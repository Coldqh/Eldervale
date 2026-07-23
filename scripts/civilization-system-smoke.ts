import assert from 'node:assert/strict';
import type { CivilizationContentPack } from '../src/civilizationTypes';
import { buildContentCatalog, validateContentPacks } from '../src/content/catalog';
import { CORE_CONTENT_PACK, CIVILIZATION_CONTENT } from '../src/content/coreContent';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import {
  advanceCivilizationSystem, civilizationIntegrityIssues, recipeAvailableToSettlement, synchronizeCivilizationRecipes,
} from '../src/sim/civilizationSystem';

assert.deepEqual(validateContentPacks([CORE_CONTENT_PACK]), [], 'базовый пакет цивилизационного контента должен быть целостным');

const extensionPack: CivilizationContentPack = {
  id: 'smoke-extension',
  version: 1,
  eras: [{
    id: 'smoke-era', name: 'Проверочная эпоха', order: 99,
    description: 'Проверяет подключение новой эпохи без изменения симуляции.',
    entryTechnologyIds: ['smoke-technology'], minimumPopulation: 0, minimumUrbanization: 0, minimumLiteracy: 0,
  }],
  technologies: [{
    id: 'smoke-technology', name: 'Проверочная технология', eraId: 'smoke-era', category: 'ремесло',
    prerequisites: ['controlled-fire'], cost: 1,
    unlocks: { capabilities: ['smoke-capability'] },
    description: 'Проверяет расширение дерева технологий отдельным пакетом данных.',
  }],
  resources: [{
    id: 'smoke-resource', name: 'Проверочный ресурс', category: 'еда', material: 'проверочный материал',
    unit: 'шт.', weight: 1, perishability: 0, value: 1, requiredTechnologyId: 'smoke-technology',
  }],
  recipes: [{
    key: 'smoke-recipe', name: 'Проверочный рецепт', category: 'готовка', profession: 'cook',
    establishmentTypes: ['пекарня'], inputs: [{ templateId: 'grain', quantity: 1 }],
    outputs: [{ templateId: 'smoke-resource', quantity: 1 }], laborHours: 1, minimumSkill: 0,
    requiredTechnologyId: 'smoke-technology', description: 'Проверяет добавление рецепта через контент-пакет.',
  }],
};
const extendedCatalog = buildContentCatalog([CORE_CONTENT_PACK, extensionPack]);
assert.ok(extendedCatalog.eraById.has('smoke-era'), 'новая эпоха должна подключаться через пакет данных');
assert.ok(extendedCatalog.technologyById.has('smoke-technology'), 'новая технология должна подключаться через пакет данных');
assert.ok(extendedCatalog.resourceById.has('smoke-resource'), 'новый ресурс должен подключаться через пакет данных');
assert.ok(extendedCatalog.recipeByKey.has('smoke-recipe'), 'новый рецепт должен подключаться через пакет данных');

const cyclicPack: CivilizationContentPack = {
  id: 'broken-cycle', version: 1, eras: [], resources: [], recipes: [], technologies: [
    { id: 'cycle-a', name: 'A', eraId: 'survival', category: 'знания', prerequisites: ['cycle-b'], cost: 1, unlocks: {}, description: 'A' },
    { id: 'cycle-b', name: 'B', eraId: 'survival', category: 'знания', prerequisites: ['cycle-a'], cost: 1, unlocks: {}, description: 'B' },
  ],
};
assert.ok(validateContentPacks([CORE_CONTENT_PACK, cyclicPack]).some(error => error.includes('цикл')), 'каталог обязан отклонять циклическое дерево технологий');

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'eldervale-civilization-system-smoke',
  width: 18,
  height: 12,
  historyYears: 45,
  kingdomCount: 4,
  settlementCount: 8,
  populationScale: .14,
  monsterDensity: .08,
  artifactDensity: .08,
  ecologyDensity: .12,
});

assert.equal(world.version, 32, 'новый мир должен использовать схему 32');
assert.ok(world.civilizations.length > 0, 'историческая генерация должна сформировать цивилизации');
assert.ok(world.civilizations.length <= world.kingdoms.length, 'одна цивилизация может объединять несколько государств общей культуры');
assert.ok(world.kingdoms.every(kingdom => world.civilizations.some(civilization => civilization.id === kingdom.civilizationId)), 'каждое государство должно быть связано с цивилизацией');
assert.ok(world.settlements.every(settlement => {
  const kingdom = world.kingdoms.find(item => item.id === settlement.kingdomId);
  return settlement.civilizationId === kingdom?.civilizationId;
}), 'поселение должно наследовать цивилизацию государства');

for (const civilization of world.civilizations) {
  assert.ok(CIVILIZATION_CONTENT.eraById.has(civilization.eraId), 'эпоха цивилизации должна существовать в каталоге');
  const unlocked = new Set(civilization.unlockedTechnologyIds);
  for (const technologyId of unlocked) {
    const technology = CIVILIZATION_CONTENT.technologyById.get(technologyId)!;
    assert.ok(technology.prerequisites.every(prerequisite => unlocked.has(prerequisite)), `технология ${technologyId} не может существовать без предпосылок`);
  }
}

assert.equal(new Set(world.productionRecipes.map(recipe => recipe.key)).size, world.productionRecipes.length, 'производственные рецепты должны иметь уникальные стабильные ключи');
assert.deepEqual(civilizationIntegrityIssues(world), [], 'сгенерированный мир должен пройти цивилизационную проверку целостности');

const progressBefore = world.civilizations.reduce((sum, item) => sum + Object.values(item.technologyProgress).reduce((subtotal, value) => subtotal + value, 0), 0);
world.year += 1;
advanceCivilizationSystem(world);
const progressAfter = world.civilizations.reduce((sum, item) => sum + Object.values(item.technologyProgress).reduce((subtotal, value) => subtotal + value, 0), 0);
assert.ok(progressAfter > progressBefore || world.civilizations.some(item => item.unlockedTechnologyIds.length > 14), 'годовой ход должен вкладывать реальные инновации в доступные технологии');
assert.ok(world.civilizations.filter(item => item.status !== 'extinct').every(item => item.lastAdvancedYear === world.year), 'активные цивилизации должны продвигаться ровно до текущего года');

const gatedRecipe = world.productionRecipes.find(recipe => recipe.requiredTechnologyId
  && world.establishments.some(establishment => establishment.recipeIds.includes(recipe.id) && recipe.establishmentTypes.includes(establishment.type)));
assert.ok(gatedRecipe, 'для проверки нужен технологически ограниченный рецепт, реально используемый заведением');
const establishment = world.establishments.find(item => item.recipeIds.includes(gatedRecipe!.id) && gatedRecipe!.establishmentTypes.includes(item.type))!;
assert.equal(recipeAvailableToSettlement(world, establishment.settlementId, gatedRecipe!), true, 'рецепт должен быть доступен только там, где существует локальная практика');
assert.ok(world.settlementTechnologyKnowledge.some(item => item.settlementId === establishment.settlementId && item.technologyId === gatedRecipe!.requiredTechnologyId && item.active), 'доступный рецепт должен иметь местных живых носителей');
synchronizeCivilizationRecipes(world);
assert.ok(establishment.recipeIds.includes(gatedRecipe!.id), 'локально известный рецепт должен оставаться в подходящем заведении');
assert.deepEqual(civilizationIntegrityIssues(world), [], 'после пересчёта локальных рецептов мир должен оставаться целостным');

console.log(`OK CIVILIZATIONS: ${world.civilizations.length} цивилизаций, ${CIVILIZATION_CONTENT.technologies.length} технологий, ${world.productionRecipes.length} рецептов.`);
