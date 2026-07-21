import type { Character, Settlement, Species, WorldState } from '../types';
import { ensureCharacterCultureProfile } from './cultureSystem';
import { hashSeed, RNG } from './rng';

export const ACTIVE_SPECIES: readonly Species[] = ['human', 'elf', 'orc', 'dwarf'];

export interface SettlementRaceProfile {
  primary: Species;
  mixed: boolean;
  minority?: Species;
  minorityShare: number;
}

type RaceRuntime = WorldState['simulation'] & {
  raceDemographyVersion?: 1;
  raceDemographyLastCharacterId?: number;
};

export function settlementRaceProfile(world: WorldState, settlement: Settlement): SettlementRaceProfile {
  const kingdom = world.kingdoms.find(item => item.id === settlement.kingdomId);
  const primary = kingdom?.species ?? 'human';
  const mixedThreshold = settlement.type === 'port' ? 90
    : settlement.type === 'city' ? 80
      : settlement.type === 'town' ? 55
        : settlement.type === 'village' ? 35
          : 25;
  const mixed = hashSeed(`${world.config.seed}:смешанное-поселение:${settlement.id}`) % 1000 < mixedThreshold;
  if (!mixed) return { primary, mixed: false, minorityShare: 0 };

  const alternatives = ACTIVE_SPECIES.filter(species => species !== primary);
  const minority = alternatives[hashSeed(`${world.config.seed}:меньшинство:${settlement.id}`) % alternatives.length]!;
  const minorityShare = .05 + (hashSeed(`${world.config.seed}:доля-меньшинства:${settlement.id}`) % 5) / 100;
  return { primary, mixed: true, minority, minorityShare };
}

export function initializeRaceDemography(world: WorldState): void {
  const runtime = world.simulation as RaceRuntime;
  if (runtime.raceDemographyVersion !== 1) {
    normalizeExistingPopulation(world);
    runtime.raceDemographyVersion = 1;
  } else maintainRaceDemography(world);
  runtime.raceDemographyLastCharacterId = Math.max(0, ...world.characters.map(character => character.id));
}

export function maintainRaceDemography(world: WorldState): void {
  const runtime = world.simulation as RaceRuntime;
  const previousLastId = runtime.raceDemographyLastCharacterId ?? 0;
  const newcomers = world.characters.filter(character => character.id > previousLastId);
  for (const character of newcomers) normalizeNewCharacter(world, character);
  runtime.raceDemographyVersion = 1;
  runtime.raceDemographyLastCharacterId = Math.max(previousLastId, ...world.characters.map(character => character.id));
}

function normalizeExistingPopulation(world: WorldState): void {
  for (const settlement of [...world.settlements].sort((a, b) => a.id - b.id)) {
    const profile = settlementRaceProfile(world, settlement);
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
      handledSpouses.add(resident.id);
      handledSpouses.add(spouse.id);

      const royalCouple = world.kingdoms.some(kingdom => kingdom.rulerId === resident.id || kingdom.rulerId === spouse.id);
      if (royalCouple) {
        desired.set(resident.id, profile.primary);
        desired.set(spouse.id, profile.primary);
        continue;
      }
      const mixedCouple = Boolean(profile.mixed && profile.minority)
        && hashSeed(`${world.config.seed}:межрасовая-пара:${Math.min(resident.id, spouse.id)}:${Math.max(resident.id, spouse.id)}`) % 1000 < 12;
      if (mixedCouple && profile.minority) {
        const firstPrimary = hashSeed(`${world.config.seed}:вид-пары:${resident.id}:${spouse.id}`) % 2 === 0;
        desired.set(resident.id, firstPrimary ? profile.primary : profile.minority);
        desired.set(spouse.id, firstPrimary ? profile.minority : profile.primary);
      } else {
        const familySpecies = desired.get(resident.id) === profile.minority || desired.get(spouse.id) === profile.minority
          ? profile.minority ?? profile.primary
          : profile.primary;
        desired.set(resident.id, familySpecies);
        desired.set(spouse.id, familySpecies);
      }
    }

    for (const resident of residents) setCharacterSpecies(world, resident, desired.get(resident.id) ?? profile.primary);

    // Ребёнок наследует только вид одного из родителей. Третий случайный вид невозможен.
    for (const child of residents.filter(character => character.parentIds.length).sort((a, b) => a.age - b.age || a.id - b.id)) {
      const inherited = inheritedSpecies(world, child);
      if (inherited) setCharacterSpecies(world, child, inherited);
    }
  }

  for (const kingdom of world.kingdoms) {
    const ruler = world.characters.find(character => character.id === kingdom.rulerId);
    if (ruler) setCharacterSpecies(world, ruler, kingdom.species);
  }
}

function normalizeNewCharacter(world: WorldState, character: Character): void {
  const inherited = inheritedSpecies(world, character);
  if (inherited) {
    setCharacterSpecies(world, character, inherited);
    return;
  }

  const spouse = character.spouseId ? world.characters.find(item => item.id === character.spouseId) : undefined;
  if (spouse) {
    setCharacterSpecies(world, character, spouse.species);
    return;
  }

  const settlement = world.settlements.find(item => item.id === character.settlementId);
  if (!settlement) return;
  const profile = settlementRaceProfile(world, settlement);
  const minority = profile.mixed && profile.minority
    && hashSeed(`${world.config.seed}:новый-житель-меньшинство:${settlement.id}:${character.id}`) % 1000 < Math.round(profile.minorityShare * 1000);
  setCharacterSpecies(world, character, minority ? profile.minority! : profile.primary);
}

function inheritedSpecies(world: WorldState, child: Character): Species | undefined {
  const parents = child.parentIds
    .map(parentId => world.characters.find(character => character.id === parentId))
    .filter((parent): parent is Character => Boolean(parent));
  if (!parents.length) return undefined;
  if (parents.every(parent => parent.species === parents[0]!.species)) return parents[0]!.species;
  const parentSpecies = [...new Set(parents.map(parent => parent.species))];
  return parentSpecies[hashSeed(`${world.config.seed}:наследование-вида:${child.id}`) % parentSpecies.length];
}

function setCharacterSpecies(world: WorldState, character: Character, species: Species): void {
  if (character.species === species) return;
  character.species = species;
  character.cultureProfile = undefined;
  if (world.cultures?.length && world.languages?.length && world.religions?.length) {
    ensureCharacterCultureProfile(world, character, new RNG(`${world.config.seed}:культура-после-демографии:${character.id}:${species}`));
  }
}

function demographicRank(world: WorldState, settlementId: number, characterId: number): number {
  return hashSeed(`${world.config.seed}:демография:${settlementId}:${characterId}`) >>> 0;
}
