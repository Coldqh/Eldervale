export type TechnologyKnowledgeLevel = 'theoretical' | 'practiced' | 'institutional' | 'lost';

export type TechnologyTransmissionMode = 'discovery' | 'migration' | 'apprenticeship' | 'book' | 'trade' | 'founding' | 'migration-import';

export interface SettlementTechnologyKnowledge {
  id: number;
  settlementId: number;
  technologyId: string;
  level: TechnologyKnowledgeLevel;
  mastery: number;
  practitionerIds: number[];
  apprenticeIds: number[];
  institutionBuildingIds: number[];
  bookIds: number[];
  sourceSettlementId?: number;
  lastPracticedYear: number;
  active: boolean;
  history: string[];
}

export interface TechnologyTransmission {
  id: number;
  technologyId: string;
  fromSettlementId?: number;
  toSettlementId: number;
  carrierCharacterId?: number;
  bookId?: number;
  mode: TechnologyTransmissionMode;
  startedTick: number;
  completedTick?: number;
  status: 'active' | 'completed' | 'failed';
  outcome?: string;
  history: string[];
}
