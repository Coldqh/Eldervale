export type SettlementExpeditionStatus = 'forming' | 'traveling' | 'camped' | 'returning' | 'founded' | 'failed' | 'returned';
export type SettlementExpeditionCause = 'overcrowding' | 'land-shortage' | 'unemployment' | 'religious-conflict' | 'war' | 'resource-search' | 'royal-charter';

export interface ExpeditionRoutePoint {
  x: number;
  y: number;
}

export interface SettlementExpeditionSupplies {
  foodPersonDays: number;
  timber: number;
  tools: number;
  seedGrain: number;
  livestock: number;
  coin: number;
}

export interface SettlementExpedition {
  id: number;
  originSettlementId: number;
  sponsorKingdomId: number;
  civilizationId?: number;
  cultureId?: number;
  leaderCharacterId: number;
  memberIds: number[];
  householdIds: number[];
  status: SettlementExpeditionStatus;
  cause: SettlementExpeditionCause;
  reason: string;
  formedTick: number;
  departedTick?: number;
  arrivedTick?: number;
  resolvedTick?: number;
  currentX: number;
  currentY: number;
  destinationX: number;
  destinationY: number;
  route: ExpeditionRoutePoint[];
  routeIndex: number;
  campProgress: number;
  morale: number;
  supplies: SettlementExpeditionSupplies;
  knownTechnologyIds: string[];
  foundedSettlementId?: number;
  failureReason?: string;
  history: string[];
}
