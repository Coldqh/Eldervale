export type RegionalResourceKind = 'mineral' | 'forest' | 'soil' | 'water' | 'herb';

export interface ResourceDeposit {
  id: number;
  x: number;
  y: number;
  templateId: string;
  kind: RegionalResourceKind;
  initialAmount: number;
  remaining: number;
  quality: number;
  extractionDifficulty: number;
  renewable: boolean;
  regenerationPerYear: number;
  assignedSettlementId?: number;
  lastExtractionTick?: number;
  exhaustedYear?: number;
  history: string[];
}

export type SettlementSpecializationKind =
  | 'subsistence'
  | 'agriculture'
  | 'mining'
  | 'forestry'
  | 'fishing'
  | 'craft'
  | 'trade'
  | 'military'
  | 'scholarly';

export type RegionalEconomicCrisisKind =
  | 'raw-material-shortage'
  | 'food-import-shock'
  | 'trade-blockade'
  | 'deposit-exhaustion'
  | 'production-collapse';

export interface SettlementRegionalEconomy {
  settlementId: number;
  specialization: SettlementSpecializationKind;
  secondarySpecialization?: SettlementSpecializationKind;
  localDepositIds: number[];
  criticalImportTemplateIds: string[];
  exportTemplateIds: string[];
  importReliance: number;
  marketAccess: number;
  productionCapacity: number;
  activeCrisis?: RegionalEconomicCrisisKind;
  crisisMonths: number;
  lastEvaluatedTick: number;
  history: string[];
}

export type TradeContractStatus = 'active' | 'suspended' | 'fulfilled' | 'cancelled';

export interface TradeContract {
  id: number;
  routeId: number;
  fromSettlementId: number;
  toSettlementId: number;
  templateId: string;
  targetQuantity: number;
  minimumDestinationStock: number;
  maxUnitPrice: number;
  priority: number;
  status: TradeContractStatus;
  createdTick: number;
  lastShipmentTick?: number;
  disruptedSinceTick?: number;
  cause?: string;
  history: string[];
}
