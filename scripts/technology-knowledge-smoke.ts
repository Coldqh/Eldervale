import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import {
  advanceTechnologyKnowledge, initializeTechnologyKnowledge, recipeAvailableToSettlement,
  reconcileTechnologyKnowledge, settlementTechnologyState, technologyKnowledgeIntegrityIssues,
} from '../src/sim/technologyKnowledge';

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'eldervale-local-technology-knowledge-smoke',
  width: 18,
  height: 12,
  historyYears: 55,
  kingdomCount: 3,
  settlementCount: 8,
  populationScale: .16,
  monsterDensity: .06,
  artifactDensity: .06,
  ecologyDensity: .1,
});

assert.equal(world.version, 34, 'новый мир должен использовать схему 34');
initializeTechnologyKnowledge(world);
assert.ok(world.settlementTechnologyKnowledge.length > world.settlements.length, 'поселения должны иметь отдельные технологические состояния');
assert.deepEqual(technologyKnowledgeIntegrityIssues(world), [], 'исходный мир должен иметь целостные локальные знания');

const sourceState = world.settlementTechnologyKnowledge.find(state => state.active && state.practitionerIds.length > 0
  && !['controlled-fire', 'oral-tradition'].includes(state.technologyId)
  && world.productionRecipes.some(recipe => recipe.requiredTechnologyId === state.technologyId));
assert.ok(sourceState, 'для проверки нужна практическая технология с производственным рецептом');
const technologyId = sourceState!.technologyId;
const recipe = world.productionRecipes.find(item => item.requiredTechnologyId === technologyId)!;
const source = world.settlements.find(item => item.id === sourceState!.settlementId)!;
let target = world.settlements.find(item => item.id !== source.id && item.civilizationId === source.civilizationId);
if (!target) {
  target = world.settlements.find(item => item.id !== source.id)!;
  target.civilizationId = source.civilizationId;
  const targetKingdom = world.kingdoms.find(item => item.id === target!.kingdomId);
  if (targetKingdom) targetKingdom.civilizationId = source.civilizationId;
}

for (const character of world.characters.filter(item => item.settlementId === target!.id)) character.technologyIds = (character.technologyIds ?? []).filter(id => id !== technologyId);
for (const book of world.books.filter(item => item.settlementId === target!.id)) book.technologyIds = (book.technologyIds ?? []).filter(id => id !== technologyId);
world.settlementTechnologyKnowledge = world.settlementTechnologyKnowledge.filter(item => !(item.settlementId === target!.id && item.technologyId === technologyId));
reconcileTechnologyKnowledge(world);
assert.equal(recipeAvailableToSettlement(world, target.id, recipe), false, 'чужой город не должен получать рецепт через общую цивилизацию');

const master = world.characters.find(item => item.id === sourceState!.practitionerIds[0])!;
for (const character of world.characters.filter(item => item.settlementId === source.id && item.id !== master.id)) character.technologyIds = (character.technologyIds ?? []).filter(id => id !== technologyId);
master.expeditionId = 999_999;
reconcileTechnologyKnowledge(world);
assert.equal(recipeAvailableToSettlement(world, source.id, recipe), false, 'ушедший в экспедицию мастер не должен продолжать производство в старом городе');
master.expeditionId = undefined;
reconcileTechnologyKnowledge(world);
assert.equal(recipeAvailableToSettlement(world, source.id, recipe), true, 'вернувшийся мастер должен восстановить местную практику');
master.settlementId = target.id;
master.kingdomId = target.kingdomId;
reconcileTechnologyKnowledge(world);
assert.equal(recipeAvailableToSettlement(world, target.id, recipe), true, 'переселившийся мастер должен открыть рецепт в новом городе');
assert.ok(world.technologyTransmissions.some(item => item.mode === 'migration' && item.technologyId === technologyId && item.toSettlementId === target!.id), 'перенос знания должен быть записан как причинная передача');

master.alive = false;
reconcileTechnologyKnowledge(world);
assert.equal(recipeAvailableToSettlement(world, target.id, recipe), false, 'смерть последнего мастера без книги и ученика должна уничтожить практику');
assert.equal(settlementTechnologyState(world, target.id, technologyId)?.level, 'lost', 'утраченное знание должно сохраняться в истории поселения');

master.alive = true;
master.technologyIds = [...new Set([...(master.technologyIds ?? []), technologyId])];
const apprentice = world.characters.find(item => item.alive && item.settlementId === target!.id && item.id !== master.id && item.age >= 14)!;
assert.ok(apprentice, 'в городе должен найтись ученик');
apprentice.technologyIds = (apprentice.technologyIds ?? []).filter(id => id !== technologyId);
apprentice.technologyLearning = { ...(apprentice.technologyLearning ?? {}), [technologyId]: 90 };
world.employments.push({
  id: world.nextIds.employment++, characterId: apprentice.id,
  establishmentId: master.employerEstablishmentId ?? world.establishments.find(item => item.settlementId === target!.id)?.id ?? world.establishments[0]!.id,
  role: 'ученик', wage: 1, hoursPerWeek: 42, sinceYear: world.year - 2, apprenticeOfCharacterId: master.id, active: true,
});
reconcileTechnologyKnowledge(world);
world.year += 1;
advanceTechnologyKnowledge(world);
assert.ok(apprentice.technologyIds?.includes(technologyId), 'ученичество должно передавать практическую технологию конкретному человеку');
master.alive = false;
reconcileTechnologyKnowledge(world);
assert.equal(recipeAvailableToSettlement(world, target.id, recipe), true, 'обученный ученик должен сохранить производство после смерти мастера');

apprentice.alive = false;
for (const book of world.books.filter(item => item.settlementId === target!.id)) book.technologyIds = (book.technologyIds ?? []).filter(id => id !== technologyId);
reconcileTechnologyKnowledge(world);
assert.equal(recipeAvailableToSettlement(world, target.id, recipe), false, 'после исчезновения всех носителей практика должна снова потеряться');

console.log(`OK LOCAL KNOWLEDGE: ${technologyId}, ${source.name} → ${target.name}, передач ${world.technologyTransmissions.length}.`);
