import type {
  GenesisSitePlan, HistoricalEraKind, HistoricalEraSummary, Settlement, WorldConfig, WorldState,
} from '../types';
import type { GenerationProgressReporter } from './generator';
import type { WorldIndexes } from './indexes';
import { appendCausalEvent } from './causality';
import { createHousingProfile } from './settlements';
import { createSimulationRuntime, ensureSimulationRuntime, worldTick } from './scheduler';
import { RNG } from './rng';
import { initializeDecisionCore, linkDecisionToEvent, recordDecision, recordStateDelta } from './decisionCore';
import { initializeMindSystem } from './mindSystem';
import { initializeSettlementLayouts } from './cityMorphology';
import { advanceMaterialEconomy, generatePhysicalEconomy, pruneEmptyMaterialItems } from './materialEconomy';
import { advanceAgriculture, advanceConstruction, initializeAgricultureAndConstruction } from './agricultureConstruction';
import { initializeLivingEconomy } from './livingEconomy';
import { initializeMilitaryInfrastructure } from './militaryInfrastructure';
import { initializePhysicalArmySystem } from './physicalArmy';
import { compactDeadEntities, ensureCemeteries, synchronizeMortalityIds } from './mortality';
import { initializeKnowledgeSystem } from './knowledgeSystem';
import { initializeSettlementLife } from './settlementLife';
import { initializeStateMachine } from './stateMachine';
import { advanceSocialSystem, initializeSocialSystem } from './socialSystem';
import { advanceHealthSystem, initializeHealthSystem } from './healthSystem';
import { initializeBattleSystem } from './battleSystem';
import { initializeCultureSystem } from './cultureSystem';
import { advanceCivilizationSystem, initializeCivilizationSystem } from './civilizationSystem';
import {
  advanceSettlementLifecycle, formSettlementExpedition, initializeSettlementLifecycle,
} from './settlementLifecycle';
import { advanceStateFormation, initializeStateFormation } from './stateFormation';
import { advanceCitySimulation, initializeCitySimulation } from './citySimulation';
import {
  initializeTerritorialHistory, recordKingdomFoundation,
} from './territory';
import { normalizeKingdomCapitals } from './kingdomState';
import {
  advancePopulation, advanceWorldSystems, createWorldSystemEngine,
} from './simulation';
import { refreshDynamicWorldIndexes } from './indexes';
import { inspectWorldIntegrity } from './integrity';
import { advanceDynastyLegacy } from './dynastyLegacy';
import { APP_VERSION } from '../version';

const GENESIS_VERSION = 1 as const;
const SCHEMA_VERSION = 31;

interface GenesisPreparation {
  initialSettlementIds: number[];
  initialKingdomIds: number[];
  initialPopulation: number;
  sites: GenesisSitePlan[];
}

export function buildLivedHistoricalWorld(
  world: WorldState,
  config: WorldConfig,
  onProgress?: GenerationProgressReporter,
): WorldState {
  const preparation = prepareGenesis(world, config);
  initializeGenesisSystems(world, config, onProgress);
  seedGenesisEvents(world, preparation.initialSettlementIds);
  runLivedHistory(world, config, preparation, onProgress);
  finalizeLivedHistory(world, config, preparation, onProgress);
  return world;
}

function prepareGenesis(world: WorldState, config: WorldConfig): GenesisPreparation {
  const originalSettlements = [...world.settlements];
  const componentByCoordinate = landComponents(world);
  const seedIds = new Set(world.kingdoms.map(kingdom => kingdom.capitalId));

  for (const componentId of new Set(componentByCoordinate.values())) {
    const inComponent = originalSettlements.filter(settlement => componentByCoordinate.get(`${settlement.x}:${settlement.y}`) === componentId);
    if (!inComponent.length || inComponent.some(settlement => seedIds.has(settlement.id))) continue;
    const anchor = [...inComponent].sort((a, b) => b.population - a.population || a.id - b.id)[0];
    if (anchor) seedIds.add(anchor.id);
  }

  const initialSettlements = originalSettlements.filter(settlement => seedIds.has(settlement.id));
  const futureSettlements = originalSettlements.filter(settlement => !seedIds.has(settlement.id));
  const historyEnd = Math.max(1, config.historyYears);
  const sites: GenesisSitePlan[] = futureSettlements
    .sort((a, b) => a.foundedYear - b.foundedYear || a.id - b.id)
    .map((settlement, index) => ({
      id: index + 1,
      originalSettlementId: settlement.id,
      originalName: settlement.name,
      x: settlement.x,
      y: settlement.y,
      terrain: world.tiles[settlement.y * world.config.width + settlement.x]?.terrain ?? 'plains',
      resource: settlement.resource,
      sponsorKingdomId: settlement.kingdomId,
      targetYear: Math.max(3, Math.min(historyEnd - 1, Math.round(3 + (index + 1) / Math.max(1, futureSettlements.length + 1) * Math.max(1, historyEnd - 6)))),
      status: 'planned',
      attempts: 0,
    }));

  const keptSettlementIds = new Set(initialSettlements.map(settlement => settlement.id));
  const keptCharacterIds = new Set(world.characters.filter(character => keptSettlementIds.has(character.settlementId)).map(character => character.id));
  world.settlements = initialSettlements;
  world.characters = world.characters.filter(character => keptCharacterIds.has(character.id));
  world.relationships = world.relationships.filter(relation => keptCharacterIds.has(relation.characterAId) && keptCharacterIds.has(relation.characterBId));
  const relationshipIds = new Set(world.relationships.map(relation => relation.id));
  for (const character of world.characters) {
    character.parentIds = character.parentIds.filter(id => keptCharacterIds.has(id));
    character.childIds = character.childIds.filter(id => keptCharacterIds.has(id));
    character.relationshipIds = character.relationshipIds.filter(id => relationshipIds.has(id));
  }
  rebalanceGenesisDemography(world, config.seed);
  for (const character of world.characters) {
    character.birthYear = 1 - character.age;
    character.biography = [`Родился в родовой общине ${world.settlements.find(item => item.id === character.settlementId)?.name ?? 'неизвестного поселения'}.`];
  }

  world.dynasties = world.dynasties.filter(dynasty => dynasty.memberIds.some(id => keptCharacterIds.has(id)));
  const dynastyIds = new Set(world.dynasties.map(dynasty => dynasty.id));
  for (const dynasty of world.dynasties) {
    dynasty.memberIds = dynasty.memberIds.filter(id => keptCharacterIds.has(id));
    if (!keptCharacterIds.has(dynasty.founderId)) dynasty.founderId = dynasty.memberIds[0] ?? dynasty.founderId;
    dynasty.history = [`Род ${dynasty.name} существовал среди первых общин.`];
  }

  for (const tile of world.tiles) {
    tile.kingdomId = undefined;
    tile.controlledSinceYear = undefined;
    tile.settlementId = undefined;
    tile.settlementDistrict = undefined;
  }

  const genesisRng = new RNG(`${config.seed}:родовые-общины-v1`);
  for (const settlement of world.settlements) {
    settlement.population = world.characters.filter(character => character.alive && character.settlementId === settlement.id).length;
    settlement.foundedYear = 1;
    settlement.type = settlement.population >= 85 ? 'village' : 'hamlet';
    const housing = createHousingProfile(settlement.population, settlement.type, genesisRng);
    settlement.buildings = housing.buildings;
    settlement.buildingCounts = housing.buildingCounts;
    settlement.households = housing.households;
    settlement.residentialCapacity = housing.residentialCapacity;
    settlement.districts = [{ x: settlement.x, y: settlement.y, name: 'Родовой центр', role: 'центр' }];
    settlement.history = [`В 1 году постоянный лагерь ${settlement.name} стал родовой общиной.`];
    settlement.buildingIds = [];
    settlement.householdIds = [];
    settlement.establishmentIds = [];
    settlement.tradeRouteIds = [];
    settlement.politicalStatus = 'frontier';
    settlement.foundingExpeditionId = undefined;
    settlement.politicalCommunityId = undefined;
    settlement.layout = undefined;
    const tile = world.tiles[settlement.y * world.config.width + settlement.x];
    if (tile) {
      tile.settlementId = settlement.id;
      tile.settlementDistrict = settlement.districts[0]!.name;
    }
  }

  for (const kingdom of world.kingdoms) {
    const capital = world.settlements.find(settlement => settlement.id === kingdom.capitalId)
      ?? world.settlements.filter(settlement => settlement.kingdomId === kingdom.id).sort((a, b) => b.population - a.population || a.id - b.id)[0];
    if (capital) kingdom.capitalId = capital.id;
    kingdom.foundedYear = 1;
    kingdom.treasury = Math.max(80, Math.round(kingdom.treasury * .18));
    kingdom.armyStrength = Math.max(16, Math.round(kingdom.armyStrength * .2));
    kingdom.stability = Math.max(32, Math.min(72, kingdom.stability));
    kingdom.claims = capital ? [capital.id] : [];
    kingdom.enemies = [];
    kingdom.predecessorKingdomIds = [];
    kingdom.politicalOrigin = 'generated';
    if (kingdom.dynastyId && !dynastyIds.has(kingdom.dynastyId)) kingdom.dynastyId = undefined;
    kingdom.diplomacy = world.kingdoms.filter(other => other.id !== kingdom.id).map(other => ({
      kingdomId: other.id,
      score: 0,
      status: 'мир' as const,
      reason: 'родовые общины ещё не установили устойчивых отношений',
    }));
  }

  const keptKingdomIds = new Set(world.kingdoms.map(kingdom => kingdom.id));
  world.tradeRoutes = world.tradeRoutes.filter(route => keptSettlementIds.has(route.fromSettlementId) && keptSettlementIds.has(route.toSettlementId));
  const keptRouteIds = new Set(world.tradeRoutes.map(route => route.id));
  for (const settlement of world.settlements) settlement.tradeRouteIds = settlement.tradeRouteIds.filter(id => keptRouteIds.has(id));
  world.artifacts = world.artifacts.filter(artifact => (!artifact.ownerId || keptCharacterIds.has(artifact.ownerId)) && (!artifact.settlementId || keptSettlementIds.has(artifact.settlementId)));
  world.books = world.books.filter(book => keptSettlementIds.has(book.settlementId) && keptCharacterIds.has(book.authorId));
  world.dungeons = [];
  world.wars = [];
  world.events = [];
  world.decisions = [];
  world.stateDeltas = [];
  world.territoryHistory = [];
  world.localMapChanges = [];
  world.cemeteries = [];
  world.burials = [];
  world.battleRecords = [];
  world.settlementExpeditions = [];
  world.politicalCommunities = [];
  world.politicalTransitions = [];
  world.cultures = [];
  world.civilizations = [];
  world.languages = [];
  world.religions = [];
  world.settlementCultures = [];
  world.settlementGovernments = [];
  world.districtCivicStates = [];
  world.cityStates = [];
  world.urbanStates = [];
  world.civicPatrols = [];
  world.crimes = [];
  world.courtCases = [];
  world.fireIncidents = [];
  world.kingdomGovernments = [];
  world.nobleTitles = [];
  world.vassalContracts = [];
  world.courtOffices = [];
  world.courtFactions = [];
  world.royalOrders = [];
  world.stateCrises = [];
  world.diplomaticAgreements = [];
  world.socialObligations = [];
  world.healthConditions = [];
  world.pregnancies = [];
  world.epidemics = [];
  world.buildings = [];
  world.households = [];
  world.establishments = [];
  world.fields = [];
  world.constructionProjects = [];
  world.items = [];
  world.productionRecipes = [];
  world.employments = [];
  world.shipments = [];
  world.travelingMerchants = [];
  world.marketTransactions = [];
  world.knowledgeFacts = [];
  world.memories = [];
  world.rumors = [];
  world.messages = [];
  world.settlementKnowledge = [];
  world.militaryUnits = [];
  world.supplyWagons = [];
  world.armyCamps = [];
  world.armyCampStructures = [];
  world.armyLocalPositions = [];

  world.armies = world.armies.filter(army => keptKingdomIds.has(army.kingdomId) && keptCharacterIds.has(army.commanderId));
  for (const army of world.armies) {
    const capital = world.settlements.find(settlement => settlement.id === world.kingdoms.find(kingdom => kingdom.id === army.kingdomId)?.capitalId);
    if (capital) { army.x = capital.x; army.y = capital.y; army.targetSettlementId = undefined; }
    army.strength = Math.max(8, Math.round(army.strength * .18));
    army.soldierIds = [];
    army.unitIds = [];
    army.supplyWagonIds = [];
    army.inventoryItemIds = [];
    army.campaignHistory = [];
  }

  world.year = 1;
  world.month = 1;
  world.config = { ...config };
  world.version = SCHEMA_VERSION;
  world.appVersion = APP_VERSION;
  world.simulation = createSimulationRuntime(world);
  world.history = {
    engineVersion: 3,
    generatedYears: Math.max(1, config.historyYears),
    eras: [],
    landmarkEventIds: [],
    fallenRealms: [],
    compressedEventCount: 0,
    logicWarnings: [],
    historicalSimulationVersion: 2,
    livedDecisionIds: [],
    genesis: {
      version: GENESIS_VERSION,
      initialSettlementIds: world.settlements.map(settlement => settlement.id),
      initialKingdomIds: world.kingdoms.map(kingdom => kingdom.id),
      initialPopulation: world.characters.filter(character => character.alive).length,
      plannedSiteCount: sites.length,
      foundedSiteCount: 0,
      failedSiteCount: 0,
      coarseSteps: 0,
      detailedMonths: 0,
      sitePlans: sites,
      finalSettlementIds: [],
      formedKingdomIds: [],
      finalPopulation: 0,
    },
  };

  world.nextIds.event = 1;
  world.nextIds.war = 1;
  world.nextIds.decision = 1;
  world.nextIds.stateDelta = 1;
  world.nextIds.settlementExpedition = 1;
  world.nextIds.politicalCommunity = 1;
  world.nextIds.politicalTransition = 1;
  world.nextIds.civilization = 1;
  world.nextIds.building = 1;
  world.nextIds.household = 1;
  world.nextIds.establishment = 1;
  world.nextIds.item = 1;
  world.nextIds.productionRecipe = 1;
  world.nextIds.employment = 1;
  world.nextIds.shipment = 1;
  world.nextIds.travelingMerchant = 1;
  world.nextIds.marketTransaction = 1;
  world.nextIds.knowledgeFact = 1;
  world.nextIds.memory = 1;
  world.nextIds.rumor = 1;
  world.nextIds.message = 1;
  world.nextIds.settlementGovernment = 1;
  world.nextIds.districtCivic = 1;
  world.nextIds.patrol = 1;
  world.nextIds.crime = 1;
  world.nextIds.courtCase = 1;
  world.nextIds.fireIncident = 1;
  world.nextIds.militaryUnit = 1;
  world.nextIds.supplyWagon = 1;
  world.nextIds.field = 1;
  world.nextIds.constructionProject = 1;
  world.nextIds.territoryChange = 1;
  world.nextIds.cemetery = 1;
  world.nextIds.burial = 1;
  world.nextIds.socialObligation = 1;
  world.nextIds.healthCondition = 1;
  world.nextIds.pregnancy = 1;
  world.nextIds.epidemic = 1;
  world.nextIds.battleRecord = 1;

  return {
    initialSettlementIds: world.settlements.map(settlement => settlement.id),
    initialKingdomIds: world.kingdoms.map(kingdom => kingdom.id),
    initialPopulation: world.characters.filter(character => character.alive).length,
    sites,
  };
}


function rebalanceGenesisDemography(world: WorldState, seed: string): void {
  const byId = new Map(world.characters.map(character => [character.id, character]));
  const rulerIds = new Set(world.kingdoms.map(kingdom => kingdom.rulerId));
  const assigned = new Set<number>();
  const range = (species: WorldState['characters'][number]['species']): [number, number, number] => {
    if (species === 'elf') return [24, 105, 180];
    if (species === 'dwarf') return [22, 68, 110];
    if (species === 'orc') return [16, 38, 64];
    return [18, 42, 78];
  };

  for (const character of [...world.characters].sort((a, b) => a.id - b.id)) {
    if (!character.spouseId || character.id > character.spouseId) continue;
    const spouse = byId.get(character.spouseId);
    if (!spouse || spouse.settlementId !== character.settlementId) continue;
    const [aMin, aMax] = range(character.species);
    const [bMin, bMax] = range(spouse.species);
    const low = Math.max(aMin, bMin);
    const high = Math.min(aMax, bMax);
    const rng = new RNG(`${seed}:первые-семьи:${character.id}:${spouse.id}`);
    const shared = low <= high ? rng.int(low, Math.min(high, low + 18)) : rng.int(aMin, Math.min(aMax, aMin + 14));
    character.age = Math.max(aMin, Math.min(aMax, shared + rng.int(-2, 2)));
    spouse.age = Math.max(bMin, Math.min(bMax, shared + rng.int(-2, 2)));
    assigned.add(character.id);
    assigned.add(spouse.id);
  }

  for (const character of [...world.characters].sort((a, b) => a.id - b.id)) {
    if (assigned.has(character.id)) continue;
    const [adult, fertileEnd, maxAge] = range(character.species);
    const rng = new RNG(`${seed}:возрастная-пирамида:${character.id}`);
    if (rulerIds.has(character.id) || character.titles.length) {
      character.age = rng.int(adult + 8, Math.min(maxAge - 8, fertileEnd + 12));
    } else {
      const roll = rng.int(1, 100);
      if (roll <= 30) character.age = rng.int(0, Math.max(1, adult - 1));
      else if (roll <= 78) character.age = rng.int(adult, fertileEnd);
      else if (roll <= 95) character.age = rng.int(fertileEnd + 1, Math.max(fertileEnd + 2, Math.floor(maxAge * .78)));
      else character.age = rng.int(Math.max(fertileEnd + 2, Math.floor(maxAge * .78)), maxAge);
    }
  }

  // Родственные ссылки не должны утверждать невозможный возраст родителей.
  for (const child of world.characters) {
    child.parentIds = child.parentIds.filter(parentId => {
      const parent = byId.get(parentId);
      return Boolean(parent && parent.age >= child.age + 16);
    });
  }
  for (const parent of world.characters) parent.childIds = parent.childIds.filter(childId => byId.get(childId)?.parentIds.includes(parent.id));

  for (const settlement of world.settlements) {
    const residents = world.characters.filter(character => character.alive && character.settlementId === settlement.id);
    const workers = residents.filter(character => character.age >= 14 && !character.titles.length);
    const farmerTarget = Math.max(2, Math.ceil(workers.length * .42));
    const farmers = workers.filter(character => character.profession === 'farmer');
    for (const character of workers.filter(item => item.profession !== 'farmer').sort((a, b) => a.id - b.id).slice(0, Math.max(0, farmerTarget - farmers.length))) {
      character.profession = 'farmer';
      character.workplace = 'поля и пастбища';
      character.skills.farmer = Math.max(character.skills.farmer ?? 0, 18 + character.id % 24);
    }
    for (const character of residents) {
      if (character.age < 14) {
        character.profession = 'child';
        character.workplace = 'дом семьи';
      }
      character.birthYear = 1 - character.age;
    }
  }
}

function initializeGenesisSystems(world: WorldState, config: WorldConfig, onProgress?: GenerationProgressReporter): void {
  const rng = new RNG(`${config.seed}:прожитая-история-инициализация-v1`);
  onProgress?.('Родовые общины и первые земли', 36, 100, `${world.settlements.length} исходных общин`);
  initializeDecisionCore(world);
  initializeMindSystem(world);
  initializeTerritorialHistory(world);
  for (const kingdom of world.kingdoms) recordKingdomFoundation(world, kingdom, 1);
  initializeSettlementLayouts(world);
  generatePhysicalEconomy(world, new RNG(`${config.seed}:генезис-повседневная-жизнь-v1`));
  initializeAgricultureAndConstruction(world, new RNG(`${config.seed}:генезис-земледелие-и-стройка-v1`));
  initializeLivingEconomy(world, new RNG(`${config.seed}:генезис-личная-экономика-v1`));
  initializeMilitaryInfrastructure(world, new RNG(`${config.seed}:генезис-военная-инфраструктура-v1`));
  initializePhysicalArmySystem(world, new RNG(`${config.seed}:генезис-физические-армии-v1`));
  ensureCemeteries(world, rng);
  compactDeadEntities(world, rng);
  initializeKnowledgeSystem(world, new RNG(`${config.seed}:генезис-память-и-знания-v1`));
  initializeSettlementLife(world, new RNG(`${config.seed}:генезис-жизнь-поселений-v1`));
  initializeStateMachine(world, new RNG(`${config.seed}:генезис-государственная-машина-v1`));
  initializeSocialSystem(world);
  initializeHealthSystem(world);
  initializeBattleSystem(world);
  initializeCultureSystem(world, new RNG(`${config.seed}:генезис-культура-вера-образование-v1`));
  initializeCivilizationSystem(world, new RNG(`${config.seed}:генезис-цивилизации-и-технологии-v1`));
  initializeSettlementLifecycle(world);
  initializeStateFormation(world);
  initializeCitySimulation(world);
}

function seedGenesisEvents(world: WorldState, settlementIds: readonly number[]): void {
  for (const settlementId of settlementIds) {
    const settlement = world.settlements.find(item => item.id === settlementId);
    const kingdom = settlement ? world.kingdoms.find(item => item.id === settlement.kingdomId) : undefined;
    if (!settlement || !kingdom) continue;
    const decision = recordDecision(world, {
      actorRef: { kind: 'character', id: kingdom.rulerId },
      goal: 'закрепить постоянную родовую общину',
      context: `${settlement.name} существует как лагерь у пригодной для жизни земли`,
      knownFactIds: [],
      options: [
        { id: 'остаться', label: 'остаться и строить постоянные дома', utility: 38, factors: { вода: 14, земля: 12, безопасность: 12 } },
        { id: 'уйти', label: 'продолжить кочевой путь', utility: 18, factors: { неизвестность: -8, свобода: 10, ресурсы: 16 } },
      ],
      chosenOptionId: 'остаться',
      reason: 'семьи выбрали постоянное жильё, воду и общие запасы',
      historical: true,
      tick: worldTick(world),
      tags: ['генезис', 'основание поселения'],
    });
    const delta = recordStateDelta(world, {
      entityRef: { kind: 'settlement', id: settlement.id },
      field: 'politicalStatus',
      before: 'temporary-camp',
      after: settlement.politicalStatus ?? 'frontier',
      cause: 'семьи признали лагерь постоянной общиной',
      decisionId: decision.id,
      historical: true,
      tick: worldTick(world),
    });
    const event = appendCausalEvent(world, {
      kind: 'settlement',
      title: `Основана родовая община ${settlement.name}`,
      description: `${settlement.population} жителей закрепились у клетки ${settlement.x}:${settlement.y}.`,
      cause: 'доступ к воде, земле и общим запасам',
      conditions: ['существовали реальные семьи', 'место было свободно', 'община могла построить жильё и склад'],
      decision: 'остаться и признать лагерь постоянным поселением',
      outcome: `${settlement.name} стало первым постоянным центром державы ${kingdom.name}`,
      consequences: ['появились постоянные дома и поля', 'земля получила политического владельца', 'началась родовая хроника'],
      entityRefs: [{ kind: 'settlement', id: settlement.id }, { kind: 'kingdom', id: kingdom.id }, { kind: 'character', id: kingdom.rulerId }],
      importance: 4,
    });
    linkDecisionToEvent(world, decision.id, event, delta ? [delta.id] : []);
  }
}

function runLivedHistory(
  world: WorldState,
  config: WorldConfig,
  preparation: GenesisPreparation,
  onProgress?: GenerationProgressReporter,
): void {
  const targetYear = Math.max(1, config.historyYears);
  if (targetYear <= 1) return;
  const detailedYears = Math.min(12, Math.max(4, Math.floor(targetYear * .12)));
  const detailedStart = Math.max(1, targetYear - detailedYears);
  const engine = createWorldSystemEngine(world);
  let steps = 0;
  const estimatedCoarseSteps = estimateCoarseSteps(1, detailedStart);

  while (world.year < detailedStart) {
    const cadence = cadenceYears(world.year, detailedStart);
    const previousYear = world.year;
    const nextYear = Math.min(detailedStart, world.year + cadence);
    const beforeEvents = world.events.length;
    bridgeSkippedGenerations(world, engine.indexes, previousYear, nextYear);
    world.year = Math.max(0, nextYear - 1);
    world.month = 10;
    ensureSimulationRuntime(world);
    advanceWorldSystems(engine, { fastForward: true, monthStep: 3, historicalPopulation: true });
    launchPlannedSites(world, engine.indexes, preparation.sites, cadence);
    const lifecycle = advanceSettlementLifecycle(
      world,
      new RNG(`${config.seed}:исторические-экспедиции:${world.year}`),
      engine.indexes,
      { allowFormation: true, elapsedMonths: Math.min(36, cadence * 12) },
    );
    if (lifecycle.changed) refreshDynamicWorldIndexes(engine.indexes, world);
    const politics = advanceStateFormation(
      world,
      new RNG(`${config.seed}:историческая-политика:${world.year}`),
      engine.indexes,
      { allowTransitions: true, elapsedMonths: cadence * 12 },
    );
    if (politics.changed) refreshDynamicWorldIndexes(engine.indexes, world);
    synchronizeGenesisSites(world, preparation.sites);
    advanceCivilizationSystem(world);
    advanceCitySimulation(world);
    steps += 1;
    if (world.history.genesis) world.history.genesis.coarseSteps = steps;
    const percent = 38 + Math.round(steps / Math.max(1, estimatedCoarseSteps) * 42);
    onProgress?.('Прожитая история: основания и распады', Math.min(80, percent), 100,
      `${world.year} год · поселений ${world.settlements.length} · держав ${world.kingdoms.length} · событий +${world.events.length - beforeEvents}`);
  }

  let detailedMonths = 0;
  while (world.year < targetYear || world.month !== 1) {
    advanceWorldSystems(engine, { fastForward: true, monthStep: 3, historicalPopulation: true });
    detailedMonths += 3;
    if (world.month === 3 || world.month === 9) launchPlannedSites(world, engine.indexes, preparation.sites, 1);
    synchronizeGenesisSites(world, preparation.sites);
    const total = detailedYears * 12;
    onProgress?.('Прожитая история: последние поколения', 80 + Math.round(detailedMonths / Math.max(1, total) * 16), 100,
      `${world.year}.${String(world.month).padStart(2, '0')} · жителей ${world.characters.filter(character => character.alive).length}`);
    if (world.year > targetYear || (world.year === targetYear && world.month > 1)) break;
  }
  world.year = targetYear;
  world.month = 1;
  ensureSimulationRuntime(world);
  if (world.history.genesis) world.history.genesis.detailedMonths = detailedMonths;
}


function bridgeSkippedGenerations(world: WorldState, indexes: WorldIndexes, fromYear: number, toYear: number): void {
  const quarterMonths = [1, 4, 7, 10] as const;

  for (let year = fromYear + 1; year < toYear; year += 1) {
    world.year = year;
    const settlementIds = new Set(world.settlements.map(settlement => settlement.id));

    for (const month of quarterMonths) {
      world.month = month;
      ensureSimulationRuntime(world);
      const rng = new RNG(`${world.config.seed}:исторический-квартал:${year}:${month}`);
      if (month === 1) {
        advanceMaterialEconomy(world, rng, indexes, settlementIds, new Set());
        advanceCitySimulation(world);
      }
      advanceAgriculture(world, rng, indexes, settlementIds);
      if (month === 4 || month === 10) advanceConstruction(world, rng, indexes, settlementIds);
      advanceHealthSystem(world, rng, indexes, { fastForward: true, elapsedMonths: 3, demographyOnly: true });
    }

    advancePopulation(world, new RNG(`${world.config.seed}:поколения-между-срезами:${year}`), indexes, { mortalityScale: .12, hungerRiskScale: .02, familyFormationScale: 6 });
    advanceSocialSystem(world, new RNG(`${world.config.seed}:связи-между-срезами:${year}`), indexes, true);
    advanceDynastyLegacy(world, { elapsedMonths: 12 });
    const livingBySettlement = new Map<number, number>();
    for (const character of world.characters) if (character.alive && character.settlementId > 0) {
      livingBySettlement.set(character.settlementId, (livingBySettlement.get(character.settlementId) ?? 0) + 1);
    }
    for (const settlement of world.settlements) settlement.population = livingBySettlement.get(settlement.id) ?? 0;
  }
}

function launchPlannedSites(world: WorldState, indexes: WorldIndexes, sites: GenesisSitePlan[], cadence: number): void {
  const due = sites
    .filter(site => site.status === 'planned' && site.targetYear <= world.year && site.attempts < 3)
    .sort((a, b) => a.targetYear - b.targetYear || a.id - b.id)
    .slice(0, Math.max(1, Math.min(2, Math.ceil(cadence / 3))));
  for (const site of due) {
    const origin = chooseOriginForSite(world, site);
    if (!origin) continue;
    const expedition = formSettlementExpedition(
      world,
      origin,
      new RNG(`${world.config.seed}:запланированное-основание:${site.id}:${site.attempts}`),
      { cause: 'resource-search', destination: { x: site.x, y: site.y }, force: true },
    );
    site.attempts += 1;
    site.lastAttemptYear = world.year;
    if (!expedition) continue;
    site.expeditionId = expedition.id;
    site.status = 'traveling';
  }
  refreshDynamicWorldIndexes(indexes, world);
}

function chooseOriginForSite(world: WorldState, site: GenesisSitePlan): Settlement | undefined {
  const activeOrigins = new Set(world.settlementExpeditions
    .filter(expedition => ['forming', 'traveling', 'camped', 'returning'].includes(expedition.status))
    .map(expedition => expedition.originSettlementId));
  return [...world.settlements]
    .filter(settlement => settlement.population >= 24 && settlement.householdIds.length >= 3 && !activeOrigins.has(settlement.id))
    .sort((a, b) => {
      const sponsorA = Number(a.kingdomId === site.sponsorKingdomId);
      const sponsorB = Number(b.kingdomId === site.sponsorKingdomId);
      return sponsorB - sponsorA
        || Math.hypot(a.x - site.x, a.y - site.y) - Math.hypot(b.x - site.x, b.y - site.y)
        || b.population - a.population
        || a.id - b.id;
    })[0];
}

function synchronizeGenesisSites(world: WorldState, sites: GenesisSitePlan[]): void {
  for (const site of sites) {
    const founded = world.settlements.find(settlement => settlement.x === site.x && settlement.y === site.y && settlement.foundedYear >= 2);
    if (founded) {
      site.status = 'founded';
      site.foundedSettlementId = founded.id;
      site.foundedYear = founded.foundedYear;
      continue;
    }
    const expedition = site.expeditionId ? world.settlementExpeditions.find(item => item.id === site.expeditionId) : undefined;
    if (!expedition) {
      if (site.status === 'traveling') site.status = site.attempts >= 3 ? 'failed' : 'planned';
      continue;
    }
    if (expedition.status === 'founded' && expedition.foundedSettlementId) {
      site.status = 'founded';
      site.foundedSettlementId = expedition.foundedSettlementId;
      site.foundedYear = world.settlements.find(item => item.id === expedition.foundedSettlementId)?.foundedYear;
    } else if (expedition.status === 'failed' || expedition.status === 'returned') {
      site.status = site.attempts >= 3 ? 'failed' : 'planned';
      site.expeditionId = undefined;
    }
  }
}

function finalizeLivedHistory(
  world: WorldState,
  config: WorldConfig,
  preparation: GenesisPreparation,
  onProgress?: GenerationProgressReporter,
): void {
  synchronizeGenesisSites(world, preparation.sites);
  reconcileMaterialLocations(world);
  pruneEmptyMaterialItems(world);
  normalizeKingdomCapitals(world);
  synchronizeMortalityIds(world);
  world.events.sort((a, b) => a.year - b.year || a.month - b.month || a.id - b.id);
  world.nextIds.event = Math.max(0, ...world.events.map(event => event.id)) + 1;
  world.nextIds.war = Math.max(0, ...world.wars.map(war => war.id)) + 1;
  world.nextIds.artifact = Math.max(0, ...world.artifacts.map(artifact => artifact.id)) + 1;
  world.nextIds.book = Math.max(0, ...world.books.map(book => book.id)) + 1;

  for (const book of world.books) {
    const localEvents = world.events.filter(event => event.year <= book.yearWritten && event.entityRefs.some(ref => ref.kind === 'settlement' && ref.id === book.settlementId));
    book.referencedEventIds = localEvents.slice(-4).map(event => event.id);
  }

  const eras = livedEraSummaries(world, Math.max(1, config.historyYears));
  const landmarkEventIds = [...world.events]
    .sort((a, b) => b.importance - a.importance || b.year - a.year || b.id - a.id)
    .slice(0, 40)
    .map(event => event.id);
  const integrity = inspectWorldIntegrity(world);
  const genesis = world.history.genesis;
  if (genesis) {
    genesis.sitePlans = preparation.sites;
    genesis.foundedSiteCount = preparation.sites.filter(site => site.status === 'founded').length;
    genesis.failedSiteCount = preparation.sites.filter(site => site.status === 'failed').length;
    genesis.finalSettlementIds = world.settlements.map(settlement => settlement.id);
    genesis.formedKingdomIds = world.kingdoms.filter(kingdom => !preparation.initialKingdomIds.includes(kingdom.id)).map(kingdom => kingdom.id);
    genesis.finalPopulation = world.characters.filter(character => character.alive).length;
  }
  world.history.engineVersion = 3;
  world.history.generatedYears = Math.max(1, config.historyYears);
  world.history.eras = eras;
  world.history.landmarkEventIds = landmarkEventIds;
  world.history.compressedEventCount = Math.max(0, config.historyYears * 12 - ((genesis?.coarseSteps ?? 0) * 3 + (genesis?.detailedMonths ?? 0)));
  world.history.logicWarnings = [...integrity.errors, ...integrity.warnings].slice(0, 40);
  world.history.historicalSimulationVersion = 2;
  world.history.livedDecisionIds = world.decisions.filter(decision => decision.historical || decision.tick <= worldTick(world)).map(decision => decision.id).slice(-1200);
  world.version = SCHEMA_VERSION;
  world.appVersion = APP_VERSION;
  onProgress?.('Живой мир готов', 100, 100,
    `${world.settlements.length} поселений · ${world.kingdoms.length} держав · ${world.events.length} событий прожиты единым миром`);
}


function reconcileMaterialLocations(world: WorldState): void {
  const located = new Set<number>();
  const mark = (ids: readonly number[]) => ids.forEach(id => located.add(id));
  for (const character of world.characters) mark(character.inventoryItemIds);
  for (const household of world.households) mark(household.inventoryItemIds);
  for (const building of world.buildings) mark(building.inventoryItemIds);
  for (const establishment of world.establishments) mark(establishment.inventoryItemIds);
  for (const army of world.armies) mark(army.inventoryItemIds);
  for (const wagon of world.supplyWagons) mark(wagon.inventoryItemIds);
  for (const merchant of world.travelingMerchants) mark(merchant.wagonInventoryItemIds);

  const characterById = new Map(world.characters.map(character => [character.id, character]));
  const householdById = new Map(world.households.map(household => [household.id, household]));
  const buildingById = new Map(world.buildings.map(building => [building.id, building]));
  const establishmentById = new Map(world.establishments.map(establishment => [establishment.id, establishment]));
  const wagonById = new Map(world.supplyWagons.map(wagon => [wagon.id, wagon]));
  const pushUnique = (ids: number[], id: number) => { if (!ids.includes(id)) ids.push(id); located.add(id); };

  for (const item of world.items) {
    if (located.has(item.id)) continue;
    const owner = item.ownerCharacterId ? characterById.get(item.ownerCharacterId) : undefined;
    if (owner) { pushUnique(owner.inventoryItemIds, item.id); continue; }
    const household = item.householdId ? householdById.get(item.householdId) : undefined;
    if (household) { pushUnique(household.inventoryItemIds, item.id); continue; }
    const establishment = item.establishmentId ? establishmentById.get(item.establishmentId) : undefined;
    if (establishment) { pushUnique(establishment.inventoryItemIds, item.id); continue; }
    const wagon = item.supplyWagonId ? wagonById.get(item.supplyWagonId) : undefined;
    if (wagon) { pushUnique(wagon.inventoryItemIds, item.id); continue; }
    const building = item.buildingId ? buildingById.get(item.buildingId) : undefined;
    if (building) { pushUnique(building.inventoryItemIds, item.id); continue; }
    const fallback = world.buildings
      .filter(candidate => candidate.settlementId === item.settlementId)
      .sort((a, b) => Number(b.type === 'warehouse') - Number(a.type === 'warehouse') || a.id - b.id)[0];
    if (fallback) {
      item.buildingId = fallback.id;
      pushUnique(fallback.inventoryItemIds, item.id);
    }
  }
}

function livedEraSummaries(world: WorldState, years: number): HistoricalEraSummary[] {
  const plans = eraPlans(years);
  return plans.map((plan, index) => {
    const eventIds = world.events.filter(event => event.year >= plan.startYear && event.year <= plan.endYear).map(event => event.id);
    const kinds = new Map<string, number>();
    for (const event of world.events.filter(item => eventIds.includes(item.id))) kinds.set(event.kind, (kinds.get(event.kind) ?? 0) + 1);
    const dominant = [...kinds.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([kind, count]) => `${kind}: ${count}`).join(', ');
    return {
      id: index + 1,
      kind: plan.kind,
      name: plan.name,
      startYear: plan.startYear,
      endYear: plan.endYear,
      stepYears: plan.stepYears,
      eventIds,
      summary: `${eventIds.length} причинных событий${dominant ? `; основные: ${dominant}` : ''}.`,
    };
  });
}

function eraPlans(years: number): { kind: HistoricalEraKind; name: string; startYear: number; endYear: number; stepYears: number }[] {
  if (years <= 40) return [{ kind: 'современная эпоха', name: 'Первые поколения', startYear: 1, endYear: years, stepYears: 1 }];
  const ancientEnd = Math.max(8, Math.floor(years * .28));
  const formationEnd = Math.max(ancientEnd + 1, Math.floor(years * .58));
  const dynasticEnd = Math.max(formationEnd + 1, years - Math.min(24, Math.max(8, Math.floor(years * .14))));
  const plans: { kind: HistoricalEraKind; name: string; startYear: number; endYear: number; stepYears: number }[] = [
    { kind: 'древняя эпоха', name: 'Родовые общины', startYear: 1, endYear: ancientEnd, stepYears: 5 },
    { kind: 'эпоха становления', name: 'Основание поселений', startYear: ancientEnd + 1, endYear: formationEnd, stepYears: 3 },
    { kind: 'династическая эпоха', name: 'Союзы и государства', startYear: formationEnd + 1, endYear: dynasticEnd, stepYears: 2 },
    { kind: 'современная эпоха', name: 'Живая память поколений', startYear: dynasticEnd + 1, endYear: years, stepYears: 1 },
  ];
  return plans.filter(plan => plan.startYear <= plan.endYear);
}

function cadenceYears(currentYear: number, coarseEnd: number): number {
  const remaining = coarseEnd - currentYear;
  if (remaining > 180) return 5;
  if (remaining > 90) return 3;
  if (remaining > 30) return 2;
  return 1;
}

function estimateCoarseSteps(startYear: number, endYear: number): number {
  let year = startYear;
  let steps = 0;
  while (year < endYear) {
    year = Math.min(endYear, year + cadenceYears(year, endYear));
    steps += 1;
  }
  return steps;
}

function landComponents(world: WorldState): Map<string, number> {
  const result = new Map<string, number>();
  const tileByKey = new Map(world.tiles.filter(tile => tile.terrain !== 'ocean').map(tile => [`${tile.x}:${tile.y}`, tile]));
  let component = 0;
  for (const key of tileByKey.keys()) {
    if (result.has(key)) continue;
    component += 1;
    const queue = [key];
    result.set(key, component);
    while (queue.length) {
      const current = queue.shift()!;
      const [x, y] = current.split(':').map(Number);
      for (const [nx, ny] of [[x! + 1, y!], [x! - 1, y!], [x!, y! + 1], [x!, y! - 1]]) {
        const next = `${nx}:${ny}`;
        if (!tileByKey.has(next) || result.has(next)) continue;
        result.set(next, component);
        queue.push(next);
      }
    }
  }
  return result;
}
