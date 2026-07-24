import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { advanceEcology } from '../src/sim/ecology';
import { buildWorldIndexes } from '../src/sim/indexes';
import { advanceMaterialEconomy, materialEconomyIntegrityIssues, pruneEmptyMaterialItems } from '../src/sim/materialEconomy';
import { RNG } from '../src/sim/rng';
import { worldTick } from '../src/sim/scheduler';

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'physical-hunt-economy-smoke',
  width: 18,
  height: 12,
  historyYears: 6,
  kingdomCount: 2,
  settlementCount: 7,
  populationScale: .34,
  monsterDensity: .05,
  artifactDensity: .05,
  ecologyDensity: .3,
  localMapSize: 96,
});

const settlement = world.settlements.find(candidate => {
  const households = world.households.filter(household => household.settlementId === candidate.id && household.memberIds.length > 0);
  const establishments = world.establishments.filter(establishment => establishment.settlementId === candidate.id);
  return households.length >= 2 && establishments.length > 0;
});
assert.ok(settlement, 'проверка требует поселение минимум с двумя семьями и реальным заведением');

const localHouseholds = world.households
  .filter(household => household.settlementId === settlement!.id && household.memberIds.length > 0)
  .sort((a, b) => a.id - b.id);
const consumerHousehold = localHouseholds[0]!;
const hunterHousehold = localHouseholds.at(-1)!;
assert.notEqual(consumerHousehold.id, hunterHousehold.id, 'покупатель и охотники должны быть разными семьями');

const localCharacters = world.characters.filter(character => character.alive && character.settlementId === settlement!.id);
for (const character of localCharacters) character.profession = 'laborer';
const hunter = hunterHousehold.memberIds
  .map(id => world.characters.find(character => character.id === id))
  .find(character => character?.alive && character.age >= 16);
assert.ok(hunter, 'в семье охотников нужен живой взрослый');
hunter!.profession = 'hunter';
hunter!.skills.hunter = 72;

const consumerMembers = consumerHousehold.memberIds
  .map(id => world.characters.find(character => character.id === id))
  .filter(character => character?.alive);
assert.ok(consumerMembers.length > 0, 'семья-покупатель должна иметь живых членов');
for (const member of consumerMembers) member!.profession = 'laborer';

const localEstablishments = world.establishments.filter(establishment => establishment.settlementId === settlement!.id);
for (const establishment of localEstablishments) establishment.active = false;
const market = localEstablishments[0]!;
market.active = true;
market.type = 'рынок';
market.cash = 10_000;
market.debt = 0;
market.inventoryItemIds = [];
market.recipeIds = [];
const marketOwner = hunter!;
assert.ok(marketOwner, 'рынку нужен живой владелец');
market.ownerCharacterId = marketOwner.id;
market.workerIds = [marketOwner.id];
if (!settlement!.establishmentIds.includes(market.id)) settlement!.establishmentIds.push(market.id);

const removedItemIds = new Set(world.items
  .filter(item => item.settlementId === settlement!.id && (item.category === 'еда' || item.templateId === 'raw_hide'))
  .map(item => item.id));
world.items = world.items.filter(item => !removedItemIds.has(item.id));
for (const household of localHouseholds) {
  household.inventoryItemIds = household.inventoryItemIds.filter(id => !removedItemIds.has(id));
  household.wealth = household.id === consumerHousehold.id ? 500 : household.id === hunterHousehold.id ? 12 : 0;
  household.monthlyIncome = 0;
  household.monthlyExpenses = 0;
}
for (const establishment of localEstablishments) establishment.inventoryItemIds = establishment.inventoryItemIds.filter(id => !removedItemIds.has(id));
for (const building of world.buildings.filter(item => item.settlementId === settlement!.id)) building.inventoryItemIds = building.inventoryItemIds.filter(id => !removedItemIds.has(id));
for (const character of localCharacters) character.inventoryItemIds = character.inventoryItemIds.filter(id => !removedItemIds.has(id));

settlement!.type = 'city';
settlement!.food = 0;
settlement!.stockpile['мясо'] = 999;
settlement!.stockpile['шкуры'] = 999;
world.month = 5;
world.animalPopulations = [{
  id: 1,
  species: 'олень',
  x: settlement!.x,
  y: settlement!.y,
  count: 20,
  carryingCapacity: 40,
  diet: 'травоядное',
  preySpecies: [],
  predatorSpecies: ['волк'],
  reproductionRate: .2,
  migrationDrive: 0,
  health: 100,
  huntedThisYear: 0,
  lastCause: 'контрольная популяция',
  history: [],
}];
world.ingredients = [];

const indexes = buildWorldIndexes(world);
const hunterWealthBefore = hunterHousehold.wealth;
const marketCashBefore = market.cash;
const animalCountBefore = world.animalPopulations[0]!.count;
advanceEcology(world, new RNG('physical-hunt-yield'), indexes, {
  settlementIds: new Set([settlement!.id]),
  activeSettlementIds: new Set([settlement!.id]),
  updateAnimals: false,
});

const killed = animalCountBefore - world.animalPopulations[0]!.count;
assert.ok(killed > 0, 'охота должна уменьшить реальную популяцию животных');
const physicalMeatAfterHunt = world.items
  .filter(item => item.settlementId === settlement!.id && item.templateId === 'meat' && item.quantity > 0)
  .reduce((sum, item) => sum + item.quantity, 0);
const physicalHidesAfterHunt = world.items
  .filter(item => item.settlementId === settlement!.id && item.templateId === 'raw_hide' && item.quantity > 0)
  .reduce((sum, item) => sum + item.quantity, 0);
assert.ok(physicalMeatAfterHunt > 0, 'убитые животные должны создать физическую партию мяса');
assert.ok(physicalHidesAfterHunt > 0, 'убитые животные должны создать физическую партию шкур');
assert.equal(settlement!.stockpile['мясо'], physicalMeatAfterHunt, 'старый показатель мяса должен быть только проекцией физических предметов');
assert.equal(settlement!.stockpile['шкуры'], physicalHidesAfterHunt, 'старый показатель шкур должен быть только проекцией физических предметов');
assert.ok(hunterHousehold.wealth > hunterWealthBefore, 'реальный покупатель должен заплатить семье охотников');
assert.ok(market.cash < marketCashBefore, 'закупка добычи должна уменьшить кассу рынка');
assert.ok(world.items.some(item => item.establishmentId === market.id && item.templateId === 'meat' && item.source.includes('куплено у охотников')),
  'мясо должно попасть на конкретный рынок с записанным происхождением');

const marketHuntMeatBeforeConsumption = world.items
  .filter(item => item.establishmentId === market.id && item.templateId === 'meat' && item.source.includes('куплено у охотников') && item.quantity > 0)
  .reduce((sum, item) => sum + item.quantity, 0);
const consumerWealthBefore = consumerHousehold.wealth;
world.simulation.economyLastTickBySettlement[String(settlement!.id)] = Math.max(0, worldTick(world) - 1);
advanceMaterialEconomy(world, new RNG('physical-hunt-market-consumption'), indexes, new Set([settlement!.id]), new Set([settlement!.id]));

const totalMeatAfterConsumption = world.items
  .filter(item => item.settlementId === settlement!.id && item.templateId === 'meat' && item.quantity > 0 && item.condition > 0)
  .reduce((sum, item) => sum + item.quantity, 0);
assert.ok(consumerHousehold.wealth < consumerWealthBefore, 'семья должна заплатить за физическую еду');
assert.ok(market.monthlyRevenue > 0, 'рынок должен получить выручку от продажи добычи');
const marketHuntMeatAfterConsumption = world.items
  .filter(item => item.establishmentId === market.id && item.templateId === 'meat' && item.source.includes('куплено у охотников') && item.quantity > 0)
  .reduce((sum, item) => sum + item.quantity, 0);
assert.ok(marketHuntMeatAfterConsumption < marketHuntMeatBeforeConsumption, 'рынок должен физически передать часть охотничьего мяса семье');
assert.equal(settlement!.stockpile['мясо'], totalMeatAfterConsumption, 'после еды сводка должна снова совпадать с реальным остатком');
pruneEmptyMaterialItems(world, indexes);
assert.deepEqual(materialEconomyIntegrityIssues(world), [], 'охота, продажа и питание не должны ломать материальные инварианты');

console.log(`OK PHYSICAL HUNT ECONOMY: добыто ${killed} животных, мясо ${physicalMeatAfterHunt.toFixed(2)}, шкуры ${physicalHidesAfterHunt.toFixed(2)}, рынок продал физический товар.`);
