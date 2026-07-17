import type { SimulationProfile, SimulationProgress, WorldConfig, WorldState } from '../types';

export type WorldWorkerCommand =
  | { id: number; action: 'initialize'; world: WorldState }
  | { id: number; action: 'generate'; config: WorldConfig }
  | { id: number; action: 'advance'; months: number }
  | { id: number; action: 'advanceUntilEvent'; maxMonths: number; minImportance: number }
  | { id: number; action: 'snapshot' }
  | { id: number; action: 'setFocus'; x?: number; y?: number; level?: number; radius?: number }
  | { id: number; action: 'cancel'; targetId: number };

export type WorldWorkerMessage =
  | { id: number; type: 'progress'; progress: SimulationProgress }
  | { id: number; type: 'complete'; world?: WorldState; profile?: SimulationProfile; stoppedOnEventId?: number; limitReached?: boolean }
  | { id: number; type: 'cancelled'; world?: WorldState; profile?: SimulationProfile; stoppedOnEventId?: number; limitReached?: boolean }
  | { id: number; type: 'error'; error: string };

export interface WorldWorkerResult {
  world?: WorldState;
  profile?: SimulationProfile;
  cancelled?: boolean;
  stoppedOnEventId?: number;
  limitReached?: boolean;
}
