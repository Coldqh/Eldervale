export type PoliticalCommunityKind =
  | 'crown-domain'
  | 'frontier-colony'
  | 'rural-council'
  | 'free-city'
  | 'city-league'
  | 'tribal-confederation';

export type PoliticalCommunityStatus =
  | 'integrated'
  | 'frontier'
  | 'autonomous'
  | 'independent'
  | 'organizing-state'
  | 'state-founded'
  | 'merged'
  | 'collapsed';

export type PoliticalTransitionKind =
  | 'integration'
  | 'autonomy'
  | 'independence'
  | 'league'
  | 'state-foundation'
  | 'voluntary-union'
  | 'tribute'
  | 'collapse';

export interface PoliticalCommunity {
  id: number;
  name: string;
  kind: PoliticalCommunityKind;
  status: PoliticalCommunityStatus;
  settlementIds: number[];
  originKingdomId: number;
  currentKingdomId: number;
  civilizationId?: number;
  cultureId?: number;
  leaderCharacterId: number;
  authority: number;
  cohesion: number;
  autonomy: number;
  legitimacy: number;
  treasury: number;
  militarySupport: number;
  independencePressure: number;
  createdTick: number;
  lastAdvancedTick: number;
  foundedKingdomId?: number;
  successorCommunityId?: number;
  history: string[];
}

export interface PoliticalTransition {
  id: number;
  kind: PoliticalTransitionKind;
  communityId: number;
  settlementIds: number[];
  fromKingdomId?: number;
  toKingdomId?: number;
  leaderCharacterId?: number;
  tick: number;
  cause: string;
  outcome: string;
}
