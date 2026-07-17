import type { WorldEvent } from '../types';

type EventSummary = Pick<WorldEvent, 'id' | 'importance'>;

export function latestEventId(events: readonly EventSummary[]): number {
  let latest = 0;
  for (const event of events) latest = Math.max(latest, event.id);
  return latest;
}

export function nextImportantEventId(
  events: readonly EventSummary[],
  afterEventId: number,
  minImportance = 2,
): number | undefined {
  let candidate: EventSummary | undefined;
  for (const event of events) {
    if (event.id <= afterEventId || event.importance < minImportance) continue;
    if (!candidate || event.importance > candidate.importance || (event.importance === candidate.importance && event.id < candidate.id)) {
      candidate = event;
    }
  }
  return candidate?.id;
}
