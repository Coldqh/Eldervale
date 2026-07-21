import type { GameDate } from "../../../core/calendar/types";
import { SeededRandom } from "../../../core/random/SeededRandom";
import type { FootballPosition, FootballSeasonState } from "../career/types";
import type { FootballMatchState, MatchStatLine, MatchUnit } from "./types";

function addDays(date: GameDate, days: number): GameDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

export function matchUnitForPosition(position: FootballPosition): MatchUnit {
  return position === "LB" || position === "CB" ? "defense" : "offense";
}

export function createEmptyMatchStats(): MatchStatLine {
  return {
    passingAttempts: 0,
    completions: 0,
    passingYards: 0,
    rushingAttempts: 0,
    rushingYards: 0,
    targets: 0,
    receptions: 0,
    receivingYards: 0,
    touchdowns: 0,
    turnovers: 0,
    tackles: 0,
    tacklesForLoss: 0,
    sacks: 0,
    passBreakups: 0,
    interceptions: 0,
  };
}

export function createInitialMatchState(
  worldSeed: string,
  position: FootballPosition,
  season: FootballSeasonState,
  currentDate: GameDate,
  dayIndex = 0,
  scheduledWeek = 1,
): FootballMatchState {
  const random = new SeededRandom(`${worldSeed}:match:${scheduledWeek}:${season.nextOpponent.id}`);
  const daysUntilSaturday = (5 - dayIndex + 7) % 7;
  return {
    moduleVersion: 1,
    gameId: `game-${scheduledWeek}-${season.nextOpponent.id}`,
    status: "upcoming",
    scheduledWeek,
    scheduledDate: addDays(currentDate, daysUntilSaturday),
    opponentId: season.nextOpponent.id,
    opponentName: season.nextOpponent.name,
    opponentRecord: season.nextOpponent.record,
    opponentThreat: season.nextOpponent.threat,
    heroUnit: matchUnitForPosition(position),
    heroScore: 0,
    opponentScore: 0,
    quarter: 1,
    clockSeconds: 12 * 60,
    heroFatigue: random.integer(4, 10),
    coachGrade: 55,
    episodeIndex: 0,
    totalEpisodes: 6,
    completedEpisodes: [],
    stats: createEmptyMatchStats(),
  };
}

const OPPONENT_PREFIXES = ["Riverside", "South County", "Oak Valley", "Franklin Tech", "Bishop Rowe", "Jefferson", "Westlake", "North Metro"] as const;
const OPPONENT_MASCOTS = ["Ravens", "Bulls", "Falcons", "Knights", "Wildcats", "Spartans", "Tigers", "Hawks"] as const;
const THREATS = ["aggressive secondary", "heavy pressure front", "fast perimeter offense", "disciplined zone coverage", "power run game", "mobile quarterback"] as const;

export function createNextOpponent(worldSeed: string, week: number): FootballSeasonState["nextOpponent"] {
  const random = new SeededRandom(`${worldSeed}:opponent:${week}`);
  const prefix = random.pick(OPPONENT_PREFIXES);
  const mascot = random.pick(OPPONENT_MASCOTS);
  const wins = random.integer(0, Math.max(0, week - 1));
  const losses = Math.max(0, week - 1 - wins);
  return {
    id: `opponent-${week}-${prefix.toLowerCase().replaceAll(" ", "-")}`,
    name: `${prefix} ${mascot}`,
    record: `${wins}–${losses}`,
    threat: random.pick(THREATS),
  };
}
