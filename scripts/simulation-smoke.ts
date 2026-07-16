import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { inspectWorldIntegrity } from '../src/sim/integrity';
import { migrateWorld } from '../src/sim/migrateWorld';
import { advanceWorld } from '../src/sim/simulation';

const config = {
  ...defaultConfig,
  seed: 'eldervale-invariant-suite',
  width: 22,
  height: 16,
  historyYears: 70,
  kingdomCount: 4,
  settlementCount: 9,
  populationScale: .14,
  monsterDensity: .35,
  artifactDensity: .3,
  ecologyDensity: .35,
};

function signature(world: ReturnType<typeof generateHistoricalWorld>) {
  return {
    year: world.year,
    month: world.month,
    kingdoms: world.kingdoms.map(item => [item.id, Math.round(item.treasury * 100) / 100, item.stability]),
    settlements: world.settlements.map(item => [item.id, item.population, item.food, item.prosperity, item.unrest]),
    characters: world.characters.length,
    events: world.events.map(item => [item.year, item.month, item.kind, item.title, item.decisionId]),
    decisions: world.decisions.map(item => [item.tick, item.actorRef.kind, item.actorRef.id, item.chosenOptionId]),
    deltas: world.stateDeltas.map(item => [item.tick, item.entityRef.kind, item.entityRef.id, item.field, item.before, item.after]),
  };
}

const first = generateHistoricalWorld(config);
const second = generateHistoricalWorld(config);
assert.deepEqual(signature(first), signature(second), 'один seed должен давать одинаковую прожитую историю');
assert.equal(first.version, 18);
assert.ok(first.decisions.length > 0, 'история должна содержать решения');
assert.ok(first.stateDeltas.length > 0, 'история должна содержать изменения состояния');
assert.ok(first.characters.every(character => character.mind), 'каждый живой персонаж должен иметь психику');
assert.ok(first.relationships.every(relation => relation.trust !== undefined && relation.tension !== undefined), 'каждая связь должна иметь социальное состояние');
assert.ok(Array.isArray(first.socialObligations), 'мир должен хранить личные обязательства');

const focused = structuredClone(first);
const unfocused = structuredClone(first);
const observed = focused.settlements[0]!;
focused.simulation.observerFocus = { x: observed.x, y: observed.y, level: 0, radius: 2 };
unfocused.simulation.observerFocus = undefined;
const focusedFuture = advanceWorld(focused, 24);
const unfocusedFuture = advanceWorld(unfocused, 24);
assert.deepEqual(signature(focusedFuture), signature(unfocusedFuture), 'камера наблюдателя не должна менять ход мира');

const report = inspectWorldIntegrity(focusedFuture);
assert.deepEqual(report.errors, [], `ошибки целостности: ${report.errors.join(' | ')}`);

const legacy = structuredClone(first) as any;
legacy.version = 17;
delete legacy.socialObligations;
legacy.simulation.socialSystemVersion = undefined;
legacy.simulation.lastSocialBurialId = undefined;
const migrated = migrateWorld(legacy);
assert.equal(migrated.version, 18);
assert.ok(migrated.characters.every(character => character.mind), 'миграция должна восстановить психику');
assert.ok(Array.isArray(migrated.decisions) && Array.isArray(migrated.stateDeltas), 'миграция должна создать журналы причинности');
assert.ok(Array.isArray(migrated.socialObligations), 'миграция должна создать социальные обязательства');
assert.deepEqual(inspectWorldIntegrity(migrated).errors, [], 'мигрированный мир должен проходить проверку целостности');

console.log(`OK: ${report.checks} проверок, ${focusedFuture.decisions.length} решений, ${focusedFuture.stateDeltas.length} изменений.`);
