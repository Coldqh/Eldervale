import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { inspectWorldIntegrity } from '../src/sim/integrity';
import { advanceOneMonth, createSimulationEngine, resetSimulationProfiler, simulationPhaseProfile } from '../src/sim/simulation';

const config = {
  ...defaultConfig,
  seed: 'eldervale-performance-suite',
  width: 30,
  height: 20,
  historyYears: 90,
  kingdomCount: 5,
  settlementCount: 14,
  populationScale: .22,
  monsterDensity: .45,
  artifactDensity: .4,
  ecologyDensity: .45,
};

const world = generateHistoricalWorld(config);
const exact = createSimulationEngine(structuredClone(world));
const fast = createSimulationEngine(structuredClone(world));

resetSimulationProfiler(exact);
let startedAt = performance.now();
for (let month = 0; month < 12; month += 1) advanceOneMonth(exact, undefined, { fastForward: false });
const exactMs = performance.now() - startedAt;

resetSimulationProfiler(fast);
startedAt = performance.now();
for (let month = 0; month < 120; month += 1) advanceOneMonth(fast, undefined, { fastForward: true });
const fastMs = performance.now() - startedAt;
const profile = simulationPhaseProfile(fast);

assert.equal(exact.exactMonths, 12, 'профилировщик должен считать точные месяцы');
assert.equal(fast.coarseMonths, 120, 'профилировщик должен считать ускоренные месяцы');
assert.ok(profile.length >= 8, 'профилировщик должен показывать фазы симуляции');
assert.ok(profile.every(entry => entry.calls > 0 && entry.totalMs >= 0 && entry.maxMs >= 0), 'профиль фаз должен быть корректным');
assert.ok(fastMs / 120 < exactMs / 12, `ускоренный месяц должен быть дешевле точного: ${fastMs.toFixed(0)} мс / ${exactMs.toFixed(0)} мс`);
assert.ok(fastMs < 60_000, `десятилетний тест не должен занимать минуту: ${fastMs.toFixed(0)} мс`);
assert.deepEqual(inspectWorldIntegrity(fast.world).errors, [], 'ускоренный мир должен сохранять целостность');

console.log(`OK PERF: год точно ${exactMs.toFixed(0)} мс · 10 лет ускоренно ${fastMs.toFixed(0)} мс · ${world.characters.length} жителей · тяжёлая фаза: ${profile[0]?.phase ?? 'нет'} ${profile[0]?.totalMs.toFixed(0) ?? 0} мс.`);
