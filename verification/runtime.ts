import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, type Browser } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Check } from './types';
import { startServer, type VerificationServer } from './server';
import { camera, collectTrace, frameDurations, instrument, percentile, ready, settle, type AtlasWindow, type NetworkLog } from './browser';

interface Place { id: string; label: string; date?: string; dateRange?: { start: string; end: string } | [string, string] }
interface Budgets {
  firstViewBytes: number; firstViewRequests: number; frameP95: number; longFrames: number;
  idleMs: number; heapBytes: number; visualDiff: number; fcpWarmMs: number; fcpColdMs: number; layoutShift: number;
}
const viewport = { width: 1440, height: 900 };
const artifacts = 'verification/artifacts';
const baselineDirectory = 'verification/baselines';
const describe = (error: unknown) => error instanceof Error ? `${error.name}: ${error.message}` : String(error);

export async function runtimeChecks(approve = false): Promise<Check[]> {
  const checks: Check[] = [];
  const record = (id: string, category: Check['category'], metric: number, unit: string, threshold: number,
    message: string, comparator: Check['comparator'] = 'lte', extra: Partial<Check> = {}) => {
    const passes = Number.isFinite(metric) && Number.isFinite(threshold)
      && (comparator === 'lte' ? metric <= threshold : comparator === 'gte' ? metric >= threshold : metric === threshold);
    checks.push({ id, category, status: passes ? 'pass' : 'fail', metric, unit, threshold, comparator, message, ...extra });
  };
  const failed = (id: string, category: Check['category'], error: unknown) => record(id, category, 1, 'errors', 0, describe(error), 'eq');
  const run = async (id: string, category: Check['category'], action: () => Promise<void>) => {
    try { await action(); } catch (error) { failed(id, category, error); }
  };
  let budgets: Budgets;
  try {
    budgets = JSON.parse(await readFile('verification/budgets.json', 'utf8')) as Budgets;
    for (const key of ['firstViewBytes', 'firstViewRequests', 'frameP95', 'longFrames', 'idleMs', 'heapBytes', 'visualDiff', 'fcpWarmMs', 'fcpColdMs', 'layoutShift'] as const) {
      if (!Number.isFinite(budgets[key])) throw new Error(`verification/budgets.json missing finite ${key}`);
    }
  } catch (error) { failed('runtime.budgets', 'correctness', error); return checks; }
  try { await access('dist/index.html'); }
  catch (error) { failed('runtime.dist', 'correctness', `dist/index.html missing: build the application before browser verification. ${describe(error)}`); return checks; }
  await mkdir(artifacts, { recursive: true });
  let server: VerificationServer | undefined;
  let browser: Browser | undefined;
  let networkLog: NetworkLog | undefined;
  try {
    server = await startServer();
    browser = await chromium.launch({
      headless: true,
      ignoreDefaultArgs: ['--disable-gpu'],
      args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--force-color-profile=srgb'],
    });
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'UTC', colorScheme: 'dark', reducedMotion: 'no-preference', serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const { cdp, log } = await instrument(context, page, server.origin);
    networkLog = log;
    const url = `${server.origin}/atlas/?deterministic=1`;
    await cdp.send('Network.clearBrowserCache');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const navigation = await page.goto(url, { waitUntil: 'load' });
    if (!navigation || navigation.status() !== 200) throw new Error(`GET ${url}: HTTP ${navigation?.status() ?? 'no response'}`);
    const firstIdle = await ready(page);
    record('runtime.contract', 'correctness', 0, 'errors', 0, 'dist/index.html exposes window.__atlas.map/select/reset and a loaded map under /atlas/.', 'eq');
    record('runtime.fixture-idle', 'performance', firstIdle, 'ms', budgets.idleMs, `Deterministic fixture map loaded + fonts ready + idle; normal startup is measured separately.`);
    record('network.first-view-bytes', 'network', log.bytes, 'bytes', budgets.firstViewBytes, 'CDP Network.loadingFinished encodedDataLength summed for cold first view, including response headers.');
    record('network.first-view-requests', 'network', log.requests, 'requests', budgets.firstViewRequests, 'CDP Network.requestWillBeSent count through cold first-view idle.');
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750,connectionType:'cellular4g'});
    await page.goto(`${server.origin}/atlas/`,{waitUntil:'load'});
    await page.waitForFunction(()=>(window as unknown as AtlasWindow).__atlas?.firstIdleMs>0);
    const cold = await page.evaluate(() => (window as unknown as AtlasWindow).__atlasMetrics);
    if (cold.fcp === null) failed('performance.fcp-cold', 'performance', 'No first-contentful-paint PerformanceEntry on cold navigation');
    else record('performance.fcp-cold', 'performance', cold.fcp, 'ms', budgets.fcpColdMs, 'Cache disabled, CDP 4G: 150ms RTT, 1.6Mbps down; navigation-relative first-contentful-paint.');
    record('performance.cls', 'performance', cold.cls, 'score', budgets.layoutShift, 'Buffered layout-shift entries excluding recent user input through first idle.');
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await page.goto(url,{waitUntil:'load'});
    await ready(page);
    await run('runtime.gpu', 'correctness', async () => {
      const info = await page.evaluate(() => {
        const canvas = (window as unknown as AtlasWindow).__atlas.map.getCanvas();
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        if (!gl) throw new Error('Map canvas has no WebGL context');
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        if (!extension) throw new Error('WEBGL_debug_renderer_info unavailable; GPU renderer cannot be verified');
        return String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL));
      });
      record('runtime.gpu', 'correctness', /swiftshader|llvmpipe|software rasterizer/i.test(info) ? 1 : 0, 'software renderers', 0, `Chromium ${browser?.version()}; WebGL renderer: ${info}`, 'eq');
    });
    await run('visual.nonblank-canvas', 'visual', async () => {
      const canvas = page.locator('.maplibregl-canvas');
      const image = PNG.sync.read(await canvas.screenshot());
      const colors = new Set<number>();
      for (let offset = 0; offset < image.data.length; offset += 16) {
        const [red, green, blue] = image.data.subarray(offset, offset + 3);
        colors.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4));
      }
      record('visual.nonblank-canvas', 'visual', colors.size, 'quantized colors', 8, `Actual WebGL canvas screenshot ${image.width}×${image.height}; 4-bit RGB sampled every fourth pixel.`, 'gte');
    });
    const screenshot = async (name: string) => {
      await settle(page);
      const actual = await page.screenshot({ animations: 'disabled', caret: 'hide' });
      const actualPath = `${artifacts}/${name}.actual.png`;
      const baselinePath = `${baselineDirectory}/${name}.png`;
      await writeFile(actualPath, actual);
      if (approve) {
        await mkdir(baselineDirectory, { recursive: true });
        await writeFile(baselinePath, actual);
      }
      let expectedBytes: Buffer;
      try { expectedBytes = await readFile(baselinePath); }
      catch (error) { throw new Error(`Missing approved baseline ${baselinePath}; actual ${actualPath}; only npm run verify:approve creates baselines. ${describe(error)}`, { cause: error }); }
      const expected = PNG.sync.read(expectedBytes);
      const observed = PNG.sync.read(actual);
      if (expected.width !== observed.width || expected.height !== observed.height) throw new Error(`${baselinePath} dimensions ${expected.width}×${expected.height} differ from ${actualPath} ${observed.width}×${observed.height}`);
      const diff = new PNG({ width: observed.width, height: observed.height });
      const different = pixelmatch(expected.data, observed.data, diff.data, observed.width, observed.height, { threshold: 0, includeAA: true });
      const diffPath = `${artifacts}/${name}.diff.png`;
      await writeFile(diffPath, PNG.sync.write(diff));
      record(`visual.${name}`, 'visual', different, 'different pixels', budgets.visualDiff, `${approve ? 'Explicit approval wrote baseline. ' : ''}${baselinePath} vs ${actualPath}; exact pixelmatch including anti-aliasing, diff ${diffPath}; Chromium ${browser?.version()}, viewport ${JSON.stringify(page.viewportSize())}, DPR 1.`);
    };
    const axe = async (name: string) => {
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const filename = `${artifacts}/axe-${name}.json`;
      await writeFile(filename, JSON.stringify(result, null, 2));
      record(`a11y.${name}`, 'a11y', result.violations.length, 'violations', 0,
        `${filename}: ${result.violations.map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`).join('; ') || 'No WCAG A/AA violations'}`, 'eq');
    };
    await run('a11y.initial', 'a11y', () => axe('initial'));
    await run('visual.globe', 'visual', () => screenshot('globe'));
    await run('interaction.country', 'correctness', async () => {
      await camera(page, [10, 51], 3);
      const target = await page.evaluate(() => {
        const map = (window as unknown as AtlasWindow).__atlas.map;
        const before = { zoom: map.getZoom(), center: map.getCenter().toArray() };
        const bounds = map.getCanvas().getBoundingClientRect();
        for (let y = 80; y < bounds.height - 80; y += 12) for (let x = 80; x < bounds.width - 80; x += 12) {
          if (document.elementFromPoint(bounds.left + x, bounds.top + y) !== map.getCanvas()) continue;
          const features = map.queryRenderedFeatures([x, y]);
          const country = features.find((feature) => ['Polygon', 'MultiPolygon'].includes(feature.geometry.type)
            && feature.layer.id === 'countries' && feature.properties.country === 'DE');
          if (country) return { x: bounds.left + x, y: bounds.top + y, before, layer: country.layer.id };
        }
        throw new Error('No rendered DE country polygon found in map.queryRenderedFeatures; country click cannot be exercised');
      });
      await page.mouse.click(target.x, target.y);
      await page.waitForFunction((before) => {
        const map = (window as unknown as AtlasWindow).__atlas.map;
        const center = map.getCenter().toArray();
        return Math.abs(map.getZoom() - before.zoom) > 0.1 || Math.hypot(center[0] - before.center[0], center[1] - before.center[1]) > 0.1;
      }, target.before);
      await settle(page);
      record('interaction.country', 'correctness', 0, 'errors', 0, `Real pointer click on rendered DE polygon in layer ${target.layer} changed camera.`, 'eq');
    });
    await run('visual.country', 'visual', () => screenshot('country'));
    await run('visual.region', 'visual', async () => { await camera(page, [11.5, 48.5], 6); await screenshot('region'); });
    await run('visual.city', 'visual', async () => { await camera(page, [13.405, 52.52], 10); await screenshot('city'); });
    const buttons = page.locator('[data-place-id]');
    const ids = await buttons.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-place-id') ?? ''));
    record('data.fixture-pins', 'data', new Set(ids).size, 'unique places', 6, `Expected six deterministic fixture cities, rendered IDs: ${ids.join(', ')}`, 'eq');
    const first = ids[0];
    if (!first) throw new Error('No [data-place-id] controls exist; cannot exercise selection, keyboard, caption or deep link');
    const places = JSON.parse(await readFile('src/generated/places.json', 'utf8')) as Place[];
    const expectedLabel = places.find((place) => place.id === first)?.label;
    if (!expectedLabel) throw new Error(`src/generated/places.json has no label for rendered place ${first}`);
    await run('interaction.pin-caption', 'correctness', async () => {
      await buttons.first().click();
      const dialog = page.getByRole('dialog', { name: 'Place', exact: true });
      await dialog.waitFor({ state: 'visible' });
      const text = await dialog.innerText();
      if (!text.includes(expectedLabel)) throw new Error(`Place dialog after selecting ${first} must contain ${expectedLabel}; actual: ${text}`);
      record('interaction.pin-caption', 'correctness', 0, 'errors', 0, `Pointer selected ${first}; visible Place dialog: ${text}`, 'eq');
      await run('a11y.caption', 'a11y', () => axe('caption'));
      await run('visual.caption', 'visual', () => screenshot('caption'));
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-place-id'));
      record('a11y.escape-focus-return', 'a11y', focused === first ? 0 : 1, 'errors', 0, `Escape closes Place dialog and returns focus to ${first}; actual active data-place-id=${focused}`, 'eq');
    });
    await run('a11y.chronological-tab', 'a11y', async () => {
      const date = (place: Place) => place.date ?? (Array.isArray(place.dateRange) ? place.dateRange[0] : place.dateRange?.start) ?? '';
      if (!Array.isArray(places) || places.some((place) => !place.id || !date(place))) throw new Error('src/generated/places.json must contain dated places for an independently derived chronological keyboard order');
      const expected = [...places].sort((left, right) => date(left).localeCompare(date(right)) || left.id.localeCompare(right.id)).map((place) => place.id);
      await page.evaluate(() => (window as unknown as AtlasWindow).__atlas.reset());
      await settle(page);
      await page.evaluate(() => { const active = document.activeElement; if (active instanceof HTMLElement) active.blur(); document.body.tabIndex = -1; document.body.focus(); });
      const observed: string[] = [];
      for (let count = 0; count < 100 && observed.length < expected.length; count += 1) {
        await page.keyboard.press('Tab');
        const id = await page.evaluate(() => document.activeElement?.getAttribute('data-place-id'));
        if (id) observed.push(id);
      }
      record('a11y.chronological-tab', 'a11y', JSON.stringify(observed) === JSON.stringify(expected) ? 0 : 1, 'order mismatches', 0,
        `src/generated/places.json expected ${expected.join(' → ')}; actual keyboard Tab ${observed.join(' → ')}`, 'eq');
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Place', exact: true });
      await dialog.waitFor({ state: 'visible' });
      const activated = observed[observed.length - 1];
      const label = places.find((place) => place.id === activated)?.label;
      const caption = await dialog.innerText();
      record('a11y.keyboard-activation', 'a11y', label && caption.includes(label) ? 0 : 1, 'errors', 0, `Enter on ${activated} opens matching caption; expected ${label}, actual ${caption}`, 'eq');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      const returned = await page.evaluate(() => document.activeElement?.getAttribute('data-place-id'));
      record('a11y.keyboard-focus-return', 'a11y', returned === activated ? 0 : 1, 'errors', 0, `Escape after keyboard activation returns focus to ${activated}; actual ${returned}`, 'eq');
    });
    await run('interaction.timeline', 'correctness', async () => {
      const slider = page.getByRole('slider', { name: 'Year', exact: true });
      const before = await slider.inputValue();
      await slider.focus();
      await slider.press('Home');
      const after = await slider.inputValue();
      if (after === before) await slider.press('End');
      const changed = await slider.inputValue();
      record('interaction.timeline', 'correctness', changed === before ? 1 : 0, 'errors', 0, `Keyboard Year timeline value before=${before}, after=${changed}`, 'eq');
      await run('a11y.timeline', 'a11y', () => axe('timeline'));
      await slider.press('End');
    });
    await run('interaction.deep-link', 'correctness', async () => {
      const deepLink = `${url}#/place/${encodeURIComponent(first)}`;
      await page.goto(deepLink, { waitUntil: 'load' });
      await page.reload({ waitUntil: 'load' });
      await ready(page);
      await page.getByRole('dialog', { name: 'Place', exact: true }).waitFor({ state: 'visible' });
      const text = await page.getByRole('dialog', { name: 'Place', exact: true }).innerText();
      record('interaction.deep-link', 'correctness', text.includes(expectedLabel) ? 0 : 1, 'errors', 0, `Reload ${deepLink} must restore ${expectedLabel} caption; actual: ${text}`, 'eq');
      await page.keyboard.press('Escape');
    });
    await run('visual.mobile', 'visual', async () => {
      await page.setViewportSize({ width: 375, height: 844 });
      await page.evaluate(() => { const atlas = (window as unknown as AtlasWindow).__atlas; atlas.map.resize(); atlas.reset(); });
      await screenshot('mobile');
    });
    await page.setViewportSize(viewport);
    await page.evaluate(() => { const atlas = (window as unknown as AtlasWindow).__atlas; atlas.map.resize(); atlas.reset(); });
    await settle(page);
    await run('performance.frames', 'performance', async () => {
      await page.goto(`${server!.origin}/atlas/`,{waitUntil:'load'});
      await page.waitForFunction(()=>(window as unknown as AtlasWindow).__atlas?.firstIdleMs>0);
      const normalIdle=await page.evaluate(()=>(window as unknown as AtlasWindow).__atlas.firstIdleMs);
      record('runtime.idle','performance',normalIdle,'ms',budgets.idleMs,'Normal production startup: actual first MapLibre idle event relative to navigation, with ignition and rotation enabled.');
      await page.waitForFunction(()=>['DE','FR','GB'].every(id=>(window as unknown as AtlasWindow).__atlas.map.getFeatureState({source:'countries',id}).visibility===1));
      const rotation=await page.evaluate(()=>new Promise<number>(resolve=>{const map=(window as unknown as AtlasWindow).__atlas.map;const before=map.getCenter().lng;setTimeout(()=>resolve(Math.abs(map.getCenter().lng-before)),500);}));
      record('motion.idle-rotation','correctness',rotation,'degrees / 500ms',.05,'Normal motion startup must settle into visible globe rotation.','gte');
      await page.getByRole('button',{name:'Back to the world'}).click();
      await ready(page);
      const p95: number[] = [];
      const long: number[] = [];
      for (let repetition = 0; repetition < 5; repetition += 1) {
        await camera(page, [5, 45], 2);
        const events = await collectTrace(cdp, async () => {
          await camera(page, [10, 51], 4.5, 900);
          await camera(page, [13.405, 52.52], 6, 900);
          await camera(page, [13.405, 52.52], 10, 900);
          await page.evaluate(id=>(window as unknown as AtlasWindow).__atlas.select(id),first);
          await settle(page);
          await page.evaluate(()=>(window as unknown as AtlasWindow).__atlas.reset());
          await settle(page);
        });
        const path = `${artifacts}/camera-${repetition + 1}.trace.json`;
        await writeFile(path, JSON.stringify({ traceEvents: events }));
        const durations = frameDurations(events);
        p95.push(percentile(durations, 0.95));
        long.push(durations.filter((duration) => duration > 32).length);
      }
      const median = percentile(p95, 0.5);
      const spread = Math.max(...p95) - Math.min(...p95);
      const unstable = median === 0 ? spread > 0 : spread / median > 0.2;
      record('perf.frametime.p95', 'performance', median, 'ms', budgets.frameP95,
        `Five fixed camera choreographies; compositor DrawFrame timestamp intervals. Per-run p95 ms=${p95.join(', ')}; max−min spread=${spread}ms; relative spread=${median ? spread / median : 0}; traces ${artifacts}/camera-[1-5].trace.json.`, 'lte', { spread, unstable });
      const longMedian = percentile(long, 0.5);
      record('performance.long-frames', 'performance', longMedian, 'frames >32ms', budgets.longFrames, `Five choreography long-frame counts=${long.join(', ')}; reported median.`, 'lte', { spread: Math.max(...long) - Math.min(...long) });
    });
    await run('performance.heap', 'performance', async () => {
      const result = await cdp.send('Performance.getMetrics');
      const heap = result.metrics.find((metric: { name: string; value: number }) => metric.name === 'JSHeapUsedSize');
      if (!heap) throw new Error('CDP Performance.getMetrics omitted JSHeapUsedSize');
      record('performance.heap', 'performance', heap.value, 'bytes', budgets.heapBytes, 'Actual CDP JSHeapUsedSize after all five camera choreographies, without forced garbage collection.');
    });
    await run('performance.fcp-warm', 'performance', async () => {
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
      await page.goto(url, { waitUntil: 'load' });
      await ready(page);
      await page.reload({ waitUntil: 'load' });
      await ready(page);
      const warm = await page.evaluate(() => ({
        ...(window as unknown as AtlasWindow).__atlasMetrics,
        cachedResources: (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
          .filter((entry) => entry.transferSize === 0 && entry.decodedBodySize > 0).map((entry) => entry.name),
      }));
      if (warm.fcp === null) throw new Error('No first-contentful-paint PerformanceEntry on warm reload');
      record('performance.warm-cache', 'performance', warm.cachedResources.length, 'cached resources', 1, `ResourceTiming confirms cache use: ${warm.cachedResources.join(', ') || 'none; warm-cache precondition failed'}`, 'gte');
      record('performance.fcp-warm', 'performance', warm.fcp, 'ms', budgets.fcpWarmMs, 'HTTP cache enabled, one priming navigation, then measured same-context reload FCP.');
      record('performance.cls-warm', 'performance', warm.cls, 'score', budgets.layoutShift, 'Warm reload buffered layout-shift score through idle, excluding recent input.');
    });
    await run('motion.reduced', 'performance', async () => {
      const reducedContext = await browser!.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'UTC', colorScheme: 'dark', reducedMotion: 'reduce', serviceWorkers: 'block' });
      try {
        const reducedPage = await reducedContext.newPage();
        const reduced = await instrument(reducedContext, reducedPage, server!.origin);
        await reducedPage.goto(`${server!.origin}/atlas/`, { waitUntil: 'load' });
        await ready(reducedPage);
        const renders = await reducedPage.evaluate(() => new Promise<number>((accept) => {
          const map = (window as unknown as AtlasWindow).__atlas.map;
          let count = 0;
          const render = () => { count += 1; };
          map.on('render', render);
          window.setTimeout(() => { map.off('render', render); accept(count); }, 2000);
        }));
        record('motion.reduced', 'performance', renders, 'render frames / 2000ms', 0, 'Real reduced-motion media context without deterministic query; MapLibre render events counted for 2000ms after settled.', 'eq');
        log.origins.push(...reduced.log.origins);
        log.errors.push(...reduced.log.errors);
      } finally { await reducedContext.close(); }
    });
    await writeFile(`${artifacts}/browser-environment.json`, JSON.stringify({ chromium: browser.version(), viewport, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'UTC', origin: server.origin, approve }, null, 2));
    await context.close();
  } catch (error) { failed('runtime.browser', 'correctness', error); }
  finally {
    if (networkLog) {
      record('network.origins', 'network', networkLog.origins.length, 'unexpected requests', 0, `Only ${server?.origin} allowed in bundled mode; unexpected URLs: ${networkLog.origins.join(', ') || 'none'}. Disallowed requests fail visibly, never silently mocked.`, 'eq');
      record('runtime.browser-errors', 'correctness', networkLog.errors.length, 'errors', 0, networkLog.errors.join('\n') || 'No console errors, page exceptions, failed requests or HTTP errors.', 'eq');
    }
    if (browser) await browser.close().catch((error: unknown) => failed('runtime.browser-close', 'correctness', error));
    if (server) await server.close().catch((error: unknown) => failed('runtime.server-close', 'correctness', error));
  }
  return checks;
}
