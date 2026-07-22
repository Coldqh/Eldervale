import type { BuildingType, ConstructionProject, WorldState } from '../types';
import type { CityProjectRequest } from '../cityTypes';
import { worldTick } from './scheduler';
import { ensureUrbanState, markCityDirty } from './cityState';

export interface CityProjectRequestOptions {
  source?: string;
  priority?: number;
}

export function requestCityProject(
  world: WorldState,
  settlementId: number,
  buildingType: BuildingType,
  reason: string,
  options: CityProjectRequestOptions = {},
): CityProjectRequest {
  const state = ensureUrbanState(world, settlementId);
  const tick = worldTick(world);
  const active = state.projectQueue.find(item => item.requestedBuildingType === buildingType
    && ['requested', 'blocked', 'approved', 'started'].includes(item.status));
  if (active) {
    active.priority = Math.max(active.priority, clamp(options.priority ?? 50, 1, 100));
    active.updatedTick = tick;
    if (reason && !active.history.includes(reason)) active.history.push(reason);
    if (active.status === 'blocked') active.status = 'requested';
    active.blockedReason = undefined;
    markCityDirty(world, settlementId, 'construction');
    return active;
  }
  const id = `city-project:${settlementId}:${buildingType}:${tick}:${state.projectQueue.length + 1}`;
  const request: CityProjectRequest = {
    id,
    settlementId,
    requestedBuildingType: buildingType,
    reason,
    source: options.source ?? 'simulation',
    priority: clamp(options.priority ?? 50, 1, 100),
    status: 'requested',
    requestedTick: tick,
    updatedTick: tick,
    history: [`Запрос создан: ${reason}`],
  };
  state.projectQueue.push(request);
  markCityDirty(world, settlementId, 'construction');
  return request;
}

export function approveCityProjectRequest(world: WorldState, requestId: string): CityProjectRequest | undefined {
  const request = findCityProjectRequest(world, requestId);
  if (!request || !['requested', 'blocked'].includes(request.status)) return request;
  request.status = 'approved';
  request.blockedReason = undefined;
  request.updatedTick = worldTick(world);
  request.history.push('Проект одобрен городской системой.');
  markCityDirty(world, request.settlementId, 'construction');
  return request;
}

export function blockCityProjectRequest(world: WorldState, requestId: string, reason: string): void {
  const request = findCityProjectRequest(world, requestId);
  if (!request) return;
  request.status = 'blocked';
  request.blockedReason = reason;
  request.updatedTick = worldTick(world);
  request.history.push(`Проект заблокирован: ${reason}`);
  markCityDirty(world, request.settlementId, 'construction');
}

export function linkCityProjectToConstruction(world: WorldState, requestId: string, project: ConstructionProject): void {
  const request = findCityProjectRequest(world, requestId);
  if (!request) return;
  request.status = 'started';
  request.constructionProjectId = project.id;
  request.updatedTick = worldTick(world);
  request.history.push(`Создана стройка №${project.id}.`);
  markCityDirty(world, request.settlementId, 'construction');
}

export function completeCityProjectRequest(world: WorldState, constructionProjectId: number): void {
  for (const state of world.urbanStates ?? []) {
    const request = state.projectQueue.find(item => item.constructionProjectId === constructionProjectId);
    if (!request) continue;
    request.status = 'completed';
    request.updatedTick = worldTick(world);
    request.history.push('Здание введено в эксплуатацию.');
    markCityDirty(world, request.settlementId, 'building');
    return;
  }
}

export function failCityProjectRequest(world: WorldState, constructionProjectId: number, reason: string): void {
  for (const state of world.urbanStates ?? []) {
    const request = state.projectQueue.find(item => item.constructionProjectId === constructionProjectId);
    if (!request) continue;
    request.status = 'blocked';
    request.blockedReason = reason;
    request.updatedTick = worldTick(world);
    request.history.push(`Стройка остановлена: ${reason}`);
    markCityDirty(world, request.settlementId, 'construction');
    return;
  }
}

export function reconcileCityProjectQueue(world: WorldState, settlementId: number): void {
  const state = ensureUrbanState(world, settlementId);
  const projectById = new Map(world.constructionProjects.map(project => [project.id, project]));
  for (const request of state.projectQueue) {
    if (!request.constructionProjectId) continue;
    const project = projectById.get(request.constructionProjectId);
    if (!project) {
      if (request.status === 'started') {
        request.status = 'blocked';
        request.blockedReason = 'связанная стройка отсутствует';
      }
      continue;
    }
    if (project.stage === 'завершено') request.status = 'completed';
    else if (project.stage === 'заброшено') {
      request.status = 'blocked';
      request.blockedReason = 'стройка заброшена';
    } else if (request.status !== 'started') request.status = 'started';
  }
  state.projectQueue = state.projectQueue
    .sort((a, b) => Number(['completed', 'rejected', 'cancelled'].includes(a.status)) - Number(['completed', 'rejected', 'cancelled'].includes(b.status))
      || b.priority - a.priority || a.requestedTick - b.requestedTick)
    .slice(0, 240);
}

export function findCityProjectRequest(world: WorldState, requestId: string): CityProjectRequest | undefined {
  for (const state of world.urbanStates ?? []) {
    const request = state.projectQueue.find(item => item.id === requestId);
    if (request) return request;
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
