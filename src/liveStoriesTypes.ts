import type { EntityRef, PersonalGoalKind } from './types';

export type CharacterStoryEventSource = 'personal' | 'world' | 'memory';

export interface CharacterEventCursor {
  personalEventId: number;
  worldEventId: number;
  memoryId: number;
}

export interface CharacterEventPointer {
  source: CharacterStoryEventSource;
  id: number;
}

export interface CharacterStoryEvent {
  key: string;
  source: CharacterStoryEventSource;
  sourceId: number;
  tick: number;
  year: number;
  month: number;
  title: string;
  description: string;
  importance: number;
  refs: EntityRef[];
}

export interface CharacterLifePlan {
  kind: PersonalGoalKind;
  title: string;
  reason: string;
  priority: number;
  progress: number;
  status: 'active' | 'blocked' | 'completed' | 'ended';
  currentStage: string;
  nextAction: string;
  completedSteps: string[];
  remainingSteps: string[];
  blockers: string[];
  targetRef?: EntityRef;
}

export interface CharacterBiography {
  years: string;
  summary: string;
  milestones: string[];
  legacy: string[];
  relativeRefs: EntityRef[];
  burialRef?: EntityRef;
}

export interface CharacterStorySnapshot {
  characterId: number;
  name: string;
  alive: boolean;
  profession: string;
  settlementId?: number;
  plan: CharacterLifePlan;
  timeline: CharacterStoryEvent[];
  biography: CharacterBiography;
}
