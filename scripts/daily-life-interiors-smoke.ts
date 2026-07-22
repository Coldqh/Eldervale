import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { applyDailyLifePhaseToMap, initializeDailyLife } from '../src/sim/dailyLife';
import { generateLocalMap } from '../src/lib/localMap';
import type { DailyRoutine, DailyRoutineStop } from '../src/dailyLifeTypes';

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'eldervale-indoor-placement-suite',
  width: 16,
  height: 12,
  historyYears: 35,
  kingdomCount: 3,
  settlementCount: 6,
  populationScale: .35,
  monsterDensity: .1,
  artifactDensity: .1,
  ecologyDensity: .15,
});
initializeDailyLife(world);

const candidateBuildings = world.buildings
  .filter(building => world.characters.filter(character => character.alive && character.settlementId === building.settlementId && !world.armies.some(army => army.soldierIds.includes(character.id))).length >= 18)
  .sort((a, b) => (a.localWidth - 2) * (a.localHeight - 2) - (b.localWidth - 2) * (b.localHeight - 2) || a.id - b.id);
const building = candidateBuildings[0];
assert.ok(building, 'для проверки нужно физическое здание в населённом поселении');

const baseMap = generateLocalMap(world, building!.globalX, building!.globalY);
const interiorCells = baseMap.cells.filter(cell => cell.buildingId === building!.id && !cell.blocked && cell.ground !== 'water');
assert.ok(interiorCells.length > 1, 'у здания должен быть проходимый интерьер');

const excluded = new Set([
  ...world.armies.flatMap(army => army.soldierIds ?? []),
  ...(world.travelingMerchants ?? []).map(merchant => merchant.characterId),
  ...(world.civicPatrols ?? []).flatMap(patrol => patrol.guardIds),
]);
const residents = world.characters
  .filter(character => character.alive && character.settlementId === building!.settlementId && !excluded.has(character.id))
  .slice(0, interiorCells.length + 14);
assert.ok(residents.length > interiorCells.length, 'для проверки перегруза жителей должно быть больше, чем клеток интерьера');

const stopFor = (characterId: number, phase: DailyRoutineStop['phase']): DailyRoutineStop => ({
  phase,
  activity: phase === 'day' ? 'находится внутри переполненного здания' : 'занят обычными делами',
  placeKind: building!.type === 'school' ? 'school' : building!.type === 'tavern' || building!.type === 'inn' ? 'tavern' : 'work',
  placeLabel: building!.name,
  settlementId: building!.settlementId,
  globalX: building!.globalX,
  globalY: building!.globalY,
  localX: building!.localX + 1 + characterId % Math.max(1, building!.localWidth - 2),
  localY: building!.localY + 1 + characterId % Math.max(1, building!.localHeight - 2),
  buildingId: building!.id,
  establishmentId: building!.establishmentId,
});
world.dailyRoutines = residents.map((character): DailyRoutine => ({
  characterId: character.id,
  tick: world.year * 12 + world.month - 1,
  year: world.year,
  month: world.month,
  stops: ['morning', 'day', 'evening', 'night'].map(phase => stopFor(character.id, phase as DailyRoutineStop['phase'])),
}));

const rendered = applyDailyLifePhaseToMap(world, baseMap, 'day');
const residentIds = new Set(residents.map(character => character.id));
const individualMarkers = rendered.markers.filter(marker => marker.kind === 'person' && marker.refs.some(ref => ref.kind === 'character' && residentIds.has(ref.id)));
const groupMarkers = rendered.markers.filter(marker => marker.kind === 'group' && marker.id.startsWith(`indoor-group-${building!.id}-day-`));
assert.ok(individualMarkers.length > 0, 'часть жителей должна отображаться отдельными фигурами');
assert.ok(groupMarkers.length > 0, 'лишние посетители должны оставаться небольшими группами внутри здания, а не высыпать на улицу');
assert.ok(groupMarkers.every(marker => (marker.count ?? 0) <= 8), 'одна группа не должна сворачивать десятки жителей в маркер 99+');
for (const marker of [...individualMarkers, ...groupMarkers]) {
  const cell = rendered.cells[marker.y * rendered.width + marker.x];
  assert.equal(cell?.buildingId, building!.id, `${marker.label}: маркер должен оставаться внутри выбранного здания`);
  assert.equal(cell?.blocked, false, `${marker.label}: житель не должен стоять в стене`);
}
assert.ok(individualMarkers.length < residents.length, 'переполненное здание не должно рисовать каждого посетителя отдельной фигурой');

console.log(`OK INTERIORS: ${residents.length} жителей, отдельно показано ${individualMarkers.length}, остальные разбиты на ${groupMarkers.length} небольших групп.`);
