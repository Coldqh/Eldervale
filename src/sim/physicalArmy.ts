import type {
  Army, ArmyActivity, ArmyCamp, ArmyCampStructure, ArmyCampStructureKind, ArmyLocalPosition, Character, Tile, WorldState,
} from '../types';
import { hashSeed, RNG } from './rng';
import { worldTick } from './scheduler';
import type { WorldIndexes } from './indexes';

const PHYSICAL_ARMY_VERSION = 1;
const FIELD_TERRAINS = new Set<Tile['terrain']>(['plains', 'forest', 'hills', 'coast', 'marsh', 'desert', 'tundra', 'mountains']);
const CAMP_STATUSES = new Set<Army['status']>(['garrison', 'recovering']);

interface StructurePlan {
  kind: ArmyCampStructureKind;
  width: number;
  height: number;
  capacity: number;
  count: number;
}

export function initializePhysicalArmySystem(world: WorldState, rng = new RNG(`${world.config.seed}:физические-армии`), indexes?: WorldIndexes): void {
  world.armyCamps ??= [];
  world.armyCampStructures ??= [];
  world.armyLocalPositions ??= [];
  world.nextIds.armyCamp ??= Math.max(0, ...world.armyCamps.map(item => item.id)) + 1;
  world.nextIds.armyCampStructure ??= Math.max(0, ...world.armyCampStructures.map(item => item.id)) + 1;
  const positionCounts = countPositionsByArmy(world);
  for (const army of world.armies) synchronizePhysicalArmy(world, army, rng, true, indexes, positionCounts.get(army.id) ?? 0);
  world.simulation.physicalArmyVersion = PHYSICAL_ARMY_VERSION;
}

export function advancePhysicalArmySystem(world: WorldState, rng: RNG, indexes?: WorldIndexes): void {
  if (world.simulation.physicalArmyVersion !== PHYSICAL_ARMY_VERSION || !Array.isArray(world.armyCamps) || !Array.isArray(world.armyCampStructures) || !Array.isArray(world.armyLocalPositions)) {
    initializePhysicalArmySystem(world, rng, indexes);
    return;
  }
  if (world.month === 1 || world.armyCamps.length !== world.armies.length) {
    const armyIds = new Set(world.armies.map(item => item.id));
    world.armyCamps = world.armyCamps.filter(item => armyIds.has(item.armyId));
    const campIds = new Set(world.armyCamps.map(item => item.id));
    world.armyCampStructures = world.armyCampStructures.filter(item => campIds.has(item.campId));
    world.armyLocalPositions = world.armyLocalPositions.filter(item => armyIds.has(item.armyId));
  }
  const positionCounts = countPositionsByArmy(world);
  for (const army of world.armies) synchronizePhysicalArmy(world, army, rng, false, indexes, positionCounts.get(army.id) ?? 0);
}

export function nextArmyFieldStep(world: WorldState, army: Army, targetX: number, targetY: number): { x: number; y: number } {
  const currentDistance = Math.hypot(targetX - army.x, targetY - army.y);
  const candidates = neighbourTiles(world, army.x, army.y)
    .filter(tile => isArmyFieldTile(world, tile, army.id))
    .map(tile => ({ tile, distance: Math.hypot(targetX - tile.x, targetY - tile.y) }))
    .sort((a, b) => a.distance - b.distance || fieldTileScore(world, b.tile, army.kingdomId) - fieldTileScore(world, a.tile, army.kingdomId) || a.tile.y - b.tile.y || a.tile.x - b.tile.x);
  return candidates.find(candidate => candidate.distance < currentDistance + .01)?.tile ?? candidates[0]?.tile ?? { x: army.x, y: army.y };
}

export function ensureArmyOutsideSettlements(world: WorldState, army: Army): void {
  const tile = tileAt(world, army.x, army.y);
  if (tile && isArmyFieldTile(world, tile, army.id)) return;
  const kingdom = world.kingdoms.find(item => item.id === army.kingdomId);
  const capital = kingdom ? world.settlements.find(item => item.id === kingdom.capitalId) : undefined;
  const origin = capital ?? { x: army.x, y: army.y };
  const field = nearestArmyFieldTile(world, origin.x, origin.y, army.kingdomId, army.id);
  if (field) { army.x = field.x; army.y = field.y; }
}

function synchronizePhysicalArmy(world: WorldState, army: Army, rng: RNG, initial: boolean, indexes: WorldIndexes | undefined, positionCount: number): void {
  ensureArmyOutsideSettlements(world, army);
  const mode: ArmyCamp['mode'] = CAMP_STATUSES.has(army.status) ? 'camp' : army.status === 'battle' ? 'battle' : 'column';
  const tick = worldTick(world);
  let camp = world.armyCamps.find(item => item.armyId === army.id);
  if (!camp) {
    camp = {
      id: world.nextIds.armyCamp++, armyId: army.id, kingdomId: army.kingdomId, globalX: army.x, globalY: army.y,
      centerX: Math.floor((world.config.localMapSize ?? 128) / 2), centerY: Math.floor((world.config.localMapSize ?? 128) / 2),
      perimeterRadius: 10, mode, structureIds: [], establishedTick: tick, lastUpdatedTick: tick, layoutSignature: '',
      history: [`Полевое размещение создано в ${world.year}.${String(world.month).padStart(2, '0')}.`],
    } as ArmyCamp & { layoutSignature: string };
    world.armyCamps.push(camp);
  }
  const moved = camp.globalX !== army.x || camp.globalY !== army.y;
  const modeChanged = camp.mode !== mode;
  camp.kingdomId = army.kingdomId;
  camp.globalX = army.x; camp.globalY = army.y; camp.mode = mode; camp.lastUpdatedTick = tick;
  if (moved) { camp.establishedTick = tick; camp.history.push(`Армия переместилась в квадрат ${army.x}:${army.y}.`); }
  const signature = `${mode}:${army.soldierIds.length}:${Math.round(army.logistics.tents ?? 0)}:${army.supplyWagonIds.length}`;
  const rosterSignature = armyRosterSignature(army);
  const currentSignature = (camp as ArmyCamp & { layoutSignature?: string }).layoutSignature;
  const rosterChanged = camp.rosterSignature !== rosterSignature;
  const layoutChanged = initial || moved || modeChanged || currentSignature !== signature;
  const positionsChanged = layoutChanged || rosterChanged || positionCount !== army.soldierIds.length;

  if (initial || rosterChanged) {
    const soldierIds = new Set(army.soldierIds);
    for (const building of world.buildings) building.workerIds = building.workerIds.filter(id => !soldierIds.has(id));
    for (const establishment of world.establishments) establishment.workerIds = establishment.workerIds.filter(id => !soldierIds.has(id));
    for (const soldierId of army.soldierIds) {
      const soldier = indexes?.characterById.get(soldierId) ?? world.characters.find(item => item.id === soldierId);
      if (!soldier) continue;
      soldier.workplace = `полевой лагерь армии ${army.name}`;
      soldier.workplaceBuildingId = undefined;
    }
    camp.rosterSignature = rosterSignature;
  }
  if (layoutChanged) {
    rebuildCampLayout(world, army, camp, mode, rng, indexes);
    (camp as ArmyCamp & { layoutSignature?: string }).layoutSignature = signature;
  }
  if (positionsChanged) rebuildSoldierPositions(world, army, camp, mode, indexes);
  for (const wagonId of army.supplyWagonIds) {
    const wagon = indexes?.supplyWagonById.get(wagonId) ?? world.supplyWagons.find(item => item.id === wagonId && item.status !== 'уничтожен');
    if (!wagon) continue;
    wagon.x = army.x; wagon.y = army.y;
    if (mode === 'camp' && wagon.status !== 'разграблен') wagon.status = 'склад';
  }
  applyCampConsequences(world, army, mode, indexes);
}

function countPositionsByArmy(world: WorldState): Map<number, number> {
  const counts = new Map<number, number>();
  for (const position of world.armyLocalPositions) counts.set(position.armyId, (counts.get(position.armyId) ?? 0) + 1);
  return counts;
}

function armyRosterSignature(army: Army): string {
  let checksum = 0;
  for (const id of army.soldierIds) checksum = (checksum * 33 + id) >>> 0;
  return `${army.soldierIds.length}:${checksum}`;
}

function rebuildCampLayout(world: WorldState, army: Army, camp: ArmyCamp, mode: ArmyCamp['mode'], rng: RNG, indexes?: WorldIndexes): void {
  const oldIds = new Set(camp.structureIds);
  world.armyCampStructures = world.armyCampStructures.filter(item => !oldIds.has(item.id));
  camp.structureIds = [];
  if (mode !== 'camp' || army.soldierIds.length === 0) { camp.perimeterRadius = 6; return; }
  const soldiers = army.soldierIds.map(id => indexes?.characterById.get(id) ?? world.characters.find(item => item.id === id)).filter((item): item is Character => Boolean(item?.alive));
  const officers = soldiers.filter(item => ['командир', 'офицер', 'сержант', 'рыцарь'].includes(item.militaryRole ?? ''));
  const rankAndFile = soldiers.filter(item => !officers.includes(item));
  const availableTents = Math.max(1, Math.floor(army.logistics.tents || Math.ceil(soldiers.length / 6)));
  const soldierTents = Math.min(Math.ceil(rankAndFile.length / 6), availableTents);
  const officerTents = Math.min(Math.ceil(Math.max(0, officers.length - 1) / 2), Math.max(0, availableTents - soldierTents));
  const plans: StructurePlan[] = [
    { kind: 'commandTent', width: 3, height: 3, capacity: 1, count: 1 },
    { kind: 'officerTent', width: 2, height: 2, capacity: 2, count: officerTents },
    { kind: 'soldierTent', width: 2, height: 2, capacity: 6, count: soldierTents },
    { kind: 'fieldKitchen', width: 3, height: 2, capacity: 6, count: 1 },
    { kind: 'infirmary', width: 3, height: 2, capacity: Math.max(4, army.logistics.wounded), count: army.logistics.wounded > 0 || soldiers.length >= 40 ? 1 : 0 },
    { kind: 'supplyDepot', width: 3, height: 2, capacity: 12, count: 1 },
    { kind: 'workshop', width: 2, height: 2, capacity: 4, count: soldiers.length >= 45 ? 1 : 0 },
    { kind: 'horseLine', width: 5, height: 2, capacity: Math.max(1, army.logistics.horses), count: army.logistics.horses > 0 ? 1 : 0 },
    { kind: 'wagonPark', width: 5, height: 3, capacity: Math.max(1, army.supplyWagonIds.length), count: army.supplyWagonIds.length ? 1 : 0 },
    { kind: 'latrine', width: 2, height: 1, capacity: 40, count: Math.max(1, Math.ceil(soldiers.length / 90)) },
    { kind: 'campfire', width: 1, height: 1, capacity: 30, count: Math.max(1, Math.ceil(soldiers.length / 45)) },
    { kind: 'guardPost', width: 1, height: 1, capacity: 2, count: soldiers.length >= 80 ? 4 : 2 },
  ];
  const expanded = plans.flatMap(plan => Array.from({ length: plan.count }, () => plan));
  const localSize = world.config.localMapSize ?? 128;
  const maxColumns = Math.max(5, Math.min(10, Math.ceil(Math.sqrt(expanded.length * 1.6))));
  const startX = Math.max(8, camp.centerX - Math.floor(maxColumns * 3.2 / 2));
  let x = startX, y = Math.max(8, camp.centerY - Math.ceil(expanded.length / maxColumns) * 2);
  let rowHeight = 0, column = 0;
  for (const plan of expanded) {
    if (column >= maxColumns || x + plan.width >= localSize - 8) { x = startX; y += rowHeight + 2; rowHeight = 0; column = 0; }
    const structure: ArmyCampStructure = {
      id: world.nextIds.armyCampStructure++, campId: camp.id, armyId: army.id, kind: plan.kind,
      localX: x, localY: y, width: plan.width, height: plan.height, capacity: plan.capacity,
      condition: rng.int(72, 100), assignedCharacterIds: [], inventoryItemIds: [], history: [`Развёрнуто в ${world.year}.${String(world.month).padStart(2, '0')}.`],
    };
    world.armyCampStructures.push(structure); camp.structureIds.push(structure.id);
    x += plan.width + 2; rowHeight = Math.max(rowHeight, plan.height); column += 1;
  }
  const structures = camp.structureIds.map(id => world.armyCampStructures.find(item => item.id === id)).filter((item): item is ArmyCampStructure => Boolean(item));
  const minX = Math.min(...structures.map(item => item.localX), camp.centerX), maxX = Math.max(...structures.map(item => item.localX + item.width), camp.centerX);
  const minY = Math.min(...structures.map(item => item.localY), camp.centerY), maxY = Math.max(...structures.map(item => item.localY + item.height), camp.centerY);
  camp.centerX = Math.round((minX + maxX) / 2); camp.centerY = Math.round((minY + maxY) / 2);
  camp.perimeterRadius = Math.max(8, Math.ceil(Math.max(maxX - minX, maxY - minY) / 2) + 3);
}

function rebuildSoldierPositions(world: WorldState, army: Army, camp: ArmyCamp, mode: ArmyCamp['mode'], indexes?: WorldIndexes): void {
  const tick = worldTick(world);
  world.armyLocalPositions = world.armyLocalPositions.filter(item => item.armyId !== army.id);
  const soldiers = army.soldierIds.map(id => indexes?.characterById.get(id) ?? world.characters.find(item => item.id === id)).filter((item): item is Character => Boolean(item?.alive));
  const used = new Set<string>();
  if (mode === 'camp') assignCampTents(world, camp, soldiers);
  for (let index = 0; index < soldiers.length; index += 1) {
    const soldier = soldiers[index]!;
    const point = mode === 'camp' ? campPointForSoldier(world, camp, soldier, index, used)
      : mode === 'battle' ? formationPoint(camp, index, 12, 2)
        : formationPoint(camp, index, 4, 1);
    const activity = activityFor(soldier, mode, index, army);
    used.add(`${point.x}:${point.y}`);
    world.armyLocalPositions.push({ armyId: army.id, characterId: soldier.id, globalX: army.x, globalY: army.y, localX: point.x, localY: point.y, activity, formationIndex: index, lastUpdatedTick: tick });
    soldier.serviceStatus = mode === 'camp' ? 'гарнизон' : 'поход';
    soldier.schedule.currentActivity = activity;
  }
}

function assignCampTents(world: WorldState, camp: ArmyCamp, soldiers: Character[]): void {
  const structures = camp.structureIds.map(id => world.armyCampStructures.find(item => item.id === id)).filter((item): item is ArmyCampStructure => Boolean(item));
  structures.forEach(item => { item.assignedCharacterIds = []; });
  const commander = soldiers.find(item => item.militaryRole === 'командир');
  const command = structures.find(item => item.kind === 'commandTent');
  if (commander && command) command.assignedCharacterIds.push(commander.id);
  const officers = soldiers.filter(item => item.id !== commander?.id && ['офицер', 'сержант', 'рыцарь'].includes(item.militaryRole ?? ''));
  const rank = soldiers.filter(item => item.id !== commander?.id && !officers.includes(item));
  fillStructures(structures.filter(item => item.kind === 'officerTent'), officers);
  fillStructures(structures.filter(item => item.kind === 'soldierTent'), rank);
}

function fillStructures(structures: ArmyCampStructure[], people: Character[]): void {
  let index = 0;
  for (const structure of structures) while (structure.assignedCharacterIds.length < structure.capacity && index < people.length) structure.assignedCharacterIds.push(people[index++]!.id);
}

function campPointForSoldier(world: WorldState, camp: ArmyCamp, soldier: Character, index: number, used: Set<string>): { x: number; y: number } {
  const structures = world.armyCampStructures.filter(item => item.campId === camp.id);
  const structure = structures.find(item => item.assignedCharacterIds.includes(soldier.id));
  const base = structure ? { x: structure.localX + Math.floor(structure.width / 2), y: structure.localY + structure.height } : { x: camp.centerX, y: camp.centerY };
  const localSize = world.config.localMapSize ?? 128;
  const free = (point: { x: number; y: number }) => point.x >= 2 && point.y >= 2 && point.x < localSize - 2 && point.y < localSize - 2
    && !used.has(`${point.x}:${point.y}`)
    && !structures.some(item => point.x >= item.localX && point.x < item.localX + item.width && point.y >= item.localY && point.y < item.localY + item.height);
  const offsets = [[0,1],[1,1],[-1,1],[2,0],[-2,0],[1,-1],[-1,-1],[2,2],[-2,2],[3,1],[-3,1],[3,2],[-3,2],[0,2]];
  for (let step = 0; step < offsets.length; step += 1) {
    const offset = offsets[(index + step) % offsets.length]!;
    const point = { x: base.x + offset[0], y: base.y + offset[1] };
    if (free(point)) return point;
  }
  for (let radius = 1; radius < Math.max(12, camp.perimeterRadius + 8); radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (const dy of [-radius, radius]) { const point = { x: camp.centerX + dx, y: camp.centerY + dy }; if (free(point)) return point; }
    }
    for (let dy = -radius + 1; dy < radius; dy += 1) {
      for (const dx of [-radius, radius]) { const point = { x: camp.centerX + dx, y: camp.centerY + dy }; if (free(point)) return point; }
    }
  }
  return { x: Math.max(2, Math.min(localSize - 3, camp.centerX + (index % 15) - 7)), y: Math.max(2, Math.min(localSize - 3, camp.centerY + Math.floor(index / 15) + camp.perimeterRadius)) };
}

function formationPoint(camp: ArmyCamp, index: number, width: number, spacing: number): { x: number; y: number } {
  const row = Math.floor(index / width), column = index % width;
  return { x: camp.centerX - Math.floor(width / 2) * spacing + column * spacing, y: camp.centerY - Math.min(35, row) };
}

function activityFor(soldier: Character, mode: ArmyCamp['mode'], index: number, army: Army): ArmyActivity {
  if (mode === 'column') return 'идёт в колонне';
  if (mode === 'battle') return 'держит строй';
  if ((soldier.health < 55 || index < army.logistics.wounded) && army.logistics.wounded > 0) return 'лечится';
  if (soldier.militaryRole === 'командир' || soldier.militaryRole === 'офицер') return index % 3 === 0 ? 'несёт караул' : 'тренируется';
  const options: ArmyActivity[] = ['отдыхает', 'тренируется', 'несёт караул', 'готовит пищу', 'чинит снаряжение', 'ухаживает за лошадьми', 'разгружает обоз'];
  return options[hashSeed(`${soldier.id}:${army.id}:${army.status}`) % options.length]!;
}

function applyCampConsequences(world: WorldState, army: Army, mode: ArmyCamp['mode'], indexes?: WorldIndexes): void {
  if (mode !== 'camp' || army.soldierIds.length === 0) return;
  const needed = Math.max(1, Math.ceil(army.soldierIds.length / 6));
  const coverage = Math.min(1, (army.logistics.tents ?? 0) / needed);
  if (coverage >= .8) return;
  army.morale = Math.max(5, army.morale - 1);
  army.readiness = Math.max(0, army.readiness - 1);
  const unsheltered = army.soldierIds.slice(Math.floor(army.soldierIds.length * coverage));
  for (const id of unsheltered.slice(0, 40)) {
    const soldier = indexes?.characterById.get(id) ?? world.characters.find(item => item.id === id);
    if (soldier) soldier.needs.rest = Math.min(100, soldier.needs.rest + 4);
  }
}

function nearestArmyFieldTile(world: WorldState, x: number, y: number, kingdomId: number, armyId: number): Tile | undefined {
  const candidates = world.tiles.filter(tile => isArmyFieldTile(world, tile, armyId));
  return candidates.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) || fieldTileScore(world, b, kingdomId) - fieldTileScore(world, a, kingdomId) || a.y - b.y || a.x - b.x)[0];
}

function fieldTileScore(world: WorldState, tile: Tile, kingdomId: number): number {
  let score = tile.kingdomId === kingdomId ? 20 : 0;
  if (tile.terrain === 'plains') score += 18;
  else if (tile.terrain === 'hills' || tile.terrain === 'coast') score += 8;
  else if (tile.terrain === 'forest') score += 3;
  else if (tile.terrain === 'marsh' || tile.terrain === 'mountains') score -= 8;
  if (world.tradeRoutes.some(route => route.active && routeGlobalTiles(world, route).some(point => point.x === tile.x && point.y === tile.y))) score += 4;
  return score;
}

function isArmyFieldTile(world: WorldState, tile: Tile, armyId: number): boolean {
  if (!FIELD_TERRAINS.has(tile.terrain) || tile.settlementId || tile.dungeonId) return false;
  if (world.monsters.some(item => item.alive && item.x === tile.x && item.y === tile.y)) return false;
  return !world.armies.some(item => item.id !== armyId && item.x === tile.x && item.y === tile.y && item.status !== 'battle');
}

function neighbourTiles(world: WorldState, x: number, y: number): Tile[] {
  return [[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy]) => tileAt(world, x + dx, y + dy)).filter((item): item is Tile => Boolean(item));
}

function tileAt(world: WorldState, x: number, y: number): Tile | undefined { return world.tiles[y * world.config.width + x]; }

function routeGlobalTiles(world: WorldState, route: WorldState['tradeRoutes'][number]): { x: number; y: number }[] {
  const from = world.settlements.find(item => item.id === route.fromSettlementId), to = world.settlements.find(item => item.id === route.toSettlementId);
  if (!from || !to) return [];
  const points: { x: number; y: number }[] = [];
  let x = from.x, y = from.y;
  while (x !== to.x || y !== to.y) { points.push({ x, y }); if (x !== to.x) x += Math.sign(to.x - x); else y += Math.sign(to.y - y); }
  points.push({ x, y }); return points;
}

export function physicalArmyIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const soldierOwner = new Map<number, number>();
  const positionByCharacter = new Map(world.armyLocalPositions.map(item => [item.characterId, item]));
  for (const army of world.armies) {
    const tile = tileAt(world, army.x, army.y);
    if (!tile || tile.settlementId) issues.push(`${army.name}: армия находится внутри поселения.`);
    const camp = world.armyCamps.find(item => item.armyId === army.id);
    if (!camp) issues.push(`${army.name}: отсутствует полевая структура размещения.`);
    for (const soldierId of army.soldierIds) {
      if (soldierOwner.has(soldierId)) issues.push(`Солдат ${soldierId}: одновременно числится в двух армиях.`);
      soldierOwner.set(soldierId, army.id);
      const position = positionByCharacter.get(soldierId);
      if (!position) issues.push(`${army.name}: солдат ${soldierId} не имеет локальной позиции.`);
      else if (position.globalX !== army.x || position.globalY !== army.y) issues.push(`${army.name}: позиция солдата ${soldierId} не совпадает с квадратом армии.`);
    }
  }
  const structureIds = new Set(world.armyCampStructures.map(item => item.id));
  for (const camp of world.armyCamps) for (const id of camp.structureIds) if (!structureIds.has(id)) issues.push(`Лагерь ${camp.id}: отсутствует сооружение ${id}.`);
  return issues;
}
