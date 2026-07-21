import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { buildWorldIndexes } from '../src/sim/indexes';
import { ensureCharacterMind } from '../src/sim/mindSystem';
import { advanceDailyLife, initializeDailyLife, routineForCharacter } from '../src/sim/dailyLife';
import { RNG } from '../src/sim/rng';
import { buildCharacterStory, latestCharacterEventCursor, nextCharacterEvent } from '../src/lib/liveStories';

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'eldervale-live-stories-suite',
  width: 18,
  height: 14,
  historyYears: 45,
  kingdomCount: 3,
  settlementCount: 7,
  populationScale: .12,
  monsterDensity: .2,
  artifactDensity: .2,
  ecologyDensity: .25,
});

initializeDailyLife(world);
const indexes = buildWorldIndexes(world);

const candidates = world.characters
  .filter(item => item.alive && item.age >= 14)
  .sort((a, b) => a.id - b.id);

const selected = candidates
  .map(character => ({ character, mind: ensureCharacterMind(world, character) }))
  .find(item => item.mind.goals.length > 0);

assert.ok(selected, 'в мире должен существовать живой взрослый персонаж с личной целью');

const { character, mind } = selected;
const goal = [...mind.goals].sort((a, b) => b.priority - a.priority)[0];
assert.ok(goal, 'у выбранного персонажа должна существовать личная цель');

goal.progress = 24;
const cursor = latestCharacterEventCursor(world, character.id);

advanceDailyLife(
  world,
  new RNG(`${world.config.seed}:live-stories:${world.year}:${world.month}`),
  indexes,
  { forceCharacterIds: [character.id] },
);

const routine = routineForCharacter(world, character);
assert.equal(routine.characterId, character.id, 'наблюдаемый персонаж должен получить подробный распорядок');
assert.equal(routine.stops.length, 4, 'распорядок должен содержать четыре части суток');
assert.ok(goal.progress >= 25, 'реальное действие должно продвигать личную цель');

const pointer = nextCharacterEvent(world, character.id, cursor);
assert.ok(pointer, 'после продвижения должна появиться новая запись личной истории');

const story = buildCharacterStory(world, character.id);
assert.ok(story, 'для живого персонажа должна собираться история');
assert.equal(story.characterId, character.id);
assert.ok(story.plan.title.length > 0 && story.plan.currentStage.length > 0, 'история должна показывать план и текущий этап');
assert.ok(story.timeline.length > 0, 'история должна содержать временную линию');

const deadRecord = world.burials.find(item => item.subjectKind === 'character' && item.subjectId);
if (deadRecord?.subjectId) {
  const deadStory = buildCharacterStory(world, deadRecord.subjectId);
  assert.ok(deadStory && !deadStory.alive, 'для умершего должна собираться завершённая биография');
  assert.ok(deadStory.biography.summary.length > 0 && deadStory.biography.legacy.length > 0, 'биография должна сохранять итог и наследие');
}

console.log(`OK LIVE STORIES: ${character.name}, цель ${story.plan.title}, событий ${story.timeline.length}.`);
