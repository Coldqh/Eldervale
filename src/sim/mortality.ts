import type { BurialRecord, BurialState, Cemetery, Character, Monster, WorldState } from '../types';
import type { WorldIndexes } from './indexes';
import { RNG } from './rng';
import { worldTick } from './scheduler';

export interface DeathContext {
  cause: string;
  globalX?: number;
  globalY?: number;
  settlementId?: number;
  killerName?: string;
  createCorpse?: boolean;
  state?: BurialState;
}

export interface CharacterDeathEntry {
  character: Character;
  context: DeathContext;
}

export function ensureCemeteries(world: WorldState, rng = new RNG(`${world.config.seed}:кладбища`)): void {
  world.cemeteries ??= [];
  world.burials ??= [];
  world.nextIds.cemetery ??= Math.max(0, ...world.cemeteries.map(item => item.id)) + 1;
  world.nextIds.burial ??= Math.max(0, ...world.burials.map(item => item.id)) + 1;

  for (const settlement of world.settlements) {
    if (world.cemeteries.some(item => item.settlementId === settlement.id)) continue;
    const size = world.config.localMapSize ?? 128;
    const district = settlement.districts.find(item => item.role === 'окраина') ?? settlement.districts.at(-1) ?? settlement.districts[0];
    const localX = 8 + rng.int(0, Math.max(1, Math.floor(size * .18)));
    const localY = Math.max(8, size - 12 - rng.int(0, Math.max(1, Math.floor(size * .18))));
    world.cemeteries.push({
      id: world.nextIds.cemetery++,
      name: `Кладбище ${settlement.name}`,
      settlementId: settlement.id,
      globalX: district?.x ?? settlement.x,
      globalY: district?.y ?? settlement.y,
      localX,
      localY,
      foundedYear: Math.max(1, settlement.foundedYear + rng.int(0, Math.max(0, Math.min(20, world.year - settlement.foundedYear)))),
      capacity: Math.max(80, Math.ceil(settlement.population * 1.6)),
      burialIds: [],
      caretakerCharacterId: world.characters.find(character => character.alive && character.settlementId === settlement.id && ['priest', 'guard'].includes(character.profession))?.id,
      history: [`Основано для жителей поселения ${settlement.name}.`],
    });
  }
}

export function archiveCharacter(world: WorldState, indexes: WorldIndexes | undefined, character: Character, context: DeathContext, rng: RNG): BurialRecord {
  const existing = burialForSubject(world, 'character', character.id);
  if (existing) return existing;
  return archiveCharactersBatch(world, indexes, [{ character, context }], rng)[0]!;
}

export function archiveCharactersBatch(world: WorldState, indexes: WorldIndexes | undefined, entries: CharacterDeathEntry[], rng: RNG): BurialRecord[] {
  ensureCemeteries(world, rng);
  const alreadyArchived = new Set(world.burials.filter(item => item.subjectKind === 'character' && item.subjectId !== undefined).map(item => item.subjectId));
  const unique = new Map<number, CharacterDeathEntry>();
  for (const entry of entries) {
    if (alreadyArchived.has(entry.character.id)) continue;
    if (!world.characters.some(item => item.id === entry.character.id)) continue;
    unique.set(entry.character.id, entry);
  }
  if (!unique.size) return [];

  const deadIds = new Set(unique.keys());
  const deadById = new Map([...unique.values()].map(entry => [entry.character.id, entry.character]));
  const burials = [...unique.values()].map(entry => createCharacterBurial(world, entry.character, entry.context, rng));
  for (const entry of unique.values()) {
    entry.character.alive = false;
    entry.character.deathYear = world.year;
  }

  // Активные массивы и индексы очищаются одним проходом. Это критично при сотнях смертей за год.
  world.characters = world.characters.filter(item => !deadIds.has(item.id));
  if (indexes) {
    for (const id of deadIds) indexes.characterById.delete(id);
    for (const [settlementId, residents] of indexes.residentsBySettlement) indexes.residentsBySettlement.set(settlementId, residents.filter(item => !deadIds.has(item.id)));
    for (const [, professions] of indexes.workersBySettlementAndProfession) {
      for (const [profession, workers] of professions) professions.set(profession, workers.filter(item => !deadIds.has(item.id)));
    }
  }
  detachCharactersBatch(world, deadIds, deadById);
  world.burials.push(...burials);
  for (const burial of burials) finalizeInitialBurial(world, burial, unique.get(burial.subjectId!)!.context, rng);
  synchronizeMortalityIds(world);
  return burials;
}

export function archiveMonster(world: WorldState, monster: Monster, context: DeathContext, rng: RNG): BurialRecord {
  const existing = burialForSubject(world, 'monster', monster.id);
  if (existing) return existing;
  ensureCemeteries(world, rng);
  const localSize = world.config.localMapSize ?? 128;
  const burial: BurialRecord = {
    id: world.nextIds.burial++,
    subjectKind: 'monster',
    subjectId: monster.id,
    name: monster.name,
    species: monster.species,
    count: 1,
    deathYear: world.year,
    deathMonth: world.month,
    cause: context.cause,
    killerName: context.killerName,
    settlementId: context.settlementId,
    globalX: context.globalX ?? monster.x,
    globalY: context.globalY ?? monster.y,
    localX: rng.int(6, Math.max(7, localSize - 7)),
    localY: rng.int(6, Math.max(7, localSize - 7)),
    state: context.state ?? 'corpse',
    titles: [],
    renown: monster.tier === 'boss' ? 90 : monster.tier === 'miniboss' ? 65 : monster.tier === 'elite' ? 35 : 10,
    parentIds: [],
    childIds: [],
    tier: monster.tier,
    power: monster.power,
    footprintWidth: monster.footprintWidth,
    footprintHeight: monster.footprintHeight,
    summary: `${monster.species}, ${monster.tier}, сила ${monster.power}.`,
    history: [...monster.history.slice(-10), `Гибель: ${context.cause}.`],
  };

  monster.alive = false;
  world.monsters = world.monsters.filter(item => item.id !== monster.id);
  for (const tile of world.tiles) if (tile.monsterId === monster.id) tile.monsterId = undefined;
  const lair = monster.lairDungeonId ? world.dungeons.find(item => item.id === monster.lairDungeonId) : undefined;
  if (lair) {
    lair.currentInhabitants = 'логово без хозяина';
    lair.history.push(`В ${world.year} году хозяин логова ${monster.name} погиб.`);
  }
  world.simulation.queuedActions = world.simulation.queuedActions.filter(action => !(action.kind === 'monster' && action.entityId === monster.id));
  for (const army of world.armies) {
    if (army.targetMonsterId !== monster.id) continue;
    army.targetMonsterId = undefined;
    army.status = 'recovering';
  }
  world.burials.push(burial);
  finalizeInitialBurial(world, burial, context, rng);
  synchronizeMortalityIds(world);
  return burial;
}

export function archiveAnonymousCasualties(world: WorldState, count: number, globalX: number, globalY: number, cause: string, rng: RNG, settlementId?: number): BurialRecord | undefined {
  if (count <= 0) return undefined;
  ensureCemeteries(world, rng);
  const localSize = world.config.localMapSize ?? 128;
  const burial: BurialRecord = {
    id: world.nextIds.burial++, subjectKind: 'anonymous', name: `${count} неизвестных погибших`, species: 'разные', count,
    deathYear: world.year, deathMonth: world.month, cause, settlementId, globalX, globalY,
    localX: rng.int(6, Math.max(7, localSize - 7)), localY: rng.int(6, Math.max(7, localSize - 7)), state: 'corpse',
    titles: [], renown: 0, parentIds: [], childIds: [], summary: `Общая могила для ${count} погибших.`, history: [`Погибли в ${world.year} году: ${cause}.`],
  };
  world.burials.push(burial);
  addCorpseEffect(world, burial);
  return burial;
}

export function advanceBurials(world: WorldState, rng: RNG): void {
  ensureCemeteries(world, rng);
  const tick = worldTick(world);
  for (const burial of world.burials) {
    if (burial.state !== 'corpse') continue;
    const ageMonths = tick - (burial.deathYear * 12 + burial.deathMonth - 1);
    const cemetery = burial.settlementId ? cemeteryForSettlement(world, burial.settlementId) : nearestCemetery(world, burial.globalX, burial.globalY, 2.5);
    const waitMonths = burial.subjectKind === 'monster' ? 3 : 1;
    if (cemetery && ageMonths >= waitMonths) {
      moveBurialToCemetery(world, burial, cemetery, rng);
      continue;
    }
    const decayMonths = burial.subjectKind === 'monster' ? 12 : 8;
    if (ageMonths >= decayMonths) {
      burial.state = 'decayed';
      burial.history.push(`Останки исчезли из местности к ${world.year} году.`);
    }
  }

  const activeCorpseIds = new Set(world.burials.filter(item => item.state === 'corpse').map(item => item.id));
  world.localMapChanges = world.localMapChanges.filter(effect => {
    if (effect.burialId && !activeCorpseIds.has(effect.burialId)) return false;
    if (effect.expiresTick !== undefined && effect.expiresTick <= tick) return false;
    return true;
  });

  // Старые миры могли иметь бессрочные трупы без burialId.
  world.localMapChanges = world.localMapChanges.filter(effect => {
    if (effect.kind !== 'body' || effect.burialId) return true;
    const effectTick = effect.year * 12 + (effect.month ?? 1) - 1;
    return tick - effectTick < 8;
  });
}

export function compactDeadEntities(world: WorldState, rng: RNG): void {
  ensureCemeteries(world, rng);
  const deadPeople = world.characters.filter(item => !item.alive);
  archiveCharactersBatch(world, undefined, deadPeople.map(character => {
    const settlement = world.settlements.find(item => item.id === character.settlementId);
    return {
      character,
      context: {
        cause: character.biography.at(-1) ?? 'причина смерти не сохранилась',
        globalX: settlement?.x,
        globalY: settlement?.y,
        settlementId: settlement?.id,
        createCorpse: false,
        state: 'buried' as const,
      },
    };
  }), rng);

  const deadMonsters = world.monsters.filter(item => !item.alive);
  for (const monster of deadMonsters) {
    if (burialForSubject(world, 'monster', monster.id)) continue;
    archiveMonster(world, monster, { cause: monster.history.at(-1) ?? 'убито в прошлом', createCorpse: false, state: 'decayed' }, rng);
  }
  synchronizeMortalityIds(world);
}

export function synchronizeMortalityIds(world: WorldState): void {
  const archivedCharacterIds = world.burials.filter(item => item.subjectKind === 'character').map(item => item.subjectId ?? 0);
  const archivedMonsterIds = world.burials.filter(item => item.subjectKind === 'monster').map(item => item.subjectId ?? 0);
  world.nextIds.character = Math.max(world.nextIds.character ?? 1, Math.max(0, ...world.characters.map(item => item.id), ...archivedCharacterIds) + 1);
  world.nextIds.monster = Math.max(world.nextIds.monster ?? 1, Math.max(0, ...world.monsters.map(item => item.id), ...archivedMonsterIds) + 1);
  world.nextIds.cemetery = Math.max(world.nextIds.cemetery ?? 1, Math.max(0, ...world.cemeteries.map(item => item.id)) + 1);
  world.nextIds.burial = Math.max(world.nextIds.burial ?? 1, Math.max(0, ...world.burials.map(item => item.id)) + 1);
}

export function burialForSubject(world: WorldState, kind: 'character' | 'monster', id: number): BurialRecord | undefined {
  return world.burials.find(item => item.subjectKind === kind && item.subjectId === id);
}

export function cemeteryForSettlement(world: WorldState, settlementId: number): Cemetery | undefined {
  return world.cemeteries.find(item => item.settlementId === settlementId);
}

function createCharacterBurial(world: WorldState, character: Character, context: DeathContext, rng: RNG): BurialRecord {
  const settlement = world.settlements.find(item => item.id === (context.settlementId ?? character.settlementId));
  const localSize = world.config.localMapSize ?? 128;
  return {
    id: world.nextIds.burial++,
    subjectKind: 'character',
    subjectId: character.id,
    name: character.name,
    species: character.species,
    count: 1,
    birthYear: character.birthYear,
    deathYear: world.year,
    deathMonth: world.month,
    cause: context.cause,
    killerName: context.killerName,
    settlementId: settlement?.id ?? character.settlementId,
    kingdomId: character.kingdomId,
    globalX: context.globalX ?? settlement?.x ?? 0,
    globalY: context.globalY ?? settlement?.y ?? 0,
    localX: rng.int(6, Math.max(7, localSize - 7)),
    localY: rng.int(6, Math.max(7, localSize - 7)),
    state: context.state ?? 'corpse',
    profession: character.profession,
    titles: [...character.titles],
    renown: character.renown,
    parentIds: [...character.parentIds],
    childIds: [...character.childIds],
    spouseId: character.spouseId,
    summary: `${character.name}, ${character.profession}, прожил ${character.age} лет.`,
    history: [...character.biography.slice(-8), `Смерть: ${context.cause}.`],
  };
}

function finalizeInitialBurial(world: WorldState, burial: BurialRecord, context: DeathContext, rng: RNG): void {
  if (burial.state === 'corpse') {
    if (context.createCorpse !== false) addCorpseEffect(world, burial);
    return;
  }
  if ((burial.state === 'buried' || burial.state === 'mass-grave' || burial.state === 'trophy') && burial.settlementId) {
    const cemetery = cemeteryForSettlement(world, burial.settlementId);
    if (cemetery) moveBurialToCemetery(world, burial, cemetery, rng, burial.state);
  }
}

function moveBurialToCemetery(world: WorldState, burial: BurialRecord, cemetery: Cemetery, rng: RNG, forcedState?: BurialState): void {
  const occupied = cemetery.burialIds.reduce((sum, id) => sum + (world.burials.find(item => item.id === id)?.count ?? 1), 0);
  if (occupied + burial.count > cemetery.capacity) {
    const previous = cemetery.capacity;
    cemetery.capacity += Math.max(50, burial.count, Math.ceil(cemetery.capacity * .25));
    cemetery.history.push(`В ${world.year} году кладбище расширили с ${previous} до ${cemetery.capacity} мест.`);
  }
  burial.cemeteryId = cemetery.id;
  burial.buriedYear = world.year;
  burial.buriedMonth = world.month;
  burial.state = forcedState ?? (burial.count > 1 ? 'mass-grave' : burial.subjectKind === 'monster' ? 'trophy' : 'buried');
  if (!cemetery.burialIds.includes(burial.id)) cemetery.burialIds.push(burial.id);
  burial.globalX = cemetery.globalX;
  burial.globalY = cemetery.globalY;
  burial.localX = cemetery.localX + rng.int(-4, 4);
  burial.localY = cemetery.localY + rng.int(-4, 4);
  burial.history.push(`Перенесено в ${cemetery.name} в ${world.year} году.`);
}

function nearestCemetery(world: WorldState, x: number, y: number, maxDistance: number): Cemetery | undefined {
  let best: Cemetery | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const cemetery of world.cemeteries) {
    const value = Math.hypot(cemetery.globalX - x, cemetery.globalY - y);
    if (value <= maxDistance && value < distance) { best = cemetery; distance = value; }
  }
  return best;
}

function addCorpseEffect(world: WorldState, burial: BurialRecord): void {
  const createdTick = burial.deathYear * 12 + burial.deathMonth - 1;
  world.localMapChanges.push({
    id: `burial-${burial.id}-${createdTick}`,
    globalX: burial.globalX,
    globalY: burial.globalY,
    level: 0,
    localX: burial.localX,
    localY: burial.localY,
    kind: 'body',
    year: burial.deathYear,
    month: burial.deathMonth,
    expiresTick: createdTick + (burial.subjectKind === 'monster' ? 12 : 8),
    burialId: burial.id,
    label: burial.subjectKind === 'monster' ? `Останки ${burial.name}` : burial.name,
    entityRef: { kind: 'burial', id: burial.id },
  });
}

function detachCharactersBatch(world: WorldState, deadIds: Set<number>, deadById: Map<number, Character>): void {
  const liveById = new Map(world.characters.map(item => [item.id, item]));
  const emptyHouseholdIds = new Set<number>();
  for (const household of world.households) {
    household.memberIds = household.memberIds.filter(id => !deadIds.has(id));
    if (deadIds.has(household.headCharacterId)) household.headCharacterId = household.memberIds.find(id => liveById.has(id)) ?? 0;
    if (!household.memberIds.length) emptyHouseholdIds.add(household.id);
  }

  for (const building of world.buildings) {
    building.residentIds = building.residentIds.filter(id => !deadIds.has(id));
    building.workerIds = building.workerIds.filter(id => !deadIds.has(id));
    if (building.ownerCharacterId && deadIds.has(building.ownerCharacterId)) building.ownerCharacterId = undefined;
    if (building.householdId && emptyHouseholdIds.has(building.householdId)) building.householdId = undefined;
  }

  for (const establishment of world.establishments) {
    establishment.workerIds = establishment.workerIds.filter(id => !deadIds.has(id));
    if (deadIds.has(establishment.ownerCharacterId)) {
      const deadOwner = deadById.get(establishment.ownerCharacterId);
      const successor = establishment.workerIds.find(id => liveById.has(id));
      if (successor) {
        establishment.ownerCharacterId = successor;
        establishment.history.push(`После смерти ${deadOwner?.name ?? 'владельца'} заведение перешло работнику ${liveById.get(successor)?.name ?? successor}.`);
      } else {
        establishment.active = false;
        establishment.history.push(`Закрыто после смерти владельца ${deadOwner?.name ?? establishment.ownerCharacterId}.`);
      }
    }
  }
  world.employments = world.employments.filter(employment => !deadIds.has(employment.characterId));

  const householdById = new Map(world.households.map(item => [item.id, item]));
  const buildingById = new Map(world.buildings.map(item => [item.id, item]));
  const establishmentById = new Map(world.establishments.map(item => [item.id, item]));
  const itemById = new Map(world.items.map(item => [item.id, item]));

  const deadMerchants = (world.travelingMerchants ?? []).filter(merchant => deadIds.has(merchant.characterId));
  for (const merchant of deadMerchants) {
    const owner = deadById.get(merchant.characterId);
    const household = owner?.householdId && !emptyHouseholdIds.has(owner.householdId) ? householdById.get(owner.householdId) : undefined;
    const destination = world.buildings
      .filter(building => building.settlementId === merchant.currentSettlementId && building.condition > 20)
      .sort((a, b) => Number(['market', 'shop', 'warehouse', 'inn', 'tavern'].includes(b.type)) - Number(['market', 'shop', 'warehouse', 'inn', 'tavern'].includes(a.type)) || a.id - b.id)[0];
    const establishment = destination?.establishmentId ? establishmentById.get(destination.establishmentId) : undefined;
    for (const itemId of merchant.wagonInventoryItemIds) {
      const item = itemById.get(itemId);
      if (!item || item.quantity <= 0) continue;
      item.ownerCharacterId = undefined;
      item.equippedByCharacterId = undefined;
      item.householdId = undefined;
      item.settlementId = merchant.currentSettlementId;
      item.buildingId = destination?.id;
      item.establishmentId = establishment?.id;
      if (establishment && !establishment.inventoryItemIds.includes(item.id)) establishment.inventoryItemIds.push(item.id);
      else if (destination && !destination.inventoryItemIds.includes(item.id)) destination.inventoryItemIds.push(item.id);
      else if (household) {
        item.householdId = household.id;
        item.buildingId = household.homeBuildingId;
        if (!household.inventoryItemIds.includes(item.id)) household.inventoryItemIds.push(item.id);
      }
      item.history.push(`Груз остался после смерти странствующего торговца ${owner?.name ?? merchant.characterId}.`);
    }
    if (household && merchant.cash > 0) {
      household.wealth += merchant.cash;
      household.history.push(`Получено ${Math.round(merchant.cash)} крон после смерти странствующего торговца ${owner?.name ?? merchant.characterId}.`);
    }
  }
  if (deadMerchants.length) {
    const deadMerchantIds = new Set(deadMerchants.map(merchant => merchant.id));
    world.travelingMerchants = world.travelingMerchants.filter(merchant => !deadMerchantIds.has(merchant.id));
  }
  const armyBySoldierId = new Map<number, WorldState['armies'][number]>();
  for (const army of world.armies) for (const soldierId of army.soldierIds ?? []) armyBySoldierId.set(soldierId, army);
  for (const item of world.items) if (item.ownerCharacterId && deadIds.has(item.ownerCharacterId)) {
    const owner = deadById.get(item.ownerCharacterId);
    item.ownerCharacterId = undefined;
    item.equippedByCharacterId = undefined;
    const inheritedHouseholdId = owner?.householdId && !emptyHouseholdIds.has(owner.householdId) ? owner.householdId : undefined;
    const inheritedBuildingId = owner?.homeBuildingId;
    if (item.householdId && emptyHouseholdIds.has(item.householdId)) item.householdId = undefined;
    item.householdId ??= inheritedHouseholdId;
    item.buildingId ??= inheritedBuildingId;
    const inheritedHousehold = item.householdId && !emptyHouseholdIds.has(item.householdId) ? householdById.get(item.householdId) : undefined;
    if (inheritedHousehold) {
      if (!inheritedHousehold.inventoryItemIds.includes(item.id)) inheritedHousehold.inventoryItemIds.push(item.id);
    } else if (item.buildingId) {
      item.householdId = undefined;
      const inventory = buildingById.get(item.buildingId)?.inventoryItemIds;
      if (inventory && !inventory.includes(item.id)) inventory.push(item.id);
    } else if (owner) {
      const army = armyBySoldierId.get(owner.id);
      if (army) {
        if (!army.inventoryItemIds.includes(item.id)) army.inventoryItemIds.push(item.id);
        item.history.push(`Подобрано бойцами армии ${army.name}.`);
      }
    }
    item.history.push(`Остался после смерти ${owner?.name ?? 'владельца'}.`);
  }

  for (const artifact of world.artifacts) if (artifact.ownerId && deadIds.has(artifact.ownerId)) {
    const owner = deadById.get(artifact.ownerId);
    artifact.ownerHistory.push({ year: world.year, characterId: artifact.ownerId, settlementId: owner?.settlementId, reason: `владелец ${owner?.name ?? artifact.ownerId} умер` });
    artifact.ownerId = undefined;
    artifact.settlementId ??= owner?.settlementId;
    artifact.history.push(`В ${world.year} году остался без владельца после смерти ${owner?.name ?? 'прежнего владельца'}.`);
  }

  for (const army of world.armies) army.soldierIds = (army.soldierIds ?? []).filter(id => !deadIds.has(id));
  for (const unit of world.militaryUnits ?? []) {
    unit.memberIds = unit.memberIds.filter(id => !deadIds.has(id));
    if (deadIds.has(unit.commanderId)) unit.commanderId = unit.memberIds.find(id => liveById.has(id)) ?? 0;
  }
  world.militaryUnits = (world.militaryUnits ?? []).filter(unit => unit.memberIds.length > 0 || unit.type === 'штаб');
  for (const wagon of world.supplyWagons ?? []) wagon.escortIds = wagon.escortIds.filter(id => !deadIds.has(id));

  const commanderCandidates = new Map<number, Character[]>();
  for (const survivor of world.characters) {
    if (!['soldier', 'guard', 'hunter'].includes(survivor.profession)) continue;
    const list = commanderCandidates.get(survivor.kingdomId) ?? [];
    list.push(survivor);
    commanderCandidates.set(survivor.kingdomId, list);
  }
  for (const list of commanderCandidates.values()) list.sort((a, b) => b.renown - a.renown || b.loyalty - a.loyalty || a.id - b.id);
  for (const army of world.armies) if (deadIds.has(army.commanderId)) {
    const former = deadById.get(army.commanderId);
    const successor = commanderCandidates.get(army.kingdomId)?.[0] ?? world.characters.filter(item => item.kingdomId === army.kingdomId).sort((a, b) => b.renown - a.renown)[0];
    if (successor) {
      army.commanderId = successor.id;
      army.campaignHistory.push(`После смерти ${former?.name ?? 'командира'} командование принял ${successor.name}.`);
    } else {
      army.strength = 0;
      army.status = 'recovering';
      army.campaignHistory.push(`После смерти ${former?.name ?? 'командира'} армия осталась без командования и распалась.`);
    }
  }

  for (const cemetery of world.cemeteries) if (cemetery.caretakerCharacterId && deadIds.has(cemetery.caretakerCharacterId)) {
    const former = deadById.get(cemetery.caretakerCharacterId);
    cemetery.caretakerCharacterId = world.characters.find(item => item.settlementId === cemetery.settlementId && ['priest', 'guard'].includes(item.profession))?.id;
    cemetery.history.push(`В ${world.year} году умер смотритель ${former?.name ?? ''}.`.trim());
  }

  for (const dynasty of world.dynasties) if (deadIds.has(dynasty.currentHeadId)) {
    dynasty.currentHeadId = dynasty.memberIds
      .map(id => liveById.get(id))
      .filter((item): item is Character => Boolean(item))
      .sort((a, b) => b.age - a.age || b.renown - a.renown)[0]?.id ?? dynasty.currentHeadId;
  }

  const removedRelations = new Set(world.relationships.filter(item => deadIds.has(item.characterAId) || deadIds.has(item.characterBId)).map(item => item.id));
  world.relationships = world.relationships.filter(item => !removedRelations.has(item.id));
  for (const survivor of world.characters) survivor.relationshipIds = survivor.relationshipIds.filter(id => !removedRelations.has(id));

  if (emptyHouseholdIds.size) {
    for (const household of world.households.filter(item => emptyHouseholdIds.has(item.id))) {
      const building = household.homeBuildingId ? buildingById.get(household.homeBuildingId) : undefined;
      for (const itemId of household.inventoryItemIds) {
        const item = itemById.get(itemId);
        if (!item) continue;
        item.householdId = undefined;
        if (building) {
          item.buildingId = building.id;
          if (!building.inventoryItemIds.includes(item.id)) building.inventoryItemIds.push(item.id);
        }
      }
    }
    world.households = world.households.filter(item => !emptyHouseholdIds.has(item.id));
    for (const settlement of world.settlements) settlement.householdIds = settlement.householdIds.filter(id => !emptyHouseholdIds.has(id));
  }
}
