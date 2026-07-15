import type { ScheduledAction, Settlement, WorldState } from '../types';
import type { WorldIndexes } from './indexes';
import { coordinateKey } from './indexes';

export interface MonthSchedule {
  tick: number;
  activeRegionKeys: Set<string>;
  activeSettlementIds: Set<number>;
  economySettlementIds: Set<number>;
  ecologySettlementIds: Set<number>;
  dueArmyIds: Set<number>;
  dueMonsterIds: Set<number>;
  runSeasonalEcology: boolean;
  runPopulation: boolean;
  runHousing: boolean;
  runBooks: boolean;
  runSettlementLifecycle: boolean;
  processedTasks: number;
}

export const worldTick = (world: Pick<WorldState, 'year' | 'month'>) => world.year * 12 + world.month - 1;

export function createSimulationRuntime(world: Pick<WorldState, 'year' | 'month'>): WorldState['simulation'] {
  return {
    schedulerVersion: 1,
    clockTick: worldTick(world),
    activeRegionKeys: [],
    sleepingRegionCount: 0,
    queuedActions: [],
  };
}

export function ensureSimulationRuntime(world: WorldState): void {
  world.simulation ??= createSimulationRuntime(world);
  world.simulation.schedulerVersion = 1;
  world.simulation.clockTick = worldTick(world);
  world.simulation.activeRegionKeys ??= [];
  world.simulation.sleepingRegionCount ??= 0;
  world.simulation.queuedActions ??= [];
}

function actionInterval(world: WorldState, action: ScheduledAction): number {
  if (action.kind === 'army') return 1;
  if (action.kind === 'war') return 1;
  if (action.kind === 'monster') {
    const monster = world.monsters.find(item => item.id === action.entityId);
    if (!monster) return 4;
    if (monster.targetSettlementId || monster.hunger >= 70 || monster.tier === 'boss') return 1;
    if (monster.tier === 'miniboss') return 2;
    if (monster.tier === 'elite') return 3;
    return 4;
  }
  return action.repeatEvery ?? 3;
}

function synchronizeEntityQueue(world: WorldState): void {
  const tick = worldTick(world);
  const validKeys = new Set<string>();
  for (const army of world.armies) {
    if (army.status !== 'marching' && army.status !== 'raiding' && army.status !== 'battle') continue;
    validKeys.add(`army:${army.id}`);
  }
  for (const monster of world.monsters) if (monster.alive) validKeys.add(`monster:${monster.id}`);
  for (const war of world.wars) if (war.active) validKeys.add(`war:${war.id}`);

  world.simulation.queuedActions = world.simulation.queuedActions.filter(action => validKeys.has(action.id));
  const existing = new Set(world.simulation.queuedActions.map(action => action.id));

  for (const key of validKeys) {
    if (existing.has(key)) continue;
    const [kind, rawId] = key.split(':') as ['army' | 'monster' | 'war', string];
    const action: ScheduledAction = { id: key, kind, entityId: Number(rawId), dueTick: tick + 1 };
    action.repeatEvery = actionInterval(world, action);
    world.simulation.queuedActions.push(action);
  }
}

function collectActiveRegions(world: WorldState, indexes: WorldIndexes): { regions: Set<string>; settlements: Set<number> } {
  const regions = new Set<string>();
  const settlements = new Set<number>();
  const activate = (x: number, y: number, radius = 0) => {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) <= radius) {
          const key = coordinateKey(x + dx, y + dy);
          if (indexes.tileByCoordinate.has(key)) regions.add(key);
        }
      }
    }
  };
  const activateSettlement = (settlement?: Settlement) => {
    if (!settlement) return;
    settlements.add(settlement.id);
    for (const district of settlement.districts) activate(district.x, district.y, 1);
  };

  for (const settlement of world.settlements) {
    if (settlement.shortages.length || settlement.damaged >= 20 || settlement.unrest >= 35 || settlement.population > settlement.residentialCapacity * .96) activateSettlement(settlement);
  }
  for (const army of world.armies) {
    if (army.status === 'garrison' || army.status === 'recovering') continue;
    activate(army.x, army.y, 2);
    activateSettlement(army.targetSettlementId ? indexes.settlementById.get(army.targetSettlementId) : undefined);
  }
  for (const war of world.wars) {
    if (!war.active) continue;
    for (const settlementId of war.contestedSettlementIds) activateSettlement(indexes.settlementById.get(settlementId));
  }
  for (const monster of world.monsters) {
    if (!monster.alive || (monster.tier === 'common' && monster.hunger < 60 && !monster.targetSettlementId)) continue;
    activate(monster.x, monster.y, Math.min(3, Math.max(1, monster.territoryRadius)));
    activateSettlement(monster.targetSettlementId ? indexes.settlementById.get(monster.targetSettlementId) : undefined);
    for (const settlement of world.settlements) {
      if (Math.hypot(settlement.x - monster.x, settlement.y - monster.y) <= monster.territoryRadius + 2) activateSettlement(settlement);
    }
  }

  return { regions, settlements };
}

export function prepareMonthSchedule(world: WorldState, indexes: WorldIndexes): MonthSchedule {
  ensureSimulationRuntime(world);
  synchronizeEntityQueue(world);
  const tick = worldTick(world);
  const due = world.simulation.queuedActions.filter(action => action.dueTick <= tick);
  const remaining = world.simulation.queuedActions.filter(action => action.dueTick > tick);
  const dueArmyIds = new Set<number>();
  const dueMonsterIds = new Set<number>();

  for (const action of due) {
    if (action.kind === 'army' && action.entityId) dueArmyIds.add(action.entityId);
    if (action.kind === 'monster' && action.entityId) dueMonsterIds.add(action.entityId);
    action.repeatEvery = actionInterval(world, action);
    action.dueTick = tick + Math.max(1, action.repeatEvery);
    remaining.push(action);
  }
  world.simulation.queuedActions = remaining.sort((a, b) => a.dueTick - b.dueTick || a.id.localeCompare(b.id));

  const { regions, settlements: activeSettlementIds } = collectActiveRegions(world, indexes);
  const seasonal = [1, 4, 7, 10].includes(world.month);
  const bulkEcology = seasonal || [8, 12].includes(world.month);
  const economySettlementIds = new Set<number>(activeSettlementIds);
  const ecologySettlementIds = new Set<number>(activeSettlementIds);
  if (seasonal) {
    for (const settlement of world.settlements) {
      economySettlementIds.add(settlement.id);
    }
  }
  if (bulkEcology) {
    for (const settlement of world.settlements) {
      ecologySettlementIds.add(settlement.id);
    }
  }

  world.simulation.clockTick = tick;
  world.simulation.activeRegionKeys = [...regions];
  world.simulation.sleepingRegionCount = Math.max(0, world.tiles.filter(tile => tile.terrain !== 'ocean').length - regions.size);

  return {
    tick,
    activeRegionKeys: regions,
    activeSettlementIds,
    economySettlementIds,
    ecologySettlementIds,
    dueArmyIds,
    dueMonsterIds,
    runSeasonalEcology: seasonal,
    runPopulation: world.month === 1,
    runHousing: world.month === 2 || world.month === 8,
    runBooks: world.month === 12,
    runSettlementLifecycle: world.month === 3,
    processedTasks: due.length + economySettlementIds.size + ecologySettlementIds.size,
  };
}
