import type { Map as AtlasMap } from 'maplibre-gl';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';

export interface AtlasWindow extends Window {
  __atlas: { map: AtlasMap; firstIdleMs:number; select(id: string): void; reset(): void; filter(year:number):void; destroy():void };
  __atlasMetrics: { cls: number; fcp: number | null };
}
export interface TraceEvent { name: string; ts: number; pid: number; tid: number; ph?: string }
export interface NetworkLog { origins: string[]; errors: string[]; requests: number; bytes: number }

export async function instrument(context: BrowserContext, page: Page, origin: string) {
  const log: NetworkLog = { origins: [], errors: [], requests: 0, bytes: 0 };
  page.on('console', (message) => { if (message.type() === 'error') log.errors.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => log.errors.push(`pageerror: ${error.message}`));
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) log.origins.push(url.href);
  });
  // Tile cancellation during a camera change or navigation is an expected HTTP abort,
  // not a renderer/console error; failed transport and HTTP responses still fail.
  context.on('requestfailed', (request) => {if(request.failure()?.errorText !== 'net::ERR_ABORTED')log.errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'request failed'}`);});
  context.on('response', (response) => { if (response.status() >= 400) log.errors.push(`HTTP ${response.status()} ${response.url()}`); });
  // tsx preserves function names with this helper; serialized Playwright callbacks
  // execute in a different realm and must receive the same compiler helper.
  await context.addInitScript('globalThis.__name = (target, value) => Object.defineProperty(target, "name", {value, configurable:true});');
  await context.addInitScript(() => {
    const target = window as unknown as AtlasWindow;
    target.__atlasMetrics = { cls: 0, fcp: null };
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        if (entry.name === 'first-contentful-paint') target.__atlasMetrics.fcp = entry.startTime;
      }
    }).observe({ type: 'paint', buffered: true });
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
        if (!shift.hadRecentInput) target.__atlasMetrics.cls += shift.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  // Avoid Playwright route(), which disables HTTP caching for the entire context.
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'http://*', requestStage: 'Request' }, { urlPattern: 'https://*', requestStage: 'Request' }] });
  cdp.on('Fetch.requestPaused', (event: { requestId: string; request: { url: string } }) => {
    const url = event.request.url;
    const allowed = new URL(url).origin === origin;
    const operation = allowed
      ? cdp.send('Fetch.continueRequest', { requestId: event.requestId })
      : cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
    void operation.catch((error: unknown) => log.errors.push(`Fetch interception ${url}: ${String(error)}`));
  });
  cdp.on('Network.requestWillBeSent', (event: { request: { url: string } }) => {
    if (/^https?:/.test(event.request.url)) log.requests += 1;
  });
  cdp.on('Network.loadingFinished', (event: { encodedDataLength: number }) => { log.bytes += event.encodedDataLength; });
  return { cdp, log };
}

export async function ready(page: Page): Promise<number> {
  try {
    await page.waitForFunction(() => {
      const atlas = (window as unknown as AtlasWindow).__atlas;
      return atlas && typeof atlas.select === 'function' && typeof atlas.reset === 'function'
        && atlas.map && typeof atlas.map.queryRenderedFeatures === 'function' && atlas.map.loaded();
    }, undefined, { timeout: 15000 });
  } catch (error) {
    throw new Error('Application contract unavailable after 15000ms: expected window.__atlas.map (loaded MapLibre Map), select(id), and reset()', { cause: error });
  }
  await page.evaluate(async () => { await document.fonts.ready; });
  await settle(page);
  return page.evaluate(()=>performance.now());
}

export async function settle(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((accept, reject) => {
    const map = (window as unknown as AtlasWindow).__atlas.map;
    const start = performance.now();
    const timeout = window.setTimeout(() => { map.off('idle', done); reject(new Error('Map did not emit idle within 15000ms')); }, 15000);
    function done() { window.clearTimeout(timeout); map.off('idle', done); accept(performance.now() - start); }
    map.on('idle', done);
    map.triggerRepaint();
  }));
}

export async function camera(page: Page, center: [number, number], zoom: number, duration = 0) {
  await page.evaluate(({ center, zoom, duration }) => {
    (window as unknown as AtlasWindow).__atlas.map.easeTo({ center, zoom, bearing: 0, pitch: 0, duration, essential: true });
  }, { center, zoom, duration });
  return settle(page);
}

export async function collectTrace(cdp: CDPSession, choreograph: () => Promise<void>): Promise<TraceEvent[]> {
  const events: TraceEvent[] = [];
  const onData = (event: { value: unknown[] }) => {
    for (const value of event.value) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as Partial<TraceEvent>;
      if (typeof entry.name === 'string' && typeof entry.ts === 'number'
        && typeof entry.pid === 'number' && typeof entry.tid === 'number') events.push(value as TraceEvent);
    }
  };
  cdp.on('Tracing.dataCollected', onData);
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,benchmark,cc',
    transferMode: 'ReportEvents',
  });
  try { await choreograph(); }
  finally {
    const complete = new Promise<void>((accept, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP Tracing.tracingComplete timed out after 15000ms')), 15000);
      cdp.once('Tracing.tracingComplete', () => { clearTimeout(timeout); accept(); });
    });
    await cdp.send('Tracing.end');
    await complete;
    cdp.off('Tracing.dataCollected', onData);
  }
  return events;
}

export function frameDurations(events: TraceEvent[]): number[] {
  const threads = new Map<string, number[]>();
  for (const event of events) {
    if (event.name !== 'DrawFrame' || !Number.isFinite(event.ts)) continue;
    const key = `${event.pid}:${event.tid}`;
    const times = threads.get(key) ?? [];
    times.push(event.ts);
    threads.set(key, times);
  }
  const times = [...new Set([...threads.values()].sort((left, right) => right.length - left.length)[0] ?? [])].sort((left, right) => left - right);
  if (times.length < 30) throw new Error(`CDP trace contains only ${times.length} DrawFrame timestamps on its busiest compositor thread; at least 30 required`);
  return times.slice(1).map((timestamp, index) => (timestamp - times[index]) / 1000);
}

export function percentile(values: number[], quantile: number): number {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) throw new Error('Missing or non-finite measurement samples');
  return [...values].sort((left, right) => left - right)[Math.max(0, Math.ceil(values.length * quantile) - 1)];
}
