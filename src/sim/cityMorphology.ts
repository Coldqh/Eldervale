import type { Building, BuildingType, Settlement, SettlementDistrict, WorldState } from '../types';
import type { CityAxis, CityLayoutStyle, CityWallStyle, DistrictLayoutPlan, SettlementLayoutPlan } from '../cityTypes';
import { hashSeed, RNG } from './rng';

export interface LocalPoint { x: number; y: number; }

type LayoutWorld = Pick<WorldState, 'config'> & Partial<Pick<WorldState, 'settlements' | 'tiles'>>;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const CENTER_TYPES = new Set<BuildingType>(['castle', 'townHall', 'courthouse', 'temple', 'market', 'guildhall', 'manor']);
const EDGE_TYPES = new Set<BuildingType>(['farm', 'stable', 'fishery', 'mine', 'quarry', 'kiln', 'warehouse', 'cemetery' as BuildingType]);
const INDUSTRIAL_TYPES = new Set<BuildingType>(['blacksmith', 'carpenter', 'weaver', 'brewery', 'bakery', 'kiln', 'siegeWorkshop', 'arsenal']);

export function initializeSettlementLayouts(world: WorldState): void {
  for (const settlement of world.settlements) settlement.layout = buildSettlementLayout(world, settlement);
}

export function normalizeSettlementLayouts(world: WorldState): void {
  for (const settlement of world.settlements) {
    const current = settlement.layout;
    const valid = current?.version === 1
      && current.settlementId === settlement.id
      && current.generatedFromSeed === world.config.seed
      && settlement.districts.every(district => current.districtPlans.some(plan => plan.globalX === district.x && plan.globalY === district.y));
    if (!valid) settlement.layout = buildSettlementLayout(world, settlement);
  }
}

export function buildSettlementLayout(world: LayoutWorld, settlement: Settlement): SettlementLayoutPlan {
  const size = world.config.localMapSize ?? 128;
  const districts = settlement.districts.length ? settlement.districts : [{ x: settlement.x, y: settlement.y, name: 'Сердце поселения', role: 'центр' as const }];
  return {
    version: 1,
    settlementId: settlement.id,
    generatedFromSeed: world.config.seed,
    districtPlans: districts.map((district, index) => buildDistrictPlan(world, settlement, district, index, size)),
  };
}

export function districtLayoutPlan(world: LayoutWorld, settlement: Settlement, globalX: number, globalY: number): DistrictLayoutPlan {
  const stored = settlement.layout?.generatedFromSeed === world.config.seed
    ? settlement.layout.districtPlans.find(plan => plan.globalX === globalX && plan.globalY === globalY)
    : undefined;
  if (stored) return stored;
  const district = settlement.districts.find(item => item.x === globalX && item.y === globalY)
    ?? settlement.districts[0]
    ?? { x: settlement.x, y: settlement.y, name: 'Сердце поселения', role: 'центр' as const };
  return buildDistrictPlan(world, settlement, district, Math.max(0, settlement.districts.indexOf(district)), world.config.localMapSize ?? 128);
}

function buildDistrictPlan(world: LayoutWorld, settlement: Settlement, district: SettlementDistrict, index: number, size: number): DistrictLayoutPlan {
  const seed = `${world.config.seed}:морфология:${settlement.id}:${district.x}:${district.y}:${district.role}`;
  const rng = new RNG(seed);
  const style = chooseStyle(world, settlement, district, rng);
  const centerMargin = Math.max(18, Math.floor(size * .2));
  const centerX = rng.int(centerMargin, size - centerMargin - 1);
  const centerY = rng.int(centerMargin, size - centerMargin - 1);
  const axis = rng.pick<CityAxis>(['horizontal', 'vertical', 'diagonal-ne', 'diagonal-se']);
  const densityBase = settlement.type === 'city' ? .82 : settlement.type === 'town' || settlement.type === 'port' ? .68 : settlement.type === 'fortress' ? .62 : .48;
  const density = clamp(densityBase + rng.next() * .18 - .09, .34, .94);
  const blockScale = rng.int(7, settlement.type === 'city' ? 13 : 16);
  const wall = chooseWall(settlement, district, style, rng);
  return {
    version: 1,
    districtName: district.name,
    globalX: district.x,
    globalY: district.y,
    style,
    centerX,
    centerY,
    axis,
    density,
    blockScale,
    wall,
    streetSeed: hashSeed(`${seed}:улицы:${index}`),
  };
}

function chooseStyle(world: LayoutWorld, settlement: Settlement, district: SettlementDistrict, rng: RNG): CityLayoutStyle {
  const terrain = world.tiles?.find(tile => tile.x === district.x && tile.y === district.y)?.terrain;
  if (district.role === 'крепость' || settlement.type === 'fortress') return 'fortified';
  if (district.role === 'порт' || settlement.type === 'port' || terrain === 'coast') return 'waterfront';
  if (terrain === 'hills' || terrain === 'mountains') return rng.chance(.72) ? 'terraced' : 'organic';
  if (district.role === 'поля' || district.role === 'окраина') return rng.chance(.62) ? 'linear' : 'organic';
  if (settlement.type === 'city') return rng.weighted([
    { value: 'radial' as const, weight: 42 }, { value: 'organic' as const, weight: 34 }, { value: 'fortified' as const, weight: 14 }, { value: 'linear' as const, weight: 10 },
  ]);
  if (settlement.type === 'town') return rng.weighted([
    { value: 'organic' as const, weight: 44 }, { value: 'radial' as const, weight: 27 }, { value: 'linear' as const, weight: 29 },
  ]);
  return rng.chance(.64) ? 'organic' : 'linear';
}

function chooseWall(settlement: Settlement, district: SettlementDistrict, style: CityLayoutStyle, rng: RNG): CityWallStyle {
  if (district.role !== 'центр' && district.role !== 'крепость') return 'none';
  if (settlement.type === 'fortress' || style === 'fortified') return 'stone';
  if (settlement.type === 'city') return rng.chance(.48) ? 'stone' : rng.chance(.5) ? 'palisade' : 'none';
  if (settlement.type === 'town') return rng.chance(.3) ? 'palisade' : 'none';
  return 'none';
}

export function morphologyPlacementCandidates(world: LayoutWorld, building: Building, count = 180): LocalPoint[] {
  const size = world.config.localMapSize ?? 128;
  const settlement = world.settlements?.find(item => item.id === building.settlementId);
  if (!settlement) return fallbackCandidates(world.config.seed, building, size, count);
  const plan = districtLayoutPlan(world, settlement, building.globalX, building.globalY);
  const rng = new RNG(`${world.config.seed}:место-здания-v2:${building.settlementId}:${building.id}:${building.type}`);
  const zone = buildingZone(building.type);
  const result: LocalPoint[] = [];
  const margin = 3;
  const maxRadius = Math.max(12, Math.floor(size * (zone === 'edge' ? .43 : zone === 'center' ? .2 : .34)));
  const minRadius = zone === 'center' ? 0 : zone === 'edge' ? Math.floor(size * .27) : Math.floor(size * .08);
  const phase = rng.next() * Math.PI * 2;

  for (let index = 0; index < count; index += 1) {
    const layer = Math.floor(index / 12);
    const noiseX = rng.int(-2, 2);
    const noiseY = rng.int(-2, 2);
    let x = plan.centerX;
    let y = plan.centerY;
    if (plan.style === 'radial') {
      const radius = minRadius + ((index * 7 + layer * 5) % Math.max(1, maxRadius - minRadius + 1));
      const angle = phase + index * GOLDEN_ANGLE;
      x += Math.round(Math.cos(angle) * radius) + noiseX;
      y += Math.round(Math.sin(angle) * radius) + noiseY;
    } else if (plan.style === 'linear' || plan.style === 'waterfront') {
      const along = ((index * 11 + rng.int(0, 8)) % Math.max(12, size - 18)) - Math.floor((size - 18) / 2);
      const side = (index % 2 ? 1 : -1) * (minRadius + (index * 5) % Math.max(5, maxRadius - minRadius + 1));
      const point = axisPoint(plan.axis, along, side);
      x += point.x + noiseX;
      y += point.y + noiseY;
    } else if (plan.style === 'terraced') {
      const terrace = (index % 7) - 3;
      const along = ((index * 13) % Math.max(14, size - 20)) - Math.floor((size - 20) / 2);
      const point = axisPoint(plan.axis === 'vertical' ? 'horizontal' : 'vertical', along, terrace * plan.blockScale);
      x += point.x + noiseX;
      y += point.y + noiseY;
    } else if (plan.style === 'fortified') {
      const block = plan.blockScale;
      const gx = ((index * 5) % 11) - 5;
      const gy = (Math.floor(index / 11) % 11) - 5;
      x += gx * block + (index % 3) + noiseX;
      y += gy * block + ((index + 1) % 3) + noiseY;
    } else {
      const cluster = index % 4;
      const clusterAngle = phase + cluster * Math.PI / 2 + rng.next() * .4;
      const clusterRadius = minRadius + Math.floor(maxRadius * (.22 + cluster * .14));
      const baseX = Math.cos(clusterAngle) * clusterRadius;
      const baseY = Math.sin(clusterAngle) * clusterRadius;
      const radius = Math.sqrt(index + 1) * (2.2 + (1 - plan.density) * 2.5);
      const angle = phase + index * GOLDEN_ANGLE + Math.sin(index * .7) * .5;
      x += Math.round(baseX + Math.cos(angle) * radius) + noiseX;
      y += Math.round(baseY + Math.sin(angle) * radius) + noiseY;
    }
    result.push({ x: clamp(Math.round(x), margin, size - margin - 1), y: clamp(Math.round(y), margin, size - margin - 1) });
  }
  result.push(...fallbackCandidates(world.config.seed, building, size, 40));
  return dedupe(result);
}


export function morphologyRectAllowsBuilding(
  world: LayoutWorld,
  building: Building,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const settlement = world.settlements?.find(item => item.id === building.settlementId);
  if (!settlement) return true;
  const plan = districtLayoutPlan(world, settlement, building.globalX, building.globalY);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const clearance = Math.max(3, Math.hypot(rect.width, rect.height) * .36);
  const dx = cx - plan.centerX;
  const dy = cy - plan.centerY;
  if (Math.hypot(dx, dy) < clearance + 4) return false;
  if (plan.style === 'linear' || plan.style === 'waterfront') {
    return distanceToAxis(plan.axis, dx, dy) > clearance + (plan.style === 'waterfront' ? 3 : 1);
  }
  if (plan.style === 'terraced') {
    const coordinate = plan.axis === 'vertical' ? dx : dy;
    for (let terrace = -2; terrace <= 2; terrace += 1) if (Math.abs(coordinate - terrace * Math.max(8, plan.blockScale)) <= clearance + 1) return false;
    return true;
  }
  if (plan.style === 'fortified') {
    if (Math.abs(dx) <= clearance + 3 || Math.abs(dy) <= clearance + 3) return false;
    const ringX = Math.max(14, Math.round((world.config.localMapSize ?? 128) * .22));
    const ringY = Math.max(12, Math.round((world.config.localMapSize ?? 128) * .2));
    if (Math.abs(Math.abs(dx) - ringX) <= clearance + 1 && Math.abs(dy) <= ringY + clearance) return false;
    if (Math.abs(Math.abs(dy) - ringY) <= clearance + 1 && Math.abs(dx) <= ringX + clearance) return false;
    return true;
  }
  if (plan.style === 'radial') {
    const radius = Math.max(14, Math.round((world.config.localMapSize ?? 128) * (.16 + plan.density * .08)));
    const distance = Math.hypot(dx, dy);
    if (Math.abs(distance - radius) <= clearance + 1) return false;
    const angle = Math.atan2(dy, dx);
    const base = (plan.streetSeed % 360) * Math.PI / 180;
    for (let spoke = 0; spoke < 5; spoke += 1) {
      const spokeAngle = base + spoke * Math.PI * 2 / 5;
      const perpendicular = Math.abs(Math.sin(angle - spokeAngle) * distance);
      if (perpendicular <= clearance + 1) return false;
    }
    return true;
  }
  const base = (plan.streetSeed % 720) * Math.PI / 360;
  for (let branch = 0; branch < 3; branch += 1) {
    const branchAngle = base + branch * 2.19;
    const perpendicular = Math.abs(Math.sin(Math.atan2(dy, dx) - branchAngle) * Math.hypot(dx, dy));
    if (perpendicular <= clearance && Math.hypot(dx, dy) < (world.config.localMapSize ?? 128) * .38) return false;
  }
  return true;
}

function distanceToAxis(axis: CityAxis, dx: number, dy: number): number {
  if (axis === 'horizontal') return Math.abs(dy);
  if (axis === 'vertical') return Math.abs(dx);
  if (axis === 'diagonal-ne') return Math.abs(dx + dy) / Math.SQRT2;
  return Math.abs(dx - dy) / Math.SQRT2;
}

function fallbackCandidates(seed: string, building: Building, size: number, count: number): LocalPoint[] {
  const rng = new RNG(`${seed}:резервные-места:${building.id}`);
  return Array.from({ length: count }, () => ({ x: rng.int(3, size - 4), y: rng.int(3, size - 4) }));
}

function buildingZone(type: BuildingType): 'center' | 'middle' | 'edge' {
  if (CENTER_TYPES.has(type)) return 'center';
  if (EDGE_TYPES.has(type) || INDUSTRIAL_TYPES.has(type)) return 'edge';
  return 'middle';
}

function axisPoint(axis: CityAxis, along: number, side: number): LocalPoint {
  if (axis === 'horizontal') return { x: along, y: side };
  if (axis === 'vertical') return { x: side, y: along };
  if (axis === 'diagonal-ne') return { x: Math.round((along + side) / Math.SQRT2), y: Math.round((-along + side) / Math.SQRT2) };
  return { x: Math.round((along + side) / Math.SQRT2), y: Math.round((along - side) / Math.SQRT2) };
}

function dedupe(points: LocalPoint[]): LocalPoint[] {
  const seen = new Set<string>();
  return points.filter(point => {
    const key = `${point.x}:${point.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
