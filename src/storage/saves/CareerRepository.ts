import type { FootballCareerSetup } from "../../sports/football/career/types";
import {
  advanceFootballCareerDay,
  updateTrainingPlan as applyTrainingPlan,
  updateWeeklyPlan as applyWeeklyPlan,
} from "../../sports/football/simulation/advanceFootballDay";
import { createSeed } from "../../core/random/createSeed";
import { createInitialLifeState } from "../../core/life/createInitialLifeState";
import type { TrainingIntensity, WeeklyPlanTemplateId } from "../../core/life/types";
import type { TrainingFocusId } from "../../sports/football/training/types";
import { resolveMatchDecision, startMatch } from "../../sports/football/matches/simulateMatch";
import { loadSportModule } from "../../core/sports/sportRegistry";
import { createChecksum } from "./checksum";
import { migrateCareerSave } from "./migrations";
import {
  CURRENT_SCHEMA_VERSION,
  type CareerIndexRecord,
  type CareerSave,
} from "./schema";
import { getDatabase, type SnapshotRecord } from "../indexedDb/database";

const MAX_AUTOSAVE_BACKUPS = 5;

function snapshotId(careerId: string, revision: number): string {
  return `${careerId}:${revision.toString().padStart(8, "0")}`;
}

function toIndexRecord(save: CareerSave): CareerIndexRecord {
  return {
    id: save.meta.id,
    displayName: save.character.identity.fullName,
    sport: save.meta.sport,
    phase: save.meta.phase,
    currentDate: `${save.meta.currentDate.year}-${String(save.meta.currentDate.month).padStart(2, "0")}-${String(save.meta.currentDate.day).padStart(2, "0")}`,
    updatedAt: save.meta.updatedAt,
    revision: save.meta.revision,
    position: save.football.position,
    jerseyNumber: save.football.jerseyNumber,
    schoolName: save.football.school.name,
    stateCode: save.character.origin.stateCode,
    overall: save.football.ratings.overall,
    potentialBand: save.football.ratings.potentialBand,
  };
}

function toSnapshot(save: CareerSave): SnapshotRecord {
  return {
    id: snapshotId(save.meta.id, save.meta.revision),
    careerId: save.meta.id,
    revision: save.meta.revision,
    schemaVersion: save.meta.schemaVersion,
    checksum: createChecksum(save),
    createdAt: save.meta.updatedAt,
    state: save,
  };
}

async function pruneBackups(careerId: string): Promise<void> {
  const database = await getDatabase();
  const records = await database.getAllFromIndex("autosaveBackups", "by-careerId", careerId);
  records.sort((left, right) => right.revision - left.revision);

  const obsolete = records.slice(MAX_AUTOSAVE_BACKUPS);
  const transaction = database.transaction("autosaveBackups", "readwrite");
  await Promise.all(obsolete.map((record) => transaction.store.delete(record.id)));
  await transaction.done;
}

export class CareerRepository {
  async list(): Promise<CareerIndexRecord[]> {
    const database = await getDatabase();
    const records = await database.getAll("careerIndex");
    const normalized: CareerIndexRecord[] = [];

    for (const record of records) {
      if ("position" in record && typeof record.position === "string") {
        normalized.push(record);
        continue;
      }

      const migrated = await this.load(record.id);
      normalized.push(toIndexRecord(migrated));
    }

    return normalized.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async createFootballCareer(setup: FootballCareerSetup): Promise<CareerSave> {
    const careerId = crypto.randomUUID();
    const worldSeed = createSeed("football");
    const now = new Date().toISOString();
    const footballModule = await loadSportModule("american-football");
    const generated = footballModule.createInitialState(worldSeed, setup) as Pick<CareerSave, "character" | "football">;

    const save: CareerSave = {
      meta: {
        id: careerId,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        sport: "american-football",
        worldSeed,
        createdAt: now,
        updatedAt: now,
        currentDate: { year: 2026, month: 8, day: 17 },
        phase: "high-school-preseason",
        revision: 0,
      },
      character: generated.character,
      life: createInitialLifeState(),
      football: generated.football,
      history: [
        {
          id: crypto.randomUUID(),
          occurredAt: now,
          type: "career-created",
          title: "Первый день",
          description: `${generated.character.identity.fullName} начинает последний школьный сезон в ${generated.football.school.name}.`,
        },
      ],
    };

    return this.save(save);
  }


  async updateWeeklyPlan(
    careerId: string,
    templateId: WeeklyPlanTemplateId,
    intensity: TrainingIntensity,
  ): Promise<CareerSave> {
    const current = await this.load(careerId);
    return this.save(applyWeeklyPlan(current, templateId, intensity));
  }


  async updateTrainingPlan(
    careerId: string,
    focusId: TrainingFocusId,
    intensity: TrainingIntensity,
  ): Promise<CareerSave> {
    const current = await this.load(careerId);
    return this.save(applyTrainingPlan(current, focusId, intensity));
  }


  async startMatch(careerId: string): Promise<CareerSave> {
    const current = await this.load(careerId);
    if (current.life.dayIndex !== 5) throw new Error("Match is only available on Saturday");
    return this.save(startMatch(current));
  }

  async resolveMatchDecision(careerId: string, optionId: string): Promise<CareerSave> {
    const current = await this.load(careerId);
    return this.save(resolveMatchDecision(current, optionId));
  }

  async advanceDay(careerId: string): Promise<CareerSave> {
    const current = await this.load(careerId);
    if (current.life.dayIndex === 5 && current.football.match.status !== "complete") {
      throw new Error("Match must be completed before advancing Saturday");
    }
    return this.save(advanceFootballCareerDay(current));
  }

  async save(input: CareerSave): Promise<CareerSave> {
    const now = new Date().toISOString();
    const save: CareerSave = {
      ...input,
      meta: {
        ...input.meta,
        updatedAt: now,
        revision: input.meta.revision + 1,
      },
    };

    const validated = careerSaveSchemaSafeParse(save);
    const database = await getDatabase();
    const snapshot = toSnapshot(validated);
    const previous = await this.readLatestSnapshot(validated.meta.id);
    const transaction = database.transaction(
      ["careerIndex", "careerSnapshots", "autosaveBackups"],
      "readwrite",
    );

    if (previous) {
      await transaction.objectStore("autosaveBackups").put(previous);
    }

    await transaction.objectStore("careerSnapshots").put(snapshot);
    await transaction.objectStore("careerIndex").put(toIndexRecord(validated));
    await transaction.done;
    await pruneBackups(validated.meta.id);

    return validated;
  }

  async load(careerId: string): Promise<CareerSave> {
    const latest = await this.readLatestSnapshot(careerId);

    if (latest && latest.checksum === createChecksum(latest.state)) {
      const migration = migrateCareerSave(latest.state);
      if (migration.migratedFrom !== undefined) {
        return this.save({ ...migration.save, meta: { ...migration.save.meta, revision: latest.revision } });
      }
      return migration.save;
    }

    const database = await getDatabase();
    const backups = await database.getAllFromIndex("autosaveBackups", "by-careerId", careerId);
    backups.sort((left, right) => right.revision - left.revision);

    for (const backup of backups) {
      if (backup.checksum !== createChecksum(backup.state)) {
        continue;
      }
      const migration = migrateCareerSave(backup.state);
      return migration.migratedFrom !== undefined ? this.save(migration.save) : migration.save;
    }

    throw new Error("Career save is missing or corrupted");
  }

  async remove(careerId: string): Promise<void> {
    const database = await getDatabase();
    const transaction = database.transaction(
      ["careerIndex", "careerSnapshots", "autosaveBackups", "manualSaves"],
      "readwrite",
    );

    await transaction.objectStore("careerIndex").delete(careerId);

    for (const storeName of ["careerSnapshots", "autosaveBackups", "manualSaves"] as const) {
      const store = transaction.objectStore(storeName);
      const records = await store.index("by-careerId").getAll(careerId);
      await Promise.all(records.map((record) => store.delete(record.id)));
    }

    await transaction.done;
  }

  async export(careerId: string): Promise<Blob> {
    const save = await this.load(careerId);
    return new Blob([JSON.stringify(save, null, 2)], { type: "application/json" });
  }

  async import(file: File): Promise<CareerSave> {
    const raw = JSON.parse(await file.text()) as unknown;
    const imported = migrateCareerSave(raw).save;
    const now = new Date().toISOString();
    const save: CareerSave = {
      ...imported,
      meta: {
        ...imported.meta,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        revision: 0,
      },
      history: [
        ...imported.history,
        {
          id: crypto.randomUUID(),
          occurredAt: now,
          type: "career-imported",
          title: "Карьера импортирована",
          description: "Импорт создан как отдельная карьера и не перезаписал исходное сохранение.",
        },
      ],
    };

    return this.save(save);
  }

  private async readLatestSnapshot(careerId: string): Promise<SnapshotRecord | undefined> {
    const database = await getDatabase();
    const records = await database.getAllFromIndex("careerSnapshots", "by-careerId", careerId);
    records.sort((left, right) => right.revision - left.revision);
    return records[0];
  }
}

function careerSaveSchemaSafeParse(save: CareerSave): CareerSave {
  return migrateCareerSave(save).save;
}

export const careerRepository = new CareerRepository();
