import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { advanceCitySimulation, cityIntegrityIssues, projectSettlementCity } from '../src/sim/citySimulation';
import { interiorPlanForBuilding } from '../src/sim/interiors';
import { circulationCell } from '../src/sim/cityCapacity';
import { requestConstructionProject } from '../src/sim/agricultureConstruction';
import { assignConstructionFootprint } from '../src/sim/spatial';
import { RNG } from '../src/sim/rng';

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'eldervale-city-core-smoke',
  width: 16,
  height: 12,
  historyYears: 35,
  kingdomCount: 3,
  settlementCount: 6,
  populationScale: .1,
  monsterDensity: .1,
  artifactDensity: .1,
  ecologyDensity: .15,
});

assert.equal(world.version, 25);
assert.equal(world.cityStates.length, world.settlements.length, 'каждое поселение должно иметь городской аудит');
assert.ok(world.cityStates.every(state => state.land.freeBuildableCells >= 0), 'свободная земля не может быть отрицательной');
assert.ok(world.buildings.every(building => building.cityCapacity?.version === 2), 'каждое здание должно иметь профиль функциональной вместимости');

assert.equal(world.urbanStates.length, world.settlements.length, 'каждое поселение должно иметь постоянное городское состояние');
for (const settlement of world.settlements) {
  const urban = world.urbanStates.find(item => item.settlementId === settlement.id)!;
  const livingIds = world.characters.filter(item => item.alive && item.settlementId === settlement.id).map(item => item.id);
  const assignedIds = urban.housingAssignments.flatMap(item => item.characterIds);
  assert.equal(new Set(assignedIds).size, livingIds.length, 'городское состояние должно закрепить жилищный статус каждого жителя');
  assert.equal(assignedIds.length, livingIds.length, 'один житель не должен находиться в двух жилищных назначениях');
  assert.equal(urban.dirty, false, 'после городского хода состояние должно быть чистым');
}

const pureSettlement = world.settlements[0]!;
const pureBefore = JSON.stringify({
  population: pureSettlement.population,
  households: pureSettlement.households,
  residentialCapacity: pureSettlement.residentialCapacity,
  characters: world.characters.filter(item => item.settlementId === pureSettlement.id).map(item => [item.id, item.housingStatus, item.homeless, item.temporaryShelterBuildingId]),
  districts: world.districtCivicStates.filter(item => item.settlementId === pureSettlement.id).map(item => [item.id, item.homelessCount]),
  urban: world.urbanStates.find(item => item.settlementId === pureSettlement.id),
});
projectSettlementCity(world, pureSettlement);
const pureAfter = JSON.stringify({
  population: pureSettlement.population,
  households: pureSettlement.households,
  residentialCapacity: pureSettlement.residentialCapacity,
  characters: world.characters.filter(item => item.settlementId === pureSettlement.id).map(item => [item.id, item.housingStatus, item.homeless, item.temporaryShelterBuildingId]),
  districts: world.districtCivicStates.filter(item => item.settlementId === pureSettlement.id).map(item => [item.id, item.homelessCount]),
  urban: world.urbanStates.find(item => item.settlementId === pureSettlement.id),
});
assert.equal(pureAfter, pureBefore, 'чистый городской snapshot не должен изменять мир');
for (const state of world.cityStates) {
  const settlement = world.settlements.find(item => item.id === state.settlementId)!;
  assert.equal(settlement.residentialCapacity, state.housing.permanentBeds, 'жилищный агрегат должен исходить из физических мест');
  assert.ok(state.housing.occupiedBeds <= state.housing.permanentBeds, 'занятые постоянные места не могут превышать вместимость');
  assert.equal(state.housing.householdBeds + state.housing.institutionalBeds, state.housing.permanentBeds, 'типы постоянных мест должны складываться без скрытой вместимости');
  assert.ok(state.housing.peopleWithoutPermanentBed >= 0, 'дефицит постоянных мест не может быть отрицательным');
  assert.ok(state.land.districtTiles >= 1, 'город должен занимать хотя бы одну локальную территорию');
}

const house = world.buildings.find(building => ['house', 'tenement', 'manor', 'barracks', 'monastery', 'castle'].includes(building.type) && (building.cityCapacity?.permanentBeds ?? 0) >= 1);
assert.ok(house, 'для проверки нужно жилое здание');
const settlementHouseholds = world.households.filter(household => household.settlementId === house!.settlementId).slice(0, 5);
assert.ok(settlementHouseholds.length >= 2, 'для проверки перенаселения нужны несколько домохозяйств');
for (const household of settlementHouseholds) {
  household.homeBuildingId = house!.id;
  for (const characterId of household.memberIds) {
    const character = world.characters.find(item => item.id === characterId && item.alive);
    if (character) character.homeBuildingId = house!.id;
  }
}
advanceCitySimulation(world, new Set([house!.settlementId]));
const crowdedState = world.cityStates.find(state => state.settlementId === house!.settlementId)!;
assert.ok(crowdedState.problems.some(problem => problem.kind === 'overcrowding' || problem.kind === 'housing-shortage'), 'перенаселение должно стать городской проблемой');

const crowdedUrban = world.urbanStates.find(state => state.settlementId === house!.settlementId)!;
assert.ok(crowdedUrban.problemRecords.some(problem => problem.status === 'active' && (problem.kind === 'overcrowding' || problem.kind === 'housing-shortage')), 'городская проблема должна сохраняться в постоянной истории');

const projectSettlement = world.settlements.find(item => item.id !== house!.settlementId) ?? world.settlements[0]!;
const queueBefore = world.urbanStates.find(item => item.settlementId === projectSettlement.id)!.projectQueue.length;
requestConstructionProject(world, projectSettlement, 'watchtower', 'проверка единого городского API проектов', new RNG('city-project-api-smoke'));
const projectUrban = world.urbanStates.find(item => item.settlementId === projectSettlement.id)!;
assert.ok(projectUrban.projectQueue.length >= queueBefore + 1, 'строительный запрос должен пройти через постоянную городскую очередь');
const queued = projectUrban.projectQueue.find(item => item.requestedBuildingType === 'watchtower' && item.reason.includes('единого городского API'))!;
assert.ok(queued && ['blocked', 'started'].includes(queued.status), 'городской запрос должен либо получить участок, либо сохранить причину блокировки');
if (queued.status === 'started') assert.ok(queued.constructionProjectId && world.constructionProjects.some(item => item.id === queued.constructionProjectId), 'одобренный городской запрос должен быть связан со стройкой');
if (queued.status === 'blocked') assert.ok(queued.blockedReason, 'заблокированный проект должен хранить причину');
advanceCitySimulation(world, new Set([projectSettlement.id]));

const localSize = 96;
const blocker = {
  id: 1, settlementId: 1, globalX: 0, globalY: 0, localX: 3, localY: 3, localWidth: localSize - 6, localHeight: localSize - 6,
  entranceX: 3, entranceY: 3, type: 'castle', floors: 1,
} as any;
const blockedProject = {
  id: 2, settlementId: 1, buildingType: 'house', globalX: 0, globalY: 0, localX: 4, localY: 4,
  localWidth: 6, localHeight: 5, entranceX: 0, entranceY: 0, stage: 'планирование',
} as any;
assert.equal(assignConstructionFootprint({ config: { localMapSize: localSize }, buildings: [blocker], constructionProjects: [], fields: [] } as any, blockedProject), false, 'стройка не должна размещаться поверх занятой земли');

house!.interior = undefined;
const plan = interiorPlanForBuilding(world, house!);
assert.ok(!plan.fixtures.some(fixture => fixture.kind === 'floor-pallet'), 'обычный дом не должен создавать спальные места на полу');
const sleepAssignments = plan.assignments.filter(assignment => assignment.kind === 'sleep').length;
const sleeperDemand = world.characters.filter(character => character.alive && character.homeBuildingId === house!.id).length;
assert.ok(sleepAssignments <= (house!.cityCapacity?.permanentBeds ?? 0), 'назначений сна не может быть больше физических кроватей');
assert.equal(sleepAssignments, Math.min(sleeperDemand, house!.cityCapacity?.permanentBeds ?? 0), 'рассчитанная вместимость дома должна физически размещаться в его интерьере');
assert.ok(plan.unassignedSleeperIds.length > 0, 'лишние жители должны остаться видимым дефицитом, а не получить мебель из воздуха');


const warehouse = world.buildings.find(building => building.type === 'warehouse');
if (warehouse) {
  warehouse.interior = undefined;
  const warehousePlan = interiorPlanForBuilding(world, warehouse);
  const footprint = (kind: string) => kind === 'rug' || kind === 'forge' || kind === 'oven' ? { width: 2, height: 2 }
    : ['double-bed', 'table', 'bar-counter', 'kitchen-table', 'carpet-runner'].includes(kind) ? { width: 2, height: kind === 'double-bed' ? 2 : 1 }
      : ['bed', 'bunk-bed', 'prison-bed', 'treatment-bed'].includes(kind) ? { width: 1, height: 2 }
        : { width: 1, height: 1 };
  for (const fixture of warehousePlan.fixtures) {
    const size = footprint(fixture.kind);
    for (let dy = 0; dy < size.height; dy += 1) for (let dx = 0; dx < size.width; dx += 1) {
      assert.equal(circulationCell(warehouse, fixture.x + dx, fixture.y + dy, fixture.floor), false, `${fixture.label} не должна перекрывать проход склада`);
    }
  }
}

const issues = cityIntegrityIssues(world);
assert.deepEqual(issues, [], `ошибки городского ядра: ${issues.join(' | ')}`);
console.log(`OK CITY CORE: ${world.cityStates.length} поселений, ${crowdedState.problems.length} проблем, ${plan.unassignedSleeperIds.length} жителей без постоянной кровати.`);
