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
  if (type === 'warehouse' || type === 'barracks' || type === 'market') return { width: 9, height: 7 };
  if (type === 'tavern' || type === 'inn' || type === 'temple' || type === 'monastery') return { width: 8, height: 6 };
  if (type === 'farm' || type === 'stable' || type === 'fishery') return { width: 8, height: 5 };
  if (type === 'mine') return { width: 7, height: 6 };
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
