import type { GameDate } from "../../../core/calendar/types";
import type { FootballPosition } from "../career/types";

export type MatchUnit = "offense" | "defense";
export type MatchStatus = "upcoming" | "in-progress" | "complete";
export type DecisionRisk = "safe" | "balanced" | "aggressive";
export type MatchOutcomeGrade = "A" | "B" | "C" | "D";

export interface MatchDecisionOption {
  id: string;
  label: string;
  detail: string;
  risk: DecisionRisk;
  focus: "technique" | "athleticism" | "football-iq" | "competitiveness";
  difficulty: number;
  upside: number;
  mistakeRisk: number;
}

export interface MatchEpisode {
  id: string;
  unit: MatchUnit;
  position: FootballPosition;
  quarter: 1 | 2 | 3 | 4;
  clockSeconds: number;
  down: 1 | 2 | 3 | 4;
  distance: number;
  fieldPosition: number;
  scoreMargin: number;
  title: string;
  situation: string;
  assignment: string;
  read: string;
  options: MatchDecisionOption[];
}

export interface MatchStatLine {
  passingAttempts: number;
  completions: number;
  passingYards: number;
  rushingAttempts: number;
  rushingYards: number;
  targets: number;
  receptions: number;
  receivingYards: number;
  touchdowns: number;
  turnovers: number;
  tackles: number;
  tacklesForLoss: number;
  sacks: number;
  passBreakups: number;
  interceptions: number;
}

export interface MatchEpisodeResult {
  id: string;
  episodeId: string;
  optionId: string;
  grade: MatchOutcomeGrade;
  headline: string;
  description: string;
  yards: number;
  points: number;
  coachDelta: number;
  confidenceDelta: number;
  fatigueDelta: number;
  statDelta: MatchStatLine;
}

export interface MatchFinalResult {
  won: boolean;
  heroScore: number;
  opponentScore: number;
  grade: MatchOutcomeGrade;
  headline: string;
  summary: string;
  spotlight: string;
  coachTrustDelta: number;
  visibilityDelta: number;
}

export interface FootballMatchState {
  moduleVersion: 1;
  gameId: string;
  status: MatchStatus;
  scheduledWeek: number;
  scheduledDate: GameDate;
  opponentId: string;
  opponentName: string;
  opponentRecord: string;
  opponentThreat: string;
  heroUnit: MatchUnit;
  heroScore: number;
  opponentScore: number;
  quarter: 1 | 2 | 3 | 4;
  clockSeconds: number;
  heroFatigue: number;
  coachGrade: number;
  episodeIndex: number;
  totalEpisodes: number;
  currentEpisode?: MatchEpisode | undefined;
  completedEpisodes: MatchEpisodeResult[];
  stats: MatchStatLine;
  finalResult?: MatchFinalResult | undefined;
}
