import { describe, expect, it } from "vitest";
import { createInitialLifeState } from "../../../core/life/createInitialLifeState";
import { createFootballCareerState } from "../career/createFootballCareer";
import type { FootballCareerSetup } from "../career/types";
import { careerSaveSchema, type CareerSave } from "../../../storage/saves/schema";
import { resolveMatchDecision, startMatch } from "./simulateMatch";

function makeSave(position: "WR" | "LB" | "CB" = "WR"): CareerSave {
  const archetypeId = position === "WR" ? "route-technician" : position === "LB" ? "run-stopper" : "press-corner";
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
    position,
    archetypeId,
    jerseyNumber: position === "WR" ? 1 : 7,
  };
  const generated = createFootballCareerState(`match-${position}`, setup);
  const life = createInitialLifeState();
  life.dayIndex = 5;
  return {
    meta: {
      id: `career-${position}`,
      schemaVersion: 6,
      sport: "american-football",
      worldSeed: `match-${position}`,
      createdAt: "2026-07-21T10:00:00.000Z",
      updatedAt: "2026-07-21T10:00:00.000Z",
      currentDate: { year: 2026, month: 8, day: 22 },
      phase: "high-school-preseason",
      revision: 1,
    },
    ...generated,
    life,
    history: [],
  };
}

function finish(save: CareerSave): CareerSave {
  let current = startMatch(save);
  while (current.football.match.status === "in-progress") {
    const optionId = current.football.match.currentEpisode?.options[1]?.id;
    if (!optionId) throw new Error("No match option");
    current = resolveMatchDecision(current, optionId);
  }
  return current;
}

describe("football match simulation", () => {
  it("creates offensive decisions for a wide receiver", () => {
    const started = startMatch(makeSave("WR"));
    expect(started.football.match.heroUnit).toBe("offense");
    expect(started.football.match.currentEpisode?.position).toBe("WR");
    expect(started.football.match.currentEpisode?.options).toHaveLength(3);
  });

  it("creates playable defensive decisions for linebackers and cornerbacks", () => {
    for (const position of ["LB", "CB"] as const) {
      const started = startMatch(makeSave(position));
      expect(started.football.match.heroUnit).toBe("defense");
      expect(started.football.match.currentEpisode?.unit).toBe("defense");
      expect(started.football.match.currentEpisode?.options.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("is deterministic for the same state and decision", () => {
    const started = startMatch(makeSave("WR"));
    const optionId = started.football.match.currentEpisode?.options[0]?.id;
    if (!optionId) throw new Error("No match option");
    expect(resolveMatchDecision(started, optionId)).toEqual(resolveMatchDecision(started, optionId));
  });

  it("completes six episodes and updates the season record", () => {
    const completed = finish(makeSave("LB"));
    expect(completed.football.match.status).toBe("complete");
    expect(completed.football.match.completedEpisodes).toHaveLength(6);
    expect(completed.football.season.wins + completed.football.season.losses).toBe(1);
    expect(completed.football.match.finalResult?.spotlight.length).toBeGreaterThan(5);
    expect(() => careerSaveSchema.parse(completed)).not.toThrow();
  });
});
