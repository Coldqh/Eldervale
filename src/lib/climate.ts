import type { Settlement, WorldState } from '../types';
import type {
  ClimateSeason, ClimateSystemState, NaturalCrisis, NaturalCrisisKind, SettlementClimateState, WeatherKind,
} from '../climateTypes';

export interface ClimateWorldSnapshot {
  season: ClimateSeason;
  averageTemperature: number;
  averagePrecipitation: number;
  activeCrises: NaturalCrisis[];
  worstSettlement?: SettlementClimateState;
  settlements: SettlementClimateState[];
}

export function climateState(world: WorldState): ClimateSystemState | undefined {
  return world.simulation.climate;
}

export function settlementClimate(world: WorldState, settlementId: number): SettlementClimateState | undefined {
  return world.simulation.climate?.settlements.find(item => item.settlementId === settlementId);
}

export function activeClimateCrises(world: WorldState): NaturalCrisis[] {
  return (world.simulation.climate?.crises ?? [])
    .filter(item => item.status !== 'завершён')
    .sort((a, b) => b.severity - a.severity || b.startedTick - a.startedTick);
}

export function climateSnapshot(world: WorldState): ClimateWorldSnapshot {
  const settlements = world.simulation.climate?.settlements ?? [];
  const season = settlements[0]?.season ?? seasonForMonth(world.month);
  const averageTemperature = average(settlements.map(item => item.temperature));
  const averagePrecipitation = average(settlements.map(item => item.precipitation));
  const worstSettlement = [...settlements].sort((a, b) => climatePressure(b) - climatePressure(a))[0];
  return { season, averageTemperature, averagePrecipitation, activeCrises: activeClimateCrises(world), worstSettlement, settlements };
}

export function settlementForClimate(world: WorldState, state: SettlementClimateState): Settlement | undefined {
  return world.settlements.find(item => item.id === state.settlementId);
}

export function crisisForSettlement(world: WorldState, settlementId: number): NaturalCrisis[] {
  return activeClimateCrises(world).filter(item => item.settlementIds.includes(settlementId));
}

export function seasonForMonth(month: number): ClimateSeason {
  if (month === 12 || month <= 2) return 'зима';
  if (month <= 5) return 'весна';
  if (month <= 8) return 'лето';
  return 'осень';
}

export function weatherIcon(weather: WeatherKind): string {
  return ({
    'ясно': '☀', 'облачно': '☁', 'дождь': '☂', 'ливень': '☔', 'снег': '❄', 'метель': '✣',
    'жара': '☼', 'мороз': '✧', 'засуха': '◌', 'шторм': 'ϟ', 'паводок': '≈',
  } as const)[weather];
}

export function crisisIcon(kind: NaturalCrisisKind): string {
  return ({ 'засуха': '◌', 'паводок': '≈', 'сильный мороз': '✧', 'аномальная жара': '☼', 'шторм': 'ϟ', 'неурожай': '⌁' } as const)[kind];
}

export function climatePressure(state: SettlementClimateState): number {
  return Math.max(state.harvestPressure, state.waterStress, state.diseasePressure * .8, state.migrationPressure * .9, 100 - state.roadCondition);
}

export function climateRiskLabel(value: number): string {
  if (value >= 80) return 'критический';
  if (value >= 60) return 'тяжёлый';
  if (value >= 35) return 'заметный';
  return 'низкий';
}

export function climateMapPosition(world: WorldState, settlementId: number): { left: string; top: string } {
  const settlement = world.settlements.find(item => item.id === settlementId);
  if (!settlement) return { left: '50%', top: '50%' };
  const left = (settlement.x + .5) / Math.max(1, world.config.width) * 100;
  const top = (settlement.y + .5) / Math.max(1, world.config.height) * 100;
  return { left: `${left}%`, top: `${top}%` };
}

function average(values: number[]): number {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : 0;
}
