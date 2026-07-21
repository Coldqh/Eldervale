import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import {
  advanceClimateSystem, applyClimateStateToWorld, climateIntegrityIssues, initializeClimateSystem,
} from '../src/sim/climateSystem';
import { activeClimateCrises, climateSnapshot, settlementClimate } from '../src/lib/climate';
import { worldTick } from '../src/sim/scheduler';

const config = {
  ...defaultConfig,
  seed: 'eldervale-climate-crisis-suite',
  width: 18,
  height: 14,
  historyYears: 35,
  kingdomCount: 3,
  settlementCount: 8,
  populationScale: .12,
  monsterDensity: .15,
  artifactDensity: .15,
  ecologyDensity: .25,
};

const world = generateHistoricalWorld(config);
const state = initializeClimateSystem(world);
assert.equal(state.settlements.length, world.settlements.length, 'климат должен существовать для каждого поселения');
assert.equal(world.simulation.climateSystemVersion, 1);
assert.deepEqual(climateIntegrityIssues(world), [], 'начальное состояние климата должно быть целостным');
const initialSignature = state.settlements.map(item => [item.settlementId, item.weather, item.temperature, item.precipitation]);

const settlement = world.settlements.find(item => world.fields.some(field => field.settlementId === item.id)) ?? world.settlements[0];
assert.ok(settlement, 'в мире должно быть поселение');
const current = settlementClimate(world, settlement.id);
assert.ok(current, 'у выбранного поселения должен быть климат');
const field = world.fields.find(item => item.settlementId === settlement.id);
const household = world.households.find(item => item.settlementId === settlement.id);
const fieldYieldBefore = field?.expectedYield;
const reserveBefore = household?.foodReserveDays;
const priceBefore = settlement.economy.priceIndex;
const eventCountBefore = world.events.length;

applyClimateStateToWorld(world, {
  ...current,
  season: 'лето',
  weather: 'засуха',
  temperature: 41,
  precipitation: 2,
  moisture: 4,
  snowCover: 0,
  wind: 28,
  roadCondition: 82,
  harvestPressure: 93,
  waterStress: 96,
  diseasePressure: 38,
  migrationPressure: 84,
  anomaly: 12,
  lastTick: worldTick(world),
}, { recordEvents: true });

const crises = activeClimateCrises(world).filter(item => item.settlementIds.includes(settlement.id));
assert.ok(crises.some(item => item.kind === 'засуха'), 'засуха должна создать активный кризис');
assert.ok(crises.some(item => item.kind === 'неурожай'), 'тяжёлое давление на урожай должно создать неурожай');
assert.ok(world.events.length > eventCountBefore, 'природный кризис должен попасть в причинную хронику');
assert.ok(world.events.slice(eventCountBefore).some(item => item.kind === 'disaster' && item.entityRefs.some(ref => ref.kind === 'settlement' && ref.id === settlement.id)), 'событие должно ссылаться на пострадавшее поселение');
assert.ok(settlement.economy.priceIndex >= priceBefore, 'кризис не должен удешевлять рынок');
if (field && fieldYieldBefore !== undefined) assert.ok(field.expectedYield <= fieldYieldBefore, 'засуха должна снижать ожидаемый урожай');
if (household && reserveBefore !== undefined) assert.ok(household.foodReserveDays <= reserveBefore, 'семейные запасы должны расходоваться');
assert.ok(settlement.shortages.includes('вода'), 'при тяжёлой засухе должен появиться дефицит воды');
assert.deepEqual(climateIntegrityIssues(world), [], 'состояние после кризиса должно оставаться целостным');

world.month = world.month === 12 ? 1 : world.month + 1;
if (world.month === 1) world.year += 1;
advanceClimateSystem(world, { elapsedMonths: 1, recordEvents: false });
const snapshot = climateSnapshot(world);
assert.equal(snapshot.settlements.length, world.settlements.length);
assert.ok(Number.isFinite(snapshot.averageTemperature));
assert.ok(snapshot.season.length > 0);

const twin = generateHistoricalWorld(config);
const twinClimate = initializeClimateSystem(twin);
const twinSignature = twinClimate.settlements.map(item => [item.settlementId, item.weather, item.temperature, item.precipitation]);
assert.deepEqual(initialSignature, twinSignature, 'одинаковый seed должен давать одинаковый исходный климат');

console.log(`OK CLIMATE: ${settlement.name}, кризисов ${crises.length}, индекс цен ${priceBefore.toFixed(2)} → ${settlement.economy.priceIndex.toFixed(2)}.`);
