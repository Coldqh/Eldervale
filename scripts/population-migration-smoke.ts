import assert from 'node:assert/strict';
import { ACTIVE_SPECIES, raceDefinition } from '../src/raceCatalog';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import {
  advanceRaceDemography, inheritedSpecies, initializeRaceDemography, kingdomPopulationBreakdown,
  migrationRecords, settlementPopulationBreakdown,
} from '../src/sim/raceDemography';

assert.equal(ACTIVE_SPECIES.length, 4, 'пока в мире должны быть активны четыре расы');
for (const species of ACTIVE_SPECIES) {
  const race = raceDefinition(species);
  assert.ok(race.maxAge > race.adultAge, `${species}: возраст смерти должен быть выше взросления`);
  assert.ok(race.nameStarts.length >= 8 && race.nameEnds.length >= 6, `${species}: нужен полноценный набор имён`);
  assert.ok(race.preferredTerrains.length > 0, `${species}: нужны подходящие биомы`);
}

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'eldervale-population-migration-suite',
  width: 20,
  height: 16,
  historyYears: 45,
  kingdomCount: 4,
  settlementCount: 12,
  populationScale: .2,
  monsterDensity: .1,
  artifactDensity: .1,
  ecologyDensity: .15,
});
initializeRaceDemography(world);

for (const settlement of world.settlements) {
  const shares = settlementPopulationBreakdown(world, settlement.id);
  assert.equal(shares.reduce((sum, item) => sum + item.count, 0), world.characters.filter(character => character.alive && character.settlementId === settlement.id).length);
  assert.ok(Math.abs(shares.reduce((sum, item) => sum + item.share, 0) - 1) < .0001, `${settlement.name}: доли должны давать 100%`);
}
for (const kingdom of world.kingdoms) {
  const shares = kingdomPopulationBreakdown(world, kingdom.id);
  assert.ok(shares.some(item => item.species === kingdom.species), `${kingdom.name}: основной народ должен присутствовать`);
}

const sameKingdomPair = world.settlements.flatMap(origin => world.settlements
  .filter(destination => destination.id !== origin.id && destination.kingdomId === origin.kingdomId)
  .map(destination => ({ origin, destination })))[0];
assert.ok(sameKingdomPair, 'для миграционного теста нужны два поселения одного государства');
const { origin, destination } = sameKingdomPair!;
if (!world.tradeRoutes.some(route => (route.fromSettlementId === origin.id && route.toSettlementId === destination.id) || (route.fromSettlementId === destination.id && route.toSettlementId === origin.id))) {
  const id = Math.max(0, ...world.tradeRoutes.map(route => route.id)) + 1;
  world.tradeRoutes.push({
    id, name: `${origin.name} — ${destination.name}`, fromSettlementId: origin.id, toSettlementId: destination.id,
    goods: ['зерно'], volume: 70, safety: 80, active: true, controlledByKingdomIds: [origin.kingdomId], history: ['Тестовый внутренний путь.'],
  });
  origin.tradeRouteIds.push(id); destination.tradeRouteIds.push(id);
}
origin.shortages = ['еда', 'вода']; origin.food = 0; origin.unrest = 100; origin.damaged = 90; origin.residentialCapacity = Math.max(1, Math.floor(origin.population * .5)); origin.prosperity = 10;
destination.shortages = []; destination.food = 120; destination.unrest = 0; destination.damaged = 0; destination.residentialCapacity = destination.population + 300; destination.prosperity = 100; destination.economy.wageIndex = 2;

for (let step = 0; step < 48 && migrationRecords(world).length === 0; step += 1) {
  world.month += 3;
  while (world.month > 12) { world.month -= 12; world.year += 1; }
  advanceRaceDemography(world, { elapsedMonths: 3 });
}
const records = migrationRecords(world);
assert.ok(records.length > 0, 'тяжёлый кризис должен породить реальный переезд');
const record = records[0]!;
assert.ok(record.characterIds.length > 0, 'переезд должен содержать конкретных жителей');
for (const id of record.characterIds) {
  const character = world.characters.find(item => item.id === id)!;
  assert.equal(character.settlementId, record.toSettlementId, `${character.name}: поселение должно реально измениться`);
  assert.equal(character.kingdomId, world.settlements.find(item => item.id === record.toSettlementId)!.kingdomId, `${character.name}: гражданская принадлежность должна обновиться`);
}

const parents = world.characters.filter(character => character.alive && character.age >= raceDefinition(character.species).adultAge)
  .flatMap(first => world.characters.filter(second => second.id > first.id && second.alive && second.species === first.species).slice(0, 1).map(second => [first, second] as const))[0];
assert.ok(parents, 'нужна пара одной расы');
assert.equal(inheritedSpecies(world, { id: 999999, parentIds: [parents![0].id, parents![1].id] }), parents![0].species, 'у родителей одной расы ребёнок наследует только их расу');

console.log(`OK POPULATION: ${ACTIVE_SPECIES.length} рас, ${world.settlements.length} поселений, миграций ${records.length}.`);
