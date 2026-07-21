import { z } from "zod";

export const CURRENT_SCHEMA_VERSION = 6;

const gameDateSchema = z.object({
  year: z.number().int().min(1900).max(2200),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});

const personalitySchema = z.object({
  preset: z.enum(["obsessed", "composed", "electric", "underdog"]),
  discipline: z.number().min(0).max(100),
  ambition: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100),
  composure: z.number().min(0).max(100),
  coachability: z.number().min(0).max(100),
  adaptability: z.number().min(0).max(100),
  riskTolerance: z.number().min(0).max(100),
  approvalNeed: z.number().min(0).max(100),
});

const characterSchema = z.object({
  identity: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    fullName: z.string().min(3),
    birthDate: z.string().min(10),
    age: z.number().int().min(15).max(22),
    gender: z.enum(["male", "female"]),
    handedness: z.enum(["right", "left"]),
  }),
  origin: z.object({
    country: z.literal("USA"),
    stateCode: z.string().length(2),
    stateName: z.string().min(2),
    city: z.string().min(2),
    region: z.string().min(2),
    familyIncome: z.enum(["strained", "working", "comfortable", "wealthy"]),
    familyStructure: z.enum(["two-parent", "single-parent", "extended-family"]),
    familySupport: z.enum(["demanding", "supportive", "hands-off"]),
    neighborhoodSafety: z.number().min(0).max(100),
    schoolQuality: z.number().min(0).max(100),
    trainingAccess: z.number().min(0).max(100),
    medicalAccess: z.number().min(0).max(100),
    footballCulture: z.number().min(0).max(100),
  }),
  personality: personalitySchema,
  physical: z.object({
    heightInches: z.number().int().min(60).max(84),
    weightLbs: z.number().int().min(130).max(360),
    frame: z.enum(["compact", "balanced", "long", "powerful"]),
    speed: z.number().min(0).max(100),
    strength: z.number().min(0).max(100),
    agility: z.number().min(0).max(100),
    stamina: z.number().min(0).max(100),
    explosiveness: z.number().min(0).max(100),
  }),
  education: z.object({
    gpa: z.number().min(0).max(4),
    academicAbility: z.number().min(0).max(100),
    attendance: z.number().min(0).max(100),
    eligibilityStatus: z.enum(["clear", "watch", "at-risk"]),
  }),
  condition: z.object({
    energy: z.number().min(0).max(100),
    fatigue: z.number().min(0).max(100),
    stress: z.number().min(0).max(100),
    confidence: z.number().min(0).max(100),
    health: z.number().min(0).max(100),
    sleepHours: z.number().min(0).max(24),
  }),
});

const schoolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2),
  shortName: z.string().min(2),
  mascot: z.string().min(2),
  city: z.string().min(2),
  stateCode: z.string().length(2),
  primaryColor: z.string().min(4),
  secondaryColor: z.string().min(4),
  prestige: z.number().min(0).max(100),
  facilities: z.number().min(0).max(100),
  coaching: z.number().min(0).max(100),
  medicine: z.number().min(0).max(100),
  discipline: z.number().min(0).max(100),
  youthTrust: z.number().min(0).max(100),
  philosophy: z.string().min(2),
});


const playerYearSchema = z.enum(["Freshman", "Sophomore", "Junior", "Senior"]);
const rosterPositionSchema = z.enum(["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"]);
const coachSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(3),
  role: z.enum(["head-coach", "position-coach", "offensive-coordinator", "defensive-coordinator"]),
  age: z.number().int().min(25).max(80),
  archetype: z.enum(["builder", "disciplinarian", "strategist", "recruiter"]),
  development: z.number().min(0).max(100),
  tactics: z.number().min(0).max(100),
  discipline: z.number().min(0).max(100),
  communication: z.number().min(0).max(100),
  youthPatience: z.number().min(0).max(100),
  pressure: z.number().min(0).max(100),
  relationship: z.number().min(0).max(100),
  summary: z.string().min(2),
});
const rosterPlayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(3),
  position: rosterPositionSchema,
  unit: z.enum(["offense", "defense", "special"]),
  year: playerYearSchema,
  overall: z.number().min(0).max(100),
  potential: z.number().min(0).max(100),
  style: z.string().min(2),
  coachStanding: z.number().min(0).max(100),
  health: z.number().min(0).max(100),
  status: z.enum(["starter", "rotation", "backup", "injured"]),
  depthRank: z.number().int().min(1),
});
const depthEvaluationSchema = z.object({
  heroScore: z.number(),
  comparisonScore: z.number(),
  gap: z.number().min(0),
  trend: z.enum(["rising", "stable", "falling"]),
  summary: z.string().min(2),
  reasons: z.array(z.string().min(2)).min(1),
  updatedOn: z.string().min(8),
});
const depthDecisionSchema = z.object({
  type: z.enum(["promoted", "demoted", "held"]),
  title: z.string().min(2),
  description: z.string().min(2),
  occurredOn: z.string().min(8),
});

const trainingFocusSchema = z.enum(["position-craft", "explosive-power", "film-install", "recovery-reset"]);
const trainingIntensitySchema = z.enum(["controlled", "standard", "aggressive"]);
const activeHealthIssueSchema = z.object({
  id: z.string().min(1),
  diagnosis: z.string().min(2),
  area: z.enum(["lower-body", "upper-body", "head-neck", "back-core"]),
  severity: z.enum(["minor", "moderate"]),
  daysRemaining: z.number().int().nonnegative(),
  recurrenceRisk: z.number().min(0).max(100),
  startedOn: z.string().min(8),
});
const trainingSessionSchema = z.object({
  id: z.string().min(1),
  date: gameDateSchema,
  focusId: trainingFocusSchema,
  focusName: z.string().min(2),
  intensity: trainingIntensitySchema,
  grade: z.enum(["A", "B", "C", "D"]),
  load: z.number().min(0).max(100),
  readinessBefore: z.number().min(0).max(100),
  readinessAfter: z.number().min(0).max(100),
  sorenessDelta: z.number(),
  riskAfter: z.number().min(0).max(100),
  gains: z.object({
    technique: z.number(),
    athleticism: z.number(),
    footballIq: z.number(),
    competitiveness: z.number(),
  }),
  note: z.string().min(2),
  issueOccurred: z.string().min(2).optional(),
});
const footballTrainingSchema = z.object({
  moduleVersion: z.literal(1),
  plan: z.object({
    focusId: trainingFocusSchema,
    intensity: trainingIntensitySchema,
    revision: z.number().int().min(1),
  }),
  body: z.object({
    readiness: z.number().min(0).max(100),
    acuteLoad: z.number().min(0).max(100),
    chronicLoad: z.number().min(0).max(100),
    soreness: z.number().min(0).max(100),
    pain: z.number().min(0).max(100),
    injuryRisk: z.number().min(0).max(100),
    medicalStatus: z.enum(["cleared", "questionable", "limited", "out"]),
    restriction: z.string().min(2),
    activeIssue: activeHealthIssueSchema.optional(),
  }),
  momentum: z.object({
    technique: z.number().min(0).max(100),
    athleticism: z.number().min(0).max(100),
    footballIq: z.number().min(0).max(100),
    competitiveness: z.number().min(0).max(100),
  }),
  lastSession: trainingSessionSchema.optional(),
});


const matchStatLineSchema = z.object({
  passingAttempts: z.number().int().nonnegative(),
  completions: z.number().int().nonnegative(),
  passingYards: z.number().int(),
  rushingAttempts: z.number().int().nonnegative(),
  rushingYards: z.number().int(),
  targets: z.number().int().nonnegative(),
  receptions: z.number().int().nonnegative(),
  receivingYards: z.number().int(),
  touchdowns: z.number().int().nonnegative(),
  turnovers: z.number().int().nonnegative(),
  tackles: z.number().int().nonnegative(),
  tacklesForLoss: z.number().int().nonnegative(),
  sacks: z.number().int().nonnegative(),
  passBreakups: z.number().int().nonnegative(),
  interceptions: z.number().int().nonnegative(),
});

const matchDecisionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(2),
  detail: z.string().min(2),
  risk: z.enum(["safe", "balanced", "aggressive"]),
  focus: z.enum(["technique", "athleticism", "football-iq", "competitiveness"]),
  difficulty: z.number().min(0).max(100),
  upside: z.number().min(0).max(100),
  mistakeRisk: z.number().min(0).max(100),
});

const matchEpisodeSchema = z.object({
  id: z.string().min(1),
  unit: z.enum(["offense", "defense"]),
  position: z.enum(["QB", "RB", "WR", "LB", "CB"]),
  quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  clockSeconds: z.number().int().min(0).max(900),
  down: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  distance: z.number().int().min(1).max(99),
  fieldPosition: z.number().int().min(0).max(100),
  scoreMargin: z.number().int(),
  title: z.string().min(2),
  situation: z.string().min(2),
  assignment: z.string().min(2),
  read: z.string().min(2),
  options: z.array(matchDecisionOptionSchema).min(3).max(4),
});

const matchEpisodeResultSchema = z.object({
  id: z.string().min(1),
  episodeId: z.string().min(1),
  optionId: z.string().min(1),
  grade: z.enum(["A", "B", "C", "D"]),
  headline: z.string().min(2),
  description: z.string().min(2),
  yards: z.number().int(),
  points: z.number().int().nonnegative(),
  coachDelta: z.number(),
  confidenceDelta: z.number(),
  fatigueDelta: z.number(),
  statDelta: matchStatLineSchema,
});

const footballMatchSchema = z.object({
  moduleVersion: z.literal(1),
  gameId: z.string().min(1),
  status: z.enum(["upcoming", "in-progress", "complete"]),
  scheduledWeek: z.number().int().min(1),
  scheduledDate: gameDateSchema,
  opponentId: z.string().min(1),
  opponentName: z.string().min(2),
  opponentRecord: z.string().min(1),
  opponentThreat: z.string().min(2),
  heroUnit: z.enum(["offense", "defense"]),
  heroScore: z.number().int().nonnegative(),
  opponentScore: z.number().int().nonnegative(),
  quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  clockSeconds: z.number().int().min(0).max(900),
  heroFatigue: z.number().min(0).max(100),
  coachGrade: z.number().min(0).max(100),
  episodeIndex: z.number().int().nonnegative(),
  totalEpisodes: z.number().int().min(1),
  currentEpisode: matchEpisodeSchema.optional(),
  completedEpisodes: z.array(matchEpisodeResultSchema),
  stats: matchStatLineSchema,
  finalResult: z.object({
    won: z.boolean(),
    heroScore: z.number().int().nonnegative(),
    opponentScore: z.number().int().nonnegative(),
    grade: z.enum(["A", "B", "C", "D"]),
    headline: z.string().min(2),
    summary: z.string().min(2),
    spotlight: z.string().min(2),
    coachTrustDelta: z.number(),
    visibilityDelta: z.number(),
  }).optional(),
});

const footballSchema = z.object({
  moduleVersion: z.literal(5),
  worldSeed: z.string().min(1),
  stage: z.literal("high-school-preseason"),
  position: z.enum(["QB", "RB", "WR", "LB", "CB"]),
  archetypeId: z.string().min(1),
  archetypeName: z.string().min(1),
  jerseyNumber: z.number().int().min(0).max(99),
  ratings: z.object({
    overall: z.number().min(0).max(100),
    potentialBand: z.enum(["role-player", "starter", "high-upside", "national-ceiling"]),
    athleticism: z.number().min(0).max(100),
    technique: z.number().min(0).max(100),
    footballIq: z.number().min(0).max(100),
    competitiveness: z.number().min(0).max(100),
  }),
  school: schoolSchema,
  staff: z.object({
    headCoach: coachSchema,
    positionCoach: coachSchema,
    offensiveCoordinator: coachSchema,
    defensiveCoordinator: coachSchema,
  }),
  roster: z.array(rosterPlayerSchema).min(35),
  teamDynamics: z.object({
    morale: z.number().min(0).max(100),
    cohesion: z.number().min(0).max(100),
    discipline: z.number().min(0).max(100),
    schemeMastery: z.number().min(0).max(100),
  }),
  training: footballTrainingSchema,
  match: footballMatchSchema,
  depthChart: z.object({
    rank: z.number().int().min(1),
    playersAtPosition: z.number().int().min(1),
    coachTrust: z.number().min(0).max(100),
    projectedRole: z.enum(["starter", "rotation", "special-teams", "developmental"]),
    directRival: z.object({
      id: z.string().min(1),
      name: z.string().min(3),
      year: playerYearSchema,
      overall: z.number().min(0).max(100),
      style: z.string().min(2),
    }),
    evaluation: depthEvaluationSchema,
    lastDecision: depthDecisionSchema,
  }),
  season: z.object({
    year: z.number().int().min(2000),
    phase: z.literal("preseason"),
    week: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    nextOpponent: z.object({
      id: z.string().min(1),
      name: z.string().min(2),
      record: z.string().min(1),
      threat: z.string().min(2),
    }),
  }),
  recruitment: z.object({
    visibility: z.number().min(0).max(100),
    interestedPrograms: z.number().int().nonnegative(),
    offers: z.number().int().nonnegative(),
    regionalRankLabel: z.string().min(2),
  }),
});

const focusSchema = z.object({
  training: z.number().min(0).max(100),
  recovery: z.number().min(0).max(100),
  study: z.number().min(0).max(100),
  social: z.number().min(0).max(100),
});

const dayDeltaSchema = z.object({
  energy: z.number(),
  fatigue: z.number(),
  stress: z.number(),
  confidence: z.number(),
  health: z.number(),
  gpa: z.number(),
  coachTrust: z.number(),
  overall: z.number(),
});

const dayOutcomeSchema = z.object({
  id: z.string().min(1),
  date: gameDateSchema,
  grade: z.enum(["A", "B", "C", "D"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  highlights: z.array(z.string().min(1)),
  deltas: dayDeltaSchema,
});

const lifeSchema = z.object({
  moduleVersion: z.literal(1),
  weekNumber: z.number().int().min(1),
  dayIndex: z.number().int().min(0).max(6),
  completedDays: z.number().int().nonnegative(),
  weeklyPlan: z.object({
    templateId: z.enum(["balanced", "breakout", "recovery", "academic", "film-room"]),
    intensity: z.enum(["controlled", "standard", "aggressive"]),
    focus: focusSchema,
    revision: z.number().int().min(1),
  }),
  consistency: z.number().min(0).max(100),
  lastOutcome: dayOutcomeSchema.optional(),
});

const careerMetaSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  sport: z.literal("american-football"),
  worldSeed: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  currentDate: gameDateSchema,
  phase: z.literal("high-school-preseason"),
  revision: z.number().int().nonnegative(),
});

const historyEntrySchema = z.object({
  id: z.string().min(1),
  occurredAt: z.string().datetime(),
  type: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
});

export const careerSaveSchema = z.object({
  meta: careerMetaSchema,
  character: characterSchema,
  life: lifeSchema,
  football: footballSchema,
  history: z.array(historyEntrySchema),
});

export type CareerSave = z.infer<typeof careerSaveSchema>;

export interface CareerIndexRecord {
  id: string;
  displayName: string;
  sport: "american-football";
  phase: "high-school-preseason";
  currentDate: string;
  updatedAt: string;
  revision: number;
  position: "QB" | "RB" | "WR" | "LB" | "CB";
  jerseyNumber: number;
  schoolName: string;
  stateCode: string;
  overall: number;
  potentialBand: "role-player" | "starter" | "high-upside" | "national-ceiling";
}
