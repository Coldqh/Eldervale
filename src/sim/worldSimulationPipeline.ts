import type { WorldState } from '../types';
import { advanceClimateSystem, initializeClimateSystem } from './climateSystem';
import { advanceDailyLife, initializeDailyLife } from './dailyLife';
import { advanceDynastyLegacy, initializeDynastyLegacy } from './dynastyLegacy';
import {
  advanceOneMonth, createSimulationEngine, monthsToNextQuarter, type SimulationEngine,
} from './simulation';
import { advanceRaceDemography, initializeRaceDemography } from './raceDemography';
import { RNG } from './rng';

export interface WorldSystemEngineOptions {
  primeDailyLife?: boolean;
}

export interface WorldSystemAdvanceOptions {
  fastForward?: boolean;
  monthStep?: number;
  forceCharacterIds?: readonly number[];
  onPhase?: (phase: string) => void;
}

/**
 * Единственная точка инициализации систем, которые живут поверх базового ядра мира.
 * Worker, fallback и прямые прогоны обязаны использовать один и тот же порядок.
 */
export function initializeWorldSystems(world: WorldState): void {
  initializeDailyLife(world);
  initializeDynastyLegacy(world);
  initializeClimateSystem(world);
  initializeRaceDemography(world);
}

export function createWorldSystemEngine(
  world: WorldState,
  options: WorldSystemEngineOptions = {},
): SimulationEngine {
  initializeWorldSystems(world);
  const engine = createSimulationEngine(world);
  if (options.primeDailyLife) {
    advanceDailyLife(
      world,
      new RNG(`${world.config.seed}:повседневность:${world.year}:${world.month}`),
      engine.indexes,
      { recordEvents: false },
    );
  }
  synchronizeSettlementPopulation(engine);
  return engine;
}

/**
 * Полный ход мира. Никакой вызывающий код не должен вручную повторять эти системы.
 */
export function advanceWorldSystems(
  engine: SimulationEngine,
  options: WorldSystemAdvanceOptions = {},
): number {
  const fastForward = Boolean(options.fastForward);
  const monthStep = Math.max(1, Math.min(3, Math.floor(options.monthStep ?? 1)));
  const onPhase = options.onPhase;

  advanceOneMonth(engine, onPhase, { fastForward, monthStep });

  onPhase?.('Климат, сезоны и природное давление');
  advanceClimateSystem(engine.world, { elapsedMonths: monthStep });

  onPhase?.('Население, семьи и переселения');
  advanceRaceDemography(engine.world, { elapsedMonths: monthStep, indexes: engine.indexes });

  onPhase?.('Повседневная жизнь жителей');
  advanceDailyLife(
    engine.world,
    new RNG(`${engine.world.config.seed}:повседневность:${engine.world.year}:${engine.world.month}`),
    engine.indexes,
    {
      elapsedMonths: monthStep,
      forceCharacterIds: [...new Set(options.forceCharacterIds ?? [])],
    },
  );

  onPhase?.('Династии, поколения и наследие');
  advanceDynastyLegacy(engine.world, { elapsedMonths: monthStep });

  synchronizeSettlementPopulation(engine);
  return monthStep;
}

/**
 * Детерминированный прямой прогон для тестов и серверных утилит.
 */
export function advanceWorldUnified(source: WorldState, months = 1): WorldState {
  const world = structuredClone(source);
  const engine = createWorldSystemEngine(world);
  const totalMonths = Math.max(0, Math.floor(months));
  const fastForward = totalMonths >= 12;
  let completed = 0;

  while (completed < totalMonths) {
    const monthStep = fastForward
      ? Math.min(totalMonths - completed, monthsToNextQuarter(engine.world.month))
      : 1;
    advanceWorldSystems(engine, { fastForward, monthStep });
    completed += monthStep;
  }
  return world;
}

function synchronizeSettlementPopulation(engine: SimulationEngine): void {
  for (const settlement of engine.world.settlements) {
    settlement.population = (engine.indexes.residentsBySettlement.get(settlement.id) ?? [])
      .reduce((sum, character) => sum + Number(character.alive), 0);
  }
}
