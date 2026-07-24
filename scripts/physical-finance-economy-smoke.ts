import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { buildWorldIndexes } from '../src/sim/indexes';
import { addMaterialItem, advanceMaterialEconomy } from '../src/sim/materialEconomy';
import { advanceSettlementLife } from '../src/sim/settlementLife';
import { advanceMilitaryInfrastructure, initializeMilitaryInfrastructure } from '../src/sim/militaryInfrastructure';
import {
  beginFinancialAudit, completeFinancialAudit, financialIntegrityIssues, initializeFinancialSystem,
  totalMoneySupply,
} from '../src/sim/financialSystem';
import { RNG } from '../src/sim/rng';
import { worldTick } from '../src/sim/scheduler';

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'physical-finance-economy-smoke',
  width: 18,
  height: 12,
  historyYears: 6,
  kingdomCount: 2,
  settlementCount: 7,
  populationScale: .42,
  monsterDensity: .02,
  artifactDensity: .02,
  ecologyDensity: .18,
  localMapSize: 96,
});
initializeFinancialSystem(world);

const settlement = world.settlements.find(candidate => {
  const households = world.households.filter(item => item.settlementId === candidate.id && item.memberIds.length > 0);
  return households.length >= 2 && world.establishments.some(item => item.settlementId === candidate.id) && world.settlementGovernments.some(item => item.settlementId === candidate.id);
});
assert.ok(settlement, 'финансовому тесту нужны поселение, две семьи, заведение и местная власть');
const households = world.households.filter(item => item.settlementId === settlement!.id && item.memberIds.length > 0).sort((a, b) => a.id - b.id);
const workerHousehold = households[0]!;
const consumerHousehold = households[1]!;
const worker = workerHousehold.memberIds.map(id => world.characters.find(item => item.id === id)).find(item => item?.alive && item.age >= 16);
assert.ok(worker, 'нужен живой взрослый работник');
const shop = world.establishments.find(item => item.settlementId === settlement!.id)!;
const government = world.settlementGovernments.find(item => item.settlementId === settlement!.id)!;
const kingdom = world.kingdoms.find(item => item.id === settlement!.kingdomId)!;

shop.type = 'продовольственная лавка';
shop.active = true;
shop.ownerCharacterId = worker!.id;
shop.workerIds = [worker!.id];
shop.recipeIds = [];
shop.cash = 180;
shop.debt = 0;
shop.monthlyRevenue = 0;
shop.monthlyExpenses = 0;
worker!.employerEstablishmentId = shop.id;
worker!.workplaceBuildingId = shop.buildingId;
let contract = world.employments.find(item => item.characterId === worker!.id && item.establishmentId === shop.id);
if (!contract) {
  contract = {
    id: world.nextIds.employment++, characterId: worker!.id, establishmentId: shop.id, role: 'продавец', wage: 12,
    hoursPerWeek: 42, sinceYear: world.year, active: true, arrears: 0,
  };
  world.employments.push(contract);
}
contract.active = true;
contract.wage = 12;
contract.arrears = 0;
workerHousehold.wealth = 50;
workerHousehold.debt = 0;
consumerHousehold.wealth = 80;
consumerHousehold.debt = 0;
consumerHousehold.needs.hunger = 92;
government.treasury = 20;
government.monthlyTaxIncome = 0;
kingdom.treasury = 40;

const localFoodIds = new Set(world.items.filter(item => item.settlementId === settlement!.id && ['bread', 'grain', 'wheat', 'rye', 'barley', 'vegetables', 'milk', 'eggs', 'meat', 'fish'].includes(item.templateId)).map(item => item.id));
world.items = world.items.filter(item => !localFoodIds.has(item.id));
for (const establishment of world.establishments.filter(item => item.settlementId === settlement!.id)) establishment.inventoryItemIds = establishment.inventoryItemIds.filter(id => !localFoodIds.has(id));
for (const household of households) household.inventoryItemIds = household.inventoryItemIds.filter(id => !localFoodIds.has(id));
addMaterialItem(world, 'bread', 12, settlement!.id, { establishmentId: shop.id, buildingId: shop.buildingId }, 'контрольная партия хлеба для финансового теста', 70, undefined, true);

world.financialTransactions = [];
world.financialObligations = [];
world.nextIds.financialTransaction = 1;
world.nextIds.financialObligation = 1;
const moneyBeforeTrade = totalMoneySupply(world);
const checkpoint = beginFinancialAudit(world);
world.simulation.economyLastTickBySettlement ??= {};
world.simulation.economyLastTickBySettlement[String(settlement!.id)] = worldTick(world) - 1;
let indexes = buildWorldIndexes(world);
advanceMaterialEconomy(world, new RNG('physical-finance-material'), indexes, new Set([settlement!.id]), new Set([settlement!.id]));
completeFinancialAudit(world, checkpoint);
const moneyAfterTrade = totalMoneySupply(world);

assert.ok(world.financialTransactions.some(item => item.kind === 'trade' && item.payer?.kind === 'household' && item.payee?.kind === 'establishment'), 'продажа еды должна иметь проводку от семьи к заведению');
assert.ok(world.financialTransactions.some(item => item.kind === 'wage' && item.payer?.kind === 'establishment'), 'зарплата должна иметь проводку из кассы заведения');
assert.ok(world.financialTransactions.some(item => item.kind === 'tax' && item.payee?.kind === 'settlementGovernment'), 'налог должен физически поступить местной власти');
assert.ok(government.monthlyTaxIncome > 0, 'местная власть должна видеть только фактически полученный налог');
assert.ok(Math.abs(moneyAfterTrade - moneyBeforeTrade) < .0001, 'торговля, зарплата и налоги не должны менять общую денежную массу');
assert.ok(Math.abs(world.simulation.financeAudit?.unexplainedDelta ?? 1) < .0001, 'финансовый аудит не должен находить необъяснимое создание денег в материальном цикле');

const taxBeforeCivic = government.treasury;
const transactionsBeforeCivic = world.financialTransactions.length;
government.guardIds = [worker!.id];
government.judgeIds = [];
government.firefighterIds = [];
government.teacherIds = [];
government.gravediggerIds = [];
indexes = buildWorldIndexes(world);
advanceSettlementLife(world, new RNG('physical-finance-civic'), indexes, new Set([settlement!.id]), new Set([settlement!.id]), { elapsedMonths: 1 });
const civicTransactions = world.financialTransactions.slice(transactionsBeforeCivic);
assert.equal(civicTransactions.some(item => item.kind === 'tax' && !item.payer), false, 'городская система не должна начислять фантомный налог без плательщика');
assert.ok(civicTransactions.some(item => item.kind === 'servicePayroll' && item.payer?.kind === 'settlementGovernment'), 'городская служба должна получить реальное жалование из местной казны');
assert.ok(government.treasury < taxBeforeCivic, 'зарплата и содержание города должны уменьшить реальную казну');

let army = world.armies.find(item => item.soldierIds.length > 0);
if (!army) {
  worker!.militaryRole = 'пехотинец';
  worker!.serviceStatus = 'гарнизон';
  army = {
    id: world.nextIds.army++, name: 'Контрольный гарнизон', kingdomId: kingdom.id, commanderId: worker!.id,
    x: settlement!.x, y: settlement!.y, strength: 1, morale: 55, supplies: 0, status: 'garrison', campaignHistory: [],
    soldierIds: [worker!.id], unitIds: [], garrisonBuildingId: undefined, arsenalBuildingId: undefined, castleBuildingId: undefined,
    supplyWagonIds: [], inventoryItemIds: [], logistics: { foodDays: 0, waterDays: 0, medicine: 0, tents: 0, tools: 0, horses: 0, wagons: 0, equipmentCoverage: 0, armorCoverage: 0, rangedCoverage: 0, payrollDebt: 0, desertions: 0, wounded: 0 },
    monthlyPayroll: 0, readiness: 20,
  };
  world.armies.push(army);
}
indexes = buildWorldIndexes(world);
initializeMilitaryInfrastructure(world, new RNG('physical-finance-army-init'), indexes);
const armyKingdom = world.kingdoms.find(item => item.id === army!.kingdomId)!;
const soldier = world.characters.find(item => item.id === army!.soldierIds[0]);
assert.ok(soldier, 'в армии должен быть живой солдат');
armyKingdom.treasury = 0;
const arrearsBefore = soldier!.servicePayArrears ?? 0;
indexes = buildWorldIndexes(world);
advanceMilitaryInfrastructure(world, new RNG('physical-finance-army'), indexes);
assert.equal(armyKingdom.treasury, 0, 'бедная держава не должна уходить в отрицательную казну');
assert.ok((soldier!.servicePayArrears ?? 0) > arrearsBefore, 'невыплаченное военное жалование должно стать долгом');
assert.ok(world.financialObligations.some(item => item.debtor.kind === 'kingdom' && item.debtor.id === armyKingdom.id && item.kind === 'stateDebt' && item.outstandingAmount > 0), 'долг бедной державы перед солдатом должен существовать отдельным обязательством');

assert.deepEqual(financialIntegrityIssues(world), [], 'финансовые счета, проводки и обязательства должны сохранять инварианты');
console.log(`OK PHYSICAL FINANCE: проводок ${world.financialTransactions.length}, налогов ${government.monthlyTaxIncome.toFixed(2)}, открытых обязательств ${world.financialObligations.filter(item => item.status !== 'paid').length}.`);
