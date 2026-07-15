export type Terrain = 'ocean' | 'coast' | 'plains' | 'forest' | 'hills' | 'mountains' | 'marsh' | 'desert' | 'tundra';
export type Species = 'human' | 'elf' | 'orc' | 'dwarf';
export type EventKind = 'birth' | 'death' | 'war' | 'battle' | 'dragon' | 'monster' | 'hero' | 'artifact' | 'book' | 'settlement' | 'politics' | 'trade' | 'dynasty' | 'disaster' | 'ecology' | 'hunt' | 'foraging' | 'alchemy' | 'migration' | 'construction';
export type EntityKind = 'kingdom' | 'settlement' | 'character' | 'army' | 'monster' | 'artifact' | 'book' | 'dungeon' | 'war' | 'dynasty' | 'tradeRoute' | 'animalPopulation' | 'ingredient' | 'recipe';
export type RelationKind = 'родство' | 'дружба' | 'любовь' | 'верность' | 'долг' | 'страх' | 'соперничество' | 'ненависть';
export type LocalGround = 'grass' | 'dirt' | 'sand' | 'water' | 'mud' | 'snow' | 'stone' | 'road' | 'floor' | 'ash';
export type LocalFeature = 'tree' | 'bush' | 'rock' | 'reeds' | 'wall' | 'door' | 'field' | 'rubble' | 'fire' | 'blood' | 'body' | 'chest' | 'stairs-down' | 'stairs-up' | 'bridge' | 'herb' | 'berry' | 'mushroom' | 'animal-trail';
export type LocalEffectKind = 'burn' | 'rubble' | 'blood' | 'body' | 'lost-item' | 'camp' | 'grave' | 'repaired';

export interface WorldConfig {
  seed: string;
  width: number;
  height: number;
  historyYears: number;
  kingdomCount: number;
  settlementCount: number;
  populationScale: number;
  magic: number;
  warlike: number;
  monsterDensity: number;
  artifactDensity: number;
  localMapSize: 96 | 128 | 160;
  ecologyDensity: number;
  huntingPressure: number;
}

export interface Tile {
  x: number;
  y: number;
  terrain: Terrain;
  elevation: number;
  moisture: number;
  kingdomId?: number;
  settlementId?: number;
  settlementDistrict?: string;
  dungeonId?: number;
  monsterId?: number;
}

export interface DiplomacyRecord {
  kingdomId: number;
  score: number;
  status: 'союз' | 'мир' | 'напряжение' | 'война';
  reason: string;
}

export interface Kingdom {
  id: number;
  name: string;
  color: string;
  species: Species;
  rulerId: number;
  capitalId: number;
  dynastyId?: number;
  treasury: number;
  armyStrength: number;
  stability: number;
  aggression: number;
  culture: string;
  religion: string;
  foundedYear: number;
  enemies: number[];
  claims: number[];
  diplomacy: DiplomacyRecord[];
  laws: string[];
}

export interface SettlementDistrict {
  x: number;
  y: number;
  name: string;
  role: 'центр' | 'жилой район' | 'рынок' | 'ремесленный район' | 'крепость' | 'порт' | 'поля' | 'окраина';
}

export interface Settlement {
  id: number;
  name: string;
  x: number;
  y: number;
  kingdomId: number;
  population: number;
  prosperity: number;
  defense: number;
  food: number;
  foundedYear: number;
  type: 'hamlet' | 'village' | 'town' | 'city' | 'fortress' | 'port';
  buildings: string[];
  buildingCounts: Record<string, number>;
  households: number;
  residentialCapacity: number;
  districts: SettlementDistrict[];
  notableCharacterIds: number[];
  damaged: number;
  resource: string;
  stockpile: Record<string, number>;
  livestock: Record<string, number>;
  shortages: string[];
  tradeRouteIds: number[];
  unrest: number;
  history: string[];
}

export interface Character {
  id: number;
  name: string;
  species: Species;
  age: number;
  birthYear: number;
  deathYear?: number;
  alive: boolean;
  settlementId: number;
  kingdomId: number;
  dynastyId?: number;
  profession: string;
  workplace: string;
  homeDistrict?: string;
  renown: number;
  health: number;
  wealth: number;
  loyalty: number;
  ambition: string;
  parentIds: number[];
  childIds: number[];
  spouseId?: number;
  relationshipIds: number[];
  titles: string[];
  artifactIds: number[];
  bookIds: number[];
  injuries: string[];
  kills: number;
  biography: string[];
}

export interface Relationship {
  id: number;
  characterAId: number;
  characterBId: number;
  kind: RelationKind;
  strength: number;
  sinceYear: number;
  public: boolean;
  reason: string;
}

export interface Dynasty {
  id: number;
  name: string;
  founderId: number;
  currentHeadId: number;
  memberIds: number[];
  kingdomId?: number;
  prestige: number;
  wealth: number;
  claimKingdomIds: number[];
  history: string[];
}

export interface Army {
  id: number;
  name: string;
  kingdomId: number;
  commanderId: number;
  x: number;
  y: number;
  strength: number;
  morale: number;
  supplies: number;
  targetKingdomId?: number;
  targetSettlementId?: number;
  status: 'garrison' | 'marching' | 'raiding' | 'battle' | 'recovering';
  campaignHistory: string[];
}

export interface Monster {
  id: number;
  name: string;
  species: string;
  tier: 'common' | 'elite' | 'miniboss' | 'boss';
  x: number;
  y: number;
  health: number;
  power: number;
  age: number;
  alive: boolean;
  hoard: number;
  hunger: number;
  territoryRadius: number;
  behavior: string;
  goal: string;
  targetSettlementId?: number;
  lairDungeonId?: number;
  kills: number;
  history: string[];
}

export interface AnimalPopulation {
  id: number;
  species: string;
  x: number;
  y: number;
  count: number;
  carryingCapacity: number;
  diet: 'травоядное' | 'хищник' | 'всеядное';
  preySpecies: string[];
  predatorSpecies: string[];
  reproductionRate: number;
  migrationDrive: number;
  health: number;
  huntedThisYear: number;
  lastCause: string;
  history: string[];
}

export interface NaturalIngredient {
  id: number;
  name: string;
  x: number;
  y: number;
  kind: 'растение' | 'гриб' | 'минерал' | 'животный компонент';
  abundance: number;
  carryingCapacity: number;
  regenerationRate: number;
  seasonMonths: number[];
  properties: string[];
  toxicity: number;
  harvestedThisYear: number;
  history: string[];
}

export interface AlchemyRecipe {
  id: number;
  name: string;
  ingredientIds: number[];
  result: string;
  effect: string;
  risk: string;
  discoveredById?: number;
  discoveryYear: number;
  source: string;
  batchesCreated: number;
  history: string[];
}

export interface ArtifactOwnerRecord {
  year: number;
  characterId?: number;
  settlementId?: number;
  reason: string;
}

export interface Artifact {
  id: number;
  name: string;
  type: string;
  material: string;
  creatorId?: number;
  ownerId?: number;
  settlementId?: number;
  yearCreated: number;
  power: number;
  depiction: string;
  ownerHistory: ArtifactOwnerRecord[];
  history: string[];
}

export interface Book {
  id: number;
  title: string;
  authorId: number;
  yearWritten: number;
  language: string;
  subject: string;
  reliability: number;
  bias: string;
  summary: string;
  copies: number;
  settlementId: number;
  referencedEventIds: number[];
}

export interface Dungeon {
  id: number;
  name: string;
  x: number;
  y: number;
  origin: string;
  purpose: string;
  builtYear: number;
  danger: number;
  depth: number;
  currentInhabitants: string;
  ownerKingdomId?: number;
  discovered: boolean;
  artifactIds: number[];
  history: string[];
}

export interface War {
  id: number;
  name: string;
  attackerId: number;
  defenderId: number;
  startYear: number;
  endYear?: number;
  active: boolean;
  cause: string;
  goal: string;
  contestedSettlementIds: number[];
  battles: number;
  attackerLosses: number;
  defenderLosses: number;
  victorId?: number;
  peaceTerms?: string;
  history: string[];
}

export interface TradeRoute {
  id: number;
  name: string;
  fromSettlementId: number;
  toSettlementId: number;
  goods: string[];
  volume: number;
  safety: number;
  active: boolean;
  controlledByKingdomIds: number[];
  history: string[];
}

export interface WorldEvent {
  id: number;
  year: number;
  month: number;
  kind: EventKind;
  title: string;
  description: string;
  cause: string;
  conditions: string[];
  decision: string;
  outcome: string;
  consequences: string[];
  traces: EntityRef[];
  entityRefs: EntityRef[];
  importance: number;
}

export interface CausalEventInput {
  kind: EventKind;
  title: string;
  description: string;
  cause: string;
  conditions?: string[];
  decision?: string;
  outcome?: string;
  consequences: string[];
  entityRefs: EntityRef[];
  importance: number;
  traces?: EntityRef[];
}

export interface LocalMapEffect {
  id: string;
  globalX: number;
  globalY: number;
  level: number;
  localX: number;
  localY: number;
  kind: LocalEffectKind;
  year: number;
  label: string;
  entityRef?: EntityRef;
}

export interface LocalCell {
  x: number;
  y: number;
  ground: LocalGround;
  feature?: LocalFeature;
  building?: string;
  blocked: boolean;
}

export interface LocalMarker {
  id: string;
  x: number;
  y: number;
  kind: 'person' | 'army' | 'monster' | 'settlement' | 'dungeon' | 'artifact' | 'effect' | 'group' | 'fauna' | 'resource';
  label: string;
  refs: EntityRef[];
  count?: number;
  detail?: string;
}

export interface LocalExit {
  side: 'north' | 'east' | 'south' | 'west';
  position: number;
  road: boolean;
}

export interface LocalMapData {
  key: string;
  globalX: number;
  globalY: number;
  level: number;
  width: number;
  height: number;
  title: string;
  subtitle: string;
  terrain: Terrain;
  cells: LocalCell[];
  markers: LocalMarker[];
  exits: LocalExit[];
  availableLevels: number[];
}

export interface WorldState {
  version: 4;
  language?: 'ru';
  appVersion?: string;
  config: WorldConfig;
  name: string;
  year: number;
  month: number;
  tiles: Tile[];
  kingdoms: Kingdom[];
  settlements: Settlement[];
  characters: Character[];
  relationships: Relationship[];
  dynasties: Dynasty[];
  armies: Army[];
  monsters: Monster[];
  animalPopulations: AnimalPopulation[];
  ingredients: NaturalIngredient[];
  alchemyRecipes: AlchemyRecipe[];
  artifacts: Artifact[];
  books: Book[];
  dungeons: Dungeon[];
  wars: War[];
  tradeRoutes: TradeRoute[];
  events: WorldEvent[];
  localMapChanges: LocalMapEffect[];
  nextIds: Record<string, number>;
}

export interface EntityRef {
  kind: EntityKind;
  id: number;
}
