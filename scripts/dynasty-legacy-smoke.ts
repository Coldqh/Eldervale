import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { advanceDynastyLegacy, dynastyLegacyIntegrityIssues, initializeDynastyLegacy } from '../src/sim/dynastyLegacy';
import { buildDynastyLegacySnapshot, dynastyMembers } from '../src/lib/dynastyLegacy';

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'eldervale-dynasty-legacy-suite',
  width: 20,
  height: 15,
  historyYears: 70,
  kingdomCount: 4,
  settlementCount: 9,
  populationScale: .16,
  monsterDensity: .2,
  artifactDensity: .25,
  ecologyDensity: .25,
});

initializeDynastyLegacy(world);
assert.equal(world.simulation.dynastyLegacyVersion, 1, 'система поколений должна инициализироваться');
assert.ok(world.dynasties.length > 0, 'в мире должны существовать династии');

const dynasty = world.dynasties.find(item => dynastyMembers(world, item).filter(character => character.alive && character.age >= 14).length >= 2);
assert.ok(dynasty, 'нужен род минимум с двумя взрослыми живыми представителями');
const before = buildDynastyLegacySnapshot(world, dynasty.id);
assert.ok(before, 'должен собираться снимок рода');
assert.ok(before.motto.length > 0, 'у рода должен быть девиз');
assert.ok(before.generations.length > 0, 'род должен раскладываться по поколениям');
assert.ok(before.headId, 'у живого рода должен быть глава');
assert.ok(before.heirId, 'при нескольких взрослых членах должен определяться наследник');

const oldHead = world.characters.find(character => character.id === before.headId);
assert.ok(oldHead, 'глава должен быть реальным персонажем');
oldHead.alive = false;
oldHead.health = 0;
oldHead.deathYear = world.year;
world.month = world.month === 12 ? 1 : world.month + 1;
if (world.month === 1) world.year += 1;
advanceDynastyLegacy(world);

const after = buildDynastyLegacySnapshot(world, dynasty.id);
assert.ok(after?.headId && after.headId !== oldHead.id, 'после смерти глава должен смениться');
assert.ok(after.successions.some(item => item.previousHeadId === oldHead.id && item.newHeadId === after.headId), 'смена главы должна попасть в историю наследования');
assert.ok(after.milestones.some(item => item.kind === 'succession'), 'смена поколения должна стать вехой рода');
assert.ok(world.events.some(event => event.kind === 'dynasty' && event.entityRefs.some(ref => ref.kind === 'dynasty' && ref.id === dynasty.id)), 'смена главы должна попасть в мировую хронику');

const otherDynasty = world.dynasties.find(item => item.id !== dynasty.id && dynastyMembers(world, item).some(character => character.alive && character.age >= 14));
if (otherDynasty) {
  const first = dynastyMembers(world, dynasty).find(character => character.alive && character.age >= 14);
  const second = dynastyMembers(world, otherDynasty).find(character => character.alive && character.age >= 14);
  if (first && second) {
    first.spouseId = second.id;
    second.spouseId = first.id;
    world.month = world.month === 12 ? 1 : world.month + 1;
    if (world.month === 1) world.year += 1;
    advanceDynastyLegacy(world);
    const allied = buildDynastyLegacySnapshot(world, dynasty.id);
    assert.ok(allied?.alliances.some(item => item.otherDynastyId === otherDynasty.id && item.active), 'междинастический брак должен создать союз домов');
    assert.ok(allied?.milestones.some(item => item.kind === 'marriage'), 'брачный союз должен попасть в хронику рода');
  }
}

assert.deepEqual(dynastyLegacyIntegrityIssues(world), [], 'система не должна оставлять повреждённые ссылки');
console.log(`OK DYNASTY LEGACY: ${dynasty.name}, глава ${after?.headId}, поколений ${after?.generationDepth}, ветвей ${after?.branches.length}.`);
