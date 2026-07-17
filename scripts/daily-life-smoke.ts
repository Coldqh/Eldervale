import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { buildWorldIndexes } from '../src/sim/indexes';
import { advanceDailyLife, applyDailyLifePhaseToMap, DAY_PHASES, initializeDailyLife } from '../src/sim/dailyLife';
import { RNG } from '../src/sim/rng';
import { generateLocalMap } from '../src/lib/localMap';

const config = {
  ...defaultConfig,
  seed: 'eldervale-daily-life-suite',
  width: 18,
  height: 14,
  historyYears: 45,
  kingdomCount: 3,
  settlementCount: 7,
  populationScale: .12,
  monsterDensity: .2,
  artifactDensity: .2,
  ecologyDensity: .25,
};

function simulateDays(world: ReturnType<typeof generateHistoricalWorld>) {
  initializeDailyLife(world);
  const indexes = buildWorldIndexes(world);
  for (let step = 0; step < 8; step += 1) {
    const absolute = world.year * 12 + world.month;
    world.year = Math.floor(absolute / 12);
    world.month = absolute % 12 + 1;
    advanceDailyLife(world, new RNG(`${world.config.seed}:повседневность:${world.year}:${world.month}`), indexes);
  }
  return world;
}

function signature(world: ReturnType<typeof generateHistoricalWorld>) {
  return {
    routines: (world.dailyRoutines ?? []).map(item => [item.characterId, item.tick, item.stops.map(stop => [stop.phase, stop.placeKind, stop.buildingId, stop.globalX, stop.globalY, stop.localX, stop.localY])]),
    events: (world.personalLifeEvents ?? []).map(item => [item.id, item.characterId, item.otherCharacterIds, item.tick, item.phase, item.kind, item.title]),
  };
}

const first = simulateDays(generateHistoricalWorld(config));
const second = simulateDays(generateHistoricalWorld(config));
assert.deepEqual(signature(first), signature(second), 'повседневность должна быть детерминированной');
assert.ok((first.dailyRoutines ?? []).length > 0, 'должны появиться распорядки жителей');
assert.ok((first.personalLifeEvents ?? []).length > 0, 'должны появиться личные бытовые события');
assert.ok((first.dailyRoutines ?? []).every(routine => DAY_PHASES.every(phase => routine.stops.some(stop => stop.phase === phase))), 'каждый распорядок обязан содержать четыре части суток');
assert.ok((first.personalLifeEvents ?? []).every(event => first.characters.some(character => character.id === event.characterId)), 'каждое личное событие должно ссылаться на реального жителя');

const settlement = first.settlements.find(item => item.population > 3 && item.districts.length) ?? first.settlements[0]!;
const district = settlement.districts[0] ?? { x: settlement.x, y: settlement.y };
const base = generateLocalMap(first, district.x, district.y);
const morning = applyDailyLifePhaseToMap(first, base, 'morning');
const day = applyDailyLifePhaseToMap(first, base, 'day');
const morningPeople = morning.markers.filter(marker => marker.kind === 'person' && marker.id.startsWith('person-'));
const dayPeople = day.markers.filter(marker => marker.kind === 'person' && marker.id.startsWith('person-'));
assert.ok(morningPeople.length > 0 || dayPeople.length > 0, 'на локальной карте должны отображаться жители по распорядку');
const morningById = new Map(morningPeople.map(marker => [marker.id, `${marker.x}:${marker.y}`]));
assert.ok(dayPeople.some(marker => morningById.has(marker.id) && morningById.get(marker.id) !== `${marker.x}:${marker.y}`), 'хотя бы часть жителей должна менять место между утром и днём');

console.log(`OK DAILY LIFE: ${(first.dailyRoutines ?? []).length} распорядков, ${(first.personalLifeEvents ?? []).length} личных событий.`);
