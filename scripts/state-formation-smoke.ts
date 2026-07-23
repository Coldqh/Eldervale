import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { buildWorldIndexes } from '../src/sim/indexes';
import { inspectWorldIntegrity } from '../src/sim/integrity';
import { advanceStateFormation, foundKingdomFromCommunity, stateFormationIntegrityIssues } from '../src/sim/stateFormation';
import { RNG } from '../src/sim/rng';

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'state-formation-stable-4',
  width: 26,
  height: 18,
  historyYears: 54,
  kingdomCount: 3,
  settlementCount: 12,
  populationScale: .42,
  localMapSize: 96,
  monsterDensity: .08,
  artifactDensity: .08,
  ecologyDensity: .18,
});

assert.equal(world.version, 32, 'новый мир должен использовать схему 32');
assert.equal(world.politicalCommunities.length, world.settlements.length, 'каждое исходное поселение должно получить политическую общину');
assert.ok(world.settlements.every(settlement => world.politicalCommunities.some(community => community.id === settlement.politicalCommunityId && community.settlementIds.includes(settlement.id))), 'поселения должны ссылаться на реальную общину');
assert.deepEqual(stateFormationIntegrityIssues(world), [], 'исходные политические общины должны быть целостными');

const leagueWorld = structuredClone(world);
leagueWorld.month = 1;
const pair = findCompatiblePair(leagueWorld);
assert.ok(pair, 'для проверки нужен соседний союз общин одной цивилизации');
for (const community of pair!) {
  community.status = 'autonomous';
  community.authority = 94;
  community.cohesion = 94;
  community.legitimacy = 86;
  community.autonomy = 78;
  community.militarySupport = 72;
  community.independencePressure = 68;
  community.createdTick = 0;
}
const leagueResult = advanceStateFormation(leagueWorld, new RNG('state-league-turn'), buildWorldIndexes(leagueWorld), { allowTransitions: true, elapsedMonths: 1 });
assert.ok(leagueResult.leagues >= 1, 'соседние самостоятельные общины должны уметь создать политический союз');
const league = leagueWorld.politicalCommunities.find(community => ['city-league', 'tribal-confederation'].includes(community.kind) && community.settlementIds.some(id => pair![0].settlementIds.includes(id)) && community.settlementIds.some(id => pair![1].settlementIds.includes(id)));
assert.ok(league, 'союз должен стать отдельным постоянным политическим субъектом');
assert.ok(pair!.every(community => community.status === 'merged' && community.successorCommunityId === league!.id), 'исходные общины должны ссылаться на политического преемника');

const candidateSettlement = [...world.settlements]
  .filter(settlement => settlement.id !== world.kingdoms.find(kingdom => kingdom.id === settlement.kingdomId)?.capitalId)
  .filter(settlement => world.settlements.filter(item => item.kingdomId === settlement.kingdomId).length >= 2)
  .sort((a, b) => b.population - a.population || b.defense - a.defense || a.id - b.id)[0];
assert.ok(candidateSettlement, 'для проверки отделения требуется нестоличная община');
const community = world.politicalCommunities.find(item => item.id === candidateSettlement!.politicalCommunityId)!;
const predecessor = world.kingdoms.find(item => item.id === candidateSettlement!.kingdomId)!;
const oldKingdomCount = world.kingdoms.length;
const oldArmyCount = world.armies.length;
const oldGovernmentCount = world.kingdomGovernments.length;
const residents = world.characters.filter(character => character.alive && character.settlementId === candidateSettlement!.id);
assert.ok(residents.length >= 5, 'община должна иметь реальных жителей');

community.status = 'independent';
community.authority = 92;
community.cohesion = 91;
community.legitimacy = 88;
community.autonomy = 100;
community.militarySupport = 82;
community.independencePressure = 100;
community.treasury = 500;
const baselineErrors = new Set(inspectWorldIntegrity(world).errors);
const newKingdom = foundKingdomFromCommunity(world, community, new RNG('state-foundation-direct'), buildWorldIndexes(world));
assert.ok(newKingdom, 'самостоятельная жизнеспособная община должна основать новое государство');
assert.equal(world.kingdoms.length, oldKingdomCount + 1, 'в мире должен появиться новый государственный субъект');
assert.equal(candidateSettlement!.kingdomId, newKingdom!.id, 'община-основатель должна сменить государственную принадлежность');
assert.ok(residents.every(character => character.kingdomId === newKingdom!.id), 'подданство реальных жителей должно измениться вместе с поселением');
assert.equal(world.tiles.find(tile => tile.x === candidateSettlement!.x && tile.y === candidateSettlement!.y)?.kingdomId, newKingdom!.id, 'столица нового государства должна физически контролировать свою клетку');
assert.ok(world.kingdomGovernments.length > oldGovernmentCount && world.kingdomGovernments.some(state => state.kingdomId === newKingdom!.id), 'новое государство должно получить действующую государственную машину');
assert.ok(world.armies.length > oldArmyCount && world.armies.some(army => army.kingdomId === newKingdom!.id), 'новое государство должно получить реальное ополчение');
assert.ok(newKingdom!.predecessorKingdomIds?.includes(predecessor.id), 'новое государство должно хранить политического предшественника');
assert.equal(newKingdom!.foundingCommunityId, community.id, 'государство должно хранить общину-основателя');
assert.equal(community.foundedKingdomId, newKingdom!.id, 'община должна хранить основанное государство');
assert.ok(world.politicalTransitions.some(item => item.kind === 'state-foundation' && item.communityId === community.id && item.toKingdomId === newKingdom!.id), 'основание должно попасть в постоянную политическую историю');
assert.ok(predecessor.claims.includes(candidateSettlement!.id), 'прежняя держава должна сохранить спорное притязание на отделившуюся землю');
assert.ok(newKingdom!.diplomacy.some(item => item.kingdomId === predecessor.id && item.score < 0), 'отделение должно создать реальные напряжённые отношения');
assert.deepEqual(stateFormationIntegrityIssues(world), [], 'новое государство должно сохранить политические инварианты');
const introducedErrors = inspectWorldIntegrity(world).errors.filter(error => !baselineErrors.has(error));
assert.deepEqual(introducedErrors, [], `основание государства не должно создавать новые ошибки целостности:\n${introducedErrors.join('\n')}`);

console.log(`OK STATE FORMATION: ${league!.name}; ${community.name} основала ${newKingdom!.name}, получила правительство и ${world.armies.filter(army => army.kingdomId === newKingdom!.id).length} войско.`);

function findCompatiblePair(target: typeof world) {
  for (const left of target.politicalCommunities) {
    const leftSettlement = target.settlements.find(item => left.settlementIds.includes(item.id));
    if (!leftSettlement) continue;
    for (const right of target.politicalCommunities) {
      if (right.id <= left.id || right.currentKingdomId !== left.currentKingdomId) continue;
      if (left.civilizationId && right.civilizationId && left.civilizationId !== right.civilizationId) continue;
      if (left.cultureId && right.cultureId && left.cultureId !== right.cultureId) continue;
      const rightSettlement = target.settlements.find(item => right.settlementIds.includes(item.id));
      if (!rightSettlement || Math.hypot(leftSettlement.x - rightSettlement.x, leftSettlement.y - rightSettlement.y) > 7) continue;
      return [left, right] as const;
    }
  }
  return undefined;
}
