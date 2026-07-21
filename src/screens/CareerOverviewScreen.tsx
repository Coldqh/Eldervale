import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppHeader } from "../components/layout/AppHeader";
import { ScreenShell } from "../components/layout/ScreenShell";
import { LoadingScreen } from "../components/feedback/LoadingScreen";
import { Icon, type IconName } from "../components/ui/Icon";
import { MetricBar } from "../components/ui/MetricBar";
import { SectionTabs } from "../components/ui/SectionTabs";
import { TodayDashboard } from "../components/career/TodayDashboard";
import { MatchDashboard } from "../components/career/MatchDashboard";
import {
  familyIncomeLabels,
  familyStructureLabels,
  familySupportLabels,
  mindsetLabels,
} from "../sports/football/career/catalog";
import { useCareerSave } from "../hooks/useCareerSave";

const tabs = [
  { id: "today", label: "Сегодня", icon: "home" },
  { id: "match", label: "Матч", icon: "football" },
  { id: "career", label: "Карьера", icon: "chart" },
  { id: "team", label: "Команда", icon: "team" },
  { id: "profile", label: "Игрок", icon: "user" },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];

const careerViews = [
  { id: "overview", label: "Путь" },
  { id: "history", label: "История" },
  { id: "recruiting", label: "Рекрутинг" },
] as const;
const teamViews = [
  { id: "overview", label: "Сводка" },
  { id: "depth", label: "Depth" },
  { id: "roster", label: "Ростер" },
  { id: "staff", label: "Штаб" },
] as const;
const rosterViews = [
  { id: "offense", label: "Атака" },
  { id: "defense", label: "Защита" },
  { id: "special", label: "Спец." },
] as const;
const profileViews = [
  { id: "body", label: "Тело" },
  { id: "mind", label: "Характер" },
  { id: "origin", label: "Дом" },
  { id: "study", label: "Учёба" },
] as const;

type TabId = (typeof tabs)[number]["id"];
type CareerView = (typeof careerViews)[number]["id"];
type TeamView = (typeof teamViews)[number]["id"];
type ProfileView = (typeof profileViews)[number]["id"];
type RosterView = (typeof rosterViews)[number]["id"];

function heightLabel(inches: number): string {
  return `${Math.floor(inches / 12)}′${inches % 12}″`;
}

function potentialLabel(value: "role-player" | "starter" | "high-upside" | "national-ceiling"): string {
  return {
    "role-player": "Ролевой уровень",
    starter: "Потенциальный стартер",
    "high-upside": "Высокий потолок",
    "national-ceiling": "Национальный потенциал",
  }[value];
}

function roleLabel(value: "starter" | "rotation" | "special-teams" | "developmental"): string {
  return { starter: "Стартер", rotation: "Ротация", "special-teams": "Спецкоманды", developmental: "Развитие" }[value];
}

function coachRoleLabel(value: "head-coach" | "position-coach" | "offensive-coordinator" | "defensive-coordinator"): string {
  return {
    "head-coach": "Главный тренер",
    "position-coach": "Позиционный тренер",
    "offensive-coordinator": "Координатор атаки",
    "defensive-coordinator": "Координатор защиты",
  }[value];
}

function trendLabel(value: "rising" | "stable" | "falling"): string {
  return { rising: "Растёт", stable: "Стабильно", falling: "Падает" }[value];
}

export default function CareerOverviewScreen() {
  const navigate = useNavigate();
  const { careerId } = useParams();
  const { save, loading, error, mutating, actionError, updateWeeklyPlan, updateTrainingPlan, advanceDay, startMatch, resolveMatchDecision } = useCareerSave(careerId);
  const [activeTab, setActiveTab] = useState<TabId>("today");
  const [careerView, setCareerView] = useState<CareerView>("overview");
  const [teamView, setTeamView] = useState<TeamView>("overview");
  const [profileView, setProfileView] = useState<ProfileView>("body");
  const [rosterView, setRosterView] = useState<RosterView>("offense");

  if (loading) {
    return <LoadingScreen label="Восстановление карьеры" />;
  }

  if (!save || error) {
    return (
      <ScreenShell narrow>
        <section className="fatal-panel">
          <span className="eyebrow">Сохранение недоступно</span>
          <h1>{error ?? "Карьера не найдена"}</h1>
          <button className="button button--primary" onClick={() => navigate("/")}>К списку карьер</button>
        </section>
      </ScreenShell>
    );
  }

  const { character, football } = save;
  const initials = `${character.identity.firstName[0] ?? "P"}${character.identity.lastName[0] ?? "R"}`;
  const positionRivals = football.roster
    .filter((player) => player.position === football.position)
    .sort((left, right) => (right.overall * 0.72 + right.coachStanding * 0.28) - (left.overall * 0.72 + left.coachStanding * 0.28));
  const depthRoom: Array<{ id: string; name: string; year: string; style: string; overall: number; status: string; isHero: boolean }> = positionRivals.map((player) => ({
    id: player.id, name: player.name, year: player.year, style: player.style, overall: player.overall, status: player.status, isHero: false,
  }));
  depthRoom.splice(Math.max(0, football.depthChart.rank - 1), 0, {
    id: "hero", name: character.identity.fullName, year: "Senior", style: football.archetypeName, overall: football.ratings.overall, status: football.depthChart.projectedRole, isHero: true,
  });
  const visibleRoster = football.roster
    .filter((player) => player.unit === rosterView)
    .sort((left, right) => left.position.localeCompare(right.position) || left.depthRank - right.depthRank);

  return (
    <ScreenShell
      header={
        <AppHeader
          compact
          action={
            <button className="icon-button icon-button--quiet" aria-label="К списку карьер" onClick={() => navigate("/")}>
              <Icon name="menu" />
            </button>
          }
        />
      }
      footer={
        <nav className="career-nav" aria-label="Разделы карьеры">
          {tabs.map((tab) => (
            <button key={tab.id} className={activeTab === tab.id ? "is-active" : ""} onClick={() => setActiveTab(tab.id)}>
              <Icon name={tab.icon} />
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      }
    >
      <div className="career-layout career-layout--compact">
        <aside className="career-sidebar career-sidebar--compact">
          <div className="career-sidebar__logo"><span>{football.position}</span><strong>#{String(football.jerseyNumber).padStart(2, "0")}</strong></div>
          <nav>
            {tabs.map((tab) => (
              <button key={tab.id} className={activeTab === tab.id ? "is-active" : ""} onClick={() => setActiveTab(tab.id)}>
                <Icon name={tab.icon} /><span>{tab.label}</span>
              </button>
            ))}
          </nav>
          <div className="career-sidebar__season">
            <small>SENIOR SEASON</small>
            <strong>W{football.season.week} · {football.season.wins}–{football.season.losses}</strong>
            <span>{football.school.shortName} {football.school.mascot}</span>
          </div>
        </aside>

        <div className="career-main">
          <section className="player-compact-header">
            <div className="player-compact-header__avatar"><span>{initials}</span><small>{football.position}</small></div>
            <div className="player-compact-header__identity">
              <small>#{football.jerseyNumber} · {football.archetypeName}</small>
              <h1>{character.identity.fullName}</h1>
              <p>{football.school.shortName} {football.school.mascot} · {character.origin.city}, {character.origin.stateCode}</p>
            </div>
            <div className="player-compact-header__rating"><small>OVR</small><strong>{football.ratings.overall}</strong><span>{potentialLabel(football.ratings.potentialBand)}</span></div>
          </section>

          {activeTab === "today" && (
            <TodayDashboard
              save={save}
              mutating={mutating}
              {...(actionError ? { actionError } : {})}
              onUpdatePlan={updateWeeklyPlan}
              onUpdateTrainingPlan={updateTrainingPlan}
              onAdvanceDay={advanceDay}
              onOpenMatch={() => setActiveTab("match")}
            />
          )}

          {activeTab === "match" && (
            <MatchDashboard
              save={save}
              mutating={mutating}
              {...(actionError ? { actionError } : {})}
              onStartMatch={startMatch}
              onResolveDecision={resolveMatchDecision}
            />
          )}

          {activeTab === "career" && (
            <div className="compact-section">
              <header className="compact-page-head">
                <div><span>Senior season 2026</span><h2>Карьера</h2></div>
                <strong className="compact-head-score">W{football.season.week}</strong>
              </header>
              <SectionTabs<CareerView> tabs={careerViews} active={careerView} onChange={setCareerView} ariaLabel="Разделы карьеры" />

              {careerView === "overview" && (
                <div className="compact-view">
                  <section className="career-stage-compact">
                    <div className="career-stage-compact__number">01</div>
                    <div><small>Текущий этап</small><h3>Последний школьный сезон</h3><p>Закрепиться в составе, сыграть сезон и выйти на рынок колледжей.</p></div>
                    <span>ACTIVE</span>
                  </section>
                  <div className="compact-stat-pair">
                    <article><small>Видимость</small><strong>{football.recruitment.visibility}</strong><span>{football.recruitment.regionalRankLabel}</span></article>
                    <article><small>Программы</small><strong>{football.recruitment.interestedPrograms}</strong><span>проявляют интерес</span></article>
                  </div>
                  <button type="button" className="compact-link-card" onClick={() => setCareerView("recruiting")}>
                    <Icon name="target" /><div><strong>Рынок рекрутинга</strong><small>Оценки, интерес и будущие предложения</small></div><Icon name="arrow-right" />
                  </button>
                  <button type="button" className="compact-link-card" onClick={() => setCareerView("history")}>
                    <Icon name="clock" /><div><strong>История карьеры</strong><small>{save.history.length} зафиксированных событий</small></div><Icon name="arrow-right" />
                  </button>
                </div>
              )}

              {careerView === "history" && (
                <div className="compact-view history-list-compact">
                  {save.history.map((entry) => (
                    <article key={entry.id}>
                      <time>{new Date(entry.occurredAt).toLocaleDateString("ru-RU")}</time>
                      <div><strong>{entry.title}</strong><p>{entry.description}</p></div>
                    </article>
                  ))}
                </div>
              )}

              {careerView === "recruiting" && (
                <div className="compact-view">
                  <section className="recruiting-card-compact">
                    <div><small>Regional visibility</small><strong>{football.recruitment.visibility}</strong><span>{football.recruitment.regionalRankLabel}</span></div>
                    <MetricBar compact label="Известность" value={football.recruitment.visibility} />
                  </section>
                  <div className="compact-stat-pair">
                    <article><small>Интерес</small><strong>{football.recruitment.interestedPrograms}</strong><span>программ</span></article>
                    <article><small>Потолок</small><strong>{football.ratings.overall}</strong><span>{potentialLabel(football.ratings.potentialBand)}</span></article>
                  </div>
                  <div className="compact-note"><Icon name="spark" /><p>Первые серьёзные оценки появятся после матчей. Учитываются уровень соперника, роль, стабильность, учёба и поведение.</p></div>
                </div>
              )}
            </div>
          )}

          {activeTab === "team" && (
            <div className="compact-section">
              <header className="compact-page-head">
                <div><span>{football.school.city}, {football.school.stateCode}</span><h2>Команда</h2></div>
                <span className="team-color-dot" />
              </header>
              <SectionTabs<TeamView> tabs={teamViews} active={teamView} onChange={setTeamView} ariaLabel="Разделы команды" />

              {teamView === "overview" && (
                <div className="compact-view">
                  <section className="team-card-compact team-card-compact--red">
                    <div className="team-card-compact__mark">{football.school.shortName.slice(0, 2).toUpperCase()}</div>
                    <div><small>{football.school.shortName}</small><h3>{football.school.mascot}</h3><p>{football.school.philosophy}</p></div>
                    <strong>{football.school.prestige}</strong>
                  </section>
                  <div className="compact-stat-pair">
                    <article><small>Твоя роль</small><strong>#{football.depthChart.rank}</strong><span>{roleLabel(football.depthChart.projectedRole)}</span></article>
                    <article><small>До места выше</small><strong>{football.depthChart.evaluation.gap.toFixed(1)}</strong><span>{trendLabel(football.depthChart.evaluation.trend)}</span></article>
                  </div>
                  <section className={`staff-decision staff-decision--${football.depthChart.lastDecision.type}`}>
                    <div><small>Решение штаба</small><h3>{football.depthChart.lastDecision.title}</h3></div>
                    <p>{football.depthChart.lastDecision.description}</p>
                  </section>
                  <div className="team-action-grid">
                    <button type="button" onClick={() => setTeamView("depth")}><Icon name="target" /><span><strong>Depth chart</strong><small>Почему ты на этом месте</small></span></button>
                    <button type="button" onClick={() => setTeamView("roster")}><Icon name="team" /><span><strong>{football.roster.length + 1} игроков</strong><small>Полный состав программы</small></span></button>
                    <button type="button" onClick={() => setTeamView("staff")}><Icon name="brain" /><span><strong>{football.staff.headCoach.name}</strong><small>Тренерский штаб</small></span></button>
                  </div>
                </div>
              )}

              {teamView === "depth" && (
                <div className="compact-view">
                  <section className="depth-card-compact">
                    <header><div><small>{football.position} ROOM</small><h3>Depth chart</h3></div><span>#{football.depthChart.rank}</span></header>
                    <div className="depth-list depth-list--compact depth-list--full">
                      {depthRoom.map((player, index) => (
                        <article key={player.id} className={player.isHero ? "is-player" : ""}>
                          <span>{index + 1}</span>
                          <div><strong>{player.name}</strong><small>{player.year} · {player.style}</small></div>
                          <em>{player.overall}</em>
                        </article>
                      ))}
                    </div>
                  </section>
                  <section className="depth-evaluation">
                    <header><span>Оценка штаба</span><strong>{football.depthChart.evaluation.heroScore.toFixed(1)}</strong></header>
                    <p>{football.depthChart.evaluation.summary}</p>
                    <ul>{football.depthChart.evaluation.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                  </section>
                  <MetricBar compact label="Доверие позиционного тренера" value={football.depthChart.coachTrust} />
                </div>
              )}

              {teamView === "roster" && (
                <div className="compact-view">
                  <SectionTabs<RosterView> tabs={rosterViews} active={rosterView} onChange={setRosterView} ariaLabel="Группы состава" />
                  <div className="roster-list-compact">
                    {visibleRoster.map((player) => (
                      <article key={player.id}>
                        <span className="roster-position">{player.position}</span>
                        <div><strong>{player.name}</strong><small>{player.year} · #{player.depthRank} · {player.style}</small></div>
                        <span className={`roster-status roster-status--${player.status}`}>{player.status}</span>
                        <em>{player.overall}</em>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {teamView === "staff" && (
                <div className="compact-view">
                  <div className="coach-grid">
                    {[football.staff.headCoach, football.staff.positionCoach, football.staff.offensiveCoordinator, football.staff.defensiveCoordinator].map((coach) => (
                      <article key={coach.id} className={coach.role === "position-coach" ? "is-key" : ""}>
                        <header><span>{coachRoleLabel(coach.role)}</span><em>{coach.age}</em></header>
                        <h3>{coach.name}</h3>
                        <p>{coach.summary}</p>
                        <div><small>Развитие <strong>{coach.development}</strong></small><small>Тактика <strong>{coach.tactics}</strong></small><small>Отношение <strong>{coach.relationship}</strong></small></div>
                      </article>
                    ))}
                  </div>
                  <div className="team-dynamics">
                    <MetricBar compact label="Мораль" value={football.teamDynamics.morale} />
                    <MetricBar compact label="Сыгранность" value={football.teamDynamics.cohesion} />
                    <MetricBar compact label="Дисциплина" value={football.teamDynamics.discipline} />
                    <MetricBar compact label="Знание схемы" value={football.teamDynamics.schemeMastery} />
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "profile" && (
            <div className="compact-section">
              <header className="compact-page-head">
                <div><span>Player profile</span><h2>Игрок</h2></div>
                <strong className="compact-head-score">{football.position}</strong>
              </header>
              <SectionTabs<ProfileView> tabs={profileViews} active={profileView} onChange={setProfileView} ariaLabel="Разделы профиля" />

              {profileView === "body" && (
                <div className="compact-view">
                  <div className="body-readout body-readout--compact">
                    <span><small>Рост</small><strong>{heightLabel(character.physical.heightInches)}</strong></span>
                    <span><small>Вес</small><strong>{character.physical.weightLbs}</strong><em>LB</em></span>
                    <span><small>Телосложение</small><strong>{character.physical.frame}</strong></span>
                  </div>
                  <div className="metric-list-card">
                    <MetricBar compact label="Скорость" value={character.physical.speed} />
                    <MetricBar compact label="Сила" value={character.physical.strength} />
                    <MetricBar compact label="Ловкость" value={character.physical.agility} />
                    <MetricBar compact label="Взрывная мощь" value={character.physical.explosiveness} />
                    <MetricBar compact label="Выносливость" value={character.physical.stamina} />
                  </div>
                </div>
              )}

              {profileView === "mind" && (
                <div className="compact-view">
                  <section className="mindset-card-compact"><small>Архетип</small><h3>{mindsetLabels[character.personality.preset].name}</h3><p>{mindsetLabels[character.personality.preset].summary}</p></section>
                  <div className="metric-list-card">
                    <MetricBar compact label="Дисциплина" value={character.personality.discipline} />
                    <MetricBar compact label="Амбиции" value={character.personality.ambition} />
                    <MetricBar compact label="Самообладание" value={character.personality.composure} />
                    <MetricBar compact label="Обучаемость" value={character.personality.coachability} />
                    <MetricBar compact label="Адаптивность" value={character.personality.adaptability} />
                  </div>
                </div>
              )}

              {profileView === "origin" && (
                <div className="compact-view">
                  <section className="origin-card-compact"><Icon name="map" /><div><small>Родной город</small><h3>{character.origin.city}, {character.origin.stateCode}</h3><p>{character.origin.region}</p></div></section>
                  <div className="info-list info-list--compact">
                    <span><small>Финансы семьи</small><strong>{familyIncomeLabels[character.origin.familyIncome]}</strong></span>
                    <span><small>Дом</small><strong>{familyStructureLabels[character.origin.familyStructure]}</strong></span>
                    <span><small>Поддержка спорта</small><strong>{familySupportLabels[character.origin.familySupport]}</strong></span>
                  </div>
                  <div className="metric-list-card">
                    <MetricBar compact label="Доступ к тренировкам" value={character.origin.trainingAccess} />
                    <MetricBar compact label="Доступ к медицине" value={character.origin.medicalAccess} />
                    <MetricBar compact label="Футбольная культура" value={character.origin.footballCulture} />
                  </div>
                </div>
              )}

              {profileView === "study" && (
                <div className="compact-view">
                  <section className="academic-card-compact">
                    <div><small>GPA</small><strong>{character.education.gpa.toFixed(2)}</strong></div>
                    <span>{character.education.eligibilityStatus.toUpperCase()}</span>
                  </section>
                  <div className="metric-list-card">
                    <MetricBar compact label="Академические способности" value={character.education.academicAbility} />
                    <MetricBar compact label="Посещаемость" value={character.education.attendance} />
                  </div>
                  <div className="compact-note"><Icon name="book" /><p>Учёба влияет на eligibility и список доступных колледжей. Высокий рейтинг не отменяет академические требования.</p></div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ScreenShell>
  );
}
