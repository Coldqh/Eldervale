import type {
  Army, Character, DiplomaticAgreement, DiplomacyRecord, GovernmentForm, Kingdom, Settlement, WorldState,
} from '../types';
import type {
  PoliticalCommunity, PoliticalCommunityKind, PoliticalCommunityStatus, PoliticalTransition, PoliticalTransitionKind,
} from '../stateFormationTypes';
import type { WorldIndexes } from './indexes';
import { refreshDynamicWorldIndexes } from './indexes';
import { appendCausalEvent } from './causality';
import { initializeCivilizationSystem } from './civilizationSystem';
import { initializeMilitaryInfrastructure } from './militaryInfrastructure';
import { initializePhysicalArmySystem } from './physicalArmy';
import { advanceCitySimulation } from './citySimulation';
import { synchronizeEmploymentLinks } from './livingEconomy';
import { initializeKingdomGovernment } from './stateMachine';
import { controlledCapital, normalizeKingdomCapitals } from './kingdomState';
import { RNG } from './rng';
import { worldTick } from './scheduler';
import { recordKingdomFoundation, transferPoliticalTerritory } from './territory';
import { authorizeStateFoundation, markInstitutionDecisionExecuted } from './institutionSystem';
import { transferMoney } from './financialSystem';

const ACTIVE_COMMUNITY_STATUSES = new Set<PoliticalCommunityStatus>(['integrated', 'frontier', 'autonomous', 'independent', 'organizing-state']);
const STATE_COLORS = ['#774b4b', '#4b6477', '#6d5d3e', '#45654f', '#67517a', '#7a643f', '#536b70', '#6f4f62', '#4f6a47', '#735744'];

export interface StateFormationAdvanceOptions {
  allowTransitions?: boolean;
  elapsedMonths?: number;
  forceTransitions?: boolean;
}

export interface StateFormationResult {
  integrations: number;
  autonomies: number;
  independences: number;
  leagues: number;
  statesFounded: number;
  voluntaryUnions: number;
  collapsedCommunities: number;
  changed: boolean;
}

interface CommunitySnapshot {
  population: number;
  averageProsperity: number;
  averageUnrest: number;
  averageDefense: number;
  distanceFromCapital: number;
  cultureDifference: boolean;
  connectedToCapital: boolean;
  warPressure: number;
  separatistPressure: number;
}

export function initializeStateFormation(world: WorldState): void {
  world.politicalCommunities ??= [];
  world.politicalTransitions ??= [];
  world.nextIds ??= {};
  world.nextIds.politicalCommunity ??= Math.max(0, ...world.politicalCommunities.map(item => item.id)) + 1;
  world.nextIds.politicalTransition ??= Math.max(0, ...world.politicalTransitions.map(item => item.id)) + 1;
  world.nextIds.kingdom ??= Math.max(0, ...world.kingdoms.map(item => item.id)) + 1;
  world.nextIds.army ??= Math.max(0, ...world.armies.map(item => item.id)) + 1;
  world.nextIds.diplomaticAgreement ??= Math.max(0, ...world.diplomaticAgreements.map(item => item.id)) + 1;

  for (const kingdom of world.kingdoms) {
    kingdom.predecessorKingdomIds ??= [];
    kingdom.politicalOrigin ??= 'generated';
  }

  const communityById = new Map(world.politicalCommunities.map(item => [item.id, item]));
  for (const settlement of world.settlements) {
    const existing = settlement.politicalCommunityId ? communityById.get(settlement.politicalCommunityId) : undefined;
    if (existing?.status === 'merged' && existing.successorCommunityId) {
      const successor = communityById.get(existing.successorCommunityId);
      if (successor && !['merged', 'collapsed'].includes(successor.status)) {
        settlement.politicalCommunityId = successor.id;
        if (!successor.settlementIds.includes(settlement.id)) successor.settlementIds.push(settlement.id);
        continue;
      }
    }
    if (existing && (existing.status !== 'collapsed' || settlement.population <= 3)) {
      if (!existing.settlementIds.includes(settlement.id)) existing.settlementIds.push(settlement.id);
      continue;
    }
    const community = createSettlementCommunity(world, settlement);
    world.politicalCommunities.push(community);
    communityById.set(community.id, community);
    settlement.politicalCommunityId = community.id;
  }

  for (const community of world.politicalCommunities) normalizeCommunity(world, community);
  world.simulation.stateFormationVersion = 1;
}

export function advanceStateFormation(
  world: WorldState,
  rng: RNG,
  indexes?: WorldIndexes,
  options: StateFormationAdvanceOptions = {},
): StateFormationResult {
  if (world.simulation.stateFormationVersion !== 1) initializeStateFormation(world);
  const result: StateFormationResult = {
    integrations: 0,
    autonomies: 0,
    independences: 0,
    leagues: 0,
    statesFounded: 0,
    voluntaryUnions: 0,
    collapsedCommunities: 0,
    changed: false,
  };
  const elapsedMonths = Math.max(1, Math.floor(options.elapsedMonths ?? 1));
  const allowTransitions = Boolean(options.allowTransitions);
  const force = Boolean(options.forceTransitions);
  const tick = worldTick(world);

  synchronizeCommunities(world);
  const active = world.politicalCommunities.filter(item => ACTIVE_COMMUNITY_STATUSES.has(item.status)).sort((a, b) => a.id - b.id);
  for (const community of active) {
    const settlements = communitySettlements(world, community);
    if (!settlements.length || settlements.every(settlement => settlement.population <= 3)) {
      collapseCommunity(world, community, 'в общине не осталось жизнеспособных поселений');
      result.collapsedCommunities += 1;
      result.changed = true;
      continue;
    }
    updateCommunityMetrics(world, community, elapsedMonths);
    community.lastAdvancedTick = tick;
    if (!allowTransitions) continue;
    const transition = advanceCommunityStatus(world, community, force);
    if (!transition) continue;
    result.changed = true;
    if (transition === 'integration') result.integrations += 1;
    if (transition === 'autonomy') result.autonomies += 1;
    if (transition === 'independence') result.independences += 1;
  }

  if (allowTransitions && (world.month === 1 || force)) {
    result.leagues += formPoliticalLeagues(world, rng, force);
    result.changed ||= result.leagues > 0;
  }

  if (allowTransitions && (world.month === 1 || world.month === 7 || force)) {
    for (const community of world.politicalCommunities.filter(item => ['independent', 'organizing-state'].includes(item.status)).sort((a, b) => a.id - b.id)) {
      if (community.status === 'independent' && stateReadiness(world, community) >= (force ? 0 : 60)) {
        community.status = 'organizing-state';
        community.history.push(`В ${world.year}.${String(world.month).padStart(2, '0')} совет общины начал собирать постоянную государственную власть.`);
      }
      if (community.status !== 'organizing-state') continue;
      if (!force && stateReadiness(world, community) < 68) continue;
      const founded = foundKingdomFromCommunity(world, community, new RNG(`${world.config.seed}:новое-государство:${community.id}:${world.year}`), indexes);
      if (founded) {
        result.statesFounded += 1;
        result.changed = true;
      }
    }
  }

  if (allowTransitions && (world.month === 7 || force)) {
    const unions = processVoluntaryUnions(world, rng, force, indexes);
    result.voluntaryUnions += unions;
    result.changed ||= unions > 0;
  }

  if (result.changed) {
    initializeCivilizationSystem(world, new RNG(`${world.config.seed}:цивилизации-после-политики:${world.year}:${world.month}`));
    normalizeKingdomCapitals(world);
    if (indexes) refreshDynamicWorldIndexes(indexes, world);
  }
  return result;
}

export function foundKingdomFromCommunity(
  world: WorldState,
  community: PoliticalCommunity,
  rng: RNG,
  indexes?: WorldIndexes,
): Kingdom | undefined {
  initializeStateFormation(world);
  if (community.foundedKingdomId || !['independent', 'organizing-state'].includes(community.status)) return undefined;
  const settlements = communitySettlements(world, community).filter(settlement => settlement.population > 3);
  if (!settlements.length) return undefined;
  const memberIds = new Set(settlements.map(item => item.id));
  const residents = world.characters.filter(character => character.alive && memberIds.has(character.settlementId));
  if (residents.length < 5) return undefined;
  const leader = chooseCommunityLeader(world, community, settlements);
  if (!leader) return undefined;
  const foundingDecision = authorizeStateFoundation(world, community, leader, settlements);
  if (foundingDecision.status !== 'approved' || foundingDecision.chosenOptionId !== 'establish') {
    community.status = foundingDecision.chosenOptionId === 'submit' ? 'autonomous' : 'organizing-state';
    community.history.push(`В ${world.year}.${String(world.month).padStart(2, '0')} государство не было создано: ${foundingDecision.result ?? 'советы не пришли к согласию'}.`);
    return undefined;
  }
  const capital = [...settlements].sort((a, b) => b.population - a.population || b.prosperity - a.prosperity || b.defense - a.defense || a.id - b.id)[0]!;
  const predecessorIds = [...new Set(settlements.map(settlement => settlement.kingdomId))];
  const primaryPredecessor = world.kingdoms.find(item => item.id === community.originKingdomId) ?? world.kingdoms.find(item => predecessorIds.includes(item.id));
  const cultureState = world.settlementCultures.find(item => item.settlementId === capital.id);
  const civilizationId = community.civilizationId ?? capital.civilizationId ?? primaryPredecessor?.civilizationId;
  const species = majoritySpecies(residents);
  const form = governmentFormForCommunity(community, settlements, species);
  const id = world.nextIds.kingdom++;
  const kingdom: Kingdom = {
    id,
    name: uniqueStateName(world, community, capital),
    color: uniqueStateColor(world, id),
    species,
    rulerId: leader.id,
    capitalId: capital.id,
    treasury: Math.max(0, Math.round(community.treasury)),
    armyStrength: 0,
    stability: clamp(Math.round(community.cohesion * .45 + community.legitimacy * .35 + community.authority * .2), 18, 88),
    aggression: clamp(Math.round(25 + community.independencePressure * .28 + rng.int(-10, 12)), 5, 90),
    culture: world.cultures.find(item => item.id === cultureState?.dominantCultureId)?.name ?? primaryPredecessor?.culture ?? 'местная культура',
    religion: world.religions.find(item => item.id === cultureState?.dominantReligionId)?.name ?? primaryPredecessor?.religion ?? 'местная вера',
    cultureId: cultureState?.dominantCultureId ?? primaryPredecessor?.cultureId,
    religionId: cultureState?.dominantReligionId ?? primaryPredecessor?.religionId,
    officialLanguageId: primaryPredecessor?.officialLanguageId,
    foundedYear: world.year,
    enemies: [],
    claims: settlements.map(item => item.id),
    diplomacy: [],
    laws: foundingLaws(form),
    civilizationId,
    foundingCommunityId: community.id,
    predecessorKingdomIds: predecessorIds,
    politicalOrigin: community.kind === 'city-league' || community.kind === 'tribal-confederation' ? 'league' : 'secession',
    foundingGovernmentForm: form,
  };
  community.treasury = 0;
  world.kingdoms.push(kingdom);
  for (const predecessorId of predecessorIds) {
    const predecessor = world.kingdoms.find(item => item.id === predecessorId);
    if (!predecessor) continue;
    predecessor.claims = [...new Set([...predecessor.claims, ...settlements.map(item => item.id)])];
  }

  for (const other of world.kingdoms.filter(item => item.id !== kingdom.id)) initializeDiplomacyPair(kingdom, other, predecessorIds.includes(other.id) ? -38 : sameCivilization(kingdom, other) ? 18 : 0);

  for (const settlement of settlements) {
    const oldKingdomId = settlement.kingdomId;
    settlement.kingdomId = kingdom.id;
    settlement.politicalStatus = 'integrated';
    settlement.claimantKingdomId = oldKingdomId;
    settlement.civilizationId = civilizationId;
    settlement.history.push(`В ${world.year}.${String(world.month).padStart(2, '0')} вошло в новое государство ${kingdom.name} как одна из общин-основателей.`);
    for (const character of world.characters.filter(item => item.alive && item.settlementId === settlement.id)) character.kingdomId = kingdom.id;
  }
  recordKingdomFoundation(world, kingdom, world.month);
  transferPoliticalTerritory(world, settlements.map(item => item.id), predecessorIds, kingdom.id, world.year, world.month, 'политическое отделение');
  updateTradeRouteControl(world, settlements, predecessorIds, kingdom.id);

  leader.kingdomId = kingdom.id;
  leader.titles = [...new Set([...leader.titles, rulerTitle(form)])];
  leader.renown = Math.max(65, leader.renown);
  leader.visualRole = 'king';
  leader.biography.push(`В ${world.year} году возглавил новое государство ${kingdom.name}.`);

  const army = createFoundingArmy(world, kingdom, capital, leader, residents, community.militarySupport, rng);
  detachFoundingSoldiers(world, army.soldierIds);
  world.armies.push(army);
  kingdom.armyStrength = army.strength;
  community.status = 'state-founded';
  community.foundedKingdomId = kingdom.id;
  community.currentKingdomId = kingdom.id;
  community.history.push(`В ${world.year}.${String(world.month).padStart(2, '0')} община оформила государство ${kingdom.name}.`);
  recordTransition(world, 'state-foundation', community, 'местная власть, ополчение и совет общин смогли удержать самостоятельность', `${kingdom.name} признано отдельным государством`, primaryPredecessor?.id, kingdom.id);

  if (indexes) refreshDynamicWorldIndexes(indexes, world);
  initializeKingdomGovernment(world, kingdom, new RNG(`${world.config.seed}:первое-правительство:${kingdom.id}`));
  initializeMilitaryInfrastructure(world, new RNG(`${world.config.seed}:первое-войско:${kingdom.id}`), indexes);
  initializePhysicalArmySystem(world, new RNG(`${world.config.seed}:физическое-войско:${kingdom.id}`), indexes);
  synchronizeEmploymentLinks(world, indexes);
  advanceCitySimulation(world, memberIds);
  maybeCreateTribute(world, kingdom, primaryPredecessor, community, rng);
  markInstitutionDecisionExecuted(world, foundingDecision.id, `Создано государство ${kingdom.name}; в казну передано ${kingdom.treasury} крон, в ополчение вошли ${army.soldierIds.length} жителей.`);
  appendCausalEvent(world, {
    kind: 'state',
    title: `Возникло государство ${kingdom.name}`,
    description: `${settlements.map(item => item.name).join(', ')} отделились от прежней власти и создали постоянные органы управления, казну и ополчение.`,
    cause: `давление независимости достигло ${Math.round(community.independencePressure)}%, а местная власть — ${Math.round(community.authority)}%`,
    conditions: [`население общин: ${residents.length}`, `сплочённость: ${Math.round(community.cohesion)}%`, `военная поддержка: ${Math.round(community.militarySupport)}%`],
    decision: `${leader.name} и советы поселений закрепили общую власть`,
    outcome: `${kingdom.name} стало самостоятельным участником политики мира`,
    consequences: ['поселения сменили государственную принадлежность', 'границы были перераспределены вокруг общин', 'созданы правительство и местное войско'],
    entityRefs: [{ kind: 'kingdom', id: kingdom.id }, { kind: 'character', id: leader.id }, ...settlements.slice(0, 4).map(item => ({ kind: 'settlement' as const, id: item.id }))],
    importance: 5,
    decisionId: foundingDecision.decisionRecordId,
  });
  return kingdom;
}

export function stateFormationIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const communityIds = new Set(world.politicalCommunities.map(item => item.id));
  const kingdomIds = new Set(world.kingdoms.map(item => item.id));
  const settlementIds = new Set(world.settlements.map(item => item.id));
  const characterIds = new Set(world.characters.filter(item => item.alive).map(item => item.id));
  for (const settlement of world.settlements) {
    if (!settlement.politicalCommunityId || !communityIds.has(settlement.politicalCommunityId)) issues.push(`${settlement.name}: отсутствует политическая община`);
    if (!kingdomIds.has(settlement.kingdomId)) issues.push(`${settlement.name}: отсутствует государство ${settlement.kingdomId}`);
  }
  for (const community of world.politicalCommunities) {
    if (community.settlementIds.some(id => !settlementIds.has(id))) issues.push(`Политическая община ${community.id}: отсутствует поселение`);
    if (!['merged', 'collapsed'].includes(community.status) && !characterIds.has(community.leaderCharacterId)) issues.push(`Политическая община ${community.id}: отсутствует живой лидер`);
    if (community.foundedKingdomId && !kingdomIds.has(community.foundedKingdomId)) issues.push(`Политическая община ${community.id}: отсутствует основанное государство`);
  }
  for (const kingdom of world.kingdoms.filter(item => item.foundingCommunityId)) {
    const community = world.politicalCommunities.find(item => item.id === kingdom.foundingCommunityId);
    if (!community || community.foundedKingdomId !== kingdom.id) issues.push(`${kingdom.name}: нарушена связь с общиной-основателем`);
    if (!world.settlements.some(item => item.kingdomId === kingdom.id)) issues.push(`${kingdom.name}: государство не контролирует поселения`);
  }
  return issues;
}

function synchronizeCommunities(world: WorldState): void {
  const activeBySettlement = new Map<number, PoliticalCommunity>();
  for (const community of world.politicalCommunities.filter(item => ACTIVE_COMMUNITY_STATUSES.has(item.status))) {
    for (const settlementId of community.settlementIds) if (!activeBySettlement.has(settlementId)) activeBySettlement.set(settlementId, community);
  }
  for (const settlement of world.settlements) {
    const linked = settlement.politicalCommunityId ? world.politicalCommunities.find(item => item.id === settlement.politicalCommunityId) : undefined;
    if (linked && ACTIVE_COMMUNITY_STATUSES.has(linked.status)) continue;
    if (linked?.status === 'merged' && linked.successorCommunityId) {
      const successor = world.politicalCommunities.find(item => item.id === linked.successorCommunityId && ACTIVE_COMMUNITY_STATUSES.has(item.status));
      if (successor) {
        settlement.politicalCommunityId = successor.id;
        if (!successor.settlementIds.includes(settlement.id)) successor.settlementIds.push(settlement.id);
        continue;
      }
    }
    // An empty ruined settlement keeps its final collapsed community as history.
    // Recreating it every quarter used to produce hundreds of dead communities.
    if (linked?.status === 'collapsed' && settlement.population <= 3) continue;
    const community = activeBySettlement.get(settlement.id) ?? createSettlementCommunity(world, settlement);
    if (!world.politicalCommunities.includes(community)) world.politicalCommunities.push(community);
    settlement.politicalCommunityId = community.id;
  }
  for (const community of world.politicalCommunities) normalizeCommunity(world, community);
}

function createSettlementCommunity(world: WorldState, settlement: Settlement): PoliticalCommunity {
  const government = world.settlementGovernments.find(item => item.settlementId === settlement.id);
  const leader = government?.leaderCharacterId
    ? world.characters.find(item => item.id === government.leaderCharacterId && item.alive)
    : chooseLocalLeader(world, [settlement]);
  const status: PoliticalCommunityStatus = settlement.politicalStatus === 'independent' ? 'independent'
    : settlement.politicalStatus === 'frontier' ? 'frontier' : 'integrated';
  const kind = communityKindForSettlement(world, settlement, status);
  return {
    id: world.nextIds.politicalCommunity++,
    name: communityName(kind, settlement.name),
    kind,
    status,
    settlementIds: [settlement.id],
    originKingdomId: settlement.claimantKingdomId ?? settlement.kingdomId,
    currentKingdomId: settlement.kingdomId,
    civilizationId: settlement.civilizationId,
    cultureId: world.settlementCultures.find(item => item.settlementId === settlement.id)?.dominantCultureId,
    leaderCharacterId: leader?.id ?? settlement.notableCharacterIds[0] ?? world.characters.find(item => item.alive && item.settlementId === settlement.id)?.id ?? 0,
    authority: clamp(20 + settlement.defense * .35 + (leader?.renown ?? 0) * .25, 5, 92),
    cohesion: clamp(62 - (world.settlementCultures.find(item => item.settlementId === settlement.id)?.culturalTension ?? 0) * .45, 10, 95),
    autonomy: status === 'independent' ? 100 : status === 'frontier' ? 38 : 18,
    legitimacy: clamp(30 + (leader?.renown ?? 0) * .5 + (leader?.loyalty ?? 50) * .2, 8, 92),
    treasury: Math.max(5, Math.round((government?.treasury ?? settlement.economy.coinSupply * .04))),
    militarySupport: clamp(settlement.defense * .45, 4, 75),
    independencePressure: status === 'independent' ? 100 : status === 'frontier' ? 30 : 12,
    createdTick: Math.min(worldTick(world), Math.max(0, settlement.foundedYear * 12)),
    lastAdvancedTick: worldTick(world),
    history: [`Политическая община оформлена вокруг поселения ${settlement.name}.`],
  };
}

function normalizeCommunity(world: WorldState, community: PoliticalCommunity): void {
  community.settlementIds = [...new Set(community.settlementIds)].filter(id => world.settlements.some(item => item.id === id));
  const settlements = communitySettlements(world, community);
  if (!settlements.length && ACTIVE_COMMUNITY_STATUSES.has(community.status)) community.status = 'collapsed';
  community.currentKingdomId = settlements[0]?.kingdomId ?? community.currentKingdomId;
  community.civilizationId ??= settlements.find(item => item.civilizationId)?.civilizationId;
  community.cultureId ??= settlements.map(item => world.settlementCultures.find(value => value.settlementId === item.id)?.dominantCultureId).find((id): id is number => typeof id === 'number');
  const leader = world.characters.find(item => item.id === community.leaderCharacterId && item.alive && settlements.some(settlement => settlement.id === item.settlementId));
  if (!leader) community.leaderCharacterId = chooseLocalLeader(world, settlements)?.id ?? 0;
  if (ACTIVE_COMMUNITY_STATUSES.has(community.status)) {
    for (const settlement of settlements) settlement.politicalCommunityId = community.id;
  }
}

function updateCommunityMetrics(world: WorldState, community: PoliticalCommunity, elapsedMonths: number): void {
  const settlements = communitySettlements(world, community);
  const snapshot = communitySnapshot(world, community, settlements);
  const localGovernments = settlements.map(settlement => world.settlementGovernments.find(item => item.settlementId === settlement.id)).filter(Boolean);
  const leader = world.characters.find(item => item.id === community.leaderCharacterId && item.alive);
  const administration = world.kingdomGovernments.find(item => item.kingdomId === community.currentKingdomId);
  const authorityTarget = clamp(18 + snapshot.averageDefense * .28 + Math.log2(snapshot.population + 1) * 5 + (leader?.politicalInfluence ?? leader?.renown ?? 0) * .24, 4, 96);
  const cultureTension = average(settlements.map(settlement => world.settlementCultures.find(item => item.settlementId === settlement.id)?.culturalTension ?? 0));
  const cohesionTarget = clamp(78 - cultureTension * .55 - snapshot.averageUnrest * .28 + (snapshot.connectedToCapital ? 4 : -3) + Math.min(10, settlements.length * 2), 5, 98);
  const militaryResidents = world.characters.filter(character => character.alive && settlements.some(settlement => settlement.id === character.settlementId) && (character.militaryRole || ['guard', 'soldier', 'hunter'].includes(character.profession))).length;
  const militaryTarget = clamp(snapshot.averageDefense * .42 + militaryResidents / Math.max(1, snapshot.population) * 180, 2, 96);
  const legitimacyTarget = clamp(25 + (leader?.renown ?? 0) * .42 + (leader?.loyalty ?? 50) * .18 + snapshot.averageProsperity * .2 - snapshot.averageUnrest * .18, 4, 96);
  const pressure = clamp(
    snapshot.averageUnrest * .55 + snapshot.distanceFromCapital * 3.2 + snapshot.averageDefense * .12 + snapshot.warPressure + snapshot.separatistPressure
    + (snapshot.cultureDifference ? 18 : 0) + (community.status === 'frontier' ? 9 : 0)
    - (administration?.administration ?? 35) * .22 - (administration?.centralization ?? 35) * .18
    - (world.kingdoms.find(item => item.id === community.currentKingdomId)?.stability ?? 45) * .2 - (snapshot.connectedToCapital ? 10 : 0),
    0,
    100,
  );
  const blend = Math.min(1, elapsedMonths / 8);
  community.authority = approach(community.authority, authorityTarget, blend);
  community.cohesion = approach(community.cohesion, cohesionTarget, blend);
  community.militarySupport = approach(community.militarySupport, militaryTarget, blend);
  community.legitimacy = approach(community.legitimacy, legitimacyTarget, blend);
  community.independencePressure = approach(community.independencePressure, pressure, Math.min(1, elapsedMonths / 5));
  const autonomyDelta = (community.independencePressure - 45) / 24 * elapsedMonths - (community.status === 'integrated' && snapshot.connectedToCapital ? .5 * elapsedMonths : 0);
  community.autonomy = clamp(community.autonomy + autonomyDelta, 0, 100);
  for (const government of localGovernments) {
    if (!government) continue;
    transferMoney(world, {
      payer: { kind: 'settlementGovernment', id: government.id },
      payee: { kind: 'politicalCommunity', id: community.id },
      amount: Number(government.monthlyTaxIncome ?? 0) * elapsedMonths * .08,
      kind: 'governmentTransfer',
      purpose: `взнос общины ${community.name} из местных налогов`,
      settlementId: government.settlementId,
      kingdomId: community.currentKingdomId,
    });
  }
}

function advanceCommunityStatus(world: WorldState, community: PoliticalCommunity, force: boolean): PoliticalTransitionKind | undefined {
  const age = worldTick(world) - community.createdTick;
  const settlements = communitySettlements(world, community);
  if (community.status === 'frontier' && (force || age >= 48 && community.independencePressure < 42 && community.autonomy < 50)) {
    changeCommunityStatus(world, community, 'integrated', 'integration', 'дороги, налоги и местная администрация связали пограничную общину со столицей');
    settlements.forEach(settlement => { settlement.politicalStatus = 'integrated'; });
    return 'integration';
  }
  if ((community.status === 'integrated' || community.status === 'frontier') && (force || age >= 24 && community.independencePressure >= 70 && community.autonomy >= 52)) {
    changeCommunityStatus(world, community, 'autonomous', 'autonomy', 'удалённость, местная казна и слабый контроль столицы позволили общине управлять собой');
    settlements.forEach(settlement => { settlement.politicalStatus = 'independent'; settlement.claimantKingdomId ??= settlement.kingdomId; });
    return 'autonomy';
  }
  if (community.status === 'autonomous' && (force || age >= 36 && community.independencePressure >= 82 && community.authority >= 44 && community.cohesion >= 48)) {
    changeCommunityStatus(world, community, 'independent', 'independence', 'местный совет перестал исполнять приказы прежней власти и удержал поселения собственными силами');
    community.autonomy = 100;
    settlements.forEach(settlement => { settlement.politicalStatus = 'independent'; settlement.claimantKingdomId ??= settlement.kingdomId; });
    return 'independence';
  }
  return undefined;
}

function formPoliticalLeagues(world: WorldState, rng: RNG, force: boolean): number {
  let formed = 0;
  const available = world.politicalCommunities.filter(item => ['autonomous', 'independent'].includes(item.status) && !item.successorCommunityId).sort((a, b) => a.id - b.id);
  const consumed = new Set<number>();
  for (const community of available) {
    if (consumed.has(community.id)) continue;
    const partner = available
      .filter(item => item.id !== community.id && !consumed.has(item.id))
      .filter(item => compatibleCommunities(world, community, item))
      .sort((a, b) => communityDistance(world, community, a) - communityDistance(world, community, b) || b.cohesion - a.cohesion || a.id - b.id)[0];
    if (!partner) continue;
    const score = average([community.authority, partner.authority, community.cohesion, partner.cohesion, community.independencePressure, partner.independencePressure]);
    if (!force && (score < 59 || score < 80 && !rng.chance(Math.min(.72, .18 + score / 180)))) continue;
    const settlements = [...communitySettlements(world, community), ...communitySettlements(world, partner)];
    const urban = settlements.some(item => ['town', 'city', 'port'].includes(item.type));
    const kind: PoliticalCommunityKind = urban ? 'city-league' : 'tribal-confederation';
    const leader = chooseLocalLeader(world, settlements);
    if (!leader) continue;
    const merged: PoliticalCommunity = {
      id: world.nextIds.politicalCommunity++,
      name: urban ? `Союз городов ${settlements.map(item => item.name).slice(0, 2).join(' и ')}` : `Союз общин ${settlements.map(item => item.name).slice(0, 2).join(' и ')}`,
      kind,
      status: community.status === 'independent' || partner.status === 'independent' ? 'independent' : 'autonomous',
      settlementIds: [...new Set([...community.settlementIds, ...partner.settlementIds])],
      originKingdomId: community.originKingdomId,
      currentKingdomId: community.currentKingdomId,
      civilizationId: community.civilizationId ?? partner.civilizationId,
      cultureId: community.cultureId ?? partner.cultureId,
      leaderCharacterId: leader.id,
      authority: clamp(average([community.authority, partner.authority]) + 8, 0, 100),
      cohesion: clamp(average([community.cohesion, partner.cohesion]) + 4, 0, 100),
      autonomy: Math.max(community.autonomy, partner.autonomy),
      legitimacy: clamp(average([community.legitimacy, partner.legitimacy]) + 3, 0, 100),
      treasury: community.treasury + partner.treasury,
      militarySupport: clamp(community.militarySupport + partner.militarySupport * .7, 0, 100),
      independencePressure: Math.max(community.independencePressure, partner.independencePressure),
      createdTick: worldTick(world),
      lastAdvancedTick: worldTick(world),
      history: [`В ${world.year}.${String(world.month).padStart(2, '0')} общины объединили советы, казну и ополчение.`],
    };
    world.politicalCommunities.push(merged);
    for (const source of [community, partner]) {
      source.status = 'merged';
      source.successorCommunityId = merged.id;
      source.history.push(`Община вошла в ${merged.name}.`);
      consumed.add(source.id);
    }
    for (const settlement of settlements) settlement.politicalCommunityId = merged.id;
    recordTransition(world, 'league', merged, 'соседние самостоятельные общины нуждались в общем рынке, защите и переговорах', `${merged.name} получил единый совет`, community.currentKingdomId);
    appendCausalEvent(world, {
      kind: 'state', title: `Создан ${merged.name}`, description: `${settlements.map(item => item.name).join(', ')} объединили местные власти.`,
      cause: 'общая торговля, близость поселений и потребность в совместной защите', conditions: [`сплочённость ${Math.round(merged.cohesion)}%`, `местная власть ${Math.round(merged.authority)}%`],
      decision: `${leader.name} возглавил общий совет`, outcome: 'общины получили единый политический центр', consequences: ['общая казна', 'совместное ополчение', 'возможность основать отдельное государство'],
      entityRefs: [{ kind: 'character', id: leader.id }, ...settlements.slice(0, 4).map(item => ({ kind: 'settlement' as const, id: item.id }))], importance: 4,
    });
    formed += 1;
  }
  return formed;
}

function processVoluntaryUnions(world: WorldState, rng: RNG, force: boolean, indexes?: WorldIndexes): number {
  let united = 0;
  for (const community of world.politicalCommunities.filter(item => item.status === 'autonomous').sort((a, b) => a.id - b.id)) {
    const settlements = communitySettlements(world, community);
    if (!settlements.length || community.independencePressure > 58) continue;
    const origin = world.kingdoms.find(item => item.id === community.currentKingdomId);
    const capital = settlements[0]!;
    const candidate = world.kingdoms
      .filter(item => item.id !== community.currentKingdomId)
      .filter(item => sameCivilizationById(item, community.civilizationId))
      .map(kingdom => ({ kingdom, capital: controlledCapital(world, kingdom.id) }))
      .filter((item): item is { kingdom: Kingdom; capital: Settlement } => Boolean(item.capital))
      .sort((a, b) => Math.hypot(a.capital.x - capital.x, a.capital.y - capital.y) - Math.hypot(b.capital.x - capital.x, b.capital.y - capital.y) || b.kingdom.stability - a.kingdom.stability)[0];
    if (!candidate) continue;
    const relation = origin?.diplomacy.find(item => item.kingdomId === candidate.kingdom.id)?.score ?? 0;
    const unionScore = candidate.kingdom.stability + relation * .35 - community.independencePressure + community.cohesion * .25;
    if (!force && (unionScore < 55 || !rng.chance(Math.min(.42, unionScore / 220)))) continue;
    const previousIds = [...new Set(settlements.map(item => item.kingdomId))];
    for (const settlement of settlements) {
      settlement.kingdomId = candidate.kingdom.id;
      settlement.politicalStatus = 'integrated';
      settlement.claimantKingdomId = previousIds[0];
      settlement.history.push(`В ${world.year} году добровольно признало власть государства ${candidate.kingdom.name}.`);
      for (const character of world.characters.filter(item => item.alive && item.settlementId === settlement.id)) character.kingdomId = candidate.kingdom.id;
    }
    transferPoliticalTerritory(world, settlements.map(item => item.id), previousIds, candidate.kingdom.id, world.year, world.month, 'добровольное объединение');
    updateTradeRouteControl(world, settlements, previousIds, candidate.kingdom.id);
    community.status = 'integrated';
    community.currentKingdomId = candidate.kingdom.id;
    community.autonomy = Math.max(20, community.autonomy - 35);
    community.history.push(`Совет общины добровольно признал власть ${candidate.kingdom.name}.`);
    recordTransition(world, 'voluntary-union', community, 'общине требовались защита, рынок и признанная внешняя власть', `поселения вошли в ${candidate.kingdom.name}`, previousIds[0], candidate.kingdom.id);
    appendCausalEvent(world, {
      kind: 'diplomacy', title: `${settlements.map(item => item.name).join(', ')} вошли в ${candidate.kingdom.name}`, description: 'Местные советы добровольно передали внешнюю политику и часть налогов более устойчивому государству.',
      cause: 'торговые связи, слабость прежней власти и потребность в защите', conditions: [`сплочённость общины ${Math.round(community.cohesion)}%`, `стабильность принимающей державы ${candidate.kingdom.stability}%`],
      decision: 'советы поселений приняли договор об объединении', outcome: 'политическая принадлежность и границы изменились без войны', consequences: ['жители получили новое подданство', 'торговые пути признали нового контролёра'],
      entityRefs: [{ kind: 'kingdom', id: candidate.kingdom.id }, ...settlements.slice(0, 4).map(item => ({ kind: 'settlement' as const, id: item.id }))], importance: 4,
    });
    united += 1;
  }
  if (united && indexes) refreshDynamicWorldIndexes(indexes, world);
  return united;
}

function communitySnapshot(world: WorldState, community: PoliticalCommunity, settlements: Settlement[]): CommunitySnapshot {
  const kingdom = world.kingdoms.find(item => item.id === community.currentKingdomId);
  const capital = kingdom ? controlledCapital(world, kingdom.id) : undefined;
  const communityCulture = community.cultureId;
  const capitalCulture = capital ? world.settlementCultures.find(item => item.settlementId === capital.id)?.dominantCultureId : undefined;
  const routes = new Set(settlements.flatMap(item => item.tradeRouteIds));
  const connectedToCapital = Boolean(capital && world.tradeRoutes.some(route => routes.has(route.id) && [route.fromSettlementId, route.toSettlementId].includes(capital.id) && route.active));
  const warPressure = world.wars.some(war => war.active && settlements.some(settlement => war.contestedSettlementIds.includes(settlement.id))) ? 22 : 0;
  const crises = world.stateCrises.filter(crisis => crisis.kingdomId === community.currentKingdomId && ['сепаратизм', 'вассальный мятеж', 'гражданская война'].includes(crisis.kind) && ['назревает', 'активен', 'урегулирован'].includes(crisis.status) && (!crisis.settlementIds.length || crisis.settlementIds.some(id => community.settlementIds.includes(id))));
  const separatistPressure = crises.reduce((highest, crisis) => Math.max(highest, crisis.severity * .28 + crisis.support * .18), 0);
  return {
    population: settlements.reduce((sum, settlement) => sum + settlement.population, 0),
    averageProsperity: average(settlements.map(item => item.prosperity)),
    averageUnrest: average(settlements.map(item => item.unrest)),
    averageDefense: average(settlements.map(item => item.defense)),
    distanceFromCapital: capital ? average(settlements.map(item => Math.hypot(item.x - capital.x, item.y - capital.y))) : 12,
    cultureDifference: Boolean(communityCulture && capitalCulture && communityCulture !== capitalCulture),
    connectedToCapital,
    warPressure,
    separatistPressure,
  };
}

function changeCommunityStatus(world: WorldState, community: PoliticalCommunity, status: PoliticalCommunityStatus, kind: PoliticalTransitionKind, cause: string): void {
  community.status = status;
  community.history.push(`В ${world.year}.${String(world.month).padStart(2, '0')} статус изменён: ${status}. ${cause}.`);
  recordTransition(world, kind, community, cause, `община получила статус ${status}`, community.currentKingdomId);
}

function collapseCommunity(world: WorldState, community: PoliticalCommunity, cause: string): void {
  community.status = 'collapsed';
  community.history.push(`В ${world.year}.${String(world.month).padStart(2, '0')} политическая община исчезла: ${cause}.`);
  recordTransition(world, 'collapse', community, cause, 'единый местный политический центр прекратил существование', community.currentKingdomId);
}

function recordTransition(world: WorldState, kind: PoliticalTransitionKind, community: PoliticalCommunity, cause: string, outcome: string, fromKingdomId?: number, toKingdomId?: number): PoliticalTransition {
  const transition: PoliticalTransition = {
    id: world.nextIds.politicalTransition++, kind, communityId: community.id, settlementIds: [...community.settlementIds],
    fromKingdomId, toKingdomId, leaderCharacterId: community.leaderCharacterId || undefined, tick: worldTick(world), cause, outcome,
  };
  world.politicalTransitions.push(transition);
  if (world.politicalTransitions.length > 1200) world.politicalTransitions.splice(0, world.politicalTransitions.length - 1200);
  return transition;
}

function maybeCreateTribute(world: WorldState, kingdom: Kingdom, predecessor: Kingdom | undefined, community: PoliticalCommunity, rng: RNG): DiplomaticAgreement | undefined {
  if (!predecessor || predecessor.id === kingdom.id || predecessor.armyStrength < kingdom.armyStrength * 1.25 || community.militarySupport > 68) return undefined;
  if (!rng.chance(.55)) return undefined;
  const agreement: DiplomaticAgreement = {
    id: world.nextIds.diplomaticAgreement++, kingdomIds: [kingdom.id, predecessor.id], kind: 'дань', status: 'действует', initiatorKingdomId: predecessor.id,
    signedTick: worldTick(world), expiresTick: worldTick(world) + rng.int(36, 96), tributeAmount: Math.max(8, Math.round(kingdom.treasury * .04)),
    terms: [`${kingdom.name} сохраняет внутреннюю власть`, `${kingdom.name} выплачивает ежегодную дань`, `${predecessor.name} отказывается от немедленного похода`],
    history: ['Договор заключён одновременно с признанием нового государства.'],
  };
  world.diplomaticAgreements.push(agreement);
  for (const state of world.kingdomGovernments.filter(item => agreement.kingdomIds.includes(item.kingdomId))) if (!state.agreementIds.includes(agreement.id)) state.agreementIds.push(agreement.id);
  recordTransition(world, 'tribute', community, 'новое государство не могло выдержать немедленную войну с прежней державой', `самостоятельность сохранена ценой дани государству ${predecessor.name}`, predecessor.id, kingdom.id);
  return agreement;
}

function createFoundingArmy(world: WorldState, kingdom: Kingdom, capital: Settlement, leader: Character, residents: Character[], militarySupport: number, rng: RNG): Army {
  const preferred = residents
    .filter(character => character.age >= 16 && (character.militaryRole || ['guard', 'soldier', 'hunter'].includes(character.profession)))
    .sort((a, b) => (b.militaryExperience ?? 0) - (a.militaryExperience ?? 0) || b.renown - a.renown || a.id - b.id);
  const reserve = residents
    .filter(character => character.age >= 16 && !preferred.includes(character) && character.profession !== 'child')
    .sort((a, b) => b.loyalty - a.loyalty || b.health - a.health || a.id - b.id);
  const supportRatio = Math.max(.03, Math.min(.28, militarySupport / 400));
  const target = Math.max(1, Math.min(36, Math.ceil(residents.length * supportRatio)));
  const soldiers = [...preferred, ...reserve].slice(0, target);
  const commander = soldiers[0] ?? leader;
  commander.kingdomId = kingdom.id;
  commander.profession = commander.profession === 'child' ? 'guard' : commander.profession;
  commander.militaryRole ??= 'командир';
  commander.titles = [...new Set([...commander.titles, 'Командир ополчения'])];
  for (const soldier of soldiers) {
    soldier.kingdomId = kingdom.id;
    soldier.serviceStatus = 'гарнизон';
    soldier.militaryRole ??= soldier.id === commander.id ? 'командир' : 'ополченец';
  }
  return {
    id: world.nextIds.army++, name: `Ополчение ${capital.name}`, kingdomId: kingdom.id, commanderId: commander.id, x: capital.x, y: capital.y,
    strength: Math.max(4, soldiers.length * 3), morale: clamp(Math.round(45 + kingdom.stability * .35 + rng.int(-5, 8)), 30, 92), supplies: 45,
    status: 'garrison', campaignHistory: [`Сформировано при основании государства ${kingdom.name}.`], soldierIds: soldiers.map(item => item.id), unitIds: [], supplyWagonIds: [], inventoryItemIds: [],
    logistics: { foodDays: 24, waterDays: 18, medicine: 4, tents: 0, tools: 2, horses: 0, wagons: 0, equipmentCoverage: 20, armorCoverage: 8, rangedCoverage: 12, payrollDebt: 0, desertions: 0, wounded: 0 },
    monthlyPayroll: 0, readiness: 32,
  };
}

function detachFoundingSoldiers(world: WorldState, soldierIds: readonly number[]): void {
  const transferring = new Set(soldierIds);
  if (!transferring.size) return;
  const removedUnitIds = new Set<number>();
  for (const unit of world.militaryUnits) {
    unit.memberIds = unit.memberIds.filter(id => !transferring.has(id));
    if (transferring.has(unit.commanderId)) unit.commanderId = unit.memberIds[0] ?? world.kingdoms.find(item => item.id === unit.kingdomId)?.rulerId ?? unit.commanderId;
    if (!unit.memberIds.length) removedUnitIds.add(unit.id);
  }
  world.militaryUnits = world.militaryUnits.filter(unit => !removedUnitIds.has(unit.id));
  for (const army of world.armies) {
    const before = army.soldierIds.length;
    army.soldierIds = army.soldierIds.filter(id => !transferring.has(id));
    army.unitIds = army.unitIds.filter(id => !removedUnitIds.has(id));
    if (transferring.has(army.commanderId)) army.commanderId = army.soldierIds[0] ?? world.kingdoms.find(item => item.id === army.kingdomId)?.rulerId ?? army.commanderId;
    if (army.soldierIds.length !== before) {
      army.strength = Math.max(0, Math.min(army.strength, army.soldierIds.length * 4));
      army.campaignHistory.push(`В ${world.year}.${String(world.month).padStart(2, '0')} часть местного ополчения перешла под власть нового государства.`);
    }
  }
  world.armyLocalPositions = world.armyLocalPositions.filter(position => !transferring.has(position.characterId));
  for (const structure of world.armyCampStructures) structure.assignedCharacterIds = structure.assignedCharacterIds.filter(id => !transferring.has(id));
}

function updateTradeRouteControl(world: WorldState, settlements: Settlement[], previousIds: number[], newKingdomId: number): void {
  const settlementIds = new Set(settlements.map(item => item.id));
  for (const route of world.tradeRoutes) {
    if (!settlementIds.has(route.fromSettlementId) && !settlementIds.has(route.toSettlementId)) continue;
    route.controlledByKingdomIds = [...new Set([...route.controlledByKingdomIds.filter(id => !previousIds.includes(id)), newKingdomId])];
    route.history.push(`В ${world.year} году контроль пути изменился вслед за политической принадлежностью поселений.`);
  }
}

function initializeDiplomacyPair(created: Kingdom, other: Kingdom, score: number): void {
  const status: DiplomacyRecord['status'] = score >= 40 ? 'союз' : score <= -28 ? 'напряжение' : 'мир';
  const reason = score < 0 ? 'спор о признании нового государства и прежних правах на землю' : score > 0 ? 'общая цивилизация и торговые связи' : 'государства ещё не выработали устойчивых отношений';
  created.diplomacy.push({ kingdomId: other.id, score, status, reason });
  const existing = other.diplomacy.find(item => item.kingdomId === created.id);
  if (existing) { existing.score = score; existing.status = status; existing.reason = reason; }
  else other.diplomacy.push({ kingdomId: created.id, score, status, reason });
}

function compatibleCommunities(world: WorldState, a: PoliticalCommunity, b: PoliticalCommunity): boolean {
  if (a.currentKingdomId !== b.currentKingdomId && a.originKingdomId !== b.originKingdomId) return false;
  if (a.civilizationId && b.civilizationId && a.civilizationId !== b.civilizationId) return false;
  if (a.cultureId && b.cultureId && a.cultureId !== b.cultureId) return false;
  return communityDistance(world, a, b) <= 7;
}

function communityDistance(world: WorldState, a: PoliticalCommunity, b: PoliticalCommunity): number {
  const left = communitySettlements(world, a);
  const right = communitySettlements(world, b);
  let best = Number.POSITIVE_INFINITY;
  for (const x of left) for (const y of right) best = Math.min(best, Math.hypot(x.x - y.x, x.y - y.y));
  return best;
}

function stateReadiness(world: WorldState, community: PoliticalCommunity): number {
  const settlements = communitySettlements(world, community);
  const population = settlements.reduce((sum, settlement) => sum + settlement.population, 0);
  const institutional = settlements.reduce((sum, settlement) => sum + Number(Boolean(world.settlementGovernments.some(item => item.settlementId === settlement.id))), 0) / Math.max(1, settlements.length) * 100;
  return clamp(community.authority * .25 + community.cohesion * .18 + community.legitimacy * .18 + community.militarySupport * .17 + Math.min(100, population * 1.1) * .12 + institutional * .1, 0, 100);
}

function chooseCommunityLeader(world: WorldState, community: PoliticalCommunity, settlements: Settlement[]): Character | undefined {
  const current = world.characters.find(item => item.id === community.leaderCharacterId && item.alive && settlements.some(settlement => settlement.id === item.settlementId));
  return current ?? chooseLocalLeader(world, settlements);
}

function chooseLocalLeader(world: WorldState, settlements: Settlement[]): Character | undefined {
  const settlementIds = new Set(settlements.map(item => item.id));
  const governmentLeaders = world.settlementGovernments.filter(item => settlementIds.has(item.settlementId)).map(item => item.leaderCharacterId);
  return world.characters
    .filter(character => character.alive && character.age >= 18 && settlementIds.has(character.settlementId))
    .sort((a, b) => Number(governmentLeaders.includes(b.id)) - Number(governmentLeaders.includes(a.id)) || politicalScore(b) - politicalScore(a) || a.id - b.id)[0];
}

function politicalScore(character: Character): number {
  return (character.politicalInfluence ?? 0) * 1.1 + character.renown * .8 + character.loyalty * .25 + character.wealth * .04 + character.titles.length * 8 + (character.militaryExperience ?? 0) * .18;
}

function communityKindForSettlement(world: WorldState, settlement: Settlement, status: PoliticalCommunityStatus): PoliticalCommunityKind {
  if (status === 'frontier') return 'frontier-colony';
  if (['city', 'town', 'port'].includes(settlement.type)) return 'free-city';
  const species = majoritySpecies(world.characters.filter(item => item.alive && item.settlementId === settlement.id));
  if (species === 'orc' || settlement.type === 'hamlet') return 'rural-council';
  return settlement.id === world.kingdoms.find(item => item.id === settlement.kingdomId)?.capitalId ? 'crown-domain' : 'rural-council';
}

function communityName(kind: PoliticalCommunityKind, settlementName: string): string {
  if (kind === 'frontier-colony') return `Пограничная община ${settlementName}`;
  if (kind === 'free-city') return `Городская община ${settlementName}`;
  if (kind === 'crown-domain') return `Столичная община ${settlementName}`;
  return `Община ${settlementName}`;
}

function governmentFormForCommunity(community: PoliticalCommunity, settlements: Settlement[], species: Kingdom['species']): GovernmentForm {
  if (community.kind === 'city-league') return 'городской союз';
  if (community.kind === 'tribal-confederation' || species === 'orc') return 'племенной союз';
  if (settlements.length === 1 && ['city', 'town', 'port'].includes(settlements[0]!.type)) return 'республика';
  return community.cohesion >= 68 ? 'выборная монархия' : 'феодальная монархия';
}

function uniqueStateName(world: WorldState, community: PoliticalCommunity, capital: Settlement): string {
  const base = community.kind === 'city-league' ? `Союз ${capital.name}`
    : community.kind === 'tribal-confederation' ? `Конфедерация ${capital.name}`
      : capital.type === 'city' || capital.type === 'port' ? `Свободное государство ${capital.name}` : `Княжество ${capital.name}`;
  if (!world.kingdoms.some(item => item.name === base)) return base;
  let index = 2;
  while (world.kingdoms.some(item => item.name === `${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

function uniqueStateColor(world: WorldState, id: number): string {
  const used = new Set(world.kingdoms.map(item => item.color.toLowerCase()));
  const available = STATE_COLORS.filter(color => !used.has(color.toLowerCase()));
  return available[id % Math.max(1, available.length)] ?? STATE_COLORS[id % STATE_COLORS.length]!;
}

function foundingLaws(form: GovernmentForm): string[] {
  if (form === 'городской союз' || form === 'республика') return ['неприкосновенность общинного совета', 'общая оборона торговых путей', 'налог утверждается представителями поселений'];
  if (form === 'племенной союз') return ['совет старших родов', 'общее ополчение', 'право общин сохранять внутренние обычаи'];
  return ['защита земель общин-основателей', 'единая монета и пошлина', 'воинская повинность при внешней угрозе'];
}

function rulerTitle(form: GovernmentForm): string {
  if (form === 'городской союз' || form === 'республика') return 'Первый советник';
  if (form === 'племенной союз') return 'Верховный вождь';
  if (form === 'выборная монархия') return 'Избранный правитель';
  return 'Правитель';
}

function majoritySpecies(characters: Character[]): Kingdom['species'] {
  const counts = new Map<Kingdom['species'], number>();
  for (const character of characters) counts.set(character.species, (counts.get(character.species) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'human';
}

function sameCivilization(a: Kingdom, b: Kingdom): boolean {
  return Boolean(a.civilizationId && b.civilizationId && a.civilizationId === b.civilizationId);
}

function sameCivilizationById(kingdom: Kingdom, civilizationId: number | undefined): boolean {
  return Boolean(civilizationId && kingdom.civilizationId === civilizationId);
}

function communitySettlements(world: WorldState, community: PoliticalCommunity): Settlement[] {
  const ids = new Set(community.settlementIds);
  return world.settlements.filter(item => ids.has(item.id));
}

function approach(current: number, target: number, factor: number): number {
  return clamp(current + (target - current) * factor, 0, 100);
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
