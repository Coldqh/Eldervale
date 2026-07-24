import type { DistrictCivicState, Settlement, SettlementDistrict, Tile, WorldState } from '../types';
import { appendCausalEvent } from './causality';
import { markCityDirty } from './cityState';
import { transferMoney } from './financialSystem';

type DistrictRole = SettlementDistrict['role'];

export interface DistrictExpansionResult {
  ok: boolean;
  cost: number;
  district?: SettlementDistrict;
  reason?: string;
}

const TERRAIN_COST: Record<Tile['terrain'], number> = {
  ocean: Number.POSITIVE_INFINITY,
  coast: 72,
  plains: 42,
  forest: 58,
  hills: 74,
  mountains: 120,
  marsh: 92,
  desert: 78,
  tundra: 82,
};

export function expandSettlementDistrict(
  world: WorldState,
  settlement: Settlement,
  role: DistrictRole,
  reason: string,
): DistrictExpansionResult {
  const candidate = expansionCandidates(world, settlement)[0];
  if (!candidate) return { ok: false, cost: 0, reason: 'рядом нет свободной пригодной земли под контролем государства' };

  const government = world.settlementGovernments.find(item => item.settlementId === settlement.id);
  if (!government) return { ok: false, cost: 0, reason: 'в поселении нет местной власти, способной оформить новый район' };

  const cost = Math.round(TERRAIN_COST[candidate.terrain] + settlement.districts.length * 4);
  if (government.treasury < cost) {
    return { ok: false, cost, reason: `городской казне не хватает ${Math.ceil(cost - government.treasury)} монет на дороги, межевание и водоотвод` };
  }

  const district: SettlementDistrict = {
    x: candidate.x,
    y: candidate.y,
    role,
    name: nextDistrictName(settlement, role),
  };
  const payment = transferMoney(world, {
    payer: { kind: 'settlementGovernment', id: government.id },
    amount: cost,
    kind: 'maintenance',
    purpose: `дороги, межевание и водоотвод для района «${district.name}»`,
    settlementId: settlement.id,
    kingdomId: settlement.kingdomId,
  });
  if (payment.paid + .0001 < cost) return { ok: false, cost, reason: 'городская казна не смогла провести оплату расширения' };
  government.history.push(`В ${world.year}.${String(world.month).padStart(2, '0')} выделено ${cost} монет на район «${district.name}»: ${reason}.`);
  settlement.districts.push(district);
  settlement.history.push(`В ${world.year} году к городу присоединён район «${district.name}» (${role}).`);
  candidate.settlementId = settlement.id;
  candidate.settlementDistrict = district.name;
  ensureDistrictCivicState(world, settlement, district);
  markCityDirty(world, settlement.id, 'construction');
  appendCausalEvent(world, {
    kind: 'settlement',
    title: `Расширение города: ${district.name}`,
    description: `${settlement.name} занял новую городскую клетку ${candidate.x}:${candidate.y} под район «${district.name}».`,
    cause: reason,
    conditions: [`земля принадлежит государству №${settlement.kingdomId}`, `местная казна оплатила ${cost} монет`, `клетка не занята другим поселением`],
    decision: `расширить город и назначить новой земле роль «${role}»`,
    outcome: 'район добавлен в физическую структуру поселения',
    consequences: ['появилась новая земля для зданий, полей и общественных служб', 'городская казна уменьшилась'],
    entityRefs: [{ kind: 'settlement', id: settlement.id }],
    importance: 2,
  });
  return { ok: true, cost, district };
}

function expansionCandidates(world: WorldState, settlement: Settlement): Tile[] {
  const tileByKey = new Map(world.tiles.map(tile => [`${tile.x}:${tile.y}`, tile]));
  const existing = new Set(settlement.districts.map(district => `${district.x}:${district.y}`));
  const candidates = new Map<string, Tile>();
  for (const district of settlement.districts) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = district.x + dx;
      const y = district.y + dy;
      const key = `${x}:${y}`;
      if (existing.has(key) || candidates.has(key)) continue;
      const tile = tileByKey.get(key);
      if (!tile || tile.terrain === 'ocean' || tile.settlementId || tile.dungeonId || tile.monsterId) continue;
      if (tile.kingdomId !== settlement.kingdomId) continue;
      candidates.set(key, tile);
    }
  }
  return [...candidates.values()].sort((a, b) => expansionScore(a, settlement) - expansionScore(b, settlement) || a.y - b.y || a.x - b.x);
}

function expansionScore(tile: Tile, settlement: Settlement): number {
  const centerDistance = Math.abs(tile.x - settlement.x) + Math.abs(tile.y - settlement.y);
  const occupiedNeighbours = settlement.districts.filter(district => Math.abs(district.x - tile.x) + Math.abs(district.y - tile.y) === 1).length;
  return TERRAIN_COST[tile.terrain] + centerDistance * 3 - occupiedNeighbours * 8;
}

function nextDistrictName(settlement: Settlement, role: DistrictRole): string {
  const base = role[0]!.toUpperCase() + role.slice(1);
  const existing = new Set(settlement.districts.map(district => district.name));
  let serial = 1;
  while (existing.has(`${base} ${serial}`)) serial += 1;
  return `${base} ${serial}`;
}

function ensureDistrictCivicState(world: WorldState, settlement: Settlement, district: SettlementDistrict): DistrictCivicState {
  const existing = world.districtCivicStates.find(item => item.settlementId === settlement.id && item.districtName === district.name);
  if (existing) return existing;
  world.nextIds.districtCivic ??= Math.max(0, ...world.districtCivicStates.map(item => item.id)) + 1;
  const neighbours = world.districtCivicStates.filter(item => item.settlementId === settlement.id);
  const average = (field: keyof Pick<DistrictCivicState, 'safety' | 'cleanliness' | 'fireRisk' | 'waterAccess' | 'rentMultiplier' | 'crimeRate'>, fallback: number) =>
    neighbours.length ? neighbours.reduce((sum, item) => sum + Number(item[field]), 0) / neighbours.length : fallback;
  const state: DistrictCivicState = {
    id: world.nextIds.districtCivic++,
    settlementId: settlement.id,
    districtName: district.name,
    safety: clamp(average('safety', 45) - 4, 0, 100),
    cleanliness: clamp(average('cleanliness', 48) - 7, 0, 100),
    fireRisk: clamp(average('fireRisk', 32) + 4, 0, 100),
    waterAccess: clamp(average('waterAccess', 42) - 8, 0, 100),
    rentMultiplier: clamp(average('rentMultiplier', .8) * .82, .35, 2.4),
    crimeRate: clamp(average('crimeRate', 28) + 5, 0, 100),
    homelessCount: 0,
    patrolIds: [],
    history: [`Район создан при расширении ${settlement.name} в ${world.year} году.`],
  };
  world.districtCivicStates.push(state);
  return state;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
