import assert from 'node:assert/strict';
import type { Character } from '../src/types';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { prepareMonthSchedule } from '../src/sim/scheduler';
import {
  advanceRaceDemography, initializeRaceDemography, migrationRecords,
} from '../src/sim/raceDemography';
import {
  advanceWorldSystems, advanceWorldUnified, createWorldSystemEngine,
} from '../src/sim/worldSimulationPipeline';
import { populationIntegrityIssues } from '../src/sim/populationIntegrity';

const config = {
  ...defaultConfig,
  seed: 'eldervale-unified-pipeline-suite',
  width: 16,
  height: 12,
  historyYears: 35,
  kingdomCount: 3,
  settlementCount: 9,
  populationScale: .12,
  monsterDensity: .08,
  artifactDensity: .08,
  ecologyDensity: .12,
};

const generated = generateHistoricalWorld(config);
const direct = advanceWorldUnified(generated, 6);
const manual = structuredClone(generated);
const manualEngine = createWorldSystemEngine(manual);
for (let month = 0; month < 6; month += 1) advanceWorldSystems(manualEngine);
assert.deepEqual(manual, direct, 'прямой прогон и ручной вызов общего pipeline должны давать идентичный мир');
const initialCityRuns = new Map(generated.urbanStates.map(state => [state.settlementId, state.simulationCount]));
for (const state of direct.urbanStates) {
  assert.equal(state.simulationCount, (initialCityRuns.get(state.settlementId) ?? 0) + 6, 'единый pipeline должен выполнять ровно один городской ход за месяц');
  assert.equal(state.dirty, false, 'городской ход должен завершаться чистым состоянием');
}
const activeContracts = direct.employments.filter(contract => contract.active);
const establishmentById = new Map(direct.establishments.map(establishment => [establishment.id, establishment]));
assert.ok(activeContracts.every(contract => establishmentById.get(contract.establishmentId)?.workerIds.includes(contract.characterId)), 'каждый активный договор должен быть отражён в workerIds заведения');
const servingIds = new Set(direct.armies.flatMap(army => army.soldierIds));
assert.ok(activeContracts.every(contract => !servingIds.has(contract.characterId)), 'военнослужащий не должен одновременно иметь гражданский трудовой договор');

const august = structuredClone(generated);
august.month = 8;
const augustEngine = createWorldSystemEngine(august);
const schedule = prepareMonthSchedule(august, augustEngine.indexes);
assert.equal(schedule.runHousing, false, 'после PopulationSystem старая жилищная миграция должна быть отключена');

const migrationWorld = generateHistoricalWorld({ ...config, seed: 'eldervale-atomic-household-migration' });
initializeRaceDemography(migrationWorld);
const pair = migrationWorld.settlements.flatMap(origin => migrationWorld.settlements
  .filter(destination => destination.id !== origin.id && destination.kingdomId === origin.kingdomId)
  .map(destination => ({ origin, destination })))[0];
assert.ok(pair, 'нужны два поселения одного государства');
const { origin, destination } = pair!;

if (!migrationWorld.tradeRoutes.some(route => (route.fromSettlementId === origin.id && route.toSettlementId === destination.id)
  || (route.fromSettlementId === destination.id && route.toSettlementId === origin.id))) {
  const id = Math.max(0, ...migrationWorld.tradeRoutes.map(route => route.id)) + 1;
  migrationWorld.tradeRoutes.push({
    id,
    name: `${origin.name} — ${destination.name}`,
    fromSettlementId: origin.id,
    toSettlementId: destination.id,
    goods: ['зерно'],
    volume: 80,
    safety: 90,
    active: true,
    controlledByKingdomIds: [origin.kingdomId],
    history: ['Тестовый внутренний путь.'],
  });
  origin.tradeRouteIds.push(id);
  destination.tradeRouteIds.push(id);
}

const rulerIds = new Set(migrationWorld.kingdoms.map(kingdom => kingdom.rulerId));
const household = migrationWorld.households
  .filter(item => item.settlementId === origin.id)
  .map(item => ({
    household: item,
    members: item.memberIds.map(id => migrationWorld.characters.find(character => character.id === id))
      .filter((character): character is Character => Boolean(character?.alive && character.settlementId === origin.id)),
  }))
  .find(item => item.members.length >= 2 && item.members.every(character => !rulerIds.has(character.id)));
assert.ok(household, 'нужно обычное домохозяйство минимум из двух живых жителей');
const migratingIds = new Set(household!.members.map(character => character.id));

for (const character of migrationWorld.characters.filter(item => item.alive && item.settlementId === origin.id)) {
  character.titles = [];
  character.courtOfficeIds = [];
  character.nobleTitleIds = [];
  character.serviceStatus = undefined;
  character.prisonerOfBattleId = undefined;
  character.legalStatus = migratingIds.has(character.id) ? 'свободен' : 'под стражей';
}

const worker = household!.members[0]!;
const establishment = migrationWorld.establishments.find(item => item.settlementId === origin.id);
const workplaceBuilding = establishment ? migrationWorld.buildings.find(item => item.id === establishment.buildingId) : undefined;
if (establishment) {
  if (!establishment.workerIds.includes(worker.id)) establishment.workerIds.push(worker.id);
  if (workplaceBuilding && !workplaceBuilding.workerIds.includes(worker.id)) workplaceBuilding.workerIds.push(worker.id);
  const contractId = Math.max(0, ...migrationWorld.employments.map(item => item.id)) + 1;
  migrationWorld.employments.push({
    id: contractId,
    characterId: worker.id,
    establishmentId: establishment.id,
    role: worker.profession,
    wage: 1,
    hoursPerWeek: 40,
    sinceYear: migrationWorld.year,
    active: true,
  });
  worker.employmentContractId = contractId;
  worker.employerEstablishmentId = establishment.id;
  worker.workplaceBuildingId = workplaceBuilding?.id;
}

origin.shortages = ['пища', 'вода'];
origin.food = 0;
origin.unrest = 100;
origin.damaged = 95;
origin.residentialCapacity = Math.max(1, Math.floor(origin.population * .35));
origin.prosperity = 5;
destination.shortages = [];
destination.food = 120;
destination.unrest = 0;
destination.damaged = 0;
destination.residentialCapacity = destination.population + 500;
destination.prosperity = 100;
destination.economy.wageIndex = 2;

for (let step = 0; step < 120 && !migrationRecords(migrationWorld, 600).some(record => record.householdId === household!.household.id); step += 1) {
  migrationWorld.month += 3;
  while (migrationWorld.month > 12) { migrationWorld.month -= 12; migrationWorld.year += 1; }
  advanceRaceDemography(migrationWorld, { elapsedMonths: 3 });
}

const record = migrationRecords(migrationWorld, 600).find(item => item.householdId === household!.household.id);
assert.ok(record, 'кризис должен переселить выбранное домохозяйство целиком');
assert.deepEqual(new Set(record!.characterIds), migratingIds, 'запись миграции должна содержать всю живую семью');
assert.equal(household!.household.settlementId, record!.toSettlementId, 'домохозяйство должно переехать в поселение назначения');
for (const member of household!.members) {
  assert.equal(member.settlementId, record!.toSettlementId, `${member.name}: член семьи должен переехать вместе с домохозяйством`);
  assert.equal(member.homeBuildingId, household!.household.homeBuildingId, `${member.name}: дом жителя и дом семьи должны совпасть`);
}
if (establishment) assert.ok(!establishment.workerIds.includes(worker.id), 'старое заведение не должно удерживать переехавшего работника');
if (workplaceBuilding) assert.ok(!workplaceBuilding.workerIds.includes(worker.id), 'старое рабочее здание не должно удерживать переехавшего работника');
assert.ok(!migrationWorld.employments.some(item => item.characterId === worker.id && item.active), 'старый трудовой договор должен быть закрыт');

const relevantIntegrityIssues = populationIntegrityIssues(migrationWorld).filter(issue =>
  issue.includes(`Домохозяйство №${household!.household.id}`) || household!.members.some(member => issue.includes(member.name)));
assert.deepEqual(relevantIntegrityIssues, [], `после переезда не должно остаться нарушений семьи и работников: ${relevantIntegrityIssues.join('; ')}`);

console.log(`OK PIPELINE: единый ход совпал, старая миграция отключена, семья №${household!.household.id} переехала целиком.`);
