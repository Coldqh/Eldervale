import type { Species } from './types';

export type MigrationReason = 'голод' | 'война' | 'эпидемия' | 'безработица' | 'перенаселение' | 'климат' | 'торговля' | 'родственники';

export interface PopulationShare {
  species: Species;
  count: number;
  share: number;
}

export interface SettlementDemographyState {
  settlementId: number;
  primarySpecies: Species;
  mixed: boolean;
  minoritySpecies?: Species;
  reason: string;
  shares: PopulationShare[];
  migrationPressure: number;
  migrationBalance: number;
  updatedTick: number;
}

export interface MigrationRecord {
  id: number;
  tick: number;
  year: number;
  month: number;
  fromSettlementId: number;
  toSettlementId: number;
  householdId?: number;
  characterIds: number[];
  species: Species[];
  reason: MigrationReason;
  summary: string;
}

export interface PopulationSystemState {
  version: 1;
  lastTick: number;
  lastCharacterId: number;
  migrationCarry: number;
  nextMigrationId: number;
  settlements: SettlementDemographyState[];
  migrations: MigrationRecord[];
}

declare module './types' {
  interface SimulationRuntimeState {
    raceDemographyVersion?: 2;
    population?: PopulationSystemState;
  }
}
