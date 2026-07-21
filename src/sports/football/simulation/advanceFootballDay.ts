import { advanceLifeDay } from "../../../core/life/advanceLifeDay";
import { getWeeklyPlanTemplate } from "../../../core/life/planCatalog";
import type { TrainingIntensity, WeeklyPlanTemplateId } from "../../../core/life/types";
import type { CareerSave } from "../../../storage/saves/schema";
import { evaluateDepthChart } from "../team/evaluateDepthChart";
import { getTrainingFocus } from "../training/catalog";
import { resolveTrainingDay } from "../training/resolveTrainingDay";
import type { TrainingFocusId } from "../training/types";
import { createInitialMatchState, createNextOpponent } from "../matches/createMatchState";

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value * 10) / 10));
}

function round(value: number, digits = 1): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function calculateOverall(ratings: CareerSave["football"]["ratings"]): number {
  return clamp(
    ratings.athleticism * 0.34 +
      ratings.technique * 0.31 +
      ratings.footballIq * 0.2 +
      ratings.competitiveness * 0.15,
    45,
    99,
  );
}

export function updateWeeklyPlan(
  save: CareerSave,
  templateId: WeeklyPlanTemplateId,
  intensity: TrainingIntensity,
): CareerSave {
  const template = getWeeklyPlanTemplate(templateId);
  return {
    ...save,
    life: {
      ...save.life,
      weeklyPlan: {
        templateId,
        intensity,
        focus: { ...template.focus },
        revision: save.life.weeklyPlan.revision + 1,
      },
    },
    history: [
      ...save.history,
      {
        id: `plan-${save.meta.id}-${save.life.weeklyPlan.revision + 1}`,
        occurredAt: save.meta.updatedAt,
        type: "weekly-plan-updated",
        title: `План недели: ${template.name}`,
        description: `${template.description} Интенсивность: ${intensity}.`,
      },
    ],
  };
}

export function updateTrainingPlan(
  save: CareerSave,
  focusId: TrainingFocusId,
  intensity: TrainingIntensity,
): CareerSave {
  const focus = getTrainingFocus(save.football.position, focusId);
  return {
    ...save,
    football: {
      ...save.football,
      training: {
        ...save.football.training,
        plan: {
          focusId,
          intensity,
          revision: save.football.training.plan.revision + 1,
        },
      },
    },
    history: [
      ...save.history,
      {
        id: `training-plan-${save.meta.id}-${save.football.training.plan.revision + 1}`,
        occurredAt: save.meta.updatedAt,
        type: "training-plan-updated",
        title: `Тренировочный акцент: ${focus.name}`,
        description: `${focus.summary} Интенсивность: ${intensity}. План действует до следующего изменения.`,
      },
    ],
  };
}

export function advanceFootballCareerDay(save: CareerSave): CareerSave {
  const result = advanceLifeDay(save.character, save.life, save.meta.currentDate, save.meta.worldSeed);
  const weekday = save.life.dayIndex;
  const practiceFactor = [0.9, 1, 1.15, 1.05, 0.72, 0.95, 0.2][weekday] ?? 1;
  const trainingResolution = resolveTrainingDay(
    save.football,
    result.character,
    result.effects,
    save.meta.currentDate,
    save.meta.worldSeed,
    practiceFactor,
  );

  const previousOverall = save.football.ratings.overall;
  const nextRatings = {
    ...trainingResolution.ratings,
    overall: calculateOverall(trainingResolution.ratings),
  };
  const overallDelta = round(nextRatings.overall - previousOverall, 2);
  const baseTrustDelta = round(
    (result.effects.trainingQuality - 55) * 0.018 +
      (result.character.education.attendance - 85) * 0.008 -
      Math.max(0, result.character.condition.fatigue - 78) * 0.025,
    1,
  );
  const coachTrustDelta = round(baseTrustDelta + trainingResolution.coachTrustDelta, 1);
  const nextCoachTrust = clamp(save.football.depthChart.coachTrust + coachTrustDelta);

  const nextOutcome = {
    ...result.outcome,
    highlights: [
      ...result.outcome.highlights,
      `${trainingResolution.session.focusName}: ${trainingResolution.session.grade}, нагрузка ${Math.round(trainingResolution.session.load)}.`,
      ...(trainingResolution.session.issueOccurred
        ? [`Медицинский штаб зафиксировал: ${trainingResolution.session.issueOccurred}.`]
        : []),
    ],
    deltas: {
      ...result.outcome.deltas,
      coachTrust: coachTrustDelta,
      overall: overallDelta,
    },
  };

  const teamMoraleDelta = result.outcome.grade === "A" ? 0.5 : result.outcome.grade === "D" ? -0.7 : 0;
  const provisionalFootball: CareerSave["football"] = {
    ...save.football,
    ratings: nextRatings,
    training: trainingResolution.training,
    teamDynamics: {
      ...save.football.teamDynamics,
      morale: clamp(save.football.teamDynamics.morale + teamMoraleDelta),
      schemeMastery: clamp(
        save.football.teamDynamics.schemeMastery + trainingResolution.session.gains.footballIq * 0.42,
      ),
    },
    depthChart: {
      ...save.football.depthChart,
      coachTrust: nextCoachTrust,
    },
    season: {
      ...save.football.season,
      week: Math.max(0, result.life.weekNumber - 1),
    },
  };
  const depthUpdate = evaluateDepthChart(provisionalFootball, trainingResolution.character, result.nextDate);
  const depthChanged = depthUpdate.rank !== save.football.depthChart.rank;
  let nextFootball: CareerSave["football"] = {
    ...provisionalFootball,
    depthChart: {
      ...provisionalFootball.depthChart,
      ...depthUpdate,
    },
  };

  if (result.life.dayIndex === 0 && save.football.match.status === "complete") {
    const nextOpponent = createNextOpponent(save.meta.worldSeed, result.life.weekNumber);
    const nextSeason = { ...nextFootball.season, nextOpponent };
    nextFootball = {
      ...nextFootball,
      season: nextSeason,
      match: createInitialMatchState(
        save.meta.worldSeed,
        save.football.position,
        nextSeason,
        result.nextDate,
        result.life.dayIndex,
        result.life.weekNumber,
      ),
    };
  }

  return {
    ...save,
    meta: {
      ...save.meta,
      currentDate: result.nextDate,
    },
    character: trainingResolution.character,
    life: {
      ...result.life,
      lastOutcome: nextOutcome,
    },
    football: nextFootball,
    history: [
      ...save.history,
      {
        id: nextOutcome.id,
        occurredAt: save.meta.updatedAt,
        type: "day-completed",
        title: nextOutcome.title,
        description: nextOutcome.summary,
      },
      {
        id: trainingResolution.session.id,
        occurredAt: save.meta.updatedAt,
        type: "training-session-completed",
        title: `${trainingResolution.session.focusName}: ${trainingResolution.session.grade}`,
        description: trainingResolution.session.note,
      },
      ...(trainingResolution.session.issueOccurred
        ? [
            {
              id: `medical-${trainingResolution.session.id}`,
              occurredAt: save.meta.updatedAt,
              type: "health-issue",
              title: "Медицинский статус изменён",
              description: `${trainingResolution.session.issueOccurred}. ${trainingResolution.training.body.restriction}`,
            },
          ]
        : []),
      ...(depthChanged
        ? [
            {
              id: `depth-${save.meta.id}-${result.life.completedDays}`,
              occurredAt: save.meta.updatedAt,
              type: "depth-chart-changed",
              title: depthUpdate.lastDecision.title,
              description: depthUpdate.lastDecision.description,
            },
          ]
        : []),
    ],
  };
}
