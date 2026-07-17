import assert from 'node:assert/strict';
import {
  MAX_AUTOMATIC_SNAPSHOT_BYTES,
  legacySnapshotMetadata,
  shouldCreateSnapshot,
  snapshotMetadata,
} from '../src/lib/storageSnapshotMeta';

const source = {
  id: 'slot:120:7:123456',
  slotId: 'slot',
  year: 120,
  month: 7,
  createdAt: 123456,
  reason: 'ручной' as const,
  sizeBytes: 42_000,
  world: { huge: true },
};

assert.deepEqual(snapshotMetadata(source), {
  id: source.id,
  slotId: source.slotId,
  year: source.year,
  month: source.month,
  createdAt: source.createdAt,
  reason: 'ручной',
  sizeBytes: 42_000,
});
assert.equal('world' in snapshotMetadata(source), false, 'метаданные не должны удерживать полный мир');

assert.deepEqual(legacySnapshotMetadata('slot:15:4:9000', 'slot'), {
  id: 'slot:15:4:9000',
  slotId: 'slot',
  year: 15,
  month: 4,
  createdAt: 9000,
  reason: 'автоматический',
  sizeBytes: 0,
});
assert.equal(legacySnapshotMetadata('other:15:4:9000', 'slot'), undefined);
assert.equal(legacySnapshotMetadata('slot:broken', 'slot'), undefined);

assert.equal(shouldCreateSnapshot({ force: false, automaticDue: false, bytesEstimated: 1 }), false);
assert.equal(shouldCreateSnapshot({ force: false, automaticDue: true, bytesEstimated: MAX_AUTOMATIC_SNAPSHOT_BYTES }), true);
assert.equal(shouldCreateSnapshot({ force: false, automaticDue: true, bytesEstimated: MAX_AUTOMATIC_SNAPSHOT_BYTES + 1 }), false);
assert.equal(shouldCreateSnapshot({ force: true, automaticDue: false, bytesEstimated: MAX_AUTOMATIC_SNAPSHOT_BYTES * 4 }), true, 'ручной снимок должен оставаться доступным');

console.log('OK STORAGE: метаданные снимков сохраняют тип и размер, крупные автоматические копии ограничены.');
