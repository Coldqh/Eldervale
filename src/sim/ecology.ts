import type { AlchemyRecipe, AnimalPopulation, Character, Establishment, NaturalIngredient, Terrain, WorldState } from '../types';
import { appendCausalEvent } from './causality';
import { RNG } from './rng';
import type { WorldIndexes } from './indexes';
import { addAnimalPopulationToIndexes, coordinateKey, nearbyTileKeys, rebuildAnimalIndexes, workers } from './indexes';
import { addMaterialItem, refreshSettlementMaterialSummary } from './materialEconomy';

interface AnimalDefinition {
  species: string;
  terrains: Terrain[];
  diet: AnimalPopulation['diet'];
  base: [number, number];
  reproduction: number;
  prey: string[];
  predators: string[];
}

const animals: AnimalDefinition[] = [
  { species: 'олень', terrains: ['forest', 'plains', 'hills'], diet: 'травоядное', base: [18, 90], reproduction: .22, prey: [], predators: ['волк', 'рысь', 'пещерный медведь'] },
  { species: 'кабан', terrains: ['forest', 'marsh', 'hills'], diet: 'всеядное', base: [10, 55], reproduction: .28, prey: [], predators: ['волк', 'пещерный медведь'] },
  { species: 'заяц', terrains: ['plains', 'forest', 'tundra'], diet: 'травоядное', base: [35, 180], reproduction: .42, prey: [], predators: ['волк', 'рысь', 'степной орёл'] },
  { species: 'горный козёл', terrains: ['hills', 'mountains'], diet: 'травоядное', base: [12, 70], reproduction: .18, prey: [], predators: ['рысь', 'грифон'] },
  { species: 'северный олень', terrains: ['tundra'], diet: 'травоядное', base: [25, 130], reproduction: .2, prey: [], predators: ['волк'] },
  { species: 'болотный тур', terrains: ['marsh'], diet: 'травоядное', base: [8, 38], reproduction: .14, prey: [], predators: ['болотный змей'] },
  { species: 'волк', terrains: ['forest', 'plains', 'hills', 'tundra'], diet: 'хищник', base: [4, 24], reproduction: .12, prey: ['олень', 'кабан', 'заяц', 'северный олень'], predators: [] },
  { species: 'рысь', terrains: ['forest', 'hills', 'mountains'], diet: 'хищник', base: [2, 10], reproduction: .08, prey: ['заяц', 'олень', 'горный козёл'], predators: [] },
  { species: 'пещерный медведь', terrains: ['forest', 'hills', 'mountains'], diet: 'всеядное', base: [1, 6], reproduction: .04, prey: ['олень', 'кабан'], predators: [] },
  { species: 'степной орёл', terrains: ['plains', 'hills', 'desert'], diet: 'хищник', base: [2, 12], reproduction: .08, prey: ['заяц'], predators: [] },
  { species: 'песчаная антилопа', terrains: ['desert'], diet: 'травоядное', base: [12, 65], reproduction: .18, prey: [], predators: ['пустынная гиена'] },
  { species: 'пустынная гиена', terrains: ['desert'], diet: 'хищник', base: [3, 17], reproduction: .1, prey: ['песчаная антилопа'], predators: [] },
  { species: 'береговой тюлень', terrains: ['coast'], diet: 'хищник', base: [8, 48], reproduction: .12, prey: ['рыба'], predators: [] },
];

interface IngredientDefinition {
  name: string;
  terrains: Terrain[];
  kind: NaturalIngredient['kind'];
  properties: string[];
  toxicity: number;
  seasons: number[];
}

const ingredients: IngredientDefinition[] = [
  { name: 'серебряный тысячелистник', terrains: ['plains', 'hills'], kind: 'растение', properties: ['заживление', 'снижение жара'], toxicity: 4, seasons: [4, 5, 6, 7, 8] },
  { name: 'кровавый мох', terrains: ['forest', 'marsh'], kind: 'растение', properties: ['свёртывание крови', 'раздражение'], toxicity: 24, seasons: [3, 4, 5, 6, 7, 8, 9] },
  { name: 'лунный гриб', terrains: ['forest', 'marsh'], kind: 'гриб', properties: ['сон', 'видения'], toxicity: 38, seasons: [8, 9, 10, 11] },
  { name: 'горький корень', terrains: ['plains', 'forest', 'hills'], kind: 'растение', properties: ['противоядие', 'тошнота'], toxicity: 12, seasons: [2, 3, 4, 9, 10] },
  { name: 'ледяной лишайник', terrains: ['tundra', 'mountains'], kind: 'растение', properties: ['охлаждение', 'замедление'], toxicity: 18, seasons: [1, 2, 10, 11, 12] },
  { name: 'огненная соль', terrains: ['desert', 'mountains'], kind: 'минерал', properties: ['нагрев', 'воспламенение'], toxicity: 31, seasons: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { name: 'болотная желчь', terrains: ['marsh'], kind: 'животный компонент', properties: ['яд', 'разложение'], toxicity: 68, seasons: [3, 4, 5, 6, 7, 8, 9] },
  { name: 'янтарная смола', terrains: ['forest'], kind: 'растение', properties: ['сохранение', 'связующее вещество'], toxicity: 2, seasons: [5, 6, 7, 8] },
  { name: 'каменный цветок', terrains: ['hills', 'mountains'], kind: 'минерал', properties: ['укрепление', 'минеральная соль'], toxicity: 9, seasons: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { name: 'морская полынь', terrains: ['coast'], kind: 'растение', properties: ['дыхание', 'очищение'], toxicity: 15, seasons: [4, 5, 6, 7, 8, 9] },
  { name: 'чёрная ягода', terrains: ['forest', 'tundra'], kind: 'растение', properties: ['бодрость', 'слабый яд'], toxicity: 27, seasons: [7, 8, 9] },
];

export function generateAnimalPopulations(worldSeed: string, tiles: WorldState['tiles'], density: number): AnimalPopulation[] {
  const result: AnimalPopulation[] = [];
  let id = 1;
  for (const tile of tiles) {
    if (tile.terrain === 'ocean') continue;
    const rng = new RNG(`${worldSeed}:животные:${tile.x}:${tile.y}`);
    const candidates = animals.filter(definition => definition.terrains.includes(tile.terrain));
    if (!candidates.length) continue;
    const count = Math.max(1, Math.min(candidates.length, Math.round((rng.int(1, 2) + (rng.chance(.3) ? 1 : 0)) * density)));
    const selected = [...candidates].sort(() => rng.next() - .5).slice(0, count);
    for (const definition of selected) {
      const baseCount = rng.int(definition.base[0], definition.base[1]);
      const carryingCapacity = Math.max(baseCount, Math.round(baseCount * rng.int(130, 230) / 100));
      result.push({
        id: id++, species: definition.species, x: tile.x, y: tile.y, count: baseCount, carryingCapacity,
        diet: definition.diet, preySpecies: definition.prey, predatorSpecies: definition.predators,
        reproductionRate: definition.reproduction, migrationDrive: rng.int(5, 35), health: rng.int(70, 100),
        huntedThisYear: 0, lastCause: 'подходящий биом и доступная пища', history: [`Популяция сформировалась в клетке ${tile.x}:${tile.y}.`],
      });
    }
  }
  return result;
}

export function generateNaturalIngredients(worldSeed: string, tiles: WorldState['tiles'], density: number): NaturalIngredient[] {
  const result: NaturalIngredient[] = [];
  let id = 1;
  for (const tile of tiles) {
    if (tile.terrain === 'ocean') continue;
    const rng = new RNG(`${worldSeed}:ресурсы:${tile.x}:${tile.y}`);
    const candidates = ingredients.filter(definition => definition.terrains.includes(tile.terrain));
    if (!candidates.length || !rng.chance(Math.min(1, .62 * density))) continue;
    const selected = [...candidates].sort(() => rng.next() - .5).slice(0, rng.chance(.22 * density) ? 2 : 1);
    for (const definition of selected) {
      const abundance = rng.int(24, 92);
      result.push({
        id: id++, name: definition.name, x: tile.x, y: tile.y, kind: definition.kind, abundance,
        carryingCapacity: rng.int(Math.max(abundance, 65), 150), regenerationRate: rng.int(4, 16), seasonMonths: definition.seasons,
        properties: definition.properties, toxicity: definition.toxicity, harvestedThisYear: 0,
        history: [`Источник обнаружен в клетке ${tile.x}:${tile.y}.`],
      });
    }
  }
  return result;
}

export function generateAlchemyRecipes(world: Pick<WorldState, 'ingredients' | 'characters' | 'year'>, rng: RNG): AlchemyRecipe[] {
  const specialists = world.characters.filter(character => character.age >= 18 && ['herbalist', 'healer', 'brewer'].includes(character.profession));
  const distinct = [...new Map(world.ingredients.map(item => [item.name, item])).values()];
  if (distinct.length < 2) return [];
  const result: AlchemyRecipe[] = [];
  const count = Math.min(28, Math.max(8, Math.round(distinct.length * .8)));
  const effects = [
    ['лечебная настойка', 'ускоряет заживление ран', 'передозировка вызывает слабость'],
    ['жаропонижающий отвар', 'снижает жар и облегчает болезнь', 'ошибка дозировки вызывает озноб'],
    ['охотничий яд', 'ослабляет зверя после попадания в кровь', 'опасен для изготовителя'],
    ['противоядие', 'связывает распространённые природные яды', 'не действует на неизвестные токсины'],
    ['дымная смесь', 'создаёт густой раздражающий дым', 'может воспламениться'],
    ['укрепляющее масло', 'защищает кожу и дерево от повреждений', 'легко портится'],
    ['сонный порошок', 'вызывает сонливость', 'в большой дозе останавливает дыхание'],
  ] as const;
  for (let id = 1; id <= count; id += 1) {
    const ingredientA = rng.pick(distinct);
    const ingredientB = rng.pick(distinct.filter(item => item.name !== ingredientA.name));
    const specialist = specialists.length ? rng.pick(specialists) : undefined;
    const [resultName, effect, risk] = rng.pick(effects);
    result.push({
      id, name: `${resultName}: ${ingredientA.name}`, ingredientIds: [ingredientA.id, ingredientB.id], result: resultName,
      effect, risk, discoveredById: specialist?.id, discoveryYear: rng.int(Math.max(1, world.year - 120), world.year),
      source: specialist ? `опыты ${specialist.name}` : 'старые записи неизвестного травника', batchesCreated: rng.int(0, 18),
      history: [`Рецепт возник из сочетания «${ingredientA.name}» и «${ingredientB.name}».`],
    });
  }
  return result;
}

export interface EcologyAdvanceOptions {
  settlementIds: ReadonlySet<number>;
  activeSettlementIds: ReadonlySet<number>;
  updateAnimals: boolean;
}

export function advanceEcology(world: WorldState, rng: RNG, indexes: WorldIndexes, options: EcologyAdvanceOptions): void {
  regenerateIngredients(world);
  if (options.updateAnimals) updateAnimalPopulations(world, rng, indexes);
  gatherResources(world, rng, indexes, options.settlementIds);
  huntAnimals(world, rng, indexes, options.settlementIds, options.activeSettlementIds);
  brewAlchemy(world, rng, indexes, options.settlementIds);
  if (world.month === 1) {
    for (const population of world.animalPopulations) population.huntedThisYear = 0;
    for (const ingredient of world.ingredients) ingredient.harvestedThisYear = 0;
  }
}

function regenerateIngredients(world: WorldState): void {
  for (const ingredient of world.ingredients) {
    if (!ingredient.seasonMonths.includes(world.month)) continue;
    ingredient.abundance = Math.min(ingredient.carryingCapacity, ingredient.abundance + Math.max(1, Math.round(ingredient.regenerationRate / 4)));
  }
}

function updateAnimalPopulations(world: WorldState, rng: RNG, indexes: WorldIndexes): void {
  rebuildAnimalIndexes(indexes, world.animalPopulations);
  const populations = [...world.animalPopulations];
  for (const population of populations) {
    const local = indexes.animalPopulationsByTile.get(coordinateKey(population.x, population.y)) ?? [];
    let prey = 0;
    let predators = 0;
    for (const item of local) {
      if (item.id === population.id) continue;
      if (population.preySpecies.includes(item.species)) prey += item.count;
      if (item.preySpecies.includes(population.species)) predators += item.count;
    }
    const foodFactor = population.diet === 'хищник' ? Math.min(1.25, prey / Math.max(5, population.count * 2)) : 1;
    const crowding = population.count / Math.max(1, population.carryingCapacity);
    const births = Math.max(0, Math.round(population.count * population.reproductionRate * foodFactor * Math.max(0, 1 - crowding) / 4));
    const crowdingMortality = Math.max(0, crowding - 1) * .16;
    const deaths = Math.max(0, Math.round(population.count * (.008 + predators / Math.max(100, population.count * 16) + (population.health < 45 ? .03 : 0) + crowdingMortality)));
    population.count = Math.max(0, population.count + births - deaths);
    population.health = Math.max(10, Math.min(100, population.health + (foodFactor > .55 ? 2 : -8) + rng.int(-2, 2)));
    population.migrationDrive = Math.max(0, Math.min(100, population.migrationDrive + (crowding > .88 ? 10 : -2) + (foodFactor < .45 ? 18 : 0)));

    if (population.count <= 0) {
      if (population.history.some(line => line.includes('местная популяция исчезла'))) continue;
      population.history.push(`К ${world.year} году местная популяция исчезла из-за ${population.lastCause}.`);
      appendCausalEvent(world, {
        kind: 'ecology', title: `Исчезла местная популяция: ${population.species}`, description: `В клетке ${population.x}:${population.y} больше не осталось устойчивой группы животных.`,
        cause: population.lastCause || 'охота, хищники и нехватка пищи', conditions: [`численность упала до нуля`, `здоровье популяции ${population.health}%`],
        decision: 'животные не смогли восстановить численность или уйти в безопасный район', outcome: 'локальная пищевая цепочка изменилась',
        consequences: ['хищники теряют часть добычи', 'охотники вынуждены искать другие земли'], entityRefs: [{ kind: 'animalPopulation', id: population.id }], importance: 3,
      });
      continue;
    }

    if (population.migrationDrive >= 85 && rng.chance(.12)) migratePopulation(world, population, rng, indexes);
  }
}

function migratePopulation(world: WorldState, population: AnimalPopulation, rng: RNG, indexes: WorldIndexes): void {
  const definition = animals.find(item => item.species === population.species);
  if (!definition) return;
  const neighbourKeys = [
    coordinateKey(population.x + 1, population.y), coordinateKey(population.x - 1, population.y),
    coordinateKey(population.x, population.y + 1), coordinateKey(population.x, population.y - 1),
  ];
  const suitable = neighbourKeys
    .map(key => indexes.tileByCoordinate.get(key))
    .filter((tile): tile is NonNullable<typeof tile> => Boolean(tile && tile.terrain !== 'ocean' && definition.terrains.includes(tile.terrain)))
    .filter(tile => {
      const resident = indexes.animalPopulationByTileAndSpecies.get(`${coordinateKey(tile.x, tile.y)}:${population.species}`);
      return !resident || resident.count < resident.carryingCapacity * .9;
    });
  if (!suitable.length) return;
  const destination = rng.pick(suitable);
  const destinationKey = coordinateKey(destination.x, destination.y);
  const resident = indexes.animalPopulationByTileAndSpecies.get(`${destinationKey}:${population.species}`);
  const desiredMove = Math.max(1, Math.round(population.count * rng.int(20, 45) / 100));
  const spareCapacity = resident ? Math.max(0, resident.carryingCapacity - resident.count) : desiredMove;
  const moved = Math.min(desiredMove, spareCapacity);
  if (moved <= 0) return;
  const previousDrive = population.migrationDrive;
  population.count -= moved;
  population.migrationDrive = 20;
  population.lastCause = 'нехватка пищи, давление хищников или перенаселение';
  let target = resident;
  if (!target) {
    const habitatCapacity = Math.max(moved, Math.round(population.carryingCapacity * rng.int(75, 115) / 100));
    target = { ...population, id: world.nextIds.animalPopulation++, x: destination.x, y: destination.y, count: 0, carryingCapacity: habitatCapacity, huntedThisYear: 0, history: [] };
    world.animalPopulations.push(target);
    addAnimalPopulationToIndexes(indexes, target);
  }
  target.count += moved;
  target.history.push(`В ${world.year} году прибыло ${moved} особей из клетки ${population.x}:${population.y}.`);
  const alreadyRecorded = population.history.some(line => line === `Миграция записана в ${world.year} году.`);
  if (moved >= 8 && !alreadyRecorded) {
    population.history.push(`Миграция записана в ${world.year} году.`);
    appendCausalEvent(world, {
      kind: 'migration', title: `${population.species}: миграция в клетку ${destination.x}:${destination.y}`,
      description: `${moved} особей покинули прежнюю территорию.`, cause: population.lastCause,
      conditions: [`миграционное давление достигло ${previousDrive}%`, `рядом нашёлся подходящий биом`],
      decision: 'стая или стадо переместилось в соседнюю клетку', outcome: `численность перераспределилась между клетками`,
      consequences: ['изменилась доступность добычи', 'охотничьи угодья сместились'], entityRefs: [{ kind: 'animalPopulation', id: population.id }, { kind: 'animalPopulation', id: target.id }], importance: 2,
    });
  }
}

function nearbyAnimalPopulations(indexes: WorldIndexes, x: number, y: number, radius: number): AnimalPopulation[] {
  const result: AnimalPopulation[] = [];
  for (const key of nearbyTileKeys(x, y, radius)) {
    for (const population of indexes.animalPopulationsByTile.get(key) ?? []) {
      if (Math.hypot(population.x - x, population.y - y) <= radius) result.push(population);
    }
  }
  return result;
}

function nearbyIngredients(indexes: WorldIndexes, x: number, y: number, radius: number): NaturalIngredient[] {
  const result: NaturalIngredient[] = [];
  for (const key of nearbyTileKeys(x, y, radius)) {
    for (const ingredient of indexes.ingredientsByTile.get(key) ?? []) {
      if (Math.hypot(ingredient.x - x, ingredient.y - y) <= radius) result.push(ingredient);
    }
  }
  return result;
}

interface HuntYield {
  meat: number;
  hides: number;
}

interface DeliveredHuntYield extends HuntYield {
  hunterRevenue: number;
}

const HUNT_YIELD_BY_SPECIES: Record<string, HuntYield> = {
  'заяц': { meat: .12, hides: .18 },
  'олень': { meat: 1.15, hides: 1 },
  'северный олень': { meat: 1.25, hides: 1 },
  'кабан': { meat: .9, hides: .72 },
  'горный козёл': { meat: .58, hides: .9 },
  'болотный тур': { meat: 2.4, hides: 1.2 },
  'песчаная антилопа': { meat: .68, hides: .88 },
  'береговой тюлень': { meat: .82, hides: .8 },
};

function physicalYield(species: string, killed: number): HuntYield {
  const perAnimal = HUNT_YIELD_BY_SPECIES[species] ?? { meat: .55, hides: .65 };
  return {
    meat: Math.max(.05, Math.round(killed * perAnimal.meat * 100) / 100),
    hides: Math.max(.05, Math.round(killed * perAnimal.hides * 100) / 100),
  };
}

function huntBuyer(indexes: WorldIndexes, settlementId: number, templateId: 'meat' | 'raw_hide'): Establishment | undefined {
  const priority = templateId === 'meat'
    ? ['продовольственная лавка', 'рынок', 'лавка', 'склад', 'таверна', 'постоялый двор']
    : ['кожевенная мастерская', 'рынок', 'склад', 'лавка'];
  const rank = new Map(priority.map((type, index) => [type, index]));
  return [...(indexes.establishmentsBySettlement.get(settlementId) ?? [])]
    .filter(establishment => establishment.active && rank.has(establishment.type))
    .sort((a, b) => (rank.get(a.type) ?? 999) - (rank.get(b.type) ?? 999) || b.cash - a.cash || a.id - b.id)[0];
}

function hunterHouseholdShares(hunters: Character[]): { householdId: number; weight: number }[] {
  const counts = new Map<number, number>();
  for (const hunter of hunters) if (hunter.householdId) counts.set(hunter.householdId, (counts.get(hunter.householdId) ?? 0) + 1);
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (!total) return [];
  return [...counts.entries()].map(([householdId, count]) => ({ householdId, weight: count / total }));
}

function payHunters(indexes: WorldIndexes, hunters: Character[], amount: number): void {
  if (amount <= .0001) return;
  const shares = hunterHouseholdShares(hunters);
  if (shares.length) {
    for (const share of shares) {
      const household = indexes.householdById.get(share.householdId);
      if (!household) continue;
      const payment = amount * share.weight;
      household.wealth += payment;
      household.monthlyIncome += payment;
    }
    return;
  }
  const leadHunter = hunters[0];
  if (leadHunter) leadHunter.wallet += amount;
}

function storeUnsoldHuntYield(
  world: WorldState, indexes: WorldIndexes, hunters: Character[], settlementId: number, templateId: 'meat' | 'raw_hide', quantity: number, quality: number, source: string,
): void {
  if (quantity <= .0001) return;
  const householdId = hunters.find(hunter => hunter.householdId)?.householdId;
  const household = householdId ? indexes.householdById.get(householdId) : undefined;
  const leadHunter = hunters[0];
  addMaterialItem(world, templateId, quantity, settlementId, household
    ? { householdId: household.id, buildingId: household.homeBuildingId }
    : leadHunter ? { ownerCharacterId: leadHunter.id } : {}, source, quality, indexes.itemById, false, leadHunter);
}

function sellOrStoreHuntYield(
  world: WorldState, indexes: WorldIndexes, hunters: Character[], settlementId: number, templateId: 'meat' | 'raw_hide', quantity: number, quality: number, species: string,
): number {
  if (quantity <= .0001) return 0;
  const buyer = huntBuyer(indexes, settlementId, templateId);
  const baseUnitPrice = templateId === 'meat' ? 14 : 10;
  const procurementUnitPrice = baseUnitPrice * (.42 + quality / 250);
  const purchased = buyer ? Math.min(quantity, buyer.cash / Math.max(.01, procurementUnitPrice)) : 0;
  let payment = 0;
  if (buyer && purchased > .0001) {
    payment = purchased * procurementUnitPrice;
    buyer.cash -= payment;
    buyer.monthlyExpenses += payment;
    payHunters(indexes, hunters, payment);
    addMaterialItem(world, templateId, purchased, settlementId, { establishmentId: buyer.id, buildingId: buyer.buildingId },
      `куплено у охотников после добычи ${species}`, quality, indexes.itemById);
  }
  const remainder = quantity - purchased;
  if (remainder > .0001) storeUnsoldHuntYield(world, indexes, hunters, settlementId, templateId, remainder, quality,
    `доля охотников после добычи ${species}`);
  return payment;
}

function deliverHuntYield(
  world: WorldState, rng: RNG, indexes: WorldIndexes, settlementId: number, hunters: Character[], species: string, killed: number,
): DeliveredHuntYield {
  const yieldAmount = physicalYield(species, killed);
  const averageSkill = hunters.reduce((sum, hunter) => sum + (hunter.skills.hunter ?? 0), 0) / Math.max(1, hunters.length);
  const quality = Math.max(32, Math.min(86, Math.round(42 + averageSkill * .42 + rng.int(-4, 6))));
  const hunterRevenue = sellOrStoreHuntYield(world, indexes, hunters, settlementId, 'meat', yieldAmount.meat, quality, species)
    + sellOrStoreHuntYield(world, indexes, hunters, settlementId, 'raw_hide', yieldAmount.hides, quality, species);
  refreshSettlementMaterialSummary(world, settlementId);
  return { ...yieldAmount, hunterRevenue };
}

function huntAnimals(world: WorldState, rng: RNG, indexes: WorldIndexes, settlementIds: ReadonlySet<number>, activeSettlementIds: ReadonlySet<number>): void {
  for (const settlementId of settlementIds) {
    const settlement = indexes.settlementById.get(settlementId);
    if (!settlement) continue;
    const hunters = workers(indexes, settlement.id, ['hunter']);
    if (!hunters.length) continue;
    const candidates = nearbyAnimalPopulations(indexes, settlement.x, settlement.y, 2.3)
      .filter(population => population.count > 2 && population.diet !== 'хищник');
    if (!candidates.length) continue;
    const target = candidates.reduce((best, item) => item.count > best.count ? item : best);
    const urgentFoodNeed = settlement.food < 45;
    const need = urgentFoodNeed ? 1.45 : 1;
    const elapsedMonths = activeSettlementIds.has(settlement.id) ? 1 : 3;
    const killed = Math.min(target.count - 1, Math.max(1, Math.round(hunters.length * world.config.huntingPressure * need * rng.int(1, 3) * Math.min(2, elapsedMonths * .7))));
    if (killed <= 0) continue;
    target.count -= killed;
    target.huntedThisYear += killed;
    target.lastCause = `охота жителей поселения ${settlement.name}`;
    const delivered = deliverHuntYield(world, rng, indexes, settlement.id, hunters, target.species, killed);
    const dangerous = rng.chance(.012 * hunters.length + (target.species.includes('кабан') ? .04 : 0));
    if (dangerous) {
      const victim = rng.pick(hunters);
      victim.health = Math.max(12, victim.health - rng.int(14, 42));
      victim.injuries.push(`рана на охоте на ${target.species}`);
      appendCausalEvent(world, {
        kind: 'hunt', title: `${victim.name} ранен на охоте`, description: `Охотники добыли ${killed} животных, но один из них получил тяжёлую рану.`,
        cause: `поселению ${settlement.name} требовались мясо и шкуры`, conditions: [`в угодьях было ${target.count + killed} животных`, `на охоту вышли ${hunters.length} охотников`],
        decision: `охотники выбрали добычу «${target.species}»`, outcome: `получено ${delivered.meat.toFixed(1)} туш мяса и ${delivered.hides.toFixed(1)} шкур, ${victim.name} ранен`,
        consequences: ['физическая добыча поступила семьям и покупателям', 'численность животных снизилась', 'охотник получил постоянный след'],
        entityRefs: [{ kind: 'settlement', id: settlement.id }, { kind: 'character', id: victim.id }, { kind: 'animalPopulation', id: target.id }], importance: 3,
      });
    } else if (killed >= 8 || settlement.food < 30) {
      appendCausalEvent(world, {
        kind: 'hunt', title: `Охотники ${settlement.name} вернулись с добычей`, description: `Добыто ${killed} животных вида «${target.species}».`,
        cause: urgentFoodNeed ? 'нехватка пищи' : 'спрос на мясо и шкуры', conditions: [`рядом существовала популяция из ${target.count + killed} особей`, `в поселении работали ${hunters.length} охотников`],
        decision: `охотники отправились в клетку ${target.x}:${target.y}`, outcome: `получено ${delivered.meat.toFixed(1)} туш мяса и ${delivered.hides.toFixed(1)} шкур${delivered.hunterRevenue > 0 ? `, охотники выручили ${delivered.hunterRevenue.toFixed(1)} крон` : ''}`,
        consequences: ['добыча существует как физические предметы', 'животная популяция сократилась'], entityRefs: [{ kind: 'settlement', id: settlement.id }, { kind: 'animalPopulation', id: target.id }], importance: 2,
      });
    }
  }
}

function gatherResources(world: WorldState, rng: RNG, indexes: WorldIndexes, settlementIds: ReadonlySet<number>): void {
  if (![4, 7, 10].includes(world.month)) return;
  for (const settlementId of settlementIds) {
    const settlement = indexes.settlementById.get(settlementId);
    if (!settlement) continue;
    const gatherers = workers(indexes, settlement.id, ['herbalist', 'healer', 'farmer']);
    if (!gatherers.length) continue;
    const candidates = nearbyIngredients(indexes, settlement.x, settlement.y, 2.2)
      .filter(ingredient => ingredient.abundance > 3 && ingredient.seasonMonths.includes(world.month));
    if (!candidates.length) continue;
    const source = rng.pick(candidates);
    const amount = Math.min(source.abundance, Math.max(1, Math.round(gatherers.length * rng.int(1, 3) * .55)));
    source.abundance -= amount;
    source.harvestedThisYear += amount;
    settlement.stockpile[source.name] = (settlement.stockpile[source.name] ?? 0) + amount;
    source.history.push(`В ${world.year} году жители ${settlement.name} собрали ${amount} единиц.`);
    if (source.abundance < source.carryingCapacity * .12 || amount >= 10) {
      appendCausalEvent(world, {
        kind: 'foraging', title: `Сбор: ${source.name}`, description: `Жители ${settlement.name} принесли ${amount} единиц сырья.`,
        cause: 'потребность лекарей, ремесленников и алхимиков в природном сырье', conditions: [`сезон подходит для сбора`, `источник имел запас ${source.abundance + amount}`],
        decision: `собиратели отправились в клетку ${source.x}:${source.y}`, outcome: `сырьё доставлено в ${settlement.name}`,
        consequences: ['запасы поселения пополнены', source.abundance < source.carryingCapacity * .12 ? 'источник истощён и будет восстанавливаться медленно' : 'источник сохранил часть запаса'],
        entityRefs: [{ kind: 'settlement', id: settlement.id }, { kind: 'ingredient', id: source.id }], importance: source.abundance < source.carryingCapacity * .12 ? 3 : 2,
      });
    }
  }
}

function brewAlchemy(world: WorldState, rng: RNG, indexes: WorldIndexes, settlementIds: ReadonlySet<number>): void {
  if (![4, 8, 12].includes(world.month)) return;
  for (const settlementId of settlementIds) {
    const settlement = indexes.settlementById.get(settlementId);
    if (!settlement) continue;
    const alchemists = workers(indexes, settlement.id, ['herbalist', 'healer', 'brewer']);
    if (!alchemists.length) continue;
    const available = world.alchemyRecipes.filter(recipe => recipe.ingredientIds.every(id => {
      const ingredient = indexes.ingredientById.get(id);
      return ingredient && (settlement.stockpile[ingredient.name] ?? 0) > 0;
    }));
    if (!available.length) continue;
    const recipe = rng.pick(available);
    for (const id of recipe.ingredientIds) {
      const ingredient = indexes.ingredientById.get(id)!;
      settlement.stockpile[ingredient.name] = Math.max(0, (settlement.stockpile[ingredient.name] ?? 0) - 1);
    }
    recipe.batchesCreated += 1;
    settlement.stockpile[recipe.result] = (settlement.stockpile[recipe.result] ?? 0) + 1;
    const maker = rng.pick(alchemists);
    const accident = rng.chance(.025 + recipe.ingredientIds.reduce((sum, id) => sum + (indexes.ingredientById.get(id)?.toxicity ?? 0), 0) / 3000);
    if (accident) {
      maker.health = Math.max(10, maker.health - rng.int(8, 35));
      maker.injuries.push(`алхимический ожог при создании «${recipe.name}»`);
      appendCausalEvent(world, {
        kind: 'alchemy', title: `Алхимический несчастный случай в ${settlement.name}`,
        description: `${maker.name} пострадал при изготовлении состава «${recipe.name}».`, cause: recipe.risk,
        conditions: ['ядовитые или нестабильные компоненты', `рецепт изготовлялся в ${settlement.name}`], decision: `${maker.name} провёл опасную обработку компонентов`,
        outcome: 'состав создан, но мастер получил травму', consequences: ['в запасах появился алхимический состав', 'алхимик ранен'],
        entityRefs: [{ kind: 'recipe', id: recipe.id }, { kind: 'character', id: maker.id }, { kind: 'settlement', id: settlement.id }], importance: 3,
      });
    } else if (recipe.batchesCreated === 1 || rng.chance(.08)) {
      appendCausalEvent(world, {
        kind: 'alchemy', title: `Создан состав «${recipe.name}»`, description: `${maker.name} изготовил ${recipe.result}.`,
        cause: 'наличие рецепта, сырья и обученного мастера', conditions: [`в запасах были все компоненты`, `${maker.name} владеет травничеством или лекарским делом`],
        decision: `мастер использовал рецепт «${recipe.name}»`, outcome: `состав «${recipe.result}» помещён в запасы поселения`,
        consequences: ['алхимические запасы выросли', 'часть природного сырья израсходована'], entityRefs: [{ kind: 'recipe', id: recipe.id }, { kind: 'character', id: maker.id }, { kind: 'settlement', id: settlement.id }], importance: 2,
      });
    }
  }
}

export function ecologyNear(world: WorldState, x: number, y: number): { animals: AnimalPopulation[]; ingredients: NaturalIngredient[] } {
  return {
    animals: world.animalPopulations.filter(item => item.x === x && item.y === y && item.count > 0),
    ingredients: world.ingredients.filter(item => item.x === x && item.y === y && item.abundance > 0),
  };
}

export function ecologyIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const tileKeys = new Set(world.tiles.map(tile => coordinateKey(tile.x, tile.y)));
  for (const population of world.animalPopulations) {
    if (!tileKeys.has(coordinateKey(population.x, population.y))) issues.push(`Популяция ${population.id} вне карты`);
    if (population.count < 0) issues.push(`Популяция ${population.id} имеет отрицательную численность`);
  }
  for (const ingredient of world.ingredients) {
    if (ingredient.abundance < 0 || ingredient.abundance > ingredient.carryingCapacity) issues.push(`Источник ${ingredient.id} имеет неверный запас`);
  }
  for (const settlement of world.settlements) {
  }
  return issues;
}
