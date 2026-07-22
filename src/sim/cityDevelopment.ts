import type { BuildingType, Settlement, WorldState } from '../types';
import type { CityProblem, CityProblemKind, CityProjectRequest, SettlementCityState } from '../cityTypes';
import { requestCityProject } from './cityProjects';
import { worldTick } from './scheduler';

type DistrictRole = Settlement['districts'][number]['role'];

interface DevelopmentResponse {
  requestedType: BuildingType | 'district-expansion';
  priority: number;
  expectedRelief: CityProblemKind[];
  targetDistrictRole?: DistrictRole;
}

export function synchronizeCityDevelopmentPlan(
  world: WorldState,
  settlement: Settlement,
  snapshot: SettlementCityState,
): void {
  const tick = worldTick(world);
  const activeProblemIds = new Set(snapshot.problems.map(problem => problem.id));
  const plannedRequestIds = new Set<string>();

  for (const problem of snapshot.problems) {
    const response = responseForProblem(problem, snapshot);
    if (!response) continue;
    const request = requestCityProject(
      world,
      settlement.id,
      response.requestedType,
      `${problem.title}: ${problem.description}`,
      {
        source: 'city-development',
        priority: response.priority,
        triggerProblemIds: [problem.id],
        expectedRelief: response.expectedRelief,
        targetDistrictRole: response.targetDistrictRole,
      },
    );
    plannedRequestIds.add(request.id);
  }

  const urban = world.urbanStates.find(item => item.settlementId === settlement.id);
  if (!urban) return;
  urban.lastDevelopmentTick = tick;
  for (const request of urban.projectQueue) {
    if (!['requested', 'blocked', 'approved'].includes(request.status)) continue;
    if (request.triggerProblemIds.length) request.triggerProblemIds = request.triggerProblemIds.filter(id => activeProblemIds.has(id));
    if (plannedRequestIds.has(request.id) || request.triggerProblemIds.length || request.source !== 'city-development') continue;
    request.status = 'cancelled';
    request.blockedReason = undefined;
    request.updatedTick = tick;
    request.history.push(`Автоматическая заявка снята в ${tick}: вызвавший её дефицит исчез.`);
  }
}

export function pendingCityDevelopmentRequests(world: WorldState, settlementId: number): CityProjectRequest[] {
  return (world.urbanStates.find(item => item.settlementId === settlementId)?.projectQueue ?? [])
    .filter(request => request.triggerProblemIds.length > 0 && ['requested', 'blocked', 'approved'].includes(request.status))
    .sort((a, b) => b.priority - a.priority || a.requestedTick - b.requestedTick || a.id.localeCompare(b.id));
}

function responseForProblem(problem: CityProblem, snapshot: SettlementCityState): DevelopmentResponse | undefined {
  const scaledPriority = (base: number) => clamp(Math.round(base + problem.severity * .58), 1, 100);
  switch (problem.kind) {
    case 'homelessness':
      return {
        requestedType: snapshot.housing.shelterBeds < snapshot.housing.homelessPeople ? 'shelter' : residentialType(snapshot),
        priority: scaledPriority(58),
        expectedRelief: ['homelessness', 'housing-shortage'],
        targetDistrictRole: 'жилой район',
      };
    case 'overcrowding':
    case 'housing-shortage':
      return {
        requestedType: residentialType(snapshot),
        priority: scaledPriority(48),
        expectedRelief: ['overcrowding', 'housing-shortage', 'homelessness'],
        targetDistrictRole: 'жилой район',
      };
    case 'school-shortage':
      return { requestedType: 'school', priority: scaledPriority(44), expectedRelief: ['school-shortage'], targetDistrictRole: 'жилой район' };
    case 'storage-shortage':
      return { requestedType: 'warehouse', priority: scaledPriority(38), expectedRelief: ['storage-shortage'], targetDistrictRole: 'ремесленный район' };
    case 'water-shortage':
      return { requestedType: 'bathhouse', priority: scaledPriority(42), expectedRelief: ['water-shortage', 'fire-risk'], targetDistrictRole: 'центр' };
    case 'fire-risk':
      return { requestedType: 'fireStation', priority: scaledPriority(52), expectedRelief: ['fire-risk', 'water-shortage'], targetDistrictRole: 'центр' };
    case 'unemployment':
      if (problem.severity < 35) return undefined;
      return { requestedType: 'market', priority: scaledPriority(24), expectedRelief: ['unemployment'], targetDistrictRole: 'рынок' };
    case 'land-shortage':
      return { requestedType: 'district-expansion', priority: scaledPriority(46), expectedRelief: ['land-shortage'], targetDistrictRole: expansionRole(snapshot) };
    case 'worker-shortage':
    case 'land-conflict':
      return undefined;
  }
}

function residentialType(snapshot: SettlementCityState): BuildingType {
  return snapshot.population >= 700 || snapshot.land.density >= .2 ? 'tenement' : 'house';
}

function expansionRole(snapshot: SettlementCityState): DistrictRole {
  if (snapshot.housing.peopleWithoutPermanentBed > 0) return 'жилой район';
  if (snapshot.storage.overflow > 0) return 'ремесленный район';
  return 'окраина';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
