import type { Settlement } from '../types';
import { RNG } from './rng';

const servicePools: Record<Settlement['type'], string[]> = {
  hamlet: ['колодец', 'зерновой сарай', 'общая печь', 'малое святилище'],
  village: ['кузница', 'мельница', 'трактир', 'часовня', 'амбар', 'рынок'],
  town: ['дом гильдии', 'казармы', 'храм', 'пивоварня', 'библиотека', 'рынок', 'склады'],
  city: ['цитадель', 'большой рынок', 'собор', 'арсенал', 'академия', 'казармы', 'склады', 'больница'],
  fortress: ['цитадель', 'оружейная', 'учебный двор', 'амбар', 'сторожевые башни', 'казармы'],
  port: ['доки', 'маяк', 'рыбный рынок', 'верфь', 'таможня', 'склады', 'трактиры'],
};

export interface HousingProfile {
  households: number;
  residentialCapacity: number;
  buildingCounts: Record<string, number>;
  buildings: string[];
}

export function createHousingProfile(population: number, type: Settlement['type'], rng: RNG): HousingProfile {
  const averageHousehold = type === 'city' || type === 'port' ? rng.int(4, 6) : rng.int(4, 5);
  const communalShare = type === 'fortress' ? .38 : type === 'city' ? .16 : type === 'port' ? .12 : .04;
  const communalPopulation = Math.round(population * communalShare);
  const familyPopulation = Math.max(0, population - communalPopulation);
  const households = Math.max(1, Math.ceil(familyPopulation / averageHousehold));
  const buildingCounts: Record<string, number> = {
    'жилой дом': households,
  };
  if (type === 'fortress') buildingCounts['казарма'] = Math.max(1, Math.ceil(communalPopulation / 80));
  else if (type === 'city' || type === 'port') buildingCounts['доходный дом'] = Math.max(0, Math.ceil(communalPopulation / 24));
  else if (communalPopulation >= 20) buildingCounts['общинный дом'] = Math.ceil(communalPopulation / 14);

  const serviceCount = type === 'hamlet' ? 2 : type === 'village' ? 4 : type === 'town' ? 6 : 8;
  for (const service of [...servicePools[type]].sort(() => rng.next() - .5).slice(0, serviceCount)) {
    buildingCounts[service] = (buildingCounts[service] ?? 0) + 1;
  }
  const barns = Math.max(1, Math.ceil(population / (type === 'city' ? 180 : 95)));
  buildingCounts['сарай или хозяйственная постройка'] = barns;

  const capacity = households * averageHousehold
    + (buildingCounts['казарма'] ?? 0) * 90
    + (buildingCounts['доходный дом'] ?? 0) * 28
    + (buildingCounts['общинный дом'] ?? 0) * 16;
  const buildings = Object.entries(buildingCounts).map(([name, count]) => `${count} × ${name}`);
  return { households, residentialCapacity: Math.max(population, capacity), buildingCounts, buildings };
}

export function expandHousing(settlement: Settlement, peopleNeeded: number, rng: RNG): { houses: number; capacityAdded: number } {
  const averageHousehold = settlement.type === 'city' || settlement.type === 'port' ? 5 : 4;
  const houses = Math.max(1, Math.ceil(peopleNeeded / averageHousehold));
  settlement.households += houses;
  settlement.buildingCounts['жилой дом'] = (settlement.buildingCounts['жилой дом'] ?? 0) + houses;
  const capacityAdded = houses * averageHousehold + rng.int(0, houses);
  settlement.residentialCapacity += capacityAdded;
  settlement.buildings = Object.entries(settlement.buildingCounts).map(([name, count]) => `${count} × ${name}`);
  return { houses, capacityAdded };
}

export function housingIntegrity(settlement: Settlement): string | undefined {
  if (settlement.residentialCapacity < settlement.population) {
    return `${settlement.name}: вместимость ${settlement.residentialCapacity}, население ${settlement.population}`;
  }
  const residences = (settlement.buildingCounts['жилой дом'] ?? 0)
    + (settlement.buildingCounts['доходный дом'] ?? 0)
    + (settlement.buildingCounts['общинный дом'] ?? 0)
    + (settlement.buildingCounts['казарма'] ?? 0);
  if (residences <= 0) return `${settlement.name}: нет жилых зданий`;
  return undefined;
}
