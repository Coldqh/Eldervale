import type { Species } from './types';

export type InteriorRoomKind =
  | 'entry' | 'common-room' | 'bedroom' | 'kitchen' | 'pantry' | 'storage' | 'cellar'
  | 'classroom' | 'teacher-room' | 'workshop' | 'forge' | 'sales-floor' | 'tavern-hall'
  | 'guest-room' | 'great-hall' | 'throne-room' | 'royal-chamber' | 'guard-room'
  | 'barracks' | 'armory' | 'chapel' | 'treasury' | 'library' | 'study'
  | 'sanctuary' | 'vestry' | 'ward' | 'apothecary' | 'cell' | 'mess-hall' | 'stable';

export type InteriorFixtureKind =
  | 'bed' | 'double-bed' | 'bunk-bed' | 'prison-bed' | 'treatment-bed'
  | 'student-desk' | 'teacher-desk' | 'writing-desk'
  | 'workbench' | 'anvil' | 'forge' | 'loom' | 'oven' | 'counter' | 'market-stall'
  | 'table' | 'chair' | 'bench' | 'bar-counter' | 'kitchen-table'
  | 'shelf' | 'bookcase' | 'chest' | 'barrel' | 'crate' | 'weapon-rack'
  | 'hearth' | 'fireplace' | 'cauldron' | 'wash-basin'
  | 'rug' | 'carpet-runner' | 'banner' | 'tapestry' | 'throne' | 'altar'
  | 'training-dummy' | 'guard-post' | 'lectern' | 'wardrobe' | 'partition';

export type InteriorAssignmentKind = 'sleep' | 'school' | 'work' | 'seat' | 'treatment' | 'prison';

export interface InteriorMaterialProfile {
  wall: string;
  floor: string;
  ceiling: string;
  furniture: string;
  textile: string;
  metal: string;
  light: string;
  style: string;
  species: Species;
  quality: 'бедная' | 'простая' | 'добротная' | 'богатая' | 'дворцовая';
}

export interface InteriorRoom {
  id: string;
  buildingId: number;
  kind: InteriorRoomKind;
  name: string;
  floor: number;
  x: number;
  y: number;
  width: number;
  height: number;
  capacity: number;
}

export interface InteriorFixture {
  id: string;
  buildingId: number;
  roomId: string;
  kind: InteriorFixtureKind;
  label: string;
  floor: number;
  x: number;
  y: number;
  capacity: number;
  assignedCharacterIds: number[];
  functional: boolean;
  material: string;
}

export interface InteriorAssignment {
  characterId: number;
  kind: InteriorAssignmentKind;
  buildingId: number;
  fixtureId: string;
  roomId: string;
  floor: number;
  x: number;
  y: number;
  label: string;
}

export interface BuildingInteriorPlan {
  buildingId: number;
  signature: string;
  materials: InteriorMaterialProfile;
  rooms: InteriorRoom[];
  fixtures: InteriorFixture[];
  assignments: InteriorAssignment[];
  requiredBeds: number;
  availableBeds: number;
  requiredDesks: number;
  availableDesks: number;
  requiredWorkstations: number;
  availableWorkstations: number;
  overflowFloors: number;
  warnings: string[];
}
