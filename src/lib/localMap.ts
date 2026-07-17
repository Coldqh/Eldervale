import type {
  EntityRef, LocalCell, LocalExit, LocalFeature, LocalGround, LocalMapData, LocalMarker, Terrain, Tile, TradeRoute, WorldState,
} from '../types';
import { professionLabel, settlementTypeLabel } from '../i18n';
import { hashSeed, RNG } from '../sim/rng';
import { buildingInteriorPoint, buildingRect } from '../sim/spatial';
import { LocalOccupancyGrid, type LocalPoint } from './localOccupancy';

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
  placeAgricultureAndConstruction(world, tile, cells, width, height);
  placeCemeteries(world, tile, cells, width, height);
  const dungeon = tile.dungeonId ? world.dungeons.find(item => item.id === tile.dungeonId) : world.dungeons.find(item => item.x === tile.x && item.y === tile.y);
  if (dungeon) placeDungeonEntrance(cells, width, height, rng);

  applyHistoricalScars(world, tile, cells, width, height, rng);
  applyStoredEffects(world, tile.x, tile.y, 0, cells, width, height);
  placeArmyCampStructures(world, tile, cells, width, height);

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
  const physicalBuildings = (world.buildings ?? []).filter(building => building.globalX === tile.x && building.globalY === tile.y);
  if (physicalBuildings.length) {
    for (const building of physicalBuildings) {
      const rect = buildingRect(building);
      drawBuilding(cells, width, rect.x, rect.y, rect.width, rect.height, building.name, new RNG(`${world.config.seed}:физическое-здание:${building.id}`), {
        buildingId: building.id,
        establishmentId: building.establishmentId,
        entranceX: building.entranceX,
        entranceY: building.entranceY,
      });
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


function canBuild(cells: LocalCell[], width: number, height: number, x0: number, y0: number, w: number, h: number): boolean {
  if (!inside(x0, y0, width, height) || !inside(x0 + w, y0 + h, width, height)) return false;
  let unsuitable = 0;
  for (let y = y0 - 1; y <= y0 + h; y += 1) for (let x = x0 - 1; x <= x0 + w; x += 1) {
    const cell = cells[y * width + x];
    if (!cell || cell.ground === 'water' || cell.ground === 'road' || cell.building) unsuitable += 1;
  }
  return unsuitable === 0;
}

function drawBuilding(
  cells: LocalCell[], width: number, x0: number, y0: number, w: number, h: number, label: string, rng: RNG,
  spatial?: { buildingId: number; establishmentId?: number; entranceX: number; entranceY: number },
): void {
  for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) {
    const wall = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
    setCell(cells, width, x, y, {
      ground: wall ? 'stone' : 'floor', feature: wall ? 'wall' : undefined, blocked: wall, building: label,
      buildingId: spatial?.buildingId, establishmentId: spatial?.establishmentId,
    });
  }
  const fallbackSide = rng.pick(['north', 'south', 'east', 'west'] as const);
  const fallbackDoor = fallbackSide === 'north' ? { x: x0 + Math.floor(w / 2), y: y0 }
    : fallbackSide === 'south' ? { x: x0 + Math.floor(w / 2), y: y0 + h - 1 }
      : fallbackSide === 'west' ? { x: x0, y: y0 + Math.floor(h / 2) }
        : { x: x0 + w - 1, y: y0 + Math.floor(h / 2) };
  const door = spatial && spatial.entranceX >= x0 && spatial.entranceX < x0 + w && spatial.entranceY >= y0 && spatial.entranceY < y0 + h
    ? { x: spatial.entranceX, y: spatial.entranceY }
    : fallbackDoor;
  setCell(cells, width, door.x, door.y, {
    ground: 'floor', feature: 'door', blocked: false, building: label,
    buildingId: spatial?.buildingId, establishmentId: spatial?.establishmentId,
  });
}


function placeAgricultureAndConstruction(world: WorldState, tile: Tile, cells: LocalCell[], width: number, height: number): void {
  for (const field of (world.fields ?? []).filter(item => item.globalX === tile.x && item.globalY === tile.y)) {
    const feature: LocalFeature = field.state === 'подготовка' || field.state === 'пар' || field.state === 'убрано' || field.state === 'погибло' ? 'tilled-soil'
      : field.state === 'посеяно' || field.state === 'всходы' ? 'seedlings'
        : field.state === 'готово к жатве' ? 'ripe-crop' : 'crop';
    for (const point of field.cells) {
      if (!inside(point.x, point.y, width, height)) continue;
      const cell = cells[point.y * width + point.x];
      if (!cell || cell.buildingId || cell.constructionProjectId) continue;
      cell.ground = 'dirt'; cell.feature = feature; cell.blocked = false; cell.fieldId = field.id;
    }
  }
  for (const project of (world.constructionProjects ?? []).filter(item => item.globalX === tile.x && item.globalY === tile.y && item.stage !== 'завершено' && item.stage !== 'заброшено')) {
    const feature: LocalFeature = project.stage === 'планирование' || project.stage === 'доставка материалов' || project.stage === 'фундамент' ? 'construction-foundation'
      : project.stage === 'каркас' ? 'construction-frame'
        : project.stage === 'стены' || project.stage === 'крыша' ? 'construction-wall' : 'scaffold';
    for (let y = project.localY; y < project.localY + project.localHeight; y += 1) for (let x = project.localX; x < project.localX + project.localWidth; x += 1) {
      if (!inside(x, y, width, height)) continue;
      const cell = cells[y * width + x];
      if (!cell || cell.buildingId) continue;
      cell.ground = project.stage === 'фундамент' ? 'stone' : 'dirt';
      cell.feature = feature;
      cell.blocked = !['планирование', 'доставка материалов', 'фундамент'].includes(project.stage);
      cell.constructionProjectId = project.id;
      cell.building = project.name;
    }
  }
}

function placeDungeonEntrance(cells: LocalCell[], width: number, height: number, rng: RNG): void {
  const point = randomWalkable(cells, width, height, rng, 7);
  setCell(cells, width, point.x, point.y, { ground: 'stone', feature: 'stairs-down', blocked: false, building: 'вход в подземелье' });
}


function placeCemeteries(world: WorldState, tile: Tile, cells: LocalCell[], width: number, height: number): void {
  for (const cemetery of world.cemeteries.filter(item => item.globalX === tile.x && item.globalY === tile.y)) {
    const burialCount = cemetery.burialIds.length;
    const plotSize = Math.max(6, Math.min(14, 6 + Math.ceil(Math.sqrt(Math.max(1, burialCount)))));
    const preferred = {
      x: Math.max(2, Math.min(width - plotSize - 2, cemetery.localX - Math.floor(plotSize / 2))),
      y: Math.max(2, Math.min(height - plotSize - 2, cemetery.localY - Math.floor(plotSize / 2))),
    };
    const placement = findFreeCemeteryRect(cells, width, height, preferred.x, preferred.y, plotSize);
    if (!placement) continue;
    const x0 = placement.x;
    const y0 = placement.y;
    for (let y = y0; y < Math.min(height - 1, y0 + plotSize); y += 1) for (let x = x0; x < Math.min(width - 1, x0 + plotSize); x += 1) {
      const edge = x === x0 || y === y0 || x === x0 + plotSize - 1 || y === y0 + plotSize - 1;
      const cell = cells[y * width + x];
      if (!cell || !cemeteryCellAvailable(cell)) continue;
      if (edge) { cell.feature = 'cemetery'; cell.blocked = false; cell.ground = 'dirt'; }
      else if ((x + y) % 2 === 0 && burialCount > 0) { cell.feature = 'grave'; cell.blocked = false; cell.ground = 'grass'; }
      cell.building = cemetery.name;
    }
  }
}

function findFreeCemeteryRect(
  cells: LocalCell[],
  width: number,
  height: number,
  preferredX: number,
  preferredY: number,
  size: number,
): { x: number; y: number } | undefined {
  const fits = (x: number, y: number) => {
    if (x < 2 || y < 2 || x + size >= width - 2 || y + size >= height - 2) return false;
    for (let yy = y - 1; yy <= y + size; yy += 1) {
      for (let xx = x - 1; xx <= x + size; xx += 1) {
        const cell = cells[yy * width + xx];
        if (!cell || !cemeteryCellAvailable(cell)) return false;
      }
    }
    return true;
  };

  if (fits(preferredX, preferredY)) return { x: preferredX, y: preferredY };
  const maxRadius = Math.max(width, height);
  for (let radius = 2; radius <= maxRadius; radius += 2) {
    for (let dx = -radius; dx <= radius; dx += 2) {
      for (const dy of [-radius, radius]) {
        const x = Math.max(2, Math.min(width - size - 3, preferredX + dx));
        const y = Math.max(2, Math.min(height - size - 3, preferredY + dy));
        if (fits(x, y)) return { x, y };
      }
    }
    for (let dy = -radius + 2; dy <= radius - 2; dy += 2) {
      for (const dx of [-radius, radius]) {
        const x = Math.max(2, Math.min(width - size - 3, preferredX + dx));
        const y = Math.max(2, Math.min(height - size - 3, preferredY + dy));
        if (fits(x, y)) return { x, y };
      }
    }
  }
  return undefined;
}

function cemeteryCellAvailable(cell: LocalCell): boolean {
  if (cell.ground === 'water' || cell.ground === 'road') return false;
  if (cell.blocked || cell.building || cell.fieldId || cell.constructionProjectId || cell.armyCampStructureId) return false;
  return !cell.feature || ['grass', 'bush', 'tree', 'flowers', 'reeds'].includes(cell.feature);
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

function placeArmyCampStructures(world: WorldState, tile: Tile, cells: LocalCell[], width: number, height: number): void {
  const camps = (world.armyCamps ?? []).filter(item => item.globalX === tile.x && item.globalY === tile.y && item.mode === 'camp');
  for (const camp of camps) {
    const structures = camp.structureIds.map(id => world.armyCampStructures.find(item => item.id === id)).filter((item): item is WorldState['armyCampStructures'][number] => Boolean(item));
    for (const structure of structures) {
      const feature: LocalFeature = structure.kind === 'campfire' || structure.kind === 'fieldKitchen' ? 'campfire'
        : structure.kind === 'latrine' ? 'latrine'
          : structure.kind === 'horseLine' ? 'hitching-post'
            : 'tent';
      for (let dy = 0; dy < structure.height; dy += 1) {
        for (let dx = 0; dx < structure.width; dx += 1) {
          const x = structure.localX + dx, y = structure.localY + dy;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          setCell(cells, width, x, y, {
            ground: 'dirt', feature: dx === 0 && dy === 0 ? feature : undefined,
            blocked: structure.kind !== 'campfire' && structure.kind !== 'latrine' && structure.kind !== 'guardPost',
            armyCampStructureId: structure.id,
          });
        }
      }
    }
  }
}

function buildSurfaceMarkers(
  world: WorldState, tile: Tile, cells: LocalCell[], width: number, height: number, rng: RNG,
  settlement?: WorldState['settlements'][number], dungeon?: WorldState['dungeons'][number],
): LocalMarker[] {
  const markers: LocalMarker[] = [];
  const occupancy = new LocalOccupancyGrid(cells, width, height);

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
    const occupied = cells.filter(cell => cell.building === cemetery.name && (cell.feature === 'cemetery' || cell.feature === 'grave'));
    const markerX = occupied.length ? Math.round(occupied.reduce((sum, cell) => sum + cell.x, 0) / occupied.length) : cemetery.localX;
    const markerY = occupied.length ? Math.round(occupied.reduce((sum, cell) => sum + cell.y, 0) / occupied.length) : cemetery.localY;
    markers.push({ id: `cemetery-${cemetery.id}`, x: markerX, y: markerY, kind: 'cemetery', label: cemetery.name, refs: [{ kind: 'cemetery', id: cemetery.id }], count: buried, detail: `${buried} записей о погребении · вместимость ${cemetery.capacity}` });
  }

  markers.push(...placeNaturalResources(world, tile, cells, width, height));

  // Сначала резервируются сущности с уже существующими физическими координатами.
  for (const position of (world.armyLocalPositions ?? []).filter(item => item.globalX === tile.x && item.globalY === tile.y).sort((a, b) => a.formationIndex - b.formationIndex || a.characterId - b.characterId)) {
    const character = world.characters.find(item => item.id === position.characterId && item.alive);
    const army = world.armies.find(item => item.id === position.armyId);
    if (!character || !army) continue;
    const point = occupancy.claim({ x: position.localX, y: position.localY }, humanCellAvailable)
      ?? occupancy.claimNearest({ x: position.localX, y: position.localY }, `${world.config.seed}:перенос-солдата:${army.id}:${character.id}`, humanCellAvailable);
    if (!point) continue;
    const unit = character.militaryUnitId ? world.militaryUnits.find(item => item.id === character.militaryUnitId) : undefined;
    markers.push({
      id: `army-soldier-${army.id}-${character.id}`, x: point.x, y: point.y, kind: 'person', label: character.name,
      refs: [{ kind: 'character', id: character.id }, { kind: 'army', id: army.id }, ...(unit ? [{ kind: 'militaryUnit' as const, id: unit.id }] : [])],
      detail: `${character.militaryRole ?? 'солдат'} · ${position.activity}${unit ? ` · ${unit.name}` : ''}`,
      visualRole: character.visualRole ?? 'soldier',
    });
  }

  for (const monster of world.monsters.filter(item => item.alive && item.x === tile.x && item.y === tile.y).sort((a, b) => a.id - b.id)) {
    const preferred = deterministicPoint(cells, `${world.config.seed}:чудовище:${monster.id}:${tile.x}:${tile.y}`, monsterCellAvailable);
    const footprintWidth = Math.max(1, monster.footprintWidth ?? 1);
    const footprintHeight = Math.max(1, monster.footprintHeight ?? 1);
    const topLeft = occupancy.claimFootprintNear(preferred, footprintWidth, footprintHeight, `${world.config.seed}:след-чудовища:${monster.id}`, monsterCellAvailable);
    if (!topLeft) continue;
    occupyFootprint(cells, width, topLeft, footprintWidth, footprintHeight);
    markers.push({ id: `monster-${monster.id}`, x: topLeft.x, y: topLeft.y, kind: 'monster', label: monster.name, refs: [{ kind: 'monster', id: monster.id }], detail: `${monster.species}, сила ${monster.power} · занимает ${footprintWidth}×${footprintHeight} клеток`, footprintWidth, footprintHeight });
  }

  for (const population of world.animalPopulations.filter(item => item.count > 0 && item.x === tile.x && item.y === tile.y).sort((a, b) => a.id - b.id)) {
    markers.push(...placeAnimalPopulation(world, cells, width, occupancy, population, settlement));
  }

  const presentMerchants = settlement ? (world.travelingMerchants ?? []).filter(merchant => merchant.currentSettlementId === settlement.id && merchant.status !== 'в пути') : [];
  const merchantCharacterIds = new Set(presentMerchants.map(merchant => merchant.characterId));
  const armyCharacterIds = new Set(world.armies.flatMap(army => army.soldierIds ?? []));
  const activePatrols = settlement
    ? (world.civicPatrols ?? []).filter(item => item.settlementId === settlement.id && item.status === 'патрулирует' && item.guardIds.length)
    : [];
  const patrolCharacterIds = new Set(activePatrols.flatMap(patrol => patrol.guardIds));
  const liveCharacters = settlement ? world.characters.filter(character => {
    if (!character.alive || character.settlementId !== settlement.id || merchantCharacterIds.has(character.id) || armyCharacterIds.has(character.id) || patrolCharacterIds.has(character.id)) return false;
    const anchor = characterAnchorBuilding(world, character);
    if (anchor) return anchor.globalX === tile.x && anchor.globalY === tile.y;
    const districts = settlement.districts?.length ? settlement.districts : [{ x: settlement.x, y: settlement.y, name: 'Сердце поселения' }];
    const assigned = districts[hashSeed(`${world.config.seed}:район-жителя:${character.id}`) % districts.length]!;
    return assigned.x === tile.x && assigned.y === tile.y;
  }).sort((a, b) => a.id - b.id) : [];

  for (const character of liveCharacters) {
    const anchor = characterAnchorBuilding(world, character);
    const preferred = anchor && anchor.globalX === tile.x && anchor.globalY === tile.y
      ? buildingInteriorPoint(anchor, `${world.config.seed}:житель-в-здании:${character.id}:${world.month}`)
      : deterministicPoint(cells, `${world.config.seed}:житель:${character.id}:${tile.x}:${tile.y}`, humanCellAvailable);
    const point = occupancy.claimNearest(preferred, `${world.config.seed}:уникальный-житель:${character.id}:${world.month}`, humanCellAvailable);
    if (!point) continue;
    const isRuler = world.kingdoms.some(kingdom => kingdom.rulerId === character.id);
    markers.push({
      id: `person-${character.id}`, x: point.x, y: point.y, kind: 'person', label: character.name,
      refs: [{ kind: 'character', id: character.id }], detail: professionLabel(character.profession),
      visualRole: isRuler ? 'king' : character.visualRole ?? character.profession,
    });
  }

  for (const patrol of activePatrols.sort((a, b) => a.id - b.id)) {
    const district = settlement?.districts.find(item => item.name === patrol.districtName);
    const roadCells = cells.filter(cell => humanCellAvailable(cell) && cell.ground === 'road');
    const fallback = deterministicPoint(cells, `${world.config.seed}:патруль:${patrol.id}:${world.month}`, humanCellAvailable);
    for (let index = 0; index < patrol.guardIds.length; index += 1) {
      const guardId = patrol.guardIds[index]!;
      const guard = world.characters.find(item => item.id === guardId && item.alive);
      if (!guard) continue;
      const preferred = roadCells.length
        ? { x: roadCells[hashSeed(`${world.config.seed}:путь-патруля:${patrol.id}:${guard.id}:${world.month}`) % roadCells.length]!.x, y: roadCells[hashSeed(`${world.config.seed}:путь-патруля:${patrol.id}:${guard.id}:${world.month}`) % roadCells.length]!.y }
        : fallback;
      const point = occupancy.claimNearest(preferred, `${world.config.seed}:стражник-патруля:${patrol.id}:${guard.id}`, humanCellAvailable);
      if (!point) continue;
      markers.push({
        id: `patrol-guard-${patrol.id}-${guard.id}`, x: point.x, y: point.y, kind: 'person', label: guard.name,
        refs: [{ kind: 'character', id: guard.id }, { kind: 'patrol', id: patrol.id }],
        detail: `${patrol.shift} патруль${district ? ` · ${district.name}` : ''}`, visualRole: 'guard',
      });
    }
  }

  for (const merchant of presentMerchants.sort((a, b) => a.id - b.id)) {
    const character = world.characters.find(item => item.id === merchant.characterId);
    if (!character?.alive) continue;
    const preferred = deterministicPoint(cells, `${world.config.seed}:странствующий-торговец:${merchant.id}:${world.month}`, marketCellAvailable);
    const point = occupancy.claimNearest(preferred, `${world.config.seed}:место-торговца:${merchant.id}`, humanCellAvailable);
    if (!point) continue;
    const stock = merchant.wagonInventoryItemIds.reduce((sum, id) => sum + (world.items.find(item => item.id === id)?.quantity ?? 0), 0);
    markers.push({
      id: `merchant-${merchant.id}`, x: point.x, y: point.y, kind: 'merchant', label: character.name,
      refs: [{ kind: 'character', id: character.id }, { kind: 'travelingMerchant', id: merchant.id }],
      detail: `странствующий продавец · товаров ${Math.round(stock)} · касса ${Math.round(merchant.cash)} крон`,
    });
  }

  // Поле отображается самими клетками. Невидимый маркер нужен только для инспектора и перехода к сущности.
  for (const field of (world.fields ?? []).filter(item => item.globalX === tile.x && item.globalY === tile.y)) {
    const center = field.cells[Math.floor(field.cells.length / 2)] ?? { x: 0, y: 0 };
    markers.push({
      id: `field-${field.id}`, x: center.x, y: center.y, kind: 'field', label: `Поле: ${field.crop}`,
      refs: [{ kind: 'field', id: field.id }], count: field.cells.length,
      detail: `${field.state} · ${field.cells.length} клеток · плодородие ${Math.round(field.fertility)}%`, visualRole: 'map-reference',
    });
  }
  for (const project of (world.constructionProjects ?? []).filter(item => item.globalX === tile.x && item.globalY === tile.y && item.stage !== 'завершено' && item.stage !== 'заброшено')) {
    markers.push({ id: `construction-${project.id}`, x: project.localX, y: project.localY, kind: 'construction', label: project.name, refs: [{ kind: 'constructionProject', id: project.id }], detail: `${project.stage} · труд ${Math.round(project.laborDone)}/${project.laborRequired}`, footprintWidth: project.localWidth, footprintHeight: project.localHeight });
  }

  for (const building of (world.buildings ?? []).filter(item => item.globalX === tile.x && item.globalY === tile.y)) {
    const establishment = building.establishmentId ? world.establishments.find(item => item.id === building.establishmentId) : undefined;
    const markerKind: LocalMarker['kind'] = establishment ? 'establishment' : 'building';
    const occupantRefs: EntityRef[] = liveCharacters
      .filter(character => characterAnchorBuilding(world, character)?.id === building.id)
      .slice(0, 12)
      .map(character => ({ kind: 'character' as const, id: character.id }));
    const refs: EntityRef[] = [...occupantRefs, ...(establishment ? [{ kind: 'establishment' as const, id: establishment.id }] : []), { kind: 'building', id: building.id }];
    const rect = buildingRect(building);
    markers.push({
      id: `building-${building.id}`, x: rect.x, y: rect.y,
      kind: markerKind, label: establishment?.name ?? building.name, refs,
      detail: establishment ? `${establishment.type} · работников ${establishment.workerIds.length} · область ${rect.width}×${rect.height}` : `${building.rooms.length} помещений · состояние ${building.condition}% · область ${rect.width}×${rect.height}`,
      footprintWidth: rect.width, footprintHeight: rect.height,
    });
  }

  for (const camp of (world.armyCamps ?? []).filter(item => item.globalX === tile.x && item.globalY === tile.y)) {
    const army = world.armies.find(item => item.id === camp.armyId);
    if (!army) continue;
    if (camp.mode === 'camp') {
      const structures = camp.structureIds.map(id => world.armyCampStructures.find(item => item.id === id)).filter((item): item is WorldState['armyCampStructures'][number] => Boolean(item));
      for (const structure of structures) {
        const assignedRefs = structure.assignedCharacterIds.slice(0, 8).map(id => ({ kind: 'character' as const, id }));
        markers.push({
          id: `camp-structure-${structure.id}`, x: structure.localX, y: structure.localY, kind: 'camp',
          label: campStructureLabel(structure.kind), refs: [{ kind: 'army', id: army.id }, ...assignedRefs],
          count: structure.assignedCharacterIds.length || undefined,
          detail: `${campStructureLabel(structure.kind)} · вместимость ${structure.capacity} · состояние ${Math.round(structure.condition)}%`,
          footprintWidth: structure.width, footprintHeight: structure.height, visualRole: structure.kind,
        });
      }
      markers.push({ id: `army-headquarters-${army.id}`, x: camp.centerX, y: camp.centerY, kind: 'army', label: `Штаб: ${army.name}`, refs: [{ kind: 'army', id: army.id }], detail: `${army.soldierIds.length} именных бойцов · полевой лагерь вне поселения · готовность ${Math.round(army.readiness)}%`, visualRole: 'headquarters' });
    } else {
      markers.push({ id: `army-formation-${army.id}`, x: camp.centerX, y: camp.centerY, kind: 'army', label: army.name, refs: [{ kind: 'army', id: army.id }], detail: `${army.soldierIds.length} бойцов · ${camp.mode === 'battle' ? 'боевое построение' : 'походная колонна'} · готовность ${Math.round(army.readiness)}%`, visualRole: camp.mode });
    }
  }

  for (const wagon of (world.supplyWagons ?? []).filter(item => item.x === tile.x && item.y === tile.y && item.status !== 'уничтожен').sort((a, b) => a.id - b.id)) {
    const army = world.armies.find(item => item.id === wagon.armyId);
    const camp = world.armyCamps.find(item => item.armyId === wagon.armyId);
    const park = camp?.structureIds.map(id => world.armyCampStructures.find(item => item.id === id)).find(item => item?.kind === 'wagonPark');
    for (let unitIndex = 0; unitIndex < Math.max(1, wagon.wagonCount); unitIndex += 1) {
      const preferred = park
        ? { x: park.localX + unitIndex % Math.max(1, park.width), y: park.localY + park.height + Math.floor(unitIndex / Math.max(1, park.width)) }
        : { x: (camp?.centerX ?? Math.floor(width / 2)) + 4 + unitIndex, y: (camp?.centerY ?? Math.floor(height / 2)) + 5 };
      const point = occupancy.claimNearest(preferred, `${world.config.seed}:повозка:${wagon.id}:${unitIndex}`, wagonCellAvailable);
      if (!point) continue;
      markers.push({
        id: `supply-wagon-${wagon.id}-${unitIndex}`, x: point.x, y: point.y, kind: 'army', label: `Повозка ${unitIndex + 1}/${Math.max(1, wagon.wagonCount)} · ${army?.name ?? `обоз №${wagon.id}`}`,
        refs: [{ kind: 'supplyWagon', id: wagon.id }, ...(army ? [{ kind: 'army' as const, id: army.id }] : [])],
        detail: `${wagon.horseCount} лошадей в обозе · состояние ${Math.round(wagon.condition)}% · ${wagon.status}`, visualRole: 'wagon',
      });
    }
  }

  for (const item of world.items.filter(entry => entry.settlementId === settlement?.id && !entry.ownerCharacterId && !entry.householdId && !entry.establishmentId).slice(0, 24)) {
    const building = item.buildingId ? world.buildings.find(entry => entry.id === item.buildingId) : undefined;
    const point = building && building.globalX === tile.x && building.globalY === tile.y
      ? buildingInteriorPoint(building, `${world.config.seed}:предмет-в-здании:${item.id}`)
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

function placeAnimalPopulation(
  world: WorldState,
  cells: LocalCell[],
  width: number,
  occupancy: LocalOccupancyGrid,
  population: WorldState['animalPopulations'][number],
  settlement?: WorldState['settlements'][number],
): LocalMarker[] {
  const markers: LocalMarker[] = [];
  const count = Math.max(0, Math.round(population.count));
  if (!count) return markers;
  const predicate = (cell: LocalCell) => animalCellAvailable(cell, population.species, settlement, width);
  const candidates = cells.filter(predicate);
  if (!candidates.length) return markers;
  const seed = `${world.config.seed}:рассеивание:${population.id}:${world.year}:${seasonIndex(world.month)}`;
  const start = hashSeed(`${seed}:start`) % candidates.length;
  const step = coprimeStep(candidates.length, hashSeed(`${seed}:step`));
  const selected: LocalPoint[] = [];
  const idealSpacing = Math.max(1, Math.floor(Math.sqrt(candidates.length / Math.max(1, count)) * .62));
  let cursor = start;
  for (let unitIndex = 0; unitIndex < count; unitIndex += 1) {
    let point: LocalPoint | undefined;
    for (let spacing = idealSpacing; spacing >= 0 && !point; spacing -= 1) {
      for (let attempt = 0; attempt < candidates.length; attempt += 1) {
        const cell = candidates[cursor]!;
        cursor = (cursor + step) % candidates.length;
        if (spacing > 0 && selected.some(other => Math.max(Math.abs(other.x - cell.x), Math.abs(other.y - cell.y)) < spacing)) continue;
        point = occupancy.claim({ x: cell.x, y: cell.y }, predicate);
        if (point) break;
      }
    }
    if (!point) {
      const fallback = deterministicPoint(cells, `${world.config.seed}:особь-резерв:${population.id}:${unitIndex}`, broadAnimalCellAvailable);
      point = occupancy.claimNearest(fallback, `${world.config.seed}:особь-резерв:${population.id}:${unitIndex}`, broadAnimalCellAvailable);
    }
    if (!point) break;
    selected.push(point);
    markers.push({
      id: `fauna-${population.id}-${unitIndex}`, x: point.x, y: point.y, kind: 'fauna', label: `${population.species} ${unitIndex + 1}`,
      refs: [{ kind: 'animalPopulation', id: population.id }],
      detail: `${population.diet} · особь ${unitIndex + 1}/${count} · здоровье популяции ${Math.round(population.health)}%`,
      visualRole: population.species,
    });
    const trailInterval = Math.max(4, Math.ceil(count / 8));
    if (unitIndex % trailInterval === 0) {
      const trail = cells[point.y * width + point.x];
      if (trail && !trail.feature) trail.feature = 'animal-trail';
    }
  }
  return markers;
}

function coprimeStep(length: number, seed: number): number {
  if (length <= 1) return 1;
  let step = Math.max(1, seed % length);
  while (greatestCommonDivisor(step, length) !== 1) step = (step + 1) % length || 1;
  return step;
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a), right = Math.abs(b);
  while (right) { const next = left % right; left = right; right = next; }
  return left || 1;
}

function seasonIndex(month: number): number { return Math.floor((Math.max(1, month) - 1) / 3); }

function animalCellAvailable(cell: LocalCell, species: string, settlement: WorldState['settlements'][number] | undefined, mapSize: number): boolean {
  const aquatic = /рыб|карп|щук|лосос|угор/i.test(species);
  if (aquatic) return cell.ground === 'water' && !cell.blocked;
  if (!broadAnimalCellAvailable(cell)) return false;
  if (cell.buildingId || cell.armyCampStructureId || cell.constructionProjectId || cell.ground === 'floor' || cell.ground === 'road') return false;
  if (settlement) {
    const edge = Math.max(8, Math.round(mapSize * .18));
    const outskirts = cell.x < edge || cell.y < edge || cell.x >= mapSize - edge || cell.y >= mapSize - edge;
    if (!outskirts && !cell.fieldId) return false;
  }
  return true;
}

function broadAnimalCellAvailable(cell: LocalCell): boolean {
  return !cell.blocked && cell.ground !== 'water' && cell.ground !== 'floor' && !cell.buildingId && !cell.armyCampStructureId && !cell.constructionProjectId;
}

function humanCellAvailable(cell: LocalCell): boolean {
  return !cell.blocked && cell.ground !== 'water';
}

function marketCellAvailable(cell: LocalCell): boolean {
  return humanCellAvailable(cell) && (cell.ground === 'road' || cell.ground === 'floor' || Boolean(cell.establishmentId));
}

function monsterCellAvailable(cell: LocalCell): boolean {
  return !cell.blocked && cell.ground !== 'water' && cell.ground !== 'floor' && !cell.buildingId && !cell.armyCampStructureId;
}

function wagonCellAvailable(cell: LocalCell): boolean {
  return !cell.blocked && cell.ground !== 'water' && cell.ground !== 'floor' && !cell.buildingId;
}

function deterministicPoint(cells: LocalCell[], seed: string, predicate: (cell: LocalCell) => boolean): LocalPoint {
  const candidates = cells.filter(predicate);
  if (!candidates.length) return { x: 0, y: 0 };
  const cell = candidates[hashSeed(seed) % candidates.length]!;
  return { x: cell.x, y: cell.y };
}

function selectSeparatedCenters(candidates: LocalCell[], desired: number, seed: string): LocalPoint[] {
  if (!candidates.length || desired <= 0) return [];
  const target = Math.min(desired, candidates.length);
  const first = candidates.reduce((best, cell) => hashSeed(`${seed}:первый:${cell.x}:${cell.y}`) < hashSeed(`${seed}:первый:${best.x}:${best.y}`) ? cell : best, candidates[0]!);
  const centers: LocalPoint[] = [{ x: first.x, y: first.y }];
  const selectedKeys = new Set([`${first.x}:${first.y}`]);
  const minDistance = candidates.map(cell => Math.hypot(cell.x - first.x, cell.y - first.y));
  while (centers.length < target) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < candidates.length; index += 1) {
      const cell = candidates[index]!;
      if (selectedKeys.has(`${cell.x}:${cell.y}`)) continue;
      const score = minDistance[index]! * 10_000 + (hashSeed(`${seed}:${centers.length}:${cell.x}:${cell.y}`) % 10_000);
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    }
    if (bestIndex < 0) break;
    const best = candidates[bestIndex]!;
    centers.push({ x: best.x, y: best.y });
    selectedKeys.add(`${best.x}:${best.y}`);
    for (let index = 0; index < candidates.length; index += 1) {
      const cell = candidates[index]!;
      minDistance[index] = Math.min(minDistance[index]!, Math.hypot(cell.x - best.x, cell.y - best.y));
    }
  }
  return centers;
}

function campStructureLabel(kind: WorldState['armyCampStructures'][number]['kind']): string {
  return ({
    soldierTent: 'Солдатская палатка', officerTent: 'Офицерская палатка', commandTent: 'Командирская палатка',
    fieldKitchen: 'Полевая кухня', infirmary: 'Лазарет', supplyDepot: 'Склад припасов', workshop: 'Ремонтная палатка',
    horseLine: 'Коновязь', wagonPark: 'Стоянка обоза', latrine: 'Отхожее место', guardPost: 'Караульный пост', campfire: 'Костёр',
  } as const)[kind];
}

function characterAnchorBuilding(world: WorldState, character: WorldState['characters'][number]): WorldState['buildings'][number] | undefined {
  const working = character.age >= 14 && character.profession !== 'child';
  const preferredId = working ? character.workplaceBuildingId ?? character.homeBuildingId : character.homeBuildingId;
  return preferredId ? world.buildings.find(building => building.id === preferredId) : undefined;
}

function placeNaturalResources(world: WorldState, tile: Tile, cells: LocalCell[], width: number, height: number): LocalMarker[] {
  const markers: LocalMarker[] = [];
  const occupied = new Set<string>();
  const ingredients = world.ingredients
    .filter(item => item.abundance > 0 && item.x === tile.x && item.y === tile.y && item.kind !== 'животный компонент')
    .sort((a, b) => a.id - b.id);

  for (const ingredient of ingredients) {
    const desired = Math.max(1, Math.round(ingredient.abundance));
    const candidates = cells.filter(cell => resourceCellAvailable(cell) && !occupied.has(`${cell.x}:${cell.y}`));
    if (!candidates.length) continue;
    const patchCount = Math.max(1, Math.min(desired, Math.ceil(desired / 7), 24));
    const centers = selectSeparatedCenters(candidates, patchCount, `${world.config.seed}:участки-ресурса:${ingredient.id}:${world.year}:${seasonIndex(world.month)}`);
    const pools: LocalCell[][] = centers.map(() => []);
    for (const cell of candidates) {
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < centers.length; index += 1) {
        const center = centers[index]!;
        const distance = Math.hypot(cell.x - center.x, cell.y - center.y);
        if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
      }
      pools[nearestIndex]!.push(cell);
    }
    pools.forEach((pool, poolIndex) => pool.sort((a, b) => {
      const center = centers[poolIndex]!;
      const scoreA = Math.hypot(a.x - center.x, a.y - center.y) + resourceHabitatPenalty(a, ingredient.kind, ingredient.name, tile.terrain);
      const scoreB = Math.hypot(b.x - center.x, b.y - center.y) + resourceHabitatPenalty(b, ingredient.kind, ingredient.name, tile.terrain);
      if (scoreA !== scoreB) return scoreA - scoreB;
      return hashSeed(`${world.config.seed}:ресурс:${ingredient.id}:${a.x}:${a.y}`)
        - hashSeed(`${world.config.seed}:ресурс:${ingredient.id}:${b.x}:${b.y}`);
    }));
    const pointers = pools.map(() => 0);
    const selected: LocalCell[] = [];
    for (let unitIndex = 0; unitIndex < Math.min(desired, candidates.length); unitIndex += 1) {
      let cell: LocalCell | undefined;
      for (let offset = 0; offset < pools.length && !cell; offset += 1) {
        const poolIndex = (unitIndex + offset) % pools.length;
        const pool = pools[poolIndex]!;
        while (pointers[poolIndex]! < pool.length) {
          const candidate = pool[pointers[poolIndex]!]!;
          pointers[poolIndex] = pointers[poolIndex]! + 1;
          if (!occupied.has(`${candidate.x}:${candidate.y}`)) { cell = candidate; break; }
        }
      }
      if (!cell) break;
      occupied.add(`${cell.x}:${cell.y}`);
      selected.push(cell);
    }

    selected.forEach((cell, unitIndex) => {
      cell.feature = resourceFeature(ingredient.kind, ingredient.name);
      cell.resourceIngredientId = ingredient.id;
      cell.resourceUnitIndex = unitIndex;
      markers.push({
        id: `resource-${ingredient.id}-${unitIndex}`, x: cell.x, y: cell.y, kind: 'resource', label: ingredient.name,
        refs: [{ kind: 'ingredient', id: ingredient.id }], count: 1,
        detail: `${ingredient.kind} · единица ${unitIndex + 1}/${desired}`, visualRole: 'map-reference',
      });
    });
  }
  return markers;
}

function resourceHabitatPenalty(cell: LocalCell, kind: WorldState['ingredients'][number]['kind'], name: string, terrain: Terrain): number {
  if (kind === 'минерал') return cell.ground === 'stone' || cell.feature === 'rock' ? -8 : terrain === 'mountains' || terrain === 'hills' ? -3 : 8;
  if (kind === 'гриб') return cell.ground === 'mud' || cell.feature === 'bush' || terrain === 'forest' ? -5 : 4;
  if (/тростник|камыш/i.test(name)) return cell.ground === 'mud' || cell.feature === 'reeds' ? -7 : 10;
  if (/ягод|плод|виноград/i.test(name)) return cell.feature === 'bush' || terrain === 'forest' ? -4 : 2;
  return cell.ground === 'grass' || cell.ground === 'mud' ? -2 : 3;
}

function resourceCellAvailable(cell: LocalCell): boolean {
  if (cell.blocked || cell.building || cell.buildingId || cell.fieldId || cell.constructionProjectId || cell.resourceIngredientId) return false;
  if (cell.ground === 'water' || cell.ground === 'road' || cell.ground === 'floor') return false;
  return !cell.feature || ['bush', 'reeds', 'rock'].includes(cell.feature);
}

function resourceFeature(kind: WorldState['ingredients'][number]['kind'], name: string): LocalFeature {
  if (kind === 'минерал') return 'rock';
  if (kind === 'гриб') return 'mushroom';
  if (/ягод|плод|виноград/i.test(name)) return 'berry';
  return 'herb';
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
  if (cell.fieldId) {
    const fieldMarker = map.markers.find(marker => marker.kind === 'field' && marker.refs.some(ref => ref.kind === 'field' && ref.id === cell.fieldId));
    if (fieldMarker && !markers.includes(fieldMarker)) markers.push(fieldMarker);
  }
  const groundNames: Record<LocalGround, string> = { grass: 'трава', dirt: 'земля', sand: 'песок', water: 'вода', mud: 'грязь', snow: 'снег', stone: 'камень', road: 'дорога', floor: 'пол', ash: 'пепел' };
  const featureNames: Partial<Record<LocalFeature, string>> = {
    tree: 'дерево', bush: 'кустарник', rock: 'скала', reeds: 'камыш', wall: 'стена', door: 'дверь', field: 'поле', 'tilled-soil': 'вспаханная земля', seedlings: 'всходы', crop: 'растущая культура', 'ripe-crop': 'созревший урожай', 'construction-foundation': 'фундамент стройки', 'construction-frame': 'каркас стройки', 'construction-wall': 'незавершённые стены', scaffold: 'строительные леса', rubble: 'развалины', looted: 'разграбленный участок', fire: 'огонь', blood: 'кровь', body: 'тело', bones: 'кости', grave: 'могила', cemetery: 'ограда кладбища', chest: 'сундук или предметы',
    'stairs-down': 'спуск вниз', 'stairs-up': 'подъём вверх', bridge: 'мост', herb: 'лекарственное растение', berry: 'ягоды', mushroom: 'грибы', 'animal-trail': 'звериная тропа', tent: 'полевая палатка', campfire: 'лагерный костёр', latrine: 'отхожее место', palisade: 'частокол', 'hitching-post': 'коновязь',
  };
  const lines = [`Основа: ${groundNames[cell.ground]}`];
  if (cell.feature) lines.push(`Объект: ${featureNames[cell.feature] ?? cell.feature}`);
  if (cell.building) lines.push(`Место: ${cell.building}`);
  if (cell.fieldId) lines.push(`Поле №${cell.fieldId}`);
  if (cell.constructionProjectId) lines.push(`Стройплощадка №${cell.constructionProjectId}`);
  if (markers.length) lines.push(`Здесь находятся: ${markers.map(marker => marker.label).join(', ')}`);
  return { title: `${map.globalX}:${map.globalY} · ${x}:${y}`, lines, markers };
}
