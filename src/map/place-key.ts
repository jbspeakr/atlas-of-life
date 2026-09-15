/** A city is identified by country, resolved administrative region and normalized name. */
export function placeKey(place:{country:string;region?:string;city?:string;label:string}):string {
 return JSON.stringify([place.country,place.region??'',(place.city??place.label).normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase()]);
}
