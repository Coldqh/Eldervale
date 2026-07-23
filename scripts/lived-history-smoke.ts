import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { inspectWorldIntegrity } from '../src/sim/integrity';

const config = {
  ...defaultConfig,
  seed: 'lived-history-smoke',
  historyYears: 60,
  width: 24,
  height: 16,
  kingdomCount: 3,
  settlementCount: 10,
  populationScale: .7,
  monsterDensity: .08,
  artifactDensity: .08,
  ecologyDensity: .12,
};

const signature = (world: ReturnType<typeof generateHistoricalWorld>) => JSON.stringify({
  settlements: world.settlements.map(item => [item.id, item.name, item.x, item.y, item.foundedYear, item.kingdomId, item.population]),
  kingdoms: world.kingdoms.map(item => [item.id, item.name, item.foundedYear, item.capitalId, item.politicalOrigin]),
  events: world.events.map(item => [item.year, item.month, item.kind, item.title]),
  genesis: world.history.genesis,
});

const first = generateHistoricalWorld(config);
const second = generateHistoricalWorld(config);
const different = generateHistoricalWorld({ ...config, seed: 'lived-history-smoke-other' });

assert.equal(first.version, 34);
assert.equal(first.history.engineVersion, 3);
assert.equal(first.history.historicalSimulationVersion, 2);
assert.ok(first.history.genesis, 'мир должен хранить отчёт генезиса');
assert.ok((first.history.genesis?.coarseSteps ?? 0) > 0, 'ранняя история должна иметь ускоренные реальные срезы');
assert.ok((first.history.genesis?.detailedMonths ?? 0) > 0, 'последние годы должны быть прожиты подробными ходами');
assert.ok(first.characters.some(item => item.alive), 'прожитая история не должна уничтожать всё население');
assert.ok(first.events.some(item => item.kind === 'birth'), 'в истории должны происходить реальные рождения');
assert.ok(first.events.some(item => item.kind === 'settlement'), 'в истории должны происходить реальные основания поселений');

for (const settlement of first.settlements) {
  assert.ok(first.events.some(event => event.kind === 'settlement' && event.entityRefs.some(ref => ref.kind === 'settlement' && ref.id === settlement.id)), `у поселения ${settlement.name} должно быть событие основания`);
}
for (const kingdom of first.kingdoms) {
  assert.ok(first.territoryHistory.some(change => change.kingdomId === kingdom.id && change.reason === 'основание столицы'), `у державы ${kingdom.name} должна быть территориальная запись основания`);
}

assert.equal(signature(first), signature(second), 'один seed должен воспроизводить одну прожитую историю');
assert.notEqual(signature(first), signature(different), 'разные seed должны создавать разные истории');

const integrity = inspectWorldIntegrity(first);
assert.deepEqual(integrity.errors, [], `целостность прожитого мира нарушена: ${integrity.errors.join('; ')}`);
console.log(`lived history smoke passed: ${first.history.genesis?.initialPopulation} -> ${first.history.genesis?.finalPopulation} жителей, ${first.settlements.length} поселений, ${first.kingdoms.length} держав, ${first.events.length} событий`);
