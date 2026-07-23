import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { CIVILIZATION_CONTENT } from '../src/content/coreContent';
import { advanceMaterialEconomy } from '../src/sim/materialEconomy';
import { buildWorldIndexes } from '../src/sim/indexes';
import { RNG } from '../src/sim/rng';
import type { ResourceDeposit } from '../src/regionalEconomyTypes';
import {
  activeTradeContractForRoute, initializeRegionalEconomy, regionalEconomyIntegrityIssues,
  regionalPriceMultiplier, reserveRegionalExtraction, synchronizeRegionalTradeContracts,
} from '../src/sim/regionalEconomy';

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'regional-economy-smoke',
  width: 20,
  height: 14,
  historyYears: 8,
  kingdomCount: 2,
  settlementCount: 8,
  populationScale: .22,
  monsterDensity: .15,
  artifactDensity: .15,
  ecologyDensity: .45,
});

assert.equal(world.version, 34, 'новый мир должен использовать схему 34');
initializeRegionalEconomy(world);
assert.equal(world.settlementRegionalEconomies.length, world.settlements.length, 'каждое поселение должно иметь региональную экономику');
assert.ok(world.resourceDeposits.length > 0, 'карта должна содержать естественные ресурсные источники');
assert.ok(world.resourceDeposits.every(deposit => !deposit.history.some(entry => entry.includes('чтобы его хозяйство имело физическую ресурсную базу'))), 'поселение не должно получать искусственное месторождение ради выживания');

const ironRecipe = world.productionRecipes.find(recipe => recipe.outputs.some(output => output.templateId === 'iron_ore'));
assert.ok(ironRecipe, 'должен существовать рецепт добычи железной руды');
const extractionSettlement = world.settlements[0]!;
world.resourceDeposits = world.resourceDeposits.filter(item => !(item.assignedSettlementId === extractionSettlement.id && item.templateId === 'iron_ore'));
const controlledDeposit: ResourceDeposit = {
  id: Math.max(0, ...world.resourceDeposits.map(item => item.id)) + 1,
  x: extractionSettlement.x,
  y: extractionSettlement.y,
  templateId: 'iron_ore',
  kind: 'mineral' as const,
  initialAmount: 12,
  remaining: 12,
  quality: 80,
  extractionDifficulty: 35,
  renewable: false,
  regenerationPerYear: 0,
  assignedSettlementId: extractionSettlement.id,
  history: ['Проверочное месторождение.'],
};
world.resourceDeposits.push(controlledDeposit);
const extractionState = world.settlementRegionalEconomies.find(item => item.settlementId === extractionSettlement.id)!;
extractionState.localDepositIds = world.resourceDeposits.filter(item => item.assignedSettlementId === extractionSettlement.id).map(item => item.id);
const allowedRuns = reserveRegionalExtraction(world, extractionSettlement.id, ironRecipe!, 5);
assert.equal(allowedRuns, 2, 'физический остаток месторождения должен ограничить число производственных циклов');
assert.equal(controlledDeposit.remaining, 0, 'добыча должна списать реальный запас');
assert.equal(controlledDeposit.exhaustedYear, world.year, 'истощение должно быть записано в мире');

const route = world.tradeRoutes.find(candidate => {
  const endpointIds = [candidate.fromSettlementId, candidate.toSettlementId];
  return endpointIds.every(settlementId => world.establishments.some(establishment => establishment.settlementId === settlementId)
    && world.characters.some(character => character.alive && character.settlementId === settlementId && character.age >= 16));
});
assert.ok(route, 'проверка требует торговый путь между двумя живыми хозяйственными центрами');
const sellerState = world.settlementRegionalEconomies.find(item => item.settlementId === route!.fromSettlementId)!;
const buyerState = world.settlementRegionalEconomies.find(item => item.settlementId === route!.toSettlementId)!;
const seller = world.settlements.find(item => item.id === route!.fromSettlementId)!;
const buyer = world.settlements.find(item => item.id === route!.toSettlementId)!;
route!.active = true;
route!.safety = 82;
route!.volume = Math.max(120, route!.volume);
sellerState.exportTemplateIds = ['iron_ore'];
buyerState.criticalImportTemplateIds = ['iron_ore'];
buyerState.importReliance = 88;
seller.economy.supply.iron_ore = 120;
seller.economy.demand.iron_ore = 2;
buyer.economy.supply.iron_ore = 0;
buyer.economy.demand.iron_ore = 18;
world.tradeContracts = [];
synchronizeRegionalTradeContracts(world);
const contract = world.tradeContracts.find(item => item.routeId === route!.id && item.fromSettlementId === seller.id && item.toSettlementId === buyer.id && item.templateId === 'iron_ore');
assert.ok(contract, 'дефицит и избыток на связанном маршруте должны создать договор поставки железной руды');
assert.equal(contract!.templateId, 'iron_ore');
assert.equal(contract!.fromSettlementId, seller.id);
assert.equal(contract!.toSettlementId, buyer.id);
contract!.maxUnitPrice = 100000;
world.tradeContracts = [contract!];
world.shipments = world.shipments.filter(item => item.routeId !== route!.id);
assert.ok(regionalPriceMultiplier(world, buyer.id, 'iron_ore') > regionalPriceMultiplier(world, seller.id, 'iron_ore'), 'импортозависимый город должен иметь более высокое ценовое давление');

const sellerEstablishment = world.establishments.find(item => item.settlementId === seller.id && item.active && ['рынок', 'лавка', 'склад'].includes(item.type))
  ?? world.establishments.find(item => item.settlementId === seller.id);
const buyerEstablishment = world.establishments.find(item => item.settlementId === buyer.id && item.active && ['рынок', 'лавка', 'склад'].includes(item.type))
  ?? world.establishments.find(item => item.settlementId === buyer.id);
assert.ok(sellerEstablishment && buyerEstablishment, 'физическая поставка требует реальных заведений на обоих концах пути');
sellerEstablishment!.active = true;
buyerEstablishment!.active = true;
buyerEstablishment!.type = 'рынок';
const sellerOwner = world.characters.find(character => character.alive && character.settlementId === seller.id && character.age >= 16);
const buyerOwner = world.characters.find(character => character.alive && character.settlementId === buyer.id && character.age >= 16);
assert.ok(sellerOwner && buyerOwner, 'поставка требует живых владельцев заведений');
sellerEstablishment!.ownerCharacterId = sellerOwner!.id;
buyerEstablishment!.ownerCharacterId = buyerOwner!.id;
if (!sellerEstablishment!.workerIds.includes(sellerOwner!.id)) sellerEstablishment!.workerIds.push(sellerOwner!.id);
if (!buyerEstablishment!.workerIds.includes(buyerOwner!.id)) buyerEstablishment!.workerIds.push(buyerOwner!.id);
if (!seller.establishmentIds.includes(sellerEstablishment!.id)) seller.establishmentIds.push(sellerEstablishment!.id);
if (!buyer.establishmentIds.includes(buyerEstablishment!.id)) buyer.establishmentIds.push(buyerEstablishment!.id);
const oreTemplate = CIVILIZATION_CONTENT.resourceById.get('iron_ore')!;
const oreItemId = world.nextIds.item++;
world.items.push({
  id: oreItemId, templateId: oreTemplate.id, name: oreTemplate.name, category: oreTemplate.category, material: oreTemplate.material,
  quantity: 180, unit: oreTemplate.unit, weightPerUnit: oreTemplate.weight, quality: 72, condition: 100, freshness: 100,
  perishabilityMonths: oreTemplate.perishability, baseValue: oreTemplate.value, settlementId: seller.id,
  buildingId: sellerEstablishment!.buildingId, establishmentId: sellerEstablishment!.id, createdYear: world.year,
  source: 'проверочный склад региональной экономики', history: [],
});
sellerEstablishment!.inventoryItemIds.push(oreItemId);
buyerEstablishment!.cash = 100000;
world.month = 1;
advanceMaterialEconomy(world, new RNG('regional-shipment-departure'), buildWorldIndexes(world), new Set([seller.id, buyer.id]), new Set([seller.id, buyer.id]));
const physicalShipment = world.shipments.find(item => item.routeId === route!.id && item.fromSettlementId === seller.id && item.toSettlementId === buyer.id && item.status === 'в пути' && item.goods.some(goods => goods.templateId === 'iron_ore'));
assert.ok(physicalShipment, 'договор должен создать физическую поставку железной руды');

route!.active = false;
synchronizeRegionalTradeContracts(world);
assert.equal(world.tradeContracts.find(item => item.id === contract!.id)?.status, 'suspended', 'перекрытый путь должен приостановить договор');
assert.ok(world.tradeContracts.find(item => item.id === contract!.id)?.disruptedSinceTick !== undefined, 'разрыв поставки должен хранить момент начала');
world.year = Math.floor(physicalShipment!.arrivalTick / 12);
world.month = physicalShipment!.arrivalTick % 12 + 1;
advanceMaterialEconomy(world, new RNG('regional-shipment-blocked'), buildWorldIndexes(world), new Set([seller.id, buyer.id]), new Set([seller.id, buyer.id]));
assert.equal(physicalShipment!.status, 'потерян', 'поставка на перекрытом пути не должна телепортироваться в город');

route!.active = true;
route!.safety = 75;
synchronizeRegionalTradeContracts(world);
assert.equal(world.tradeContracts.find(item => item.id === contract!.id)?.status, 'active', 'после восстановления пути договор должен возобновиться');

assert.deepEqual(regionalEconomyIntegrityIssues(world), [], 'региональная экономика должна сохранять инварианты');
console.log(`OK REGIONAL ECONOMY: месторождений ${world.resourceDeposits.length}, специализаций ${world.settlementRegionalEconomies.length}, договоров ${world.tradeContracts.length}.`);
