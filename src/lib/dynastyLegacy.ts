import type { Character, Dynasty, WorldState } from '../types';
import type {
  DynastyAllianceRecord, DynastyBranchRecord, DynastyGenerationGroup, DynastyLegacySnapshot,
} from '../dynastyLegacyTypes';
import { hashSeed } from '../sim/rng';

const MOTTOES = [
  'Кровь помнит, долг остаётся',
  'Имя переживает короны',
  'Верность дому выше страха',
  'Пока жив наследник, жив и род',
  'Земля хранит наши имена',
  'Честь передаётся вместе с кровью',
  'Сила рода — в памяти поколений',
  'Дом стоит, пока держится слово',
];

export function dynastyMotto(world: WorldState, dynasty: Dynasty): string {
  return dynasty.motto ?? MOTTOES[hashSeed(`${world.config.seed}:девиз:${dynasty.id}:${dynasty.name}`) % MOTTOES.length]!;
}

export function dynastyMembers(world: WorldState, dynasty: Dynasty): Character[] {
  const ids = new Set<number>(dynasty.memberIds ?? []);
  for (const character of world.characters) if (character.dynastyId === dynasty.id) ids.add(character.id);
  return [...ids]
    .map(id => world.characters.find(character => character.id === id))
    .filter((character): character is Character => Boolean(character));
}

export function generationOfMember(world: WorldState, dynasty: Dynasty, characterId: number, memo = new Map<number, number>(), visiting = new Set<number>()): number {
  const cached = memo.get(characterId);
  if (cached !== undefined) return cached;
  if (characterId === dynasty.founderId) { memo.set(characterId, 1); return 1; }
  if (visiting.has(characterId)) return 1;
  visiting.add(characterId);
  const character = world.characters.find(item => item.id === characterId);
  const parentGenerations = (character?.parentIds ?? [])
    .filter(parentId => world.characters.find(parent => parent.id === parentId)?.dynastyId === dynasty.id)
    .map(parentId => generationOfMember(world, dynasty, parentId, memo, visiting));
  visiting.delete(characterId);
  const generation = parentGenerations.length ? Math.min(...parentGenerations) + 1 : 1;
  memo.set(characterId, generation);
  return generation;
}

export function isDescendantOf(world: WorldState, characterId: number, ancestorId: number, visited = new Set<number>()): boolean {
  if (characterId === ancestorId) return true;
  if (visited.has(characterId)) return false;
  visited.add(characterId);
  const character = world.characters.find(item => item.id === characterId);
  return Boolean(character?.parentIds.some(parentId => parentId === ancestorId || isDescendantOf(world, parentId, ancestorId, visited)));
}

export function selectDynastyHead(world: WorldState, dynasty: Dynasty, previousHeadId?: number, excludedIds: ReadonlySet<number> = new Set()): Character | undefined {
  const members = dynastyMembers(world, dynasty).filter(character => character.alive && !excludedIds.has(character.id));
  if (!members.length) return undefined;
  const previous = previousHeadId ? world.characters.find(character => character.id === previousHeadId) : undefined;
  const siblingIds = new Set<number>();
  if (previous) {
    const parentIds = new Set(previous.parentIds);
    for (const member of members) if (member.parentIds.some(id => parentIds.has(id))) siblingIds.add(member.id);
  }
  return members.sort((a, b) => successionScore(world, dynasty, b, previousHeadId, siblingIds) - successionScore(world, dynasty, a, previousHeadId, siblingIds) || a.birthYear - b.birthYear || a.id - b.id)[0];
}

function successionScore(world: WorldState, dynasty: Dynasty, candidate: Character, previousHeadId: number | undefined, siblingIds: Set<number>): number {
  let score = 0;
  if (candidate.age >= 14) score += 180;
  else score -= 300;
  if (previousHeadId) {
    const previous = world.characters.find(item => item.id === previousHeadId);
    if (previous?.childIds.includes(candidate.id)) score += 1_100;
    else if (isDescendantOf(world, candidate.id, previousHeadId)) score += 760;
    else if (siblingIds.has(candidate.id)) score += 620;
    else if (candidate.parentIds.some(parentId => siblingIds.has(parentId))) score += 430;
  }
  if (candidate.id === dynasty.founderId) score += 900;
  score += candidate.titles.length * 85;
  score += (candidate.nobleTitleIds?.length ?? 0) * 70;
  score += (candidate.courtOfficeIds?.length ?? 0) * 45;
  score += (candidate.politicalInfluence ?? 0) * .8;
  score += candidate.renown * 1.1;
  score += Math.min(75, candidate.age);
  score += candidate.loyalty * .18;
  return score;
}

export function deriveDynastyBranches(world: WorldState, dynasty: Dynasty): DynastyBranchRecord[] {
  const members = dynastyMembers(world, dynasty);
  const founder = world.characters.find(character => character.id === dynasty.founderId);
  const roots = (founder?.childIds ?? [])
    .map(id => world.characters.find(character => character.id === id))
    .filter((character): character is Character => Boolean(character && character.dynastyId === dynasty.id));
  if (!roots.length) {
    const living = members.filter(character => character.alive).map(character => character.id);
    return [{
      id: `dynasty:${dynasty.id}:branch:root`, founderId: dynasty.founderId, name: `Главная линия ${dynasty.name}`, kind: 'главная',
      headId: selectDynastyHead(world, dynasty)?.id, memberIds: members.map(character => character.id), livingMemberIds: living,
      generationDepth: Math.max(1, ...members.map(character => generationOfMember(world, dynasty, character.id))),
      prestige: branchPrestige(members), status: living.length ? 'действует' : 'угасла',
    }];
  }
  return roots.map((root, index) => {
    const branchMembers = members.filter(member => isDescendantOf(world, member.id, root.id));
    const living = branchMembers.filter(member => member.alive);
    const branchDynasty: Dynasty = { ...dynasty, memberIds: branchMembers.map(member => member.id), founderId: root.id };
    return {
      id: `dynasty:${dynasty.id}:branch:${root.id}`, founderId: root.id,
      name: index === 0 ? `Главная линия ${root.name}` : `Младшая линия ${root.name}`,
      kind: index === 0 ? 'главная' : 'младшая', headId: selectDynastyHead(world, branchDynasty, root.id)?.id,
      memberIds: branchMembers.map(member => member.id), livingMemberIds: living.map(member => member.id),
      generationDepth: Math.max(1, ...branchMembers.map(member => generationOfMember(world, dynasty, member.id))),
      prestige: branchPrestige(branchMembers), status: living.length ? 'действует' : 'угасла',
    } satisfies DynastyBranchRecord;
  }).sort((a, b) => (a.kind === 'главная' ? -1 : 1) - (b.kind === 'главная' ? -1 : 1) || b.prestige - a.prestige || a.founderId - b.founderId);
}

export function deriveDynastyAlliances(world: WorldState, dynasty: Dynasty): DynastyAllianceRecord[] {
  const records = new Map<string, DynastyAllianceRecord>();
  for (const member of dynastyMembers(world, dynasty)) {
    if (!member.spouseId) continue;
    const spouse = world.characters.find(character => character.id === member.spouseId);
    if (!spouse?.dynastyId || spouse.dynastyId === dynasty.id) continue;
    const pair = [member.id, spouse.id].sort((a, b) => a - b) as [number, number];
    const id = `dynasty-alliance:${pair[0]}:${pair[1]}`;
    records.set(id, { id, otherDynastyId: spouse.dynastyId, characterIds: pair, sinceYear: Math.max(member.birthYear + 14, spouse.birthYear + 14), active: member.alive && spouse.alive && member.spouseId === spouse.id });
  }
  return [...records.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.sinceYear - a.sinceYear || a.id.localeCompare(b.id));
}

export function buildDynastyLegacySnapshot(world: WorldState, dynastyId: number): DynastyLegacySnapshot | undefined {
  const dynasty = world.dynasties.find(item => item.id === dynastyId);
  if (!dynasty) return undefined;
  const members = dynastyMembers(world, dynasty);
  const living = members.filter(character => character.alive);
  const head = world.characters.find(character => character.id === dynasty.currentHeadId && character.alive) ?? selectDynastyHead(world, dynasty, dynasty.currentHeadId);
  const heir = world.characters.find(character => character.id === dynasty.heirId && character.alive)
    ?? (head ? selectDynastyHead(world, dynasty, head.id, new Set([head.id])) : undefined);
  const memo = new Map<number, number>();
  const generationsMap = new Map<number, number[]>();
  for (const member of members) {
    const generation = generationOfMember(world, dynasty, member.id, memo);
    const list = generationsMap.get(generation) ?? [];
    list.push(member.id);
    generationsMap.set(generation, list);
  }
  const generations: DynastyGenerationGroup[] = [...generationsMap.entries()].sort((a, b) => a[0] - b[0]).map(([generation, memberIds]) => ({
    generation, memberIds: memberIds.sort((a, b) => a - b), livingMemberIds: memberIds.filter(id => world.characters.find(character => character.id === id)?.alive),
  }));
  const branches = dynasty.branchRecords?.length ? dynasty.branchRecords : deriveDynastyBranches(world, dynasty);
  const alliances = dynasty.allianceRecords?.length ? dynasty.allianceRecords : deriveDynastyAlliances(world, dynasty);
  const notable = dynasty.notableMemberIds?.length ? dynasty.notableMemberIds : notableMembers(members);
  const generation = head ? generationOfMember(world, dynasty, head.id, memo) : Math.max(1, ...generations.map(item => item.generation));
  const generationDepth = Math.max(1, ...generations.map(item => item.generation));
  const score = dynasty.legacyScore ?? calculateLegacyScore(dynasty, members, branches, alliances);
  return {
    dynastyId: dynasty.id, name: dynasty.name, motto: dynastyMotto(world, dynasty), founderId: dynasty.founderId,
    headId: head?.id, heirId: heir?.id, kingdomId: dynasty.kingdomId, livingMemberIds: living.map(character => character.id),
    deceasedMemberIds: members.filter(character => !character.alive).map(character => character.id), notableMemberIds: notable,
    generation, generationDepth, legacyScore: score, prestige: dynasty.prestige, wealth: dynasty.wealth,
    extinct: living.length === 0, extinctYear: dynasty.extinctYear, generations, branches, alliances,
    successions: [...(dynasty.successionHistory ?? [])].sort((a, b) => b.year - a.year || b.month - a.month).slice(0, 24),
    milestones: [...(dynasty.milestones ?? [])].sort((a, b) => b.year - a.year || b.month - a.month).slice(0, 40),
  };
}

export function notableMembers(members: Character[]): number[] {
  return [...members].sort((a, b) => memberLegacyScore(b) - memberLegacyScore(a) || a.id - b.id).slice(0, 12).map(member => member.id);
}

export function calculateLegacyScore(dynasty: Dynasty, members: Character[], branches: DynastyBranchRecord[], alliances: DynastyAllianceRecord[]): number {
  const living = members.filter(member => member.alive).length;
  const titleCount = members.reduce((sum, member) => sum + member.titles.length + (member.nobleTitleIds?.length ?? 0), 0);
  const achievement = members.reduce((sum, member) => sum + member.renown * .18 + member.bookIds.length * 3 + member.artifactIds.length * 5 + Math.min(20, member.kills), 0);
  return Math.max(0, Math.round(dynasty.prestige + living * 2 + titleCount * 8 + achievement + branches.filter(branch => branch.status === 'действует').length * 9 + alliances.filter(alliance => alliance.active).length * 7 + (dynasty.kingdomId ? 30 : 0)));
}

function branchPrestige(members: Character[]): number {
  return Math.round(members.reduce((sum, member) => sum + member.renown + member.titles.length * 18 + (member.nobleTitleIds?.length ?? 0) * 14, 0) / Math.max(1, Math.sqrt(members.length)));
}

function memberLegacyScore(member: Character): number {
  return member.renown + member.titles.length * 24 + (member.nobleTitleIds?.length ?? 0) * 18 + (member.courtOfficeIds?.length ?? 0) * 12 + member.bookIds.length * 8 + member.artifactIds.length * 12 + Math.min(30, member.kills * 2);
}
