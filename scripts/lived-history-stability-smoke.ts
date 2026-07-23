import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { inspectWorldIntegrity } from '../src/sim/integrity';

const cases = [
  { seed: 'lived-stability-century', years: 100, populationScale: .28 },
  { seed: 'lived-stability-two-centuries', years: 180, populationScale: .32 },
  { seed: 'lived-stability-long-age', years: 260, populationScale: .36 },
] as const;

const reports: string[] = [];
for (const scenario of cases) {
  const world = generateHistoricalWorld({
    ...defaultConfig,
    seed: scenario.seed,
    historyYears: scenario.years,
    width: 18,
    height: 12,
    kingdomCount: 3,
    settlementCount: 8,
    populationScale: scenario.populationScale,
    monsterDensity: .05,
    artifactDensity: .05,
    ecologyDensity: .1,
    localMapSize: 96,
  });
  const genesis = world.history.genesis!;
  const living = world.characters.filter(character => character.alive).length;
  const activeExpeditions = world.settlementExpeditions.filter(expedition => ['forming', 'traveling', 'camped', 'returning'].includes(expedition.status));
  const activeCommunitiesWithoutPeople = world.politicalCommunities.filter(community =>
    ['integrated', 'frontier', 'autonomous', 'independent', 'organizing-state'].includes(community.status)
    && community.settlementIds.every(settlementId => (world.settlements.find(settlement => settlement.id === settlementId)?.population ?? 0) <= 3),
  );
  const collapsedCommunities = world.politicalCommunities.filter(community => community.status === 'collapsed');

  assert.ok(genesis.initialPopulation > 0, `${scenario.seed}: генезис должен начинаться с живых общин`);
  assert.equal(genesis.finalPopulation, living, `${scenario.seed}: отчёт генезиса должен совпадать с реальным населением`);
  assert.ok(living >= 1, `${scenario.seed}: сценарий должен либо сохранить хотя бы одну живую общину, либо иметь отдельный тест полного вымирания`);
  assert.ok(living <= genesis.initialPopulation * 10 + 500, `${scenario.seed}: население не должно взрываться без физической вместимости`);
  assert.deepEqual(activeExpeditions, [], `${scenario.seed}: исторический runner не должен оставлять экспедиции между мирами`);
  assert.deepEqual(activeCommunitiesWithoutPeople, [], `${scenario.seed}: мёртвая община должна быть закрыта, а не оставаться активной`);
  assert.ok(
    collapsedCommunities.length <= world.settlements.length * 6 + 12,
    `${scenario.seed}: политические общины не должны пересоздаваться каждый квартал (${collapsedCommunities.length})`,
  );

  for (const settlement of world.settlements) {
    assert.ok(
      world.events.some(event => event.kind === 'settlement' && event.entityRefs.some(ref => ref.kind === 'settlement' && ref.id === settlement.id)),
      `${scenario.seed}: у ${settlement.name} отсутствует причинное событие основания`,
    );
  }
  for (const kingdom of world.kingdoms) {
    assert.ok(
      world.territoryHistory.some(change => change.kingdomId === kingdom.id && change.reason === 'основание столицы'),
      `${scenario.seed}: у ${kingdom.name} отсутствует территориальное основание`,
    );
  }

  const integrity = inspectWorldIntegrity(world);
  assert.deepEqual(integrity.errors, [], `${scenario.seed}: ошибки целостности:\n${integrity.errors.join('\n')}`);
  reports.push(`${scenario.years} лет: ${genesis.initialPopulation}→${living}, ${world.settlements.length} поселений, ${world.kingdoms.length} держав`);
}

console.log(`OK LIVED HISTORY STABILITY: ${reports.join('; ')}.`);
