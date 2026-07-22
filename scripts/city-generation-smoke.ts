import assert from 'node:assert/strict';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { applyDailyLifePhaseToMap, routineStopForCharacter } from '../src/sim/dailyLife';
import { generateLocalMap } from '../src/lib/localMap';
import { inspectWorldIntegrity } from '../src/sim/integrity';
import type { BuildingType, WorldState } from '../src/types';

const zoning: Partial<Record<BuildingType, string[]>> = {
  market: ['рынок', 'центр', 'порт'], farm: ['поля', 'окраина'], mill: ['поля', 'окраина'], fishery: ['порт', 'окраина'],
  blacksmith: ['ремесленный район', 'окраина'], tannery: ['окраина', 'ремесленный район'], kiln: ['окраина', 'ремесленный район'],
  castle: ['крепость', 'центр'], barracks: ['крепость', 'окраина'], warehouse: ['окраина', 'порт', 'рынок'],
};

const config = {
  ...defaultConfig,
  width: 24,
  height: 18,
  historyYears: 42,
  kingdomCount: 3,
  settlementCount: 9,
  populationScale: .52,
  localMapSize: 96 as const,
  ecologyDensity: .25,
  huntingPressure: .8,
  monsterDensity: .15,
  artifactDensity: .15,
};

const first = generateHistoricalWorld({ ...config, seed: 'city-generation-v2-a' });
const repeat = generateHistoricalWorld({ ...config, seed: 'city-generation-v2-a' });
const second = generateHistoricalWorld({ ...config, seed: 'city-generation-v2-b' });

assert.equal(first.version, 30, 'новый мир должен использовать схему 30');
assert.deepEqual(citySignature(first), citySignature(repeat), 'одинаковый ключ должен давать одинаковый физический город');
assert.notDeepEqual(citySignature(first), citySignature(second), 'разные ключи должны менять планы и физическую застройку городов');

for (const world of [first, second]) {
  for (const settlement of world.settlements) {
    assert.equal(settlement.layout?.version, 1, `${settlement.name}: отсутствует постоянный план города`);
    assert.equal(settlement.layout?.districtPlans.length, settlement.districts.length, `${settlement.name}: план должен покрывать каждый район`);
  }
  assert.ok(world.buildings.every(building => building.spatialVersion === 2), 'новая генерация обязана размещать здания морфологическим генератором');
  verifyBuildingZoning(world);
  const integrity = inspectWorldIntegrity(world);
  const cityErrors = integrity.errors.filter(error => /пересекается|область выходит|морфологический план|план улиц|центр района/.test(error));
  assert.deepEqual(cityErrors, [], `физический город после генерации должен быть целостным:\n${cityErrors.join('\n')}`);
}

const styles = new Set([...first.settlements, ...second.settlements].flatMap(settlement => settlement.layout?.districtPlans.map(plan => plan.style) ?? []));
assert.ok(styles.size >= 4, `два мира должны содержать разные типы городской морфологии, получено: ${[...styles].join(', ')}`);

const roadSignatures = new Set<string>();
for (const world of [first, second]) {
  for (const settlement of world.settlements.slice(0, 5)) {
    for (const district of settlement.districts.slice(0, 2)) {
      const map = generateLocalMap(world, district.x, district.y);
      roadSignatures.add(`${settlement.layout?.districtPlans.find(plan => plan.globalX === district.x && plan.globalY === district.y)?.style}:${map.cells.filter(cell => cell.ground === 'road').length}`);
    }
  }
}
assert.ok(roadSignatures.size >= 5, 'локальные карты должны иметь разные дорожные структуры');

const crowdedSettlement = [...first.settlements].sort((a, b) => b.population - a.population)[0]!;
const unemployed = first.characters
  .filter(character => character.alive && character.settlementId === crowdedSettlement.id && character.age >= 16)
  .slice(0, 178);
assert.ok(unemployed.length >= 120, 'тестовый город должен содержать достаточно взрослых жителей для проверки толпы');
for (const character of unemployed) {
  character.workplaceBuildingId = undefined;
  character.employerEstablishmentId = undefined;
  character.employmentContractId = undefined;
  character.militaryUnitId = undefined;
  character.serviceStatus = undefined;
  character.profession = 'laborer';
  if (character.mind) character.mind.goals = [];
}
first.dailyRoutines = [];
const dayStops = unemployed.map(character => routineStopForCharacter(first, character, 'day'));
const uniqueStops = new Set(dayStops.map(stop => `${stop.globalX}:${stop.globalY}:${stop.localX}:${stop.localY}`));
assert.ok(uniqueStops.size >= Math.floor(unemployed.length * .45), `${unemployed.length} безработных не должны получать одну общую точку ожидания`);

let maxGroup = 0;
let maxCellPopulation = 0;
for (const key of new Set(dayStops.map(stop => `${stop.globalX}:${stop.globalY}`))) {
  const [x, y] = key.split(':').map(Number);
  const map = applyDailyLifePhaseToMap(first, generateLocalMap(first, x!, y!), 'day');
  const occupied = new Map<string, number>();
  for (const marker of map.markers.filter(marker => marker.kind === 'person' || marker.kind === 'group')) {
    const count = marker.count ?? 1;
    maxGroup = Math.max(maxGroup, marker.kind === 'group' ? count : 0);
    const coordinate = `${marker.x}:${marker.y}`;
    occupied.set(coordinate, (occupied.get(coordinate) ?? 0) + count);
  }
  maxCellPopulation = Math.max(maxCellPopulation, 0, ...occupied.values());
}
assert.ok(maxGroup <= 8, `скрытая толпа не должна сворачиваться в 99+, получена группа ${maxGroup}`);
assert.ok(maxCellPopulation <= 8, `одна клетка не должна содержать массовую очередь, получено ${maxCellPopulation}`);

console.log(`OK CITY GENERATION: ${styles.size} стилей, ${roadSignatures.size} дорожных профилей, ${unemployed.length} безработных распределены по ${uniqueStops.size} точкам, максимум ${maxCellPopulation} человек в клетке.`);

function citySignature(world: WorldState) {
  return {
    layouts: world.settlements.map(settlement => settlement.layout),
    buildings: world.buildings.map(building => [building.id, building.type, building.globalX, building.globalY, building.localX, building.localY, building.localWidth, building.localHeight, building.entranceX, building.entranceY]),
  };
}

function verifyBuildingZoning(world: WorldState): void {
  for (const settlement of world.settlements) {
    for (const [type, preferred] of Object.entries(zoning) as [BuildingType, string[]][]) {
      if (!settlement.districts.some(district => preferred.includes(district.role))) continue;
      const buildings = world.buildings.filter(item => item.settlementId === settlement.id && item.type === type);
      if (!buildings.length) continue;
      const placedInPreferredZone = buildings.filter(building => {
        const district = settlement.districts.find(item => item.x === building.globalX && item.y === building.globalY);
        return Boolean(district && preferred.includes(district.role));
      }).length;
      assert.ok(placedInPreferredZone >= Math.ceil(buildings.length * .5), `${settlement.name}: большинство зданий ${type} должно находиться в профильных районах`);
    }
  }
}
