import type { Character, EntityRef, Kingdom, Monster, Relationship, Settlement, SimulationPhaseProfile, TradeRoute, War, WorldEvent, WorldState, CausalEventInput } from '../types';
import { RNG } from './rng';
import { personName } from './names';
import { appendCausalEvent } from './causality';
import { advanceEcology } from './ecology';
import { advanceMaterialEconomy, ensureEstablishmentOwners, ensureHouseholdPhysicalCapacity, invalidateMaterialRuntime, pruneEmptyMaterialItems } from './materialEconomy';
import { advanceAgriculture, advanceConstruction, requestConstructionProject } from './agricultureConstruction';
import { advanceLivingEconomy, detailedPopulationContext, synchronizeEmploymentLinks } from './livingEconomy';
import { advanceMilitaryInfrastructure, applyArmyCasualties, synchronizeArmyStrength } from './militaryInfrastructure';
import { normalizeKingdomCapitals } from './kingdomState';
import type { WorldIndexes } from './indexes';
import {
  addResidentToIndexes, buildWorldIndexes, changeProfessionInIndexes, indexRelationship,
  moveResidentInIndexes, refreshDynamicWorldIndexes, rebuildRelationshipIndexes, relationshipKey, residents, workers,
} from './indexes';
import { prepareMonthSchedule, worldTick } from './scheduler';
import { advanceModernTerritories, captureTerritoryAroundSettlement } from './territory';
import { advanceBurials, archiveCharacter, archiveCharactersBatch, archiveMonster, burialForSubject } from './mortality';
import { advanceKnowledgeSystem, markKnowledgeDecision, registerWorldEventKnowledge } from './knowledgeSystem';
import { advanceSettlementLife, synchronizeSettlementGovernmentLeaders } from './settlementLife';
import { advanceStateMachine, synchronizeStateMachineReferences } from './stateMachine';
import { decisionKnowledge, initializeDecisionCore, linkDecisionToEvent, recordDecision, recordStateDelta } from './decisionCore';
import { advanceMindSystem, ensureCharacterMind, scoreMotivatedAction, setDecisionMoment } from './mindSystem';
import { advanceSocialSystem, settlementConnectionScore } from './socialSystem';
import { advancePhysicalArmySystem, ensureArmyOutsideSettlements, nextArmyFieldStep } from './physicalArmy';
import { advanceHealthSystem } from './healthSystem';
import { releaseWarPrisoners, resolveSpatialArmyBattle } from './battleSystem';
import { advanceCultureSystem } from './cultureSystem';
import { advanceClimateSystem, initializeClimateSystem } from './climateSystem';
import { advanceDailyLife, initializeDailyLife } from './dailyLife';
import { advanceDynastyLegacy, initializeDynastyLegacy } from './dynastyLegacy';
import { advanceRaceDemography, initializeRaceDemography } from './raceDemography';
import { applyInteriorMonthlyEffects } from './interiors';
import { advanceCitySimulation, initializeCitySimulation } from './citySimulation';
import { advanceCivilizationSystem, initializeCivilizationSystem } from './civilizationSystem';
import { advanceSettlementLifecycle, initializeSettlementLifecycle } from './settlementLifecycle';
import { advanceStateFormation, initializeStateFormation } from './stateFormation';

function addEvent(world: WorldState, data: CausalEventInput): WorldEvent {
  const event = appendCausalEvent(world, data);
  registerWorldEventKnowledge(world, event);
  return event;
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function workplaceFor(profession: string): string {
  const map: Record<string, string> = { child: 'дом семьи', farmer: 'поля и пастбища', miller: 'мельница', hunter: 'охотничьи угодья', guard: 'стража и ворота', blacksmith: 'кузница', carpenter: 'плотницкая мастерская', herbalist: 'травницкая мастерская', merchant: 'рынок', scribe: 'архив или канцелярия', priest: 'храм', soldier: 'казармы', fisher: 'берег или пристань', miner: 'шахта', weaver: 'ткацкая мастерская', brewer: 'пивоварня', healer: 'лечебница' };
  return map[profession] ?? 'местные работы';
}

function addLocalEffect(world: WorldState, globalX: number, globalY: number, kind: WorldState['localMapChanges'][number]['kind'], label: string, rng: RNG, entityRef?: EntityRef, level = 0): void {
  world.localMapChanges ??= [];
  const ttl = kind === 'blood' ? 4 : kind === 'burn' ? 18 : kind === 'looted' ? 36 : kind === 'rubble' ? 120 : kind === 'body' ? 8 : undefined;
  const effect = {
    id: `${world.year}-${world.month}-${world.localMapChanges.length + 1}-${rng.int(1000, 9999)}`,
    globalX, globalY, level, localX: rng.int(6, Math.max(7, (world.config.localMapSize ?? 128) - 7)), localY: rng.int(6, Math.max(7, (world.config.localMapSize ?? 128) - 7)), kind, year: world.year, month: world.month,
    expiresTick: ttl ? worldTick(world) + ttl : undefined, label, entityRef,
  };
  world.localMapChanges.push(effect);
  if (world.localMapChanges.length > 6000) world.localMapChanges.splice(0, world.localMapChanges.length - 6000);
}

function addBattlefieldEffects(world: WorldState, x: number, y: number, losses: number, rng: RNG, armyId: number, settlementId?: number): void {
  const count = Math.min(24, Math.max(4, Math.round(losses / 5)));
  for (let index = 0; index < count; index += 1) {
    const kind = index % 3 === 0 ? 'blood' : 'rubble';
    addLocalEffect(world, x, y, kind, kind === 'blood' ? 'Следы сражения' : 'Разрушения после боя', rng, { kind: 'army', id: armyId });
  }
}

function nearestSettlement(world: WorldState, x: number, y: number, filter?: (settlement: Settlement) => boolean): Settlement | undefined {
  return world.settlements.filter(filter ?? (() => true)).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
}

function ruler(world: WorldState, kingdom: Kingdom): Character | undefined {
  return world.characters.find(character => character.id === kingdom.rulerId);
}

function relationBetween(world: WorldState, kingdomA: number, kingdomB: number) {
  return world.kingdoms.find(kingdom => kingdom.id === kingdomA)?.diplomacy.find(record => record.kingdomId === kingdomB);
}

function setDiplomacy(world: WorldState, kingdomA: number, kingdomB: number, score: number, status: 'союз' | 'мир' | 'напряжение' | 'война', reason: string) {
  for (const [sourceId, targetId] of [[kingdomA, kingdomB], [kingdomB, kingdomA]]) {
    const kingdom = world.kingdoms.find(item => item.id === sourceId);
    if (!kingdom) continue;
    let record = kingdom.diplomacy.find(item => item.kingdomId === targetId);
    if (!record) {
      record = { kingdomId: targetId, score, status, reason };
      kingdom.diplomacy.push(record);
    } else {
      record.score = score;
      record.status = status;
      record.reason = reason;
    }
  }
}

function routeSettlements(world: WorldState, route: TradeRoute): [Settlement, Settlement] | undefined {
  const from = world.settlements.find(item => item.id === route.fromSettlementId);
  const to = world.settlements.find(item => item.id === route.toSettlementId);
  return from && to ? [from, to] : undefined;
}

function advanceEconomy(
  world: WorldState,
  rng: RNG,
  indexes: WorldIndexes,
  settlementIds: ReadonlySet<number>,
  activeSettlementIds: ReadonlySet<number>,
): void {
  for (const settlementId of settlementIds) {
    const settlement = indexes.settlementById.get(settlementId);
    if (!settlement) continue;
    const localResidents = residents(indexes, settlement.id);
    settlement.population = localResidents.length;
    const merchants = workers(indexes, settlement.id, ['merchant']).length;
    const elapsedMonths = activeSettlementIds.has(settlement.id) ? 1 : 6;
    const prosperityStep = Math.sign(settlement.food - 45) + Math.min(2, Math.floor(merchants / 12)) - Math.ceil(settlement.damaged / 35) - Math.ceil(settlement.unrest / 45);
    settlement.prosperity = Math.max(3, Math.min(100, settlement.prosperity + prosperityStep * elapsedMonths));
    settlement.damaged = Math.max(0, settlement.damaged - (settlement.prosperity > 45 ? elapsedMonths : 0));
    settlement.unrest = Math.max(0, Math.min(100, settlement.unrest + ((settlement.food < 22 ? 4 : -1) + (settlement.damaged > 60 ? 2 : 0)) * elapsedMonths));
    const wasHungry = settlement.shortages.includes('пища');
    if (settlement.food < 18 && !wasHungry) {
      settlement.shortages.push('пища');
      settlement.history.push(`В ${world.year} году началась нехватка продовольствия.`);
      addEvent(world, {
        kind: 'trade', title: `Голод угрожает поселению ${settlement.name}`, description: `Запасы пищи почти исчерпаны, цены растут, семьи покидают дома.`,
        cause: 'плохие запасы, повреждения и недостаток работников', consequences: ['рост беспорядков', 'усиление миграции', 'спрос на зерно'],
        entityRefs: [{ kind: 'settlement', id: settlement.id }, { kind: 'kingdom', id: settlement.kingdomId }], importance: 4,
      });
    } else if (settlement.food > 42 && wasHungry) {
      settlement.shortages = settlement.shortages.filter(item => item !== 'пища');
      addEvent(world, {
        kind: 'trade', title: `${settlement.name} преодолел голод`, description: `Караваны и новый урожай восстановили запасы.`,
        cause: 'доставка продовольствия и работа местных жителей', consequences: ['снижение беспорядков', 'возвращение торговли'],
        entityRefs: [{ kind: 'settlement', id: settlement.id }], importance: 2,
      });
    }
  }

  for (const route of world.tradeRoutes) {
    const from = indexes.settlementById.get(route.fromSettlementId);
    const to = indexes.settlementById.get(route.toSettlementId);
    if (!from || !to) continue;
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const nearbyThreat = world.monsters.some(monster => monster.alive && distance(monster, middle) <= monster.territoryRadius);
    const warBlocks = world.wars.some(war => war.active && [from.kingdomId, to.kingdomId].includes(war.attackerId) && [from.kingdomId, to.kingdomId].includes(war.defenderId));
    const previous = route.active;
    route.safety = Math.max(0, Math.min(100, route.safety + (nearbyThreat ? -rng.int(3, 9) : 2) + (warBlocks ? -8 : 0)));
    route.active = route.safety >= 18 && !warBlocks;
    if (route.active) {
      const gain = Math.max(1, Math.round(route.volume / 70));
      from.prosperity = Math.min(100, from.prosperity + gain);
      to.prosperity = Math.min(100, to.prosperity + gain);
    }
    if (previous && !route.active) {
      route.history.push(`В ${world.year} году путь закрылся из-за войны или чудовищ.`);
      addEvent(world, {
        kind: 'trade', title: `Закрыт путь ${route.name}`, description: `Караваны перестали ходить между поселениями.`,
        cause: warBlocks ? 'война перекрыла дорогу' : 'нападения чудовищ сделали путь смертельно опасным',
        consequences: ['падение торговли', 'нехватка чужих товаров', 'рост цен'], entityRefs: [{ kind: 'tradeRoute', id: route.id }, { kind: 'settlement', id: from.id }, { kind: 'settlement', id: to.id }], importance: 3,
      });
    } else if (!previous && route.active) {
      route.history.push(`В ${world.year} году движение караванов восстановилось.`);
      addEvent(world, {
        kind: 'trade', title: `Вновь открыт путь ${route.name}`, description: `Стража и охотники очистили дорогу.`,
        cause: 'опасность ослабла', consequences: ['возврат караванов', 'снижение цен'], entityRefs: [{ kind: 'tradeRoute', id: route.id }], importance: 2,
      });
    }
  }
}

function addRelationship(world: WorldState, indexes: WorldIndexes, a: Character, b: Character, kind: Relationship['kind'], strength: number, reason: string): void {
  if (a.id === b.id || indexes.relationshipKeys.has(relationshipKey(a.id, b.id))) return;
  const relationship: Relationship = { id: world.nextIds.relationship++, characterAId: a.id, characterBId: b.id, kind, strength, sinceYear: world.year, public: kind !== 'ненависть', reason };
  world.relationships.push(relationship);
  a.relationshipIds.push(relationship.id);
  b.relationshipIds.push(relationship.id);
  indexRelationship(indexes, relationship);
}

function advancePopulation(world: WorldState, rng: RNG, indexes: WorldIndexes): void {
  const deaths: { character: Character; cause: string; settlement?: Settlement }[] = [];
  for (const character of world.characters) {
    character.age = Math.max(0, world.year - character.birthYear);
    if (character.profession === 'child' && character.age >= 14) {
      const profession = rng.pick(['farmer', 'guard', 'hunter', 'blacksmith', 'merchant', 'scribe', 'soldier']);
      changeProfessionInIndexes(indexes, character, profession);
      character.workplace = workplaceFor(character.profession);
    }
    const settlement = indexes.settlementById.get(character.settlementId);
    const hungerRisk = settlement?.shortages.includes('пища') ? .028 : 0;
    const speciesAge = character.species === 'elf' ? character.age / 2.8 : character.species === 'dwarf' ? character.age / 1.45 : character.species === 'orc' ? character.age / .82 : character.age;
    const mortality = speciesAge < 2 ? .006 : speciesAge < 45 ? .0015 : speciesAge < 65 ? .007 : speciesAge < 82 ? .034 : speciesAge < 96 ? .11 : .28;
    const frailtyRisk = (character.healthProfile?.frailty ?? 20) / 5000;
    const healthRisk = Math.max(0, 55 - character.health) / 2200;
    if (rng.chance(mortality + hungerRisk + frailtyRisk + healthRisk)) {
      const activeCondition = character.healthProfile?.activeConditionIds.map(id => world.healthConditions.find(item => item.id === id)).find(item => item && (item.status === 'активно' || item.status === 'выздоровление'));
      deaths.push({ character, cause: hungerRisk ? 'голод и истощение' : activeCondition?.name ?? (speciesAge >= 65 ? 'старость и ослабление организма' : 'внезапное ухудшение здоровья'), settlement });
    }
  }
  if (deaths.length) {
    archiveCharactersBatch(world, indexes, deaths.map(({ character, cause, settlement }) => ({
      character,
      context: { cause, settlementId: settlement?.id, globalX: settlement?.x, globalY: settlement?.y },
    })), rng);
    for (const { character, cause, settlement } of deaths) addEvent(world, {
      kind: 'death', title: `Умер ${character.name}`, description: `${character.name} умер в возрасте ${character.age} лет.`,
      cause, consequences: character.childIds.length ? ['имущество и обязательства переходят детям', 'тело будет перенесено на кладбище'] : ['освободилось место в общине', 'тело будет перенесено на кладбище'],
      entityRefs: [{ kind: 'character', id: character.id }, ...(settlement ? [{ kind: 'settlement' as const, id: settlement.id }] : [])], importance: character.renown > 55 ? 3 : 1,
    });
  }

  for (const settlement of world.settlements) {
    const localResidents = residents(indexes, settlement.id);
    settlement.population = localResidents.length;
    const adults = localResidents.filter(character => character.age >= 18 && character.age <= 48);
    const unmarried = adults.filter(character => !character.spouseId && character.age <= 60);
    if (unmarried.length >= 2 && rng.chance(.2)) {
      const a = rng.pick(unmarried);
      const candidates = unmarried.filter(character => character.id !== a.id && Math.abs(character.age - a.age) < 24);
      if (candidates.length) {
        const b = rng.pick(candidates);
        a.spouseId = b.id;
        b.spouseId = a.id;
        addRelationship(world, indexes, a, b, 'любовь', rng.int(45, 92), `брак в ${settlement.name}`);
        a.biography.push(`В ${world.year} году вступил в брак с ${b.name}.`);
        b.biography.push(`В ${world.year} году вступил в брак с ${a.name}.`);
      }
    }
  }
}

function startWars(world: WorldState, rng: RNG): void {
  if (world.wars.filter(war => war.active).length >= Math.ceil(world.kingdoms.length / 3)) return;
  const candidates = world.kingdoms.filter(kingdom => !world.wars.some(war => war.active && (war.attackerId === kingdom.id || war.defenderId === kingdom.id)));
  if (candidates.length < 2) return;

  let selected: { attacker: Kingdom; defender: Kingdom; target: Settlement; ruler: Character; options: ReturnType<typeof scoreMotivatedAction>[] } | undefined;
  let selectedMargin = Number.NEGATIVE_INFINITY;
  for (const attacker of candidates) {
    const actingRuler = ruler(world, attacker);
    const capital = world.settlements.find(item => item.id === attacker.capitalId);
    if (!actingRuler || !capital) continue;
    ensureCharacterMind(world, actingRuler);
    const possibleDefenders = candidates
      .filter(kingdom => kingdom.id !== attacker.id)
      .map(defender => ({ defender, relation: relationBetween(world, attacker.id, defender.id)?.score ?? 0 }))
      .sort((a, b) => a.relation - b.relation || b.defender.stability - a.defender.stability);
    const defender = possibleDefenders[0]?.defender;
    if (!defender) continue;
    const target = nearestSettlement(world, capital.x, capital.y, settlement => settlement.kingdomId === defender.id);
    if (!target) continue;
    const claim = attacker.claims.includes(target.id) ? 20 : 0;
    const hostility = Math.max(0, -(relationBetween(world, attacker.id, defender.id)?.score ?? 0));
    const powerAdvantage = attacker.armyStrength - defender.armyStrength + attacker.treasury / 12 - defender.treasury / 18;
    const warPressure = world.config.warlike * 28 + attacker.aggression * .28 + claim + hostility * .18 + powerAdvantage * .025;
    const options = [
      scoreMotivatedAction(world, actingRuler, {
        id: 'peace', label: 'Сохранить мир', base: 18, orderBenefit: 25, familyBenefit: 8,
        survivalBenefit: Math.max(0, -powerAdvantage) * .08, powerGain: -8, socialApproval: attacker.stability > 55 ? 10 : -4,
        situational: { 'торговые связи': world.tradeRoutes.some(route => route.active && route.controlledByKingdomIds.includes(attacker.id) && route.controlledByKingdomIds.includes(defender.id)) ? 14 : 0 },
      }),
      scoreMotivatedAction(world, actingRuler, {
        id: 'pressure', label: 'Давить угрозами и пошлинами', base: 12, powerGain: 18, wealthGain: 10,
        risk: 8, deception: 5, orderBenefit: -5, situational: { 'враждебность соседа': hostility * .12 },
      }),
      scoreMotivatedAction(world, actingRuler, {
        id: 'war', label: `Начать войну за ${target.name}`, base: warPressure, powerGain: 32 + claim,
        wealthGain: Math.max(5, target.prosperity * .25), familyBenefit: -12, orderBenefit: -22,
        risk: Math.max(12, 42 - powerAdvantage * .04), harm: 35, violence: 45, legalPenalty: 2,
        situational: { 'военное преимущество': powerAdvantage * .035, 'агрессивность государства': attacker.aggression * .18 },
      }),
    ];
    const war = options.find(option => option.id === 'war')!;
    const alternative = Math.max(...options.filter(option => option.id !== 'war').map(option => option.utility));
    const margin = war.utility - alternative;
    if (margin > selectedMargin) { selectedMargin = margin; selected = { attacker, defender, target, ruler: actingRuler, options }; }
  }

  if (!selected || selectedMargin < 6 || !rng.chance(Math.min(.7, .08 + selectedMargin / 120 + world.config.warlike * .12))) return;
  const { attacker, defender, target, ruler: actingRuler, options } = selected;
  const cause = attacker.claims.includes(target.id)
    ? `старое притязание на ${target.name}`
    : rng.pick(['неуплаченные торговые пошлины', 'набеги на приграничные деревни', `контроль над ресурсом «${target.resource}»`, 'убийство королевского посланника']);
  const goal = cause.includes('притязание') ? 'подчинить спорное владение' : `захватить ${target.name}`;
  const army = world.armies.find(item => item.kingdomId === attacker.id && !item.targetMonsterId && (item.status === 'garrison' || item.status === 'recovering'));
  if (!army) return;

  const decision = recordDecision(world, {
    actorRef: { kind: 'character', id: actingRuler.id }, goal, context: `${attacker.name} выбирает ответ государству ${defender.name}`,
    knownFactIds: decisionKnowledge(world, { kind: 'character', id: actingRuler.id }), options, chosenOptionId: 'war',
    tags: ['война', 'государство', 'внешняя политика'],
  });
  setDecisionMoment(world, actingRuler);
  const deltas: number[] = [];
  const addDelta = (delta: ReturnType<typeof recordStateDelta>) => { if (delta) deltas.push(delta.id); };

  const war: War = {
    id: world.nextIds.war++, name: `Война ${attacker.name} и ${defender.name}`, attackerId: attacker.id, defenderId: defender.id, startYear: world.year, active: true,
    cause, goal, contestedSettlementIds: [target.id], battles: 0, attackerLosses: 0, defenderLosses: 0, history: [`Война началась из-за причины: ${cause}.`],
  };
  world.wars.push(war);
  const attackerEnemiesBefore = [...attacker.enemies];
  const defenderEnemiesBefore = [...defender.enemies];
  if (!attacker.enemies.includes(defender.id)) attacker.enemies.push(defender.id);
  if (!defender.enemies.includes(attacker.id)) defender.enemies.push(attacker.id);
  const claimsBefore = [...attacker.claims];
  if (!attacker.claims.includes(target.id)) attacker.claims.push(target.id);
  addDelta(recordStateDelta(world, { entityRef: { kind: 'kingdom', id: attacker.id }, field: 'enemies', before: attackerEnemiesBefore, after: attacker.enemies, cause, decisionId: decision.id }));
  addDelta(recordStateDelta(world, { entityRef: { kind: 'kingdom', id: defender.id }, field: 'enemies', before: defenderEnemiesBefore, after: defender.enemies, cause, decisionId: decision.id }));
  addDelta(recordStateDelta(world, { entityRef: { kind: 'kingdom', id: attacker.id }, field: 'claims', before: claimsBefore, after: attacker.claims, cause, decisionId: decision.id }));
  setDiplomacy(world, attacker.id, defender.id, -100, 'война', cause);
  const armyBefore = { status: army.status, targetKingdomId: army.targetKingdomId, targetSettlementId: army.targetSettlementId };
  army.targetMonsterId = undefined;
  army.targetKingdomId = defender.id;
  army.targetSettlementId = target.id;
  army.status = 'marching';
  army.campaignHistory.push(`В ${world.year} году выступило к ${target.name}.`);
  addDelta(recordStateDelta(world, { entityRef: { kind: 'army', id: army.id }, field: 'campaign', before: armyBefore, after: { status: army.status, targetKingdomId: army.targetKingdomId, targetSettlementId: army.targetSettlementId }, cause: `приказ ${actingRuler.name}`, decisionId: decision.id }));
  const created = addEvent(world, {
    kind: 'war', title: `Началась ${war.name}`, description: `${actingRuler.name} приказал армии идти к ${target.name}.`, cause,
    conditions: [`правитель знал о состоянии армии и отношениях с ${defender.name}`, `вариант войны получил преимущество ${Math.round(selectedMargin)} пунктов`],
    decision: decision.reason, outcome: `армия ${army.name} начала поход`,
    consequences: ['собрана армия', 'торговля между сторонами остановлена', `цель похода — ${goal}`],
    entityRefs: [{ kind: 'war', id: war.id }, { kind: 'kingdom', id: attacker.id }, { kind: 'kingdom', id: defender.id }, { kind: 'army', id: army.id }, { kind: 'settlement', id: target.id }], importance: 5,
    decisionId: decision.id, stateDeltaIds: deltas,
  });
  linkDecisionToEvent(world, decision.id, created, deltas);
}

function moveArmies(world: WorldState, rng: RNG, indexes: WorldIndexes, dueArmyIds: ReadonlySet<number>): void {
  for (const armyId of dueArmyIds) {
    const army = world.armies.find(item => item.id === armyId);
    if (!army || (army.status !== 'marching' && army.status !== 'hunting')) continue;
    if (army.status === 'hunting') {
      const monster = army.targetMonsterId ? world.monsters.find(item => item.id === army.targetMonsterId) : undefined;
      if (!monster) { army.status = 'recovering'; army.targetMonsterId = undefined; continue; }
      if (Math.hypot(monster.x - army.x, monster.y - army.y) <= 1) { resolveMonsterBattle(world, army, monster, rng, indexes); continue; }
      const step = nextArmyFieldStep(world, army, monster.x, monster.y);
      army.x = step.x; army.y = step.y;
      if (Math.hypot(monster.x - army.x, monster.y - army.y) <= 1) resolveMonsterBattle(world, army, monster, rng, indexes);
      continue;
    }

    const target = army.targetSettlementId ? indexes.settlementById.get(army.targetSettlementId) : undefined;
    if (!target) { army.status = 'recovering'; continue; }
    if (Math.hypot(target.x - army.x, target.y - army.y) <= 1) { resolveBattle(world, army.id, target.id, rng, indexes); continue; }
    const step = nextArmyFieldStep(world, army, target.x, target.y);
    army.x = step.x; army.y = step.y;
    if (Math.hypot(target.x - army.x, target.y - army.y) <= 1) resolveBattle(world, army.id, target.id, rng, indexes);
  }
}

function resolveMonsterBattle(world: WorldState, army: WorldState['armies'][number], monster: Monster, rng: RNG, indexes: WorldIndexes): void {
  const armyPower = army.strength * (.55 + army.morale / 120) * (.55 + army.supplies / 160) * rng.int(75, 125) / 100;
  const monsterPower = (monster.power * 2.2 + monster.health * .9 + monster.footprintWidth * monster.footprintHeight * 4) * rng.int(78, 126) / 100;
  const armyLosses = Math.min(Math.max(army.soldierIds.length, army.strength), Math.max(3, Math.round(monsterPower / 20)));
  const monsterDamage = Math.max(4, Math.round(armyPower / 14));
  const actualArmyLosses = applyArmyCasualties(world, indexes, army, armyLosses, `погибли в бою с ${monster.name}`, rng, monster.x, monster.y);
  synchronizeArmyStrength(world, army);
  army.morale = Math.max(8, army.morale - Math.max(2, Math.round(armyLosses / 12)));
  monster.health = Math.max(0, monster.health - monsterDamage);
  monster.kills += actualArmyLosses;
  addBattlefieldEffects(world, monster.x, monster.y, actualArmyLosses, rng, army.id);
  army.campaignHistory.push(`В ${world.year} году сразилось с ${monster.name}: потери ${actualArmyLosses}, чудовище потеряло ${monsterDamage} здоровья.`);

  if (monster.health <= 0 || armyPower > monsterPower * 1.12) {
    const name = monster.name;
    const monsterId = monster.id;
    archiveMonster(world, monster, { cause: `убито армией ${army.name}`, killerName: army.name, globalX: monster.x, globalY: monster.y }, rng);
    army.targetMonsterId = undefined;
    army.status = 'recovering';
    army.morale = Math.min(100, army.morale + 12);
    addEvent(world, {
      kind: 'monster', title: `${army.name} уничтожило ${name}`, description: `Армия добралась до логова и убила чудовище ценой ${actualArmyLosses} воинов.`,
      cause: 'приказ правителя после нападений на жителей и дороги', conditions: ['угроза была подтверждена', 'армия имела снабжение и могла дойти до цели'],
      decision: 'командир вступил в бой', outcome: 'чудовище погибло', consequences: ['угроза исчезла', 'павших перенесут на кладбища', 'армия возвращается на восстановление'],
      entityRefs: [{ kind: 'army', id: army.id }, { kind: 'monster', id: monsterId }, { kind: 'kingdom', id: army.kingdomId }], importance: 5,
    });
  } else if (army.strength <= Math.max(8, Math.round(monster.power / 2)) || army.morale < 22) {
    army.status = 'recovering';
    addEvent(world, {
      kind: 'monster', title: `${army.name} отступило от ${monster.name}`, description: `Чудовище пережило бой. Армия потеряла ${actualArmyLosses} воинов.`,
      cause: 'силы чудовища превысили возможности отряда', consequences: ['угроза сохранилась', 'армия вернулась за пополнением'],
      entityRefs: [{ kind: 'army', id: army.id }, { kind: 'monster', id: monster.id }], importance: 4,
    });
  }
}

function resolveBattle(world: WorldState, armyId: number, settlementId: number, rng: RNG, indexes: WorldIndexes): void {
  const army = world.armies.find(item => item.id === armyId);
  const target = indexes.settlementById.get(settlementId);
  if (!army || !target) return;
  const war = world.wars.find(item => item.active && item.attackerId === army.kingdomId && item.defenderId === target.kingdomId);
  if (!war) { army.status = 'recovering'; return; }
  const defenderArmy = world.armies.find(item => item.kingdomId === target.kingdomId && item.id !== army.id);
  if (!defenderArmy) { army.status = 'recovering'; return; }

  army.status = 'battle';
  defenderArmy.status = 'battle';
  defenderArmy.x = army.x;
  defenderArmy.y = army.y;
  const outcome = resolveSpatialArmyBattle(world, army, defenderArmy, war, target, rng, indexes);
  const attackLosses = outcome.attackerDead + outcome.attackerWounded + outcome.attackerCaptured;
  const defenseLosses = outcome.defenderDead + outcome.defenderWounded + outcome.defenderCaptured;
  war.attackerLosses += attackLosses;
  war.defenderLosses += defenseLosses;
  war.battles += 1;
  const won = outcome.attackerWon;

  if (won) {
    const oldKingdom = target.kingdomId;
    target.kingdomId = army.kingdomId;
    target.damaged = Math.min(100, target.damaged + rng.int(18, 48));
    target.defense = Math.max(10, target.defense - rng.int(8, 22));
    target.unrest = Math.min(100, target.unrest + 35);
    target.history.push(`В ${world.year} году поселение захватило войско государства ${world.kingdoms.find(item => item.id === army.kingdomId)!.name}.`);
    residents(indexes, target.id).forEach(character => {
      character.kingdomId = army.kingdomId;
      character.loyalty = Math.max(0, character.loyalty - rng.int(5, 25));
      character.biography.push(`${target.name} был захвачен государством ${world.kingdoms.find(item => item.id === army.kingdomId)!.name}.`);
    });
    captureTerritoryAroundSettlement(world, target, army.kingdomId, world.year, rng, Math.max(4, Math.min(10, 4 + Math.floor(army.strength / 90))));
    for (const route of world.tradeRoutes.filter(item => item.fromSettlementId === target.id || item.toSettlementId === target.id)) {
      const fromKingdom = world.settlements.find(item => item.id === route.fromSettlementId)?.kingdomId;
      const toKingdom = world.settlements.find(item => item.id === route.toSettlementId)?.kingdomId;
      route.controlledByKingdomIds = [...new Set([fromKingdom, toKingdom].filter((id): id is number => typeof id === 'number'))];
      route.history.push(`После захвата ${target.name} контроль над путём изменился.`);
    }
    war.history.push(`${target.name} пал после сражения №${outcome.record.id}. Потери сторон: ${attackLosses} и ${defenseLosses}.`);
    addEvent(world, {
      kind: 'battle', title: `Пал ${target.name}`, description: `${army.name} захватило поселение после ${outcome.record.rounds} раундов боя.`, cause: `поход в рамках войны: ${war.cause}`,
      conditions: [`подразделения атакующих сохранили строй`, `защитники потеряли ${outcome.defenderCaptured} воинов пленными`],
      decision: 'командиры ввели фронт, фланги, стрелков и резерв в бой', outcome: 'оборона была сломлена и поселение занято',
      consequences: ['граница государства изменилась', 'раненые требуют лечения', 'пленные ожидают обмена или мира', 'победитель получил часть обоза'],
      entityRefs: [{ kind: 'battleRecord', id: outcome.record.id }, { kind: 'settlement', id: target.id }, { kind: 'army', id: army.id }, { kind: 'army', id: defenderArmy.id }, { kind: 'war', id: war.id }, { kind: 'kingdom', id: oldKingdom }, { kind: 'kingdom', id: army.kingdomId }], importance: 5,
    });
  } else {
    war.history.push(`${target.name} удержал стены в сражении №${outcome.record.id}. Потери сторон: ${attackLosses} и ${defenseLosses}.`);
    addEvent(world, {
      kind: 'battle', title: `${target.name} удержал стены`, description: `${army.name} потеряло строй и было отброшено после ${outcome.record.rounds} раундов.`, cause: `оборона спорной территории в войне: ${war.cause}`,
      conditions: ['защитникам помогли укрепления', `атакующие потеряли пленными ${outcome.attackerCaptured}`],
      decision: 'командир защитников удержал фронт и ввёл резерв', outcome: 'атакующая армия отступила',
      consequences: ['армия отступила', 'раненые эвакуируются в лагерь', 'на поле остались тела и брошенное имущество'],
      entityRefs: [{ kind: 'battleRecord', id: outcome.record.id }, { kind: 'settlement', id: target.id }, { kind: 'army', id: army.id }, { kind: 'army', id: defenderArmy.id }, { kind: 'war', id: war.id }], importance: 4,
    });
  }

  addBattlefieldEffects(world, army.x, army.y, outcome.attackerDead + outcome.defenderDead, rng, army.id, target.id);
  for (let index = 0; index < Math.min(8, outcome.record.lootedItemIds.length); index += 1) addLocalEffect(world, army.x, army.y, 'lost-item', 'Брошенное имущество после сражения', rng, { kind: 'battleRecord', id: outcome.record.id });
  army.status = 'recovering';
  defenderArmy.status = 'recovering';
  army.targetSettlementId = undefined;
  army.targetKingdomId = undefined;
  army.campaignHistory.push(won ? `Захватило ${target.name} в сражении №${outcome.record.id}.` : `Отступило от ${target.name} после сражения №${outcome.record.id}.`);
  defenderArmy.campaignHistory.push(won ? `Потеряло ${target.name} в сражении №${outcome.record.id}.` : `Удержало ${target.name} в сражении №${outcome.record.id}.`);
  if (war.battles >= 2 && rng.chance(.28 + war.battles * .08)) endWar(world, war, won ? war.attackerId : war.defenderId);
}

function endWar(world: WorldState, war: War, victorId: number): void {
  war.active = false;
  war.endYear = world.year;
  war.victorId = victorId;
  const attacker = world.kingdoms.find(item => item.id === war.attackerId)!;
  const defender = world.kingdoms.find(item => item.id === war.defenderId)!;
  const victor = world.kingdoms.find(item => item.id === victorId)!;
  war.peaceTerms = victorId === attacker.id ? `${defender.name} признало захваченные земли и выплатило часть казны` : `${attacker.name} отказалось от притязаний и отвело войско`;
  war.history.push(`Мир заключён: ${war.peaceTerms}.`);
  releaseWarPrisoners(world, war);
  attacker.enemies = attacker.enemies.filter(id => id !== defender.id);
  defender.enemies = defender.enemies.filter(id => id !== attacker.id);
  setDiplomacy(world, attacker.id, defender.id, -32, 'напряжение', 'свежая память о войне');
  world.armies.filter(army => army.kingdomId === attacker.id || army.kingdomId === defender.id).forEach(army => { army.status = 'recovering'; army.targetSettlementId = undefined; army.targetMonsterId = undefined; });
  addEvent(world, {
    kind: 'war', title: `Завершилась ${war.name}`, description: war.peaceTerms, cause: 'потери, истощение запасов и исход сражений',
    consequences: ['армии возвращаются домой', 'границы закреплены мирным договором', 'между государствами осталось напряжение'],
    entityRefs: [{ kind: 'war', id: war.id }, { kind: 'kingdom', id: victor.id }], importance: 4,
  });
}

function recoverArmies(world: WorldState): void {
  for (const army of world.armies) {
    if (army.status !== 'recovering' && army.status !== 'garrison') continue;
    const kingdom = world.kingdoms.find(item => item.id === army.kingdomId);
    const capital = kingdom ? world.settlements.find(item => item.id === kingdom.capitalId) : undefined;
    if (!kingdom || !capital) continue;
    army.x = capital.x;
    army.y = capital.y;
    ensureArmyOutsideSettlements(world, army);
    army.morale = Math.min(92, army.morale + 2);
    army.supplies = Math.min(100, army.supplies + 8);

    if (army.targetMonsterId) {
      const target = world.monsters.find(item => item.id === army.targetMonsterId);
      if (!target) {
        army.targetMonsterId = undefined;
        army.status = 'garrison';
        continue;
      }
      const requiredStrength = Math.max(18, Math.round(target.power * .48));
      if (army.strength >= requiredStrength && army.supplies > 55 && army.morale > 40) {
        army.status = 'hunting';
        army.campaignHistory.push(`В ${world.year} году после пополнения продолжило охоту на ${target.name}.`);
      } else army.status = 'recovering';
      continue;
    }

    if (army.soldierIds.length > Math.max(10, kingdom.armyStrength * .45) && army.supplies > 55) army.status = 'garrison';
  }
}

function transferArtifactToMonster(world: WorldState, monsterId: number, settlementId: number, rng: RNG, indexes: WorldIndexes): void {
  const victims = world.artifacts.filter(artifact => artifact.ownerId && (artifact.settlementId === settlementId || indexes.characterById.get(artifact.ownerId)?.settlementId === settlementId) && rng.chance(.2));
  const artifact = victims[0];
  if (!artifact) return;
  const oldOwner = artifact.ownerId ? indexes.characterById.get(artifact.ownerId) : undefined;
  if (oldOwner) oldOwner.artifactIds = oldOwner.artifactIds.filter(id => id !== artifact.id);
  artifact.ownerHistory.push({ year: world.year, settlementId: artifact.settlementId, reason: `утрачен во время нападения существа ${world.monsters.find(monster => monster.id === monsterId)?.name}` });
  artifact.ownerId = undefined;
  artifact.history.push(`В ${world.year} году исчез после нападения чудовища.`);
}

function monsterActions(world: WorldState, rng: RNG, indexes: WorldIndexes, dueMonsterIds: ReadonlySet<number>): void {
  for (const monsterId of dueMonsterIds) {
    const monster = world.monsters.find(item => item.id === monsterId);
    if (!monster?.alive) continue;
    const elapsedMonths = monster.targetSettlementId || monster.hunger >= 70 || monster.tier === 'boss'
      ? 1
      : monster.tier === 'miniboss'
        ? 2
        : monster.tier === 'elite'
          ? 3
          : 4;
    monster.hunger = Math.min(100, monster.hunger + rng.int(1, 5) * elapsedMonths);
    const monthlyActionChance = Math.min(.9, ((monster.species === 'dragon' ? .035 : .014) + monster.hunger / 1800) * world.config.monsterDensity);
    const scheduledActionChance = 1 - Math.pow(1 - monthlyActionChance, elapsedMonths);
    if (!rng.chance(scheduledActionChance)) continue;
    const target = nearestSettlement(world, monster.x, monster.y, settlement => distance(monster, settlement) <= monster.territoryRadius + 5);
    if (!target) continue;
    monster.targetSettlementId = target.id;
    monster.x += Math.sign(target.x - monster.x);
    monster.y += Math.sign(target.y - monster.y);
    if (distance(monster, target) > 1.5) continue;
    const isDragon = monster.species === 'dragon';
    const damage = isDragon ? rng.int(12, 38) : rng.int(4, 16);
    const deaths = Math.min(target.population, rng.int(1, Math.max(2, Math.round(target.population * (isDragon ? .07 : .025)))));
    target.damaged = Math.min(100, target.damaged + damage);
    target.food = Math.max(0, target.food - rng.int(isDragon ? 12 : 4, isDragon ? 35 : 16));
    target.prosperity = Math.max(3, target.prosperity - rng.int(1, isDragon ? 8 : 4));
    monster.hoard += rng.int(10, isDragon ? 160 : 45);
    monster.hunger = Math.max(0, monster.hunger - rng.int(25, 65));
    monster.kills += deaths;
    const victims = [...residents(indexes, target.id)].sort(() => rng.next() - .5).slice(0, deaths);
    for (const victim of victims) victim.biography.push(`Погиб во время нападения ${monster.name} на ${target.name}.`);
    archiveCharactersBatch(world, indexes, victims.map(victim => ({
      character: victim,
      context: {
        cause: `погиб во время нападения ${monster.name} на ${target.name}`,
        killerName: monster.name,
        settlementId: target.id,
        globalX: target.x,
        globalY: target.y,
      },
    })), rng);
    for (let index = 0; index < Math.min(18, Math.max(4, Math.round(damage / 2))); index += 1) {
      addLocalEffect(world, target.x, target.y, isDragon && index % 2 === 0 ? 'burn' : index % 4 === 0 ? 'blood' : index % 3 === 0 ? 'rubble' : 'looted', isDragon ? 'След огня дракона' : 'Разграбленный участок', rng, { kind: 'monster', id: monster.id });
    }
    monster.history.push(`Напал на ${target.name} в ${world.year} году.`);
    target.history.push(`В ${world.year} году ${monster.name} разорил часть поселения.`);
    target.population = residents(indexes, target.id).length;
    transferArtifactToMonster(world, monster.id, target.id, rng, indexes);
    addEvent(world, {
      kind: isDragon ? 'dragon' : 'monster', title: `${monster.name} напал на ${target.name}`,
      description: isDragon ? `Огонь уничтожил дома и амбары. Погибли ${deaths} жителей.` : `Существо разграбило окраины. Погибли ${deaths} жителей.`,
      cause: `${monster.behavior}; голод вынудил существо выйти к поселению`,
      consequences: ['потеря припасов', 'гибель жителей', 'правитель отправляет героя или армию', 'опасность торговых путей выросла'],
      entityRefs: [{ kind: 'monster', id: monster.id }, { kind: 'settlement', id: target.id }, { kind: 'kingdom', id: target.kingdomId }], importance: isDragon ? 5 : monster.tier === 'boss' ? 4 : 3,
    });
    // Реакция правителя больше не происходит мгновенно. Событие создаёт
    // свидетельства, слухи и официальное донесение. Герой или армия будут
    // отправлены только после доставки и подтверждения сведений в столице.
  }
}

function dispatchHero(world: WorldState, monsterId: number, kingdomId: number, rng: RNG, indexes: WorldIndexes): void {
  const monster = world.monsters.find(item => item.id === monsterId);
  const kingdom = world.kingdoms.find(item => item.id === kingdomId);
  if (!monster || !kingdom) return;
  const heroes = world.characters.filter(character => character.alive && character.kingdomId === kingdomId && character.age >= 18 && (character.profession === 'soldier' || character.profession === 'hunter' || character.renown >= 35));
  if (!heroes.length) return;
  const hero = [...heroes].sort((a, b) => b.renown - a.renown)[0]!;
  addEvent(world, {
    kind: 'hero', title: `${hero.name} отправлен против ${monster.name}`, description: `${ruler(world, kingdom)?.name ?? 'Правитель'} пообещал золото, титул и землю за голову чудовища.`,
    cause: `нападение на земли государства ${kingdom.name}`, consequences: ['собрана экспедиция', 'герой покинул поселение'],
    entityRefs: [{ kind: 'character', id: hero.id }, { kind: 'monster', id: monster.id }, { kind: 'kingdom', id: kingdom.id }], importance: 4,
  });
  const heroPower = 30 + hero.renown + hero.health * .35 + hero.artifactIds.length * 18 + rng.int(0, 55);
  const monsterPower = monster.power + monster.health * .08 + rng.int(0, 55);
  if (heroPower > monsterPower) {
    const monsterName = monster.name;
    const lair = world.dungeons.find(dungeon => dungeon.id === monster.lairDungeonId);
    hero.renown = Math.min(100, hero.renown + (monster.species === 'dragon' ? 35 : 18));
    hero.kills += 1;
    hero.wealth += monster.hoard;
    hero.titles.push(monster.species === 'dragon' ? 'Драконоборец' : 'Убийца чудовищ');
    hero.biography.push(`Убил ${monsterName} в ${world.year} году.`);
    monster.history.push(`Убит героем ${hero.name}.`);
    archiveMonster(world, monster, { cause: `убито героем ${hero.name}`, killerName: hero.name, globalX: monster.x, globalY: monster.y }, rng);
    addLocalEffect(world, monster.x, monster.y, 'blood', `Место победы ${hero.name}`, rng, { kind: 'character', id: hero.id });
    if (lair) lair.history.push(`В ${world.year} году ${hero.name} убил хозяина логова.`);
    addEvent(world, {
      kind: 'hero', title: `${hero.name} убил ${monsterName}`, description: `Герой вернулся с сокровищами и доказательствами победы.`, cause: 'королевский приказ и личная охота',
      consequences: ['опасность исчезла', 'герой получил богатство и славу', 'останки занесены в кладбищенский архив'],
      entityRefs: [{ kind: 'character', id: hero.id }, { kind: 'monster', id: monsterId }, ...(lair ? [{ kind: 'dungeon' as const, id: lair.id }] : [])], importance: 5,
    });
  } else if (rng.chance(.58)) {
    const heroName = hero.name;
    const heroId = hero.id;
    hero.biography.push(`Погиб во время охоты на ${monster.name}.`);
    monster.kills += 1;
    archiveCharacter(world, indexes, hero, {
      cause: `погиб во время охоты на ${monster.name}`,
      killerName: monster.name,
      globalX: monster.x,
      globalY: monster.y,
    }, rng);
    if (hero.artifactIds.length) addLocalEffect(world, monster.x, monster.y, 'lost-item', `Утерянное снаряжение ${heroName}`, rng, { kind: 'artifact', id: hero.artifactIds[0]! });
    addEvent(world, {
      kind: 'hero', title: `${heroName} погиб на охоте за ${monster.name}`, description: `Выжившие вернулись с разными рассказами о последнем бое.`, cause: 'чудовище оказалось сильнее экспедиции',
      consequences: ['угроза сохранилась', 'оружие героя могло остаться в логове', 'тело будет найдено или истлеет в дикой местности'],
      entityRefs: [{ kind: 'character', id: heroId }, { kind: 'monster', id: monster.id }], importance: 4,
    });
  } else {
    const injury = rng.pick(['сломанная рука', 'обожжённое лицо', 'повреждённое колено', 'глубокая рана груди']);
    hero.health = Math.max(12, hero.health - rng.int(18, 45));
    hero.injuries.push(injury);
    hero.biography.push(`Был ранен во время охоты на ${monster.name}: ${injury}.`);
    addEvent(world, {
      kind: 'hero', title: `${hero.name} вернулся раненым`, description: `${monster.name} пережил охоту и остался угрозой.`, cause: 'неудачный бой с чудовищем',
      consequences: ['герой получил постоянную травму', 'угроза сохранилась', 'правитель может направить армию'], entityRefs: [{ kind: 'character', id: hero.id }, { kind: 'monster', id: monster.id }], importance: 3,
    });
  }
}

function dispatchArmyAgainstMonster(world: WorldState, monsterId: number, kingdomId: number): void {
  const monster = world.monsters.find(item => item.id === monsterId);
  const kingdom = world.kingdoms.find(item => item.id === kingdomId);
  const army = world.armies.find(item => item.kingdomId === kingdomId && !item.targetMonsterId && (item.status === 'garrison' || item.status === 'recovering'));
  if (!monster || !kingdom || !army || army.targetMonsterId === monsterId) return;
  if (army.strength < Math.max(20, Math.round(monster.power * .55))) return;
  army.targetMonsterId = monster.id;
  army.targetSettlementId = undefined;
  army.targetKingdomId = undefined;
  army.status = 'hunting';
  army.campaignHistory.push(`В ${world.year} году получило приказ уничтожить ${monster.name}.`);
  addEvent(world, {
    kind: 'monster', title: `${army.name} отправлено против ${monster.name}`, description: `${ruler(world, kingdom)?.name ?? 'Правитель'} направил войско к месту последнего появления чудовища.`,
    cause: 'герой не смог устранить угрозу или угроза слишком велика для одного отряда', conditions: ['местонахождение чудовища известно', 'армия имеет достаточно людей и припасов'],
    decision: 'правитель приказал армии начать охоту', outcome: 'армия вышла к цели', consequences: ['гарнизон столицы ослаблен', 'началась военная экспедиция против чудовища'],
    entityRefs: [{ kind: 'army', id: army.id }, { kind: 'monster', id: monster.id }, { kind: 'kingdom', id: kingdom.id }], importance: 4,
  });
}

function succession(world: WorldState, rng: RNG): void {
  for (const kingdom of world.kingdoms) {
    const current = world.characters.find(character => character.id === kingdom.rulerId);
    if (current?.alive) continue;
    const archivedCurrent = burialForSubject(world, 'character', kingdom.rulerId);
    const dynasty = world.dynasties.find(item => item.id === kingdom.dynastyId);
    const heirIds = current?.childIds ?? archivedCurrent?.childIds ?? [];
    const heirs = heirIds.map(id => world.characters.find(character => character.id === id)).filter((character): character is Character => Boolean(character?.alive && character.age >= 16));
    const dynasticCandidates = dynasty?.memberIds.map(id => world.characters.find(character => character.id === id)).filter((character): character is Character => Boolean(character?.alive && character.age >= 16)) ?? [];
    const nobles = world.characters.filter(character => character.alive && character.kingdomId === kingdom.id && character.age >= 18).sort((a, b) => b.renown - a.renown);
    const successor = heirs[0] ?? dynasticCandidates[0] ?? nobles[0];
    if (!successor) continue;
    const dynastic = successor.dynastyId === kingdom.dynastyId;
    successor.titles.push(kingdom.species === 'orc' ? 'Верховный вождь' : 'Правитель');
    successor.renown = Math.max(65, successor.renown);
    kingdom.rulerId = successor.id;
    kingdom.stability = Math.max(12, kingdom.stability - (dynastic ? rng.int(3, 10) : rng.int(16, 34)));
    successor.biography.push(`Стал правителем государства ${kingdom.name} в ${world.year} году.`);
    if (dynasty && dynastic) dynasty.currentHeadId = successor.id;
    if (!dynastic && successor.dynastyId) {
      kingdom.dynastyId = successor.dynastyId;
      const newDynasty = world.dynasties.find(item => item.id === successor.dynastyId);
      if (newDynasty) {
        newDynasty.kingdomId = kingdom.id;
        newDynasty.claimKingdomIds = [...new Set([...newDynasty.claimKingdomIds, kingdom.id])];
        newDynasty.history.push(`В ${world.year} году дом получил престол государства ${kingdom.name}.`);
      }
    }
    addEvent(world, {
      kind: 'politics', title: `${successor.name} занял престол государства ${kingdom.name}`,
      description: dynastic ? 'Власть перешла члену правящего дома.' : 'Явного наследника не было, и сильнейшая придворная группа возвела нового правителя.',
      cause: `смерть прежнего правителя ${current?.name ?? archivedCurrent?.name ?? ''}`.trim(), consequences: dynastic ? ['династия сохранила власть'] : ['правящий дом сменился', 'стабильность государства упала', 'старые претенденты могут поднять мятеж'],
      entityRefs: [{ kind: 'character', id: successor.id }, { kind: 'kingdom', id: kingdom.id }, ...(successor.dynastyId ? [{ kind: 'dynasty' as const, id: successor.dynastyId }] : [])], importance: 5,
    });
  }
}

function writeBooks(world: WorldState, rng: RNG): void {
  if (world.month !== 12 || !rng.chance(.55)) return;
  const authors = world.characters.filter(character => character.alive && character.age >= 20 && ['scribe', 'priest', 'healer'].includes(character.profession));
  if (!authors.length) return;
  const author = rng.pick(authors);
  const recent = world.events.filter(event => event.year >= world.year - 8).slice(-30);
  const source = recent.length ? rng.pick(recent) : undefined;
  const subject = source ? source.title : rng.pick(['чудовища', 'история династий', 'торговые пути', 'богословие', 'охота и миграции животных', 'алхимические составы']);
  const book = {
    id: world.nextIds.book++, title: `${rng.pick(['Хроника', 'Свидетельство', 'Рассуждение', 'Песни'])}: ${subject}`, authorId: author.id, yearWritten: world.year,
    language: world.kingdoms.find(kingdom => kingdom.id === author.kingdomId)?.culture ?? 'общий язык', subject, reliability: rng.int(35, 95),
    bias: rng.pick(['лояльность правителю', 'личный взгляд автора', 'религиозное толкование', 'страх перед чудовищами']),
    summary: source ? `Автор описывает событие «${source.title}» и объясняет его причины по-своему.` : `Автор собирает сведения о теме «${subject}».`,
    copies: rng.int(1, 12), settlementId: author.settlementId, referencedEventIds: source ? [source.id] : [],
  };
  world.books.push(book);
  author.bookIds.push(book.id);
  author.biography.push(`Написал книгу «${book.title}».`);
  addEvent(world, {
    kind: 'book', title: `Написана книга «${book.title}»`, description: `${author.name} закончил труд в поселении ${world.settlements.find(item => item.id === author.settlementId)?.name}.`,
    cause: source ? `попытка объяснить событие «${source.title}»` : 'накопленные знания автора', consequences: ['появился новый источник сведений', 'версия автора может повлиять на взгляды читателей'],
    entityRefs: [{ kind: 'book', id: book.id }, { kind: 'character', id: author.id }], importance: 2,
  });
}


function advanceHousing(world: WorldState, rng: RNG, indexes: WorldIndexes): void {
  for (const settlement of world.settlements) {
    const localResidents = residents(indexes, settlement.id);
    settlement.population = localResidents.length;
    const shortage = Math.max(0, settlement.population - settlement.residentialCapacity);
    const nearCapacity = settlement.residentialCapacity - settlement.population < Math.max(2, Math.ceil(settlement.population * .015));
    if (shortage <= 0 && !nearCapacity) continue;
    const peopleNeeded = shortage > 0 ? shortage : Math.max(4, Math.ceil(settlement.population * .04));

    const activeHousing = world.constructionProjects.some(project => project.settlementId === settlement.id && ['house', 'tenement', 'manor'].includes(project.buildingType) && !['завершено', 'заброшено'].includes(project.stage));
    if (!activeHousing && settlement.prosperity >= 18) {
      const type = peopleNeeded >= 18 || settlement.type === 'city' ? 'tenement' : 'house';
      requestConstructionProject(world, settlement, type, `необходимо ${peopleNeeded} новых жилых мест`, rng);
      continue;
    }

    if (shortage <= Math.max(3, Math.ceil(settlement.population * .02))) continue;
    let destination: Settlement | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of world.settlements) {
      if (candidate.id === settlement.id || candidate.kingdomId !== settlement.kingdomId || candidate.residentialCapacity - candidate.population < 3) continue;
      const candidateDistance = Math.hypot(candidate.x - settlement.x, candidate.y - settlement.y);
      const connection = localResidents.slice(0, 24).reduce((sum, resident) => sum + settlementConnectionScore(world, resident, candidate.id, indexes), 0);
      const score = (candidate.residentialCapacity - candidate.population) * .8 + candidate.prosperity * .25 + connection - candidateDistance * 4;
      if (score > bestScore) { bestScore = score; destination = candidate; }
    }
    if (!destination) {
      settlement.unrest = Math.min(100, settlement.unrest + 5);
      continue;
    }
    const migrants = localResidents.filter(character => character.age >= 14 && !character.titles.length).sort((a, b) => settlementConnectionScore(world, b, destination!.id, indexes) - settlementConnectionScore(world, a, destination!.id, indexes) || a.id - b.id).slice(0, Math.min(shortage, rng.int(1, 6)));
    if (!migrants.length) continue;
    for (const migrant of migrants) {
      moveResidentInIndexes(indexes, migrant, destination.id);
      migrant.kingdomId = destination.kingdomId;
      migrant.homeDistrict = destination.districts[0]?.name ?? 'Сердце поселения';
      migrant.biography.push(`В ${world.year} году переехал из ${settlement.name} в ${destination.name} из-за нехватки жилья.`);
    }
    settlement.population = residents(indexes, settlement.id).length;
    destination.population = residents(indexes, destination.id).length;
    addEvent(world, {
      kind: 'migration', title: `Жители покинули ${settlement.name}`, description: `${migrants.length} человек переселились в ${destination.name}.`,
      cause: 'нехватка жилья и материалов для строительства', conditions: [`не хватало ${shortage} жилых мест`, `${destination.name} имел свободное жильё`],
      decision: 'семьи выбрали переселение внутри государства', outcome: 'население перераспределилось между поселениями',
      consequences: ['перенаселение снизилось', 'новое поселение получило работников', 'семейные и рабочие связи изменились'],
      entityRefs: [{ kind: 'settlement', id: settlement.id }, { kind: 'settlement', id: destination.id }, ...migrants.slice(0, 3).map(character => ({ kind: 'character' as const, id: character.id }))], importance: 2,
    });
  }
}

export interface SimulationEngine {
  world: WorldState;
  indexes: WorldIndexes;
  processedTasks: number;
  phaseTotals: Map<string, { totalMs: number; calls: number; maxMs: number }>;
  exactMonths: number;
  coarseMonths: number;
}

export function createSimulationEngine(world: WorldState): SimulationEngine {
  world.simulation.performanceCoreVersion = 1;
  synchronizeEmploymentLinks(world);
  return { world, indexes: buildWorldIndexes(world), processedTasks: 0, phaseTotals: new Map(), exactMonths: 0, coarseMonths: 0 };
}

export function replaceSimulationWorld(engine: SimulationEngine, world: WorldState): void {
  engine.world = world;
  engine.indexes = buildWorldIndexes(world);
  engine.processedTasks = 0;
  engine.phaseTotals.clear();
  engine.exactMonths = 0;
  engine.coarseMonths = 0;
}

export function resetSimulationProfiler(engine: SimulationEngine): void {
  engine.phaseTotals.clear();
  engine.exactMonths = 0;
  engine.coarseMonths = 0;
}

export function simulationPhaseProfile(engine: SimulationEngine): SimulationPhaseProfile[] {
  return [...engine.phaseTotals.entries()]
    .map(([phase, value]) => ({ phase, totalMs: value.totalMs, calls: value.calls, maxMs: value.maxMs }))
    .sort((a, b) => b.totalMs - a.totalMs || a.phase.localeCompare(b.phase));
}

function runPhase<T>(engine: SimulationEngine, phase: string, onPhase: ((phase: string) => void) | undefined, action: () => T): T {
  onPhase?.(phase);
  const startedAt = performance.now();
  try {
    return action();
  } finally {
    const elapsed = performance.now() - startedAt;
    const current = engine.phaseTotals.get(phase) ?? { totalMs: 0, calls: 0, maxMs: 0 };
    current.totalMs += elapsed;
    current.calls += 1;
    current.maxMs = Math.max(current.maxMs, elapsed);
    engine.phaseTotals.set(phase, current);
  }
}

export function advanceOneMonth(
  engine: SimulationEngine,
  onPhase?: (phase: string) => void,
  options: { fastForward?: boolean; monthStep?: number; deferCitySimulation?: boolean } = {},
): number {
  const { world, indexes } = engine;
  const fastForward = Boolean(options.fastForward);
  const monthStep = Math.max(1, Math.min(3, Math.floor(options.monthStep ?? 1)));
  if (fastForward) engine.coarseMonths += monthStep;
  else engine.exactMonths += monthStep;
  initializeDecisionCore(world);
  const absoluteMonth = world.year * 12 + world.month - 1 + monthStep;
  world.year = Math.floor(absoluteMonth / 12);
  world.month = absoluteMonth % 12 + 1;
  const rng = new RNG(`${world.config.seed}:${world.year}:${world.month}`);
  const schedule = prepareMonthSchedule(world, indexes, { fastForward });
  const detailed = detailedPopulationContext(world, indexes, schedule.activeSettlementIds);

  if (schedule.economySettlementIds.size) runPhase(engine, 'Поля, посевы и уход за урожаем', onPhase, () => advanceAgriculture(world, rng, indexes, schedule.economySettlementIds));
  if (schedule.economySettlementIds.size) runPhase(engine, 'Домохозяйства, заведения и физическая экономика', onPhase, () => advanceMaterialEconomy(world, rng, indexes, schedule.economySettlementIds, schedule.activeSettlementIds, detailed.householdIds));
  runPhase(engine, 'Личная экипировка, работа, покупки и местные потребности', onPhase, () => advanceLivingEconomy(world, rng, indexes, detailed, { fastForward }));
  if (schedule.economySettlementIds.size) runPhase(engine, 'Стройплощадки, материалы и работа строителей', onPhase, () => advanceConstruction(world, rng, indexes, schedule.economySettlementIds));
  if (schedule.economySettlementIds.size) runPhase(engine, 'Поселения и торговые пути', onPhase, () => advanceEconomy(world, rng, indexes, schedule.economySettlementIds, schedule.activeSettlementIds));

  if (schedule.runPopulation) {
    runPhase(engine, 'Жители, семьи и наследование', onPhase, () => advancePopulation(world, rng, indexes));
    rebuildRelationshipIndexes(indexes, world.relationships);
  }
  if (schedule.runHousing) {
    runPhase(engine, 'Строительство и переселения', onPhase, () => advanceHousing(world, rng, indexes));
  }
  runPhase(engine, 'Здоровье, болезни, беременность и лечение', onPhase, () => advanceHealthSystem(world, rng, indexes, { fastForward, elapsedMonths: monthStep }));

  if (schedule.ecologySettlementIds.size || schedule.runSeasonalEcology) runPhase(engine, schedule.runSeasonalEcology ? 'Сезонная экология' : 'Активные регионы и промыслы', onPhase, () => advanceEcology(world, rng, indexes, {
    settlementIds: schedule.ecologySettlementIds, activeSettlementIds: schedule.activeSettlementIds, updateAnimals: schedule.runSeasonalEcology,
  }));

  if (world.month === 1) {
    runPhase(engine, 'Культура, вера, языки и образование', onPhase, () => advanceCultureSystem(world, new RNG(`${world.config.seed}:культура:${world.year}`), indexes));
    runPhase(engine, 'Цивилизации, эпохи, технологии и рецепты', onPhase, () => advanceCivilizationSystem(world));
    runPhase(engine, 'Медленное расширение границ', onPhase, () => advanceModernTerritories(world, new RNG(`${world.config.seed}:современные-границы:${world.year}`)));
  }

  const mindIds = schedule.runMindGlobal ? undefined : fastForward && ![1, 4, 7, 10].includes(world.month) ? new Set<number>() : new Set<number>([
    ...detailed.characterIds,
    ...world.kingdoms.map(kingdom => kingdom.rulerId),
    ...world.armies.map(army => army.commanderId).filter((id): id is number => typeof id === 'number'),
  ]);
  if (schedule.runMindGlobal || (mindIds?.size ?? 0)) runPhase(engine, 'Цели, эмоции, обязательства и мотивы жителей', onPhase, () => advanceMindSystem(world, rng, indexes, mindIds));
  if (!fastForward || [1, 4, 7, 10].includes(world.month)) runPhase(engine, 'Связи, семьи, обещания и личные последствия', onPhase, () => advanceSocialSystem(world, rng, indexes, fastForward));
  if (!fastForward || world.month === 1 || world.armies.some(army => army.status !== 'garrison' && army.status !== 'recovering')) runPhase(engine, 'Казармы, гарнизоны, жалование и снабжение армий', onPhase, () => advanceMilitaryInfrastructure(world, rng, indexes));
  runPhase(engine, 'Политика, армии и угрозы', onPhase, () => {
    startWars(world, rng); moveArmies(world, rng, indexes, schedule.dueArmyIds); recoverArmies(world); monsterActions(world, rng, indexes, schedule.dueMonsterIds); normalizeKingdomCapitals(world);
  });
  runPhase(engine, 'Городские службы, патрули, преступления, суды и пожары', onPhase, () => advanceSettlementLife(world, rng, indexes, schedule.activeSettlementIds, schedule.economySettlementIds, { fastForward, elapsedMonths: monthStep }));
  const knowledge = (!fastForward || [1, 4, 7, 10].includes(world.month) || world.messages.some(message => message.status === 'в пути' && message.arrivalTick <= worldTick(world)))
    ? runPhase(engine, 'Память, слухи, письма и донесения', onPhase, () => advanceKnowledgeSystem(world, rng, indexes, detailed, { maintenance: schedule.runKnowledgeMaintenance }))
    : { confirmedMonsterThreats: [], deliveredMessages: 0, spreadRumors: 0 };
  for (const threat of knowledge.confirmedMonsterThreats) {
    const monster = indexes.monsterById.get(threat.monsterId) ?? world.monsters.find(item => item.id === threat.monsterId);
    if (!monster?.alive) { markKnowledgeDecision(world, threat.factId, 'К моменту решения угроза уже исчезла.'); continue; }
    dispatchHero(world, threat.monsterId, threat.kingdomId, rng, indexes);
    if (world.monsters.some(item => item.id === threat.monsterId)) dispatchArmyAgainstMonster(world, threat.monsterId, threat.kingdomId);
    markKnowledgeDecision(world, threat.factId, `Правитель получил подтверждённое донесение и отдал приказ в ${world.year}.${String(world.month).padStart(2, '0')}.`);
  }
  runPhase(engine, 'Кладбища, погребения и исчезновение следов', onPhase, () => { advanceBurials(world, rng); succession(world, rng); });
  if (!fastForward || [1, 4, 7, 10].includes(world.month)) runPhase(engine, 'Дворы, вассалы, налоги, приказы и внутренняя политика', onPhase, () => advanceStateMachine(world, rng, indexes));
  if (!fastForward || world.month === 1 || world.armies.some(army => army.status !== 'garrison' && army.status !== 'recovering')) runPhase(engine, 'Полевые лагеря, отдельные солдаты и походные колонны', onPhase, () => advancePhysicalArmySystem(world, rng, indexes));

  if (schedule.runBooks) writeBooks(world, rng);
  runPhase(engine, 'Экспедиции, лагеря и основание поселений', onPhase, () => advanceSettlementLifecycle(world, rng, indexes, { allowFormation: schedule.runSettlementLifecycle, elapsedMonths: monthStep }));
  runPhase(engine, 'Политические общины, автономия и формирование государств', onPhase, () => advanceStateFormation(world, new RNG(`${world.config.seed}:политические-общины:${world.year}:${world.month}`), indexes, { allowTransitions: world.month === 1 || world.month === 7, elapsedMonths: monthStep }));

  // Смерти и архивирование могут оставить заведение без владельца уже после экономического хода.
  ensureEstablishmentOwners(world, indexes);
  if (!fastForward || world.month === 1) runPhase(engine, 'Очистка исчерпанных предметов', onPhase, () => pruneEmptyMaterialItems(world, indexes));
  if (world.month === 1) runPhase(engine, 'Уплотнение индексов и очередей', onPhase, () => {
    invalidateMaterialRuntime(world);
    refreshDynamicWorldIndexes(indexes, world);
  });

  synchronizeSettlementGovernmentLeaders(world, indexes);
  synchronizeStateMachineReferences(world, new RNG(`${world.config.seed}:state-references:${world.year}:${world.month}`), indexes);
  synchronizeEmploymentLinks(world, indexes);
  synchronizeSettlementPopulation(engine);
  if (!options.deferCitySimulation) advanceCitySimulation(world);
  engine.processedTasks += schedule.processedTasks;
  return schedule.processedTasks;
}

export interface WorldSystemEngineOptions {
  primeDailyLife?: boolean;
}

export interface WorldSystemAdvanceOptions {
  fastForward?: boolean;
  monthStep?: number;
  forceCharacterIds?: readonly number[];
  onPhase?: (phase: string) => void;
}

export function initializeWorldSystems(world: WorldState): void {
  initializeDailyLife(world);
  initializeDynastyLegacy(world);
  initializeClimateSystem(world);
  initializeRaceDemography(world);
  synchronizeEmploymentLinks(world);
  initializeCivilizationSystem(world);
  initializeSettlementLifecycle(world);
  initializeStateFormation(world);
  initializeCitySimulation(world);
}

export function createWorldSystemEngine(
  world: WorldState,
  options: WorldSystemEngineOptions = {},
): SimulationEngine {
  initializeWorldSystems(world);
  const engine = createSimulationEngine(world);
  if (options.primeDailyLife) {
    advanceDailyLife(
      world,
      new RNG(`${world.config.seed}:повседневность:${world.year}:${world.month}`),
      engine.indexes,
      { recordEvents: false },
    );
  }
  synchronizeSettlementPopulation(engine);
  return engine;
}

export function advanceWorldSystems(
  engine: SimulationEngine,
  options: WorldSystemAdvanceOptions = {},
): number {
  const fastForward = Boolean(options.fastForward);
  const monthStep = Math.max(1, Math.min(3, Math.floor(options.monthStep ?? 1)));
  const onPhase = options.onPhase;

  advanceOneMonth(engine, onPhase, { fastForward, monthStep, deferCitySimulation: true });

  onPhase?.('Климат, сезоны и природное давление');
  advanceClimateSystem(engine.world, { elapsedMonths: monthStep });

  onPhase?.('Население, семьи и переселения');
  advanceRaceDemography(engine.world, { elapsedMonths: monthStep, indexes: engine.indexes });

  onPhase?.('Повседневная жизнь жителей');
  advanceDailyLife(
    engine.world,
    new RNG(`${engine.world.config.seed}:повседневность:${engine.world.year}:${engine.world.month}`),
    engine.indexes,
    {
      elapsedMonths: monthStep,
      forceCharacterIds: [...new Set(options.forceCharacterIds ?? [])],
    },
  );

  onPhase?.('Династии, поколения и наследие');
  advanceDynastyLegacy(engine.world, { elapsedMonths: monthStep });

  synchronizeSettlementGovernmentLeaders(engine.world, engine.indexes);
  synchronizeStateMachineReferences(engine.world, new RNG(`${engine.world.config.seed}:state-references:${engine.world.year}:${engine.world.month}`), engine.indexes);
  synchronizeEmploymentLinks(engine.world, engine.indexes);
  synchronizeSettlementPopulation(engine);

  onPhase?.('Городской источник истины, распределение и проекты');
  advanceCitySimulation(engine.world);

  onPhase?.('Физические интерьеры, сон и износ мебели');
  applyInteriorMonthlyEffects(engine.world, monthStep);
  return monthStep;
}

export function advanceWorldUnified(source: WorldState, months = 1): WorldState {
  const world = structuredClone(source);
  const engine = createWorldSystemEngine(world);
  const totalMonths = Math.max(0, Math.floor(months));
  const fastForward = totalMonths >= 12;
  let completed = 0;
  while (completed < totalMonths) {
    const monthStep = fastForward ? Math.min(totalMonths - completed, monthsToNextQuarter(engine.world.month)) : 1;
    advanceWorldSystems(engine, { fastForward, monthStep });
    completed += monthStep;
  }
  return world;
}

export function advanceWorld(source: WorldState, months = 1): WorldState {
  return advanceWorldUnified(source, months);
}

function synchronizeSettlementPopulation(engine: SimulationEngine): void {
  const livingBySettlement = new Map<number, number>();
  for (const character of engine.world.characters) {
    if (!character.alive) continue;
    livingBySettlement.set(character.settlementId, (livingBySettlement.get(character.settlementId) ?? 0) + 1);
  }
  for (const settlement of engine.world.settlements) settlement.population = livingBySettlement.get(settlement.id) ?? 0;
}

export function monthsToNextQuarter(month: number): number {
  for (const anchor of [1, 4, 7, 10]) if (anchor > month) return anchor - month;
  return 13 - month;
}
