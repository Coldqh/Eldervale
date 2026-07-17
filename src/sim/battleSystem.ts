import type {
  Army, BattleRecord, BattleUnitRole, BattleUnitState, Character, MilitaryUnit, Settlement, War, WorldItem, WorldState,
} from '../types';
import type { WorldIndexes } from './indexes';
import { appendCausalEvent } from './causality';
import { addBattleInjury } from './healthSystem';
import { archiveCharactersBatch } from './mortality';
import { hashSeed, RNG } from './rng';
import { synchronizeArmyStrength } from './militaryInfrastructure';

const MAX_BATTLE_RECORDS = 900;

export interface SpatialBattleOutcome {
  record: BattleRecord;
  attackerWon: boolean;
  attackerDead: number;
  defenderDead: number;
  attackerWounded: number;
  defenderWounded: number;
  attackerCaptured: number;
  defenderCaptured: number;
}

interface SideRuntime {
  army: Army;
  units: MilitaryUnit[];
  states: BattleUnitState[];
  defenseBonus: number;
}

interface SideLossPlan {
  dead: number;
  wounded: number;
  captured: number;
  routed: boolean;
}

export function initializeBattleSystem(world: WorldState): void {
  world.battleRecords ??= [];
  world.nextIds.battleRecord ??= Math.max(0, ...world.battleRecords.map(item => item.id)) + 1;
  for (const record of world.battleRecords) normalizeBattleRecord(record);
  world.simulation.battleSystemVersion = 1;
}

export function resolveSpatialArmyBattle(
  world: WorldState,
  attacker: Army,
  defender: Army,
  war: War | undefined,
  settlement: Settlement | undefined,
  rng: RNG,
  indexes: WorldIndexes,
): SpatialBattleOutcome {
  initializeBattleSystem(world);
  const attackerSide = makeSide(world, attacker, false, 0);
  const defenderSide = makeSide(world, defender, true, settlement ? Math.max(0, settlement.defense * .42) : 0);
  const record: BattleRecord = {
    id: world.nextIds.battleRecord++, warId: war?.id, year: world.year, month: world.month,
    globalX: attacker.x, globalY: attacker.y, settlementId: settlement?.id,
    attackerArmyId: attacker.id, defenderArmyId: defender.id, phase: 'сближение', rounds: 0,
    attackerUnitStates: attackerSide.states, defenderUnitStates: defenderSide.states,
    attackerDead: 0, defenderDead: 0, attackerWounded: 0, defenderWounded: 0,
    attackerCaptured: 0, defenderCaptured: 0, prisonerIds: [], woundedIds: [], lootedItemIds: [], destroyedWagonIds: [],
    history: [`Сражение началось в ${world.year}.${String(world.month).padStart(2, '0')}.`],
  };
  world.battleRecords.push(record);

  const maxRounds = 3 + rng.int(0, 2);
  let attackerRouted = false;
  let defenderRouted = false;
  for (let round = 1; round <= maxRounds; round += 1) {
    record.rounds = round;
    record.phase = round === 1 ? 'перестрелка' : 'схватка';
    const attackPower = sidePower(attackerSide, defenderSide, round, rng);
    const defensePower = sidePower(defenderSide, attackerSide, round, rng) + defenderSide.defenseBonus;
    const attackerPressure = defensePower / Math.max(1, attackPower + defensePower);
    const defenderPressure = attackPower / Math.max(1, attackPower + defensePower);
    applyRoundPressure(attackerSide, attackerPressure, round, rng);
    applyRoundPressure(defenderSide, defenderPressure, round, rng);
    attackerRouted = sideRouted(attackerSide, rng);
    defenderRouted = sideRouted(defenderSide, rng);
    record.history.push(`Раунд ${round}: давление ${Math.round(defenderPressure * 100)}% на защитников и ${Math.round(attackerPressure * 100)}% на атакующих.`);
    if (attackerRouted || defenderRouted) break;
  }

  const attackerScore = survivingPower(attackerSide) * (attackerRouted ? .35 : 1);
  const defenderScore = survivingPower(defenderSide) * (defenderRouted ? .35 : 1) + defenderSide.defenseBonus;
  const attackerWon = defenderRouted || (!attackerRouted && attackerScore > defenderScore);
  record.phase = attackerRouted || defenderRouted ? 'бегство' : 'последствия';
  record.winnerArmyId = attackerWon ? attacker.id : defender.id;

  const attackerPlan = lossPlan(attackerSide, attackerRouted || !attackerWon, rng);
  const defenderPlan = lossPlan(defenderSide, defenderRouted || attackerWon, rng);
  const attackerApplied = applyPersonnelOutcome(world, attackerSide, attackerPlan, defender.kingdomId, record, rng, indexes, settlement?.id);
  const defenderApplied = applyPersonnelOutcome(world, defenderSide, defenderPlan, attacker.kingdomId, record, rng, indexes, settlement?.id);

  record.attackerDead = attackerApplied.dead;
  record.defenderDead = defenderApplied.dead;
  record.attackerWounded = attackerApplied.wounded;
  record.defenderWounded = defenderApplied.wounded;
  record.attackerCaptured = attackerApplied.captured;
  record.defenderCaptured = defenderApplied.captured;
  record.prisonerIds.push(...attackerApplied.prisonerIds, ...defenderApplied.prisonerIds);
  record.woundedIds.push(...attackerApplied.woundedIds, ...defenderApplied.woundedIds);

  const winner = attackerWon ? attacker : defender;
  const loser = attackerWon ? defender : attacker;
  captureBattlefieldSupplies(world, winner, loser, record, rng, settlement);

  attacker.morale = clamp(attacker.morale + (attackerWon ? 7 : -18) - attackerApplied.dead * .04 - attackerApplied.captured * .08, 5, 100);
  defender.morale = clamp(defender.morale + (attackerWon ? -18 : 7) - defenderApplied.dead * .04 - defenderApplied.captured * .08, 5, 100);
  attacker.readiness = clamp(attacker.readiness - attackerApplied.dead * .08 - attackerApplied.wounded * .04, 0, 100);
  defender.readiness = clamp(defender.readiness - defenderApplied.dead * .08 - defenderApplied.wounded * .04, 0, 100);
  synchronizeArmyStrength(world, attacker);
  synchronizeArmyStrength(world, defender);

  record.phase = 'последствия';
  record.history.push(`${winner.name} удержало поле боя. Погибло ${record.attackerDead + record.defenderDead}, ранено ${record.attackerWounded + record.defenderWounded}, пленено ${record.attackerCaptured + record.defenderCaptured}.`);
  trimBattleRecords(world);
  return {
    record, attackerWon,
    attackerDead: record.attackerDead, defenderDead: record.defenderDead,
    attackerWounded: record.attackerWounded, defenderWounded: record.defenderWounded,
    attackerCaptured: record.attackerCaptured, defenderCaptured: record.defenderCaptured,
  };
}

export function releaseWarPrisoners(world: WorldState, war: War): number {
  initializeBattleSystem(world);
  const battleIds = new Set(world.battleRecords.filter(record => record.warId === war.id).map(record => record.id));
  let released = 0;
  for (const character of world.characters) {
    if (!character.prisonerOfBattleId || !battleIds.has(character.prisonerOfBattleId)) continue;
    character.capturedByKingdomId = undefined;
    character.prisonerOfBattleId = undefined;
    character.serviceStatus = 'ветеран';
    character.workplace = 'возвращается после плена';
    character.biography.push(`Освобождён после завершения войны в ${world.year} году.`);
    released += 1;
  }
  if (released) war.history.push(`После мира освобождено ${released} военнопленных.`);
  return released;
}

export function battleSystemIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const armyIds = new Set(world.armies.map(item => item.id));
  const warIds = new Set(world.wars.map(item => item.id));
  const characterIds = new Set([
    ...world.characters.map(item => item.id),
    ...world.burials.filter(item => item.subjectKind === 'character' && typeof item.subjectId === 'number').map(item => item.subjectId!),
  ]);
  const recordIds = new Set<number>();
  for (const record of world.battleRecords ?? []) {
    if (recordIds.has(record.id)) issues.push(`Сражение ${record.id}: повторяющийся ID`);
    recordIds.add(record.id);
    if (record.warId && !warIds.has(record.warId)) issues.push(`Сражение ${record.id}: отсутствует война`);
    for (const id of record.prisonerIds) if (!characterIds.has(id)) issues.push(`Сражение ${record.id}: отсутствует пленный ${id}`);
    for (const state of [...record.attackerUnitStates, ...record.defenderUnitStates]) {
      if (state.remainingCount < 0 || state.remainingCount > state.initialCount) issues.push(`Сражение ${record.id}: неверная численность подразделения ${state.unitId}`);
    }
  }
  for (const character of world.characters) {
    if (character.serviceStatus === 'пленник' && (!character.prisonerOfBattleId || !recordIds.has(character.prisonerOfBattleId))) issues.push(`${character.name}: плен без записи сражения`);
  }
  return [...new Set(issues)];
}

function makeSide(world: WorldState, army: Army, defending: boolean, defenseBonus: number): SideRuntime {
  const units = army.unitIds.map(id => world.militaryUnits.find(item => item.id === id)).filter((item): item is MilitaryUnit => Boolean(item));
  const effectiveUnits = units.length ? units : [syntheticUnit(army)];
  const states = effectiveUnits.map((unit, index) => ({
    unitId: unit.id, armyId: army.id, role: roleFor(unit, index, effectiveUnits.length, defending),
    initialCount: unit.memberIds.length, remainingCount: unit.memberIds.length,
    morale: clamp(army.morale * .62 + unit.cohesion * .38, 0, 100), cohesion: unit.cohesion,
    fatigue: army.status === 'marching' ? 18 : 8, casualties: 0, wounded: 0, captured: 0, routed: false,
  }));
  return { army, units: effectiveUnits, states, defenseBonus };
}

function syntheticUnit(army: Army): MilitaryUnit {
  return {
    id: -army.id, armyId: army.id, kingdomId: army.kingdomId, name: `${army.name}: сводный строй`, type: 'пехота', commanderId: army.commanderId,
    memberIds: [...army.soldierIds], training: army.readiness, cohesion: army.morale, equipmentCoverage: army.logistics.equipmentCoverage,
    horseCount: army.logistics.horses, experience: army.readiness, history: [],
  };
}

function roleFor(unit: MilitaryUnit, index: number, total: number, defending: boolean): BattleUnitRole {
  if (unit.type === 'стрелки') return 'missile';
  if (unit.type === 'конница' || unit.type === 'рыцари') return 'flank';
  if (unit.type === 'штаб' || index === total - 1 && total >= 4) return 'reserve';
  if (defending && unit.type === 'копейщики') return 'front';
  return 'front';
}

function sidePower(side: SideRuntime, enemy: SideRuntime, round: number, rng: RNG): number {
  let total = 0;
  const enemyFront = enemy.states.filter(state => !state.routed && state.role === 'front').reduce((sum, state) => sum + state.remainingCount, 0);
  for (let index = 0; index < side.states.length; index += 1) {
    const state = side.states[index]!;
    if (state.routed || state.remainingCount <= 0) continue;
    const unit = side.units[index] ?? side.units[0]!;
    const roleFactor = state.role === 'missile' ? (round === 1 ? 1.42 : .72)
      : state.role === 'flank' ? (enemyFront > 0 ? 1.16 : 1.42)
        : state.role === 'reserve' ? (round === 1 ? .38 : 1.18) : 1;
    const typeFactor = unit.type === 'рыцари' ? 1.35 : unit.type === 'конница' ? 1.2 : unit.type === 'копейщики' ? 1.08 : unit.type === 'ополчение' ? .76 : 1;
    const preparation = .46 + unit.training / 190 + unit.experience / 260 + unit.equipmentCoverage * .28;
    const discipline = .42 + state.morale / 220 + state.cohesion / 230;
    const fatigue = Math.max(.38, 1 - state.fatigue / 135);
    total += state.remainingCount * roleFactor * typeFactor * preparation * discipline * fatigue;
  }
  return total * (.88 + rng.int(0, 24) / 100) * (.7 + side.army.supplies / 260);
}

function applyRoundPressure(side: SideRuntime, pressure: number, round: number, rng: RNG): void {
  const active = side.states.filter(state => !state.routed && state.remainingCount > 0);
  const total = active.reduce((sum, state) => sum + state.remainingCount, 0);
  if (!total) return;
  const rate = Math.min(.24, .018 + pressure * (round === 1 ? .075 : .13));
  let losses = Math.max(1, Math.round(total * rate * (.82 + rng.int(0, 36) / 100)));
  const ordered = [...active].sort((a, b) => exposure(b) - exposure(a) || a.unitId - b.unitId);
  for (const state of ordered) {
    if (losses <= 0) break;
    const share = Math.max(1, Math.min(state.remainingCount, Math.round(losses * state.remainingCount / Math.max(1, total))));
    state.remainingCount -= share;
    state.casualties += share;
    losses -= share;
    state.fatigue = clamp(state.fatigue + 8 + round * 3, 0, 100);
    state.morale = clamp(state.morale - share / Math.max(1, state.initialCount) * 115 - pressure * 8 + rng.int(-2, 2), 0, 100);
    state.cohesion = clamp(state.cohesion - share / Math.max(1, state.initialCount) * 90 - state.fatigue * .025, 0, 100);
  }
}

function exposure(state: BattleUnitState): number {
  return state.role === 'front' ? 4 : state.role === 'flank' ? 3 : state.role === 'missile' ? 2 : 1;
}

function sideRouted(side: SideRuntime, rng: RNG): boolean {
  const active = side.states.filter(state => state.remainingCount > 0);
  const initial = side.states.reduce((sum, state) => sum + state.initialCount, 0);
  const remaining = active.reduce((sum, state) => sum + state.remainingCount, 0);
  for (const state of active) {
    const threshold = 15 + state.fatigue * .18 + (state.remainingCount < state.initialCount * .45 ? 16 : 0);
    if (state.morale < threshold && rng.chance(Math.min(.92, .24 + (threshold - state.morale) / 70))) state.routed = true;
  }
  const stable = active.filter(state => !state.routed).reduce((sum, state) => sum + state.remainingCount, 0);
  return remaining <= initial * .22 || stable <= initial * .34;
}

function survivingPower(side: SideRuntime): number {
  return side.states.reduce((sum, state) => sum + (state.routed ? .2 : 1) * state.remainingCount * (.5 + state.morale / 180) * (.5 + state.cohesion / 180), 0);
}

function lossPlan(side: SideRuntime, losingOrRouted: boolean, rng: RNG): SideLossPlan {
  const casualties = side.states.reduce((sum, state) => sum + state.casualties, 0);
  const available = side.army.soldierIds.length;
  const deadShare = losingOrRouted ? rng.int(34, 52) / 100 : rng.int(25, 42) / 100;
  const captureShare = losingOrRouted ? rng.int(10, 28) / 100 : 0;
  const dead = Math.min(available, Math.round(casualties * deadShare));
  const captured = Math.min(Math.max(0, available - dead), Math.round(casualties * captureShare));
  const wounded = Math.min(Math.max(0, available - dead - captured), Math.max(0, casualties - dead - captured));
  return { dead, wounded, captured, routed: losingOrRouted };
}

function applyPersonnelOutcome(
  world: WorldState,
  side: SideRuntime,
  plan: SideLossPlan,
  captorKingdomId: number,
  record: BattleRecord,
  rng: RNG,
  indexes: WorldIndexes,
  settlementId?: number,
): { dead: number; wounded: number; captured: number; prisonerIds: number[]; woundedIds: number[] } {
  const ordered = battleRoster(world, side);
  const rankAndFile = ordered.filter(character => character.id !== side.army.commanderId);
  const commander = ordered.find(character => character.id === side.army.commanderId);
  const dead = rankAndFile.slice(0, Math.min(plan.dead, rankAndFile.length));
  const afterDead = rankAndFile.slice(dead.length);
  const captured = afterDead.slice(0, Math.min(plan.captured, afterDead.length));
  const afterCaptured = afterDead.slice(captured.length);
  const woundedPool = commander ? [...afterCaptured, commander] : afterCaptured;
  const wounded = woundedPool.slice(0, Math.min(plan.wounded, woundedPool.length));
  const deadIds = new Set(dead.map(item => item.id));
  const capturedIds = new Set(captured.map(item => item.id));
  if (dead.length) archiveCharactersBatch(world, indexes, dead.map(character => ({ character, context: {
    cause: `погиб в сражении между ${world.armies.find(item => item.id === record.attackerArmyId)?.name} и ${world.armies.find(item => item.id === record.defenderArmyId)?.name}`,
    globalX: record.globalX, globalY: record.globalY, settlementId, createCorpse: true,
  } })), rng);
  for (const character of wounded) {
    character.health = Math.max(8, character.health - rng.int(12, 34));
    character.serviceStatus = 'ранен';
    addBattleInjury(world, character, settlementId ?? character.settlementId, clamp(72 - character.health + rng.int(8, 24), 18, 88), 'рана, полученная в строю', rng);
    character.biography.push(`Ранен в сражении №${record.id}.`);
  }
  for (const character of captured) {
    character.serviceStatus = 'пленник';
    character.capturedByKingdomId = captorKingdomId;
    character.prisonerOfBattleId = record.id;
    character.militaryUnitId = undefined;
    character.workplace = 'лагерь военнопленных';
    character.workplaceBuildingId = undefined;
    character.biography.push(`Попал в плен в сражении №${record.id}.`);
  }
  const removedIds = new Set([...deadIds, ...capturedIds]);
  side.army.soldierIds = side.army.soldierIds.filter(id => !removedIds.has(id));
  for (const unit of world.militaryUnits.filter(item => item.armyId === side.army.id)) unit.memberIds = unit.memberIds.filter(id => !removedIds.has(id));
  side.army.logistics.wounded = Math.max(0, side.army.logistics.wounded + wounded.length);
  return { dead: dead.length, wounded: wounded.length, captured: captured.length, prisonerIds: captured.map(item => item.id), woundedIds: wounded.map(item => item.id) };
}

function battleRoster(world: WorldState, side: SideRuntime): Character[] {
  const exposureByUnit = new Map(side.states.map(state => [state.unitId, exposure(state) + state.casualties / Math.max(1, state.initialCount) * 4]));
  return side.army.soldierIds
    .map(id => world.characters.find(item => item.id === id))
    .filter((item): item is Character => Boolean(item?.alive))
    .sort((a, b) => {
      const exposureA = exposureByUnit.get(a.militaryUnitId ?? -side.army.id) ?? 1;
      const exposureB = exposureByUnit.get(b.militaryUnitId ?? -side.army.id) ?? 1;
      const hashA = hashSeed(`${world.config.seed}:battle:${world.year}:${world.month}:${side.army.id}:${a.id}`);
      const hashB = hashSeed(`${world.config.seed}:battle:${world.year}:${world.month}:${side.army.id}:${b.id}`);
      return exposureB - exposureA || hashA - hashB;
    });
}

function captureBattlefieldSupplies(world: WorldState, winner: Army, loser: Army, record: BattleRecord, rng: RNG, settlement?: Settlement): void {
  const transferable = loser.inventoryItemIds.filter(id => world.items.some(item => item.id === id && item.quantity > 0 && item.condition > 0));
  const takeCount = Math.min(transferable.length, Math.max(0, Math.ceil(transferable.length * rng.int(15, 42) / 100)));
  for (const itemId of transferable.slice(0, takeCount)) {
    loser.inventoryItemIds = loser.inventoryItemIds.filter(id => id !== itemId);
    if (!winner.inventoryItemIds.includes(itemId)) winner.inventoryItemIds.push(itemId);
    const item = world.items.find(candidate => candidate.id === itemId);
    if (item) {
      item.supplyWagonId = undefined;
      item.settlementId = settlement?.id ?? item.settlementId;
      item.history.push(`Захвачено армией ${winner.name} после сражения №${record.id}.`);
    }
    record.lootedItemIds.push(itemId);
  }
  for (const wagonId of [...loser.supplyWagonIds]) {
    const wagon = world.supplyWagons.find(item => item.id === wagonId && item.status !== 'уничтожен');
    if (!wagon) continue;
    if (rng.chance(.18)) {
      wagon.status = 'уничтожен';
      wagon.condition = 0;
      record.destroyedWagonIds.push(wagon.id);
      continue;
    }
    if (!rng.chance(.42)) continue;
    loser.supplyWagonIds = loser.supplyWagonIds.filter(id => id !== wagon.id);
    if (!winner.supplyWagonIds.includes(wagon.id)) winner.supplyWagonIds.push(wagon.id);
    wagon.armyId = winner.id;
    wagon.kingdomId = winner.kingdomId;
    wagon.status = 'следует за армией';
    wagon.x = winner.x; wagon.y = winner.y;
    wagon.history.push(`Захвачен армией ${winner.name} в сражении №${record.id}.`);
  }
  winner.supplies = clamp(winner.supplies + rng.int(5, 16), 0, 100);
  loser.supplies = clamp(loser.supplies - rng.int(12, 28), 0, 100);
  if (record.lootedItemIds.length || record.destroyedWagonIds.length) appendCausalEvent(world, {
    kind: 'military', title: `${winner.name} захватило обоз`, description: `После боя захвачено ${record.lootedItemIds.length} партий имущества, уничтожено ${record.destroyedWagonIds.length} повозок.`,
    cause: 'противник оставил снабжение при отступлении', consequences: ['победитель пополнил запасы', 'проигравшая армия потеряла часть имущества'],
    entityRefs: [{ kind: 'battleRecord', id: record.id }, { kind: 'army', id: winner.id }, { kind: 'army', id: loser.id }], importance: 3,
  });
}

function normalizeBattleRecord(record: BattleRecord): void {
  record.attackerUnitStates ??= [];
  record.defenderUnitStates ??= [];
  record.prisonerIds ??= [];
  record.woundedIds ??= [];
  record.lootedItemIds ??= [];
  record.destroyedWagonIds ??= [];
  record.history ??= [];
  record.phase ??= 'последствия';
}

function trimBattleRecords(world: WorldState): void {
  if (world.battleRecords.length <= MAX_BATTLE_RECORDS) return;
  const protectedIds = new Set(world.characters.map(character => character.prisonerOfBattleId).filter((id): id is number => typeof id === 'number'));
  const keep = [...world.battleRecords]
    .sort((a, b) => Number(protectedIds.has(b.id)) - Number(protectedIds.has(a.id)) || b.year - a.year || b.month - a.month || b.id - a.id)
    .slice(0, Math.max(MAX_BATTLE_RECORDS, protectedIds.size))
    .sort((a, b) => a.id - b.id);
  world.battleRecords = keep;
}

function clamp(value: number, min = 0, max = 100): number { return Math.max(min, Math.min(max, Math.round(value * 100) / 100)); }
