import type { EntityRef } from './types';

export type DayPhase = 'morning' | 'day' | 'evening' | 'night';
export type DailyPlaceKind = 'home' | 'work' | 'market' | 'tavern' | 'temple' | 'healer' | 'school' | 'prison' | 'barracks' | 'street';
export type PersonalLifeEventKind = 'routine' | 'meeting' | 'work' | 'family' | 'need' | 'faith' | 'health' | 'conflict' | 'goal';

export interface DailyRoutineStop {
  phase: DayPhase;
  activity: string;
  placeKind: DailyPlaceKind;
  placeLabel: string;
  settlementId: number;
  globalX: number;
  globalY: number;
  localX: number;
  localY: number;
  buildingId?: number;
  establishmentId?: number;
  interiorFloor?: number;
  interiorRoomId?: string;
  interiorFixtureId?: string;
}

export interface DailyRoutine {
  characterId: number;
  tick: number;
  year: number;
  month: number;
  stops: DailyRoutineStop[];
}

export interface PersonalLifeEvent {
  id: number;
  characterId: number;
  otherCharacterIds: number[];
  tick: number;
  year: number;
  month: number;
  phase: DayPhase;
  kind: PersonalLifeEventKind;
  title: string;
  description: string;
  settlementId: number;
  relatedRefs: EntityRef[];
  importance: 0 | 1 | 2;
}

declare module './types' {
  interface WorldState {
    dailyRoutines?: DailyRoutine[];
    personalLifeEvents?: PersonalLifeEvent[];
  }

  interface SimulationRuntimeState {
    dailyLifeVersion?: 1;
    lastDailyLifeTick?: number;
  }

  interface CharacterSchedule {
    lastRoutineTick?: number;
  }
}
