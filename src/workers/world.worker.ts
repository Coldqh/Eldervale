/// <reference lib="webworker" />
import type { SimulationProfile, SimulationProgress, WorldState } from '../types';
import type { WorldWorkerCommand, WorldWorkerMessage } from '../lib/worldWorkerProtocol';
import { generateHistoricalWorld } from '../sim/historicalEngine';
import { advanceOneMonth, createSimulationEngine, type SimulationEngine } from '../sim/simulation';
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
  post({ id: message.id, type: 'complete', profile });
}

async function generate(message: Extract<WorldWorkerCommand, { action: 'generate' }>): Promise<void> {
  activeOperationId = message.id;
  cancelRequestedFor = undefined;
  const startedAt = performance.now();
  const world = generateHistoricalWorld(message.config, (phase, completed, total, detail) => {
    const operation: SimulationProgress['operation'] = phase.includes('История') || phase.includes('истории') || phase.includes('эпох') || phase.includes('Связывание') ? 'история' : 'генерация';
    post({ id: message.id, type: 'progress', progress: progressMessage(operation, phase, completed, total, startedAt, { detail }) });
  });
  engine = createSimulationEngine(world);
  const totalMs = performance.now() - startedAt;
  const profile: SimulationProfile = {
    operation: 'генерация', totalMs, simulationMs: totalMs, indexedEntities: countIndexedEntities(engine.indexes), processedTasks: 0,
    activeRegions: world.simulation.activeRegionKeys.length, sleepingRegions: world.simulation.sleepingRegionCount, generatedAt: Date.now(),
  };
  lastProfile = profile;
  activeOperationId = undefined;
  post({ id: message.id, type: 'complete', world, profile });
}

async function advance(message: Extract<WorldWorkerCommand, { action: 'advance' }>): Promise<void> {
  if (!engine) throw new Error('Мир не загружен в движок симуляции');
  activeOperationId = message.id;
  cancelRequestedFor = undefined;
  const startedAt = performance.now();
  const startTasks = engine.processedTasks;
  let movingAverageMs = 0;
  let lastPhase = 'Подготовка планировщика';

  post({ id: message.id, type: 'progress', progress: progressMessage('симуляция', lastPhase, 0, message.months, startedAt, { year: engine.world.year, month: engine.world.month }) });

  for (let step = 0; step < message.months; step += 1) {
    if (cancelRequestedFor === message.id) {
      const elapsed = performance.now() - startedAt;
      const profile: SimulationProfile = {
        operation: 'симуляция', months: step, totalMs: elapsed, simulationMs: elapsed, indexedEntities: countIndexedEntities(engine.indexes),
        processedTasks: engine.processedTasks - startTasks, activeRegions: engine.world.simulation.activeRegionKeys.length,
        sleepingRegions: engine.world.simulation.sleepingRegionCount, generatedAt: Date.now(),
      };
      lastProfile = profile;
      activeOperationId = undefined;
      cancelRequestedFor = undefined;
      post({ id: message.id, type: 'cancelled', world: engine.world, profile });
      return;
    }

    const monthStarted = performance.now();
    advanceOneMonth(engine, phase => { lastPhase = phase; });
    const monthMs = performance.now() - monthStarted;
    movingAverageMs = movingAverageMs ? movingAverageMs * .72 + monthMs * .28 : monthMs;
    const completed = step + 1;
    const etaMs = Math.max(0, movingAverageMs * (message.months - completed));
    post({
      id: message.id,
      type: 'progress',
      progress: {
        operation: 'симуляция', phase: lastPhase, completed, total: message.months, percent: completed / message.months * 100,
        elapsedMs: performance.now() - startedAt, etaMs, year: engine.world.year, month: engine.world.month,
        detail: `Активных регионов: ${engine.world.simulation.activeRegionKeys.length} · в очереди: ${engine.world.simulation.queuedActions.length}`,
      },
    });
    if (completed % 2 === 0 || completed === message.months) await yieldToWorker();
  }

  const simulationMs = performance.now() - startedAt;
  const profile: SimulationProfile = {
    operation: 'симуляция', months: message.months, totalMs: simulationMs, simulationMs, indexedEntities: countIndexedEntities(engine.indexes),
    processedTasks: engine.processedTasks - startTasks, activeRegions: engine.world.simulation.activeRegionKeys.length,
    sleepingRegions: engine.world.simulation.sleepingRegionCount, generatedAt: Date.now(),
  };
  lastProfile = profile;
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
