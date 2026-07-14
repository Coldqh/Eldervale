import type { WorldState } from '../types';
import { migrateWorld } from '../sim/migrateWorld';

const DB_NAME = 'eldervale';
const STORE_NAME = 'worlds';
const ACTIVE_WORLD = 'active';
const LEGACY_KEY = 'eldervale-world-v1';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadWorld(): Promise<WorldState | undefined> {
  try {
    const db = await openDatabase();
    const world = await new Promise<WorldState | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(ACTIVE_WORLD);
      request.onsuccess = () => resolve(request.result as WorldState | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (world) return migrateWorld(world);
  } catch {
    // В приватном режиме браузер может блокировать IndexedDB.
  }

  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    return legacy ? migrateWorld(JSON.parse(legacy)) : undefined;
  } catch {
    return undefined;
  }
}

export async function saveWorld(world: WorldState): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(world, ACTIVE_WORLD);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    try { localStorage.setItem(LEGACY_KEY, JSON.stringify(world)); } catch { /* Экспорт остаётся доступен вручную. */ }
  }
}
