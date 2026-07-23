import type { Civilization, CivilizationEraDefinition, TechnologyDefinition } from '../civilizationTypes';
import { CIVILIZATION_CONTENT } from '../content/coreContent';
import { stableRecipeKey } from '../content/coreRecipes';
import type { EstablishmentType, Kingdom, ProductionRecipe, Settlement, WorldState } from '../types';
import { appendCausalEvent } from './causality';
import { initializeCultureSystem } from './cultureSystem';
import { registerWorldEventKnowledge } from './knowledgeSystem';
import { RNG } from './rng';
import {
  advanceTechnologyKnowledge, availableRecipesForSettlement as localAvailableRecipesForSettlement,
  establishLocalTechnology, initializeTechnologyKnowledge, recipeAvailableToSettlement as localRecipeAvailableToSettlement,
  selectDiscoverySettlement, synchronizeTechnologyRecipes, technologyKnowledgeIntegrityIssues,
} from './technologyKnowledge';

const BASELINE_TECHNOLOGIES = ['controlled-fire', 'oral-tradition'] as const;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function civilizationKingdoms(world: WorldState, civilizationId: number): Kingdom[] {
  return world.kingdoms.filter(kingdom => kingdom.civilizationId === civilizationId);
}

function civilizationSettlements(world: WorldState, civilizationId: number): Settlement[] {
  return world.settlements.filter(settlement => settlement.civilizationId === civilizationId);
}

function cultureKey(world: WorldState, kingdom: Kingdom): string {
  if (kingdom.cultureId) return `culture:${kingdom.cultureId}`;
  const culture = world.cultures.find(item => item.name === kingdom.culture);
  return culture ? `culture:${culture.id}` : `name:${kingdom.species}:${kingdom.culture.trim().toLocaleLowerCase('ru-RU')}`;
}

function civilizationKey(world: WorldState, civilization: Civilization): string {
  if (civilization.originCultureId) return `culture:${civilization.originCultureId}`;
  return `name:${civilization.species}:${civilization.name.replace(/^Цивилизация\s+/iu, '').trim().toLocaleLowerCase('ru-RU')}`;
}

function cultureName(world: WorldState, kingdom: Kingdom): string {
  return world.cultures.find(item => item.id === kingdom.cultureId)?.name ?? kingdom.culture;
}

function civilizationName(world: WorldState, kingdom: Kingdom): string {
  return `Цивилизация ${cultureName(world, kingdom)}`;
}

function createCivilization(world: WorldState, kingdom: Kingdom): Civilization {
  const capital = world.settlements.find(item => item.id === kingdom.capitalId)
    ?? world.settlements.filter(item => item.kingdomId === kingdom.id).sort((a, b) => b.population - a.population)[0]
    ?? world.settlements[0]!;
  const civilization: Civilization = {
    id: world.nextIds.civilization++,
    name: civilizationName(world, kingdom),
    species: kingdom.species,
    originCultureId: kingdom.cultureId,
    capitalSettlementId: capital.id,
    foundedYear: Math.max(1, Math.min(kingdom.foundedYear, capital.foundedYear)),
    eraId: 'survival',
    unlockedTechnologyIds: [...BASELINE_TECHNOLOGIES],
    technologyProgress: {},
    knownResourceIds: [],
    knownRecipeKeys: [],
    metrics: { population: 0, urbanization: 0, literacy: 0, prosperity: 0, innovation: 0 },
    status: 'active',
    lastAdvancedYear: world.year,
    history: [`Сформировалась вокруг культуры «${cultureName(world, kingdom)}» и государства ${kingdom.name}.`],
  };
  world.civilizations.push(civilization);
  return civilization;
}

function synchronizeMembership(world: WorldState): void {
  const civilizationById = new Map(world.civilizations.map(item => [item.id, item]));
  const civilizationByCulture = new Map(world.civilizations.map(item => [civilizationKey(world, item), item]));

  for (const kingdom of world.kingdoms) {
    let civilization = kingdom.civilizationId ? civilizationById.get(kingdom.civilizationId) : undefined;
    if (!civilization) civilization = civilizationByCulture.get(cultureKey(world, kingdom));
    if (!civilization) {
      civilization = createCivilization(world, kingdom);
      civilizationById.set(civilization.id, civilization);
      civilizationByCulture.set(cultureKey(world, kingdom), civilization);
    }
    kingdom.civilizationId = civilization.id;
  }

  for (const settlement of world.settlements) {
    settlement.civilizationId = world.kingdoms.find(item => item.id === settlement.kingdomId)?.civilizationId;
  }

  for (const civilization of world.civilizations) {
    const kingdoms = civilizationKingdoms(world, civilization.id);
    const settlements = civilizationSettlements(world, civilization.id);
    civilization.status = kingdoms.length ? (kingdoms.length > 1 ? 'fragmented' : 'active') : 'extinct';
    if (!settlements.length) continue;
    const capital = [...settlements].sort((a, b) => Number(b.id === world.kingdoms.find(k => k.id === b.kingdomId)?.capitalId) - Number(a.id === world.kingdoms.find(k => k.id === a.kingdomId)?.capitalId) || b.population - a.population || b.prosperity - a.prosperity)[0]!;
    civilization.capitalSettlementId = capital.id;
  }
}

function settlementLiteracy(world: WorldState, settlement: Settlement): number {
  return world.settlementCultures.find(item => item.settlementId === settlement.id)?.literacy
    ?? clamp(world.characters.filter(item => item.alive && item.settlementId === settlement.id && (item.cultureProfile?.literacy ?? 0) >= 50).length / Math.max(1, settlement.population) * 100);
}

function calculateMetrics(world: WorldState, civilization: Civilization): Civilization['metrics'] {
  const settlements = civilizationSettlements(world, civilization.id);
  const population = settlements.reduce((sum, settlement) => sum + Math.max(0, settlement.population), 0);
  if (!settlements.length) return { population: 0, urbanization: 0, literacy: 0, prosperity: 0, innovation: 0 };
  const weighted = Math.max(1, population);
  const literacy = settlements.reduce((sum, settlement) => sum + settlementLiteracy(world, settlement) * Math.max(1, settlement.population), 0) / weighted;
  const prosperity = settlements.reduce((sum, settlement) => sum + settlement.prosperity * Math.max(1, settlement.population), 0) / weighted;
  const urbanScore = settlements.reduce((sum, settlement) => {
    const typeScore = settlement.type === 'city' ? 60 : settlement.type === 'port' ? 55 : settlement.type === 'town' ? 40 : settlement.type === 'fortress' ? 35 : settlement.type === 'village' ? 18 : 8;
    return sum + typeScore + Math.min(20, settlement.districts.length * 4) + Math.min(20, settlement.establishmentIds.length / 4);
  }, 0) / settlements.length;
  const settlementIds = new Set(settlements.map(item => item.id));
  const books = world.books.filter(book => settlementIds.has(book.settlementId)).length;
  const schools = world.buildings.filter(building => settlementIds.has(building.settlementId) && ['school', 'monastery', 'temple', 'guildhall'].includes(building.type)).reduce((sum, building) => sum + Math.max(1, building.capacity), 0);
  const scribes = world.characters.filter(character => character.alive && settlementIds.has(character.settlementId) && ['scribe', 'priest', 'healer'].includes(character.profession)).length;
  const trade = world.tradeRoutes.filter(route => route.active && (settlementIds.has(route.fromSettlementId) || settlementIds.has(route.toSettlementId))).length;
  const innovation = Math.max(2, Math.sqrt(Math.max(1, population)) * .48 + literacy * .28 + prosperity * .08 + Math.sqrt(schools) * .65 + Math.sqrt(books) * 1.8 + Math.sqrt(scribes) * 1.2 + trade * .7);
  return {
    population,
    urbanization: clamp(urbanScore),
    literacy: clamp(literacy),
    prosperity: clamp(prosperity),
    innovation: Math.round(innovation * 10) / 10,
  };
}

function discoverResources(world: WorldState, civilization: Civilization): string[] {
  const settlementIds = new Set(civilizationSettlements(world, civilization.id).map(item => item.id));
  const known = new Set(civilization.knownResourceIds);
  for (const item of world.items) if (settlementIds.has(item.settlementId) && CIVILIZATION_CONTENT.resourceById.has(item.templateId)) known.add(item.templateId);
  for (const settlement of civilizationSettlements(world, civilization.id)) {
    for (const [stockName, amount] of Object.entries(settlement.stockpile)) {
      if (amount <= 0) continue;
      const resource = CIVILIZATION_CONTENT.resources.find(item => item.id === stockName || item.name === stockName || item.material === stockName);
      if (resource) known.add(resource.id);
    }
  }
  return [...known].filter(id => CIVILIZATION_CONTENT.resourceById.has(id)).sort();
}

function evidenceTechnologies(world: WorldState, civilization: Civilization): Set<string> {
  const settlements = civilizationSettlements(world, civilization.id);
  const settlementIds = new Set(settlements.map(item => item.id));
  const establishments = world.establishments.filter(item => settlementIds.has(item.settlementId));
  const establishmentTypes = new Set(establishments.map(item => item.type));
  const buildingTypes = new Set(world.buildings.filter(item => settlementIds.has(item.settlementId)).map(item => item.type));
  const itemIds = new Set(world.items.filter(item => settlementIds.has(item.settlementId) && item.quantity > 0).map(item => item.templateId));
  const fields = world.fields.some(field => settlementIds.has(field.settlementId));
  const livestock = settlements.some(settlement => Object.values(settlement.livestock).some(value => value > 0));
  const books = world.books.some(book => settlementIds.has(book.settlementId));
  const result = new Set<string>(BASELINE_TECHNOLOGIES);
  if (fields || buildingTypes.has('farm') || establishments.some(item => item.type === 'ферма')) result.add('settled-agriculture');
  if (livestock || ['milk', 'eggs', 'wool', 'raw_hide'].some(id => itemIds.has(id))) result.add('animal-husbandry');
  if (['smoked_meat', 'salted_fish', 'military_rations'].some(id => itemIds.has(id)) || establishmentTypes.has('рыбный промысел')) result.add('food-preservation');
  if (buildingTypes.has('carpenter') || establishmentTypes.has('плотницкая мастерская') || ['timber', 'planks', 'furniture'].some(id => itemIds.has(id))) result.add('carpentry');
  if (['ткацкая мастерская', 'портная мастерская', 'красильня', 'кожевенная мастерская', 'сапожная мастерская'].some(type => establishmentTypes.has(type as EstablishmentType))) result.add('textile-craft');
  if (buildingTypes.has('brewery') || buildingTypes.has('winery') || ['ale', 'wine'].some(id => itemIds.has(id))) result.add('fermentation');
  if (buildingTypes.has('quarry') || buildingTypes.has('kiln') || ['bricks', 'lime'].some(id => itemIds.has(id))) result.add('masonry');
  if (buildingTypes.has('mine') || buildingTypes.has('blacksmith') || ['iron_ore', 'iron', 'nails'].some(id => itemIds.has(id))) result.add('metalworking');
  if (buildingTypes.has('toolmaker') || establishmentTypes.has('инструментальная мастерская') || ['tools', 'pickaxe', 'smith_hammer'].some(id => itemIds.has(id))) result.add('specialized-tools');
  if (books || civilization.metrics.literacy >= 8 || establishmentTypes.has('школа')) result.add('written-records');
  if (buildingTypes.has('mill') || establishmentTypes.has('мельница')) result.add('mechanical-milling');
  if (buildingTypes.has('townHall') || buildingTypes.has('courthouse') || settlements.some(item => item.districts.length >= 3)) result.add('civic-planning');
  if (buildingTypes.has('guildhall') || establishmentTypes.has('гильдейский дом')) result.add('guild-organization');
  if (buildingTypes.has('healer') && (books || civilization.metrics.literacy >= 18)) result.add('formal-medicine');
  if (buildingTypes.has('armorer') || buildingTypes.has('arsenal') || establishmentTypes.has('бронная мастерская')) result.add('advanced-armoring');
  if (world.config.magic >= .55 && world.alchemyRecipes.length >= 3 && books && civilization.metrics.literacy >= 30) result.add('arcane-method');
  return result;
}

function addWithPrerequisites(target: Set<string>, technologyId: string): void {
  const technology = CIVILIZATION_CONTENT.technologyById.get(technologyId);
  if (!technology) return;
  for (const prerequisite of technology.prerequisites) addWithPrerequisites(target, prerequisite);
  target.add(technology.id);
}

function eraForCivilization(civilization: Civilization): CivilizationEraDefinition {
  const unlocked = new Set(civilization.unlockedTechnologyIds);
  const eligible = CIVILIZATION_CONTENT.eras.filter(era => era.entryTechnologyIds.every(id => unlocked.has(id))
    && civilization.metrics.population >= era.minimumPopulation
    && civilization.metrics.urbanization >= era.minimumUrbanization
    && civilization.metrics.literacy >= era.minimumLiteracy);
  return eligible.at(-1) ?? CIVILIZATION_CONTENT.eras[0]!;
}

function requirementMet(world: WorldState, civilization: Civilization, technology: TechnologyDefinition): boolean {
  const requirements = technology.requirements;
  if (!requirements) return true;
  if (civilization.metrics.population < (requirements.minimumPopulation ?? 0)) return false;
  if (civilization.metrics.urbanization < (requirements.minimumUrbanization ?? 0)) return false;
  if (civilization.metrics.literacy < (requirements.minimumLiteracy ?? 0)) return false;
  if (civilization.metrics.prosperity < (requirements.minimumProsperity ?? 0)) return false;
  if (world.config.magic < (requirements.minimumMagic ?? 0)) return false;
  const knownResources = new Set(civilization.knownResourceIds);
  if ((requirements.requiredResourceIds ?? []).some(id => !knownResources.has(id))) return false;
  if (requirements.requiredEstablishmentTypes?.length) {
    const settlementIds = new Set(civilizationSettlements(world, civilization.id).map(item => item.id));
    const localTypes = new Set(world.establishments.filter(item => settlementIds.has(item.settlementId)).map(item => item.type));
    if (requirements.requiredEstablishmentTypes.some(type => !localTypes.has(type))) return false;
  }
  return true;
}

function knownRecipeKeys(civilization: Civilization): string[] {
  const unlocked = new Set(civilization.unlockedTechnologyIds);
  return CIVILIZATION_CONTENT.recipes
    .filter(recipe => !recipe.requiredTechnologyId || unlocked.has(recipe.requiredTechnologyId))
    .map(recipe => recipe.key)
    .sort();
}

function normalizeCivilization(world: WorldState, civilization: Civilization): void {
  civilization.unlockedTechnologyIds ??= [...BASELINE_TECHNOLOGIES];
  civilization.technologyProgress ??= {};
  civilization.knownResourceIds ??= [];
  civilization.knownRecipeKeys ??= [];
  civilization.metrics ??= { population: 0, urbanization: 0, literacy: 0, prosperity: 0, innovation: 0 };
  civilization.status ??= 'active';
  civilization.lastAdvancedYear ??= world.year;
  civilization.history ??= [];
  civilization.eraId ??= 'survival';
  const validTechnologyIds = new Set(CIVILIZATION_CONTENT.technologies.map(item => item.id));
  civilization.unlockedTechnologyIds = [...new Set(civilization.unlockedTechnologyIds.filter(id => validTechnologyIds.has(id)))];
  for (const baseline of BASELINE_TECHNOLOGIES) if (!civilization.unlockedTechnologyIds.includes(baseline)) civilization.unlockedTechnologyIds.push(baseline);
}

export function productionRecipeKey(recipe: Pick<ProductionRecipe, 'key' | 'name'>): string {
  return recipe.key || stableRecipeKey(recipe.name);
}

export function civilizationForSettlement(world: WorldState, settlementId: number): Civilization | undefined {
  const settlement = world.settlements.find(item => item.id === settlementId);
  return settlement?.civilizationId ? world.civilizations.find(item => item.id === settlement.civilizationId) : undefined;
}

export const recipeAvailableToSettlement = localRecipeAvailableToSettlement;

export const availableRecipesForSettlement = localAvailableRecipesForSettlement;

export function synchronizeCivilizationRecipes(world: WorldState): void {
  synchronizeTechnologyRecipes(world);
}

export function initializeCivilizationSystem(world: WorldState, rng = new RNG(`${world.config.seed}:civilizations-v1`)): void {
  world.civilizations ??= [];
  world.nextIds ??= {};
  world.nextIds.civilization ??= Math.max(0, ...world.civilizations.map(item => item.id)) + 1;
  if (!world.cultures.length) initializeCultureSystem(world, rng);
  for (const civilization of world.civilizations) normalizeCivilization(world, civilization);
  synchronizeMembership(world);
  for (const civilization of world.civilizations) {
    civilization.metrics = calculateMetrics(world, civilization);
    civilization.knownResourceIds = discoverResources(world, civilization);
    const seeded = new Set(civilization.unlockedTechnologyIds);
    for (const technologyId of evidenceTechnologies(world, civilization)) addWithPrerequisites(seeded, technologyId);
    civilization.unlockedTechnologyIds = [...seeded].filter(id => CIVILIZATION_CONTENT.technologyById.has(id));
    civilization.knownRecipeKeys = knownRecipeKeys(civilization);
    civilization.eraId = eraForCivilization(civilization).id;
    civilization.lastAdvancedYear = Math.max(civilization.lastAdvancedYear ?? world.year, world.year);
  }
  world.simulation.civilizationSystemVersion = 1;
  initializeTechnologyKnowledge(world, new RNG(`${world.config.seed}:локальные-носители-знаний-v1`));
  synchronizeCivilizationRecipes(world);
}

function candidateTechnologies(world: WorldState, civilization: Civilization): TechnologyDefinition[] {
  const unlocked = new Set(civilization.unlockedTechnologyIds);
  const currentEra = CIVILIZATION_CONTENT.eraById.get(civilization.eraId) ?? CIVILIZATION_CONTENT.eras[0]!;
  return CIVILIZATION_CONTENT.technologies
    .filter(technology => !unlocked.has(technology.id))
    .filter(technology => technology.prerequisites.every(id => unlocked.has(id)))
    .filter(technology => requirementMet(world, civilization, technology))
    .sort((a, b) => {
      const eraA = CIVILIZATION_CONTENT.eraById.get(a.eraId)?.order ?? 0;
      const eraB = CIVILIZATION_CONTENT.eraById.get(b.eraId)?.order ?? 0;
      const frontierA = eraA <= currentEra.order + 1 ? 0 : 1;
      const frontierB = eraB <= currentEra.order + 1 ? 0 : 1;
      const progressA = civilization.technologyProgress[a.id] ?? 0;
      const progressB = civilization.technologyProgress[b.id] ?? 0;
      return frontierA - frontierB || eraA - eraB || progressB / Math.max(1, b.cost) - progressA / Math.max(1, a.cost) || a.id.localeCompare(b.id);
    });
}

function recordTechnologyDiscovery(world: WorldState, civilization: Civilization, technology: TechnologyDefinition): void {
  const unlockedRecipes = CIVILIZATION_CONTENT.recipes.filter(recipe => recipe.requiredTechnologyId === technology.id).map(recipe => recipe.name);
  const unlockedResources = CIVILIZATION_CONTENT.resources.filter(resource => resource.requiredTechnologyId === technology.id).map(resource => resource.name);
  const discoverySettlement = selectDiscoverySettlement(world, civilization.id, technology);
  if (discoverySettlement) establishLocalTechnology(world, discoverySettlement.id, technology.id, 'discovery', {
    mastery: 74,
    reason: `В ${world.year} году местные мастера закрепили открытие «${technology.name}».`,
  });
  const capital = discoverySettlement ?? world.settlements.find(item => item.id === civilization.capitalSettlementId);
  const kingdom = capital ? world.kingdoms.find(item => item.id === capital.kingdomId) : civilizationKingdoms(world, civilization.id)[0];
  civilization.history.push(`В ${world.year} году освоена технология «${technology.name}».`);
  const event = appendCausalEvent(world, {
    kind: 'knowledge',
    title: `${civilization.name} освоила технологию «${technology.name}»`,
    description: technology.description,
    cause: 'накопленные знания, ремесленная практика, доступные ресурсы и работа местных институтов',
    conditions: [
      `население: ${civilization.metrics.population}`,
      `урбанизация: ${Math.round(civilization.metrics.urbanization)}%`,
      `грамотность: ${Math.round(civilization.metrics.literacy)}%`,
    ],
    decision: 'мастера, учёные и власти закрепили новый воспроизводимый способ работы',
    outcome: `открыты новые возможности: ${[...(technology.unlocks.capabilities ?? []), ...unlockedResources, ...unlockedRecipes].join(', ') || 'новая ступень знаний'}`,
    consequences: ['цивилизация получила постоянную технологию', 'доступные рецепты и учреждения были пересчитаны'],
    entityRefs: [
      ...(capital ? [{ kind: 'settlement' as const, id: capital.id }] : []),
      ...(kingdom ? [{ kind: 'kingdom' as const, id: kingdom.id }] : []),
      ...(civilization.originCultureId ? [{ kind: 'culture' as const, id: civilization.originCultureId }] : []),
    ],
    importance: 3,
  });
  registerWorldEventKnowledge(world, event);
}

function advanceCivilization(world: WorldState, civilization: Civilization, elapsedYears: number): void {
  civilization.metrics = calculateMetrics(world, civilization);
  civilization.knownResourceIds = discoverResources(world, civilization);
  let innovation = civilization.metrics.innovation * Math.max(1, elapsedYears);
  let safety = 0;
  while (innovation > .01 && safety++ < 8) {
    const candidate = candidateTechnologies(world, civilization)[0];
    if (!candidate) break;
    const current = civilization.technologyProgress[candidate.id] ?? 0;
    const invested = Math.min(innovation, Math.max(0, candidate.cost - current));
    civilization.technologyProgress[candidate.id] = current + invested;
    innovation -= invested;
    if (civilization.technologyProgress[candidate.id] + .0001 < candidate.cost) break;
    civilization.unlockedTechnologyIds.push(candidate.id);
    civilization.unlockedTechnologyIds = [...new Set(civilization.unlockedTechnologyIds)];
    delete civilization.technologyProgress[candidate.id];
    recordTechnologyDiscovery(world, civilization, candidate);
  }
  civilization.knownRecipeKeys = knownRecipeKeys(civilization);
  const previousEra = civilization.eraId;
  const era = eraForCivilization(civilization);
  civilization.eraId = era.id;
  if (previousEra !== era.id) civilization.history.push(`В ${world.year} году началась «${era.name}».`);
  civilization.lastAdvancedYear = world.year;
}

export function advanceCivilizationSystem(world: WorldState): void {
  if (world.simulation.civilizationSystemVersion !== 1) initializeCivilizationSystem(world);
  synchronizeMembership(world);
  for (const civilization of world.civilizations) {
    normalizeCivilization(world, civilization);
    if (civilization.status === 'extinct') continue;
    const elapsedYears = Math.max(0, world.year - civilization.lastAdvancedYear);
    if (elapsedYears <= 0) {
      civilization.metrics = calculateMetrics(world, civilization);
      civilization.knownResourceIds = discoverResources(world, civilization);
      continue;
    }
    advanceCivilization(world, civilization, elapsedYears);
  }
  advanceTechnologyKnowledge(world);
  synchronizeCivilizationRecipes(world);
}

export function civilizationIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const civilizationIds = new Set(world.civilizations.map(item => item.id));
  const technologyIds = new Set(CIVILIZATION_CONTENT.technologies.map(item => item.id));
  const eraIds = new Set(CIVILIZATION_CONTENT.eras.map(item => item.id));
  for (const kingdom of world.kingdoms) if (!kingdom.civilizationId || !civilizationIds.has(kingdom.civilizationId)) issues.push(`${kingdom.name}: государство не связано с цивилизацией.`);
  for (const settlement of world.settlements) {
    const kingdom = world.kingdoms.find(item => item.id === settlement.kingdomId);
    if (settlement.civilizationId !== kingdom?.civilizationId) issues.push(`${settlement.name}: цивилизация поселения не совпадает с государством.`);
  }
  for (const civilization of world.civilizations) {
    if (!eraIds.has(civilization.eraId)) issues.push(`${civilization.name}: неизвестная эпоха «${civilization.eraId}».`);
    for (const technologyId of civilization.unlockedTechnologyIds) if (!technologyIds.has(technologyId)) issues.push(`${civilization.name}: неизвестная технология «${technologyId}».`);
    const unlocked = new Set(civilization.unlockedTechnologyIds);
    for (const technologyId of unlocked) {
      const technology = CIVILIZATION_CONTENT.technologyById.get(technologyId);
      for (const prerequisite of technology?.prerequisites ?? []) if (!unlocked.has(prerequisite)) issues.push(`${civilization.name}: технология «${technologyId}» освоена без «${prerequisite}».`);
    }
    if (!world.settlements.some(item => item.id === civilization.capitalSettlementId)) issues.push(`${civilization.name}: отсутствует культурная столица ${civilization.capitalSettlementId}.`);
  }
  for (const recipe of world.productionRecipes) {
    if (!recipe.key) issues.push(`${recipe.name}: производственный рецепт не имеет стабильного ключа.`);
    if (recipe.requiredTechnologyId && !technologyIds.has(recipe.requiredTechnologyId)) issues.push(`${recipe.name}: рецепт требует неизвестную технологию «${recipe.requiredTechnologyId}».`);
  }
  for (const establishment of world.establishments) {
    for (const recipeId of establishment.recipeIds) {
      const recipe = world.productionRecipes.find(item => item.id === recipeId);
      if (recipe && !recipeAvailableToSettlement(world, establishment.settlementId, recipe)) issues.push(`${establishment.name}: использует недоступный рецепт «${recipe.name}».`);
    }
  }
  issues.push(...technologyKnowledgeIntegrityIssues(world));
  return [...new Set(issues)];
}
