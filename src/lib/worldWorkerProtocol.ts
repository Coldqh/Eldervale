import type { SimulationProfile, SimulationProgress, WorldConfig, WorldState } from '../types';
import type { CharacterEventPointer } from '../liveStoriesTypes';

export type WorldWorkerCommand =
  | { id: number; action: 'initialize'; world: WorldState }
  | { id: number; action: 'generate'; config: WorldConfig }
  | { id: number; action: 'advance'; months: number }
  | { id: number; action: 'advanceUntilEvent'; maxMonths: number; minImportance: number }
  | { id: number; action: 'advanceUntilCharacterEvent'; characterId: number; maxMonths: number }
  | { id: number; action: 'snapshot' }
  | { id: number; action: 'setFocus'; x?: number; y?: number; level?: number; radius?: number }
  | { id: number; action: 'setWatchedCharacters'; characterIds: number[] }
  | { id: number; action: 'cancel'; targetId: number };

export type WorldWorkerMessage =
  | { id: number; type: 'progress'; progress: SimulationProgress }
  | { id: number; type: 'complete'; world?: WorldState; profile?: SimulationProfile; stoppedOnEventId?: number; stoppedOnCharacterEvent?: CharacterEventPointer; limitReached?: boolean }
  | { id: number; type: 'cancelled'; world?: WorldState; profile?: SimulationProfile; stoppedOnEventId?: number; stoppedOnCharacterEvent?: CharacterEventPointer; limitReached?: boolean }
  | { id: number; type: 'error'; error: string };

export interface WorldWorkerResult {
  world?: WorldState;
  profile?: SimulationProfile;
  cancelled?: boolean;
  stoppedOnEventId?: number;
  stoppedOnCharacterEvent?: CharacterEventPointer;
  limitReached?: boolean;
}
