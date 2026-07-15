import type {
  EntityRef, LocalCell, LocalExit, LocalFeature, LocalGround, LocalMapData, LocalMarker, Terrain, Tile, TradeRoute, WorldState,
} from '../types';
import { professionLabel, settlementTypeLabel } from '../i18n';
import { hashSeed, RNG } from '../sim/rng';

export const DEFAULT_LOCAL_MAP_SIZE = 128;

function localMapSize(world: WorldState): number {
  const value = world.config.localMapSize ?? DEFAULT_LOCAL_MAP_SIZE;
  return value === 96 || value === 160 ? value : 128;
}

type Side = LocalExit['side'];
type Point = { x: number; y: number };

const terrainTitles: Record<Terrain, string> = {
  ocean: 'Открытая вода', coast: 'Побережье', plains: 'Равнина', forest: 'Лес', hills: 'Холмы', mountains: 'Горный участок',
  marsh: 'Болото', desert: 'Пустыня', tundra: 'Тундра',
};

export function localMapKey(globalX: number, globalY: number, level = 0): string {
  return `${globalX}:${globalY}:${level}`;
}

export function generateLocalMap(world: WorldState, globalX: number, globalY: number, level = 0): LocalMapData {
  const tile = tileAt(world, globalX, globalY);
  if (!tile) throw new Error('Такого квадрата нет на карте мира.');
  const dungeon = world.dungeons.find(item => item.x === globalX && item.y === globalY);
  const availableLevels = [0, ...Array.from({ length: dungeon?.depth ?? 0 }, (_, index) => -(index + 1))];
  const safeLevel = availableLevels.includes(level) ? level : 0;
  if (safeLevel < 0) return generateDungeonLevel(world, tile, safeLevel, availableLevels);
  return generateSurface(world, tile, availableLevels);
}

function generateSurface(world: WorldState, tile: Tile, availableLevels: number[]): LocalMapData {
  const width = localMapSize(world);
  const height = width;
  const rng = new RNG(`${world.config.seed}:местность:${tile.x}:${tile.y}:0`);
  const cells = createBaseCells(world, tile, width, height, rng);
  const exits = roadExits(world, tile, width, height);
  drawRoadNetwork(cells, width, height, exits, rng, Boolean(tile.settlementId));

  const settlement = tile.settlementId ? world.settlements.find(item => item.id === tile.settlementId) : undefined;
  if (settlement) buildSettlement(world, cells, width, height, settlement, tile, exits, rng);
  placeCemeteries(world, tile, cells, width, height);
  const dungeon = tile.dungeonId ? world.dungeons.find(item => item.id === tile.dungeonId) : world.dungeons.find(item => item.x === tile.x && item.y === tile.y);
  if (dungeon) placeDungeonEntrance(cells, width, height, rng);

  applyHistoricalScars(world, tile, cells, width, height, rng);
  applyStoredEffects(world, tile.x, tile.y, 0, cells, width, height);

  const markers = buildSurfaceMarkers(world, tile, cells, width, height, rng, settlement, dungeon);
  const kingdom = tile.kingdomId ? world.kingdoms.find(item => item.id === tile.kingdomId) : undefined;
  const title = settlement?.name ?? dungeon?.name ?? terrainTitles[tile.terrain];
  const subtitleParts = [`квадрат ${tile.x}:${tile.y}`, terrainTitles[tile.terrain]];
  if (kingdom) subtitleParts.push(kingdom.name);
  if (settlement) subtitleParts.push(`${settlementTypeLabel(settlement.type)}, ${settlement.population} жителей`);

  return {
    key: localMapKey(tile.x, tile.y), globalX: tile.x, globalY: tile.y, level: 0, width, height, title,
    subtitle: subtitleParts.join(' · '), terrain: tile.terrain, cells, markers, exits, availableLevels,
  };
}

function generateDungeonLevel(world: WorldState, tile: Tile, level: number, availableLevels: number[]): LocalMapData {
  const width = localMapSize(world);
  const height = width;
  const dungeon = world.dungeons.find(item => item.x === tile.x && item.y === tile.y);
  if (!dungeon) return generateSurface(world, tile, availableLevels);
  const depth = Math.abs(level);
  const rng = new RNG(`${world.config.seed}:подземелье:${tile.x}:${tile.y}:${depth}`);
  const cells: LocalCell[] = Array.from({ length: width * height }, (_, index) => ({
    x: index % width, y: Math.floor(index / width), ground: 'stone' as LocalGround, feature: 'wall' as LocalFeature, blocked: true,
  }));

  const rooms: { x: number; y: number; w: number; h: number }[] = [];
  const roomCount = Math.min(14, 6 + depth * 2 + rng.int(0, 3));
  for (let attempt = 0; attempt < roomCount * 12 && rooms.length < roomCount; attempt += 1) {
    const w = rng.int(5, 11);
    const h = rng.int(4, 9);
    const room = { x: rng.int(2, width - w - 3), y: rng.int(2, height - h - 3), w, h };
    if (rooms.some(other => rectanglesOverlap(room, other, 2))) continue;
    rooms.push(room);
    carveRoom(cells, width, room);
  }
  for (let index = 1; index < rooms.length; index += 1) connectRooms(cells, width, center(rooms[index - 1]!), center(rooms[index]!), rng);
  const first = rooms[0] ?? { x: 20, y: 20, w: 8, h: 8 };
  const last = rooms.at(-1) ?? first;
  setCell(cells, width, center(first).x, center(first).y, { feature: 'stairs-up', blocked: false, ground: 'floor' });
  if (depth < (dungeon.depth ?? 1)) setCell(cells, width, center(last).x, center(last).y, { feature: 'stairs-down', blocked: false, ground: 'floor' });

  for (let i = 0; i < dungeon.danger * 3; i += 1) {
    const room = rng.pick(rooms.length ? rooms : [first]);
    const x = rng.int(room.x + 1, room.x + room.w - 2);
    const y = rng.int(room.y + 1, room.y + room.h - 2);
    if (rng.chance(.35)) setCell(cells, width, x, y, { feature: 'rubble', blocked: false });
  }
  const chestRoom = rng.pick(rooms.length ? rooms : [last]);
  setCell(cells, width, chestRoom.x + Math.floor(chestRoom.w / 2), chestRoom.y + Math.floor(chestRoom.h / 2), { feature: 'chest', blocked: true });
  applyStoredEffects(world, tile.x, tile.y, level, cells, width, height);

  const markers: LocalMarker[] = [];
  const monster = world.monsters.find(item => item.alive && item.lairDungeonId === dungeon.id);
  if (monster && depth === Math.max(1, dungeon.depth)) {
    const point = center(last);
    const topLeft = fitFootprint(cells, width, height, point, monster.footprintWidth ?? 1, monster.footprintHeight ?? 1);
    occupyFootprint(cells, width, topLeft, monster.footprintWidth ?? 1, monster.footprintHeight ?? 1);
    markers.push({ id: `monster-${monster.id}`, x: topLeft.x, y: topLeft.y, kind: 'monster', label: monster.name, refs: [{ kind: 'monster', id: monster.id }], detail: `Хозяин логова · занимает ${monster.footprintWidth ?? 1}×${monster.footprintHeight ?? 1} клеток`, footprintWidth: monster.footprintWidth ?? 1, footprintHeight: monster.footprintHeight ?? 1 });
  }
  for (const artifactId of dungeon.artifactIds) {
    const point = randomWalkable(cells, width, height, rng);
    const artifact = world.artifacts.find(item => item.id === artifactId);
    if (artifact) markers.push({ id: `artifact-${artifact.id}`, x: point.x, y: point.y, kind: 'artifact', label: artifact.name, refs: [{ kind: 'artifact', id: artifact.id }] });
  }

  return {
    key: localMapKey(tile.x, tile.y, level), globalX: tile.x, globalY: tile.y, level, width, height,
    title: `${dungeon.name} · уровень ${depth}`, subtitle: `${dungeon.currentInhabitants} · опасность ${dungeon.danger}/10`, terrain: tile.terrain,
    cells, markers, exits: [], availableLevels,
  };
}

function createBaseCells(world: WorldState, tile: Tile, width: number, height: number, rng: RNG): LocalCell[] {
  const cells: LocalCell[] = [];
  const oceanSides = oceanNeighbourSides(world, tile);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const edgeWater = tile.terrain === 'coast' && oceanSides.some(side => distanceFromSide(side, x, y, width, height) < 10 + Math.sin((x + y) * .45) * 2);
      let ground = baseGround(tile.terrain, edgeWater);
      let feature: LocalFeature | undefined;
      let blocked = ground === 'water';
      const roll = rng.next();
      if (!blocked) {
        if (tile.terrain === 'forest' && roll < .31) { feature = 'tree'; blocked = true; }
        else if (tile.terrain === 'plains' && roll < .08) feature = 'bush';
        else if ((tile.terrain === 'hills' || tile.terrain === 'mountains') && roll < (tile.terrain === 'mountains' ? .31 : .17)) { feature = 'rock'; blocked = true; }
        else if (tile.terrain === 'marsh' && roll < .22) feature = 'reeds';
        else if (tile.terrain === 'tundra' && roll < .12) { feature = 'rock'; blocked = true; }
        else if (tile.terrain === 'desert' && roll < .05) feature = 'rock';
      }
      cells.push({ x, y, ground, feature, blocked });
    }
  }
  return cells;
}

function baseGround(terrain: Terrain, coastWater: boolean): LocalGround {
  if (terrain === 'ocean' || coastWater) return 'water';
  if (terrain === 'coast' || terrain === 'desert') return 'sand';
  if (terrain === 'marsh') return 'mud';
  if (terrain === 'tundra') return 'snow';
  if (terrain === 'mountains' || terrain === 'hills') return 'stone';
  return 'grass';
}

function oceanNeighbourSides(world: WorldState, tile: Tile): Side[] {
  const sides: [Side, number, number][] = [['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0]];
  return sides.filter(([, dx, dy]) => tileAt(world, tile.x + dx, tile.y + dy)?.terrain === 'ocean').map(([side]) => side);
}

function distanceFromSide(side: Side, x: number, y: number, width: number, height: number): number {
  if (side === 'north') return y;
  if (side === 'south') return height - 1 - y;
  if (side === 'west') return x;
  return width - 1 - x;
}

function roadExits(world: WorldState, tile: Tile, width: number, height: number): LocalExit[] {
  const exits = new Map<Side, LocalExit>();
  for (const route of world.tradeRoutes) {
    const path = routeGlobalPath(world, route);
    const index = path.findIndex(point => point.x === tile.x && point.y === tile.y);
    if (index < 0) continue;
    const neighbours = [path[index - 1], path[index + 1]].filter((point): point is Point => Boolean(point));
    for (const neighbour of neighbours) {
      const side = sideTowards(tile, neighbour);
      if (!side) continue;
      exits.set(side, { side, position: boundaryPosition(world.config.seed, tile, side, width, height), road: true });
    }
  }
  if (tile.settlementId && exits.size === 0) {
    const settlement = world.settlements.find(item => item.id === tile.settlementId);
    const nearest = settlement ? world.settlements.filter(item => item.id !== settlement.id).sort((a, b) => Math.hypot(a.x - settlement.x, a.y - settlement.y) - Math.hypot(b.x - settlement.x, b.y - settlement.y))[0] : undefined;
    const side = nearest ? sideTowards(tile, nearest) : 'south';
    if (side) exits.set(side, { side, position: boundaryPosition(world.config.seed, tile, side, width, height), road: true });
  }
  return [...exits.values()];
}

function routeGlobalPath(world: WorldState, route: TradeRoute): Point[] {
  const from = world.settlements.find(item => item.id === route.fromSettlementId);
  const to = world.settlements.find(item => item.id === route.toSettlementId);
  if (!from || !to) return [];
  const raw = bresenham(from.x, from.y, to.x, to.y);
  const orthogonal: Point[] = [raw[0]!];
  for (const point of raw.slice(1)) {
    const previous = orthogonal.at(-1)!;
    if (point.x !== previous.x && point.y !== previous.y) orthogonal.push({ x: point.x, y: previous.y });
    if (point.x !== orthogonal.at(-1)!.x || point.y !== orthogonal.at(-1)!.y) orthogonal.push(point);
  }
  return orthogonal;
}

function bresenham(x0: number, y0: number, x1: number, y1: number): Point[] {
  const points: Point[] = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    points.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * error;
    if (e2 >= dy) { error += dy; x += sx; }
    if (e2 <= dx) { error += dx; y += sy; }
  }
  return points;
}

function sideTowards(from: Point, to: Point): Side | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? 'east' : 'west';
  if (dy !== 0) return dy > 0 ? 'south' : 'north';
  return undefined;
}

function boundaryPosition(seed: string, tile: Tile, side: Side, width: number, height: number): number {
  const vertical = side === 'east' || side === 'west';
  const bx = side === 'east' ? tile.x + 1 : tile.x;
  const by = side === 'south' ? tile.y + 1 : tile.y;
  const limit = vertical ? height : width;
  return 8 + hashSeed(`${seed}:граница:${vertical ? 'в' : 'г'}:${bx}:${by}`) % Math.max(1, limit - 16);
}

function drawRoadNetwork(cells: LocalCell[], width: number, height: number, exits: LocalExit[], rng: RNG, hasSettlement: boolean): void {
  if (!exits.length && !hasSettlement) return;
  const centerPoint = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
  const endpoints = exits.map(exit => exitPoint(exit, width, height)).concat(hasSettlement ? [centerPoint] : []);
  if (endpoints.length === 1) endpoints.push(centerPoint);
  const hub = hasSettlement ? centerPoint : endpoints[0]!;
  for (const endpoint of endpoints) drawPath(cells, width, height, endpoint, hub, rng, 2);
}

function exitPoint(exit: LocalExit, width: number, height: number): Point {
  if (exit.side === 'north') return { x: exit.position, y: 0 };
  if (exit.side === 'south') return { x: exit.position, y: height - 1 };
  if (exit.side === 'west') return { x: 0, y: exit.position };
  return { x: width - 1, y: exit.position };
}

function drawPath(cells: LocalCell[], width: number, height: number, from: Point, to: Point, rng: RNG, radius: number): void {
  let x = from.x;
  let y = from.y;
  let guard = 0;
  while ((x !== to.x || y !== to.y) && guard++ < width * height) {
    paintRoad(cells, width, height, x, y, radius);
    const chooseX = x !== to.x && (y === to.y || rng.chance(.56));
    if (chooseX) x += Math.sign(to.x - x); else if (y !== to.y) y += Math.sign(to.y - y);
  }
  paintRoad(cells, width, height, to.x, to.y, radius);
}

function paintRoad(cells: LocalCell[], width: number, height: number, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y += 1) for (let x = cx - radius; x <= cx + radius; x += 1) {
    if (!inside(x, y, width, height) || Math.abs(x - cx) + Math.abs(y - cy) > radius + 1) continue;
    const cell = cells[y * width + x]!;
    if (cell.ground === 'water') cell.feature = 'bridge'; else cell.feature = undefined;
    cell.ground = cell.ground === 'water' ? 'water' : 'road';
    cell.blocked = false;
  }
}

function buildSettlement(
  world: WorldState, cells: LocalCell[], width: number, height: number, settlement: WorldState['settlements'][number], tile: Tile, exits: LocalExit[], rng: RNG,
): void {
  const districts = settlement.districts?.length ? settlement.districts : [{ x: settlement.x, y: settlement.y, name: 'Сердце поселения', role: 'центр' as const }];
  const districtIndex = Math.max(0, districts.findIndex(item => item.x === tile.x && item.y === tile.y));
  const district = districts[districtIndex] ?? districts[0]!;
  const allLabels: string[] = [];
  for (const [label, count] of Object.entries(settlement.buildingCounts ?? {})) {
    for (let index = 0; index < count; index += 1) allLabels.push(label);
  }
  if (!allLabels.length) allLabels.push(...settlement.buildings);
  const labels = allLabels.filter((_, index) => index % districts.length === districtIndex);
  if (district.role === 'центр') {
    for (const label of settlement.buildings.filter(item => !item.includes('жилой дом') && !item.includes('сарай'))) {
      const clean = label.replace(/^\d+\s*×\s*/, '');
      if (!labels.includes(clean)) labels.unshift(clean);
    }
  }
  const targetCount = Math.min(labels.length, Math.floor((width - 10) * (height - 12) / 48));

  if (district.role === 'крепость' || (district.role === 'центр' && (settlement.type === 'city' || settlement.type === 'fortress'))) {
    drawSettlementWall(cells, width, height, exits);
  }
  const fieldCount = district.role === 'поля' ? Math.max(18, Math.round(width / 5)) : settlement.type === 'city' || settlement.type === 'fortress' ? 4 : Math.max(8, Math.round(width / 12));
  placeFields(cells, width, height, rng, fieldCount);

  const physicalBuildings = (world.buildings ?? []).filter(building => building.globalX === tile.x && building.globalY === tile.y);
  if (physicalBuildings.length) {
    for (const building of physicalBuildings) {
      const dimensions = physicalBuildingDimensions(building.type, building.floors);
      const slot = findBuildSlot(cells, width, height, building.localX, building.localY, dimensions.w, dimensions.h);
      if (!slot) continue;
      drawBuilding(cells, width, slot.x, slot.y, dimensions.w, dimensions.h, building.name, new RNG(`${world.config.seed}:физическое-здание:${building.id}`));
    }
    return;
  }

  const slots: Point[] = [];
  for (let y = 5; y < height - 9; y += 8) for (let x = 5; x < width - 9; x += 9) slots.push({ x, y });
  slots.sort(() => rng.next() - .5);
  let built = 0;
  for (const slot of slots) {
    if (built >= targetCount) break;
    const label = labels[built] ?? 'жилой дом';
    const dense = label === 'доходный дом' || district.role === 'центр';
    const w = dense ? rng.int(6, 9) : rng.int(5, 8);
    const h = dense ? rng.int(5, 8) : rng.int(4, 7);
    if (!canBuild(cells, width, height, slot.x, slot.y, w, h)) continue;
    drawBuilding(cells, width, slot.x, slot.y, w, h, label, rng);
    built += 1;
  }
}

function physicalBuildingDimensions(type: WorldState['buildings'][number]['type'], floors: number): { w: number; h: number } {
  if (type === 'tenement' || type === 'manor' || type === 'guildhall') return { w: Math.min(11, 7 + floors), h: Math.min(9, 6 + Math.floor(floors / 2)) };
  if (type === 'warehouse' || type === 'barracks' || type === 'market') return { w: 9, h: 7 };
  if (type === 'tavern' || type === 'inn' || type === 'temple') return { w: 8, h: 6 };
  if (type === 'farm' || type === 'stable') return { w: 8, h: 5 };
  return { w: 6, h: 5 };
}

function findBuildSlot(cells: LocalCell[], width: number, height: number, desiredX: number, desiredY: number, w: number, h: number): Point | undefined {
  const baseX = Math.max(2, Math.min(width - w - 2, desiredX));
  const baseY = Math.max(2, Math.min(height - h - 2, desiredY));
  for (let radius = 0; radius <= 18; radius += 2) {
    for (let dy = -radius; dy <= radius; dy += 2) for (let dx = -radius; dx <= radius; dx += 2) {
      const x = Math.max(2, Math.min(width - w - 2, baseX + dx));
      const y = Math.max(2, Math.min(height - h - 2, baseY + dy));
      if (canBuild(cells, width, height, x, y, w, h)) return { x, y };
    }
  }
  return undefined;
}

function drawSettlementWall(cells: LocalCell[], width: number, height: number, exits: LocalExit[]): void {
  const min = 3;
  const maxX = width - 4;
  const maxY = height - 4;
  for (let x = min; x <= maxX; x += 1) {
    setCell(cells, width, x, min, { feature: 'wall', blocked: true, ground: 'stone', building: 'городская стена' });
    setCell(cells, width, x, maxY, { feature: 'wall', blocked: true, ground: 'stone', building: 'городская стена' });
  }
  for (let y = min; y <= maxY; y += 1) {
    setCell(cells, width, min, y, { feature: 'wall', blocked: true, ground: 'stone', building: 'городская стена' });
    setCell(cells, width, maxX, y, { feature: 'wall', blocked: true, ground: 'stone', building: 'городская стена' });
  }
  for (const exit of exits) {
    const point = exitPoint(exit, width, height);
    const gate = { x: Math.max(min, Math.min(maxX, point.x)), y: Math.max(min, Math.min(maxY, point.y)) };
    for (let offset = -2; offset <= 2; offset += 1) {
      const x = exit.side === 'north' || exit.side === 'south' ? gate.x + offset : gate.x;
      const y = exit.side === 'east' || exit.side === 'west' ? gate.y + offset : gate.y;
      setCell(cells, width, x, y, { feature: 'door', blocked: false, ground: 'road', building: 'городские ворота' });
    }
  }
}

function placeFields(cells: LocalCell[], width: number, height: number, rng: RNG, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const x0 = rng.int(1, width - 10);
    const y0 = rng.int(1, height - 8);
    const w = rng.int(5, 10);
    const h = rng.int(4, 7);
    for (let y = y0; y < Math.min(height, y0 + h); y += 1) for (let x = x0; x < Math.min(width, x0 + w); x += 1) {
      const cell = cells[y * width + x]!;
      if (!cell.blocked && cell.ground !== 'road') { cell.feature = 'field'; cell.ground = 'dirt'; }
    }
  }
}

function canBuild(cells: LocalCell[], width: number, height: number, x0: number, y0: number, w: number, h: number): boolean {
  if (!inside(x0, y0, width, height) || !inside(x0 + w, y0 + h, width, height)) return false;
  let unsuitable = 0;
  for (let y = y0 - 1; y <= y0 + h; y += 1) for (let x = x0 - 1; x <= x0 + w; x += 1) {
    const cell = cells[y * width + x];
    if (!cell || cell.ground === 'water' || cell.ground === 'road' || cell.building) unsuitable += 1;
  }
  return unsuitable === 0;
}

function drawBuilding(cells: LocalCell[], width: number, x0: number, y0: number, w: number, h: number, label: string, rng: RNG): void {
  for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) {
    const wall = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
    setCell(cells, width, x, y, { ground: wall ? 'stone' : 'floor', feature: wall ? 'wall' : undefined, blocked: wall, building: label });
  }
  const doorSide = rng.pick(['north', 'south', 'east', 'west'] as const);
  const door = doorSide === 'north' ? { x: x0 + Math.floor(w / 2), y: y0 }
    : doorSide === 'south' ? { x: x0 + Math.floor(w / 2), y: y0 + h - 1 }
      : doorSide === 'west' ? { x: x0, y: y0 + Math.floor(h / 2) }
        : { x: x0 + w - 1, y: y0 + Math.floor(h / 2) };
  setCell(cells, width, door.x, door.y, { ground: 'floor', feature: 'door', blocked: false, building: label });
}

function placeDungeonEntrance(cells: LocalCell[], width: number, height: number, rng: RNG): void {
  const point = randomWalkable(cells, width, height, rng, 7);
  setCell(cells, width, point.x, point.y, { ground: 'stone', feature: 'stairs-down', blocked: false, building: 'вход в подземелье' });
}


function placeCemeteries(world: WorldState, tile: Tile, cells: LocalCell[], width: number, height: number): void {
  for (const cemetery of world.cemeteries.filter(item => item.globalX === tile.x && item.globalY === tile.y)) {
    const x0 = Math.max(2, Math.min(width - 10, cemetery.localX - 4));
    const y0 = Math.max(2, Math.min(height - 10, cemetery.localY - 4));
    const burialCount = cemetery.burialIds.length;
    const plotSize = Math.max(6, Math.min(14, 6 + Math.ceil(Math.sqrt(Math.max(1, burialCount)))));
    for (let y = y0; y < Math.min(height - 1, y0 + plotSize); y += 1) for (let x = x0; x < Math.min(width - 1, x0 + plotSize); x += 1) {
      const edge = x === x0 || y === y0 || x === x0 + plotSize - 1 || y === y0 + plotSize - 1;
      const cell = cells[y * width + x];
      if (!cell || cell.ground === 'water' || cell.ground === 'road') continue;
      if (edge) { cell.feature = 'cemetery'; cell.blocked = false; cell.ground = 'dirt'; }
      else if ((x + y) % 2 === 0 && burialCount > 0) { cell.feature = 'grave'; cell.blocked = false; cell.ground = 'grass'; }
      cell.building = cemetery.name;
    }
  }
}

function applyHistoricalScars(world: WorldState, tile: Tile, cells: LocalCell[], width: number, height: number, rng: RNG): void {
  const settlement = tile.settlementId ? world.settlements.find(item => item.id === tile.settlementId) : undefined;
  const scars = settlement ? Math.floor(settlement.damaged / 8) : 0;
  const hasStored = world.localMapChanges.some(effect => effect.globalX === tile.x && effect.globalY === tile.y && effect.level === 0);
  if (hasStored) return;
  for (let i = 0; i < scars; i += 1) {
    const point = randomWalkable(cells, width, height, rng);
    const patch: Partial<LocalCell> = { feature: rng.chance(.6) ? 'rubble' : 'blood', blocked: false };
    if (rng.chance(.45)) patch.ground = 'ash';
    setCell(cells, width, point.x, point.y, patch);
  }
}

function applyStoredEffects(world: WorldState, globalX: number, globalY: number, level: number, cells: LocalCell[], width: number, height: number): void {
  for (const effect of world.localMapChanges.filter(item => item.globalX === globalX && item.globalY === globalY && item.level === level)) {
    if (!inside(effect.localX, effect.localY, width, height)) continue;
    const patch = effect.kind === 'burn' ? { ground: 'ash' as LocalGround, feature: 'fire' as LocalFeature, blocked: false }
      : effect.kind === 'rubble' ? { feature: 'rubble' as LocalFeature, blocked: false }
        : effect.kind === 'looted' ? { feature: 'looted' as LocalFeature, ground: 'ash' as LocalGround, blocked: false }
          : effect.kind === 'blood' ? { feature: 'blood' as LocalFeature, blocked: false }
          : effect.kind === 'body' ? { feature: 'body' as LocalFeature, blocked: true }
            : effect.kind === 'grave' ? { feature: 'grave' as LocalFeature, blocked: false }
            : effect.kind === 'lost-item' ? { feature: 'chest' as LocalFeature, blocked: true }
              : effect.kind === 'repaired' ? { feature: undefined, ground: 'grass' as LocalGround, blocked: false }
                : { ground: 'dirt' as LocalGround, blocked: false };
    setCell(cells, width, effect.localX, effect.localY, patch);
  }
}

function buildSurfaceMarkers(
  world: WorldState, tile: Tile, cells: LocalCell[], width: number, height: number, rng: RNG,
  settlement?: WorldState['settlements'][number], dungeon?: WorldState['dungeons'][number],
): LocalMarker[] {
  const markers: LocalMarker[] = [];
  if (settlement) {
    const district = settlement.districts?.find(item => item.x === tile.x && item.y === tile.y);
    markers.push({ id: `settlement-${settlement.id}-${tile.x}-${tile.y}`, x: Math.floor(width / 2), y: Math.floor(height / 2), kind: 'settlement', label: settlement.name, refs: [{ kind: 'settlement', id: settlement.id }], detail: `${district?.name ?? 'поселение'} · ${settlement.population} жителей` });
  }
  if (dungeon) {
    const stair = cells.find(cell => cell.feature === 'stairs-down');
    markers.push({ id: `dungeon-${dungeon.id}`, x: stair?.x ?? width - 8, y: stair?.y ?? height - 8, kind: 'dungeon', label: dungeon.name, refs: [{ kind: 'dungeon', id: dungeon.id }], detail: `${dungeon.depth} уровней` });
  }
  for (const cemetery of world.cemeteries.filter(item => item.globalX === tile.x && item.globalY === tile.y)) {
    const buried = cemetery.burialIds.length;
    markers.push({ id: `cemetery-${cemetery.id}`, x: cemetery.localX, y: cemetery.localY, kind: 'cemetery', label: cemetery.name, refs: [{ kind: 'cemetery', id: cemetery.id }], count: buried, detail: `${buried} записей о погребении · вместимость ${cemetery.capacity}` });
  }

  const liveCharacters = settlement ? world.characters.filter(character => {
    if (!character.alive || character.settlementId !== settlement.id) return false;
    const districts = settlement.districts?.length ? settlement.districts : [{ x: settlement.x, y: settlement.y, name: 'Сердце поселения' }];
    const assigned = districts[hashSeed(`${world.config.seed}:район-жителя:${character.id}`) % districts.length]!;
    return assigned.x === tile.x && assigned.y === tile.y;
  }) : [];
  const walkable = cells.filter(cell => !cell.blocked && cell.ground !== 'water');
  const groups = new Map<string, { point: Point; refs: EntityRef[]; names: string[]; professions: string[] }>();
  for (const character of liveCharacters) {
    const point = characterPosition(character.id, walkable, world.config.seed, tile.x, tile.y);
    const key = `${point.x}:${point.y}`;
    const group = groups.get(key) ?? { point, refs: [], names: [], professions: [] };
    group.refs.push({ kind: 'character', id: character.id });
    group.names.push(character.name);
    group.professions.push(professionLabel(character.profession));
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    markers.push({
      id: `people-${key}`, x: group.point.x, y: group.point.y, kind: group.refs.length > 1 ? 'group' : 'person',
      label: group.refs.length > 1 ? `${group.refs.length} жителей` : group.names[0]!, refs: group.refs, count: group.refs.length,
      detail: group.refs.length > 1 ? group.names.slice(0, 4).join(', ') : group.professions[0],
    });
  }

  for (const building of (world.buildings ?? []).filter(item => item.globalX === tile.x && item.globalY === tile.y)) {
    const establishment = building.establishmentId ? world.establishments.find(item => item.id === building.establishmentId) : undefined;
    const markerKind: LocalMarker['kind'] = establishment ? 'establishment' : 'building';
    const refs: EntityRef[] = [{ kind: 'building', id: building.id }, ...(establishment ? [{ kind: 'establishment' as const, id: establishment.id }] : [])];
    markers.push({
      id: `building-${building.id}`, x: Math.max(1, Math.min(width - 2, building.localX)), y: Math.max(1, Math.min(height - 2, building.localY)),
      kind: markerKind, label: establishment?.name ?? building.name, refs,
      detail: establishment ? `${establishment.type} · работников ${establishment.workerIds.length}` : `${building.rooms.length} помещений · состояние ${building.condition}%`,
    });
  }

  for (const army of world.armies.filter(item => item.x === tile.x && item.y === tile.y)) {
    const point = randomWalkable(cells, width, height, new RNG(`${world.config.seed}:армия:${army.id}:${tile.x}:${tile.y}`), 5);
    markers.push({ id: `army-${army.id}`, x: point.x, y: point.y, kind: 'army', label: army.name, refs: [{ kind: 'army', id: army.id }], count: army.strength, detail: `${army.strength} воинов · ${army.status}` });
  }
  for (const monster of world.monsters.filter(item => item.alive && item.x === tile.x && item.y === tile.y)) {
    const point = randomWalkable(cells, width, height, new RNG(`${world.config.seed}:чудовище:${monster.id}:${tile.x}:${tile.y}`), 6);
    const footprintWidth = Math.max(1, monster.footprintWidth ?? 1);
    const footprintHeight = Math.max(1, monster.footprintHeight ?? 1);
    const topLeft = fitFootprint(cells, width, height, point, footprintWidth, footprintHeight);
    occupyFootprint(cells, width, topLeft, footprintWidth, footprintHeight);
    markers.push({ id: `monster-${monster.id}`, x: topLeft.x, y: topLeft.y, kind: 'monster', label: monster.name, refs: [{ kind: 'monster', id: monster.id }], detail: `${monster.species}, сила ${monster.power} · занимает ${footprintWidth}×${footprintHeight} клеток`, footprintWidth, footprintHeight });
  }

  for (const population of world.animalPopulations.filter(item => item.count > 0 && item.x === tile.x && item.y === tile.y)) {
    const point = randomWalkable(cells, width, height, new RNG(`${world.config.seed}:популяция:${population.id}:${tile.x}:${tile.y}`), 5);
    markers.push({ id: `fauna-${population.id}`, x: point.x, y: point.y, kind: 'fauna', label: population.species, refs: [{ kind: 'animalPopulation', id: population.id }], count: population.count, detail: `${population.count} особей · ${population.diet}` });
    const trail = cells[point.y * width + point.x];
    if (trail && !trail.feature) trail.feature = 'animal-trail';
  }
  for (const ingredient of world.ingredients.filter(item => item.abundance > 0 && item.x === tile.x && item.y === tile.y)) {
    const spreadRng = new RNG(`${world.config.seed}:ареал-ингредиента:${ingredient.id}:${tile.x}:${tile.y}`);
    const total = Math.max(1, Math.round(ingredient.abundance));
    const patchCount = Math.max(3, Math.min(18, Math.round(Math.sqrt(total) * 1.35)));
    let remaining = total;
    for (let patchIndex = 0; patchIndex < patchCount && remaining > 0; patchIndex += 1) {
      const center = randomWalkable(cells, width, height, spreadRng, 5);
      const patchesLeft = patchCount - patchIndex;
      const amount = patchIndex === patchCount - 1
        ? remaining
        : Math.max(1, Math.min(remaining - (patchesLeft - 1), Math.round(remaining / patchesLeft * spreadRng.int(65, 135) / 100)));
      remaining -= amount;
      const radius = ingredient.kind === 'минерал' ? spreadRng.int(1, 3) : spreadRng.int(2, 5);
      let painted = 0;
      const targetCells = Math.max(2, Math.min(amount, ingredient.kind === 'минерал' ? spreadRng.int(3, 8) : spreadRng.int(4, 12)));
      for (let attempt = 0; attempt < targetCells * 5 && painted < targetCells; attempt += 1) {
        const x = center.x + spreadRng.int(-radius, radius);
        const y = center.y + spreadRng.int(-radius, radius);
        if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
        const cell = cells[y * width + x];
        if (!cell || cell.blocked || cell.ground === 'water' || cell.building) continue;
        if (!cell.feature || ['bush', 'reeds', 'rock'].includes(cell.feature)) {
          cell.feature = ingredient.kind === 'гриб' ? 'mushroom' : ingredient.kind === 'растение' ? 'herb' : 'rock';
          painted += 1;
        }
      }
      markers.push({
        id: `resource-${ingredient.id}-${patchIndex}`, x: center.x, y: center.y, kind: 'resource', label: ingredient.name,
        refs: [{ kind: 'ingredient', id: ingredient.id }], count: amount,
        detail: `${ingredient.kind} · участок ${patchIndex + 1}/${patchCount} · запас ${amount}`,
      });
    }
  }

  for (const item of world.items.filter(entry => entry.settlementId === settlement?.id && !entry.ownerCharacterId && !entry.householdId && !entry.establishmentId).slice(0, 24)) {
    const building = item.buildingId ? world.buildings.find(entry => entry.id === item.buildingId) : undefined;
    const point = building && building.globalX === tile.x && building.globalY === tile.y
      ? { x: Math.max(1, Math.min(width - 2, building.localX + 1)), y: Math.max(1, Math.min(height - 2, building.localY + 1)) }
      : randomWalkable(cells, width, height, new RNG(`${world.config.seed}:предмет:${item.id}:${tile.x}:${tile.y}`));
    markers.push({ id: `item-${item.id}`, x: point.x, y: point.y, kind: 'item', label: item.name, refs: [{ kind: 'item', id: item.id }], count: Math.round(item.quantity), detail: `${item.category} · ${item.quantity} ${item.unit}` });
  }

  for (const artifact of world.artifacts.filter(item => item.settlementId === settlement?.id && !item.ownerId)) {
    const point = randomWalkable(cells, width, height, new RNG(`${world.config.seed}:артефакт:${artifact.id}`));
    markers.push({ id: `artifact-${artifact.id}`, x: point.x, y: point.y, kind: 'artifact', label: artifact.name, refs: [{ kind: 'artifact', id: artifact.id }] });
  }
  for (const effect of world.localMapChanges.filter(item => item.globalX === tile.x && item.globalY === tile.y && item.level === 0)) {
    const markerKind: LocalMarker['kind'] = effect.kind === 'body' ? 'corpse' : effect.kind === 'grave' ? 'grave' : effect.kind === 'lost-item' ? 'item' : 'effect';
    const refs = effect.burialId ? [{ kind: 'burial' as const, id: effect.burialId }] : effect.entityRef ? [effect.entityRef] : [];
    markers.push({ id: `effect-${effect.id}`, x: effect.localX, y: effect.localY, kind: markerKind, label: effect.label, refs, detail: `${effect.year}.${String(effect.month ?? 1).padStart(2, '0')} · ${effect.kind}` });
  }
  return markers;
}

function characterPosition(id: number, walkable: LocalCell[], seed: string, x: number, y: number): Point {
  if (!walkable.length) return { x: 24, y: 24 };
  const cell = walkable[hashSeed(`${seed}:житель:${id}:${x}:${y}`) % walkable.length]!;
  return { x: cell.x, y: cell.y };
}

function occupyFootprint(cells: LocalCell[], width: number, topLeft: Point, footprintWidth: number, footprintHeight: number): void {
  for (let y = topLeft.y; y < topLeft.y + footprintHeight; y += 1) for (let x = topLeft.x; x < topLeft.x + footprintWidth; x += 1) {
    const cell = cells[y * width + x];
    if (cell) cell.blocked = true;
  }
}

function fitFootprint(cells: LocalCell[], width: number, height: number, center: Point, footprintWidth: number, footprintHeight: number): Point {
  const desiredX = Math.max(1, Math.min(width - footprintWidth - 1, center.x - Math.floor(footprintWidth / 2)));
  const desiredY = Math.max(1, Math.min(height - footprintHeight - 1, center.y - Math.floor(footprintHeight / 2)));
  for (let radius = 0; radius <= 12; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      const x0 = Math.max(1, Math.min(width - footprintWidth - 1, desiredX + dx));
      const y0 = Math.max(1, Math.min(height - footprintHeight - 1, desiredY + dy));
      let clear = true;
      for (let y = y0; y < y0 + footprintHeight && clear; y += 1) for (let x = x0; x < x0 + footprintWidth; x += 1) {
        const cell = cells[y * width + x];
        if (!cell || cell.blocked || cell.ground === 'water') { clear = false; break; }
      }
      if (clear) return { x: x0, y: y0 };
    }
  }
  return { x: desiredX, y: desiredY };
}

function randomWalkable(cells: LocalCell[], width: number, height: number, rng: RNG, margin = 2): Point {
  const options = cells.filter(cell => !cell.blocked && cell.ground !== 'water' && cell.x >= margin && cell.y >= margin && cell.x < width - margin && cell.y < height - margin);
  const cell = options.length ? rng.pick(options) : cells[Math.floor(cells.length / 2)]!;
  return { x: cell.x, y: cell.y };
}

function carveRoom(cells: LocalCell[], width: number, room: { x: number; y: number; w: number; h: number }): void {
  for (let y = room.y; y < room.y + room.h; y += 1) for (let x = room.x; x < room.x + room.w; x += 1) setCell(cells, width, x, y, { ground: 'floor', feature: undefined, blocked: false });
}

function connectRooms(cells: LocalCell[], width: number, from: Point, to: Point, rng: RNG): void {
  const horizontalFirst = rng.chance(.5);
  const corner = horizontalFirst ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  carveLine(cells, width, from, corner);
  carveLine(cells, width, corner, to);
}

function carveLine(cells: LocalCell[], width: number, from: Point, to: Point): void {
  let x = from.x;
  let y = from.y;
  while (x !== to.x || y !== to.y) {
    setCell(cells, width, x, y, { ground: 'floor', feature: undefined, blocked: false });
    if (x !== to.x) x += Math.sign(to.x - x); else y += Math.sign(to.y - y);
  }
  setCell(cells, width, to.x, to.y, { ground: 'floor', feature: undefined, blocked: false });
}

function rectanglesOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, margin = 0): boolean {
  return a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y;
}

function center(room: { x: number; y: number; w: number; h: number }): Point {
  return { x: room.x + Math.floor(room.w / 2), y: room.y + Math.floor(room.h / 2) };
}

function setCell(cells: LocalCell[], width: number, x: number, y: number, patch: Partial<LocalCell>): void {
  const cell = cells[y * width + x];
  if (cell) Object.assign(cell, patch);
}

function tileAt(world: WorldState, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= world.config.width || y >= world.config.height) return undefined;
  return world.tiles[y * world.config.width + x] ?? world.tiles.find(tile => tile.x === x && tile.y === y);
}

function inside(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

export function localCellSummary(map: LocalMapData, x: number, y: number): { title: string; lines: string[]; markers: LocalMarker[] } {
  const cell = map.cells[y * map.width + x];
  const markers = map.markers.filter(marker => x >= marker.x && y >= marker.y && x < marker.x + (marker.footprintWidth ?? 1) && y < marker.y + (marker.footprintHeight ?? 1));
  if (!cell) return { title: 'За пределами карты', lines: [], markers: [] };
  const groundNames: Record<LocalGround, string> = { grass: 'трава', dirt: 'земля', sand: 'песок', water: 'вода', mud: 'грязь', snow: 'снег', stone: 'камень', road: 'дорога', floor: 'пол', ash: 'пепел' };
  const featureNames: Partial<Record<LocalFeature, string>> = {
    tree: 'дерево', bush: 'кустарник', rock: 'скала', reeds: 'камыш', wall: 'стена', door: 'дверь', field: 'поле', rubble: 'развалины', looted: 'разграбленный участок', fire: 'огонь', blood: 'кровь', body: 'тело', bones: 'кости', grave: 'могила', cemetery: 'ограда кладбища', chest: 'сундук или предметы',
    'stairs-down': 'спуск вниз', 'stairs-up': 'подъём вверх', bridge: 'мост', herb: 'лекарственное растение', berry: 'ягоды', mushroom: 'грибы', 'animal-trail': 'звериная тропа',
  };
  const lines = [`Основа: ${groundNames[cell.ground]}`];
  if (cell.feature) lines.push(`Объект: ${featureNames[cell.feature] ?? cell.feature}`);
  if (cell.building) lines.push(`Место: ${cell.building}`);
  if (markers.length) lines.push(`Здесь находятся: ${markers.map(marker => marker.label).join(', ')}`);
  return { title: `${map.globalX}:${map.globalY} · ${x}:${y}`, lines, markers };
}
