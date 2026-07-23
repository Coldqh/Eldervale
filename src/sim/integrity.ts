import { cultureIntegrityIssues } from './cultureSystem';
import type { WorldState } from '../types';
import { causalIntegrityIssues } from './causality';
import { ecologyIntegrityIssues } from './ecology';
import { housingIntegrity } from './settlements';
import { materialEconomyIntegrityIssues } from './materialEconomy';
import { territoryIntegrityIssues } from './territory';
import { worldTick } from './scheduler';
import { buildingRect, constructionRect } from './spatial';
import { agricultureConstructionIntegrityIssues } from './agricultureConstruction';
import { livingEconomyIntegrityIssues } from './livingEconomy';
import { militaryInfrastructureIntegrityIssues } from './militaryInfrastructure';
import { knowledgeIntegrityIssues } from './knowledgeSystem';
import { settlementLifeIntegrityIssues } from './settlementLife';
import { stateMachineIntegrityIssues } from './stateMachine';
import { decisionCoreIntegrityIssues } from './decisionCore';
import { mindIntegrityIssues } from './mindSystem';
import { socialSystemIntegrityIssues } from './socialSystem';
import { physicalArmyIntegrityIssues } from './physicalArmy';
import { healthSystemIntegrityIssues } from './healthSystem';
import { battleSystemIntegrityIssues } from './battleSystem';
import { populationIntegrityIssues } from './populationIntegrity';
import { interiorCapacityWarnings, interiorIntegrityIssues } from './interiors';
import { cityIntegrityIssues } from './citySimulation';
import { civilizationIntegrityIssues } from './civilizationSystem';
import { settlementLifecycleIntegrityIssues } from './settlementLifecycle';
import { stateFormationIntegrityIssues } from './stateFormation';
import { regionalEconomyIntegrityIssues } from './regionalEconomy';
import { worldLawIntegrityIssues } from './worldLaw';

export interface WorldIntegrityReport {
  errors: string[];
  warnings: string[];
  checks: number;
}

export function inspectWorldIntegrity(world: WorldState): WorldIntegrityReport {
  const territory = territoryIntegrityIssues(world);
  const errors = [...causalIntegrityIssues(world), ...ecologyIntegrityIssues(world), ...materialEconomyIntegrityIssues(world), ...agricultureConstructionIntegrityIssues(world), ...livingEconomyIntegrityIssues(world), ...militaryInfrastructureIntegrityIssues(world), ...knowledgeIntegrityIssues(world), ...settlementLifeIntegrityIssues(world), ...stateMachineIntegrityIssues(world), ...decisionCoreIntegrityIssues(world), ...mindIntegrityIssues(world), ...socialSystemIntegrityIssues(world), ...physicalArmyIntegrityIssues(world), ...healthSystemIntegrityIssues(world), ...battleSystemIntegrityIssues(world), ...cultureIntegrityIssues(world), ...populationIntegrityIssues(world), ...interiorIntegrityIssues(world), ...cityIntegrityIssues(world), ...civilizationIntegrityIssues(world), ...settlementLifecycleIntegrityIssues(world), ...stateFormationIntegrityIssues(world), ...regionalEconomyIntegrityIssues(world), ...worldLawIntegrityIssues(world), ...territory.errors];
  const warnings: string[] = [...territory.warnings, ...interiorCapacityWarnings(world)];
  let checks = world.events.length * 6 + world.settlements.length * 4 + world.characters.length + world.animalPopulations.length + world.alchemyRecipes.length + (world.buildings?.length ?? 0) + (world.households?.length ?? 0) + (world.establishments?.length ?? 0) + (world.items?.length ?? 0) + (world.cemeteries?.length ?? 0) + (world.burials?.length ?? 0) + (world.fields?.length ?? 0) + (world.constructionProjects?.length ?? 0) + (world.travelingMerchants?.length ?? 0) + (world.marketTransactions?.length ?? 0) + (world.militaryUnits?.length ?? 0) + (world.supplyWagons?.length ?? 0) + (world.knowledgeFacts?.length ?? 0) + (world.memories?.length ?? 0) + (world.rumors?.length ?? 0) + (world.messages?.length ?? 0) + (world.settlementGovernments?.length ?? 0) + (world.districtCivicStates?.length ?? 0) + (world.civicPatrols?.length ?? 0) + (world.crimes?.length ?? 0) + (world.courtCases?.length ?? 0) + (world.fireIncidents?.length ?? 0) + (world.kingdomGovernments?.length ?? 0) + (world.nobleTitles?.length ?? 0) + (world.vassalContracts?.length ?? 0) + (world.courtOffices?.length ?? 0) + (world.courtFactions?.length ?? 0) + (world.royalOrders?.length ?? 0) + (world.stateCrises?.length ?? 0) + (world.diplomaticAgreements?.length ?? 0) + (world.decisions?.length ?? 0) + (world.stateDeltas?.length ?? 0) + (world.socialObligations?.length ?? 0) + (world.armyCamps?.length ?? 0) + (world.armyCampStructures?.length ?? 0) + (world.armyLocalPositions?.length ?? 0) + (world.healthConditions?.length ?? 0) + (world.pregnancies?.length ?? 0) + (world.epidemics?.length ?? 0) + (world.battleRecords?.length ?? 0) + (world.cultures?.length ?? 0) + (world.languages?.length ?? 0) + (world.religions?.length ?? 0) + (world.settlementCultures?.length ?? 0) + (world.simulation.population?.migrations.length ?? 0) + world.buildings.length * 3 + (world.cityStates?.length ?? 0) * 8 + (world.civilizations?.length ?? 0) * 8 + (world.settlementTechnologyKnowledge?.length ?? 0) * 7 + (world.technologyTransmissions?.length ?? 0) * 4 + (world.settlementExpeditions?.length ?? 0) * 8 + (world.politicalCommunities?.length ?? 0) * 7 + (world.politicalTransitions?.length ?? 0) * 3 + (world.resourceDeposits?.length ?? 0) * 4 + (world.settlementRegionalEconomies?.length ?? 0) * 5 + (world.tradeContracts?.length ?? 0) * 4;

  for (const settlement of world.settlements) {
    const housing = housingIntegrity(settlement);
    if (housing) warnings.push(housing);
    const tiles = world.tiles.filter(tile => tile.settlementId === settlement.id);
    if (!tiles.length) errors.push(`${settlement.name}: нет квадрата на глобальной карте`);
    if (settlement.districts.length !== tiles.length) warnings.push(`${settlement.name}: число районов и занятых квадратов различается`);
    if ((settlement.type === 'city' || settlement.type === 'port') && settlement.population >= 700 && settlement.districts.length < 2) warnings.push(`${settlement.name}: крупный город занимает только один квадрат`);
    if (!settlement.layout || settlement.layout.version !== 1 || settlement.layout.settlementId !== settlement.id) errors.push(`${settlement.name}: отсутствует постоянный морфологический план`);
    else {
      if (settlement.layout.generatedFromSeed !== world.config.seed) errors.push(`${settlement.name}: городской план создан для другого ключа мира`);
      for (const district of settlement.districts) {
        const plan = settlement.layout.districtPlans.find(item => item.globalX === district.x && item.globalY === district.y);
        if (!plan) errors.push(`${settlement.name}: район ${district.name} не имеет плана улиц и застройки`);
        else if (plan.centerX < 2 || plan.centerY < 2 || plan.centerX >= (world.config.localMapSize ?? 128) - 2 || plan.centerY >= (world.config.localMapSize ?? 128) - 2) errors.push(`${settlement.name}: центр района ${district.name} находится вне локальной карты`);
      }
    }
  }

  const settlementIds = new Set(world.settlements.map(item => item.id));
  const characterIds = new Set(world.characters.map(item => item.id));
  const monsterIds = new Set(world.monsters.map(item => item.id));
  const cemeteryIds = new Set((world.cemeteries ?? []).map(item => item.id));
  const burialIds = new Set((world.burials ?? []).map(item => item.id));
  const ingredientIds = new Set(world.ingredients.map(item => item.id));
  const tileKeys = new Set(world.tiles.map(tile => `${tile.x}:${tile.y}`));
  for (const character of world.characters) {
    if (!character.alive) errors.push(`${character.name}: мёртвая личность осталась в активной симуляции`);
    const activeExpedition = character.expeditionId ? world.settlementExpeditions?.some(item => item.id === character.expeditionId && ['forming', 'traveling', 'camped', 'returning'].includes(item.status)) : false;
    if (!settlementIds.has(character.settlementId) && !activeExpedition) errors.push(`${character.name}: не существует поселение проживания ${character.settlementId}`);
    if (!character.workplace) warnings.push(`${character.name}: не определено рабочее место`);
  }
  for (const army of world.armies) {
    if (!characterIds.has(army.commanderId) && army.strength > 0) errors.push(`${army.name}: нет живого командира`);
    if (army.status === 'hunting' && (!army.targetMonsterId || !monsterIds.has(army.targetMonsterId))) errors.push(`${army.name}: охота не имеет живой цели`);
    if (army.targetMonsterId && army.status !== 'hunting') warnings.push(`${army.name}: указана цель-чудовище без статуса охоты`);
  }
  const buildingsByTile = new Map<string, WorldState['buildings']>();
  for (const building of world.buildings ?? []) {
    const rect = buildingRect(building);
    const localSize = world.config.localMapSize ?? 128;
    if (rect.width < 4 || rect.height < 4) errors.push(`${building.name}: неверный размер области ${rect.width}×${rect.height}`);
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > localSize || rect.y + rect.height > localSize) errors.push(`${building.name}: область выходит за пределы локальной карты`);
    if (building.entranceX < rect.x || building.entranceY < rect.y || building.entranceX >= rect.x + rect.width || building.entranceY >= rect.y + rect.height) errors.push(`${building.name}: вход находится вне здания`);
    const physicalBeds = building.cityCapacity?.permanentBeds ?? 0;
    if (physicalBeds > 0 && building.residentIds.length > physicalBeds) warnings.push(`${building.name}: физическое перенаселение ${building.residentIds.length}/${physicalBeds}`);
    const key = `${building.globalX}:${building.globalY}`;
    const peers = buildingsByTile.get(key) ?? [];
    for (const peer of peers) {
      const other = buildingRect(peer);
      const overlaps = rect.x < other.x + other.width && rect.x + rect.width > other.x && rect.y < other.y + other.height && rect.y + rect.height > other.y;
      if (overlaps) errors.push(`${building.name}: область пересекается со зданием ${peer.name}`);
    }
    peers.push(building);
    buildingsByTile.set(key, peers);
  }

  for (const project of world.constructionProjects ?? []) {
    if (project.stage === 'завершено' || project.stage === 'заброшено') continue;
    const rect = constructionRect(project);
    const peers = buildingsByTile.get(`${project.globalX}:${project.globalY}`) ?? [];
    for (const building of peers) {
      const other = buildingRect(building);
      if (rect.x < other.x + other.width && rect.x + rect.width > other.x && rect.y < other.y + other.height && rect.y + rect.height > other.y) errors.push(`${project.name}: стройплощадка пересекает ${building.name}`);
    }
  }

  for (const artifact of world.artifacts) if (artifact.ownerId && !characterIds.has(artifact.ownerId)) errors.push(`${artifact.name}: не существует владелец`);
  for (const recipe of world.alchemyRecipes) {
    if (recipe.ingredientIds.some(id => !ingredientIds.has(id))) errors.push(`${recipe.name}: отсутствует ингредиент`);
  }
  for (const monster of world.monsters) {
    if (!monster.alive) errors.push(`${monster.name}: мёртвое существо осталось в активной симуляции`);
    if ((monster.footprintWidth ?? 0) < 1 || (monster.footprintHeight ?? 0) < 1) errors.push(`${monster.name}: неверный физический размер`);
    if ((monster.footprintWidth ?? 1) > 16 || (monster.footprintHeight ?? 1) > 16) warnings.push(`${monster.name}: занимает слишком много локальных клеток`);
  }
  for (const population of world.animalPopulations) {
    if (population.count > population.carryingCapacity * 1.8) warnings.push(`${population.species} ${population.x}:${population.y}: сильное перенаселение`);
  }

  const burialSubjectKeys = new Set<string>();
  for (const burial of world.burials ?? []) {
    if (burial.subjectKind !== 'anonymous' && burial.subjectId !== undefined) {
      const key = `${burial.subjectKind}:${burial.subjectId}`;
      if (burialSubjectKeys.has(key)) errors.push(`Кладбищенский архив: повтор записи ${key}`);
      burialSubjectKeys.add(key);
      if (burial.subjectKind === 'character' && characterIds.has(burial.subjectId)) errors.push(`${burial.name}: одновременно находится среди живых и умерших`);
      if (burial.subjectKind === 'monster' && monsterIds.has(burial.subjectId)) errors.push(`${burial.name}: одновременно находится среди живых существ и останков`);
    }
    if (burial.cemeteryId && !cemeteryIds.has(burial.cemeteryId)) errors.push(`${burial.name}: не существует кладбище ${burial.cemeteryId}`);
    if (burial.state === 'corpse' && burial.cemeteryId) warnings.push(`${burial.name}: тело уже привязано к кладбищу, но не погребено`);
    if (burial.count < 1) errors.push(`${burial.name}: неверное число погибших`);
  }
  for (const cemetery of world.cemeteries ?? []) {
    if (cemetery.settlementId && !settlementIds.has(cemetery.settlementId)) errors.push(`${cemetery.name}: не существует поселение`);
    const unique = new Set(cemetery.burialIds);
    if (unique.size !== cemetery.burialIds.length) errors.push(`${cemetery.name}: повторяющиеся могилы`);
    for (const id of unique) {
      const burial = world.burials.find(item => item.id === id);
      if (!burial) errors.push(`${cemetery.name}: отсутствует запись погребения ${id}`);
      else if (burial.cemeteryId !== cemetery.id) errors.push(`${cemetery.name}: запись ${id} ссылается на другое кладбище`);
    }
  }
  const tick = worldTick(world);
  for (const effect of world.localMapChanges) {
    if (effect.burialId && !burialIds.has(effect.burialId)) errors.push(`Местность ${effect.id}: отсутствует запись останков ${effect.burialId}`);
    if (effect.kind === 'body' && effect.expiresTick !== undefined && effect.expiresTick <= tick) errors.push(`Местность ${effect.id}: просроченный труп не удалён`);
  }

  const scheduledIds = new Set<string>();
  for (const action of world.simulation.queuedActions) {
    if (scheduledIds.has(action.id)) errors.push(`Планировщик: повтор действия ${action.id}`);
    scheduledIds.add(action.id);
    if (action.kind === 'army' && !world.armies.some(item => item.id === action.entityId)) errors.push(`Планировщик: не существует армия ${action.entityId}`);
    if (action.kind === 'monster' && !world.monsters.some(item => item.id === action.entityId)) errors.push(`Планировщик: не существует существо ${action.entityId}`);
    if (action.kind === 'war' && !world.wars.some(item => item.id === action.entityId)) errors.push(`Планировщик: не существует война ${action.entityId}`);
  }
  for (const key of world.simulation.activeRegionKeys) if (!tileKeys.has(key)) warnings.push(`Планировщик: активный регион ${key} находится вне карты`);

  checks += world.armies.length + world.artifacts.length + world.ingredients.length + world.monsters.length + world.territoryHistory.length + world.tiles.length + world.simulation.queuedActions.length + world.simulation.activeRegionKeys.length;
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], checks };
}
