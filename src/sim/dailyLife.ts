import type { Building, Character, LocalMapData, LocalMarker, Relationship, Settlement, WorldState } from '../types';
import type { DailyPlaceKind, DailyRoutine, DailyRoutineStop, DayPhase, PersonalLifeEvent, PersonalLifeEventKind } from '../dailyLifeTypes';
import type { WorldIndexes } from './indexes';
import { indexRelationship, relationshipKey, residents } from './indexes';
import { hashSeed, RNG } from './rng';
import { worldTick } from './scheduler';
import {
  applyInteriorLayoutToMap, initializeInteriorSystem, interiorMarkersForMap, interiorPositionForCharacter,
  isSchoolAgeCharacter, schoolBuildingForCharacter,
} from './interiors';
import type { InteriorAssignmentKind } from '../interiorTypes';

export const DAY_PHASES: DayPhase[] = ['morning', 'day', 'evening', 'night'];
const MAX_ROUTINES = 1_200;
const MAX_PERSONAL_EVENTS = 3_200;
const MAX_DETAILED_CHARACTERS = 280;

export function dayPhaseLabel(phase: DayPhase): string {
  return ({ morning: 'Утро', day: 'День', evening: 'Вечер', night: 'Ночь' } as const)[phase];
}

export function initializeDailyLife(world: WorldState): void {
  initializeInteriorSystem(world);
  world.dailyRoutines ??= [];
  world.personalLifeEvents ??= [];
  world.nextIds.personalLifeEvent ??= Math.max(0, ...world.personalLifeEvents.map(item => item.id)) + 1;
  world.simulation.dailyLifeVersion = 1;
}

export function advanceDailyLife(
  world: WorldState,
  rng: RNG,
  indexes: WorldIndexes,
  options: { elapsedMonths?: number; recordEvents?: boolean; forceCharacterIds?: readonly number[] } = {},
): void {
  initializeDailyLife(world);
  const tick = worldTick(world);
  const settlementIds = selectDetailedSettlements(world, indexes, tick);
  const forcedTargets = [...new Set(options.forceCharacterIds ?? [])]
    .map(characterId => indexes.characterById.get(characterId))
    .filter((character): character is Character => Boolean(character?.alive && !isAwayWithArmy(character)));
  const forcedIds = new Set(forcedTargets.map(character => character.id));
  const regularTargets = settlementIds
    .flatMap(settlementId => residents(indexes, settlementId))
    .filter(character => character.alive && !isAwayWithArmy(character) && !forcedIds.has(character.id))
    .sort((a, b) => detailScore(world, b) - detailScore(world, a) || a.id - b.id);
  const targets = [...forcedTargets, ...regularTargets].slice(0, MAX_DETAILED_CHARACTERS);

  const refreshedIds = new Set(targets.map(character => character.id));
  const newRoutines = targets.map(character => buildDailyRoutine(world, character, tick));
  world.dailyRoutines = [
    ...(world.dailyRoutines ?? []).filter(routine => !refreshedIds.has(routine.characterId)),
    ...newRoutines,
  ].sort((a, b) => b.tick - a.tick || a.characterId - b.characterId).slice(0, MAX_ROUTINES);

  for (const routine of newRoutines) {
    const character = indexes.characterById.get(routine.characterId);
    if (!character) continue;
    character.schedule.currentActivity = routine.stops.find(stop => stop.phase === 'day')?.activity ?? character.schedule.currentActivity;
    character.schedule.lastRoutineTick = tick;
  }

  if (options.recordEvents !== false) {
    createRoutineEvents(world, rng, indexes, newRoutines, Math.max(1, options.elapsedMonths ?? 1));
    processMeetings(world, rng, indexes, newRoutines);
  }

  world.personalLifeEvents = (world.personalLifeEvents ?? [])
    .sort((a, b) => b.tick - a.tick || b.id - a.id)
    .slice(0, MAX_PERSONAL_EVENTS);
  world.simulation.lastDailyLifeTick = tick;
}

export function routineForCharacter(world: WorldState, character: Character): DailyRoutine {
  return (world.dailyRoutines ?? []).find(item => item.characterId === character.id)
    ?? buildDailyRoutine(world, character, worldTick(world));
}

export function routineStopForCharacter(world: WorldState, character: Character, phase: DayPhase): DailyRoutineStop {
  return routineForCharacter(world, character).stops.find(stop => stop.phase === phase)
    ?? routineForCharacter(world, character).stops[0]!;
}

export function personalEventsForCharacter(world: WorldState, characterId: number, limit = 18): PersonalLifeEvent[] {
  return (world.personalLifeEvents ?? [])
    .filter(event => event.characterId === characterId || event.otherCharacterIds.includes(characterId))
    .sort((a, b) => b.tick - a.tick || b.id - a.id)
    .slice(0, limit);
}

export function applyDailyLifePhaseToMap(world: WorldState, map: LocalMapData, phase: DayPhase): LocalMapData {
  if (map.level < 0) return map;
  map = applyInteriorLayoutToMap(world, map);
  const furniture = interiorMarkersForMap(world, map);
  const tile = world.tiles[map.globalY * world.config.width + map.globalX]
    ?? world.tiles.find(item => item.x === map.globalX && item.y === map.globalY);
  const settlement = tile?.settlementId ? world.settlements.find(item => item.id === tile.settlementId) : undefined;
  if (!settlement) return { ...map, markers: [...map.markers, ...furniture] };

  const fixedMarkers = map.markers.filter(marker => {
    if (marker.kind !== 'person') return true;
    return marker.refs.some(ref => ref.kind === 'army' || ref.kind === 'patrol');
  });
  const physicalOccupants = new Set<LocalMarker['kind']>(['person', 'patrol', 'army', 'monster', 'corpse', 'merchant', 'group']);
  const occupied = new Set<string>();
  for (const marker of fixedMarkers) {
    if (!physicalOccupants.has(marker.kind)) continue;
    const width = marker.footprintWidth ?? 1;
    const height = marker.footprintHeight ?? 1;
    for (let y = marker.y; y < marker.y + height; y += 1) for (let x = marker.x; x < marker.x + width; x += 1) occupied.add(`${x}:${y}`);
  }

  const armyIds = new Set(world.armies.flatMap(army => army.soldierIds ?? []));
  const merchantIds = new Set((world.travelingMerchants ?? []).map(merchant => merchant.characterId));
  const patrolIds = new Set((world.civicPatrols ?? []).flatMap(patrol => patrol.guardIds));
  const buildingGroups = new Map<number, { character: Character; stop: DailyRoutineStop }[]>();
  const outdoor: { character: Character; stop: DailyRoutineStop }[] = [];

  for (const character of world.characters) {
    if (!character.alive || character.settlementId !== settlement.id || armyIds.has(character.id) || merchantIds.has(character.id) || patrolIds.has(character.id)) continue;
    const stop = routineStopForCharacter(world, character, phase);
    if (stop.globalX !== map.globalX || stop.globalY !== map.globalY) continue;
    if (stop.buildingId) {
      if ((stop.interiorFloor ?? 0) !== map.level) continue;
      const group = buildingGroups.get(stop.buildingId) ?? [];
      group.push({ character, stop });
      buildingGroups.set(stop.buildingId, group);
    } else if (map.level === 0) outdoor.push({ character, stop });
  }

  const people: LocalMarker[] = [];
  for (const entry of outdoor.sort((a, b) => a.character.id - b.character.id)) {
    const point = claimNearby(map, entry.stop.localX, entry.stop.localY, occupied, `${world.config.seed}:распорядок:${entry.character.id}:${phase}:${world.year}:${world.month}`);
    if (point) people.push(personMarker(world, entry.character, entry.stop, point));
  }

  for (const [buildingId, entries] of [...buildingGroups].sort((a, b) => a[0] - b[0])) {
    const building = world.buildings.find(item => item.id === buildingId && item.globalX === map.globalX && item.globalY === map.globalY && item.floors > map.level);
    if (!building) continue;
    const ordered = [...entries].sort((a, b) => a.character.id - b.character.id);
    const interiorCount = map.cells.filter(cell => cell.buildingId === buildingId && !cell.blocked && cell.ground !== 'water').length;
    if (!interiorCount) continue;
    const visibleLimit = Math.min(interiorCount, visiblePeopleLimit(building));
    const reserveGroupCell = ordered.length > visibleLimit ? 1 : 0;
    const individualLimit = Math.max(0, Math.min(visibleLimit, interiorCount - reserveGroupCell));
    let placed = 0;
    for (const entry of ordered.slice(0, individualLimit)) {
      const point = claimInsideBuilding(
        map, buildingId, entry.stop.localX, entry.stop.localY, occupied,
        `${world.config.seed}:внутри:${buildingId}:${map.level}:${entry.character.id}:${phase}:${world.year}:${world.month}`,
      );
      if (!point) break;
      people.push(personMarker(world, entry.character, entry.stop, point));
      placed += 1;
    }
    const hidden = ordered.length - placed;
    if (hidden > 0) {
      const groupPoint = claimInsideBuilding(
        map, buildingId, building.localX + Math.floor(building.localWidth / 2), building.localY + Math.floor(building.localHeight / 2), occupied,
        `${world.config.seed}:группа-внутри:${buildingId}:${map.level}:${phase}:${world.year}:${world.month}`,
      );
      if (groupPoint) people.push({
        id: map.level === 0 ? `indoor-group-${buildingId}-${phase}` : `indoor-group-${buildingId}-${map.level}-${phase}`, x: groupPoint.x, y: groupPoint.y, kind: 'group',
        label: `${building.name}: ещё ${hidden}`, count: hidden,
        refs: ordered.slice(placed).slice(0, 12).map(entry => ({ kind: 'character' as const, id: entry.character.id })),
        detail: `${hidden} жителей находятся на этом этаже · ${ordered[0]?.stop.activity ?? 'заняты делами'}`,
        visualRole: building.type,
      });
    }
  }

  return { ...map, markers: [...fixedMarkers, ...furniture, ...people] };
}

function personMarker(world: WorldState, character: Character, stop: DailyRoutineStop, point: { x: number; y: number }): LocalMarker {
  const isRuler = world.kingdoms.some(kingdom => kingdom.rulerId === character.id);
  return {
    id: `person-${character.id}`, x: point.x, y: point.y, kind: 'person', label: character.name,
    refs: [{ kind: 'character', id: character.id }], detail: `${stop.activity} · ${stop.placeLabel}`,
    visualRole: isRuler ? 'king' : character.visualRole ?? character.profession,
  };
}

function visiblePeopleLimit(building: Building): number {
  // Лимит больше не режет школу, казарму или мастерскую до нескольких случайных фигур.
  // Фактический предел задаёт число свободных клеток интерьера; верхние этажи сворачиваются в группу.
  return Math.max(12, building.capacity, building.workerIds.length, building.residentIds.length);
}

function claimInsideBuilding(
  map: LocalMapData,
  buildingId: number,
  desiredX: number,
  desiredY: number,
  occupied: Set<string>,
  seed: string,
): { x: number; y: number } | undefined {
  const tieSeed = hashSeed(seed);
  const candidates = map.cells
    .filter(cell => cell.buildingId === buildingId && !cell.blocked && cell.ground !== 'water' && !occupied.has(`${cell.x}:${cell.y}`))
    .sort((a, b) => {
      const doorPenaltyA = a.feature === 'door' ? 1000 : 0;
      const doorPenaltyB = b.feature === 'door' ? 1000 : 0;
      const distanceA = Math.abs(a.x - desiredX) + Math.abs(a.y - desiredY) + doorPenaltyA;
      const distanceB = Math.abs(b.x - desiredX) + Math.abs(b.y - desiredY) + doorPenaltyB;
      if (distanceA !== distanceB) return distanceA - distanceB;
      return (hashSeed(`${tieSeed}:${a.x}:${a.y}`) >>> 0) - (hashSeed(`${tieSeed}:${b.x}:${b.y}`) >>> 0);
    });
  const point = candidates[0];
  if (!point) return undefined;
  occupied.add(`${point.x}:${point.y}`);
  return { x: point.x, y: point.y };
}

function selectDetailedSettlements(world: WorldState, indexes: WorldIndexes, tick: number): number[] {
  const result: number[] = [];
  const add = (id?: number) => { if (id !== undefined && indexes.settlementById.has(id) && !result.includes(id)) result.push(id); };
  const activeKeys = new Set(world.simulation.activeRegionKeys ?? []);
  const active = world.settlements
    .filter(settlement => settlement.districts.some(district => activeKeys.has(`${district.x}:${district.y}`)))
    .sort((a, b) => crisisScore(b) - crisisScore(a) || a.id - b.id);
  active.slice(0, 2).forEach(settlement => add(settlement.id));

  const capitals = world.kingdoms
    .map(kingdom => indexes.settlementById.get(kingdom.capitalId))
    .filter((item): item is Settlement => Boolean(item))
    .sort((a, b) => b.population - a.population || a.id - b.id);
  add(capitals[tick % Math.max(1, capitals.length)]?.id);

  const ordered = [...world.settlements].sort((a, b) => a.id - b.id);
  if (ordered.length) {
    add(ordered[tick % ordered.length]!.id);
    add(ordered[(tick * 7 + 3) % ordered.length]!.id);
  }
  return result.slice(0, 4);
}

function crisisScore(settlement: Settlement): number {
  return settlement.unrest + settlement.damaged + settlement.shortages.length * 18 + Math.max(0, settlement.population - settlement.residentialCapacity) * 2;
}

function detailScore(world: WorldState, character: Character): number {
  return character.renown * 2 + character.titles.length * 30 + character.childIds.length * 5
    + (character.relationshipIds?.length ?? 0) * 2 + (character.health < 60 ? 24 : 0)
    + hashSeed(`${world.config.seed}:повседневность:${worldTick(world)}:${character.id}`) % 20;
}

function isAwayWithArmy(character: Character): boolean {
  return ['поход', 'пленник'].includes(character.serviceStatus ?? '') || Boolean(character.prisonerOfBattleId);
}

function buildDailyRoutine(world: WorldState, character: Character, tick: number): DailyRoutine {
  const settlement = world.settlements.find(item => item.id === character.settlementId)!;
  const home = character.homeBuildingId ? world.buildings.find(item => item.id === character.homeBuildingId) : undefined;
  const work = character.workplaceBuildingId ? world.buildings.find(item => item.id === character.workplaceBuildingId) : undefined;
  const buildings = world.buildings.filter(item => item.settlementId === settlement.id);
  const temple = buildings.find(item => item.type === 'temple');
  const healer = buildings.find(item => item.type === 'healer' || item.type === 'bathhouse');
  const school = schoolBuildingForCharacter(world, character);
  const prison = buildings.find(item => item.type === 'prison');
  const barracks = buildings.find(item => item.type === 'barracks');
  const market = buildings.find(item => item.type === 'market' || item.type === 'shop' || Boolean(item.establishmentId && ['рынок', 'лавка', 'продовольственная лавка', 'одежная лавка', 'оружейная лавка'].includes(world.establishments.find(establishment => establishment.id === item.establishmentId)?.type ?? '')));
  const tavern = buildings.find(item => item.type === 'tavern' || item.type === 'inn');
  const townHall = buildings.find(item => item.type === 'townHall' || item.type === 'courthouse');
  const castle = buildings.find(item => item.type === 'castle' || item.type === 'manor');
  const primaryGoal = [...(character.mind?.goals ?? [])]
    .filter(goal => goal.status === 'active' || goal.status === 'blocked')
    .sort((a, b) => b.priority - a.priority || b.updatedTick - a.updatedTick)[0];

  const morning = home
    ? stopAtBuilding(world, character, 'morning', home, isSchoolAgeCharacter(character) ? 'просыпается в семье и завтракает' : 'просыпается, ест и готовится к делам', 'home')
    : stopInSettlement(world, character, settlement, 'morning', 'ищет воду и еду на улице', 'street');

  let day: DailyRoutineStop;
  if (character.legalStatus === 'заключён' || character.legalStatus === 'под стражей') {
    day = prison ? stopAtBuilding(world, character, 'day', prison, 'проводит день под стражей', 'prison') : stopInSettlement(world, character, settlement, 'day', 'остаётся под надзором стражи', 'street');
  } else if (character.health < 42 && healer) {
    day = stopAtBuilding(world, character, 'day', healer, 'получает лечение и отдыхает', 'healer');
  } else if (school && isSchoolAgeCharacter(character)) {
    day = stopAtBuilding(world, character, 'day', school, 'учится вместе с другими детьми', 'school');
  } else if (primaryGoal?.kind === 'serve_faith' && temple) {
    day = stopAtBuilding(world, character, 'day', temple, 'служит вере и укрепляет связи с прихожанами', 'temple');
  } else if (primaryGoal?.kind === 'gain_power' && (townHall || castle)) {
    day = stopAtBuilding(world, character, 'day', townHall ?? castle!, 'ищет поддержку, должность и политические связи', 'work');
  } else if (primaryGoal?.kind === 'protect_home' && barracks) {
    day = stopAtBuilding(world, character, 'day', barracks, 'готовится защищать поселение и помогает страже', 'barracks');
  } else if (primaryGoal?.kind === 'explore' && (tavern || market)) {
    day = stopAtBuilding(world, character, 'day', tavern ?? market!, 'собирает сведения о дорогах и готовится к путешествию', tavern ? 'tavern' : 'market');
  } else if (primaryGoal?.kind === 'revenge' && (tavern || market)) {
    day = stopAtBuilding(world, character, 'day', tavern ?? market!, 'расспрашивает людей и ищет след виновника', tavern ? 'tavern' : 'market');
  } else if (character.profession === 'priest' && temple) {
    day = stopAtBuilding(world, character, 'day', temple, 'служит в храме и принимает прихожан', 'temple');
  } else if (['гарнизон', 'резерв'].includes(character.serviceStatus ?? '') && barracks) {
    day = stopAtBuilding(world, character, 'day', barracks, 'проходит службу и занимается снаряжением', 'barracks');
  } else if (work) {
    day = stopAtBuilding(world, character, 'day', work, workActivity(character), 'work');
  } else if (market) {
    day = stopAtBuilding(world, character, 'day', market, !isSchoolAgeCharacter(character) ? 'ищет работу, товары и новости' : 'помогает семье на рынке', 'market');
  } else {
    day = stopInSettlement(world, character, settlement, 'day', !isSchoolAgeCharacter(character) ? 'занят случайной работой' : 'проводит день рядом с домом', 'street');
  }

  const eveningRoll = hashSeed(`${world.config.seed}:вечер:${tick}:${character.id}`) % 100;
  let evening: DailyRoutineStop;
  if (character.health < 50 && home) evening = stopAtBuilding(world, character, 'evening', home, 'раньше возвращается домой из-за слабости', 'home');
  else if ((character.mind?.values.faith ?? 0) > 65 && temple && eveningRoll < 55) evening = stopAtBuilding(world, character, 'evening', temple, 'молится и встречает знакомых', 'temple');
  else if (character.age >= 16 && tavern && eveningRoll < 34) evening = stopAtBuilding(world, character, 'evening', tavern, 'ужинает, разговаривает и слушает новости', 'tavern');
  else if (market && eveningRoll < 62) evening = stopAtBuilding(world, character, 'evening', market, 'покупает нужное и разговаривает с торговцами', 'market');
  else if (home) evening = stopAtBuilding(world, character, 'evening', home, 'проводит вечер с домочадцами', 'home');
  else evening = stopInSettlement(world, character, settlement, 'evening', 'ищет ночлег и безопасное место', 'street');

  let night: DailyRoutineStop;
  if (character.legalStatus === 'заключён' && prison) night = stopAtBuilding(world, character, 'night', prison, 'спит в камере', 'prison');
  else if (['гарнизон'].includes(character.serviceStatus ?? '') && barracks) night = stopAtBuilding(world, character, 'night', barracks, 'ночует при казармах', 'barracks');
  else if (home) night = stopAtBuilding(world, character, 'night', home, 'спит дома', 'home');
  else night = stopInSettlement(world, character, settlement, 'night', 'ночует на улице или в общем приюте', 'street');

  return { characterId: character.id, tick, year: world.year, month: world.month, stops: [morning, day, evening, night] };
}

function workActivity(character: Character): string {
  const activity: Record<string, string> = {
    farmer: 'работает в поле и следит за хозяйством', blacksmith: 'куёт и чинит металлические вещи', carpenter: 'пилит древесину и собирает изделия',
    merchant: 'торгует и считает деньги', guard: 'несёт службу и проверяет улицы', soldier: 'тренируется и обслуживает оружие', healer: 'лечит больных',
    priest: 'служит в храме', scribe: 'ведёт записи и переписывает документы', hunter: 'готовит добычу и снаряжение', fisher: 'работает с сетями и уловом',
    miner: 'добывает руду и камень', weaver: 'прядёт и ткёт полотно', tailor: 'шьёт и чинит одежду', brewer: 'варит напитки и следит за бочками',
  };
  return activity[character.profession] ?? `работает: ${character.workplace}`;
}

function stopAtBuilding(
  world: WorldState,
  character: Character,
  phase: DayPhase,
  building: Building,
  activity: string,
  placeKind: DailyPlaceKind,
): DailyRoutineStop {
  const assignmentKind = interiorAssignmentKind(phase, placeKind, character);
  const interior = interiorPositionForCharacter(world, character, building, assignmentKind);
  const innerWidth = Math.max(1, building.localWidth - 2);
  const innerHeight = Math.max(1, building.localHeight - 2);
  const fallbackX = building.localX + Math.min(building.localWidth - 1, 1 + hashSeed(`${world.config.seed}:место:${phase}:${character.id}:${building.id}:x`) % innerWidth);
  const fallbackY = building.localY + Math.min(building.localHeight - 1, 1 + hashSeed(`${world.config.seed}:место:${phase}:${character.id}:${building.id}:y`) % innerHeight);
  const placeLabel = interior
    ? `${building.name} · ${interior.roomName} · ${interior.fixtureLabel}${interior.floor ? ` · этаж ${interior.floor + 1}` : ''}`
    : building.name;
  const resolvedActivity = interior ? activity
    : placeKind === 'school' ? 'не получил место в классе и ждёт свободную парту'
      : phase === 'day' && (placeKind === 'work' || placeKind === 'barracks') ? 'не может начать работу: нет свободного рабочего места'
        : phase === 'night' && (placeKind === 'home' || placeKind === 'barracks') ? 'спит без нормального спального места'
          : activity;
  return {
    phase, activity: resolvedActivity, placeKind, placeLabel, settlementId: character.settlementId,
    globalX: building.globalX, globalY: building.globalY, localX: interior?.x ?? fallbackX, localY: interior?.y ?? fallbackY,
    buildingId: building.id, establishmentId: building.establishmentId,
    interiorFloor: interior?.floor,
    interiorRoomId: interior?.roomId,
    interiorFixtureId: interior?.fixtureId,
  };
}

function interiorAssignmentKind(phase: DayPhase, placeKind: DailyPlaceKind, character: Character): InteriorAssignmentKind {
  if (placeKind === 'prison') return 'prison';
  if (placeKind === 'school') return 'school';
  if (placeKind === 'healer') return character.health < 55 ? 'treatment' : character.profession === 'healer' || character.profession === 'herbalist' ? 'work' : 'seat';
  if (phase === 'day' && placeKind === 'temple' && character.profession === 'priest') return 'work';
  if (phase === 'night' && (placeKind === 'home' || placeKind === 'barracks')) return 'sleep';
  if (phase === 'day' && (placeKind === 'work' || placeKind === 'barracks' || placeKind === 'market')) return 'work';
  return 'seat';
}

function stopInSettlement(
  world: WorldState,
  character: Character,
  settlement: Settlement,
  phase: DayPhase,
  activity: string,
  placeKind: DailyPlaceKind,
): DailyRoutineStop {
  const districts = settlement.districts.length ? settlement.districts : [{ x: settlement.x, y: settlement.y, name: 'Сердце поселения', role: 'центр' as const }];
  const preferred = placeKind === 'market' ? districts.find(item => item.role === 'рынок')
    : placeKind === 'street' && phase === 'night' ? districts.find(item => item.role === 'окраина')
      : districts.find(item => item.name === character.homeDistrict) ?? districts[0];
  const district = preferred ?? districts[0]!;
  const size = world.config.localMapSize ?? 128;
  return {
    phase, activity, placeKind, placeLabel: district.name, settlementId: settlement.id,
    globalX: district.x, globalY: district.y,
    localX: 5 + hashSeed(`${world.config.seed}:улица:${phase}:${character.id}:x`) % Math.max(1, size - 10),
    localY: 5 + hashSeed(`${world.config.seed}:улица:${phase}:${character.id}:y`) % Math.max(1, size - 10),
  };
}

function createRoutineEvents(world: WorldState, rng: RNG, indexes: WorldIndexes, routines: DailyRoutine[], elapsedMonths: number): void {
  for (const routine of routines) {
    const character = indexes.characterById.get(routine.characterId);
    if (!character) continue;
    const day = routine.stops.find(stop => stop.phase === 'day')!;
    const evening = routine.stops.find(stop => stop.phase === 'evening')!;
    advanceGoalFromRoutine(world, character, day, evening, elapsedMonths);
    const roll = hashSeed(`${world.config.seed}:личное-событие:${routine.tick}:${character.id}`) % 100;

    if (character.health < 48 && roll < 65) {
      addPersonalEvent(world, character.id, [], 'day', 'health', `${character.name} провёл день в слабости`, `${day.placeLabel}: здоровье мешало обычным делам.`, character.settlementId, [{ kind: 'character', id: character.id }], 1);
      continue;
    }
    if (character.needs.hunger > 55 && roll < 72) {
      addPersonalEvent(world, character.id, [], 'evening', 'need', `${character.name} остался голодным`, 'Денег или запасов не хватило на нормальную вечернюю еду.', character.settlementId, character.householdId ? [{ kind: 'household', id: character.householdId }] : [], 1);
      continue;
    }
    if (day.placeKind === 'work' && day.interiorFixtureId && roll < Math.min(55, 13 * elapsedMonths)) {
      const skill = character.skills[character.profession] ?? 0;
      character.skills[character.profession] = Math.min(100, Math.round((skill + .2 + rng.next() * .6) * 100) / 100);
      addPersonalEvent(world, character.id, [], 'day', 'work', `${character.name} хорошо справился с работой`, `${day.activity}. Навык постепенно вырос.`, character.settlementId, day.buildingId ? [{ kind: 'building', id: day.buildingId }] : [], 0);
      continue;
    }
    if (evening.placeKind === 'tavern' && roll < 42) {
      addPersonalEvent(world, character.id, [], 'evening', 'routine', `${character.name} провёл вечер в заведении`, `${evening.placeLabel}: еда, разговоры и местные новости.`, character.settlementId, evening.establishmentId ? [{ kind: 'establishment', id: evening.establishmentId }] : [], 0);
      continue;
    }
    if (evening.placeKind === 'temple' && roll < 48) {
      addPersonalEvent(world, character.id, [], 'evening', 'faith', `${character.name} посетил храм`, `${evening.placeLabel}: молитва и разговоры с прихожанами.`, character.settlementId, evening.buildingId ? [{ kind: 'building', id: evening.buildingId }] : [], 0);
      continue;
    }
    if (evening.placeKind === 'home' && character.childIds.length && roll < 30) {
      addPersonalEvent(world, character.id, character.childIds.slice(0, 3), 'evening', 'family', `${character.name} провёл вечер с семьёй`, 'Домочадцы ели вместе и обсуждали дела дома.', character.settlementId, character.householdId ? [{ kind: 'household', id: character.householdId }] : [], 0);
    }
  }
}


function advanceGoalFromRoutine(
  world: WorldState,
  character: Character,
  day: DailyRoutineStop,
  evening: DailyRoutineStop,
  elapsedMonths: number,
): void {
  const goal = [...(character.mind?.goals ?? [])]
    .filter(item => item.status === 'active' || item.status === 'blocked')
    .sort((a, b) => b.priority - a.priority || b.updatedTick - a.updatedTick)[0];
  if (!goal) return;
  const before = goal.progress ?? 0;
  let gain = 0;
  if (goal.kind === 'survive') gain = day.placeKind === 'healer' || evening.placeKind === 'home' ? 4 : 1;
  else if (goal.kind === 'feed_family') gain = day.placeKind === 'work' || day.placeKind === 'market' ? 3 : 1;
  else if (goal.kind === 'earn_wealth') gain = day.placeKind === 'work' ? 3 : day.placeKind === 'market' ? 2 : .5;
  else if (goal.kind === 'gain_power') gain = day.activity.includes('поддерж') || day.activity.includes('политичес') ? 3 : 1;
  else if (goal.kind === 'protect_home') gain = day.placeKind === 'barracks' ? 3 : 1;
  else if (goal.kind === 'serve_faith') gain = day.placeKind === 'temple' || evening.placeKind === 'temple' ? 3 : 1;
  else if (goal.kind === 'revenge') gain = day.activity.includes('след') || day.activity.includes('расспраш') ? 2 : .5;
  else if (goal.kind === 'escape_justice') gain = character.legalStatus === 'сбежал' ? 5 : character.legalStatus === 'разыскивается' ? 2 : .5;
  else if (goal.kind === 'master_craft') gain = day.placeKind === 'work' ? 3 : 1;
  else if (goal.kind === 'explore') gain = day.activity.includes('дорог') || day.activity.includes('путешеств') ? 3 : .75;
  goal.progress = clamp(Math.max(before, before + gain * Math.max(1, elapsedMonths)));
  goal.updatedTick = worldTick(world);
  const crossed = [25, 50, 75, 100].find(value => before < value && goal.progress >= value);
  if (!crossed) return;
  addPersonalEvent(
    world,
    character.id,
    [],
    'evening',
    'goal',
    crossed >= 100 ? `${character.name} достиг важной жизненной цели` : `${character.name} продвинулся к своей цели`,
    `${goal.reason}. Прогресс: ${Math.round(goal.progress)}%.`,
    character.settlementId,
    [{ kind: 'character', id: character.id }, ...(goal.targetRef ? [goal.targetRef] : [])],
    crossed >= 100 ? 2 : 1,
  );
}

function processMeetings(world: WorldState, rng: RNG, indexes: WorldIndexes, routines: DailyRoutine[]): void {
  const groups = new Map<string, { routine: DailyRoutine; stop: DailyRoutineStop }[]>();
  for (const routine of routines) for (const stop of routine.stops) {
    if (stop.phase === 'night') continue;
    const place = stop.buildingId ? `building:${stop.buildingId}` : `${stop.globalX}:${stop.globalY}:${Math.floor(stop.localX / 12)}:${Math.floor(stop.localY / 12)}`;
    const key = `${stop.phase}:${place}`;
    const list = groups.get(key) ?? [];
    list.push({ routine, stop });
    groups.set(key, list);
  }

  let processed = 0;
  for (const [key, entries] of groups) {
    if (processed >= 90 || entries.length < 2) continue;
    entries.sort((a, b) => a.routine.characterId - b.routine.characterId);
    const offset = hashSeed(`${world.config.seed}:встреча:${worldTick(world)}:${key}`) % entries.length;
    for (let index = 0; index + 1 < entries.length && processed < 90; index += 2) {
      const first = entries[(index + offset) % entries.length]!;
      const second = entries[(index + offset + 1) % entries.length]!;
      if (first.routine.characterId === second.routine.characterId) continue;
      const chance = first.stop.placeKind === 'tavern' || first.stop.placeKind === 'market' ? .55 : first.stop.placeKind === 'work' ? .38 : .24;
      if (!rng.chance(chance)) continue;
      const a = indexes.characterById.get(first.routine.characterId);
      const b = indexes.characterById.get(second.routine.characterId);
      if (!a || !b) continue;
      touchRelationship(world, indexes, a, b, first.stop.placeKind);
      addPersonalEvent(world, a.id, [b.id], first.stop.phase, 'meeting', `${a.name} встретил ${b.name}`, `${first.stop.placeLabel}: короткий разговор повлиял на их знакомство.`, a.settlementId, [{ kind: 'character', id: a.id }, { kind: 'character', id: b.id }], 0);
      processed += 1;
    }
  }
}

function touchRelationship(world: WorldState, indexes: WorldIndexes, a: Character, b: Character, placeKind: DailyPlaceKind): void {
  const existing = indexes.relationshipByPair.get(relationshipKey(a.id, b.id));
  if (existing) {
    existing.familiarity = clamp((existing.familiarity ?? 0) + 1.5);
    existing.interactionCount = (existing.interactionCount ?? 0) + 1;
    existing.lastInteractionTick = worldTick(world);
    existing.trust = clampSigned((existing.trust ?? 0) + (placeKind === 'work' || placeKind === 'temple' ? .8 : .35));
    existing.strength = Math.max(existing.strength, Math.round(Math.abs(existing.trust ?? 0) + (existing.familiarity ?? 0) * .2));
    existing.history ??= [];
    if ((existing.history.length === 0 || existing.history.at(-1) !== `Встречались в ${world.year}.${String(world.month).padStart(2, '0')}.`) && existing.interactionCount % 6 === 0) {
      existing.history.push(`Встречались в ${world.year}.${String(world.month).padStart(2, '0')}.`);
      if (existing.history.length > 12) existing.history.shift();
    }
    return;
  }

  if (hashSeed(`${world.config.seed}:новое-знакомство:${worldTick(world)}:${relationshipKey(a.id, b.id)}`) % 100 >= 28) return;
  const relationship: Relationship = {
    id: world.nextIds.relationship++, characterAId: a.id, characterBId: b.id, kind: 'дружба', strength: 5,
    sinceYear: world.year, public: true, reason: `познакомились: ${placeKind}`, contexts: [placeKind === 'work' ? 'work' : placeKind === 'temple' ? 'faith' : placeKind === 'market' || placeKind === 'tavern' ? 'market' : 'neighbors'],
    trust: 3, affection: 1, respect: 2, fear: 0, tension: 0, familiarity: 6, interactionCount: 1,
    lastInteractionTick: worldTick(world), status: 'distant', history: [`Познакомились в ${world.year}.${String(world.month).padStart(2, '0')}.`],
  };
  world.relationships.push(relationship);
  a.relationshipIds.push(relationship.id);
  b.relationshipIds.push(relationship.id);
  indexRelationship(indexes, relationship);
}

function addPersonalEvent(
  world: WorldState,
  characterId: number,
  otherCharacterIds: number[],
  phase: DayPhase,
  kind: PersonalLifeEventKind,
  title: string,
  description: string,
  settlementId: number,
  relatedRefs: PersonalLifeEvent['relatedRefs'],
  importance: PersonalLifeEvent['importance'],
): void {
  initializeDailyLife(world);
  const tick = worldTick(world);
  const duplicate = (world.personalLifeEvents ?? []).some(event => event.tick === tick && event.characterId === characterId && event.kind === kind && event.title === title);
  if (duplicate) return;
  world.personalLifeEvents!.push({
    id: world.nextIds.personalLifeEvent++, characterId, otherCharacterIds: [...new Set(otherCharacterIds)], tick,
    year: world.year, month: world.month, phase, kind, title, description, settlementId, relatedRefs, importance,
  });
}

function claimNearby(map: LocalMapData, desiredX: number, desiredY: number, occupied: Set<string>, seed: string): { x: number; y: number } | undefined {
  const start = hashSeed(seed) % 8;
  const directions = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (let radius = 0; radius <= 6; radius += 1) {
    for (let index = 0; index < directions.length; index += 1) {
      const [dx, dy] = directions[(index + start) % directions.length]!;
      const x = Math.max(0, Math.min(map.width - 1, desiredX + dx * radius));
      const y = Math.max(0, Math.min(map.height - 1, desiredY + dy * radius));
      const key = `${x}:${y}`;
      const cell = map.cells[y * map.width + x];
      if (!cell || cell.blocked || cell.ground === 'water' || occupied.has(key)) continue;
      occupied.add(key);
      return { x, y };
    }
  }
  return undefined;
}

function clamp(value: number): number { return Math.max(0, Math.min(100, Math.round(value * 100) / 100)); }
function clampSigned(value: number): number { return Math.max(-100, Math.min(100, Math.round(value * 100) / 100)); }
