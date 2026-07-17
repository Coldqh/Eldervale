import assert from 'node:assert/strict';
import { latestEventId, nextImportantEventId } from '../src/lib/nextEvent';

const events = [
  { id: 4, importance: 1 },
  { id: 7, importance: 3 },
  { id: 8, importance: 2 },
  { id: 9, importance: 3 },
];

assert.equal(latestEventId(events), 9);
assert.equal(nextImportantEventId(events, 4, 2), 7, 'при равной важности выбирается первое новое событие');
assert.equal(nextImportantEventId(events, 7, 2), 9, 'более важное событие должно победить обычное');
assert.equal(nextImportantEventId(events, 9, 1), undefined);
assert.equal(nextImportantEventId([], 0, 1), undefined);

console.log('OK NEXT EVENT: граница событий и порог важности работают детерминированно.');
