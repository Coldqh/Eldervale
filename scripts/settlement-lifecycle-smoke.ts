import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { buildWorldIndexes } from '../src/sim/indexes';
import { inspectWorldIntegrity } from '../src/sim/integrity';
import { routineStopForCharacter } from '../src/sim/dailyLife';
import {
  advanceSettlementLifecycle,
  chooseSettlementDestination,
  formSettlementExpedition,
  settlementLifecycleIntegrityIssues,
} from '../src/sim/settlementLifecycle';
import { RNG } from '../src/sim/rng';
import { advanceWorldSystems, createWorldSystemEngine } from '../src/sim/simulation';
import type { WorldState } from '../src/types';

const config = {
  ...defaultConfig,
  seed: 'settlement-lifecycle-smoke',
  width: 24,
  height: 18,
  historyYears: 48,
  kingdomCount: 3,
  settlementCount: 9,
  populationScale: .55,
  localMapSize: 96 as const,
  monsterDensity: .12,
  artifactDensity: .12,
  ecologyDensity: .22,
};

const world = generateHistoricalWorld(config);
assert.equal(world.version, 29, 'новый мир должен использовать схему 29');
assert.deepEqual(world.settlementExpeditions, [], 'сгенерированный мир не должен начинаться с выдуманных активных экспедиций');
const baselineIntegrityErrors = new Set(inspectWorldIntegrity(world).errors);
const returnWorld = structuredClone(world);
const automaticWorld = structuredClone(world);
const automaticOrigin = [...automaticWorld.settlements]
  .filter(settlement => settlement.population >= 55 && settlement.householdIds.length >= 4)
  .sort((a, b) => b.population - a.population || a.id - b.id)[0]!;
const automaticCity = automaticWorld.cityStates.find(item => item.settlementId === automaticOrigin.id)!;
for (const settlement of automaticWorld.settlements) if (settlement.id !== automaticOrigin.id) settlement.population = Math.min(settlement.population, 54);
automaticCity.housing.peopleWithoutPermanentBed = automaticCity.population;
automaticCity.housing.permanentBeds = 0;
automaticCity.housing.occupiedBeds = 0;
const automaticResult = advanceSettlementLifecycle(automaticWorld, new RNG('settlement-lifecycle-automatic'), buildWorldIndexes(automaticWorld), { allowFormation: true, elapsedMonths: 1 });
assert.ok(automaticResult.formed >= 1, 'критический городской дефицит должен автономно сформировать экспедицию без прямого вызова создания');
assert.ok(automaticWorld.settlementExpeditions.some(item => item.originSettlementId === automaticOrigin.id && item.status === 'traveling'), 'автономная экспедиция должна выйти из реального проблемного города');

const pipelineWorld = structuredClone(world);
const pipelineBaselineErrors = new Set(inspectWorldIntegrity(pipelineWorld).errors);
const pipelineOrigin = [...pipelineWorld.settlements]
  .filter(settlement => settlement.population >= 55 && settlement.householdIds.length >= 4)
  .sort((a, b) => b.population - a.population || a.id - b.id)[0]!;
const pipelineDestination = chooseSettlementDestination(pipelineWorld, pipelineOrigin, new RNG('settlement-pipeline-destination'))!;
const pipelineExpedition = formSettlementExpedition(pipelineWorld, pipelineOrigin, new RNG('settlement-pipeline-form'), { destination: pipelineDestination, force: true })!;
pipelineExpedition.supplies.foodPersonDays = 100_000;
pipelineExpedition.morale = 100;
const pipelineEngine = createWorldSystemEngine(pipelineWorld);
advanceWorldSystems(pipelineEngine);
advanceWorldSystems(pipelineEngine);
assert.ok(['traveling', 'camped', 'founded'].includes(pipelineExpedition.status), 'единый мировой ход должен безопасно проводить экспедицию через остальные системы');
const pipelineIntroducedErrors = inspectWorldIntegrity(pipelineWorld).errors.filter(error => !pipelineBaselineErrors.has(error));
assert.deepEqual(pipelineIntroducedErrors, [], `полный мировой pipeline не должен ломать экспедицию:\n${pipelineIntroducedErrors.join('\n')}`);

const origin = [...world.settlements]
  .filter(settlement => settlement.population >= 55 && settlement.householdIds.length >= 4)
  .sort((a, b) => b.population - a.population || a.id - b.id)[0];
assert.ok(origin, 'для проверки нужен достаточно крупный город с семьями');
const destination = chooseSettlementDestination(world, origin!, new RNG('settlement-lifecycle-destination'));
assert.ok(destination, 'экспедиция должна найти пригодную свободную землю');

const settlementCountBefore = world.settlements.length;
const originPopulationBefore = origin!.population;
const expedition = formSettlementExpedition(world, origin!, new RNG('settlement-lifecycle-form'), {
  destination: destination!,
  cause: 'land-shortage',
  force: true,
});
assert.ok(expedition, 'город должен сформировать физическую экспедицию основателей');
assert.ok(expedition!.memberIds.length >= 6, 'экспедиция должна состоять из нескольких реальных семей');
assert.ok(expedition!.householdIds.length >= 1, 'экспедиция должна содержать целые домохозяйства');
assert.ok(expedition!.route.length >= 2, 'экспедиция должна хранить реальный сухопутный маршрут');
assert.equal(origin!.population, originPopulationBefore - expedition!.memberIds.length, 'уехавшие жители должны исчезнуть из населения исходного города');

for (const householdId of expedition!.householdIds) {
  const household = world.households.find(item => item.id === householdId)!;
  const aliveMembers = household.memberIds.filter(id => world.characters.some(character => character.id === id && character.alive));
  assert.ok(aliveMembers.every(id => expedition!.memberIds.includes(id)), 'домохозяйство не должно быть разорвано при переселении');
  assert.equal(household.settlementId, 0, 'домохозяйство в пути не должно числиться в готовом поселении');
}
for (const characterId of expedition!.memberIds) {
  const character = world.characters.find(item => item.id === characterId)!;
  assert.equal(character.expeditionId, expedition!.id, 'каждый переселенец должен быть связан с экспедицией');
  assert.equal(character.settlementId, 0, 'переселенец в пути не должен числиться жителем города');
}

const leader = world.characters.find(item => item.id === expedition!.leaderCharacterId)!;
const routeStop = routineStopForCharacter(world, leader, 'day');
assert.equal(routeStop.globalX, expedition!.currentX, 'физический распорядок лидера должен находиться на клетке экспедиции');
assert.equal(routeStop.globalY, expedition!.currentY, 'физический распорядок лидера должен следовать за экспедицией');
assert.match(routeStop.placeLabel, /Экспедиция|Лагерь/, 'интерфейс карты должен показывать переселенцев как отдельную группу');

// Убираем случайный голод из проверки и даём достаточно материалов, чтобы тест
// проверял сам маршрут и основание, а не удачу конкретной экспедиции.
expedition!.supplies.foodPersonDays = 100_000;
expedition!.supplies.timber = 500;
expedition!.supplies.tools = 100;
expedition!.supplies.seedGrain = 100;
expedition!.morale = 100;
const indexes = buildWorldIndexes(world);
let safety = 0;
while (expedition!.status === 'traveling' && safety++ < 24) {
  advanceCalendar(world);
  advanceSettlementLifecycle(world, new RNG(`settlement-lifecycle-travel-${safety}`), indexes, { elapsedMonths: 1 });
}
assert.equal(expedition!.status, 'camped', 'после маршрута переселенцы должны разбить постоянный лагерь');
expedition!.campProgress = 100_000;
advanceCalendar(world);
const foundedResult = advanceSettlementLifecycle(world, new RNG('settlement-lifecycle-found'), indexes, { elapsedMonths: 1 });
assert.equal(expedition!.status, 'founded', 'подготовленный лагерь должен стать постоянным поселением');
assert.equal(foundedResult.founded, 1, 'месячный ход должен сообщить об основании поселения');
assert.equal(world.settlements.length, settlementCountBefore + 1, 'мировой список должен получить новое поселение');

const founded = world.settlements.find(item => item.id === expedition!.foundedSettlementId);
assert.ok(founded, 'экспедиция должна хранить ссылку на основанное поселение');
assert.equal(founded!.foundingExpeditionId, expedition!.id, 'поселение должно хранить экспедицию-основателя');
assert.equal(founded!.politicalStatus, 'frontier', 'новая община должна начинать как пограничное поселение');
assert.equal(world.tiles.find(tile => tile.x === founded!.x && tile.y === founded!.y)?.settlementId, founded!.id, 'новое поселение должно занять реальную клетку глобальной карты');
assert.ok(founded!.buildingIds.length >= expedition!.householdIds.length + 3, 'основатели должны построить дома, склад, ферму и общий двор');
assert.ok(world.fields.some(field => field.settlementId === founded!.id), 'новая община должна получить физические поля');
assert.ok(world.tradeRoutes.some(route => [route.fromSettlementId, route.toSettlementId].includes(origin!.id) && [route.fromSettlementId, route.toSettlementId].includes(founded!.id)), 'новое поселение должно сохранить дорогу к исходной общине');
assert.ok(world.settlementGovernments.some(item => item.settlementId === founded!.id), 'новое поселение должно войти в систему местной власти');
assert.ok(world.settlementCultures.some(item => item.settlementId === founded!.id), 'новое поселение должно получить реальный культурный состав');
assert.ok(world.cityStates.some(item => item.settlementId === founded!.id), 'новое поселение должно войти в городской аудит');
assert.ok(world.urbanStates.some(item => item.settlementId === founded!.id), 'новое поселение должно получить постоянное городское состояние');
for (const characterId of expedition!.memberIds) {
  const character = world.characters.find(item => item.id === characterId)!;
  if (!character.alive) continue;
  assert.equal(character.settlementId, founded!.id, 'основатель должен стать жителем нового поселения');
  assert.equal(character.expeditionId, undefined, 'после основания временная связь с экспедицией должна закрыться');
  assert.ok(character.homeBuildingId, 'основатель должен получить физический дом');
}
assert.deepEqual(settlementLifecycleIntegrityIssues(world), [], 'жизненный цикл поселения должен сохранить собственные инварианты');
const integrity = inspectWorldIntegrity(world);
const introducedIntegrityErrors = integrity.errors.filter(error => !baselineIntegrityErrors.has(error));
assert.deepEqual(introducedIntegrityErrors, [], `основание не должно создавать новые ошибки целостности:\n${introducedIntegrityErrors.join('\n')}`);

// Отдельно проверяем отказ: уцелевшие семьи возвращаются, а не остаются в
// техническом settlementId=0.
const returnOrigin = [...returnWorld.settlements]
  .filter(settlement => settlement.population >= 55 && settlement.householdIds.length >= 4)
  .sort((a, b) => b.population - a.population || a.id - b.id)[0]!;
const returnDestination = chooseSettlementDestination(returnWorld, returnOrigin, new RNG('settlement-return-destination'))!;
const returning = formSettlementExpedition(returnWorld, returnOrigin, new RNG('settlement-return-form'), { destination: returnDestination, force: true })!;
returning.morale = 0;
advanceSettlementLifecycle(returnWorld, new RNG('settlement-return-turn'), buildWorldIndexes(returnWorld), { elapsedMonths: 1 });
assert.equal(returning.status, 'returned', 'сломленная у исходного города экспедиция должна вернуться');
assert.ok(returning.memberIds.every(id => {
  const member = returnWorld.characters.find(item => item.id === id);
  return !member?.alive || (member.settlementId === returnOrigin.id && member.expeditionId === undefined);
}), 'выжившие после отказа должны снова числиться жителями реального поселения');
assert.deepEqual(settlementLifecycleIntegrityIssues(returnWorld), [], 'возвращение не должно оставлять висячие ссылки');

console.log(`OK SETTLEMENT LIFECYCLE: экспедиция №${expedition!.id} прошла ${expedition!.route.length - 1} клеток и основала ${founded!.name} с ${founded!.population} жителями и ${founded!.buildingIds.length} зданиями.`);

function advanceCalendar(target: WorldState): void {
  const absoluteMonth = target.year * 12 + target.month;
  target.year = Math.floor(absoluteMonth / 12);
  target.month = absoluteMonth % 12 + 1;
}
