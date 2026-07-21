import { useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "../ui/Icon";
import { BottomSheet } from "../ui/BottomSheet";
import { SectionTabs } from "../ui/SectionTabs";
import { addGameDays, formatGameDate, formatWeekday } from "../../core/calendar/types";
import {
  getIntensityDescriptor,
  getWeeklyPlanTemplate,
  intensityDescriptors,
  weeklyPlanTemplates,
} from "../../core/life/planCatalog";
import { buildDaySchedule } from "../../core/life/schedule";
import type { ScheduleActivityType, TrainingIntensity, WeeklyPlanTemplateId } from "../../core/life/types";
import { getTrainingFocus, getTrainingFocusCatalog } from "../../sports/football/training/catalog";
import type { MedicalStatus, TrainingFocusId } from "../../sports/football/training/types";
import type { CareerSave } from "../../storage/saves/schema";

const activityIcons: Record<ScheduleActivityType, IconName> = {
  school: "book",
  football: "football",
  recovery: "pulse",
  study: "brain",
  personal: "user",
};

const trainingIcons: Record<TrainingFocusId, IconName> = {
  "position-craft": "target",
  "explosive-power": "bolt",
  "film-install": "brain",
  "recovery-reset": "pulse",
};

const weekdayLabels = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"] as const;
const views = [
  { id: "overview", label: "Сводка" },
  { id: "training", label: "Трен." },
  { id: "plan", label: "Режим" },
  { id: "schedule", label: "День" },
] as const;

type TodayView = (typeof views)[number]["id"];
type SheetId = "condition" | "result" | "training-result" | "medical" | null;

function signed(value: number, digits = 1): string {
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

function riskLabel(risk: "low" | "medium" | "high"): string {
  return { low: "Низкий риск", medium: "Средний риск", high: "Высокий риск" }[risk];
}

function medicalLabel(status: MedicalStatus): string {
  return {
    cleared: "Допущен",
    questionable: "Под вопросом",
    limited: "Ограничен",
    out: "Вне работы",
  }[status];
}

interface TodayDashboardProps {
  save: CareerSave;
  mutating: boolean;
  actionError?: string;
  onUpdatePlan(templateId: WeeklyPlanTemplateId, intensity: TrainingIntensity): Promise<void>;
  onUpdateTrainingPlan(focusId: TrainingFocusId, intensity: TrainingIntensity): Promise<void>;
  onAdvanceDay(): Promise<void>;
  onOpenMatch(): void;
}

export function TodayDashboard({
  save,
  mutating,
  actionError,
  onUpdatePlan,
  onUpdateTrainingPlan,
  onAdvanceDay,
  onOpenMatch,
}: TodayDashboardProps) {
  const { character, football, life } = save;
  const [view, setView] = useState<TodayView>("overview");
  const [sheet, setSheet] = useState<SheetId>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<WeeklyPlanTemplateId>(life.weeklyPlan.templateId);
  const [selectedIntensity, setSelectedIntensity] = useState<TrainingIntensity>(life.weeklyPlan.intensity);
  const [selectedTrainingFocus, setSelectedTrainingFocus] = useState<TrainingFocusId>(football.training.plan.focusId);
  const [selectedTrainingIntensity, setSelectedTrainingIntensity] = useState<TrainingIntensity>(football.training.plan.intensity);

  useEffect(() => {
    setSelectedTemplate(life.weeklyPlan.templateId);
    setSelectedIntensity(life.weeklyPlan.intensity);
  }, [life.weeklyPlan.intensity, life.weeklyPlan.templateId]);

  useEffect(() => {
    setSelectedTrainingFocus(football.training.plan.focusId);
    setSelectedTrainingIntensity(football.training.plan.intensity);
  }, [football.training.plan.focusId, football.training.plan.intensity]);

  const activeTemplate = getWeeklyPlanTemplate(selectedTemplate);
  const activeIntensity = getIntensityDescriptor(selectedIntensity);
  const trainingCatalog = getTrainingFocusCatalog(football.position);
  const activeTrainingFocus = getTrainingFocus(football.position, selectedTrainingFocus);
  const schedule = useMemo(
    () => buildDaySchedule(life.dayIndex, {
      ...life.weeklyPlan,
      templateId: selectedTemplate,
      intensity: selectedIntensity,
      focus: activeTemplate.focus,
    }),
    [activeTemplate.focus, life.dayIndex, life.weeklyPlan, selectedIntensity, selectedTemplate],
  );
  const weekStart = addGameDays(save.meta.currentDate, -life.dayIndex);
  const planChanged = selectedTemplate !== life.weeklyPlan.templateId || selectedIntensity !== life.weeklyPlan.intensity;
  const trainingPlanChanged = selectedTrainingFocus !== football.training.plan.focusId || selectedTrainingIntensity !== football.training.plan.intensity;
  const projectedLoad = Math.round((activeTemplate.focus.training * 0.58 + 25) * activeIntensity.loadMultiplier);
  const trainingLoad = Math.round(activeTrainingFocus.load * getIntensityDescriptor(selectedTrainingIntensity).loadMultiplier);
  const recoveryMargin = Math.round(activeTemplate.focus.recovery * 1.45 - projectedLoad * 0.42);
  const nextActivity = schedule[0];
  const body = football.training.body;
  const currentTrainingFocus = getTrainingFocus(football.position, football.training.plan.focusId);

  return (
    <div className="compact-section today-section">
      <header className="compact-page-head">
        <div>
          <span>{formatWeekday(save.meta.currentDate)} · неделя {life.weekNumber}</span>
          <h2>{formatGameDate(save.meta.currentDate)}</h2>
        </div>
        <button type="button" className={`medical-pill medical-pill--${body.medicalStatus}`} onClick={() => setSheet("medical")}>
          {medicalLabel(body.medicalStatus)} <Icon name="chevron-down" size={15} />
        </button>
      </header>

      <div className="mini-week" aria-label="Текущая игровая неделя">
        {weekdayLabels.map((label, index) => {
          const date = addGameDays(weekStart, index);
          const className = index < life.dayIndex ? "is-complete" : index === life.dayIndex ? "is-current" : "";
          return (
            <span className={className} key={label}>
              <small>{label}</small>
              <strong>{date.day}</strong>
            </span>
          );
        })}
      </div>

      <SectionTabs<TodayView> tabs={views} active={view} onChange={setView} ariaLabel="Разделы текущего дня" />

      {actionError && <div className="inline-message inline-message--error">{actionError}</div>}

      {view === "overview" && (
        <div className="compact-view">
          <div className="vital-row vital-row--body">
            <button type="button" onClick={() => setSheet("condition")}>
              <small>Энергия</small><strong>{Math.round(character.condition.energy)}</strong><i style={{ width: `${character.condition.energy}%` }} />
            </button>
            <button type="button" onClick={() => setSheet("medical")}>
              <small>Готовность</small><strong>{Math.round(body.readiness)}</strong><i style={{ width: `${body.readiness}%` }} />
            </button>
            <button type="button" onClick={() => setSheet("medical")}>
              <small>Риск</small><strong>{Math.round(body.injuryRisk)}</strong><i style={{ width: `${body.injuryRisk}%` }} />
            </button>
          </div>

          <button type="button" className="training-brief" onClick={() => setView("training")}>
            <span className="training-brief__icon"><Icon name={trainingIcons[currentTrainingFocus.id]} /></span>
            <div><small>Тренировочный акцент</small><strong>{currentTrainingFocus.name}</strong><p>{getIntensityDescriptor(football.training.plan.intensity).name} · готовность {Math.round(body.readiness)}</p></div>
            <Icon name="arrow-right" />
          </button>

          {body.activeIssue ? (
            <button type="button" className="medical-alert" onClick={() => setSheet("medical")}>
              <Icon name="pulse" />
              <div><small>Активное ограничение</small><strong>{body.activeIssue.diagnosis}</strong><span>{body.activeIssue.daysRemaining} дн. до оценки</span></div>
              <Icon name="arrow-right" />
            </button>
          ) : nextActivity ? (
            <button type="button" className="next-activity" onClick={() => setView("schedule")}>
              <span className={`next-activity__icon next-activity__icon--${nextActivity.type}`}><Icon name={activityIcons[nextActivity.type]} /></span>
              <div><small>Следующий блок · {nextActivity.time}</small><strong>{nextActivity.title}</strong><p>{nextActivity.location}</p></div>
              <Icon name="arrow-right" />
            </button>
          ) : null}

          {football.training.lastSession && (
            <button type="button" className="result-teaser" onClick={() => setSheet("training-result")}>
              <span className={`result-grade result-grade--${football.training.lastSession.grade.toLowerCase()}`}>{football.training.lastSession.grade}</span>
              <div><small>Последняя тренировка</small><strong>{football.training.lastSession.focusName}</strong></div>
              <Icon name="arrow-right" />
            </button>
          )}

          {life.dayIndex === 5 && football.match.status !== "complete" ? (
            <button type="button" className="primary-action-bar primary-action-bar--match" disabled={mutating} onClick={onOpenMatch}>
              <span><small>Суббота · {football.match.opponentName}</small><strong>Перейти к матчу</strong></span>
              <Icon name="arrow-right" />
            </button>
          ) : (
            <button type="button" className="primary-action-bar" disabled={mutating} onClick={() => void onAdvanceDay()}>
              <span><small>План и тренировка применятся автоматически</small><strong>{mutating ? "Расчёт дня…" : "Завершить день"}</strong></span>
              <Icon name="arrow-right" />
            </button>
          )}
        </div>
      )}

      {view === "training" && (
        <div className="compact-view training-view">
          <div className="training-body-strip">
            <button type="button" onClick={() => setSheet("medical")}><small>Готовность</small><strong>{Math.round(body.readiness)}</strong></button>
            <button type="button" onClick={() => setSheet("medical")}><small>Боль</small><strong>{Math.round(body.pain)}</strong></button>
            <button type="button" onClick={() => setSheet("medical")}><small>Риск</small><strong>{Math.round(body.injuryRisk)}</strong></button>
            <button type="button" onClick={() => setSheet("medical")}><small>Допуск</small><strong>{medicalLabel(body.medicalStatus)}</strong></button>
          </div>

          <div className="training-focus-list">
            {trainingCatalog.map((focus) => (
              <button
                type="button"
                className={selectedTrainingFocus === focus.id ? "is-active" : ""}
                onClick={() => setSelectedTrainingFocus(focus.id)}
                key={focus.id}
              >
                <span><Icon name={trainingIcons[focus.id]} /></span>
                <div><strong>{focus.name}</strong><small>{focus.summary}</small></div>
                <em>{focus.load}</em>
              </button>
            ))}
          </div>

          <section className="training-control-card">
            <header><div><small>Интенсивность</small><strong>Ожидаемая нагрузка {trainingLoad}</strong></div><span>{getIntensityDescriptor(selectedTrainingIntensity).loadMultiplier.toFixed(2)}×</span></header>
            <div className="compact-segmented">
              {intensityDescriptors.map((item) => (
                <button type="button" className={selectedTrainingIntensity === item.id ? "is-active" : ""} onClick={() => setSelectedTrainingIntensity(item.id)} key={item.id}>
                  {item.name}
                </button>
              ))}
            </div>
          </section>

          <button
            type="button"
            className="primary-action-bar"
            disabled={!trainingPlanChanged || mutating}
            onClick={() => void onUpdateTrainingPlan(selectedTrainingFocus, selectedTrainingIntensity)}
          >
            <span><small>{activeTrainingFocus.coachValue}</small><strong>{mutating ? "Сохранение…" : trainingPlanChanged ? "Применить тренировку" : "Тренировка активна"}</strong></span>
            <Icon name={trainingPlanChanged ? "arrow-right" : "check"} />
          </button>
        </div>
      )}

      {view === "plan" && (
        <div className="compact-view">
          <div className="plan-list-compact">
            {weeklyPlanTemplates.map((template) => (
              <button type="button" className={selectedTemplate === template.id ? "is-active" : ""} onClick={() => setSelectedTemplate(template.id)} key={template.id}>
                <span className="plan-list-compact__mark"><Icon name={selectedTemplate === template.id ? "check" : "target"} /></span>
                <div><strong>{template.shortName}</strong><small>{template.identity} · {riskLabel(template.risk)}</small></div>
                <em>{template.focus.training}</em>
              </button>
            ))}
          </div>

          <section className="compact-control-card">
            <header><div><small>Интенсивность недели</small><strong>{activeIntensity.description}</strong></div><span>{activeIntensity.loadMultiplier.toFixed(2)}×</span></header>
            <div className="compact-segmented">
              {intensityDescriptors.map((item) => (
                <button type="button" className={selectedIntensity === item.id ? "is-active" : ""} onClick={() => setSelectedIntensity(item.id)} key={item.id}>{item.name}</button>
              ))}
            </div>
          </section>

          <div className="compact-forecast">
            <span><small>Нагрузка</small><strong>{projectedLoad}</strong></span>
            <span><small>Запас</small><strong className={recoveryMargin < 0 ? "is-danger" : ""}>{recoveryMargin > 0 ? "+" : ""}{recoveryMargin}</strong></span>
            <span><small>Стабильность</small><strong>{Math.round(life.consistency)}</strong></span>
          </div>

          <button type="button" className="primary-action-bar" disabled={!planChanged || mutating} onClick={() => void onUpdatePlan(selectedTemplate, selectedIntensity)}>
            <span><small>{activeTemplate.name}</small><strong>{mutating ? "Сохранение…" : planChanged ? "Применить режим" : "Режим активен"}</strong></span>
            <Icon name={planChanged ? "arrow-right" : "check"} />
          </button>
        </div>
      )}

      {view === "schedule" && (
        <div className="compact-view">
          <div className="schedule-list-compact">
            {schedule.map((activity) => (
              <article key={activity.id}>
                <time>{activity.time}</time>
                <span className={`schedule-list-compact__icon schedule-list-compact__icon--${activity.type}`}><Icon name={activityIcons[activity.type]} size={17} /></span>
                <div><strong>{activity.title}</strong><small>{activity.location} · {activity.durationMinutes} мин</small></div>
                {activity.mandatory && <em>обяз.</em>}
              </article>
            ))}
          </div>
          <div className="schedule-summary">
            <span><small>Блоков</small><strong>{schedule.length}</strong></span>
            <span><small>Время</small><strong>{Math.round(schedule.reduce((total, item) => total + item.durationMinutes, 0) / 60)} ч</strong></span>
            <span><small>Фокус</small><strong>{currentTrainingFocus.shortName}</strong></span>
          </div>
          <button type="button" className="primary-action-bar" disabled={mutating} onClick={() => void onAdvanceDay()}>
            <span><small>После последнего блока</small><strong>{mutating ? "Расчёт дня…" : "Завершить день"}</strong></span>
            <Icon name="arrow-right" />
          </button>
        </div>
      )}

      <BottomSheet open={sheet === "condition"} title="Состояние спортсмена" eyebrow="Сегодня" onClose={() => setSheet(null)}>
        <div className="sheet-metric-list">
          <span><small>Энергия</small><strong>{Math.round(character.condition.energy)}</strong><i><b style={{ width: `${character.condition.energy}%` }} /></i></span>
          <span><small>Усталость</small><strong>{Math.round(character.condition.fatigue)}</strong><i><b style={{ width: `${character.condition.fatigue}%` }} /></i></span>
          <span><small>Стресс</small><strong>{Math.round(character.condition.stress)}</strong><i><b style={{ width: `${character.condition.stress}%` }} /></i></span>
          <span><small>Уверенность</small><strong>{Math.round(character.condition.confidence)}</strong><i><b style={{ width: `${character.condition.confidence}%` }} /></i></span>
          <span><small>Здоровье</small><strong>{Math.round(character.condition.health)}</strong><i><b style={{ width: `${character.condition.health}%` }} /></i></span>
        </div>
        <div className="sheet-fact-grid">
          <span><small>Сон</small><strong>{character.condition.sleepHours.toFixed(1)} ч</strong></span>
          <span><small>Доверие тренера</small><strong>{Math.round(football.depthChart.coachTrust)}</strong></span>
          <span><small>GPA</small><strong>{character.education.gpa.toFixed(2)}</strong></span>
          <span><small>Общий рейтинг</small><strong>{football.ratings.overall}</strong></span>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "medical"} title="Медицинский статус" eyebrow={medicalLabel(body.medicalStatus)} onClose={() => setSheet(null)}>
        <div className={`medical-status-card medical-status-card--${body.medicalStatus}`}>
          <Icon name="pulse" />
          <div><small>Решение штаба</small><strong>{body.restriction}</strong></div>
        </div>
        {body.activeIssue && (
          <div className="active-issue-card">
            <small>Активная проблема</small>
            <h3>{body.activeIssue.diagnosis}</h3>
            <p>{body.activeIssue.severity === "moderate" ? "Средняя тяжесть" : "Лёгкая проблема"} · {body.activeIssue.daysRemaining} дн. до повторной оценки · риск рецидива {Math.round(body.activeIssue.recurrenceRisk)}</p>
          </div>
        )}
        <div className="sheet-metric-list">
          <span><small>Готовность</small><strong>{Math.round(body.readiness)}</strong><i><b style={{ width: `${body.readiness}%` }} /></i></span>
          <span><small>Острая нагрузка</small><strong>{Math.round(body.acuteLoad)}</strong><i><b style={{ width: `${body.acuteLoad}%` }} /></i></span>
          <span><small>Накопленная нагрузка</small><strong>{Math.round(body.chronicLoad)}</strong><i><b style={{ width: `${body.chronicLoad}%` }} /></i></span>
          <span><small>Забитость</small><strong>{Math.round(body.soreness)}</strong><i><b style={{ width: `${body.soreness}%` }} /></i></span>
          <span><small>Боль</small><strong>{Math.round(body.pain)}</strong><i><b style={{ width: `${body.pain}%` }} /></i></span>
          <span><small>Риск травмы</small><strong>{Math.round(body.injuryRisk)}</strong><i><b style={{ width: `${body.injuryRisk}%` }} /></i></span>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "training-result" && Boolean(football.training.lastSession)} title={football.training.lastSession?.focusName ?? "Тренировка"} eyebrow="Последняя сессия" onClose={() => setSheet(null)}>
        {football.training.lastSession && (
          <div className="sheet-result">
            <div className={`sheet-result__grade result-grade--${football.training.lastSession.grade.toLowerCase()}`}>{football.training.lastSession.grade}</div>
            <p>{football.training.lastSession.note}</p>
            <div className="sheet-deltas">
              <span><small>Техника</small><strong>{signed(football.training.lastSession.gains.technique, 2)}</strong></span>
              <span><small>Атлетизм</small><strong>{signed(football.training.lastSession.gains.athleticism, 2)}</strong></span>
              <span><small>Football IQ</small><strong>{signed(football.training.lastSession.gains.footballIq, 2)}</strong></span>
              <span><small>Забитость</small><strong>{signed(football.training.lastSession.sorenessDelta)}</strong></span>
            </div>
            <div className="sheet-fact-grid">
              <span><small>Нагрузка</small><strong>{Math.round(football.training.lastSession.load)}</strong></span>
              <span><small>Готовность после</small><strong>{Math.round(football.training.lastSession.readinessAfter)}</strong></span>
              <span><small>Риск после</small><strong>{Math.round(football.training.lastSession.riskAfter)}</strong></span>
              <span><small>Интенсивность</small><strong>{getIntensityDescriptor(football.training.lastSession.intensity).name}</strong></span>
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={sheet === "result" && Boolean(life.lastOutcome)} title={life.lastOutcome?.title ?? "Итог дня"} eyebrow="Последний завершённый день" onClose={() => setSheet(null)}>
        {life.lastOutcome && (
          <div className="sheet-result">
            <div className={`sheet-result__grade result-grade--${life.lastOutcome.grade.toLowerCase()}`}>{life.lastOutcome.grade}</div>
            <p>{life.lastOutcome.summary}</p>
            <div className="sheet-highlights">
              {life.lastOutcome.highlights.map((highlight) => <span key={highlight}><i />{highlight}</span>)}
            </div>
            <div className="sheet-deltas">
              <span><small>Энергия</small><strong>{signed(life.lastOutcome.deltas.energy)}</strong></span>
              <span><small>Усталость</small><strong>{signed(life.lastOutcome.deltas.fatigue)}</strong></span>
              <span><small>Доверие</small><strong>{signed(life.lastOutcome.deltas.coachTrust)}</strong></span>
              <span><small>OVR</small><strong>{signed(life.lastOutcome.deltas.overall, 2)}</strong></span>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
