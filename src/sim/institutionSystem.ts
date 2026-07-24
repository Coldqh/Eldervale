import type { BuildingType, Character, DecisionOptionScore, Settlement, WorldState } from '../types';
import type { InstitutionDecision, InstitutionDecisionKind, InstitutionKind } from '../institutionTypes';
import type { PoliticalCommunity } from '../stateFormationTypes';
import type { TechnologyDefinition } from '../civilizationTypes';
import type { TradeContract } from '../regionalEconomyTypes';
import { appendCausalEvent } from './causality';
import {
  approveCityProjectRequest,
  deferCityProjectRequest,
  rejectCityProjectRequest,
} from './cityProjects';
import { chooseBestOption, decisionKnowledge, linkDecisionToEvent, recordDecision, recordStateDelta } from './decisionCore';
import { ensureCharacterMind, scoreMotivatedAction } from './mindSystem';
import { worldTick } from './scheduler';
import { RNG } from './rng';
import { transferMoney } from './financialSystem';

interface InstitutionProposalInput {
  kind: InstitutionDecisionKind;
  proposalKey: string;
  institutionKind: InstitutionKind;
  institutionId: number;
  actorCharacterId: number;
  settlementId?: number;
  kingdomId?: number;
  communityId?: number;
  cityRequestId?: string;
  tradeContractId?: number;
  technologyId?: string;
  goal: string;
  options: DecisionOptionScore[];
  supporterCharacterIds?: number[];
  opponentCharacterIds?: number[];
  reservedMoney?: number;
  reservedItemIds?: number[];
}

export function initializeInstitutionSystem(world: WorldState): void {
  world.institutionDecisions ??= [];
  world.nextIds ??= {};
  world.nextIds.institutionDecision ??= Math.max(0, ...world.institutionDecisions.map(item => item.id)) + 1;
  migrateLegacyInstitutionDecisions(world);
  reconcileInstitutionActors(world);
  world.simulation.institutionSystemVersion = 1;
}

export function advanceInstitutionSystem(world: WorldState, rng = new RNG(`${world.config.seed}:живые-институты:${world.year}:${world.month}`)): void {
  if (world.simulation.institutionSystemVersion !== 1) initializeInstitutionSystem(world);
  reconcileInstitutionActors(world);
  reconcileTradeRepresentatives(world);
  advanceCityCouncils(world, rng);
  advanceTradeNegotiations(world, rng);
  trimInstitutionHistory(world);
}

export function reconcileInstitutionReferences(world: WorldState): void {
  if (world.simulation.institutionSystemVersion !== 1) initializeInstitutionSystem(world);
  reconcileInstitutionActors(world);
  reconcileTradeRepresentatives(world);
}

export function authorizeTechnologyResearch(
  world: WorldState,
  civilizationId: number,
  settlement: Settlement,
  technology: TechnologyDefinition,
  actor: Character,
  availableInnovation: number,
): InstitutionDecision {
  initializeInstitutionSystem(world);
  const proposalKey = `technology:${civilizationId}:${technology.id}:${world.year}`;
  const existing = latestDecision(world, 'technology-research', proposalKey);
  if (existing) return existing;
  const localPractitioners = world.characters
    .filter(character => character.alive && character.settlementId === settlement.id && character.id !== actor.id && character.age >= 14)
    .sort((a, b) => researchSupportScore(b, technology) - researchSupportScore(a, technology) || a.id - b.id)
    .slice(0, 8);
  const mind = ensureCharacterMind(world, actor);
  const materialAccess = technology.requirements?.requiredResourceIds?.every(id => settlementHasMaterial(world, settlement.id, id)) ?? true;
  const institutionSupport = world.buildings.filter(building => building.settlementId === settlement.id && building.condition > 0
    && ['school', 'guildhall', 'temple', 'blacksmith', 'toolmaker', 'healer', 'mill'].includes(building.type)).length;
  const attempt = scoreMotivatedAction(world, actor, {
    id: 'attempt', label: `Провести опыт: ${technology.name}`,
    base: Math.min(55, availableInnovation * 2.2) + institutionSupport * 5,
    wealthGain: technology.category === 'ремесло' || technology.category === 'строительство' ? 18 : 6,
    powerGain: technology.category === 'управление' || technology.category === 'военное дело' ? 12 : 2,
    socialApproval: 14 + localPractitioners.length * 2,
    risk: materialAccess ? 14 : 58,
    blockedReason: materialAccess ? undefined : 'нет требуемого сырья для воспроизводимого опыта',
  });
  const defer = scoreMotivatedAction(world, actor, {
    id: 'defer', label: 'Отложить опыт', base: 28 + Math.max(0, 18 - availableInnovation),
    orderBenefit: 8, risk: 2,
  });
  const abandon = scoreMotivatedAction(world, actor, {
    id: 'abandon', label: 'Отказаться от направления', base: 8,
    orderBenefit: materialAccess ? -4 : 18, socialApproval: -6,
  });
  // Текущие страх, терпение и амбиция меняют выбор, но не дают технологии сами по себе.
  attempt.utility += mind.traits.ambition * .15 + mind.traits.patience * .08 - mind.emotions.fear * .05;
  const supporters = localPractitioners.filter(character => researchSupportScore(character, technology) >= 44).map(item => item.id);
  const opponents = localPractitioners.filter(character => researchSupportScore(character, technology) < 24).map(item => item.id);
  const decision = createInstitutionDecision(world, {
    kind: 'technology-research', proposalKey, institutionKind: 'workshop-circle', institutionId: settlement.id,
    actorCharacterId: actor.id, settlementId: settlement.id, kingdomId: settlement.kingdomId, technologyId: technology.id,
    goal: `проверить и закрепить практику «${technology.name}»`, options: [attempt, defer, abandon],
    supporterCharacterIds: supporters, opponentCharacterIds: opponents,
  });
  const chosen = chooseBestOption(decision.optionScores);
  resolveInstitutionDecision(world, decision, chosen.id,
    chosen.id === 'attempt' ? 'мастер и местные помощники согласились провести воспроизводимый опыт'
      : chosen.id === 'defer' ? 'опыт отложен до появления сырья, времени или поддержки'
        : 'местные мастера отказались тратить ресурсы на это направление');
  return decision;
}

export function authorizeStateFoundation(
  world: WorldState,
  community: PoliticalCommunity,
  leader: Character,
  settlements: Settlement[],
): InstitutionDecision {
  initializeInstitutionSystem(world);
  const proposalKey = `state:${community.id}:${world.year}:${Math.floor((world.month - 1) / 3)}`;
  const existing = latestDecision(world, 'state-foundation', proposalKey);
  if (existing) return existing;
  const residents = world.characters.filter(character => character.alive && settlements.some(settlement => settlement.id === character.settlementId));
  const delegates = uniqueCharacters([
    ...settlements.map(settlement => world.settlementGovernments.find(item => item.settlementId === settlement.id)?.leaderCharacterId),
    ...settlements.flatMap(settlement => world.settlementGovernments.find(item => item.settlementId === settlement.id)?.councilCharacterIds ?? []),
  ].map(id => id ? world.characters.find(character => character.id === id && character.alive) : undefined).filter((item): item is Character => Boolean(item)))
    .filter(character => character.id !== leader.id).slice(0, 14);
  const population = residents.length;
  const minimumTreasury = Math.max(18, Math.ceil(population * .18));
  const minimumSupport = Math.max(4, Math.ceil(population * .08));
  const canFund = community.treasury >= minimumTreasury;
  const canDefend = community.militarySupport >= minimumSupport;
  const establish = scoreMotivatedAction(world, leader, {
    id: 'establish', label: 'Провозгласить государство',
    base: community.legitimacy * .38 + community.authority * .3 + community.cohesion * .22,
    powerGain: 34, orderBenefit: 18, freedomBenefit: 22,
    risk: 42 + Number(!canFund) * 35 + Number(!canDefend) * 28,
    blockedReason: !canFund ? `община не собрала ${minimumTreasury} крон` : !canDefend ? `нет поддержки хотя бы ${minimumSupport} ополченцев` : undefined,
  });
  const confederate = scoreMotivatedAction(world, leader, {
    id: 'confederate', label: 'Остаться союзом общин', base: 38 + community.cohesion * .16,
    freedomBenefit: 20, orderBenefit: 8, risk: 8,
  });
  const submit = scoreMotivatedAction(world, leader, {
    id: 'submit', label: 'Вернуться под прежнюю власть', base: 12 + Math.max(0, 40 - community.legitimacy) * .4,
    orderBenefit: 22, risk: Math.max(0, 55 - community.militarySupport), freedomBenefit: -28,
  });
  const supporters = delegates.filter(character => delegateStateSupport(world, character, community) >= 46).map(item => item.id);
  const opponents = delegates.filter(character => delegateStateSupport(world, character, community) < 30).map(item => item.id);
  establish.utility += supporters.length * 4 - opponents.length * 5;
  const decision = createInstitutionDecision(world, {
    kind: 'state-foundation', proposalKey, institutionKind: 'political-community', institutionId: community.id,
    actorCharacterId: leader.id, settlementId: settlements[0]?.id, kingdomId: community.currentKingdomId, communityId: community.id,
    goal: 'создать власть, способную собирать средства, удерживать землю и отвечать за решения',
    options: [establish, confederate, submit], supporterCharacterIds: supporters, opponentCharacterIds: opponents,
    reservedMoney: canFund ? minimumTreasury : 0,
  });
  const chosen = chooseBestOption(decision.optionScores);
  resolveInstitutionDecision(world, decision, chosen.id,
    chosen.id === 'establish' ? 'делегаты поддержали создание постоянной власти'
      : chosen.id === 'confederate' ? 'общины сохранили самостоятельность и отложили создание государства'
        : 'часть общин предпочла восстановить прежнюю политическую связь');
  return decision;
}

export function markInstitutionDecisionExecuted(world: WorldState, decisionId: number | undefined, result: string): void {
  if (!decisionId) return;
  const decision = world.institutionDecisions.find(item => item.id === decisionId);
  if (!decision) return;
  decision.status = 'executed';
  decision.resolvedTick ??= worldTick(world);
  decision.result = result;
  decision.history.push(result);
}

export function markInstitutionDecisionFailed(world: WorldState, decisionId: number | undefined, result: string): void {
  if (!decisionId) return;
  const decision = world.institutionDecisions.find(item => item.id === decisionId);
  if (!decision) return;
  decision.status = 'failed';
  decision.resolvedTick = worldTick(world);
  decision.result = result;
  decision.history.push(result);
}

export function institutionDecisionIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const ids = new Set<number>();
  const characterIds = new Set(world.characters.filter(item => item.alive).map(item => item.id));
  const settlementIds = new Set(world.settlements.map(item => item.id));
  const contractIds = new Set(world.tradeContracts.map(item => item.id));
  for (const decision of world.institutionDecisions ?? []) {
    if (ids.has(decision.id)) issues.push(`Институциональное решение ${decision.id}: повтор идентификатора`);
    ids.add(decision.id);
    if (!characterIds.has(decision.actorCharacterId) && ['proposed', 'deliberating', 'deferred'].includes(decision.status)) issues.push(`Институциональное решение ${decision.id}: незавершённое решение потеряло инициатора`);
    if (decision.settlementId && !settlementIds.has(decision.settlementId)) issues.push(`Институциональное решение ${decision.id}: отсутствует поселение`);
    if (decision.tradeContractId && !contractIds.has(decision.tradeContractId)) issues.push(`Институциональное решение ${decision.id}: отсутствует торговый договор`);
    if (decision.chosenOptionId && !decision.optionScores.some(item => item.id === decision.chosenOptionId)) issues.push(`Институциональное решение ${decision.id}: выбран неизвестный вариант`);
    if (decision.reservedMoney < -.001) issues.push(`Институциональное решение ${decision.id}: отрицательный резерв денег`);
    if (new Set(decision.supporterCharacterIds).size !== decision.supporterCharacterIds.length) issues.push(`Институциональное решение ${decision.id}: повтор сторонника`);
    if (decision.supporterCharacterIds.some(id => decision.opponentCharacterIds.includes(id))) issues.push(`Институциональное решение ${decision.id}: человек одновременно сторонник и противник`);
  }
  for (const contract of world.tradeContracts) {
    if (contract.status !== 'active') continue;
    if (!contract.institutionDecisionId) issues.push(`Торговый договор ${contract.id}: активен без решения участников`);
    const seller = world.characters.find(character => character.id === contract.sellerRepresentativeId && character.alive);
    const buyer = world.characters.find(character => character.id === contract.buyerRepresentativeId && character.alive);
    if (!seller || seller.settlementId !== contract.fromSettlementId) issues.push(`Торговый договор ${contract.id}: отсутствует действующий представитель продавца`);
    if (!buyer || buyer.settlementId !== contract.toSettlementId) issues.push(`Торговый договор ${contract.id}: отсутствует действующий представитель покупателя`);
  }
  for (const urban of world.urbanStates) {
    for (const request of urban.projectQueue) if (['approved', 'started', 'completed'].includes(request.status) && !request.institutionDecisionId) {
      issues.push(`Городской проект ${request.id}: исполняется без решения местной власти`);
    }
  }
  return [...new Set(issues)];
}



function reconcileInstitutionActors(world: WorldState): void {
  const living = new Set(world.characters.filter(character => character.alive).map(character => character.id));
  for (const decision of world.institutionDecisions ?? []) {
    if (!['proposed', 'deliberating', 'deferred'].includes(decision.status) || living.has(decision.actorCharacterId)) continue;
    decision.status = 'cancelled';
    decision.resolvedTick = worldTick(world);
    decision.result = 'инициатор умер или выбыл до завершения решения';
    decision.history.push('Решение закрыто: инициатор умер или выбыл; институт должен рассмотреть вопрос заново.');
    if (decision.cityRequestId) {
      for (const urban of world.urbanStates ?? []) {
        const request = urban.projectQueue.find(item => item.id === decision.cityRequestId);
        if (request?.institutionDecisionId === decision.id && ['requested', 'blocked'].includes(request.status)) request.institutionDecisionId = undefined;
      }
    }
    if (decision.tradeContractId) {
      const contract = world.tradeContracts.find(item => item.id === decision.tradeContractId);
      if (contract?.institutionDecisionId === decision.id && ['proposed', 'suspended'].includes(contract.status)) contract.institutionDecisionId = undefined;
    }
  }
}

function reconcileTradeRepresentatives(world: WorldState): void {
  for (const contract of world.tradeContracts ?? []) {
    if (!['active', 'suspended'].includes(contract.status)) continue;
    const seller = contract.sellerRepresentativeId
      ? world.characters.find(character => character.id === contract.sellerRepresentativeId && character.alive && character.settlementId === contract.fromSettlementId)
      : undefined;
    const buyer = contract.buyerRepresentativeId
      ? world.characters.find(character => character.id === contract.buyerRepresentativeId && character.alive && character.settlementId === contract.toSettlementId)
      : undefined;
    if (seller && buyer) continue;
    const route = world.tradeRoutes.find(item => item.id === contract.routeId);
    contract.status = route?.active && route.safety >= 18 ? 'proposed' : 'suspended';
    contract.cause = 'один из ответственных участников умер, уехал или потерял полномочия';
    contract.institutionDecisionId = undefined;
    contract.brokerCharacterId = undefined;
    contract.sellerRepresentativeId = undefined;
    contract.buyerRepresentativeId = undefined;
    contract.history.push('Договор требует новых переговоров: прежние представители больше не могут отвечать за обязательства.');
  }
}

function migrateLegacyInstitutionDecisions(world: WorldState): void {
  const tick = worldTick(world);
  for (const urban of world.urbanStates ?? []) {
    const government = world.settlementGovernments.find(item => item.settlementId === urban.settlementId);
    const actor = government ? world.characters.find(item => item.id === government.leaderCharacterId && item.alive) : undefined;
    if (!government || !actor) continue;
    for (const request of urban.projectQueue) {
      if (request.institutionDecisionId || !['approved', 'started', 'completed'].includes(request.status)) continue;
      const decision: InstitutionDecision = {
        id: world.nextIds.institutionDecision++, kind: 'city-project', proposalKey: `legacy-city:${request.id}`,
        institutionKind: 'settlement-government', institutionId: government.id, actorCharacterId: actor.id,
        settlementId: urban.settlementId, kingdomId: world.settlements.find(item => item.id === urban.settlementId)?.kingdomId,
        cityRequestId: request.id, knownFactIds: decisionKnowledge(world, { kind: 'character', id: actor.id }),
        goal: `сохранить ранее принятое решение по проекту ${request.requestedBuildingType}`,
        optionScores: [{ id: 'approve', label: 'Сохранить принятое решение', utility: 100, factors: { migration: 100 } }],
        chosenOptionId: 'approve', supporterCharacterIds: [], opponentCharacterIds: [], reservedMoney: request.reservedMoney ?? 0,
        reservedItemIds: [], status: request.status === 'completed' ? 'executed' : 'approved', createdTick: tick, resolvedTick: tick,
        result: 'Решение существовало до введения журнала живых институтов.', history: ['Миграция сохранила действующий проект и назначила ему реального руководителя местной власти.'],
      };
      world.institutionDecisions.push(decision);
      request.institutionDecisionId = decision.id;
    }
  }
  for (const contract of world.tradeContracts ?? []) {
    if (contract.institutionDecisionId || !['active', 'suspended'].includes(contract.status)) continue;
    const seller = tradeRepresentative(world, contract.fromSettlementId, contract.templateId, true);
    const buyer = tradeRepresentative(world, contract.toSettlementId, contract.templateId, false);
    const actor = seller ?? buyer;
    if (!actor) {
      contract.status = 'proposed';
      contract.cause = 'после миграции требуется найти ответственных участников';
      continue;
    }
    const decision: InstitutionDecision = {
      id: world.nextIds.institutionDecision++, kind: 'trade-contract', proposalKey: `legacy-trade:${contract.id}`,
      institutionKind: 'merchant-consortium', institutionId: contract.routeId, actorCharacterId: actor.id,
      settlementId: contract.fromSettlementId, kingdomId: world.settlements.find(item => item.id === contract.fromSettlementId)?.kingdomId,
      tradeContractId: contract.id, knownFactIds: decisionKnowledge(world, { kind: 'character', id: actor.id }),
      goal: `сохранить действующий договор по товару ${contract.templateId}`,
      optionScores: [{ id: 'sign', label: 'Подтвердить существующий договор', utility: 100, factors: { migration: 100 } }],
      chosenOptionId: 'sign', supporterCharacterIds: [seller?.id, buyer?.id].filter((id): id is number => Boolean(id) && id !== actor.id),
      opponentCharacterIds: [], reservedMoney: 0, reservedItemIds: [], status: contract.status === 'active' ? 'executed' : 'approved',
      createdTick: tick, resolvedTick: tick, result: 'Договор подтверждён участниками при миграции.',
      history: ['Миграция связала старый договор с живыми представителями продавца и покупателя.'],
    };
    world.institutionDecisions.push(decision);
    contract.institutionDecisionId = decision.id;
    contract.sellerRepresentativeId = seller?.id;
    contract.buyerRepresentativeId = buyer?.id;
    contract.brokerCharacterId = actor.id;
  }
}

function advanceCityCouncils(world: WorldState, rng: RNG): void {
  const tick = worldTick(world);
  for (const settlement of world.settlements) {
    const government = world.settlementGovernments.find(item => item.settlementId === settlement.id);
    const urban = world.urbanStates.find(item => item.settlementId === settlement.id);
    if (!government || !urban) continue;
    const actor = world.characters.find(item => item.id === government.leaderCharacterId && item.alive && item.settlementId === settlement.id);
    if (!actor) continue;
    const candidates = urban.projectQueue
      .filter(request => request.status === 'requested' && (!request.nextReviewTick || request.nextReviewTick <= tick))
      .sort((a, b) => politicalProjectScore(world, settlement, government.corruption, actor, b.requestedBuildingType, b.priority)
        - politicalProjectScore(world, settlement, government.corruption, actor, a.requestedBuildingType, a.priority)
        || a.requestedTick - b.requestedTick);
    const request = candidates[0];
    if (!request) continue;
    const proposalKey = `city:${request.id}:${request.updatedTick}`;
    if (latestDecision(world, 'city-project', proposalKey)) continue;
    const reserve = cityPlanningReserve(request.requestedBuildingType);
    const council = government.councilCharacterIds
      .map(id => world.characters.find(character => character.id === id && character.alive && character.settlementId === settlement.id))
      .filter((item): item is Character => Boolean(item));
    const supporters = council.filter(member => councilProjectSupport(world, member, request.requestedBuildingType, request.priority, government.corruption) >= 45).map(item => item.id);
    const opponents = council.filter(member => councilProjectSupport(world, member, request.requestedBuildingType, request.priority, government.corruption) < 28).map(item => item.id);
    const affordable = government.treasury + .0001 >= reserve;
    const approve = scoreMotivatedAction(world, actor, {
      id: 'approve', label: 'Одобрить проект', base: request.priority + supporters.length * 4 - opponents.length * 4,
      orderBenefit: 20, familyBenefit: ['house', 'tenement', 'shelter', 'school'].includes(request.requestedBuildingType) ? 18 : 2,
      wealthGain: ['market', 'bathhouse', 'warehouse'].includes(request.requestedBuildingType) ? 10 + government.corruption * .18 : 2,
      risk: affordable ? 10 : 75,
      blockedReason: affordable ? undefined : `в казне нет ${reserve} крон на подготовку`,
    });
    const defer = scoreMotivatedAction(world, actor, {
      id: 'defer', label: 'Отложить решение', base: 32 + Number(!affordable) * 35 + opponents.length * 3,
      orderBenefit: 8, risk: Math.max(2, request.priority * .08),
    });
    const reject = scoreMotivatedAction(world, actor, {
      id: 'reject', label: 'Отклонить проект', base: 12 + Math.max(0, 42 - request.priority) + government.corruption * .12,
      wealthGain: government.corruption > 55 && !['market', 'bathhouse'].includes(request.requestedBuildingType) ? 12 : 0,
      socialApproval: -Math.min(30, request.priority * .22),
    });
    const decision = createInstitutionDecision(world, {
      kind: 'city-project', proposalKey, institutionKind: 'settlement-government', institutionId: government.id,
      actorCharacterId: actor.id, settlementId: settlement.id, kingdomId: settlement.kingdomId, cityRequestId: request.id,
      goal: `решить, тратить ли городские ресурсы на «${request.requestedBuildingType}»`, options: [approve, defer, reject],
      supporterCharacterIds: supporters, opponentCharacterIds: opponents, reservedMoney: affordable ? reserve : 0,
    });
    const chosen = chooseBestOption(decision.optionScores);
    if (chosen.id === 'approve' && affordable) {
      const reservation = transferMoney(world, {
        payer: { kind: 'settlementGovernment', id: government.id },
        amount: reserve,
        kind: 'maintenance',
        purpose: `подготовительный резерв проекта ${request.requestedBuildingType}`,
        settlementId: settlement.id,
        kingdomId: settlement.kingdomId,
      });
      if (reservation.paid + .0001 < reserve) {
        deferCityProjectRequest(world, request.id, 'казна не смогла провести денежный резерв', tick + 3, decision.id);
        resolveInstitutionDecision(world, decision, 'defer', 'платёж резерва не прошёл');
        continue;
      }
      approveCityProjectRequest(world, request.id, `${actor.name} и совет одобрили проект; за подготовку зарезервировано ${reserve} крон.`, decision.id, reserve);
      resolveInstitutionDecision(world, decision, 'approve', `проект одобрен голосами ${supporters.length + 1} участников`);
      government.activeDecision = `исполнение решения по проекту ${request.requestedBuildingType}`;
      const event = appendCausalEvent(world, {
        kind: 'civic', title: `${settlement.name}: принято решение о проекте`,
        description: `${actor.name} вынес на совет проект «${request.requestedBuildingType}».`,
        cause: request.reason, conditions: [`сторонников: ${supporters.length}`, `противников: ${opponents.length}`, `резерв: ${reserve} крон`],
        decision: 'местная власть одобрила расход и передала проект строителям', outcome: 'проект получил политическое разрешение и денежный резерв',
        consequences: ['стройка ещё может сорваться из-за земли, материалов или работников'],
        entityRefs: [{ kind: 'settlement', id: settlement.id }, { kind: 'settlementGovernment', id: government.id }, { kind: 'character', id: actor.id }], importance: 2,
      });
      linkDecisionToEvent(world, decision.decisionRecordId, event);
    } else if (chosen.id === 'reject') {
      rejectCityProjectRequest(world, request.id, `${actor.name} и совет не поддержали расход`, decision.id);
      resolveInstitutionDecision(world, decision, 'reject', 'предложение отклонено местной властью');
    } else {
      const delay = 3 + rng.int(0, 6);
      deferCityProjectRequest(world, request.id, affordable ? 'совет не собрал достаточной поддержки' : `казна не собрала ${reserve} крон`, tick + delay, decision.id);
      decision.nextReviewTick = tick + delay;
      resolveInstitutionDecision(world, decision, 'defer', `решение отложено на ${delay} месяцев`);
    }
  }
}

function advanceTradeNegotiations(world: WorldState, _rng: RNG): void {
  for (const contract of world.tradeContracts.filter(item => item.status === 'proposed')) {
    const proposalKey = `trade:${contract.id}:${Math.floor(worldTick(world) / 3)}`;
    const existing = latestDecision(world, 'trade-contract', proposalKey);
    if (existing) {
      if (existing.status === 'approved') contract.status = 'active';
      else if (existing.status === 'rejected') contract.status = 'rejected';
      continue;
    }
    const route = world.tradeRoutes.find(item => item.id === contract.routeId);
    const seller = tradeRepresentative(world, contract.fromSettlementId, contract.templateId, true);
    const buyer = tradeRepresentative(world, contract.toSettlementId, contract.templateId, false);
    contract.sellerRepresentativeId = seller?.id;
    contract.buyerRepresentativeId = buyer?.id;
    contract.brokerCharacterId = seller?.profession === 'merchant' ? seller.id : buyer?.profession === 'merchant' ? buyer.id : seller?.id;
    const actor = seller ?? buyer;
    if (!actor) {
      contract.status = 'rejected';
      contract.disruptedSinceTick = worldTick(world);
      contract.cause = 'не найден человек, готовый отвечать за сделку';
      contract.history.push('Предложение закрыто: у сделки нет ответственного участника.');
      continue;
    }
    const buyerBusiness = world.establishments.find(item => item.ownerCharacterId === buyer?.id && item.settlementId === contract.toSettlementId && item.active)
      ?? world.establishments.find(item => item.settlementId === contract.toSettlementId && item.active && ['рынок', 'лавка', 'склад'].includes(item.type));
    const expectedCommitment = Math.max(1, Math.min(contract.maxUnitPrice * contract.targetQuantity, buyerBusiness?.cash ?? 0));
    const routeOpen = Boolean(route?.active && route.safety >= 18);
    const sign = scoreMotivatedAction(world, actor, {
      id: 'sign', label: 'Заключить договор', base: contract.priority + Number(routeOpen) * 18,
      wealthGain: 26, socialApproval: 8, risk: routeOpen ? Math.max(5, 50 - (route?.safety ?? 0)) : 70,
      blockedReason: !seller || !buyer ? 'у сделки нет обеих ответственных сторон' : !routeOpen ? 'путь закрыт или слишком опасен' : expectedCommitment < 1 ? 'покупатель не имеет оборотных средств' : undefined,
    });
    const renegotiate = scoreMotivatedAction(world, actor, {
      id: 'renegotiate', label: 'Потребовать другие условия', base: 34 + Math.max(0, 30 - (route?.safety ?? 0)),
      wealthGain: 12, risk: 8,
    });
    const reject = scoreMotivatedAction(world, actor, {
      id: 'reject', label: 'Отказаться от сделки', base: 18 + Number(!routeOpen) * 32,
      orderBenefit: 8, risk: 1,
    });
    const supporters = [seller, buyer].filter((item): item is Character => Boolean(item)).map(item => item.id);
    const decision = createInstitutionDecision(world, {
      kind: 'trade-contract', proposalKey, institutionKind: 'merchant-consortium', institutionId: contract.routeId,
      actorCharacterId: actor.id, settlementId: contract.fromSettlementId, kingdomId: world.settlements.find(item => item.id === contract.fromSettlementId)?.kingdomId,
      tradeContractId: contract.id, goal: `договориться о поставке товара ${contract.templateId}`,
      options: [sign, renegotiate, reject], supporterCharacterIds: supporters, reservedMoney: expectedCommitment,
    });
    contract.institutionDecisionId = decision.id;
    const chosen = chooseBestOption(decision.optionScores);
    if (chosen.id === 'sign' && !chosen.blockedReason) {
      contract.status = 'active';
      contract.cause = undefined;
      contract.history.push(`${actor.name} принял условия от имени участников сделки.`);
      resolveInstitutionDecision(world, decision, 'sign', 'ответственные продавец и покупатель приняли условия');
    } else if (chosen.id === 'renegotiate') {
      contract.maxUnitPrice *= .92;
      contract.targetQuantity *= .82;
      contract.status = routeOpen ? 'proposed' : 'suspended';
      contract.cause = 'стороны потребовали пересмотра цены и объёма';
      decision.nextReviewTick = worldTick(world) + 3;
      resolveInstitutionDecision(world, decision, 'renegotiate', 'условия возвращены на переговоры');
    } else {
      contract.status = 'rejected';
      contract.disruptedSinceTick = worldTick(world);
      contract.cause = chosen.blockedReason ?? 'ответственный участник отказался от сделки';
      contract.history.push(`Договор отклонён: ${contract.cause}.`);
      resolveInstitutionDecision(world, decision, 'reject', contract.cause);
    }
  }
}

function createInstitutionDecision(world: WorldState, input: InstitutionProposalInput): InstitutionDecision {
  const decision: InstitutionDecision = {
    id: world.nextIds.institutionDecision++, kind: input.kind, proposalKey: input.proposalKey,
    institutionKind: input.institutionKind, institutionId: input.institutionId, actorCharacterId: input.actorCharacterId,
    settlementId: input.settlementId, kingdomId: input.kingdomId, communityId: input.communityId,
    cityRequestId: input.cityRequestId, tradeContractId: input.tradeContractId, technologyId: input.technologyId,
    knownFactIds: decisionKnowledge(world, { kind: 'character', id: input.actorCharacterId }),
    goal: input.goal, optionScores: input.options.map(option => ({ ...option, factors: { ...option.factors } })),
    supporterCharacterIds: [...new Set(input.supporterCharacterIds ?? [])].filter(id => id !== input.actorCharacterId),
    opponentCharacterIds: [...new Set(input.opponentCharacterIds ?? [])].filter(id => id !== input.actorCharacterId),
    reservedMoney: Math.max(0, input.reservedMoney ?? 0), reservedItemIds: [...new Set(input.reservedItemIds ?? [])],
    status: 'deliberating', createdTick: worldTick(world), history: [`Предложение внесено: ${input.goal}.`],
  };
  world.institutionDecisions.push(decision);
  return decision;
}

function resolveInstitutionDecision(world: WorldState, institution: InstitutionDecision, chosenOptionId: string, result: string): void {
  institution.chosenOptionId = chosenOptionId;
  institution.result = result;
  institution.resolvedTick = worldTick(world);
  institution.status = chosenOptionId === 'reject' || chosenOptionId === 'abandon' || chosenOptionId === 'submit' ? 'rejected'
    : chosenOptionId === 'defer' || chosenOptionId === 'renegotiate' || chosenOptionId === 'confederate' ? 'deferred'
      : 'approved';
  institution.history.push(result);
  const actorRef = { kind: 'character' as const, id: institution.actorCharacterId };
  const decision = recordDecision(world, {
    actorRef, goal: institution.goal,
    context: `${institution.institutionKind} #${institution.institutionId}; сторонников ${institution.supporterCharacterIds.length}, противников ${institution.opponentCharacterIds.length}`,
    knownFactIds: institution.knownFactIds, options: institution.optionScores, chosenOptionId,
    reason: result, tags: ['institution', institution.kind],
  });
  institution.decisionRecordId = decision.id;
  recordStateDelta(world, {
    entityRef: institution.settlementId ? { kind: 'settlement', id: institution.settlementId } : { kind: 'character', id: institution.actorCharacterId }, field: `institutionDecision:${institution.id}:status`, before: 'deliberating', after: institution.status,
    cause: result, decisionId: decision.id,
  });
}

function latestDecision(world: WorldState, kind: InstitutionDecisionKind, proposalKey: string): InstitutionDecision | undefined {
  return [...world.institutionDecisions]
    .filter(item => item.kind === kind && item.proposalKey === proposalKey)
    .sort((a, b) => b.id - a.id)[0];
}

function cityPlanningReserve(type: string): number {
  const expensive = new Set(['castle', 'arsenal', 'tenement', 'manor', 'courthouse', 'prison', 'fireStation', 'school', 'shelter']);
  const medium = new Set(['market', 'warehouse', 'townHall', 'guildhall', 'temple', 'bathhouse', 'barracks']);
  if (type === 'district-expansion') return 0;
  if (expensive.has(type)) return 8;
  if (medium.has(type)) return 5;
  return 3;
}

function politicalProjectScore(world: WorldState, settlement: Settlement, corruption: number, actor: Character, type: string, priority: number): number {
  const mind = ensureCharacterMind(world, actor);
  const publicNeed = ['house', 'tenement', 'shelter', 'school', 'fireStation'].includes(type) ? mind.values.family * .12 + mind.traits.empathy * .1 : 0;
  const privateInterest = ['market', 'bathhouse', 'warehouse'].includes(type) ? corruption * .22 + mind.values.wealth * .08 : 0;
  const defense = ['barracks', 'arsenal', 'watchtower', 'castle'].includes(type) ? settlement.defense * .1 + mind.values.order * .08 : 0;
  return priority + publicNeed + privateInterest + defense;
}

function councilProjectSupport(world: WorldState, member: Character, type: string, priority: number, corruption: number): number {
  const mind = ensureCharacterMind(world, member);
  let score = priority * .55 + mind.values.order * .15 + mind.traits.empathy * .12;
  if (['market', 'warehouse', 'guildhall'].includes(type) && ['merchant', 'scribe'].includes(member.profession)) score += 22 + mind.values.wealth * .12;
  if (['shelter', 'house', 'tenement', 'school'].includes(type)) score += mind.values.family * .16;
  if (['barracks', 'watchtower', 'arsenal'].includes(type) && ['guard', 'soldier'].includes(member.profession)) score += 20;
  if (corruption > 55 && !['market', 'bathhouse', 'warehouse'].includes(type)) score -= corruption * .16;
  return score;
}

function tradeRepresentative(world: WorldState, settlementId: number, templateId: string, seller: boolean): Character | undefined {
  const businesses = world.establishments.filter(item => item.settlementId === settlementId && item.active);
  const ranked = businesses
    .filter(establishment => seller
      ? establishment.inventoryItemIds.some(id => world.items.some(item => item.id === id && item.templateId === templateId && item.quantity > .1))
      : ['рынок', 'лавка', 'склад'].includes(establishment.type))
    .sort((a, b) => b.cash - a.cash || b.reputation - a.reputation || a.id - b.id);
  const owners = ranked.map(item => world.characters.find(character => character.id === item.ownerCharacterId && character.alive)).filter((item): item is Character => Boolean(item));
  return owners.sort((a, b) => Number(b.profession === 'merchant') - Number(a.profession === 'merchant') || b.wealth - a.wealth || a.id - b.id)[0]
    ?? world.characters.filter(item => item.alive && item.settlementId === settlementId && item.profession === 'merchant').sort((a, b) => b.wealth - a.wealth || a.id - b.id)[0];
}

function researchSupportScore(character: Character, technology: TechnologyDefinition): number {
  const relevant = technology.category === 'знания' ? ['scribe', 'priest', 'healer']
    : technology.category === 'земледелие' ? ['farmer', 'miller', 'herbalist']
      : technology.category === 'строительство' ? ['carpenter', 'miner', 'toolmaker']
        : technology.category === 'военное дело' ? ['blacksmith', 'armorer', 'soldier']
          : ['blacksmith', 'carpenter', 'toolmaker', 'weaver', 'brewer', 'merchant'];
  return Number(relevant.includes(character.profession)) * 34 + Math.max(...Object.values(character.skills ?? {}), 0) * .5 + character.renown * .15;
}

function delegateStateSupport(world: WorldState, character: Character, community: PoliticalCommunity): number {
  const mind = ensureCharacterMind(world, character);
  return community.legitimacy * .28 + community.cohesion * .22 + mind.values.freedom * .2 + mind.values.power * .12
    + mind.traits.courage * .08 - mind.emotions.fear * .14;
}

function settlementHasMaterial(world: WorldState, settlementId: number, templateId: string): boolean {
  return world.items.some(item => item.settlementId === settlementId && item.templateId === templateId && item.quantity > .2 && item.condition > 0);
}

function uniqueCharacters(characters: Character[]): Character[] {
  const seen = new Set<number>();
  return characters.filter(character => !seen.has(character.id) && seen.add(character.id));
}

function trimInstitutionHistory(world: WorldState): void {
  if (world.institutionDecisions.length <= 4_000) return;
  const active = world.institutionDecisions.filter(item => ['proposed', 'deliberating', 'approved', 'deferred'].includes(item.status));
  const finished = world.institutionDecisions.filter(item => !active.includes(item)).slice(-2_500);
  world.institutionDecisions = [...finished, ...active].sort((a, b) => a.id - b.id);
}
