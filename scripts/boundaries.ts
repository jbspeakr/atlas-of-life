import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import polylabel from 'polylabel';

export type AreaGeometry = Polygon | MultiPolygon;
export type RawFeature = Feature<AreaGeometry, Record<string, unknown>>;
export type RawCollection = FeatureCollection<AreaGeometry, Record<string, unknown>>;
export type BoundaryProperties = {
  country: string;
  region?: string;
  label: string;
  bbox: [number, number, number, number];
  anchor: [number, number];
};
export type Boundary = Feature<AreaGeometry, BoundaryProperties>;
export type Boundaries = FeatureCollection<AreaGeometry, BoundaryProperties>;
type Fixture = { path: string; sha256: string; featureCount: number };
type Source = {
  provider: string;
  version: string;
  url: string;
  sha256: string;
  cache: string;
  license: string;
  licenseURL: string;
  api?: string;
  boundaryID?: string;
  fixture?: Fixture;
};
type Fallback = { country: string; region?: string; source: 'naturalEarthRegions'; reason: string };
type Manifest = {
  version: number;
  naturalEarthCountries: Source;
  naturalEarthRegions: Source;
  geoBoundaries: Record<string, Source>;
  fallbacks: Fallback[];
};
export const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = resolve(root, 'data/sources.json');
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collection(bytes: Uint8Array, label: string): RawCollection {
  const value: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (!object(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
    throw new Error(`${label}: expected a GeoJSON FeatureCollection`);
  }
  for (const feature of value.features) {
    if (!object(feature) || feature.type !== 'Feature' || !object(feature.properties) ||
        !object(feature.geometry) || !['Polygon', 'MultiPolygon'].includes(String(feature.geometry.type)) ||
        !Array.isArray(feature.geometry.coordinates)) {
      throw new Error(`${label}: unusable polygon feature`);
    }
  }
  return value as unknown as RawCollection;
}

async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Boundary download ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function readIfPresent(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (object(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export function polygons(geometry: AreaGeometry): Position[][][] {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

function ringArea(ring: Position[]): number {
  // Spherical area up to a constant factor, so high-latitude islands do not win by distortion.
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const delta = ((ring[i][0] - ring[j][0] + 540) % 360) - 180;
    sum += delta * (2 + Math.sin(ring[j][1] * Math.PI / 180) + Math.sin(ring[i][1] * Math.PI / 180));
  }
  return Math.abs(sum);
}

export function geometryMetadata(geometry: AreaGeometry): Pick<BoundaryProperties, 'bbox' | 'anchor'> {
  const parts = polygons(geometry);
  const bbox: BoundaryProperties['bbox'] = [Infinity, Infinity, -Infinity, -Infinity];
  let largest = parts[0];
  let largestArea = -1;
  for (const polygon of parts) {
    const area = ringArea(polygon[0]) - polygon.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0);
    if (area > largestArea) { largestArea = area; largest = polygon; }
    for (const ring of polygon) for (const [x, y] of ring) {
      bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y);
      bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y);
    }
  }
  if (!largest || !bbox.every(Number.isFinite)) throw new Error('Boundary has no polygon coordinates');
  const point = polylabel(largest as [number, number][][], 0.001);
  return { bbox, anchor: [point[0], point[1]] };
}

function ringContains(point: [number, number], ring: Position[]): boolean {
  let inside = false;
  // Unwrap each edge without allocating a second copy of high-resolution source rings.
  let ax = ring[0][0];
  let ay = ring[0][1];
  const x = point[0] + Math.round((ax - point[0]) / 360) * 360;
  const y = point[1];
  for (let i = 1; i < ring.length; i++) {
    const bx = ring[i][0] + Math.round((ax - ring[i][0]) / 360) * 360;
    const by = ring[i][1];
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-10 && x >= Math.min(ax, bx) && x <= Math.max(ax, bx) &&
        y >= Math.min(ay, by) && y <= Math.max(ay, by)) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    ax = bx; ay = by;
  }
  return inside;
}

export function containsPoint(geometry: AreaGeometry, point: [number, number]): boolean {
  return polygons(geometry).some(polygon => ringContains(point, polygon[0]) &&
    !polygon.slice(1).some(hole => ringContains(point, hole)));
}

function combine(features: RawFeature[], id: string, country: string, label: string, region?: string): Boundary {
  const coordinates = features.flatMap(feature => polygons(feature.geometry));
  const geometry: AreaGeometry = coordinates.length === 1
    ? { type: 'Polygon', coordinates: coordinates[0] }
    : { type: 'MultiPolygon', coordinates };
  return { type: 'Feature', id, geometry, properties: {
    country, ...(region ? { region } : {}), label, ...geometryMetadata(geometry),
  } };
}

export class BoundaryRepository {
  private readonly datasets = new Map<string, RawCollection>();
  private changed = false;
  private constructor(private readonly manifest: Manifest) {}

  static async open(): Promise<BoundaryRepository> {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    if (manifest.version !== 1) throw new Error('Unsupported boundary source manifest version');
    return new BoundaryRepository(manifest);
  }

  private async load(source: Source, fixture = false): Promise<RawCollection> {
    if (process.env.ATLAS_FIXTURE === '1' && (!fixture || !source.fixture)) {
      throw new Error(`ATLAS_FIXTURE=1: missing committed boundary coverage for ${source.cache}; network and mutable download caches are disabled`);
    }
    const path = fixture && source.fixture ? source.fixture.path : source.cache;
    const digest = fixture && source.fixture ? source.fixture.sha256 : source.sha256;
    const loaded = this.datasets.get(path);
    if (loaded) return loaded;
    let bytes = await readIfPresent(resolve(root, path));
    if (!bytes) {
      if (fixture) throw new Error(`Missing committed boundary fixture: ${path}`);
      console.log(`Boundary cache miss: downloading pinned ${source.url}`);
      bytes = await fetchBytes(source.url);
      if (sha256(bytes) !== digest) throw new Error(`Boundary SHA256 mismatch: ${source.url}`);
      await mkdir(dirname(resolve(root, path)), { recursive: true });
      await writeFile(resolve(root, path), bytes);
    }
    if (sha256(bytes) !== digest) throw new Error(`Boundary SHA256 mismatch: ${path}`);
    const parsed = collection(bytes, path);
    this.datasets.set(path, parsed);
    return parsed;
  }

  async countries(codes: string[]): Promise<{ boundaries: Boundary[]; iso3: Map<string, string> }> {
    const source = this.manifest.naturalEarthCountries;
    let data = await this.load(source, Boolean(source.fixture));
    if (codes.some(code => !data.features.some(feature => feature.properties.ISO_A2_EH === code))) {
      data = await this.load(source);
    }
    const iso3 = new Map<string, string>();
    const boundaries = codes.map(code => {
      const features = data.features.filter(feature => feature.properties.ISO_A2_EH === code);
      if (!features.length) throw new Error(`Natural Earth 10m has no country boundary for ${code}`);
      const primary = features.find(feature => feature.properties.ADM0_A3 === feature.properties.ISO_A3_EH) ?? features[0];
      iso3.set(code, code === 'XK' ? 'XKX' : String(primary.properties.ISO_A3_EH));
      return combine(features, code, code, String(primary.properties.NAME_EN ?? primary.properties.ADMIN));
    });
    return { boundaries, iso3 };
  }

  private async gbSource(iso3: string): Promise<Source> {
    const existing = this.manifest.geoBoundaries[iso3];
    if (existing) return existing;
    if (process.env.ATLAS_FIXTURE === '1') throw new Error(`ATLAS_FIXTURE=1: no pinned gbOpen fixture for ${iso3}; network is disabled`);
    const api = `https://www.geoboundaries.org/api/current/gbOpen/${iso3}/ADM1/`;
    console.log(`Discovering gbOpen boundary source: ${api}`);
    const metadata: unknown = JSON.parse((await fetchBytes(api)).toString('utf8'));
    if (!object(metadata) || typeof metadata.gjDownloadURL !== 'string') throw new Error(`gbOpen ADM1 is absent for ${iso3}`);
    // Resolve Git LFS to its actual object, keeping the API's immutable commit in the URL.
    const url = metadata.gjDownloadURL.replace('https://github.com/wmgeolab/geoBoundaries/raw/',
      'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/');
    const version = /geoBoundaries\/([^/]+)\//.exec(url)?.[1];
    if (!version || !/^[a-f0-9]{7,40}$/.test(version)) throw new Error(`gbOpen URL is not commit-pinned: ${url}`);
    const bytes = await fetchBytes(url);
    const parsed = collection(bytes, url);
    const source: Source = {
      provider: 'geoBoundaries gbOpen', version, url, sha256: sha256(bytes),
      cache: `data/.geocache/gbOpen-${iso3}-ADM1.geojson`, api,
      boundaryID: String(metadata.boundaryID), license: String(metadata.boundaryLicense),
      licenseURL: String(metadata.licenseSource).startsWith('http') ? String(metadata.licenseSource) : `https://${String(metadata.licenseSource)}`,
    };
    await mkdir(resolve(root, 'data/.geocache'), { recursive: true });
    await writeFile(resolve(root, source.cache), bytes);
    this.datasets.set(source.cache, parsed);
    this.manifest.geoBoundaries[iso3] = source;
    this.changed = true;
    return source;
  }

  private regionFeatures(data: RawCollection, country: string, iso3: string, naturalEarth = false): Boundary[] {
    const groups = new Map<string, RawFeature[]>();
    for (const feature of data.features) {
      const props = feature.properties;
      const code = naturalEarth ? props.iso_3166_2 : props.shapeISO;
      const belongs = naturalEarth ? props.iso_a2 === country : props.shapeGroup === iso3;
      if (!belongs || typeof code !== 'string' || !code.startsWith(`${country}-`)) continue;
      const members = groups.get(code) ?? [];
      members.push(feature); groups.set(code, members);
    }
    return [...groups].map(([code, features]) => combine(features, code, country,
      String(features[0].properties[naturalEarth ? 'name_en' : 'shapeName'] ?? features[0].properties.name), code));
  }

  async regions(country: string, iso3: string, requests: { region?: string; coordinates?: [number, number] }[]): Promise<Boundary[]> {
    const requested = requests.filter(visit => visit.region || visit.coordinates);
    if (!requested.length) return [];
    const satisfies = (features: Boundary[], request: typeof requested[number]) => request.region
      ? features.some(feature => feature.id === request.region || feature.properties.label === request.region)
      : features.some(feature => containsPoint(feature.geometry, request.coordinates!));
    let features: Boundary[] = [];
    let unavailable: string | undefined;
    try {
      const source = await this.gbSource(iso3);
      features = this.regionFeatures(await this.load(source, Boolean(source.fixture)), country, iso3);
      if (requested.some(request => !satisfies(features, request)) && source.fixture) {
        features = this.regionFeatures(await this.load(source), country, iso3);
      }
    } catch (error) {
      if (process.env.ATLAS_FIXTURE === '1') throw error;
      // Corrupt local sources must never be silently replaced by another provider.
      if (error instanceof Error && error.message.includes('SHA256 mismatch')) throw error;
      unavailable = error instanceof Error ? error.message : String(error);
    }
    const missing = requested.filter(request => !satisfies(features, request));
    if (missing.length) {
      const fallback = this.regionFeatures(await this.load(this.manifest.naturalEarthRegions), country, iso3, true);
      for (const request of missing) {
        const replacement = fallback.find(feature => request.region
          ? feature.id === request.region || feature.properties.label === request.region : containsPoint(feature.geometry, request.coordinates!));
        if (!replacement) {
          if (request.region) throw new Error(`No usable ADM1 boundary for ${request.region}: ${unavailable ?? 'absent from gbOpen and Natural Earth'}`);
          throw new Error(`No ADM1 boundary contains ${request.coordinates?.join(',')} in ${country}; specify a valid region explicitly`);
        }
        if (!features.some(feature => feature.id === replacement.id)) features.push(replacement);
        const reason = unavailable ?? `gbOpen ADM1 does not cover ${request.region ?? request.coordinates?.join(',')}`;
        const record: Fallback = { country, region: String(replacement.id), source: 'naturalEarthRegions', reason };
        if (!this.manifest.fallbacks.some(item => item.country === record.country && item.region === record.region && item.reason === reason)) {
          this.manifest.fallbacks.push(record); this.changed = true;
        }
        console.warn(`Natural Earth ADM1 fallback for ${replacement.id}: ${reason}`);
      }
    }
    // Never expose unvisited polygons, even when a full upstream country dataset was loaded.
    return features.filter(feature => requested.some(request => request.region
      ? feature.id === request.region || feature.properties.label === request.region : containsPoint(feature.geometry, request.coordinates!)));
  }

  async save(): Promise<void> {
    if (this.changed) await writeFile(manifestPath, `${JSON.stringify(this.manifest, null, 2)}\n`);
  }
}
