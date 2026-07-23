import type { DecisionOptionScore } from './types';

export type InstitutionDecisionKind =
  | 'city-project'
  | 'trade-contract'
  | 'technology-research'
  | 'state-foundation';

export type InstitutionKind =
  | 'settlement-government'
  | 'merchant-consortium'
  | 'workshop-circle'
  | 'political-community';

export type InstitutionDecisionStatus =
  | 'proposed'
  | 'deliberating'
  | 'approved'
  | 'rejected'
  | 'deferred'
  | 'executed'
  | 'failed'
  | 'cancelled';

export interface InstitutionDecision {
  id: number;
  kind: InstitutionDecisionKind;
  proposalKey: string;
  institutionKind: InstitutionKind;
  institutionId: number;
  actorCharacterId: number;
  settlementId?: number;
  kingdomId?: number;
  communityId?: number;
  cityRequestId?: string;
  tradeContractId?: number;
  technologyId?: string;
  knownFactIds: number[];
  goal: string;
  optionScores: DecisionOptionScore[];
  chosenOptionId?: string;
  supporterCharacterIds: number[];
  opponentCharacterIds: number[];
  reservedMoney: number;
  reservedItemIds: number[];
  status: InstitutionDecisionStatus;
  createdTick: number;
  resolvedTick?: number;
  nextReviewTick?: number;
  decisionRecordId?: number;
  result?: string;
  history: string[];
}
