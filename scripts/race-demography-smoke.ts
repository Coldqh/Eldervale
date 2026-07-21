import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { initializeRaceDemography, maintainRaceDemography, settlementRaceProfile } from '../src/sim/raceDemography';

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'eldervale-race-demography-suite',
  width: 18,
  height: 14,
  historyYears: 55,
  kingdomCount: 4,
  settlementCount: 10,
  populationScale: .18,
  monsterDensity: .15,
  artifactDensity: .15,
  ecologyDensity: .2,
});

initializeRaceDemography(world);

let mixedSettlements = 0;
for (const settlement of world.settlements) {
  const profile = settlementRaceProfile(world, settlement);
  const species = new Set(world.characters.filter(character => character.alive && character.settlementId === settlement.id).map(character => character.species));
  assert.ok(species.has(profile.primary), `${settlement.name}: основная раса государства должна присутствовать`);
  if (!profile.mixed) assert.deepEqual([...species], [profile.primary], `${settlement.name}: обычное поселение должно быть однорасовым`);
  else {
    mixedSettlements += 1;
    assert.ok(species.size <= 2, `${settlement.name}: редкое смешанное поселение не должно собирать все расы сразу`);
    assert.ok([...species].every(item => item === profile.primary || item === profile.minority), `${settlement.name}: допускается только основная раса и одно меньшинство`);
  }
}
assert.ok(mixedSettlements <= Math.max(1, Math.ceil(world.settlements.length * .2)), 'смешанных поселений пока должно быть мало');

for (const child of world.characters.filter(character => character.parentIds.length >= 2)) {
  const parents = child.parentIds.map(id => world.characters.find(character => character.id === id)).filter(Boolean);
  if (parents.length < 2) continue;
  const parentSpecies = new Set(parents.map(parent => parent!.species));
  assert.ok(parentSpecies.has(child.species), `${child.name}: ребёнок может наследовать только расу одного из родителей`);
  if (parentSpecies.size === 1) assert.equal(child.species, parents[0]!.species, `${child.name}: у родителей одной расы не может родиться ребёнок другой расы`);
}

const sameSpeciesParents = world.characters.filter(character => character.alive && character.age >= 18)
  .flatMap(parentA => world.characters.filter(parentB => parentB.id > parentA.id && parentB.alive && parentB.settlementId === parentA.settlementId && parentB.species === parentA.species).slice(0, 1).map(parentB => [parentA, parentB] as const))[0];
assert.ok(sameSpeciesParents, 'для проверки нужна пара одной расы');
const template = world.characters.find(character => character.alive && character.age < 14) ?? world.characters[0]!;
const newId = Math.max(...world.characters.map(character => character.id)) + 1;
world.characters.push({
  ...structuredClone(template),
  id: newId,
  name: 'Проверочный ребёнок',
  species: sameSpeciesParents![0].species === 'orc' ? 'elf' : 'orc',
  age: 0,
  birthYear: world.year,
  parentIds: [sameSpeciesParents![0].id, sameSpeciesParents![1].id],
  childIds: [],
  spouseId: undefined,
  relationshipIds: [],
  settlementId: sameSpeciesParents![0].settlementId,
  kingdomId: sameSpeciesParents![0].kingdomId,
  cultureProfile: undefined,
});
maintainRaceDemography(world);
assert.equal(world.characters.find(character => character.id === newId)!.species, sameSpeciesParents![0].species, 'новорождённый должен получить расу родителей, а не случайную третью');

console.log(`OK RACE DEMOGRAPHY: ${world.kingdoms.length} расовых государств, смешанных поселений ${mixedSettlements}/${world.settlements.length}.`);
