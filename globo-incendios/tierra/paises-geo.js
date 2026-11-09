import { geoContains } from './vendor/d3-geo.js';

export const normalizeName = value =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
export function coordinatesFromPoint({ x, y, z }) {
  const length = Math.hypot(x, y, z);
  return [(Math.atan2(-z, x) * 180) / Math.PI, (Math.asin(Math.max(-1, Math.min(1, y / length))) * 180) / Math.PI];
}
export function containsBounds([[west, south], [east, north]], [lon, lat]) {
  return lat >= south && lat <= north && (west <= east ? lon >= west && lon <= east : lon >= west || lon <= east);
}
export function countryAt(countries, coordinates, previous) {
  if (previous && containsBounds(previous.properties.bounds, coordinates) && geoContains(previous, coordinates))
    return previous;
  return countries.find(c => containsBounds(c.properties.bounds, coordinates) && geoContains(c, coordinates)) || null;
}
export function searchCountries(countries, query) {
  const needle = normalizeName(query);
  const ranked = countries
    .map(c => {
      const terms = [c.properties.name, c.properties.spanish, ...c.properties.aliases].map(normalizeName);
      const rank = !needle
        ? 3
        : terms.some(t => t === needle)
          ? 0
          : terms.some(t => t.startsWith(needle))
            ? 1
            : terms.some(t => t.includes(needle))
              ? 2
              : 9;
      return { c, rank };
    })
    .filter(x => x.rank < 9)
    .sort((a, b) => a.rank - b.rank || a.c.properties.name.localeCompare(b.c.properties.name));
  return ranked.slice(0, 12).map(x => x.c);
}
