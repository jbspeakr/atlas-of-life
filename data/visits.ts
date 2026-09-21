import type { Config } from "../scripts/config.ts";

// Fictional travel dates; coordinates in the warm cache describe public places only.
// The address fixture is a landmark, never a home, and publishes at city precision.
const config: Config = {
  publishPrecision: "city",
  visits: [
    {
      id: "berlin-2024",
      label: "Berlin",
      country: "DE",
      city: "Berlin",
      date: "2024-04-25",
    },
    {
      id: "wendisch-rietz-2025",
      label: "Wendisch Rietz",
      country: "DE",
      city: "Wendisch Rietz",
      dateRange: ["2025-04-04", "2025-04-06"],
    },
    {
      id: "kalamos-2025",
      label: "Kalamos",
      country: "GR",
      city: "Kalamos",
      dateRange: ["2025-04-27", "2025-05-02"],
    },
    {
      id: "jena-2025",
      label: "Jena",
      country: "DE",
      city: "Jena",
      dateRange: ["2025-05-17", "2025-05-18"],
    },
    {
      id: "hollenbeck-2025",
      label: "Hollenbeck",
      country: "DE",
      city: "Hollenbeck",
      dateRange: ["2025-05-24", "2025-05-25"],
    },
    {
      id: "storvorde-2025",
      label: "Storvorde",
      country: "DK",
      city: "Storvorde",
      dateRange: ["2025-05-25", "2025-06-01"],
    },
    {
      id: "bindslev-2025",
      label: "Bindslev",
      country: "DK",
      city: "Bindslev",
      dateRange: ["2025-06-01", "2025-06-03"],
    },
    {
      id: "egersund-2025",
      label: "Egersund",
      country: "NO",
      city: "Egersund",
      dateRange: ["2025-06-03", "2025-06-07"],
    },
    {
      id: "lampeland-2025",
      label: "Lampeland",
      country: "NO",
      city: "Lampeland",
      dateRange: ["2025-06-07", "2025-06-12"],
    },
    {
      id: "odsmal-2025",
      label: "Ödsmål",
      country: "SE",
      city: "Ödsmål",
      dateRange: ["2025-06-18", "2025-06-24"],
    },
    {
      id: "hoor-2025",
      label: "Höör",
      country: "SE",
      city: "Höör",
      dateRange: ["2025-06-24", "2025-07-01"],
    },
    {
      id: "fincken-2025",
      label: "Fincken",
      country: "DE",
      city: "Fincken",
      dateRange: ["2025-07-01", "2025-07-03"],
    },
    {
      id: "reggio-calabria-2026",
      label: "Reggio Calabria",
      country: "IT",
      city: "Reggio Calabria",
      dateRange: ["2026-02-04", "2026-02-11"],
    },
    {
      id: "paris-2026",
      label: "Paris",
      country: "FR",
      city: "Paris",
      dateRange: ["2026-05-14", "2026-05-18"],
    },
    {
      id: "lubbenau-2026",
      label: "Lübbenau",
      country: "DE",
      city: "Lübbenau",
      dateRange: ["2026-05-23", "2026-05-27"],
    },
    {
      id: "amsterdam-2026",
      label: "Amsterdam",
      country: "NL",
      city: "Amsterdam",
      dateRange: ["2026-07-05", "2026-07-10"],
    },
    {
      id: "ahlbeck-2026",
      label: "Ahlbeck",
      country: "DE",
      city: "Ahlbeck",
      dateRange: ["2026-08-07", "2026-08-13"],
    },
  ],
};
export default config;
