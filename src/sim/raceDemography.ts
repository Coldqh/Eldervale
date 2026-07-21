import type { Building, Character, Household, Settlement, Species, WorldState } from '../types';
import type {
  MigrationReason, MigrationRecord, PopulationShare, PopulationSystemState, SettlementDemographyState,
} from '../populationTypes';
import type { WorldIndexes } from './indexes';
import { ensureCharacterCultureProfile } from './cultureSystem';
import { moveResidentInIndexes } from './indexes';
import { personName } from './names';
import { hashSeed, RNG } from './rng';
import { worldTick } from './scheduler';
import {
  ACTIVE_SPECIES, mixedSettlementScale, raceDefinition, terrainAffinity,
} from '../raceCatalog';

export { ACTIVE_SPECIES };

export interface SettlementRaceProfile {
  primary: Species;
  mixed: boolean;
  minority?: Species;
  minorityShare: number;
  reason: string;
}

export interface PopulationAdvanceOptions {
  elapsedMonths?: number;
  indexes?: WorldIndexes;
  recordHistory?: boolean;
}

const POPULATION_VERSION = 1;
const RACE_DEMOGRAPHY_VERSION = 2;
const MIGRATION_INTERVAL_MONTHS = 3;
const MAX_MIGRATIONS = 600;

export function settlementRaceProfile(world: WorldState, settlement: Settlement): SettlementRaceProfile {
  const stored = world.simulation.population?.settlements.find(item => item.settlementId === settlement.id);
  if (stored) {
    const minority = stored.shares.find(item => item.species !== stored.primarySpecies)?.species;
    const minorityShare = stored.shares.filter(item => item.species !== stored.primarySpecies).reduce((sum, item) => sum + item.share, 0);
    return {
      primary: stored.primarySpecies,
      mixed: stored.mixed,
      minority,
      minorityShare,
      reason: stored.reason,
    };
  }
  return seededSettlementProfile(world, settlement);
}

export function initializeRaceDemography(world: WorldState): PopulationSystemState {
  const tick = worldTick(world);
  const runtime = world.simulation;
  if (!runtime.population || runtime.raceDemographyVersion !== RACE_DEMOGRAPHY_VERSION) {
    normalizeExistingPopulation(world);
    runtime.population = {
      version: POPULATION_VERSION,
      lastTick: tick,
      lastCharacterId: Math.max(0, ...world.characters.map(character => character.id)),
      migrationCarry: 0,
      nextMigrationId: 1,
      settlements: [],
      migrations: [],
    };
    runtime.raceDemographyVersion = RACE_DEMOGRAPHY_VERSION;
    refreshPopulationState(world, runtime.population);
    return runtime.population;
  }

  const elapsedMonths = Math.max(0, tick - runtime.population.lastTick);
  advanceRaceDemography(world, { elapsedMonths, recordHistory: false });
  return runtime.population;
}

export function maintainRaceDemography(world: WorldState, indexes?: WorldIndexes): PopulationSystemState {
  const state = ensurePopulationState(world);
  const elapsedMonths = Math.max(0, worldTick(world) - state.lastTick);
  return advanceRaceDemography(world, { elapsedMonths, indexes });
}

export function advanceRaceDemography(world: WorldState, options: PopulationAdvanceOptions = {}): PopulationSystemState {
  const state = ensurePopulationState(world);
  normalizeNewCharacters(world, state);
  const elapsedMonths = Math.max(0, Math.floor(options.elapsedMonths ?? Math.max(0, worldTick(world) - state.lastTick)));
  state.migrationCarry += elapsedMonths;
  const cycles = Math.floor(state.migrationCarry / MIGRATION_INTERVAL_MONTHS);
  state.migrationCarry %= MIGRATION_INTERVAL_MONTHS;
  if (cycles > 0) processMigrationCycles(world, state, cycles, options.indexes, options.recordHistory !== false);
  state.lastTick = Math.max(state.lastTick, worldTick(world));
  state.lastCharacterId = Math.max(state.lastCharacterId, ...world.characters.map(character => character.id));
  refreshPopulationState(world, state);
  return state;
}

export function settlementPopulationBreakdown(world: WorldState, settlementId: number): PopulationShare[] {
  return populationShares(world.characters.filter(character => character.alive && character.settlementId === settlementId));
}

export function kingdomPopulationBreakdown(world: WorldState, kingdomId: number): PopulationShare[] {
  return populationShares(world.characters.filter(character => character.alive && character.kingdomId === kingdomId));
}

export function migrationRecords(world: WorldState, limit = 80): MigrationRecord[] {
  return [...(world.simulation.population?.migrations ?? [])]
    .sort((a, b) => b.tick - a.tick || b.id - a.id)
    .slice(0, limit);
}

export function inheritedSpecies(world: WorldState, child: Pick<Character, 'id' | 'parentIds'>): Species | undefined {
  const parents = child.parentIds
    .map(parentId => world.characters.find(character => character.id === parentId))
    .filter((parent): parent is Character => Boolean(parent));
  if (!parents.length) return undefined;
  if (parents.every(parent => parent.species === parents[0]!.species)) return parents[0]!.species;
  const parentSpecies = [...new Set(parents.map(parent => parent.species))];
  return parentSpecies[hashSeed(`${world.config.seed}:наследование-вида:${child.id}`) % parentSpecies.length];
}

function ensurePopulationState(world: WorldState): PopulationSystemState {
  if (!world.simulation.population || world.simulation.raceDemographyVersion !== RACE_DEMOGRAPHY_VERSION) {
    return initializeRaceDemography(world);
  }
  return world.simulation.population;
}

function seededSettlementProfile(world: WorldState, settlement: Settlement): SettlementRaceProfile {
  const kingdom = world.kingdoms.find(item => item.id === settlement.kingdomId);
  const primary = kingdom?.species ?? 'human';
  const crossBorderRoute = world.tradeRoutes.some(route => {
    if (route.fromSettlementId !== settlement.id && route.toSettlementId !== settlement.id) return false;
    return route.controlledByKingdomIds.some(id => id !== settlement.kingdomId);
  });
  const capital = kingdom?.capitalId === settlement.id;
  const baseChance = settlement.type === 'port' ? 70
    : settlement.type === 'city' ? 48
      : settlement.type === 'town' ? 28
        : settlement.type === 'village' ? 14
          : settlement.type === 'fortress' ? 12 : 8;
  const expansion = Math.round(mixedSettlementScale() * (settlement.type === 'port' || capital ? 180 : 90));
  const threshold = baseChance + expansion + (crossBorderRoute ? 26 : 0) + (capital ? 18 : 0);
  const mixed = hashSeed(`${world.config.seed}:смешанное-поселение-v2:${settlement.id}`) % 1000 < threshold;
  const reason = crossBorderRoute ? 'приграничная торговля'
    : settlement.type === 'port' ? 'порт и постоянный поток приезжих'
      : capital ? 'столица притягивает чужеземцев'
        : 'редкое историческое переселение';
  if (!mixed) return { primary, mixed: false, minorityShare: 0, reason: 'поселение народа государства' };

  const neighbours = neighbouringSpecies(world, settlement, primary);
  const alternatives = neighbours.length ? neighbours : ACTIVE_SPECIES.filter(species => species !== primary);
  const minority = alternatives[hashSeed(`${world.config.seed}:меньшинство-v2:${settlement.id}`) % alternatives.length]!;
  const minorityShare = .03 + (hashSeed(`${world.config.seed}:доля-меньшинства-v2:${settlement.id}`) % 5) / 100;
  return { primary, mixed: true, minority, minorityShare, reason };
}

function neighbouringSpecies(world: WorldState, settlement: Settlement, primary: Species): Species[] {
  const result = new Set<Species>();
  for (const route of world.tradeRoutes) {
    const otherId = route.fromSettlementId === settlement.id ? route.toSettlementId
      : route.toSettlementId === settlement.id ? route.fromSettlementId : undefined;
    if (!otherId) continue;
    const other = world.settlements.find(item => item.id === otherId);
    const species = other ? world.kingdoms.find(item => item.id === other.kingdomId)?.species : undefined;
    if (species && species !== primary) result.add(species);
  }
  return [...result];
}

function normalizeExistingPopulation(world: WorldState): void {
  for (const settlement of [...world.settlements].sort((a, b) => a.id - b.id)) {
    const profile = seededSettlementProfile(world, settlement);
    const residents = world.characters
      .filter(character => character.settlementId === settlement.id)
      .sort((a, b) => a.id - b.id);
    if (!residents.length) continue;

    const desired = new Map<number, Species>();
    for (const resident of residents) desired.set(resident.id, profile.primary);
    if (profile.mixed && profile.minority) {
      const targetMinority = Math.max(1, Math.round(residents.length * profile.minorityShare));
      const minorityResidents = [...residents]
        .filter(character => !world.kingdoms.some(kingdom => kingdom.rulerId === character.id))
        .sort((a, b) => demographicRank(world, settlement.id, b.id) - demographicRank(world, settlement.id, a.id) || a.id - b.id)
        .slice(0, targetMinority);
      for (const resident of minorityResidents) desired.set(resident.id, profile.minority);
    }

    const handledSpouses = new Set<number>();
    for (const resident of residents) {
      if (!resident.spouseId || handledSpouses.has(resident.id)) continue;
      const spouse = world.characters.find(character => character.id === resident.spouseId && character.settlementId === settlement.id);
      if (!spouse) continue;
      handledSpouses.add(resident.id); handledSpouses.add(spouse.id);
      const royalCouple = world.kingdoms.some(kingdom => kingdom.rulerId === resident.id || kingdom.rulerId === spouse.id);
      if (royalCouple) {
        desired.set(resident.id, profile.primary); desired.set(spouse.id, profile.primary);
        continue;
      }
      const intermarriage = profile.mixed && profile.minority
        && hashSeed(`${world.config.seed}:межрасовая-пара-v2:${Math.min(resident.id, spouse.id)}:${Math.max(resident.id, spouse.id)}`) % 10000
          < Math.round(Math.min(raceDefinition(profile.primary).intermarriageChance, raceDefinition(profile.minority).intermarriageChance) * 10000);
      if (intermarriage && profile.minority) {
        const firstPrimary = hashSeed(`${world.config.seed}:вид-пары-v2:${resident.id}:${spouse.id}`) % 2 === 0;
        desired.set(resident.id, firstPrimary ? profile.primary : profile.minority);
        desired.set(spouse.id, firstPrimary ? profile.minority : profile.primary);
      } else {
        const familySpecies = desired.get(resident.id) === profile.minority || desired.get(spouse.id) === profile.minority
          ? profile.minority ?? profile.primary : profile.primary;
        desired.set(resident.id, familySpecies); desired.set(spouse.id, familySpecies);
      }
    }

    for (const resident of residents) setCharacterSpecies(world, resident, desired.get(resident.id) ?? profile.primary, false);
    for (const child of residents.filter(character => character.parentIds.length).sort((a, b) => a.age - b.age || a.id - b.id)) {
      const inherited = inheritedSpecies(world, child);
      if (inherited) setCharacterSpecies(world, child, inherited, child.age === 0);
    }
  }
  for (const kingdom of world.kingdoms) {
    const ruler = world.characters.find(character => character.id === kingdom.rulerId);
    if (ruler) setCharacterSpecies(world, ruler, kingdom.species, false);
  }
}

function normalizeNewCharacters(world: WorldState, state: PopulationSystemState): void {
  const newcomers = world.characters.filter(character => character.id > state.lastCharacterId).sort((a, b) => a.id - b.id);
  for (const character of newcomers) normalizeNewCharacter(world, character);
  state.lastCharacterId = Math.max(state.lastCharacterId, ...world.characters.map(character => character.id));
}

function normalizeNewCharacter(world: WorldState, character: Character): void {
  const inherited = inheritedSpecies(world, character);
  if (inherited) {
    setCharacterSpecies(world, character, inherited, character.age === 0);
    return;
  }
  const spouse = character.spouseId ? world.characters.find(item => item.id === character.spouseId) : undefined;
  if (spouse) {
    setCharacterSpecies(world, character, spouse.species, false);
    return;
  }
  const settlement = world.settlements.find(item => item.id === character.settlementId);
  if (!settlement) return;
  const profile = settlementRaceProfile(world, settlement);
  const minority = profile.mixed && profile.minority
    && hashSeed(`${world.config.seed}:новый-житель-меньшинство-v2:${settlement.id}:${character.id}`) % 10000 < Math.round(profile.minorityShare * 10000);
  setCharacterSpecies(world, character, minority ? profile.minority! : profile.primary, character.age === 0);
}

function setCharacterSpecies(world: WorldState, character: Character, species: Species, renameNewborn: boolean): void {
  if (character.species === species) return;
  character.species = species;
  if (renameNewborn) character.name = personName(new RNG(`${world.config.seed}:имя-по-наследованию:${character.id}:${species}`), species);
  character.cultureProfile = undefined;
  if (world.cultures?.length && world.languages?.length && world.religions?.length) {
    ensureCharacterCultureProfile(world, character, new RNG(`${world.config.seed}:культура-после-демографии:${character.id}:${species}`));
  }
}

function processMigrationCycles(
  world: WorldState,
  state: PopulationSystemState,
  cycles: number,
  indexes: WorldIndexes | undefined,
  recordHistory: boolean,
): void {
  const maxGroups = Math.min(28, 2 + cycles * 3 + Math.floor(world.settlements.length / 10));
  let moved = 0;
  const origins = [...world.settlements]
    .map(settlement => ({ settlement, pressure: migrationPressure(world, settlement) }))
    .filter(entry => entry.pressure >= 34)
    .sort((a, b) => b.pressure - a.pressure || a.settlement.id - b.settlement.id);

  for (const originEntry of origins) {
    if (moved >= maxGroups) break;
    const groups = migrationGroups(world, originEntry.settlement)
      .sort((a, b) => migrationRank(world, originEntry.settlement.id, a.characterIds[0]!) - migrationRank(world, originEntry.settlement.id, b.characterIds[0]!));
    for (const group of groups) {
      if (moved >= maxGroups) break;
      const reason = migrationReason(world, originEntry.settlement);
      const destination = chooseDestination(world, originEntry.settlement, group.species, reason);
      if (!destination) continue;
      const improvement = destinationAttractiveness(world, destination, group.species) - destinationAttractiveness(world, originEntry.settlement, group.species);
      if (improvement < 12) continue;
      const chance = Math.min(.72, .06 + originEntry.pressure / 170 + improvement / 240) * raceDefinition(group.species[0]!).migrationDrive;
      if ((hashSeed(`${world.config.seed}:миграция:${worldTick(world)}:${group.characterIds.join('-')}:${destination.id}`) % 10000) / 10000 >= chance) continue;
      if (!canEnterSettlement(world, destination, group.species, reason, group.characterIds[0]!)) continue;
      moveGroup(world, state, originEntry.settlement, destination, group, reason, indexes, recordHistory);
      moved += 1;
    }
  }
}

interface MigrationGroup {
  householdId?: number;
  characterIds: number[];
  species: Species[];
}

function migrationGroups(world: WorldState, settlement: Settlement): MigrationGroup[] {
  const groups: MigrationGroup[] = [];
  const used = new Set<number>();
  for (const household of world.households.filter(item => item.settlementId === settlement.id).sort((a, b) => a.id - b.id)) {
    const members = household.memberIds
      .map(id => world.characters.find(character => character.id === id))
      .filter((character): character is Character => Boolean(character?.alive && character.settlementId === settlement.id && canMigrate(character)));
    if (!members.length || members.some(character => world.kingdoms.some(kingdom => kingdom.rulerId === character.id))) continue;
    members.forEach(character => used.add(character.id));
    groups.push({ householdId: household.id, characterIds: members.map(character => character.id), species: [...new Set(members.map(character => character.species))] });
  }
  for (const character of world.characters.filter(item => item.alive && item.settlementId === settlement.id && item.age >= raceDefinition(item.species).adultAge && !used.has(item.id) && canMigrate(item))) {
    groups.push({ characterIds: [character.id], species: [character.species] });
  }
  return groups.slice(0, 80);
}

function canMigrate(character: Character): boolean {
  if (character.titles.length || character.courtOfficeIds?.length || character.nobleTitleIds?.length) return false;
  if (character.legalStatus === 'заключён' || character.legalStatus === 'под стражей') return false;
  if (['поход', 'пленник', 'гарнизон'].includes(character.serviceStatus ?? '')) return false;
  return !character.prisonerOfBattleId;
}

function chooseDestination(world: WorldState, origin: Settlement, species: Species[], reason: MigrationReason): Settlement | undefined {
  const connected = new Set<number>();
  for (const route of world.tradeRoutes.filter(item => item.active)) {
    if (route.fromSettlementId === origin.id) connected.add(route.toSettlementId);
    if (route.toSettlementId === origin.id) connected.add(route.fromSettlementId);
  }
  for (const settlement of world.settlements) {
    if (settlement.kingdomId === origin.kingdomId && Math.hypot(settlement.x - origin.x, settlement.y - origin.y) <= 10) connected.add(settlement.id);
  }
  if (reason === 'война' || reason === 'эпидемия' || reason === 'климат' || reason === 'голод') {
    world.settlements
      .filter(item => item.id !== origin.id)
      .sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y))
      .slice(0, 5)
      .forEach(item => connected.add(item.id));
  }
  return [...connected]
    .map(id => world.settlements.find(item => item.id === id))
    .filter((item): item is Settlement => Boolean(item && item.id !== origin.id))
    .filter(item => item.population < item.residentialCapacity * 1.08)
    .sort((a, b) => destinationAttractiveness(world, b, species) - destinationAttractiveness(world, a, species) || a.id - b.id)[0];
}

function destinationAttractiveness(world: WorldState, settlement: Settlement, species: Species[]): number {
  const climate = world.simulation.climate?.settlements.find(item => item.settlementId === settlement.id);
  const tile = world.tiles.find(item => item.x === settlement.x && item.y === settlement.y);
  const housing = Math.max(-35, Math.min(45, (settlement.residentialCapacity - settlement.population) / Math.max(1, settlement.population) * 100));
  const sameRace = species.every(item => item === world.kingdoms.find(kingdom => kingdom.id === settlement.kingdomId)?.species) ? 18 : -8;
  const affinity = species.reduce((sum, item) => sum + terrainAffinity(item, tile?.terrain), 0) / Math.max(1, species.length);
  return settlement.prosperity * .75 + settlement.food * .38 + housing + settlement.economy.wageIndex * 12
    - settlement.unrest * .65 - settlement.damaged * .35 - settlement.shortages.length * 16
    - (climate?.migrationPressure ?? 0) * .42 + sameRace + affinity;
}

function migrationPressure(world: WorldState, settlement: Settlement): number {
  const climate = world.simulation.climate?.settlements.find(item => item.settlementId === settlement.id);
  const epidemic = world.epidemics.some(item => item.settlementId === settlement.id && item.status !== 'завершено');
  const war = world.wars.some(item => item.active && item.contestedSettlementIds.includes(settlement.id));
  const overcrowding = Math.max(0, settlement.population - settlement.residentialCapacity) / Math.max(1, settlement.population) * 100;
  return clamp(settlement.shortages.length * 20 + settlement.unrest * .55 + settlement.damaged * .38 + overcrowding * 1.2
    + (climate?.migrationPressure ?? 0) * .72 + (epidemic ? 24 : 0) + (war ? 42 : 0) + Math.max(0, 34 - settlement.food));
}

function migrationReason(world: WorldState, settlement: Settlement): MigrationReason {
  if (world.wars.some(item => item.active && item.contestedSettlementIds.includes(settlement.id))) return 'война';
  if (world.epidemics.some(item => item.settlementId === settlement.id && item.status !== 'завершено')) return 'эпидемия';
  const climate = world.simulation.climate?.settlements.find(item => item.settlementId === settlement.id);
  if ((climate?.migrationPressure ?? 0) >= 62) return 'климат';
  if (settlement.shortages.includes('еда') || settlement.food < 26) return 'голод';
  if (settlement.population > settlement.residentialCapacity) return 'перенаселение';
  if (settlement.economy.bankruptcies > 2 || settlement.prosperity < 34) return 'безработица';
  return settlement.tradeRouteIds.length ? 'торговля' : 'родственники';
}

function canEnterSettlement(world: WorldState, destination: Settlement, species: Species[], reason: MigrationReason, seedId: number): boolean {
  const primary = world.kingdoms.find(item => item.id === destination.kingdomId)?.species ?? 'human';
  if (species.every(item => item === primary)) return true;
  const existing = settlementPopulationBreakdown(world, destination.id);
  if (species.every(item => existing.some(share => share.species === item))) return true;
  const refugeeReason = reason === 'война' || reason === 'эпидемия' || reason === 'климат' || reason === 'голод';
  const openPlace = destination.type === 'port' || destination.type === 'city' || destination.tradeRouteIds.length >= 2;
  if (!refugeeReason && !openPlace) return false;
  const chance = refugeeReason ? .34 : destination.type === 'port' ? .18 : .09;
  return (hashSeed(`${world.config.seed}:открытие-меньшинства:${destination.id}:${seedId}:${reason}`) % 10000) / 10000 < chance;
}

function moveGroup(
  world: WorldState,
  state: PopulationSystemState,
  origin: Settlement,
  destination: Settlement,
  group: MigrationGroup,
  reason: MigrationReason,
  indexes: WorldIndexes | undefined,
  recordHistory: boolean,
): void {
  const household = group.householdId ? world.households.find(item => item.id === group.householdId) : undefined;
  const oldHomeId = household?.homeBuildingId;
  const oldHome = oldHomeId ? world.buildings.find(item => item.id === oldHomeId) : undefined;
  if (oldHome) oldHome.residentIds = oldHome.residentIds.filter(id => !group.characterIds.includes(id));
  const newHome = chooseDestinationHome(world, destination, group.characterIds.length);
  if (household) {
    if (indexes) moveHouseholdIndex(indexes, household, destination.id);
    household.settlementId = destination.id;
    household.homeBuildingId = newHome?.id;
    household.history.push(`${world.year}.${String(world.month).padStart(2, '0')}: семья переехала из ${origin.name} в ${destination.name}; причина — ${reason}.`);
  }
  if (newHome) {
    for (const id of group.characterIds) if (!newHome.residentIds.includes(id)) newHome.residentIds.push(id);
  }

  for (const id of group.characterIds) {
    const character = world.characters.find(item => item.id === id);
    if (!character) continue;
    if (indexes) moveResidentInIndexes(indexes, character, destination.id);
    else character.settlementId = destination.id;
    character.kingdomId = destination.kingdomId;
    character.homeBuildingId = newHome?.id;
    character.homeDistrict = newHome?.districtName ?? destination.districts[0]?.name ?? 'Сердце поселения';
    character.workplaceBuildingId = undefined;
    character.employerEstablishmentId = undefined;
    character.employmentContractId = undefined;
    character.workplace = 'ищет работу после переезда';
    character.homeless = !newHome;
    character.biography.push(`В ${world.year} году переехал из ${origin.name} в ${destination.name}: ${reason}.`);
    const contract = world.employments.find(item => item.characterId === character.id && item.active);
    if (contract) contract.active = false;
  }

  origin.population = world.characters.filter(item => item.alive && item.settlementId === origin.id).length;
  destination.population = world.characters.filter(item => item.alive && item.settlementId === destination.id).length;
  const record: MigrationRecord = {
    id: state.nextMigrationId++, tick: worldTick(world), year: world.year, month: world.month,
    fromSettlementId: origin.id, toSettlementId: destination.id, householdId: household?.id,
    characterIds: [...group.characterIds], species: [...group.species], reason,
    summary: `${group.characterIds.length} ${group.characterIds.length === 1 ? 'житель переехал' : 'жителей переехали'} из ${origin.name} в ${destination.name}: ${reason}.`,
  };
  state.migrations.push(record);
  if (state.migrations.length > MAX_MIGRATIONS) state.migrations.splice(0, state.migrations.length - MAX_MIGRATIONS);
  if (recordHistory) {
    origin.history.push(`${record.year}.${String(record.month).padStart(2, '0')}: ${record.summary}`);
    destination.history.push(`${record.year}.${String(record.month).padStart(2, '0')}: прибыли переселенцы из ${origin.name}; причина — ${reason}.`);
  }
}

function chooseDestinationHome(world: WorldState, settlement: Settlement, size: number): Building | undefined {
  return world.buildings
    .filter(building => building.settlementId === settlement.id && ['house', 'tenement', 'shelter', 'inn'].includes(building.type))
    .filter(building => building.capacity - building.residentIds.length >= size)
    .sort((a, b) => (b.capacity - b.residentIds.length) - (a.capacity - a.residentIds.length) || a.id - b.id)[0];
}

function moveHouseholdIndex(indexes: WorldIndexes, household: Household, destinationId: number): void {
  const previous = indexes.householdsBySettlement.get(household.settlementId) ?? [];
  indexes.householdsBySettlement.set(household.settlementId, previous.filter(item => item.id !== household.id));
  const next = indexes.householdsBySettlement.get(destinationId) ?? [];
  if (!next.some(item => item.id === household.id)) next.push(household);
  next.sort((a, b) => a.id - b.id);
  indexes.householdsBySettlement.set(destinationId, next);
}

function refreshPopulationState(world: WorldState, state: PopulationSystemState): void {
  const recentStart = worldTick(world) - 12;
  state.settlements = world.settlements.map(settlement => {
    const shares = settlementPopulationBreakdown(world, settlement.id);
    const kingdomSpecies = world.kingdoms.find(item => item.id === settlement.kingdomId)?.species ?? shares[0]?.species ?? 'human';
    const outgoing = state.migrations.filter(item => item.tick >= recentStart && item.fromSettlementId === settlement.id).reduce((sum, item) => sum + item.characterIds.length, 0);
    const incoming = state.migrations.filter(item => item.tick >= recentStart && item.toSettlementId === settlement.id).reduce((sum, item) => sum + item.characterIds.length, 0);
    const seeded = seededSettlementProfile(world, settlement);
    const mixed = shares.filter(item => item.count > 0).length > 1;
    const minority = shares.find(item => item.species !== kingdomSpecies)?.species;
    const reason = mixed
      ? state.migrations.some(item => item.toSettlementId === settlement.id && item.species.some(species => species !== kingdomSpecies))
        ? 'миграция и переселение'
        : seeded.reason
      : 'поселение народа государства';
    return {
      settlementId: settlement.id,
      primarySpecies: kingdomSpecies,
      mixed,
      minoritySpecies: minority,
      reason,
      shares,
      migrationPressure: migrationPressure(world, settlement),
      migrationBalance: incoming - outgoing,
      updatedTick: worldTick(world),
    } satisfies SettlementDemographyState;
  });
}

function populationShares(characters: Character[]): PopulationShare[] {
  const counts = new Map<Species, number>();
  for (const character of characters) counts.set(character.species, (counts.get(character.species) ?? 0) + 1);
  const total = Math.max(1, characters.length);
  return [...counts.entries()]
    .map(([species, count]) => ({ species, count, share: count / total }))
    .sort((a, b) => b.count - a.count || a.species.localeCompare(b.species));
}

function demographicRank(world: WorldState, settlementId: number, characterId: number): number {
  return hashSeed(`${world.config.seed}:демография-v2:${settlementId}:${characterId}`) >>> 0;
}

function migrationRank(world: WorldState, settlementId: number, characterId: number): number {
  return hashSeed(`${world.config.seed}:очередь-миграции:${worldTick(world)}:${settlementId}:${characterId}`) >>> 0;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}
