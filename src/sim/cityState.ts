import type { CityDirtyReason, UrbanState } from '../cityTypes';
import type { WorldState } from '../types';
import { worldTick } from './scheduler';

export function ensureUrbanState(world: WorldState, settlementId: number): UrbanState {
  world.urbanStates ??= [];
  let state = world.urbanStates.find(item => item.settlementId === settlementId);
  if (state) return state;
  const tick = worldTick(world);
  state = {
    version: 2,
    settlementId,
    initializedTick: tick,
    lastSimulatedTick: -1,
    simulationCount: 0,
    lastDevelopmentTick: -1,
    dirty: true,
    dirtyReasons: ['initialization'],
    housingAssignments: [],
    problemRecords: [],
    projectQueue: [],
  };
  world.urbanStates.push(state);
  return state;
}

export function urbanStateForSettlement(world: WorldState, settlementId: number): UrbanState | undefined {
  return world.urbanStates?.find(item => item.settlementId === settlementId);
}

export function markCityDirty(world: WorldState, settlementId: number, reason: CityDirtyReason): void {
  const state = ensureUrbanState(world, settlementId);
  state.dirty = true;
  if (!state.dirtyReasons.includes(reason)) state.dirtyReasons.push(reason);
}

export function markCitiesDirty(world: WorldState, settlementIds: Iterable<number>, reason: CityDirtyReason): void {
  for (const settlementId of settlementIds) markCityDirty(world, settlementId, reason);
}

export function markAllCitiesDirty(world: WorldState, reason: CityDirtyReason): void {
  for (const settlement of world.settlements) markCityDirty(world, settlement.id, reason);
}

export function clearCityDirty(state: UrbanState, tick: number): void {
  state.lastSimulatedTick = tick;
  state.dirty = false;
  state.dirtyReasons = [];
}

export function normalizeUrbanStates(world: WorldState): void {
  world.urbanStates ??= [];
  const validSettlementIds = new Set(world.settlements.map(item => item.id));
  world.urbanStates = world.urbanStates.filter(item => validSettlementIds.has(item.settlementId));
  for (const settlement of world.settlements) {
    const state = ensureUrbanState(world, settlement.id);
    state.version = 2;
    state.housingAssignments ??= [];
    state.problemRecords ??= [];
    state.projectQueue ??= [];
    state.dirtyReasons ??= [];
    state.dirty ??= true;
    state.initializedTick ??= worldTick(world);
    state.lastSimulatedTick ??= -1;
    state.simulationCount ??= 0;
    state.lastDevelopmentTick ??= -1;
    for (const request of state.projectQueue) {
      request.triggerProblemIds ??= [];
      request.expectedRelief ??= [];
    }
  }
}
