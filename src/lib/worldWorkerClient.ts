import type { WorldConfig, WorldState } from '../types';
import { generateWorld } from '../sim/generator';
import { advanceWorld } from '../sim/simulation';

type WorkerCommand =
  | { action: 'generate'; config: WorldConfig }
  | { action: 'advance'; world: WorldState; months: number };

type WorkerRequest = WorkerCommand & { id: number };
type WorkerResponse = { id: number; world?: WorldState; error?: string };

let nextId = 1;
let worker: Worker | undefined;
const pending = new Map<number, { resolve: (world: WorldState) => void; reject: (error: Error) => void }>();

function getWorker(): Worker | undefined {
  if (typeof Worker === 'undefined') return undefined;
  if (worker) return worker;
  worker = new Worker(new URL('../workers/world.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.error || !event.data.world) request.reject(new Error(event.data.error ?? 'Симуляция не вернула мир'));
    else request.resolve(event.data.world);
  };
  worker.onerror = () => {
    for (const request of pending.values()) request.reject(new Error('Фоновая симуляция остановилась'));
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}

function run(command: WorkerCommand): Promise<WorldState> {
  const activeWorker = getWorker();
  if (!activeWorker) {
    return Promise.resolve(command.action === 'generate'
      ? generateWorld(command.config)
      : advanceWorld(command.world, command.months));
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    activeWorker.postMessage({ ...command, id } satisfies WorkerRequest);
  });
}

export const generateWorldInBackground = (config: WorldConfig) => run({ action: 'generate', config });
export const advanceWorldInBackground = (world: WorldState, months: number) => run({ action: 'advance', world, months });
