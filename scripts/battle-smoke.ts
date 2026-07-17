import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { buildWorldIndexes } from '../src/sim/indexes';
import { battleSystemIntegrityIssues, resolveSpatialArmyBattle } from '../src/sim/battleSystem';
import { RNG } from '../src/sim/rng';
import type { War } from '../src/types';

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'eldervale-battle-smoke',
  width: 20,
  height: 14,
  historyYears: 55,
  kingdomCount: 4,
  settlementCount: 9,
  populationScale: .15,
});
const attacker = world.armies[0]!;
const defender = world.armies.find(item => item.kingdomId !== attacker.kingdomId)!;
const target = world.settlements.find(item => item.kingdomId === defender.kingdomId)!;
attacker.x = defender.x;
attacker.y = defender.y;
attacker.status = 'battle';
defender.status = 'battle';
const war: War = {
  id: world.nextIds.war++, name: 'Тестовая война', attackerId: attacker.kingdomId, defenderId: defender.kingdomId,
  startYear: world.year, active: true, cause: 'проверка боя', goal: 'проверить бой', contestedSettlementIds: [target.id],
  battles: 0, attackerLosses: 0, defenderLosses: 0, history: [],
};
world.wars.push(war);
const before = world.characters.length;
const outcome = resolveSpatialArmyBattle(world, attacker, defender, war, target, new RNG('battle-smoke'), buildWorldIndexes(world));
assert.equal(world.battleRecords.length, 1);
assert.ok(outcome.record.rounds >= 1);
assert.ok(outcome.record.attackerUnitStates.length > 0 && outcome.record.defenderUnitStates.length > 0);
assert.equal(outcome.record.prisonerIds.length, outcome.attackerCaptured + outcome.defenderCaptured);
assert.equal(outcome.record.woundedIds.length, outcome.attackerWounded + outcome.defenderWounded);
assert.ok(world.characters.length <= before);
assert.ok(outcome.record.history.length >= 2);
assert.deepEqual(battleSystemIntegrityIssues(world), []);
assert.ok(outcome.record.prisonerIds.every(id => !attacker.soldierIds.includes(id) && !defender.soldierIds.includes(id)), 'пленные не должны оставаться в строю');
assert.ok(outcome.record.woundedIds.every(id => world.healthConditions.some(condition => condition.characterId === id && condition.kind === 'травма')), 'каждый раненый должен получить состояние здоровья');
console.log(`OK BATTLE: ${outcome.record.rounds} раундов, погибло ${outcome.attackerDead + outcome.defenderDead}, ранено ${outcome.attackerWounded + outcome.defenderWounded}, пленено ${outcome.attackerCaptured + outcome.defenderCaptured}.`);
