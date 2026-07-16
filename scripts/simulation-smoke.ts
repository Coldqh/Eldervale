import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { inspectWorldIntegrity } from '../src/sim/integrity';
import { migrateWorld } from '../src/sim/migrateWorld';
import { advanceWorld } from '../src/sim/simulation';
import { generateLocalMap } from '../src/lib/localMap';

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
    camps: world.armyCamps.map(item => [item.armyId, item.globalX, item.globalY, item.mode, item.structureIds.length]),
    armyPositions: world.armyLocalPositions.map(item => [item.armyId, item.characterId, item.globalX, item.globalY, item.localX, item.localY, item.activity]),
  };
}

const first = generateHistoricalWorld(config);
const second = generateHistoricalWorld(config);
assert.deepEqual(signature(first), signature(second), 'один seed должен давать одинаковую прожитую историю');
assert.equal(first.version, 19);
assert.ok(first.decisions.length > 0, 'история должна содержать решения');
assert.ok(first.stateDeltas.length > 0, 'история должна содержать изменения состояния');
assert.ok(first.characters.every(character => character.mind), 'каждый живой персонаж должен иметь психику');
assert.ok(first.relationships.every(relation => relation.trust !== undefined && relation.tension !== undefined), 'каждая связь должна иметь социальное состояние');
assert.ok(Array.isArray(first.socialObligations), 'мир должен хранить личные обязательства');
assert.ok(first.armies.every(army => !first.tiles[army.y * first.config.width + army.x]?.settlementId), 'армии не должны размещаться в поселениях');
assert.equal(first.armyLocalPositions.length, first.armies.reduce((sum, army) => sum + army.soldierIds.length, 0), 'каждый солдат должен иметь отдельную локальную позицию');
assert.ok(first.armyCamps.some(camp => camp.mode === 'camp' && camp.structureIds.length > 10), 'полевой лагерь должен состоять из реальных сооружений');
for (const army of first.armies) {
  const map = generateLocalMap(first, army.x, army.y);
  const soldiers = map.markers.filter(marker => marker.id.startsWith(`army-soldier-${army.id}-`));
  assert.equal(soldiers.length, army.soldierIds.length, `${army.name}: каждый солдат должен иметь отдельный маркер`);
  assert.equal(new Set(soldiers.map(marker => `${marker.x}:${marker.y}`)).size, soldiers.length, `${army.name}: солдаты не должны занимать одну клетку`);
  assert.ok(soldiers.every(marker => !map.cells[marker.y * map.width + marker.x]?.blocked), `${army.name}: солдаты не должны стоять внутри палаток`);
}
for (const settlement of first.settlements) {
  for (const district of settlement.districts) {
    const map = generateLocalMap(first, district.x, district.y);
    assert.equal(map.markers.filter(marker => marker.id.startsWith('army-soldier-')).length, 0, `${settlement.name}: армейские солдаты не должны дублироваться в городе`);
    assert.equal(map.markers.filter(marker => marker.kind === 'camp').length, 0, `${settlement.name}: полевой лагерь не должен появляться в городе`);
  }
}

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
legacy.version = 18;
delete legacy.armyCamps;
delete legacy.armyCampStructures;
delete legacy.armyLocalPositions;
legacy.simulation.physicalArmyVersion = undefined;
const migrated = migrateWorld(legacy);
assert.equal(migrated.version, 19);
assert.ok(migrated.characters.every(character => character.mind), 'миграция должна восстановить психику');
assert.ok(Array.isArray(migrated.decisions) && Array.isArray(migrated.stateDeltas), 'миграция должна создать журналы причинности');
assert.ok(Array.isArray(migrated.socialObligations), 'миграция должна сохранить социальные обязательства');
assert.ok(migrated.armies.every(army => !migrated.tiles[army.y * migrated.config.width + army.x]?.settlementId), 'миграция должна вывести армии из городов');
assert.equal(migrated.armyLocalPositions.length, migrated.armies.reduce((sum, army) => sum + army.soldierIds.length, 0), 'миграция должна создать позиции всех солдат');
assert.deepEqual(inspectWorldIntegrity(migrated).errors, [], 'мигрированный мир должен проходить проверку целостности');

console.log(`OK: ${report.checks} проверок, ${focusedFuture.decisions.length} решений, ${focusedFuture.stateDeltas.length} изменений.`);
