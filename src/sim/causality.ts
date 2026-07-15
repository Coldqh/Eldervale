import type { CausalEventInput, WorldEvent, WorldState } from '../types';

export function causalEvent(
  id: number,
  year: number,
  month: number,
  input: CausalEventInput,
): WorldEvent {
  const conditions = input.conditions?.filter(Boolean) ?? [input.cause];
  const decision = input.decision?.trim() || input.description;
  const outcome = input.outcome?.trim() || input.consequences.join('; ');
  return {
    id,
    year,
    month,
    kind: input.kind,
    title: input.title,
    description: input.description,
    cause: input.cause,
    conditions: conditions.length ? conditions : ['состояние мира сделало событие возможным'],
    decision,
    outcome: outcome || 'состояние мира изменилось',
    consequences: input.consequences.length ? input.consequences : ['событие оставило материальный или социальный след'],
    traces: input.traces ?? input.entityRefs,
    entityRefs: input.entityRefs,
    importance: input.importance,
  };
}

export function appendCausalEvent(world: WorldState, input: CausalEventInput): WorldEvent {
  world.nextIds.event ??= Math.max(0, ...world.events.map(event => event.id)) + 1;
  const event = causalEvent(world.nextIds.event++, world.year, world.month, input);
  world.events.push(event);
  if (world.events.length > 5000) world.events.splice(0, world.events.length - 5000);
  return event;
}

export function normalizeEventCausality(event: any): WorldEvent {
  event.cause ||= 'состояние мира и решения участников';
  event.conditions = Array.isArray(event.conditions) && event.conditions.length ? event.conditions : [event.cause];
  event.decision ||= event.description || 'участники отреагировали на сложившиеся условия';
  event.consequences = Array.isArray(event.consequences) && event.consequences.length ? event.consequences : ['состояние мира изменилось'];
  event.outcome ||= event.consequences.join('; ');
  event.entityRefs ??= [];
  event.traces = Array.isArray(event.traces) && event.traces.length ? event.traces : event.entityRefs;
  return event as WorldEvent;
}

export function causalIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  for (const event of world.events) {
    if (!event.cause?.trim()) issues.push(`Событие ${event.id}: нет причины`);
    if (!event.conditions?.length) issues.push(`Событие ${event.id}: нет условий`);
    if (!event.decision?.trim()) issues.push(`Событие ${event.id}: нет действия или решения`);
    if (!event.outcome?.trim()) issues.push(`Событие ${event.id}: нет результата`);
    if (!event.consequences?.length) issues.push(`Событие ${event.id}: нет последствий`);
    if (!event.traces?.length) issues.push(`Событие ${event.id}: нет следов`);
  }
  return issues;
}
