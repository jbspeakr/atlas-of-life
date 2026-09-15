#!/usr/bin/env bash
set -euo pipefail
# CLI references: https://docs.protomaps.com/pmtiles/cli and
# https://github.com/felt/tippecanoe#tile-join
if [[ ${1:-} == --help ]]; then
  printf '%s\n' 'Usage: bash scripts/build-basemap.sh SOURCE.pmtiles [src/generated/places.json] [public/tiles/basemap.pmtiles]' 'SOURCE must be a real clustered global Protomaps archive covering z0–14.' 'CITY_PADDING_KM defaults to 20. Requires pmtiles, tile-join (Tippecanoe), python3.'
  exit 0
fi
if [[ $# -lt 1 || $# -gt 3 ]]; then printf '%s\n' 'A source archive is required. Discover current URLs at https://maps.protomaps.com/builds; use --help.' >&2; exit 2; fi
for tool in pmtiles tile-join python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then printf 'Missing dependency: %s. Install pmtiles from https://github.com/protomaps/go-pmtiles/releases and tile-join via brew install tippecanoe.\n' "$tool" >&2; exit 2; fi
done
source_archive=$1
cities=${2:-src/generated/places.json}
output=${3:-public/tiles/basemap.pmtiles}
if [[ ! -f "$cities" ]]; then printf 'Missing generated city coordinates: %s. Run npm run generate first.\n' "$cities" >&2; exit 2; fi
if [[ -e "$output" ]]; then printf 'Refusing to overwrite existing archive: %s. Choose a new output path.\n' "$output" >&2; exit 2; fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
pmtiles version
pmtiles show "$source_archive" --header-json > "$work/header.json"
python3 - "$cities" "$work" "${CITY_PADDING_KM:-20}" <<'PY'
import json, math, pathlib, sys
cities_path, work_path, padding = sys.argv[1:]
work = pathlib.Path(work_path)
header = json.loads((work / 'header.json').read_text())
if header['minzoom'] != 0 or header['maxzoom'] < 14 or header['tile_type'] != 'mvt':
    raise SystemExit('Source must be an MVT basemap containing zoom levels 0 through 14.')
if header['bounds'][0] > -179 or header['bounds'][2] < 179 or header['bounds'][1] > -85 or header['bounds'][3] < 85:
    raise SystemExit('Source does not cover the global overview.')
km = float(padding)
if not math.isfinite(km) or km <= 0:
    raise SystemExit('CITY_PADDING_KM must be a finite positive distance.')
cities = json.loads(pathlib.Path(cities_path).read_text())
if not isinstance(cities, list) or not cities:
    raise SystemExit('City input must be a nonempty array of objects with coordinates: [longitude, latitude].')
boxes = []
for city in cities:
    coordinates = city.get('coordinates')
    if not isinstance(coordinates, list) or len(coordinates) != 2:
        raise SystemExit('Each city requires coordinates: [longitude, latitude].')
    lon, lat = coordinates
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in coordinates) or not (-180 <= lon <= 180 and -85.0511287 <= lat <= 85.0511287):
        raise SystemExit('City coordinates are outside Web Mercator bounds.')
    dy = km / 111.195
    dx = min(180, km / (111.195 * math.cos(math.radians(lat))))
    south, north = max(-85.0511287, lat - dy), min(85.0511287, lat + dy)
    west, east = lon - dx, lon + dx
    # Split dateline-crossing boxes; pmtiles --bbox requires west <= east.
    segments = [(west, east)] if west >= -180 and east <= 180 else ([(west + 360, 180), (-180, east)] if west < -180 else [(west, 180), (-180, east - 360)])
    for west, east in segments:
        boxes.append(','.join(f'{v:.7f}' for v in (west, south, east, north)))
(work / 'boxes.txt').write_text('\n'.join(dict.fromkeys(boxes)) + '\n')
PY
pmtiles extract "$source_archive" "$work/world.pmtiles" --minzoom=0 --maxzoom=6
tile-join -pk -o "$work/world.mbtiles" "$work/world.pmtiles"
index=0
while IFS= read -r bbox; do
  index=$((index + 1))
  pmtiles extract "$source_archive" "$work/city-$index.pmtiles" --minzoom=7 --maxzoom=14 --bbox="$bbox"
  tile-join -pk -o "$work/city-$index.mbtiles" "$work/city-$index.pmtiles"
done < "$work/boxes.txt"
# Tile-join converts each input without dropping large tiles. Union whole tile rows
# from the SAME source so overlapping city windows cannot duplicate features.
python3 - "$work" <<'PY'
import json, pathlib, sqlite3, sys
work = pathlib.Path(sys.argv[1])
merged = work / 'merged.mbtiles'
with sqlite3.connect(merged) as db:
    # tile-join may emit a normalized database whose `tiles` is a view.
    # Materialize a portable flat union rather than trying to index that view.
    db.execute('CREATE TABLE tiles(zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB,PRIMARY KEY(zoom_level,tile_column,tile_row))')
    db.execute('CREATE TABLE metadata(name TEXT PRIMARY KEY,value TEXT)')
    layers = {}
    for path in [work / 'world.mbtiles', *sorted(work.glob('city-*.mbtiles'))]:
        with sqlite3.connect(path) as part:
            for name, value in part.execute('SELECT name,value FROM metadata'):
                db.execute('INSERT OR IGNORE INTO metadata(name,value) VALUES(?,?)',(name,value))
                if name == 'json':
                    for layer in json.loads(value).get('vector_layers', []):
                        previous = layers.get(layer['id'])
                        if previous:
                            previous['minzoom'] = min(previous.get('minzoom', 0), layer.get('minzoom', 0))
                            previous['maxzoom'] = max(previous.get('maxzoom', 14), layer.get('maxzoom', 14))
                            previous.setdefault('fields', {}).update(layer.get('fields', {}))
                        else:
                            layers[layer['id']] = layer
            db.executemany('INSERT OR IGNORE INTO tiles(zoom_level,tile_column,tile_row,tile_data) VALUES(?,?,?,?)', part.execute('SELECT zoom_level,tile_column,tile_row,tile_data FROM tiles'))
    minimum, maximum = db.execute('SELECT min(zoom_level),max(zoom_level) FROM tiles').fetchone()
    if minimum != 0 or maximum != 14:
        raise SystemExit(f'Extracted tile coverage is z{minimum}–{maximum}, expected z0–14.')
    updates = {'minzoom': '0', 'maxzoom': '14', 'bounds': '-180,-85.0511287,180,85.0511287', 'json': json.dumps({'vector_layers': list(layers.values())}), 'attribution': '© OpenStreetMap contributors · Protomaps'}
    for key, value in updates.items():
        db.execute('DELETE FROM metadata WHERE name=?', (key,))
        db.execute('INSERT INTO metadata(name,value) VALUES(?,?)', (key, value))
PY
pmtiles convert "$work/merged.mbtiles" "$work/basemap.pmtiles"
pmtiles verify "$work/basemap.pmtiles"
python3 - "$work/basemap.pmtiles" "$output" <<'PY'
import pathlib, shutil, sys
source, output = map(pathlib.Path, sys.argv[1:])
size = source.stat().st_size
if size > 250_000_000:
    print(f'WARNING: bundled basemap is {size:,} bytes, exceeding 250 MB. Prefer immutable remote hosting or reduce city padding.', file=sys.stderr)
output.parent.mkdir(parents=True, exist_ok=True)
with output.open('xb') as dest, source.open('rb') as src:
    shutil.copyfileobj(src, dest)
print(f'Bundled archive: {output} ({size:,} bytes); global z0–6 plus padded city windows z7–14.')
PY
