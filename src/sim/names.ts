import type { Species } from '../types';
import { RNG } from './rng';

const starts: Record<Species, string[]> = {
  human: ['Ald', 'Ber', 'Ced', 'Dar', 'Ed', 'Fen', 'Garr', 'Had', 'Is', 'Jor', 'Kael', 'Lor', 'Mar', 'Nor', 'Os', 'Per', 'Quin', 'Roder', 'Ser', 'Tor', 'Val'],
  elf: ['Ael', 'Cael', 'Eli', 'Fael', 'Iri', 'Lae', 'Myr', 'Naev', 'Ori', 'Rae', 'Syl', 'Thael', 'Vael'],
  orc: ['Brak', 'Drog', 'Gar', 'Grim', 'Karg', 'Mog', 'Rag', 'Skor', 'Thrag', 'Urz', 'Vorg', 'Zag'],
  dwarf: ['Bal', 'Bor', 'Dain', 'Dor', 'Far', 'Gim', 'Har', 'Khor', 'Mor', 'Nor', 'Tor', 'Var'],
};
const ends: Record<Species, string[]> = {
  human: ['an', 'ard', 'en', 'eth', 'ian', 'ic', 'in', 'or', 'ric', 'us', 'wyn'],
  elf: ['ael', 'aris', 'eth', 'iel', 'ion', 'ira', 'ith', 'or', 'wen'],
  orc: ['ak', 'ash', 'gar', 'grom', 'nak', 'ruk', 'th', 'ug'],
  dwarf: ['ain', 'ar', 'ek', 'grim', 'in', 'or', 'rik', 'um'],
};
const placeStarts = ['Alder', 'Ash', 'Black', 'Bright', 'Cinder', 'Dawn', 'Deep', 'Dragon', 'Dun', 'Elder', 'Frost', 'Gold', 'Green', 'Grey', 'High', 'Iron', 'Moon', 'Oak', 'Raven', 'Red', 'River', 'Silver', 'Stone', 'Storm', 'Sun', 'Thorn', 'White', 'Wolf'];
const placeEnds = ['barrow', 'bridge', 'brook', 'burg', 'dale', 'fall', 'ford', 'gate', 'haven', 'heim', 'hold', 'keep', 'march', 'mere', 'moor', 'port', 'reach', 'rest', 'shire', 'stead', 'vale', 'watch', 'wick'];
const kingdomForms = ['Kingdom', 'Crown', 'Marches', 'Realm', 'Dominion', 'Highlands', 'Confederacy', 'Thrones'];

export function personName(rng: RNG, species: Species): string {
  return `${rng.pick(starts[species])}${rng.pick(ends[species])}`;
}
export function placeName(rng: RNG): string {
  return `${rng.pick(placeStarts)}${rng.pick(placeEnds)}`;
}
export function kingdomName(rng: RNG): string {
  return `${rng.pick(kingdomForms)} of ${placeName(rng)}`;
}
export function monsterName(rng: RNG, species: string): string {
  const titles = ['the Ashen', 'the Red', 'the Hollow', 'the Ancient', 'the Devourer', 'the Pale', 'the Unbound', 'the Mountain-Breaker', 'the Crown-Eater'];
  return `${personName(rng, rng.pick(['human', 'elf', 'orc', 'dwarf'] as Species[]))} ${rng.pick(titles)}, ${species}`;
}
