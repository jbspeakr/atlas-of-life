import type { Config } from "../scripts/config.ts";

const config: Config = {
  publishPrecision: "city",
  // Home is where journeys start and end. It counts as a place lived in, with
  // its region lit, under its own quiet ring; it never counts as a trip.
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
      country: "GR",
      city: "Athen",
      date: "2025-04-29",
      dayTrip: true
    },
    {
      country: "GR",
      city: "Néa Palátia",
      date: "2025-04-29",
      dayTrip: true
    },
    {
      country: "GR",
      city: "Athen",
      date: "2025-04-30",
      coordinates: [23.72456, 37.97478],
      publishPrecision: "exact",
      dayTrip: true
    },
    {
      country: "GR",
      city: "Néa Palátia",
      date: "2025-05-01",
      dayTrip: true
    },
    {
      country: "DE",
      city: "Jena",
      dateRange: ["2025-04-11", "2025-04-12"],
    },
    {
      country: "DE",
      city: "Jena",
      dateRange: ["2025-05-17", "2025-05-18"],
    },
    {
      country: "DE",
      city: "Rendswühren",
      coordinates: [10.13328, 54.08282],
      publishPrecision: "exact",
      dateRange: ["2025-05-24", "2025-05-25"],
    },
    {
      country: "DK",
      city: "Storvorde",
      coordinates: [10.273445855646422, 56.97925672981059],
      publishPrecision: "exact",
      dateRange: ["2025-05-25", "2025-06-01"],
    },
    {
      country: "DK",
      city: "Skørping",
      date: "2025-05-27",
    },
    {
      country: "DK",
      city: "Lille Vildmose",
      coordinates: [10.195336, 56.8813664],
      publishPrecision: "exact",
      date: "2025-05-28",
    },
    {
      country: "DK",
      city: "Aalborg",
      date: "2025-05-29",
    },
    {
      country: "DK",
      city: "Skørping",
      date: "2025-05-31",
    },
    {
      country: "DK",
      city: "Skagen",
      date: "2025-06-01",
      dayTrip: true
    },
    {
      country: "DK",
      city: "Bindslev",
      coordinates: [10.15046, 57.55413],
      publishPrecision: "exact",
      dateRange: ["2025-06-01", "2025-06-03"],
    },
    {
      country: "DK",
      city: "Hirtshals",
      date: "2025-06-02",
      dayTrip: true
    },
    {
      country: "NO",
      city: "Kristiansand",
      date: "2025-06-03",
      dayTrip: true
    },
    {
      country: "NO",
      city: "Søre Eigerøya",
      coordinates: [5.9256828, 58.4602712],
      publishPrecision: "exact",
      dateRange: ["2025-06-03", "2025-06-07"],
    },
    {
      country: "NO",
      city: "Egersund",
      date: "2025-06-04",
      dayTrip: true
    },
    {
      country: "NO",
      city: "Egersund",
      date: "2025-06-05",
      dayTrip: true
    },
    {
      country: "NO",
      city: "Valle",
      date: "2025-06-07",
      dayTrip: true
    },
    {
      country: "NO",
      city: "Lampeland",
      coordinates: [9.44849, 59.80486],
      publishPrecision: "exact",
      dateRange: ["2025-06-07", "2025-06-12"],
    },
    {
      country: "NO",
      city: "ørje",
      date: "2025-06-12",
      dayTrip: true
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
      city: "Munkfors",
      date: "2025-06-13",
      dayTrip: true
    },
    {
      country: "SE",
      city: "Karlstad",
      date: "2025-06-15",
      dayTrip: true
    },
    {
      country: "SE",
      city: "Hagfors",
      date: "2025-06-17",
      dayTrip: true
    },
    {
      country: "SE",
      city: "Uddeholm",
      date: "2025-06-17",
      dayTrip: true
    },
    {
      country: "SE",
      city: "åmål",
      date: "2025-06-18",
      dayTrip: true
    },
    {
      country: "SE",
      city: "Ödsmål",
      dateRange: ["2025-06-18", "2025-06-24"],
    },
    {
      country: "SE",
      city: "Kyrkesund",
      date: "2025-06-19",
      dayTrip: true
    },
    {
      country: "SE",
      city: "Härön",
      date: "2025-06-19",
      dayTrip: true
    },
    {
      country: "SE",
      city: "Svanesund",
      date: "2025-06-20",
      dayTrip: true
    },
    {
      country: "SE",
      city: "Stenungsund",
      date: "2025-06-20",
      dayTrip: true
    },
    {
      country: "SE",
      city: "Trollhättan",
      date: "2025-06-22",
      dayTrip: true
    },
    {
      country: "SE",
      city: "Rolsberga",
      coordinates: [13.49356, 55.80654],
      publishPrecision: "exact",
      dateRange: ["2025-06-24", "2025-07-01"],
    },
    {
      country: "SE",
      city: "Göteborg",
      date: "2025-06-24",
      dayTrip: true
    },
    {
      country: "SE",
      city: "Eslöv",
      date: "2025-06-26",
      dayTrip: true
    },
    {
      country: "SE",
      city: "Skrylle",
      date: "2025-06-27",
      coordinates: [13.35885, 55.69274],
      publishPrecision: "exact",
      dayTrip: true
    },
    {
      country: "SE",
      city: "Malmö",
      date: "2025-06-28",
      dayTrip: true
    },
    {
      country: "SE",
      city: "Trelleborg",
      date: "2025-07-01",
      dayTrip: true
    },
    {
      country: "DE",
      city: "Fincken",
      dateRange: ["2025-07-01", "2025-07-03"],
    },
    {
      country: "DE",
      city: "Jena",
      dateRange: ["2025-07-27", "2025-07-28"],
    },
    {
      country: "DE",
      city: "Bruchsal",
      dateRange: ["2025-09-17", "2025-09-20"],
    },
    {
      country: "IT",
      city: "Reggio Calabria",
      dateRange: ["2026-03-04", "2026-03-11"],
    },
    {
      country: "IT",
      city: "Reggio C. Catona",
      date: "2026-03-05",
      dayTrip: true
    },
    {
      country: "IT",
      city: "Reggio C. Archi",
      date: "2026-03-05",
      dayTrip: true
    },
    {
      country: "IT",
      city: "Gambarie",
      date: "2026-03-07",
      dayTrip: true
    },
    {
      country: "DE",
      city: "Märkisch Buchholz",
      date: "2026-04-19",
      dayTrip: true
    },
    {
      country: "DE",
      city: "Märkisch Buchholz",
      date: "2026-05-10",
      dayTrip: true
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
      country: "DE",
      city: "Märkisch Buchholz",
      date: "2026-05-30",
      dayTrip: true
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
    {
      country: "DE",
      city: "Märkisch Buchholz",
      date: "2026-08-23",
      dayTrip: true
    },
    {
      country: "DE",
      city: "Märkisch Buchholz",
      date: "2026-09-06",
      dayTrip: true
    },
    {
      country: "DE",
      city: "Märkisch Buchholz",
      date: "2026-09-27",
      dayTrip: true
    },
  ],
};
export default config;
