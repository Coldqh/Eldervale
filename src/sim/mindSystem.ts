import type {
  Character, CharacterMind, CharacterObligation, CharacterSecret, CharacterTraitKey, CharacterValueKey,
  DecisionOptionScore, EntityRef, GroupReputation, PersonalGoal, PersonalGoalKind, WorldState,
} from '../types';
import { hashSeed, RNG } from './rng';
import { worldTick } from './scheduler';
import type { WorldIndexes } from './indexes';

export interface MotiveInput {
  id: string;
  label: string;
  base?: number;
  wealthGain?: number;
  powerGain?: number;
  familyBenefit?: number;
  faithBenefit?: number;
  orderBenefit?: number;
  freedomBenefit?: number;
  survivalBenefit?: number;
  risk?: number;
  harm?: number;
  deception?: number;
  violence?: number;
  socialApproval?: number;
  legalPenalty?: number;
  blockedReason?: string;
  situational?: Record<string, number>;
}

const TRAITS: CharacterTraitKey[] = ['greed', 'empathy', 'courage', 'patience', 'honesty', 'cruelty', 'ambition', 'riskTolerance'];
const VALUES: CharacterValueKey[] = ['family', 'faith', 'wealth', 'power', 'freedom', 'order'];

export function initializeMindSystem(world: WorldState): void {
  if (world.simulation.mindSystemVersion === 1) return;
  for (const character of world.characters) ensureCharacterMind(world, character);
  world.simulation.mindSystemVersion = 1;
}

export function ensureCharacterMind(world: WorldState, character: Character): CharacterMind {
  if (character.mind) {
    normalizeMind(world, character);
    return character.mind!;
  }
  const tick = worldTick(world);
  const trait = (name: CharacterTraitKey, offset = 0) => seededValue(world, character, `trait:${name}`, offset);
  const value = (name: CharacterValueKey, offset = 0) => seededValue(world, character, `value:${name}`, offset);
  const ambition = character.ambition.toLowerCase();
  const mind: CharacterMind = {
    traits: {
      greed: trait('greed', ambition.includes('разбогат') ? 24 : 0),
      empathy: trait('empathy', ambition.includes('семь') || ambition.includes('защит') ? 14 : 0),
      courage: trait('courage', ['guard', 'soldier', 'hunter'].includes(character.profession) ? 18 : 0),
      patience: trait('patience', ['farmer', 'scribe', 'priest', 'weaver'].includes(character.profession) ? 12 : 0),
      honesty: trait('honesty', character.profession === 'priest' ? 16 : 0),
      cruelty: trait('cruelty', character.profession === 'soldier' ? 8 : 0),
      ambition: trait('ambition', character.titles.length ? 20 : ambition.includes('власт') || ambition.includes('титул') ? 24 : 0),
      riskTolerance: trait('riskTolerance', ['hunter', 'merchant', 'soldier'].includes(character.profession) ? 14 : 0),
    },
    values: {
      family: value('family', character.spouseId || character.childIds.length ? 24 : 0),
      faith: value('faith', character.profession === 'priest' ? 36 : ambition.includes('бог') ? 24 : 0),
      wealth: value('wealth', ambition.includes('разбогат') ? 35 : character.profession === 'merchant' ? 18 : 0),
      power: value('power', ambition.includes('власт') || ambition.includes('титул') ? 36 : character.titles.length ? 22 : 0),
      freedom: value('freedom', ambition.includes('дорог') || ambition.includes('руин') ? 26 : 0),
      order: value('order', ['guard', 'soldier', 'scribe'].includes(character.profession) ? 20 : 0),
    },
    emotions: { fear: 12, anger: 8, grief: 0, hope: 55, stress: 18, contentment: 45, updatedTick: tick },
    goals: [], obligations: [], secrets: [], reputations: [], lastDecisionTick: tick,
  };
  character.mind = mind;
  refreshGoals(world, character);
  refreshObligations(world, character);
  updateReputations(world, character);
  return mind;
}

export function advanceMindSystem(
  world: WorldState,
  rng: RNG,
  indexes?: WorldIndexes,
  characterIds?: ReadonlySet<number>,
): void {
  if (world.simulation.mindSystemVersion !== 1) initializeMindSystem(world);
  const tick = worldTick(world);
  const targets = characterIds
    ? [...characterIds].map(id => indexes?.characterById.get(id) ?? world.characters.find(item => item.id === id)).filter((item): item is Character => Boolean(item))
    : world.characters;
  for (const character of targets) {
    if (!character.alive) continue;
    const mind = ensureCharacterMind(world, character);
    const household = character.householdId ? indexes?.householdById.get(character.householdId) ?? world.households.find(item => item.id === character.householdId) : undefined;
    const settlement = indexes?.settlementById.get(character.settlementId) ?? world.settlements.find(item => item.id === character.settlementId);
    const hunger = Math.max(character.needs.hunger, household?.needs.hunger ?? 0);
    const danger = Math.max(character.needs.safety, settlement?.unrest ?? 0, character.homeless ? 60 : 0);
    const debtPressure = Math.min(100, (household?.debt ?? 0) * 8 + (character.servicePayArrears ?? 0) * 3);
    const imprisoned = character.legalStatus === 'заключён' || character.legalStatus === 'под стражей';
    mind.emotions.fear = clamp(mind.emotions.fear * .78 + danger * .24 + (character.health < 45 ? 12 : 0) + rng.int(-3, 3));
    mind.emotions.anger = clamp(mind.emotions.anger * .82 + debtPressure * .12 + (imprisoned ? 18 : 0) + (settlement?.unrest ?? 0) * .06 + rng.int(-3, 3));
    mind.emotions.stress = clamp(mind.emotions.stress * .78 + hunger * .18 + danger * .15 + debtPressure * .15 + rng.int(-2, 3));
    mind.emotions.hope = clamp(mind.emotions.hope * .86 + (character.health + (settlement?.prosperity ?? 40)) * .07 - mind.emotions.stress * .05 + rng.int(-2, 2));
    mind.emotions.contentment = clamp(62 - hunger * .32 - danger * .22 - debtPressure * .18 + mind.emotions.hope * .22 + rng.int(-3, 3));
    // Новое горе начисляется системой смерти сразу родственникам. Здесь оно только затухает,
    // поэтому не требуется ежемесячно искать каждого родственника среди всех захоронений.
    mind.emotions.grief = clamp(mind.emotions.grief * .9);
    mind.emotions.updatedTick = tick;
    refreshGoals(world, character, indexes);
    refreshObligations(world, character);
    updateReputations(world, character);
    for (const goal of mind.goals) {
      if (goal.status !== 'active') continue;
      goal.priority = clamp(goal.priority + goalPressure(world, character, goal.kind, indexes));
      goal.updatedTick = tick;
    }
  }
}

export function scoreMotivatedAction(world: WorldState, character: Character, input: MotiveInput): DecisionOptionScore {
  const mind = ensureCharacterMind(world, character);
  const factors: Record<string, number> = {};
  const add = (key: string, value: number) => { if (Math.abs(value) >= .01) factors[key] = Math.round(value * 100) / 100; };
  let utility = input.base ?? 0;
  const weighted = (label: string, amount: number | undefined, weight: number) => {
    if (!amount) return;
    const value = amount * weight / 100;
    utility += value;
    add(label, value);
  };
  weighted('богатство', input.wealthGain, mind.values.wealth + mind.traits.greed * .55);
  weighted('власть', input.powerGain, mind.values.power + mind.traits.ambition * .7);
  weighted('семья', input.familyBenefit, mind.values.family + mind.traits.empathy * .35);
  weighted('вера', input.faithBenefit, mind.values.faith);
  weighted('порядок', input.orderBenefit, mind.values.order + mind.traits.honesty * .3);
  weighted('свобода', input.freedomBenefit, mind.values.freedom);
  weighted('выживание', input.survivalBenefit, 80 + mind.emotions.fear * .35);
  weighted('общественное одобрение', input.socialApproval, 45 + mind.values.order * .25 + mind.traits.empathy * .25);
  weighted('риск', input.risk, -(105 - mind.traits.riskTolerance - mind.traits.courage * .35 + mind.emotions.fear * .45));
  weighted('вред другим', input.harm, -(mind.traits.empathy + mind.traits.honesty * .2 - mind.traits.cruelty * .8));
  weighted('обман', input.deception, -(mind.traits.honesty - mind.traits.greed * .35));
  weighted('насилие', input.violence, -(mind.traits.empathy * .45 + mind.values.order * .3 - mind.traits.cruelty - mind.emotions.anger * .45));
  weighted('наказание', input.legalPenalty, -(mind.values.order + mind.emotions.fear * .6 + 35));
  for (const [key, value] of Object.entries(input.situational ?? {})) { utility += value; add(key, value); }
  return { id: input.id, label: input.label, utility: Math.round(utility * 100) / 100, factors, blockedReason: input.blockedReason };
}

export function addCharacterSecret(world: WorldState, character: Character, secret: Omit<CharacterSecret, 'id'> & { id?: string }): CharacterSecret {
  const mind = ensureCharacterMind(world, character);
  const id = secret.id ?? `secret:${character.id}:${worldTick(world)}:${mind.secrets.length + 1}`;
  const existing = mind.secrets.find(item => item.id === id);
  if (existing) return existing;
  const result: CharacterSecret = { ...secret, id };
  mind.secrets.push(result);
  if (mind.secrets.length > 10) mind.secrets.splice(0, mind.secrets.length - 10);
  return result;
}

export function setDecisionMoment(world: WorldState, character: Character): void {
  ensureCharacterMind(world, character).lastDecisionTick = worldTick(world);
}

export function mindIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  for (const character of world.characters) {
    if (!character.mind) { issues.push(`${character.name}: отсутствует психика`); continue; }
    for (const key of TRAITS) if (!validScale(character.mind.traits[key])) issues.push(`${character.name}: неверная черта ${key}`);
    for (const key of VALUES) if (!validScale(character.mind.values[key])) issues.push(`${character.name}: неверная ценность ${key}`);
    for (const goal of character.mind.goals) if (!validScale(goal.priority) || !validScale(goal.progress)) issues.push(`${character.name}: неверная цель ${goal.id}`);
    const secretIds = new Set<string>();
    for (const secret of character.mind.secrets) {
      if (secretIds.has(secret.id)) issues.push(`${character.name}: повторяющаяся тайна ${secret.id}`);
      secretIds.add(secret.id);
    }
  }
  return [...new Set(issues)];
}

function normalizeMind(world: WorldState, character: Character): void {
  const tick = worldTick(world);
  const mind = character.mind!;
  mind.goals ??= [];
  mind.obligations ??= [];
  mind.secrets ??= [];
  mind.reputations ??= [];
  mind.lastDecisionTick ??= tick;
  mind.emotions ??= { fear: 12, anger: 8, grief: 0, hope: 55, stress: 18, contentment: 45, updatedTick: tick };
  mind.emotions.updatedTick ??= tick;
  for (const key of TRAITS) mind.traits[key] = clamp(mind.traits[key] ?? seededValue(world, character, `trait:${key}`));
  for (const key of VALUES) mind.values[key] = clamp(mind.values[key] ?? seededValue(world, character, `value:${key}`));
}

function refreshGoals(world: WorldState, character: Character, indexes?: WorldIndexes): void {
  const mind = character.mind!;
  const tick = worldTick(world);
  const household = character.householdId ? indexes?.householdById.get(character.householdId) ?? world.households.find(item => item.id === character.householdId) : undefined;
  const settlement = indexes?.settlementById.get(character.settlementId) ?? world.settlements.find(item => item.id === character.settlementId);
  const desired: { kind: PersonalGoalKind; priority: number; reason: string; targetRef?: EntityRef }[] = [];
  if (character.health < 65 || character.needs.hunger > 55 || character.needs.thirst > 55) desired.push({ kind: 'survive', priority: 92, reason: 'здоровье или базовые потребности под угрозой' });
  if (household && (household.needs.hunger > 38 || household.foodReserveDays < 8)) desired.push({ kind: 'feed_family', priority: clamp(58 + mind.values.family * .35 + household.needs.hunger * .25), reason: 'семье не хватает пищи', targetRef: { kind: 'household', id: household.id } });
  if ((household?.wealth ?? character.wealth) < 12 || mind.values.wealth > 62) desired.push({ kind: 'earn_wealth', priority: clamp(38 + mind.values.wealth * .45 + mind.traits.greed * .25), reason: 'нехватка денег или стремление к достатку' });
  if (character.titles.length || character.courtOfficeIds?.length || mind.values.power > 65) desired.push({ kind: 'gain_power', priority: clamp(30 + mind.values.power * .55 + mind.traits.ambition * .3), reason: 'статус и амбиции требуют большего влияния', targetRef: { kind: 'kingdom', id: character.kingdomId } });
  if ((settlement?.unrest ?? 0) > 45 || character.profession === 'guard' || character.profession === 'soldier') desired.push({ kind: 'protect_home', priority: clamp(38 + mind.values.order * .35 + mind.traits.courage * .3 + (settlement?.unrest ?? 0) * .35), reason: 'поселению угрожают беспорядки или внешняя опасность', targetRef: settlement ? { kind: 'settlement', id: settlement.id } : undefined });
  if (character.profession === 'priest' || mind.values.faith > 72) desired.push({ kind: 'serve_faith', priority: clamp(30 + mind.values.faith * .6), reason: 'вера определяет жизненные решения' });
  if (character.legalStatus === 'разыскивается' || character.legalStatus === 'под стражей' || character.legalStatus === 'заключён') desired.push({ kind: 'escape_justice', priority: clamp(55 + mind.values.freedom * .35 + mind.emotions.fear * .3), reason: 'закон ограничивает свободу' });
  if (character.ambition.includes('мастер') || (character.skills[character.profession] ?? 0) > 45) desired.push({ kind: 'master_craft', priority: clamp(30 + mind.traits.patience * .35 + mind.traits.ambition * .35), reason: 'профессия и амбиции требуют мастерства' });
  if (character.ambition.includes('дорог') || character.ambition.includes('руин')) desired.push({ kind: 'explore', priority: clamp(35 + mind.values.freedom * .45 + mind.traits.riskTolerance * .3), reason: character.ambition });
  for (const wanted of desired) {
    let goal = mind.goals.find(item => item.kind === wanted.kind && item.status === 'active');
    if (!goal) {
      goal = { id: `goal:${character.id}:${wanted.kind}`, kind: wanted.kind, priority: wanted.priority, status: 'active', targetRef: wanted.targetRef, reason: wanted.reason, progress: 0, createdTick: tick, updatedTick: tick };
      mind.goals.push(goal);
    } else {
      goal.priority = wanted.priority; goal.reason = wanted.reason; goal.targetRef = wanted.targetRef; goal.updatedTick = tick;
    }
  }
  const activeKinds = new Set(desired.map(item => item.kind));
  for (const goal of mind.goals) if (goal.status === 'active' && !activeKinds.has(goal.kind)) goal.status = goal.progress >= 100 ? 'completed' : 'blocked';
  mind.goals = mind.goals.sort((a, b) => b.priority - a.priority).slice(0, 8);
}

function refreshObligations(world: WorldState, character: Character): void {
  const mind = character.mind!;
  const obligations: CharacterObligation[] = [];
  const add = (entry: CharacterObligation) => { if (!obligations.some(item => item.id === entry.id)) obligations.push(entry); };
  if (character.householdId) add({ id: `family:${character.householdId}`, kind: 'family', targetRef: { kind: 'household', id: character.householdId }, strength: clamp(35 + mind.values.family * .6), fulfilled: false, reason: 'жизнь и имущество связаны с домохозяйством' });
  if (character.employerEstablishmentId) add({ id: `employment:${character.employerEstablishmentId}`, kind: 'employment', targetRef: { kind: 'establishment', id: character.employerEstablishmentId }, strength: clamp(30 + mind.values.order * .35), fulfilled: false, reason: 'действующий трудовой договор' });
  if (character.courtOfficeIds?.length) for (const id of character.courtOfficeIds) add({ id: `office:${id}`, kind: 'office', strength: clamp(45 + character.loyalty * .4), fulfilled: false, reason: 'придворная должность требует службы' });
  if (character.nobleTitleIds?.length) for (const id of character.nobleTitleIds) add({ id: `oath:${id}`, kind: 'oath', targetRef: { kind: 'kingdom', id: character.kingdomId }, strength: clamp(35 + character.loyalty * .5), fulfilled: false, reason: 'титул связан с присягой и обязанностями' });
  const old = new Map(mind.obligations.map(item => [item.id, item]));
  mind.obligations = obligations.map(item => ({ ...item, fulfilled: old.get(item.id)?.fulfilled ?? item.fulfilled })).slice(0, 12);
}

function updateReputations(world: WorldState, character: Character): void {
  const mind = character.mind!;
  const tick = worldTick(world);
  const groups: GroupReputation['group'][] = ['family', 'neighbors', 'workers', 'merchants', 'guards', 'clergy', 'nobility', 'army', 'court'];
  const criminalPenalty = (character.wantedForCrimeIds?.length ?? 0) * 14 + (character.legalStatus === 'заключён' ? 24 : 0);
  const scoreFor = (group: GroupReputation['group']) => {
    let score = character.renown * .35 + character.loyalty * .25 - 25;
    if (group === 'family') score += mind.values.family * .35;
    if (group === 'workers' && character.employerEstablishmentId) score += 18;
    if (group === 'merchants' && character.profession === 'merchant') score += 26;
    if (group === 'guards') score += ['guard', 'soldier'].includes(character.profession) ? 30 : -criminalPenalty;
    if (group === 'clergy' && character.profession === 'priest') score += 35;
    if (group === 'nobility') score += character.titles.length * 18;
    if (group === 'army') score += character.serviceStatus && character.serviceStatus !== 'гражданский' ? 28 : 0;
    if (group === 'court') score += (character.courtOfficeIds?.length ?? 0) * 24 + (character.politicalInfluence ?? 0) * .25;
    if (group === 'neighbors') score -= criminalPenalty * .6;
    return Math.max(-100, Math.min(100, Math.round(score)));
  };
  mind.reputations = groups.map(group => ({ group, score: scoreFor(group), reason: reputationReason(character, group), updatedTick: tick }));
}

function reputationReason(character: Character, group: GroupReputation['group']): string {
  if ((character.wantedForCrimeIds?.length ?? 0) && (group === 'guards' || group === 'neighbors')) return 'подозрения и уголовные дела';
  if (group === 'court' && character.courtOfficeIds?.length) return 'служба при дворе';
  if (group === 'nobility' && character.titles.length) return 'титулы и происхождение';
  if (group === 'workers' && character.employerEstablishmentId) return 'совместная работа';
  return 'профессия, известность и поведение';
}

function goalPressure(world: WorldState, character: Character, kind: PersonalGoalKind, indexes?: WorldIndexes): number {
  const settlement = indexes?.settlementById.get(character.settlementId) ?? world.settlements.find(item => item.id === character.settlementId);
  if (kind === 'survive') return character.health < 45 ? 4 : -2;
  if (kind === 'feed_family') return character.needs.hunger > 60 ? 3 : -1;
  if (kind === 'protect_home') return (settlement?.unrest ?? 0) > 55 ? 2 : -.5;
  if (kind === 'escape_justice') return character.legalStatus === 'свободен' ? -8 : 3;
  return -.15;
}

function seededValue(world: WorldState, character: Character, key: string, offset = 0): number {
  const value = 18 + hashSeed(`${world.config.seed}:mind:${character.id}:${key}`) % 65 + offset;
  return clamp(value);
}

function validScale(value: number): boolean { return Number.isFinite(value) && value >= 0 && value <= 100; }
function clamp(value: number): number { return Math.max(0, Math.min(100, Math.round(value * 100) / 100)); }
