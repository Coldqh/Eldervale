import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { buildWorldIndexes } from '../src/sim/indexes';
import { advanceHealthSystem, initializeHealthSystem } from '../src/sim/healthSystem';
import { advanceLivingEconomy } from '../src/sim/livingEconomy';
import { createWorldSystemEngine, advanceWorldSystems } from '../src/sim/simulation';
import { worldTick } from '../src/sim/scheduler';
import { RNG } from '../src/sim/rng';
import { worldLawIntegrityIssues } from '../src/sim/worldLaw';
import type { Character, WorldState } from '../src/types';

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'world-law-smoke',
  width: 18,
  height: 12,
  historyYears: 8,
  kingdomCount: 2,
  settlementCount: 7,
  populationScale: .32,
  monsterDensity: .05,
  artifactDensity: .05,
  ecologyDensity: .18,
  localMapSize: 96,
});

assert.equal(world.version, 34, '6.0 должен использовать схему 34');
assert.equal(world.simulation.worldLawVersion, 1, 'единый закон мира должен быть инициализирован');
assert.equal(world.history.genesis?.plannedSiteCount, 0, 'будущие города не должны быть предрешены старым каркасом карты');
assert.ok(world.resourceDeposits.every(deposit => !deposit.history.some(entry => entry.includes('чтобы его хозяйство имело физическую ресурсную базу'))), 'у поселений не должно быть искусственных ресурсных страховок');
assert.ok(world.items.every(item => item.source.trim().length > 0), 'каждый предмет должен иметь происхождение');
assert.ok(world.items.every(item => item.source !== 'товар странствующего продавца'), 'торговцы не должны получать бесплатный товар');
for (const merchant of world.travelingMerchants) {
  for (const itemId of merchant.wagonInventoryItemIds) {
    const item = world.items.find(candidate => candidate.id === itemId)!;
    assert.ok(item.source.includes('куплено у'), `товар ${itemId} должен быть куплен у реального продавца`);
  }
}

const spousePair = world.characters.find(character => character.alive && character.spouseId && character.id < character.spouseId);
if (spousePair) {
  const spouse = world.characters.find(character => character.id === spousePair.spouseId)!;
  spousePair.sex = 'female';
  spouse.sex = 'female';
  world.simulation.healthSystemVersion = undefined;
  initializeHealthSystem(world);
  assert.equal(spousePair.sex, 'female');
  assert.equal(spouse.sex, 'female', 'инициализация здоровья не должна менять биологический пол супруга');
}

const birthWorld = structuredClone(world) as WorldState;
const adults = birthWorld.characters.filter(character => character.alive && character.age >= 18).slice(0, 2);
if (adults.length === 2) {
  const [gestating, other] = adults as [Character, Character];
  gestating.sex = 'female';
  other.sex = 'male';
  gestating.spouseId = other.id;
  other.spouseId = gestating.id;
  birthWorld.simulation.healthSystemVersion = undefined;
  initializeHealthSystem(birthWorld);
  const pregnancyId = birthWorld.nextIds.pregnancy++;
  gestating.healthProfile!.pregnancyId = pregnancyId;
  birthWorld.pregnancies.push({
    id: pregnancyId,
    parentAId: gestating.id,
    parentBId: other.id,
    gestatingParentId: gestating.id,
    settlementId: gestating.settlementId,
    conceivedTick: worldTick(birthWorld) - 9,
    dueTick: worldTick(birthWorld),
    status: 'беременность',
    risk: 12,
    history: ['Проверочная беременность.'],
  });
  other.alive = false;
  const beforeChildren = birthWorld.characters.length;
  advanceHealthSystem(birthWorld, new RNG('world-law-birth'), buildWorldIndexes(birthWorld), { demographyOnly: true });
  const pregnancy = birthWorld.pregnancies.find(item => item.id === pregnancyId)!;
  assert.equal(pregnancy.status, 'завершено', 'смерть второго родителя после зачатия не должна прерывать беременность');
  assert.equal(birthWorld.characters.length, beforeChildren + 1, 'ребёнок должен родиться');
}

const detailWorld = structuredClone(world) as WorldState;
detailWorld.travelingMerchants = [];
detailWorld.simulation.livingEconomyVersion = 1;
const detailIndexes = buildWorldIndexes(detailWorld);
const detailedCharacter = detailWorld.characters.find(character => character.alive && character.householdId);
if (detailedCharacter?.householdId) {
  const beforeItemIds = detailWorld.items.map(item => item.id).sort((a, b) => a - b);
  advanceLivingEconomy(detailWorld, new RNG('world-law-detail'), detailIndexes, {
    settlementIds: new Set([detailedCharacter.settlementId]),
    characterIds: new Set([detailedCharacter.id]),
    householdIds: new Set([detailedCharacter.householdId]),
  });
  assert.deepEqual(detailWorld.items.map(item => item.id).sort((a, b) => a - b), beforeItemIds, 'приближение наблюдателя не должно материализовывать бесплатную экипировку');
}

const normalWorld = structuredClone(world) as WorldState;
const historicalFlagWorld = structuredClone(world) as WorldState;
advanceWorldSystems(createWorldSystemEngine(normalWorld), { fastForward: true, monthStep: 3 });
advanceWorldSystems(createWorldSystemEngine(historicalFlagWorld), { fastForward: true, monthStep: 3, historicalPopulation: true });
const signature = (value: WorldState) => JSON.stringify({
  year: value.year,
  month: value.month,
  characters: value.characters.map(character => [character.id, character.age, character.alive, character.spouseId, character.health]),
  pregnancies: value.pregnancies,
  items: value.items.map(item => [item.id, item.quantity, item.condition, item.freshness]),
  crimes: value.crimes.map(crime => [crime.id, crime.type, crime.perpetratorId, crime.status]),
});
assert.equal(signature(normalWorld), signature(historicalFlagWorld), 'режим истории не должен менять законы биологии и хозяйства');

for (const character of world.characters.filter(item => item.alive && item.spouseId && item.id < item.spouseId)) {
  const spouse = world.characters.find(item => item.id === character.spouseId);
  if (!spouse) continue;
  assert.ok(!character.parentIds.includes(spouse.id) && !spouse.parentIds.includes(character.id), 'родитель и ребёнок не могут образовать пару');
  assert.ok(!character.parentIds.some(id => spouse.parentIds.includes(id)), 'родные братья и сёстры не могут образовать пару');
}

assert.deepEqual(worldLawIntegrityIssues(world), [], 'единый закон мира должен сохранять свои инварианты');
console.log(`OK WORLD LAW: ${world.characters.length} жителей, ${world.items.length} предметов, ${world.resourceDeposits.length} естественных месторождений, ${world.travelingMerchants.length} торговцев.`);
