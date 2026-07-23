import type { TechnologyDefinition } from '../civilizationTypes';
import { CIVILIZATION_CONTENT } from '../content/coreContent';
import type { BuildingType, Character, EstablishmentType, ProductionRecipe, Settlement, WorldState } from '../types';
import type {
  SettlementTechnologyKnowledge, TechnologyKnowledgeLevel, TechnologyTransmission, TechnologyTransmissionMode,
} from '../technologyKnowledgeTypes';
import { appendCausalEvent } from './causality';
import { RNG } from './rng';
import { worldTick } from './scheduler';

export const BASELINE_LOCAL_TECHNOLOGIES = ['controlled-fire', 'oral-tradition'] as const;

const PROFESSION_BY_TECHNOLOGY: Record<string, string[]> = {
  'controlled-fire': ['cook', 'baker', 'brewer', 'blacksmith'],
  'oral-tradition': ['priest', 'scribe', 'merchant', 'guard'],
  'settled-agriculture': ['farmer', 'miller'],
  'animal-husbandry': ['farmer', 'herbalist'],
  'food-preservation': ['cook', 'hunter', 'fisher', 'baker'],
  carpentry: ['carpenter', 'toolmaker'],
  'textile-craft': ['weaver', 'tailor', 'dyer', 'tanner', 'cobbler'],
  fermentation: ['brewer', 'cook'],
  masonry: ['miner', 'carpenter', 'toolmaker'],
  metalworking: ['blacksmith', 'armorer', 'toolmaker'],
  'specialized-tools': ['toolmaker', 'blacksmith', 'carpenter'],
  'written-records': ['scribe', 'priest'],
  'mechanical-milling': ['miller', 'carpenter'],
  'civic-planning': ['scribe', 'merchant', 'guard'],
  'guild-organization': ['merchant', 'scribe', 'blacksmith', 'carpenter', 'weaver'],
  'formal-medicine': ['healer', 'herbalist', 'priest'],
  'advanced-armoring': ['armorer', 'blacksmith'],
  'arcane-method': ['healer', 'herbalist', 'priest', 'scribe'],
};

const BUILDINGS_BY_TECHNOLOGY: Record<string, BuildingType[]> = {
  'controlled-fire': ['house', 'tavern', 'bakery', 'blacksmith'],
  'oral-tradition': ['temple', 'townHall', 'tavern'],
  'settled-agriculture': ['farm', 'mill', 'warehouse'],
  'animal-husbandry': ['farm', 'stable'],
  'food-preservation': ['fishery', 'tavern', 'warehouse'],
  carpentry: ['carpenter', 'toolmaker'],
  'textile-craft': ['weaver', 'tailor', 'dyehouse', 'tannery', 'cobbler'],
  fermentation: ['brewery', 'winery', 'tavern'],
  masonry: ['quarry', 'kiln'],
  metalworking: ['mine', 'blacksmith'],
  'specialized-tools': ['toolmaker', 'blacksmith'],
  'written-records': ['school', 'monastery', 'temple', 'townHall'],
  'mechanical-milling': ['mill'],
  'civic-planning': ['townHall', 'courthouse'],
  'guild-organization': ['guildhall'],
  'formal-medicine': ['healer', 'school', 'monastery'],
  'advanced-armoring': ['armorer', 'arsenal'],
  'arcane-method': ['school', 'monastery', 'temple'],
};

const ESTABLISHMENTS_BY_TECHNOLOGY: Partial<Record<string, EstablishmentType[]>> = {
  'settled-agriculture': ['ферма', 'мельница'],
  'animal-husbandry': ['ферма', 'конюшня'],
  'food-preservation': ['рыбный промысел', 'таверна', 'постоялый двор'],
  carpentry: ['плотницкая мастерская'],
  'textile-craft': ['ткацкая мастерская', 'портная мастерская', 'красильня', 'кожевенная мастерская', 'сапожная мастерская'],
  fermentation: ['пивоварня', 'винодельня', 'таверна'],
  masonry: ['каменоломня', 'кирпичная мастерская'],
  metalworking: ['рудник', 'кузница'],
  'specialized-tools': ['инструментальная мастерская', 'кузница'],
  'written-records': ['школа', 'храм', 'городская управа'],
  'mechanical-milling': ['мельница'],
  'civic-planning': ['городская управа', 'суд'],
  'guild-organization': ['гильдейский дом'],
  'formal-medicine': ['лечебница', 'школа'],
  'advanced-armoring': ['бронная мастерская', 'арсенал'],
  'arcane-method': ['школа', 'храм', 'лечебница'],
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function ensureCollections(world: WorldState): void {
  world.settlementTechnologyKnowledge ??= [];
  world.technologyTransmissions ??= [];
  world.nextIds ??= {};
  world.nextIds.settlementTechnologyKnowledge ??= Math.max(0, ...world.settlementTechnologyKnowledge.map(item => item.id)) + 1;
  world.nextIds.technologyTransmission ??= Math.max(0, ...world.technologyTransmissions.map(item => item.id)) + 1;
  for (const character of world.characters) {
    character.technologyIds ??= [];
    character.technologyLearning ??= {};
  }
  for (const book of world.books) book.technologyIds ??= [];
}

function characterTechnologyIds(character: Character): string[] {
  character.technologyIds ??= [];
  return character.technologyIds;
}

function technologyState(world: WorldState, settlementId: number, technologyId: string): SettlementTechnologyKnowledge | undefined {
  return world.settlementTechnologyKnowledge.find(item => item.settlementId === settlementId && item.technologyId === technologyId);
}

function ensureTechnologyState(world: WorldState, settlementId: number, technologyId: string): SettlementTechnologyKnowledge {
  let state = technologyState(world, settlementId, technologyId);
  if (state) return state;
  state = {
    id: world.nextIds.settlementTechnologyKnowledge++, settlementId, technologyId,
    level: 'theoretical', mastery: 0, practitionerIds: [], apprenticeIds: [], institutionBuildingIds: [], bookIds: [],
    lastPracticedYear: world.year, active: false, history: [],
  };
  world.settlementTechnologyKnowledge.push(state);
  return state;
}

function professionsForTechnology(technologyId: string): string[] {
  return PROFESSION_BY_TECHNOLOGY[technologyId] ?? ['scribe', 'merchant'];
}

function localCandidates(world: WorldState, settlementId: number, technologyId: string): Character[] {
  const preferred = new Set(professionsForTechnology(technologyId));
  const residents = world.characters.filter(character => character.alive && character.settlementId === settlementId && character.age >= 14 && !character.expeditionId);
  return residents.sort((a, b) => {
    const preferredA = Number(preferred.has(a.profession));
    const preferredB = Number(preferred.has(b.profession));
    const skillA = Math.max(...Object.values(a.skills ?? {}), 0) + (a.cultureProfile?.literacy ?? 0) * .3;
    const skillB = Math.max(...Object.values(b.skills ?? {}), 0) + (b.cultureProfile?.literacy ?? 0) * .3;
    return preferredB - preferredA || skillB - skillA || b.age - a.age || a.id - b.id;
  });
}

function localInstitutionIds(world: WorldState, settlementId: number, technologyId: string): number[] {
  const allowed = new Set(BUILDINGS_BY_TECHNOLOGY[technologyId] ?? []);
  return world.buildings
    .filter(building => building.settlementId === settlementId && building.condition > 0 && allowed.has(building.type))
    .map(building => building.id);
}

function localBookIds(world: WorldState, settlementId: number, technologyId: string): number[] {
  return world.books.filter(book => book.settlementId === settlementId && (book.technologyIds ?? []).includes(technologyId)).map(book => book.id);
}

function technologyEvidenceAtSettlement(world: WorldState, settlement: Settlement): Set<string> {
  const buildingTypes = new Set(world.buildings.filter(item => item.settlementId === settlement.id && item.condition > 0).map(item => item.type));
  const establishmentTypes = new Set(world.establishments.filter(item => item.settlementId === settlement.id && item.active).map(item => item.type));
  const itemIds = new Set(world.items.filter(item => item.settlementId === settlement.id && item.quantity > 0 && item.condition > 0).map(item => item.templateId));
  const result = new Set<string>(BASELINE_LOCAL_TECHNOLOGIES);
  if (world.fields.some(field => field.settlementId === settlement.id) || buildingTypes.has('farm')) result.add('settled-agriculture');
  if (Object.values(settlement.livestock ?? {}).some(value => value > 0) || ['milk', 'eggs', 'wool', 'raw_hide'].some(id => itemIds.has(id))) result.add('animal-husbandry');
  if (['smoked_meat', 'salted_fish', 'military_rations'].some(id => itemIds.has(id)) || establishmentTypes.has('рыбный промысел')) result.add('food-preservation');
  if (buildingTypes.has('carpenter') || establishmentTypes.has('плотницкая мастерская') || ['timber', 'planks', 'furniture'].some(id => itemIds.has(id))) result.add('carpentry');
  if ((ESTABLISHMENTS_BY_TECHNOLOGY['textile-craft'] ?? []).some(type => establishmentTypes.has(type))) result.add('textile-craft');
  if (buildingTypes.has('brewery') || buildingTypes.has('winery') || ['ale', 'wine'].some(id => itemIds.has(id))) result.add('fermentation');
  if (buildingTypes.has('quarry') || buildingTypes.has('kiln') || ['bricks', 'lime'].some(id => itemIds.has(id))) result.add('masonry');
  if (buildingTypes.has('mine') || buildingTypes.has('blacksmith') || ['iron_ore', 'iron', 'nails'].some(id => itemIds.has(id))) result.add('metalworking');
  if (buildingTypes.has('toolmaker') || establishmentTypes.has('инструментальная мастерская') || ['tools', 'pickaxe', 'smith_hammer'].some(id => itemIds.has(id))) result.add('specialized-tools');
  if (world.books.some(book => book.settlementId === settlement.id) || buildingTypes.has('school') || establishmentTypes.has('школа')) result.add('written-records');
  if (buildingTypes.has('mill') || establishmentTypes.has('мельница')) result.add('mechanical-milling');
  if (buildingTypes.has('townHall') || buildingTypes.has('courthouse') || settlement.districts.length >= 3) result.add('civic-planning');
  if (buildingTypes.has('guildhall') || establishmentTypes.has('гильдейский дом')) result.add('guild-organization');
  if (buildingTypes.has('healer') && (world.books.some(book => book.settlementId === settlement.id) || (world.settlementCultures.find(item => item.settlementId === settlement.id)?.literacy ?? 0) >= 18)) result.add('formal-medicine');
  if (buildingTypes.has('armorer') || buildingTypes.has('arsenal') || establishmentTypes.has('бронная мастерская')) result.add('advanced-armoring');
  if (world.config.magic >= .55 && world.alchemyRecipes.length >= 3 && world.books.some(book => book.settlementId === settlement.id)) result.add('arcane-method');
  return result;
}

function addPrerequisites(target: Set<string>, technologyId: string): void {
  const technology = CIVILIZATION_CONTENT.technologyById.get(technologyId);
  if (!technology) return;
  for (const prerequisite of technology.prerequisites) addPrerequisites(target, prerequisite);
  target.add(technologyId);
}

function recordTransmission(
  world: WorldState,
  technologyId: string,
  toSettlementId: number,
  mode: TechnologyTransmissionMode,
  options: { fromSettlementId?: number; carrierCharacterId?: number; bookId?: number; outcome?: string } = {},
): TechnologyTransmission {
  const existing = world.technologyTransmissions.find(item => item.technologyId === technologyId && item.toSettlementId === toSettlementId
    && item.mode === mode && item.carrierCharacterId === options.carrierCharacterId && item.bookId === options.bookId && item.status === 'completed');
  if (existing) return existing;
  const transmission: TechnologyTransmission = {
    id: world.nextIds.technologyTransmission++, technologyId, fromSettlementId: options.fromSettlementId, toSettlementId,
    carrierCharacterId: options.carrierCharacterId, bookId: options.bookId, mode, startedTick: worldTick(world), completedTick: worldTick(world),
    status: 'completed', outcome: options.outcome, history: [options.outcome ?? `Знание «${technologyId}» закрепилось в поселении.`],
  };
  world.technologyTransmissions.push(transmission);
  return transmission;
}

function grantTechnologyToCharacterInternal(character: Character, technologyId: string): boolean {
  const ids = characterTechnologyIds(character);
  if (ids.includes(technologyId)) return false;
  ids.push(technologyId);
  ids.sort();
  return true;
}

export function grantTechnologyToCharacter(world: WorldState, characterId: number, technologyId: string, reason = 'освоил практику'): boolean {
  ensureCollections(world);
  if (!CIVILIZATION_CONTENT.technologyById.has(technologyId)) return false;
  const character = world.characters.find(item => item.id === characterId && item.alive);
  if (!character) return false;
  const changed = grantTechnologyToCharacterInternal(character, technologyId);
  if (!changed) return false;
  character.biography.push(`В ${world.year} году ${reason}: «${CIVILIZATION_CONTENT.technologyById.get(technologyId)?.name ?? technologyId}».`);
  const state = ensureTechnologyState(world, character.settlementId, technologyId);
  state.practitionerIds = [...new Set([...state.practitionerIds, character.id])];
  state.mastery = Math.max(state.mastery, 62);
  state.lastPracticedYear = world.year;
  state.active = true;
  return true;
}

export function establishLocalTechnology(
  world: WorldState,
  settlementId: number,
  technologyId: string,
  mode: TechnologyTransmissionMode,
  options: { fromSettlementId?: number; carrierCharacterId?: number; bookId?: number; mastery?: number; reason?: string } = {},
): SettlementTechnologyKnowledge | undefined {
  ensureCollections(world);
  if (!CIVILIZATION_CONTENT.technologyById.has(technologyId) || !world.settlements.some(item => item.id === settlementId)) return undefined;
  const state = ensureTechnologyState(world, settlementId, technologyId);
  const candidates = localCandidates(world, settlementId, technologyId);
  const explicit = options.carrierCharacterId ? world.characters.find(item => item.id === options.carrierCharacterId && item.alive && item.settlementId === settlementId) : undefined;
  const practitioners = [explicit, ...candidates].filter((item): item is Character => Boolean(item)).slice(0, technologyId === 'oral-tradition' ? 3 : 2);
  for (const practitioner of practitioners) {
    grantTechnologyToCharacterInternal(practitioner, technologyId);
    state.practitionerIds.push(practitioner.id);
  }
  state.practitionerIds = [...new Set(state.practitionerIds)];
  state.institutionBuildingIds = [...new Set([...state.institutionBuildingIds, ...localInstitutionIds(world, settlementId, technologyId)])];
  state.bookIds = [...new Set([...state.bookIds, ...localBookIds(world, settlementId, technologyId), ...(options.bookId ? [options.bookId] : [])])];
  state.mastery = Math.max(state.mastery, options.mastery ?? (state.practitionerIds.length ? 68 : state.bookIds.length ? 42 : 25));
  state.lastPracticedYear = state.practitionerIds.length ? world.year : state.lastPracticedYear;
  state.active = state.practitionerIds.length > 0 || BASELINE_LOCAL_TECHNOLOGIES.includes(technologyId as typeof BASELINE_LOCAL_TECHNOLOGIES[number]);
  state.level = state.practitionerIds.length && state.institutionBuildingIds.length ? 'institutional' : state.practitionerIds.length ? 'practiced' : state.bookIds.length ? 'theoretical' : 'lost';
  if (options.fromSettlementId !== undefined) state.sourceSettlementId = options.fromSettlementId;
  const reason = options.reason ?? `Знание закрепилось через ${mode}.`;
  if (!state.history.includes(reason)) state.history.push(reason);
  if (mode !== 'founding' || options.fromSettlementId !== undefined || options.carrierCharacterId !== undefined || options.bookId !== undefined) {
    recordTransmission(world, technologyId, settlementId, mode, {
      fromSettlementId: options.fromSettlementId, carrierCharacterId: options.carrierCharacterId, bookId: options.bookId, outcome: reason,
    });
  }
  return state;
}

function reconcileState(world: WorldState, state: SettlementTechnologyKnowledge): void {
  const previousLevel = state.level;
  const practitioners = world.characters.filter(character => character.alive && !character.expeditionId && character.settlementId === state.settlementId
    && (character.technologyIds ?? []).includes(state.technologyId)).map(character => character.id);
  state.practitionerIds = [...new Set(practitioners)];
  state.institutionBuildingIds = localInstitutionIds(world, state.settlementId, state.technologyId);
  state.bookIds = localBookIds(world, state.settlementId, state.technologyId);
  state.apprenticeIds = state.apprenticeIds.filter(id => world.characters.some(character => character.id === id && character.alive && character.settlementId === state.settlementId));
  const baseline = BASELINE_LOCAL_TECHNOLOGIES.includes(state.technologyId as typeof BASELINE_LOCAL_TECHNOLOGIES[number]);
  if (state.practitionerIds.length) {
    state.active = true;
    state.lastPracticedYear = world.year;
    state.mastery = clamp(Math.max(state.mastery, state.institutionBuildingIds.length ? 72 : 58) + Math.min(2, state.practitionerIds.length * .2));
    state.level = state.institutionBuildingIds.length ? 'institutional' : 'practiced';
  } else if (baseline) {
    state.active = true;
    state.mastery = Math.max(state.mastery, 55);
    state.level = state.institutionBuildingIds.length ? 'institutional' : 'practiced';
  } else if (state.bookIds.length) {
    state.active = false;
    state.mastery = Math.max(30, state.mastery - Math.max(0, world.year - state.lastPracticedYear) * 1.5);
    state.level = 'theoretical';
  } else {
    state.active = false;
    state.mastery = Math.max(0, state.mastery - Math.max(4, (world.year - state.lastPracticedYear) * 5));
    state.level = 'lost';
  }
  if (previousLevel !== 'lost' && state.level === 'lost') state.history.push(`В ${world.year} году умер или уехал последний носитель; практика была утрачена.`);
  if (previousLevel === 'lost' && state.level !== 'lost') state.history.push(`В ${world.year} году знание было восстановлено.`);
}

function synchronizeCivilizationSummary(world: WorldState): void {
  for (const civilization of world.civilizations) {
    const settlementIds = new Set(world.settlements.filter(item => item.civilizationId === civilization.id).map(item => item.id));
    const known = new Set<string>(BASELINE_LOCAL_TECHNOLOGIES);
    for (const state of world.settlementTechnologyKnowledge) if (settlementIds.has(state.settlementId) && state.level !== 'lost') known.add(state.technologyId);
    for (const id of [...known]) addPrerequisites(known, id);
    civilization.unlockedTechnologyIds = [...known].filter(id => CIVILIZATION_CONTENT.technologyById.has(id)).sort();
    civilization.knownRecipeKeys = CIVILIZATION_CONTENT.recipes
      .filter(recipe => !recipe.requiredTechnologyId || civilization.unlockedTechnologyIds.includes(recipe.requiredTechnologyId))
      .map(recipe => recipe.key).sort();
  }
}

export function settlementTechnologyState(world: WorldState, settlementId: number, technologyId: string): SettlementTechnologyKnowledge | undefined {
  ensureCollections(world);
  return technologyState(world, settlementId, technologyId);
}

export function settlementHasTechnology(world: WorldState, settlementId: number, technologyId: string): boolean {
  if (BASELINE_LOCAL_TECHNOLOGIES.includes(technologyId as typeof BASELINE_LOCAL_TECHNOLOGIES[number])) return true;
  const state = settlementTechnologyState(world, settlementId, technologyId);
  return Boolean(state?.active && state.mastery >= 45 && state.practitionerIds.length > 0);
}

export function recipeAvailableToSettlement(world: WorldState, settlementId: number, recipe: ProductionRecipe): boolean {
  if (!recipe.requiredTechnologyId) return true;
  return settlementHasTechnology(world, settlementId, recipe.requiredTechnologyId);
}

export function availableRecipesForSettlement(world: WorldState, settlementId: number, type?: EstablishmentType): ProductionRecipe[] {
  return world.productionRecipes.filter(recipe => (!type || recipe.establishmentTypes.includes(type)) && recipeAvailableToSettlement(world, settlementId, recipe));
}

export function synchronizeTechnologyRecipes(world: WorldState): void {
  ensureCollections(world);
  for (const establishment of world.establishments) {
    establishment.recipeIds = [...new Set(availableRecipesForSettlement(world, establishment.settlementId, establishment.type).map(recipe => recipe.id))];
  }
  synchronizeCivilizationSummary(world);
}

function seedTechnologyAtSettlement(world: WorldState, settlement: Settlement, technologyId: string, mode: TechnologyTransmissionMode, sourceSettlementId?: number): void {
  const state = establishLocalTechnology(world, settlement.id, technologyId, mode, {
    fromSettlementId: sourceSettlementId, mastery: 60,
    reason: `В ${world.year} году практика «${CIVILIZATION_CONTENT.technologyById.get(technologyId)?.name ?? technologyId}» получила местных носителей.`,
  });
  if (!state) return;
  for (const prerequisite of CIVILIZATION_CONTENT.technologyById.get(technologyId)?.prerequisites ?? []) seedTechnologyAtSettlement(world, settlement, prerequisite, mode, sourceSettlementId);
}

export function initializeTechnologyKnowledge(world: WorldState, rng = new RNG(`${world.config.seed}:local-knowledge-v1`)): void {
  const firstInitialization = world.simulation.technologyKnowledgeVersion !== 1 || !world.settlementTechnologyKnowledge?.length;
  ensureCollections(world);
  for (const settlement of world.settlements) {
    const existingLocalState = world.settlementTechnologyKnowledge.some(item => item.settlementId === settlement.id);
    if (firstInitialization) {
      const local = new Set<string>();
      for (const technologyId of technologyEvidenceAtSettlement(world, settlement)) addPrerequisites(local, technologyId);
      for (const technologyId of local) seedTechnologyAtSettlement(world, settlement, technologyId, 'founding');
    } else if (!existingLocalState) {
      for (const technologyId of BASELINE_LOCAL_TECHNOLOGIES) seedTechnologyAtSettlement(world, settlement, technologyId, 'founding');
      for (const character of world.characters.filter(item => item.alive && item.settlementId === settlement.id)) {
        for (const technologyId of character.technologyIds ?? []) establishLocalTechnology(world, settlement.id, technologyId, 'migration-import', {
          carrierCharacterId: character.id,
          reason: `${character.name} принёс знание в новую общину.`,
        });
      }
    }
  }
  if (firstInitialization) for (const civilization of world.civilizations) {
    const settlements = world.settlements.filter(item => item.civilizationId === civilization.id);
    if (!settlements.length) continue;
    const capital = world.settlements.find(item => item.id === civilization.capitalSettlementId) ?? settlements[0]!;
    for (const technologyId of civilization.unlockedTechnologyIds ?? []) {
      const represented = world.settlementTechnologyKnowledge.some(item => settlements.some(settlement => settlement.id === item.settlementId)
        && item.technologyId === technologyId && item.level !== 'lost');
      if (!represented) seedTechnologyAtSettlement(world, capital, technologyId, 'discovery');
    }
  }
  for (const expedition of world.settlementExpeditions ?? []) {
    for (const memberId of expedition.memberIds) {
      const member = world.characters.find(item => item.id === memberId && item.alive);
      if (!member) continue;
      for (const technologyId of expedition.knownTechnologyIds ?? []) if (rng.chance(.55)) grantTechnologyToCharacterInternal(member, technologyId);
    }
  }
  for (const state of world.settlementTechnologyKnowledge) reconcileState(world, state);
  synchronizeTechnologyRecipes(world);
  world.simulation.technologyKnowledgeVersion = 1;
}

function advanceApprenticeships(world: WorldState): void {
  for (const contract of world.employments) {
    if (!contract.active || !contract.apprenticeOfCharacterId) continue;
    const apprentice = world.characters.find(item => item.id === contract.characterId && item.alive);
    const master = world.characters.find(item => item.id === contract.apprenticeOfCharacterId && item.alive);
    if (!apprentice || !master || apprentice.settlementId !== master.settlementId) continue;
    apprentice.technologyLearning ??= {};
    for (const technologyId of master.technologyIds ?? []) {
      if ((apprentice.technologyIds ?? []).includes(technologyId)) continue;
      const literacy = apprentice.cultureProfile?.literacy ?? 0;
      const years = Math.max(0, world.year - contract.sinceYear + 1);
      const progress = (apprentice.technologyLearning[technologyId] ?? 0) + 24 + Math.min(18, literacy * .22) + Math.min(18, years * 3);
      apprentice.technologyLearning[technologyId] = progress;
      const state = ensureTechnologyState(world, apprentice.settlementId, technologyId);
      state.apprenticeIds = [...new Set([...state.apprenticeIds, apprentice.id])];
      if (progress < 100) continue;
      delete apprentice.technologyLearning[technologyId];
      grantTechnologyToCharacter(world, apprentice.id, technologyId, `завершил ученичество у ${master.name}`);
      recordTransmission(world, technologyId, apprentice.settlementId, 'apprenticeship', {
        fromSettlementId: master.settlementId, carrierCharacterId: apprentice.id,
        outcome: `${apprentice.name} освоил практику у ${master.name}.`,
      });
    }
  }
}

function advanceBookKnowledge(world: WorldState): void {
  for (const book of world.books) {
    for (const technologyId of book.technologyIds ?? []) {
      const state = ensureTechnologyState(world, book.settlementId, technologyId);
      if (!state.bookIds.includes(book.id)) {
        state.bookIds.push(book.id);
        state.mastery = Math.max(state.mastery, Math.round(book.reliability * .55));
        state.history.push(`Книга «${book.title}» сохранила теорию в ${world.year} году.`);
        recordTransmission(world, technologyId, book.settlementId, 'book', { bookId: book.id, outcome: `Книга «${book.title}» сохранила описание технологии.` });
      }
    }
  }
}

function advanceTradeTransmission(world: WorldState, rng: RNG): void {
  for (const route of world.tradeRoutes.filter(item => item.active)) {
    const sourceStates = world.settlementTechnologyKnowledge
      .filter(item => item.settlementId === route.fromSettlementId && item.active && item.mastery >= 65 && !settlementHasTechnology(world, route.toSettlementId, item.technologyId))
      .sort((a, b) => b.mastery - a.mastery || a.technologyId.localeCompare(b.technologyId));
    const source = sourceStates[0];
    if (!source || !rng.chance(Math.min(.42, .08 + Math.max(0, route.volume ?? 0) / 500))) continue;
    const candidate = localCandidates(world, route.toSettlementId, source.technologyId)[0];
    if (!candidate) continue;
    candidate.technologyLearning ??= {};
    candidate.technologyLearning[source.technologyId] = Math.max(candidate.technologyLearning[source.technologyId] ?? 0, 45 + rng.int(0, 25));
    const state = ensureTechnologyState(world, route.toSettlementId, source.technologyId);
    state.mastery = Math.max(state.mastery, 28);
    state.sourceSettlementId = route.fromSettlementId;
    state.history.push(`В ${world.year} году торговцы принесли описание практики из соседнего поселения.`);
    recordTransmission(world, source.technologyId, route.toSettlementId, 'trade', {
      fromSettlementId: route.fromSettlementId, carrierCharacterId: candidate.id,
      outcome: `${candidate.name} начал перенимать технологию через торговый путь.`,
    });
  }
}

function registerMovedPractitioners(world: WorldState): void {
  for (const character of world.characters) {
    if (!character.alive || character.expeditionId) continue;
    for (const technologyId of character.technologyIds ?? []) {
      const previousState = world.settlementTechnologyKnowledge.find(item => item.technologyId === technologyId
        && item.settlementId !== character.settlementId && item.practitionerIds.includes(character.id));
      const state = ensureTechnologyState(world, character.settlementId, technologyId);
      if (state.practitionerIds.includes(character.id)) continue;
      state.practitionerIds.push(character.id);
      state.mastery = Math.max(state.mastery, 58);
      state.lastPracticedYear = world.year;
      state.active = true;
      state.sourceSettlementId = previousState?.settlementId;
      state.history.push(`В ${world.year} году ${character.name} принёс практику в поселение.`);
      recordTransmission(world, technologyId, character.settlementId, 'migration', {
        fromSettlementId: previousState?.settlementId, carrierCharacterId: character.id,
        outcome: `${character.name} перенёс практическое знание при переселении.`,
      });
    }
  }
}

export function reconcileTechnologyKnowledge(world: WorldState): void {
  if (world.simulation.technologyKnowledgeVersion !== 1) initializeTechnologyKnowledge(world);
  ensureCollections(world);
  registerMovedPractitioners(world);
  advanceBookKnowledge(world);
  for (const state of world.settlementTechnologyKnowledge) reconcileState(world, state);
  synchronizeTechnologyRecipes(world);
}

export function advanceTechnologyKnowledge(world: WorldState): void {
  if (world.simulation.technologyKnowledgeVersion !== 1) initializeTechnologyKnowledge(world);
  ensureCollections(world);
  if (world.simulation.lastTechnologyKnowledgeAdvanceYear === world.year) {
    reconcileTechnologyKnowledge(world);
    return;
  }
  registerMovedPractitioners(world);
  advanceApprenticeships(world);
  advanceBookKnowledge(world);
  advanceTradeTransmission(world, new RNG(`${world.config.seed}:knowledge-transmission:${world.year}`));
  for (const state of world.settlementTechnologyKnowledge) reconcileState(world, state);
  synchronizeTechnologyRecipes(world);
  world.simulation.lastTechnologyKnowledgeAdvanceYear = world.year;
}

export function selectDiscoverySettlement(world: WorldState, civilizationId: number, technology: TechnologyDefinition): Settlement | undefined {
  const settlements = world.settlements.filter(item => item.civilizationId === civilizationId);
  return [...settlements].sort((a, b) => {
    const professions = new Set(professionsForTechnology(technology.id));
    const score = (settlement: Settlement) => {
      const practitioners = world.characters.filter(item => item.alive && item.settlementId === settlement.id && professions.has(item.profession)).length;
      const institutions = localInstitutionIds(world, settlement.id, technology.id).length;
      const literacy = world.settlementCultures.find(item => item.settlementId === settlement.id)?.literacy ?? 0;
      return practitioners * 18 + institutions * 14 + literacy * .35 + settlement.prosperity * .2 + Number(settlement.id === world.civilizations.find(item => item.id === civilizationId)?.capitalSettlementId) * 8;
    };
    return score(b) - score(a) || b.population - a.population || a.id - b.id;
  })[0];
}

export function technologyKnowledgeIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const technologyIds = new Set(CIVILIZATION_CONTENT.technologies.map(item => item.id));
  const settlementIds = new Set(world.settlements.map(item => item.id));
  const characterIds = new Set(world.characters.filter(item => item.alive).map(item => item.id));
  const buildingIds = new Set(world.buildings.map(item => item.id));
  const bookIds = new Set(world.books.map(item => item.id));
  const keys = new Set<string>();
  for (const state of world.settlementTechnologyKnowledge ?? []) {
    const key = `${state.settlementId}:${state.technologyId}`;
    if (keys.has(key)) issues.push(`Локальные знания: повтор записи ${key}.`);
    keys.add(key);
    if (!settlementIds.has(state.settlementId)) issues.push(`Локальные знания: отсутствует поселение ${state.settlementId}.`);
    if (!technologyIds.has(state.technologyId)) issues.push(`Локальные знания: неизвестная технология «${state.technologyId}».`);
    if (state.practitionerIds.some(id => !characterIds.has(id))) issues.push(`Локальные знания ${key}: указан отсутствующий практик.`);
    for (const practitionerId of state.practitionerIds) {
      const practitioner = world.characters.find(item => item.id === practitionerId && item.alive);
      if (practitioner && (practitioner.expeditionId || practitioner.settlementId !== state.settlementId || !(practitioner.technologyIds ?? []).includes(state.technologyId))) issues.push(`Локальные знания ${key}: практик ${practitionerId} не находится в поселении или не владеет технологией.`);
    }
    if (state.institutionBuildingIds.some(id => !buildingIds.has(id))) issues.push(`Локальные знания ${key}: указано отсутствующее учреждение.`);
    if (state.institutionBuildingIds.some(id => world.buildings.find(item => item.id === id)?.settlementId !== state.settlementId)) issues.push(`Локальные знания ${key}: учреждение находится в другом поселении.`);
    if (state.bookIds.some(id => !bookIds.has(id))) issues.push(`Локальные знания ${key}: указана отсутствующая книга.`);
    if (state.bookIds.some(id => { const book = world.books.find(item => item.id === id); return book && (book.settlementId !== state.settlementId || !(book.technologyIds ?? []).includes(state.technologyId)); })) issues.push(`Локальные знания ${key}: книга не находится в поселении или не содержит технологию.`);
    if (state.active && !BASELINE_LOCAL_TECHNOLOGIES.includes(state.technologyId as typeof BASELINE_LOCAL_TECHNOLOGIES[number]) && !state.practitionerIds.length) issues.push(`Локальные знания ${key}: активная практика не имеет живого носителя.`);
  }
  for (const character of world.characters) for (const technologyId of character.technologyIds ?? []) if (!technologyIds.has(technologyId)) issues.push(`${character.name}: знает неизвестную технологию «${technologyId}».`);
  for (const book of world.books) for (const technologyId of book.technologyIds ?? []) if (!technologyIds.has(technologyId)) issues.push(`${book.title}: содержит неизвестную технологию «${technologyId}».`);
  for (const establishment of world.establishments) for (const recipeId of establishment.recipeIds) {
    const recipe = world.productionRecipes.find(item => item.id === recipeId);
    if (recipe && !recipeAvailableToSettlement(world, establishment.settlementId, recipe)) issues.push(`${establishment.name}: использует локально недоступный рецепт «${recipe.name}».`);
  }
  return [...new Set(issues)];
}
