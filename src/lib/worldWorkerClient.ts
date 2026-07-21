import type { SimulationProfile, SimulationProgress, WorldConfig, WorldState } from '../types';
import type { WorldWorkerCommand, WorldWorkerMessage, WorldWorkerResult } from './worldWorkerProtocol';
import { generateHistoricalWorld } from '../sim/historicalEngine';
import { advanceOneMonth, createSimulationEngine, monthsToNextQuarter, resetSimulationProfiler, simulationPhaseProfile, type SimulationEngine } from '../sim/simulation';
import { countIndexedEntities } from '../sim/indexes';
import { createInactivityWatchdog, workerInactivityTimeout, type InactivityWatchdog, type WorkerOperation } from './workerWatchdog';
import { latestEventId, nextImportantEventId } from './nextEvent';
import { latestCharacterEventCursor, nextCharacterEvent } from './liveStories';
import { advanceDailyLife, initializeDailyLife } from '../sim/dailyLife';
import { RNG } from '../sim/rng';
import { advanceDynastyLegacy, initializeDynastyLegacy } from '../sim/dynastyLegacy';
import { advanceClimateSystem, initializeClimateSystem } from '../sim/climateSystem';
import { advanceRaceDemography, initializeRaceDemography } from '../sim/raceDemography';

type WorldWorkerCommandInput = WorldWorkerCommand extends infer Command
  ? Command extends { id: number; action: infer Action }
    ? Action extends 'cancel'
      ? never
      : Omit<Command, 'id'>
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
let pendingWatchedCharacterIds: number[] = [];

interface PendingRequest {
  resolve: (result: WorldWorkerResult) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: SimulationProgress) => void;
  action: WorldWorkerCommandInput['action'];
  watchdog: InactivityWatchdog;
}

const pending = new Map<number, PendingRequest>();

function operationLabel(action: PendingRequest['action']): string {
  if (action === 'initialize') return 'загрузка мира';
  if (action === 'generate') return 'генерация мира';
  if (action === 'advance') return 'симуляция мира';
  if (action === 'advanceUntilEvent') return 'поиск следующего события';
  if (action === 'advanceUntilCharacterEvent') return 'поиск личного события';
  if (action === 'snapshot') return 'получение снимка';
  if (action === 'setWatchedCharacters') return 'обновление наблюдаемых историй';
  return 'обновление фокуса';
}

function resetWorker(error: Error): void {
  const activeWorker = worker;
  worker = undefined;
  activeWorker?.terminate();
  for (const request of pending.values()) {
    request.watchdog.stop();
    request.reject(error);
  }
  pending.clear();
  currentOperationId = undefined;
  workerHasWorld = false;
}

function getWorker(): Worker | undefined {
  if (typeof Worker === 'undefined') return undefined;
  if (worker) return worker;
  worker = new Worker(new URL('../workers/world.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorldWorkerMessage>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    if (event.data.type === 'progress') {
      request.watchdog.touch();
      request.onProgress?.(event.data.progress);
      return;
    }
    request.watchdog.stop();
    pending.delete(event.data.id);
    if (currentOperationId === event.data.id) currentOperationId = undefined;
    if (event.data.type === 'error') request.reject(new Error(event.data.error));
    else {
      if (request.action === 'initialize') workerHasWorld = true;
      if (request.action === 'generate' || request.action === 'advance' || request.action === 'advanceUntilEvent' || request.action === 'advanceUntilCharacterEvent') workerHasWorld = false;
      if (event.data.world) lastKnownWorld = event.data.world;
      request.resolve({ world: event.data.world, profile: event.data.profile, cancelled: event.data.type === 'cancelled', stoppedOnEventId: event.data.stoppedOnEventId, stoppedOnCharacterEvent: event.data.stoppedOnCharacterEvent, limitReached: event.data.limitReached });
    }
  };
  worker.onerror = event => resetWorker(new Error(event.message || 'Фоновая симуляция остановилась'));
  worker.onmessageerror = () => resetWorker(new Error('Браузер не смог прочитать ответ фоновой симуляции'));
  return worker;
}

function runWorker(command: WorldWorkerCommandInput, onProgress?: (progress: SimulationProgress) => void): Promise<WorldWorkerResult> {
  const activeWorker = getWorker();
  if (!activeWorker) return runFallback(command, onProgress);
  const id = nextId++;
  if (command.action === 'generate' || command.action === 'advance' || command.action === 'advanceUntilEvent' || command.action === 'advanceUntilCharacterEvent') currentOperationId = id;
  return new Promise((resolve, reject) => {
    const watchdog = createInactivityWatchdog(
      workerInactivityTimeout(command.action as WorkerOperation),
      () => {
        if (!pending.has(id)) return;
        resetWorker(new Error(`Фоновая операция «${operationLabel(command.action)}» слишком долго не отвечает. Движок перезапущен, сохранённый мир не изменён.`));
      },
    );
    pending.set(id, { resolve, reject, onProgress, action: command.action, watchdog });
    try {
      activeWorker.postMessage({ ...command, id } as WorldWorkerCommand);
    } catch (error) {
      resetWorker(error instanceof Error ? error : new Error('Не удалось передать данные фоновой симуляции'));
    }
  });
}

async function runFallback(command: WorldWorkerCommandInput, onProgress?: (progress: SimulationProgress) => void): Promise<WorldWorkerResult> {
  const startedAt = performance.now();
  if (command.action === 'initialize') {
    initializeDailyLife(command.world);
    initializeDynastyLegacy(command.world);
    initializeClimateSystem(command.world);
    initializeRaceDemography(command.world);
    fallbackEngine = createSimulationEngine(command.world);
    return { profile: { operation: 'загрузка', totalMs: performance.now() - startedAt, indexedEntities: countIndexedEntities(fallbackEngine.indexes), generatedAt: Date.now() } };
  }
  if (command.action === 'generate') {
    const world = generateHistoricalWorld(command.config, (phase, completed, total, detail) => {
      const elapsedMs = performance.now() - startedAt;
      const operation: SimulationProgress['operation'] = phase.includes('История') || phase.includes('истории') || phase.includes('эпох') || phase.includes('Связывание') ? 'история' : 'генерация';
      const scaled = Math.min(97, completed / Math.max(1, total) * 97);
      onProgress?.({ operation, phase, completed: scaled, total: 100, percent: scaled, elapsedMs, etaMs: completed ? elapsedMs / completed * (total - completed) : undefined, detail });
    });
    initializeDynastyLegacy(world);
    initializeClimateSystem(world);
    initializeRaceDemography(world);
    fallbackEngine = createSimulationEngine(world);
    advanceDailyLife(world, new RNG(`${world.config.seed}:повседневность:${world.year}:${world.month}`), fallbackEngine.indexes, { recordEvents: false });
    const profile: SimulationProfile = { operation: 'генерация', totalMs: performance.now() - startedAt, simulationMs: performance.now() - startedAt, indexedEntities: countIndexedEntities(fallbackEngine.indexes), generatedAt: Date.now() };
    fallbackProfile = profile;
    return { world, profile };
  }
  if (command.action === 'advance' || command.action === 'advanceUntilEvent' || command.action === 'advanceUntilCharacterEvent') {
    if (!fallbackEngine) throw new Error('Мир не загружен в движок симуляции');
    fallbackCancelled = false;
    let average = 0;
    const startTasks = fallbackEngine.processedTasks;
    resetSimulationProfiler(fallbackEngine);
    const targetMonths = command.action === 'advance' ? command.months : Math.max(1, command.maxMonths);
    const fastForward = command.action === 'advance' && command.months >= 12;
    const baselineEventId = command.action === 'advanceUntilEvent' ? latestEventId(fallbackEngine.world.events) : 0;
    const characterCursor = command.action === 'advanceUntilCharacterEvent' ? latestCharacterEventCursor(fallbackEngine.world, command.characterId) : undefined;
    let stoppedOnEventId: number | undefined;
    let stoppedOnCharacterEvent: WorldWorkerResult['stoppedOnCharacterEvent'];
    let completedMonths = 0;
    while (completedMonths < targetMonths) {
      if (fallbackCancelled) return { world: fallbackEngine.world, cancelled: true };
      const monthStart = performance.now();
      let phase = 'Симуляция мира';
      const monthStep = fastForward ? Math.min(targetMonths - completedMonths, monthsToNextQuarter(fallbackEngine.world.month)) : 1;
      advanceOneMonth(fallbackEngine, value => { phase = value; }, { fastForward, monthStep });
      advanceClimateSystem(fallbackEngine.world, { elapsedMonths: monthStep });
      advanceRaceDemography(fallbackEngine.world, { elapsedMonths: monthStep, indexes: fallbackEngine.indexes });
      advanceDailyLife(fallbackEngine.world, new RNG(`${fallbackEngine.world.config.seed}:повседневность:${fallbackEngine.world.year}:${fallbackEngine.world.month}`), fallbackEngine.indexes, { elapsedMonths: monthStep, forceCharacterIds: [...pendingWatchedCharacterIds, ...(command.action === 'advanceUntilCharacterEvent' ? [command.characterId] : [])] });
      advanceDynastyLegacy(fallbackEngine.world, { elapsedMonths: monthStep });
      const monthMs = performance.now() - monthStart;
      const normalizedMonthMs = monthMs / monthStep;
      average = average ? average * .72 + normalizedMonthMs * .28 : normalizedMonthMs;
      completedMonths += monthStep;
      if (command.action === 'advanceUntilEvent') stoppedOnEventId = nextImportantEventId(fallbackEngine.world.events, baselineEventId, command.minImportance);
      if (command.action === 'advanceUntilCharacterEvent' && characterCursor) stoppedOnCharacterEvent = nextCharacterEvent(fallbackEngine.world, command.characterId, characterCursor);
      const found = Boolean(stoppedOnEventId || stoppedOnCharacterEvent);
      onProgress?.({ operation: 'симуляция', phase: stoppedOnCharacterEvent ? 'Найдено личное событие' : stoppedOnEventId ? 'Найдено новое событие' : phase, completed: completedMonths, total: targetMonths, percent: completedMonths / targetMonths * 100, elapsedMs: performance.now() - startedAt, etaMs: average * (targetMonths - completedMonths), year: fallbackEngine.world.year, month: fallbackEngine.world.month });
      if (found) break;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    const profile: SimulationProfile = {
      operation: 'симуляция', months: completedMonths, totalMs: performance.now() - startedAt, simulationMs: performance.now() - startedAt,
      indexedEntities: countIndexedEntities(fallbackEngine.indexes), processedTasks: fallbackEngine.processedTasks - startTasks,
      activeRegions: fallbackEngine.world.simulation.activeRegionKeys.length, sleepingRegions: fallbackEngine.world.simulation.sleepingRegionCount, generatedAt: Date.now(),
      fastForward, exactMonths: fallbackEngine.exactMonths, coarseMonths: fallbackEngine.coarseMonths, phaseTimings: simulationPhaseProfile(fallbackEngine),
    };
    fallbackProfile = profile;
    fallbackEngine.world.simulation.lastProfile = profile;
    const searched = command.action === 'advanceUntilEvent' || command.action === 'advanceUntilCharacterEvent';
    return { world: fallbackEngine.world, profile, stoppedOnEventId, stoppedOnCharacterEvent, limitReached: searched && !stoppedOnEventId && !stoppedOnCharacterEvent };
  }
  if (command.action === 'snapshot') return { world: fallbackEngine?.world, profile: fallbackProfile };
  if (command.action === 'setFocus') {
    pendingFocus = { x: command.x, y: command.y, level: command.level, radius: command.radius };
    if (fallbackEngine) fallbackEngine.world.simulation.observerFocus = typeof command.x === 'number' && typeof command.y === 'number' ? { x: command.x, y: command.y, level: command.level ?? 0, radius: command.radius ?? 1 } : undefined;
    return {};
  }
  if (command.action === 'setWatchedCharacters') {
    pendingWatchedCharacterIds = [...new Set(command.characterIds.filter(id => Number.isInteger(id) && id > 0))].slice(0, 24);
    return {};
  }
  return {};
}

export async function initializeWorldInBackground(world: WorldState, onProgress?: (progress: SimulationProgress) => void): Promise<SimulationProfile | undefined> {
  lastKnownWorld = world;
  const result = await runWorker({ action: 'initialize', world }, onProgress);
  if (pendingFocus) await runWorker({ action: 'setFocus', ...pendingFocus });
  await runWorker({ action: 'setWatchedCharacters', characterIds: pendingWatchedCharacterIds });
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

export async function advanceToNextEventInBackground(
  maxMonths = 24,
  minImportance = 2,
  onProgress?: (progress: SimulationProgress) => void,
): Promise<WorldWorkerResult> {
  if (getWorker() && !workerHasWorld && lastKnownWorld) await initializeWorldInBackground(lastKnownWorld);
  const result = await runWorker({ action: 'advanceUntilEvent', maxMonths: Math.max(1, Math.floor(maxMonths)), minImportance: Math.max(1, Math.floor(minImportance)) }, onProgress);
  if (result.world) lastKnownWorld = result.world;
  return result;
}


export async function advanceToNextCharacterEventInBackground(
  characterId: number,
  maxMonths = 36,
  onProgress?: (progress: SimulationProgress) => void,
): Promise<WorldWorkerResult> {
  if (getWorker() && !workerHasWorld && lastKnownWorld) await initializeWorldInBackground(lastKnownWorld);
  const result = await runWorker({ action: 'advanceUntilCharacterEvent', characterId, maxMonths: Math.max(1, Math.floor(maxMonths)) }, onProgress);
  if (result.world) lastKnownWorld = result.world;
  return result;
}

export async function setWatchedCharactersInBackground(characterIds: readonly number[]): Promise<void> {
  pendingWatchedCharacterIds = [...new Set(characterIds.filter(id => Number.isInteger(id) && id > 0))].slice(0, 24);
  if (typeof Worker === 'undefined') await runFallback({ action: 'setWatchedCharacters', characterIds: pendingWatchedCharacterIds });
  else if (workerHasWorld) await runWorker({ action: 'setWatchedCharacters', characterIds: pendingWatchedCharacterIds });
}

export async function setWorldFocusInBackground(focus?: { x: number; y: number; level?: number; radius?: number }): Promise<void> {
  pendingFocus = focus ? { x: focus.x, y: focus.y, level: focus.level ?? 0, radius: focus.radius ?? 1 } : {};
  if (typeof Worker === 'undefined') await runFallback({ action: 'setFocus', ...(pendingFocus ?? {}) });
  else if (workerHasWorld) await runWorker({ action: 'setFocus', ...(pendingFocus ?? {}) });
  if (lastKnownWorld) lastKnownWorld.simulation.observerFocus = focus ? { x: focus.x, y: focus.y, level: focus.level ?? 0, radius: focus.radius ?? 1 } : undefined;
}

export async function snapshotWorldInBackground(): Promise<WorldState | undefined> {
  if (typeof Worker !== 'undefined' && !workerHasWorld) return lastKnownWorld;
  return (await runWorker({ action: 'snapshot' })).world;
}

export function cancelWorldOperation(): void {
  fallbackCancelled = true;
  const activeWorker = getWorker();
  if (!activeWorker || currentOperationId === undefined) return;
  activeWorker.postMessage({ id: nextId++, action: 'cancel', targetId: currentOperationId } satisfies WorldWorkerCommand);
}
