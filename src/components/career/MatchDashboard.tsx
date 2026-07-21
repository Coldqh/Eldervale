import { useMemo, useState } from "react";
import type { CareerSave } from "../../storage/saves/schema";
import { formatGameDate } from "../../core/calendar/types";
import { BottomSheet } from "../ui/BottomSheet";
import { Icon } from "../ui/Icon";

interface MatchDashboardProps {
  save: CareerSave;
  mutating: boolean;
  actionError?: string;
  onStartMatch(): Promise<void>;
  onResolveDecision(optionId: string): Promise<void>;
}

function clockLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function unitLabel(unit: "offense" | "defense"): string {
  return unit === "offense" ? "АТАКА" : "ЗАЩИТА";
}

function riskLabel(risk: "safe" | "balanced" | "aggressive"): string {
  return { safe: "Надёжно", balanced: "Баланс", aggressive: "Риск" }[risk];
}

function daysUntilMatch(dayIndex: number): number {
  return Math.max(0, 5 - dayIndex);
}

function statLine(save: CareerSave): Array<{ label: string; value: string }> {
  const stats = save.football.match.stats;
  switch (save.football.position) {
    case "QB":
      return [
        { label: "COMP/ATT", value: `${stats.completions}/${stats.passingAttempts}` },
        { label: "PASS YDS", value: String(stats.passingYards) },
        { label: "TD", value: String(stats.touchdowns) },
        { label: "TO", value: String(stats.turnovers) },
      ];
    case "RB":
      return [
        { label: "CAR", value: String(stats.rushingAttempts) },
        { label: "RUSH YDS", value: String(stats.rushingYards) },
        { label: "TD", value: String(stats.touchdowns) },
        { label: "TO", value: String(stats.turnovers) },
      ];
    case "WR":
      return [
        { label: "REC/TGT", value: `${stats.receptions}/${stats.targets}` },
        { label: "REC YDS", value: String(stats.receivingYards) },
        { label: "TD", value: String(stats.touchdowns) },
        { label: "TO", value: String(stats.turnovers) },
      ];
    case "LB":
      return [
        { label: "TACKLES", value: String(stats.tackles) },
        { label: "TFL", value: String(stats.tacklesForLoss) },
        { label: "SACK", value: String(stats.sacks) },
        { label: "INT", value: String(stats.interceptions) },
      ];
    case "CB":
      return [
        { label: "TACKLES", value: String(stats.tackles) },
        { label: "PBU", value: String(stats.passBreakups) },
        { label: "INT", value: String(stats.interceptions) },
        { label: "TD", value: String(stats.touchdowns) },
      ];
  }
}

export function MatchDashboard({ save, mutating, actionError, onStartMatch, onResolveDecision }: MatchDashboardProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { football, life } = save;
  const match = football.match;
  const episode = match.currentEpisode;
  const stats = useMemo(() => statLine(save), [save]);
  const isMatchDay = life.dayIndex === 5;

  return (
    <div className="compact-section match-section">
      <header className="compact-page-head match-page-head">
        <div>
          <span>WEEK {match.scheduledWeek} · {unitLabel(match.heroUnit)}</span>
          <h2>{match.status === "complete" ? "Финал" : "Матч"}</h2>
        </div>
        <button type="button" className="match-stat-button" onClick={() => setSheetOpen(true)}>
          <small>EP</small><strong>{match.episodeIndex}/{match.totalEpisodes}</strong>
        </button>
      </header>

      {actionError && <div className="inline-message inline-message--error">{actionError}</div>}

      <section className="match-scoreboard">
        <div>
          <small>{football.school.shortName}</small>
          <strong>{match.heroScore}</strong>
        </div>
        <span>
          <em>{match.status === "upcoming" ? formatGameDate(match.scheduledDate) : `Q${match.quarter} · ${clockLabel(match.clockSeconds)}`}</em>
          <i>{match.status === "complete" ? "FINAL" : match.status === "in-progress" ? "LIVE" : "UPCOMING"}</i>
        </span>
        <div>
          <small>{match.opponentName}</small>
          <strong>{match.opponentScore}</strong>
        </div>
      </section>

      {match.status === "upcoming" && (
        <div className="compact-view match-upcoming">
          <section className="opponent-card">
            <div className="opponent-card__mark"><Icon name={match.heroUnit === "defense" ? "shield" : "football"} size={28} /></div>
            <div>
              <small>СЛЕДУЮЩИЙ СОПЕРНИК · {match.opponentRecord}</small>
              <h3>{match.opponentName}</h3>
              <p>{match.opponentThreat}</p>
            </div>
          </section>

          <div className="match-readiness-strip">
            <span><small>РОЛЬ</small><strong>#{football.depthChart.rank}</strong></span>
            <span><small>ГОТОВНОСТЬ</small><strong>{Math.round(football.training.body.readiness)}</strong></span>
            <span><small>ДОВЕРИЕ</small><strong>{Math.round(football.depthChart.coachTrust)}</strong></span>
          </div>

          {isMatchDay ? (
            <button type="button" className="primary-action-bar primary-action-bar--match" disabled={mutating} onClick={() => void onStartMatch()}>
              <span><small>{unitLabel(match.heroUnit)} · {football.position}</small><strong>{mutating ? "Подготовка…" : "Начать матч"}</strong></span>
              <Icon name="arrow-right" />
            </button>
          ) : (
            <div className="match-lock-card">
              <Icon name="calendar" />
              <div><small>Матч откроется в субботу</small><strong>Осталось {daysUntilMatch(life.dayIndex)} дн.</strong></div>
            </div>
          )}
        </div>
      )}

      {match.status === "in-progress" && episode && (
        <div className="compact-view match-live-view">
          <section className="match-situation-card">
            <header>
              <div><small>{episode.down} & {episode.distance} · FIELD {episode.fieldPosition}</small><h3>{episode.title}</h3></div>
              <span>{football.position}</span>
            </header>
            <p>{episode.situation}</p>
            <div className="match-read-grid">
              <span><small>ЗАДАЧА</small><strong>{episode.assignment}</strong></span>
              <span><small>КЛЮЧ</small><strong>{episode.read}</strong></span>
            </div>
          </section>

          <div className="match-options">
            {episode.options.map((decision, index) => (
              <button type="button" key={decision.id} disabled={mutating} onClick={() => void onResolveDecision(decision.id)}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><small>{riskLabel(decision.risk)}</small><strong>{decision.label}</strong><p>{decision.detail}</p></div>
                <Icon name="arrow-right" />
              </button>
            ))}
          </div>

          {match.completedEpisodes.at(-1) && (
            <button type="button" className="last-play-strip" onClick={() => setSheetOpen(true)}>
              <span className={`result-grade result-grade--${match.completedEpisodes.at(-1)?.grade.toLowerCase()}`}>{match.completedEpisodes.at(-1)?.grade}</span>
              <div><small>Последний эпизод</small><strong>{match.completedEpisodes.at(-1)?.headline}</strong></div>
              <Icon name="chevron-down" />
            </button>
          )}
        </div>
      )}

      {match.status === "complete" && match.finalResult && (
        <div className="compact-view match-final-view">
          <section className={`match-final-card ${match.finalResult.won ? "is-win" : "is-loss"}`}>
            <small>{match.finalResult.won ? "ПОБЕДА" : "ПОРАЖЕНИЕ"}</small>
            <div><strong>{match.finalResult.heroScore}</strong><span>:</span><strong>{match.finalResult.opponentScore}</strong></div>
            <h3>{match.finalResult.headline}</h3>
            <p>{match.finalResult.summary}</p>
          </section>

          <div className="match-stat-grid">
            {stats.map((item) => <span key={item.label}><small>{item.label}</small><strong>{item.value}</strong></span>)}
          </div>

          <section className="match-coach-report">
            <span className={`result-grade result-grade--${match.finalResult.grade.toLowerCase()}`}>{match.finalResult.grade}</span>
            <div><small>ОЦЕНКА ШТАБА</small><strong>{match.finalResult.spotlight}</strong><p>Доверие {match.finalResult.coachTrustDelta >= 0 ? "+" : ""}{match.finalResult.coachTrustDelta.toFixed(1)} · Видимость +{match.finalResult.visibilityDelta.toFixed(1)}</p></div>
          </section>

          <button type="button" className="button button--ghost button--wide" onClick={() => setSheetOpen(true)}>Открыть протокол</button>
        </div>
      )}

      <BottomSheet open={sheetOpen} title="Протокол матча" eyebrow={`${football.position} · ${unitLabel(match.heroUnit)}`} onClose={() => setSheetOpen(false)}>
        <div className="match-sheet-stats">
          {stats.map((item) => <span key={item.label}><small>{item.label}</small><strong>{item.value}</strong></span>)}
        </div>
        <div className="match-log">
          {match.completedEpisodes.length === 0 ? <p>Игровых эпизодов пока нет.</p> : [...match.completedEpisodes].reverse().map((result, index) => (
            <article key={result.id}>
              <span className={`result-grade result-grade--${result.grade.toLowerCase()}`}>{result.grade}</span>
              <div><small>ЭПИЗОД {match.completedEpisodes.length - index}</small><strong>{result.headline}</strong><p>{result.description}</p></div>
            </article>
          ))}
        </div>
      </BottomSheet>
    </div>
  );
}
