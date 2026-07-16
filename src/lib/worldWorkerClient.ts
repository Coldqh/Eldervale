import type { SimulationProfile, SimulationProgress, WorldConfig, WorldState } from '../types';
import type { WorldWorkerCommand, WorldWorkerMessage, WorldWorkerResult } from './worldWorkerProtocol';
import { generateHistoricalWorld } from '../sim/historicalEngine';
import { advanceOneMonth, createSimulationEngine, type SimulationEngine } from '../sim/simulation';
import { countIndexedEntities } from '../sim/indexes';

type WorldWorkerCommandInput = WorldWorkerCommand extends infer Command
  ? Command extends { id: number }
    ? Omit<Command, 'id'>
    : never
  : never;

let nextId = 1;
let worker: Worker | undefined;
let currentOperationId: number | undefined;
let fallbackEngine: SimulationEngine | undefined;
let fallbackCancelled = false;
let fallbackProfile: SimulationProfile | undefined;
let workerHasWorld = false;
let lastKnownWorld: WorldState | undefined;
let pendingFocus: { x?: number; y?: number; level?: number; radius?: number } | undefined;

interface PendingRequest {
  resolve: (result: WorldWorkerResult) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: SimulationProgress) => void;
  action: WorldWorkerCommandInput['action'];
}

const pending = new Map<number, PendingRequest>();

function getWorker(): Worker | undefined {
  if (typeof Worker === 'undefined') return undefined;
  if (worker) return worker;
  worker = new Worker(new URL('../workers/world.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorldWorkerMessage>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    if (event.data.type === 'progress') {
      request.onProgress?.(event.data.progress);
      return;
    }
    pending.delete(event.data.id);
    if (currentOperationId === event.data.id) currentOperationId = undefined;
    if (event.data.type === 'error') request.reject(new Error(event.data.error));
    else {
      if (request.action === 'initialize') workerHasWorld = true;
      if (request.action === 'generate') workerHasWorld = false;
      if (event.data.world) lastKnownWorld = event.data.world;
      request.resolve({ world: event.data.world, profile: event.data.profile, cancelled: event.data.type === 'cancelled' });
    }
  };
  worker.onerror = () => {
    for (const request of pending.values()) request.reject(new Error('Фоновая симуляция остановилась'));
    pending.clear();
    currentOperationId = undefined;
    workerHasWorld = false;
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}

function runWorker(command: WorldWorkerCommandInput, onProgress?: (progress: SimulationProgress) => void): Promise<WorldWorkerResult> {
  const activeWorker = getWorker();
  if (!activeWorker) return runFallback(command, onProgress);
  const id = nextId++;
  if (command.action === 'generate' || command.action === 'advance') currentOperationId = id;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress, action: command.action });
    activeWorker.postMessage({ ...command, id } as WorldWorkerCommand);
  });
}

async function runFallback(command: WorldWorkerCommandInput, onProgress?: (progress: SimulationProgress) => void): Promise<WorldWorkerResult> {
  const startedAt = performance.now();
  if (command.action === 'initialize') {
    fallbackEngine = createSimulationEngine(command.world);
    return { profile: { operation: 'загрузка', totalMs: performance.now() - startedAt, indexedEntities: countIndexedEntities(fallbackEngine.indexes), generatedAt: Date.now() } };
  }
  if (command.action === 'generate') {
    const world = generateHistoricalWorld(command.config, (phase, completed, total, detail) => {
      const elapsedMs = performance.now() - startedAt;
      const operation: SimulationProgress['operation'] = phase.includes('История') || phase.includes('истории') || phase.includes('эпох') || phase.includes('Связывание') ? 'история' : 'генерация';
      const capped = Math.min(94, completed / Math.max(1, total) * 94);
      onProgress?.({ operation, phase, completed: capped, total: 100, percent: capped, elapsedMs, etaMs: completed ? elapsedMs / completed * (total - completed) : undefined, detail });
    });
    fallbackEngine = createSimulationEngine(world);
    const profile: SimulationProfile = { operation: 'генерация', totalMs: performance.now() - startedAt, simulationMs: performance.now() - startedAt, indexedEntities: countIndexedEntities(fallbackEngine.indexes), generatedAt: Date.now() };
    fallbackProfile = profile;
    return { world, profile };
  }
  if (command.action === 'advance') {
    if (!fallbackEngine) throw new Error('Мир не загружен в движок симуляции');
    fallbackCancelled = false;
    let average = 0;
    const startTasks = fallbackEngine.processedTasks;
    for (let step = 0; step < command.months; step += 1) {
      if (fallbackCancelled) return { world: fallbackEngine.world, cancelled: true };
      const monthStart = performance.now();
      let phase = 'Симуляция мира';
      advanceOneMonth(fallbackEngine, value => { phase = value; });
      const monthMs = performance.now() - monthStart;
      average = average ? average * .72 + monthMs * .28 : monthMs;
      const completed = step + 1;
      onProgress?.({ operation: 'симуляция', phase, completed, total: command.months, percent: completed / command.months * 100, elapsedMs: performance.now() - startedAt, etaMs: average * (command.months - completed), year: fallbackEngine.world.year, month: fallbackEngine.world.month });
      if (completed % 2 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    const profile: SimulationProfile = {
      operation: 'симуляция', months: command.months, totalMs: performance.now() - startedAt, simulationMs: performance.now() - startedAt,
      indexedEntities: countIndexedEntities(fallbackEngine.indexes), processedTasks: fallbackEngine.processedTasks - startTasks,
      activeRegions: fallbackEngine.world.simulation.activeRegionKeys.length, sleepingRegions: fallbackEngine.world.simulation.sleepingRegionCount, generatedAt: Date.now(),
    };
    fallbackProfile = profile;
    return { world: fallbackEngine.world, profile };
  }
  if (command.action === 'snapshot') return { world: fallbackEngine?.world, profile: fallbackProfile };
  if (command.action === 'setFocus') {
    pendingFocus = { x: command.x, y: command.y, level: command.level, radius: command.radius };
    if (fallbackEngine) fallbackEngine.world.simulation.observerFocus = typeof command.x === 'number' && typeof command.y === 'number' ? { x: command.x, y: command.y, level: command.level ?? 0, radius: command.radius ?? 1 } : undefined;
    return {};
  }
  return {};
}

export async function initializeWorldInBackground(world: WorldState, onProgress?: (progress: SimulationProgress) => void): Promise<SimulationProfile | undefined> {
  lastKnownWorld = world;
  const result = await runWorker({ action: 'initialize', world }, onProgress);
  if (pendingFocus) await runWorker({ action: 'setFocus', ...pendingFocus });
  return result.profile;
}

export async function generateWorldInBackground(config: WorldConfig, onProgress?: (progress: SimulationProgress) => void): Promise<WorldWorkerResult> {
  const result = await runWorker({ action: 'generate', config }, onProgress);
  if (result.world) lastKnownWorld = result.world;
  return result;
}

export async function advanceWorldInBackground(months: number, onProgress?: (progress: SimulationProgress) => void): Promise<WorldWorkerResult> {
  if (getWorker() && !workerHasWorld && lastKnownWorld) await initializeWorldInBackground(lastKnownWorld);
  const result = await runWorker({ action: 'advance', months }, onProgress);
  if (result.world) lastKnownWorld = result.world;
  return result;
}

export async function setWorldFocusInBackground(focus?: { x: number; y: number; level?: number; radius?: number }): Promise<void> {
  pendingFocus = focus ? { x: focus.x, y: focus.y, level: focus.level ?? 0, radius: focus.radius ?? 1 } : {};
  await runWorker({ action: 'setFocus', ...(pendingFocus ?? {}) });
  if (lastKnownWorld) lastKnownWorld.simulation.observerFocus = focus ? { x: focus.x, y: focus.y, level: focus.level ?? 0, radius: focus.radius ?? 1 } : undefined;
}

export async function snapshotWorldInBackground(): Promise<WorldState | undefined> {
  return (await runWorker({ action: 'snapshot' })).world;
}

export function cancelWorldOperation(): void {
  fallbackCancelled = true;
  const activeWorker = getWorker();
  if (!activeWorker || currentOperationId === undefined) return;
  activeWorker.postMessage({ id: nextId++, action: 'cancel', targetId: currentOperationId } satisfies WorldWorkerCommand);
}
