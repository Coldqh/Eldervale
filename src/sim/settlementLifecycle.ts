import type {
  Building, Character, EmploymentContract, Establishment, Household, Settlement, SettlementEconomy, Tile, TradeRoute, WorldState,
} from '../types';
import type { SettlementExpedition, SettlementExpeditionCause } from '../settlementLifecycleTypes';
import type { WorldIndexes } from './indexes';
import { refreshDynamicWorldIndexes } from './indexes';
import { appendCausalEvent } from './causality';
import { initializeAgricultureAndConstruction } from './agricultureConstruction';
import { initializeCitySimulation } from './citySimulation';
import { buildSettlementLayout } from './cityMorphology';
import { initializeCivilizationSystem } from './civilizationSystem';
import { initializeCultureSystem } from './cultureSystem';
import { addMaterialItem } from './materialEconomy';
import { placeName } from './names';
import { hashSeed, RNG } from './rng';
import { worldTick } from './scheduler';
import { initializeSettlementLife } from './settlementLife';
import { assignBuildingFootprintAcrossSettlement, buildingDimensions } from './spatial';
import { establishSettlementTerritory } from './territory';

const ACTIVE_STATUSES = new Set<SettlementExpedition['status']>(['forming', 'traveling', 'camped', 'returning']);
const LAND_TERRAINS = new Set<Tile['terrain']>(['coast', 'plains', 'forest', 'hills', 'marsh', 'desert', 'tundra']);
const RESOURCE_BY_TERRAIN: Record<Tile['terrain'], string[]> = {
  ocean: ['рыба'], coast: ['рыба', 'соль'], plains: ['зерно', 'лён'], forest: ['древесина', 'мёд'],
  hills: ['камень', 'железо'], mountains: ['камень', 'железо'], marsh: ['торф', 'тростник'], desert: ['соль', 'пряности'], tundra: ['меха', 'рыба'],
};

export interface SettlementLifecycleAdvanceOptions {
  allowFormation?: boolean;
  elapsedMonths?: number;
}

export interface FormSettlementExpeditionOptions {
  cause?: SettlementExpeditionCause;
  destination?: { x: number; y: number };
  householdIds?: readonly number[];
  force?: boolean;
}

export interface SettlementLifecycleResult {
  formed: number;
  founded: number;
  failed: number;
  returned: number;
  changed: boolean;
}

export function initializeSettlementLifecycle(world: WorldState): void {
  world.settlementExpeditions ??= [];
  world.nextIds ??= {};
  world.nextIds.settlement ??= Math.max(0, ...world.settlements.map(item => item.id)) + 1;
  world.nextIds.settlementExpedition ??= Math.max(0, ...world.settlementExpeditions.map(item => item.id)) + 1;
  world.nextIds.tradeRoute ??= Math.max(0, ...world.tradeRoutes.map(item => item.id)) + 1;
  world.nextIds.building ??= Math.max(0, ...world.buildings.map(item => item.id)) + 1;
  world.nextIds.establishment ??= Math.max(0, ...world.establishments.map(item => item.id)) + 1;
  world.nextIds.employment ??= Math.max(0, ...world.employments.map(item => item.id)) + 1;
  for (const settlement of world.settlements) settlement.politicalStatus ??= settlement.foundingExpeditionId ? 'frontier' : 'integrated';
  for (const character of world.characters) {
    if (character.expeditionId && !world.settlementExpeditions.some(item => item.id === character.expeditionId && ACTIVE_STATUSES.has(item.status))) character.expeditionId = undefined;
  }
  world.simulation.settlementLifecycleVersion = 1;
}

export function activeExpeditionForCharacter(world: WorldState, characterId: number): SettlementExpedition | undefined {
  return (world.settlementExpeditions ?? []).find(item => ACTIVE_STATUSES.has(item.status) && item.memberIds.includes(characterId));
}

export function advanceSettlementLifecycle(
  world: WorldState,
  rng: RNG,
  indexes?: WorldIndexes,
  options: SettlementLifecycleAdvanceOptions = {},
): SettlementLifecycleResult {
  if (world.simulation.settlementLifecycleVersion !== 1) initializeSettlementLifecycle(world);
  const result: SettlementLifecycleResult = { formed: 0, founded: 0, failed: 0, returned: 0, changed: false };
  const elapsedMonths = Math.max(1, Math.floor(options.elapsedMonths ?? 1));

  if (options.allowFormation) {
    markAbandonedSettlements(world, rng);
    const activeCount = world.settlementExpeditions.filter(item => ACTIVE_STATUSES.has(item.status)).length;
    const capacity = Math.max(1, Math.ceil(world.kingdoms.length / 2));
    const origins = candidateOrigins(world)
      .sort((a, b) => foundingPressure(world, b).score - foundingPressure(world, a).score || b.population - a.population || a.id - b.id);
    for (const origin of origins) {
      if (activeCount + result.formed >= capacity) break;
      const pressure = foundingPressure(world, origin);
      const chance = pressure.score >= 90 ? 1 : Math.min(.82, .08 + pressure.score / 180);
      if (pressure.score < 28 || !rng.chance(chance)) continue;
      const expedition = formSettlementExpedition(world, origin, new RNG(`${world.config.seed}:экспедиция:${world.year}:${origin.id}`), { cause: pressure.cause });
      if (expedition) { result.formed += 1; result.changed = true; }
    }
  }

  for (const expedition of world.settlementExpeditions.filter(item => ACTIVE_STATUSES.has(item.status)).sort((a, b) => a.id - b.id)) {
    const before = expedition.status;
    advanceExpedition(world, expedition, new RNG(`${world.config.seed}:экспедиция-ход:${expedition.id}:${world.year}:${world.month}`), elapsedMonths);
    if (before !== expedition.status || expedition.status === 'traveling' || expedition.status === 'camped' || expedition.status === 'returning') result.changed = true;
    if (before !== 'founded' && expedition.status === 'founded') result.founded += 1;
    if (before !== 'failed' && expedition.status === 'failed') result.failed += 1;
    if (before !== 'returned' && expedition.status === 'returned') result.returned += 1;
  }

  if (result.changed && indexes) refreshDynamicWorldIndexes(indexes, world);
  return result;
}

export function formSettlementExpedition(
  world: WorldState,
  origin: Settlement,
  rng: RNG,
  options: FormSettlementExpeditionOptions = {},
): SettlementExpedition | undefined {
  initializeSettlementLifecycle(world);
  if (!options.force && world.settlementExpeditions.some(item => item.originSettlementId === origin.id && ACTIVE_STATUSES.has(item.status))) return undefined;
  const cause = options.cause ?? foundingPressure(world, origin).cause;
  const destination = options.destination ?? chooseSettlementDestination(world, origin, rng);
  if (!destination) return undefined;
  const route = findSettlementRoute(world, origin, destination);
  if (route.length < 2) return undefined;

  const chosenHouseholds = selectExpeditionHouseholds(world, origin, rng, options.householdIds);
  const members = chosenHouseholds
    .flatMap(household => household.memberIds)
    .map(id => world.characters.find(character => character.id === id))
    .filter((character): character is Character => Boolean(character?.alive && !character.expeditionId));
  const adultCount = members.filter(member => member.age >= 16).length;
  if (members.length < 6 || adultCount < 3) return undefined;

  const leader = [...members]
    .filter(member => member.age >= 18)
    .sort((a, b) => leadershipScore(b) - leadershipScore(a) || a.id - b.id)[0];
  if (!leader) return undefined;
  const id = world.nextIds.settlementExpedition++;
  const civilization = world.civilizations.find(item => item.id === origin.civilizationId);
  const foodDays = members.length * rng.int(75, 125);
  const expedition: SettlementExpedition = {
    id,
    originSettlementId: origin.id,
    sponsorKingdomId: origin.kingdomId,
    civilizationId: origin.civilizationId,
    cultureId: world.settlementCultures.find(item => item.settlementId === origin.id)?.dominantCultureId,
    leaderCharacterId: leader.id,
    memberIds: members.map(member => member.id),
    householdIds: chosenHouseholds.map(household => household.id),
    status: 'traveling',
    cause,
    reason: expeditionReason(cause, origin),
    formedTick: worldTick(world),
    departedTick: worldTick(world),
    currentX: origin.x,
    currentY: origin.y,
    destinationX: destination.x,
    destinationY: destination.y,
    route,
    routeIndex: 0,
    campProgress: 0,
    morale: Math.max(35, Math.min(92, 58 + Math.round(origin.prosperity / 4) - Math.round(origin.unrest / 5))),
    supplies: {
      foodPersonDays: foodDays,
      timber: Math.max(20, chosenHouseholds.length * 8),
      tools: Math.max(4, adultCount),
      seedGrain: Math.max(8, Math.ceil(members.length / 2)),
      livestock: Math.max(2, Math.min(12, Math.round(members.length / 4))),
      coin: Math.max(30, Math.round(members.reduce((sum, member) => sum + member.wallet, 0) * .45)),
    },
    knownTechnologyIds: [...new Set(civilization?.unlockedTechnologyIds ?? [])],
    history: [`В ${world.year}.${String(world.month).padStart(2, '0')} ${members.length} жителей вышли из ${origin.name}: ${expeditionReason(cause, origin)}.`],
  };

  detachExpeditionFromOrigin(world, origin, expedition, chosenHouseholds, members);
  world.settlementExpeditions.push(expedition);
  addCampTrace(world, expedition, 2);
  appendCausalEvent(world, {
    kind: 'migration',
    title: `Из ${origin.name} вышли основатели нового поселения`,
    description: `${members.length} жителей под руководством ${leader.name} отправились к клетке ${destination.x}:${destination.y}.`,
    cause: expedition.reason,
    conditions: [`собрано ${chosenHouseholds.length} домохозяйств`, `запас еды рассчитан на ${Math.floor(foodDays / members.length)} дней на человека`, `разведан сухопутный маршрут длиной ${route.length - 1} клеток`],
    decision: `покинуть ${origin.name} и попытаться основать постоянную общину`,
    outcome: 'переселенцы покинули дома, работу и местный рынок; экспедиция существует как отдельная физическая группа',
    consequences: ['население исходного города уменьшилось', 'по дороге возможны голод, нападения и возвращение', 'при успехе появится новое поселение'],
    entityRefs: [{ kind: 'settlement', id: origin.id }, { kind: 'character', id: leader.id }],
    importance: 3,
  });
  return expedition;
}

export function chooseSettlementDestination(world: WorldState, origin: Settlement, rng: RNG): { x: number; y: number } | undefined {
  const candidates = world.tiles
    .filter(tile => LAND_TERRAINS.has(tile.terrain) && !tile.settlementId && !tile.dungeonId && !tile.monsterId && (tile.kingdomId === undefined || tile.kingdomId === origin.kingdomId))
    .filter(tile => {
      const distance = Math.hypot(tile.x - origin.x, tile.y - origin.y);
      return distance >= 3 && distance <= 12;
    })
    .filter(tile => world.settlements.every(settlement => Math.hypot(tile.x - settlement.x, tile.y - settlement.y) >= 2.8));
  if (!candidates.length) return undefined;
  const ranked = [...candidates]
    .map(tile => ({ tile, score: settlementSiteScore(world, origin, tile) + rng.int(-12, 12) }))
    .sort((a, b) => b.score - a.score || a.tile.y - b.tile.y || a.tile.x - b.tile.x);
  // Хорошая клетка на другом острове не является реальной целью. Проверяем
  // достижимость до формирования группы, чтобы семьи не исчезали из города зря.
  for (const candidate of ranked.slice(0, 64)) {
    if (findSettlementRoute(world, origin, candidate.tile).length >= 2) return candidate.tile;
  }
  return undefined;
}

export function settlementSiteScore(world: WorldState, origin: Settlement, tile: Tile): number {
  const terrain = tile.terrain;
  const arable = terrain === 'plains' ? 30 : terrain === 'forest' ? 18 : terrain === 'coast' ? 16 : terrain === 'hills' ? 10 : terrain === 'marsh' ? 7 : 2;
  const water = Math.round(tile.moisture * 24) + (terrain === 'coast' || terrain === 'marsh' ? 16 : 0);
  const resources = RESOURCE_BY_TERRAIN[terrain].length * 7 + (terrain === 'hills' || terrain === 'forest' ? 8 : 0);
  const friendlyControl = tile.kingdomId === origin.kingdomId ? 14 : tile.kingdomId === undefined ? 5 : -24;
  const nearestMarket = Math.min(...world.settlements.map(item => Math.hypot(item.x - tile.x, item.y - tile.y)));
  const marketAccess = Math.max(-12, 18 - nearestMarket * 2.4);
  const monsterRisk = world.monsters.filter(monster => monster.alive).reduce((risk, monster) => {
    const distance = Math.hypot(monster.x - tile.x, monster.y - tile.y);
    if (distance > monster.territoryRadius + 3) return risk;
    return risk + Math.max(0, monster.power / 7 - distance * 2);
  }, 0);
  const climatePenalty = terrain === 'desert' ? 22 : terrain === 'tundra' ? 16 : terrain === 'marsh' ? 10 : 0;
  const elevationPenalty = tile.elevation > .82 ? 20 : 0;
  return arable + water + resources + friendlyControl + marketAccess - monsterRisk - climatePenalty - elevationPenalty;
}

export function findSettlementRoute(world: WorldState, start: { x: number; y: number }, destination: { x: number; y: number }): { x: number; y: number }[] {
  const startKey = `${start.x}:${start.y}`;
  const destinationKey = `${destination.x}:${destination.y}`;
  const tileByKey = new Map(world.tiles.map(tile => [`${tile.x}:${tile.y}`, tile]));
  const open = new Set([startKey]);
  const cameFrom = new Map<string, string>();
  const cost = new Map<string, number>([[startKey, 0]]);
  const heuristic = (x: number, y: number) => Math.abs(destination.x - x) + Math.abs(destination.y - y);

  while (open.size) {
    const currentKey = [...open].sort((a, b) => {
      const [ax, ay] = a.split(':').map(Number); const [bx, by] = b.split(':').map(Number);
      return (cost.get(a)! + heuristic(ax!, ay!)) - (cost.get(b)! + heuristic(bx!, by!)) || a.localeCompare(b);
    })[0]!;
    if (currentKey === destinationKey) break;
    open.delete(currentKey);
    const [x, y] = currentKey.split(':').map(Number);
    for (const [nx, ny] of [[x! + 1, y!], [x! - 1, y!], [x!, y! + 1], [x!, y! - 1]]) {
      const nextKey = `${nx}:${ny}`;
      const tile = tileByKey.get(nextKey);
      if (!tile || tile.terrain === 'ocean') continue;
      const stepCost = tile.terrain === 'mountains' ? 5 : tile.terrain === 'marsh' ? 2.3 : tile.terrain === 'forest' || tile.terrain === 'hills' ? 1.5 : 1;
      const nextCost = cost.get(currentKey)! + stepCost;
      if (nextCost >= (cost.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      cameFrom.set(nextKey, currentKey);
      cost.set(nextKey, nextCost);
      open.add(nextKey);
    }
  }
  if (!cameFrom.has(destinationKey) && startKey !== destinationKey) return [];
  const result = [destinationKey];
  while (result[0] !== startKey) {
    const previous = cameFrom.get(result[0]!);
    if (!previous) return [];
    result.unshift(previous);
  }
  return result.map(key => { const [x, y] = key.split(':').map(Number); return { x: x!, y: y! }; });
}

function advanceExpedition(world: WorldState, expedition: SettlementExpedition, rng: RNG, elapsedMonths: number): void {
  if (expedition.status === 'forming') expedition.status = 'traveling';
  for (let month = 0; month < elapsedMonths && ACTIVE_STATUSES.has(expedition.status); month += 1) {
    consumeExpeditionSupplies(world, expedition, rng);
    if (!ACTIVE_STATUSES.has(expedition.status)) break;
    if (expedition.status === 'traveling' || expedition.status === 'returning') advanceTravel(world, expedition, rng);
    else if (expedition.status === 'camped') advanceCamp(world, expedition, rng);
  }
}

function consumeExpeditionSupplies(world: WorldState, expedition: SettlementExpedition, rng: RNG): void {
  const members = livingExpeditionMembers(world, expedition);
  if (!members.length) { failExpedition(world, expedition, 'все участники погибли или исчезли'); return; }
  expedition.supplies.foodPersonDays -= members.length * 30;
  const currentTile = tileAt(world, expedition.currentX, expedition.currentY);
  const danger = expeditionDanger(world, expedition.currentX, expedition.currentY);
  if (expedition.supplies.foodPersonDays < 0) {
    expedition.morale = Math.max(0, expedition.morale - 16);
    for (const member of members) { member.needs.hunger = Math.min(100, member.needs.hunger + 24); member.health = Math.max(8, member.health - rng.int(1, 5)); }
    expedition.history.push(`В ${world.year}.${String(world.month).padStart(2, '0')} закончилась еда; здоровье и мораль переселенцев ухудшились.`);
  } else {
    const foraging = Math.max(0, Math.round((currentTile?.moisture ?? .3) * members.length * (currentTile?.terrain === 'forest' || currentTile?.terrain === 'coast' ? .8 : .25)));
    expedition.supplies.foodPersonDays += foraging;
  }
  if (danger > 18 && rng.chance(Math.min(.48, danger / 150))) {
    expedition.morale = Math.max(0, expedition.morale - rng.int(4, 12));
    const victim = rng.pick(members);
    victim.health = Math.max(6, victim.health - rng.int(4, 16));
    victim.biography.push(`В ${world.year} году пострадал во время пути экспедиции №${expedition.id}.`);
    expedition.history.push(`Группа столкнулась с опасностью у клетки ${expedition.currentX}:${expedition.currentY}; ${victim.name} пострадал.`);
  }
  if (expedition.morale <= 12 || livingExpeditionMembers(world, expedition).length < 5) beginReturn(world, expedition, 'группа потеряла способность продолжать основание поселения');
}

function advanceTravel(world: WorldState, expedition: SettlementExpedition, rng: RNG): void {
  const members = livingExpeditionMembers(world, expedition);
  const adults = members.filter(member => member.age >= 16);
  const skill = adults.length ? adults.reduce((sum, member) => sum + (member.skills.hunter ?? 0) + (member.skills.farmer ?? 0), 0) / adults.length : 0;
  const steps = Math.max(1, Math.min(3, 1 + Math.floor((expedition.morale + skill) / 85)));
  expedition.routeIndex = Math.min(expedition.route.length - 1, expedition.routeIndex + steps);
  const point = expedition.route[expedition.routeIndex]!;
  expedition.currentX = point.x;
  expedition.currentY = point.y;
  addCampTrace(world, expedition, 2);
  if (expedition.routeIndex < expedition.route.length - 1) return;
  if (expedition.status === 'returning') { restoreReturnedExpedition(world, expedition); return; }
  const tile = tileAt(world, expedition.destinationX, expedition.destinationY);
  if (!tile || tile.terrain === 'ocean' || tile.settlementId) {
    beginReturn(world, expedition, 'выбранное место оказалось недоступно или занято');
    return;
  }
  expedition.status = 'camped';
  expedition.arrivedTick = worldTick(world);
  expedition.campProgress = Math.max(0, expedition.campProgress);
  expedition.history.push(`В ${world.year}.${String(world.month).padStart(2, '0')} экспедиция разбила постоянный лагерь в клетке ${tile.x}:${tile.y}.`);
  expedition.morale = Math.min(100, expedition.morale + rng.int(3, 9));
}

function advanceCamp(world: WorldState, expedition: SettlementExpedition, rng: RNG): void {
  const members = livingExpeditionMembers(world, expedition);
  const adults = members.filter(member => member.age >= 16);
  const craft = adults.reduce((sum, member) => sum + Math.max(member.skills.carpenter ?? 0, member.skills.farmer ?? 0, member.skills.blacksmith ?? 0), 0);
  const monthlyWork = adults.length * 5 + craft * .18 + expedition.supplies.tools * .8 + rng.int(0, 12);
  expedition.campProgress += monthlyWork;
  expedition.supplies.timber = Math.max(0, expedition.supplies.timber - Math.max(1, Math.round(adults.length / 5)));
  expedition.morale = Math.max(0, Math.min(100, expedition.morale + (expedition.supplies.foodPersonDays > members.length * 45 ? 2 : -4)));
  const target = 70 + members.length * 7 + expedition.householdIds.length * 12;
  addCampTrace(world, expedition, 3);
  if (expedition.campProgress >= target && expedition.supplies.seedGrain >= 4 && expedition.supplies.tools >= 3) {
    foundSettlement(world, expedition, rng);
    return;
  }
  const monthsCamped = Math.max(0, worldTick(world) - (expedition.arrivedTick ?? worldTick(world)));
  if (monthsCamped >= 10 && expedition.campProgress < target * .55) beginReturn(world, expedition, 'лагерь не смог построить жильё и подготовить хозяйство до следующего сезона');
}

function foundSettlement(world: WorldState, expedition: SettlementExpedition, rng: RNG): Settlement | undefined {
  const tile = tileAt(world, expedition.destinationX, expedition.destinationY);
  if (!tile || tile.terrain === 'ocean' || tile.settlementId || tile.dungeonId || tile.monsterId) { beginReturn(world, expedition, 'земля была занята до завершения лагеря'); return undefined; }
  const members = livingExpeditionMembers(world, expedition);
  const households = expedition.householdIds.map(id => world.households.find(item => item.id === id)).filter((item): item is Household => Boolean(item));
  if (members.length < 5 || !households.length) { beginReturn(world, expedition, 'не осталось достаточного числа семей для постоянной общины'); return undefined; }

  const id = world.nextIds.settlement++;
  const name = uniqueSettlementName(world, new RNG(`${world.config.seed}:имя-нового-поселения:${expedition.id}`));
  const resource = rng.pick(RESOURCE_BY_TERRAIN[tile.terrain]);
  const settlement: Settlement = {
    id,
    name,
    x: tile.x,
    y: tile.y,
    kingdomId: expedition.sponsorKingdomId,
    population: members.length,
    prosperity: Math.max(18, Math.min(56, 28 + Math.round(expedition.morale / 5))),
    defense: Math.max(8, Math.round(members.filter(member => ['guard', 'soldier', 'hunter'].includes(member.profession)).length * 3 + expedition.morale / 5)),
    food: Math.max(18, Math.min(100, Math.round(expedition.supplies.foodPersonDays / Math.max(1, members.length)))),
    foundedYear: world.year,
    type: 'hamlet',
    buildings: [],
    buildingCounts: {},
    households: households.length,
    residentialCapacity: Math.max(members.length, households.length * 6),
    districts: [{ x: tile.x, y: tile.y, name: 'Лагерь основателей', role: tile.terrain === 'coast' ? 'порт' : 'центр' }],
    notableCharacterIds: members.sort((a, b) => b.renown - a.renown || a.id - b.id).slice(0, 6).map(member => member.id),
    damaged: 0,
    resource,
    stockpile: { [resource]: 8, зерно: expedition.supplies.seedGrain, древесина: expedition.supplies.timber, камень: tile.terrain === 'hills' ? 18 : 6 },
    livestock: { куры: expedition.supplies.livestock * 2, козы: expedition.supplies.livestock, лошади: Math.max(0, Math.floor(expedition.supplies.livestock / 3)) },
    shortages: expedition.supplies.foodPersonDays < members.length * 60 ? ['пища'] : [],
    tradeRouteIds: [],
    unrest: Math.max(0, 35 - Math.round(expedition.morale / 3)),
    history: [`Основано в ${world.year}.${String(world.month).padStart(2, '0')} экспедицией из ${world.settlements.find(item => item.id === expedition.originSettlementId)?.name ?? 'старой общины'}.`],
    buildingIds: [],
    householdIds: households.map(household => household.id),
    establishmentIds: [],
    economy: defaultEconomy(members.length, expedition.supplies.coin),
    civilizationId: expedition.civilizationId,
    politicalStatus: 'frontier',
    foundingExpeditionId: expedition.id,
    claimantKingdomId: expedition.sponsorKingdomId,
  };
  settlement.layout = buildSettlementLayout(world, settlement);
  if (tile.kingdomId !== undefined && tile.kingdomId !== settlement.kingdomId) {
    beginReturn(world, expedition, 'земля оказалась под властью другого государства');
    return undefined;
  }
  world.settlements.push(settlement);
  tile.settlementId = settlement.id;
  tile.settlementDistrict = settlement.districts[0]!.name;
  if (!establishSettlementTerritory(world, settlement, settlement.kingdomId, world.year, world.month)) {
    world.settlements.pop();
    tile.settlementId = undefined;
    tile.settlementDistrict = undefined;
    beginReturn(world, expedition, 'власть не смогла закрепить права на выбранную землю');
    return undefined;
  }

  // Сначала переселяем людей и домохозяйства в новый источник истины. Все
  // последующие системы должны видеть реальных жителей, а не пустую клетку.
  for (const member of members) {
    member.settlementId = settlement.id;
    member.kingdomId = settlement.kingdomId;
    member.homeDistrict = settlement.districts[0]!.name;
  }
  for (const household of households) {
    household.settlementId = settlement.id;
    for (const itemId of household.inventoryItemIds) {
      const item = world.items.find(candidate => candidate.id === itemId);
      if (item) item.settlementId = settlement.id;
    }
  }

  createFounderBuildings(world, settlement, expedition, households, members, rng);
  createFounderEmployment(world, settlement, expedition, members);
  initializeAgricultureAndConstruction(world, new RNG(`${world.config.seed}:поля-нового-поселения:${id}`));
  linkFounderRoute(world, settlement, expedition.originSettlementId, rng);

  expedition.status = 'founded';
  expedition.foundedSettlementId = settlement.id;
  expedition.resolvedTick = worldTick(world);
  expedition.currentX = settlement.x;
  expedition.currentY = settlement.y;
  expedition.history.push(`В ${world.year}.${String(world.month).padStart(2, '0')} лагерь признан постоянным поселением ${settlement.name}.`);
  for (const member of members) member.biography.push(`В ${world.year} году стал одним из основателей поселения ${settlement.name}.`);
  clearExpeditionMembership(world, expedition);
  for (const household of households) household.history.push(`Домохозяйство основало ${settlement.name} в ${world.year} году.`);

  initializeSettlementLife(world, new RNG(`${world.config.seed}:власть-нового-поселения:${id}`));
  initializeCultureSystem(world, new RNG(`${world.config.seed}:культура-нового-поселения:${id}`));
  initializeCivilizationSystem(world, new RNG(`${world.config.seed}:цивилизация-нового-поселения:${id}`));
  initializeCitySimulation(world);
  appendCausalEvent(world, {
    kind: 'settlement',
    title: `Основано поселение ${settlement.name}`,
    description: `${members.length} переселенцев превратили лагерь в постоянную общину с домами, складом, полем и местной властью.`,
    cause: expedition.reason,
    conditions: [`экспедиция добралась до клетки ${settlement.x}:${settlement.y}`, `лагерь накопил ${Math.round(expedition.campProgress)} единиц строительной работы`, `сохранились ${households.length} семей и семенной запас`],
    decision: 'остаться на выбранной земле и признать лагерь постоянным поселением',
    outcome: `${settlement.name} добавлен в мировой список поселений и включён во все действующие системы`,
    consequences: ['на глобальной карте занята новая клетка', 'семьи получили физические дома', 'появились поля, местное управление и дорога к исходному городу'],
    entityRefs: [{ kind: 'settlement', id: settlement.id }, { kind: 'settlement', id: expedition.originSettlementId }, { kind: 'character', id: expedition.leaderCharacterId }],
    importance: 4,
  });
  return settlement;
}

function createFounderBuildings(
  world: WorldState,
  settlement: Settlement,
  expedition: SettlementExpedition,
  households: Household[],
  members: Character[],
  rng: RNG,
): void {
  const homeByHousehold = new Map<number, Building>();
  for (const [index, household] of households.entries()) {
    const memberIds = household.memberIds.filter(id => members.some(member => member.id === id));
    const building = createFounderBuilding(world, settlement, 'house', `Дом семьи ${world.characters.find(item => item.id === household.headCharacterId)?.name ?? household.id}`, index, Math.max(4, memberIds.length + 1), rng);
    building.householdId = household.id;
    building.residentIds = memberIds;
    household.homeBuildingId = building.id;
    homeByHousehold.set(household.id, building);
    for (const memberId of memberIds) {
      const member = world.characters.find(item => item.id === memberId);
      if (!member) continue;
      member.homeBuildingId = building.id;
      member.homeless = false;
      member.housingStatus = 'secure';
    }
  }
  const warehouse = createFounderBuilding(world, settlement, 'warehouse', `Общий склад ${settlement.name}`, households.length, 90, rng);
  const farm = createFounderBuilding(world, settlement, 'farm', `Общинное поле ${settlement.name}`, households.length + 1, Math.max(18, members.length), rng);
  createFounderBuilding(world, settlement, 'public', `Колодец и общий двор ${settlement.name}`, households.length + 2, Math.max(12, members.length), rng);
  settlement.buildingCounts = { 'жилой дом': households.length, 'зерновой сарай': 1, 'ферма': 1, 'колодец и общий двор': 1 };
  settlement.buildings = Object.entries(settlement.buildingCounts).map(([name, count]) => `${count} × ${name}`);
  settlement.residentialCapacity = households.reduce((sum, household) => sum + (homeByHousehold.get(household.id)?.capacity ?? 0), 0);
  addMaterialItem(world, 'grain', Math.max(4, expedition.supplies.seedGrain), settlement.id, { buildingId: warehouse.id }, 'семенной и продовольственный запас основателей', 58);
  addMaterialItem(world, 'timber', Math.max(4, expedition.supplies.timber), settlement.id, { buildingId: warehouse.id }, 'оставшаяся древесина экспедиции', 55);
  addMaterialItem(world, 'tools', Math.max(2, expedition.supplies.tools), settlement.id, { buildingId: warehouse.id }, 'общие инструменты основателей', 62);
  void farm;
}

function createFounderBuilding(world: WorldState, settlement: Settlement, type: Building['type'], name: string, index: number, capacity: number, rng: RNG): Building {
  const dimensions = buildingDimensions(type, 1);
  const size = world.config.localMapSize ?? 128;
  const building: Building = {
    id: world.nextIds.building++, settlementId: settlement.id, districtName: settlement.districts[0]!.name,
    globalX: settlement.x, globalY: settlement.y, localX: 5 + (index * 9) % Math.max(8, size - dimensions.width - 10), localY: 8 + Math.floor(index / 8) * 9,
    localWidth: dimensions.width, localHeight: dimensions.height, entranceX: 0, entranceY: 0,
    name, type, floors: 1, capacity, condition: rng.int(48, 72), builtYear: world.year,
    residentIds: [], workerIds: [], inventoryItemIds: [], rooms: founderRooms(type), hasWater: type === 'public' || type === 'house', hasHearth: type !== 'warehouse',
    history: [`Построено основателями ${settlement.name} в ${world.year} году.`], spatialVersion: 2,
  };
  if (!assignBuildingFootprintAcrossSettlement(world, building)) throw new Error(`${settlement.name}: основатели не смогли разместить ${name}`);
  world.buildings.push(building);
  settlement.buildingIds.push(building.id);
  return building;
}

function createFounderEmployment(world: WorldState, settlement: Settlement, expedition: SettlementExpedition, members: Character[]): void {
  const farm = world.buildings.find(item => item.settlementId === settlement.id && item.type === 'farm');
  if (!farm) return;
  const adults = members.filter(member => member.age >= 14).sort((a, b) => (b.skills.farmer ?? 0) - (a.skills.farmer ?? 0) || a.id - b.id);
  const owner = adults[0] ?? members[0];
  if (!owner) return;
  const workers = adults.slice(0, Math.max(2, Math.min(8, Math.ceil(members.length / 4))));
  const establishment: Establishment = {
    id: world.nextIds.establishment++, settlementId: settlement.id, buildingId: farm.id, name: `Общинная ферма «${settlement.name}»`, type: 'ферма',
    ownerCharacterId: owner.id, workerIds: workers.map(worker => worker.id), supplierEstablishmentIds: [], customerHouseholdIds: [...settlement.householdIds], inventoryItemIds: [], recipeIds: [],
    openHour: 6, closeHour: 18, reputation: 45, cash: Math.max(10, Math.round(expedition.supplies.coin * .25)), debt: 0, monthlyRevenue: 0, monthlyExpenses: 0, active: true, menu: {},
    history: [`Создана основателями ${settlement.name} в ${world.year} году.`],
  };
  world.establishments.push(establishment);
  settlement.establishmentIds.push(establishment.id);
  farm.establishmentId = establishment.id;
  farm.ownerCharacterId = owner.id;
  farm.workerIds = [...establishment.workerIds];
  for (const worker of workers) {
    const contract: EmploymentContract = { id: world.nextIds.employment++, characterId: worker.id, establishmentId: establishment.id, role: worker.id === owner.id ? 'староста хозяйства' : 'земледелец', wage: 2, hoursPerWeek: 48, sinceYear: world.year, active: true };
    world.employments.push(contract);
    worker.employerEstablishmentId = establishment.id;
    worker.employmentContractId = contract.id;
    worker.workplaceBuildingId = farm.id;
    worker.workplace = establishment.name;
    if (worker.profession === 'child' && worker.age >= 14) worker.profession = 'farmer';
  }
}

function linkFounderRoute(world: WorldState, settlement: Settlement, originSettlementId: number, rng: RNG): TradeRoute | undefined {
  const origin = world.settlements.find(item => item.id === originSettlementId);
  if (!origin || world.tradeRoutes.some(route => [route.fromSettlementId, route.toSettlementId].includes(origin.id) && [route.fromSettlementId, route.toSettlementId].includes(settlement.id))) return undefined;
  const route: TradeRoute = {
    id: world.nextIds.tradeRoute++, name: `${origin.name} — ${settlement.name}`, fromSettlementId: origin.id, toSettlementId: settlement.id,
    goods: [...new Set([origin.resource, settlement.resource, 'зерно'])], volume: rng.int(8, 24), safety: Math.max(20, Math.round(86 - Math.hypot(origin.x - settlement.x, origin.y - settlement.y) * 5)),
    active: true, controlledByKingdomIds: [...new Set([origin.kingdomId, settlement.kingdomId])], history: [`Путь проложили семьи, основавшие ${settlement.name}.`],
  };
  world.tradeRoutes.push(route);
  origin.tradeRouteIds.push(route.id);
  settlement.tradeRouteIds.push(route.id);
  return route;
}

function beginReturn(world: WorldState, expedition: SettlementExpedition, reason: string): void {
  if (expedition.status === 'returning') return;
  const origin = world.settlements.find(item => item.id === expedition.originSettlementId);
  if (!origin) { failExpedition(world, expedition, reason); return; }
  expedition.status = 'returning';
  expedition.failureReason = reason;
  const current = { x: expedition.currentX, y: expedition.currentY };
  const route = findSettlementRoute(world, current, origin);
  if (route.length < 2) { restoreReturnedExpedition(world, expedition); return; }
  expedition.route = route;
  expedition.routeIndex = 0;
  expedition.destinationX = origin.x;
  expedition.destinationY = origin.y;
  expedition.history.push(`В ${world.year}.${String(world.month).padStart(2, '0')} принято решение возвращаться: ${reason}.`);
}

function restoreReturnedExpedition(world: WorldState, expedition: SettlementExpedition): void {
  const origin = world.settlements.find(item => item.id === expedition.originSettlementId);
  if (!origin) { failExpedition(world, expedition, 'исходное поселение исчезло до возвращения'); return; }
  const members = livingExpeditionMembers(world, expedition);
  for (const member of members) {
    member.settlementId = origin.id;
    member.kingdomId = origin.kingdomId;
    member.expeditionId = undefined;
    member.homeDistrict = origin.districts[0]?.name ?? 'Сердце поселения';
    member.homeless = true;
    member.housingStatus = 'homeless';
    member.biography.push(`В ${world.year} году вернулся в ${origin.name} после неудачной попытки основать поселение.`);
  }
  for (const householdId of expedition.householdIds) {
    const household = world.households.find(item => item.id === householdId);
    if (!household) continue;
    household.settlementId = origin.id;
    household.homeBuildingId = undefined;
    household.history.push(`Вернулось в ${origin.name} после неудачной экспедиции.`);
    if (!origin.householdIds.includes(household.id)) origin.householdIds.push(household.id);
    for (const itemId of household.inventoryItemIds) {
      const item = world.items.find(candidate => candidate.id === itemId);
      if (item) item.settlementId = origin.id;
    }
  }
  origin.population = world.characters.filter(character => character.alive && character.settlementId === origin.id).length;
  origin.households = origin.householdIds.length;
  clearExpeditionMembership(world, expedition);
  expedition.status = 'returned';
  expedition.resolvedTick = worldTick(world);
  expedition.currentX = origin.x;
  expedition.currentY = origin.y;
  expedition.history.push(`Экспедиция вернулась в ${origin.name}.`);
  appendCausalEvent(world, {
    kind: 'migration', title: `Основатели вернулись в ${origin.name}`, description: `${members.length} выживших вернулись без нового поселения.`,
    cause: expedition.failureReason ?? 'экспедиция не смогла закрепиться', conditions: ['маршрут назад оставался доступным'], decision: 'отказаться от основания и сохранить оставшихся людей',
    outcome: 'семьи вернулись без домов и постоянной работы', consequences: ['в городе выросла потребность в жилье', 'знания о маршруте и земле сохранились'],
    entityRefs: [{ kind: 'settlement', id: origin.id }, { kind: 'character', id: expedition.leaderCharacterId }], importance: 2,
  });
}

function failExpedition(world: WorldState, expedition: SettlementExpedition, reason: string): void {
  expedition.failureReason = reason;
  const members = livingExpeditionMembers(world, expedition);
  const origin = world.settlements.find(item => item.id === expedition.originSettlementId);
  if (members.length && origin) {
    restoreReturnedExpedition(world, expedition);
    return;
  }

  // Если исходная община исчезла, выжившие не должны зависнуть в несуществующем
  // settlementId=0. Ближайшее живое поселение принимает их как беженцев.
  const refuge = members.length
    ? [...world.settlements]
      .filter(settlement => settlement.population > 3)
      .sort((a, b) => Math.hypot(a.x - expedition.currentX, a.y - expedition.currentY) - Math.hypot(b.x - expedition.currentX, b.y - expedition.currentY) || a.id - b.id)[0]
    : undefined;
  if (refuge) {
    for (const member of members) {
      member.expeditionId = undefined;
      member.settlementId = refuge.id;
      member.kingdomId = refuge.kingdomId;
      member.homeDistrict = refuge.districts[0]?.name ?? 'Сердце поселения';
      member.homeless = true;
      member.housingStatus = 'homeless';
      member.biography.push(`В ${world.year} году добрался до ${refuge.name} после гибели экспедиции №${expedition.id}.`);
    }
    for (const householdId of expedition.householdIds) {
      const household = world.households.find(item => item.id === householdId);
      if (!household) continue;
      household.settlementId = refuge.id;
      household.homeBuildingId = undefined;
      if (!refuge.householdIds.includes(household.id)) refuge.householdIds.push(household.id);
      for (const itemId of household.inventoryItemIds) {
        const item = world.items.find(candidate => candidate.id === itemId);
        if (item) item.settlementId = refuge.id;
      }
    }
    refuge.population = world.characters.filter(character => character.alive && character.settlementId === refuge.id).length;
    refuge.households = refuge.householdIds.length;
  }
  clearExpeditionMembership(world, expedition);
  expedition.status = 'failed';
  expedition.resolvedTick = worldTick(world);
  expedition.history.push(`Экспедиция прекратила существование: ${reason}.`);
}

function detachExpeditionFromOrigin(world: WorldState, origin: Settlement, expedition: SettlementExpedition, households: Household[], members: Character[]): void {
  const memberIds = new Set(members.map(member => member.id));
  for (const contract of world.employments) {
    if (!memberIds.has(contract.characterId) || !contract.active) continue;
    contract.active = false;
    const establishment = world.establishments.find(item => item.id === contract.establishmentId);
    if (establishment) establishment.workerIds = establishment.workerIds.filter(id => id !== contract.characterId);
  }
  for (const building of world.buildings) {
    building.residentIds = building.residentIds.filter(id => !memberIds.has(id));
    building.workerIds = building.workerIds.filter(id => !memberIds.has(id));
    if (building.ownerCharacterId && memberIds.has(building.ownerCharacterId)) building.ownerCharacterId = undefined;
  }
  for (const household of households) {
    origin.householdIds = origin.householdIds.filter(id => id !== household.id);
    if (household.homeBuildingId) {
      const home = world.buildings.find(item => item.id === household.homeBuildingId);
      if (home?.householdId === household.id) home.householdId = undefined;
    }
    household.settlementId = 0;
    household.homeBuildingId = undefined;
    household.history.push(`Покинуло ${origin.name} в составе экспедиции №${expedition.id}.`);
    for (const itemId of household.inventoryItemIds) {
      const item = world.items.find(candidate => candidate.id === itemId);
      if (!item) continue;
      item.settlementId = 0;
      item.buildingId = undefined;
    }
  }
  for (const member of members) {
    member.settlementId = 0;
    member.expeditionId = expedition.id;
    member.homeBuildingId = undefined;
    member.workplaceBuildingId = undefined;
    member.employerEstablishmentId = undefined;
    member.employmentContractId = undefined;
    member.homeless = false;
    member.housingStatus = undefined;
    member.temporaryShelterBuildingId = undefined;
    member.schedule.currentActivity = 'идёт в составе экспедиции основателей';
  }
  origin.population = world.characters.filter(character => character.alive && character.settlementId === origin.id).length;
  origin.households = origin.householdIds.length;
  origin.food = Math.max(0, origin.food - Math.ceil(members.length / 4));
  origin.stockpile.зерно = Math.max(0, (origin.stockpile.зерно ?? 0) - expedition.supplies.seedGrain);
  origin.stockpile.древесина = Math.max(0, (origin.stockpile.древесина ?? 0) - expedition.supplies.timber);
  origin.economy.coinSupply = Math.max(0, origin.economy.coinSupply - expedition.supplies.coin);
}

function selectExpeditionHouseholds(world: WorldState, origin: Settlement, rng: RNG, requested?: readonly number[]): Household[] {
  const requestedSet = requested ? new Set(requested) : undefined;
  const activeMemberIds = new Set(world.settlementExpeditions.filter(item => ACTIVE_STATUSES.has(item.status)).flatMap(item => item.memberIds));
  const candidates = world.households
    .filter(household => household.settlementId === origin.id && (!requestedSet || requestedSet.has(household.id)))
    .filter(household => household.memberIds.some(id => world.characters.some(character => character.id === id && character.alive && character.age >= 18)))
    .filter(household => household.memberIds.every(id => !activeMemberIds.has(id)))
    .filter(household => !household.memberIds.some(id => world.characters.find(character => character.id === id)?.titles.length))
    .sort((a, b) => householdExpeditionScore(world, b) - householdExpeditionScore(world, a) || a.id - b.id);
  const populationLimit = Math.max(8, Math.min(36, Math.floor(origin.population * .16)));
  const selected: Household[] = [];
  let count = 0;
  for (const household of candidates) {
    const aliveCount = household.memberIds.filter(id => world.characters.some(character => character.id === id && character.alive)).length;
    if (!aliveCount || count + aliveCount > populationLimit + 3) continue;
    if (selected.length && rng.chance(.12)) continue;
    selected.push(household);
    count += aliveCount;
    if (count >= Math.min(18, populationLimit)) break;
  }
  return selected;
}

function candidateOrigins(world: WorldState): Settlement[] {
  const tick = worldTick(world);
  return world.settlements.filter(settlement => settlement.population >= 55
    && settlement.householdIds.length >= 4
    && !world.settlementExpeditions.some(item => item.originSettlementId === settlement.id && ACTIVE_STATUSES.has(item.status))
    && !world.settlementExpeditions.some(item => item.originSettlementId === settlement.id && tick - item.formedTick < 72));
}

function foundingPressure(world: WorldState, settlement: Settlement): { score: number; cause: SettlementExpeditionCause } {
  const city = world.cityStates.find(item => item.settlementId === settlement.id);
  const problems = city?.problems ?? [];
  const housing = city ? city.housing.peopleWithoutPermanentBed / Math.max(1, city.population) * 100 : Math.max(0, settlement.population - settlement.residentialCapacity) / Math.max(1, settlement.population) * 100;
  const unemployment = city ? city.employment.unemployedPeople / Math.max(1, city.employment.workingAgePeople) * 100 : 0;
  const land = problems.find(problem => problem.kind === 'land-shortage' || problem.kind === 'land-conflict')?.severity ?? 0;
  const cultureTension = world.settlementCultures.find(item => item.settlementId === settlement.id)?.culturalTension ?? 0;
  const war = world.wars.some(item => item.active && item.contestedSettlementIds.includes(settlement.id)) ? 55 : 0;
  const factors: { cause: SettlementExpeditionCause; score: number }[] = [
    { cause: 'overcrowding', score: housing * 1.8 },
    { cause: 'land-shortage', score: land * .9 },
    { cause: 'unemployment', score: unemployment * 1.1 },
    { cause: 'religious-conflict', score: Math.max(0, cultureTension - 35) * .75 },
    { cause: 'war', score: war },
    { cause: 'resource-search', score: settlement.prosperity >= 55 && settlement.population >= 220 ? 24 + settlement.prosperity * .18 : 0 },
    { cause: 'royal-charter', score: world.kingdoms.find(item => item.id === settlement.kingdomId)?.treasury && settlement.population >= 400 ? 26 : 0 },
  ];
  return factors.sort((a, b) => b.score - a.score || a.cause.localeCompare(b.cause))[0] ?? { cause: 'resource-search', score: 0 };
}

function markAbandonedSettlements(world: WorldState, rng: RNG): void {
  for (const settlement of world.settlements) {
    if (settlement.population > 3 || settlement.history.some(line => line.includes('окончательно опустел'))) continue;
    settlement.history.push(`В ${world.year} году поселение окончательно опустело и стало руинами.`);
    const dungeonId = Math.max(0, ...world.dungeons.map(dungeon => dungeon.id)) + 1;
    world.dungeons.push({
      id: dungeonId, name: `Руины ${settlement.name}`, x: settlement.x, y: settlement.y, origin: 'покинутое поселение', purpose: 'бывшие дома, склады и укрепления', builtYear: settlement.foundedYear,
      danger: rng.int(2, 7), depth: 1, currentInhabitants: rng.pick(['разбойники', 'дикие звери', 'нежить', 'никто']), ownerKingdomId: settlement.kingdomId, discovered: true, artifactIds: [], history: [...settlement.history],
    });
    const tile = tileAt(world, settlement.x, settlement.y);
    if (tile) tile.dungeonId = dungeonId;
    appendCausalEvent(world, {
      kind: 'settlement', title: `${settlement.name} стал руинами`, description: 'Последние жители покинули поселение.', cause: settlement.shortages.length ? 'голод и разрушения' : 'война, упадок и отток людей',
      conditions: ['в поселении осталось не больше трёх жителей'], decision: 'не восстанавливать пустую общину', outcome: 'поселение перестало поддерживать постоянную жизнь',
      consequences: ['на карте появились руины', 'здания могут занять чудовища или разбойники'], entityRefs: [{ kind: 'settlement', id: settlement.id }, { kind: 'dungeon', id: dungeonId }], importance: 4,
    });
  }
}

function addCampTrace(world: WorldState, expedition: SettlementExpedition, durationMonths: number): void {
  const size = world.config.localMapSize ?? 128;
  const seed = hashSeed(`${world.config.seed}:след-экспедиции:${expedition.id}:${expedition.currentX}:${expedition.currentY}:${world.year}:${world.month}`);
  const id = `expedition:${expedition.id}:${world.year}:${world.month}:${expedition.currentX}:${expedition.currentY}`;
  if (world.localMapChanges.some(effect => effect.id === id)) return;
  world.localMapChanges.push({
    id, globalX: expedition.currentX, globalY: expedition.currentY, level: 0,
    localX: 8 + seed % Math.max(1, size - 16), localY: 8 + Math.floor(seed / 97) % Math.max(1, size - 16),
    kind: 'camp', year: world.year, month: world.month, expiresTick: worldTick(world) + durationMonths,
    label: expedition.status === 'camped' ? `Лагерь основателей (${livingExpeditionMembers(world, expedition).length})` : `Ночной лагерь переселенцев (${livingExpeditionMembers(world, expedition).length})`,
    entityRef: { kind: 'character', id: expedition.leaderCharacterId },
  });
}

function defaultEconomy(population: number, coinSupply: number): SettlementEconomy {
  return { currency: 'крона', coinSupply: Math.max(50, coinSupply), priceIndex: 1.18, wageIndex: .72, rentIndex: .55, taxRate: .04, prices: {}, supply: {}, demand: {}, imports: {}, exports: {}, lastMonthlyTrade: 0, bankruptcies: 0 };
}

function founderRooms(type: Building['type']): string[] {
  if (type === 'house') return ['общая комната', 'спальные места', 'кладовая'];
  if (type === 'warehouse') return ['общий склад', 'семенной закром', 'навес инструментов'];
  if (type === 'farm') return ['рабочий навес', 'загон', 'кладовая'];
  return ['общий двор', 'колодец', 'место собраний'];
}

function expeditionReason(cause: SettlementExpeditionCause, origin: Settlement): string {
  const reasons: Record<SettlementExpeditionCause, string> = {
    overcrowding: `в ${origin.name} не хватает постоянного жилья`,
    'land-shortage': `у ${origin.name} закончилась доступная земля для полей и домов`,
    unemployment: `часть семей ${origin.name} не может найти устойчивую работу`,
    'religious-conflict': `часть общины покидает ${origin.name} из-за культурного и религиозного конфликта`,
    war: `${origin.name} оказался под военной угрозой`,
    'resource-search': `${origin.name} ищет новые земли и сырьё`,
    'royal-charter': `власть выдала семьям ${origin.name} разрешение освоить новую землю`,
  };
  return reasons[cause];
}

function leadershipScore(character: Character): number {
  return character.renown * 2 + character.loyalty + character.ambition.length * .2 + (character.skills.farmer ?? 0) + (character.skills.carpenter ?? 0) + (character.skills.merchant ?? 0);
}

function householdExpeditionScore(world: WorldState, household: Household): number {
  const members = household.memberIds.map(id => world.characters.find(item => item.id === id)).filter((item): item is Character => Boolean(item?.alive));
  const adults = members.filter(member => member.age >= 16);
  const useful = adults.reduce((sum, member) => sum + Math.max(member.skills.farmer ?? 0, member.skills.carpenter ?? 0, member.skills.hunter ?? 0, member.skills.blacksmith ?? 0), 0);
  return adults.length * 22 + members.length * 5 + useful * .4 + household.foodReserveDays * .6 - household.debt * 2;
}

function clearExpeditionMembership(world: WorldState, expedition: SettlementExpedition): void {
  const memberIds = new Set(expedition.memberIds);
  for (const character of world.characters) if (memberIds.has(character.id) && character.expeditionId === expedition.id) character.expeditionId = undefined;
}

function livingExpeditionMembers(world: WorldState, expedition: SettlementExpedition): Character[] {
  const ids = new Set(expedition.memberIds);
  return world.characters.filter(character => character.alive && ids.has(character.id));
}

function expeditionDanger(world: WorldState, x: number, y: number): number {
  return world.monsters.filter(monster => monster.alive).reduce((sum, monster) => {
    const distance = Math.hypot(monster.x - x, monster.y - y);
    return distance <= monster.territoryRadius + 2 ? sum + Math.max(0, monster.power / 4 - distance * 3) : sum;
  }, 0);
}

function tileAt(world: WorldState, x: number, y: number): Tile | undefined {
  return world.tiles[y * world.config.width + x] ?? world.tiles.find(tile => tile.x === x && tile.y === y);
}

function uniqueSettlementName(world: WorldState, rng: RNG): string {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const name = placeName(rng);
    if (!world.settlements.some(settlement => settlement.name === name)) return name;
  }
  return `Новая община ${world.nextIds.settlement}`;
}

export function settlementLifecycleIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const expeditionIds = new Set<number>();
  const settlementIds = new Set(world.settlements.map(item => item.id));
  const characterById = new Map(world.characters.map(item => [item.id, item]));
  const householdById = new Map(world.households.map(item => [item.id, item]));
  for (const expedition of world.settlementExpeditions ?? []) {
    if (expeditionIds.has(expedition.id)) issues.push(`Экспедиция №${expedition.id}: повтор идентификатора`);
    expeditionIds.add(expedition.id);
    if (!settlementIds.has(expedition.originSettlementId)) issues.push(`Экспедиция №${expedition.id}: отсутствует исходное поселение`);
    if (!world.kingdoms.some(item => item.id === expedition.sponsorKingdomId)) issues.push(`Экспедиция №${expedition.id}: отсутствует государство-покровитель`);
    if (!characterById.has(expedition.leaderCharacterId)) issues.push(`Экспедиция №${expedition.id}: отсутствует лидер`);
    if (!expedition.route.length) issues.push(`Экспедиция №${expedition.id}: отсутствует маршрут`);
    if (expedition.routeIndex < 0 || expedition.routeIndex >= Math.max(1, expedition.route.length)) issues.push(`Экспедиция №${expedition.id}: неверная позиция на маршруте`);
    const routePoint = expedition.route[expedition.routeIndex];
    if (routePoint && (routePoint.x !== expedition.currentX || routePoint.y !== expedition.currentY)) issues.push(`Экспедиция №${expedition.id}: текущая клетка не совпадает с маршрутом`);
    const routeEnd = expedition.route.at(-1);
    if (routeEnd && (routeEnd.x !== expedition.destinationX || routeEnd.y !== expedition.destinationY)) issues.push(`Экспедиция №${expedition.id}: маршрут не заканчивается в заявленной цели`);
    for (const point of expedition.route) {
      const tile = tileAt(world, point.x, point.y);
      if (!tile || tile.terrain === 'ocean') { issues.push(`Экспедиция №${expedition.id}: маршрут проходит через недоступную клетку ${point.x}:${point.y}`); break; }
    }
    if (new Set(expedition.memberIds).size !== expedition.memberIds.length) issues.push(`Экспедиция №${expedition.id}: участники повторяются`);
    if (new Set(expedition.householdIds).size !== expedition.householdIds.length) issues.push(`Экспедиция №${expedition.id}: домохозяйства повторяются`);
    if (ACTIVE_STATUSES.has(expedition.status)) {
      for (const characterId of expedition.memberIds) {
        const character = characterById.get(characterId);
        if (!character?.alive) continue;
        if (character.expeditionId !== expedition.id) issues.push(`${character.name}: не связан со своей экспедицией №${expedition.id}`);
        if (character.settlementId !== 0) issues.push(`${character.name}: участник активной экспедиции всё ещё числится жителем поселения ${character.settlementId}`);
      }
      for (const householdId of expedition.householdIds) {
        const household = householdById.get(householdId);
        if (!household) { issues.push(`Экспедиция №${expedition.id}: отсутствует домохозяйство ${householdId}`); continue; }
        if (household.settlementId !== 0) issues.push(`Домохозяйство №${household.id}: активная экспедиция числится в поселении ${household.settlementId}`);
        const missingMembers = household.memberIds.filter(characterId => characterById.get(characterId)?.alive && !expedition.memberIds.includes(characterId));
        if (missingMembers.length) issues.push(`Экспедиция №${expedition.id}: домохозяйство ${household.id} оставило живых членов вне группы`);
      }
    }
    if (expedition.status === 'founded') {
      if (!expedition.foundedSettlementId || !settlementIds.has(expedition.foundedSettlementId)) issues.push(`Экспедиция №${expedition.id}: основанное поселение отсутствует`);
      const settlement = world.settlements.find(item => item.id === expedition.foundedSettlementId);
      if (settlement && settlement.foundingExpeditionId !== expedition.id) issues.push(`${settlement.name}: не хранит ссылку на экспедицию-основателя`);
      if (settlement) for (const characterId of expedition.memberIds) {
        const character = characterById.get(characterId);
        if (character?.alive && character.settlementId !== settlement.id) issues.push(`${character.name}: живой основатель не числится в ${settlement.name}`);
      }
    }
  }
  for (const character of world.characters) {
    if (!character.expeditionId) continue;
    const expedition = world.settlementExpeditions.find(item => item.id === character.expeditionId);
    if (!expedition || !ACTIVE_STATUSES.has(expedition.status)) issues.push(`${character.name}: ссылка на неактивную экспедицию ${character.expeditionId}`);
  }
  return [...new Set(issues)];
}
