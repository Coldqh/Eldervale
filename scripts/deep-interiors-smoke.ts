import assert from 'node:assert/strict';
import type { Building, Character, LocalMapData, LocalMarker, WorldState } from '../src/types';
import { applyDailyLifePhaseToMap, initializeDailyLife, routineForCharacter } from '../src/sim/dailyLife';
import {
  ensureInteriorCapacity, interiorIntegrityIssues, interiorPlanForBuilding, interiorPositionForCharacter,
  isSchoolAgeCharacter, operationalSchoolCapacity, operationalWorkerIds, schoolBuildingForCharacter,
} from '../src/sim/interiors';
import { generateLocalMap } from '../src/lib/localMap';

const SIZE = 64;

function building(id: number, type: Building['type'], name: string, x: number, y: number, width: number, height: number): Building {
  return {
    id, settlementId: 1, districtName: 'Центр', globalX: 0, globalY: 0,
    localX: x, localY: y, localWidth: width, localHeight: height,
    entranceX: x + Math.floor(width / 2), entranceY: y + height - 1,
    name, type, floors: type === 'castle' ? 2 : 1, capacity: 4, condition: 92, builtYear: 1,
    residentIds: [], workerIds: [], inventoryItemIds: [], rooms: [], hasWater: true, hasHearth: true, history: [],
  };
}

function person(id: number, name: string, age: number, profession: string, homeBuildingId: number, workplaceBuildingId?: number): Character {
  return {
    id, name, species: 'human', age, birthYear: 90 - age, alive: true, settlementId: 1, kingdomId: 1,
    profession, workplace: workplaceBuildingId ? 'назначенное рабочее здание' : 'дом семьи', homeDistrict: 'Центр',
    renown: 2, health: 90, wealth: 12, loyalty: 70, ambition: 'жить и работать', parentIds: [], childIds: [], relationshipIds: [],
    titles: [], artifactIds: [], bookIds: [], injuries: [], kills: 0, biography: [], householdId: homeBuildingId === 4 ? 2 : 1,
    homeBuildingId, workplaceBuildingId, inventoryItemIds: [], skills: { [profession]: 20 },
    needs: { hunger: 5, thirst: 5, rest: 5, warmth: 5, safety: 5, social: 5, lastUpdatedTick: 1080 },
    schedule: { wakeHour: 7, workStartHour: 8, workEndHour: 17, sleepHour: 22, restDay: 7, currentActivity: 'дома' },
    wallet: 5, equipment: { material: 'лён', color: 'серый', quality: 35, condition: 80, socialTier: 'обычный', equippedItemIds: {}, compact: true, lastMaintainedTick: 1080 },
    knowledge: { factIds: [], memoryIds: [], opinions: [], detailed: false, lastGossipTick: 1080 },
  } as Character;
}

const house = building(1, 'house', 'Дом семьи Ренн', 2, 2, 12, 11);
const school = building(2, 'school', 'Школа ремесла и письма', 17, 2, 14, 12);
const forge = building(3, 'blacksmith', 'Кузница у ворот', 34, 2, 11, 11);
const castle = building(4, 'castle', 'Замок Серой Короны', 2, 19, 25, 20);

school.establishmentId = 1;
forge.establishmentId = 2;

const parentA = person(1, 'Арен Ренн', 35, 'farmer', 1);
const parentB = person(2, 'Мира Ренн', 34, 'weaver', 1);
const studentA = person(3, 'Тэль Ренн', 8, 'child', 1);
const studentB = person(4, 'Эна Ренн', 11, 'child', 1);
const teacher = person(5, 'Севен Лор', 31, 'scribe', 1, 2);
const smith = person(6, 'Борн Кайл', 39, 'blacksmith', 1, 3);
const ruler = person(7, 'Король Эрдан', 46, 'ruler', 4);
ruler.titles = ['Правитель'];

const world = {
  version: 29, language: 'ru', appVersion: '5.0.0',
  config: { seed: 'deep-interiors-smoke', width: 1, height: 1, historyYears: 90, kingdomCount: 1, settlementCount: 1, populationScale: 1, magic: .5, warlike: .2, monsterDensity: .1, artifactDensity: .1, localMapSize: SIZE, ecologyDensity: .1, huntingPressure: 1 },
  name: 'Проверка интерьеров', year: 90, month: 6,
  tiles: [{ x: 0, y: 0, terrain: 'plains', elevation: .5, moisture: .5, kingdomId: 1, settlementId: 1, settlementDistrict: 'Центр' }],
  kingdoms: [{ id: 1, name: 'Серая Корона', color: '#555', species: 'human', rulerId: 7, capitalId: 1, treasury: 1000, armyStrength: 100, stability: 70, aggression: 20, culture: 'Речная Корона', religion: 'Семь Светильников', foundedYear: 1, enemies: [], claims: [], diplomacy: [], laws: [] }],
  settlements: [{ id: 1, name: 'Вальден', x: 0, y: 0, kingdomId: 1, population: 7, prosperity: 72, defense: 40, food: 80, foundedYear: 1, type: 'town', buildings: [], buildingCounts: {}, households: 2, residentialCapacity: 20, districts: [{ x: 0, y: 0, name: 'Центр', role: 'центр' }], notableCharacterIds: [7], damaged: 0, resource: 'зерно', stockpile: {}, livestock: {}, shortages: [], tradeRouteIds: [], unrest: 0, history: [], buildingIds: [1, 2, 3, 4], householdIds: [1, 2], establishmentIds: [1, 2], economy: { currency: 'крона', coinSupply: 100, priceIndex: 1, wageIndex: 1, rentIndex: 1, taxRate: .08, prices: {}, supply: {}, demand: {}, imports: {}, exports: {}, lastMonthlyTrade: 0, bankruptcies: 0 } }],
  characters: [parentA, parentB, studentA, studentB, teacher, smith, ruler],
  relationships: [], dynasties: [], armies: [], battleRecords: [], militaryUnits: [], supplyWagons: [], armyCamps: [], armyCampStructures: [], armyLocalPositions: [], monsters: [], cemeteries: [], burials: [], animalPopulations: [], ingredients: [], alchemyRecipes: [], artifacts: [], books: [], dungeons: [], wars: [], tradeRoutes: [],
  buildings: [house, school, forge, castle],
  households: [
    { id: 1, settlementId: 1, homeBuildingId: 1, headCharacterId: 1, memberIds: [1, 2, 3, 4, 5, 6], status: 'обычные', wealth: 50, debt: 0, monthlyIncome: 10, monthlyExpenses: 8, foodReserveDays: 20, fuelReserveDays: 20, inventoryItemIds: [], needs: parentA.needs, history: [] },
    { id: 2, settlementId: 1, homeBuildingId: 4, headCharacterId: 7, memberIds: [7], status: 'знатные', wealth: 500, debt: 0, monthlyIncome: 50, monthlyExpenses: 20, foodReserveDays: 60, fuelReserveDays: 60, inventoryItemIds: [], needs: ruler.needs, history: [] },
  ],
  establishments: [
    { id: 1, settlementId: 1, buildingId: 2, name: 'Школа', type: 'школа', ownerCharacterId: 5, workerIds: [5], supplierEstablishmentIds: [], customerHouseholdIds: [], inventoryItemIds: [], recipeIds: [], openHour: 8, closeHour: 16, reputation: 70, cash: 20, debt: 0, monthlyRevenue: 0, monthlyExpenses: 0, active: true, menu: {}, history: [] },
    { id: 2, settlementId: 1, buildingId: 3, name: 'Кузница', type: 'кузница', ownerCharacterId: 6, workerIds: [6], supplierEstablishmentIds: [], customerHouseholdIds: [], inventoryItemIds: [], recipeIds: [], openHour: 7, closeHour: 18, reputation: 60, cash: 20, debt: 0, monthlyRevenue: 0, monthlyExpenses: 0, active: true, menu: {}, history: [] },
  ],
  fields: [], constructionProjects: [], items: [], productionRecipes: [],
  employments: [
    { id: 1, characterId: 5, establishmentId: 1, role: 'teacher', wage: 1, hoursPerWeek: 36, sinceYear: 80, active: true },
    { id: 2, characterId: 6, establishmentId: 2, role: 'blacksmith', wage: 1, hoursPerWeek: 44, sinceYear: 74, active: true },
  ],
  shipments: [], travelingMerchants: [], marketTransactions: [], knowledgeFacts: [], memories: [], rumors: [], messages: [], settlementKnowledge: [], cultures: [], languages: [], religions: [], settlementCultures: [],
  settlementGovernments: [{ id: 1, settlementId: 1, leaderCharacterId: 7, councilCharacterIds: [], treasury: 50, monthlyTaxIncome: 0, monthlyExpenses: 0, corruption: 0, guardIds: [], judgeIds: [], firefighterIds: [], teacherIds: [5], gravediggerIds: [], prisonerIds: [], laws: [], activeDecision: '', history: [] }],
  districtCivicStates: [], cityStates: [], civicPatrols: [], crimes: [], courtCases: [], fireIncidents: [], kingdomGovernments: [], nobleTitles: [], vassalContracts: [], courtOffices: [], courtFactions: [], royalOrders: [], stateCrises: [], diplomaticAgreements: [], socialObligations: [], healthConditions: [], pregnancies: [], epidemics: [], decisions: [], stateDeltas: [], territoryHistory: [], events: [], localMapChanges: [],
  simulation: { schedulerVersion: 1, clockTick: 1085, activeRegionKeys: ['0:0'], sleepingRegionCount: 0, queuedActions: [] },
  history: { engineVersion: 2, generatedYears: 90, eras: [], landmarkEventIds: [], fallenRealms: [], compressedEventCount: 0, logicWarnings: [] },
  nextIds: { relationship: 1, personalLifeEvent: 1 },
} as unknown as WorldState;

// Регрессия: активные договоры не должны теряться из workerIds.
school.workerIds = [];
forge.workerIds = [];
world.establishments[0]!.workerIds = [];
world.establishments[1]!.workerIds = [];
teacher.employmentContractId = 1;
smith.employmentContractId = 2;

initializeDailyLife(world);

assert.ok(world.establishments[0]!.workerIds.includes(teacher.id), 'активный договор учителя должен восстановить workerIds школы');
assert.ok(world.establishments[1]!.workerIds.includes(smith.id), 'активный договор кузнеца должен восстановить workerIds кузницы');
assert.ok(school.workerIds.includes(teacher.id), 'учитель должен быть записан работником здания школы');
assert.ok(forge.workerIds.includes(smith.id), 'кузнец должен быть записан работником здания кузницы');
for (const contract of world.employments.filter(item => item.active)) {
  const establishment = world.establishments.find(item => item.id === contract.establishmentId);
  assert.ok(establishment?.workerIds.includes(contract.characterId), 'каждый активный договор должен быть отражён в workerIds заведения');
}

const housePlan = interiorPlanForBuilding(world, house);
assert.equal(housePlan.requiredBeds, 6, 'у каждого жителя дома должно быть своё спальное место');
assert.equal(housePlan.assignments.filter(item => item.kind === 'sleep').length, 6);
assert.equal(new Set(housePlan.assignments.filter(item => item.kind === 'sleep').map(item => item.fixtureId)).size, 6, 'кровати не должны делиться случайно');

assert.ok(isSchoolAgeCharacter(studentA) && isSchoolAgeCharacter(studentB));
assert.equal(schoolBuildingForCharacter(world, studentA)?.id, school.id);
const schoolPlan = interiorPlanForBuilding(world, school);
const desks = schoolPlan.assignments.filter(item => item.kind === 'school');
assert.equal(desks.length, 2, 'у каждого ученика должна быть назначена парта');
assert.equal(new Set(desks.map(item => item.fixtureId)).size, desks.length, 'у учеников должны быть разные парты');
assert.ok(desks.every(item => schoolPlan.rooms.find(room => room.id === item.roomId)?.kind === 'classroom'), 'парта должна стоять внутри класса');
assert.ok(schoolPlan.assignments.some(item => item.characterId === teacher.id && item.kind === 'work'), 'учителю нужен собственный стол');

const forgePlan = interiorPlanForBuilding(world, forge);
const smithStation = forgePlan.assignments.find(item => item.characterId === smith.id && item.kind === 'work');
assert.ok(smithStation, 'кузнецу нужно назначенное рабочее место');
assert.equal(forgePlan.fixtures.find(item => item.id === smithStation!.fixtureId)?.kind, 'anvil');

const castlePlan = interiorPlanForBuilding(world, castle);
for (const fixture of ['throne', 'carpet-runner', 'banner', 'tapestry', 'fireplace'] as const) {
  assert.ok(castlePlan.fixtures.some(item => item.kind === fixture), `замку не хватает узнаваемого объекта: ${fixture}`);
}
assert.match(castlePlan.materials.wall, /кам/i, 'замок должен иметь каменные материалы');
assert.ok(castlePlan.fixtures.every(item => item.floor >= 0 && item.floor < castle.floors), 'вся мебель замка должна находиться на существующих этажах');
assert.ok(castlePlan.rooms.every(item => item.floor >= 0 && item.floor < castle.floors), 'все комнаты замка должны находиться на существующих этажах');

assert.equal(castlePlan.floorCount, castle.floors, 'постоянный интерьер должен знать реальное число этажей');
assert.ok(castlePlan.stairs.some(item => item.floor === 0 && item.direction === 'up'), 'с первого этажа замка должна вести лестница наверх');
assert.ok(castlePlan.stairs.some(item => item.floor === 1 && item.direction === 'down'), 'со второго этажа замка должна вести лестница вниз');
const upperMap = applyDailyLifePhaseToMap(world, generateLocalMap(world, 0, 0, 1), 'day');
assert.equal(upperMap.level, 1, 'локальная карта должна открывать второй этаж');
assert.ok(upperMap.availableLevels.includes(1), 'второй этаж должен быть доступен в переключателе уровней');
assert.ok(upperMap.cells.some(cell => cell.buildingId === castle.id && !cell.blocked), 'второй этаж замка должен иметь проходимые клетки');
assert.ok(upperMap.cells.some(cell => cell.buildingId === castle.id && cell.feature === 'stairs-down'), 'на втором этаже должна отображаться лестница вниз');

assert.ok(operationalWorkerIds(world, forge.id).has(smith.id), 'исправная наковальня должна допускать кузнеца к производству');
const smithFixture = forgePlan.fixtures.find(item => item.id === smithStation!.fixtureId)!;
smithFixture.condition = 0;
smithFixture.functional = false;
assert.ok(!operationalWorkerIds(world, forge.id).has(smith.id), 'сломанное рабочее место должно останавливать работу кузнеца');
smithFixture.condition = 92;
smithFixture.functional = true;

assert.equal(operationalSchoolCapacity(world, school), 2, 'работающий класс с учителем должен обучать двух учеников');
const teacherAssignment = schoolPlan.assignments.find(item => item.characterId === teacher.id && item.kind === 'work')!;
const teacherDesk = schoolPlan.fixtures.find(item => item.id === teacherAssignment.fixtureId)!;
teacherDesk.condition = 0;
teacherDesk.functional = false;
assert.equal(operationalSchoolCapacity(world, school), 0, 'без исправного учительского места класс не должен работать');
teacherDesk.condition = 92;
teacherDesk.functional = true;

const floorsBeforeCrowding = house.floors;
for (let index = 0; index < 28; index += 1) {
  const resident = person(100 + index, `Житель ${index + 1}`, 20 + index % 20, 'farmer', house.id);
  resident.householdId = 1;
  world.characters.push(resident);
  world.households[0]!.memberIds.push(resident.id);
}
ensureInteriorCapacity(world);
const crowdedPlan = interiorPlanForBuilding(world, house);
assert.equal(house.floors, floorsBeforeCrowding, 'перенаселение не должно создавать этаж из воздуха');
assert.ok(crowdedPlan.unassignedSleeperIds.length > 0 || crowdedPlan.fixtures.some(item => item.kind === 'floor-pallet'), 'при тесноте должны появляться временные постели или реальная нехватка мест');


const studentDesk = interiorPositionForCharacter(world, studentA, school, 'school')!;
const studentRoutine = routineForCharacter(world, studentA);
const schoolStop = studentRoutine.stops.find(stop => stop.phase === 'day')!;
assert.equal(schoolStop.buildingId, school.id);
assert.equal(schoolStop.localX, studentDesk.x);
assert.equal(schoolStop.localY, studentDesk.y);
assert.match(schoolStop.placeLabel, /Парта/);

const bed = interiorPositionForCharacter(world, parentA, house, 'sleep')!;
const nightStop = routineForCharacter(world, parentA).stops.find(stop => stop.phase === 'night')!;
assert.equal(nightStop.localX, bed.x);
assert.equal(nightStop.localY, bed.y);
assert.match(nightStop.placeLabel, /Кровать|койка/i);

const map = localMap(world.buildings);
const schoolDay = applyDailyLifePhaseToMap(world, map, 'day');
const studentMarker = schoolDay.markers.find(marker => marker.refs.some(ref => ref.kind === 'character' && ref.id === studentA.id) && marker.kind === 'person');
assert.ok(studentMarker, 'ученик должен отображаться внутри школы');
assert.equal(studentMarker!.x, studentDesk.x);
assert.equal(studentMarker!.y, studentDesk.y);
assert.ok(schoolDay.markers.some(marker => marker.id === studentDesk.fixtureId), 'парта должна отображаться на локальной карте');

const nightMap = applyDailyLifePhaseToMap(world, map, 'night');
const sleepingMarker = nightMap.markers.find(marker => marker.refs.some(ref => ref.kind === 'character' && ref.id === parentA.id) && marker.kind === 'person');
assert.ok(sleepingMarker, 'ночью житель должен отображаться у своей кровати');
assert.equal(sleepingMarker!.x, bed.x);
assert.equal(sleepingMarker!.y, bed.y);

assert.deepEqual(interiorIntegrityIssues(world), [], 'в глубоком интерьере не должно быть нехватки кроватей, парт и рабочих мест');
console.log(`OK DEEP INTERIORS: ${housePlan.availableBeds} кроватей, ${schoolPlan.availableDesks} парт, ${forgePlan.availableWorkstations} рабочих мест; замок узнаваем.`);

function localMap(buildings: Building[]): LocalMapData {
  const cells: LocalMapData['cells'] = Array.from({ length: SIZE * SIZE }, (_, index) => ({
    x: index % SIZE, y: Math.floor(index / SIZE), ground: 'grass' as const, blocked: false,
  }));
  const markers: LocalMarker[] = [];
  for (const item of buildings) {
    for (let y = item.localY; y < item.localY + item.localHeight; y += 1) for (let x = item.localX; x < item.localX + item.localWidth; x += 1) {
      const edge = x === item.localX || y === item.localY || x === item.localX + item.localWidth - 1 || y === item.localY + item.localHeight - 1;
      const entrance = x === item.entranceX && y === item.entranceY;
      cells[y * SIZE + x] = { x, y, ground: 'floor', buildingId: item.id, building: item.name, feature: entrance ? 'door' : edge ? 'wall' : undefined, blocked: edge && !entrance } as LocalMapData['cells'][number];
    }
    markers.push({ id: `building-${item.id}`, x: item.localX, y: item.localY, kind: 'building', label: item.name, refs: [{ kind: 'building', id: item.id }], footprintWidth: item.localWidth, footprintHeight: item.localHeight });
  }
  return { key: '0:0:0', globalX: 0, globalY: 0, level: 0, width: SIZE, height: SIZE, title: 'Вальден', subtitle: 'Тестовая местность', terrain: 'plains', cells, markers, exits: [], availableLevels: [0] };
}
