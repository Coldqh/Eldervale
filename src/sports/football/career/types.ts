import type { CharacterCreationInput } from "../../../core/character/types";
import type { FootballTrainingState } from "../training/types";
import type { FootballMatchState } from "../matches/types";
import type {
  DepthChartDecision,
  DepthChartEvaluation,
  FootballRosterPlayer,
  FootballTeamStaff,
  PlayerYear,
  TeamDynamics,
} from "../team/types";

export type FootballPosition = "QB" | "RB" | "WR" | "LB" | "CB";

export interface FootballCareerSetup {
  character: CharacterCreationInput;
  position: FootballPosition;
  archetypeId: string;
  jerseyNumber: number;
}

export interface FootballRatings {
  overall: number;
  potentialBand: "role-player" | "starter" | "high-upside" | "national-ceiling";
  athleticism: number;
  technique: number;
  footballIq: number;
  competitiveness: number;
}

export interface SchoolIdentity {
  id: string;
  name: string;
  shortName: string;
  mascot: string;
  city: string;
  stateCode: string;
  primaryColor: string;
  secondaryColor: string;
  prestige: number;
  facilities: number;
  coaching: number;
  medicine: number;
  discipline: number;
  youthTrust: number;
  philosophy: string;
}

export interface DepthChartState {
  rank: number;
  playersAtPosition: number;
  coachTrust: number;
  projectedRole: "starter" | "rotation" | "special-teams" | "developmental";
  directRival: {
    id: string;
    name: string;
    year: PlayerYear;
    overall: number;
    style: string;
  };
  evaluation: DepthChartEvaluation;
  lastDecision: DepthChartDecision;
}

export interface FootballSeasonState {
  year: number;
  phase: "preseason";
  week: number;
  wins: number;
  losses: number;
  nextOpponent: {
    id: string;
    name: string;
    record: string;
    threat: string;
  };
}

export interface FootballCareerState {
  moduleVersion: 5;
  worldSeed: string;
  stage: "high-school-preseason";
  position: FootballPosition;
  archetypeId: string;
  archetypeName: string;
  jerseyNumber: number;
  ratings: FootballRatings;
  school: SchoolIdentity;
  staff: FootballTeamStaff;
  roster: FootballRosterPlayer[];
  teamDynamics: TeamDynamics;
  training: FootballTrainingState;
  match: FootballMatchState;
  depthChart: DepthChartState;
  season: FootballSeasonState;
  recruitment: {
    visibility: number;
    interestedPrograms: number;
    offers: number;
    regionalRankLabel: string;
  };
}
