import type {
  Character, CourtFaction, Establishment, Household, Relationship, RelationshipStatus, SocialContextKind,
  SocialObligation, SocialObligationKind, WorldState,
} from '../types';
import type { WorldIndexes } from './indexes';
import { indexRelationship, moveResidentInIndexes, relationshipKey } from './indexes';
import { appendCausalEvent } from './causality';
import { decisionKnowledge, recordDecision, recordStateDelta } from './decisionCore';
import { addCharacterSecret, ensureCharacterMind, scoreMotivatedAction, setDecisionMoment } from './mindSystem';
import { RNG, hashSeed } from './rng';
import { worldTick } from './scheduler';

const MAX_OBLIGATIONS = 2_400;
const MAX_RELATIONSHIPS_PER_CHARACTER = 18;
const MAX_RELATION_HISTORY = 12;

export interface WitnessChoiceResult {
  reports: boolean;
  pressure: number;
  reason: string;
}

export interface JudicialInfluenceResult {
  bias: number;
  bribe: number;
  reason: string;
}

export function initializeSocialSystem(world: WorldState, indexes?: WorldIndexes): void {
  world.socialObligations ??= [];
  world.nextIds.socialObligation ??= Math.max(0, ...world.socialObligations.map(item => item.id)) + 1;
  if (world.simulation.socialSystemVersion === 1) return;
  for (const relationship of world.relationships) normalizeRelationship(world, relationship);
  seedStructuralRelationships(world, indexes);
  seedDebtObligations(world, indexes);
  world.simulation.socialSystemVersion = 1;
  world.simulation.lastSocialBurialId ??= Math.max(0, ...world.burials.map(item => item.id));
}

export function advanceSocialSystem(world: WorldState, rng: RNG, indexes: WorldIndexes, fastForward = false): void {
  if (world.simulation.socialSystemVersion !== 1) initializeSocialSystem(world, indexes);
  processDeathAftermath(world, indexes);
  const relationshipTurn = fastForward ? [1, 7].includes(world.month) : [1, 4, 7, 10].includes(world.month);
  if (relationshipTurn) advanceRelationships(world, rng, indexes);
  if (relationshipTurn) formContextualRelationships(world, rng, indexes);
  if (fastForward ? world.month === 2 : [2, 8].includes(world.month)) advanceUnions(world, rng, indexes);
  if (fastForward ? world.month === 3 : [3, 9].includes(world.month)) advancePrivateAffairs(world, rng, indexes);
  if (!fastForward || [1, 4, 7, 10].includes(world.month)) advanceObligations(world, rng, indexes);
  trimSocialCollections(world);
}

export function relationshipBetween(world: WorldState, firstId: number, secondId: number, indexes?: WorldIndexes): Relationship | undefined {
  if (firstId === secondId) return undefined;
  if (indexes) return indexes.relationshipByPair.get(relationshipKey(firstId, secondId));
  return world.relationships.find(item =>
    (item.characterAId === firstId && item.characterBId === secondId)
    || (item.characterAId === secondId && item.characterBId === firstId));
}

export function witnessWillReport(
  world: WorldState,
  witness: Character,
  perpetrator: Character,
  victim: Character,
  severity: number,
  rng: RNG,
  indexes?: WorldIndexes,
): WitnessChoiceResult {
  const mind = ensureCharacterMind(world, witness);
  const perpetratorTie = relationshipBetween(world, witness.id, perpetrator.id, indexes);
  const victimTie = relationshipBetween(world, witness.id, victim.id, indexes);
  const silenceDebt = world.socialObligations.find(item => item.status === 'active' && item.debtorCharacterId === witness.id && item.creditorCharacterId === perpetrator.id && item.kind === 'silence');
  const fear = (perpetratorTie?.fear ?? 0) + mind.emotions.fear * .4 + Math.max(0, perpetrator.renown - witness.renown) * .35;
  const loyaltyToPerpetrator = (perpetratorTie?.trust ?? 0) * .45 + (perpetratorTie?.affection ?? 0) * .3 + (silenceDebt?.strength ?? 0);
  const concernForVictim = (victimTie?.affection ?? 0) * .45 + (victimTie?.trust ?? 0) * .25 + mind.traits.empathy * .45;
  const law = mind.values.order * .55 + mind.traits.honesty * .4 + severity * 7;
  const pressure = law + concernForVictim - fear - loyaltyToPerpetrator + rng.int(-18, 18);
  const reports = pressure >= 18;
  const options = [
    scoreMotivatedAction(world, witness, {
      id: 'report', label: 'Сообщить страже', base: severity * 5, orderBenefit: 28, socialApproval: 12,
      harm: victimTie && victimTie.tension! > 50 ? 4 : -8, risk: Math.max(0, fear * .25),
      situational: { 'сочувствие жертве': concernForVictim * .25, 'улики и тяжесть': severity * 4 },
    }),
    scoreMotivatedAction(world, witness, {
      id: 'silence', label: 'Промолчать', base: 4, orderBenefit: -22, risk: Math.max(0, 18 - fear * .15),
      familyBenefit: perpetratorTie?.contexts?.includes('family') ? 20 : 0,
      situational: { 'страх преступника': fear * .35, 'верность преступнику': loyaltyToPerpetrator * .35 },
    }),
  ];
  if (severity >= 5 || perpetratorTie || victimTie) {
    recordDecision(world, {
      actorRef: { kind: 'character', id: witness.id }, goal: 'решить, говорить ли страже',
      context: `${witness.name} видел преступление против ${victim.name}`,
      knownFactIds: decisionKnowledge(world, { kind: 'character', id: witness.id }), options,
      chosenOptionId: reports ? 'report' : 'silence', tags: ['свидетель', 'преступление', 'общество'],
    });
    setDecisionMoment(world, witness);
  }
  if (!reports && severity >= 7 && perpetratorTie && (perpetratorTie.fear ?? 0) > 45) {
    ensureObligation(world, 'silence', witness.id, perpetrator.id, witness.settlementId, 0, clamp(35 + fear * .45), 'молчание после тяжёлого преступления', true, worldTick(world) + 18);
  }
  return { reports, pressure, reason: reports ? 'закон, сочувствие и улики перевесили страх' : 'страх, родство или зависимость перевесили обязанность сообщить' };
}

export function applyJudicialInfluence(
  world: WorldState,
  judge: Character | undefined,
  defendant: Character,
  victim: Character | undefined,
  severity: number,
  rng: RNG,
  indexes?: WorldIndexes,
): JudicialInfluenceResult {
  if (!judge) return { bias: 0, bribe: 0, reason: 'судья не назначен' };
  const judgeMind = ensureCharacterMind(world, judge);
  const defendantMind = ensureCharacterMind(world, defendant);
  const defendantTie = relationshipBetween(world, judge.id, defendant.id, indexes);
  const victimTie = victim ? relationshipBetween(world, judge.id, victim.id, indexes) : undefined;
  const kinBias = defendantTie?.contexts?.includes('family') ? -24 : 0;
  const friendshipBias = -((defendantTie?.trust ?? 0) + (defendantTie?.affection ?? 0)) * .12;
  const hostilityBias = (defendantTie?.tension ?? 0) * .13 + (victimTie?.affection ?? 0) * .1;
  const honesty = judgeMind.traits.honesty + judgeMind.values.order;
  const greed = judgeMind.traits.greed + judgeMind.values.wealth;
  const available = Math.max(0, defendant.wallet + (defendant.householdId ? world.households.find(item => item.id === defendant.householdId)?.wealth ?? 0 : 0));
  const desiredBribe = Math.min(available * .16, 4 + severity * 1.8);
  const corruptionChance = clamp01((greed - honesty + defendantMind.traits.greed * .2 - severity * 5) / 140);
  let bribe = 0;
  let corruptionBias = 0;
  if (desiredBribe >= 2 && severity < 9 && rng.chance(corruptionChance)) {
    bribe = transferPrivateMoney(world, defendant, judge, desiredBribe);
    if (bribe > 0) {
      corruptionBias = -Math.min(34, bribe * 2.2 + greed * .08);
      addCharacterSecret(world, judge, { kind: 'crime', severity: clamp(35 + bribe * 3), knownByCharacterIds: [defendant.id], exposed: false, summary: `получил взятку ${bribe.toFixed(1)} крон от ${defendant.name}` });
      addCharacterSecret(world, defendant, { kind: 'crime', severity: clamp(30 + bribe * 2), knownByCharacterIds: [judge.id], exposed: false, summary: `подкупил судью ${judge.name}` });
      ensureObligation(world, 'silence', judge.id, defendant.id, defendant.settlementId, 0, clamp(45 + bribe * 2), 'взаимное молчание о судебной взятке', true, worldTick(world) + 60);
    }
  }
  const bias = Math.round((kinBias + friendshipBias + hostilityBias + corruptionBias) * 100) / 100;
  if (Math.abs(bias) > 8 || bribe > 0) {
    const options = [
      scoreMotivatedAction(world, judge, { id: 'impartial', label: 'Судить по уликам', base: 26, orderBenefit: 35, socialApproval: 18 }),
      scoreMotivatedAction(world, judge, { id: 'favor', label: 'Склонить дело в пользу подсудимого', base: bribe * 3, wealthGain: bribe, deception: 25, legalPenalty: 18, situational: { 'личная связь': -(kinBias + friendshipBias) } }),
      scoreMotivatedAction(world, judge, { id: 'punish', label: 'Усилить обвинение', base: hostilityBias, orderBenefit: severity * 2, harm: 12 }),
    ];
    recordDecision(world, {
      actorRef: { kind: 'character', id: judge.id }, goal: 'вынести приговор', context: `дело против ${defendant.name}`,
      knownFactIds: decisionKnowledge(world, { kind: 'character', id: judge.id }), options,
      chosenOptionId: bribe > 0 || bias < -10 ? 'favor' : bias > 10 ? 'punish' : 'impartial', tags: ['суд', 'личные связи', bribe > 0 ? 'коррупция' : 'правосудие'],
    });
    setDecisionMoment(world, judge);
  }
  return { bias, bribe, reason: bribe > 0 ? 'на решение повлияли взятка и личные связи' : Math.abs(bias) > 5 ? 'на решение повлияли родство и личное отношение' : 'личное влияние было слабым' };
}

export function workplaceConnectionScore(world: WorldState, character: Character, establishment: Establishment, indexes?: WorldIndexes): number {
  const contacts = [establishment.ownerCharacterId, ...establishment.workerIds]
    .map(id => relationshipBetween(world, character.id, id, indexes))
    .filter((item): item is Relationship => Boolean(item));
  return contacts.reduce((sum, tie) => sum + Math.max(-18, ((tie.trust ?? 0) + (tie.respect ?? 0) - (tie.tension ?? 0) * 1.2) / 8), 0);
}

export function settlementConnectionScore(world: WorldState, character: Character, settlementId: number, indexes?: WorldIndexes): number {
  let score = 0;
  for (const relationId of character.relationshipIds) {
    const relation = indexes?.relationshipById.get(relationId) ?? world.relationships.find(item => item.id === relationId);
    if (!relation) continue;
    const otherId = relation.characterAId === character.id ? relation.characterBId : relation.characterAId;
    const other = indexes?.characterById.get(otherId) ?? world.characters.find(item => item.id === otherId);
    if (!other || other.settlementId !== settlementId) continue;
    const family = relation.contexts?.includes('family') || relation.kind === 'родство' ? 22 : 0;
    score += family + ((relation.trust ?? 0) + (relation.affection ?? 0) - (relation.tension ?? 0)) / 12;
  }
  return score;
}

export function recruitFactionThroughRelationships(world: WorldState, faction: CourtFaction, leader: Character, candidates: Character[], indexes?: WorldIndexes): number[] {
  const recruits = candidates
    .filter(candidate => candidate.id !== leader.id && !candidate.courtFactionId)
    .map(candidate => {
      const tie = relationshipBetween(world, leader.id, candidate.id, indexes);
      const score = (tie?.trust ?? 0) + (tie?.respect ?? 0) + (tie?.affection ?? 0) * .5 - (tie?.tension ?? 0) + candidate.loyalty * .25;
      return { candidate, score };
    })
    .filter(entry => entry.score >= 55)
    .sort((a, b) => b.score - a.score || a.candidate.id - b.candidate.id)
    .slice(0, 2)
    .map(entry => entry.candidate);
  for (const recruit of recruits) {
    recruit.courtFactionId = faction.id;
    if (!faction.memberIds.includes(recruit.id)) faction.memberIds.push(recruit.id);
    faction.history.push(`${leader.name} привлёк ${recruit.name} через личные связи.`);
  }
  return recruits.map(item => item.id);
}

export function inheritanceHeir(world: WorldState, deceased: Character): Character | undefined {
  const living = (id: number | undefined) => id ? world.characters.find(item => item.id === id && item.alive) : undefined;
  const spouse = living(deceased.spouseId);
  if (spouse) return spouse;
  const children = deceased.childIds.map(living).filter((item): item is Character => Boolean(item)).sort((a, b) => Number(b.age >= 16) - Number(a.age >= 16) || b.age - a.age || b.renown - a.renown);
  if (children[0]) return children[0];
  const parents = deceased.parentIds.map(living).filter((item): item is Character => Boolean(item)).sort((a, b) => b.age - a.age);
  if (parents[0]) return parents[0];
  if (deceased.householdId) {
    const household = world.households.find(item => item.id === deceased.householdId);
    const member = household?.memberIds.map(living).find((item): item is Character => Boolean(item));
    if (member) return member;
  }
  return undefined;
}

export function socialSystemIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const characterIds = new Set(world.characters.map(item => item.id));
  const pairKeys = new Set<string>();
  for (const relationship of world.relationships) {
    const key = relationshipKey(relationship.characterAId, relationship.characterBId);
    if (pairKeys.has(key)) issues.push(`Отношения: повтор связи ${key}`);
    pairKeys.add(key);
    if (!characterIds.has(relationship.characterAId) || !characterIds.has(relationship.characterBId)) issues.push(`Отношения ${relationship.id}: отсутствует живой участник`);
    for (const value of [relationship.trust, relationship.affection, relationship.respect, relationship.fear, relationship.tension, relationship.familiarity]) if (value !== undefined && (value < 0 || value > 100 || !Number.isFinite(value))) issues.push(`Отношения ${relationship.id}: неверная социальная шкала`);
  }
  const obligationIds = new Set<number>();
  for (const obligation of world.socialObligations ?? []) {
    if (obligationIds.has(obligation.id)) issues.push(`Обязательства: повтор ID ${obligation.id}`);
    obligationIds.add(obligation.id);
    if (!characterIds.has(obligation.debtorCharacterId) && obligation.status === 'active') issues.push(`Обязательство ${obligation.id}: должник отсутствует`);
    if (!characterIds.has(obligation.creditorCharacterId) && obligation.status === 'active') issues.push(`Обязательство ${obligation.id}: кредитор отсутствует`);
  }
  for (const character of world.characters) {
    if (character.spouseId && world.characters.find(item => item.id === character.spouseId)?.spouseId !== character.id) issues.push(`${character.name}: односторонний брак`);
  }
  return [...new Set(issues)];
}

function normalizeRelationship(world: WorldState, relationship: Relationship): void {
  const a = world.characters.find(item => item.id === relationship.characterAId);
  const b = world.characters.find(item => item.id === relationship.characterBId);
  const defaults = relationDefaults(relationship.kind, relationship.strength);
  relationship.contexts ??= inferContexts(a, b, relationship.kind);
  relationship.trust ??= defaults.trust;
  relationship.affection ??= defaults.affection;
  relationship.respect ??= defaults.respect;
  relationship.fear ??= defaults.fear;
  relationship.tension ??= defaults.tension;
  relationship.familiarity ??= defaults.familiarity;
  relationship.interactionCount ??= 0;
  relationship.lastInteractionTick ??= worldTick(world);
  relationship.status ??= relationshipStatus(relationship);
  relationship.history ??= [];
}

function relationDefaults(kind: Relationship['kind'], strength: number) {
  const s = clamp(strength);
  if (kind === 'родство') return { trust: clamp(48 + s * .45), affection: clamp(50 + s * .5), respect: clamp(30 + s * .35), fear: 4, tension: 8, familiarity: 92 };
  if (kind === 'дружба') return { trust: clamp(35 + s * .6), affection: clamp(38 + s * .55), respect: clamp(30 + s * .45), fear: 2, tension: 7, familiarity: clamp(42 + s * .5) };
  if (kind === 'любовь') return { trust: clamp(38 + s * .55), affection: clamp(55 + s * .48), respect: clamp(30 + s * .4), fear: 3, tension: 8, familiarity: clamp(55 + s * .45) };
  if (kind === 'верность') return { trust: clamp(42 + s * .55), affection: clamp(18 + s * .3), respect: clamp(45 + s * .5), fear: 8, tension: 10, familiarity: clamp(40 + s * .45) };
  if (kind === 'долг') return { trust: 38, affection: 18, respect: 35, fear: 8, tension: clamp(22 + s * .3), familiarity: 48 };
  if (kind === 'страх') return { trust: 12, affection: 4, respect: clamp(20 + s * .35), fear: clamp(45 + s * .55), tension: clamp(35 + s * .45), familiarity: 45 };
  if (kind === 'соперничество') return { trust: 24, affection: 12, respect: clamp(28 + s * .4), fear: 12, tension: clamp(44 + s * .5), familiarity: 56 };
  return { trust: 6, affection: 2, respect: 10, fear: 18, tension: clamp(58 + s * .42), familiarity: 62 };
}

function inferContexts(a: Character | undefined, b: Character | undefined, kind: Relationship['kind']): SocialContextKind[] {
  const contexts: SocialContextKind[] = [];
  if (!a || !b) return kind === 'родство' ? ['family'] : [];
  if (kind === 'родство' || a.spouseId === b.id || a.parentIds.includes(b.id) || a.childIds.includes(b.id)) contexts.push('family');
  if (a.householdId && a.householdId === b.householdId) contexts.push('household');
  if (a.employerEstablishmentId && a.employerEstablishmentId === b.employerEstablishmentId) contexts.push('work');
  if (a.settlementId === b.settlementId && !contexts.includes('household')) contexts.push('neighbors');
  if (a.militaryUnitId && a.militaryUnitId === b.militaryUnitId) contexts.push('army');
  if (a.courtFactionId && a.courtFactionId === b.courtFactionId) contexts.push('court');
  if (a.profession === 'priest' || b.profession === 'priest') contexts.push('faith');
  return [...new Set(contexts)];
}

function seedStructuralRelationships(world: WorldState, indexes?: WorldIndexes): void {
  const byHousehold = new Map<number, Character[]>();
  const byWork = new Map<number, Character[]>();
  for (const character of world.characters) {
    if (character.householdId) { const list = byHousehold.get(character.householdId) ?? []; list.push(character); byHousehold.set(character.householdId, list); }
    if (character.employerEstablishmentId) { const list = byWork.get(character.employerEstablishmentId) ?? []; list.push(character); byWork.set(character.employerEstablishmentId, list); }
  }
  for (const members of byHousehold.values()) connectSmallGroup(world, members, 'родство', 'совместная жизнь в одном доме', ['household', 'family'], indexes, 6);
  for (const workers of byWork.values()) connectSmallGroup(world, workers, 'дружба', 'ежедневная совместная работа', ['work'], indexes, 4);
  for (const unit of world.militaryUnits) {
    const members = unit.memberIds.map(id => world.characters.find(item => item.id === id)).filter((item): item is Character => Boolean(item));
    connectSmallGroup(world, members, 'верность', `совместная служба в подразделении ${unit.name}`, ['army'], indexes, 3);
  }
  for (const faction of world.courtFactions) {
    const members = faction.memberIds.map(id => world.characters.find(item => item.id === id)).filter((item): item is Character => Boolean(item));
    connectSmallGroup(world, members, 'верность', `участие в группировке ${faction.name}`, ['court'], indexes, 3);
  }
}

function connectSmallGroup(world: WorldState, members: Character[], kind: Relationship['kind'], reason: string, contexts: SocialContextKind[], indexes: WorldIndexes | undefined, limitPerPerson: number): void {
  const sorted = [...members].sort((a, b) => a.id - b.id);
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i]!;
    let added = 0;
    for (let step = 1; step < sorted.length && added < limitPerPerson; step += 1) {
      const b = sorted[(i + step) % sorted.length]!;
      if (a.id === b.id) continue;
      const family = a.spouseId === b.id || b.spouseId === a.id || a.parentIds.includes(b.id) || b.parentIds.includes(a.id) || a.childIds.includes(b.id) || b.childIds.includes(a.id);
      const actualKind = kind === 'родство' && !family ? 'дружба' : kind;
      const actualContexts = family ? [...new Set<SocialContextKind>([...contexts, 'family'])] : contexts.filter(context => context !== 'family');
      const relationship = ensureRelationship(world, a, b, actualKind, 45 + hashSeed(`${world.config.seed}:social:${a.id}:${b.id}`) % 35, reason, actualContexts, indexes);
      if (relationship) added += 1;
    }
  }
}

function ensureRelationship(world: WorldState, a: Character, b: Character, kind: Relationship['kind'], strength: number, reason: string, contexts: SocialContextKind[], indexes?: WorldIndexes): Relationship | undefined {
  if (a.id === b.id) return undefined;
  const existing = relationshipBetween(world, a.id, b.id, indexes);
  if (existing) {
    normalizeRelationship(world, existing);
    existing.contexts = [...new Set([...(existing.contexts ?? []), ...contexts])];
    return existing;
  }
  if (a.relationshipIds.length >= MAX_RELATIONSHIPS_PER_CHARACTER || b.relationshipIds.length >= MAX_RELATIONSHIPS_PER_CHARACTER) return undefined;
  const relation: Relationship = {
    id: world.nextIds.relationship++, characterAId: a.id, characterBId: b.id, kind, strength: clamp(strength), sinceYear: world.year,
    public: kind !== 'ненависть', reason, contexts: [...new Set(contexts)], ...relationDefaults(kind, strength), interactionCount: 0,
    lastInteractionTick: worldTick(world), status: 'stable', history: [],
  };
  relation.status = relationshipStatus(relation);
  world.relationships.push(relation);
  if (!a.relationshipIds.includes(relation.id)) a.relationshipIds.push(relation.id);
  if (!b.relationshipIds.includes(relation.id)) b.relationshipIds.push(relation.id);
  indexes && indexRelationship(indexes, relation);
  return relation;
}

function seedDebtObligations(world: WorldState, indexes?: WorldIndexes): void {
  for (const relationship of world.relationships.filter(item => item.kind === 'долг')) {
    if (world.socialObligations.some(item => item.status === 'active' && [item.debtorCharacterId, item.creditorCharacterId].includes(relationship.characterAId) && [item.debtorCharacterId, item.creditorCharacterId].includes(relationship.characterBId))) continue;
    const debtor = indexes?.characterById.get(relationship.characterAId) ?? world.characters.find(item => item.id === relationship.characterAId);
    const creditor = indexes?.characterById.get(relationship.characterBId) ?? world.characters.find(item => item.id === relationship.characterBId);
    if (!debtor || !creditor) continue;
    const poorer = debtor.wealth + debtor.wallet <= creditor.wealth + creditor.wallet ? debtor : creditor;
    const richer = poorer.id === debtor.id ? creditor : debtor;
    ensureObligation(world, 'loan', poorer.id, richer.id, poorer.settlementId, Math.max(3, relationship.strength * .22), relationship.strength, relationship.reason, false, worldTick(world) + 24);
  }
}

function formContextualRelationships(world: WorldState, rng: RNG, indexes: WorldIndexes): void {
  for (const settlement of world.settlements) {
    const locals = (indexes.residentsBySettlement.get(settlement.id) ?? []).filter(item => item.alive && item.age >= 12 && item.relationshipIds.length < MAX_RELATIONSHIPS_PER_CHARACTER);
    const attempts = Math.min(10, Math.max(2, Math.ceil(locals.length / 180)));
    for (let attempt = 0; attempt < attempts && locals.length > 1; attempt += 1) {
      const a = rng.pick(locals);
      const candidates = locals.filter(b => b.id !== a.id && !relationshipBetween(world, a.id, b.id, indexes));
      if (!candidates.length) continue;
      const b = rng.weighted(candidates.slice(0, 80).map(candidate => ({ value: candidate, weight: Math.max(1, contextualWeight(a, candidate)) })));
      const contexts = inferContexts(a, b, 'дружба');
      const kind: Relationship['kind'] = contexts.includes('work') || contexts.includes('army') ? 'верность' : rng.chance(.72) ? 'дружба' : 'соперничество';
      ensureRelationship(world, a, b, kind, rng.int(28, 62), contexts.includes('work') ? 'познакомились через работу' : contexts.includes('faith') ? 'познакомились при храме' : 'регулярно встречались в поселении', contexts.length ? contexts : ['market'], indexes);
    }
  }
}

function contextualWeight(a: Character, b: Character): number {
  let weight = 1;
  if (a.householdId && a.householdId === b.householdId) weight += 20;
  if (a.employerEstablishmentId && a.employerEstablishmentId === b.employerEstablishmentId) weight += 16;
  if (a.homeDistrict && a.homeDistrict === b.homeDistrict) weight += 8;
  if (a.profession === b.profession) weight += 5;
  if (a.militaryUnitId && a.militaryUnitId === b.militaryUnitId) weight += 18;
  return weight;
}

function advanceRelationships(world: WorldState, rng: RNG, indexes: WorldIndexes): void {
  const tick = worldTick(world);
  for (const relationship of world.relationships) {
    const a = indexes.characterById.get(relationship.characterAId);
    const b = indexes.characterById.get(relationship.characterBId);
    if (!a || !b) continue;
    relationship.contexts = [...new Set([...(relationship.contexts ?? []), ...inferContexts(a, b, relationship.kind)])];
    const sharedHouse = a.householdId && a.householdId === b.householdId;
    const sharedWork = a.employerEstablishmentId && a.employerEstablishmentId === b.employerEstablishmentId;
    const stress = (a.mind?.emotions.stress ?? 20) + (b.mind?.emotions.stress ?? 20);
    const compatibility = 18 - Math.abs((a.mind?.traits.honesty ?? 50) - (b.mind?.traits.honesty ?? 50)) * .12 - Math.abs((a.mind?.values.family ?? 50) - (b.mind?.values.family ?? 50)) * .08;
    const contact = sharedHouse ? 3.5 : sharedWork ? 2.5 : relationship.contexts?.includes('army') ? 2 : 1;
    const positive = contact + compatibility * .08 + rng.int(-2, 2);
    const conflict = stress / 90 + ((a.mind?.emotions.anger ?? 0) + (b.mind?.emotions.anger ?? 0)) / 130 + rng.int(-1, 2);
    relationship.trust = clamp((relationship.trust ?? 40) + positive * .35 - conflict * .35);
    relationship.affection = clamp((relationship.affection ?? 35) + positive * .38 - conflict * .45);
    relationship.respect = clamp((relationship.respect ?? 35) + positive * .28 + (a.renown + b.renown) / 500 - conflict * .18);
    relationship.tension = clamp((relationship.tension ?? 15) + conflict * .55 - positive * .25);
    relationship.fear = clamp((relationship.fear ?? 0) + Math.max(0, Math.abs(a.renown - b.renown) - 40) * .02 - .25);
    relationship.familiarity = clamp((relationship.familiarity ?? 35) + contact * .8);
    relationship.interactionCount = (relationship.interactionCount ?? 0) + 1;
    relationship.lastInteractionTick = tick;
    const previousKind = relationship.kind;
    relationship.status = relationshipStatus(relationship);
    relationship.kind = relationshipKind(relationship, a, b);
    relationship.strength = relationshipStrength(relationship);
    if (previousKind !== relationship.kind) pushHistory(relationship, `В ${world.year} году связь изменилась: ${previousKind} → ${relationship.kind}.`);
  }
}

function advanceUnions(world: WorldState, rng: RNG, indexes: WorldIndexes): void {
  const tick = worldTick(world);
  const handled = new Set<number>();
  const divorceCounts = new Map<number, number>();
  const divorceLimitBySettlement = new Map(world.settlements.map(settlement => [settlement.id, Math.max(1, Math.ceil(settlement.population / 1_000))]));
  const totalDivorceLimit = Math.max(2, Math.ceil(world.characters.length / 600));
  let divorces = 0;
  for (const person of world.characters.filter(item => item.spouseId && item.id < item.spouseId!)) {
    if (divorces >= totalDivorceLimit) break;
    const spouse = indexes.characterById.get(person.spouseId!);
    if (!spouse) { person.spouseId = undefined; continue; }
    const localDivorceLimit = divorceLimitBySettlement.get(person.settlementId) ?? 1;
    if ((divorceCounts.get(person.settlementId) ?? 0) >= localDivorceLimit) continue;
    const relation = relationshipBetween(world, person.id, spouse.id, indexes);
    if (!relation) continue;
    const tension = relation.tension ?? 0;
    const affection = relation.affection ?? 0;
    const divorcePressure = tension - affection + (person.mind?.values.freedom ?? 0) * .18 + (spouse.mind?.values.freedom ?? 0) * .18 - (person.mind?.values.family ?? 0) * .16 - (spouse.mind?.values.family ?? 0) * .16;
    if (divorcePressure < 38 || !rng.chance(Math.min(.5, .04 + divorcePressure / 220))) continue;
    const actor = divorcePressure + (person.mind?.values.freedom ?? 0) >= divorcePressure + (spouse.mind?.values.freedom ?? 0) ? person : spouse;
    const options = [
      scoreMotivatedAction(world, actor, { id: 'stay', label: 'Сохранить брак', base: 18, familyBenefit: 28, socialApproval: 12, freedomBenefit: -12, situational: { 'напряжение': -tension * .2 } }),
      scoreMotivatedAction(world, actor, { id: 'leave', label: 'Разорвать брак', base: divorcePressure, freedomBenefit: 32, familyBenefit: -24, socialApproval: -8, risk: 12 }),
    ];
    const decision = recordDecision(world, { actorRef: { kind: 'character', id: actor.id }, goal: 'решить судьбу брака', context: `брак с ${actor.id === person.id ? spouse.name : person.name}`, knownFactIds: decisionKnowledge(world, { kind: 'character', id: actor.id }), options, chosenOptionId: 'leave', tags: ['семья', 'развод'] });
    const beforeA = person.spouseId;
    const beforeB = spouse.spouseId;
    person.spouseId = undefined; spouse.spouseId = undefined;
    relation.kind = 'соперничество'; relation.tension = clamp(tension + 15); relation.affection = clamp(affection - 20); relation.status = 'broken'; relation.reason = 'брак распался после длительного конфликта';
    pushHistory(relation, `В ${world.year} году брак распался.`);
    recordStateDelta(world, { entityRef: { kind: 'character', id: person.id }, field: 'spouseId', before: beforeA, after: undefined, cause: 'развод', decisionId: decision.id });
    recordStateDelta(world, { entityRef: { kind: 'character', id: spouse.id }, field: 'spouseId', before: beforeB, after: undefined, cause: 'развод', decisionId: decision.id });
    splitHouseholdAfterDivorce(world, actor, actor.id === person.id ? spouse : person, rng, indexes);
    person.biography.push(`В ${world.year} году развёлся с ${spouse.name}.`); spouse.biography.push(`В ${world.year} году развёлся с ${person.name}.`);
    appendCausalEvent(world, { kind: 'household', title: `Распался брак ${person.name} и ${spouse.name}`, description: 'Супруги разделили дом, деньги и обязанности.', cause: 'накопившееся напряжение и потеря доверия', consequences: ['домохозяйства разделились', 'отношения семьи изменились'], entityRefs: [{ kind: 'character', id: person.id }, { kind: 'character', id: spouse.id }], importance: person.titles.length || spouse.titles.length ? 3 : 1 });
    handled.add(person.id); handled.add(spouse.id);
    divorceCounts.set(person.settlementId, (divorceCounts.get(person.settlementId) ?? 0) + 1);
    divorces += 1;
  }

  const candidates = world.relationships
    .filter(relation => ['любовь', 'дружба'].includes(relation.kind) && (relation.affection ?? 0) >= 62 && (relation.trust ?? 0) >= 45 && (relation.tension ?? 0) < 45)
    .sort((a, b) => (b.affection ?? 0) - (a.affection ?? 0) || a.id - b.id);
  const marriageCounts = new Map<number, number>();
  const marriageLimitBySettlement = new Map(world.settlements.map(settlement => [settlement.id, Math.max(1, Math.ceil(settlement.population / 280))]));
  const totalMarriageLimit = Math.max(6, Math.ceil(world.characters.length / 120));
  let marriages = 0;
  for (const relation of candidates) {
    if (marriages >= totalMarriageLimit) break;
    const a = indexes.characterById.get(relation.characterAId);
    const b = indexes.characterById.get(relation.characterBId);
    if (!a || !b || a.spouseId || b.spouseId || handled.has(a.id) || handled.has(b.id) || a.age < 16 || b.age < 16 || a.settlementId !== b.settlementId || Math.abs(a.age - b.age) > 35) continue;
    const localMarriageLimit = marriageLimitBySettlement.get(a.settlementId) ?? 1;
    if ((marriageCounts.get(a.settlementId) ?? 0) >= localMarriageLimit) continue;
    const compatibility = (relation.affection ?? 0) + (relation.trust ?? 0) + (a.mind?.values.family ?? 0) * .35 + (b.mind?.values.family ?? 0) * .35 - (relation.tension ?? 0);
    if (compatibility < 135 || !rng.chance(Math.min(.55, .06 + compatibility / 500))) continue;
    const actor = (a.mind?.traits.ambition ?? 0) + (a.mind?.values.family ?? 0) >= (b.mind?.traits.ambition ?? 0) + (b.mind?.values.family ?? 0) ? a : b;
    const options = [
      scoreMotivatedAction(world, actor, { id: 'marry', label: 'Предложить брак', base: compatibility * .16, familyBenefit: 34, socialApproval: 14, risk: 8 }),
      scoreMotivatedAction(world, actor, { id: 'wait', label: 'Не менять отношения', base: 18, freedomBenefit: 10, risk: -4 }),
    ];
    const decision = recordDecision(world, { actorRef: { kind: 'character', id: actor.id }, goal: 'создать семью', context: `отношения с ${actor.id === a.id ? b.name : a.name}`, knownFactIds: decisionKnowledge(world, { kind: 'character', id: actor.id }), options, chosenOptionId: 'marry', tags: ['семья', 'брак'] });
    a.spouseId = b.id; b.spouseId = a.id;
    relation.kind = 'любовь'; relation.contexts = [...new Set<SocialContextKind>([...(relation.contexts ?? []), 'family', 'household'])]; relation.status = 'close'; relation.reason = `брак в ${world.settlements.find(item => item.id === a.settlementId)?.name ?? 'поселении'}`;
    mergeHouseholds(world, a, b, indexes);
    recordStateDelta(world, { entityRef: { kind: 'character', id: a.id }, field: 'spouseId', before: undefined, after: b.id, cause: 'взаимное решение вступить в брак', decisionId: decision.id });
    recordStateDelta(world, { entityRef: { kind: 'character', id: b.id }, field: 'spouseId', before: undefined, after: a.id, cause: 'взаимное решение вступить в брак', decisionId: decision.id });
    a.biography.push(`В ${world.year} году вступил в брак с ${b.name}.`); b.biography.push(`В ${world.year} году вступил в брак с ${a.name}.`);
    appendCausalEvent(world, { kind: 'household', title: `Брак ${a.name} и ${b.name}`, description: 'Два человека объединили дом, имущество и обязанности.', cause: 'доверие, привязанность и желание создать семью', consequences: ['домохозяйства объединились', 'возникли новые родственные связи'], entityRefs: [{ kind: 'character', id: a.id }, { kind: 'character', id: b.id }, ...(a.householdId ? [{ kind: 'household' as const, id: a.householdId }] : [])], importance: a.titles.length || b.titles.length ? 3 : 1 });
    handled.add(a.id); handled.add(b.id);
    marriageCounts.set(a.settlementId, (marriageCounts.get(a.settlementId) ?? 0) + 1);
    marriages += 1;
  }
  void tick;
}

function advancePrivateAffairs(world: WorldState, rng: RNG, indexes?: WorldIndexes): void {
  for (const relationship of world.relationships.filter(item => item.kind === 'любовь' && (item.affection ?? 0) > 72 && (item.tension ?? 0) < 35)) {
    const a = indexes?.characterById.get(relationship.characterAId) ?? world.characters.find(item => item.id === relationship.characterAId);
    const b = indexes?.characterById.get(relationship.characterBId) ?? world.characters.find(item => item.id === relationship.characterBId);
    if (!a || !b || (!a.spouseId && !b.spouseId) || a.spouseId === b.id || b.spouseId === a.id) continue;
    if ((a.mind?.traits.honesty ?? 50) + (b.mind?.traits.honesty ?? 50) > 105 || !rng.chance(.025)) continue;
    relationship.public = false;
    relationship.contexts = [...new Set<SocialContextKind>([...(relationship.contexts ?? []), 'neighbors'])];
    const summary = `тайная связь ${a.name} и ${b.name}`;
    addCharacterSecret(world, a, { id: `affair:${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`, kind: 'affair', severity: 58, knownByCharacterIds: [b.id], exposed: false, summary });
    addCharacterSecret(world, b, { id: `affair:${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`, kind: 'affair', severity: 58, knownByCharacterIds: [a.id], exposed: false, summary });
    for (const person of [a, b]) {
      const spouse = person.spouseId ? indexes?.characterById.get(person.spouseId) ?? world.characters.find(item => item.id === person.spouseId) : undefined;
      const marriage = spouse ? relationshipBetween(world, person.id, spouse.id, indexes) : undefined;
      if (marriage) { marriage.trust = clamp((marriage.trust ?? 50) - 5); marriage.tension = clamp((marriage.tension ?? 10) + 7); }
    }
  }
}

function advanceObligations(world: WorldState, rng: RNG, indexes: WorldIndexes): void {
  const tick = worldTick(world);
  const changedDebtorIds = new Set<number>();
  for (const obligation of world.socialObligations) {
    if (obligation.status !== 'active') continue;
    const debtor = indexes.characterById.get(obligation.debtorCharacterId);
    const creditor = indexes.characterById.get(obligation.creditorCharacterId);
    if (!debtor || !creditor) { obligation.status = 'broken'; obligation.resolvedTick = tick; continue; }
    const tie = relationshipBetween(world, debtor.id, creditor.id, indexes);
    if (obligation.amount > 0) {
      const scheduled = obligation.dueTick !== undefined && tick >= obligation.dueTick;
      const voluntary = (debtor.mind?.traits.honesty ?? 50) + (tie?.trust ?? 0) * .3 > 72 && rng.chance(.16);
      if (scheduled || voluntary) {
        const payment = transferPrivateMoney(world, debtor, creditor, Math.min(obligation.amount, Math.max(1, obligation.amount * .35)));
        if (payment > 0) {
          const before = obligation.amount;
          obligation.amount = Math.max(0, obligation.amount - payment);
          obligation.history.push(`${payment.toFixed(1)} крон выплачено в ${world.year}.${String(world.month).padStart(2, '0')}.`);
          recordStateDelta(world, { entityRef: { kind: 'character', id: debtor.id }, field: `socialObligation:${obligation.id}`, before, after: obligation.amount, amount: -payment, cause: 'выплата личного долга' });
          if (tie) { tie.trust = clamp((tie.trust ?? 40) + 3); tie.tension = clamp((tie.tension ?? 15) - 4); }
          changedDebtorIds.add(debtor.id);
          if (obligation.amount <= .05) { obligation.status = 'fulfilled'; obligation.resolvedTick = tick; }
        } else if (scheduled && tick - obligation.dueTick! > 6) {
          defaultObligation(world, obligation, debtor, creditor, tie);
          changedDebtorIds.add(debtor.id);
        }
      }
    } else if (obligation.dueTick !== undefined && tick >= obligation.dueTick) {
      const reliability = (debtor.mind?.traits.honesty ?? 50) + (debtor.mind?.values.family ?? 0) * (obligation.kind === 'family_support' ? .35 : 0) + (tie?.trust ?? 0) * .25;
      if (rng.chance(clamp01(reliability / 120))) {
        obligation.status = 'fulfilled'; obligation.resolvedTick = tick; obligation.history.push('Обещание или услуга выполнены.'); changedDebtorIds.add(debtor.id);
        if (tie) { tie.trust = clamp((tie.trust ?? 40) + 5); tie.affection = clamp((tie.affection ?? 30) + 3); }
      } else {
        defaultObligation(world, obligation, debtor, creditor, tie);
        changedDebtorIds.add(debtor.id);
      }
    }
  }
  if ([4, 10].includes(world.month)) createSocialObligations(world, rng, indexes, changedDebtorIds);
  syncMindObligations(world, indexes, changedDebtorIds);
}

function createSocialObligations(world: WorldState, rng: RNG, indexes: WorldIndexes, changedDebtorIds: Set<number>): void {
  const candidates = world.relationships.filter(item => item.status === 'close' || ((item.trust ?? 0) > 60 && (item.tension ?? 0) < 30));
  for (const tie of candidates.slice(0, Math.min(80, candidates.length))) {
    if (!rng.chance(.06)) continue;
    const a = indexes.characterById.get(tie.characterAId);
    const b = indexes.characterById.get(tie.characterBId);
    if (!a || !b || world.socialObligations.some(item => item.status === 'active' && ((item.debtorCharacterId === a.id && item.creditorCharacterId === b.id) || (item.debtorCharacterId === b.id && item.creditorCharacterId === a.id)))) continue;
    const householdA = a.householdId ? world.households.find(item => item.id === a.householdId) : undefined;
    const householdB = b.householdId ? world.households.find(item => item.id === b.householdId) : undefined;
    const poorA = (householdA?.wealth ?? a.wallet) < (householdB?.wealth ?? b.wallet) * .55;
    const debtor = poorA ? a : b;
    const creditor = poorA ? b : a;
    const amount = Math.min(20, Math.max(2, ((creditor.wallet + (creditor.householdId ? world.households.find(item => item.id === creditor.householdId)?.wealth ?? 0 : 0)) * .08)));
    const kind: SocialObligationKind = tie.contexts?.includes('family') ? 'family_support' : rng.chance(.6) ? 'loan' : 'service';
    ensureObligation(world, kind, debtor.id, creditor.id, debtor.settlementId, kind === 'loan' ? amount : 0, clamp(45 + (tie.trust ?? 0) * .4), kind === 'loan' ? 'личный заём через доверенные отношения' : 'обещанная помощь знакомому', false, worldTick(world) + rng.int(6, 24));
    changedDebtorIds.add(debtor.id);
  }
}

function ensureObligation(world: WorldState, kind: SocialObligationKind, debtorId: number, creditorId: number, settlementId: number, amount: number, strength: number, reason: string, secret: boolean, dueTick?: number): SocialObligation {
  const existing = world.socialObligations.find(item => item.status === 'active' && item.kind === kind && item.debtorCharacterId === debtorId && item.creditorCharacterId === creditorId);
  if (existing) { existing.amount = Math.max(existing.amount, amount); existing.strength = Math.max(existing.strength, strength); existing.dueTick = existing.dueTick ?? dueTick; return existing; }
  const obligation: SocialObligation = { id: world.nextIds.socialObligation++, kind, debtorCharacterId: debtorId, creditorCharacterId: creditorId, settlementId, amount, strength: clamp(strength), createdTick: worldTick(world), dueTick, status: 'active', reason, secret, history: [`Возникло в ${world.year}.${String(world.month).padStart(2, '0')}.`] };
  world.socialObligations.push(obligation);
  return obligation;
}

function defaultObligation(world: WorldState, obligation: SocialObligation, debtor: Character, creditor: Character, tie: Relationship | undefined): void {
  obligation.status = obligation.kind === 'promise' || obligation.kind === 'service' || obligation.kind === 'family_support' ? 'broken' : 'defaulted';
  obligation.resolvedTick = worldTick(world); obligation.history.push('Обязательство нарушено после истечения срока.');
  if (tie) { tie.trust = clamp((tie.trust ?? 40) - 14); tie.tension = clamp((tie.tension ?? 20) + 18); tie.kind = tie.tension > 72 ? 'ненависть' : 'долг'; tie.status = relationshipStatus(tie); }
  addCharacterSecret(world, debtor, { kind: obligation.kind === 'loan' ? 'hidden_debt' : 'betrayal', severity: clamp(30 + obligation.strength * .45), knownByCharacterIds: [creditor.id], exposed: false, summary: `нарушил обязательство перед ${creditor.name}: ${obligation.reason}` });
  debtor.mind!.emotions.stress = clamp(debtor.mind!.emotions.stress + 8);
  creditor.mind!.emotions.anger = clamp(creditor.mind!.emotions.anger + 12);
}

function syncMindObligations(world: WorldState, indexes: WorldIndexes, characterIds: ReadonlySet<number>): void {
  if (!characterIds.size) return;
  const obligationsByDebtor = new Map<number, SocialObligation[]>();
  for (const obligation of world.socialObligations) {
    if (obligation.status !== 'active' || !characterIds.has(obligation.debtorCharacterId)) continue;
    const list = obligationsByDebtor.get(obligation.debtorCharacterId) ?? [];
    list.push(obligation);
    obligationsByDebtor.set(obligation.debtorCharacterId, list);
  }
  for (const characterId of characterIds) {
    const character = indexes.characterById.get(characterId);
    if (!character) continue;
    const mind = ensureCharacterMind(world, character);
    const persistent = mind.obligations.filter(item => !item.id.startsWith('social:'));
    const social = (obligationsByDebtor.get(character.id) ?? []).slice(-8).map(item => ({
      id: `social:${item.id}`, kind: item.kind === 'loan' ? 'debt' as const : 'promise' as const,
      targetRef: { kind: 'character' as const, id: item.creditorCharacterId }, strength: item.strength, dueTick: item.dueTick, fulfilled: false, reason: item.reason,
    }));
    mind.obligations = [...persistent, ...social].slice(0, 14);
  }
}

function processDeathAftermath(world: WorldState, indexes: WorldIndexes): void {
  const lastId = world.simulation.lastSocialBurialId ?? 0;
  const recent = world.burials.filter(item => item.id > lastId && item.subjectKind === 'character').sort((a, b) => a.id - b.id);
  for (const burial of recent) {
    const relatives = [...new Set([...(burial.parentIds ?? []), ...(burial.childIds ?? []), ...(burial.spouseId ? [burial.spouseId] : [])])];
    for (const id of relatives) {
      const survivor = indexes.characterById.get(id);
      if (!survivor) continue;
      const mind = ensureCharacterMind(world, survivor);
      mind.emotions.grief = clamp(mind.emotions.grief + 28 + burial.renown * .12);
      mind.emotions.stress = clamp(mind.emotions.stress + 12);
      if (/убит|убий|казн|сраж|напад/i.test(burial.cause)) {
        mind.emotions.anger = clamp(mind.emotions.anger + 18);
        const revenge = mind.goals.find(item => item.kind === 'revenge' && item.status === 'active');
        if (revenge) { revenge.priority = clamp(revenge.priority + 15); revenge.reason = `отомстить за смерть ${burial.name}`; }
        else mind.goals.push({ id: `goal:${survivor.id}:revenge:${burial.id}`, kind: 'revenge', priority: clamp(55 + mind.traits.courage * .25 + mind.emotions.anger * .25), status: 'active', reason: `отомстить за смерть ${burial.name}`, progress: 0, createdTick: worldTick(world), updatedTick: worldTick(world) });
      }
      survivor.biography.push(`Тяжело пережил смерть ${burial.name} в ${burial.deathYear} году.`);
    }
  }
  if (recent.length) world.simulation.lastSocialBurialId = recent.at(-1)!.id;
}

function mergeHouseholds(world: WorldState, a: Character, b: Character, indexes: WorldIndexes): void {
  const householdA = a.householdId ? indexes.householdById.get(a.householdId) ?? world.households.find(item => item.id === a.householdId) : undefined;
  const householdB = b.householdId ? indexes.householdById.get(b.householdId) ?? world.households.find(item => item.id === b.householdId) : undefined;
  if (!householdA && !householdB) return;
  if (!householdA) { a.householdId = householdB!.id; addUnique(householdB!.memberIds, a.id); a.homeBuildingId = householdB!.homeBuildingId; return; }
  if (!householdB) { b.householdId = householdA.id; addUnique(householdA.memberIds, b.id); b.homeBuildingId = householdA.homeBuildingId; return; }
  if (householdA.id === householdB.id) return;
  const target = householdA.wealth + householdA.memberIds.length >= householdB.wealth + householdB.memberIds.length ? householdA : householdB;
  const source = target.id === householdA.id ? householdB : householdA;
  const targetHome = target.homeBuildingId ? indexes.buildingById.get(target.homeBuildingId) : undefined;
  const sourceHome = source.homeBuildingId ? indexes.buildingById.get(source.homeBuildingId) : undefined;
  for (const id of source.memberIds) {
    const member = indexes.characterById.get(id);
    if (member) {
      if (member.settlementId !== target.settlementId) moveResidentInIndexes(indexes, member, target.settlementId);
      member.householdId = target.id;
      member.homeBuildingId = target.homeBuildingId;
      member.homeDistrict = targetHome?.districtName ?? member.homeDistrict;
    }
    addUnique(target.memberIds, id);
    if (sourceHome) sourceHome.residentIds = sourceHome.residentIds.filter(residentId => residentId !== id);
    if (targetHome) addUnique(targetHome.residentIds, id);
  }
  target.wealth += source.wealth; target.debt += source.debt; target.inventoryItemIds.push(...source.inventoryItemIds.filter(id => !target.inventoryItemIds.includes(id)));
  for (const itemId of source.inventoryItemIds) {
    const item = indexes.itemById.get(itemId);
    if (item?.householdId === source.id) { item.householdId = target.id; item.settlementId = target.settlementId; item.buildingId = target.homeBuildingId; }
  }
  if (sourceHome?.householdId === source.id) sourceHome.householdId = undefined;
  world.households = world.households.filter(item => item.id !== source.id);
  for (const settlement of world.settlements) settlement.householdIds = settlement.householdIds.filter(id => id !== source.id);
  const targetSettlement = indexes.settlementById.get(target.settlementId);
  if (targetSettlement) addUnique(targetSettlement.householdIds, target.id);
  indexes.householdById.delete(source.id);
  for (const [settlementId, households] of indexes.householdsBySettlement) {
    indexes.householdsBySettlement.set(settlementId, households.filter(item => item.id !== source.id));
  }
  const list = indexes.householdsBySettlement.get(target.settlementId) ?? [];
  if (!list.some(item => item.id === target.id)) list.push(target);
  indexes.householdsBySettlement.set(target.settlementId, list);
}

function splitHouseholdAfterDivorce(world: WorldState, leaving: Character, staying: Character, rng: RNG, indexes: WorldIndexes): void {
  const source = leaving.householdId ? indexes.householdById.get(leaving.householdId) ?? world.households.find(item => item.id === leaving.householdId) : undefined;
  if (!source || source.id !== staying.householdId || source.memberIds.length < 2) return;
  const wealth = source.wealth * .35;
  const debt = source.debt * .35;
  source.wealth -= wealth; source.debt -= debt; source.memberIds = source.memberIds.filter(id => id !== leaving.id);
  const settlement = indexes.settlementById.get(leaving.settlementId);
  if (!settlement) return;
  const home = (indexes.buildingsBySettlement.get(settlement.id) ?? []).find(item => ['house', 'tenement', 'manor'].includes(item.type) && item.condition > 25 && !item.householdId);
  const household: Household = {
    id: world.nextIds.household++, settlementId: settlement.id, homeBuildingId: home?.id, headCharacterId: leaving.id, memberIds: [leaving.id], status: wealth > 80 ? 'зажиточные' : wealth < 8 ? 'бедные' : 'обычные',
    wealth, debt, monthlyIncome: 0, monthlyExpenses: 0, foodReserveDays: 0, fuelReserveDays: 0, inventoryItemIds: [], needs: { ...leaving.needs }, history: [`Создано после развода в ${world.year} году.`],
  };
  world.households.push(household); settlement.householdIds.push(household.id); indexes.householdById.set(household.id, household);
  const list = indexes.householdsBySettlement.get(settlement.id) ?? []; list.push(household); indexes.householdsBySettlement.set(settlement.id, list);
  leaving.householdId = household.id; leaving.homeBuildingId = home?.id; leaving.homeless = !home;
  if (home) { home.householdId = household.id; addUnique(home.residentIds, leaving.id); }
  if (source.homeBuildingId) { const oldHome = indexes.buildingById.get(source.homeBuildingId); if (oldHome) oldHome.residentIds = oldHome.residentIds.filter(id => id !== leaving.id); }
  void rng;
}

function transferPrivateMoney(world: WorldState, from: Character, to: Character, amount: number): number {
  let remaining = Math.max(0, amount);
  const fromWallet = Math.min(from.wallet, remaining); from.wallet -= fromWallet; remaining -= fromWallet;
  const household = from.householdId ? world.households.find(item => item.id === from.householdId) : undefined;
  const fromHousehold = household ? Math.min(household.wealth, remaining) : 0;
  if (household) household.wealth -= fromHousehold;
  const paid = fromWallet + fromHousehold;
  to.wallet += paid;
  return paid;
}

function relationshipKind(relationship: Relationship, a: Character, b: Character): Relationship['kind'] {
  if (a.spouseId === b.id || b.spouseId === a.id) return 'любовь';
  if (a.parentIds.includes(b.id) || b.parentIds.includes(a.id) || a.childIds.includes(b.id) || b.childIds.includes(a.id)) return 'родство';
  if ((relationship.tension ?? 0) >= 78 && (relationship.affection ?? 0) < 22) return 'ненависть';
  if ((relationship.fear ?? 0) >= 65 && (relationship.trust ?? 0) < 30) return 'страх';
  if ((relationship.tension ?? 0) >= 55) return 'соперничество';
  if ((relationship.affection ?? 0) >= 72 && (relationship.trust ?? 0) >= 48) return 'любовь';
  if ((relationship.trust ?? 0) >= 60 && (relationship.affection ?? 0) >= 42) return 'дружба';
  if ((relationship.respect ?? 0) >= 62 && (relationship.trust ?? 0) >= 45) return 'верность';
  return relationship.kind === 'долг' ? 'долг' : 'дружба';
}

function relationshipStatus(relationship: Relationship): RelationshipStatus {
  if ((relationship.tension ?? 0) >= 82) return 'hostile';
  if ((relationship.tension ?? 0) >= 58) return 'strained';
  if ((relationship.trust ?? 0) >= 65 && (relationship.affection ?? 0) >= 58) return 'close';
  if ((relationship.familiarity ?? 0) < 28) return 'distant';
  return 'stable';
}

function relationshipStrength(relationship: Relationship): number {
  return clamp(((relationship.trust ?? 0) + (relationship.affection ?? 0) + (relationship.respect ?? 0) + (relationship.familiarity ?? 0) - (relationship.tension ?? 0) - (relationship.fear ?? 0) * .25) / 3.2);
}

function pushHistory(relationship: Relationship, entry: string): void {
  relationship.history ??= [];
  if (relationship.history.at(-1) !== entry) relationship.history.push(entry);
  if (relationship.history.length > MAX_RELATION_HISTORY) relationship.history.splice(0, relationship.history.length - MAX_RELATION_HISTORY);
}

function trimSocialCollections(world: WorldState): void {
  if (world.socialObligations.length > MAX_OBLIGATIONS) {
    const active = world.socialObligations.filter(item => item.status === 'active');
    const resolved = world.socialObligations.filter(item => item.status !== 'active').slice(-(MAX_OBLIGATIONS - active.length));
    world.socialObligations = [...resolved, ...active].slice(-MAX_OBLIGATIONS);
  }
}

function addUnique(list: number[], value: number): void { if (!list.includes(value)) list.push(value); }
function clamp(value: number): number { return Math.max(0, Math.min(100, Math.round(value * 100) / 100)); }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
