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
    decisionId: input.decisionId,
    stateDeltaIds: input.stateDeltaIds ? [...input.stateDeltaIds] : undefined,
  };
}

export function appendCausalEvent(world: WorldState, input: CausalEventInput): WorldEvent {
  world.nextIds.event ??= Math.max(0, ...world.events.map(event => event.id)) + 1;
  const event = causalEvent(world.nextIds.event++, world.year, world.month, input);
  world.events.push(event);
  if (world.events.length > 7200) compactEventJournal(world);
  return event;
}

export function compactEventJournal(world: WorldState): void {
  const protectedIds = new Set<number>([
    ...(world.history?.landmarkEventIds ?? []),
    ...world.books.flatMap(book => book.referencedEventIds ?? []),
  ]);
  const cutoff = Math.max(1, world.year - 60);
  const candidates = world.events.filter(event => event.year < cutoff && event.importance <= 2 && !protectedIds.has(event.id));
  if (candidates.length < 500) {
    const removable = world.events.filter(event => event.importance <= 1 && !protectedIds.has(event.id)).slice(0, Math.max(0, world.events.length - 6800));
    const ids = new Set(removable.map(event => event.id));
    world.events = world.events.filter(event => !ids.has(event.id));
    if (world.history) world.history.compressedEventCount += removable.length;
    return;
  }

  const grouped = new Map<string, WorldEvent[]>();
  for (const event of candidates) {
    const decade = Math.floor((event.year - 1) / 10) * 10 + 1;
    const group = eventGroup(event.kind);
    const key = `${decade}:${group}`;
    const list = grouped.get(key) ?? [];
    list.push(event);
    grouped.set(key, list);
  }
  const removedIds = new Set(candidates.map(event => event.id));
  world.events = world.events.filter(event => !removedIds.has(event.id));
  if (world.history) world.history.compressedEventCount += candidates.length;

  for (const [key, events] of grouped) {
    const [decadeText, group] = key.split(':');
    const decade = Number(decadeText);
    const refs = uniqueRefs(events.flatMap(event => event.entityRefs)).slice(0, 8);
    const summary = causalEvent(world.nextIds.event++, decade + 9, 12, {
      kind: summaryKind(group),
      title: `Сводка десятилетия: ${group}`,
      description: `${events.length} обычных событий сведены в одну запись, чтобы сохранить ход истории без перегрузки мира.`,
      cause: 'повторяющиеся события обычной жизни накопились за десятилетие',
      conditions: [`записи относятся к ${decade}–${decade + 9} годам`],
      decision: 'летописцы объединили малые события в статистическую хронику',
      outcome: 'главные изменения десятилетия сохранены в сжатом виде',
      consequences: [`сохранено ${events.length} причинных изменений`, 'уникальные и важные события остались подробными'],
      entityRefs: refs.length ? refs : events[0]?.entityRefs ?? [],
      traces: refs.length ? refs : events[0]?.traces ?? [],
      importance: 2,
    });
    world.events.push(summary);
  }
  world.events.sort((a, b) => a.year - b.year || a.month - b.month || a.id - b.id);
}

function eventGroup(kind: WorldEvent['kind']): string {
  if (kind === 'birth' || kind === 'death' || kind === 'migration') return 'жизнь населения';
  if (kind === 'trade' || kind === 'foraging' || kind === 'hunt' || kind === 'alchemy') return 'хозяйство и промыслы';
  if (kind === 'ecology') return 'изменения природы';
  if (kind === 'construction' || kind === 'settlement') return 'поселения и строительство';
  return 'общественная жизнь';
}

function summaryKind(group: string): WorldEvent['kind'] {
  if (group === 'жизнь населения') return 'migration';
  if (group === 'хозяйство и промыслы') return 'trade';
  if (group === 'изменения природы') return 'ecology';
  if (group === 'поселения и строительство') return 'settlement';
  return 'politics';
}

function uniqueRefs(refs: WorldEvent['entityRefs']): WorldEvent['entityRefs'] {
  const seen = new Set<string>();
  return refs.filter(ref => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeEventCausality(event: any): WorldEvent {
  event.cause ||= 'состояние мира и решения участников';
  event.conditions = Array.isArray(event.conditions) && event.conditions.length ? event.conditions : [event.cause];
  event.decision ||= event.description || 'участники отреагировали на сложившиеся условия';
  event.consequences = Array.isArray(event.consequences) && event.consequences.length ? event.consequences : ['состояние мира изменилось'];
  event.outcome ||= event.consequences.join('; ');
  event.entityRefs ??= [];
  event.traces = Array.isArray(event.traces) && event.traces.length ? event.traces : event.entityRefs;
  event.stateDeltaIds = Array.isArray(event.stateDeltaIds) ? event.stateDeltaIds : [];
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
