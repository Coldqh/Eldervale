import type {
  Building, BuildingType, Character, CivicPatrol, CourtCase, CrimeIncident, CrimeType, DistrictCivicState,
  FireIncident, SentenceKind, Settlement, SettlementGovernment, WorldEvent, WorldState,
} from '../types';
import type { WorldIndexes } from './indexes';
import { appendCausalEvent } from './causality';
import { registerWorldEventKnowledge } from './knowledgeSystem';
import { archiveCharactersBatch } from './mortality';
import { requestConstructionProject } from './agricultureConstruction';
import { assignBuildingFootprint, buildingDimensions, buildingRect } from './spatial';
import { RNG, hashSeed } from './rng';
import { worldTick } from './scheduler';
import { decisionKnowledge, linkDecisionToEvent, recordDecision, recordStateDelta } from './decisionCore';
import { addCharacterSecret, ensureCharacterMind, scoreMotivatedAction, setDecisionMoment } from './mindSystem';
import { applyJudicialInfluence, witnessWillReport } from './socialSystem';

const CIVIC_BUILDINGS: Partial<Record<BuildingType, { minPopulation: number; label: string; rooms: string[] }>> = {
  townHall: { minPopulation: 90, label: 'городская управа', rooms: ['зал совета', 'канцелярия', 'казначейская', 'приёмная'] },
  courthouse: { minPopulation: 260, label: 'суд', rooms: ['зал суда', 'архив дел', 'комната судьи', 'помещение стражи'] },
  prison: { minPopulation: 320, label: 'тюрьма', rooms: ['камеры', 'караульная', 'двор', 'склад'] },
  fireStation: { minPopulation: 170, label: 'пожарный двор', rooms: ['сарай вёдер', 'водяные бочки', 'помещение команды', 'конюшня'] },
  school: { minPopulation: 240, label: 'школа', rooms: ['учебная комната', 'комната наставника', 'кладовая книг'] },
  shelter: { minPopulation: 480, label: 'приют', rooms: ['общий зал', 'спальные места', 'кухня', 'кладовая'] },
};

const CRIME_TYPES: CrimeType[] = ['кража', 'грабёж', 'нападение', 'убийство', 'поджог', 'контрабанда', 'мошенничество', 'взлом', 'браконьерство'];

export function initializeSettlementLife(world: WorldState, rng = new RNG(`${world.config.seed}:жизнь-поселений`), indexes?: WorldIndexes): void {
  world.settlementGovernments ??= [];
  world.districtCivicStates ??= [];
  world.civicPatrols ??= [];
  world.crimes ??= [];
  world.courtCases ??= [];
  world.fireIncidents ??= [];
  world.nextIds.settlementGovernment ??= maxId(world.settlementGovernments) + 1;
  world.nextIds.districtCivic ??= maxId(world.districtCivicStates) + 1;
  world.nextIds.patrol ??= maxId(world.civicPatrols) + 1;
  world.nextIds.crime ??= maxId(world.crimes) + 1;
  world.nextIds.courtCase ??= maxId(world.courtCases) + 1;
  world.nextIds.fireIncident ??= maxId(world.fireIncidents) + 1;

  for (const character of world.characters) {
    character.legalStatus ??= 'свободен';
    character.wantedForCrimeIds ??= [];
    character.homeless ??= !character.homeBuildingId;
  }

  for (const settlement of world.settlements) {
    ensureDistrictStates(world, settlement);
    const government = ensureGovernment(world, settlement, rng, indexes);
    ensureHistoricalCivicBuildings(world, settlement, government, rng, indexes);
    ensurePatrols(world, settlement, government);
  }
  world.simulation.settlementLifeVersion = 1;
}

export function advanceSettlementLife(
  world: WorldState,
  rng: RNG,
  indexes: WorldIndexes,
  activeSettlementIds: ReadonlySet<number>,
  economySettlementIds: ReadonlySet<number>,
): void {
  if (world.simulation.settlementLifeVersion !== 1 || world.settlementGovernments.length !== world.settlements.length) initializeSettlementLife(world, rng, indexes);
  const tick = worldTick(world);
  releaseCompletedSentences(world, tick);
  cleanOrphanedCivicRecords(world);

  for (const settlement of world.settlements) {
    const active = activeSettlementIds.has(settlement.id);
    const economy = economySettlementIds.has(settlement.id);
    if (!active && !economy) continue;
    const government = world.settlementGovernments.find(item => item.settlementId === settlement.id);
    if (!government) continue;
    updateCivicRoster(world, settlement, government, indexes);
    updateHomelessness(world, settlement, government, indexes);
    updateDistrictConditions(world, settlement, government, active ? 1 : 6, indexes);
    collectLocalTaxes(world, settlement, government, active ? 1 : 6);
    fundServices(world, settlement, government, active ? 1 : 6, indexes);
    ensureFutureCivicProjects(world, settlement, rng);
    if (active) {
      advancePatrols(world, settlement, government, rng);
      maybeCommitCrime(world, settlement, government, rng, indexes);
      investigateCrimes(world, settlement, government, rng);
      processCourtCases(world, settlement, government, rng);
      maybeStartFire(world, settlement, government, rng);
      advanceFires(world, settlement, government, rng, indexes);
    } else if (world.month === 1 || world.month === 7) {
      aggregateDistantDisorder(world, settlement, government, rng);
    }
  }
  cleanOrphanedCivicRecords(world);
  trimCivicHistory(world);
}

function ensureGovernment(world: WorldState, settlement: Settlement, rng: RNG, indexes?: WorldIndexes): SettlementGovernment {
  const existing = world.settlementGovernments.find(item => item.settlementId === settlement.id);
  if (existing) return existing;
  const residents = residentsOf(world, settlement.id, indexes).filter(character => character.alive && character.age >= 18);
  const leader = [...residents].sort((a, b) => leadershipScore(b) - leadershipScore(a) || a.id - b.id)[0];
  if (!leader) throw new Error(`${settlement.name}: невозможно создать местную власть без взрослых жителей`);
  const council = [...residents]
    .filter(character => character.id !== leader.id)
    .sort((a, b) => councilScore(b) - councilScore(a) || a.id - b.id)
    .slice(0, Math.max(2, Math.min(8, Math.ceil(settlement.population / 350))));
  const treasurySeed = Math.max(25, Math.round(settlement.population * (.4 + settlement.prosperity / 90)));
  const government: SettlementGovernment = {
    id: world.nextIds.settlementGovernment++, settlementId: settlement.id, leaderCharacterId: leader.id,
    councilCharacterIds: council.map(item => item.id), treasury: treasurySeed, monthlyTaxIncome: 0, monthlyExpenses: 0,
    corruption: rng.int(2, Math.min(55, 8 + Math.round(settlement.unrest / 3))), guardIds: [], judgeIds: [], firefighterIds: [], teacherIds: [], gravediggerIds: [], prisonerIds: [],
    laws: ['запрет ночного грабежа', 'обязанность тушить соседний пожар', 'рыночные меры и весы', 'штраф за нападение в пределах поселения'],
    activeDecision: 'поддержание порядка и запасов', history: [`Местное управление оформлено не позднее ${world.year} года.`],
  };
  leader.visualRole = leader.titles.length ? leader.visualRole ?? 'official' : 'mayor';
  world.settlementGovernments.push(government);
  return government;
}

function ensureDistrictStates(world: WorldState, settlement: Settlement): void {
  for (const district of settlement.districts) {
    if (world.districtCivicStates.some(item => item.settlementId === settlement.id && item.districtName === district.name)) continue;
    const water = world.buildings.some(building => building.globalX === district.x && building.globalY === district.y && building.hasWater) ? 86 : district.role === 'центр' ? 64 : 42;
    const baseSafety = clamp(48 + settlement.defense * .25 + settlement.prosperity * .18 - settlement.unrest * .35, 8, 95);
    world.districtCivicStates.push({
      id: world.nextIds.districtCivic++, settlementId: settlement.id, districtName: district.name,
      safety: clamp(baseSafety + (district.role === 'крепость' ? 20 : district.role === 'окраина' ? -14 : 0), 5, 100),
      cleanliness: clamp(38 + settlement.prosperity * .45 - (district.role === 'рынок' ? 8 : 0), 8, 96),
      fireRisk: clamp(58 - settlement.prosperity * .18 + (district.role === 'жилой район' ? 12 : district.role === 'ремесленный район' ? 18 : 0), 8, 95),
      waterAccess: water, rentMultiplier: district.role === 'центр' ? 1.35 : district.role === 'окраина' ? .65 : 1,
      crimeRate: clamp(42 + settlement.unrest * .32 - baseSafety * .24, 4, 90), homelessCount: 0, patrolIds: [], history: [],
    });
  }
}

function ensureHistoricalCivicBuildings(world: WorldState, settlement: Settlement, government: SettlementGovernment, rng: RNG, indexes?: WorldIndexes): void {
  const age = Math.max(0, world.year - settlement.foundedYear);
  for (const [type, definition] of Object.entries(CIVIC_BUILDINGS) as [BuildingType, NonNullable<(typeof CIVIC_BUILDINGS)[BuildingType]>][]) {
    if (settlement.population < definition.minPopulation || age < 15 || world.buildings.some(building => building.settlementId === settlement.id && building.type === type)) continue;
    const district = chooseDistrict(settlement, type);
    const dimensions = buildingDimensions(type, type === 'townHall' || type === 'courthouse' ? 2 : 1);
    const id = world.nextIds.building++;
    const building: Building = {
      id, settlementId: settlement.id, districtName: district.name, globalX: district.x, globalY: district.y,
      localX: 4 + hashSeed(`${world.config.seed}:служба:${id}:x`) % Math.max(6, world.config.localMapSize - dimensions.width - 8),
      localY: 4 + hashSeed(`${world.config.seed}:служба:${id}:y`) % Math.max(6, world.config.localMapSize - dimensions.height - 8),
      localWidth: dimensions.width, localHeight: dimensions.height, entranceX: 0, entranceY: 0,
      name: `${definition.label} ${settlement.name}`, type, floors: type === 'townHall' || type === 'courthouse' ? 2 : 1,
      capacity: Math.max(8, dimensions.width * dimensions.height), condition: rng.int(68, 98), builtYear: rng.int(Math.max(settlement.foundedYear, world.year - Math.max(15, age)), Math.max(settlement.foundedYear, world.year - 1)),
      ownerCharacterId: government.leaderCharacterId, residentIds: [], workerIds: [], inventoryItemIds: [], rooms: definition.rooms,
      hasWater: type !== 'prison' || rng.chance(.7), hasHearth: !['fireStation'].includes(type), history: [`Служит поселению ${settlement.name}.`],
    };
    assignBuildingFootprint(world, building);
    world.buildings.push(building); settlement.buildingIds.push(building.id);
    indexes?.buildingById.set(building.id, building);
    if (indexes) {
      const list = indexes.buildingsBySettlement.get(settlement.id) ?? [];
      list.push(building); indexes.buildingsBySettlement.set(settlement.id, list);
    }
  }
}

function ensureFutureCivicProjects(world: WorldState, settlement: Settlement, rng: RNG): void {
  for (const [type, definition] of Object.entries(CIVIC_BUILDINGS) as [BuildingType, NonNullable<(typeof CIVIC_BUILDINGS)[BuildingType]>][]) {
    if (settlement.population < definition.minPopulation) continue;
    const exists = world.buildings.some(item => item.settlementId === settlement.id && item.type === type)
      || world.constructionProjects.some(item => item.settlementId === settlement.id && item.buildingType === type && item.stage !== 'заброшено');
    if (!exists && rng.chance(.12)) requestConstructionProject(world, settlement, type, `поселению требуется ${definition.label}`, rng);
  }
}

function updateCivicRoster(world: WorldState, settlement: Settlement, government: SettlementGovernment, indexes: WorldIndexes): void {
  const allLiving = residentsOf(world, settlement.id, indexes).filter(character => character.alive);
  const residents = allLiving.filter(character => character.age >= 16 && character.legalStatus !== 'заключён');
  const currentLeader = indexes.characterById.get(government.leaderCharacterId);
  if (!currentLeader?.alive || currentLeader.settlementId !== settlement.id || currentLeader.legalStatus === 'заключён') {
    const successor = [...residents].sort((a, b) => leadershipScore(b) - leadershipScore(a) || a.id - b.id)[0] ?? allLiving[0];
    if (successor) {
      const previousId = government.leaderCharacterId;
      government.leaderCharacterId = successor.id;
      successor.visualRole = successor.titles.length ? successor.visualRole ?? 'official' : 'mayor';
      government.history.push(`В ${world.year} году ${successor.name} возглавил местное управление после выбытия руководителя ${previousId}.`);
    } else {
      government.leaderCharacterId = 0;
      government.activeDecision = 'поселение обезлюдело, управление не действует';
    }
  }
  const councilTarget = Math.max(2, Math.min(8, Math.ceil(settlement.population / 350)));
  const validCouncil = government.councilCharacterIds.filter(id => {
    const character = indexes.characterById.get(id);
    return Boolean(character?.alive && character.settlementId === settlement.id && character.age >= 16 && character.legalStatus !== 'заключён' && id !== government.leaderCharacterId);
  });
  const replacements = [...residents]
    .filter(character => character.id !== government.leaderCharacterId && !validCouncil.includes(character.id))
    .sort((a, b) => councilScore(b) - councilScore(a) || a.id - b.id)
    .slice(0, Math.max(0, councilTarget - validCouncil.length));
  government.councilCharacterIds = [...validCouncil, ...replacements.map(character => character.id)].slice(0, councilTarget);
  government.guardIds = pickRole(residents, ['guard', 'soldier'], Math.max(2, Math.min(30, Math.ceil(settlement.population / 90))), government.guardIds, 'guard');
  government.judgeIds = pickRole(residents, ['scribe', 'priest'], Math.max(1, Math.ceil(settlement.population / 900)), government.judgeIds, 'judge');
  government.firefighterIds = pickRole(residents, ['carpenter', 'guard', 'laborer', 'farmer'], Math.max(2, Math.min(18, Math.ceil(settlement.population / 180))), government.firefighterIds, 'firefighter');
  government.teacherIds = pickRole(residents, ['scribe', 'priest'], Math.max(1, Math.ceil(settlement.population / 700)), government.teacherIds, 'teacher');
  government.gravediggerIds = pickRole(residents, ['farmer', 'laborer', 'guard'], Math.max(1, Math.ceil(settlement.population / 1200)), government.gravediggerIds, 'gravedigger');
  government.prisonerIds = residentsOf(world, settlement.id, indexes).filter(character => character.legalStatus === 'заключён').map(character => character.id);
  const buildingByType = (type: BuildingType) => world.buildings.find(building => building.settlementId === settlement.id && building.type === type);
  attachWorkers(buildingByType('townHall'), [government.leaderCharacterId, ...government.councilCharacterIds]);
  attachWorkers(buildingByType('courthouse'), government.judgeIds);
  attachWorkers(buildingByType('prison'), government.guardIds.slice(0, Math.max(2, Math.ceil(government.guardIds.length / 4))));
  attachWorkers(buildingByType('fireStation'), government.firefighterIds);
  attachWorkers(buildingByType('school'), government.teacherIds);
}

function ensurePatrols(world: WorldState, settlement: Settlement, government: SettlementGovernment): void {
  const tick = worldTick(world);
  for (const district of settlement.districts) {
    for (const shift of ['дневная', 'ночная'] as const) {
      let patrol = world.civicPatrols.find(item => item.settlementId === settlement.id && item.districtName === district.name && item.shift === shift);
      if (!patrol) {
        patrol = { id: world.nextIds.patrol++, settlementId: settlement.id, districtName: district.name, guardIds: [], shift, status: 'отдыхает', arrests: 0, lastPatrolTick: tick, history: [] };
        world.civicPatrols.push(patrol);
      }
      const state = world.districtCivicStates.find(item => item.settlementId === settlement.id && item.districtName === district.name);
      if (state && !state.patrolIds.includes(patrol.id)) state.patrolIds.push(patrol.id);
    }
  }
  distributePatrolGuards(world, settlement, government);
}

function distributePatrolGuards(world: WorldState, settlement: Settlement, government: SettlementGovernment): void {
  const patrols = world.civicPatrols.filter(item => item.settlementId === settlement.id);
  patrols.forEach(item => { item.guardIds = []; });
  government.guardIds.forEach((id, index) => { if (patrols.length) patrols[index % patrols.length]!.guardIds.push(id); });
}

function advancePatrols(world: WorldState, settlement: Settlement, government: SettlementGovernment, rng: RNG): void {
  distributePatrolGuards(world, settlement, government);
  const tick = worldTick(world);
  for (const patrol of world.civicPatrols.filter(item => item.settlementId === settlement.id)) {
    patrol.status = patrol.guardIds.length ? 'патрулирует' : 'разбита';
    patrol.lastPatrolTick = tick;
    const state = world.districtCivicStates.find(item => item.settlementId === settlement.id && item.districtName === patrol.districtName);
    if (!state) continue;
    const strength = patrol.guardIds.length * (patrol.shift === 'ночная' ? .8 : 1);
    state.safety = clamp(state.safety + Math.min(2.2, strength * .3) - state.crimeRate * .006, 0, 100);
    if (rng.chance(.02) && patrol.guardIds.length) patrol.history.push(`В ${world.year}.${String(world.month).padStart(2, '0')} проверил рынок и ворота.`);
  }
  government.activeDecision = settlement.unrest > 55 ? 'усилить ночные патрули' : government.treasury < 10 ? 'сократить расходы служб' : 'поддерживать порядок';
}

function maybeCommitCrime(world: WorldState, settlement: Settlement, government: SettlementGovernment, rng: RNG, indexes: WorldIndexes): void {
  const states = world.districtCivicStates.filter(item => item.settlementId === settlement.id);
  if (!states.length) return;
  const averageCrime = states.reduce((sum, item) => sum + item.crimeRate, 0) / states.length;
  const poverty = states.reduce((sum, item) => sum + item.homelessCount, 0) / Math.max(1, settlement.population);
  const opportunityChance = clamp(.008 + averageCrime / 1800 + settlement.unrest / 2300 + poverty * .22 - government.guardIds.length / Math.max(1, settlement.population) * 1.5, .002, .24);
  if (!rng.chance(opportunityChance)) return;
  const district = rng.weighted(states.map(item => ({ value: item, weight: Math.max(1, item.crimeRate + item.homelessCount * 4) })));
  const residents = residentsOf(world, settlement.id, indexes).filter(character => character.alive && character.age >= 14 && character.legalStatus !== 'заключён');
  if (residents.length < 2) return;
  const candidates = residents.filter(character => character.id !== government.leaderCharacterId && !government.guardIds.includes(character.id));
  if (!candidates.length) return;

  const evaluated = candidates.map(character => {
    const mind = ensureCharacterMind(world, character);
    const household = character.householdId ? world.households.find(item => item.id === character.householdId) : undefined;
    const scarcity = Math.max(character.needs.hunger, household?.needs.hunger ?? 0, character.homeless ? 78 : 0);
    const anger = mind.emotions.anger;
    const guardPressure = government.guardIds.length / Math.max(1, settlement.population) * 900 + district.safety * .25;
    const options = [
      scoreMotivatedAction(world, character, {
        id: 'abstain', label: 'Не совершать преступление', base: 18, orderBenefit: 25, socialApproval: 16,
        survivalBenefit: scarcity < 55 ? 8 : -8, freedomBenefit: 7,
      }),
      scoreMotivatedAction(world, character, {
        id: 'кража', label: 'Совершить кражу', base: scarcity * .24 + district.crimeRate * .12,
        wealthGain: 22, survivalBenefit: scarcity * .35, risk: 18 + guardPressure * .18, harm: 8, deception: 24, legalPenalty: 24,
      }),
      scoreMotivatedAction(world, character, {
        id: 'грабёж', label: 'Ограбить жителя', base: scarcity * .18 + anger * .2,
        wealthGain: 32, survivalBenefit: scarcity * .22, risk: 30 + guardPressure * .2, harm: 24, deception: 8, violence: 28, legalPenalty: 38,
      }),
      scoreMotivatedAction(world, character, {
        id: 'нападение', label: 'Напасть на человека', base: anger * .48 + mind.traits.cruelty * .18,
        powerGain: 8, risk: 35 + guardPressure * .2, harm: 42, violence: 52, legalPenalty: 42,
      }),
      scoreMotivatedAction(world, character, {
        id: character.profession === 'merchant' || character.profession === 'scribe' ? 'мошенничество' : 'взлом',
        label: character.profession === 'merchant' || character.profession === 'scribe' ? 'Провести мошенничество' : 'Взломать помещение',
        base: scarcity * .12 + mind.traits.greed * .18, wealthGain: 28, risk: 24 + guardPressure * .16,
        harm: 10, deception: 38, legalPenalty: 30,
      }),
    ];
    const chosen = [...options].sort((a, b) => b.utility - a.utility)[0]!;
    const abstain = options[0]!;
    return { character, options, chosen, margin: chosen.id === 'abstain' ? -100 : chosen.utility - abstain.utility };
  }).sort((a, b) => b.margin - a.margin || b.chosen.utility - a.chosen.utility);

  const selected = evaluated[0];
  if (!selected || selected.margin < 4 || !rng.chance(Math.min(.82, .12 + selected.margin / 110))) return;
  const perpetrator = selected.character;
  const type = selected.chosen.id as CrimeType;
  const victims = residents.filter(character => character.id !== perpetrator.id);
  const victim = [...victims].sort((a, b) => {
    const aHouse = a.householdId ? world.households.find(item => item.id === a.householdId)?.wealth ?? a.wealth : a.wealth;
    const bHouse = b.householdId ? world.households.find(item => item.id === b.householdId)?.wealth ?? b.wealth : b.wealth;
    return (type === 'кража' || type === 'грабёж' || type === 'мошенничество' || type === 'взлом') ? bHouse - aHouse : Math.abs(a.id - perpetrator.id) - Math.abs(b.id - perpetrator.id);
  })[0] ?? rng.pick(victims);
  const severity = crimeSeverity(type);
  const potentialWitnesses = residents
    .filter(character => character.id !== perpetrator.id && character.id !== victim.id && character.homeDistrict === district.districtName)
    .filter(character => rng.chance(Math.max(.08, district.safety / 140)))
    .slice(0, Math.max(2, rng.int(1, 6)));
  const witnesses = potentialWitnesses.filter(character => witnessWillReport(world, character, perpetrator, victim, severity, rng).reports).slice(0, 4);
  const evidence = clamp(rng.int(6, 36) + witnesses.length * 16 + government.guardIds.length / Math.max(1, settlement.population) * 760, 0, 100);
  const decision = recordDecision(world, {
    actorRef: { kind: 'character', id: perpetrator.id }, goal: selected.chosen.id === 'нападение' ? 'выплеснуть злость или запугать жертву' : 'получить ресурсы незаконным путём',
    context: `${perpetrator.name} находится в районе ${district.districtName} поселения ${settlement.name}`,
    knownFactIds: decisionKnowledge(world, { kind: 'character', id: perpetrator.id }), options: selected.options, chosenOptionId: selected.chosen.id,
    tags: ['преступление', type, 'личное решение'],
  });
  setDecisionMoment(world, perpetrator);

  const crime: CrimeIncident = {
    id: world.nextIds.crime++, type, settlementId: settlement.id, districtName: district.districtName,
    perpetratorId: perpetrator.id, victimCharacterId: victim.id, victimEstablishmentId: type === 'кража' || type === 'взлом' ? rng.pick(world.establishments.filter(item => item.settlementId === settlement.id))?.id : undefined,
    witnessIds: witnesses.map(item => item.id), evidence, severity, stolenItemIds: [], status: witnesses.length || evidence >= 45 ? 'расследуется' : 'совершено', createdTick: worldTick(world), history: [`Совершено в районе ${district.districtName}.`, `Мотив: ${decision.reason}.`],
  };
  world.crimes.push(crime);
  const perpetratorBefore = { legalStatus: perpetrator.legalStatus, wantedForCrimeIds: [...(perpetrator.wantedForCrimeIds ?? [])] };
  const victimBefore = { health: victim.health, safety: victim.needs.safety, inventoryItemIds: [...victim.inventoryItemIds], wealth: victim.wealth };
  const districtBefore = district.crimeRate;
  perpetrator.wantedForCrimeIds ??= [];
  if (crime.status === 'расследуется') { perpetrator.wantedForCrimeIds.push(crime.id); perpetrator.legalStatus = 'разыскивается'; }
  district.crimeRate = clamp(district.crimeRate + severity * .8, 0, 100);
  victim.needs.safety = clamp(victim.needs.safety + severity * 3, 0, 100);
  if (type === 'кража' || type === 'грабёж' || type === 'взлом' || type === 'мошенничество') transferStolenProperty(world, perpetrator, victim, crime, rng);
  if (type === 'нападение' || type === 'убийство') victim.health = Math.max(type === 'убийство' ? 1 : 8, victim.health - rng.int(8, type === 'убийство' ? 80 : 35));
  if (!witnesses.length) addCharacterSecret(world, perpetrator, { kind: 'crime', severity: severity * 8, knownByCharacterIds: [perpetrator.id], exposed: false, summary: `${perpetrator.name} скрывает преступление «${crimeLabel(type)}» в ${settlement.name}.`, id: `crime:${crime.id}` });

  const deltaIds: number[] = [];
  for (const delta of [
    recordStateDelta(world, { entityRef: { kind: 'character', id: perpetrator.id }, field: 'legalStatus/wantedForCrimeIds', before: perpetratorBefore, after: { legalStatus: perpetrator.legalStatus, wantedForCrimeIds: perpetrator.wantedForCrimeIds }, cause: `совершено преступление ${crime.id}`, decisionId: decision.id }),
    recordStateDelta(world, { entityRef: { kind: 'character', id: victim.id }, field: 'health/safety/inventory/wealth', before: victimBefore, after: { health: victim.health, safety: victim.needs.safety, inventoryItemIds: victim.inventoryItemIds, wealth: victim.wealth }, cause: `жертва преступления ${crime.id}`, decisionId: decision.id }),
    recordStateDelta(world, { entityRef: { kind: 'settlement', id: settlement.id }, field: `district:${district.districtName}:crimeRate`, before: districtBefore, after: district.crimeRate, amount: district.crimeRate - districtBefore, cause: `преступление ${crime.id}`, decisionId: decision.id }),
  ]) if (delta) deltaIds.push(delta.id);

  const event = recordCivicEvent(world, {
    kind: 'crime', title: `${crimeLabel(type)} в ${settlement.name}`, description: witnesses.length ? `${witnesses.length} свидетелей сообщили страже.` : 'Очевидцев почти не оказалось.',
    cause: crimeCause(type, perpetrator, settlement), conditions: [`решение принял ${perpetrator.name}`, `лучший преступный вариант превысил отказ на ${Math.round(selected.margin)} пунктов`],
    decision: decision.reason, outcome: crime.status === 'расследуется' ? 'стража получила основания для расследования' : 'преступник пока не установлен',
    consequences: ['страх жителей вырос', crime.status === 'расследуется' ? 'стража начала расследование' : 'дело пока не раскрыто'],
    entityRefs: [{ kind: 'crime', id: crime.id }, { kind: 'settlement', id: settlement.id }, { kind: 'character', id: victim.id }, { kind: 'character', id: perpetrator.id }], importance: severity >= 8 ? 4 : 2,
    decisionId: decision.id, stateDeltaIds: deltaIds,
  });
  linkDecisionToEvent(world, decision.id, event, deltaIds);
}

function investigateCrimes(world: WorldState, settlement: Settlement, government: SettlementGovernment, rng: RNG): void {
  const patrols = world.civicPatrols.filter(item => item.settlementId === settlement.id && item.status === 'патрулирует');
  for (const crime of world.crimes.filter(item => item.settlementId === settlement.id && ['совершено', 'расследуется', 'подозреваемый найден'].includes(item.status))) {
    const perpetrator = crime.perpetratorId ? world.characters.find(item => item.id === crime.perpetratorId) : undefined;
    if (!perpetrator) { crime.status = 'не раскрыто'; continue; }
    const districtPatrol = patrols.find(item => item.districtName === crime.districtName);
    const investigation = crime.evidence + (districtPatrol?.guardIds.length ?? 0) * 8 + government.judgeIds.length * 5 - government.corruption * .35 + rng.int(-18, 22);
    if (investigation < 55) { crime.status = 'расследуется'; crime.evidence = clamp(crime.evidence + rng.int(1, 8), 0, 100); continue; }
    crime.status = 'передано в суд'; crime.resolvedTick = worldTick(world); perpetrator.legalStatus = 'под стражей';
    if (districtPatrol) { districtPatrol.arrests += 1; districtPatrol.status = 'реагирует'; }
    if (!world.courtCases.some(item => item.crimeId === crime.id)) {
      world.courtCases.push({ id: world.nextIds.courtCase++, crimeId: crime.id, settlementId: settlement.id, judgeId: government.judgeIds[0], defendantId: perpetrator.id, status: 'ожидает суда', sentenceMonths: 0, fine: 0, openedTick: worldTick(world), history: ['Стража передала материалы дела суду.'] });
    }
  }
}

function processCourtCases(world: WorldState, settlement: Settlement, government: SettlementGovernment, rng: RNG): void {
  const pending = world.courtCases.filter(item => item.settlementId === settlement.id && item.status !== 'завершено' && item.status !== 'прекращено').slice(0, Math.max(1, government.judgeIds.length));
  for (const courtCase of pending) {
    const crime = world.crimes.find(item => item.id === courtCase.crimeId);
    const defendant = courtCase.defendantId ? world.characters.find(item => item.id === courtCase.defendantId) : undefined;
    if (!crime || !defendant) { courtCase.status = 'прекращено'; continue; }
    courtCase.status = 'слушается';
    const judge = courtCase.judgeId ? world.characters.find(item => item.id === courtCase.judgeId) : undefined;
    const victim = crime.victimCharacterId ? world.characters.find(item => item.id === crime.victimCharacterId) : undefined;
    const influence = applyJudicialInfluence(world, judge, defendant, victim, crime.severity, rng);
    const guiltyScore = crime.evidence + crime.witnessIds.length * 12 - government.corruption * rng.int(0, 1) + influence.bias + rng.int(-15, 15);
    courtCase.history.push(`${influence.reason}; влияние на оценку дела ${influence.bias >= 0 ? '+' : ''}${influence.bias.toFixed(1)}${influence.bribe > 0 ? `, передано ${influence.bribe.toFixed(1)} крон` : ''}.`);
    const verdict = sentenceFor(crime, guiltyScore, rng);
    courtCase.verdict = verdict.kind; courtCase.sentenceMonths = verdict.months; courtCase.fine = verdict.fine; courtCase.closedTick = worldTick(world); courtCase.status = 'завершено';
    crime.status = verdict.kind === 'оправдание' ? 'не раскрыто' : 'раскрыто';
    defendant.wantedForCrimeIds = (defendant.wantedForCrimeIds ?? []).filter(id => id !== crime.id);
    applySentence(world, government, defendant, courtCase);
    recordCivicEvent(world, {
      kind: 'justice', title: `Суд по делу «${crimeLabel(crime.type)}»`, description: `${defendant.name}: ${sentenceText(courtCase)}.`,
      cause: `${crime.witnessIds.length} свидетелей и ${Math.round(crime.evidence)}% собранных улик`, consequences: [verdict.kind === 'оправдание' ? 'подсудимый освобождён' : 'приговор вступил в силу', 'решение стало известно в поселении'],
      entityRefs: [{ kind: 'courtCase', id: courtCase.id }, { kind: 'crime', id: crime.id }, { kind: 'character', id: defendant.id }, { kind: 'settlement', id: settlement.id }], importance: crime.severity >= 8 ? 4 : 2,
    });
  }
}

function maybeStartFire(world: WorldState, settlement: Settlement, government: SettlementGovernment, rng: RNG): void {
  if (world.fireIncidents.some(item => item.settlementId === settlement.id && (item.status === 'горит' || item.status === 'локализован'))) return;
  const states = world.districtCivicStates.filter(item => item.settlementId === settlement.id);
  if (!states.length) return;
  const risk = states.reduce((sum, item) => sum + item.fireRisk, 0) / states.length;
  const chance = clamp(.004 + risk / 2500 + settlement.damaged / 1800 - government.firefighterIds.length / Math.max(1, settlement.population) * 1.4, .002, .16);
  if (!rng.chance(chance)) return;
  const district = rng.weighted(states.map(item => ({ value: item, weight: Math.max(1, item.fireRisk) })));
  const candidates = world.buildings.filter(item => item.settlementId === settlement.id && item.districtName === district.districtName && item.condition > 0);
  const origin = candidates.length ? rng.pick(candidates) : rng.pick(world.buildings.filter(item => item.settlementId === settlement.id));
  if (!origin) return;
  const fire: FireIncident = {
    id: world.nextIds.fireIncident++, settlementId: settlement.id, originBuildingId: origin.id, affectedBuildingIds: [origin.id], firefighterIds: [],
    intensity: rng.int(24, 58), spreadRisk: clamp(district.fireRisk + rng.int(-8, 12), 5, 100), status: 'горит', startedTick: worldTick(world), deaths: 0, destroyedBuildingIds: [], history: [`Огонь начался в здании ${origin.name}.`],
  };
  world.fireIncidents.push(fire);
  addFireEffects(world, origin, fire.id, rng, 4);
  recordCivicEvent(world, {
    kind: 'fire', title: `Пожар в ${settlement.name}`, description: `Загорелось здание ${origin.name}.`, cause: origin.hasHearth ? 'неосторожность с очагом, искры или неисправная печь' : 'поджог, молния или работа с горючими материалами',
    consequences: ['пожарная команда поднята', 'соседи выносят воду и имущество'], entityRefs: [{ kind: 'fireIncident', id: fire.id }, { kind: 'building', id: origin.id }, { kind: 'settlement', id: settlement.id }], importance: 3,
  });
}

function advanceFires(world: WorldState, settlement: Settlement, government: SettlementGovernment, rng: RNG, indexes: WorldIndexes): void {
  for (const fire of world.fireIncidents.filter(item => item.settlementId === settlement.id && (item.status === 'горит' || item.status === 'локализован'))) {
    fire.firefighterIds = government.firefighterIds.filter(id => indexes.characterById.get(id)?.alive).slice(0, 20);
    const water = averageDistrict(world, settlement.id, 'waterAccess');
    const response = fire.firefighterIds.length * 5 + water * .35 + government.treasury * .01 + rng.int(-12, 14);
    fire.intensity = clamp(fire.intensity + fire.spreadRisk * .08 - response * .18, 0, 100);
    if (fire.intensity <= 12) {
      fire.status = 'потушен'; fire.endedTick = worldTick(world); fire.history.push('Огонь потушен до полного уничтожения квартала.');
      for (const id of fire.affectedBuildingIds) { const building = indexes.buildingById.get(id); if (building) building.condition = Math.max(1, building.condition - rng.int(4, 18)); }
      recordCivicEvent(world, { kind: 'fire', title: `Пожар в ${settlement.name} потушен`, description: `Команда и жители остановили огонь.`, cause: 'вода, работа пожарных и помощь соседей', consequences: ['пострадавшие здания требуют ремонта'], entityRefs: [{ kind: 'fireIncident', id: fire.id }, { kind: 'settlement', id: settlement.id }], importance: 2 });
      continue;
    }
    if (response > fire.intensity * .8) fire.status = 'локализован';
    const affected = fire.affectedBuildingIds.map(id => indexes.buildingById.get(id)).filter((item): item is Building => Boolean(item));
    for (const building of affected) {
      building.condition = Math.max(0, building.condition - rng.int(4, Math.max(5, Math.round(fire.intensity / 5))));
      if (building.condition <= 0 && !fire.destroyedBuildingIds.includes(building.id)) {
        fire.destroyedBuildingIds.push(building.id); fire.history.push(`${building.name} выгорело.`); settlement.damaged = clamp(settlement.damaged + 8, 0, 100);
      }
    }
    if (fire.status === 'горит' && rng.chance(fire.spreadRisk / 160)) spreadFire(world, settlement, fire, rng, indexes);
    const endangered = affected.flatMap(building => building.residentIds).map(id => indexes.characterById.get(id)).filter((item): item is Character => Boolean(item?.alive));
    const deaths = endangered.filter(() => rng.chance(fire.intensity / 2200)).slice(0, 3);
    if (deaths.length) {
      fire.deaths += deaths.length;
      archiveCharactersBatch(world, indexes, deaths.map(character => ({ character, context: { cause: `погиб при пожаре в ${settlement.name}`, settlementId: settlement.id, globalX: settlement.x, globalY: settlement.y } })), rng);
    }
    if (fire.intensity >= 92 || fire.destroyedBuildingIds.length >= 5) {
      fire.status = 'выгорел'; fire.endedTick = worldTick(world); fire.history.push('Огонь исчерпал горючие постройки и угас.');
    }
  }
}

function updateHomelessness(world: WorldState, settlement: Settlement, government: SettlementGovernment, indexes: WorldIndexes): void {
  const households = indexes.householdsBySettlement.get(settlement.id) ?? [];
  let homeless = 0;
  for (const household of households) {
    const home = household.homeBuildingId ? indexes.buildingById.get(household.homeBuildingId) : undefined;
    const isHomeless = !home || home.condition <= 0;
    let livingMembers = 0;
    for (const id of household.memberIds) {
      const character = indexes.characterById.get(id);
      if (!character?.alive) continue;
      character.homeless = isHomeless;
      livingMembers += 1;
    }
    if (isHomeless) homeless += livingMembers;
  }
  const states = world.districtCivicStates.filter(item => item.settlementId === settlement.id);
  states.forEach(item => { item.homelessCount = 0; });
  const outskirts = states.find(item => settlement.districts.find(district => district.name === item.districtName)?.role === 'окраина') ?? states[states.length - 1];
  if (outskirts) outskirts.homelessCount = homeless;
  if (homeless > Math.max(4, settlement.population * .03)) {
    government.activeDecision = 'расширить приют или жильё';
    const exists = world.buildings.some(item => item.settlementId === settlement.id && item.type === 'shelter') || world.constructionProjects.some(item => item.settlementId === settlement.id && item.buildingType === 'shelter' && item.stage !== 'заброшено');
    if (!exists && world.month === 3) requestConstructionProject(world, settlement, 'shelter', 'рост бездомности после бедности, пожаров и перенаселения', new RNG(`${world.config.seed}:приют:${settlement.id}:${world.year}`));
  }
}

function updateDistrictConditions(world: WorldState, settlement: Settlement, government: SettlementGovernment, elapsedMonths: number, indexes: WorldIndexes): void {
  const buildings = indexes.buildingsBySettlement.get(settlement.id) ?? [];
  const hasBath = buildings.some(item => item.type === 'bathhouse' && item.condition > 20);
  const wells = buildings.filter(item => item.hasWater && item.condition > 20).length;
  const activeFires = world.fireIncidents.filter(item => item.settlementId === settlement.id && ['горит', 'локализован'].includes(item.status)).length;
  for (const state of world.districtCivicStates.filter(item => item.settlementId === settlement.id)) {
    const patrols = world.civicPatrols.filter(item => state.patrolIds.includes(item.id) && item.status === 'патрулирует');
    state.safety = clamp(state.safety + patrols.reduce((sum, item) => sum + item.guardIds.length * .18, 0) - state.crimeRate * .01 * elapsedMonths - settlement.unrest * .006 * elapsedMonths, 0, 100);
    const cleaningBudget = government.monthlyExpenses > 0 ? Math.min(4, government.monthlyExpenses / Math.max(1, settlement.population) * 15) : 0;
    state.cleanliness = clamp(state.cleanliness + (hasBath ? .8 : 0) + cleaningBudget - state.homelessCount * .08 - settlement.population / Math.max(1200, settlement.districts.length * 900), 0, 100);
    state.waterAccess = clamp(state.waterAccess + wells * .25 - activeFires * 2, 0, 100);
    state.fireRisk = clamp(state.fireRisk + (100 - state.cleanliness) * .012 - state.waterAccess * .01 + activeFires * 4, 0, 100);
    state.crimeRate = clamp(state.crimeRate + state.homelessCount * .03 + settlement.unrest * .012 - state.safety * .014, 0, 100);
    state.rentMultiplier = clamp(.55 + settlement.prosperity / 120 + state.safety / 220 - state.homelessCount / Math.max(20, settlement.population) * 2, .35, 2.4);
  }
}

function collectLocalTaxes(world: WorldState, settlement: Settlement, government: SettlementGovernment, elapsedMonths: number): void {
  const base = settlement.economy.lastMonthlyTrade * settlement.economy.taxRate * .42 + settlement.population * settlement.prosperity / 10000;
  const collected = Math.max(0, base * elapsedMonths * (1 - government.corruption / 140));
  government.monthlyTaxIncome = collected; government.treasury += collected;
}

function fundServices(world: WorldState, settlement: Settlement, government: SettlementGovernment, elapsedMonths: number, indexes: WorldIndexes): void {
  const payroll = (government.guardIds.length * 1.2 + government.judgeIds.length * 2.4 + government.firefighterIds.length * 1 + government.teacherIds.length * .9 + government.gravediggerIds.length * .7) * elapsedMonths;
  const maintenance = (indexes.buildingsBySettlement.get(settlement.id) ?? []).filter(item => ['townHall', 'courthouse', 'prison', 'fireStation', 'school', 'shelter'].includes(item.type)).length * 1.4 * elapsedMonths;
  const due = payroll + maintenance;
  const paid = Math.min(government.treasury, due); government.treasury -= paid; government.monthlyExpenses = paid;
  if (paid < due * .65) {
    settlement.unrest = clamp(settlement.unrest + 2 * elapsedMonths, 0, 100);
    for (const state of world.districtCivicStates.filter(item => item.settlementId === settlement.id)) state.safety = clamp(state.safety - 1.5 * elapsedMonths, 0, 100);
  }
}

function aggregateDistantDisorder(world: WorldState, settlement: Settlement, government: SettlementGovernment, rng: RNG): void {
  const averageCrime = averageDistrict(world, settlement.id, 'crimeRate');
  if (rng.chance(clamp(averageCrime / 600, .01, .16))) {
    settlement.unrest = clamp(settlement.unrest + 1, 0, 100);
    government.history.push(`В ${world.year} году дальние отчёты отметили рост мелкой преступности.`);
  }
  const averageCleanliness = averageDistrict(world, settlement.id, 'cleanliness');
  if (averageCleanliness < 25) settlement.prosperity = Math.max(1, settlement.prosperity - 1);
}

function releaseCompletedSentences(world: WorldState, tick: number): void {
  for (const character of world.characters) {
    if (character.legalStatus !== 'заключён' || !character.sentenceUntilTick || character.sentenceUntilTick > tick) continue;
    character.legalStatus = 'свободен'; character.sentenceUntilTick = undefined; character.schedule.currentActivity = 'вышел из тюрьмы и ищет работу';
    const government = world.settlementGovernments.find(item => item.settlementId === character.settlementId);
    if (government) government.prisonerIds = government.prisonerIds.filter(id => id !== character.id);
  }
}

function applySentence(world: WorldState, government: SettlementGovernment, defendant: Character, courtCase: CourtCase): void {
  const verdict = courtCase.verdict ?? 'оправдание';
  if (verdict === 'оправдание') { defendant.legalStatus = 'свободен'; return; }
  if (verdict === 'штраф') { const paid = Math.min(defendant.wallet ?? 0, courtCase.fine); defendant.wallet = Math.max(0, (defendant.wallet ?? 0) - paid); government.treasury += paid; defendant.legalStatus = 'свободен'; return; }
  if (verdict === 'общественные работы') { defendant.legalStatus = 'свободен'; defendant.schedule.currentActivity = 'исполняет общественные работы'; return; }
  if (verdict === 'изгнание') { defendant.legalStatus = 'свободен'; defendant.loyalty = Math.max(0, defendant.loyalty - 25); defendant.biography.push(`Изгнан из поселения в ${world.year} году.`); return; }
  if (verdict === 'заключение') {
    defendant.legalStatus = 'заключён'; defendant.sentenceUntilTick = worldTick(world) + Math.max(1, courtCase.sentenceMonths); defendant.schedule.currentActivity = 'содержится в тюрьме';
    defendant.employerEstablishmentId = undefined; defendant.employmentContractId = undefined; if (!government.prisonerIds.includes(defendant.id)) government.prisonerIds.push(defendant.id); return;
  }
  defendant.legalStatus = 'заключён'; defendant.sentenceUntilTick = worldTick(world) + 1200; defendant.schedule.currentActivity = 'ожидает исполнения приговора';
}

function transferStolenProperty(world: WorldState, perpetrator: Character, victim: Character, crime: CrimeIncident, rng: RNG): void {
  const equippedIds = new Set(Object.values(victim.equipment?.equippedItemIds ?? {}).filter((id): id is number => typeof id === 'number'));
  const candidates = victim.inventoryItemIds
    .map(id => world.items.find(item => item.id === id))
    .filter((item): item is WorldState['items'][number] => Boolean(item && item.quantity > 0 && !item.equippedByCharacterId && !equippedIds.has(item.id)));
  const item = candidates.length ? rng.pick(candidates) : undefined;
  if (item) {
    item.ownerCharacterId = perpetrator.id;
    item.householdId = undefined;
    item.buildingId = undefined;
    item.establishmentId = undefined;
    victim.inventoryItemIds = victim.inventoryItemIds.filter(id => id !== item.id);
    if (!perpetrator.inventoryItemIds.includes(item.id)) perpetrator.inventoryItemIds.push(item.id);
    crime.stolenItemIds.push(item.id);
  } else {
    const amount = Math.min(victim.wallet ?? 0, rng.int(1, Math.max(1, Math.round((victim.wallet ?? 0) * .4))));
    victim.wallet = Math.max(0, (victim.wallet ?? 0) - amount);
    perpetrator.wallet = (perpetrator.wallet ?? 0) + amount;
  }
}

function spreadFire(world: WorldState, settlement: Settlement, fire: FireIncident, rng: RNG, indexes: WorldIndexes): void {
  const existing = fire.affectedBuildingIds.map(id => indexes.buildingById.get(id)).filter((item): item is Building => Boolean(item));
  const candidates = world.buildings.filter(candidate => candidate.settlementId === settlement.id && !fire.affectedBuildingIds.includes(candidate.id) && existing.some(source => source.globalX === candidate.globalX && source.globalY === candidate.globalY && rectDistance(buildingRect(source), buildingRect(candidate)) <= 4));
  if (!candidates.length) return;
  const next = rng.pick(candidates); fire.affectedBuildingIds.push(next.id); fire.history.push(`Огонь перекинулся на ${next.name}.`); addFireEffects(world, next, fire.id, rng, 3);
}

function addFireEffects(world: WorldState, building: Building, fireId: number, rng: RNG, count: number): void {
  for (let index = 0; index < count; index += 1) {
    const rect = buildingRect(building);
    world.localMapChanges.push({ id: `fire-${fireId}-${building.id}-${index}`, globalX: building.globalX, globalY: building.globalY, level: 0, localX: rng.int(rect.x, rect.x + rect.width - 1), localY: rng.int(rect.y, rect.y + rect.height - 1), kind: 'burn', year: world.year, month: world.month, expiresTick: worldTick(world) + 24, label: `Пожар: ${building.name}`, entityRef: { kind: 'fireIncident', id: fireId } });
  }
}

function cleanOrphanedCivicRecords(world: WorldState): void {
  const livingIds = new Set(world.characters.filter(character => character.alive).map(character => character.id));
  for (const government of world.settlementGovernments) {
    government.prisonerIds = government.prisonerIds.filter(id => livingIds.has(id));
    government.guardIds = government.guardIds.filter(id => livingIds.has(id));
    government.judgeIds = government.judgeIds.filter(id => livingIds.has(id));
    government.firefighterIds = government.firefighterIds.filter(id => livingIds.has(id));
    government.teacherIds = government.teacherIds.filter(id => livingIds.has(id));
    government.gravediggerIds = government.gravediggerIds.filter(id => livingIds.has(id));
    government.councilCharacterIds = government.councilCharacterIds.filter(id => livingIds.has(id));
  }
  for (const crime of world.crimes) {
    if (crime.perpetratorId && !livingIds.has(crime.perpetratorId) && !['раскрыто', 'не раскрыто'].includes(crime.status)) {
      crime.status = 'не раскрыто';
      crime.resolvedTick ??= worldTick(world);
      crime.history.push('Подозреваемый умер или исчез до завершения дела; расследование закрыто без приговора.');
    }
    crime.witnessIds = crime.witnessIds.filter(id => livingIds.has(id));
  }
  for (const courtCase of world.courtCases) {
    if (courtCase.status === 'завершено' || courtCase.status === 'прекращено') continue;
    if ((courtCase.defendantId && !livingIds.has(courtCase.defendantId)) || (courtCase.judgeId && !livingIds.has(courtCase.judgeId))) {
      courtCase.status = 'прекращено';
      courtCase.closedTick ??= worldTick(world);
      courtCase.history.push('Дело прекращено из-за смерти или исчезновения участника процесса.');
    }
  }
  for (const character of world.characters) {
    character.wantedForCrimeIds = (character.wantedForCrimeIds ?? []).filter(id => {
      const crime = world.crimes.find(item => item.id === id);
      return Boolean(crime && !['раскрыто', 'не раскрыто'].includes(crime.status));
    });
    if (character.legalStatus === 'разыскивается' && !character.wantedForCrimeIds.length) character.legalStatus = 'свободен';
  }
}

function recordCivicEvent(world: WorldState, input: Parameters<typeof appendCausalEvent>[1]): WorldEvent {
  const event = appendCausalEvent(world, input);
  registerWorldEventKnowledge(world, event);
  return event;
}

function sentenceFor(crime: CrimeIncident, guiltyScore: number, rng: RNG): { kind: SentenceKind; months: number; fine: number } {
  if (guiltyScore < 48) return { kind: 'оправдание', months: 0, fine: 0 };
  if (crime.severity <= 3) return rng.chance(.6) ? { kind: 'штраф', months: 0, fine: 3 + crime.severity * 3 } : { kind: 'общественные работы', months: 1 + crime.severity, fine: 0 };
  if (crime.type === 'убийство' && guiltyScore > 88) return { kind: 'заключение', months: rng.int(48, 180), fine: 0 };
  if (crime.type === 'поджог' || crime.type === 'грабёж' || crime.type === 'нападение') return { kind: 'заключение', months: rng.int(6, 36) + crime.severity * 2, fine: 0 };
  return { kind: 'штраф', months: 0, fine: 8 + crime.severity * 6 };
}

function sentenceText(courtCase: CourtCase): string {
  if (courtCase.verdict === 'штраф') return `штраф ${Math.round(courtCase.fine)} крон`;
  if (courtCase.verdict === 'заключение') return `заключение на ${courtCase.sentenceMonths} месяцев`;
  if (courtCase.verdict === 'общественные работы') return 'общественные работы';
  return courtCase.verdict ?? 'решение не вынесено';
}

function chooseCrimeType(settlement: Settlement, perpetrator: Character, district: DistrictCivicState, rng: RNG): CrimeType {
  const weights = CRIME_TYPES.map(type => ({ value: type, weight: type === 'кража' ? 35 : type === 'мошенничество' && perpetrator.profession === 'merchant' ? 18 : type === 'браконьерство' && ['hunter', 'farmer'].includes(perpetrator.profession) ? 20 : type === 'поджог' && district.fireRisk > 65 ? 8 : type === 'убийство' ? 2 + settlement.unrest / 30 : 8 }));
  return rng.weighted(weights);
}

function crimeSeverity(type: CrimeType): number { return ({ кража: 2, грабёж: 6, нападение: 6, убийство: 10, поджог: 8, контрабанда: 4, мошенничество: 3, взлом: 4, браконьерство: 2 } as Record<CrimeType, number>)[type]; }
function crimeLabel(type: CrimeType): string { return type[0]!.toUpperCase() + type.slice(1); }
function crimeCause(type: CrimeType, perpetrator: Character, settlement: Settlement): string { return `${type}: бедность, личная выгода, конфликт или слабый контроль; ${perpetrator.name}, положение ${perpetrator.wealth < 5 ? 'бедное' : 'обычное'}, беспорядки ${settlement.unrest}%`; }
function leadershipScore(character: Character): number { return character.renown * 2 + character.wealth + character.titles.length * 35 + (['scribe', 'merchant', 'priest', 'guard'].includes(character.profession) ? 20 : 0); }
function councilScore(character: Character): number { return character.renown + character.wealth * .5 + (['scribe', 'merchant', 'priest', 'guard', 'healer'].includes(character.profession) ? 30 : 0); }
function residentsOf(world: WorldState, settlementId: number, indexes?: WorldIndexes): Character[] { return indexes?.residentsBySettlement.get(settlementId) ?? world.characters.filter(item => item.settlementId === settlementId); }
function pickRole(residents: Character[], professions: string[], count: number, previous: number[], visualRole: string): number[] { const chosen = [...residents].filter(item => previous.includes(item.id) || professions.includes(item.profession)).sort((a, b) => Number(previous.includes(b.id)) - Number(previous.includes(a.id)) || b.health - a.health || a.id - b.id).slice(0, count); chosen.forEach(item => { item.visualRole = visualRole; }); return chosen.map(item => item.id); }
function attachWorkers(building: Building | undefined, ids: number[]): void { if (building) building.workerIds = [...new Set(ids.filter(Boolean))]; }
function chooseDistrict(settlement: Settlement, type: BuildingType) { const preferred = type === 'fireStation' ? ['центр', 'рынок', 'ремесленный район'] : type === 'prison' ? ['крепость', 'окраина'] : type === 'shelter' ? ['окраина', 'жилой район'] : ['центр', 'крепость']; return settlement.districts.find(item => preferred.includes(item.role)) ?? settlement.districts[0]!; }
function averageDistrict(world: WorldState, settlementId: number, key: 'waterAccess' | 'crimeRate' | 'cleanliness'): number { const states = world.districtCivicStates.filter(item => item.settlementId === settlementId); return states.length ? states.reduce((sum, item) => sum + item[key], 0) / states.length : 50; }
function rectDistance(a: ReturnType<typeof buildingRect>, b: ReturnType<typeof buildingRect>): number { const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width)); const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height)); return Math.hypot(dx, dy); }
function maxId(items: { id: number }[]): number { return items.reduce((max, item) => Math.max(max, item.id), 0); }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function trimCivicHistory(world: WorldState): void { if (world.crimes.length > 4500) world.crimes.splice(0, world.crimes.length - 4500); if (world.courtCases.length > 3500) world.courtCases.splice(0, world.courtCases.length - 3500); if (world.fireIncidents.length > 1800) world.fireIncidents.splice(0, world.fireIncidents.length - 1800); }

export function settlementLifeIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const settlementIds = new Set(world.settlements.map(item => item.id));
  const characterIds = new Set(world.characters.map(item => item.id));
  const buildingIds = new Set(world.buildings.map(item => item.id));
  const crimeIds = new Set(world.crimes.map(item => item.id));
  for (const government of world.settlementGovernments) {
    if (!settlementIds.has(government.settlementId)) issues.push(`Местная власть ${government.id}: нет поселения`);
    const hasLivingResidents = world.characters.some(character => character.alive && character.settlementId === government.settlementId);
    if (hasLivingResidents && !characterIds.has(government.leaderCharacterId)) issues.push(`Местная власть ${government.id}: нет живого руководителя`);
    if (government.prisonerIds.some(id => !characterIds.has(id))) issues.push(`Местная власть ${government.id}: в тюрьме отсутствующий персонаж`);
  }
  for (const crime of world.crimes) {
    if (!settlementIds.has(crime.settlementId)) issues.push(`Преступление ${crime.id}: нет поселения`);
    if (crime.perpetratorId && !characterIds.has(crime.perpetratorId) && ['совершено', 'расследуется', 'подозреваемый найден', 'передано в суд'].includes(crime.status)) issues.push(`Преступление ${crime.id}: активное дело с отсутствующим преступником`);
  }
  for (const courtCase of world.courtCases) if (!crimeIds.has(courtCase.crimeId)) issues.push(`Судебное дело ${courtCase.id}: нет преступления`);
  for (const fire of world.fireIncidents) for (const id of fire.affectedBuildingIds) if (!buildingIds.has(id)) issues.push(`Пожар ${fire.id}: нет здания ${id}`);
  for (const character of world.characters) {
    if (character.legalStatus === 'заключён' && !character.sentenceUntilTick) issues.push(`${character.name}: заключён без срока`);
    if ((character.wantedForCrimeIds ?? []).some(id => !crimeIds.has(id))) issues.push(`${character.name}: розыск по отсутствующему делу`);
  }
  return issues;
}
