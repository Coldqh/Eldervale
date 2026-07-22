import type {
  BuildingType, EquipmentSlot, EstablishmentType, ItemCategory, ProductionRecipe, Species,
} from './types';

export type TechnologyCategory = 'выживание' | 'земледелие' | 'ремесло' | 'строительство' | 'знания' | 'управление' | 'военное дело' | 'магия';
export type CivilizationStatus = 'active' | 'fragmented' | 'extinct';

export interface CivilizationEraDefinition {
  id: string;
  name: string;
  order: number;
  description: string;
  entryTechnologyIds: string[];
  minimumPopulation: number;
  minimumUrbanization: number;
  minimumLiteracy: number;
}

export interface TechnologyUnlocks {
  buildingTypes?: BuildingType[];
  capabilities?: string[];
}

export interface TechnologyRequirements {
  minimumPopulation?: number;
  minimumUrbanization?: number;
  minimumLiteracy?: number;
  minimumProsperity?: number;
  minimumMagic?: number;
  requiredResourceIds?: string[];
  requiredEstablishmentTypes?: EstablishmentType[];
}

export interface TechnologyDefinition {
  id: string;
  name: string;
  eraId: string;
  category: TechnologyCategory;
  prerequisites: string[];
  cost: number;
  requirements?: TechnologyRequirements;
  unlocks: TechnologyUnlocks;
  description: string;
}

export interface ResourceDefinition {
  id: string;
  name: string;
  category: ItemCategory;
  material: string;
  unit: string;
  weight: number;
  perishability: number;
  value: number;
  equipmentSlot?: EquipmentSlot;
  dye?: string;
  warmth?: number;
  armor?: number;
  damage?: number;
  toolType?: string;
  requiredProfession?: string;
  maxCondition?: number;
  requiredTechnologyId?: string;
  tags?: string[];
}

export interface RecipeDefinition extends Omit<ProductionRecipe, 'id' | 'key'> {
  key: string;
  requiredTechnologyId?: string;
}

export interface CivilizationContentPack {
  id: string;
  version: number;
  eras: CivilizationEraDefinition[];
  technologies: TechnologyDefinition[];
  resources: ResourceDefinition[];
  recipes: RecipeDefinition[];
}

export interface CivilizationMetrics {
  population: number;
  urbanization: number;
  literacy: number;
  prosperity: number;
  innovation: number;
}

export interface Civilization {
  id: number;
  name: string;
  species: Species;
  originCultureId?: number;
  capitalSettlementId: number;
  foundedYear: number;
  eraId: string;
  unlockedTechnologyIds: string[];
  technologyProgress: Record<string, number>;
  knownResourceIds: string[];
  knownRecipeKeys: string[];
  metrics: CivilizationMetrics;
  status: CivilizationStatus;
  lastAdvancedYear: number;
  history: string[];
}
