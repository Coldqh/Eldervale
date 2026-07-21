import type { Species, Terrain } from './types';

export interface RaceDefinition {
  id: Species;
  label: string;
  pluralLabel: string;
  adultAge: number;
  maxAge: number;
  fertilityMultiplier: number;
  migrationDrive: number;
  integration: number;
  intermarriageChance: number;
  preferredTerrains: readonly Terrain[];
  professionWeights: Readonly<Record<string, number>>;
  nameStarts: readonly string[];
  nameEnds: readonly string[];
}

export const RACE_CATALOG: Readonly<Record<Species, RaceDefinition>> = {
  human: {
    id: 'human', label: 'человек', pluralLabel: 'люди', adultAge: 16, maxAge: 78,
    fertilityMultiplier: 1, migrationDrive: 1.05, integration: 72, intermarriageChance: .12,
    preferredTerrains: ['plains', 'coast', 'hills'],
    professionWeights: { farmer: 1.3, merchant: 1.2, guard: 1.1, scribe: 1.05 },
    nameStarts: ['Ald', 'Ber', 'Ced', 'Dar', 'Ed', 'Fen', 'Garr', 'Had', 'Is', 'Jor', 'Kael', 'Lor', 'Mar', 'Nor', 'Os', 'Per', 'Quin', 'Roder', 'Ser', 'Tor', 'Val'],
    nameEnds: ['an', 'ard', 'en', 'eth', 'ian', 'ic', 'in', 'or', 'ric', 'us', 'wyn'],
  },
  elf: {
    id: 'elf', label: 'эльф', pluralLabel: 'эльфы', adultAge: 22, maxAge: 180,
    fertilityMultiplier: .58, migrationDrive: .62, integration: 54, intermarriageChance: .06,
    preferredTerrains: ['forest', 'hills'],
    professionWeights: { herbalist: 1.45, hunter: 1.3, scribe: 1.25, healer: 1.2 },
    nameStarts: ['Ael', 'Cael', 'Eli', 'Fael', 'Iri', 'Lae', 'Myr', 'Naev', 'Ori', 'Rae', 'Syl', 'Thael', 'Vael'],
    nameEnds: ['ael', 'aris', 'eth', 'iel', 'ion', 'ira', 'ith', 'or', 'wen'],
  },
  orc: {
    id: 'orc', label: 'орк', pluralLabel: 'орки', adultAge: 14, maxAge: 68,
    fertilityMultiplier: 1.12, migrationDrive: 1.15, integration: 43, intermarriageChance: .045,
    preferredTerrains: ['hills', 'plains', 'marsh'],
    professionWeights: { soldier: 1.45, guard: 1.35, hunter: 1.25, blacksmith: 1.1 },
    nameStarts: ['Brak', 'Drog', 'Gar', 'Grim', 'Karg', 'Mog', 'Rag', 'Skor', 'Thrag', 'Urz', 'Vorg', 'Zag'],
    nameEnds: ['ak', 'ash', 'gar', 'grom', 'nak', 'ruk', 'th', 'ug'],
  },
  dwarf: {
    id: 'dwarf', label: 'дворф', pluralLabel: 'дворфы', adultAge: 18, maxAge: 112,
    fertilityMultiplier: .78, migrationDrive: .72, integration: 49, intermarriageChance: .055,
    preferredTerrains: ['mountains', 'hills'],
    professionWeights: { miner: 1.55, blacksmith: 1.45, brewer: 1.2, carpenter: 1.1 },
    nameStarts: ['Bal', 'Bor', 'Dain', 'Dor', 'Far', 'Gim', 'Har', 'Khor', 'Mor', 'Nor', 'Tor', 'Var'],
    nameEnds: ['ain', 'ar', 'ek', 'grim', 'in', 'or', 'rik', 'um'],
  },
};

export const ACTIVE_SPECIES = Object.freeze(Object.keys(RACE_CATALOG) as Species[]);

export function raceDefinition(species: Species): RaceDefinition {
  return RACE_CATALOG[species];
}

export function terrainAffinity(species: Species, terrain?: Terrain): number {
  if (!terrain) return 0;
  return raceDefinition(species).preferredTerrains.includes(terrain) ? 18 : 0;
}

export function mixedSettlementScale(): number {
  return Math.max(0, Math.min(1, (ACTIVE_SPECIES.length - 4) / 26));
}
