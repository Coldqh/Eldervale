import assert from 'node:assert/strict';
import {
  createInactivityWatchdog,
  workerInactivityTimeout,
  type WatchdogClock,
} from '../src/lib/workerWatchdog';

class FakeClock implements WatchdogClock {
  private nextId = 1;
  private tasks = new Map<number, () => void>();

  set(handler: () => void): number {
    const id = this.nextId++;
    this.tasks.set(id, handler);
    return id;
  }

  clear(handle: unknown): void {
    this.tasks.delete(Number(handle));
  }

  runPending(): void {
    const tasks = [...this.tasks.values()];
    this.tasks.clear();
    for (const task of tasks) task();
  }

  get size(): number {
    return this.tasks.size;
  }
}

assert.equal(workerInactivityTimeout('setFocus'), 15_000);
assert.equal(workerInactivityTimeout('snapshot'), 60_000);
assert.equal(workerInactivityTimeout('initialize'), 120_000);
assert.equal(workerInactivityTimeout('generate'), 120_000);
assert.equal(workerInactivityTimeout('advance'), 120_000);
assert.equal(workerInactivityTimeout('advanceUntilEvent'), 120_000);

const clock = new FakeClock();
let timeouts = 0;
const watchdog = createInactivityWatchdog(100, () => { timeouts += 1; }, clock);
assert.equal(clock.size, 1, 'watchdog должен сразу поставить таймер');

watchdog.touch();
assert.equal(clock.size, 1, 'touch должен заменить таймер, а не добавить второй');
clock.runPending();
assert.equal(timeouts, 1, 'watchdog должен сработать один раз');
assert.equal(clock.size, 0);

watchdog.touch();
clock.runPending();
assert.equal(timeouts, 1, 'сработавший watchdog нельзя перезапустить');

const stoppedClock = new FakeClock();
let stoppedTimeouts = 0;
const stopped = createInactivityWatchdog(100, () => { stoppedTimeouts += 1; }, stoppedClock);
stopped.stop();
stoppedClock.runPending();
assert.equal(stoppedTimeouts, 0, 'остановленный watchdog не должен вызывать timeout');

assert.throws(() => createInactivityWatchdog(0, () => undefined, new FakeClock()));
console.log('OK WATCHDOG: таймер обновляется прогрессом, останавливается и срабатывает только один раз.');
