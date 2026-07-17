import type {
  BiologicalSex, Character, Epidemic, HealthCondition, LifeStage, Pregnancy, Settlement, WorldState,
} from '../types';
import type { WorldIndexes } from './indexes';
import { addResidentToIndexes, indexRelationship, relationshipKey } from './indexes';
import { appendCausalEvent } from './causality';
import { ensureHouseholdPhysicalCapacity } from './materialEconomy';
import { archiveCharactersBatch } from './mortality';
import { personName } from './names';
import { hashSeed, RNG } from './rng';
import { worldTick } from './scheduler';
import { ensureCharacterCultureProfile } from './cultureSystem';

const HEALTH_VERSION = 1;
const MAX_ACTIVE_CONDITIONS = 1_800;
const MAX_ACTIVE_PREGNANCIES = 650;

interface DiseaseDefinition {
  id: string;
  name: string;
  baseSeverity: number;
  contagiousness: number;
  durationMonths: [number, number];
  coldBias?: number;
  dirtyWaterBias?: number;
  crowdingBias?: number;
}

const DISEASES: DiseaseDefinition[] = [
  { id: 'seasonal-fever', name: 'сезонная лихорадка', baseSeverity: 24, contagiousness: 34, durationMonths: [1, 3], coldBias: 18 },
  { id: 'gut-flux', name: 'кишечная хворь', baseSeverity: 38, contagiousness: 48, durationMonths: [1, 4], dirtyWaterBias: 38 },
  { id: 'pox', name: 'оспенная горячка', baseSeverity: 56, contagiousness: 72, durationMonths: [2, 6], crowdingBias: 28 },
  { id: 'lung-fever', name: 'грудная хворь', baseSeverity: 44, contagiousness: 41, durationMonths: [2, 5], coldBias: 32, crowdingBias: 12 },
];

export interface HealthAdvanceOptions {
  fastForward?: boolean;
  elapsedMonths?: number;
}

export function initializeHealthSystem(world: WorldState): void {
  world.healthConditions ??= [];
  world.pregnancies ??= [];
  world.epidemics ??= [];
  world.nextIds.healthCondition ??= Math.max(0, ...world.healthConditions.map(item => item.id)) + 1;
  world.nextIds.pregnancy ??= Math.max(0, ...world.pregnancies.map(item => item.id)) + 1;
  world.nextIds.epidemic ??= Math.max(0, ...world.epidemics.map(item => item.id)) + 1;
  const tick = worldTick(world);

  for (const character of world.characters) {
    character.sex ??= seededSex(world, character.id);
    character.healthProfile ??= {
      lifeStage: lifeStage(character.age),
      frailty: baseFrailty(character),
      immunity: seededScale(world, character.id, 'immunity', 30, 88),
      fertility: seededScale(world, character.id, 'fertility', 35, 92),
      activeConditionIds: [], pregnancyId: undefined, chronicConditions: [], lastHealthTick: tick,
    };
    normalizeHealthProfile(character, tick);
  }

  // Старые супружеские пары получают совместимую биологическую пару. Это миграция,
  // а не ежемесячное изменение личности.
  for (const character of world.characters) {
    if (!character.spouseId || character.id > character.spouseId) continue;
    const spouse = world.characters.find(item => item.id === character.spouseId);
    if (!spouse || character.sex !== spouse.sex) continue;
    spouse.sex = character.sex === 'female' ? 'male' : 'female';
  }

  for (const pregnancy of world.pregnancies.filter(item => item.status === 'беременность' || item.status === 'роды')) {
    const parent = world.characters.find(item => item.id === pregnancy.gestatingParentId);
    if (parent?.healthProfile) parent.healthProfile.pregnancyId = pregnancy.id;
  }
  world.simulation.healthSystemVersion = HEALTH_VERSION;
}

export function advanceHealthSystem(world: WorldState, rng: RNG, indexes: WorldIndexes, options: HealthAdvanceOptions = {}): void {
  if (world.simulation.healthSystemVersion !== HEALTH_VERSION) initializeHealthSystem(world);
  const tick = worldTick(world);
  const elapsedMonths = Math.max(1, Math.floor(options.elapsedMonths ?? 1));

  processPregnancies(world, rng, indexes, tick);
  processActiveConditions(world, rng, indexes, elapsedMonths);
  processEpidemics(world, rng, indexes, elapsedMonths);

  const seasonal = [1, 4, 7, 10].includes(world.month) || elapsedMonths >= 3;
  if (seasonal) {
    seedDiseasePressure(world, rng, indexes);
    startPregnancies(world, rng, indexes);
    detectPhysicalInjuries(world, rng, indexes);
  }
  if (world.month === 1 || elapsedMonths >= 12) refreshLifeStages(world, tick);
  trimHealthCollections(world);
}

function processPregnancies(world: WorldState, rng: RNG, indexes: WorldIndexes, tick: number): void {
  const due = world.pregnancies.filter(item => item.status === 'беременность' && item.dueTick <= tick);
  for (const pregnancy of due) {
    const parentA = indexes.characterById.get(pregnancy.parentAId);
    const parentB = indexes.characterById.get(pregnancy.parentBId);
    const gestating = indexes.characterById.get(pregnancy.gestatingParentId);
    const settlement = indexes.settlementById.get(pregnancy.settlementId);
    if (!parentA?.alive || !parentB?.alive || !gestating?.alive || !settlement) {
      pregnancy.status = 'потеря';
      pregnancy.history.push('Беременность завершилась после смерти или исчезновения одного из родителей.');
      if (gestating?.healthProfile) gestating.healthProfile.pregnancyId = undefined;
      continue;
    }

    pregnancy.status = 'роды';
    const care = settlementCareQuality(world, indexes, settlement.id);
    const shortage = settlement.shortages.includes('пища') ? 18 : 0;
    const complicationRisk = Math.min(.42, .025 + pregnancy.risk / 260 + Math.max(0, 45 - care) / 280 + shortage / 300);
    if (rng.chance(complicationRisk)) {
      const severity = rng.int(35, 78);
      createCondition(world, gestating, settlement.id, {
        kind: 'осложнение родов', name: 'осложнение после родов', severity, contagiousness: 0,
        duration: rng.int(2, 6), cause: 'тяжёлые роды и недостаток ухода', treated: care >= 45,
      });
      gestating.health = Math.max(8, gestating.health - Math.round(severity * .18));
    }

    const child = createChild(world, rng, indexes, pregnancy, parentA, parentB, settlement, care);
    pregnancy.childId = child.id;
    pregnancy.status = 'завершено';
    pregnancy.history.push(`Роды завершились в ${world.year}.${String(world.month).padStart(2, '0')}; родился ${child.name}.`);
    gestating.healthProfile!.pregnancyId = undefined;
    appendCausalEvent(world, {
      kind: 'birth', title: `Родился ${child.name}`, description: `У ${parentA.name} и ${parentB.name} родился ребёнок.`,
      cause: 'завершившаяся беременность', conditions: [`здоровье роженицы ${Math.round(gestating.health)}%`, `качество помощи ${Math.round(care)}%`],
      decision: 'семья и повитухи приняли роды', outcome: `${child.name} появился на свет`,
      consequences: child.dynastyId ? ['у династии появился новый член', 'семье требуется больше пищи и жилья'] : ['семья стала больше', 'возросла нагрузка на домохозяйство'],
      entityRefs: [{ kind: 'character', id: child.id }, { kind: 'character', id: parentA.id }, { kind: 'character', id: parentB.id }, { kind: 'settlement', id: settlement.id }],
      importance: child.dynastyId ? 2 : 1,
    });
  }
}

function processActiveConditions(world: WorldState, rng: RNG, indexes: WorldIndexes, elapsedMonths: number): void {
  const tick = worldTick(world);
  const deaths: { character: Character; cause: string; settlement?: Settlement; condition: HealthCondition }[] = [];
  const active = world.healthConditions.filter(item => item.status === 'активно' || item.status === 'выздоровление' || item.status === 'хроническое');
  for (const condition of active) {
    const character = indexes.characterById.get(condition.characterId);
    const settlement = indexes.settlementById.get(condition.settlementId);
    if (!character?.alive) { condition.status = 'смерть'; continue; }
    const profile = character.healthProfile!;
    const care = settlement ? settlementCareQuality(world, indexes, settlement.id) : 0;
    const treatment = tryTreatment(world, indexes, condition, care);
    condition.careQuality = Math.max(condition.careQuality, care);
    condition.treated ||= treatment;

    const immunity = profile.immunity * .12;
    const frailty = profile.frailty * .14;
    const recovery = (4 + care * .08 + immunity - frailty + rng.int(-4, 5)) * elapsedMonths;
    const deterioration = Math.max(0, condition.severity - 42) * .05 * elapsedMonths;
    condition.severity = clamp(condition.severity - recovery + deterioration);
    const damage = Math.max(0, (condition.severity - 28) / 16) * elapsedMonths;
    if (condition.kind === 'травма' || condition.kind === 'инфекция' || condition.kind === 'осложнение родов') character.health = Math.max(0, character.health - damage);
    else character.health = Math.max(0, character.health - damage * .65);

    const lethal = condition.severity >= 82
      ? .02 + (condition.severity - 82) / 160 + profile.frailty / 650 - care / 900
      : character.health < 12 ? .05 + profile.frailty / 500 : 0;
    if (character.health <= 0 || rng.chance(Math.max(0, lethal) * elapsedMonths)) {
      condition.status = 'смерть';
      condition.history.push(`Состояние оказалось смертельным в ${world.year}.${String(world.month).padStart(2, '0')}.`);
      deaths.push({ character, cause: condition.name, settlement, condition });
      const epidemic = condition.diseaseId ? world.epidemics.find(item => item.diseaseId === condition.diseaseId && item.settlementId === condition.settlementId && item.status !== 'завершено') : undefined;
      if (epidemic) epidemic.deaths += 1;
      continue;
    }

    if (condition.severity <= 10 || tick >= condition.expectedEndTick + 6) {
      condition.status = condition.kind === 'хроническое состояние' ? 'хроническое' : 'вылечено';
      condition.history.push(`Состояние завершилось в ${world.year}.${String(world.month).padStart(2, '0')}.`);
      profile.activeConditionIds = profile.activeConditionIds.filter(id => id !== condition.id);
      character.health = Math.min(100, character.health + Math.max(2, care * .04));
      if (condition.kind === 'травма' && character.serviceStatus === 'ранен') {
        const hasOtherTrauma = profile.activeConditionIds.some(id => {
          const activeCondition = world.healthConditions.find(item => item.id === id);
          return activeCondition?.kind === 'травма' && activeCondition.status !== 'вылечено' && activeCondition.status !== 'смерть';
        });
        if (!hasOtherTrauma) {
          const army = world.armies.find(item => item.soldierIds.includes(character.id));
          character.serviceStatus = army ? (army.status === 'garrison' || army.status === 'recovering' ? 'гарнизон' : 'поход') : 'ветеран';
          if (army) army.logistics.wounded = Math.max(0, army.logistics.wounded - 1);
          character.biography.push(`Вернулся в строй после лечения в ${world.year} году.`);
        }
      }
      const epidemic = condition.diseaseId ? world.epidemics.find(item => item.diseaseId === condition.diseaseId && item.settlementId === condition.settlementId && item.status !== 'завершено') : undefined;
      if (epidemic) epidemic.recovered += 1;
    } else if (condition.severity < 30) condition.status = 'выздоровление';
    profile.lastHealthTick = tick;
  }

  if (deaths.length) {
    archiveCharactersBatch(world, indexes, deaths.map(entry => ({
      character: entry.character,
      context: { cause: entry.cause, settlementId: entry.settlement?.id, globalX: entry.settlement?.x, globalY: entry.settlement?.y },
    })), rng);
    for (const entry of deaths) appendCausalEvent(world, {
      kind: 'death', title: `Умер ${entry.character.name}`, description: `${entry.character.name} умер из-за состояния «${entry.condition.name}».`,
      cause: entry.condition.cause, conditions: [`тяжесть ${Math.round(entry.condition.severity)}%`, `качество помощи ${Math.round(entry.condition.careQuality)}%`],
      decision: entry.condition.treated ? 'лечение не смогло остановить ухудшение' : 'доступной помощи оказалось недостаточно',
      outcome: 'человек умер', consequences: ['семья потеряла близкого', 'тело будет перенесено на кладбище'],
      entityRefs: [{ kind: 'character', id: entry.character.id }, ...(entry.settlement ? [{ kind: 'settlement' as const, id: entry.settlement.id }] : [])],
      importance: entry.character.renown >= 55 ? 3 : 1,
    });
  }
}

function processEpidemics(world: WorldState, rng: RNG, indexes: WorldIndexes, elapsedMonths: number): void {
  const tick = worldTick(world);
  for (const epidemic of world.epidemics.filter(item => item.status !== 'завершено')) {
    const settlement = indexes.settlementById.get(epidemic.settlementId);
    if (!settlement) { epidemic.status = 'завершено'; epidemic.endTick = tick; continue; }
    const care = settlementCareQuality(world, indexes, settlement.id);
    const civic = world.districtCivicStates.filter(item => item.settlementId === settlement.id);
    const cleanliness = civic.length ? civic.reduce((sum, item) => sum + item.cleanliness, 0) / civic.length : 45;
    const water = civic.length ? civic.reduce((sum, item) => sum + item.waterAccess, 0) / civic.length : 45;
    const pressure = epidemic.transmission + Math.max(0, 45 - cleanliness) * .35 + Math.max(0, 45 - water) * .25 - care * .22;
    const growth = Math.round(epidemic.infectedEstimate * Math.max(-.3, Math.min(.42, (pressure - 45) / 130)) * elapsedMonths);
    epidemic.infectedEstimate = Math.max(0, Math.min(settlement.population, epidemic.infectedEstimate + growth));
    epidemic.severeEstimate = Math.round(epidemic.infectedEstimate * Math.max(.04, Math.min(.35, .08 + (70 - care) / 260)));
    epidemic.status = growth > 0 ? 'распространение' : epidemic.infectedEstimate > Math.max(3, settlement.population * .003) ? 'спад' : 'завершено';
    if (epidemic.status === 'завершено') {
      epidemic.endTick = tick;
      epidemic.history.push(`Вспышка завершилась в ${world.year}.${String(world.month).padStart(2, '0')}.`);
      appendCausalEvent(world, {
        kind: 'disease', title: `${epidemic.name} отступила в ${settlement.name}`, description: `Вспышка завершилась после ${Math.max(1, Math.ceil((tick - epidemic.startTick) / 12))} лет наблюдения.`,
        cause: 'иммунитет жителей, лечение и уменьшение числа новых заражений',
        consequences: [`выздоровело не менее ${epidemic.recovered} известных больных`, `подтверждено смертей: ${epidemic.deaths}`],
        entityRefs: [{ kind: 'settlement', id: settlement.id }], importance: epidemic.deaths >= 8 ? 3 : 2,
      });
    }
  }
}

function seedDiseasePressure(world: WorldState, rng: RNG, indexes: WorldIndexes): void {
  const tick = worldTick(world);
  const activeCountBySettlement = new Map<number, number>();
  for (const condition of world.healthConditions) if (condition.status === 'активно' || condition.status === 'выздоровление') activeCountBySettlement.set(condition.settlementId, (activeCountBySettlement.get(condition.settlementId) ?? 0) + 1);

  for (const settlement of world.settlements) {
    const residents = indexes.residentsBySettlement.get(settlement.id) ?? [];
    if (!residents.length) continue;
    const civic = world.districtCivicStates.filter(item => item.settlementId === settlement.id);
    const cleanliness = civic.length ? civic.reduce((sum, item) => sum + item.cleanliness, 0) / civic.length : 48;
    const water = civic.length ? civic.reduce((sum, item) => sum + item.waterAccess, 0) / civic.length : 48;
    const crowding = settlement.population / Math.max(1, settlement.residentialCapacity);
    const winter = [11, 12, 1, 2].includes(world.month) ? 1 : 0;
    const disease = weightedDisease(rng, cleanliness, water, crowding, winter);
    const pressure = .0025 + Math.max(0, 50 - cleanliness) / 1500 + Math.max(0, 50 - water) / 1300 + Math.max(0, crowding - .88) * .08 + (settlement.shortages.includes('пища') ? .018 : 0);
    const expected = Math.min(36, Math.max(0, Math.round(settlement.population * pressure * (.6 + rng.next()))));
    const capacity = Math.max(0, Math.min(48, MAX_ACTIVE_CONDITIONS - world.healthConditions.filter(item => item.status === 'активно' || item.status === 'выздоровление').length));
    const createCount = Math.min(expected, capacity, Math.max(1, Math.ceil(settlement.population / 900)));
    if (createCount <= 0) continue;

    const current = activeCountBySettlement.get(settlement.id) ?? 0;
    const outbreakThreshold = Math.max(5, Math.ceil(settlement.population * .004));
    let epidemic = world.epidemics.find(item => item.settlementId === settlement.id && item.diseaseId === disease.id && item.status !== 'завершено');
    if (!epidemic && current + expected >= outbreakThreshold && rng.chance(Math.min(.65, pressure * 8))) {
      epidemic = {
        id: world.nextIds.epidemic++, diseaseId: disease.id, name: disease.name, settlementId: settlement.id, startTick: tick,
        status: 'зарождение', infectedEstimate: Math.max(outbreakThreshold, expected), severeEstimate: Math.max(1, Math.round(expected * disease.baseSeverity / 260)),
        deaths: 0, recovered: 0, transmission: disease.contagiousness, history: [`Вспышка замечена в ${world.year}.${String(world.month).padStart(2, '0')}.`],
      };
      world.epidemics.push(epidemic);
      appendCausalEvent(world, {
        kind: 'disease', title: `${disease.name} началась в ${settlement.name}`, description: `Лекари оценивают число заболевших примерно в ${epidemic.infectedEstimate}.`,
        cause: disease.id === 'gut-flux' ? 'грязная вода и теснота' : disease.id === 'lung-fever' ? 'холод, сырость и скученность' : 'контакты между жителями и слабый иммунитет',
        conditions: [`чистота ${Math.round(cleanliness)}%`, `доступ к воде ${Math.round(water)}%`, `заселённость ${Math.round(crowding * 100)}%`],
        decision: 'городские службы и лекари начали наблюдение', outcome: 'зафиксирована вспышка заболевания',
        consequences: ['часть жителей временно не может работать', 'лечебницы получают дополнительную нагрузку'],
        entityRefs: [{ kind: 'settlement', id: settlement.id }], importance: epidemic.infectedEstimate >= 40 ? 3 : 2,
      });
    }

    const candidates = residents
      .filter(character => character.alive && !character.healthProfile!.activeConditionIds.length)
      .sort((a, b) => healthRisk(b) - healthRisk(a) || a.id - b.id)
      .slice(0, Math.max(createCount * 8, 24));
    for (let index = 0; index < createCount && candidates.length; index += 1) {
      const character = candidates.splice(rng.int(0, candidates.length - 1), 1)[0]!;
      createCondition(world, character, settlement.id, {
        kind: 'болезнь', name: disease.name,
        diseaseId: disease.id, severity: clamp(disease.baseSeverity + rng.int(-12, 18) + character.healthProfile!.frailty * .12 - character.healthProfile!.immunity * .1),
        contagiousness: disease.contagiousness, duration: rng.int(disease.durationMonths[0], disease.durationMonths[1]),
        cause: epidemic ? `заражение во время вспышки в ${settlement.name}` : `обычное сезонное заболевание в ${settlement.name}`,
      });
    }
  }
}

function startPregnancies(world: WorldState, rng: RNG, indexes: WorldIndexes): void {
  const activePregnancies = world.pregnancies.filter(item => item.status === 'беременность').length;
  if (activePregnancies >= MAX_ACTIVE_PREGNANCIES) return;
  const tick = worldTick(world);
  for (const settlement of world.settlements) {
    const residents = indexes.residentsBySettlement.get(settlement.id) ?? [];
    const spareHousing = Math.max(0, settlement.residentialCapacity - settlement.population);
    if (spareHousing <= 0 || settlement.food < 28) continue;
    const candidates = residents
      .filter(character => character.alive && character.spouseId && character.id < character.spouseId! && !character.healthProfile!.pregnancyId)
      .map(character => [character, indexes.characterById.get(character.spouseId!)] as const)
      .filter((pair): pair is readonly [Character, Character] => Boolean(pair[1]?.alive && pair[1]?.settlementId === settlement.id && !pair[1]?.healthProfile?.pregnancyId))
      .filter(([a, b]) => a.sex !== b.sex && fertile(a) && fertile(b));
    if (!candidates.length) continue;
    const target = Math.min(6, spareHousing, Math.ceil(candidates.length * .06));
    let created = 0;
    for (const [a, b] of candidates) {
      if (created >= target || world.pregnancies.filter(item => item.status === 'беременность').length >= MAX_ACTIVE_PREGNANCIES) break;
      const gestating = a.sex === 'female' ? a : b;
      const partner = gestating.id === a.id ? b : a;
      const fertility = (gestating.healthProfile!.fertility + partner.healthProfile!.fertility) / 2;
      const chance = Math.min(.28, .025 + fertility / 750 + settlement.prosperity / 1600 - (settlement.shortages.length ? .04 : 0));
      if (!rng.chance(chance)) continue;
      const pregnancy: Pregnancy = {
        id: world.nextIds.pregnancy++, parentAId: a.id, parentBId: b.id, gestatingParentId: gestating.id,
        settlementId: settlement.id, conceivedTick: tick, dueTick: tick + 9, status: 'беременность',
        risk: clamp(12 + gestating.healthProfile!.frailty * .32 + Math.max(0, 65 - gestating.health) * .45 + rng.int(-5, 12)),
        history: [`Беременность началась в ${world.year}.${String(world.month).padStart(2, '0')}.`],
      };
      world.pregnancies.push(pregnancy);
      gestating.healthProfile!.pregnancyId = pregnancy.id;
      created += 1;
    }
  }
}

function detectPhysicalInjuries(world: WorldState, rng: RNG, indexes: WorldIndexes): void {
  const injured = world.characters
    .filter(character => character.alive && character.health < 62 && !character.healthProfile!.activeConditionIds.some(id => world.healthConditions.find(item => item.id === id)?.kind === 'травма'))
    .sort((a, b) => a.health - b.health || a.id - b.id)
    .slice(0, 40);
  for (const character of injured) {
    const cause = character.serviceStatus && character.serviceStatus !== 'гражданский' ? 'ранение на военной службе' : character.legalStatus === 'под стражей' ? 'травма во время задержания' : 'несчастный случай или старая рана';
    const condition = createCondition(world, character, character.settlementId, {
      kind: 'травма', name: rng.pick(['глубокая рана', 'перелом', 'сильный ушиб', 'повреждение сустава']),
      severity: clamp(70 - character.health + rng.int(10, 28)), contagiousness: 0, duration: rng.int(2, 8), cause,
    });
    if (condition && !character.injuries.includes(condition.name)) character.injuries.push(condition.name);
  }
}


export function addBattleInjury(world: WorldState, character: Character, settlementId: number, severity: number, cause: string, rng: RNG): HealthCondition | undefined {
  if (world.simulation.healthSystemVersion !== HEALTH_VERSION || !character.healthProfile) initializeHealthSystem(world);
  const names = severity >= 70 ? ['тяжёлая рубленая рана', 'пробитие доспеха', 'раздробление кости']
    : severity >= 45 ? ['глубокая рана', 'перелом', 'повреждение сустава']
      : ['сильный ушиб', 'рассечение', 'растяжение'];
  const condition = createCondition(world, character, settlementId, {
    kind: 'травма', name: rng.pick(names), severity: clamp(severity), contagiousness: 0, duration: rng.int(2, severity >= 65 ? 10 : 6), cause, treated: false,
  });
  if (condition && !character.injuries.includes(condition.name)) character.injuries.push(condition.name);
  return condition;
}

function createCondition(
  world: WorldState,
  character: Character,
  settlementId: number,
  input: { kind: HealthCondition['kind']; name: string; diseaseId?: string; severity: number; contagiousness: number; duration: number; cause: string; treated?: boolean },
): HealthCondition | undefined {
  const activeCount = world.healthConditions.filter(item => item.status === 'активно' || item.status === 'выздоровление' || item.status === 'хроническое').length;
  if (activeCount >= MAX_ACTIVE_CONDITIONS) return undefined;
  if (character.healthProfile!.activeConditionIds.some(id => {
    const existing = world.healthConditions.find(item => item.id === id);
    return existing?.name === input.name && existing.status !== 'вылечено' && existing.status !== 'смерть';
  })) return undefined;
  const tick = worldTick(world);
  const condition: HealthCondition = {
    id: world.nextIds.healthCondition++, characterId: character.id, settlementId, kind: input.kind, diseaseId: input.diseaseId,
    name: input.name, severity: clamp(input.severity), contagiousness: clamp(input.contagiousness), startedTick: tick,
    expectedEndTick: tick + Math.max(1, input.duration), status: 'активно', treated: Boolean(input.treated), careQuality: 0,
    cause: input.cause, history: [`Состояние началось в ${world.year}.${String(world.month).padStart(2, '0')}.`],
  };
  world.healthConditions.push(condition);
  character.healthProfile!.activeConditionIds.push(condition.id);
  character.healthProfile!.lastHealthTick = tick;
  return condition;
}

function createChild(world: WorldState, rng: RNG, indexes: WorldIndexes, pregnancy: Pregnancy, parentA: Character, parentB: Character, settlement: Settlement, care: number): Character {
  const tick = worldTick(world);
  const child: Character = {
    id: world.nextIds.character++, name: personName(rng, parentA.species), sex: rng.chance(.5) ? 'female' : 'male', species: parentA.species,
    age: 0, birthYear: world.year, alive: true, settlementId: settlement.id, kingdomId: settlement.kingdomId,
    dynastyId: parentA.dynastyId ?? parentB.dynastyId, profession: 'child', workplace: 'дом семьи',
    homeDistrict: parentA.homeDistrict ?? parentB.homeDistrict ?? settlement.districts[0]?.name, renown: 0,
    health: clamp(rng.int(68, 96) + care * .05 - pregnancy.risk * .08), wealth: 0, loyalty: rng.int(35, 85), ambition: 'вырасти и найти своё место в мире',
    parentIds: [parentA.id, parentB.id], childIds: [], relationshipIds: [], titles: [], artifactIds: [], bookIds: [], injuries: [], kills: 0,
    biography: [`Родился в ${settlement.name} в ${world.year} году.`], householdId: parentA.householdId ?? parentB.householdId,
    homeBuildingId: parentA.homeBuildingId ?? parentB.homeBuildingId, inventoryItemIds: [], skills: { child: 1 },
    needs: { hunger: 8, thirst: 8, rest: 12, warmth: 12, safety: 8, social: 14, lastUpdatedTick: tick },
    schedule: { wakeHour: 7, workStartHour: 0, workEndHour: 0, sleepHour: 20, restDay: 1 + (world.nextIds.character % 7), currentActivity: 'находится под опекой семьи' },
    wallet: 0, equipment: { material: 'лён и шерсть', color: 'неокрашенный', quality: 28, condition: 72, socialTier: 'обычный', equippedItemIds: {}, compact: true, lastMaintainedTick: tick },
    knowledge: { factIds: [], memoryIds: [], opinions: [], detailed: false, lastGossipTick: tick },
    healthProfile: { lifeStage: 'младенец', frailty: rng.int(18, 42), immunity: rng.int(28, 72), fertility: rng.int(35, 92), activeConditionIds: [], chronicConditions: [], lastHealthTick: tick },
  };
  ensureCharacterCultureProfile(world, child, rng);
  parentA.childIds.push(child.id); parentB.childIds.push(child.id); world.characters.push(child); addResidentToIndexes(indexes, child);
  if (child.householdId) {
    const household = indexes.householdById.get(child.householdId);
    if (household) {
      if (!household.memberIds.includes(child.id)) household.memberIds.push(child.id);
      const home = ensureHouseholdPhysicalCapacity(world, household, rng, indexes);
      child.homeBuildingId = home?.id; child.homeDistrict = home?.districtName ?? child.homeDistrict;
    }
  }
  addFamilyRelationship(world, indexes, parentA, child, rng.int(72, 100));
  addFamilyRelationship(world, indexes, parentB, child, rng.int(72, 100));
  if (child.dynastyId) world.dynasties.find(item => item.id === child.dynastyId)?.memberIds.push(child.id);
  settlement.population = (indexes.residentsBySettlement.get(settlement.id) ?? []).length;
  return child;
}

function addFamilyRelationship(world: WorldState, indexes: WorldIndexes, a: Character, b: Character, strength: number): void {
  if (indexes.relationshipKeys.has(relationshipKey(a.id, b.id))) return;
  const relationship = { id: world.nextIds.relationship++, characterAId: a.id, characterBId: b.id, kind: 'родство' as const, strength, sinceYear: world.year, public: true, reason: 'родитель и ребёнок', contexts: ['family' as const, 'household' as const] };
  world.relationships.push(relationship); a.relationshipIds.push(relationship.id); b.relationshipIds.push(relationship.id); indexRelationship(indexes, relationship);
}

function tryTreatment(world: WorldState, indexes: WorldIndexes, condition: HealthCondition, care: number): boolean {
  if (care < 18) return false;
  if (condition.treated) return true;
  const establishments = indexes.establishmentsBySettlement.get(condition.settlementId) ?? [];
  const healer = establishments.find(item => item.active && (item.type === 'лечебница' || item.type === 'храм' || item.type === 'баня'));
  if (!healer) return false;
  const medicine = healer.inventoryItemIds.map(id => indexes.itemById.get(id)).find(item => item?.templateId === 'herbal_medicine' && item.quantity > .05 && item.condition > 0);
  if (medicine && condition.severity >= 35) medicine.quantity = Math.max(0, medicine.quantity - .25);
  condition.history.push(`Получена помощь в ${healer.name}.`);
  return true;
}

function settlementCareQuality(world: WorldState, indexes: WorldIndexes, settlementId: number): number {
  const establishments = indexes.establishmentsBySettlement.get(settlementId) ?? [];
  const healers = (indexes.residentsBySettlement.get(settlementId) ?? []).filter(item => item.alive && ['healer', 'herbalist', 'priest'].includes(item.profession)).length;
  const clinics = establishments.filter(item => item.active && item.type === 'лечебница').length;
  const baths = establishments.filter(item => item.active && item.type === 'баня').length;
  const government = world.settlementGovernments.find(item => item.settlementId === settlementId);
  return clamp(12 + healers * 4 + clinics * 18 + baths * 5 + (government?.treasury ?? 0) / 80 - (government?.corruption ?? 0) * .12);
}

function refreshLifeStages(world: WorldState, tick: number): void {
  for (const character of world.characters) {
    if (!character.healthProfile) continue;
    character.age = Math.max(0, world.year - character.birthYear);
    character.healthProfile.lifeStage = lifeStage(character.age);
    character.healthProfile.frailty = clamp(baseFrailty(character) + character.healthProfile.chronicConditions.length * 8);
    character.healthProfile.lastHealthTick = tick;
  }
}

function normalizeHealthProfile(character: Character, tick: number): void {
  const profile = character.healthProfile!;
  profile.lifeStage ??= lifeStage(character.age);
  profile.frailty = clamp(profile.frailty ?? baseFrailty(character));
  profile.immunity = clamp(profile.immunity ?? 55);
  profile.fertility = clamp(profile.fertility ?? 55);
  profile.activeConditionIds ??= [];
  profile.chronicConditions ??= [];
  profile.lastHealthTick ??= tick;
}

function trimHealthCollections(world: WorldState): void {
  if (world.healthConditions.length > 8_000) {
    const active = world.healthConditions.filter(item => item.status === 'активно' || item.status === 'выздоровление' || item.status === 'хроническое');
    const closed = world.healthConditions.filter(item => !active.includes(item)).slice(-Math.max(0, 8_000 - active.length));
    world.healthConditions = [...closed, ...active].sort((a, b) => a.id - b.id);
  }
  if (world.pregnancies.length > 4_000) {
    const active = world.pregnancies.filter(item => item.status === 'беременность' || item.status === 'роды');
    const closed = world.pregnancies.filter(item => !active.includes(item)).slice(-Math.max(0, 4_000 - active.length));
    world.pregnancies = [...closed, ...active].sort((a, b) => a.id - b.id);
  }
  if (world.epidemics.length > 600) world.epidemics = world.epidemics.slice(-600);
}

function weightedDisease(rng: RNG, cleanliness: number, water: number, crowding: number, winter: number): DiseaseDefinition {
  return rng.weighted(DISEASES.map(disease => ({
    value: disease,
    weight: 10 + (disease.coldBias ?? 0) * winter + (disease.dirtyWaterBias ?? 0) * Math.max(0, 55 - water) / 55 + (disease.crowdingBias ?? 0) * Math.max(0, crowding - .75),
  })));
}

function fertile(character: Character): boolean {
  if (!character.healthProfile || character.health < 45 || character.healthProfile.activeConditionIds.length > 1) return false;
  const [min, max] = character.species === 'elf' ? [24, 120] : character.species === 'dwarf' ? [22, 70] : character.species === 'orc' ? [16, 40] : [18, 44];
  return character.age >= min && character.age <= max;
}

function healthRisk(character: Character): number {
  const profile = character.healthProfile!;
  return profile.frailty + Math.max(0, 60 - profile.immunity) + Math.max(0, 65 - character.health) + (character.age < 5 ? 25 : character.age > 65 ? 20 : 0);
}

function lifeStage(age: number): LifeStage {
  if (age < 2) return 'младенец';
  if (age < 12) return 'ребёнок';
  if (age < 18) return 'подросток';
  if (age < 60) return 'взрослый';
  if (age < 78) return 'пожилой';
  return 'старый';
}

function baseFrailty(character: Character): number {
  const age = character.age;
  const ageLoad = age < 2 ? 30 : age < 12 ? 12 : age < 50 ? 8 : age < 65 ? 22 : age < 80 ? 48 : 72;
  return clamp(ageLoad + Math.max(0, 70 - character.health) * .45 + character.injuries.length * 5);
}

function seededSex(world: WorldState, characterId: number): BiologicalSex {
  return hashSeed(`${world.config.seed}:sex:${characterId}`) % 2 === 0 ? 'female' : 'male';
}

function seededScale(world: WorldState, characterId: number, key: string, min: number, max: number): number {
  return min + hashSeed(`${world.config.seed}:health:${characterId}:${key}`) % Math.max(1, max - min + 1);
}

export function healthSystemIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const characterIds = new Set(world.characters.map(item => item.id));
  const settlementIds = new Set(world.settlements.map(item => item.id));
  const conditionIds = new Set(world.healthConditions.map(item => item.id));
  const pregnancyIds = new Set(world.pregnancies.map(item => item.id));
  for (const character of world.characters) {
    if (!character.healthProfile) { issues.push(`${character.name}: отсутствует профиль здоровья`); continue; }
    if (character.healthProfile.activeConditionIds.some(id => !conditionIds.has(id))) issues.push(`${character.name}: ссылка на отсутствующее состояние здоровья`);
    if (character.healthProfile.pregnancyId && !pregnancyIds.has(character.healthProfile.pregnancyId)) issues.push(`${character.name}: отсутствует запись беременности`);
  }
  for (const condition of world.healthConditions) {
    if (!settlementIds.has(condition.settlementId)) issues.push(`Состояние ${condition.id}: отсутствует поселение`);
    if (condition.severity < 0 || condition.severity > 100) issues.push(`Состояние ${condition.id}: неверная тяжесть`);
  }
  for (const pregnancy of world.pregnancies) {
    if (!settlementIds.has(pregnancy.settlementId)) issues.push(`Беременность ${pregnancy.id}: отсутствует поселение`);
  }
  for (const epidemic of world.epidemics) {
    if (!settlementIds.has(epidemic.settlementId)) issues.push(`Эпидемия ${epidemic.id}: отсутствует поселение`);
    if (epidemic.infectedEstimate < 0 || epidemic.severeEstimate < 0) issues.push(`Эпидемия ${epidemic.id}: неверная численность`);
  }
  return [...new Set(issues)];
}

function clamp(value: number): number { return Math.max(0, Math.min(100, Math.round(value * 100) / 100)); }
