import { describe, expect, it } from "vitest";
import { createInitialLifeState } from "../../../core/life/createInitialLifeState";
import { createFootballCareerState } from "../career/createFootballCareer";
import type { FootballCareerSetup } from "../career/types";
import { advanceFootballCareerDay, updateWeeklyPlan } from "./advanceFootballDay";
import type { CareerSave } from "../../../storage/saves/schema";

const setup: FootballCareerSetup = {
  character: {
    firstName: "Jalen",
    lastName: "Cole",
    birthDate: "2008-08-17",
    gender: "male",
    handedness: "right",
    originId: "houston",
    familyIncome: "working",
    familyStructure: "two-parent",
    familySupport: "supportive",
    mindset: "composed",
  },
  position: "WR",
  archetypeId: "route-technician",
  jerseyNumber: 1,
};

function makeSave(): CareerSave {
  const generated = createFootballCareerState("simulation-seed", setup);
  return {
    meta: {
      id: "career",
      schemaVersion: 6,
      sport: "american-football",
      worldSeed: "simulation-seed",
      createdAt: "2026-07-21T10:00:00.000Z",
      updatedAt: "2026-07-21T10:00:00.000Z",
      currentDate: { year: 2026, month: 8, day: 17 },
      phase: "high-school-preseason",
      revision: 1,
    },
    ...generated,
    life: createInitialLifeState(),
    history: [],
  };
}

describe("football day simulation", () => {
  it("changes the plan without advancing time", () => {
    const save = makeSave();
    const updated = updateWeeklyPlan(save, "breakout", "aggressive");
    expect(updated.life.weeklyPlan.templateId).toBe("breakout");
    expect(updated.meta.currentDate).toEqual(save.meta.currentDate);
  });

  it("advances a day and updates football development", () => {
    const save = makeSave();
    const advanced = advanceFootballCareerDay(save);
    expect(advanced.meta.currentDate).toEqual({ year: 2026, month: 8, day: 18 });
    expect(advanced.life.completedDays).toBe(1);
    expect(advanced.football.ratings.technique).toBeGreaterThanOrEqual(save.football.ratings.technique);
    expect(advanced.history.some((entry) => entry.type === "day-completed")).toBe(true);
    expect(advanced.football.training.lastSession?.date).toEqual(save.meta.currentDate);
  });
});
