import type { DecisionOptionScore, DecisionRecord, EntityRef, StateDelta, WorldEvent, WorldState } from '../types';
import { worldTick } from './scheduler';

const MAX_DECISIONS = 12_000;
const MAX_STATE_DELTAS = 40_000;

export interface DecisionInput {
  actorRef: EntityRef;
  goal: string;
  context: string;
  knownFactIds?: number[];
  options: DecisionOptionScore[];
  chosenOptionId?: string;
  reason?: string;
  historical?: boolean;
  tick?: number;
  tags?: string[];
}

export interface StateDeltaInput {
  entityRef: EntityRef;
  field: string;
  before: unknown;
  after: unknown;
  amount?: number;
  cause: string;
  decisionId?: number;
  eventId?: number;
  historical?: boolean;
  tick?: number;
}

export function initializeDecisionCore(world: WorldState): void {
  world.decisions ??= [];
  world.stateDeltas ??= [];
  world.nextIds ??= {};
  world.nextIds.decision ??= Math.max(0, ...world.decisions.map(item => item.id)) + 1;
  world.nextIds.stateDelta ??= Math.max(0, ...world.stateDeltas.map(item => item.id)) + 1;
  world.simulation.decisionCoreVersion = 1;
}

export function chooseBestOption(options: DecisionOptionScore[]): DecisionOptionScore {
  if (!options.length) throw new Error('Решение не имеет доступных вариантов');
  const available = options.filter(option => !option.blockedReason);
  const pool = available.length ? available : options;
  return [...pool].sort((a, b) => b.utility - a.utility || a.id.localeCompare(b.id))[0]!;
}

export function recordDecision(world: WorldState, input: DecisionInput): DecisionRecord {
  initializeDecisionCore(world);
  const chosen = input.chosenOptionId
    ? input.options.find(option => option.id === input.chosenOptionId) ?? chooseBestOption(input.options)
    : chooseBestOption(input.options);
  const decision: DecisionRecord = {
    id: world.nextIds.decision++,
    tick: input.tick ?? worldTick(world),
    actorRef: input.actorRef,
    goal: input.goal,
    context: input.context,
    knownFactIds: [...new Set(input.knownFactIds ?? [])].slice(-32),
    optionScores: input.options.map(option => ({ ...option, factors: { ...option.factors } })),
    chosenOptionId: chosen.id,
    reason: input.reason ?? explainOption(chosen),
    stateDeltaIds: [],
    historical: Boolean(input.historical),
    tags: [...new Set(input.tags ?? [])],
  };
  world.decisions.push(decision);
  trimDecisionCore(world);
  return decision;
}

export function recordStateDelta(world: WorldState, input: StateDeltaInput): StateDelta | undefined {
  initializeDecisionCore(world);
  const before = stableValue(input.before);
  const after = stableValue(input.after);
  if (before === after && !input.amount) return undefined;
  const delta: StateDelta = {
    id: world.nextIds.stateDelta++,
    tick: input.tick ?? worldTick(world),
    entityRef: input.entityRef,
    field: input.field,
    before,
    after,
    amount: input.amount,
    cause: input.cause,
    decisionId: input.decisionId,
    eventId: input.eventId,
    historical: Boolean(input.historical),
  };
  world.stateDeltas.push(delta);
  if (delta.decisionId) {
    const decision = world.decisions.find(item => item.id === delta.decisionId);
    if (decision && !decision.stateDeltaIds.includes(delta.id)) decision.stateDeltaIds.push(delta.id);
  }
  trimDecisionCore(world);
  return delta;
}

export function linkDecisionToEvent(world: WorldState, decisionId: number | undefined, event: WorldEvent, deltaIds: number[] = []): void {
  if (!decisionId) return;
  const decision = world.decisions.find(item => item.id === decisionId);
  if (!decision) return;
  decision.eventId = event.id;
  event.decisionId = decision.id;
  const ids = [...new Set([...decision.stateDeltaIds, ...deltaIds])];
  decision.stateDeltaIds = ids;
  event.stateDeltaIds = ids;
  for (const id of ids) {
    const delta = world.stateDeltas.find(item => item.id === id);
    if (delta) { delta.eventId = event.id; delta.decisionId ??= decisionId; }
  }
}

export function decisionKnowledge(world: WorldState, actorRef: EntityRef): number[] {
  if (actorRef.kind === 'character') {
    return world.characters.find(item => item.id === actorRef.id)?.knowledge?.factIds.slice(-24) ?? [];
  }
  if (actorRef.kind === 'kingdom') {
    const kingdom = world.kingdoms.find(item => item.id === actorRef.id);
    const ruler = kingdom ? world.characters.find(item => item.id === kingdom.rulerId) : undefined;
    return ruler?.knowledge?.factIds.slice(-24) ?? [];
  }
  if (actorRef.kind === 'settlement') {
    return world.settlementKnowledge.find(item => item.settlementId === actorRef.id)?.verifiedFactIds.slice(-24) ?? [];
  }
  return [];
}

export function decisionCoreIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const decisions = new Map(world.decisions.map(item => [item.id, item]));
  const deltas = new Map(world.stateDeltas.map(item => [item.id, item]));
  for (const decision of world.decisions) {
    if (!decision.optionScores.length) issues.push(`Решение ${decision.id}: нет вариантов`);
    if (!decision.optionScores.some(option => option.id === decision.chosenOptionId)) issues.push(`Решение ${decision.id}: выбран неизвестный вариант ${decision.chosenOptionId}`);
    for (const id of decision.stateDeltaIds) if (!deltas.has(id)) issues.push(`Решение ${decision.id}: отсутствует изменение ${id}`);
  }
  for (const delta of world.stateDeltas) {
    if (delta.decisionId && !decisions.has(delta.decisionId)) issues.push(`Изменение ${delta.id}: отсутствует решение ${delta.decisionId}`);
    if (!delta.cause.trim()) issues.push(`Изменение ${delta.id}: не указана причина`);
    if (!delta.field.trim()) issues.push(`Изменение ${delta.id}: не указано поле`);
  }
  for (const event of world.events) {
    if (event.decisionId && !decisions.has(event.decisionId)) issues.push(`Событие ${event.id}: отсутствует решение ${event.decisionId}`);
    for (const id of event.stateDeltaIds ?? []) if (!deltas.has(id)) issues.push(`Событие ${event.id}: отсутствует изменение ${id}`);
  }
  return [...new Set(issues)];
}

function stableValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 1_000) / 1_000) : String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || value === null) return String(value);
  try { return JSON.stringify(value); } catch { return String(value); }
}

function explainOption(option: DecisionOptionScore): string {
  const strongest = Object.entries(option.factors)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3)
    .map(([name, value]) => `${name} ${value >= 0 ? '+' : ''}${Math.round(value)}`)
    .join(', ');
  return strongest ? `${option.label}: ${strongest}` : option.label;
}

function trimDecisionCore(world: WorldState): void {
  if (world.decisions.length > MAX_DECISIONS) {
    const remove = world.decisions.length - MAX_DECISIONS;
    const removedIds = new Set(world.decisions.slice(0, remove).map(item => item.id));
    world.decisions.splice(0, remove);
    const removedDeltaIds = new Set(world.stateDeltas.filter(delta => delta.decisionId && removedIds.has(delta.decisionId)).map(delta => delta.id));
    world.stateDeltas = world.stateDeltas.filter(delta => !delta.decisionId || !removedIds.has(delta.decisionId));
    for (const event of world.events) {
      if (event.decisionId && removedIds.has(event.decisionId)) event.decisionId = undefined;
      if (event.stateDeltaIds) event.stateDeltaIds = event.stateDeltaIds.filter(id => !removedDeltaIds.has(id));
    }
  }
  if (world.stateDeltas.length > MAX_STATE_DELTAS) {
    const removable = world.stateDeltas.length - MAX_STATE_DELTAS;
    const removedIds = new Set(world.stateDeltas.slice(0, removable).map(item => item.id));
    world.stateDeltas.splice(0, removable);
    for (const decision of world.decisions) decision.stateDeltaIds = decision.stateDeltaIds.filter(id => !removedIds.has(id));
    for (const event of world.events) if (event.stateDeltaIds) event.stateDeltaIds = event.stateDeltaIds.filter(id => !removedIds.has(id));
  }
}
