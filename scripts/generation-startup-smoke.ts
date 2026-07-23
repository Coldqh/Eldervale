import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { createWorldSystemEngine } from '../src/sim/simulation';

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'eldervale-generation-startup-suite',
  historyYears: 80,
});
assert.ok(world.buildings.length > 80, 'прожитая история должна создать физически насыщенный набор зданий');

const startedAt = performance.now();
createWorldSystemEngine(world, { primeDailyLife: true });
const initializationMs = performance.now() - startedAt;
const materialized = world.buildings.filter(building => Boolean(building.interior)).length;

assert.ok(initializationMs < 20_000, `инициализация мира заняла ${Math.round(initializationMs)} мс и может сработать по watchdog`);
assert.ok(materialized > 0, 'подробная повседневность должна материализовать используемые интерьеры');
assert.ok(materialized < world.buildings.length * .95, `на старте материализовано слишком много интерьеров: ${materialized}/${world.buildings.length}`);

console.log(`OK GENERATION STARTUP: ${world.buildings.length} зданий, ${materialized} интерьеров, инициализация ${Math.round(initializationMs)} мс.`);
