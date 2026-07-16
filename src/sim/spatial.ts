import type { Building, BuildingType, WorldState } from '../types';
import { hashSeed } from './rng';

export interface SpatialRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EDGE_MARGIN = 3;
const BUILDING_GAP = 1;

export function buildingDimensions(type: BuildingType, floors: number): { width: number; height: number } {
  if (type === 'tenement' || type === 'manor' || type === 'guildhall') return { width: Math.min(11, 7 + floors), height: Math.min(9, 6 + Math.floor(floors / 2)) };
  if (type === 'castle') return { width: Math.min(24, 17 + floors * 2), height: Math.min(20, 14 + floors) };
  if (type === 'arsenal' || type === 'siegeWorkshop') return { width: 11, height: 8 };
  if (type === 'watchtower') return { width: 5, height: 5 };
  if (type === 'townHall' || type === 'courthouse') return { width: 10, height: 8 };
  if (type === 'prison') return { width: 11, height: 8 };
  if (type === 'fireStation') return { width: 9, height: 7 };
  if (type === 'school' || type === 'shelter') return { width: 9, height: 6 };
  if (type === 'warehouse' || type === 'barracks' || type === 'market') return { width: 9, height: 7 };
  if (type === 'tavern' || type === 'inn' || type === 'temple' || type === 'monastery') return { width: 8, height: 6 };
  if (type === 'farm' || type === 'stable' || type === 'fishery') return { width: 8, height: 5 };
  if (type === 'mine' || type === 'quarry') return { width: 7, height: 6 };
  if (type === 'kiln') return { width: 8, height: 6 };
  return { width: 6, height: 5 };
}

export function buildingRect(building: Building): SpatialRect {
  const fallback = buildingDimensions(building.type, building.floors);
  return {
    x: building.localX,
    y: building.localY,
    width: building.localWidth ?? fallback.width,
    height: building.localHeight ?? fallback.height,
  };
}

export function buildingContains(building: Building, x: number, y: number): boolean {
  const rect = buildingRect(building);
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

export function buildingInteriorPoint(building: Building, seed: string | number): { x: number; y: number } {
  const rect = buildingRect(building);
  const hash = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  const interiorWidth = Math.max(1, rect.width - 2);
  const interiorHeight = Math.max(1, rect.height - 2);
  return {
    x: rect.x + Math.min(rect.width - 1, 1 + hash % interiorWidth),
    y: rect.y + Math.min(rect.height - 1, 1 + Math.floor(hash / 97) % interiorHeight),
  };
}

export function ensureAllBuildingFootprints(world: WorldState): void {
  const ordered = [...world.buildings].sort((a, b) => a.globalY - b.globalY || a.globalX - b.globalX || a.id - b.id);
  const placed: Building[] = [];
  for (const building of ordered) {
    assignBuildingFootprint(world, building, placed);
    placed.push(building);
  }
}

export function assignBuildingFootprint(world: Pick<WorldState, 'config' | 'buildings'>, building: Building, alreadyPlaced?: readonly Building[]): void {
  const localSize = world.config.localMapSize ?? 128;
  const dimensions = buildingDimensions(building.type, building.floors);
  const width = Math.max(4, building.localWidth ?? dimensions.width);
  const height = Math.max(4, building.localHeight ?? dimensions.height);
  const peers = (alreadyPlaced ?? world.buildings).filter(other => other.id !== building.id && other.globalX === building.globalX && other.globalY === building.globalY);
  const preferred = {
    x: clamp(building.localX, EDGE_MARGIN, localSize - width - EDGE_MARGIN),
    y: clamp(building.localY, EDGE_MARGIN, localSize - height - EDGE_MARGIN),
  };
  const slot = findFreeRect(preferred.x, preferred.y, width, height, localSize, peers) ?? preferred;
  building.localX = slot.x;
  building.localY = slot.y;
  building.localWidth = width;
  building.localHeight = height;

  const sideRoll = hashSeed(`${world.config.seed}:вход:${building.id}`) % 4;
  if (sideRoll === 0) {
    building.entranceX = slot.x + Math.floor(width / 2);
    building.entranceY = slot.y;
  } else if (sideRoll === 1) {
    building.entranceX = slot.x + width - 1;
    building.entranceY = slot.y + Math.floor(height / 2);
  } else if (sideRoll === 2) {
    building.entranceX = slot.x + Math.floor(width / 2);
    building.entranceY = slot.y + height - 1;
  } else {
    building.entranceX = slot.x;
    building.entranceY = slot.y + Math.floor(height / 2);
  }
}

function findFreeRect(preferredX: number, preferredY: number, width: number, height: number, localSize: number, peers: readonly Building[]): { x: number; y: number } | undefined {
  const fits = (x: number, y: number) => {
    if (x < EDGE_MARGIN || y < EDGE_MARGIN || x + width > localSize - EDGE_MARGIN || y + height > localSize - EDGE_MARGIN) return false;
    const candidate = { x: x - BUILDING_GAP, y: y - BUILDING_GAP, width: width + BUILDING_GAP * 2, height: height + BUILDING_GAP * 2 };
    return peers.every(peer => !rectanglesOverlap(candidate, expandedRect(buildingRect(peer), BUILDING_GAP)));
  };

  if (fits(preferredX, preferredY)) return { x: preferredX, y: preferredY };
  for (let radius = 2; radius <= localSize; radius += 2) {
    for (let dx = -radius; dx <= radius; dx += 2) {
      for (const dy of [-radius, radius]) {
        const x = clamp(preferredX + dx, EDGE_MARGIN, localSize - width - EDGE_MARGIN);
        const y = clamp(preferredY + dy, EDGE_MARGIN, localSize - height - EDGE_MARGIN);
        if (fits(x, y)) return { x, y };
      }
    }
    for (let dy = -radius + 2; dy <= radius - 2; dy += 2) {
      for (const dx of [-radius, radius]) {
        const x = clamp(preferredX + dx, EDGE_MARGIN, localSize - width - EDGE_MARGIN);
        const y = clamp(preferredY + dy, EDGE_MARGIN, localSize - height - EDGE_MARGIN);
        if (fits(x, y)) return { x, y };
      }
    }
  }

  // Фрагментированная плотная застройка требует полного прохода, а не только спирали с шагом 2.
  for (let y = EDGE_MARGIN; y <= localSize - height - EDGE_MARGIN; y += 1) {
    for (let x = EDGE_MARGIN; x <= localSize - width - EDGE_MARGIN; x += 1) {
      if (fits(x, y)) return { x, y };
    }
  }

  // В старых перенаселённых городах допускаем соприкосновение стен, но никогда пересечение областей.
  const fitsTight = (x: number, y: number) => {
    if (x < EDGE_MARGIN || y < EDGE_MARGIN || x + width > localSize - EDGE_MARGIN || y + height > localSize - EDGE_MARGIN) return false;
    const candidate = { x, y, width, height };
    return peers.every(peer => !rectanglesOverlap(candidate, buildingRect(peer)));
  };
  for (let y = EDGE_MARGIN; y <= localSize - height - EDGE_MARGIN; y += 1) {
    for (let x = EDGE_MARGIN; x <= localSize - width - EDGE_MARGIN; x += 1) {
      if (fitsTight(x, y)) return { x, y };
    }
  }
  return undefined;
}

function expandedRect(rect: SpatialRect, gap: number): SpatialRect {
  return { x: rect.x - gap, y: rect.y - gap, width: rect.width + gap * 2, height: rect.height + gap * 2 };
}

function rectanglesOverlap(a: SpatialRect, b: SpatialRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function constructionRect(project: import('../types').ConstructionProject): SpatialRect {
  return { x: project.localX, y: project.localY, width: project.localWidth, height: project.localHeight };
}

export function assignConstructionFootprint(
  world: Pick<WorldState, 'config' | 'buildings' | 'constructionProjects' | 'fields'>,
  project: import('../types').ConstructionProject,
): void {
  const localSize = world.config.localMapSize ?? 128;
  const dimensions = buildingDimensions(project.buildingType, 1);
  const width = Math.max(4, project.localWidth || dimensions.width);
  const height = Math.max(4, project.localHeight || dimensions.height);
  const occupiedRects: SpatialRect[] = [
    ...world.buildings.filter(item => item.globalX === project.globalX && item.globalY === project.globalY).map(buildingRect),
    ...world.constructionProjects.filter(item => item.id !== project.id && item.stage !== 'завершено' && item.stage !== 'заброшено' && item.globalX === project.globalX && item.globalY === project.globalY).map(constructionRect),
  ];
  const fieldKeys = new Set(world.fields.filter(item => item.globalX === project.globalX && item.globalY === project.globalY).flatMap(item => item.cells.map(cell => `${cell.x}:${cell.y}`)));
  const preferredX = clamp(project.localX, EDGE_MARGIN, localSize - width - EDGE_MARGIN);
  const preferredY = clamp(project.localY, EDGE_MARGIN, localSize - height - EDGE_MARGIN);
  const fits = (x: number, y: number) => {
    if (x < EDGE_MARGIN || y < EDGE_MARGIN || x + width > localSize - EDGE_MARGIN || y + height > localSize - EDGE_MARGIN) return false;
    const candidate = { x, y, width, height };
    if (occupiedRects.some(rect => rectanglesOverlap(candidate, expandedRect(rect, 1)))) return false;
    for (let yy = y; yy < y + height; yy += 1) for (let xx = x; xx < x + width; xx += 1) if (fieldKeys.has(`${xx}:${yy}`)) return false;
    return true;
  };
  let slot: { x: number; y: number } | undefined;
  for (let radius = 0; radius <= localSize && !slot; radius += 2) {
    for (let dy = -radius; dy <= radius && !slot; dy += 2) {
      for (let dx = -radius; dx <= radius; dx += 2) {
        const x = clamp(preferredX + dx, EDGE_MARGIN, localSize - width - EDGE_MARGIN);
        const y = clamp(preferredY + dy, EDGE_MARGIN, localSize - height - EDGE_MARGIN);
        if (fits(x, y)) { slot = { x, y }; break; }
      }
    }
  }
  slot ??= { x: preferredX, y: preferredY };
  project.localX = slot.x;
  project.localY = slot.y;
  project.localWidth = width;
  project.localHeight = height;
  project.entranceX = slot.x + Math.floor(width / 2);
  project.entranceY = slot.y + height - 1;
}

export function assignFieldCells(
  world: Pick<WorldState, 'config' | 'buildings' | 'constructionProjects' | 'fields'>,
  globalX: number,
  globalY: number,
  near: { x: number; y: number },
  desiredCount: number,
  seed: string,
  fieldId?: number,
): import('../types').FieldCell[] {
  const size = world.config.localMapSize ?? 128;
  const blocked = new Set<string>();
  for (const building of world.buildings.filter(item => item.globalX === globalX && item.globalY === globalY)) {
    const rect = buildingRect(building);
    for (let y = rect.y - 1; y <= rect.y + rect.height; y += 1) for (let x = rect.x - 1; x <= rect.x + rect.width; x += 1) blocked.add(`${x}:${y}`);
  }
  for (const project of world.constructionProjects.filter(item => item.stage !== 'завершено' && item.stage !== 'заброшено' && item.globalX === globalX && item.globalY === globalY)) {
    const rect = constructionRect(project);
    for (let y = rect.y - 1; y <= rect.y + rect.height; y += 1) for (let x = rect.x - 1; x <= rect.x + rect.width; x += 1) blocked.add(`${x}:${y}`);
  }
  for (const field of world.fields.filter(item => item.id !== fieldId && item.globalX === globalX && item.globalY === globalY)) for (const cell of field.cells) blocked.add(`${cell.x}:${cell.y}`);

  const result: import('../types').FieldCell[] = [];
  const selected = new Set<string>();
  let cursor = hashSeed(seed);
  const next = () => {
    cursor ^= cursor << 13; cursor ^= cursor >>> 17; cursor ^= cursor << 5;
    return cursor >>> 0;
  };
  const target = Math.max(12, Math.min(desiredCount, Math.floor(size * size * .18)));
  const originX = clamp(near.x + 3 + (next() % 9), 2, size - 3);
  const originY = clamp(near.y + 3 + (next() % 9), 2, size - 3);
  const frontier: import('../types').FieldCell[] = [{ x: originX, y: originY }];
  const directions = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  let guard = target * 80;
  while (frontier.length && result.length < target && guard-- > 0) {
    const index = next() % frontier.length;
    const point = frontier.splice(index, 1)[0]!;
    const key = `${point.x}:${point.y}`;
    if (point.x < 2 || point.y < 2 || point.x >= size - 2 || point.y >= size - 2 || blocked.has(key) || selected.has(key)) continue;
    selected.add(key);
    result.push(point);
    const rotated = next() % 4;
    for (let i = 0; i < 4; i += 1) {
      const dir = directions[(i + rotated) % 4]!;
      frontier.push({ x: point.x + dir.x, y: point.y + dir.y });
    }
  }
  if (result.length < Math.min(12, target)) {
    for (let y = 2; y < size - 2 && result.length < target; y += 1) for (let x = 2; x < size - 2 && result.length < target; x += 1) {
      const key = `${x}:${y}`;
      if (!blocked.has(key) && !selected.has(key)) { selected.add(key); result.push({ x, y }); }
    }
  }
  return result;
}
