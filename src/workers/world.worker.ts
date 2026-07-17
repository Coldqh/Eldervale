/// <reference lib="webworker" />
import type { SimulationProfile, SimulationProgress, WorldState } from '../types';
import type { WorldWorkerCommand, WorldWorkerMessage } from '../lib/worldWorkerProtocol';
import { generateHistoricalWorld } from '../sim/historicalEngine';
import { advanceOneMonth, createSimulationEngine, monthsToNextQuarter, resetSimulationProfiler, simulationPhaseProfile, type SimulationEngine } from '../sim/simulation';
import { countIndexedEntities } from '../sim/indexes';

const scope = self as DedicatedWorkerGlobalScope;
let engine: SimulationEngine | undefined;
let activeOperationId: number | undefined;
let cancelRequestedFor: number | undefined;
let lastProfile: SimulationProfile | undefined;

const post = (message: WorldWorkerMessage) => scope.postMessage(message);
const yieldToWorker = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function progressMessage(
  operation: SimulationProgress['operation'],
  phase: string,
  completed: number,
  total: number,
  startedAt: number,
  extra: Partial<SimulationProgress> = {},
): SimulationProgress {
  const elapsedMs = performance.now() - startedAt;
  const percent = total > 0 ? Math.max(0, Math.min(100, completed / total * 100)) : 0;
  const etaMs = completed > 0 && completed < total ? elapsedMs / completed * (total - completed) : undefined;
  return { operation, phase, completed, total, percent, elapsedMs, etaMs, ...extra };
}

async function initialize(message: Extract<WorldWorkerCommand, { action: 'initialize' }>): Promise<void> {
  const startedAt = performance.now();
  post({ id: message.id, type: 'progress', progress: progressMessage('загрузка', 'Построение индексов мира', 0, 1, startedAt) });
  engine = createSimulationEngine(message.world);
  const profile: SimulationProfile = {
    operation: 'загрузка', totalMs: performance.now() - startedAt, indexedEntities: countIndexedEntities(engine.indexes),
    activeRegions: engine.world.simulation.activeRegionKeys.length, sleepingRegions: engine.world.simulation.sleepingRegionCount, generatedAt: Date.now(),
  };
  lastProfile = profile;
  engine.world.simulation.lastProfile = profile;
  post({ id: message.id, type: 'complete', profile });
}

async function generate(message: Extract<WorldWorkerCommand, { action: 'generate' }>): Promise<void> {
  activeOperationId = message.id;
  cancelRequestedFor = undefined;
  const startedAt = performance.now();
  const world = generateHistoricalWorld(message.config, (phase, completed, total, detail) => {
    const operation: SimulationProgress['operation'] = phase.includes('История') || phase.includes('истории') || phase.includes('эпох') || phase.includes('Связывание') ? 'история' : 'генерация';
    const scaled = Math.min(97, completed / Math.max(1, total) * 97);
    post({ id: message.id, type: 'progress', progress: progressMessage(operation, phase, scaled, 100, startedAt, { detail }) });
  });
  post({ id: message.id, type: 'progress', progress: progressMessage('генерация', 'Индексируем созданный мир', 98, 100, startedAt) });
  engine = createSimulationEngine(world);
  const totalMs = performance.now() - startedAt;
  const profile: SimulationProfile = {
    operation: 'генерация', totalMs, simulationMs: totalMs, indexedEntities: countIndexedEntities(engine.indexes), processedTasks: 0,
    activeRegions: world.simulation.activeRegionKeys.length, sleepingRegions: world.simulation.sleepingRegionCount, generatedAt: Date.now(),
  };
  lastProfile = profile;
  activeOperationId = undefined;
  post({ id: message.id, type: 'progress', progress: progressMessage('генерация', 'Передаём мир приложению', 99, 100, startedAt) });
  post({ id: message.id, type: 'complete', world, profile });
  // Главный поток уже получил structured-clone копию. Не держим второй
  // полный мир и его индексы во время тяжёлого первого сохранения.
  engine = undefined;
}

async function advance(message: Extract<WorldWorkerCommand, { action: 'advance' }>): Promise<void> {
  if (!engine) throw new Error('Мир не загружен в движок симуляции');
  activeOperationId = message.id;
  cancelRequestedFor = undefined;
  const startedAt = performance.now();
  const startTasks = engine.processedTasks;
  resetSimulationProfiler(engine);
  const fastForward = message.months >= 12;
  let movingAverageMs = 0;
  let lastPhase = 'Подготовка планировщика';
  let completedMonths = 0;

  post({ id: message.id, type: 'progress', progress: progressMessage('симуляция', lastPhase, 0, message.months, startedAt, { year: engine.world.year, month: engine.world.month }) });

  while (completedMonths < message.months) {
    if (cancelRequestedFor === message.id) {
      const elapsed = performance.now() - startedAt;
      const profile: SimulationProfile = {
        operation: 'симуляция', months: completedMonths, totalMs: elapsed, simulationMs: elapsed, indexedEntities: countIndexedEntities(engine.indexes),
        processedTasks: engine.processedTasks - startTasks, activeRegions: engine.world.simulation.activeRegionKeys.length,
        sleepingRegions: engine.world.simulation.sleepingRegionCount, generatedAt: Date.now(),
        fastForward, exactMonths: engine.exactMonths, coarseMonths: engine.coarseMonths, phaseTimings: simulationPhaseProfile(engine),
      };
      lastProfile = profile;
      activeOperationId = undefined;
      cancelRequestedFor = undefined;
      post({ id: message.id, type: 'cancelled', world: engine.world, profile });
      return;
    }

    const monthStarted = performance.now();
    const monthStep = fastForward ? Math.min(message.months - completedMonths, monthsToNextQuarter(engine.world.month)) : 1;
    advanceOneMonth(engine, phase => { lastPhase = phase; }, { fastForward, monthStep });
    const monthMs = performance.now() - monthStarted;
    const normalizedMonthMs = monthMs / monthStep;
    movingAverageMs = movingAverageMs ? movingAverageMs * .72 + normalizedMonthMs * .28 : normalizedMonthMs;
    completedMonths += monthStep;
    const etaMs = Math.max(0, movingAverageMs * (message.months - completedMonths));
    post({
      id: message.id,
      type: 'progress',
      progress: {
        operation: 'симуляция', phase: lastPhase, completed: completedMonths, total: message.months, percent: completedMonths / message.months * 100,
        elapsedMs: performance.now() - startedAt, etaMs, year: engine.world.year, month: engine.world.month,
        detail: `Активных регионов: ${engine.world.simulation.activeRegionKeys.length} · в очереди: ${engine.world.simulation.queuedActions.length}`,
      },
    });
    await yieldToWorker();
  }

  const simulationMs = performance.now() - startedAt;
  const profile: SimulationProfile = {
    operation: 'симуляция', months: message.months, totalMs: simulationMs, simulationMs, indexedEntities: countIndexedEntities(engine.indexes),
    processedTasks: engine.processedTasks - startTasks, activeRegions: engine.world.simulation.activeRegionKeys.length,
    sleepingRegions: engine.world.simulation.sleepingRegionCount, generatedAt: Date.now(),
    fastForward, exactMonths: engine.exactMonths, coarseMonths: engine.coarseMonths, phaseTimings: simulationPhaseProfile(engine),
  };
  lastProfile = profile;
  engine.world.simulation.lastProfile = profile;
  activeOperationId = undefined;
  post({ id: message.id, type: 'complete', world: engine.world, profile });
}

scope.onmessage = event => {
  const message = event.data as WorldWorkerCommand;
  if (message.action === 'cancel') {
    if (activeOperationId === message.targetId) cancelRequestedFor = message.targetId;
    return;
  }

  void (async () => {
    try {
      if (message.action === 'initialize') await initialize(message);
      else if (message.action === 'generate') await generate(message);
      else if (message.action === 'advance') await advance(message);
      else if (message.action === 'setFocus') {
        if (engine) engine.world.simulation.observerFocus = typeof message.x === 'number' && typeof message.y === 'number' ? { x: message.x, y: message.y, level: message.level ?? 0, radius: message.radius ?? 1 } : undefined;
        post({ id: message.id, type: 'complete' });
      }
      else if (message.action === 'snapshot') {
        if (!engine) throw new Error('Мир не загружен');
        post({ id: message.id, type: 'complete', world: engine.world, profile: lastProfile });
      }
    } catch (error) {
      activeOperationId = undefined;
      post({ id: message.id, type: 'error', error: error instanceof Error ? error.message : 'Неизвестная ошибка симуляции' });
    }
  })();
};

export {};
