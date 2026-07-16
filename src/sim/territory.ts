import type { Kingdom, Settlement, TerritoryChange, Tile, WorldState } from '../types';
import { RNG } from './rng';

const TERRAIN_COST: Record<Tile['terrain'], number> = {
  ocean: Number.POSITIVE_INFINITY,
  coast: 1.15,
  plains: 1,
  forest: 1.45,
  hills: 1.65,
  mountains: 3.4,
  marsh: 2.2,
  desert: 2.4,
  tundra: 2.5,
};

const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

export function initializeTerritorialHistory(world: WorldState): void {
  world.territoryHistory = [];
  world.nextIds.territoryChange = 1;
  for (const tile of world.tiles) {
    tile.kingdomId = undefined;
    tile.controlledSinceYear = undefined;
  }
}

export function advanceHistoricalTerritories(world: WorldState, rng: RNG, startYear: number, spanYears: number): void {
  const endYear = Math.min(world.year, startYear + Math.max(1, spanYears) - 1);
  ensureFoundedCapitals(world, endYear);
  const roadCells = tradeRoadCells(world);
  const kingdoms = [...world.kingdoms]
    .filter(kingdom => kingdom.foundedYear <= endYear)
    .sort((a, b) => a.foundedYear - b.foundedYear || a.id - b.id);

  for (const kingdom of kingdoms) {
    const effectiveStart = Math.max(startYear, kingdom.foundedYear + 1);
    if (effectiveStart > endYear) continue;
    expandKingdom(world, kingdom, rng, effectiveStart, endYear - effectiveStart + 1, roadCells);
  }
}

export function advanceModernTerritories(world: WorldState, rng: RNG): void {
  if (world.month !== 1) return;
  ensureFoundedCapitals(world, world.year);
  const roadCells = tradeRoadCells(world);
  for (const kingdom of world.kingdoms) {
    if (kingdom.foundedYear > world.year) continue;
    expandKingdom(world, kingdom, rng, world.year, 1, roadCells);
  }
}

export function transferKingdomTerritory(
  world: WorldState,
  fromKingdomId: number,
  toKingdomId: number,
  year: number,
  month: number,
  sourceSettlementId?: number,
): number {
  let transferred = 0;
  for (const tile of world.tiles) {
    if (tile.kingdomId !== fromKingdomId) continue;
    if (claim(world, tile, toKingdomId, year, month, 'военное завоевание', sourceSettlementId)) transferred += 1;
  }
  return transferred;
}

export function captureTerritoryAroundSettlement(
  world: WorldState,
  target: Settlement,
  kingdomId: number,
  year: number,
  rng: RNG,
  maximumCells = 7,
): number {
  const targetTile = tileAt(world, target.x, target.y);
  if (!targetTile || targetTile.terrain === 'ocean') return 0;
  const previousKingdomId = targetTile.kingdomId;
  const connection = shortestConnectionPath(world, kingdomId, targetTile, previousKingdomId);
  if (!connection.length) return 0;
  let claimed = 0;
  for (const tile of connection) {
    if (tile.kingdomId === kingdomId) continue;
    if (claim(world, tile, kingdomId, year, rng.int(1, 12), 'военное завоевание', target.id)) claimed += 1;
  }

  const queue: Tile[] = [targetTile];
  const visited = new Set(connection.map(tile => key(tile.x, tile.y)));
  const surroundingLimit = Math.max(1, maximumCells);
  let surroundingClaims = 0;
  while (queue.length && surroundingClaims < surroundingLimit) {
    const source = queue.shift()!;
    const neighbours = neighboursOf(world, source)
      .filter(tile => !visited.has(key(tile.x, tile.y)))
      .filter(tile => tile.terrain !== 'ocean')
      .filter(tile => tile.kingdomId === previousKingdomId || tile.kingdomId === undefined)
      .sort((a, b) => TERRAIN_COST[a.terrain] - TERRAIN_COST[b.terrain] || distance(a, targetTile) - distance(b, targetTile));
    for (const tile of neighbours) {
      visited.add(key(tile.x, tile.y));
      if (surroundingClaims >= surroundingLimit) break;
      const chance = Math.max(.18, 1 - TERRAIN_COST[tile.terrain] * .18 - distance(tile, targetTile) * .07);
      if (!rng.chance(chance)) continue;
      if (claim(world, tile, kingdomId, year, rng.int(1, 12), 'военное завоевание', target.id)) {
        claimed += 1;
        surroundingClaims += 1;
        queue.push(tile);
      }
    }
  }
  return claimed;
}

function shortestConnectionPath(world: WorldState, kingdomId: number, target: Tile, previousKingdomId?: number): Tile[] {
  if (target.kingdomId === kingdomId) return [target];
  const sources = world.tiles.filter(tile => tile.kingdomId === kingdomId && tile.terrain !== 'ocean');
  if (!sources.length) return [];
  const targetKey = key(target.x, target.y);
  const frontier: Array<{ tile: Tile; cost: number }> = sources.map(tile => ({ tile, cost: 0 }));
  const best = new Map<string, number>(sources.map(tile => [key(tile.x, tile.y), 0]));
  const previous = new Map<string, string>();
  const sourceKeys = new Set(sources.map(tile => key(tile.x, tile.y)));
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost || a.tile.y - b.tile.y || a.tile.x - b.tile.x);
    const current = frontier.shift()!;
    const currentKey = key(current.tile.x, current.tile.y);
    if (current.cost !== best.get(currentKey)) continue;
    if (currentKey === targetKey) {
      const path: Tile[] = [current.tile];
      let cursor = currentKey;
      while (!sourceKeys.has(cursor)) {
        const parent = previous.get(cursor);
        if (!parent) return [];
        cursor = parent;
        const [x, y] = cursor.split(':').map(Number);
        const tile = tileAt(world, x!, y!);
        if (tile) path.push(tile);
      }
      return path.reverse();
    }
    for (const neighbour of neighboursOf(world, current.tile)) {
      if (neighbour.terrain === 'ocean') continue;
      if (neighbour.kingdomId !== undefined && neighbour.kingdomId !== kingdomId && neighbour.kingdomId !== previousKingdomId) continue;
      const neighbourKey = key(neighbour.x, neighbour.y);
      const nextCost = current.cost + TERRAIN_COST[neighbour.terrain] + (neighbour.kingdomId === previousKingdomId ? .2 : 0);
      if (nextCost >= (best.get(neighbourKey) ?? Number.POSITIVE_INFINITY)) continue;
      best.set(neighbourKey, nextCost);
      previous.set(neighbourKey, currentKey);
      frontier.push({ tile: neighbour, cost: nextCost });
    }
  }
  return [];
}

export function rebuildTerritoryHistoryFromCurrent(world: WorldState): void {
  const currentOwners = new Map(world.tiles.map(tile => [key(tile.x, tile.y), tile.kingdomId]));
  initializeTerritorialHistory(world);
  const rng = new RNG(`${world.config.seed}:восстановление-границ-v2`);
  for (const kingdom of world.kingdoms) {
    const capital = settlementById(world, kingdom.capitalId);
    if (!capital) continue;
    const owned = world.tiles
      .filter(tile => currentOwners.get(key(tile.x, tile.y)) === kingdom.id && tile.terrain !== 'ocean')
      .sort((a, b) => distance(a, capital) - distance(b, capital) || a.y - b.y || a.x - b.x);
    if (!owned.some(tile => tile.x === capital.x && tile.y === capital.y)) {
      const capitalTile = tileAt(world, capital.x, capital.y);
      if (capitalTile) owned.unshift(capitalTile);
    }
    const yearsAvailable = Math.max(1, world.year - kingdom.foundedYear);
    const maximumDistance = Math.max(1, ...owned.map(tile => distance(tile, capital)));
    for (let index = 0; index < owned.length; index += 1) {
      const tile = owned[index]!;
      const distanceShare = distance(tile, capital) / maximumDistance;
      const orderShare = index / Math.max(1, owned.length - 1);
      const year = Math.min(world.year, Math.max(kingdom.foundedYear, Math.round(kingdom.foundedYear + yearsAvailable * (.68 * distanceShare + .32 * orderShare))));
      claim(world, tile, kingdom.id, year, 1 + (index % 12), index === 0 ? 'основание столицы' : tile.settlementId ? 'рост поселения' : 'мирное освоение', tile.settlementId, true);
    }
  }
  // Клетки, которые не были связаны с действующим государством, остаются ничейными.
  ensureFoundedCapitals(world, world.year);
  // Стабильный порядок нужен для детерминизма атласа и сохранений.
  world.territoryHistory.sort((a, b) => a.year - b.year || a.month - b.month || a.id - b.id);
  void rng;
}

export function territoryOwnerAt(world: WorldState, x: number, y: number, year: number): number | undefined {
  let owner: number | undefined;
  for (const change of world.territoryHistory) {
    if (change.x !== x || change.y !== y || change.year > year) continue;
    owner = change.kingdomId;
  }
  return owner;
}

function expandKingdom(world: WorldState, kingdom: Kingdom, rng: RNG, startYear: number, spanYears: number, roadCells: Set<string>): void {
  const capital = settlementById(world, kingdom.capitalId);
  if (!capital) return;
  const controlledSettlements = world.settlements.filter(settlement => tileAt(world, settlement.x, settlement.y)?.kingdomId === kingdom.id);
  const population = controlledSettlements.reduce((sum, settlement) => sum + settlement.population, 0);
  const administrativeRate = Math.max(.08, Math.min(.82,
    .12
      + Math.log10(Math.max(10, population)) * .055
      + kingdom.stability / 620
      + Math.log10(Math.max(10, kingdom.treasury)) * .025
      - Math.max(0, 45 - kingdom.stability) / 260,
  ));
  let expansionPoints = administrativeRate * spanYears * (.82 + rng.next() * .36);
  if (expansionPoints < .72 && !rng.chance(expansionPoints)) return;
  expansionPoints = Math.max(1, expansionPoints);

  const owned = new Set(world.tiles.filter(tile => tile.kingdomId === kingdom.id).map(tile => key(tile.x, tile.y)));
  if (!owned.size) return;
  const maximumClaims = Math.max(1, Math.ceil(expansionPoints));
  let claims = 0;
  let guard = 0;

  while (expansionPoints >= .72 && claims < maximumClaims && guard++ < maximumClaims * 12 + 20) {
    const frontier = frontierTiles(world, owned)
      .filter(tile => tile.kingdomId === undefined)
      .map(tile => ({ tile, score: expansionScore(world, tile, kingdom, capital, owned, roadCells, rng) }))
      .sort((a, b) => a.score - b.score || a.tile.y - b.tile.y || a.tile.x - b.tile.x);
    const choice = frontier[0];
    if (!choice) break;
    const cost = TERRAIN_COST[choice.tile.terrain];
    if (!Number.isFinite(cost)) break;
    if (cost > expansionPoints && claims > 0) break;
    const sequence = claims / Math.max(1, maximumClaims - 1);
    const year = Math.min(world.year, startYear + Math.floor(sequence * Math.max(0, spanYears - 1)));
    const sourceSettlement = nearestControlledSettlement(world, choice.tile, kingdom.id);
    const reason = choice.tile.settlementId ? 'рост поселения' : roadCells.has(key(choice.tile.x, choice.tile.y)) ? 'торговый путь' : 'мирное освоение';
    if (claim(world, choice.tile, kingdom.id, year, 1 + ((choice.tile.x * 5 + choice.tile.y * 7 + kingdom.id) % 12), reason, sourceSettlement?.id)) {
      owned.add(key(choice.tile.x, choice.tile.y));
      expansionPoints -= Math.max(.72, cost);
      claims += 1;
    } else break;
  }
}

function expansionScore(
  world: WorldState,
  tile: Tile,
  kingdom: Kingdom,
  capital: Settlement,
  owned: Set<string>,
  roadCells: Set<string>,
  rng: RNG,
): number {
  const adjacentOwned = neighboursOf(world, tile).filter(neighbour => owned.has(key(neighbour.x, neighbour.y))).length;
  const friendlySettlement = tile.settlementId ? world.settlements.find(settlement => settlement.id === tile.settlementId && settlement.kingdomId === kingdom.id) : undefined;
  const nearbyFriendly = nearestControlledSettlement(world, tile, kingdom.id);
  const logisticsDistance = nearbyFriendly ? distance(tile, nearbyFriendly) : distance(tile, capital);
  const frontierCompetition = neighboursOf(world, tile).filter(neighbour => neighbour.kingdomId !== undefined && neighbour.kingdomId !== kingdom.id).length;
  return TERRAIN_COST[tile.terrain]
    + logisticsDistance * .09
    + distance(tile, capital) * .012
    + frontierCompetition * .65
    - adjacentOwned * .34
    - (roadCells.has(key(tile.x, tile.y)) ? .72 : 0)
    - (friendlySettlement ? 1.2 : 0)
    + rng.next() * .16;
}

function ensureFoundedCapitals(world: WorldState, throughYear: number): void {
  for (const kingdom of world.kingdoms) {
    if (kingdom.foundedYear > throughYear) continue;
    const capital = settlementById(world, kingdom.capitalId);
    const tile = capital ? tileAt(world, capital.x, capital.y) : undefined;
    if (!capital || !tile || tile.terrain === 'ocean') continue;
    const alreadyFounded = world.territoryHistory.some(change => change.kingdomId === kingdom.id && change.reason === 'основание столицы');
    if (!alreadyFounded) claim(world, tile, kingdom.id, kingdom.foundedYear, 1, 'основание столицы', capital.id);
  }
}

function claim(
  world: WorldState,
  tile: Tile,
  kingdomId: number | undefined,
  year: number,
  month: number,
  reason: TerritoryChange['reason'],
  sourceSettlementId?: number,
  allowSameOwner = false,
): boolean {
  const previousKingdomId = tile.kingdomId;
  if (!allowSameOwner && previousKingdomId === kingdomId) return false;
  tile.kingdomId = kingdomId;
  tile.controlledSinceYear = year;
  const change: TerritoryChange = {
    id: world.nextIds.territoryChange++, year, month, x: tile.x, y: tile.y, kingdomId, previousKingdomId,
    sourceSettlementId, reason,
  };
  world.territoryHistory.push(change);
  return true;
}

function frontierTiles(world: WorldState, owned: Set<string>): Tile[] {
  const result = new Map<string, Tile>();
  for (const coordinate of owned) {
    const [x, y] = coordinate.split(':').map(Number);
    const source = tileAt(world, x!, y!);
    if (!source) continue;
    for (const neighbour of neighboursOf(world, source)) {
      if (neighbour.terrain === 'ocean' || owned.has(key(neighbour.x, neighbour.y))) continue;
      result.set(key(neighbour.x, neighbour.y), neighbour);
    }
  }
  return [...result.values()];
}

function neighboursOf(world: WorldState, tile: Tile): Tile[] {
  const result: Tile[] = [];
  for (const [dx, dy] of directions) {
    const neighbour = tileAt(world, tile.x + dx, tile.y + dy);
    if (neighbour) result.push(neighbour);
  }
  return result;
}

function nearestControlledSettlement(world: WorldState, tile: Tile, kingdomId: number): Settlement | undefined {
  let best: Settlement | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const settlement of world.settlements) {
    const settlementTile = tileAt(world, settlement.x, settlement.y);
    if (settlementTile?.kingdomId !== kingdomId) continue;
    const currentDistance = distance(tile, settlement);
    if (currentDistance < bestDistance) {
      bestDistance = currentDistance;
      best = settlement;
    }
  }
  return best;
}

function tradeRoadCells(world: WorldState): Set<string> {
  const result = new Set<string>();
  for (const route of world.tradeRoutes) {
    const from = settlementById(world, route.fromSettlementId);
    const to = settlementById(world, route.toSettlementId);
    if (!from || !to) continue;
    let x = from.x;
    let y = from.y;
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    const sx = from.x < to.x ? 1 : -1;
    const sy = from.y < to.y ? 1 : -1;
    let error = dx - dy;
    for (let guard = 0; guard < world.config.width + world.config.height + 8; guard += 1) {
      result.add(key(x, y));
      if (x === to.x && y === to.y) break;
      const doubled = error * 2;
      if (doubled > -dy) { error -= dy; x += sx; }
      if (doubled < dx) { error += dx; y += sy; }
    }
  }
  return result;
}

function tileAt(world: WorldState, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= world.config.width || y >= world.config.height) return undefined;
  return world.tiles[y * world.config.width + x] ?? world.tiles.find(tile => tile.x === x && tile.y === y);
}

function settlementById(world: WorldState, id: number): Settlement | undefined {
  return world.settlements.find(settlement => settlement.id === id);
}

function key(x: number, y: number): string {
  return `${x}:${y}`;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function territoryIntegrityIssues(world: WorldState): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const kingdomIds = new Set(world.kingdoms.map(kingdom => kingdom.id));
  const historicalKingdomIds = new Set((world.history?.fallenRealms ?? []).map(realm => realm.formerKingdomId).filter((id): id is number => typeof id === 'number'));
  const latest = new Map<string, TerritoryChange>();
  for (const change of world.territoryHistory) {
    const tile = tileAt(world, change.x, change.y);
    if (!tile) { errors.push(`Границы: изменение ${change.id} находится вне карты`); continue; }
    if (tile.terrain === 'ocean' && change.kingdomId !== undefined) errors.push(`Границы: океаническая клетка ${change.x}:${change.y} захвачена государством`);
    if (change.kingdomId !== undefined && !kingdomIds.has(change.kingdomId) && !historicalKingdomIds.has(change.kingdomId)) errors.push(`Границы: изменение ${change.id} ссылается на несуществующее государство ${change.kingdomId}`);
    const coordinate = key(change.x, change.y);
    const previous = latest.get(coordinate);
    if (!previous || change.year > previous.year || change.year === previous.year && (change.month > previous.month || change.month === previous.month && change.id > previous.id)) latest.set(coordinate, change);
  }
  for (const tile of world.tiles) {
    const expected = latest.get(key(tile.x, tile.y))?.kingdomId;
    if (tile.kingdomId !== expected) errors.push(`Границы: текущий владелец клетки ${tile.x}:${tile.y} не совпадает с историей`);
  }
  for (const kingdom of world.kingdoms) {
    const capital = settlementById(world, kingdom.capitalId);
    const foundations = world.territoryHistory.filter(change => change.kingdomId === kingdom.id && change.reason === 'основание столицы');
    if (foundations.length !== 1) errors.push(`${kingdom.name}: должно быть одно территориальное основание, найдено ${foundations.length}`);
    const foundation = foundations[0];
    const foundingSettlement = foundation?.sourceSettlementId ? settlementById(world, foundation.sourceSettlementId) : undefined;
    if (foundation && foundingSettlement && (foundation.x !== foundingSettlement.x || foundation.y !== foundingSettlement.y)) errors.push(`${kingdom.name}: основание не совпадает с исторической столицей`);
    const owned = world.tiles.filter(tile => tile.kingdomId === kingdom.id);
    if (!owned.length) warnings.push(`${kingdom.name}: не контролирует ни одной клетки`);
    else if (capital && capital.kingdomId !== kingdom.id) warnings.push(`${kingdom.name}: не имеет подконтрольного поселения для новой столицы`);
    if (capital && owned.length) {
      const ownedKeys = new Set(owned.map(tile => key(tile.x, tile.y)));
      const start = key(capital.x, capital.y);
      if (ownedKeys.has(start)) {
        const reached = new Set<string>([start]);
        const queue = [tileAt(world, capital.x, capital.y)!];
        while (queue.length) {
          const current = queue.shift()!;
          for (const neighbour of neighboursOf(world, current)) {
            const neighbourKey = key(neighbour.x, neighbour.y);
            if (!ownedKeys.has(neighbourKey) || reached.has(neighbourKey)) continue;
            reached.add(neighbourKey);
            queue.push(neighbour);
          }
        }
        if (reached.size < owned.length) {
          const remaining = new Set(ownedKeys);
          for (const reachedKey of reached) remaining.delete(reachedKey);
          let emptyDetached = 0;
          while (remaining.size) {
            const first = remaining.values().next().value as string;
            const component = new Set<string>([first]);
            const componentQueue = [first];
            remaining.delete(first);
            while (componentQueue.length) {
              const currentKey = componentQueue.shift()!;
              const [x, y] = currentKey.split(':').map(Number);
              const currentTile = tileAt(world, x!, y!);
              if (!currentTile) continue;
              for (const neighbour of neighboursOf(world, currentTile)) {
                const neighbourKey = key(neighbour.x, neighbour.y);
                if (!remaining.delete(neighbourKey)) continue;
                component.add(neighbourKey);
                componentQueue.push(neighbourKey);
              }
            }
            const anchored = world.settlements.some(settlement => component.has(key(settlement.x, settlement.y)) && tileAt(world, settlement.x, settlement.y)?.kingdomId === kingdom.id);
            if (!anchored) emptyDetached += component.size;
          }
          if (emptyDetached) warnings.push(`${kingdom.name}: ${emptyDetached} изолированных клеток не имеют поселения или гарнизона`);
        }
      }
    }
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
