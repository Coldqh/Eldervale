import type { WorldSnapshotMeta } from '../types';

export const MAX_AUTOMATIC_SNAPSHOT_BYTES = 64 * 1024 * 1024;

export interface StoredSnapshotMetadataSource extends WorldSnapshotMeta {
  world?: unknown;
}

export function snapshotMetadata(source: StoredSnapshotMetadataSource): WorldSnapshotMeta {
  return {
    id: source.id,
    slotId: source.slotId,
    year: source.year,
    month: source.month,
    createdAt: source.createdAt,
    reason: source.reason,
    sizeBytes: source.sizeBytes,
  };
}

export function legacySnapshotMetadata(key: string, slotId: string): WorldSnapshotMeta | undefined {
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

export function shouldCreateSnapshot(options: { force: boolean; automaticDue: boolean; bytesEstimated: number }): boolean {
  if (options.force) return true;
  if (!options.automaticDue) return false;
  return options.bytesEstimated <= MAX_AUTOMATIC_SNAPSHOT_BYTES;
}
