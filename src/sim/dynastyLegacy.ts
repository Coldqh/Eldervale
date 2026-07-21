import type { Character, Dynasty, WorldState } from '../types';
import type { DynastyMilestone, DynastySuccessionRecord } from '../dynastyLegacyTypes';
import {
  buildDynastyLegacySnapshot, calculateLegacyScore, deriveDynastyAlliances, deriveDynastyBranches,
  dynastyMembers, dynastyMotto, generationOfMember, notableMembers, selectDynastyHead,
} from '../lib/dynastyLegacy';
import { worldTick } from './scheduler';

const MAX_MILESTONES = 160;
const MAX_SUCCESSIONS = 48;

export function initializeDynastyLegacy(world: WorldState): void {
  for (const dynasty of world.dynasties) normalizeDynasty(world, dynasty, false);
  world.simulation.dynastyLegacyVersion = 1;
  world.simulation.lastDynastyLegacyTick = worldTick(world);
}

export function advanceDynastyLegacy(world: WorldState, options: { elapsedMonths?: number } = {}): void {
  if (world.simulation.dynastyLegacyVersion !== 1) initializeDynastyLegacy(world);
  for (const dynasty of world.dynasties) advanceDynasty(world, dynasty, Math.max(1, options.elapsedMonths ?? 1));
  world.simulation.lastDynastyLegacyTick = worldTick(world);
}

export function dynastyLegacyIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  for (const dynasty of world.dynasties) {
    const memberIds = new Set(dynasty.memberIds);
    if (!memberIds.has(dynasty.founderId)) issues.push(`${dynasty.name}: основатель отсутствует среди членов`);
    if (dynasty.currentHeadId && !memberIds.has(dynasty.currentHeadId)) issues.push(`${dynasty.name}: глава не состоит в роду`);
    if (dynasty.heirId && (!memberIds.has(dynasty.heirId) || dynasty.heirId === dynasty.currentHeadId)) issues.push(`${dynasty.name}: неверный наследник`);
    const milestoneIds = new Set<string>();
    for (const milestone of dynasty.milestones ?? []) {
      if (milestoneIds.has(milestone.id)) issues.push(`${dynasty.name}: повторяющаяся веха ${milestone.id}`);
      milestoneIds.add(milestone.id);
    }
  }
  return [...new Set(issues)];
}

function normalizeDynasty(world: WorldState, dynasty: Dynasty, recordExisting: boolean): void {
  syncMembers(world, dynasty);
  dynasty.motto ??= dynastyMotto(world, dynasty);
  dynasty.successionHistory ??= [];
  dynasty.milestones ??= [];
  dynasty.branchRecords ??= [];
  dynasty.allianceRecords ??= [];
  dynasty.notableMemberIds ??= [];
  dynasty.knownMemberIds ??= [];
  dynasty.knownMarriageKeys ??= [];

  const current = world.characters.find(character => character.id === dynasty.currentHeadId && character.alive);
  if (!current) {
    const replacement = selectDynastyHead(world, dynasty, dynasty.currentHeadId);
    if (replacement) dynasty.currentHeadId = replacement.id;
  }
  const head = world.characters.find(character => character.id === dynasty.currentHeadId && character.alive);
  dynasty.heirId = head ? selectDynastyHead(world, dynasty, head.id, new Set([head.id]))?.id : undefined;
  dynasty.branchRecords = deriveDynastyBranches(world, dynasty);
  dynasty.allianceRecords = deriveDynastyAlliances(world, dynasty);
  const members = dynastyMembers(world, dynasty);
  dynasty.notableMemberIds = notableMembers(members);
  dynasty.generation = head ? generationOfMember(world, dynasty, head.id) : 1;
  dynasty.generationDepth = Math.max(1, ...members.map(member => generationOfMember(world, dynasty, member.id)));
  dynasty.legacyScore = calculateLegacyScore(dynasty, members, dynasty.branchRecords, dynasty.allianceRecords);
  dynasty.lastLegacyTick = worldTick(world);
  if (!members.some(member => member.alive)) dynasty.extinctYear ??= world.year;
  if (!recordExisting) {
    dynasty.knownMemberIds = [...dynasty.memberIds];
    dynasty.knownMarriageKeys = dynasty.allianceRecords.map(alliance => alliance.id);
  }
}

function advanceDynasty(world: WorldState, dynasty: Dynasty, elapsedMonths: number): void {
  const previousHeadId = dynasty.currentHeadId;
  const previousBranchIds = new Set((dynasty.branchRecords ?? []).map(branch => branch.id));
  const previousMemberIds = new Set(dynasty.knownMemberIds ?? dynasty.memberIds);
  const previousMarriageKeys = new Set(dynasty.knownMarriageKeys ?? []);
  const wasExtinct = dynasty.extinctYear !== undefined;

  syncMembers(world, dynasty);
  const members = dynastyMembers(world, dynasty);
  const living = members.filter(member => member.alive);

  if (wasExtinct && living.length) {
    dynasty.extinctYear = undefined;
    const restoredHead = selectDynastyHead(world, dynasty, previousHeadId);
    if (restoredHead) dynasty.currentHeadId = restoredHead.id;
    addMilestone(world, dynasty, {
      id: milestoneId(dynasty, 'restoration', restoredHead?.id ?? 0), kind: 'restoration', year: world.year, month: world.month,
      title: `Род ${dynasty.name} вернулся`, description: restoredHead ? `${restoredHead.name} восстановил живую линию дома.` : 'У дома вновь появились живые представители.',
      characterIds: restoredHead ? [restoredHead.id] : [], relatedRefs: [{ kind: 'dynasty', id: dynasty.id }], importance: 3,
    });
    addWorldEvent(world, dynasty, 'restoration', `Род ${dynasty.name} восстановлен`, restoredHead ? `${restoredHead.name} вновь возглавил живую линию дома.` : 'У считавшегося угасшим рода появился наследник.', 3, restoredHead ? [restoredHead.id] : []);
  }

  const currentHead = world.characters.find(character => character.id === dynasty.currentHeadId && character.alive);
  if (!currentHead && living.length) {
    const replacement = selectDynastyHead(world, dynasty, previousHeadId);
    dynasty.currentHeadId = replacement?.id ?? dynasty.currentHeadId;
    if (replacement && replacement.id !== previousHeadId) recordSuccession(world, dynasty, previousHeadId, replacement);
  }

  const head = world.characters.find(character => character.id === dynasty.currentHeadId && character.alive);
  dynasty.heirId = head ? selectDynastyHead(world, dynasty, head.id, new Set([head.id]))?.id : undefined;

  const newMembers = dynasty.memberIds.filter(id => !previousMemberIds.has(id));
  for (const characterId of newMembers.slice(0, 8)) {
    const character = world.characters.find(item => item.id === characterId);
    if (!character) continue;
    const birth = character.age <= Math.max(1, Math.ceil(elapsedMonths / 12)) || character.birthYear >= world.year - 1;
    addMilestone(world, dynasty, {
      id: milestoneId(dynasty, birth ? 'birth' : 'branch', character.id), kind: birth ? 'birth' : 'branch', year: world.year, month: world.month,
      title: birth ? `${character.name} родился в доме ${dynasty.name}` : `${character.name} вошёл в дом ${dynasty.name}`,
      description: birth ? 'У рода появился новый представитель и возможный продолжатель линии.' : 'Состав дома изменился.',
      characterIds: [character.id], relatedRefs: [{ kind: 'dynasty', id: dynasty.id }, { kind: 'character', id: character.id }], importance: birth ? 1 : 0,
    });
  }

  const alliances = deriveDynastyAlliances(world, dynasty);
  for (const alliance of alliances) {
    if (previousMarriageKeys.has(alliance.id)) continue;
    const [firstId, secondId] = alliance.characterIds;
    const first = world.characters.find(character => character.id === firstId);
    const second = world.characters.find(character => character.id === secondId);
    const other = world.dynasties.find(item => item.id === alliance.otherDynastyId);
    addMilestone(world, dynasty, {
      id: milestoneId(dynasty, 'marriage', firstId, secondId), kind: 'marriage', year: world.year, month: world.month,
      title: `Брачный союз с домом ${other?.name ?? 'неизвестного рода'}`,
      description: `${first?.name ?? 'Представитель дома'} и ${second?.name ?? 'представитель другого дома'} связали две династии.`,
      characterIds: [firstId, secondId], relatedRefs: [{ kind: 'dynasty', id: dynasty.id }, { kind: 'dynasty', id: alliance.otherDynastyId }, { kind: 'character', id: firstId }, { kind: 'character', id: secondId }], importance: 2,
    });
  }
  dynasty.allianceRecords = alliances;

  const branches = deriveDynastyBranches(world, dynasty);
  for (const branch of branches) {
    if (previousBranchIds.has(branch.id) || branch.kind !== 'младшая' || branch.memberIds.length < 2) continue;
    const founder = world.characters.find(character => character.id === branch.founderId);
    addMilestone(world, dynasty, {
      id: milestoneId(dynasty, 'branch', branch.founderId), kind: 'branch', year: world.year, month: world.month,
      title: `Возникла ${branch.name}`,
      description: `${founder?.name ?? 'Представитель рода'} положил начало самостоятельной ветви дома.`,
      characterIds: [branch.founderId], relatedRefs: [{ kind: 'dynasty', id: dynasty.id }, { kind: 'character', id: branch.founderId }], importance: 1,
    });
  }
  dynasty.branchRecords = branches;

  if (!living.length && dynasty.extinctYear === undefined) {
    dynasty.extinctYear = world.year;
    dynasty.heirId = undefined;
    addMilestone(world, dynasty, {
      id: milestoneId(dynasty, 'extinction', world.year), kind: 'extinction', year: world.year, month: world.month,
      title: `Дом ${dynasty.name} угас`, description: 'Не осталось ни одного живого представителя рода.', characterIds: [],
      relatedRefs: [{ kind: 'dynasty', id: dynasty.id }], importance: 4,
    });
    addWorldEvent(world, dynasty, 'extinction', `Дом ${dynasty.name} угас`, 'Последний живой представитель рода умер, не оставив продолжателя.', 4, []);
  }

  dynasty.notableMemberIds = notableMembers(members);
  dynasty.generation = head ? generationOfMember(world, dynasty, head.id) : dynasty.generation ?? 1;
  dynasty.generationDepth = Math.max(1, ...members.map(member => generationOfMember(world, dynasty, member.id)));
  dynasty.legacyScore = calculateLegacyScore(dynasty, members, branches, alliances);
  dynasty.knownMemberIds = [...dynasty.memberIds];
  dynasty.knownMarriageKeys = alliances.map(alliance => alliance.id);
  dynasty.lastLegacyTick = worldTick(world);
  dynasty.milestones = (dynasty.milestones ?? []).sort((a, b) => b.year - a.year || b.month - a.month).slice(0, MAX_MILESTONES);
  dynasty.successionHistory = (dynasty.successionHistory ?? []).sort((a, b) => b.year - a.year || b.month - a.month).slice(0, MAX_SUCCESSIONS);
}

function syncMembers(world: WorldState, dynasty: Dynasty): void {
  const memberIds = new Set<number>(dynasty.memberIds ?? []);
  memberIds.add(dynasty.founderId);
  for (const character of world.characters) if (character.dynastyId === dynasty.id) memberIds.add(character.id);
  dynasty.memberIds = [...memberIds].sort((a, b) => a - b);
}

function recordSuccession(world: WorldState, dynasty: Dynasty, previousHeadId: number | undefined, replacement: Character): void {
  const previous = previousHeadId ? world.characters.find(character => character.id === previousHeadId) : undefined;
  const generation = generationOfMember(world, dynasty, replacement.id);
  const record: DynastySuccessionRecord = {
    id: `dynasty:${dynasty.id}:succession:${world.year}:${world.month}:${replacement.id}`,
    year: world.year, month: world.month, previousHeadId, newHeadId: replacement.id,
    reason: previousHeadId ? (previous && !previous.alive ? 'смерть' : 'исчезновение') : 'первое избрание', generation,
  };
  if (!(dynasty.successionHistory ?? []).some(item => item.id === record.id)) dynasty.successionHistory!.push(record);
  addMilestone(world, dynasty, {
    id: milestoneId(dynasty, 'succession', previousHeadId ?? 0, replacement.id, worldTick(world)), kind: 'succession', year: world.year, month: world.month,
    title: `${replacement.name} возглавил дом ${dynasty.name}`,
    description: previous ? `После ухода ${previous.name} власть в роду перешла к представителю ${generation}-го поколения.` : `Дом впервые признал ${replacement.name} своим главой.`,
    characterIds: [...(previousHeadId ? [previousHeadId] : []), replacement.id],
    relatedRefs: [{ kind: 'dynasty', id: dynasty.id }, { kind: 'character', id: replacement.id }], importance: 3,
  });
  dynasty.history.push(`${world.year}.${String(world.month).padStart(2, '0')}: ${replacement.name} стал главой дома.`);
  if (dynasty.history.length > 80) dynasty.history.splice(0, dynasty.history.length - 80);
  addWorldEvent(world, dynasty, 'succession', `${replacement.name} возглавил дом ${dynasty.name}`, previous ? `После смерти или исчезновения ${previous.name} род признал нового главу.` : 'Род закрепил первого главу линии.', 3, [replacement.id, ...(previousHeadId ? [previousHeadId] : [])]);
}

function addMilestone(world: WorldState, dynasty: Dynasty, milestone: DynastyMilestone): void {
  dynasty.milestones ??= [];
  if (dynasty.milestones.some(item => item.id === milestone.id)) return;
  dynasty.milestones.push(milestone);
}

function addWorldEvent(world: WorldState, dynasty: Dynasty, tag: string, title: string, description: string, importance: number, characterIds: number[]): void {
  const signature = `${world.year}:${world.month}:${tag}:${dynasty.id}`;
  if (world.events.some(event => event.year === world.year && event.month === world.month && event.title === title)) return;
  world.nextIds.event ??= Math.max(0, ...world.events.map(event => event.id)) + 1;
  const refs = [{ kind: 'dynasty' as const, id: dynasty.id }, ...characterIds.map(id => ({ kind: 'character' as const, id }))];
  world.events.push({
    id: world.nextIds.event++, year: world.year, month: world.month, kind: 'dynasty', title, description,
    cause: tag === 'succession' ? 'прежний глава больше не мог возглавлять род' : tag === 'extinction' ? 'династическая линия осталась без живых представителей' : 'в роду вновь появился законный продолжатель',
    conditions: [`династия ${dynasty.name}`, signature], decision: tag === 'succession' ? 'род признал наиболее сильного наследника' : 'изменение состава рода было закреплено',
    outcome: description, consequences: tag === 'succession' ? ['изменился глава рода', 'пересчитан порядок наследования'] : tag === 'extinction' ? ['род считается угасшим'] : ['династия снова действует'],
    traces: refs, entityRefs: refs, importance,
  });
}

function milestoneId(dynasty: Dynasty, kind: string, ...ids: number[]): string {
  return `dynasty:${dynasty.id}:${kind}:${ids.join(':')}`;
}

export function dynastySnapshotForDebug(world: WorldState, dynastyId: number) {
  return buildDynastyLegacySnapshot(world, dynastyId);
}
