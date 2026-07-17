export type WorkerOperation = 'initialize' | 'generate' | 'advance' | 'snapshot' | 'setFocus';

export interface WatchdogClock {
  set(handler: () => void, timeoutMs: number): unknown;
  clear(handle: unknown): void;
}

export interface InactivityWatchdog {
  touch(): void;
  stop(): void;
}

const defaultClock: WatchdogClock = {
  set: (handler, timeoutMs) => globalThis.setTimeout(handler, timeoutMs),
  clear: handle => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export function workerInactivityTimeout(action: WorkerOperation): number {
  if (action === 'setFocus') return 15_000;
  if (action === 'snapshot') return 60_000;
  return 120_000;
}

export function createInactivityWatchdog(
  timeoutMs: number,
  onTimeout: () => void,
  clock: WatchdogClock = defaultClock,
): InactivityWatchdog {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Таймаут watchdog должен быть положительным числом');

  let handle: unknown;
  let stopped = false;

  const touch = () => {
    if (stopped) return;
    if (handle !== undefined) clock.clear(handle);
    handle = clock.set(() => {
      if (stopped) return;
      stopped = true;
      handle = undefined;
      onTimeout();
    }, timeoutMs);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (handle !== undefined) clock.clear(handle);
    handle = undefined;
  };

  touch();
  return { touch, stop };
}
