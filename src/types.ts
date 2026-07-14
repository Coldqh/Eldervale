export type Terrain = 'ocean' | 'coast' | 'plains' | 'forest' | 'hills' | 'mountains' | 'marsh' | 'desert' | 'tundra';
export type Species = 'human' | 'elf' | 'orc' | 'dwarf';
export type EventKind = 'birth' | 'death' | 'war' | 'battle' | 'dragon' | 'monster' | 'hero' | 'artifact' | 'book' | 'settlement' | 'politics' | 'trade';
export type EntityKind = 'kingdom' | 'settlement' | 'character' | 'army' | 'monster' | 'artifact' | 'book' | 'dungeon' | 'war';

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
}

export interface Tile {
  x: number;
  y: number;
  terrain: Terrain;
  elevation: number;
  moisture: number;
  kingdomId?: number;
  settlementId?: number;
  dungeonId?: number;
  monsterId?: number;
}

export interface Kingdom {
  id: number;
  name: string;
  color: string;
  species: Species;
  rulerId: number;
  capitalId: number;
  treasury: number;
  armyStrength: number;
  stability: number;
  aggression: number;
  culture: string;
  religion: string;
  foundedYear: number;
  enemies: number[];
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
  notableCharacterIds: number[];
  damaged: number;
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
  profession: string;
  renown: number;
  health: number;
  ambition: string;
  parentIds: number[];
  childIds: number[];
  spouseId?: number;
  titles: string[];
  artifactIds: number[];
  bookIds: number[];
  kills: number;
  biography: string[];
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
  targetKingdomId?: number;
  targetSettlementId?: number;
  status: 'garrison' | 'marching' | 'raiding' | 'battle' | 'recovering';
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
  lairDungeonId?: number;
  kills: number;
  history: string[];
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
  summary: string;
  copies: number;
  settlementId: number;
}

export interface Dungeon {
  id: number;
  name: string;
  x: number;
  y: number;
  origin: string;
  builtYear: number;
  danger: number;
  depth: number;
  currentInhabitants: string;
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
  battles: number;
  attackerLosses: number;
  defenderLosses: number;
}

export interface WorldEvent {
  id: number;
  year: number;
  month: number;
  kind: EventKind;
  title: string;
  description: string;
  entityRefs: { kind: EntityKind; id: number }[];
  importance: number;
}

export interface WorldState {
  version: 1;
  language?: 'ru';
  config: WorldConfig;
  name: string;
  year: number;
  month: number;
  tiles: Tile[];
  kingdoms: Kingdom[];
  settlements: Settlement[];
  characters: Character[];
  armies: Army[];
  monsters: Monster[];
  artifacts: Artifact[];
  books: Book[];
  dungeons: Dungeon[];
  wars: War[];
  events: WorldEvent[];
  nextIds: Record<string, number>;
}

export interface EntityRef {
  kind: EntityKind;
  id: number;
}
