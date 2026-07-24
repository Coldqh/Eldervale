import assert from 'node:assert/strict';
import { advanceAgriculture } from '../src/sim/agricultureConstruction';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { buildWorldIndexes } from '../src/sim/indexes';
import {
  advanceMaterialEconomy,
  materialEconomyIntegrityIssues,
  pruneEmptyMaterialItems,
  refreshSettlementMaterialSummary,
  routeAgriculturalHarvestToGranaries,
} from '../src/sim/materialEconomy';
import { RNG } from '../src/sim/rng';
import { worldTick } from '../src/sim/scheduler';

const cropTemplates = new Set(['grain', 'wheat', 'barley', 'rye', 'vegetables', 'flax', 'straw']);
const cerealTemplates = new Set(['grain', 'wheat', 'barley', 'rye']);

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'physical-agriculture-economy-smoke',
  width: 18,
  height: 12,
  historyYears: 8,
  kingdomCount: 2,
  settlementCount: 7,
  populationScale: .38,
  monsterDensity: .04,
  artifactDensity: .04,
  ecologyDensity: .24,
  localMapSize: 96,
});

const settlement = world.settlements.find(candidate => {
  const fields = world.fields.filter(field => field.settlementId === candidate.id && field.establishmentId);
  const households = world.households.filter(household => household.settlementId === candidate.id && household.memberIds.length > 0);
  const establishments = world.establishments.filter(establishment => establishment.settlementId === candidate.id);
  return fields.length > 0 && households.length >= 2 && establishments.length >= 2;
});
assert.ok(settlement, 'проверка требует поселение с полем, фермой и двумя семьями');

const field = world.fields.find(candidate => candidate.settlementId === settlement!.id && candidate.establishmentId);
assert.ok(field, 'у поселения должно быть физическое поле');
const farm = world.establishments.find(candidate => candidate.id === field!.establishmentId);
assert.ok(farm, 'поле должно принадлежать физической ферме');

const localEstablishments = world.establishments.filter(candidate => candidate.settlementId === settlement!.id);
let granary = localEstablishments.find(candidate => candidate.type === 'склад' && candidate.id !== farm!.id);
if (!granary) granary = localEstablishments.find(candidate => candidate.id !== farm!.id);
assert.ok(granary, 'для урожая требуется отдельное физическое хранилище');
granary!.type = 'склад';
granary!.active = true;
granary!.cash = 20_000;
granary!.debt = 0;
granary!.inventoryItemIds = [];
granary!.recipeIds = [];

for (const establishment of localEstablishments) {
  establishment.active = establishment.id === farm!.id || establishment.id === granary!.id;
  establishment.recipeIds = [];
  establishment.inventoryItemIds = [];
}
farm!.active = true;
farm!.type = 'ферма';
farm!.cash = 10;
farm!.debt = 0;

const localHouseholds = world.households
  .filter(household => household.settlementId === settlement!.id && household.memberIds.length > 0)
  .sort((a, b) => a.id - b.id);
const consumer = localHouseholds[0]!;
for (const household of localHouseholds) {
  household.inventoryItemIds = [];
  household.wealth = household.id === consumer.id ? 500 : 120;
  household.debt = 0;
  household.needs.hunger = 82;
  household.monthlyIncome = 0;
  household.monthlyExpenses = 0;
}

const localCharacters = world.characters.filter(character => character.alive && character.settlementId === settlement!.id);
for (const character of localCharacters) {
  character.profession = 'laborer';
  character.inventoryItemIds = [];
  character.employerEstablishmentId = undefined;
  character.employmentContractId = undefined;
}
const farmer = localCharacters.find(character => character.age >= 16 && character.householdId !== consumer.id) ?? localCharacters.find(character => character.age >= 16);
assert.ok(farmer, 'ферме нужен живой взрослый работник');
farmer!.profession = 'farmer';
farmer!.skills.farmer = 85;
farm!.workerIds = [farmer!.id];
granary!.workerIds = [];
const farmBuilding = world.buildings.find(building => building.id === farm!.buildingId);
const granaryBuilding = world.buildings.find(building => building.id === granary!.buildingId);
assert.ok(farmBuilding && granaryBuilding, 'ферма и амбар должны иметь физические здания');
farmBuilding!.workerIds = [farmer!.id];
farmBuilding!.inventoryItemIds = [];
granaryBuilding!.workerIds = [];
granaryBuilding!.inventoryItemIds = [];

const removedIds = new Set(world.items
  .filter(item => item.settlementId === settlement!.id && (cropTemplates.has(item.templateId) || item.category === 'еда'))
  .map(item => item.id));
world.items = world.items.filter(item => !removedIds.has(item.id));
for (const building of world.buildings.filter(candidate => candidate.settlementId === settlement!.id)) {
  building.inventoryItemIds = building.inventoryItemIds.filter(id => !removedIds.has(id));
}
for (const household of localHouseholds) household.inventoryItemIds = household.inventoryItemIds.filter(id => !removedIds.has(id));
for (const establishment of localEstablishments) establishment.inventoryItemIds = establishment.inventoryItemIds.filter(id => !removedIds.has(id));
for (const character of localCharacters) character.inventoryItemIds = character.inventoryItemIds.filter(id => !removedIds.has(id));

settlement!.type = 'city';
settlement!.food = 999;
settlement!.stockpile['зерно'] = 999;
settlement!.stockpile['пшеница'] = 999;
world.month = 8;
field!.crop = 'пшеница';
field!.state = 'готово к жатве';
field!.fertility = 92;
field!.moisture = 55;
field!.weeds = 0;
field!.pests = 0;
field!.laborRequired = 1;
field!.laborDone = 1;
field!.lastWorkedTick = Math.max(0, worldTick(world) - 1);
world.simulation.agricultureLastTickBySettlement[String(settlement!.id)] = Math.max(0, worldTick(world) - 1);
refreshSettlementMaterialSummary(world, settlement!.id);

const indexes = buildWorldIndexes(world);
advanceAgriculture(world, new RNG('physical-agriculture-harvest'), indexes, new Set([settlement!.id]));

const harvestedWheat = world.items.filter(item => item.settlementId === settlement!.id
  && item.templateId === 'wheat' && item.quantity > 0 && item.source.includes(`урожай поля №${field!.id}`));
assert.ok(harvestedWheat.length > 0, 'жатва должна создать физическую партию пшеницы');
assert.equal(field!.state, 'убрано', 'поле должно перейти в состояние убранного урожая');
assert.ok(harvestedWheat.every(item => item.establishmentId === farm!.id && item.buildingId === farm!.buildingId),
  'сразу после жатвы урожай должен находиться на конкретной ферме');

const totalCrop = () => world.items
  .filter(item => item.settlementId === settlement!.id && cropTemplates.has(item.templateId) && item.quantity > .0001 && item.condition > 0)
  .reduce((sum, item) => sum + item.quantity, 0);
const totalCereal = () => world.items
  .filter(item => item.settlementId === settlement!.id && cerealTemplates.has(item.templateId) && item.quantity > .0001 && item.condition > 0)
  .reduce((sum, item) => sum + item.quantity, 0);

const cropBeforeRouting = totalCrop();
const farmCashBefore = farm!.cash;
const granaryCashBefore = granary!.cash;
const routed = routeAgriculturalHarvestToGranaries(world, settlement!.id);
const cropAfterRouting = totalCrop();
assert.ok(routed.movedQuantity > 0, 'физический амбар должен принять урожай фермы');
assert.ok(Math.abs(cropBeforeRouting - cropAfterRouting) < .0001, 'перевозка в амбар не должна создавать или уничтожать урожай');
assert.ok(farm!.cash > farmCashBefore, 'амбар должен оплатить принятую партию ферме');
assert.ok(granary!.cash < granaryCashBefore, 'закупка урожая должна уменьшить кассу амбара');
assert.ok(world.items.some(item => item.establishmentId === granary!.id && item.templateId === 'wheat'
  && item.quantity > 0 && item.source.includes('принят в амбар')),
  'пшеница должна физически находиться в конкретном амбаре с происхождением');
const workerShare = world.items.filter(item => item.householdId && item.templateId === 'wheat'
  && item.quantity > 0 && item.source.includes('натуральная доля урожая'));
assert.ok(workerShare.length > 0, 'доля работников должна стать физическим запасом их семей');
assert.ok(Math.abs(cropBeforeRouting - totalCrop()) < .0001,
  'раздел урожая между работниками и амбаром не должен менять общее количество');

refreshSettlementMaterialSummary(world, settlement!.id);
assert.ok(Math.abs((settlement!.stockpile['зерно'] ?? 0) - totalCereal()) < .0001,
  'старый показатель зерна должен быть только проекцией физических мешков');
assert.ok(Math.abs((settlement!.stockpile['пшеница'] ?? 0) - totalCereal()) < .0001,
  'показатель пшеницы должен совпадать с реальной партией');
assert.ok(settlement!.food < 999 && settlement!.food > 0, 'пища поселения должна пересчитаться из физических предметов');

const cerealBeforeConsumption = totalCereal();
const consumerWealthBefore = consumer.wealth;
const consumerHungerBefore = consumer.needs.hunger;
world.simulation.economyLastTickBySettlement[String(settlement!.id)] = Math.max(0, worldTick(world) - 1);
advanceMaterialEconomy(world, new RNG('physical-agriculture-consumption'), indexes, new Set([settlement!.id]), new Set([settlement!.id]));
const cerealAfterConsumption = totalCereal();
assert.ok(cerealAfterConsumption < cerealBeforeConsumption, 'семьи должны физически расходовать выращенное зерно');
assert.ok(consumer.wealth < consumerWealthBefore, 'семья должна платить за зерно из амбара');
assert.ok(consumer.needs.hunger < consumerHungerBefore, 'питание реальным зерном должно уменьшать голод');
assert.ok(world.items.filter(item => item.settlementId === settlement!.id && cerealTemplates.has(item.templateId) && item.quantity > 0)
  .some(item => item.freshness < 100), 'оставшийся урожай должен стареть по правилам хранения');
assert.ok(Math.abs((settlement!.stockpile['зерно'] ?? 0) - totalCereal()) < .0001,
  'после торговли и питания сводка зерна должна совпадать с остатком');

pruneEmptyMaterialItems(world, indexes);
assert.deepEqual(materialEconomyIntegrityIssues(world), [], 'поле, амбар, рынок и питание не должны ломать материальные инварианты');

console.log(`OK PHYSICAL AGRICULTURE: поле ${field!.id}, собрано ${cropBeforeRouting.toFixed(2)}, в амбар ${routed.movedQuantity.toFixed(2)}, после питания зерна ${cerealAfterConsumption.toFixed(2)}.`);
