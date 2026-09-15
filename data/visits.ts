import type { Config } from '../scripts/config.ts';

// Fictional travel dates; coordinates in the warm cache describe public places only.
// The address fixture is a landmark, never a home, and publishes at city precision.
const config: Config = {
  publishPrecision: 'city',
  visits: [
    { id: 'berlin-2019', label: 'Berlin', country: 'DE', region: 'DE-BE', city: 'Berlin', date: '2019-07-14', tags: ['architecture', 'summer'] },
    { id: 'munich-2020', label: 'Munich', country: 'DE', region: 'DE-BY', city: 'Munich', dateRange: ['2020-08-10', '2020-08-14'], tags: ['gardens'] },
    { id: 'paris-2021', label: 'Paris', country: 'FR', region: 'FR-IDF', city: 'Paris', dateRange: ['2021-09-03', '2021-09-08'], tags: ['art', 'walking'] },
    { id: 'lyon-2022', label: 'Lyon', country: 'FR', region: 'FR-ARA', city: 'Lyon', date: '2022-05-21', tags: ['food', 'rivers'] },
    { id: 'berlin-2023', label: 'Berlin', country: 'DE', region: 'DE-BE', city: 'Berlin', address: 'Brandenburg Gate, Pariser Platz', coordinates: [13.3777, 52.5163], date: '2023-06-01', tags: ['history', 'walking'] },
    { id: 'london-2024', label: 'London', country: 'GB', region: 'GB-ENG', city: 'London', dateRange: ['2024-04-12', '2024-04-16'], tags: ['museums'] },
    { id: 'edinburgh-2025', label: 'Edinburgh', country: 'GB', region: 'GB-SCT', city: 'Edinburgh', dateRange: ['2025-08-02', '2025-08-06'], tags: ['hills', 'summer'] },
  ],
};
export default config;
