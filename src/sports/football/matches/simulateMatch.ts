import { SeededRandom } from "../../../core/random/SeededRandom";
import type { CareerSave } from "../../../storage/saves/schema";
import type { FootballPosition } from "../career/types";
import type {
  FootballMatchState,
  MatchDecisionOption,
  MatchEpisode,
  MatchEpisodeResult,
  MatchFinalResult,
  MatchOutcomeGrade,
  MatchStatLine,
} from "./types";

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value * 10) / 10));
}

function round(value: number, digits = 1): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function emptyDelta(): MatchStatLine {
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

function addStats(left: MatchStatLine, right: MatchStatLine): MatchStatLine {
  const result = { ...left };
  for (const key of Object.keys(result) as Array<keyof MatchStatLine>) result[key] += right[key];
  return result;
}

function option(
  id: string,
  label: string,
  detail: string,
  risk: MatchDecisionOption["risk"],
  focus: MatchDecisionOption["focus"],
  difficulty: number,
  upside: number,
  mistakeRisk: number,
): MatchDecisionOption {
  return { id, label, detail, risk, focus, difficulty, upside, mistakeRisk };
}

const clockPlan = [568, 188, 374, 676, 166, 258] as const;
const quarterPlan = [1, 1, 2, 3, 3, 4] as const;

function episodeOptions(position: FootballPosition, variant: number): MatchDecisionOption[] {
  const catalog: Record<FootballPosition, MatchDecisionOption[][]> = {
    QB: [
      [
        option("qb-check", "Сбросить в короткую", "Быстро убрать мяч и сохранить владение.", "safe", "football-iq", 48, 8, 4),
        option("qb-window", "Атаковать окно", "Попасть между linebacker и safety.", "balanced", "technique", 62, 20, 12),
        option("qb-shot", "Глубокий пас", "Проверить cornerback один в один.", "aggressive", "competitiveness", 76, 42, 24),
      ],
      [
        option("qb-slide", "Сдвинуть защиту", "Сменить protection и сыграть по чтению.", "balanced", "football-iq", 58, 18, 9),
        option("qb-run", "Уйти ногами", "Взять свободные ярды до контакта.", "balanced", "athleticism", 60, 16, 10),
        option("qb-hero", "Держать розыгрыш", "Дождаться большого маршрута под давлением.", "aggressive", "competitiveness", 80, 38, 28),
      ],
    ],
    RB: [
      [
        option("rb-press", "Продавить назначенный гэп", "Довериться блокам и взять гарантированные ярды.", "safe", "technique", 50, 10, 5),
        option("rb-cut", "Резать назад", "Увидеть backside и сменить направление.", "balanced", "football-iq", 63, 22, 11),
        option("rb-bounce", "Вынести наружу", "Атаковать край до закрытия contain.", "aggressive", "athleticism", 75, 36, 22),
      ],
      [
        option("rb-secure", "Закрыть мяч", "Сохранить владение через плотный контакт.", "safe", "competitiveness", 52, 9, 3),
        option("rb-contact", "Пройти через контакт", "Понизить центр тяжести и закончить рывок.", "balanced", "competitiveness", 64, 19, 10),
        option("rb-jump", "Перепрыгнуть фронт", "Рискнуть ради first down у линии.", "aggressive", "athleticism", 79, 28, 20),
      ],
    ],
    WR: [
      [
        option("wr-stack", "Сложить защитника", "Выиграть внешнее плечо и держать вертикаль.", "balanced", "technique", 62, 24, 10),
        option("wr-zone", "Сесть в окно", "Остановиться между зонами и показать номер QB.", "safe", "football-iq", 50, 12, 4),
        option("wr-go", "Атаковать глубину", "Не сбрасывать скорость и потребовать дальний мяч.", "aggressive", "athleticism", 76, 42, 21),
      ],
      [
        option("wr-hands", "Страховать приём", "Поймать корпусом и сразу закрыть мяч.", "safe", "technique", 48, 10, 3),
        option("wr-separate", "Создать поздний отрыв", "Сломать темп перед выходом из маршрута.", "balanced", "technique", 64, 21, 9),
        option("wr-highpoint", "Забрать спорный мяч", "Атаковать высшую точку против контакта.", "aggressive", "competitiveness", 78, 35, 18),
      ],
    ],
    LB: [
      [
        option("lb-fit", "Закрыть свой гэп", "Не терять плечо и остановить вынос.", "safe", "football-iq", 50, 11, 4),
        option("lb-scrape", "Скользить за блоком", "Догнать бегущего к боковой линии.", "balanced", "athleticism", 62, 20, 9),
        option("lb-shoot", "Атаковать разрыв", "Пройти до формирования блока.", "aggressive", "competitiveness", 76, 34, 20),
      ],
      [
        option("lb-carry", "Унести маршрут", "Не отпустить tight end за спину.", "safe", "football-iq", 52, 12, 5),
        option("lb-rob", "Читать глаза QB", "Сесть под внутреннее окно передачи.", "balanced", "technique", 66, 24, 12),
        option("lb-blitz", "Давить через A-gap", "Отказаться от глубины ради давления.", "aggressive", "athleticism", 78, 36, 24),
      ],
    ],
    CB: [
      [
        option("cb-leverage", "Держать рычаг", "Не отдавать внутреннюю часть поля.", "safe", "football-iq", 50, 12, 4),
        option("cb-press", "Сбить релиз", "Навязать контакт на линии и нарушить тайминг.", "balanced", "technique", 64, 23, 10),
        option("cb-jump", "Прыгнуть маршрут", "Срезать передачу до выхода ресивера.", "aggressive", "competitiveness", 79, 40, 25),
      ],
      [
        option("cb-trail", "Играть из trail", "Сохранять позицию и атаковать руки поздно.", "safe", "technique", 52, 13, 5),
        option("cb-ball", "Повернуться к мячу", "Найти передачу и сыграть на breakup.", "balanced", "football-iq", 65, 24, 11),
        option("cb-pick", "Идти на перехват", "Оставить ресивера ради мяча.", "aggressive", "competitiveness", 80, 42, 27),
      ],
    ],
  };
  return catalog[position][variant % catalog[position].length] ?? catalog[position][0]!;
}

function episodeText(position: FootballPosition, variant: number): Pick<MatchEpisode, "title" | "situation" | "assignment" | "read"> {
  const texts: Record<FootballPosition, Array<Pick<MatchEpisode, "title" | "situation" | "assignment" | "read">>> = {
    QB: [
      { title: "Третья попытка", situation: "Защита показывает two-high и поздний nickel blitz.", assignment: "Продлить владение и не отдать мяч.", read: "Mike linebacker смещается к границе поля." },
      { title: "Red zone", situation: "Сжатое поле, man coverage и давление с края.", assignment: "Найти лучший matchup до snap.", read: "Safety стоит слишком широко над slot." },
    ],
    RB: [
      { title: "Inside zone", situation: "Front закрывает playside A-gap, backside end держит ширину.", assignment: "Прочитать первый уровень и не остановить ноги.", read: "Nose tackle уходит за блоком вправо." },
      { title: "Короткий ярд", situation: "Восемь защитников в box, first down в двух ярдах.", assignment: "Сохранить мяч и закончить вперёд.", read: "Weakside linebacker идёт до snap." },
    ],
    WR: [
      { title: "Изоляция", situation: "Cornerback играет off-man с внешним рычагом.", assignment: "Выиграть release и открыть окно QB.", read: "Safety остаётся внутри hash." },
      { title: "Ключевой приём", situation: "Третий down, защита показывает match-zone.", assignment: "Понять передачу покрытия после snap.", read: "Nickel defender смотрит в backfield." },
    ],
    LB: [
      { title: "Вынос в твой сектор", situation: "Нападение ставит tight end и H-back в одну сторону.", assignment: "Сохранить fit и не выпустить бегущего наружу.", read: "Guard делает первый шаг к тебе." },
      { title: "Play-action", situation: "QB прячет мяч, tight end выходит за linebackers.", assignment: "Не потерять run responsibility и глубину.", read: "Backside guard не поднимается на второй уровень." },
    ],
    CB: [
      { title: "Один в один", situation: "Ресивер широко, reduced split отсутствует, safety далеко.", assignment: "Не отдать explosive play.", read: "Первый шаг ресивера направлен внутрь." },
      { title: "Третий down", situation: "Trips formation, твой ресивер выходит из bunch.", assignment: "Пережить traffic и закрыть sticks.", read: "QB заранее проверяет твою сторону." },
    ],
  };
  return texts[position][variant % texts[position].length] ?? texts[position][0]!;
}

function generateEpisode(save: CareerSave, match: FootballMatchState, index: number): MatchEpisode {
  const random = new SeededRandom(`${save.meta.worldSeed}:${match.gameId}:episode:${index}`);
  const variant = random.integer(0, 3);
  const quarter = quarterPlan[index] ?? 4;
  const clockSeconds = clockPlan[index] ?? 120;
  const text = episodeText(save.football.position, variant);
  return {
    id: `${match.gameId}-ep-${index + 1}`,
    unit: match.heroUnit,
    position: save.football.position,
    quarter,
    clockSeconds,
    down: random.pick([1, 2, 3, 3, 4] as const),
    distance: random.integer(1, 11),
    fieldPosition: random.integer(18, 88),
    scoreMargin: match.heroScore - match.opponentScore,
    ...text,
    options: episodeOptions(save.football.position, variant),
  };
}

function skillValue(save: CareerSave, option: MatchDecisionOption): number {
  const ratings = save.football.ratings;
  const focus = {
    technique: ratings.technique,
    athleticism: ratings.athleticism,
    "football-iq": ratings.footballIq,
    competitiveness: ratings.competitiveness,
  }[option.focus];
  return (
    focus * 0.47 +
    ratings.technique * 0.14 +
    ratings.footballIq * 0.12 +
    save.character.condition.confidence * 0.1 +
    save.football.training.body.readiness * 0.09 +
    save.football.depthChart.coachTrust * 0.08
  );
}

function gradeFromScore(score: number): MatchOutcomeGrade {
  if (score >= 80) return "A";
  if (score >= 64) return "B";
  if (score >= 47) return "C";
  return "D";
}

function makeStatDelta(position: FootballPosition, grade: MatchOutcomeGrade, yards: number, points: number, random: SeededRandom): MatchStatLine {
  const stats = emptyDelta();
  const success = grade === "A" || grade === "B";
  if (position === "QB") {
    stats.passingAttempts = 1;
    stats.completions = success ? 1 : 0;
    stats.passingYards = success ? Math.max(0, yards) : 0;
    stats.touchdowns = points === 7 ? 1 : 0;
    stats.turnovers = grade === "D" && random.chance(0.34) ? 1 : 0;
  } else if (position === "RB") {
    stats.rushingAttempts = 1;
    stats.rushingYards = yards;
    stats.touchdowns = points === 7 ? 1 : 0;
    stats.turnovers = grade === "D" && random.chance(0.22) ? 1 : 0;
  } else if (position === "WR") {
    stats.targets = 1;
    stats.receptions = success ? 1 : 0;
    stats.receivingYards = success ? Math.max(0, yards) : 0;
    stats.touchdowns = points === 7 ? 1 : 0;
    stats.turnovers = grade === "D" && random.chance(0.08) ? 1 : 0;
  } else if (position === "LB") {
    stats.tackles = grade === "D" ? 0 : 1;
    stats.tacklesForLoss = grade === "A" && yards <= -2 ? 1 : 0;
    stats.sacks = grade === "A" && random.chance(0.32) ? 1 : 0;
    stats.passBreakups = grade === "A" && random.chance(0.24) ? 1 : 0;
    stats.interceptions = grade === "A" && random.chance(0.12) ? 1 : 0;
  } else {
    stats.tackles = grade === "C" || grade === "B" ? 1 : 0;
    stats.passBreakups = grade === "A" || (grade === "B" && random.chance(0.35)) ? 1 : 0;
    stats.interceptions = grade === "A" && random.chance(0.24) ? 1 : 0;
  }
  return stats;
}

function resultText(unit: FootballMatchState["heroUnit"], grade: MatchOutcomeGrade, yards: number, turnover: boolean): Pick<MatchEpisodeResult, "headline" | "description"> {
  if (unit === "offense") {
    if (turnover) return { headline: "Потеря мяча", description: "Риск не прошёл. Защита забирает владение и штаб фиксирует ошибку." };
    if (grade === "A") return { headline: "Большой розыгрыш", description: `Решение сработало полностью. Нападение получает ${Math.max(1, yards)} ярдов и меняет позицию на поле.` };
    if (grade === "B") return { headline: "Положительный розыгрыш", description: `Ты выполняешь задачу и приносишь ${Math.max(1, yards)} ярдов.` };
    if (grade === "C") return { headline: "Минимальный результат", description: `Розыгрыш не разваливается, но даёт только ${Math.max(0, yards)} ярда.` };
    return { headline: "Розыгрыш проигран", description: `Защита читает решение. Нападение теряет ${Math.abs(Math.min(0, yards))} ярда.` };
  }
  if (grade === "A") return { headline: "Защита выигрывает эпизод", description: yards < 0 ? `Ты останавливаешь атаку за линией на ${Math.abs(yards)} ярда.` : "Ты закрываешь назначение и создаёшь turnover opportunity." };
  if (grade === "B") return { headline: "Надёжная защита", description: `Ты ограничиваешь розыгрыш ${Math.max(0, yards)} ярдами и сохраняешь структуру.` };
  if (grade === "C") return { headline: "Поздний контакт", description: `Атака получает ${Math.max(1, yards)} ярдов, но ты не позволяешь explosive play.` };
  return { headline: "Назначение проиграно", description: `Атака использует ошибку и забирает ${Math.max(8, yards)} ярдов.` };
}

function backgroundScore(match: FootballMatchState, save: CareerSave, index: number): { hero: number; opponent: number } {
  const random = new SeededRandom(`${save.meta.worldSeed}:${match.gameId}:background:${index}`);
  const teamEdge = (save.football.teamDynamics.cohesion + save.football.teamDynamics.schemeMastery - 120) / 100;
  const heroChance = 0.34 + teamEdge * 0.12;
  const opponentChance = 0.32 - teamEdge * 0.08;
  const score = () => (random.chance(0.68) ? 7 : 3);
  return {
    hero: random.chance(heroChance) ? score() : 0,
    opponent: random.chance(opponentChance) ? score() : 0,
  };
}

function finalResult(match: FootballMatchState, save: CareerSave): MatchFinalResult {
  let heroScore = match.heroScore;
  let opponentScore = match.opponentScore;
  const random = new SeededRandom(`${save.meta.worldSeed}:${match.gameId}:final`);
  if (heroScore === opponentScore) {
    if (random.chance(0.52)) heroScore += 3;
    else opponentScore += 3;
  }
  const grade = gradeFromScore(match.coachGrade);
  const won = heroScore > opponentScore;
  const spotlight = save.football.position === "QB"
    ? `${match.stats.completions}/${match.stats.passingAttempts}, ${match.stats.passingYards} ярдов`
    : save.football.position === "RB"
      ? `${match.stats.rushingYards} ярдов на ${match.stats.rushingAttempts} выносах`
      : save.football.position === "WR"
        ? `${match.stats.receptions}/${match.stats.targets}, ${match.stats.receivingYards} ярдов`
        : save.football.position === "LB"
          ? `${match.stats.tackles} захватов, ${match.stats.tacklesForLoss} TFL, ${match.stats.sacks} sacks`
          : `${match.stats.tackles} захватов, ${match.stats.passBreakups} PBU, ${match.stats.interceptions} INT`;
  const coachTrustDelta = round((match.coachGrade - 55) * 0.11, 1);
  const visibilityDelta = round(Math.max(0, (match.coachGrade - 52) * 0.09) + (won ? 0.8 : 0), 1);
  return {
    won,
    heroScore,
    opponentScore,
    grade,
    headline: won ? "Победа закрыта" : "Матч упущен",
    summary: `${save.football.school.shortName} ${won ? "побеждает" : "проигрывает"} ${heroScore}:${opponentScore}. Оценка штаба — ${grade}.`,
    spotlight,
    coachTrustDelta,
    visibilityDelta,
  };
}

export function startMatch(save: CareerSave): CareerSave {
  const match = save.football.match;
  if (match.status !== "upcoming") return save;
  const started: FootballMatchState = {
    ...match,
    status: "in-progress",
    heroScore: 0,
    opponentScore: 0,
    quarter: 1,
    clockSeconds: clockPlan[0],
    heroFatigue: clamp(save.character.condition.fatigue * 0.16 + (100 - save.football.training.body.readiness) * 0.12, 3, 24),
    coachGrade: 55,
    episodeIndex: 0,
    completedEpisodes: [],
    stats: emptyDelta(),
  };
  return {
    ...save,
    football: {
      ...save.football,
      match: { ...started, currentEpisode: generateEpisode(save, started, 0) },
    },
    history: [
      ...save.history,
      {
        id: `${match.gameId}-started`,
        occurredAt: save.meta.updatedAt,
        type: "match-started",
        title: `Матч против ${match.opponentName}`,
        description: `${save.football.position} выходит в ${match.heroUnit === "defense" ? "защите" : "атаке"}. Ключевые эпизоды будут решаться вручную.`,
      },
    ],
  };
}

export function resolveMatchDecision(save: CareerSave, optionId: string): CareerSave {
  const match = save.football.match;
  const episode = match.currentEpisode;
  if (match.status !== "in-progress" || !episode) throw new Error("Match has no active episode");
  const selected = episode.options.find((item) => item.id === optionId);
  if (!selected) throw new Error("Unknown match decision");

  const random = new SeededRandom(`${save.meta.worldSeed}:${match.gameId}:${episode.id}:${optionId}`);
  const fatiguePenalty = match.heroFatigue * 0.24 + save.character.condition.fatigue * 0.08;
  const painPenalty = save.football.training.body.pain * 0.1 + (save.football.training.body.medicalStatus === "limited" ? 6 : 0);
  const rawScore = skillValue(save, selected) + random.integer(-17, 17) - selected.difficulty * 0.42 - fatiguePenalty - painPenalty + 31;
  const grade = gradeFromScore(rawScore);
  const offense = match.heroUnit === "offense";
  const yardsBase = selected.upside * (grade === "A" ? 1.05 : grade === "B" ? 0.58 : grade === "C" ? 0.18 : -0.22);
  const yards = Math.round(offense ? yardsBase + random.integer(-3, 5) : grade === "A" ? -random.integer(1, 5) : grade === "B" ? random.integer(0, 4) : grade === "C" ? random.integer(4, 9) : random.integer(10, 24));
  const mistake = grade === "D" && random.chance(selected.mistakeRisk / 100);
  const touchdown = offense && grade === "A" && (episode.fieldPosition + Math.max(0, yards) >= 100 || random.chance(selected.risk === "aggressive" ? 0.23 : 0.1));
  const points = touchdown ? 7 : 0;
  const statDelta = makeStatDelta(save.football.position, grade, yards, points, random);
  if (mistake) statDelta.turnovers = Math.max(1, statDelta.turnovers);
  const coachDelta = round(grade === "A" ? 8 : grade === "B" ? 3.5 : grade === "C" ? -1.5 : -7.5, 1);
  const confidenceDelta = round(grade === "A" ? 4 : grade === "B" ? 1.5 : grade === "C" ? -0.7 : -3.5, 1);
  const fatigueDelta = round(4 + selected.difficulty * 0.035 + (selected.risk === "aggressive" ? 2.4 : 0), 1);
  const copy = resultText(match.heroUnit, grade, yards, mistake);
  const outcome: MatchEpisodeResult = {
    id: `${episode.id}-result`,
    episodeId: episode.id,
    optionId,
    grade,
    ...copy,
    yards,
    points,
    coachDelta,
    confidenceDelta,
    fatigueDelta,
    statDelta,
  };

  const background = backgroundScore(match, save, match.episodeIndex);
  let heroScore = match.heroScore + background.hero + points;
  let opponentScore = match.opponentScore + background.opponent;
  if (!offense && grade === "D" && random.chance(0.34)) opponentScore += 7;
  if (!offense && statDelta.interceptions > 0 && random.chance(0.25)) heroScore += 7;
  const nextIndex = match.episodeIndex + 1;
  const nextStats = addStats(match.stats, statDelta);
  const nextMatchBase: FootballMatchState = {
    ...match,
    heroScore,
    opponentScore,
    quarter: quarterPlan[Math.min(nextIndex, quarterPlan.length - 1)] ?? 4,
    clockSeconds: clockPlan[Math.min(nextIndex, clockPlan.length - 1)] ?? 0,
    heroFatigue: clamp(match.heroFatigue + fatigueDelta, 0, 100),
    coachGrade: clamp(match.coachGrade + coachDelta, 0, 100),
    episodeIndex: nextIndex,
    completedEpisodes: [...match.completedEpisodes, outcome],
    stats: nextStats,
    currentEpisode: undefined,
  };

  let nextMatch: FootballMatchState;
  let nextFootball = save.football;
  let history = save.history;
  let nextCharacter = {
    ...save.character,
    condition: {
      ...save.character.condition,
      confidence: clamp(save.character.condition.confidence + confidenceDelta),
      fatigue: clamp(save.character.condition.fatigue + fatigueDelta * 0.36),
      energy: clamp(save.character.condition.energy - fatigueDelta * 0.28),
    },
  };

  if (nextIndex >= match.totalEpisodes) {
    const result = finalResult(nextMatchBase, save);
    nextMatch = {
      ...nextMatchBase,
      status: "complete",
      heroScore: result.heroScore,
      opponentScore: result.opponentScore,
      quarter: 4,
      clockSeconds: 0,
      finalResult: result,
    };
    nextFootball = {
      ...save.football,
      match: nextMatch,
      season: {
        ...save.football.season,
        wins: save.football.season.wins + (result.won ? 1 : 0),
        losses: save.football.season.losses + (result.won ? 0 : 1),
      },
      depthChart: {
        ...save.football.depthChart,
        coachTrust: clamp(save.football.depthChart.coachTrust + result.coachTrustDelta),
      },
      recruitment: {
        ...save.football.recruitment,
        visibility: clamp(save.football.recruitment.visibility + result.visibilityDelta),
      },
    };
    history = [
      ...history,
      {
        id: `${match.gameId}-complete`,
        occurredAt: save.meta.updatedAt,
        type: "match-completed",
        title: `${result.won ? "Победа" : "Поражение"} ${result.heroScore}:${result.opponentScore}`,
        description: `${result.summary} ${result.spotlight}.`,
      },
    ];
  } else {
    nextMatch = { ...nextMatchBase, currentEpisode: generateEpisode(save, nextMatchBase, nextIndex) };
    nextFootball = { ...save.football, match: nextMatch };
  }

  return { ...save, character: nextCharacter, football: nextFootball, history };
}
