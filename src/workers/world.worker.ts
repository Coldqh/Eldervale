/// <reference lib="webworker" />
import type { WorldConfig, WorldState } from '../types';
import { generateWorld } from '../sim/generator';
import { advanceWorld } from '../sim/simulation';

type Request =
  | { id: number; action: 'generate'; config: WorldConfig }
  | { id: number; action: 'advance'; world: WorldState; months: number };

type Response = { id: number; world?: WorldState; error?: string };

self.onmessage = (event: MessageEvent<Request>) => {
  const message = event.data;
  try {
    const world = message.action === 'generate'
      ? generateWorld(message.config)
      : advanceWorld(message.world, message.months);
    self.postMessage({ id: message.id, world } satisfies Response);
  } catch (error) {
    self.postMessage({ id: message.id, error: error instanceof Error ? error.message : 'Неизвестная ошибка симуляции' } satisfies Response);
  }
};

export {};
