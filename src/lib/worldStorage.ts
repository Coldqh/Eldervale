import type { SimulationProgress, StorageProfile, WorldSlotMeta, WorldSnapshotMeta, WorldState } from '../types';
import { migrateWorld } from '../sim/migrateWorld';
import { APP_VERSION } from '../version';
import { reportWorldStorageFailure } from './storageDiagnostics';
import { legacySnapshotMetadata, shouldCreateSnapshot, snapshotMetadata } from './storageSnapshotMeta';

const DB_NAME = 'eldervale';
const DB_VERSION = 3;
const SLOT_STORE = 'slots';
const CORE_STORE = 'worldCore';
const RECORD_STORE = 'worldRecords';
const SNAPSHOT_STORE = 'snapshots';
const SNAPSHOT_META_STORE = 'snapshotMeta';
const PREFERENCE_STORE = 'preferences';
const LEGACY_STORE = 'worlds';
const ACTIVE_SLOT_KEY = 'active-slot';
const LEGACY_KEY = 'eldervale-world-v1';
const ACTIVE_SLOT_FALLBACK = 'eldervale-active-slot';
const SNAPSHOT_INTERVAL_YEARS = 25;
const SNAPSHOT_LIMIT = 4;
const TILE_CHUNK_SIZE = 256;
const ENTITY_CHUNK_SIZE = 160;
const MAX_LOCAL_RECOVERY_BYTES = 4 * 1024 * 1024;

const entityCollections = [
  'kingdoms', 'settlements', 'characters', 'relationships', 'dynasties', 'armies', 'battleRecords', 'militaryUnits', 'supplyWagons', 'armyCamps', 'armyCampStructures', 'armyLocalPositions', 'monsters', 'cemeteries', 'burials', 'animalPopulations',
  'ingredients', 'alchemyRecipes', 'artifacts', 'books', 'dungeons', 'wars', 'tradeRoutes', 'territoryHistory', 'buildings', 'households', 'establishments', 'fields', 'constructionProjects', 'items', 'productionRecipes', 'employments', 'shipments', 'travelingMerchants', 'marketTransactions', 'knowledgeFacts', 'memories', 'rumors', 'messages', 'settlementKnowledge', 'cultures', 'languages', 'religions', 'settlementCultures', 'settlementGovernments', 'districtCivicStates', 'civicPatrols', 'crimes', 'courtCases', 'fireIncidents', 'kingdomGovernments', 'nobleTitles', 'vassalContracts', 'courtOffices', 'courtFactions', 'royalOrders', 'stateCrises', 'diplomaticAgreements', 'socialObligations', 'healthConditions', 'pregnancies', 'epidemics', 'decisions', 'stateDeltas', 'events', 'localMapChanges',
] as const;

type EntityCollection = typeof entityCollections[number];

interface StoredRecord {
  key: string;
  slotId: string;
  collection: EntityCollection | 'tiles';
  order: number | string;
  fingerprint: string;
  byteSize?: number;
  data: unknown;
}

interface StoredCore {
  slotId: string;
  core: Omit<WorldState, EntityCollection | 'tiles'>;
}

interface StoredSnapshot extends WorldSnapshotMeta {
  world: WorldState;
}

const fingerprintCache = new Map<string, Map<string, string>>();
let activeSlotCache: string | undefined;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = event => {
      const db = request.result;
      const transaction = request.transaction;
      if (!transaction) return;
      if (!db.objectStoreNames.contains(SLOT_STORE)) db.createObjectStore(SLOT_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(CORE_STORE)) db.createObjectStore(CORE_STORE, { keyPath: 'slotId' });
      if (!db.objectStoreNames.contains(RECORD_STORE)) {
        const store = db.createObjectStore(RECORD_STORE, { keyPath: 'key' });
        store.createIndex('slotId', 'slotId', { unique: false });
      }
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        const store = db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
        store.createIndex('slotId', 'slotId', { unique: false });
      }
      let snapshotMetaStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(SNAPSHOT_META_STORE)) {
        snapshotMetaStore = db.createObjectStore(SNAPSHOT_META_STORE, { keyPath: 'id' });
        snapshotMetaStore.createIndex('slotId', 'slotId', { unique: false });
      } else snapshotMetaStore = transaction.objectStore(SNAPSHOT_META_STORE);
      if (!db.objectStoreNames.contains(PREFERENCE_STORE)) db.createObjectStore(PREFERENCE_STORE);

      if (event.oldVersion < 3 && db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        const cursorRequest = transaction.objectStore(SNAPSHOT_STORE).openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const snapshot = cursor.value as StoredSnapshot;
          snapshotMetaStore.put(snapshotMetadata(snapshot));
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Другая вкладка удерживает старую версию хранилища'));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Транзакция IndexedDB остановлена'));
  });
}

export async function listWorldSlots(): Promise<WorldSlotMeta[]> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    const transaction = db.transaction(SLOT_STORE, 'readonly');
    const slots = await requestValue(transaction.objectStore(SLOT_STORE).getAll() as IDBRequest<WorldSlotMeta[]>);
    await transactionDone(transaction);
    return slots.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    throw reportWorldStorageFailure('прочитать список миров', error);
  } finally {
    db?.close();
  }
}

export async function getActiveWorldSlotId(): Promise<string | undefined> {
  if (activeSlotCache) return activeSlotCache;
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    const transaction = db.transaction(PREFERENCE_STORE, 'readonly');
    const value = await requestValue(transaction.objectStore(PREFERENCE_STORE).get(ACTIVE_SLOT_KEY) as IDBRequest<string | undefined>);
    await transactionDone(transaction);
    activeSlotCache = value;
    return value;
  } catch {
    try { return localStorage.getItem(ACTIVE_SLOT_FALLBACK) ?? undefined; } catch { return undefined; }
  } finally {
    db?.close();
  }
}

export async function setActiveWorldSlot(slotId: string): Promise<void> {
  activeSlotCache = slotId;
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    const transaction = db.transaction(PREFERENCE_STORE, 'readwrite');
    transaction.objectStore(PREFERENCE_STORE).put(slotId, ACTIVE_SLOT_KEY);
    await transactionDone(transaction);
    try { localStorage.setItem(ACTIVE_SLOT_FALLBACK, slotId); } catch { /* Необязательно. */ }
  } catch {
    try { localStorage.setItem(ACTIVE_SLOT_FALLBACK, slotId); } catch { /* Браузер полностью запретил постоянное хранилище. */ }
  } finally {
    db?.close();
  }
}

export async function loadWorld(slotId?: string): Promise<WorldState | undefined> {
  try {
    const resolvedSlot = slotId ?? await getActiveWorldSlotId() ?? (await listWorldSlots())[0]?.id;
    if (resolvedSlot) {
      const loaded = await loadPartitionedWorld(resolvedSlot);
      if (loaded) {
        activeSlotCache = resolvedSlot;
        await setActiveWorldSlot(resolvedSlot);
        return loaded;
      }
    }
    const legacy = await loadLegacyIndexedWorld();
    if (legacy) {
      const created = await createWorldSlot(legacy, 'legacy-active');
      return created.world;
    }
  } catch {
    // Сообщение уже показано на границе операции. Ниже остаётся аварийное сохранение.
  }

  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return undefined;
    const world = migrateWorld(JSON.parse(legacy));
    await createWorldSlot(world, 'local-recovery');
    return world;
  } catch {
    return undefined;
  }
}

export async function loadWorldSlot(slotId: string): Promise<WorldState | undefined> {
  try {
    const world = await loadPartitionedWorld(slotId);
    if (world) await setActiveWorldSlot(slotId);
    return world;
  } catch (error) {
    throw reportWorldStorageFailure('прочитать мир', error);
  }
}

async function loadPartitionedWorld(slotId: string): Promise<WorldState | undefined> {
  const db = await openDatabase();
  try {
    const coreTransaction = db.transaction(CORE_STORE, 'readonly');
    const core = await requestValue(coreTransaction.objectStore(CORE_STORE).get(slotId) as IDBRequest<StoredCore | undefined>);
    await transactionDone(coreTransaction);
    if (!core) return undefined;

    const collections: Record<string, unknown[]> = Object.fromEntries(entityCollections.map(name => [name, []]));
    const tileChunks: { order: number; data: WorldState['tiles'] }[] = [];
    const fingerprints = new Map<string, string>();
    const transaction = db.transaction(RECORD_STORE, 'readonly');
    const index = transaction.objectStore(RECORD_STORE).index('slotId');
    await new Promise<void>((resolve, reject) => {
      const request = index.openCursor(IDBKeyRange.only(slotId));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        const record = cursor.value as StoredRecord;
        fingerprints.set(record.key, record.fingerprint);
        if (record.collection === 'tiles') tileChunks.push({ order: Number(record.order), data: record.data as WorldState['tiles'] });
        else if (Array.isArray(record.data)) collections[record.collection]!.push(...record.data);
        else collections[record.collection]!.push(record.data);
        cursor.continue();
      };
    });
    await transactionDone(transaction);

    const legacyCore = core.core as unknown as Record<string, unknown>;
    for (const name of entityCollections) {
      if (collections[name]!.length === 0 && Array.isArray(legacyCore[name])) collections[name] = legacyCore[name] as unknown[];
      collections[name]!.sort((a: any, b: any) => entityOrder(a) - entityOrder(b));
    }
    tileChunks.sort((a, b) => a.order - b.order);
    fingerprintCache.set(slotId, fingerprints);
    return migrateWorld({ ...core.core, tiles: tileChunks.flatMap(chunk => chunk.data), ...collections });
  } finally {
    db.close();
  }
}

export async function createWorldSlot(
  world: WorldState,
  preferredId?: string,
  options: { onProgress?: (progress: SimulationProgress) => void } = {},
): Promise<{ slotId: string; world: WorldState; profile: StorageProfile }> {
  let existing = new Set<string>();
  try { existing = new Set((await listWorldSlots()).map(slot => slot.id)); } catch { /* saveWorld попробует аварийное хранилище. */ }
  let slotId = sanitizeSlotId(preferredId || `${world.config.seed}-${Date.now()}`);
  let suffix = 2;
  while (existing.has(slotId)) slotId = `${sanitizeSlotId(preferredId || world.config.seed)}-${suffix++}`;
  activeSlotCache = slotId;
  const profile = await saveWorld(world, slotId, { onProgress: options.onProgress });
  await setActiveWorldSlot(slotId);
  return { slotId, world, profile };
}

export async function saveWorld(
  world: WorldState,
  slotId?: string,
  options: { forceSnapshot?: boolean; reason?: WorldSnapshotMeta['reason']; onProgress?: (progress: SimulationProgress) => void } = {},
): Promise<StorageProfile> {
  const startedAt = performance.now();
  const report = (phase: string, completed: number, total: number, detail?: string) => options.onProgress?.({
    operation: 'сохранение', phase, completed, total, percent: total ? completed / total * 100 : 0,
    elapsedMs: performance.now() - startedAt, detail,
  });
  report('Подготовка хранилища', 0, 100);
  const resolvedSlot = slotId ?? await getActiveWorldSlotId() ?? sanitizeSlotId(`${world.config.seed}-${Date.now()}`);
  activeSlotCache = resolvedSlot;
  const previousFingerprints = fingerprintCache.get(resolvedSlot) ?? await readStoredFingerprints(resolvedSlot);
  report('Сериализация изменяемых коллекций', 4, 100);
  const currentRecords = await partitionWorld(world, resolvedSlot, (done, total, collection) => {
    report(`Сериализация: ${collection}`, 4 + done / Math.max(1, total) * 61, 100, `${done.toLocaleString('ru-RU')} / ${total.toLocaleString('ru-RU')} частей`);
  });
  report('Сравнение с предыдущим сохранением', 66, 100);
  const currentFingerprints = new Map(currentRecords.map(record => [record.key, record.fingerprint]));
  const changed = currentRecords.filter(record => previousFingerprints.get(record.key) !== record.fingerprint);
  const deleted = [...previousFingerprints.keys()].filter(key => !currentFingerprints.has(key));
  const rebuildSlotRecords = deleted.length > 2_000 || previousFingerprints.size > Math.max(400, currentRecords.length * 4);
  const recordsToWrite = rebuildSlotRecords ? currentRecords : changed;
  let previousMeta: WorldSlotMeta | undefined;
  try { previousMeta = (await listWorldSlots()).find(slot => slot.id === resolvedSlot); } catch { /* Ошибка уже показана; запись попробует аварийный путь. */ }
  const automaticSnapshotDue = previousMeta?.lastSnapshotYear !== undefined && world.year - previousMeta.lastSnapshotYear >= SNAPSHOT_INTERVAL_YEARS;
  const core = extractCore(world);
  const bytesEstimated = currentRecords.reduce((sum, record) => sum + (record.byteSize ?? 0), 0) + new Blob([JSON.stringify(core)]).size;
  const snapshotDue = shouldCreateSnapshot({ force: Boolean(options.forceSnapshot), automaticDue: automaticSnapshotDue, bytesEstimated });
  const now = Date.now();
  const meta: WorldSlotMeta = {
    id: resolvedSlot, name: world.name, seed: world.config.seed, createdAt: previousMeta?.createdAt ?? now, updatedAt: now,
    year: world.year, month: world.month, schemaVersion: world.version, appVersion: APP_VERSION, sizeBytes: bytesEstimated,
    snapshotCount: previousMeta?.snapshotCount ?? 0, lastSnapshotYear: previousMeta?.lastSnapshotYear ?? world.year,
  };
  if (automaticSnapshotDue && !snapshotDue) {
    meta.lastSnapshotYear = world.year;
    console.warn(`[Eldervale storage] Автоматический снимок пропущен: мир занимает ${bytesEstimated.toLocaleString('ru-RU')} байт.`);
  }

  let db: IDBDatabase | undefined;
  try {
    report('Запись изменений в IndexedDB', 72, 100, rebuildSlotRecords
      ? `быстрая смена формата · ${recordsToWrite.length.toLocaleString('ru-RU')} частей`
      : `${recordsToWrite.length.toLocaleString('ru-RU')} изменённых частей · ${deleted.length.toLocaleString('ru-RU')} удалённых`);
    db = await openDatabase();
    const stores = [SLOT_STORE, CORE_STORE, RECORD_STORE, PREFERENCE_STORE, SNAPSHOT_STORE, SNAPSHOT_META_STORE];
    const transaction = db.transaction(stores, 'readwrite');
    const coreStore = transaction.objectStore(CORE_STORE);
    const recordStore = transaction.objectStore(RECORD_STORE);
    const slotStore = transaction.objectStore(SLOT_STORE);
    const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
    const snapshotMetaStore = transaction.objectStore(SNAPSHOT_META_STORE);
    coreStore.put({ slotId: resolvedSlot, core } satisfies StoredCore);
    if (rebuildSlotRecords) recordStore.delete(IDBKeyRange.bound(`${resolvedSlot}:`, `${resolvedSlot}:\uffff`));
    for (const record of recordsToWrite) recordStore.put(record);
    if (!rebuildSlotRecords) for (const key of deleted) recordStore.delete(key);
    transaction.objectStore(PREFERENCE_STORE).put(resolvedSlot, ACTIVE_SLOT_KEY);

    let snapshotCreated = false;
    if (snapshotDue) {
      const snapshot: StoredSnapshot = {
        id: `${resolvedSlot}:${world.year}:${world.month}:${now}`, slotId: resolvedSlot, year: world.year, month: world.month,
        createdAt: now, reason: options.reason ?? 'автоматический', sizeBytes: bytesEstimated, world,
      };
      snapshotStore.put(snapshot);
      snapshotMetaStore.put(snapshotMetadata(snapshot));
      meta.snapshotCount += 1;
      meta.lastSnapshotYear = world.year;
      snapshotCreated = true;
    }
    slotStore.put(meta);
    await transactionDone(transaction);
    report('Завершение транзакции', 94, 100);
    fingerprintCache.set(resolvedSlot, currentFingerprints);
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* Необязательно. */ }
    try { localStorage.setItem(ACTIVE_SLOT_FALLBACK, resolvedSlot); } catch { /* Необязательно. */ }
    if (snapshotCreated) await trimSnapshots(resolvedSlot);
    report('Мир сохранён', 100, 100, `${recordsToWrite.length.toLocaleString('ru-RU')} частей записано`);
    return {
      slotId: resolvedSlot, writtenRecords: recordsToWrite.length + 2 + (snapshotCreated ? 2 : 0), skippedRecords: rebuildSlotRecords ? 0 : currentRecords.length - changed.length,
      deletedRecords: rebuildSlotRecords ? previousFingerprints.size : deleted.length, bytesEstimated, snapshotCreated, totalMs: performance.now() - startedAt,
    };
  } catch (error) {
    const storageError = reportWorldStorageFailure('сохранить мир', error);
    if (bytesEstimated <= MAX_LOCAL_RECOVERY_BYTES) {
      try {
        localStorage.setItem(LEGACY_KEY, JSON.stringify(world));
        return {
          slotId: resolvedSlot, writtenRecords: 1, skippedRecords: 0, deletedRecords: 0, bytesEstimated,
          snapshotCreated: false, totalMs: performance.now() - startedAt,
        };
      } catch {
        // Ниже возвращается исходная ошибка IndexedDB.
      }
    }
    throw storageError;
  } finally {
    db?.close();
  }
}

export async function renameWorldSlot(slotId: string, name: string): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction([SLOT_STORE, CORE_STORE], 'readwrite');
    const slotStore = transaction.objectStore(SLOT_STORE);
    const coreStore = transaction.objectStore(CORE_STORE);
    const nextName = name.trim();
    const meta = await requestValue(slotStore.get(slotId) as IDBRequest<WorldSlotMeta | undefined>);
    const core = await requestValue(coreStore.get(slotId) as IDBRequest<StoredCore | undefined>);
    if (meta && nextName) slotStore.put({ ...meta, name: nextName, updatedAt: Date.now() });
    if (core && nextName) coreStore.put({ ...core, core: { ...core.core, name: nextName } });
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function deleteWorldSlot(slotId: string): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction([SLOT_STORE, CORE_STORE, RECORD_STORE, SNAPSHOT_STORE, SNAPSHOT_META_STORE, PREFERENCE_STORE], 'readwrite');
    transaction.objectStore(SLOT_STORE).delete(slotId);
    transaction.objectStore(CORE_STORE).delete(slotId);
    const recordStore = transaction.objectStore(RECORD_STORE);
    const recordKeys = await requestValue(recordStore.index('slotId').getAllKeys(slotId) as IDBRequest<IDBValidKey[]>);
    for (const key of recordKeys) recordStore.delete(key);
    const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
    const snapshotKeys = await requestValue(snapshotStore.index('slotId').getAllKeys(slotId) as IDBRequest<IDBValidKey[]>);
    for (const key of snapshotKeys) snapshotStore.delete(key);
    const snapshotMetaStore = transaction.objectStore(SNAPSHOT_META_STORE);
    const snapshotMetaKeys = await requestValue(snapshotMetaStore.index('slotId').getAllKeys(slotId) as IDBRequest<IDBValidKey[]>);
    for (const key of snapshotMetaKeys) snapshotMetaStore.delete(key);
    if (activeSlotCache === slotId) {
      activeSlotCache = undefined;
      transaction.objectStore(PREFERENCE_STORE).delete(ACTIVE_SLOT_KEY);
      try { localStorage.removeItem(ACTIVE_SLOT_FALLBACK); } catch { /* Необязательно. */ }
    }
    await transactionDone(transaction);
    fingerprintCache.delete(slotId);
  } finally {
    db.close();
  }
}

export async function duplicateWorldSlot(slotId: string): Promise<string> {
  const previousActive = await getActiveWorldSlotId();
  const world = await loadPartitionedWorld(slotId);
  if (!world) throw new Error('Мир для копирования не найден');
  world.name = `${world.name} — копия`;
  const copyId = (await createWorldSlot(world, `${slotId}-copy`)).slotId;
  if (previousActive) await setActiveWorldSlot(previousActive);
  return copyId;
}

export async function listWorldSnapshots(slotId: string): Promise<WorldSnapshotMeta[]> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    const metaTransaction = db.transaction(SNAPSHOT_META_STORE, 'readonly');
    const stored = await requestValue(metaTransaction.objectStore(SNAPSHOT_META_STORE).index('slotId').getAll(slotId) as IDBRequest<WorldSnapshotMeta[]>);
    await transactionDone(metaTransaction);

    const legacyTransaction = db.transaction(SNAPSHOT_STORE, 'readonly');
    const keys = await requestValue(legacyTransaction.objectStore(SNAPSHOT_STORE).index('slotId').getAllKeys(slotId) as IDBRequest<IDBValidKey[]>);
    await transactionDone(legacyTransaction);
    const byId = new Map(stored.map(meta => [meta.id, meta]));
    for (const key of keys) {
      const id = String(key);
      if (byId.has(id)) continue;
      const legacy = legacySnapshotMetadata(id, slotId);
      if (legacy) byId.set(id, legacy);
    }
    return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    throw reportWorldStorageFailure('прочитать снимки', error);
  } finally {
    db?.close();
  }
}

export async function createWorldSnapshot(world: WorldState, slotId: string, reason: WorldSnapshotMeta['reason'] = 'ручной'): Promise<WorldSnapshotMeta> {
  await saveWorld(world, slotId, { forceSnapshot: true, reason });
  const snapshot = (await listWorldSnapshots(slotId))[0];
  if (!snapshot) throw new Error('Снимок был записан, но его метаданные не найдены');
  return snapshot;
}

export async function restoreWorldSnapshot(snapshotId: string): Promise<{ world: WorldState; slotId: string }> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    const transaction = db.transaction(SNAPSHOT_STORE, 'readonly');
    const snapshot = await requestValue(transaction.objectStore(SNAPSHOT_STORE).get(snapshotId) as IDBRequest<StoredSnapshot | undefined>);
    await transactionDone(transaction);
    if (!snapshot) throw new Error('Снимок мира не найден');
    const world = migrateWorld(snapshot.world);
    await saveWorld(world, snapshot.slotId, { forceSnapshot: false });
    await setActiveWorldSlot(snapshot.slotId);
    return { world, slotId: snapshot.slotId };
  } catch (error) {
    throw reportWorldStorageFailure('восстановить снимок', error);
  } finally {
    db?.close();
  }
}

export function estimateWorldBytes(world: WorldState): number {
  try { return new Blob([JSON.stringify(world)]).size; } catch { return 0; }
}

async function partitionWorld(
  world: WorldState,
  slotId: string,
  onProgress?: (completed: number, total: number, collection: string) => void,
): Promise<StoredRecord[]> {
  const records: StoredRecord[] = [];
  const total = Math.ceil(world.tiles.length / TILE_CHUNK_SIZE)
    + entityCollections.reduce((sum, collection) => sum + Math.ceil((world[collection] as unknown[]).length / ENTITY_CHUNK_SIZE), 0);
  let completed = 0;
  const push = async (record: StoredRecord, collection: string) => {
    records.push(record);
    completed += 1;
    onProgress?.(completed, total, collection);
    if (completed % 12 === 0) await yieldToBrowser();
  };
  for (let start = 0; start < world.tiles.length; start += TILE_CHUNK_SIZE) {
    const order = start / TILE_CHUNK_SIZE;
    const data = world.tiles.slice(start, start + TILE_CHUNK_SIZE);
    await push(makeRecord(slotId, 'tiles', order, data), 'карта');
  }
  for (const collection of entityCollections) {
    const items = world[collection] as unknown[];
    for (let start = 0; start < items.length; start += ENTITY_CHUNK_SIZE) {
      const order = start / ENTITY_CHUNK_SIZE;
      const data = items.slice(start, start + ENTITY_CHUNK_SIZE);
      await push(makeRecord(slotId, collection, `chunk-${order}`, data), collection);
    }
  }
  return records;
}

function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function makeRecord(slotId: string, collection: StoredRecord['collection'], order: number | string, data: unknown): StoredRecord {
  const serialized = JSON.stringify(data);
  return { key: `${slotId}:${collection}:${order}`, slotId, collection, order, fingerprint: hashString(serialized), byteSize: serialized.length * 2, data };
}

function extractCore(world: WorldState): StoredCore['core'] {
  const clone: any = { ...world };
  delete clone.tiles;
  for (const collection of entityCollections) delete clone[collection];
  return clone;
}

async function readStoredFingerprints(slotId: string): Promise<Map<string, string>> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    const transaction = db.transaction(RECORD_STORE, 'readonly');
    const records = await requestValue(transaction.objectStore(RECORD_STORE).index('slotId').getAll(slotId) as IDBRequest<StoredRecord[]>);
    await transactionDone(transaction);
    return new Map(records.map(record => [record.key, record.fingerprint]));
  } catch {
    return new Map();
  } finally {
    db?.close();
  }
}

async function trimSnapshots(slotId: string): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction([SNAPSHOT_STORE, SNAPSHOT_META_STORE, SLOT_STORE], 'readwrite');
    const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
    const metaStore = transaction.objectStore(SNAPSHOT_META_STORE);
    const metadata = await requestValue(metaStore.index('slotId').getAll(slotId) as IDBRequest<WorldSnapshotMeta[]>);
    const ordered = metadata.sort((a, b) => b.createdAt - a.createdAt);
    for (const entry of ordered.slice(SNAPSHOT_LIMIT)) {
      snapshotStore.delete(entry.id);
      metaStore.delete(entry.id);
    }
    const slotStore = transaction.objectStore(SLOT_STORE);
    const meta = await requestValue(slotStore.get(slotId) as IDBRequest<WorldSlotMeta | undefined>);
    if (meta) slotStore.put({ ...meta, snapshotCount: Math.min(SNAPSHOT_LIMIT, ordered.length) });
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

async function loadLegacyIndexedWorld(): Promise<WorldState | undefined> {
  const db = await openDatabase();
  try {
    if (!db.objectStoreNames.contains(LEGACY_STORE)) return undefined;
    const transaction = db.transaction(LEGACY_STORE, 'readonly');
    const world = await requestValue(transaction.objectStore(LEGACY_STORE).get('active') as IDBRequest<WorldState | undefined>);
    await transactionDone(transaction);
    return world ? migrateWorld(world) : undefined;
  } finally {
    db.close();
  }
}

function entityOrder(item: any): number {
  if (typeof item?.id === 'number') return item.id;
  if (typeof item?.year === 'number') return item.year * 20 + (item.month ?? 0);
  return 0;
}

function sanitizeSlotId(value: string): string {
  return value.toLowerCase().replace(/[^a-zа-яё0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 72) || `world-${Date.now()}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
