export type ClimateSeason = 'зима' | 'весна' | 'лето' | 'осень';
export type WeatherKind = 'ясно' | 'облачно' | 'дождь' | 'ливень' | 'снег' | 'метель' | 'жара' | 'мороз' | 'засуха' | 'шторм' | 'паводок';
export type NaturalCrisisKind = 'засуха' | 'паводок' | 'сильный мороз' | 'аномальная жара' | 'шторм' | 'неурожай';
export type NaturalCrisisStatus = 'развивается' | 'пик' | 'спад' | 'завершён';

export interface ClimateHistoryEntry {
  tick: number;
  year: number;
  month: number;
  weather: WeatherKind;
  temperature: number;
  precipitation: number;
  summary: string;
}

export interface SettlementClimateState {
  settlementId: number;
  season: ClimateSeason;
  weather: WeatherKind;
  temperature: number;
  precipitation: number;
  moisture: number;
  snowCover: number;
  wind: number;
  roadCondition: number;
  harvestPressure: number;
  waterStress: number;
  diseasePressure: number;
  migrationPressure: number;
  anomaly: number;
  lastTick: number;
  history: ClimateHistoryEntry[];
}

export interface NaturalCrisis {
  id: string;
  kind: NaturalCrisisKind;
  settlementIds: number[];
  startedTick: number;
  endedTick?: number;
  severity: number;
  peakSeverity: number;
  status: NaturalCrisisStatus;
  cause: string;
  effects: string[];
  history: string[];
}

export interface ClimateSystemState {
  version: 1;
  lastTick: number;
  settlements: SettlementClimateState[];
  crises: NaturalCrisis[];
  history: ClimateHistoryEntry[];
}

declare module './types' {
  interface SimulationRuntimeState {
    climateSystemVersion?: 1;
    climate?: ClimateSystemState;
    lastClimateTick?: number;
  }
}
