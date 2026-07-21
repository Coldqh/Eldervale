import type { Building, Character, LocalCell, LocalMapData, LocalMarker, WorldState } from '../types';
import type {
  BuildingInteriorPlan, InteriorAssignment, InteriorAssignmentKind, InteriorFixture, InteriorFixtureKind,
  InteriorMaterialProfile, InteriorRoom, InteriorRoomKind, InteriorStair,
} from '../interiorTypes';
import { hashSeed, RNG } from './rng';
import { worldTick } from './scheduler';
import { raceDefinition } from '../raceCatalog';

const PLAN_CACHE = new WeakMap<WorldState, Map<number, BuildingInteriorPlan>>();
const INITIALIZED_WORLDS = new WeakSet<WorldState>();
const MAX_RENDERED_FIXTURES_PER_BUILDING = 150;
const ROOMS_PER_FLOOR = 4;
const INTERIOR_VERSION = 2 as const;

type Demand = {
  sleepers: Character[];
  students: Character[];
  workers: Character[];
  prisoners: Character[];
  patients: Character[];
};

type RoomRequest = { kind: InteriorRoomKind; name: string; count: number };

export interface InteriorPosition {
  fixtureId: string;
  roomId: string;
  x: number;
  y: number;
  floor: number;
  fixtureKind: InteriorFixtureKind;
  fixtureLabel: string;
  roomName: string;
}

export function initializeInteriorSystem(world: WorldState): void {
  if (INITIALIZED_WORLDS.has(world)) return;
  ensureInteriorCapacity(world);
  INITIALIZED_WORLDS.add(world);
}

export function ensureInteriorCapacity(world: WorldState): void {
  normalizeBuildingOccupancy(world);
  PLAN_CACHE.delete(world);
  for (const building of world.buildings) interiorPlanForBuilding(world, building);
}

export function interiorPlanForBuilding(world: WorldState, building: Building): BuildingInteriorPlan {
  let cache = PLAN_CACHE.get(world);
  if (!cache) { cache = new Map(); PLAN_CACHE.set(world, cache); }
  const demand = collectDemand(world, building);
  const signature = planSignature(world, building, demand);
  const cached = cache.get(building.id);
  if (cached?.signature === signature) return cached;
  if (building.interior?.version === INTERIOR_VERSION && building.interior.signature === signature) {
    cache.set(building.id, building.interior);
    return building.interior;
  }

  const previous = building.interior;
  const materials = materialProfile(world, building);
  const requests = roomRequests(building, demand);
  const rooms = layoutRooms(building, requests);
  const fixtures: InteriorFixture[] = [];
  const assignments: InteriorAssignment[] = [];
  const stairs = buildStairs(building);
  const occupiedByFloor = new Map<number, Set<string>>();
  const reservedPreviousFixtureIds = new Set(previous?.fixtures.map(item => item.id) ?? []);
  const usedFixtureIds = new Set<string>();
  let fixtureSequence = 1;
  const freshFixtureId = (kind: InteriorFixtureKind): string => {
    let id = `interior:${building.id}:${kind}:${fixtureSequence++}`;
    while (reservedPreviousFixtureIds.has(id) || usedFixtureIds.has(id)) id = `interior:${building.id}:${kind}:${fixtureSequence++}`;
    return id;
  };
  reserveStairs(stairs, occupiedByFloor);

  const addFixture = (
    kind: InteriorFixtureKind,
    label: string,
    roomKinds: InteriorRoomKind[],
    capacity = 1,
    functional = true,
    temporary = false,
  ): InteriorFixture | undefined => {
    const footprint = fixtureFootprint(kind);
    const placement = findFixturePlacement(building, rooms, roomKinds, footprint, occupiedByFloor);
    if (!placement) return undefined;
    const { room, position } = placement;
    const old = findPreviousFixture(previous, kind, label, room.floor, usedFixtureIds);
    const fixtureId = old?.id ?? freshFixtureId(kind);
    usedFixtureIds.add(fixtureId);
    const fixture: InteriorFixture = {
      id: fixtureId,
      buildingId: building.id,
      roomId: room.id,
      kind,
      label,
      floor: room.floor,
      x: position.x,
      y: position.y,
      capacity,
      assignedCharacterIds: [],
      functional: functional && !old?.blocked && (old?.condition ?? 100) > 0,
      material: fixtureMaterial(kind, materials),
      condition: old?.condition ?? (temporary ? 45 : Math.max(35, building.condition)),
      maxCondition: old?.maxCondition ?? 100,
      temporary,
      blocked: old?.blocked ?? false,
      lastMaintainedTick: old?.lastMaintainedTick ?? worldTick(world),
    };
    fixtures.push(fixture);
    return fixture;
  };
  const assign = (character: Character, kind: InteriorAssignmentKind, fixture: InteriorFixture): void => {
    if (fixture.assignedCharacterIds.length >= fixture.capacity) return;
    fixture.assignedCharacterIds.push(character.id);
    assignments.push({
      characterId: character.id,
      kind,
      buildingId: building.id,
      fixtureId: fixture.id,
      roomId: fixture.roomId,
      floor: fixture.floor,
      x: fixture.x,
      y: fixture.y,
      label: fixture.label,
    });
  };

  const unassignedSleeperIds: number[] = [];
  for (const sleeper of demand.sleepers) {
    const fixtureKind = sleepFixtureKind(building, sleeper);
    let fixture = addFixture(fixtureKind, sleepLabel(fixtureKind, sleeper), sleepRooms(building), 1, true);
    if (!fixture && !['prison', 'healer'].includes(building.type)) {
      fixture = addFixture('floor-pallet', `Временная постель ${sleeper.name}`, sleepRooms(building), 1, true, true);
    }
    if (fixture) assign(sleeper, building.type === 'prison' ? 'prison' : building.type === 'healer' ? 'treatment' : 'sleep', fixture);
    else unassignedSleeperIds.push(sleeper.id);
  }

  const unassignedStudentIds: number[] = [];
  for (const student of demand.students) {
    const fixture = addFixture('student-desk', `Парта ${student.name}`, ['classroom'], 1, true);
    if (!fixture) { unassignedStudentIds.push(student.id); continue; }
    const room = rooms.find(item => item.id === fixture.roomId);
    fixture.label = `Парта ${student.name} · ${room?.name ?? 'класс'}`;
    assign(student, 'school', fixture);
  }

  const governmentTeachers = world.settlementGovernments.find(item => item.settlementId === building.settlementId)?.teacherIds ?? [];
  const teacherIds = new Set([...governmentTeachers, ...demand.workers.filter(worker => ['teacher', 'scribe'].includes(worker.profession)).map(worker => worker.id)]);
  const unassignedWorkerIds: number[] = [];
  for (const worker of demand.workers) {
    const fixtureKind = workstationKind(building, worker);
    const label = teacherIds.has(worker.id) && building.type === 'school'
      ? `Учительский стол ${worker.name}`
      : `${workstationLabel(fixtureKind)} · ${worker.name}`;
    const fixture = addFixture(fixtureKind, label, workRooms(building, fixtureKind), 1, true);
    if (fixture) assign(worker, 'work', fixture);
    else unassignedWorkerIds.push(worker.id);
  }

  for (const prisoner of demand.prisoners.filter(character => !assignments.some(item => item.characterId === character.id && item.kind === 'prison'))) {
    const fixture = addFixture('prison-bed', `Койка заключённого ${prisoner.name}`, ['cell'], 1, true);
    if (fixture) assign(prisoner, 'prison', fixture);
  }
  for (const patient of demand.patients.filter(character => !assignments.some(item => item.characterId === character.id && item.kind === 'treatment'))) {
    const fixture = addFixture('treatment-bed', `Лечебная койка ${patient.name}`, ['ward'], 1, true);
    if (fixture) assign(patient, 'treatment', fixture);
  }

  addDecorativeCore(building, materials, addFixture);
  addPublicSeating(building, demand, addFixture);

  const functional = (fixture: InteriorFixture) => fixture.functional && !fixture.blocked && fixture.condition > 0;
  const availableBeds = fixtures.filter(item => functional(item) && ['bed', 'double-bed', 'bunk-bed', 'prison-bed', 'treatment-bed', 'floor-pallet'].includes(item.kind)).reduce((sum, item) => sum + item.capacity, 0);
  const availableDesks = fixtures.filter(item => functional(item) && item.kind === 'student-desk').reduce((sum, item) => sum + item.capacity, 0);
  const availableWorkstations = fixtures.filter(item => functional(item) && isWorkstation(item.kind)).reduce((sum, item) => sum + item.capacity, 0);
  const warnings: string[] = [];
  if (unassignedSleeperIds.length) warnings.push(`без спального места: ${unassignedSleeperIds.length}`);
  if (unassignedStudentIds.length) warnings.push(`без парты: ${unassignedStudentIds.length}`);
  if (unassignedWorkerIds.length) warnings.push(`без рабочего места: ${unassignedWorkerIds.length}`);
  if (requests.reduce((sum, request) => sum + request.count, 0) > rooms.length) warnings.push('часть запрошенных помещений не помещается в существующих этажах');

  const plan: BuildingInteriorPlan = {
    version: INTERIOR_VERSION,
    generatedTick: worldTick(world),
    floorCount: building.floors,
    buildingId: building.id,
    signature,
    materials,
    rooms,
    fixtures,
    assignments,
    stairs,
    requiredBeds: demand.sleepers.length,
    availableBeds,
    requiredDesks: demand.students.length,
    availableDesks,
    requiredWorkstations: demand.workers.length,
    availableWorkstations,
    overflowFloors: 0,
    unassignedSleeperIds,
    unassignedStudentIds,
    unassignedWorkerIds,
    warnings,
  };
  building.interior = plan;
  cache.set(building.id, plan);
  return plan;
}

export function operationalWorkerIds(world: WorldState, buildingId: number): Set<number> {
  const building = world.buildings.find(item => item.id === buildingId);
  if (!building) return new Set();
  const plan = interiorPlanForBuilding(world, building);
  return new Set(plan.assignments
    .filter(assignment => assignment.kind === 'work')
    .filter(assignment => {
      const fixture = plan.fixtures.find(item => item.id === assignment.fixtureId);
      return Boolean(fixture?.functional && !fixture.blocked && fixture.condition > 0 && isWorkstation(fixture.kind));
    })
    .map(assignment => assignment.characterId));
}

export function operationalSchoolCapacity(world: WorldState, building: Building): number {
  if (building.type !== 'school') return 0;
  const plan = interiorPlanForBuilding(world, building);
  const operationalTeachers = operationalWorkerIds(world, building.id);
  const activeClassrooms = new Set(plan.assignments
    .filter(assignment => assignment.kind === 'work' && operationalTeachers.has(assignment.characterId))
    .map(assignment => assignment.roomId)
    .filter(roomId => plan.rooms.some(room => room.id === roomId && room.kind === 'classroom')));
  if (!activeClassrooms.size) return 0;
  return plan.assignments.filter(assignment => assignment.kind === 'school' && activeClassrooms.has(assignment.roomId)).filter(assignment => {
    const fixture = plan.fixtures.find(item => item.id === assignment.fixtureId);
    return Boolean(fixture?.functional && !fixture.blocked && fixture.condition > 0);
  }).length;
}

export function hasOperationalInteriorAssignment(
  world: WorldState,
  characterId: number,
  buildingId: number,
  kind: InteriorAssignmentKind,
): boolean {
  const building = world.buildings.find(item => item.id === buildingId);
  if (!building) return false;
  const plan = interiorPlanForBuilding(world, building);
  const assignment = plan.assignments.find(item => item.characterId === characterId && item.kind === kind);
  if (!assignment) return false;
  const fixture = plan.fixtures.find(item => item.id === assignment.fixtureId);
  if (!fixture?.functional || fixture.blocked || fixture.condition <= 0) return false;
  if (kind !== 'school') return true;
  const activeClassrooms = new Set(plan.assignments.filter(item => item.kind === 'work').filter(item => {
    const teacherFixture = plan.fixtures.find(fixture => fixture.id === item.fixtureId);
    return Boolean(teacherFixture?.functional && !teacherFixture.blocked && teacherFixture.condition > 0 && teacherFixture.kind === 'teacher-desk');
  }).map(item => item.roomId));
  return activeClassrooms.has(assignment.roomId);
}

export function applyInteriorMonthlyEffects(world: WorldState, elapsedMonths = 1): void {
  normalizeBuildingOccupancy(world);
  PLAN_CACHE.delete(world);
  for (const building of world.buildings) {
    const plan = interiorPlanForBuilding(world, building);
    for (const fixture of plan.fixtures) {
      if (fixture.temporary) fixture.condition = Math.max(0, fixture.condition - 2.4 * elapsedMonths);
      else fixture.condition = Math.max(0, fixture.condition - Math.max(.02, (100 - building.condition) / 850) * elapsedMonths);
      fixture.functional = !fixture.blocked && fixture.condition > 0;
    }
    for (const characterId of building.residentIds) {
      const character = world.characters.find(item => item.id === characterId && item.alive);
      if (!character) continue;
      const assignment = plan.assignments.find(item => item.characterId === character.id && item.kind === 'sleep');
      const fixture = assignment ? plan.fixtures.find(item => item.id === assignment.fixtureId) : undefined;
      if (!fixture?.functional) {
        character.needs.rest = Math.min(100, character.needs.rest + 10 * elapsedMonths);
        character.health = Math.max(1, character.health - .15 * elapsedMonths);
      } else {
        const recovery = fixture.kind === 'floor-pallet' ? 3 : fixture.kind === 'bunk-bed' ? 6 : 8;
        character.needs.rest = Math.max(0, character.needs.rest - recovery * elapsedMonths);
      }
    }
  }
  PLAN_CACHE.delete(world);
}

export interface InteriorExpansionNeed {
  buildingId: number;
  settlementId: number;
  buildingType: Building['type'];
  requestedType: Building['type'];
  shortage: number;
  reason: string;
}

export function interiorExpansionNeeds(world: WorldState): InteriorExpansionNeed[] {
  const needs: InteriorExpansionNeed[] = [];
  for (const building of world.buildings) {
    const plan = interiorPlanForBuilding(world, building);
    const shortage = plan.unassignedSleeperIds.length + plan.unassignedStudentIds.length + plan.unassignedWorkerIds.length;
    if (!shortage) continue;
    const settlement = world.settlements.find(item => item.id === building.settlementId);
    if (!settlement) continue;
    const requestedType = plan.unassignedStudentIds.length ? 'school'
      : plan.unassignedSleeperIds.length ? (building.type === 'tenement' || settlement.type === 'city' ? 'tenement' : 'house')
        : building.type;
    needs.push({
      buildingId: building.id,
      settlementId: building.settlementId,
      buildingType: building.type,
      requestedType,
      shortage,
      reason: `${building.name}: не хватает ${shortage} физических мест внутри здания`,
    });
  }
  return needs;
}

function findPreviousFixture(
  previous: BuildingInteriorPlan | undefined,
  kind: InteriorFixtureKind,
  label: string,
  floor: number,
  usedIds: ReadonlySet<string>,
): InteriorFixture | undefined {
  if (!previous) return undefined;
  return previous.fixtures.find(item => item.kind === kind && item.label === label && !usedIds.has(item.id))
    ?? previous.fixtures.find(item => item.kind === kind && item.floor === floor && !item.assignedCharacterIds.length && !usedIds.has(item.id));
}

function buildStairs(building: Building): InteriorStair[] {
  if (building.floors <= 1) return [];
  const innerLeft = building.localX + 1;
  const innerTop = building.localY + 1;
  const x = Math.min(building.localX + building.localWidth - 2, innerLeft + 1);
  const y = Math.min(building.localY + building.localHeight - 2, innerTop + 1);
  const stairs: InteriorStair[] = [];
  for (let floor = 0; floor < building.floors; floor += 1) {
    if (floor < building.floors - 1) stairs.push({ id: `stair:${building.id}:${floor}:up`, buildingId: building.id, floor, x, y, direction: 'up', connectedFloor: floor + 1 });
    if (floor > 0) stairs.push({ id: `stair:${building.id}:${floor}:down`, buildingId: building.id, floor, x: Math.min(building.localX + building.localWidth - 2, x + 1), y, direction: 'down', connectedFloor: floor - 1 });
  }
  return stairs;
}

function reserveStairs(stairs: InteriorStair[], occupiedByFloor: Map<number, Set<string>>): void {
  for (const stair of stairs) {
    const occupied = occupiedByFloor.get(stair.floor) ?? new Set<string>();
    occupied.add(`${stair.x}:${stair.y}`);
    occupiedByFloor.set(stair.floor, occupied);
  }
}

export function interiorPositionForCharacter(
  world: WorldState,
  character: Character,
  building: Building,
  kind: InteriorAssignmentKind,
): InteriorPosition | undefined {
  const plan = interiorPlanForBuilding(world, building);
  const exact = plan.assignments.find(item => item.characterId === character.id && item.kind === kind);
  const fallbackKind = kind === 'seat'
    ? ['chair', 'bench', 'table', 'bar-counter']
    : kind === 'treatment' ? ['treatment-bed', 'bed']
      : kind === 'prison' ? ['prison-bed', 'bed']
        : kind === 'work' ? plan.fixtures.filter(item => isWorkstation(item.kind)).map(item => item.kind)
          : [];
  const fixture = exact
    ? plan.fixtures.find(item => item.id === exact.fixtureId)
    : choosePublicFixture(plan.fixtures, fallbackKind as InteriorFixtureKind[], character.id, kind);
  if (!fixture) return undefined;
  const room = plan.rooms.find(item => item.id === fixture.roomId);
  return {
    fixtureId: fixture.id,
    roomId: fixture.roomId,
    x: fixture.x,
    y: fixture.y,
    floor: fixture.floor,
    fixtureKind: fixture.kind,
    fixtureLabel: fixture.label,
    roomName: room?.name ?? building.name,
  };
}

export function applyInteriorLayoutToMap(world: WorldState, map: LocalMapData): LocalMapData {
  if (map.level < 0) return map;
  const buildings = world.buildings.filter(building => building.globalX === map.globalX && building.globalY === map.globalY && building.floors > map.level);
  if (!buildings.length) return map;
  const cells = map.cells.map(cell => ({ ...cell }));
  for (const building of buildings) {
    const plan = interiorPlanForBuilding(world, building);
    const ground = floorGround(plan.materials.floor);
    for (const cell of cells) {
      if (cell.buildingId !== building.id || cell.feature === 'wall' || cell.feature === 'door') continue;
      cell.ground = ground;
    }
    for (const room of plan.rooms.filter(room => room.floor === map.level)) drawRoomPartitions(cells, map.width, building, room);
    for (const stair of plan.stairs.filter(item => item.floor === map.level)) {
      const cell = cells[stair.y * map.width + stair.x];
      if (!cell) continue;
      cell.buildingId = building.id;
      cell.ground = ground;
      cell.feature = stair.direction === 'up' ? 'stairs-up' : 'stairs-down';
      cell.blocked = false;
    }
  }
  return { ...map, cells };
}

export function interiorMarkersForMap(world: WorldState, map: LocalMapData): LocalMarker[] {
  if (map.level < 0) return [];
  const result: LocalMarker[] = [];
  for (const building of world.buildings.filter(item => item.globalX === map.globalX && item.globalY === map.globalY && item.floors > map.level)) {
    const plan = interiorPlanForBuilding(world, building);
    const floorFixtures = plan.fixtures.filter(item => item.floor === map.level);
    const visible = floorFixtures.slice(0, MAX_RENDERED_FIXTURES_PER_BUILDING);
    for (const fixture of visible) {
      const room = plan.rooms.find(item => item.id === fixture.roomId);
      const assigned = fixture.assignedCharacterIds
        .map(id => world.characters.find(character => character.id === id)?.name)
        .filter((name): name is string => Boolean(name));
      result.push({
        id: fixture.id,
        x: fixture.x,
        y: fixture.y,
        kind: markerKindForFixture(fixture.kind),
        label: fixture.label,
        refs: [
          { kind: 'building', id: building.id },
          ...fixture.assignedCharacterIds.slice(0, 4).map(id => ({ kind: 'character' as const, id })),
        ],
        count: fixture.capacity > 1 ? fixture.capacity : undefined,
        detail: `${room?.name ?? 'Помещение'} · ${fixture.material} · состояние ${Math.round(fixture.condition)}%. ${fixture.temporary ? 'Временное место. ' : ''}${assigned.length ? `Закреплено: ${assigned.join(', ')}.` : ''}`,
        visualRole: fixtureVisualRole(fixture.kind),
        footprintWidth: fixtureFootprint(fixture.kind).width,
        footprintHeight: fixtureFootprint(fixture.kind).height,
      });
    }
    const hidden = floorFixtures.length - visible.length;
    if (hidden > 0) result.push({
      id: `interior-hidden-${building.id}-${map.level}`,
      x: building.entranceX,
      y: building.entranceY,
      kind: 'group',
      label: `${building.name}: ещё ${hidden} предметов`,
      refs: [{ kind: 'building', id: building.id }],
      count: hidden,
      detail: 'Часть мебели скрыта на текущем масштабе, но остаётся физически размещённой на этаже.',
      visualRole: 'interior-furniture-group',
    });
    if (map.level === 0) result.push({
      id: `interior-materials-${building.id}`,
      x: building.entranceX,
      y: building.entranceY,
      kind: 'item',
      label: `${plan.materials.style} интерьер`,
      refs: [{ kind: 'building', id: building.id }],
      detail: `Стены: ${plan.materials.wall}. Пол: ${plan.materials.floor}. Мебель: ${plan.materials.furniture}. Текстиль: ${plan.materials.textile}. Освещение: ${plan.materials.light}.`,
      visualRole: 'interior-materials',
    });
  }
  return result;
}

export function interiorIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const plans = new Map(world.buildings.map(building => [building.id, interiorPlanForBuilding(world, building)]));
  for (const building of world.buildings) {
    const plan = plans.get(building.id)!;
    if (plan.version !== INTERIOR_VERSION) issues.push(`${building.name}: устаревшая версия физического интерьера`);
    if (plan.floorCount !== building.floors) issues.push(`${building.name}: интерьер хранит ${plan.floorCount} этажей при здании ${building.floors}`);
    const assignmentKeys = new Set<string>();
    const fixtureIds = new Set<string>();
    for (const fixture of plan.fixtures) {
      if (fixtureIds.has(fixture.id)) issues.push(`${building.name}: повтор идентификатора мебели ${fixture.id}`);
      fixtureIds.add(fixture.id);
    }
    for (const assignment of plan.assignments) {
      const key = `${assignment.characterId}:${assignment.kind}`;
      if (assignmentKeys.has(key)) issues.push(`${building.name}: у жителя №${assignment.characterId} повторное назначение «${assignment.kind}»`);
      assignmentKeys.add(key);
      if (!fixtureIds.has(assignment.fixtureId)) issues.push(`${building.name}: назначение жителя №${assignment.characterId} ссылается на отсутствующую мебель`);
      if (assignment.floor < 0 || assignment.floor >= building.floors) issues.push(`${building.name}: назначение жителя №${assignment.characterId} находится на несуществующем этаже`);
    }
    const footprintByFloor = new Map<number, Set<string>>();
    for (const fixture of plan.fixtures) {
      if (fixture.assignedCharacterIds.length > fixture.capacity) issues.push(`${building.name}: ${fixture.label} перегружено ${fixture.assignedCharacterIds.length}/${fixture.capacity}`);
      if (fixture.floor < 0 || fixture.floor >= building.floors) issues.push(`${building.name}: ${fixture.label} назначено на несуществующий этаж ${fixture.floor + 1}`);
      if (fixture.condition < 0 || fixture.condition > fixture.maxCondition) issues.push(`${building.name}: ${fixture.label} имеет неверное состояние`);
      const footprint = fixtureFootprint(fixture.kind);
      if (fixture.x <= building.localX || fixture.y <= building.localY
        || fixture.x + footprint.width > building.localX + building.localWidth - 1
        || fixture.y + footprint.height > building.localY + building.localHeight - 1) {
        issues.push(`${building.name}: ${fixture.label} стоит вне полезной площади`);
      }
      const occupied = footprintByFloor.get(fixture.floor) ?? new Set<string>();
      for (let dy = 0; dy < footprint.height; dy += 1) for (let dx = 0; dx < footprint.width; dx += 1) {
        const key = `${fixture.x + dx}:${fixture.y + dy}`;
        if (occupied.has(key)) issues.push(`${building.name}: мебель пересекается на этаже ${fixture.floor + 1} в клетке ${key}`);
        occupied.add(key);
      }
      footprintByFloor.set(fixture.floor, occupied);
    }
    for (let floor = 0; floor < building.floors; floor += 1) {
      if (building.floors > 1 && !plan.stairs.some(stair => stair.floor === floor)) issues.push(`${building.name}: этаж ${floor + 1} не соединён лестницей`);
    }
  }
  return [...new Set(issues)];
}

export function interiorCapacityWarnings(world: WorldState): string[] {
  const warnings: string[] = [];
  for (const building of world.buildings) {
    const plan = interiorPlanForBuilding(world, building);
    if (plan.unassignedSleeperIds.length) warnings.push(`${building.name}: ${plan.unassignedSleeperIds.length} жителей спят без отдельного места`);
    if (plan.unassignedStudentIds.length) warnings.push(`${building.name}: ${plan.unassignedStudentIds.length} учеников не получили парту`);
    if (plan.unassignedWorkerIds.length) warnings.push(`${building.name}: ${plan.unassignedWorkerIds.length} работников не получили рабочее место`);
  }
  return [...new Set(warnings)];
}

function collectDemand(world: WorldState, building: Building): Demand {
  const alive = world.characters.filter(character => character.alive && character.settlementId === building.settlementId);
  const sleepers = alive.filter(character => character.homeBuildingId === building.id || building.residentIds.includes(character.id));
  const students = building.type === 'school'
    ? alive.filter(character => isSchoolAgeCharacter(character) && schoolBuildingForCharacter(world, character)?.id === building.id)
    : [];
  const workers = alive.filter(character => character.workplaceBuildingId === building.id
    || building.workerIds.includes(character.id)
    || (character.employerEstablishmentId !== undefined && character.employerEstablishmentId === building.establishmentId
      && world.employments.some(contract => contract.characterId === character.id && contract.active)));
  const prisoners = building.type === 'prison'
    ? alive.filter(character => character.legalStatus === 'заключён' || character.legalStatus === 'под стражей')
    : [];
  const patients = building.type === 'healer'
    ? alive.filter(character => character.health < 42)
    : [];
  if (building.type === 'barracks') {
    for (const character of alive.filter(character => character.serviceStatus === 'гарнизон' && (character.workplaceBuildingId === building.id || building.workerIds.includes(character.id)))) {
      if (!sleepers.some(item => item.id === character.id)) sleepers.push(character);
    }
  }
  if (building.type === 'prison') for (const character of prisoners) if (!sleepers.some(item => item.id === character.id)) sleepers.push(character);
  if (building.type === 'healer') for (const character of patients) if (!sleepers.some(item => item.id === character.id)) sleepers.push(character);
  return {
    sleepers: uniqueCharacters(sleepers),
    students: uniqueCharacters(students).sort((a, b) => a.age - b.age || a.id - b.id),
    workers: uniqueCharacters(workers),
    prisoners: uniqueCharacters(prisoners),
    patients: uniqueCharacters(patients),
  };
}

export function schoolBuildingForCharacter(world: WorldState, character: Character): Building | undefined {
  if (!isSchoolAgeCharacter(character)) return undefined;
  const schools = world.buildings.filter(building => building.settlementId === character.settlementId && building.type === 'school').sort((a, b) => a.id - b.id);
  if (!schools.length) return undefined;
  return schools[hashSeed(`${world.config.seed}:школа:${character.id}`) % schools.length];
}

function roomRequests(building: Building, demand: Demand): RoomRequest[] {
  const bedrooms = Math.max(1, Math.ceil(demand.sleepers.length / (building.type === 'barracks' ? 12 : building.type === 'tenement' ? 6 : 4)));
  const classroomCapacity = Math.max(6, Math.min(18, Math.floor(Math.max(12, (building.localWidth - 2) * (building.localHeight - 2)) / 3)));
  const classrooms = Math.max(1, Math.ceil(demand.students.length / classroomCapacity));
  const cells = Math.max(1, Math.ceil(demand.prisoners.length / 2));
  const workshops = Math.max(1, Math.ceil(demand.workers.length / 12));
  const requests: RoomRequest[] = [];
  const add = (kind: InteriorRoomKind, name: string, count = 1) => requests.push({ kind, name, count });
  if (building.type === 'house' || building.type === 'tenement') {
    add('entry', 'Сени'); add('common-room', 'Общая комната'); add('kitchen', 'Кухня'); add('bedroom', 'Спальная комната', bedrooms); add('storage', 'Кладовая');
  } else if (building.type === 'manor') {
    add('entry', 'Парадные сени'); add('great-hall', 'Главный зал'); add('kitchen', 'Кухня'); add('bedroom', 'Покои', bedrooms); add('study', 'Кабинет'); add('library', 'Библиотека'); add('storage', 'Кладовые');
  } else if (building.type === 'castle') {
    add('entry', 'Воротный зал'); add('great-hall', 'Большой зал'); add('throne-room', 'Тронный зал'); add('royal-chamber', 'Королевские покои'); add('guest-room', 'Гостевые покои', Math.max(1, Math.ceil(bedrooms / 2))); add('kitchen', 'Замковая кухня'); add('barracks', 'Казармы'); add('armory', 'Оружейная'); add('chapel', 'Часовня'); add('treasury', 'Казна'); add('library', 'Архив'); add('storage', 'Склады');
  } else if (building.type === 'school') {
    add('entry', 'Школьные сени'); add('classroom', 'Класс', classrooms); add('teacher-room', 'Учительская'); add('library', 'Учебная библиотека'); add('storage', 'Кладовая');
  } else if (building.type === 'tavern' || building.type === 'inn') {
    add('entry', 'Входной зал'); add('tavern-hall', 'Общий зал'); add('kitchen', 'Кухня'); add('pantry', 'Продуктовая кладовая'); add('cellar', 'Погреб'); if (building.type === 'inn') add('guest-room', 'Комнаты постояльцев', Math.max(1, bedrooms));
  } else if (building.type === 'blacksmith') {
    add('forge', 'Горновая'); add('workshop', 'Кузнечная мастерская', workshops); add('storage', 'Склад металла'); add('sales-floor', 'Приём заказов');
  } else if (building.type === 'barracks') {
    add('barracks', 'Спальная казарма', Math.max(1, bedrooms)); add('armory', 'Оружейная'); add('mess-hall', 'Солдатская столовая'); add('guard-room', 'Караульная'); add('storage', 'Склад снабжения');
  } else if (building.type === 'temple' || building.type === 'monastery') {
    add('sanctuary', 'Святилище'); add('chapel', 'Молельный зал'); add('vestry', 'Ризница'); add('library', 'Храмовая библиотека'); if (demand.sleepers.length) add('bedroom', 'Кельи', bedrooms); add('storage', 'Кладовая');
  } else if (building.type === 'healer' || building.type === 'bathhouse') {
    add('ward', 'Палата', Math.max(1, Math.ceil(Math.max(demand.patients.length, 1) / 6))); add('apothecary', 'Лекарская'); add('workshop', 'Процедурная'); add('storage', 'Склад лекарств');
  } else if (building.type === 'prison') {
    add('cell', 'Камера', cells); add('guard-room', 'Караульная'); add('workshop', 'Тюремная работа'); add('storage', 'Склад');
  } else if (building.type === 'market' || building.type === 'shop') {
    add('sales-floor', 'Торговый зал'); add('storage', 'Склад'); add('workshop', 'Подсобное помещение');
  } else if (building.type === 'stable') {
    add('stable', 'Стойла'); add('storage', 'Сеновал'); add('workshop', 'Сбруйная');
  } else {
    add('entry', 'Вход'); add('workshop', 'Рабочий зал', workshops); add('storage', 'Склад'); if (demand.sleepers.length) add('bedroom', 'Спальные помещения', bedrooms);
  }
  return requests;
}

function roomSlotsPerFloor(building: Building): number {
  const area = Math.max(1, (building.localWidth - 2) * (building.localHeight - 2));
  if (building.type === 'castle' || area >= 260) return 8;
  if (building.type === 'manor' || area >= 140) return 6;
  return ROOMS_PER_FLOOR;
}

function layoutRooms(building: Building, requests: RoomRequest[]): InteriorRoom[] {
  const roomKinds = requests.flatMap(request => Array.from({ length: request.count }, (_, index) => ({ kind: request.kind, name: request.count > 1 ? `${request.name} ${index + 1}` : request.name })));
  const innerX = building.localX + 1;
  const innerY = building.localY + 1;
  const innerWidth = Math.max(2, building.localWidth - 2);
  const innerHeight = Math.max(2, building.localHeight - 2);
  const slotsPerFloor = roomSlotsPerFloor(building);
  const floors = Math.max(1, building.floors);
  const rooms: InteriorRoom[] = [];
  for (let floor = 0; floor < floors; floor += 1) {
    const entries = roomKinds.slice(floor * slotsPerFloor, (floor + 1) * slotsPerFloor);
    if (!entries.length) continue;
    const columns = entries.length === 1 ? 1 : 2;
    const rows = Math.ceil(entries.length / columns);
    const baseWidth = Math.max(1, Math.floor(innerWidth / columns));
    const baseHeight = Math.max(1, Math.floor(innerHeight / rows));
    entries.forEach((entry, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = innerX + column * baseWidth;
      const y = innerY + row * baseHeight;
      const width = column === columns - 1 ? innerX + innerWidth - x : baseWidth;
      const height = row === rows - 1 ? innerY + innerHeight - y : baseHeight;
      rooms.push({
        id: `room:${building.id}:${floor}:${index}`,
        buildingId: building.id,
        kind: entry.kind,
        name: entry.name,
        floor,
        x,
        y,
        width: Math.max(1, width),
        height: Math.max(1, height),
        capacity: Math.max(1, width * height),
      });
    });
  }
  if (!rooms.length) rooms.push({ id: `room:${building.id}:0:0`, buildingId: building.id, kind: 'common-room', name: 'Главное помещение', floor: 0, x: innerX, y: innerY, width: innerWidth, height: innerHeight, capacity: innerWidth * innerHeight });
  return rooms;
}

function findFixturePlacement(
  building: Building,
  rooms: InteriorRoom[],
  preferred: InteriorRoomKind[],
  footprint: { width: number; height: number },
  occupiedByFloor: Map<number, Set<string>>,
): { room: InteriorRoom; position: { x: number; y: number } } | undefined {
  const candidates = rooms
    .filter(room => preferred.includes(room.kind))
    .sort((a, b) => a.floor - b.floor || a.id.localeCompare(b.id));
  for (const room of candidates) {
    const occupied = occupiedByFloor.get(room.floor) ?? new Set<string>();
    occupiedByFloor.set(room.floor, occupied);
    for (const point of roomPoints(room)) {
      if (!fixtureFits(building, room, point.x, point.y, footprint, occupied)) continue;
      occupyFixture(point.x, point.y, footprint, occupied);
      return { room, position: point };
    }
  }
  return undefined;
}

function fixtureFits(
  building: Building,
  room: InteriorRoom,
  x: number,
  y: number,
  footprint: { width: number; height: number },
  occupied: Set<string>,
): boolean {
  const roomRight = room.x + room.width;
  const roomBottom = room.y + room.height;
  const buildingRight = building.localX + building.localWidth - 1;
  const buildingBottom = building.localY + building.localHeight - 1;
  if (x < room.x || y < room.y || x + footprint.width > roomRight || y + footprint.height > roomBottom) return false;
  if (x <= building.localX || y <= building.localY || x + footprint.width > buildingRight || y + footprint.height > buildingBottom) return false;
  for (let dy = 0; dy < footprint.height; dy += 1) for (let dx = 0; dx < footprint.width; dx += 1) {
    if (occupied.has(`${x + dx}:${y + dy}`)) return false;
    if (room.floor === 0 && x + dx === building.entranceX && y + dy === building.entranceY) return false;
  }
  return true;
}

function occupyFixture(x: number, y: number, footprint: { width: number; height: number }, occupied: Set<string>): void {
  for (let dy = 0; dy < footprint.height; dy += 1) for (let dx = 0; dx < footprint.width; dx += 1) occupied.add(`${x + dx}:${y + dy}`);
}

function roomPoints(room: InteriorRoom): { x: number; y: number }[] {
  const result: { x: number; y: number }[] = [];
  const minX = room.width >= 3 ? room.x + 1 : room.x;
  const maxX = room.width >= 3 ? room.x + room.width - 2 : room.x + room.width - 1;
  const minY = room.height >= 3 ? room.y + 1 : room.y;
  const maxY = room.height >= 3 ? room.y + room.height - 2 : room.y + room.height - 1;
  for (let y = minY; y <= maxY; y += 1) {
    const row: { x: number; y: number }[] = [];
    for (let x = minX; x <= maxX; x += 1) row.push({ x, y });
    if ((y - minY) % 2) row.reverse();
    result.push(...row);
  }
  if (!result.length) result.push({ x: room.x, y: room.y });
  return result;
}

function addDecorativeCore(
  building: Building,
  materials: InteriorMaterialProfile,
  add: (kind: InteriorFixtureKind, label: string, rooms: InteriorRoomKind[], capacity?: number, functional?: boolean, temporary?: boolean) => InteriorFixture | undefined,
): void {
  const shared = () => {
    add('hearth', materials.quality === 'бедная' ? 'Открытый очаг' : 'Камин и очаг', ['common-room', 'great-hall', 'tavern-hall', 'mess-hall'], 1, false);
    add('table', 'Общий стол', ['common-room', 'great-hall', 'tavern-hall', 'mess-hall'], 6, false);
    add('chest', 'Сундук для вещей', ['bedroom', 'storage', 'guest-room'], 1, false);
    add('shelf', 'Полки', ['kitchen', 'storage', 'pantry'], 1, false);
  };
  if (['house', 'tenement', 'manor'].includes(building.type)) {
    shared(); add('kitchen-table', 'Кухонный стол', ['kitchen'], 2, false); add('barrel', 'Запасы воды', ['storage', 'kitchen'], 1, false);
    if (building.type === 'manor') { add('rug', 'Большой ковёр', ['great-hall', 'study'], 1, false); add('bookcase', 'Книжный шкаф', ['library', 'study'], 1, false); add('tapestry', 'Настенный гобелен', ['great-hall'], 1, false); }
  } else if (building.type === 'castle') {
    add('throne', 'Трон правителя', ['throne-room'], 1, false); add('carpet-runner', 'Ковровая дорожка к трону', ['throne-room'], 1, false);
    add('banner', 'Знамя государства', ['throne-room', 'great-hall'], 1, false); add('tapestry', 'Гобелен с историей рода', ['great-hall', 'royal-chamber'], 1, false);
    add('table', 'Длинный пиршественный стол', ['great-hall'], 12, false); add('fireplace', 'Каменный камин', ['great-hall', 'royal-chamber'], 1, false);
    add('altar', 'Замковый алтарь', ['chapel'], 1, false); add('weapon-rack', 'Стойка оружия', ['armory', 'barracks'], 8, false);
    add('bookcase', 'Архивные шкафы', ['library'], 1, false); add('chest', 'Окованный сундук казны', ['treasury'], 1, false);
  } else if (building.type === 'school') {
    add('teacher-desk', 'Главный учительский стол', ['classroom'], 1, false); add('lectern', 'Кафедра', ['classroom'], 1, false); add('bookcase', 'Шкаф с книгами и табличками', ['library', 'classroom'], 1, false);
  } else if (building.type === 'tavern' || building.type === 'inn') {
    add('bar-counter', 'Стойка трактирщика', ['tavern-hall'], 2, false); add('table', 'Большой стол', ['tavern-hall'], 6, false); add('bench', 'Длинная лавка', ['tavern-hall'], 4, false);
    add('barrel', 'Бочки с напитками', ['cellar', 'pantry'], 1, false); add('hearth', 'Кухонный очаг', ['kitchen'], 1, false); add('cauldron', 'Котёл', ['kitchen'], 1, false);
  } else if (building.type === 'blacksmith') {
    add('forge', 'Кузнечный горн', ['forge'], 2, false); add('anvil', 'Главная наковальня', ['forge'], 1, false); add('barrel', 'Бочка для закалки', ['forge'], 1, false); add('weapon-rack', 'Стойка готовых изделий', ['sales-floor', 'storage'], 6, false);
  } else if (building.type === 'temple' || building.type === 'monastery') {
    add('altar', 'Главный алтарь', ['sanctuary', 'chapel'], 1, false); add('carpet-runner', 'Дорожка к алтарю', ['sanctuary'], 1, false); add('bench', 'Скамьи прихожан', ['sanctuary', 'chapel'], 8, false); add('lectern', 'Кафедра служителя', ['sanctuary'], 1, false);
  } else if (building.type === 'barracks') {
    add('weapon-rack', 'Полковые стойки оружия', ['armory', 'barracks'], 12, false); add('table', 'Солдатский стол', ['mess-hall'], 8, false); add('training-dummy', 'Тренировочный манекен', ['guard-room', 'barracks'], 1, false);
  } else if (building.type === 'healer' || building.type === 'bathhouse') {
    add('shelf', 'Полки лекарств', ['apothecary'], 1, false); add('wash-basin', 'Умывальная чаша', ['ward', 'workshop'], 1, false); add('cauldron', 'Котёл для отваров', ['apothecary'], 1, false);
  } else if (building.type === 'prison') {
    add('guard-post', 'Пост надзирателя', ['guard-room'], 1, false); add('weapon-rack', 'Стойка стражи', ['guard-room'], 4, false);
  } else {
    add('table', 'Рабочий стол', ['workshop', 'sales-floor'], 2, false); add('shelf', 'Полки и запасы', ['storage', 'workshop'], 1, false);
  }
}

function addPublicSeating(
  building: Building,
  demand: Demand,
  add: (kind: InteriorFixtureKind, label: string, rooms: InteriorRoomKind[], capacity?: number, functional?: boolean, temporary?: boolean) => InteriorFixture | undefined,
): void {
  const socialBuildings: Building['type'][] = ['house', 'tenement', 'manor', 'tavern', 'inn', 'temple', 'monastery', 'castle', 'barracks', 'school', 'market', 'shop', 'townHall', 'courthouse', 'healer', 'bathhouse'];
  if (!socialBuildings.includes(building.type)) return;
  const target = building.type === 'tavern' || building.type === 'inn' ? Math.max(8, Math.min(building.capacity, 48))
    : building.type === 'temple' ? Math.max(8, Math.min(building.capacity, 64))
      : building.type === 'castle' ? Math.max(12, Math.min(building.capacity, 72))
        : Math.max(4, Math.min(16, demand.sleepers.length + demand.workers.length));
  const roomKinds: InteriorRoomKind[] = building.type === 'school' ? ['classroom', 'teacher-room']
    : building.type === 'healer' || building.type === 'bathhouse' ? ['ward', 'workshop']
      : building.type === 'townHall' || building.type === 'courthouse' ? ['workshop', 'entry']
        : ['tavern-hall', 'sanctuary', 'great-hall', 'common-room', 'sales-floor', 'mess-hall'];
  const perBench = 4;
  const count = Math.ceil(target / perBench);
  for (let index = 0; index < count; index += 1) add('bench', `Место для посетителей ${index + 1}`, roomKinds, perBench, false);
}

export function isSchoolAgeCharacter(character: Character): boolean {
  const adultAge = raceDefinition(character.species).adultAge;
  const schoolStart = Math.max(5, Math.round(adultAge * .3));
  return character.age >= schoolStart && character.age < adultAge;
}

function normalizeBuildingOccupancy(world: WorldState): void {
  const buildingById = new Map(world.buildings.map(building => [building.id, building]));
  const householdById = new Map(world.households.map(household => [household.id, household]));
  const establishmentById = new Map(world.establishments.map(establishment => [establishment.id, establishment]));
  const characterById = new Map(world.characters.map(character => [character.id, character]));

  // Старые сохранения могли знать жильца или работника только со стороны здания.
  // Восстанавливаем обратную ссылку детерминированно, не назначая человека в два места.
  for (const building of [...world.buildings].sort((a, b) => a.id - b.id)) {
    for (const characterId of building.residentIds) {
      const character = characterById.get(characterId);
      if (character?.alive && character.settlementId === building.settlementId && !character.homeBuildingId) character.homeBuildingId = building.id;
    }
    for (const characterId of building.workerIds) {
      const character = characterById.get(characterId);
      if (character?.alive && character.settlementId === building.settlementId && !character.workplaceBuildingId) character.workplaceBuildingId = building.id;
    }
  }

  // Трудовой договор — источник истины для рабочего места. Старые миры и
  // миграции могли сохранить активный контракт, но потерять workerIds.
  for (const contract of [...world.employments].filter(item => item.active).sort((a, b) => a.id - b.id)) {
    const character = characterById.get(contract.characterId);
    const establishment = establishmentById.get(contract.establishmentId);
    const workplace = establishment ? buildingById.get(establishment.buildingId) : undefined;
    if (!character?.alive || !establishment || !workplace) continue;
    if (character.settlementId !== establishment.settlementId || workplace.settlementId !== establishment.settlementId) continue;
    character.employmentContractId ??= contract.id;
    character.employerEstablishmentId ??= establishment.id;
    character.workplaceBuildingId ??= workplace.id;
    if (!establishment.workerIds.includes(character.id)) establishment.workerIds.push(character.id);
    if (!workplace.workerIds.includes(character.id)) workplace.workerIds.push(character.id);
  }
  for (const establishment of world.establishments) establishment.workerIds = [...new Set(establishment.workerIds)].sort((a, b) => a - b);
  for (const building of world.buildings) building.workerIds = [...new Set(building.workerIds)].sort((a, b) => a - b);

  for (const character of world.characters.filter(item => item.alive)) {
    const household = character.householdId ? householdById.get(character.householdId) : undefined;
    if (household?.homeBuildingId && (!character.homeBuildingId || !buildingById.has(character.homeBuildingId))) character.homeBuildingId = household.homeBuildingId;
    const activeContract = character.employmentContractId
      ? world.employments.find(contract => contract.id === character.employmentContractId && contract.active)
      : world.employments.find(contract => contract.characterId === character.id && contract.active);
    const establishment = activeContract ? establishmentById.get(activeContract.establishmentId) : character.employerEstablishmentId ? establishmentById.get(character.employerEstablishmentId) : undefined;
    if (establishment && (!character.workplaceBuildingId || !buildingById.has(character.workplaceBuildingId))) character.workplaceBuildingId = establishment.buildingId;
  }

  for (const building of world.buildings) {
    const residents = world.characters.filter(character => character.alive && character.settlementId === building.settlementId && (
      character.homeBuildingId === building.id
      || (character.householdId !== undefined && householdById.get(character.householdId)?.homeBuildingId === building.id)
    ));
    building.residentIds = [...new Set(residents.map(character => character.id))].sort((a, b) => a - b);
    const workers = world.characters.filter(character => character.alive && character.settlementId === building.settlementId && (
      character.workplaceBuildingId === building.id
      || world.employments.some(contract => contract.characterId === character.id && contract.active && establishmentById.get(contract.establishmentId)?.buildingId === building.id)
    ));
    building.workerIds = [...new Set(workers.map(character => character.id))].sort((a, b) => a - b);
  }
}

function roomKindLabel(kind: InteriorRoomKind): string {
  return ({
    classroom: 'Дополнительный класс', bedroom: 'Дополнительная спальня', barracks: 'Дополнительная казарма',
    cell: 'Дополнительная камера', ward: 'Дополнительная палата', workshop: 'Дополнительная мастерская',
    forge: 'Дополнительная горновая', 'teacher-room': 'Учительская', 'sales-floor': 'Рабочий торговый зал',
    'tavern-hall': 'Дополнительный общий зал', sanctuary: 'Дополнительный молельный зал', 'guard-room': 'Дополнительная караульная',
  } as Partial<Record<InteriorRoomKind, string>>)[kind] ?? 'Дополнительное помещение';
}

function markerKindForFixture(kind: InteriorFixtureKind): LocalMarker['kind'] {
  if (['hearth', 'fireplace', 'forge', 'oven', 'cauldron'].includes(kind)) return 'camp';
  if (['throne', 'banner', 'tapestry', 'altar'].includes(kind)) return 'artifact';
  if (['rug', 'carpet-runner'].includes(kind)) return 'field';
  return 'item';
}

function fixtureVisualRole(kind: InteriorFixtureKind): string {
  if (['hearth', 'fireplace', 'forge', 'oven'].includes(kind)) return 'campfire';
  if (kind === 'cauldron') return 'fieldKitchen';
  return `interior-${kind}`;
}

function materialProfile(world: WorldState, building: Building): InteriorMaterialProfile {
  const kingdom = world.kingdoms.find(item => item.id === world.settlements.find(settlement => settlement.id === building.settlementId)?.kingdomId);
  const species = kingdom?.species ?? 'human';
  const settlement = world.settlements.find(item => item.id === building.settlementId);
  const household = building.householdId ? world.households.find(item => item.id === building.householdId) : undefined;
  const palace = building.type === 'castle';
  const rich = palace || building.type === 'manor' || household?.status === 'богатые' || household?.status === 'знатные' || (settlement?.prosperity ?? 0) >= 75;
  const poor = household?.status === 'нищие' || household?.status === 'бедные' || (settlement?.prosperity ?? 50) < 28;
  const quality: InteriorMaterialProfile['quality'] = palace ? 'дворцовая' : rich ? 'богатая' : poor ? 'бедная' : (settlement?.prosperity ?? 50) >= 52 ? 'добротная' : 'простая';
  const cold = ['tundra', 'mountains'].includes(world.tiles.find(tile => tile.x === building.globalX && tile.y === building.globalY)?.terrain ?? 'plains');
  const base = species === 'elf'
    ? { wall: 'резное светлое дерево и белёная штукатурка', floor: rich ? 'светлый камень с деревянными вставками' : 'гладкие доски', ceiling: 'изогнутые деревянные балки', furniture: 'резное дерево', textile: 'зелёные и серебристые ткани', metal: 'серебристая бронза', style: 'эльфийский' }
    : species === 'dwarf'
      ? { wall: 'тёсаный камень', floor: 'каменные плиты', ceiling: 'каменный свод с железными креплениями', furniture: 'тяжёлый дуб и металл', textile: 'плотная шерсть', metal: 'чёрное железо и бронза', style: 'дворфийский' }
      : species === 'orc'
        ? { wall: 'толстые брёвна, камень и шкуры', floor: rich ? 'широкие тёмные доски' : 'утрамбованная земля', ceiling: 'массивные балки', furniture: 'грубое тёмное дерево', textile: 'кожа, шерсть и шкуры', metal: 'кованое железо', style: 'оркский' }
        : { wall: palace ? 'тёсаный камень' : rich ? 'камень и штукатурка' : poor ? 'дерево, глина и плетень' : 'дерево и штукатурка', floor: palace ? 'каменные плиты' : rich ? 'добротные доски и плитка' : poor ? 'утрамбованная земля' : 'деревянные доски', ceiling: palace ? 'каменные своды' : 'деревянные балки', furniture: rich ? 'дубовая мебель' : poor ? 'грубое дерево' : 'простое дерево', textile: rich ? 'окрашенная шерсть и лён' : poor ? 'неокрашенный лён' : 'шерсть и лён', metal: rich ? 'бронза и кованое железо' : 'простое железо', style: 'человеческий' };
  return { ...base, species, quality, light: cold ? 'очаги, жаровни и масляные лампы' : rich ? 'свечи и масляные лампы' : 'очаг и лучины' };
}

function workstationKind(building: Building, worker: Character): InteriorFixtureKind {
  if (building.type === 'school') return 'teacher-desk';
  if (building.type === 'blacksmith' || worker.profession === 'blacksmith') return 'anvil';
  if (building.type === 'weaver' || worker.profession === 'weaver') return 'loom';
  if (building.type === 'bakery' || worker.profession === 'baker') return 'oven';
  if (building.type === 'tavern' || building.type === 'inn') return worker.profession === 'brewer' ? 'kitchen-table' : 'bar-counter';
  if (building.type === 'market' || building.type === 'shop' || worker.profession === 'merchant') return 'counter';
  if (building.type === 'temple' || worker.profession === 'priest') return 'lectern';
  if (building.type === 'castle' || building.type === 'townHall' || building.type === 'courthouse' || worker.profession === 'scribe') return 'writing-desk';
  if (building.type === 'barracks' || worker.profession === 'guard' || worker.profession === 'soldier') return 'guard-post';
  if (building.type === 'healer' || worker.profession === 'healer' || worker.profession === 'herbalist') return 'workbench';
  return 'workbench';
}

function workRooms(building: Building, kind: InteriorFixtureKind): InteriorRoomKind[] {
  if (kind === 'teacher-desk') return ['classroom', 'teacher-room'];
  if (kind === 'anvil' || kind === 'forge') return ['forge', 'workshop'];
  if (kind === 'counter' || kind === 'bar-counter' || kind === 'market-stall') return ['sales-floor', 'tavern-hall'];
  if (kind === 'lectern') return ['sanctuary', 'chapel'];
  if (kind === 'writing-desk') return ['study', 'library', 'great-hall'];
  if (kind === 'guard-post') return ['guard-room', 'barracks', 'armory'];
  return ['workshop', 'apothecary', 'kitchen', 'sales-floor'];
}

function sleepFixtureKind(building: Building, _character: Character): InteriorFixtureKind {
  if (building.type === 'prison') return 'prison-bed';
  if (building.type === 'healer') return 'treatment-bed';
  if (building.type === 'barracks' || building.type === 'tenement') return 'bunk-bed';
  return 'bed';
}

function sleepRooms(building: Building): InteriorRoomKind[] {
  if (building.type === 'prison') return ['cell'];
  if (building.type === 'healer') return ['ward'];
  if (building.type === 'barracks') return ['barracks'];
  if (building.type === 'castle') return ['royal-chamber', 'guest-room', 'barracks'];
  return ['bedroom', 'guest-room', 'common-room'];
}

function sleepLabel(kind: InteriorFixtureKind, character: Character): string {
  if (kind === 'prison-bed') return `Койка заключённого ${character.name}`;
  if (kind === 'treatment-bed') return `Лечебная койка ${character.name}`;
  if (kind === 'bunk-bed') return `Личная койка ${character.name}`;
  return `Кровать ${character.name}`;
}

function workstationLabel(kind: InteriorFixtureKind): string {
  return ({
    'teacher-desk': 'Учительский стол', anvil: 'Наковальня', loom: 'Ткацкий станок', oven: 'Печь',
    'bar-counter': 'Место за стойкой', counter: 'Прилавок', lectern: 'Кафедра', 'writing-desk': 'Письменный стол',
    'guard-post': 'Служебный пост', workbench: 'Верстак', 'kitchen-table': 'Рабочий кухонный стол',
  } as Partial<Record<InteriorFixtureKind, string>>)[kind] ?? 'Рабочее место';
}

function fixtureMaterial(kind: InteriorFixtureKind, materials: InteriorMaterialProfile): string {
  if (['rug', 'carpet-runner', 'banner', 'tapestry'].includes(kind)) return materials.textile;
  if (['anvil', 'forge', 'weapon-rack', 'guard-post'].includes(kind)) return materials.metal;
  if (kind === 'floor-pallet') return materials.textile;
  if (['hearth', 'fireplace', 'oven', 'altar', 'throne'].includes(kind)) return `${materials.wall}, ${materials.metal}`;
  return materials.furniture;
}

function fixtureFootprint(kind: InteriorFixtureKind): { width: number; height: number } {
  if (kind === 'floor-pallet') return { width: 1, height: 1 };
  if (kind === 'bed' || kind === 'double-bed' || kind === 'bunk-bed' || kind === 'prison-bed' || kind === 'treatment-bed') return { width: kind === 'double-bed' ? 2 : 1, height: 2 };
  if (kind === 'table' || kind === 'bar-counter' || kind === 'kitchen-table' || kind === 'carpet-runner') return { width: 2, height: 1 };
  if (kind === 'rug') return { width: 2, height: 2 };
  if (kind === 'forge' || kind === 'oven') return { width: 2, height: 2 };
  return { width: 1, height: 1 };
}

function isWorkstation(kind: InteriorFixtureKind): boolean {
  return ['teacher-desk', 'writing-desk', 'workbench', 'anvil', 'forge', 'loom', 'oven', 'counter', 'market-stall', 'bar-counter', 'kitchen-table', 'guard-post', 'lectern'].includes(kind);
}

function choosePublicFixture(fixtures: InteriorFixture[], kinds: InteriorFixtureKind[], characterId: number, salt: string): InteriorFixture | undefined {
  const candidates = fixtures.filter(fixture => kinds.includes(fixture.kind));
  if (!candidates.length) return undefined;
  return candidates[hashSeed(`интерьер:${salt}:${characterId}`) % candidates.length];
}

function floorGround(floor: string): LocalCell['ground'] {
  if (/кам|плит|слан/i.test(floor)) return 'stone';
  if (/земл|глин/i.test(floor)) return 'dirt';
  return 'floor';
}

function drawRoomPartitions(cells: LocalCell[], width: number, building: Building, room: InteriorRoom): void {
  const right = room.x + room.width - 1;
  const bottom = room.y + room.height - 1;
  const buildingRight = building.localX + building.localWidth - 2;
  const buildingBottom = building.localY + building.localHeight - 2;
  if (room.width >= 3 && right < buildingRight) {
    const doorY = room.y + Math.floor(room.height / 2);
    for (let y = room.y; y <= bottom; y += 1) setPartition(cells, width, right, y, y === doorY);
  }
  if (room.height >= 3 && bottom < buildingBottom) {
    const doorX = room.x + Math.floor(room.width / 2);
    for (let x = room.x; x <= right; x += 1) setPartition(cells, width, x, bottom, x === doorX);
  }
}

function setPartition(cells: LocalCell[], width: number, x: number, y: number, door: boolean): void {
  const cell = cells[y * width + x];
  if (!cell || cell.feature === 'door') return;
  cell.feature = door ? 'door' : 'wall';
  cell.blocked = !door;
}

function baseFunctionalFixtureCount(building: Building): number {
  if (building.type === 'castle') return 16;
  if (building.type === 'school') return 5;
  if (building.type === 'tavern' || building.type === 'inn') return 10;
  if (building.type === 'temple' || building.type === 'barracks') return 8;
  return 5;
}

function planSignature(world: WorldState, building: Building, demand: Demand): string {
  return [
    building.id, building.type, building.localX, building.localY, building.localWidth, building.localHeight, building.floors, building.condition,
    ...demand.sleepers.map(item => `s${item.id}`), ...demand.students.map(item => `d${item.id}`), ...demand.workers.map(item => `w${item.id}`),
    world.settlements.find(item => item.id === building.settlementId)?.prosperity ?? 0,
  ].join(':');
}

function uniqueCharacters(characters: Character[]): Character[] {
  return [...new Map(characters.map(character => [character.id, character])).values()].sort((a, b) => a.id - b.id);
}
