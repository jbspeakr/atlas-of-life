import type { Config } from "../scripts/config.ts";

const config: Config = {
  publishPrecision: "city",
  // Home is where journeys start and end, not a place visited: it gets its own
  // quiet mark and never counts as a visit.
  home: { country: "DE", city: "Berlin", since: "2024-04-25" },
  visits: [
    {
      country: "DE",
      city: "Wendisch Rietz",
      dateRange: ["2025-04-04", "2025-04-06"],
    },
    {
      country: "GR",
      city: "Kalamos",
      dateRange: ["2025-04-27", "2025-05-02"],
    },
    {
      country: "DE",
      city: "Jena",
      dateRange: ["2025-05-17", "2025-05-18"],
    },
    {
      country: "DE",
      city: "Hollenbeck",
      dateRange: ["2025-05-24", "2025-05-25"],
    },
    {
      country: "DK",
      city: "Storvorde",
      dateRange: ["2025-05-25", "2025-06-01"],
    },
    {
      country: "DK",
      city: "Bindslev",
      dateRange: ["2025-06-01", "2025-06-03"],
    },
    {
      country: "NO",
      city: "Egersund",
      dateRange: ["2025-06-03", "2025-06-07"],
    },
    {
      country: "NO",
      city: "Lampeland",
      dateRange: ["2025-06-07", "2025-06-12"],
    },
    {
      country: "SE",
      city: "By",
      // Sweden has many hamlets called By, several in Värmland alone. This is
      // the public OSM settlement node for By in Hagfors kommun, not an address.
      coordinates: [13.5945301, 59.923603],
      publishPrecision: "exact",
      dateRange: ["2025-06-12", "2025-06-18"],
    },
    {
      country: "SE",
      city: "Ödsmål",
      dateRange: ["2025-06-18", "2025-06-24"],
    },
    {
      country: "SE",
      city: "Höör",
      dateRange: ["2025-06-24", "2025-07-01"],
    },
    {
      country: "DE",
      city: "Fincken",
      dateRange: ["2025-07-01", "2025-07-03"],
    },
    {
      country: "IT",
      city: "Reggio Calabria",
      dateRange: ["2026-02-04", "2026-02-11"],
    },
    {
      country: "FR",
      city: "Paris",
      dateRange: ["2026-05-14", "2026-05-18"],
    },
    {
      country: "DE",
      city: "Lübbenau",
      dateRange: ["2026-05-23", "2026-05-27"],
    },
    {
      country: "NL",
      city: "Amsterdam",
      dateRange: ["2026-07-05", "2026-07-10"],
    },
    {
      country: "DE",
      city: "Seebad Ahlbeck",
      dateRange: ["2026-08-07", "2026-08-13"],
    },
    {
      country: "PL",
      city: "Swinemünde",
      date: "2026-08-12",
    },
  ],
};
export default config;
