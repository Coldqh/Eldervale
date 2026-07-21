import { describe, expect, it } from "vitest";
import { createFootballCareerState, createLegacyFootballSetup } from "../../sports/football/career/createFootballCareer";
import { migrateCareerSave } from "./migrations";

const legacySave = {
  meta: {
    id: "legacy-career",
    schemaVersion: 1,
    sport: "american-football",
    worldSeed: "football-legacy-seed",
    createdAt: "2026-07-21T10:00:00.000Z",
    updatedAt: "2026-07-21T10:00:00.000Z",
    currentDate: { year: 2026, month: 8, day: 17 },
    phase: "foundation",
    revision: 1,
  },
  football: {
    moduleVersion: 1,
    worldSeed: "football-legacy-seed",
    stage: "foundation",
  },
  history: [
    {
      id: "history-1",
      occurredAt: "2026-07-21T10:00:00.000Z",
      type: "career-created",
      title: "Карьера создана",
      description: "Технический фундамент.",
    },
  ],
};

describe("migrateCareerSave", () => {
  it("migrates foundation saves through player creation into the weekly loop schema", () => {
    const result = migrateCareerSave(legacySave);
    expect(result.migratedFrom).toBe(1);
    expect(result.save.meta.schemaVersion).toBe(6);
    expect(result.save.meta.phase).toBe("high-school-preseason");
    expect(result.save.character.identity.fullName.length).toBeGreaterThan(3);
    expect(result.save.football.stage).toBe("high-school-preseason");
    expect(result.save.life.weekNumber).toBe(1);
    expect(result.save.football.roster.length).toBeGreaterThan(40);
    expect(result.save.football.staff.headCoach.name.length).toBeGreaterThan(3);
    expect(result.save.life.weeklyPlan.templateId).toBe("balanced");
    expect(result.save.history.at(-1)?.type).toBe("save-migrated");
  });

  it("migrates version two saves without regenerating the athlete", () => {
    const generated = createFootballCareerState("football-v2-seed", createLegacyFootballSetup("football-v2-seed"));
    const versionTwo = {
      meta: {
        id: "v2-career",
        schemaVersion: 2,
        sport: "american-football",
        worldSeed: "football-v2-seed",
        createdAt: "2026-07-21T10:00:00.000Z",
        updatedAt: "2026-07-21T10:00:00.000Z",
        currentDate: { year: 2026, month: 8, day: 17 },
        phase: "high-school-preseason",
        revision: 2,
      },
      ...generated,
      history: [],
    };
    const result = migrateCareerSave(versionTwo);
    expect(result.migratedFrom).toBe(2);
    expect(result.save.character).toEqual(generated.character);
    expect(result.save.life.completedDays).toBe(0);
  });

  it("migrates version three saves into the generated team world", () => {
    const generated = createFootballCareerState("football-v3-seed", createLegacyFootballSetup("football-v3-seed"));
    const { staff: _staff, roster: _roster, teamDynamics: _teamDynamics, training: _training, ...footballWithoutTeam } = generated.football;
    const { evaluation: _evaluation, lastDecision: _lastDecision, ...legacyDepthChart } = footballWithoutTeam.depthChart;
    const versionThree = {
      meta: {
        id: "v3-career",
        schemaVersion: 3,
        sport: "american-football",
        worldSeed: "football-v3-seed",
        createdAt: "2026-07-21T10:00:00.000Z",
        updatedAt: "2026-07-21T10:00:00.000Z",
        currentDate: { year: 2026, month: 8, day: 17 },
        phase: "high-school-preseason",
        revision: 3,
      },
      character: generated.character,
      life: {
        moduleVersion: 1,
        weekNumber: 1,
        dayIndex: 0,
        completedDays: 0,
        weeklyPlan: {
          templateId: "balanced",
          intensity: "standard",
          focus: { training: 34, recovery: 25, study: 25, social: 16 },
          revision: 1,
        },
        consistency: 58,
      },
      football: { ...footballWithoutTeam, moduleVersion: 2, depthChart: legacyDepthChart },
      history: [],
    };
    const result = migrateCareerSave(versionThree);
    expect(result.migratedFrom).toBe(3);
    expect(result.save.meta.schemaVersion).toBe(6);
    expect(result.save.football.roster.length).toBeGreaterThan(40);
    expect(result.save.football.school.primaryColor).toBe("#d7192d");
    expect(result.save.football.training.body.medicalStatus).toBe("cleared");
  });


  it("migrates version four saves into the training and health schema", () => {
    const generated = createFootballCareerState("football-v4-seed", createLegacyFootballSetup("football-v4-seed"));
    const { training: _training, ...legacyFootball } = generated.football;
    const versionFour = {
      meta: {
        id: "v4-career",
        schemaVersion: 4,
        sport: "american-football",
        worldSeed: "football-v4-seed",
        createdAt: "2026-07-21T10:00:00.000Z",
        updatedAt: "2026-07-21T10:00:00.000Z",
        currentDate: { year: 2026, month: 8, day: 17 },
        phase: "high-school-preseason",
        revision: 4,
      },
      character: generated.character,
      life: {
        moduleVersion: 1,
        weekNumber: 1,
        dayIndex: 0,
        completedDays: 0,
        weeklyPlan: {
          templateId: "balanced",
          intensity: "standard",
          focus: { training: 34, recovery: 25, study: 25, social: 16 },
          revision: 1,
        },
        consistency: 58,
      },
      football: { ...legacyFootball, moduleVersion: 3 },
      history: [],
    };
    const result = migrateCareerSave(versionFour);
    expect(result.migratedFrom).toBe(4);
    expect(result.save.meta.schemaVersion).toBe(6);
    expect(result.save.football.moduleVersion).toBe(5);
    expect(result.save.football.training.plan.focusId).toBe("position-craft");
    expect(result.save.football.match.status).toBe("upcoming");
  });

  it("migrates version five saves into the match schema", () => {
    const generated = createFootballCareerState("football-v5-seed", createLegacyFootballSetup("football-v5-seed"));
    const { match: _match, ...legacyFootball } = generated.football;
    const versionFive = {
      meta: {
        id: "v5-career",
        schemaVersion: 5,
        sport: "american-football",
        worldSeed: "football-v5-seed",
        createdAt: "2026-07-21T10:00:00.000Z",
        updatedAt: "2026-07-21T10:00:00.000Z",
        currentDate: { year: 2026, month: 8, day: 20 },
        phase: "high-school-preseason",
        revision: 5,
      },
      character: generated.character,
      life: {
        moduleVersion: 1,
        weekNumber: 1,
        dayIndex: 3,
        completedDays: 3,
        weeklyPlan: {
          templateId: "balanced",
          intensity: "standard",
          focus: { training: 34, recovery: 25, study: 25, social: 16 },
          revision: 1,
        },
        consistency: 58,
      },
      football: { ...legacyFootball, moduleVersion: 4 },
      history: [],
    };
    const result = migrateCareerSave(versionFive);
    expect(result.migratedFrom).toBe(5);
    expect(result.save.meta.schemaVersion).toBe(6);
    expect(result.save.football.match.status).toBe("upcoming");
    expect(result.save.football.match.heroUnit).toMatch(/offense|defense/);
  });

  it("produces the same migrated athlete for the same seed", () => {
    expect(migrateCareerSave(legacySave).save.character).toEqual(migrateCareerSave(legacySave).save.character);
  });
});
