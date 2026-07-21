import type {
  CharacterState,
  EducationProfile,
  PersonalityProfile,
} from "../../../core/character/types";
import { SeededRandom } from "../../../core/random/SeededRandom";
import {
  getArchetype,
  getOriginPreset,
  getPositionDescriptor,
  type ArchetypeDescriptor,
} from "./catalog";
import type {
  FootballCareerSetup,
  FootballCareerState,
  FootballRatings,
  SchoolIdentity,
} from "./types";
import { evaluateDepthChart } from "../team/evaluateDepthChart";
import { createFootballRoster, createTeamDynamics, createTeamStaff } from "../team/generateTeam";
import { createInitialTrainingState } from "../training/createTrainingState";
import { createInitialMatchState } from "../matches/createMatchState";

const FIRST_NAMES = ["Cameron", "Jaylen", "Marcus", "Darius", "Devin", "Malik", "Jordan", "Tyler"] as const;
const LAST_NAMES = ["Hayes", "Carter", "Brooks", "Reed", "Mitchell", "Coleman", "Ward", "Foster"] as const;
const SCHOOL_PREFIXES = ["Northline", "West Harbor", "Cedar Ridge", "Eastgate", "Union Park", "Stonebridge", "Lakeview", "Central Heights"] as const;
const MASCOTS = ["Wolves", "Vipers", "Falcons", "Bulls", "Panthers", "Ravens", "Titans", "Coyotes"] as const;
const RIVAL_PREFIXES = ["South County", "Bishop Rowe", "Riverside", "Franklin Tech", "Oak Valley", "Jefferson"] as const;
const COLORS = [["#d7192d", "#08090b"]] as const;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function calculateAge(birthDate: string, currentDate = "2026-08-17"): number {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const current = new Date(`${currentDate}T00:00:00Z`);
  let age = current.getUTCFullYear() - birth.getUTCFullYear();
  const monthDifference = current.getUTCMonth() - birth.getUTCMonth();
  if (monthDifference < 0 || (monthDifference === 0 && current.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

function incomeModifier(income: FootballCareerSetup["character"]["familyIncome"]): number {
  return { strained: -10, working: -3, comfortable: 7, wealthy: 14 }[income];
}

function supportModifier(support: FootballCareerSetup["character"]["familySupport"]): number {
  return { demanding: 3, supportive: 8, "hands-off": -2 }[support];
}

function createPersonality(setup: FootballCareerSetup, random: SeededRandom): PersonalityProfile {
  const base: Record<FootballCareerSetup["character"]["mindset"], Omit<PersonalityProfile, "preset">> = {
    obsessed: { discipline: 86, ambition: 91, confidence: 72, composure: 65, coachability: 76, adaptability: 70, riskTolerance: 68, approvalNeed: 72 },
    composed: { discipline: 78, ambition: 76, confidence: 76, composure: 88, coachability: 84, adaptability: 78, riskTolerance: 52, approvalNeed: 45 },
    electric: { discipline: 65, ambition: 85, confidence: 91, composure: 64, coachability: 66, adaptability: 76, riskTolerance: 88, approvalNeed: 70 },
    underdog: { discipline: 82, ambition: 84, confidence: 67, composure: 76, coachability: 81, adaptability: 89, riskTolerance: 61, approvalNeed: 55 },
  };
  const selected = base[setup.character.mindset];
  const variance = () => random.integer(-4, 4);
  return {
    preset: setup.character.mindset,
    discipline: clamp(selected.discipline + variance()),
    ambition: clamp(selected.ambition + variance()),
    confidence: clamp(selected.confidence + variance()),
    composure: clamp(selected.composure + variance()),
    coachability: clamp(selected.coachability + variance()),
    adaptability: clamp(selected.adaptability + variance()),
    riskTolerance: clamp(selected.riskTolerance + variance()),
    approvalNeed: clamp(selected.approvalNeed + variance()),
  };
}

function createEducation(
  setup: FootballCareerSetup,
  random: SeededRandom,
  schoolQuality: number,
  personality: PersonalityProfile,
): EducationProfile {
  const resource = incomeModifier(setup.character.familyIncome);
  const structure = setup.character.familyStructure === "single-parent" ? -2 : setup.character.familyStructure === "extended-family" ? 3 : 2;
  const ability = clamp(66 + random.integer(-10, 12) + schoolQuality * 0.08 + resource * 0.25);
  const attendance = clamp(84 + random.integer(-4, 8) + personality.discipline * 0.08 + structure);
  const gpa = Math.max(1.8, Math.min(4, 2.05 + ability * 0.013 + personality.discipline * 0.006 + random.integer(-8, 8) / 100));
  const roundedGpa = Math.round(gpa * 100) / 100;
  return {
    gpa: roundedGpa,
    academicAbility: ability,
    attendance,
    eligibilityStatus: roundedGpa >= 2.5 ? "clear" : roundedGpa >= 2.1 ? "watch" : "at-risk",
  };
}

function createSchool(worldSeed: string, setup: FootballCareerSetup): SchoolIdentity {
  const random = new SeededRandom(worldSeed).fork("school");
  const origin = getOriginPreset(setup.character.originId);
  const colors = random.pick(COLORS);
  const prefix = random.pick(SCHOOL_PREFIXES);
  const mascot = random.pick(MASCOTS);
  const prestige = clamp(48 + origin.footballCulture * 0.34 + random.integer(-8, 10));
  const resource = incomeModifier(setup.character.familyIncome);
  return {
    id: `school-${origin.stateCode.toLowerCase()}-${prefix.toLowerCase().replaceAll(" ", "-")}`,
    name: `${prefix} High`,
    shortName: prefix,
    mascot,
    city: origin.city,
    stateCode: origin.stateCode,
    primaryColor: colors[0],
    secondaryColor: colors[1],
    prestige,
    facilities: clamp(origin.trainingAccess + resource * 0.35 + random.integer(-8, 7)),
    coaching: clamp(58 + origin.footballCulture * 0.24 + random.integer(-8, 10)),
    medicine: clamp(origin.medicalAccess + resource * 0.25 + random.integer(-7, 7)),
    discipline: clamp(62 + random.integer(-12, 15)),
    youthTrust: clamp(56 + random.integer(-14, 18)),
    philosophy: random.pick([
      "Tempo spread · aggressive passing",
      "Balanced offense · disciplined defense",
      "Power run · field-position football",
      "Multiple offense · pressure defense",
    ]),
  };
}

function createRatings(
  setup: FootballCareerSetup,
  archetype: ArchetypeDescriptor,
  personality: PersonalityProfile,
  random: SeededRandom,
): FootballRatings {
  const support = supportModifier(setup.character.familySupport);
  const technical = clamp(archetype.technique + random.integer(-5, 5) + support * 0.15);
  const footballIq = clamp(archetype.footballIq + random.integer(-5, 5) + personality.coachability * 0.04);
  const athleticism = clamp(
    (archetype.speed + archetype.strength + archetype.agility + archetype.explosiveness) / 4 + random.integer(-4, 4),
  );
  const competitiveness = clamp((personality.ambition + personality.confidence + personality.discipline) / 3 + random.integer(-4, 4));
  const overall = clamp(athleticism * 0.34 + technical * 0.31 + footballIq * 0.2 + competitiveness * 0.15, 45, 89);
  const potentialScore = clamp(overall + personality.adaptability * 0.12 + personality.discipline * 0.08 + random.integer(4, 13), 55, 98);
  const potentialBand: FootballRatings["potentialBand"] =
    potentialScore >= 91 ? "national-ceiling" : potentialScore >= 83 ? "high-upside" : potentialScore >= 73 ? "starter" : "role-player";
  return { overall, potentialBand, athleticism, technique: technical, footballIq, competitiveness };
}

function createPhysical(archetype: ArchetypeDescriptor, random: SeededRandom): CharacterState["physical"] {
  return {
    heightInches: random.integer(archetype.height[0], archetype.height[1]),
    weightLbs: random.integer(archetype.weight[0], archetype.weight[1]),
    frame: archetype.frame,
    speed: clamp(archetype.speed + random.integer(-3, 3)),
    strength: clamp(archetype.strength + random.integer(-3, 3)),
    agility: clamp(archetype.agility + random.integer(-3, 3)),
    stamina: clamp(archetype.stamina + random.integer(-3, 3)),
    explosiveness: clamp(archetype.explosiveness + random.integer(-3, 3)),
  };
}

export function createFootballCareerState(
  worldSeed: string,
  setup: FootballCareerSetup,
): { character: CharacterState; football: FootballCareerState } {
  const random = new SeededRandom(worldSeed);
  const origin = getOriginPreset(setup.character.originId);
  const archetype = getArchetype(setup.archetypeId);
  if (archetype.position !== setup.position) {
    throw new Error("Archetype does not belong to selected position");
  }

  const personality = createPersonality(setup, random.fork("personality"));
  const school = createSchool(worldSeed, setup);
  const education = createEducation(setup, random.fork("education"), origin.schoolQuality, personality);
  const physical = createPhysical(archetype, random.fork("physical"));
  const ratings = createRatings(setup, archetype, personality, random.fork("ratings"));
  const opponentPrefix = random.fork("opponent").pick(RIVAL_PREFIXES);
  const income = incomeModifier(setup.character.familyIncome);
  const support = supportModifier(setup.character.familySupport);

  const character: CharacterState = {
    identity: {
      firstName: setup.character.firstName.trim(),
      lastName: setup.character.lastName.trim(),
      fullName: `${setup.character.firstName.trim()} ${setup.character.lastName.trim()}`,
      birthDate: setup.character.birthDate,
      age: calculateAge(setup.character.birthDate),
      gender: setup.character.gender,
      handedness: setup.character.handedness,
    },
    origin: {
      country: "USA",
      stateCode: origin.stateCode,
      stateName: origin.stateName,
      city: origin.city,
      region: origin.region,
      familyIncome: setup.character.familyIncome,
      familyStructure: setup.character.familyStructure,
      familySupport: setup.character.familySupport,
      neighborhoodSafety: clamp(origin.neighborhoodSafety + income * 0.5),
      schoolQuality: clamp(origin.schoolQuality + income * 0.35),
      trainingAccess: clamp(origin.trainingAccess + income * 0.6),
      medicalAccess: clamp(origin.medicalAccess + income * 0.65),
      footballCulture: origin.footballCulture,
    },
    personality,
    physical,
    education,
    condition: {
      energy: clamp(82 + support * 0.25 + random.integer(-3, 4)),
      fatigue: clamp(12 + random.integer(-3, 4)),
      stress: clamp(25 + personality.approvalNeed * 0.13 - personality.composure * 0.08 + random.integer(-4, 5)),
      confidence: personality.confidence,
      health: clamp(94 + random.integer(-3, 4)),
      sleepHours: Math.round((7.3 + personality.discipline * 0.006 + random.integer(-3, 4) / 10) * 10) / 10,
    },
  };

  const roster = createFootballRoster(worldSeed, school, setup.position);
  const initialTrust = clamp(54 + personality.coachability * 0.22 + school.youthTrust * 0.15 + random.integer(-5, 6));
  const staff = createTeamStaff(worldSeed, school, setup.position, initialTrust);
  const teamDynamics = createTeamDynamics(worldSeed, school);
  const firstRoomPlayer = roster.find((player) => player.position === setup.position);
  if (!firstRoomPlayer) {
    throw new Error("Generated roster has no player in the selected position room");
  }

  let football: FootballCareerState = {
    moduleVersion: 5,
    worldSeed,
    stage: "high-school-preseason",
    position: setup.position,
    archetypeId: archetype.id,
    archetypeName: archetype.name,
    jerseyNumber: setup.jerseyNumber,
    ratings,
    school,
    staff,
    roster,
    teamDynamics,
    training: createInitialTrainingState(worldSeed, setup.position, character, ratings),
    match: createInitialMatchState(worldSeed, setup.position, {
      year: 2026,
      phase: "preseason",
      week: 0,
      wins: 0,
      losses: 0,
      nextOpponent: {
        id: `opponent-${opponentPrefix.toLowerCase().replaceAll(" ", "-")}`,
        name: `${opponentPrefix} ${random.fork("opponent-mascot").pick(MASCOTS)}`,
        record: "0–0",
        threat: random.fork("opponent-threat").pick(["aggressive secondary", "heavy pressure front", "fast perimeter defense", "disciplined zone coverage"]),
      },
    }, { year: 2026, month: 8, day: 17 }),
    depthChart: {
      rank: 1,
      playersAtPosition: roster.filter((player) => player.position === setup.position).length + 1,
      coachTrust: initialTrust,
      projectedRole: "rotation",
      directRival: {
        id: firstRoomPlayer.id,
        name: firstRoomPlayer.name,
        year: firstRoomPlayer.year,
        overall: firstRoomPlayer.overall,
        style: firstRoomPlayer.style,
      },
      evaluation: {
        heroScore: 0,
        comparisonScore: 0,
        gap: 0,
        trend: "stable",
        summary: "Штаб формирует стартовый depth chart.",
        reasons: ["Первые места определяются по физической готовности, технике и доверию штаба."],
        updatedOn: "2026-08-17",
      },
      lastDecision: {
        type: "held",
        title: "Стартовая оценка",
        description: "Тренеры сформировали первый порядок игроков перед началом сезона.",
        occurredOn: "2026-08-17",
      },
    },
    season: {
      year: 2026,
      phase: "preseason",
      week: 0,
      wins: 0,
      losses: 0,
      nextOpponent: {
        id: `opponent-${opponentPrefix.toLowerCase().replaceAll(" ", "-")}`,
        name: `${opponentPrefix} ${random.fork("opponent-mascot").pick(MASCOTS)}`,
        record: "0–0",
        threat: random.fork("opponent-threat").pick(["aggressive secondary", "heavy pressure front", "fast perimeter defense", "disciplined zone coverage"]),
      },
    },
    recruitment: {
      visibility: clamp(20 + ratings.overall * 0.28 + school.prestige * 0.18 + random.integer(-4, 5)),
      interestedPrograms: 0,
      offers: 0,
      regionalRankLabel: ratings.overall >= 80 ? "regional watchlist" : ratings.overall >= 72 ? "local prospect" : "unrated",
    },
  };

  const evaluation = evaluateDepthChart(football, character, { year: 2026, month: 8, day: 17 });
  football = {
    ...football,
    depthChart: {
      ...football.depthChart,
      ...evaluation,
      lastDecision: {
        ...evaluation.lastDecision,
        title: "Стартовый depth chart",
      },
    },
  };

  return { character, football };
}

export function createLegacyFootballSetup(worldSeed: string): FootballCareerSetup {
  const random = new SeededRandom(worldSeed).fork("legacy-setup");
  const position = random.pick(["QB", "RB", "WR", "LB", "CB"] as const);
  const archetypesByPosition: Record<typeof position, readonly string[]> = {
    QB: ["field-general", "gunslinger", "dual-threat"],
    RB: ["power-back", "slasher", "receiving-back"],
    WR: ["route-technician", "vertical-threat", "contested-catch"],
    LB: ["run-stopper", "coverage-linebacker", "edge-hunter"],
    CB: ["press-corner", "ball-hawk", "shutdown-corner"],
  };
  const positionDescriptor = getPositionDescriptor(position);
  return {
    character: {
      firstName: random.pick(FIRST_NAMES),
      lastName: random.pick(LAST_NAMES),
      birthDate: "2008-02-14",
      gender: "male",
      handedness: random.chance(0.12) ? "left" : "right",
      originId: random.pick(["houston", "miami", "atlanta", "long-beach", "detroit", "philadelphia"]),
      familyIncome: random.pick(["strained", "working", "comfortable"]),
      familyStructure: random.pick(["two-parent", "single-parent", "extended-family"]),
      familySupport: random.pick(["demanding", "supportive", "hands-off"]),
      mindset: random.pick(["obsessed", "composed", "electric", "underdog"]),
    },
    position,
    archetypeId: random.pick(archetypesByPosition[position]),
    jerseyNumber: random.integer(positionDescriptor.numberRange[0], positionDescriptor.numberRange[1]),
  };
}
