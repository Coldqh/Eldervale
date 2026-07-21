import type { Species } from '../types';
import { raceDefinition } from '../raceCatalog';
import { RNG } from './rng';

const placeStarts = ['Alder', 'Ash', 'Black', 'Bright', 'Cinder', 'Dawn', 'Deep', 'Dragon', 'Dun', 'Elder', 'Frost', 'Gold', 'Green', 'Grey', 'High', 'Iron', 'Moon', 'Oak', 'Raven', 'Red', 'River', 'Silver', 'Stone', 'Storm', 'Sun', 'Thorn', 'White', 'Wolf'];
const placeEnds = ['barrow', 'bridge', 'brook', 'burg', 'dale', 'fall', 'ford', 'gate', 'haven', 'heim', 'hold', 'keep', 'march', 'mere', 'moor', 'port', 'reach', 'rest', 'shire', 'stead', 'vale', 'watch', 'wick'];
const kingdomForms = ['Королевство', 'Корона', 'Марки', 'Держава', 'Владение', 'Нагорье', 'Союз', 'Престолы'];

export function personName(rng: RNG, species: Species): string {
  const race = raceDefinition(species);
  return `${rng.pick(race.nameStarts)}${rng.pick(race.nameEnds)}`;
}
export function placeName(rng: RNG): string {
  return `${rng.pick(placeStarts)}${rng.pick(placeEnds)}`;
}
export function kingdomName(rng: RNG): string {
  return `${rng.pick(kingdomForms)} ${placeName(rng)}`;
}
export function monsterName(rng: RNG, species: string): string {
  const titles = ['Пепельный', 'Красный', 'Пустой', 'Древний', 'Пожиратель', 'Бледный', 'Освобождённый', 'Ломатель Гор', 'Пожиратель Корон'];
  const race = rng.pick(['human', 'elf', 'orc', 'dwarf'] as Species[]);
  return `${personName(rng, race)} ${rng.pick(titles)}`;
}
