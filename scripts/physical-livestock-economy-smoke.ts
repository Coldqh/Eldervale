import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { buildWorldIndexes } from '../src/sim/indexes';
import { advanceLivestockSystem, initializeLivestockSystem, livestockIntegrityIssues, refreshSettlementLivestockSummary } from '../src/sim/livestockSystem';
import { addMaterialItem, advanceMaterialEconomy, materialEconomyIntegrityIssues, pruneEmptyMaterialItems } from '../src/sim/materialEconomy';
import { RNG } from '../src/sim/rng';
import { worldTick } from '../src/sim/scheduler';

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'physical-livestock-economy-smoke',
  width: 18,
  height: 12,
  historyYears: 7,
  kingdomCount: 2,
  settlementCount: 7,
  populationScale: .42,
  monsterDensity: .03,
  artifactDensity: .03,
  ecologyDensity: .22,
  localMapSize: 96,
});

initializeLivestockSystem(world, new RNG('physical-livestock-init'));
const goatHerd = (world.domesticHerds ?? []).find(herd => herd.species === 'козы'
  && herd.establishmentId
  && world.households.filter(household => household.settlementId === herd.settlementId && household.memberIds.length > 0).length >= 2);
assert.ok(goatHerd, 'проверка требует физическое козье стадо, хозяйство и две семьи');
const settlement = world.settlements.find(item => item.id === goatHerd!.settlementId)!;
const farm = world.establishments.find(item => item.id === goatHerd!.establishmentId)!;
const farmBuilding = world.buildings.find(item => item.id === goatHerd!.buildingId)!;
assert.ok(farm && farmBuilding, 'стадо должно иметь физическое хозяйство и помещение');

const localHouseholds = world.households.filter(item => item.settlementId === settlement.id && item.memberIds.length > 0).sort((a, b) => a.id - b.id);
const workerHousehold = localHouseholds[0]!;
const consumer = localHouseholds[1]!;
const worker = workerHousehold.memberIds.map(id => world.characters.find(item => item.id === id)).find(item => item?.alive && item.age >= 16);
assert.ok(worker, 'животноводческому хозяйству нужен взрослый работник');
worker!.profession = 'farmer';
worker!.skills.farmer = 88;
worker!.employerEstablishmentId = farm.id;
farm.workerIds = [worker!.id];
farm.ownerCharacterId = worker!.id;
farm.active = true;
farm.cash = 50;
farm.recipeIds = [];
farmBuilding.workerIds = [worker!.id];

const localIds = new Set(world.items.filter(item => item.settlementId === settlement.id
  && (['milk', 'eggs', 'wool', 'meat', 'raw_hide', 'straw', 'barley', 'grain', 'rye', 'wheat', 'vegetables'].includes(item.templateId) || item.category === 'еда'))
  .map(item => item.id));
world.items = world.items.filter(item => !localIds.has(item.id));
for (const building of world.buildings.filter(item => item.settlementId === settlement.id)) building.inventoryItemIds = building.inventoryItemIds.filter(id => !localIds.has(id));
for (const establishment of world.establishments.filter(item => item.settlementId === settlement.id)) establishment.inventoryItemIds = establishment.inventoryItemIds.filter(id => !localIds.has(id));
for (const household of localHouseholds) {
  household.inventoryItemIds = household.inventoryItemIds.filter(id => !localIds.has(id));
  household.needs.hunger = 86;
  household.wealth = household.id === consumer.id ? 600 : 120;
  household.debt = 0;
}

assert.equal(world.productionRecipes.some(recipe => ['Молочное хозяйство', 'Птичий двор'].includes(recipe.name)), false,
  'молоко и яйца не должны производиться бесплатными рецептами без животных');

world.month = 5;
goatHerd!.adults = 14;
goatHerd!.young = 3;
goatHerd!.health = 92;
goatHerd!.nutrition = 84;
goatHerd!.shelterQuality = 88;
goatHerd!.lastTick = worldTick(world) - 1;
for (const herd of world.domesticHerds ?? []) {
  if (herd.id !== goatHerd!.id && herd.settlementId === settlement.id) herd.lastTick = worldTick(world);
}
addMaterialItem(world, 'straw', 30, settlement.id, { establishmentId: farm.id, buildingId: farm.buildingId }, 'зимний и стойловый корм для коз', 64, undefined, true);
const feedBefore = world.items.filter(item => item.settlementId === settlement.id && item.templateId === 'straw').reduce((sum, item) => sum + item.quantity, 0);
advanceLivestockSystem(world, new RNG('physical-livestock-milk'), new Set([settlement.id]));
const feedAfter = world.items.filter(item => item.settlementId === settlement.id && item.templateId === 'straw').reduce((sum, item) => sum + item.quantity, 0);
assert.ok(feedAfter < feedBefore, 'стадо должно физически расходовать корм');
const milk = world.items.filter(item => item.settlementId === settlement.id && item.templateId === 'milk' && item.quantity > 0 && item.source.includes('надой'));
assert.ok(milk.length > 0, 'живое накормленное стадо должно создать физическую партию молока');
assert.ok(milk.some(item => item.establishmentId === farm.id && item.buildingId === farm.buildingId), 'основной надой должен находиться в конкретном хозяйстве');
assert.ok(milk.some(item => item.householdId === workerHousehold.id && item.source.includes('натуральная доля')), 'семья работников должна получить физическую долю надоя');
assert.equal(settlement.livestock.козы, goatHerd!.adults + goatHerd!.young, 'сводка скота должна вычисляться из физического стада');

const consumerWealthBefore = consumer.wealth;
const hungerBefore = consumer.needs.hunger;
world.simulation.economyLastTickBySettlement[String(settlement.id)] = worldTick(world) - 1;
let indexes = buildWorldIndexes(world);
advanceMaterialEconomy(world, new RNG('physical-livestock-market'), indexes, new Set([settlement.id]), new Set([settlement.id]));
assert.ok(consumer.wealth < consumerWealthBefore, 'чужая семья должна заплатить хозяйству за животную продукцию');
assert.ok(farm.monthlyRevenue > 0, 'продажа молока должна создать выручку конкретного хозяйства');
assert.ok(consumer.needs.hunger < hungerBefore, 'купленная животная продукция должна уменьшить голод');

let sheepHerd = (world.domesticHerds ?? []).find(herd => herd.settlementId === settlement.id && herd.species === 'овцы');
assert.ok(sheepHerd, 'миграция старого скота должна создать физическое овечье стадо');
world.month = 6;
sheepHerd!.adults = 12;
sheepHerd!.young = 2;
sheepHerd!.health = 90;
sheepHerd!.nutrition = 82;
sheepHerd!.lastTick = worldTick(world) - 1;
sheepHerd!.lastShearingYear = undefined;
addMaterialItem(world, 'straw', 20, settlement.id, { establishmentId: sheepHerd!.establishmentId, buildingId: sheepHerd!.buildingId }, 'корм для овец', 62, undefined, true);
advanceLivestockSystem(world, new RNG('physical-livestock-wool'), new Set([settlement.id]));
assert.ok(world.items.some(item => item.settlementId === settlement.id && item.templateId === 'wool' && item.quantity > 0 && item.source.includes('стрижка стада')),
  'шерсть должна появляться только после стрижки физического стада');

world.month = 10;
goatHerd!.adults = 24;
goatHerd!.young = 4;
goatHerd!.health = 88;
goatHerd!.nutrition = 80;
goatHerd!.lastTick = worldTick(world) - 1;
goatHerd!.lastCullYear = undefined;
addMaterialItem(world, 'straw', 30, settlement.id, { establishmentId: farm.id, buildingId: farm.buildingId }, 'корм перед осенним отбором', 60, undefined, true);
const adultsBeforeCull = goatHerd!.adults;
advanceLivestockSystem(world, new RNG('physical-livestock-cull'), new Set([settlement.id]));
assert.ok(goatHerd!.adults < adultsBeforeCull, 'осенний отбор должен уменьшить реальное стадо');
assert.ok(world.items.some(item => item.settlementId === settlement.id && item.templateId === 'meat' && item.quantity > 0 && item.source.includes('осенний отбор')),
  'забой должен создать физическое мясо с происхождением');
assert.ok(world.items.some(item => item.settlementId === settlement.id && item.templateId === 'raw_hide' && item.quantity > 0 && item.source.includes('осенний отбор')),
  'забой должен создать физические шкуры');

for (const item of world.items.filter(item => item.settlementId === settlement.id && ['straw', 'barley', 'grain', 'rye', 'wheat', 'vegetables'].includes(item.templateId))) item.quantity = 0;
world.month = 11;
goatHerd!.adults = 32;
goatHerd!.young = 4;
goatHerd!.health = 18;
goatHerd!.nutrition = 8;
goatHerd!.lastTick = worldTick(world) - 1;
const countBeforeStarvation = goatHerd!.adults + goatHerd!.young;
advanceLivestockSystem(world, new RNG('physical-livestock-starvation'), new Set([settlement.id]));
assert.ok(goatHerd!.adults + goatHerd!.young < countBeforeStarvation, 'отсутствие корма должно вызывать реальный падёж, а не только менять декоративный показатель');
assert.ok(world.events.some(event => event.title.includes('Кризис стада')), 'падёж должен иметь причинное событие мира');

refreshSettlementLivestockSummary(world, settlement.id);
indexes = buildWorldIndexes(world);
pruneEmptyMaterialItems(world, indexes);
assert.deepEqual(livestockIntegrityIssues(world), [], 'стада, здания и сводки не должны расходиться');
assert.deepEqual(materialEconomyIntegrityIssues(world), [], 'животная продукция не должна ломать материальные инварианты');

console.log(`OK PHYSICAL LIVESTOCK: стадо коз ${goatHerd!.id}, корм ${feedBefore.toFixed(2)}→${feedAfter.toFixed(2)}, молочных партий ${milk.length}, после падежа ${goatHerd!.adults + goatHerd!.young} животных.`);
