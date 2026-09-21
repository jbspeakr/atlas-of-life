# Attribution and licences

The application's original code is MIT (see `LICENSE`). Geographic data, fonts and upstream software retain their own licences; MIT does not replace them. The map always displays “© OpenStreetMap contributors” and an expandable credit control.

## OpenStreetMap and Protomaps

© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). OSM data is available under the [Open Database Licence 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Tile archives are derived OSM basemaps built by [Protomaps](https://protomaps.com). The included fixture and the exercised full archive derive from the 2026-09-14 Protomaps build, schema 4.15.2. Archive extracts contain derived OSM tile content only; no authored visit records are written into them. Preserve attribution and ODbL provenance when redistributing an extract; the publishing command stages a dataset card for that purpose.

Protomaps style code is BSD-3-Clause, copyright 2019–2023 Protomaps LLC and Kelso Cartography. Its visual design by Geraldine Sarmiento is CC0; schema work derives from Tilezen/Mapzen under MIT. Vendored sprites and glyphs come from `protomaps/basemaps-assets` commit `028c18f713baecad011301ff7a69acc39bcc2ae7`. Full notices ship as `public/PROTOMAPS-LICENSE.txt` and `public/THIRD-PARTY-LICENSES.txt`. The local theme changes colours and reduces labels; it does not imply upstream endorsement.

## Natural Earth

[Natural Earth](https://www.naturalearthdata.com/), 1:10m Admin 0 Countries, release 5.1.2. Public domain ([terms](https://www.naturalearthdata.com/about/terms-of-use/)). The Admin 1 States/Provinces dataset at the same release is the fallback for missing or unusable gbOpen geometry. Country selection uses `ISO_A2_EH`, not the frequently missing `ISO_A2`. Source URLs and original/selected-file SHA-256 checksums are in `data/sources.json`. Generated geometries are selected, combined where required, simplified with weighted Visvalingam and quantized.

## geoBoundaries

[geoBoundaries gbOpen](https://www.geoboundaries.org/), CC-BY 4.0. Cite **Runfola et al. (2020), “geoBoundaries: A global database of political administrative boundaries,” PLOS ONE 15(4): e0231866**, [doi:10.1371/journal.pone.0231866](https://doi.org/10.1371/journal.pone.0231866). Per-country ADM1 fixtures are pinned to upstream revision `9469f09`; only visited regions are shipped. Selection, simplification, quantization and interior anchors are modifications made by this project.

Retain the original upstream notices carried by gbOpen as well:

- **Germany:** © GeoBasis-DE / BKG, 2021, administrative/NUTS boundaries. [Data licence Germany – attribution – version 2.0](https://www.govdata.de/dl-de/by-2-0). Source: [BKG administrative geography](https://gdz.bkg.bund.de/index.php/default/digitale-geodaten/verwaltungsgebiete/nuts-gebiete-1-250-000-stand-31-12-nuts250-31-12.html).
- **France:** IGN, ADMIN EXPRESS, 2022. [Etalab Open Licence 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/). Source: [IGN Admin Express](https://geoservices.ign.fr/adminexpress).
- **United Kingdom:** European Commission / Eurostat GISCO, NUTS 2021; CC-BY 4.0, [legal notice](https://ec.europa.eu/info/legal-notice_en). Source: [GISCO administrative units](https://ec.europa.eu/eurostat/web/gisco/geodata/reference-data/administrative-units-statistical-units/nuts).

The original API metadata and checksums, including country-specific licence URLs, are preserved in the source manifest. Future countries must retain their own upstream credit requirements, not just the generic gbOpen credit.

## Geocoding and fonts

[Nominatim](https://nominatim.org/) is an OSM-based build-time geocoder; observe its [public-server usage policy](https://operations.osmfoundation.org/policies/nominatim/). The included warm cache uses cited public city/landmark coordinates; each cache entry retains its source URL internally. Cache provenance is never shipped as place data.

Fraunces (Undercase Type, Phaedra Charles and Flavia Zimbardi) and Noto Sans (The Noto Project) are self-hosted WOFF2, SIL Open Font Licence 1.1. Full notices are retained in `public/fonts/OFL-fraunces.txt` and `OFL-noto-sans.txt`. The same Noto Sans family is used for map glyphs, preserving the two-family limit; those glyphs retain `public/glyphs/OFL.txt`. MapLibre GL JS and PMTiles are BSD-3-Clause; React is MIT. Runtime notices are shipped in the public directory.
