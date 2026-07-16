import type {
  Character, CourtFaction, CourtFactionKind, CourtOffice, CourtOfficeKind, DiplomaticAgreement, DiplomaticAgreementKind,
  GovernmentForm, Kingdom, KingdomGovernment, NobleRank, NobleTitle, RoyalOrder, RoyalOrderKind, Settlement,
  StateCrisis, StateCrisisKind, VassalContract, WorldState,
} from '../types';
import type { WorldIndexes } from './indexes';
import { appendCausalEvent } from './causality';
import { registerWorldEventKnowledge } from './knowledgeSystem';
import { requestConstructionProject } from './agricultureConstruction';
import { controlledCapital, normalizeKingdomCapitals } from './kingdomState';
import { RNG, hashSeed } from './rng';
import { worldTick } from './scheduler';
import { decisionKnowledge, linkDecisionToEvent, recordDecision, recordStateDelta } from './decisionCore';
import { ensureCharacterMind, scoreMotivatedAction, setDecisionMoment } from './mindSystem';

const OFFICE_DEFINITIONS: Record<CourtOfficeKind, { professions: string[]; salary: number; influence: number }> = {
  'канцлер': { professions: ['scribe', 'merchant', 'priest'], salary: 12, influence: 18 },
  'казначей': { professions: ['merchant', 'scribe'], salary: 11, influence: 16 },
  'маршал': { professions: ['soldier', 'guard', 'hunter'], salary: 14, influence: 22 },
  'глава разведки': { professions: ['hunter', 'guard', 'merchant', 'scribe'], salary: 13, influence: 20 },
  'придворный лекарь': { professions: ['healer', 'herbalist'], salary: 10, influence: 11 },
  'верховный жрец': { professions: ['priest'], salary: 10, influence: 17 },
  'придворный маг': { professions: ['scribe', 'herbalist', 'healer'], salary: 18, influence: 24 },
};

const FACTION_GOALS: Record<CourtFactionKind, string[]> = {
  'корона': ['усилить центральную власть', 'сохранить династию', 'подчинить непокорных вассалов'],
  'знать': ['расширить автономию владений', 'получить придворные должности', 'снизить налоги с земель'],
  'армия': ['увеличить жалование и снабжение', 'добиться похода и добычи', 'поставить сильного маршала'],
  'духовенство': ['расширить влияние храмов', 'получить защиту святынь', 'навязать религиозные законы'],
  'купцы': ['открыть торговые пути', 'снизить пошлины', 'защитить рынки и караваны'],
  'народ': ['снизить налоги', 'получить помощь при голоде', 'ограничить произвол знати'],
};

const MAX_ORDERS = 1200;
const MAX_CRISES = 300;
const MAX_AGREEMENTS = 300;

export function initializeStateMachine(world: WorldState, rng = new RNG(`${world.config.seed}:государственная-машина-v1`), indexes?: WorldIndexes): void {
  world.kingdomGovernments ??= [];
  world.nobleTitles ??= [];
  world.vassalContracts ??= [];
  world.courtOffices ??= [];
  world.courtFactions ??= [];
  world.royalOrders ??= [];
  world.stateCrises ??= [];
  world.diplomaticAgreements ??= [];
  world.nextIds.kingdomGovernment ??= maxId(world.kingdomGovernments) + 1;
  world.nextIds.nobleTitle ??= maxId(world.nobleTitles) + 1;
  world.nextIds.vassalContract ??= maxId(world.vassalContracts) + 1;
  world.nextIds.courtOffice ??= maxId(world.courtOffices) + 1;
  world.nextIds.courtFaction ??= maxId(world.courtFactions) + 1;
  world.nextIds.royalOrder ??= maxId(world.royalOrders) + 1;
  world.nextIds.stateCrisis ??= maxId(world.stateCrises) + 1;
  world.nextIds.diplomaticAgreement ??= maxId(world.diplomaticAgreements) + 1;

  const tick = worldTick(world);
  for (const character of world.characters) {
    character.nobleTitleIds ??= [];
    character.courtOfficeIds ??= [];
    character.politicalInfluence ??= Math.max(1, Math.min(100, Math.round(character.renown * .45 + character.loyalty * .25 + (character.titles.length ? 16 : 0))));
  }

  normalizeKingdomCapitals(world);
  for (const kingdom of world.kingdoms) {
    const state = ensureKingdomGovernment(world, kingdom, rng, tick);
    ensureRealmTitles(world, kingdom, state, rng);
    ensureVassalContracts(world, kingdom, state, rng, tick);
    ensureCourt(world, kingdom, state, rng, tick);
    ensureFactions(world, kingdom, state, rng);
    kingdom.governmentStateId = state.id;
  }
  seedHistoricalAgreements(world, rng, tick);
  world.simulation.stateMachineVersion = 1;
}

export function advanceStateMachine(world: WorldState, rng: RNG, indexes: WorldIndexes): void {
  if (world.simulation.stateMachineVersion !== 1 || world.kingdomGovernments.length !== world.kingdoms.length) initializeStateMachine(world, rng, indexes);
  const tick = worldTick(world);
  normalizeKingdomCapitals(world);
  synchronizeRealmOwnership(world, rng, tick);

  for (const state of world.kingdomGovernments) {
    const kingdom = world.kingdoms.find(item => item.id === state.kingdomId);
    if (!kingdom) continue;
    synchronizeSuccession(world, kingdom, state, rng, tick);
    synchronizeCourt(world, kingdom, state, rng, tick);
    state.monthlyTaxIncome = 0;
    updateVassals(world, kingdom, state, rng, tick);
    runStateBudget(world, kingdom, state, rng, tick);
    updateFactions(world, kingdom, state, rng, tick);
    processOrders(world, kingdom, state, rng, tick);
    maybeCreateOrder(world, kingdom, state, rng, tick);
    advanceCrises(world, kingdom, state, rng, tick);
    maybeStartCrisis(world, kingdom, state, rng, tick);
  }

  advanceDiplomacy(world, rng, tick);
  trimStateCollections(world);
}

function ensureKingdomGovernment(world: WorldState, kingdom: Kingdom, rng: RNG, tick: number): KingdomGovernment {
  const existing = world.kingdomGovernments.find(item => item.kingdomId === kingdom.id);
  if (existing) {
    existing.capitalSettlementId = controlledCapital(world, kingdom.id)?.id ?? existing.capitalSettlementId;
    return existing;
  }
  const ruler = livingCharacter(world, kingdom.rulerId) ?? strongestRealmCandidate(world, kingdom.id);
  if (!ruler) throw new Error(`${kingdom.name}: невозможно создать государственную власть без живых жителей`);
  kingdom.rulerId = ruler.id;
  const form = governmentFormFor(kingdom, rng);
  const state: KingdomGovernment = {
    id: world.nextIds.kingdomGovernment++, kingdomId: kingdom.id, form, sovereignCharacterId: ruler.id,
    heirCharacterId: chooseHeir(world, kingdom, ruler)?.id, capitalSettlementId: controlledCapital(world, kingdom.id)?.id ?? kingdom.capitalId,
    sovereignTitleId: 0, titleIds: [], vassalContractIds: [], courtOfficeIds: [], factionIds: [], orderIds: [], crisisIds: [], agreementIds: [],
    legitimacy: clamp(48 + kingdom.stability * .35 + ruler.renown * .25 + rng.int(-8, 8), 15, 100),
    centralization: clamp(form === 'феодальная монархия' ? rng.int(32, 62) : form === 'племенной союз' || form === 'городской союз' ? rng.int(18, 44) : rng.int(38, 72), 5, 95),
    administration: clamp(25 + kingdom.stability * .35 + rng.int(-6, 12), 8, 92), corruption: rng.int(3, Math.min(60, 16 + Math.round((100 - kingdom.stability) * .4))),
    monthlyTaxIncome: 0, monthlyCourtCost: 0, monthlyInfrastructureCost: 0, monthlyReliefCost: 0, debt: 0,
    taxRate: form === 'феодальная монархия' ? .16 : form === 'республика' || form === 'городской союз' ? .13 : .11,
    levyRate: form === 'военная диктатура' || form === 'племенной союз' ? .2 : .12,
    successionLaw: successionLawFor(form, kingdom), activeDecision: 'удержание власти, сбор налогов и контроль вассалов',
    history: [`Государственная система оформлена не позднее ${world.year} года. Форма: ${form}.`],
  };
  if (ruler.age < 16) state.regentCharacterId = chooseRegent(world, kingdom, ruler)?.id;
  ruler.visualRole = 'king';
  ruler.politicalInfluence = Math.max(ruler.politicalInfluence ?? 0, 80);
  world.kingdomGovernments.push(state);
  return state;
}

function ensureRealmTitles(world: WorldState, kingdom: Kingdom, state: KingdomGovernment, rng: RNG): void {
  const ruler = livingCharacter(world, state.sovereignCharacterId) ?? strongestRealmCandidate(world, kingdom.id);
  if (!ruler) return;
  let sovereign = world.nobleTitles.find(title => title.id === state.sovereignTitleId || (title.kingdomId === kingdom.id && title.rank === 'корона'));
  if (!sovereign) {
    sovereign = {
      id: world.nextIds.nobleTitle++, kingdomId: kingdom.id, settlementId: state.capitalSettlementId,
      name: sovereignTitleName(kingdom, state.form), rank: 'корона', holderCharacterId: ruler.id, hereditary: !['республика', 'выборная монархия', 'городской союз'].includes(state.form),
      taxShare: state.taxRate, levyShare: state.levyRate, legitimacy: state.legitimacy, autonomy: 0, status: 'действует', claimantIds: [], history: [`Титул принадлежит ${ruler.name}.`],
    };
    world.nobleTitles.push(sovereign);
  }
  state.sovereignTitleId = sovereign.id;
  addUnique(state.titleIds, sovereign.id);
  addUnique(ruler.nobleTitleIds!, sovereign.id);

  const settlements = world.settlements.filter(item => item.kingdomId === kingdom.id).sort((a, b) => Number(b.id === state.capitalSettlementId) - Number(a.id === state.capitalSettlementId) || b.population - a.population);
  for (const settlement of settlements) {
    if (settlement.id === state.capitalSettlementId) continue;
    let title = world.nobleTitles.find(item => item.settlementId === settlement.id && item.status !== 'конфискован');
    if (!title) {
      const holder = chooseTitleHolder(world, kingdom, settlement, ruler, rng);
      title = {
        id: world.nextIds.nobleTitle++, kingdomId: kingdom.id, settlementId: settlement.id, name: territorialTitleName(settlement), rank: titleRank(settlement),
        holderCharacterId: holder.id, liegeTitleId: sovereign.id, hereditary: state.form !== 'республика' && state.form !== 'городской союз',
        taxShare: clamp(state.taxRate + rng.int(-4, 5) / 100, .05, .28), levyShare: clamp(state.levyRate + rng.int(-3, 7) / 100, .05, .3),
        legitimacy: clamp(40 + holder.renown * .45 + holder.loyalty * .2, 15, 95), autonomy: clamp(100 - state.centralization + rng.int(-10, 10), 8, 88),
        status: 'действует', claimantIds: [], history: [`Владение закреплено за ${holder.name}.`],
      };
      world.nobleTitles.push(title);
      addUnique(holder.nobleTitleIds!, title.id);
      holder.politicalInfluence = Math.max(holder.politicalInfluence ?? 0, 45);
    }
    title.kingdomId = kingdom.id;
    title.liegeTitleId = sovereign.id;
    addUnique(state.titleIds, title.id);
  }
}

function ensureVassalContracts(world: WorldState, kingdom: Kingdom, state: KingdomGovernment, rng: RNG, tick: number): void {
  const sovereign = world.nobleTitles.find(item => item.id === state.sovereignTitleId);
  if (!sovereign) return;
  for (const titleId of state.titleIds) {
    const title = world.nobleTitles.find(item => item.id === titleId);
    if (!title || title.rank === 'корона' || title.status === 'конфискован') continue;
    let contract = world.vassalContracts.find(item => item.vassalTitleId === title.id && item.kingdomId === kingdom.id);
    if (!contract) {
      contract = {
        id: world.nextIds.vassalContract++, kingdomId: kingdom.id, liegeTitleId: sovereign.id, vassalTitleId: title.id,
        liegeCharacterId: sovereign.holderCharacterId, vassalCharacterId: title.holderCharacterId, taxRate: title.taxShare, levyRate: title.levyShare,
        loyalty: clamp(35 + (livingCharacter(world, title.holderCharacterId)?.loyalty ?? 50) * .55 + rng.int(-12, 12), 5, 96), autonomy: title.autonomy,
        taxArrears: 0, levyArrears: 0, status: 'верен', lastPaidTick: tick, history: ['Вассал принёс присягу и принял налоговые и военные обязанности.'],
      };
      world.vassalContracts.push(contract);
    }
    contract.liegeTitleId = sovereign.id;
    contract.liegeCharacterId = sovereign.holderCharacterId;
    contract.vassalCharacterId = title.holderCharacterId;
    addUnique(state.vassalContractIds, contract.id);
  }
}

function ensureCourt(world: WorldState, kingdom: Kingdom, state: KingdomGovernment, rng: RNG, tick: number): void {
  const kinds = Object.keys(OFFICE_DEFINITIONS) as CourtOfficeKind[];
  for (const kind of kinds) {
    if (kind === 'придворный маг' && world.config.magic < .32) continue;
    let office = world.courtOffices.find(item => item.kingdomId === kingdom.id && item.kind === kind);
    if (!office) {
      const definition = OFFICE_DEFINITIONS[kind];
      const holder = chooseOfficeHolder(world, kingdom, state, kind, new Set(state.courtOfficeIds.flatMap(id => {
        const current = world.courtOffices.find(item => item.id === id);
        return current?.holderCharacterId ? [current.holderCharacterId] : [];
      })), rng);
      office = {
        id: world.nextIds.courtOffice++, kingdomId: kingdom.id, kind, holderCharacterId: holder?.id, salary: definition.salary,
        influence: definition.influence, competence: holder ? competenceFor(holder, kind) : 0, loyalty: holder?.loyalty ?? 0,
        appointedTick: tick, vacantSinceTick: holder ? undefined : tick, history: holder ? [`${holder.name} назначен на должность.`] : ['Должность остаётся вакантной.'],
      };
      world.courtOffices.push(office);
      if (holder) { addUnique(holder.courtOfficeIds!, office.id); holder.visualRole ??= 'official'; }
    }
    addUnique(state.courtOfficeIds, office.id);
  }
}

function ensureFactions(world: WorldState, kingdom: Kingdom, state: KingdomGovernment, rng: RNG): void {
  const kinds: CourtFactionKind[] = ['корона', 'знать', 'армия', 'духовенство', 'купцы', 'народ'];
  const residents = world.characters.filter(character => character.alive && character.kingdomId === kingdom.id && character.age >= 16);
  for (const kind of kinds) {
    if (world.courtFactions.some(item => item.kingdomId === kingdom.id && item.kind === kind)) continue;
    const members = factionMembers(world, residents, state, kind).slice(0, 64);
    const leader = [...members].sort((a, b) => factionLeadershipScore(b, kind) - factionLeadershipScore(a, kind) || a.id - b.id)[0]
      ?? livingCharacter(world, state.sovereignCharacterId)
      ?? residents[0];
    if (!leader) continue;
    const faction: CourtFaction = {
      id: world.nextIds.courtFaction++, kingdomId: kingdom.id, name: factionName(kingdom, kind), kind, leaderCharacterId: leader.id,
      memberIds: [...new Set([leader.id, ...members.map(item => item.id)])], influence: clamp(12 + members.length * .9 + leader.renown * .22 + rng.int(-5, 8), 5, 90),
      loyalty: clamp(kind === 'корона' ? state.legitimacy : 35 + leader.loyalty * .45 + rng.int(-12, 12), 5, 95), treasury: Math.max(0, Math.round(members.reduce((sum, member) => sum + member.wealth, 0) * .08)),
      goal: rng.pick(FACTION_GOALS[kind]), grievance: 'серьёзных требований пока нет', status: kind === 'корона' ? 'лояльна' : 'торгуется', history: ['Группа оформилась вокруг общих интересов.'],
    };
    world.courtFactions.push(faction); addUnique(state.factionIds, faction.id);
    for (const member of members) if (!member.courtFactionId || kind === 'корона') member.courtFactionId = faction.id;
  }
}

function synchronizeRealmOwnership(world: WorldState, rng: RNG, tick: number): void {
  for (const title of world.nobleTitles) {
    if (!title.settlementId || title.rank === 'корона') continue;
    const settlement = world.settlements.find(item => item.id === title.settlementId);
    if (!settlement || settlement.kingdomId === title.kingdomId) continue;
    const previousState = world.kingdomGovernments.find(item => item.kingdomId === title.kingdomId);
    previousState && (previousState.titleIds = previousState.titleIds.filter(id => id !== title.id));
    previousState && (previousState.vassalContractIds = previousState.vassalContractIds.filter(id => world.vassalContracts.find(contract => contract.id === id)?.vassalTitleId !== title.id));
    title.kingdomId = settlement.kingdomId;
    title.status = 'оспаривается'; title.autonomy = clamp(title.autonomy + 16, 0, 100);
    title.history.push(`После смены власти над ${settlement.name} титул перешёл под новую корону.`);
    const newState = world.kingdomGovernments.find(item => item.kingdomId === settlement.kingdomId);
    const newKingdom = world.kingdoms.find(item => item.id === settlement.kingdomId);
    if (!newState || !newKingdom) continue;
    const sovereign = world.nobleTitles.find(item => item.id === newState.sovereignTitleId);
    if (sovereign) title.liegeTitleId = sovereign.id;
    const holder = livingCharacter(world, title.holderCharacterId);
    if (!holder || holder.kingdomId !== settlement.kingdomId) {
      const ruler = livingCharacter(world, newState.sovereignCharacterId);
      const candidate = chooseTitleHolder(world, newKingdom, settlement, ruler ?? strongestRealmCandidate(world, newKingdom.id)!, rng);
      title.holderCharacterId = candidate.id;
      addUnique(candidate.nobleTitleIds!, title.id);
    }
    addUnique(newState.titleIds, title.id);
    ensureVassalContracts(world, newKingdom, newState, rng, tick);
  }
}

function synchronizeSuccession(world: WorldState, kingdom: Kingdom, state: KingdomGovernment, rng: RNG, tick: number): void {
  let sovereign = livingCharacter(world, state.sovereignCharacterId);
  const crown = world.nobleTitles.find(item => item.id === state.sovereignTitleId);
  if (!sovereign) {
    const oldId = state.sovereignCharacterId;
    const oldBurial = world.burials.find(item => item.subjectKind === 'character' && item.subjectId === oldId);
    const oldName = oldBurial?.name ?? 'прежний правитель';
    const preferred = state.heirCharacterId ? livingCharacter(world, state.heirCharacterId) : undefined;
    const successor = preferred ?? strongestRealmCandidate(world, kingdom.id);
    if (!successor) return;
    state.sovereignCharacterId = successor.id; kingdom.rulerId = successor.id; crown && (crown.holderCharacterId = successor.id);
    state.legitimacy = clamp(state.legitimacy - (preferred ? 8 : 26) + successor.renown * .12, 8, 100);
    successor.visualRole = 'king'; successor.politicalInfluence = Math.max(successor.politicalInfluence ?? 0, 80); addUnique(successor.nobleTitleIds!, state.sovereignTitleId);
    state.heirCharacterId = chooseHeir(world, kingdom, successor)?.id;
    state.regentCharacterId = successor.age < 16 ? chooseRegent(world, kingdom, successor)?.id : undefined;
    state.history.push(`${successor.name} занял престол после смерти или исчезновения ${oldName}.`);
    recordStateEvent(world, {
      kind: 'state', title: `${successor.name} занял престол государства ${kingdom.name}`, description: preferred ? 'Наследование прошло по признанному порядку.' : 'Явного наследника не оказалось, и престол получил сильнейший претендент.',
      cause: `смерть или исчезновение правителя ${oldName}`, consequences: [preferred ? 'династия сохранила власть' : 'легитимность власти снизилась', state.regentCharacterId ? 'назначен регент' : 'новый правитель принял власть'],
      entityRefs: [{ kind: 'kingdomGovernment', id: state.id }, { kind: 'kingdom', id: kingdom.id }, { kind: 'character', id: successor.id }], importance: 5,
    });
    if (!preferred || state.legitimacy < 42 || successor.age < 16) createCrisis(world, state, successor.age < 16 ? 'регентский кризис' : 'кризис наследования', undefined, successor.id, clamp(45 + (42 - state.legitimacy), 35, 85), tick);
  }
  sovereign = livingCharacter(world, state.sovereignCharacterId);
  if (!sovereign) return;
  kingdom.rulerId = sovereign.id;
  if (crown) { crown.holderCharacterId = sovereign.id; crown.legitimacy = state.legitimacy; crown.status = 'действует'; }
  const heir = state.heirCharacterId ? livingCharacter(world, state.heirCharacterId) : undefined;
  if (!heir || heir.kingdomId !== kingdom.id) state.heirCharacterId = chooseHeir(world, kingdom, sovereign)?.id;
  if (sovereign.age >= 16) state.regentCharacterId = undefined;
  else if (!livingCharacter(world, state.regentCharacterId)) state.regentCharacterId = chooseRegent(world, kingdom, sovereign)?.id;

  for (const titleId of state.titleIds) {
    const title = world.nobleTitles.find(item => item.id === titleId);
    if (!title) continue;
    const holder = livingCharacter(world, title.holderCharacterId);
    if (holder) continue;
    const settlement = title.settlementId ? world.settlements.find(item => item.id === title.settlementId) : undefined;
    const replacement = title.rank === 'корона' ? sovereign : settlement ? chooseTitleHolder(world, kingdom, settlement, sovereign, rng) : sovereign;
    title.holderCharacterId = replacement.id; title.status = title.claimantIds.length ? 'оспаривается' : 'действует'; title.legitimacy = clamp(title.legitimacy - 12 + replacement.renown * .12, 12, 95);
    title.history.push(`${replacement.name} унаследовал или получил владение.`); addUnique(replacement.nobleTitleIds!, title.id);
  }
}

function synchronizeCourt(world: WorldState, kingdom: Kingdom, state: KingdomGovernment, rng: RNG, tick: number): void {
  const used = new Set<number>();
  for (const officeId of state.courtOfficeIds) {
    const office = world.courtOffices.find(item => item.id === officeId);
    if (!office) continue;
    const holder = office.holderCharacterId ? livingCharacter(world, office.holderCharacterId) : undefined;
    if (holder && holder.kingdomId === kingdom.id && holder.legalStatus !== 'заключён') { used.add(holder.id); office.competence = competenceFor(holder, office.kind); office.loyalty = clamp(holder.loyalty + (holder.courtFactionId === crownFaction(world, state)?.id ? 8 : 0), 0, 100); continue; }
    if (holder) holder.courtOfficeIds = (holder.courtOfficeIds ?? []).filter(id => id !== office.id);
    const replacement = chooseOfficeHolder(world, kingdom, state, office.kind, used, rng);
    office.holderCharacterId = replacement?.id; office.appointedTick = tick; office.vacantSinceTick = replacement ? undefined : office.vacantSinceTick ?? tick;
    office.competence = replacement ? competenceFor(replacement, office.kind) : 0; office.loyalty = replacement?.loyalty ?? 0;
    office.history.push(replacement ? `${replacement.name} назначен на освободившуюся должность.` : 'После выбытия прежнего чиновника должность осталась вакантной.');
    if (replacement) { used.add(replacement.id); addUnique(replacement.courtOfficeIds!, office.id); replacement.visualRole ??= 'official'; }
  }
  const filled = state.courtOfficeIds.map(id => world.courtOffices.find(item => item.id === id)).filter((item): item is CourtOffice => Boolean(item?.holderCharacterId));
  state.administration = clamp(15 + average(filled.map(item => item.competence)) * .65 - state.corruption * .25, 5, 100);
}

function updateVassals(world: WorldState, kingdom: Kingdom, state: KingdomGovernment, rng: RNG, tick: number): void {
  const sovereign = world.nobleTitles.find(item => item.id === state.sovereignTitleId);
  if (!sovereign) return;
  for (const contractId of state.vassalContractIds) {
    const contract = world.vassalContracts.find(item => item.id === contractId);
    if (!contract) continue;
    const title = world.nobleTitles.find(item => item.id === contract.vassalTitleId);
    const vassal = title ? livingCharacter(world, title.holderCharacterId) : undefined;
    if (!title || !vassal || title.kingdomId !== kingdom.id) continue;
    contract.vassalCharacterId = vassal.id; contract.liegeCharacterId = sovereign.holderCharacterId; contract.autonomy = title.autonomy;
    const settlement = title.settlementId ? world.settlements.find(item => item.id === title.settlementId) : undefined;
    const localGovernment = settlement ? world.settlementGovernments.find(item => item.settlementId === settlement.id) : undefined;
    const unrestPenalty = settlement ? settlement.unrest * .16 : 0;
    const dynastyBonus = vassal.dynastyId && vassal.dynastyId === livingCharacter(world, state.sovereignCharacterId)?.dynastyId ? 8 : 0;
    const officeBonus = (vassal.courtOfficeIds?.length ?? 0) * 4;
    const arrearsPenalty = Math.min(25, contract.taxArrears / 20);
    contract.loyalty = clamp(contract.loyalty + dynastyBonus * .04 + officeBonus * .04 - unrestPenalty * .03 - arrearsPenalty * .04 + rng.int(-2, 2), 0, 100);
    if (contract.loyalty < 18) contract.status = 'мятеж';
    else if (contract.loyalty < 35) contract.status = 'отказывается';
    else if (contract.loyalty < 55) contract.status = 'напряжение';
    else contract.status = 'верен';
    if (localGovernment && tick - contract.lastPaidTick >= 1) {
      const baseDue = Math.max(0, Math.min(localGovernment.treasury * contract.taxRate, (settlement?.population ?? 0) * .08));
      const withheld = contract.status === 'мятеж' ? baseDue : contract.status === 'отказывается' ? baseDue * rng.int(45, 90) / 100 : contract.status === 'напряжение' ? baseDue * rng.int(5, 35) / 100 : 0;
      const paid = Math.max(0, Math.min(localGovernment.treasury, baseDue - withheld));
      localGovernment.treasury -= paid; kingdom.treasury += paid; state.monthlyTaxIncome += paid; contract.taxArrears += baseDue - paid;
      if (paid > 0) contract.lastPaidTick = tick;
      if (withheld > 0) contract.history.push(`Вассал удержал ${withheld.toFixed(1)} крон налога.`);
    }
  }
}

function runStateBudget(world: WorldState, kingdom: Kingdom, state: KingdomGovernment, rng: RNG, tick: number): void {
  state.monthlyTaxIncome = Math.max(0, state.monthlyTaxIncome);
  state.monthlyCourtCost = 0; state.monthlyInfrastructureCost = 0; state.monthlyReliefCost = 0;
  const offices = state.courtOfficeIds.map(id => world.courtOffices.find(item => item.id === id)).filter((item): item is CourtOffice => Boolean(item));
  for (const office of offices) {
    if (!office.holderCharacterId) continue;
    const holder = livingCharacter(world, office.holderCharacterId);
    if (!holder) continue;
    const due = office.salary;
    const paid = Math.min(Math.max(0, kingdom.treasury), due);
    kingdom.treasury -= paid; state.monthlyCourtCost += paid;
    holder.wallet += paid * .35;
    const household = holder.householdId ? world.households.find(item => item.id === holder.householdId) : undefined;
    if (household) household.wealth += paid * .65;
    if (paid < due) { state.debt += due - paid; office.loyalty = clamp(office.loyalty - 3, 0, 100); }
  }

  const capitalGovernment = world.settlementGovernments.find(item => item.settlementId === state.capitalSettlementId);
  if (capitalGovernment && capitalGovernment.treasury > 40 && kingdom.treasury < 20) {
    const emergency = Math.min(capitalGovernment.treasury * .08, 12);
    capitalGovernment.treasury -= emergency; kingdom.treasury += emergency; state.monthlyTaxIncome += emergency;
  }

  const urgent = world.settlements.filter(item => item.kingdomId === kingdom.id && (item.shortages.length || item.damaged > 55 || item.unrest > 75));
  if (urgent.length && kingdom.treasury > 45 && rng.chance(.18 + state.administration / 500)) {
    const target = [...urgent].sort((a, b) => b.unrest + b.damaged - a.unrest - a.damaged)[0]!;
    const local = world.settlementGovernments.find(item => item.settlementId === target.id);
    const relief = Math.min(kingdom.treasury * .04, Math.max(4, target.population * .015));
    kingdom.treasury -= relief; if (local) local.treasury += relief; state.monthlyReliefCost += relief;
    target.unrest = clamp(target.unrest - relief / 4, 0, 100);
  }

  const maintenance = Math.min(Math.max(0, kingdom.treasury), Math.max(0, world.settlements.filter(item => item.kingdomId === kingdom.id).length * .6));
  kingdom.treasury -= maintenance; state.monthlyInfrastructureCost += maintenance;
  if (state.debt > 0 && kingdom.treasury > 80) {
    const repayment = Math.min(state.debt, kingdom.treasury * .03);
    kingdom.treasury -= repayment; state.debt -= repayment;
  }
  state.corruption = clamp(state.corruption + (state.administration < 35 ? .35 : -.15) + (kingdom.treasury < 0 ? .4 : 0), 0, 100);
  state.legitimacy = clamp(state.legitimacy + (kingdom.stability - 50) / 500 - state.debt / 30000, 0, 100);
  if (tick % 12 === 0) state.history.push(`Годовой итог: налогов ${state.monthlyTaxIncome.toFixed(1)}, двор ${state.monthlyCourtCost.toFixed(1)}, долг ${state.debt.toFixed(1)}.`);
}

function updateFactions(world: WorldState, kingdom: Kingdom, state: KingdomGovernment, rng: RNG, tick: number): void {
  const warActive = world.wars.some(war => war.active && (war.attackerId === kingdom.id || war.defenderId === kingdom.id));
  const realmUnrest = average(world.settlements.filter(item => item.kingdomId === kingdom.id).map(item => item.unrest));
  for (const factionId of state.factionIds) {
    const faction = world.courtFactions.find(item => item.id === factionId);
    if (!faction) continue;
    faction.memberIds = faction.memberIds.filter(id => livingCharacter(world, id));
    let leader = livingCharacter(world, faction.leaderCharacterId);
    if (!leader) {
      const candidates = factionMembers(world, world.characters.filter(character => character.alive && character.kingdomId === kingdom.id), state, faction.kind);
      leader = candidates.sort((a, b) => factionLeadershipScore(b, faction.kind) - factionLeadershipScore(a, faction.kind))[0] ?? strongestRealmCandidate(world, kingdom.id) ?? livingCharacter(world, state.sovereignCharacterId);
      if (!leader) continue;
      faction.leaderCharacterId = leader.id; addUnique(faction.memberIds, leader.id); faction.history.push(`${leader.name} возглавил группировку.`);
    }
    faction.influence = clamp(faction.influence + faction.memberIds.length / 80 + (leader.courtOfficeIds?.length ?? 0) * .2 - .2, 4, 95);
    let drift = (state.legitimacy - 50) / 180 + (leader.loyalty - 50) / 200 - realmUnrest / 500;
    if (faction.kind === 'армия') drift += warActive ? .35 : state.monthlyCourtCost < 5 ? -.25 : 0;
    if (faction.kind === 'купцы') drift += world.tradeRoutes.some(route => route.active && route.controlledByKingdomIds.includes(kingdom.id)) ? .18 : -.2;
    if (faction.kind === 'народ') drift += world.settlements.some(item => item.kingdomId === kingdom.id && item.shortages.length) ? -.8 : .15;
    if (faction.kind === 'корона') drift += .35;
    faction.loyalty = clamp(faction.loyalty + drift + rng.int(-2, 2), 0, 100);
    faction.status = faction.loyalty < 18 ? 'заговор' : faction.loyalty < 38 ? 'в оппозиции' : faction.loyalty < 66 ? 'торгуется' : 'лояльна';
    faction.grievance = factionGrievance(faction.kind, state, realmUnrest, warActive);
    if (tick % 12 === 0 && faction.status !== 'лояльна') faction.history.push(`Группировка требует: ${faction.goal}. Причина: ${faction.grievance}.`);
  }
}

function maybeCreateOrder(world: WorldState, kingdom: Kingdom, state: KingdomGovernment, rng: RNG, tick: number): void {
  if (world.royalOrders.some(order => order.kingdomId === kingdom.id && ['обсуждается', 'утверждён', 'в пути'].includes(order.status))) return;
  if (tick % 2 !== kingdom.id % 2) return;
  const settlements = world.settlements.filter(item => item.kingdomId === kingdom.id);
  if (!settlements.length) return;
  const arrears = state.vassalContractIds.map(id => world.vassalContracts.find(item => item.id === id)).filter((item): item is VassalContract => Boolean(item)).sort((a, b) => b.taxArrears - a.taxArrears)[0];
  const crisis = state.crisisIds.map(id => world.stateCrises.find(item => item.id === id)).find(item => item && ['назревает', 'активен'].includes(item.status));
  const needy = [...settlements].filter(item => item.shortages.length || item.damaged > 45).sort((a, b) => b.damaged + b.unrest - a.damaged - a.unrest)[0];
  const unsafe = [...settlements].sort((a, b) => (a.defense - b.defense) || b.unrest - a.unrest)[0];
  let kind: RoyalOrderKind | undefined;
  let target: Settlement | undefined;
  let reason = '';
  let cost = 0;
  if (needy && kingdom.treasury > 20) { kind = 'помощь поселению'; target = needy; reason = needy.shortages.length ? `нехватка: ${needy.shortages.join(', ')}` : 'поселение сильно повреждено'; cost = Math.max(5, needy.population * .02); }
  else if (arrears && arrears.taxArrears > 30) { kind = 'требование налогов'; target = world.settlements.find(item => item.id === world.nobleTitles.find(title => title.id === arrears.vassalTitleId)?.settlementId); reason = `налоговая недоимка ${arrears.taxArrears.toFixed(1)} крон`; }
  else if (crisis && crisis.severity > 55) { kind = 'дарование автономии'; target = world.settlements.find(item => crisis.settlementIds.includes(item.id)); reason = 'попытка остановить внутренний конфликт уступками'; }
  else if (unsafe && unsafe.defense < 38 && kingdom.treasury > 45) { kind = 'укрепление границы'; target = unsafe; reason = 'слабая оборона и риск нападения'; cost = 35; }
  else if (state.corruption > 55) { kind = 'расследование коррупции'; target = controlledCapital(world, kingdom.id); reason = `коррупция двора достигла ${Math.round(state.corruption)}%`; cost = 8; }
  else if (rng.chance(.06)) { kind = 'назначение чиновника'; target = controlledCapital(world, kingdom.id); reason = 'двору требуется усиление управления'; cost = 4; }
  if (!kind || !target) return;
  const ruler = livingCharacter(world, state.sovereignCharacterId);
  if (!ruler) return;
  ensureCharacterMind(world, ruler);
  const urgency = target.unrest + target.damaged + (target.shortages.length ? 35 : 0) + (kind === 'требование налогов' ? Math.min(50, arrears?.taxArrears ?? 0) : 0);
  const options = [
    scoreMotivatedAction(world, ruler, { id: 'delay', label: 'Отложить решение', base: 12, orderBenefit: -Math.min(25, urgency * .18), risk: Math.max(0, urgency * .12), wealthGain: cost > 0 ? 6 : 0 }),
    scoreMotivatedAction(world, ruler, {
      id: kind, label: `${kind}: ${target.name}`, base: 18 + urgency * .18, orderBenefit: kind === 'помощь поселению' || kind === 'укрепление границы' ? 28 : 12,
      powerGain: kind === 'требование налогов' || kind === 'расследование коррупции' ? 22 : 8,
      familyBenefit: kind === 'помощь поселению' ? 14 : 0, wealthGain: kind === 'требование налогов' ? 24 : -cost,
      risk: kind === 'требование налогов' ? 18 : 7, socialApproval: kind === 'помощь поселению' ? 25 : 5,
    }),
  ];
  const chosen = [...options].sort((a, b) => b.utility - a.utility)[0]!;
  if (chosen.id === 'delay') return;
  const decision = recordDecision(world, {
    actorRef: { kind: 'character', id: ruler.id }, goal: reason, context: `совет государства ${kingdom.name} обсуждает распоряжение для ${target.name}`,
    knownFactIds: decisionKnowledge(world, { kind: 'character', id: ruler.id }), options, chosenOptionId: kind,
    tags: ['королевский указ', kind, 'государственное решение'],
  });
  setDecisionMoment(world, ruler);
  createOrder(world, kingdom, state, kind, target, reason, cost, tick, decision.id);
}

function createOrder(world: WorldState, kingdom: Kingdom, state: KingdomGovernment, kind: RoyalOrderKind, target: Settlement, reason: string, cost: number, tick: number, decisionId?: number): RoyalOrder {
  const ruler = livingCharacter(world, state.sovereignCharacterId)!;
  const capital = controlledCapital(world, kingdom.id) ?? target;
  const factId = world.nextIds.knowledgeFact++;
  const fact = {
    id: factId, topic: 'государство' as const, subjectRef: { kind: 'kingdom' as const, id: kingdom.id }, statement: `${ruler.name} приказал: ${kind} для ${target.name}.`, canonicalStatement: `${ruler.name} приказал: ${kind} для ${target.name}.`,
    truth: 100, verified: true, importance: 3, secrecy: kind === 'расследование коррупции' ? 55 : 8, originSettlementId: capital.id, originCharacterId: ruler.id,
    createdTick: tick, tags: ['государственный приказ', kind], history: [`Приказ утверждён советом в ${world.year}.${String(world.month).padStart(2, '0')}.`],
  };
  world.knowledgeFacts.push(fact);
  const distance = Math.hypot(capital.x - target.x, capital.y - target.y);
  const messageId = world.nextIds.message++;
  world.messages.push({
    id: messageId, kind: 'королевский указ', senderCharacterId: ruler.id, recipientKingdomId: kingdom.id, fromSettlementId: capital.id, toSettlementId: target.id,
    knowledgeFactIds: [factId], departedTick: tick, arrivalTick: tick + Math.max(1, Math.ceil(distance / 4)), status: 'в пути', reliability: clamp(88 + state.administration * .08, 80, 99), sealed: kind === 'расследование коррупции', history: ['Указ запечатан и передан гонцу.'],
  });
  const order: RoyalOrder = {
    id: world.nextIds.royalOrder++, kingdomId: kingdom.id, kind, issuerCharacterId: ruler.id, targetSettlementId: target.id, messageId, factId,
    status: 'в пути', priority: kind === 'помощь поселению' ? 5 : 3, cost, createdTick: tick, dispatchedTick: tick, reason, history: ['Совет обсудил приказ, казначей проверил расходы, гонец выехал из столицы.'],
  };
  world.royalOrders.push(order); addUnique(state.orderIds, order.id);
  const beforeDecision = state.activeDecision;
  state.activeDecision = `${kind}: ${target.name}`;
  const delta = recordStateDelta(world, { entityRef: { kind: 'kingdomGovernment', id: state.id }, field: 'activeDecision/orderIds', before: { activeDecision: beforeDecision, orderIds: state.orderIds.filter(id => id !== order.id) }, after: { activeDecision: state.activeDecision, orderIds: state.orderIds }, cause: reason, decisionId });
  const event = recordStateEvent(world, { kind: 'state', title: `Издан приказ: ${kind}`, description: `Гонец отправлен из ${capital.name} в ${target.name}.`, cause: reason, conditions: [`решение принял ${ruler.name}`, 'совет рассмотрел цену, срочность и риск'], decision: decisionId ? world.decisions.find(item => item.id === decisionId)?.reason : undefined, outcome: 'приказ запечатан и передан гонцу', consequences: ['исполнение начнётся только после доставки указа'], entityRefs: [{ kind: 'royalOrder', id: order.id }, { kind: 'kingdomGovernment', id: state.id }, { kind: 'settlement', id: target.id }, { kind: 'message', id: messageId }], importance: 3, decisionId, stateDeltaIds: delta ? [delta.id] : [] });
  linkDecisionToEvent(world, decisionId, event, delta ? [delta.id] : []);
  return order;
}

function processOrders(world: WorldState, kingdom: Kingdom, state: KingdomGovernment, rng: RNG, tick: number): void {
  for (const orderId of state.orderIds) {
    const order = world.royalOrders.find(item => item.id === orderId);
    if (!order || ['исполнен', 'отказано', 'провален'].includes(order.status)) continue;
    const target = order.targetSettlementId ? world.settlements.find(item => item.id === order.targetSettlementId) : undefined;
    const message = order.messageId ? world.messages.find(item => item.id === order.messageId) : undefined;
    if (message?.status === 'утрачено' || message?.status === 'перехвачено') {
      order.status = 'провален'; order.resolvedTick = tick; order.outcome = message.status === 'утрачено' ? 'указ пропал в дороге' : 'указ был перехвачен'; order.history.push(order.outcome); continue;
    }
    if (!message || message.status !== 'доставлено') continue;
    if (!target || target.kingdomId !== kingdom.id) { order.status = 'провален'; order.outcome = 'цель приказа больше не подчиняется государству'; order.resolvedTick = tick; continue; }
    const title = world.nobleTitles.find(item => item.settlementId === target.id && item.kingdomId === kingdom.id);
    const contract = title ? world.vassalContracts.find(item => item.vassalTitleId === title.id) : undefined;
    const refusalChance = contract ? clamp((45 - contract.loyalty + contract.autonomy * .2) / 100, 0, .75) : 0;
    if (contract && rng.chance(refusalChance) && order.kind !== 'дарование автономии' && order.kind !== 'помощь поселению') {
      order.status = 'отказано'; order.resolvedTick = tick; order.outcome = 'местный вассал отказался исполнять указ'; order.history.push(order.outcome);
      contract.loyalty = clamp(contract.loyalty - 12, 0, 100); contract.status = contract.loyalty < 18 ? 'мятеж' : 'отказывается';
      createCrisis(world, state, 'вассальный мятеж', contract.vassalCharacterId, undefined, clamp(38 + contract.autonomy * .35, 35, 80), tick, [target.id]);
      continue;
    }
    executeOrder(world, kingdom, state, order, target, contract, rng, tick);
  }
}

function executeOrder(world: WorldState, kingdom: Kingdom, state: KingdomGovernment, order: RoyalOrder, target: Settlement, contract: VassalContract | undefined, rng: RNG, tick: number): void {
  let outcome = '';
  if (order.kind === 'помощь поселению') {
    const local = world.settlementGovernments.find(item => item.settlementId === target.id);
    const paid = Math.min(Math.max(0, kingdom.treasury), order.cost);
    kingdom.treasury -= paid; if (local) local.treasury += paid; state.monthlyReliefCost += paid; target.unrest = clamp(target.unrest - paid / 2.5, 0, 100);
    outcome = `передано ${paid.toFixed(1)} крон местной власти`;
  } else if (order.kind === 'укрепление границы') {
    const type = target.type === 'fortress' || target.type === 'city' ? 'watchtower' : 'barracks';
    const project = requestConstructionProject(world, target, type, `королевский приказ: ${order.reason}`, rng);
    outcome = project ? `утверждена стройка «${project.name}»` : 'существующая стройка или здание уже закрывает потребность';
  } else if (order.kind === 'требование налогов') {
    const local = world.settlementGovernments.find(item => item.settlementId === target.id);
    const demanded = contract ? Math.min(contract.taxArrears, local?.treasury ?? 0) : 0;
    if (local && demanded > 0) { local.treasury -= demanded; kingdom.treasury += demanded; contract!.taxArrears -= demanded; contract!.loyalty = clamp(contract!.loyalty - 5, 0, 100); }
    outcome = demanded > 0 ? `взыскано ${demanded.toFixed(1)} крон недоимки` : 'в местной казне не оказалось средств';
  } else if (order.kind === 'расследование коррупции') {
    const reduction = rng.int(4, 14); state.corruption = clamp(state.corruption - reduction, 0, 100); outcome = `коррупция снижена на ${reduction} пунктов`;
  } else if (order.kind === 'дарование автономии') {
    if (contract) { contract.autonomy = clamp(contract.autonomy + 12, 0, 100); contract.loyalty = clamp(contract.loyalty + 18, 0, 100); contract.taxRate = clamp(contract.taxRate - .025, .03, .3); contract.status = 'напряжение'; }
    outcome = contract ? 'вассалу дарованы новые права и снижена налоговая доля' : 'поселению подтверждены местные права';
  } else if (order.kind === 'назначение чиновника') {
    const vacancy = state.courtOfficeIds.map(id => world.courtOffices.find(item => item.id === id)).find(item => item && !item.holderCharacterId);
    outcome = vacancy ? 'начат поиск кандидата на вакантную должность' : 'двор получил дополнительные полномочия'; state.administration = clamp(state.administration + 3, 0, 100);
  } else if (order.kind === 'созыв ополчения') {
    const army = world.armies.find(item => item.kingdomId === kingdom.id);
    if (army) { army.morale = clamp(army.morale + 4, 0, 100); army.readiness = clamp(army.readiness + 6, 0, 100); }
    outcome = army ? 'местное ополчение приведено в готовность' : 'в государстве нет действующей армии';
  } else outcome = 'указ исполнен местной властью';
  order.status = 'исполнен'; order.resolvedTick = tick; order.outcome = outcome; order.history.push(outcome); state.activeDecision = 'контроль исполнения государственных указов';
  recordStateEvent(world, { kind: 'state', title: `Исполнен приказ: ${order.kind}`, description: `${target.name}: ${outcome}.`, cause: order.reason, consequences: ['решение изменило местные ресурсы или обязанности'], entityRefs: [{ kind: 'royalOrder', id: order.id }, { kind: 'settlement', id: target.id }, { kind: 'kingdomGovernment', id: state.id }], importance: 2 });
}

function maybeStartCrisis(world: WorldState, kingdom: Kingdom, state: KingdomGovernment, rng: RNG, tick: number): void {
  if (world.stateCrises.some(item => item.kingdomId === kingdom.id && ['назревает', 'активен'].includes(item.status))) return;
  const factions = state.factionIds.map(id => world.courtFactions.find(item => item.id === id)).filter((item): item is CourtFaction => Boolean(item && item.kind !== 'корона'));
  const hostile = [...factions].sort((a, b) => (a.loyalty - b.loyalty) || b.influence - a.influence)[0];
  const rebellious = state.vassalContractIds.map(id => world.vassalContracts.find(item => item.id === id)).filter((item): item is VassalContract => Boolean(item)).sort((a, b) => a.loyalty - b.loyalty)[0];
  if (rebellious?.status === 'мятеж' && rng.chance(.2 + rebellious.autonomy / 250)) {
    const settlementId = world.nobleTitles.find(item => item.id === rebellious.vassalTitleId)?.settlementId;
    createCrisis(world, state, 'вассальный мятеж', rebellious.vassalCharacterId, undefined, clamp(45 + rebellious.autonomy * .35, 45, 86), tick, settlementId ? [settlementId] : []);
  } else if (hostile && hostile.status === 'заговор' && hostile.influence > 28 && rng.chance(.08 + hostile.influence / 500)) {
    createCrisis(world, state, hostile.kind === 'армия' ? 'переворот' : 'заговор', hostile.leaderCharacterId, undefined, clamp(35 + hostile.influence * .5 + (35 - hostile.loyalty), 35, 82), tick, [], hostile.id);
  } else if (state.legitimacy < 28 && rng.chance(.12)) {
    createCrisis(world, state, 'кризис наследования', hostile?.leaderCharacterId, hostile?.leaderCharacterId, clamp(50 - state.legitimacy + (hostile?.influence ?? 20) * .4, 40, 85), tick, [], hostile?.id);
  }
}

function createCrisis(world: WorldState, state: KingdomGovernment, kind: StateCrisisKind, instigatorCharacterId: number | undefined, claimantCharacterId: number | undefined, severity: number, tick: number, settlementIds: number[] = [], factionId?: number): StateCrisis {
  const duplicate = world.stateCrises.find(item => item.kingdomId === state.kingdomId && item.kind === kind && ['назревает', 'активен'].includes(item.status));
  if (duplicate) { duplicate.severity = clamp(Math.max(duplicate.severity, severity), 0, 100); duplicate.settlementIds = [...new Set([...duplicate.settlementIds, ...settlementIds])]; return duplicate; }
  const crisis: StateCrisis = {
    id: world.nextIds.stateCrisis++, kingdomId: state.kingdomId, kind, instigatorCharacterId, claimantCharacterId, factionId,
    settlementIds, severity, support: Math.max(8, severity * .55), opposition: Math.max(10, state.legitimacy * .65 + state.centralization * .25),
    status: severity >= 55 ? 'активен' : 'назревает', startedTick: tick, history: [`Кризис начался в ${world.year}.${String(world.month).padStart(2, '0')}.`],
  };
  world.stateCrises.push(crisis); addUnique(state.crisisIds, crisis.id);
  recordStateEvent(world, { kind: 'rebellion', title: `${kind} в государстве ${world.kingdoms.find(item => item.id === state.kingdomId)?.name ?? state.kingdomId}`, description: instigatorCharacterId ? `${livingCharacter(world, instigatorCharacterId)?.name ?? 'Неизвестный претендент'} собирает сторонников.` : 'Внутренняя борьба перешла в открытую фазу.', cause: `низкая лояльность, спор о власти и легитимность ${Math.round(state.legitimacy)}%`, consequences: ['налоги и приказы могут быть сорваны', 'вассалы выбирают сторону'], entityRefs: [{ kind: 'stateCrisis', id: crisis.id }, { kind: 'kingdomGovernment', id: state.id }, { kind: 'kingdom', id: state.kingdomId }], importance: severity >= 70 ? 5 : 4 });
  return crisis;
}

function advanceCrises(world: WorldState, kingdom: Kingdom, state: KingdomGovernment, rng: RNG, tick: number): void {
  for (const crisisId of state.crisisIds) {
    const crisis = world.stateCrises.find(item => item.id === crisisId);
    if (!crisis || !['назревает', 'активен'].includes(crisis.status)) continue;
    const faction = crisis.factionId ? world.courtFactions.find(item => item.id === crisis.factionId) : undefined;
    const instigator = crisis.instigatorCharacterId ? livingCharacter(world, crisis.instigatorCharacterId) : undefined;
    const settlements = crisis.settlementIds.length ? world.settlements.filter(item => crisis.settlementIds.includes(item.id)) : world.settlements.filter(item => item.kingdomId === kingdom.id && item.unrest > 55).slice(0, 3);
    crisis.settlementIds = [...new Set([...crisis.settlementIds, ...settlements.map(item => item.id)])];
    crisis.support = clamp(crisis.support + (faction?.influence ?? 0) * .03 + average(settlements.map(item => item.unrest)) * .04 + rng.int(-3, 4), 0, 100);
    crisis.opposition = clamp(crisis.opposition + state.legitimacy * .025 + state.centralization * .02 + world.armies.filter(item => item.kingdomId === kingdom.id).reduce((sum, army) => sum + army.readiness, 0) / 150 + rng.int(-3, 4), 0, 120);
    crisis.severity = clamp(crisis.severity + (crisis.support - crisis.opposition) / 30 + rng.int(-2, 2), 0, 100);
    if (crisis.status === 'назревает' && crisis.severity >= 55) crisis.status = 'активен';
    if (crisis.status === 'активен') {
      for (const settlement of settlements) settlement.unrest = clamp(settlement.unrest + crisis.severity / 80, 0, 100);
      if (crisis.severity >= 76 && crisis.kind !== 'гражданская война') { crisis.kind = 'гражданская война'; crisis.history.push('Противостояние переросло в гражданскую войну.'); }
    }
    const age = tick - crisis.startedTick;
    if (age < 4) continue;
    if (!instigator && crisis.instigatorCharacterId) crisis.support = clamp(crisis.support - 12, 0, 100);
    if (crisis.opposition > crisis.support + 22 || crisis.severity < 18) {
      crisis.status = 'подавлен'; crisis.resolvedTick = tick; state.legitimacy = clamp(state.legitimacy + 6, 0, 100); faction && (faction.loyalty = clamp(faction.loyalty + 10, 0, 100));
      if (instigator) { instigator.legalStatus = 'под стражей'; instigator.biography.push(`Был арестован после провала кризиса «${crisis.kind}».`); }
      crisis.history.push('Корона подавила сопротивление и восстановила контроль.');
      recordCrisisResolution(world, state, crisis, 'Корона сохранила власть.');
    } else if (crisis.support > crisis.opposition + 20 && crisis.severity > 70) {
      const claimant = crisis.claimantCharacterId ? livingCharacter(world, crisis.claimantCharacterId) : instigator;
      if (claimant && crisis.kind !== 'вассальный мятеж' && crisis.kind !== 'сепаратизм') {
        const old = livingCharacter(world, state.sovereignCharacterId); state.sovereignCharacterId = claimant.id; kingdom.rulerId = claimant.id;
        const crown = world.nobleTitles.find(item => item.id === state.sovereignTitleId); crown && (crown.holderCharacterId = claimant.id);
        state.legitimacy = clamp(38 + claimant.renown * .35, 20, 80); claimant.visualRole = 'king'; claimant.biography.push(`Захватил власть в государстве ${kingdom.name}.`);
        if (old) { old.titles = old.titles.filter(title => !title.toLowerCase().includes('правитель')); old.biography.push(`Был свергнут во время кризиса «${crisis.kind}».`); }
        crisis.status = 'победа мятежников'; crisis.history.push(`${claimant.name} получил верховную власть.`);
      } else {
        for (const contract of state.vassalContractIds.map(id => world.vassalContracts.find(item => item.id === id)).filter((item): item is VassalContract => Boolean(item))) {
          if (!crisis.settlementIds.includes(world.nobleTitles.find(title => title.id === contract.vassalTitleId)?.settlementId ?? -1)) continue;
          contract.autonomy = clamp(contract.autonomy + 22, 0, 100); contract.taxRate = clamp(contract.taxRate - .04, .02, .3); contract.status = 'напряжение'; contract.loyalty = 42;
        }
        crisis.status = 'урегулирован'; crisis.history.push('Корона признала широкую автономию мятежных владений.');
      }
      crisis.resolvedTick = tick; recordCrisisResolution(world, state, crisis, crisis.status === 'победа мятежников' ? 'Власть перешла победителям.' : 'Конфликт завершён уступками.');
    } else if (age > 30) {
      crisis.status = 'урегулирован'; crisis.resolvedTick = tick; state.legitimacy = clamp(state.legitimacy - 4, 0, 100); crisis.history.push('Стороны истощились и заключили шаткое соглашение.'); recordCrisisResolution(world, state, crisis, 'Стороны прекратили открытую борьбу.');
    }
  }
}

function advanceDiplomacy(world: WorldState, rng: RNG, tick: number): void {
  for (const agreement of world.diplomaticAgreements) {
    if (agreement.status === 'переговоры' && agreement.messageId) {
      const message = world.messages.find(item => item.id === agreement.messageId);
      if (message?.status === 'утрачено' || message?.status === 'перехвачено') { agreement.status = 'отклонён'; agreement.history.push('Посольство не достигло двора назначения.'); continue; }
      if (message?.status !== 'доставлено') continue;
      const [aId, bId] = agreement.kingdomIds;
      const relation = world.kingdoms.find(item => item.id === aId)?.diplomacy.find(item => item.kingdomId === bId)?.score ?? 0;
      const acceptThreshold = agreement.kind === 'оборонительный союз' ? 42 : agreement.kind === 'династический брак' ? 30 : agreement.kind === 'торговый договор' ? 5 : -5;
      if (relation + rng.int(-18, 18) >= acceptThreshold) {
        agreement.status = 'действует'; agreement.signedTick = tick; agreement.expiresTick = tick + rng.int(60, 180); agreement.history.push('Послы обменялись печатями, договор вступил в силу.');
        updateDiplomacyScore(world, aId, bId, agreement.kind === 'оборонительный союз' ? 24 : 12);
        const aState = world.kingdomGovernments.find(item => item.kingdomId === aId); const bState = world.kingdomGovernments.find(item => item.kingdomId === bId);
        aState && addUnique(aState.agreementIds, agreement.id); bState && addUnique(bState.agreementIds, agreement.id);
        recordStateEvent(world, { kind: 'diplomacy', title: `Заключён договор: ${agreement.kind}`, description: `${world.kingdoms.find(item => item.id === aId)?.name} и ${world.kingdoms.find(item => item.id === bId)?.name} согласовали условия.`, cause: 'переговоры послов и взаимная выгода', consequences: agreement.terms, entityRefs: [{ kind: 'diplomaticAgreement', id: agreement.id }, { kind: 'kingdom', id: aId }, { kind: 'kingdom', id: bId }], importance: 4 });
      } else { agreement.status = 'отклонён'; agreement.history.push('Двор назначения отверг предложение.'); updateDiplomacyScore(world, aId, bId, -4); }
    }
    if (agreement.status === 'действует' && agreement.expiresTick && agreement.expiresTick <= tick) { agreement.status = 'истёк'; agreement.history.push('Срок договора истёк.'); }
  }
  if (world.month !== 2 && world.month !== 8) return;
  const kingdoms = [...world.kingdoms].sort((a, b) => a.id - b.id);
  for (let i = 0; i < kingdoms.length; i += 1) for (let j = i + 1; j < kingdoms.length; j += 1) {
    const a = kingdoms[i]!; const b = kingdoms[j]!;
    if (world.wars.some(war => war.active && [war.attackerId, war.defenderId].includes(a.id) && [war.attackerId, war.defenderId].includes(b.id))) continue;
    if (world.diplomaticAgreements.some(item => item.kingdomIds.includes(a.id) && item.kingdomIds.includes(b.id) && ['переговоры', 'действует'].includes(item.status))) continue;
    const relation = a.diplomacy.find(item => item.kingdomId === b.id)?.score ?? 0;
    if (relation < -10 || !rng.chance(.035 + Math.max(0, relation) / 1800)) continue;
    const kind: DiplomaticAgreementKind = relation > 55 ? 'оборонительный союз' : relation > 25 ? (rng.chance(.3) ? 'династический брак' : 'ненападение') : 'торговый договор';
    createDiplomaticAgreement(world, rng.chance(.5) ? a : b, rng.chance(.5) ? b : a, kind, tick);
  }
}

function createDiplomaticAgreement(world: WorldState, initiator: Kingdom, target: Kingdom, kind: DiplomaticAgreementKind, tick: number): DiplomaticAgreement | undefined {
  if (initiator.id === target.id) return undefined;
  const from = controlledCapital(world, initiator.id); const to = controlledCapital(world, target.id);
  const initiatorState = world.kingdomGovernments.find(item => item.kingdomId === initiator.id);
  if (!from || !to || !initiatorState) return undefined;
  const factId = world.nextIds.knowledgeFact++;
  world.knowledgeFacts.push({ id: factId, topic: 'государство', subjectRef: { kind: 'kingdom', id: target.id }, statement: `${initiator.name} предлагает договор: ${kind}.`, canonicalStatement: `${initiator.name} предлагает договор: ${kind}.`, truth: 100, verified: true, importance: 3, secrecy: kind === 'династический брак' ? 35 : 10, originSettlementId: from.id, originCharacterId: initiator.rulerId, createdTick: tick, tags: ['дипломатия', kind], history: ['Предложение составлено придворной канцелярией.'] });
  const messageId = world.nextIds.message++;
  world.messages.push({ id: messageId, kind: 'письмо', senderCharacterId: initiator.rulerId, recipientCharacterId: target.rulerId, recipientKingdomId: target.id, fromSettlementId: from.id, toSettlementId: to.id, knowledgeFactIds: [factId], departedTick: tick, arrivalTick: tick + Math.max(1, Math.ceil(Math.hypot(from.x - to.x, from.y - to.y) / 4)), status: 'в пути', reliability: 94, sealed: true, history: ['Посольство отправилось к соседнему двору.'] });
  const agreement: DiplomaticAgreement = { id: world.nextIds.diplomaticAgreement++, kingdomIds: [initiator.id, target.id], kind, status: 'переговоры', initiatorKingdomId: initiator.id, messageId, tributeAmount: kind === 'дань' ? 20 : 0, terms: agreementTerms(kind), history: ['Предложение передано послам.'] };
  world.diplomaticAgreements.push(agreement); addUnique(initiatorState.agreementIds, agreement.id);
  return agreement;
}

function seedHistoricalAgreements(world: WorldState, rng: RNG, tick: number): void {
  if (world.diplomaticAgreements.length) return;
  for (const kingdom of world.kingdoms) {
    for (const relation of kingdom.diplomacy) {
      if (kingdom.id > relation.kingdomId || relation.score < 55 || !rng.chance(.3)) continue;
      const other = world.kingdoms.find(item => item.id === relation.kingdomId);
      if (!other) continue;
      const agreement: DiplomaticAgreement = { id: world.nextIds.diplomaticAgreement++, kingdomIds: [kingdom.id, other.id], kind: relation.status === 'союз' ? 'оборонительный союз' : 'торговый договор', status: 'действует', initiatorKingdomId: kingdom.id, signedTick: Math.max(0, tick - rng.int(12, 120)), expiresTick: tick + rng.int(24, 120), tributeAmount: 0, terms: relation.status === 'союз' ? ['взаимная оборона', 'право прохода послов'] : ['снижение пошлин', 'защита караванов'], history: ['Договор заключён до начала подробной хроники.'] };
      world.diplomaticAgreements.push(agreement);
      const aState = world.kingdomGovernments.find(item => item.kingdomId === kingdom.id); const bState = world.kingdomGovernments.find(item => item.kingdomId === other.id);
      aState && addUnique(aState.agreementIds, agreement.id); bState && addUnique(bState.agreementIds, agreement.id);
    }
  }
}

function recordStateEvent(world: WorldState, input: Parameters<typeof appendCausalEvent>[1]): ReturnType<typeof appendCausalEvent> {
  const event = appendCausalEvent(world, input);
  if (world.simulation.knowledgeSystemVersion === 1) registerWorldEventKnowledge(world, event, { createRumor: event.importance >= 4 });
  return event;
}

function recordCrisisResolution(world: WorldState, state: KingdomGovernment, crisis: StateCrisis, description: string): void {
  recordStateEvent(world, { kind: 'rebellion', title: `Завершён кризис: ${crisis.kind}`, description, cause: 'соотношение сил двора, вассалов и группировок изменилось', consequences: [crisis.status === 'подавлен' ? 'корона восстановила контроль' : crisis.status === 'победа мятежников' ? 'власть сменилась' : 'заключено внутреннее соглашение'], entityRefs: [{ kind: 'stateCrisis', id: crisis.id }, { kind: 'kingdomGovernment', id: state.id }, { kind: 'kingdom', id: state.kingdomId }], importance: 5 });
}

function strongestRealmCandidate(world: WorldState, kingdomId: number): Character | undefined {
  return world.characters.filter(character => character.alive && character.kingdomId === kingdomId && character.age >= 16 && character.legalStatus !== 'заключён')
    .sort((a, b) => politicalScore(b) - politicalScore(a) || a.id - b.id)[0];
}

function chooseHeir(world: WorldState, kingdom: Kingdom, ruler: Character): Character | undefined {
  const children = ruler.childIds.map(id => livingCharacter(world, id)).filter((item): item is Character => Boolean(item && item.kingdomId === kingdom.id)).sort((a, b) => b.age - a.age || b.renown - a.renown);
  if (children.length) return children[0];
  const dynasty = ruler.dynastyId ? world.dynasties.find(item => item.id === ruler.dynastyId) : undefined;
  const kin = dynasty?.memberIds.map(id => livingCharacter(world, id)).filter((item): item is Character => Boolean(item && item.kingdomId === kingdom.id && item.id !== ruler.id && item.age >= 12)).sort((a, b) => politicalScore(b) - politicalScore(a));
  return kin?.[0] ?? strongestRealmCandidate(world, kingdom.id);
}

function chooseRegent(world: WorldState, kingdom: Kingdom, ruler: Character): Character | undefined {
  const parent = ruler.parentIds.map(id => livingCharacter(world, id)).find(item => item?.kingdomId === kingdom.id);
  if (parent) return parent;
  return world.characters.filter(character => character.alive && character.kingdomId === kingdom.id && character.age >= 25 && character.id !== ruler.id && character.legalStatus !== 'заключён').sort((a, b) => politicalScore(b) - politicalScore(a))[0];
}

function chooseTitleHolder(world: WorldState, kingdom: Kingdom, settlement: Settlement, ruler: Character, rng: RNG): Character {
  const local = world.characters.filter(character => character.alive && character.kingdomId === kingdom.id && character.settlementId === settlement.id && character.age >= 18 && character.legalStatus !== 'заключён');
  const unused = local.filter(character => !(character.nobleTitleIds?.length));
  const candidates = unused.length ? unused : local;
  return [...candidates].sort((a, b) => politicalScore(b) - politicalScore(a) || rng.int(-1, 1))[0] ?? ruler;
}

function chooseOfficeHolder(world: WorldState, kingdom: Kingdom, state: KingdomGovernment, kind: CourtOfficeKind, used: Set<number>, rng: RNG): Character | undefined {
  const capital = controlledCapital(world, kingdom.id);
  const definition = OFFICE_DEFINITIONS[kind];
  const candidates = world.characters.filter(character => character.alive && character.kingdomId === kingdom.id && character.age >= 18 && character.legalStatus !== 'заключён' && !used.has(character.id));
  return [...candidates].sort((a, b) => {
    const aPreferred = definition.professions.includes(a.profession) ? 35 : 0; const bPreferred = definition.professions.includes(b.profession) ? 35 : 0;
    const aCapital = capital && a.settlementId === capital.id ? 8 : 0; const bCapital = capital && b.settlementId === capital.id ? 8 : 0;
    return (bPreferred + bCapital + competenceFor(b, kind) + rng.int(-2, 2)) - (aPreferred + aCapital + competenceFor(a, kind) + rng.int(-2, 2));
  })[0];
}

function factionMembers(world: WorldState, residents: Character[], state: KingdomGovernment, kind: CourtFactionKind): Character[] {
  if (kind === 'корона') return residents.filter(character => character.id === state.sovereignCharacterId || character.dynastyId === livingCharacter(world, state.sovereignCharacterId)?.dynastyId || (character.courtOfficeIds?.length ?? 0));
  if (kind === 'знать') return residents.filter(character => (character.nobleTitleIds?.length ?? 0) || character.titles.length || character.renown >= 50);
  if (kind === 'армия') return residents.filter(character => character.militaryRole || ['soldier', 'guard', 'hunter'].includes(character.profession));
  if (kind === 'духовенство') return residents.filter(character => character.profession === 'priest');
  if (kind === 'купцы') return residents.filter(character => ['merchant', 'scribe'].includes(character.profession) || character.wealth >= 80);
  return residents.filter(character => character.wealth < 30 && !character.titles.length && !character.militaryRole).slice(0, 50);
}

function governmentFormFor(kingdom: Kingdom, rng: RNG): GovernmentForm {
  if (kingdom.species === 'orc') return rng.chance(.72) ? 'племенной союз' : 'военная диктатура';
  if (kingdom.species === 'dwarf') return rng.chance(.55) ? 'выборная монархия' : 'городской союз';
  if (kingdom.species === 'elf') return rng.chance(.35) ? 'теократия' : 'выборная монархия';
  const roll = rng.next();
  return roll < .64 ? 'феодальная монархия' : roll < .73 ? 'республика' : roll < .82 ? 'выборная монархия' : roll < .9 ? 'теократия' : 'военная диктатура';
}

function successionLawFor(form: GovernmentForm, kingdom: Kingdom): string {
  if (form === 'республика' || form === 'городской союз') return 'выборы советом влиятельных граждан';
  if (form === 'выборная монархия') return 'правителя выбирают знатные дома и высшие должностные лица';
  if (form === 'теократия') return 'преемника утверждает высшее духовенство';
  if (form === 'племенной союз') return 'вождя признают сильнейшие кланы и военные дружины';
  if (form === 'военная диктатура') return 'власть получает командующий, удержавший армию и столицу';
  return kingdom.species === 'elf' ? 'наследование внутри старшей ветви дома с подтверждением совета' : 'наследование старшим признанным ребёнком правителя';
}

function sovereignTitleName(kingdom: Kingdom, form: GovernmentForm): string {
  if (form === 'республика') return `Первое кресло ${kingdom.name}`;
  if (form === 'городской союз') return `Высший совет ${kingdom.name}`;
  if (form === 'племенной союз') return `Верховное вождество ${kingdom.name}`;
  if (form === 'теократия') return `Священный престол ${kingdom.name}`;
  return `Корона ${kingdom.name}`;
}

function titleRank(settlement: Settlement): NobleRank {
  if (settlement.type === 'city' || settlement.type === 'fortress') return 'герцогство';
  if (settlement.type === 'town' || settlement.type === 'port') return 'графство';
  if (settlement.type === 'village') return 'баронство';
  return 'лордство';
}

function territorialTitleName(settlement: Settlement): string {
  const rank = titleRank(settlement);
  return `${rank[0]!.toUpperCase()}${rank.slice(1)} ${settlement.name}`;
}

function competenceFor(character: Character, kind: CourtOfficeKind): number {
  const professionSkill = character.skills[character.profession] ?? 12;
  const matching = OFFICE_DEFINITIONS[kind].professions.includes(character.profession) ? 18 : 0;
  return clamp(15 + professionSkill * .55 + character.renown * .18 + character.loyalty * .08 + matching, 5, 100);
}

function politicalScore(character: Character): number {
  return character.renown * .7 + character.loyalty * .25 + character.wealth * .08 + character.titles.length * 12 + (character.nobleTitleIds?.length ?? 0) * 18 + (character.courtOfficeIds?.length ?? 0) * 12 + (character.militaryRole === 'командир' ? 22 : character.militaryRole === 'офицер' ? 12 : 0);
}

function factionLeadershipScore(character: Character, kind: CourtFactionKind): number {
  let score = politicalScore(character);
  if (kind === 'армия' && character.militaryRole) score += 28;
  if (kind === 'духовенство' && character.profession === 'priest') score += 32;
  if (kind === 'купцы' && character.profession === 'merchant') score += 28;
  if (kind === 'народ' && character.wealth < 30) score += 16;
  if (kind === 'знать' && (character.nobleTitleIds?.length ?? 0)) score += 30;
  return score;
}

function factionName(kingdom: Kingdom, kind: CourtFactionKind): string {
  return kind === 'корона' ? `Сторонники короны ${kingdom.name}` : kind === 'знать' ? `Знатные дома ${kingdom.name}` : kind === 'армия' ? `Военный круг ${kingdom.name}` : kind === 'духовенство' ? `Высшее духовенство ${kingdom.name}` : kind === 'купцы' ? `Торговый союз ${kingdom.name}` : `Общинное движение ${kingdom.name}`;
}

function factionGrievance(kind: CourtFactionKind, state: KingdomGovernment, unrest: number, warActive: boolean): string {
  if (kind === 'знать') return state.centralization > 60 ? 'корона забирает слишком много полномочий' : 'двор раздаёт мало должностей и земель';
  if (kind === 'армия') return warActive ? 'армия требует снабжения и наград' : 'командиры недовольны бездействием и жалованием';
  if (kind === 'духовенство') return 'храмы требуют влияния на законы и двор';
  if (kind === 'купцы') return 'пошлины, опасные дороги и произвол чиновников мешают торговле';
  if (kind === 'народ') return unrest > 55 ? 'налоги, голод и бездомность вызывают злость' : 'общины требуют защиты и справедливых цен';
  return state.legitimacy < 45 ? 'власть правителя оспаривается' : 'корона требует большей дисциплины';
}

function agreementTerms(kind: DiplomaticAgreementKind): string[] {
  if (kind === 'оборонительный союз') return ['взаимная помощь при нападении', 'обмен военными донесениями'];
  if (kind === 'торговый договор') return ['снижение пошлин', 'защита купцов и караванов'];
  if (kind === 'династический брак') return ['брак представителей правящих домов', 'улучшение отношений и возможные наследственные притязания'];
  if (kind === 'дань') return ['регулярная выплата дани', 'отказ от части внешнеполитических притязаний'];
  if (kind === 'гарантия границ') return ['признание существующих границ', 'отказ от пограничных претензий'];
  return ['отказ от нападения', 'уведомление о расторжении договора'];
}

function updateDiplomacyScore(world: WorldState, aId: number, bId: number, delta: number): void {
  for (const [source, target] of [[aId, bId], [bId, aId]]) {
    const kingdom = world.kingdoms.find(item => item.id === source); if (!kingdom) continue;
    let record = kingdom.diplomacy.find(item => item.kingdomId === target);
    if (!record) { record = { kingdomId: target, score: 0, status: 'мир', reason: 'новые дипломатические контакты' }; kingdom.diplomacy.push(record); }
    record.score = clamp(record.score + delta, -100, 100);
    if (record.score >= 65) record.status = 'союз'; else if (record.score >= -20) record.status = 'мир'; else if (record.score > -75) record.status = 'напряжение';
    record.reason = delta > 0 ? 'договор и работа послов' : 'провал переговоров';
  }
}

function crownFaction(world: WorldState, state: KingdomGovernment): CourtFaction | undefined {
  return state.factionIds.map(id => world.courtFactions.find(item => item.id === id)).find(item => item?.kind === 'корона');
}

function livingCharacter(world: WorldState, id?: number): Character | undefined {
  if (!id) return undefined;
  return world.characters.find(character => character.id === id && character.alive);
}

function addUnique(list: number[], id: number): void { if (!list.includes(id)) list.push(id); }
function maxId(items: { id: number }[]): number { return items.reduce((max, item) => Math.max(max, item.id), 0); }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function average(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }

function trimStateCollections(world: WorldState): void {
  if (world.royalOrders.length > MAX_ORDERS) {
    const active = world.royalOrders.filter(item => !['исполнен', 'отказано', 'провален'].includes(item.status));
    const finished = world.royalOrders.filter(item => ['исполнен', 'отказано', 'провален'].includes(item.status)).sort((a, b) => (b.resolvedTick ?? b.createdTick) - (a.resolvedTick ?? a.createdTick)).slice(0, Math.max(0, MAX_ORDERS - active.length));
    world.royalOrders = [...active, ...finished].sort((a, b) => a.id - b.id);
    const ids = new Set(world.royalOrders.map(item => item.id));
    for (const state of world.kingdomGovernments) state.orderIds = state.orderIds.filter(id => ids.has(id));
  }
  if (world.stateCrises.length > MAX_CRISES) {
    const active = world.stateCrises.filter(item => ['назревает', 'активен'].includes(item.status));
    const finished = world.stateCrises.filter(item => !['назревает', 'активен'].includes(item.status)).sort((a, b) => (b.resolvedTick ?? b.startedTick) - (a.resolvedTick ?? a.startedTick)).slice(0, Math.max(0, MAX_CRISES - active.length));
    world.stateCrises = [...active, ...finished].sort((a, b) => a.id - b.id);
    const ids = new Set(world.stateCrises.map(item => item.id));
    for (const state of world.kingdomGovernments) state.crisisIds = state.crisisIds.filter(id => ids.has(id));
  }
  if (world.diplomaticAgreements.length > MAX_AGREEMENTS) {
    const active = world.diplomaticAgreements.filter(item => ['переговоры', 'действует'].includes(item.status));
    const finished = world.diplomaticAgreements.filter(item => !['переговоры', 'действует'].includes(item.status)).slice(-Math.max(0, MAX_AGREEMENTS - active.length));
    world.diplomaticAgreements = [...active, ...finished].sort((a, b) => a.id - b.id);
    const ids = new Set(world.diplomaticAgreements.map(item => item.id));
    for (const state of world.kingdomGovernments) state.agreementIds = state.agreementIds.filter(id => ids.has(id));
  }
}

export function stateMachineIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const kingdomIds = new Set(world.kingdoms.map(item => item.id));
  const settlementIds = new Set(world.settlements.map(item => item.id));
  const characterIds = new Set(world.characters.map(item => item.id));
  const titleIds = new Set(world.nobleTitles.map(item => item.id));
  const officeIds = new Set(world.courtOffices.map(item => item.id));
  const factionIds = new Set(world.courtFactions.map(item => item.id));
  const messageIds = new Set(world.messages.map(item => item.id));
  const seenStates = new Set<number>();
  for (const state of world.kingdomGovernments) {
    if (!kingdomIds.has(state.kingdomId)) issues.push(`Государственная система ${state.id}: отсутствует государство ${state.kingdomId}`);
    if (seenStates.has(state.kingdomId)) issues.push(`Государство ${state.kingdomId}: повтор государственной системы`); seenStates.add(state.kingdomId);
    if (!characterIds.has(state.sovereignCharacterId)) issues.push(`Государственная система ${state.id}: правитель отсутствует среди живых`);
    if (!settlementIds.has(state.capitalSettlementId)) issues.push(`Государственная система ${state.id}: столица отсутствует`);
    if (!titleIds.has(state.sovereignTitleId)) issues.push(`Государственная система ${state.id}: отсутствует верховный титул`);
    for (const id of state.courtOfficeIds) if (!officeIds.has(id)) issues.push(`Государственная система ${state.id}: отсутствует должность ${id}`);
    for (const id of state.factionIds) if (!factionIds.has(id)) issues.push(`Государственная система ${state.id}: отсутствует группировка ${id}`);
  }
  for (const title of world.nobleTitles) {
    if (!kingdomIds.has(title.kingdomId)) issues.push(`Титул ${title.id}: отсутствует государство`);
    if (!characterIds.has(title.holderCharacterId)) issues.push(`Титул ${title.id}: держатель отсутствует среди живых`);
    if (title.settlementId && !settlementIds.has(title.settlementId)) issues.push(`Титул ${title.id}: отсутствует владение`);
    if (title.liegeTitleId && !titleIds.has(title.liegeTitleId)) issues.push(`Титул ${title.id}: отсутствует сюзеренский титул`);
  }
  for (const contract of world.vassalContracts) {
    if (!titleIds.has(contract.liegeTitleId) || !titleIds.has(contract.vassalTitleId)) issues.push(`Вассальный договор ${contract.id}: отсутствует титул`);
    if (!characterIds.has(contract.liegeCharacterId) || !characterIds.has(contract.vassalCharacterId)) issues.push(`Вассальный договор ${contract.id}: отсутствует участник`);
  }
  for (const office of world.courtOffices) if (office.holderCharacterId && !characterIds.has(office.holderCharacterId)) issues.push(`Должность ${office.id}: чиновник отсутствует среди живых`);
  for (const faction of world.courtFactions) {
    if (!characterIds.has(faction.leaderCharacterId)) issues.push(`Группировка ${faction.id}: лидер отсутствует`);
    if (faction.memberIds.some(id => !characterIds.has(id))) issues.push(`Группировка ${faction.id}: содержит отсутствующего участника`);
  }
  for (const order of world.royalOrders) {
    if (!kingdomIds.has(order.kingdomId)) issues.push(`Приказ ${order.id}: отсутствует государство`);
    if (order.targetSettlementId && !settlementIds.has(order.targetSettlementId)) issues.push(`Приказ ${order.id}: отсутствует поселение-цель`);
    if (order.messageId && !messageIds.has(order.messageId)) issues.push(`Приказ ${order.id}: отсутствует послание`);
  }
  for (const agreement of world.diplomaticAgreements) if (agreement.kingdomIds.some(id => !kingdomIds.has(id))) issues.push(`Договор ${agreement.id}: отсутствует государство-участник`);
  return [...new Set(issues)];
}
