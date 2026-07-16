import type { StorageProfile, WorldSlotMeta, WorldSnapshotMeta, WorldState } from '../types';
import { migrateWorld } from '../sim/migrateWorld';
import { APP_VERSION } from '../version';

const DB_NAME = 'eldervale';
const DB_VERSION = 2;
const SLOT_STORE = 'slots';
const CORE_STORE = 'worldCore';
const RECORD_STORE = 'worldRecords';
const SNAPSHOT_STORE = 'snapshots';
const PREFERENCE_STORE = 'preferences';
const LEGACY_STORE = 'worlds';
const ACTIVE_SLOT_KEY = 'active-slot';
const LEGACY_KEY = 'eldervale-world-v1';
const ACTIVE_SLOT_FALLBACK = 'eldervale-active-slot';
const SNAPSHOT_INTERVAL_YEARS = 25;
const SNAPSHOT_LIMIT = 4;
const TILE_CHUNK_SIZE = 256;

const entityCollections = [
  'kingdoms', 'settlements', 'characters', 'relationships', 'dynasties', 'armies', 'monsters', 'cemeteries', 'burials', 'animalPopulations',
  'ingredients', 'alchemyRecipes', 'artifacts', 'books', 'dungeons', 'wars', 'tradeRoutes', 'territoryHistory', 'buildings', 'households', 'establishments', 'fields', 'constructionProjects', 'items', 'productionRecipes', 'employments', 'shipments', 'events', 'localMapChanges',
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
    request.onupgradeneeded = () => {
      const db = request.result;
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
      if (!db.objectStoreNames.contains(PREFERENCE_STORE)) db.createObjectStore(PREFERENCE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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
  try {
    const db = await openDatabase();
    const transaction = db.transaction(SLOT_STORE, 'readonly');
    const slots = await requestValue(transaction.objectStore(SLOT_STORE).getAll() as IDBRequest<WorldSlotMeta[]>);
    await transactionDone(transaction);
    db.close();
    return slots.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function getActiveWorldSlotId(): Promise<string | undefined> {
  if (activeSlotCache) return activeSlotCache;
  try {
    const db = await openDatabase();
    const transaction = db.transaction(PREFERENCE_STORE, 'readonly');
    const value = await requestValue(transaction.objectStore(PREFERENCE_STORE).get(ACTIVE_SLOT_KEY) as IDBRequest<string | undefined>);
    await transactionDone(transaction);
    db.close();
    activeSlotCache = value;
    return value;
  } catch {
    try { return localStorage.getItem(ACTIVE_SLOT_FALLBACK) ?? undefined; } catch { return undefined; }
  }
}

export async function setActiveWorldSlot(slotId: string): Promise<void> {
  activeSlotCache = slotId;
  try {
    const db = await openDatabase();
    const transaction = db.transaction(PREFERENCE_STORE, 'readwrite');
    transaction.objectStore(PREFERENCE_STORE).put(slotId, ACTIVE_SLOT_KEY);
    await transactionDone(transaction);
    db.close();
    try { localStorage.setItem(ACTIVE_SLOT_FALLBACK, slotId); } catch { /* Необязательно. */ }
  } catch {
    try { localStorage.setItem(ACTIVE_SLOT_FALLBACK, slotId); } catch { /* Браузер полностью запретил постоянное хранилище. */ }
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
    // Ниже остаётся аварийное локальное сохранение.
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
  const world = await loadPartitionedWorld(slotId);
  if (world) await setActiveWorldSlot(slotId);
  return world;
}

async function loadPartitionedWorld(slotId: string): Promise<WorldState | undefined> {
  const db = await openDatabase();
  const coreTransaction = db.transaction(CORE_STORE, 'readonly');
  const core = await requestValue(coreTransaction.objectStore(CORE_STORE).get(slotId) as IDBRequest<StoredCore | undefined>);
  await transactionDone(coreTransaction);
  if (!core) { db.close(); return undefined; }

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
      else collections[record.collection]!.push(record.data);
      cursor.continue();
    };
  });
  await transactionDone(transaction);
  db.close();

  for (const name of entityCollections) collections[name]!.sort((a: any, b: any) => entityOrder(a) - entityOrder(b));
  tileChunks.sort((a, b) => a.order - b.order);
  fingerprintCache.set(slotId, fingerprints);
  return migrateWorld({ ...core.core, tiles: tileChunks.flatMap(chunk => chunk.data), ...collections });
}

export async function createWorldSlot(world: WorldState, preferredId?: string): Promise<{ slotId: string; world: WorldState; profile: StorageProfile }> {
  const existing = new Set((await listWorldSlots()).map(slot => slot.id));
  let slotId = sanitizeSlotId(preferredId || `${world.config.seed}-${Date.now()}`);
  let suffix = 2;
  while (existing.has(slotId)) slotId = `${sanitizeSlotId(preferredId || world.config.seed)}-${suffix++}`;
  activeSlotCache = slotId;
  // Новый мир уже является полным сохранением. Создавать рядом вторую
  // полную копию-снимок бессмысленно и очень дорого на крупных мирах.
  const profile = await saveWorld(world, slotId);
  await setActiveWorldSlot(slotId);
  return { slotId, world, profile };
}

export async function saveWorld(
  world: WorldState,
  slotId?: string,
  options: { forceSnapshot?: boolean; reason?: WorldSnapshotMeta['reason'] } = {},
): Promise<StorageProfile> {
  const startedAt = performance.now();
  const resolvedSlot = slotId ?? await getActiveWorldSlotId() ?? sanitizeSlotId(`${world.config.seed}-${Date.now()}`);
  activeSlotCache = resolvedSlot;
  const previousFingerprints = fingerprintCache.get(resolvedSlot) ?? await readStoredFingerprints(resolvedSlot);
  const currentRecords = partitionWorld(world, resolvedSlot);
  const currentFingerprints = new Map(currentRecords.map(record => [record.key, record.fingerprint]));
  const changed = currentRecords.filter(record => previousFingerprints.get(record.key) !== record.fingerprint);
  const deleted = [...previousFingerprints.keys()].filter(key => !currentFingerprints.has(key));
  const slots = await listWorldSlots();
  const previousMeta = slots.find(slot => slot.id === resolvedSlot);
  const snapshotDue = Boolean(options.forceSnapshot || (previousMeta?.lastSnapshotYear !== undefined && world.year - previousMeta.lastSnapshotYear >= SNAPSHOT_INTERVAL_YEARS));
  // Не сериализуем весь мир второй раз. Размер уже известен из отдельных
  // записей, которые всё равно строятся для инкрементального сохранения.
  const core = extractCore(world);
  const bytesEstimated = currentRecords.reduce((sum, record) => sum + (record.byteSize ?? 0), 0) + new Blob([JSON.stringify(core)]).size;
  const now = Date.now();
  const meta: WorldSlotMeta = {
    id: resolvedSlot, name: world.name, seed: world.config.seed, createdAt: previousMeta?.createdAt ?? now, updatedAt: now,
    year: world.year, month: world.month, schemaVersion: world.version, appVersion: APP_VERSION, sizeBytes: bytesEstimated,
    snapshotCount: previousMeta?.snapshotCount ?? 0, lastSnapshotYear: previousMeta?.lastSnapshotYear ?? world.year,
  };

  try {
    const db = await openDatabase();
    const stores = [SLOT_STORE, CORE_STORE, RECORD_STORE, PREFERENCE_STORE, SNAPSHOT_STORE];
    const transaction = db.transaction(stores, 'readwrite');
    const coreStore = transaction.objectStore(CORE_STORE);
    const recordStore = transaction.objectStore(RECORD_STORE);
    const slotStore = transaction.objectStore(SLOT_STORE);
    const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
    coreStore.put({ slotId: resolvedSlot, core } satisfies StoredCore);
    for (const record of changed) recordStore.put(record);
    for (const key of deleted) recordStore.delete(key);
    transaction.objectStore(PREFERENCE_STORE).put(resolvedSlot, ACTIVE_SLOT_KEY);

    let snapshotCreated = false;
    if (snapshotDue) {
      const snapshot: StoredSnapshot = {
        id: `${resolvedSlot}:${world.year}:${world.month}:${now}`, slotId: resolvedSlot, year: world.year, month: world.month,
        createdAt: now, reason: options.reason ?? 'автоматический', sizeBytes: bytesEstimated, world: structuredClone(world),
      };
      snapshotStore.put(snapshot);
      meta.snapshotCount += 1;
      meta.lastSnapshotYear = world.year;
      snapshotCreated = true;
    }
    slotStore.put(meta);
    await transactionDone(transaction);
    db.close();
    fingerprintCache.set(resolvedSlot, currentFingerprints);
    localStorage.removeItem(LEGACY_KEY);
    try { localStorage.setItem(ACTIVE_SLOT_FALLBACK, resolvedSlot); } catch { /* Необязательно. */ }
    if (snapshotCreated) await trimSnapshots(resolvedSlot);
    return {
      slotId: resolvedSlot, writtenRecords: changed.length + 2 + (snapshotCreated ? 1 : 0), skippedRecords: currentRecords.length - changed.length,
      deletedRecords: deleted.length, bytesEstimated, snapshotCreated, totalMs: performance.now() - startedAt,
    };
  } catch (error) {
    try {
      localStorage.setItem(LEGACY_KEY, JSON.stringify(world));
      return {
        slotId: resolvedSlot, writtenRecords: 1, skippedRecords: 0, deletedRecords: 0, bytesEstimated,
        snapshotCreated: false, totalMs: performance.now() - startedAt,
      };
    } catch {
      throw error;
    }
  }
}

export async function renameWorldSlot(slotId: string, name: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([SLOT_STORE, CORE_STORE], 'readwrite');
  const slotStore = transaction.objectStore(SLOT_STORE);
  const coreStore = transaction.objectStore(CORE_STORE);
  const nextName = name.trim();
  const meta = await requestValue(slotStore.get(slotId) as IDBRequest<WorldSlotMeta | undefined>);
  const core = await requestValue(coreStore.get(slotId) as IDBRequest<StoredCore | undefined>);
  if (meta && nextName) slotStore.put({ ...meta, name: nextName, updatedAt: Date.now() });
  if (core && nextName) coreStore.put({ ...core, core: { ...core.core, name: nextName } });
  await transactionDone(transaction);
  db.close();
}

export async function deleteWorldSlot(slotId: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([SLOT_STORE, CORE_STORE, RECORD_STORE, SNAPSHOT_STORE, PREFERENCE_STORE], 'readwrite');
  transaction.objectStore(SLOT_STORE).delete(slotId);
  transaction.objectStore(CORE_STORE).delete(slotId);
  const recordStore = transaction.objectStore(RECORD_STORE);
  const recordKeys = await requestValue(recordStore.index('slotId').getAllKeys(slotId) as IDBRequest<IDBValidKey[]>);
  for (const key of recordKeys) recordStore.delete(key);
  const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
  const snapshotKeys = await requestValue(snapshotStore.index('slotId').getAllKeys(slotId) as IDBRequest<IDBValidKey[]>);
  for (const key of snapshotKeys) snapshotStore.delete(key);
  if (activeSlotCache === slotId) {
    activeSlotCache = undefined;
    transaction.objectStore(PREFERENCE_STORE).delete(ACTIVE_SLOT_KEY);
    try { localStorage.removeItem(ACTIVE_SLOT_FALLBACK); } catch { /* Необязательно. */ }
  }
  await transactionDone(transaction);
  db.close();
  fingerprintCache.delete(slotId);
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
  const db = await openDatabase();
  const transaction = db.transaction(SNAPSHOT_STORE, 'readonly');
  // getAll() десериализовывал несколько полных миров только ради даты и года.
  // Ключ снимка уже содержит все данные, нужные списку настроек.
  const keys = await requestValue(transaction.objectStore(SNAPSHOT_STORE).index('slotId').getAllKeys(slotId) as IDBRequest<IDBValidKey[]>);
  await transactionDone(transaction);
  db.close();
  return keys
    .map(key => snapshotMetaFromKey(String(key), slotId))
    .filter((meta): meta is WorldSnapshotMeta => Boolean(meta))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function createWorldSnapshot(world: WorldState, slotId: string, reason: WorldSnapshotMeta['reason'] = 'ручной'): Promise<WorldSnapshotMeta> {
  await saveWorld(world, slotId, { forceSnapshot: true, reason });
  return (await listWorldSnapshots(slotId))[0]!;
}

export async function restoreWorldSnapshot(snapshotId: string): Promise<{ world: WorldState; slotId: string }> {
  const db = await openDatabase();
  const transaction = db.transaction(SNAPSHOT_STORE, 'readonly');
  const snapshot = await requestValue(transaction.objectStore(SNAPSHOT_STORE).get(snapshotId) as IDBRequest<StoredSnapshot | undefined>);
  await transactionDone(transaction);
  db.close();
  if (!snapshot) throw new Error('Снимок мира не найден');
  const world = migrateWorld(snapshot.world);
  await saveWorld(world, snapshot.slotId, { forceSnapshot: false });
  await setActiveWorldSlot(snapshot.slotId);
  return { world, slotId: snapshot.slotId };
}

export function estimateWorldBytes(world: WorldState): number {
  try { return new Blob([JSON.stringify(world)]).size; } catch { return 0; }
}

function partitionWorld(world: WorldState, slotId: string): StoredRecord[] {
  const records: StoredRecord[] = [];
  for (let start = 0; start < world.tiles.length; start += TILE_CHUNK_SIZE) {
    const order = start / TILE_CHUNK_SIZE;
    const data = world.tiles.slice(start, start + TILE_CHUNK_SIZE);
    records.push(makeRecord(slotId, 'tiles', order, data));
  }
  for (const collection of entityCollections) {
    const items = world[collection] as unknown[];
    for (let index = 0; index < items.length; index += 1) {
      const item: any = items[index];
      records.push(makeRecord(slotId, collection, item?.id ?? index, item));
    }
  }
  return records;
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
  try {
    const db = await openDatabase();
    const transaction = db.transaction(RECORD_STORE, 'readonly');
    const records = await requestValue(transaction.objectStore(RECORD_STORE).index('slotId').getAll(slotId) as IDBRequest<StoredRecord[]>);
    await transactionDone(transaction);
    db.close();
    return new Map(records.map(record => [record.key, record.fingerprint]));
  } catch {
    return new Map();
  }
}

async function trimSnapshots(slotId: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([SNAPSHOT_STORE, SLOT_STORE], 'readwrite');
  const store = transaction.objectStore(SNAPSHOT_STORE);
  const keys = await requestValue(store.index('slotId').getAllKeys(slotId) as IDBRequest<IDBValidKey[]>);
  const ordered = keys
    .map(key => ({ key, meta: snapshotMetaFromKey(String(key), slotId) }))
    .sort((a, b) => (b.meta?.createdAt ?? 0) - (a.meta?.createdAt ?? 0));
  for (const entry of ordered.slice(SNAPSHOT_LIMIT)) store.delete(entry.key);
  const slotStore = transaction.objectStore(SLOT_STORE);
  const meta = await requestValue(slotStore.get(slotId) as IDBRequest<WorldSlotMeta | undefined>);
  if (meta) slotStore.put({ ...meta, snapshotCount: Math.min(SNAPSHOT_LIMIT, ordered.length) });
  await transactionDone(transaction);
  db.close();
}

function snapshotMetaFromKey(key: string, slotId: string): WorldSnapshotMeta | undefined {
  const prefix = `${slotId}:`;
  if (!key.startsWith(prefix)) return undefined;
  const tail = key.slice(prefix.length).split(':');
  if (tail.length < 3) return undefined;
  const year = Number(tail[0]);
  const month = Number(tail[1]);
  const createdAt = Number(tail[2]);
  if (![year, month, createdAt].every(Number.isFinite)) return undefined;
  return { id: key, slotId, year, month, createdAt, reason: 'автоматический', sizeBytes: 0 };
}

async function loadLegacyIndexedWorld(): Promise<WorldState | undefined> {
  const db = await openDatabase();
  if (!db.objectStoreNames.contains(LEGACY_STORE)) { db.close(); return undefined; }
  const transaction = db.transaction(LEGACY_STORE, 'readonly');
  const world = await requestValue(transaction.objectStore(LEGACY_STORE).get('active') as IDBRequest<WorldState | undefined>);
  await transactionDone(transaction);
  db.close();
  return world ? migrateWorld(world) : undefined;
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
