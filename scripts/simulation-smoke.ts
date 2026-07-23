import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { inspectWorldIntegrity } from '../src/sim/integrity';
import { migrateWorld } from '../src/sim/migrateWorld';
import { advanceWorld } from '../src/sim/simulation';
import { generateLocalMap, localCellSummary } from '../src/lib/localMap';
import { aggregateArchiveRows } from '../src/lib/archiveCatalog';

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

function assertUniqueLivingCells(map: ReturnType<typeof generateLocalMap>, label: string) {
  const occupied = new Set<string>();
  const living = map.markers.filter(marker => ['person', 'merchant', 'fauna', 'monster'].includes(marker.kind) || (marker.kind === 'army' && marker.visualRole === 'wagon'));
  for (const marker of living) {
    const width = marker.kind === 'monster' ? marker.footprintWidth ?? 1 : 1;
    const height = marker.kind === 'monster' ? marker.footprintHeight ?? 1 : 1;
    for (let y = marker.y; y < marker.y + height; y += 1) for (let x = marker.x; x < marker.x + width; x += 1) {
      const key = `${x}:${y}`;
      assert.ok(!occupied.has(key), `${label}: живые существа пересеклись в клетке ${key}`);
      occupied.add(key);
    }
  }
}

function localMarkerSignature(map: ReturnType<typeof generateLocalMap>) {
  return map.markers.map(marker => [marker.id, marker.x, marker.y, marker.kind, marker.visualRole]);
}

const first = generateHistoricalWorld(config);
const second = generateHistoricalWorld(config);
assert.deepEqual(signature(first), signature(second), 'один seed должен давать одинаковую прожитую историю');
assert.equal(first.version, 33);
assert.ok(first.cultures.length > 0, 'мир должен содержать культуры');
assert.ok(first.languages.length > 0, 'мир должен содержать языки');
assert.ok(first.religions.length > 0, 'мир должен содержать религии');
assert.equal(first.settlementCultures.length, first.settlements.length, 'каждое поселение должно иметь культурное состояние');
assert.ok(first.characters.every(character => character.cultureProfile), 'каждый житель должен иметь культуру, язык, веру и образование');
assert.ok(first.settlementCultures.every(state => Math.abs(state.cultureShares.reduce((sum, item) => sum + item.share, 0) - 100) <= .2), 'культурные доли должны давать 100%');
assert.ok(first.settlementCultures.every(state => Math.abs(state.religionShares.reduce((sum, item) => sum + item.share, 0) - 100) <= .2), 'религиозные доли должны давать 100%');
assert.ok(first.decisions.length > 0, 'история должна содержать решения');
assert.ok(first.stateDeltas.length > 0, 'история должна содержать изменения состояния');
assert.ok(first.characters.every(character => character.mind), 'каждый живой персонаж должен иметь психику');
assert.ok(first.relationships.every(relation => relation.trust !== undefined && relation.tension !== undefined), 'каждая связь должна иметь социальное состояние');
assert.ok(Array.isArray(first.socialObligations), 'мир должен хранить личные обязательства');
assert.ok(first.armies.every(army => !first.tiles[army.y * first.config.width + army.x]?.settlementId), 'армии не должны размещаться в поселениях');
assert.equal(first.armyLocalPositions.length, first.armies.reduce((sum, army) => sum + army.soldierIds.length, 0), 'каждый солдат должен иметь отдельную локальную позицию');
assert.ok(first.armyCamps.some(camp => camp.mode === 'camp' && camp.structureIds.length > 10), 'полевой лагерь должен состоять из реальных сооружений');
const animalArchive = aggregateArchiveRows(first, 'animalPopulation')!;
const resourceArchive = aggregateArchiveRows(first, 'ingredient')!;
const itemArchive = aggregateArchiveRows(first, 'item')!;
const fieldArchive = aggregateArchiveRows(first, 'field')!;
assert.equal(animalArchive.length, new Set(first.animalPopulations.map(item => item.species)).size, 'архив должен объединять животных по видам');
assert.equal(Math.round(animalArchive.reduce((sum, row) => sum + row.total, 0)), Math.round(first.animalPopulations.reduce((sum, item) => sum + item.count, 0)), 'агрегированный архив должен сохранять общую численность животных');
assert.equal(resourceArchive.length, new Set(first.ingredients.map(item => `${item.kind}:${item.name}`)).size, 'архив должен объединять одинаковые ресурсы');
assert.equal(itemArchive.length, new Set(first.items.filter(item => item.quantity > .0001 && item.condition > 0).map(item => item.templateId)).size, 'архив должен объединять предметы по типам');
assert.equal(fieldArchive.length, new Set(first.fields.map(item => item.crop)).size, 'архив должен объединять поля по культуре');
assert.ok([animalArchive, resourceArchive, itemArchive, fieldArchive].every(rows => rows.every(row => row.representativeId > 0 && row.entries > 0)), 'каждая агрегированная строка должна открывать реальный объект');
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
    assert.equal(map.markers.filter(marker => marker.kind === 'group').length, 0, `${settlement.name}: жители не должны схлопываться в групповой маркер`);
    assert.ok(map.cells.every(cell => cell.feature !== 'field'), `${settlement.name}: декоративные поля должны быть удалены`);
    assert.ok(map.cells.filter(cell => cell.fieldId).every(cell => first.fields.some(field => field.id === cell.fieldId && field.globalX === district.x && field.globalY === district.y)), `${settlement.name}: каждая клетка поля должна ссылаться на реальный FieldPlot`);
    const fieldCell = map.cells.find(cell => cell.fieldId);
    if (fieldCell) assert.ok(localCellSummary(map, fieldCell.x, fieldCell.y).markers.some(marker => marker.kind === 'field'), `${settlement.name}: поле должно открываться из любой своей клетки`);
    assertUniqueLivingCells(map, `${settlement.name}/${district.name}`);
  }
}

const animalTiles = [...new Set(first.animalPopulations.filter(population => population.count > 0).map(population => `${population.x}:${population.y}`))].slice(0, 8);
assert.ok(animalTiles.length > 0, 'в тестовом мире должны существовать популяции животных');
for (const tileKey of animalTiles) {
  const [x, y] = tileKey.split(':').map(Number);
  const map = generateLocalMap(first, x!, y!);
  const repeated = generateLocalMap(first, x!, y!);
  assert.deepEqual(localMarkerSignature(map), localMarkerSignature(repeated), `${tileKey}: локальное распределение должно быть детерминированным`);
  for (const population of first.animalPopulations.filter(item => item.x === x && item.y === y && item.count > 0)) {
    const animals = map.markers.filter(marker => marker.kind === 'fauna' && marker.refs.some(ref => ref.kind === 'animalPopulation' && ref.id === population.id));
    assert.equal(animals.length, Math.round(population.count), `${population.species}: глобальная численность должна совпадать с числом локальных особей`);
    assert.equal(new Set(animals.map(marker => `${marker.x}:${marker.y}`)).size, animals.length, `${population.species}: каждая особь должна занимать отдельную клетку`);
  }
  assertUniqueLivingCells(map, `дикая местность ${tileKey}`);
}

const abundantIngredient = [...first.ingredients].filter(item => item.kind !== 'животный компонент' && item.abundance >= 20).sort((a, b) => b.abundance - a.abundance)[0];
assert.ok(abundantIngredient, 'в тестовом мире должен существовать обильный природный ресурс');
if (abundantIngredient) {
  const map = generateLocalMap(first, abundantIngredient.x, abundantIngredient.y);
  const units = map.markers.filter(marker => marker.kind === 'resource' && marker.refs.some(ref => ref.kind === 'ingredient' && ref.id === abundantIngredient.id));
  assert.equal(units.length, Math.round(abundantIngredient.abundance), `${abundantIngredient.name}: все единицы ресурса должны присутствовать локально`);
  const spanX = Math.max(...units.map(marker => marker.x)) - Math.min(...units.map(marker => marker.x));
  const spanY = Math.max(...units.map(marker => marker.y)) - Math.min(...units.map(marker => marker.y));
  assert.ok(Math.max(spanX, spanY) >= map.width * .25, `${abundantIngredient.name}: ресурс не должен собираться в одном круге`);
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
legacy.version = 19;
delete legacy.armyCamps;
delete legacy.armyCampStructures;
delete legacy.armyLocalPositions;
legacy.simulation.physicalArmyVersion = undefined;
const migrated = migrateWorld(legacy);
assert.equal(migrated.version, 33);
assert.ok(Array.isArray(migrated.settlementExpeditions), 'миграция должна создать постоянный журнал экспедиций основателей');
assert.ok(migrated.settlements.every(settlement => settlement.politicalStatus), 'миграция должна назначить политический статус существующим поселениям');
assert.equal(migrated.simulation.settlementLifecycleVersion, 1, 'миграция должна включить жизненный цикл поселений');
assert.ok(migrated.urbanStates.every(state => state.version === 2 && Array.isArray(state.projectQueue) && state.projectQueue.every(request => Array.isArray(request.triggerProblemIds) && Array.isArray(request.expectedRelief))), 'миграция должна обновить постоянное городское состояние и заявки');
assert.ok(migrated.characters.every(character => character.mind), 'миграция должна восстановить психику');
assert.ok(Array.isArray(migrated.decisions) && Array.isArray(migrated.stateDeltas), 'миграция должна создать журналы причинности');
assert.ok(Array.isArray(migrated.socialObligations), 'миграция должна сохранить социальные обязательства');
assert.ok(migrated.armies.every(army => !migrated.tiles[army.y * migrated.config.width + army.x]?.settlementId), 'миграция должна вывести армии из городов');
assert.equal(migrated.armyLocalPositions.length, migrated.armies.reduce((sum, army) => sum + army.soldierIds.length, 0), 'миграция должна создать позиции всех солдат');
assert.deepEqual(inspectWorldIntegrity(migrated).errors, [], 'мигрированный мир должен проходить проверку целостности');

console.log(`OK: ${report.checks} проверок, ${focusedFuture.decisions.length} решений, ${focusedFuture.stateDeltas.length} изменений.`);
