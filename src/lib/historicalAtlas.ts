import type { EntityRef, WorldEvent, WorldState } from '../types';

export type AtlasEventGroup = 'войны' | 'чудовища' | 'власть' | 'знания' | 'поселения' | 'жизни';

export interface AtlasMapState {
  year: number;
  current: boolean;
  tileKingdomIds: Array<number | undefined>;
  settlementOwnerIds: Map<number, number>;
  settlementPopulations: Map<number, number>;
  visibleSettlementIds: Set<number>;
  visibleDungeonIds: Set<number>;
  visibleMonsterIds: Set<number>;
  visibleTradeRouteIds: Set<number>;
  activeWarIds: Set<number>;
}

export interface AtlasStats {
  settlements: number;
  population: number;
  kingdoms: number;
  wars: number;
  monsters: number;
  books: number;
  artifacts: number;
}

export function atlasYearRange(world: WorldState): { min: number; max: number } {
  const years = [
    ...world.kingdoms.map(item => item.foundedYear),
    ...world.settlements.map(item => item.foundedYear),
    ...world.events.map(item => item.year),
    ...world.artifacts.map(item => item.yearCreated),
    ...world.books.map(item => item.yearWritten),
    ...world.dungeons.map(item => item.builtYear),
  ].filter(year => Number.isFinite(year) && year > 0);
  return { min: Math.max(1, Math.min(...years, 1)), max: world.year };
}

export function buildAtlasMapState(world: WorldState, requestedYear: number): AtlasMapState {
  const range = atlasYearRange(world);
  const year = Math.max(range.min, Math.min(range.max, Math.round(requestedYear)));
  const current = year === world.year;
  const settlementOwnerIds = reconstructSettlementOwners(world, year);
  const visibleSettlementIds = new Set<number>();
  const settlementPopulations = new Map<number, number>();

  for (const settlement of world.settlements) {
    if (settlement.foundedYear > year) continue;
    visibleSettlementIds.add(settlement.id);
    settlementPopulations.set(settlement.id, estimatePopulation(world, settlement.id, year));
  }

  const visibleDungeonIds = new Set(world.dungeons.filter(dungeon => dungeon.builtYear <= year).map(dungeon => dungeon.id));
  const visibleMonsterIds = new Set(world.monsters.filter(monster => current ? monster.alive : monsterExistsInYear(world, monster.id, year)).map(monster => monster.id));
  const visibleTradeRouteIds = new Set(world.tradeRoutes.filter(route => visibleSettlementIds.has(route.fromSettlementId) && visibleSettlementIds.has(route.toSettlementId)).map(route => route.id));
  const activeWarIds = new Set(world.wars.filter(war => war.startYear <= year && (war.endYear === undefined || war.endYear >= year)).map(war => war.id));

  const tileKingdomIds = current
    ? world.tiles.map(tile => tile.kingdomId)
    : reconstructTerritories(world, visibleSettlementIds, settlementOwnerIds, year);

  return {
    year,
    current,
    tileKingdomIds,
    settlementOwnerIds,
    settlementPopulations,
    visibleSettlementIds,
    visibleDungeonIds,
    visibleMonsterIds,
    visibleTradeRouteIds,
    activeWarIds,
  };
}

export function atlasStats(world: WorldState, state: AtlasMapState): AtlasStats {
  const kingdoms = new Set<number>();
  for (const settlementId of state.visibleSettlementIds) {
    const owner = state.settlementOwnerIds.get(settlementId);
    if (owner !== undefined) kingdoms.add(owner);
  }
  return {
    settlements: state.visibleSettlementIds.size,
    population: [...state.settlementPopulations.values()].reduce((sum, value) => sum + value, 0),
    kingdoms: kingdoms.size,
    wars: state.activeWarIds.size,
    monsters: state.visibleMonsterIds.size,
    books: world.books.filter(book => book.yearWritten <= state.year).length,
    artifacts: world.artifacts.filter(artifact => artifact.yearCreated <= state.year).length,
  };
}

export function atlasEventGroup(event: WorldEvent): AtlasEventGroup {
  if (event.kind === 'war' || event.kind === 'battle') return 'войны';
  if (event.kind === 'dragon' || event.kind === 'monster' || event.kind === 'hero') return 'чудовища';
  if (event.kind === 'politics' || event.kind === 'dynasty') return 'власть';
  if (event.kind === 'book' || event.kind === 'artifact') return 'знания';
  if (event.kind === 'settlement' || event.kind === 'trade' || event.kind === 'disaster') return 'поселения';
  return 'жизни';
}

export function eventsAtYear(world: WorldState, year: number, enabled: Set<AtlasEventGroup>): WorldEvent[] {
  return world.events
    .filter(event => event.year === year && enabled.has(atlasEventGroup(event)))
    .sort((a, b) => b.month - a.month || b.importance - a.importance || b.id - a.id);
}

export function importantEventsUntil(world: WorldState, year: number, enabled: Set<AtlasEventGroup>, limit = 80): WorldEvent[] {
  return world.events
    .filter(event => event.year <= year && enabled.has(atlasEventGroup(event)))
    .sort((a, b) => b.year - a.year || b.month - a.month || b.importance - a.importance)
    .slice(0, limit);
}

export function primaryRef(event: WorldEvent): EntityRef | undefined {
  return event.entityRefs.find(ref => ref.kind === 'war')
    ?? event.entityRefs.find(ref => ref.kind === 'monster')
    ?? event.entityRefs.find(ref => ref.kind === 'kingdom')
    ?? event.entityRefs[0];
}

export function eraTitle(world: WorldState, year: number): string {
  const activeWars = world.wars.filter(war => war.startYear <= year && (war.endYear === undefined || war.endYear >= year)).length;
  const dragons = world.monsters.filter(monster => monster.species === 'dragon' && monsterExistsInYear(world, monster.id, year)).length;
  const crises = world.events.filter(event => event.year >= year - 4 && event.year <= year && event.importance >= 4).length;
  if (activeWars >= 3) return 'Эпоха множества войн';
  if (dragons >= 4 && crises >= 5) return 'Век драконьей угрозы';
  if (crises >= 8) return 'Годы великих потрясений';
  if (activeWars === 0 && crises <= 2) return 'Спокойная эпоха';
  return 'Живая эпоха перемен';
}

function reconstructSettlementOwners(world: WorldState, year: number): Map<number, number> {
  const owners = new Map(world.settlements.map(settlement => [settlement.id, settlement.kingdomId]));
  const warsDescending = [...world.wars].sort((a, b) => (b.endYear ?? world.year + 1) - (a.endYear ?? world.year + 1) || b.startYear - a.startYear);
  for (const war of warsDescending) {
    const resolvedYear = war.endYear ?? world.year + 1;
    if (resolvedYear <= year) continue;
    if (war.victorId !== war.attackerId) continue;
    for (const settlementId of war.contestedSettlementIds) owners.set(settlementId, war.defenderId);
  }
  return owners;
}

function reconstructTerritories(world: WorldState, visibleSettlementIds: Set<number>, owners: Map<number, number>, year: number): Array<number | undefined> {
  const settlements = world.settlements.filter(settlement => visibleSettlementIds.has(settlement.id));
  const foundedKingdoms = new Set(world.kingdoms.filter(kingdom => kingdom.foundedYear <= year).map(kingdom => kingdom.id));
  return world.tiles.map(tile => {
    if (tile.terrain === 'ocean') return undefined;
    let bestOwner: number | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const settlement of settlements) {
      const owner = owners.get(settlement.id);
      if (owner === undefined || !foundedKingdoms.has(owner)) continue;
      const dx = tile.x - settlement.x;
      const dy = tile.y - settlement.y;
      const terrainPenalty = tile.terrain === 'mountains' ? 1.18 : tile.terrain === 'marsh' ? 1.1 : 1;
      const distance = (dx * dx + dy * dy) * terrainPenalty;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestOwner = owner;
      }
    }
    return bestOwner;
  });
}

function estimatePopulation(world: WorldState, settlementId: number, year: number): number {
  const settlement = world.settlements.find(item => item.id === settlementId);
  if (!settlement) return 0;
  const totalAge = Math.max(1, world.year - settlement.foundedYear + 1);
  const ageAtYear = Math.max(1, year - settlement.foundedYear + 1);
  const maturity = Math.max(.08, Math.min(1, Math.pow(ageAtYear / totalAge, .66)));
  const laterDeaths = world.events.filter(event => event.year > year && event.entityRefs.some(ref => ref.kind === 'settlement' && ref.id === settlementId) && ['dragon', 'monster', 'battle', 'disaster'].includes(event.kind)).length;
  const shockCorrection = Math.min(.35, laterDeaths * .018);
  return Math.max(3, Math.round(settlement.population * Math.min(1.25, maturity + shockCorrection)));
}

function monsterExistsInYear(world: WorldState, monsterId: number, year: number): boolean {
  const monster = world.monsters.find(item => item.id === monsterId);
  if (!monster) return false;
  const birthYear = Math.max(1, world.year - monster.age);
  if (year < birthYear) return false;
  const deathYear = monsterDeathYear(world, monsterId);
  return deathYear === undefined || year <= deathYear;
}

function monsterDeathYear(world: WorldState, monsterId: number): number | undefined {
  if (world.monsters.find(item => item.id === monsterId)?.alive) return undefined;
  const event = world.events
    .filter(item => item.entityRefs.some(ref => ref.kind === 'monster' && ref.id === monsterId))
    .find(item => /убит|повержен|погиб|уничтожен/i.test(`${item.title} ${item.description}`));
  return event?.year ?? world.year;
}
