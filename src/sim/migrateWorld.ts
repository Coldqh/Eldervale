import type { Dynasty, Relationship, TradeRoute, WorldState } from '../types';
import { localizeLegacyWorld } from './localizeLegacy';
import { APP_VERSION } from '../version';
import { RNG } from './rng';
import { normalizeEventCausality } from './causality';
import { generateAlchemyRecipes, generateAnimalPopulations, generateNaturalIngredients } from './ecology';
import { createHousingProfile } from './settlements';
import { createSimulationRuntime, ensureSimulationRuntime } from './scheduler';
import { generatePhysicalEconomy, pruneEmptyMaterialItems } from './materialEconomy';
import { rebuildTerritoryHistoryFromCurrent } from './territory';
import { compactDeadEntities, ensureCemeteries, synchronizeMortalityIds } from './mortality';
import { ensureAllBuildingFootprints } from './spatial';
import { initializeAgricultureAndConstruction } from './agricultureConstruction';
import { initializeLivingEconomy, synchronizeEmploymentLinks } from './livingEconomy';
import { initializeMilitaryInfrastructure } from './militaryInfrastructure';
import { initializePhysicalArmySystem } from './physicalArmy';
import { emptyCharacterKnowledge, initializeKnowledgeSystem } from './knowledgeSystem';
import { initializeSettlementLife } from './settlementLife';
import { initializeStateMachine } from './stateMachine';
import { normalizeKingdomCapitals } from './kingdomState';
import { initializeDecisionCore } from './decisionCore';
import { initializeMindSystem } from './mindSystem';
import { initializeSocialSystem } from './socialSystem';
import { initializeHealthSystem } from './healthSystem';
import { initializeBattleSystem } from './battleSystem';
import { initializeCultureSystem } from './cultureSystem';
import { advanceCitySimulation, initializeCitySimulation } from './citySimulation';
import { initializeCivilizationSystem } from './civilizationSystem';
import { normalizeSettlementLayouts } from './cityMorphology';
import { initializeSettlementLifecycle } from './settlementLifecycle';
import { initializeStateFormation } from './stateFormation';

export function migrateWorld(input: unknown): WorldState {
  const raw = structuredClone(input) as any;
  if (!raw || !Array.isArray(raw.tiles) || !Array.isArray(raw.characters)) throw new Error('Неверный формат сохранения');
  const sourceVersion = Number(raw.version ?? 0);
  const localized = localizeLegacyWorld(raw as WorldState) as any;
  const rng = new RNG(`${localized.config?.seed ?? 'Eldervale'}:переход-на-схему-31`);
  const previousLocalSize = localized.config?.localMapSize ?? 48;

  const hadTerritoryHistory = Array.isArray(localized.territoryHistory) && localized.territoryHistory.length > 0;
  localized.version = 31;
  localized.language = 'ru';
  localized.appVersion = APP_VERSION;
  localized.config ??= {};
  localized.config.localMapSize = [96, 128, 160].includes(localized.config.localMapSize) ? localized.config.localMapSize : 128;
  localized.config.ecologyDensity ??= 1;
  localized.config.huntingPressure ??= 1;
  localized.relationships ??= [];
  localized.dynasties ??= [];
  localized.tradeRoutes ??= [];
  localized.wars ??= [];
  localized.events ??= [];
  localized.localMapChanges ??= [];
  localized.cemeteries ??= [];
  localized.burials ??= [];
  localized.buildings ??= [];
  localized.households ??= [];
  localized.establishments ??= [];
  localized.fields ??= [];
  localized.constructionProjects ??= [];
  localized.items ??= [];
  localized.productionRecipes ??= [];
  localized.employments ??= [];
  localized.shipments ??= [];
  localized.travelingMerchants ??= [];
  localized.marketTransactions ??= [];
  localized.knowledgeFacts ??= [];
  localized.memories ??= [];
  localized.rumors ??= [];
  localized.messages ??= [];
  localized.settlementKnowledge ??= [];
  localized.cultures ??= [];
  localized.civilizations ??= [];
  localized.settlementExpeditions ??= [];
  localized.politicalCommunities ??= [];
  localized.politicalTransitions ??= [];
  localized.languages ??= [];
  localized.religions ??= [];
  localized.settlementCultures ??= [];
  localized.settlementGovernments ??= [];
  localized.districtCivicStates ??= [];
  localized.cityStates ??= [];
  localized.urbanStates ??= [];
  localized.civicPatrols ??= [];
  localized.crimes ??= [];
  localized.courtCases ??= [];
  localized.fireIncidents ??= [];
  localized.kingdomGovernments ??= [];
  localized.nobleTitles ??= [];
  localized.vassalContracts ??= [];
  localized.courtOffices ??= [];
  localized.courtFactions ??= [];
  localized.royalOrders ??= [];
  localized.stateCrises ??= [];
  localized.diplomaticAgreements ??= [];
  localized.socialObligations ??= [];
  localized.healthConditions ??= [];
  localized.pregnancies ??= [];
  localized.epidemics ??= [];
  localized.decisions ??= [];
  localized.stateDeltas ??= [];
  localized.battleRecords ??= [];
  localized.militaryUnits ??= [];
  localized.supplyWagons ??= [];
  localized.armyCamps ??= [];
  localized.armyCampStructures ??= [];
  localized.armyLocalPositions ??= [];
  localized.territoryHistory ??= [];
  localized.nextIds ??= {};
  localized.simulation ??= createSimulationRuntime({ year: localized.year ?? localized.config.historyYears ?? 1, month: localized.month ?? 1 });
  if (sourceVersion < 12) localized.simulation.livingEconomyVersion = undefined;
  if (sourceVersion < 13) localized.simulation.militaryInfrastructureVersion = undefined;
  if (sourceVersion < 14) localized.simulation.knowledgeSystemVersion = undefined;
  if (sourceVersion < 15) localized.simulation.settlementLifeVersion = undefined;
  if (sourceVersion < 16) localized.simulation.stateMachineVersion = undefined;
  if (sourceVersion < 17) { localized.simulation.decisionCoreVersion = undefined; localized.simulation.mindSystemVersion = undefined; }
  if (sourceVersion < 18) { localized.simulation.socialSystemVersion = undefined; localized.simulation.lastSocialBurialId = undefined; }
  if (sourceVersion < 19) localized.simulation.physicalArmyVersion = undefined;
  if (sourceVersion < 20) localized.simulation.performanceCoreVersion = undefined;
  if (sourceVersion < 21) localized.simulation.healthSystemVersion = undefined;
  if (sourceVersion < 22) localized.simulation.battleSystemVersion = undefined;
  if (sourceVersion < 23) localized.simulation.cultureSystemVersion = undefined;
  if (sourceVersion < 27) localized.simulation.civilizationSystemVersion = undefined;
  if (sourceVersion < 29) localized.simulation.settlementLifecycleVersion = undefined;
  if (sourceVersion < 30) localized.simulation.stateFormationVersion = undefined;
  localized.history ??= {
    engineVersion: 1, generatedYears: localized.config.historyYears ?? localized.year ?? 1, eras: [],
    landmarkEventIds: [], fallenRealms: [], compressedEventCount: 0, logicWarnings: [],
  };
  localized.history.engineVersion = Math.max(1, localized.history.engineVersion ?? 1);
  localized.history.generatedYears ??= localized.config.historyYears ?? localized.year ?? 1;
  localized.history.eras ??= [];
  localized.history.landmarkEventIds ??= [...localized.events].sort((a: any, b: any) => (b.importance ?? 0) - (a.importance ?? 0)).slice(0, 32).map((event: any) => event.id);
  localized.history.fallenRealms ??= [];
  localized.history.compressedEventCount ??= 0;
  localized.history.logicWarnings ??= [];
  localized.history.livedDecisionIds ??= [];

  if (previousLocalSize !== localized.config.localMapSize) {
    const ratio = localized.config.localMapSize / Math.max(1, previousLocalSize);
    for (const effect of localized.localMapChanges) {
      effect.localX = Math.max(1, Math.min(localized.config.localMapSize - 2, Math.round(effect.localX * ratio)));
      effect.localY = Math.max(1, Math.min(localized.config.localMapSize - 2, Math.round(effect.localY * ratio)));
    }
  }

  for (const kingdom of localized.kingdoms) {
    kingdom.claims ??= [];
    kingdom.diplomacy ??= [];
    kingdom.laws ??= ['королевский мир на дорогах', 'налог с рынков', 'воинская повинность'];
    kingdom.predecessorKingdomIds ??= [];
    kingdom.politicalOrigin ??= 'generated';
  }
  for (const settlement of localized.settlements) {
    settlement.resource ??= resourceForTerrain(localized, settlement.x, settlement.y, rng);
    settlement.shortages ??= [];
    settlement.tradeRouteIds ??= [];
    settlement.unrest ??= 0;
    settlement.history ??= [`${settlement.name} существует с ${settlement.foundedYear} года.`];
    if (!settlement.buildingCounts || !settlement.residentialCapacity || !settlement.households) {
      const housing = createHousingProfile(settlement.population, settlement.type, rng);
      settlement.buildingCounts = housing.buildingCounts;
      settlement.residentialCapacity = housing.residentialCapacity;
      settlement.households = housing.households;
      settlement.buildings = housing.buildings;
    }
    settlement.districts ??= [{ x: settlement.x, y: settlement.y, name: 'Сердце поселения', role: settlement.type === 'fortress' ? 'крепость' : 'центр' }];
    settlement.stockpile ??= { [settlement.resource]: 30, зерно: Math.max(12, Math.round(settlement.food / 2)), древесина: 25, камень: 12 };
    settlement.buildingIds ??= [];
    settlement.householdIds ??= [];
    settlement.establishmentIds ??= [];
    settlement.politicalStatus ??= settlement.foundingExpeditionId ? 'frontier' : 'integrated';
    settlement.economy ??= { currency: 'крона', coinSupply: Math.max(100, settlement.population * 12), priceIndex: 1, wageIndex: 1, rentIndex: 1, taxRate: .08, prices: {}, supply: {}, demand: {}, imports: {}, exports: {}, lastMonthlyTrade: 0, bankruptcies: 0 };
    settlement.livestock ??= { куры: Math.round(settlement.population / 8), козы: Math.round(settlement.population / 18), лошади: Math.round(settlement.population / 45) };
    for (const district of settlement.districts) {
      const tile = localized.tiles.find((item: any) => item.x === district.x && item.y === district.y);
      if (tile) { tile.settlementId = settlement.id; tile.settlementDistrict = district.name; }
    }
  }
  for (const character of localized.characters) {
    character.wealth ??= character.age < 14 ? 0 : rng.int(0, 140);
    character.loyalty ??= rng.int(30, 90);
    character.relationshipIds ??= [];
    character.injuries ??= [];
    character.workplace ??= workplaceFor(character.profession);
    const settlement = localized.settlements.find((item: any) => item.id === character.settlementId);
    character.homeDistrict ??= settlement?.districts?.[0]?.name ?? 'Сердце поселения';
    character.inventoryItemIds ??= [];
    character.skills ??= { [character.profession]: Math.max(1, Math.min(100, rng.int(8, 45) + Math.floor((character.age ?? 0) / 3))) };
    character.needs ??= { hunger: 10, thirst: 8, rest: 10, warmth: 10, safety: 12, social: 16, lastUpdatedTick: (localized.year ?? 1) * 12 + (localized.month ?? 1) - 1 };
    character.schedule ??= { wakeHour: 6, workStartHour: character.age >= 14 ? 8 : 0, workEndHour: character.age >= 14 ? 17 : 0, sleepHour: 22, restDay: 1 + character.id % 7, currentActivity: character.age >= 14 ? 'занят обычной работой' : 'живёт в семье и учится' };
    character.wallet ??= Math.max(0, Math.round(character.wealth * .18 * 100) / 100);
    character.serviceStatus ??= 'гражданский';
    character.militaryExperience ??= 0;
    character.servicePayArrears ??= 0;
    character.nobleTitleIds ??= [];
    character.courtOfficeIds ??= [];
    character.politicalInfluence ??= Math.max(1, Math.min(100, Math.round((character.renown ?? 0) * .45 + (character.loyalty ?? 50) * .25 + ((character.titles?.length ?? 0) ? 16 : 0))));
    character.knowledge ??= emptyCharacterKnowledge((localized.year ?? 1) * 12 + (localized.month ?? 1) - 1);
  }
  for (const army of localized.armies) {
    army.supplies ??= 70;
    army.campaignHistory ??= [];
    army.targetMonsterId ??= undefined;
    if (army.status === 'battle' && army.targetMonsterId) army.status = 'hunting';
    army.soldierIds ??= []; army.unitIds ??= []; army.supplyWagonIds ??= []; army.inventoryItemIds ??= [];
    army.logistics ??= { foodDays: Math.max(8, Math.round(army.supplies * .65)), waterDays: Math.max(6, Math.round(army.supplies * .5)), medicine: 12, tents: 0, tools: 0, horses: 0, wagons: 0, equipmentCoverage: 0, armorCoverage: 0, rangedCoverage: 0, payrollDebt: 0, desertions: 0, wounded: 0 };
    army.monthlyPayroll ??= 0; army.readiness ??= 35;
  }
  for (const monster of localized.monsters) {
    monster.hunger ??= rng.int(20, 65);
    monster.territoryRadius ??= monster.species === 'dragon' ? 7 : 4;
    monster.behavior ??= monster.species === 'dragon' ? 'охраняет логово и собирает сокровища' : 'охотится в своей области';
    monster.goal ??= monster.species === 'dragon' ? 'расширить сокровищницу' : 'найти безопасное логово';
    const giant = monster.species === 'dragon' || monster.species === 'giant serpent' || monster.tier === 'boss';
    monster.footprintWidth ??= monster.species === 'dragon' ? (monster.tier === 'boss' ? 9 : 6) : monster.species === 'giant serpent' ? 8 : monster.tier === 'boss' ? 5 : monster.tier === 'miniboss' ? 3 : giant ? 2 : 1;
    monster.footprintHeight ??= monster.species === 'giant serpent' ? 2 : monster.species === 'dragon' ? (monster.tier === 'boss' ? 6 : 4) : monster.tier === 'boss' ? 5 : monster.tier === 'miniboss' ? 3 : giant ? 2 : 1;
  }
  for (const artifact of localized.artifacts) artifact.ownerHistory ??= [{ year: artifact.yearCreated, characterId: artifact.ownerId, settlementId: artifact.settlementId, reason: 'первый известный владелец' }];
  for (const book of localized.books) { book.bias ??= 'личный взгляд автора'; book.referencedEventIds ??= []; }
  for (const dungeon of localized.dungeons) { dungeon.purpose ??= dungeon.origin; dungeon.discovered ??= true; }
  for (const war of localized.wars) { war.goal ??= 'добиться уступок'; war.contestedSettlementIds ??= []; war.history ??= []; }
  localized.events = localized.events.map(normalizeEventCausality);
  if (sourceVersion < 17) {
    for (const event of localized.events) {
      event.decisionId = undefined;
      event.stateDeltaIds = [];
    }
    localized.history.livedDecisionIds = [];
  }

  localized.animalPopulations ??= generateAnimalPopulations(localized.config.seed, localized.tiles, localized.config.ecologyDensity);
  localized.ingredients ??= generateNaturalIngredients(localized.config.seed, localized.tiles, localized.config.ecologyDensity);
  localized.alchemyRecipes ??= generateAlchemyRecipes({ ingredients: localized.ingredients, characters: localized.characters, year: localized.year }, rng);

  backfillRelationships(localized, rng);
  backfillDynasties(localized, rng);
  backfillTradeRoutes(localized, rng);
  backfillDiplomacy(localized, rng);

  localized.nextIds.relationship = Math.max(0, ...localized.relationships.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.dynasty = Math.max(0, ...localized.dynasties.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.tradeRoute = Math.max(0, ...localized.tradeRoutes.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.event ??= Math.max(0, ...localized.events.map((event: any) => event.id ?? 0)) + 1;
  localized.nextIds.character ??= Math.max(0, ...localized.characters.map((character: any) => character.id ?? 0)) + 1;
  localized.nextIds.war ??= Math.max(0, ...localized.wars.map((war: any) => war.id ?? 0)) + 1;
  localized.nextIds.artifact ??= Math.max(0, ...localized.artifacts.map((artifact: any) => artifact.id ?? 0)) + 1;
  localized.nextIds.book ??= Math.max(0, ...localized.books.map((book: any) => book.id ?? 0)) + 1;
  localized.nextIds.animalPopulation = Math.max(0, ...localized.animalPopulations.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.ingredient = Math.max(0, ...localized.ingredients.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.recipe = Math.max(0, ...localized.alchemyRecipes.map((item: any) => item.id ?? 0)) + 1;

  localized.nextIds.building = Math.max(0, ...localized.buildings.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.household = Math.max(0, ...localized.households.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.establishment = Math.max(0, ...localized.establishments.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.item = Math.max(0, ...localized.items.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.productionRecipe = Math.max(0, ...localized.productionRecipes.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.employment = Math.max(0, ...localized.employments.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.shipment = Math.max(0, ...localized.shipments.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.travelingMerchant = Math.max(0, ...localized.travelingMerchants.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.marketTransaction = Math.max(0, ...localized.marketTransactions.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.knowledgeFact = Math.max(0, ...localized.knowledgeFacts.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.memory = Math.max(0, ...localized.memories.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.rumor = Math.max(0, ...localized.rumors.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.message = Math.max(0, ...localized.messages.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.culture = Math.max(0, ...localized.cultures.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.language = Math.max(0, ...localized.languages.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.religion = Math.max(0, ...localized.religions.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.settlementCulture = Math.max(0, ...localized.settlementCultures.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.settlementGovernment = Math.max(0, ...localized.settlementGovernments.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.districtCivic = Math.max(0, ...localized.districtCivicStates.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.patrol = Math.max(0, ...localized.civicPatrols.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.crime = Math.max(0, ...localized.crimes.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.courtCase = Math.max(0, ...localized.courtCases.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.fireIncident = Math.max(0, ...localized.fireIncidents.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.kingdomGovernment = Math.max(0, ...localized.kingdomGovernments.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.nobleTitle = Math.max(0, ...localized.nobleTitles.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.vassalContract = Math.max(0, ...localized.vassalContracts.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.courtOffice = Math.max(0, ...localized.courtOffices.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.courtFaction = Math.max(0, ...localized.courtFactions.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.royalOrder = Math.max(0, ...localized.royalOrders.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.stateCrisis = Math.max(0, ...localized.stateCrises.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.diplomaticAgreement = Math.max(0, ...localized.diplomaticAgreements.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.socialObligation = Math.max(0, ...localized.socialObligations.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.decision = Math.max(0, ...localized.decisions.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.stateDelta = Math.max(0, ...localized.stateDeltas.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.battleRecord = Math.max(0, ...localized.battleRecords.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.militaryUnit = Math.max(0, ...localized.militaryUnits.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.supplyWagon = Math.max(0, ...localized.supplyWagons.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.armyCamp = Math.max(0, ...localized.armyCamps.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.armyCampStructure = Math.max(0, ...localized.armyCampStructures.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.territoryChange = Math.max(0, ...localized.territoryHistory.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.cemetery = Math.max(0, ...localized.cemeteries.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.burial = Math.max(0, ...localized.burials.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.civilization = Math.max(0, ...localized.civilizations.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.settlement = Math.max(0, ...localized.settlements.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.settlementExpedition = Math.max(0, ...localized.settlementExpeditions.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.politicalCommunity = Math.max(0, ...localized.politicalCommunities.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.politicalTransition = Math.max(0, ...localized.politicalTransitions.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.kingdom = Math.max(0, ...localized.kingdoms.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.army = Math.max(0, ...localized.armies.map((item: any) => item.id ?? 0)) + 1;

  normalizeKingdomCapitals(localized);
  normalizeSettlementLayouts(localized as WorldState);
  for (const building of localized.buildings ?? []) building.spatialVersion = sourceVersion < 28 ? 2 : (building.spatialVersion ?? 1);
  generatePhysicalEconomy(localized as WorldState, new RNG(`${localized.config.seed}:переход-повседневная-жизнь-v1`));
  ensureAllBuildingFootprints(localized as WorldState);
  initializeAgricultureAndConstruction(localized as WorldState, new RNG(`${localized.config.seed}:переход-земледелие-стройка-v1`));
  initializeLivingEconomy(localized as WorldState, new RNG(`${localized.config.seed}:переход-личная-экономика-v1`));
  initializeDecisionCore(localized as WorldState);
  initializeMindSystem(localized as WorldState);
  initializeMilitaryInfrastructure(localized as WorldState, new RNG(`${localized.config.seed}:переход-военная-инфраструктура-v1`));
  initializePhysicalArmySystem(localized as WorldState, new RNG(`${localized.config.seed}:переход-физические-армии-v1`));
  pruneEmptyMaterialItems(localized as WorldState);
  repairMigratedItemLocations(localized as WorldState, sourceVersion);
  ensureCemeteries(localized as WorldState, rng);
  compactDeadEntities(localized as WorldState, rng);
  synchronizeMortalityIds(localized as WorldState);
  initializeKnowledgeSystem(localized as WorldState, new RNG(`${localized.config.seed}:переход-память-и-знания-v1`));
  initializeSettlementLife(localized as WorldState, new RNG(`${localized.config.seed}:переход-жизнь-поселений-v1`));
  initializeStateMachine(localized as WorldState, new RNG(`${localized.config.seed}:переход-государственная-машина-v1`));
  initializeSocialSystem(localized as WorldState);
  initializeHealthSystem(localized as WorldState);
  initializeBattleSystem(localized as WorldState);
  initializeCultureSystem(localized as WorldState, new RNG(`${localized.config.seed}:переход-культура-вера-образование-v1`));
  initializeCivilizationSystem(localized as WorldState, new RNG(`${localized.config.seed}:переход-цивилизации-и-технологии-v1`));
  initializeSettlementLifecycle(localized as WorldState);
  initializeStateFormation(localized as WorldState);
  if (!hadTerritoryHistory) rebuildTerritoryHistoryFromCurrent(localized as WorldState);

  for (const effect of localized.localMapChanges) { effect.month ??= 1; }
  ensureSimulationRuntime(localized as WorldState);
  synchronizeEmploymentLinks(localized as WorldState);
  for (const settlement of localized.settlements) {
    settlement.population = localized.characters.reduce((sum: number, character: any) =>
      sum + Number(character.alive && character.settlementId === settlement.id), 0);
  }
  initializeCitySimulation(localized as WorldState);
  // Сохранение могло содержать актуальную версию snapshot, но устаревшие
  // физические профили зданий. Миграция всегда завершает один чистый городской ход.
  advanceCitySimulation(localized as WorldState);

  localized.history.engineVersion = 2;
  localized.history.historicalSimulationVersion ??= 1;
  localized.history.livedDecisionIds ??= localized.decisions.filter((item: any) => item.historical).map((item: any) => item.id).slice(-1200);
  return localized as WorldState;
}


function repairMigratedItemLocations(world: WorldState, sourceVersion: number): void {
  const itemIds = new Set(world.items.map(item => item.id));
  const uniqueValid = (ids: number[] | undefined): number[] => [...new Set((ids ?? []).filter(id => itemIds.has(id)))];
  const characterById = new Map(world.characters.map(character => [character.id, character]));
  const householdById = new Map(world.households.map(household => [household.id, household]));
  const buildingById = new Map(world.buildings.map(building => [building.id, building]));
  const establishmentById = new Map(world.establishments.map(establishment => [establishment.id, establishment]));
  const wagonById = new Map((world.supplyWagons ?? []).map(wagon => [wagon.id, wagon]));

  for (const character of world.characters) character.inventoryItemIds = uniqueValid(character.inventoryItemIds);
  for (const household of world.households) household.inventoryItemIds = uniqueValid(household.inventoryItemIds);
  for (const building of world.buildings) building.inventoryItemIds = uniqueValid(building.inventoryItemIds);
  for (const establishment of world.establishments) establishment.inventoryItemIds = uniqueValid(establishment.inventoryItemIds);
  for (const army of world.armies) army.inventoryItemIds = uniqueValid(army.inventoryItemIds);
  for (const wagon of world.supplyWagons ?? []) wagon.inventoryItemIds = uniqueValid(wagon.inventoryItemIds);
  for (const merchant of world.travelingMerchants ?? []) merchant.wagonInventoryItemIds = uniqueValid(merchant.wagonInventoryItemIds);

  const located = new Set<number>();
  const mark = (ids: number[]) => ids.forEach(id => located.add(id));
  world.characters.forEach(character => mark(character.inventoryItemIds));
  world.households.forEach(household => mark(household.inventoryItemIds));
  world.buildings.forEach(building => mark(building.inventoryItemIds));
  world.establishments.forEach(establishment => mark(establishment.inventoryItemIds));
  world.armies.forEach(army => mark(army.inventoryItemIds));
  (world.supplyWagons ?? []).forEach(wagon => mark(wagon.inventoryItemIds));
  (world.travelingMerchants ?? []).forEach(merchant => mark(merchant.wagonInventoryItemIds));

  const addUnique = (ids: number[], itemId: number): void => { if (!ids.includes(itemId)) ids.push(itemId); located.add(itemId); };
  const fallbackBuilding = (settlementId: number) => {
    const candidates = world.buildings.filter(building => building.settlementId === settlementId);
    return candidates.find(building => building.type === 'arsenal')
      ?? candidates.find(building => building.type === 'warehouse')
      ?? candidates.find(building => building.type === 'barracks')
      ?? candidates.find(building => building.type === 'castle')
      ?? candidates[0];
  };

  for (const item of world.items) {
    if (sourceVersion < 13 && item.supplyWagonId && !wagonById.has(item.supplyWagonId)) item.supplyWagonId = undefined;

    const owner = item.ownerCharacterId ? characterById.get(item.ownerCharacterId) : undefined;
    const household = item.householdId ? householdById.get(item.householdId) : undefined;
    const establishment = item.establishmentId ? establishmentById.get(item.establishmentId) : undefined;
    const wagon = item.supplyWagonId ? wagonById.get(item.supplyWagonId) : undefined;
    const building = item.buildingId ? buildingById.get(item.buildingId) : undefined;

    if (owner) addUnique(owner.inventoryItemIds, item.id);
    if (household) addUnique(household.inventoryItemIds, item.id);
    if (establishment) addUnique(establishment.inventoryItemIds, item.id);
    if (wagon) addUnique(wagon.inventoryItemIds, item.id);
    if (building && !owner && !household && !establishment && !wagon) addUnique(building.inventoryItemIds, item.id);

    if (located.has(item.id)) continue;
    const destination = fallbackBuilding(item.settlementId);
    if (!destination) continue;
    item.ownerCharacterId = undefined;
    item.householdId = undefined;
    item.establishmentId = undefined;
    item.supplyWagonId = undefined;
    item.buildingId = destination.id;
    item.history ??= [];
    item.history.push(`После обновления хранилища предмет передан в ${destination.name}.`);
    addUnique(destination.inventoryItemIds, item.id);
  }
}

function workplaceFor(profession: string): string {
  const map: Record<string, string> = {
    child: 'дом семьи', farmer: 'поля и пастбища', miller: 'мельница', hunter: 'охотничьи угодья', guard: 'стража и ворота',
    blacksmith: 'кузница', carpenter: 'плотницкая мастерская', herbalist: 'травницкая мастерская', merchant: 'рынок', scribe: 'архив или канцелярия',
    priest: 'храм', soldier: 'казармы', fisher: 'берег или пристань', miner: 'шахта', weaver: 'ткацкая мастерская', brewer: 'пивоварня', healer: 'лечебница',
  };
  return map[profession] ?? 'местные работы';
}

function resourceForTerrain(world: any, x: number, y: number, rng: RNG): string {
  const terrain = world.tiles.find((tile: any) => tile.x === x && tile.y === y)?.terrain;
  const resources: Record<string, string[]> = {
    coast: ['рыба', 'соль'], plains: ['зерно', 'лён'], forest: ['древесина', 'мёд'], hills: ['камень', 'железо'],
    mountains: ['железо', 'серебро'], marsh: ['торф', 'тростник'], desert: ['соль', 'пряности'], tundra: ['меха', 'рыба'],
  };
  return rng.pick(resources[terrain] ?? ['зерно']);
}

function backfillRelationships(world: any, rng: RNG): void {
  if (world.relationships.length) return;
  const relationships: Relationship[] = [];
  let id = 1;
  const add = (characterAId: number, characterBId: number, kind: Relationship['kind'], strength: number, reason: string) => {
    if (characterAId === characterBId || relationships.some(item => (item.characterAId === characterAId && item.characterBId === characterBId) || (item.characterAId === characterBId && item.characterBId === characterAId))) return;
    const relation: Relationship = { id: id++, characterAId, characterBId, kind, strength, sinceYear: Math.max(1, world.year - rng.int(1, 40)), public: true, reason };
    relationships.push(relation);
    world.characters.find((item: any) => item.id === characterAId)?.relationshipIds.push(relation.id);
    world.characters.find((item: any) => item.id === characterBId)?.relationshipIds.push(relation.id);
  };
  for (const character of world.characters) {
    for (const parentId of character.parentIds ?? []) add(parentId, character.id, 'родство', rng.int(60, 100), 'родитель и ребёнок');
    if (character.spouseId && character.id < character.spouseId) add(character.id, character.spouseId, 'любовь', rng.int(45, 92), 'супружество');
  }
  world.relationships = relationships;
}

function backfillDynasties(world: any, rng: RNG): void {
  if (world.dynasties.length) return;
  const dynasties: Dynasty[] = [];
  for (const kingdom of world.kingdoms) {
    const ruler = world.characters.find((item: any) => item.id === kingdom.rulerId);
    if (!ruler) continue;
    const members = new Set<number>([ruler.id, ...(ruler.parentIds ?? []), ...(ruler.childIds ?? [])]);
    if (ruler.spouseId) members.add(ruler.spouseId);
    const dynasty: Dynasty = {
      id: dynasties.length + 1, name: `Дом ${ruler.name}`, founderId: ruler.parentIds?.[0] ?? ruler.id, currentHeadId: ruler.id,
      memberIds: [...members], kingdomId: kingdom.id, prestige: rng.int(55, 90), wealth: rng.int(500, 2200), claimKingdomIds: [kingdom.id],
      history: [`Дом восстановлен из старых родословных государства ${kingdom.name}.`],
    };
    dynasties.push(dynasty);
    kingdom.dynastyId = dynasty.id;
    for (const memberId of dynasty.memberIds) {
      const member = world.characters.find((item: any) => item.id === memberId);
      if (member) member.dynastyId = dynasty.id;
    }
  }
  world.dynasties = dynasties;
}

function backfillTradeRoutes(world: any, rng: RNG): void {
  if (world.tradeRoutes.length) return;
  const routes: TradeRoute[] = [];
  const used = new Set<string>();
  for (const from of world.settlements) {
    const candidates = world.settlements.filter((item: any) => item.id !== from.id).sort((a: any, b: any) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y)).slice(0, 1);
    for (const to of candidates) {
      const key = [from.id, to.id].sort((a, b) => a - b).join(':');
      if (used.has(key)) continue;
      used.add(key);
      const route: TradeRoute = {
        id: routes.length + 1, name: `${from.name} — ${to.name}`, fromSettlementId: from.id, toSettlementId: to.id,
        goods: [...new Set([from.resource, to.resource])], volume: rng.int(18, 70), safety: rng.int(45, 88), active: true,
        controlledByKingdomIds: [...new Set([from.kingdomId, to.kingdomId])], history: ['Путь восстановлен из старых торговых записей.'],
      };
      routes.push(route);
      from.tradeRouteIds.push(route.id);
      to.tradeRouteIds.push(route.id);
    }
  }
  world.tradeRoutes = routes;
}

function backfillDiplomacy(world: any, rng: RNG): void {
  for (const kingdom of world.kingdoms) {
    if (kingdom.diplomacy.length) continue;
    for (const other of world.kingdoms.filter((item: any) => item.id !== kingdom.id)) {
      const score = rng.int(-45, 60);
      kingdom.diplomacy.push({ kingdomId: other.id, score, status: score > 38 ? 'союз' : score < -25 ? 'напряжение' : 'мир', reason: score < 0 ? 'старые споры и пошлины' : 'торговля и общие интересы' });
    }
  }
}
