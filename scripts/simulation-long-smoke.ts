import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { inspectWorldIntegrity } from '../src/sim/integrity';
import { advanceWorld } from '../src/sim/simulation';
import { advanceStateMachine } from '../src/sim/stateMachine';
import { buildWorldIndexes } from '../src/sim/indexes';
import { RNG } from '../src/sim/rng';

const config = {
  ...defaultConfig,
  seed: 'eldervale-social-long-run',
  width: 18,
  height: 12,
  historyYears: 45,
  kingdomCount: 3,
  settlementCount: 7,
  populationScale: .09,
  monsterDensity: .25,
  artifactDensity: .2,
  ecologyDensity: .25,
};

let world = generateHistoricalWorld(config);
for (let batch = 0; batch < 10; batch += 1) {
  world = advanceWorld(world, 60);
  const report = inspectWorldIntegrity(world);
  assert.deepEqual(report.errors, [], `период ${batch + 1}: ${report.errors.join(' | ')}`);
}

const extinctionProbe = generateHistoricalWorld({
  ...config,
  seed: 'eldervale-extinction-archive-probe',
  width: 12,
  height: 9,
  historyYears: 24,
  kingdomCount: 3,
  settlementCount: 6,
  populationScale: .06,
});
const extinctKingdom = extinctionProbe.kingdoms[0];
assert.ok(extinctKingdom && extinctionProbe.kingdoms.length > 1, 'для проверки архива нужны минимум две державы');
for (const character of extinctionProbe.characters) if (character.kingdomId === extinctKingdom!.id) character.alive = false;
advanceStateMachine(
  extinctionProbe,
  new RNG(`${extinctionProbe.config.seed}:forced-extinction`),
  buildWorldIndexes(extinctionProbe),
);
assert.ok(
  extinctionProbe.history.fallenRealms.some(realm => realm.formerKingdomId === extinctKingdom!.id),
  'вымершая держава должна перейти в исторический архив',
);
assert.ok(world.relationships.every(relation => relation.trust !== undefined), 'социальные связи должны сохраняться после долгой симуляции');
assert.ok(world.armies.every(army => !world.tiles[army.y * world.config.width + army.x]?.settlementId), 'армии не должны входить в города после долгой симуляции');
assert.equal(world.armyLocalPositions.length, world.armies.reduce((sum, army) => sum + army.soldierIds.length, 0), 'все оставшиеся солдаты должны отображаться отдельно');
console.log(`OK LONG: год ${world.year}, живых ${world.characters.length}, держав ${world.kingdoms.length}, решений ${world.decisions.length}.`);
