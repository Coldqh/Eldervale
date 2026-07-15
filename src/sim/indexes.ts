import type {
  AnimalPopulation, Building, Character, EmploymentContract, Establishment, Household, Kingdom, NaturalIngredient, ProductionRecipe, Relationship, Settlement, Tile, WorldEvent, WorldItem, WorldState,
} from '../types';

export const coordinateKey = (x: number, y: number) => `${x}:${y}`;
export const relationshipKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;

export interface WorldIndexes {
  characterById: Map<number, Character>;
  settlementById: Map<number, Settlement>;
  kingdomById: Map<number, Kingdom>;
  tileByCoordinate: Map<string, Tile>;
  residentsBySettlement: Map<number, Character[]>;
  workersBySettlementAndProfession: Map<number, Map<string, Character[]>>;
  animalPopulationsByTile: Map<string, AnimalPopulation[]>;
  animalPopulationByTileAndSpecies: Map<string, AnimalPopulation>;
  ingredientsByTile: Map<string, NaturalIngredient[]>;
  ingredientById: Map<number, NaturalIngredient>;
  relationshipKeys: Set<string>;
  eventsByEntity: Map<string, WorldEvent[]>;
  buildingById: Map<number, Building>;
  householdById: Map<number, Household>;
  establishmentById: Map<number, Establishment>;
  itemById: Map<number, WorldItem>;
  productionRecipeById: Map<number, ProductionRecipe>;
  employmentById: Map<number, EmploymentContract>;
  buildingsBySettlement: Map<number, Building[]>;
  householdsBySettlement: Map<number, Household[]>;
  establishmentsBySettlement: Map<number, Establishment[]>;
}

export function buildWorldIndexes(world: WorldState): WorldIndexes {
  const indexes: WorldIndexes = {
    characterById: new Map(world.characters.map(item => [item.id, item])),
    settlementById: new Map(world.settlements.map(item => [item.id, item])),
    kingdomById: new Map(world.kingdoms.map(item => [item.id, item])),
    tileByCoordinate: new Map(world.tiles.map(item => [coordinateKey(item.x, item.y), item])),
    residentsBySettlement: new Map(),
    workersBySettlementAndProfession: new Map(),
    animalPopulationsByTile: new Map(),
    animalPopulationByTileAndSpecies: new Map(),
    ingredientsByTile: new Map(),
    ingredientById: new Map(world.ingredients.map(item => [item.id, item])),
    relationshipKeys: new Set(world.relationships.map(item => relationshipKey(item.characterAId, item.characterBId))),
    eventsByEntity: new Map(),
    buildingById: new Map((world.buildings ?? []).map(item => [item.id, item])),
    householdById: new Map((world.households ?? []).map(item => [item.id, item])),
    establishmentById: new Map((world.establishments ?? []).map(item => [item.id, item])),
    itemById: new Map((world.items ?? []).map(item => [item.id, item])),
    productionRecipeById: new Map((world.productionRecipes ?? []).map(item => [item.id, item])),
    employmentById: new Map((world.employments ?? []).map(item => [item.id, item])),
    buildingsBySettlement: new Map(), householdsBySettlement: new Map(), establishmentsBySettlement: new Map(),
  };

  for (const building of world.buildings ?? []) { const list = indexes.buildingsBySettlement.get(building.settlementId) ?? []; list.push(building); indexes.buildingsBySettlement.set(building.settlementId, list); }
  for (const household of world.households ?? []) { const list = indexes.householdsBySettlement.get(household.settlementId) ?? []; list.push(household); indexes.householdsBySettlement.set(household.settlementId, list); }
  for (const establishment of world.establishments ?? []) { const list = indexes.establishmentsBySettlement.get(establishment.settlementId) ?? []; list.push(establishment); indexes.establishmentsBySettlement.set(establishment.settlementId, list); }
  for (const character of world.characters) addResidentToIndexes(indexes, character);
  rebuildAnimalIndexes(indexes, world.animalPopulations);
  for (const ingredient of world.ingredients) {
    const key = coordinateKey(ingredient.x, ingredient.y);
    const list = indexes.ingredientsByTile.get(key) ?? [];
    list.push(ingredient);
    indexes.ingredientsByTile.set(key, list);
  }
  for (const event of world.events) indexEvent(indexes, event);
  return indexes;
}

export function addResidentToIndexes(indexes: WorldIndexes, character: Character): void {
  indexes.characterById.set(character.id, character);
  if (!character.alive) return;
  const residents = indexes.residentsBySettlement.get(character.settlementId) ?? [];
  residents.push(character);
  residents.sort((a, b) => a.id - b.id);
  indexes.residentsBySettlement.set(character.settlementId, residents);
  const professions = indexes.workersBySettlementAndProfession.get(character.settlementId) ?? new Map<string, Character[]>();
  const workers = professions.get(character.profession) ?? [];
  workers.push(character);
  workers.sort((a, b) => a.id - b.id);
  professions.set(character.profession, workers);
  indexes.workersBySettlementAndProfession.set(character.settlementId, professions);
}

export function removeResidentFromIndexes(indexes: WorldIndexes, character: Character): void {
  const residents = indexes.residentsBySettlement.get(character.settlementId);
  if (residents) indexes.residentsBySettlement.set(character.settlementId, residents.filter(item => item.id !== character.id));
  const professions = indexes.workersBySettlementAndProfession.get(character.settlementId);
  const workers = professions?.get(character.profession);
  if (professions && workers) professions.set(character.profession, workers.filter(item => item.id !== character.id));
}

export function moveResidentInIndexes(indexes: WorldIndexes, character: Character, newSettlementId: number): void {
  removeResidentFromIndexes(indexes, character);
  character.settlementId = newSettlementId;
  addResidentToIndexes(indexes, character);
}

export function changeProfessionInIndexes(indexes: WorldIndexes, character: Character, profession: string): void {
  if (character.alive) removeResidentFromIndexes(indexes, character);
  character.profession = profession;
  if (character.alive) addResidentToIndexes(indexes, character);
}

export function rebuildAnimalIndexes(indexes: WorldIndexes, populations: AnimalPopulation[]): void {
  indexes.animalPopulationsByTile.clear();
  indexes.animalPopulationByTileAndSpecies.clear();
  for (const population of populations) {
    const key = coordinateKey(population.x, population.y);
    const list = indexes.animalPopulationsByTile.get(key) ?? [];
    list.push(population);
    list.sort((a, b) => a.id - b.id);
    indexes.animalPopulationsByTile.set(key, list);
    indexes.animalPopulationByTileAndSpecies.set(`${key}:${population.species}`, population);
  }
}

export function addAnimalPopulationToIndexes(indexes: WorldIndexes, population: AnimalPopulation): void {
  const key = coordinateKey(population.x, population.y);
  const list = indexes.animalPopulationsByTile.get(key) ?? [];
  list.push(population);
  list.sort((a, b) => a.id - b.id);
  indexes.animalPopulationsByTile.set(key, list);
  indexes.animalPopulationByTileAndSpecies.set(`${key}:${population.species}`, population);
}

export function indexRelationship(indexes: WorldIndexes, relationship: Relationship): void {
  indexes.relationshipKeys.add(relationshipKey(relationship.characterAId, relationship.characterBId));
}

export function indexEvent(indexes: WorldIndexes, event: WorldEvent): void {
  for (const ref of event.entityRefs) {
    const key = `${ref.kind}:${ref.id}`;
    const list = indexes.eventsByEntity.get(key) ?? [];
    list.push(event);
    indexes.eventsByEntity.set(key, list);
  }
}

export function residents(indexes: WorldIndexes, settlementId: number): Character[] {
  return indexes.residentsBySettlement.get(settlementId) ?? [];
}

export function workers(indexes: WorldIndexes, settlementId: number, professions: readonly string[]): Character[] {
  const professionMap = indexes.workersBySettlementAndProfession.get(settlementId);
  if (!professionMap) return [];
  const result: Character[] = [];
  for (const profession of professions) result.push(...(professionMap.get(profession) ?? []));
  return result;
}

export function nearbyTileKeys(x: number, y: number, radius: number): string[] {
  const keys: string[] = [];
  const ceiling = Math.ceil(radius);
  for (let dy = -ceiling; dy <= ceiling; dy += 1) {
    for (let dx = -ceiling; dx <= ceiling; dx += 1) {
      if (Math.hypot(dx, dy) <= radius) keys.push(coordinateKey(x + dx, y + dy));
    }
  }
  return keys;
}

export function countIndexedEntities(indexes: WorldIndexes): number {
  return indexes.characterById.size + indexes.settlementById.size + indexes.kingdomById.size + indexes.tileByCoordinate.size
    + indexes.animalPopulationByTileAndSpecies.size + indexes.ingredientById.size + indexes.relationshipKeys.size
    + indexes.buildingById.size + indexes.householdById.size + indexes.establishmentById.size + indexes.itemById.size + indexes.employmentById.size;
}
