import type { EntityRef } from './types';

export type DynastyMilestoneKind = 'succession' | 'birth' | 'marriage' | 'branch' | 'extinction' | 'restoration';

export interface DynastyMilestone {
  id: string;
  kind: DynastyMilestoneKind;
  year: number;
  month: number;
  title: string;
  description: string;
  characterIds: number[];
  relatedRefs: EntityRef[];
  importance: 0 | 1 | 2 | 3 | 4;
}

export interface DynastySuccessionRecord {
  id: string;
  year: number;
  month: number;
  previousHeadId?: number;
  newHeadId?: number;
  reason: 'смерть' | 'исчезновение' | 'восстановление' | 'первое избрание';
  generation: number;
}

export interface DynastyBranchRecord {
  id: string;
  founderId: number;
  name: string;
  kind: 'главная' | 'младшая';
  headId?: number;
  memberIds: number[];
  livingMemberIds: number[];
  generationDepth: number;
  prestige: number;
  status: 'действует' | 'угасла';
}

export interface DynastyAllianceRecord {
  id: string;
  otherDynastyId: number;
  characterIds: [number, number];
  sinceYear: number;
  active: boolean;
}

export interface DynastyGenerationGroup {
  generation: number;
  memberIds: number[];
  livingMemberIds: number[];
}

export interface DynastyLegacySnapshot {
  dynastyId: number;
  name: string;
  motto: string;
  founderId: number;
  headId?: number;
  heirId?: number;
  kingdomId?: number;
  livingMemberIds: number[];
  deceasedMemberIds: number[];
  notableMemberIds: number[];
  generation: number;
  generationDepth: number;
  legacyScore: number;
  prestige: number;
  wealth: number;
  extinct: boolean;
  extinctYear?: number;
  generations: DynastyGenerationGroup[];
  branches: DynastyBranchRecord[];
  alliances: DynastyAllianceRecord[];
  successions: DynastySuccessionRecord[];
  milestones: DynastyMilestone[];
}

declare module './types' {
  interface Dynasty {
    heirId?: number;
    motto?: string;
    generation?: number;
    generationDepth?: number;
    legacyScore?: number;
    branchRecords?: DynastyBranchRecord[];
    allianceRecords?: DynastyAllianceRecord[];
    successionHistory?: DynastySuccessionRecord[];
    milestones?: DynastyMilestone[];
    notableMemberIds?: number[];
    knownMemberIds?: number[];
    knownMarriageKeys?: string[];
    extinctYear?: number;
    lastLegacyTick?: number;
  }

  interface SimulationRuntimeState {
    dynastyLegacyVersion?: 1;
    lastDynastyLegacyTick?: number;
  }
}
