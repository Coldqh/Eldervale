import type { Building, DomesticHerd, DomesticSpecies, Establishment, Household, Settlement, WorldItem, WorldState } from '../types';
import { appendCausalEvent } from './causality';
import { addMaterialItem, refreshSettlementMaterialSummary } from './materialEconomy';
import { RNG } from './rng';
import { worldTick } from './scheduler';

interface SpeciesDefinition {
  feedPerAdultMonth: number;
  breedingMonth: number;
  reproductionRate: number;
  maturityRate: number;
  product?: { templateId: 'milk' | 'eggs'; perAdultMonth: number; months: number[] };
  woolPerAdult?: number;
  meatPerAdult: number;
  hidePerAdult: number;
  shelterMultiplier: number;
  regularCullRate: number;
}

const SPECIES: Record<DomesticSpecies, SpeciesDefinition> = {
  куры: {
    feedPerAdultMonth: .035, breedingMonth: 4, reproductionRate: .42, maturityRate: .82,
    product: { templateId: 'eggs', perAdultMonth: .34, months: [2, 3, 4, 5, 6, 7, 8, 9, 10] },
    meatPerAdult: .12, hidePerAdult: 0, shelterMultiplier: 5, regularCullRate: .12,
  },
  козы: {
    feedPerAdultMonth: .12, breedingMonth: 3, reproductionRate: .32, maturityRate: .72,
    product: { templateId: 'milk', perAdultMonth: .24, months: [3, 4, 5, 6, 7, 8, 9, 10] },
    meatPerAdult: .45, hidePerAdult: .18, shelterMultiplier: 2.2, regularCullRate: .08,
  },
  овцы: {
    feedPerAdultMonth: .14, breedingMonth: 3, reproductionRate: .35, maturityRate: .7,
    woolPerAdult: .22, meatPerAdult: .48, hidePerAdult: .2, shelterMultiplier: 2.1, regularCullRate: .08,
  },
  коровы: {
    feedPerAdultMonth: .48, breedingMonth: 4, reproductionRate: .16, maturityRate: .64,
    product: { templateId: 'milk', perAdultMonth: .95, months: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
    meatPerAdult: 1.8, hidePerAdult: .75, shelterMultiplier: .9, regularCullRate: .05,
  },
  лошади: {
    feedPerAdultMonth: .42, breedingMonth: 4, reproductionRate: .11, maturityRate: .58,
    meatPerAdult: 0, hidePerAdult: 0, shelterMultiplier: .8, regularCullRate: 0,
  },
};

const FEED_TEMPLATES = ['straw', 'barley', 'grain', 'rye', 'wheat', 'vegetables'] as const;
const clamp = (value: number, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, value));
const herdCount = (herd: DomesticHerd) => Math.max(0, herd.adults) + Math.max(0, herd.young);

function tickYear(tick: number): number { return Math.floor(tick / 12); }
function tickMonth(tick: number): number { return tick % 12 + 1; }

function elapsedTicks(herd: DomesticHerd, currentTick: number): number[] {
  const from = Math.max(0, Math.min(currentTick - 1, herd.lastTick));
  const result: number[] = [];
  for (let tick = from + 1; tick <= currentTick; tick += 1) result.push(tick);
  return result;
}

function preferredEstablishment(world: WorldState, settlementId: number, species: DomesticSpecies): Establishment | undefined {
  const local = world.establishments.filter(item => item.active && item.settlementId === settlementId);
  const order = species === 'лошади' ? ['конюшня', 'ферма'] : ['ферма', 'конюшня'];
  for (const type of order) {
    const match = local.find(item => item.type === type);
    if (match) return match;
  }
  return local.find(item => item.type === 'склад') ?? local[0];
}

function preferredBuilding(world: WorldState, settlementId: number, species: DomesticSpecies, establishment?: Establishment): Building | undefined {
  if (establishment) {
    const building = world.buildings.find(item => item.id === establishment.buildingId);
    if (building) return building;
  }
  const local = world.buildings.filter(item => item.settlementId === settlementId && item.condition > 0);
  const order = species === 'лошади' ? ['stable', 'farm', 'warehouse'] : ['farm', 'stable', 'warehouse'];
  for (const type of order) {
    const match = local.find(item => item.type === type);
    if (match) return match;
  }
  return local[0];
}

function backfillCount(settlement: Settlement, species: DomesticSpecies): number {
  const legacy = Math.max(0, Math.round(settlement.livestock?.[species] ?? 0));
  if (legacy > 0) return legacy;
  const goats = Math.max(0, Math.round(settlement.livestock?.козы ?? 0));
  if (species === 'овцы' && goats > 0) return Math.max(1, Math.round(goats * .65));
  if (species === 'коровы' && settlement.population >= 90) return Math.max(1, Math.round(settlement.population / 95));
  return 0;
}

export function initializeLivestockSystem(world: WorldState, rng: RNG): void {
  world.domesticHerds ??= [];
  world.nextIds.domesticHerd ??= Math.max(0, ...world.domesticHerds.map(item => item.id)) + 1;
  const existing = new Set(world.domesticHerds.map(item => `${item.settlementId}:${item.species}`));
  const currentTick = worldTick(world);

  for (const settlement of world.settlements) {
    for (const species of Object.keys(SPECIES) as DomesticSpecies[]) {
      const key = `${settlement.id}:${species}`;
      if (existing.has(key)) continue;
      const count = backfillCount(settlement, species);
      if (count <= 0) continue;
      const establishment = preferredEstablishment(world, settlement.id, species);
      const building = preferredBuilding(world, settlement.id, species, establishment);
      if (!building) continue;
      const young = Math.min(count - 1, Math.max(0, Math.round(count * (species === 'куры' ? .22 : .14))));
      const herd: DomesticHerd = {
        id: world.nextIds.domesticHerd++, settlementId: settlement.id, buildingId: building.id, establishmentId: establishment?.id,
        species, adults: Math.max(1, count - young), young, health: rng.int(68, 91), nutrition: rng.int(62, 88),
        shelterQuality: clamp(Math.round(building.condition * .78 + (building.type === 'stable' ? 18 : 8))),
        lastTick: Math.max(0, currentTick - 1), history: [`Стадо учтено у ${building.name} в ${world.year}.${String(world.month).padStart(2, '0')}.`],
      };
      world.domesticHerds.push(herd);
      existing.add(key);
    }
  }
  refreshAllLivestockSummaries(world);
}

function itemsForFeed(world: WorldState, herd: DomesticHerd): WorldItem[] {
  const accepted = new Set<string>(FEED_TEMPLATES);
  return world.items
    .filter(item => item.settlementId === herd.settlementId && accepted.has(item.templateId) && item.quantity > .0001 && item.condition > 0)
    .sort((a, b) => {
      const preferredA = Number(a.establishmentId === herd.establishmentId || a.buildingId === herd.buildingId);
      const preferredB = Number(b.establishmentId === herd.establishmentId || b.buildingId === herd.buildingId);
      if (preferredA !== preferredB) return preferredB - preferredA;
      const householdA = Number(Boolean(a.householdId));
      const householdB = Number(Boolean(b.householdId));
      if (householdA !== householdB) return householdA - householdB;
      const feedRankA = FEED_TEMPLATES.indexOf(a.templateId as typeof FEED_TEMPLATES[number]);
      const feedRankB = FEED_TEMPLATES.indexOf(b.templateId as typeof FEED_TEMPLATES[number]);
      return feedRankA - feedRankB || a.freshness - b.freshness || a.id - b.id;
    });
}

function consumeFeed(world: WorldState, herd: DomesticHerd, quantity: number): number {
  let remaining = Math.max(0, quantity);
  for (const item of itemsForFeed(world, herd)) {
    if (remaining <= .0001 || item.householdId) break;
    const used = Math.min(item.quantity, remaining);
    item.quantity -= used;
    remaining -= used;
    item.history.push(`${used.toFixed(2)} ед. израсходовано на корм для стада «${herd.species}».`);
  }
  return Math.max(0, quantity - remaining);
}

function grazingCoverage(world: WorldState, herd: DomesticHerd, tick: number): number {
  if (herd.species === 'куры') return .12;
  const settlement = world.settlements.find(item => item.id === herd.settlementId);
  if (!settlement) return 0;
  const terrain = world.tiles[settlement.y * world.config.width + settlement.x]?.terrain;
  const month = tickMonth(tick);
  if (![4, 5, 6, 7, 8, 9, 10].includes(month)) return terrain === 'tundra' ? 0 : .08;
  if (terrain === 'plains' || terrain === 'forest' || terrain === 'marsh') return .62;
  if (terrain === 'hills' || terrain === 'coast') return .48;
  if (terrain === 'tundra') return .25;
  if (terrain === 'desert') return .18;
  return .35;
}

function shelterCapacity(world: WorldState, herd: DomesticHerd): number {
  const building = world.buildings.find(item => item.id === herd.buildingId);
  const definition = SPECIES[herd.species];
  if (!building) return 0;
  return Math.max(2, Math.floor(building.capacity * definition.shelterMultiplier));
}

function workersForHerd(world: WorldState, herd: DomesticHerd): number[] {
  const establishment = herd.establishmentId ? world.establishments.find(item => item.id === herd.establishmentId) : undefined;
  if (!establishment) return [];
  return [...new Set([establishment.ownerCharacterId, ...establishment.workerIds])]
    .filter(id => world.characters.some(character => character.id === id && character.alive && character.age >= 12));
}

function laborFactor(world: WorldState, herd: DomesticHerd): number {
  const workerIds = workersForHerd(world, herd);
  if (!workerIds.length) return .28;
  const skill = workerIds.reduce((sum, id) => {
    const worker = world.characters.find(item => item.id === id);
    return sum + Math.max(5, worker?.skills.farmer ?? 0);
  }, 0) / workerIds.length;
  const required = Math.max(1, Math.ceil(herdCount(herd) / (herd.species === 'куры' ? 24 : 10)));
  return clamp((workerIds.length / required) * (.72 + skill / 180), .25, 1.15);
}

function productOwner(world: WorldState, herd: DomesticHerd): { establishmentId?: number; buildingId?: number } {
  const establishment = herd.establishmentId ? world.establishments.find(item => item.id === herd.establishmentId && item.active) : undefined;
  return establishment ? { establishmentId: establishment.id, buildingId: establishment.buildingId } : { buildingId: herd.buildingId };
}

function workerHouseholds(world: WorldState, herd: DomesticHerd): Household[] {
  const ids = new Set<number>();
  for (const workerId of workersForHerd(world, herd)) {
    const worker = world.characters.find(item => item.id === workerId);
    if (worker?.householdId) ids.add(worker.householdId);
  }
  return [...ids]
    .map(id => world.households.find(item => item.id === id))
    .filter((item): item is Household => Boolean(item && item.settlementId === herd.settlementId))
    .sort((a, b) => a.id - b.id);
}

function createProduct(world: WorldState, herd: DomesticHerd, templateId: string, quantity: number, source: string, quality: number, workerShareRatio: number): number {
  if (quantity <= .0001) return 0;
  const households = workerHouseholds(world, herd);
  const workerShare = households.length ? quantity * workerShareRatio : 0;
  if (workerShare > .0001) {
    const perHousehold = workerShare / households.length;
    for (const household of households) {
      addMaterialItem(world, templateId, perHousehold, herd.settlementId, { householdId: household.id, buildingId: household.homeBuildingId },
        `натуральная доля животноводов; ${source}`, quality, undefined, true);
    }
  }
  addMaterialItem(world, templateId, quantity - workerShare, herd.settlementId, productOwner(world, herd), source, quality, undefined, true);
  return quantity;
}

function matureYoung(herd: DomesticHerd, year: number): number {
  if (herd.lastMaturityYear === year || herd.young <= 0) return 0;
  const matured = Math.max(0, Math.floor(herd.young * SPECIES[herd.species].maturityRate));
  herd.young -= matured;
  herd.adults += matured;
  herd.lastMaturityYear = year;
  if (matured) herd.history.push(`В ${year} году ${matured} молодых животных вошли во взрослое стадо.`);
  return matured;
}

function breedHerd(herd: DomesticHerd, year: number, rng: RNG, labor: number): number {
  if (herd.lastBirthYear === year || herd.adults < 2 || herd.health < 48 || herd.nutrition < 45) return 0;
  const definition = SPECIES[herd.species];
  const births = Math.max(0, Math.floor(herd.adults * definition.reproductionRate * clamp(herd.health / 100, .35, 1) * clamp(herd.nutrition / 100, .3, 1) * labor + rng.int(0, 1)));
  herd.young += births;
  herd.lastBirthYear = year;
  if (births) herd.history.push(`В ${year} году родилось ${births} молодых животных.`);
  return births;
}

function removeAnimals(herd: DomesticHerd, amount: number): number {
  let remaining = Math.max(0, Math.floor(amount));
  const youngLoss = Math.min(herd.young, Math.floor(remaining * .35));
  herd.young -= youngLoss;
  remaining -= youngLoss;
  const adultLoss = Math.min(herd.adults, remaining);
  herd.adults -= adultLoss;
  return youngLoss + adultLoss;
}

function cullHerd(world: WorldState, herd: DomesticHerd, amount: number, cause: string, quality: number): number {
  const definition = SPECIES[herd.species];
  const culled = Math.min(herd.adults, Math.max(0, Math.floor(amount)));
  if (culled <= 0) return 0;
  herd.adults -= culled;
  if (definition.meatPerAdult > 0) createProduct(world, herd, 'meat', culled * definition.meatPerAdult, `${cause}; стадо ${herd.species}`, quality, .15);
  if (definition.hidePerAdult > 0) createProduct(world, herd, 'raw_hide', culled * definition.hidePerAdult, `${cause}; стадо ${herd.species}`, Math.max(20, quality - 8), .08);
  herd.history.push(`${cause}: забито ${culled} взрослых животных.`);
  return culled;
}

function recordHerdCrisis(world: WorldState, herd: DomesticHerd, cause: string, deaths: number): void {
  if (deaths <= 0 && herd.health >= 35) return;
  appendCausalEvent(world, {
    kind: 'agriculture', title: `Кризис стада: ${herd.species}`, description: `В хозяйстве осталось ${herdCount(herd)} животных; здоровье стада ${Math.round(herd.health)}%.`,
    cause, conditions: [`питание ${Math.round(herd.nutrition)}%`, `укрытие ${Math.round(herd.shelterQuality)}%`],
    decision: 'животноводы сократили стадо и сохранили корм для выживших', outcome: deaths > 0 ? `погибло ${deaths} животных` : 'продуктивность резко упала',
    consequences: ['молока, яиц, шерсти и мяса станет меньше', 'цены на животную продукцию могут вырасти'],
    entityRefs: [{ kind: 'settlement', id: herd.settlementId }, { kind: 'building', id: herd.buildingId }], importance: 2,
  });
}

function advanceHerd(world: WorldState, herd: DomesticHerd, rng: RNG, currentTick: number): boolean {
  const ticks = elapsedTicks(herd, currentTick);
  if (!ticks.length || herdCount(herd) <= 0) { herd.lastTick = currentTick; return false; }
  const definition = SPECIES[herd.species];
  const labor = laborFactor(world, herd);
  const averageGrazing = ticks.reduce((sum, tick) => sum + grazingCoverage(world, herd, tick), 0) / ticks.length;
  const feedNeed = herdCount(herd) * definition.feedPerAdultMonth * ticks.length * (1 - averageGrazing);
  const fed = consumeFeed(world, herd, feedNeed);
  const feedRatio = feedNeed <= .0001 ? 1 : clamp(fed / feedNeed, 0, 1);
  herd.nutrition = clamp(herd.nutrition * .55 + feedRatio * 100 * .45);
  const capacity = shelterCapacity(world, herd);
  const crowding = capacity > 0 ? Math.max(0, herdCount(herd) / capacity - 1) : 1;
  const careDelta = labor >= .7 ? 1.2 : -(1 - labor) * 4;
  const feedDelta = feedRatio >= .82 ? 1.4 : -(1 - feedRatio) * 12;
  herd.health = clamp(herd.health + (careDelta + feedDelta - crowding * 8) * ticks.length);
  herd.shelterQuality = clamp(herd.shelterQuality - Math.max(.1, ticks.length * (.18 + crowding * .6)));

  let materialChanged = false;
  let births = 0;
  for (const tick of ticks) {
    const year = tickYear(tick);
    const month = tickMonth(tick);
    if (month === 1) matureYoung(herd, year);
    if (month === definition.breedingMonth) births += breedHerd(herd, year, rng, labor);
    if (definition.product?.months.includes(month) && herd.health >= 35 && herd.nutrition >= 35) {
      const productivity = clamp(herd.health / 100, .25, 1) * clamp(herd.nutrition / 100, .2, 1) * labor;
      const quantity = herd.adults * definition.product.perAdultMonth * productivity;
      materialChanged = createProduct(world, herd, definition.product.templateId, quantity,
        `${definition.product.templateId === 'milk' ? 'надой' : 'сбор яиц'} от стада ${herd.species} №${herd.id}`, Math.round(38 + herd.health * .45), .18) > 0 || materialChanged;
    }
    if (month === 6 && definition.woolPerAdult && herd.lastShearingYear !== year && herd.health >= 40) {
      const quantity = herd.adults * definition.woolPerAdult * clamp(herd.health / 100, .3, 1) * labor;
      materialChanged = createProduct(world, herd, 'wool', quantity, `стрижка стада ${herd.species} №${herd.id}`, Math.round(35 + herd.health * .5), .08) > 0 || materialChanged;
      herd.lastShearingYear = year;
    }
    if (month === 10 && herd.lastCullYear !== year && definition.regularCullRate > 0) {
      const overCapacity = Math.max(0, herdCount(herd) - capacity);
      const regular = Math.floor(herd.adults * definition.regularCullRate);
      const culled = cullHerd(world, herd, Math.max(overCapacity, regular), 'осенний отбор перед зимовкой', Math.round(35 + herd.health * .5));
      materialChanged = culled > 0 || materialChanged;
      herd.lastCullYear = year;
    }
  }

  const starvationPressure = Math.max(0, .42 - feedRatio) + Math.max(0, 32 - herd.health) / 80 + crowding * .08;
  const deaths = starvationPressure > .02 ? removeAnimals(herd, Math.floor(herdCount(herd) * starvationPressure * .16 * ticks.length + rng.int(0, 1))) : 0;
  if (deaths > 0) {
    herd.history.push(`Из-за нехватки корма, болезней или тесноты погибло ${deaths} животных.`);
    recordHerdCrisis(world, herd, feedRatio < .45 ? 'корма не хватило на зимовку стада' : crowding > .2 ? 'животных оказалось больше вместимости стойл' : 'ослабленное стадо поразили болезни', deaths);
  }
  if (births > 0 && births >= Math.max(2, Math.floor(herd.adults * .2))) {
    appendCausalEvent(world, {
      kind: 'agriculture', title: `Приплод в хозяйстве: ${herd.species}`, description: `Родилось ${births} молодых животных.`,
      cause: 'стадо получало достаточно корма и ухода', conditions: [`здоровье ${Math.round(herd.health)}%`, `питание ${Math.round(herd.nutrition)}%`],
      decision: 'хозяйство сохранило приплод для расширения стада', outcome: `численность молодняка выросла до ${herd.young}`,
      consequences: ['в будущем вырастет выпуск животной продукции', 'потребуется больше корма и места'],
      entityRefs: [{ kind: 'settlement', id: herd.settlementId }, { kind: 'building', id: herd.buildingId }], importance: 1,
    });
  }
  herd.lastTick = currentTick;
  return materialChanged || births > 0 || deaths > 0;
}

export function advanceLivestockSystem(world: WorldState, rng: RNG, settlementIds: ReadonlySet<number>): void {
  initializeLivestockSystem(world, new RNG(`${world.config.seed}:инициализация-стад:${world.year}:${world.month}`));
  const currentTick = worldTick(world);
  const changedSettlements = new Set<number>();
  for (const herd of world.domesticHerds ?? []) {
    if (!settlementIds.has(herd.settlementId)) continue;
    if (advanceHerd(world, herd, rng, currentTick)) changedSettlements.add(herd.settlementId);
  }
  for (const settlementId of settlementIds) refreshSettlementLivestockSummary(world, settlementId);
  for (const settlementId of changedSettlements) refreshSettlementMaterialSummary(world, settlementId);
}

export function refreshSettlementLivestockSummary(world: WorldState, settlementId: number): void {
  const settlement = world.settlements.find(item => item.id === settlementId);
  if (!settlement) return;
  const summary: Record<string, number> = {};
  for (const herd of world.domesticHerds ?? []) {
    if (herd.settlementId !== settlementId) continue;
    summary[herd.species] = (summary[herd.species] ?? 0) + herdCount(herd);
  }
  settlement.livestock = summary;
}

export function refreshAllLivestockSummaries(world: WorldState): void {
  for (const settlement of world.settlements) refreshSettlementLivestockSummary(world, settlement.id);
}

export function livestockIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const settlementIds = new Set(world.settlements.map(item => item.id));
  const buildingIds = new Set(world.buildings.map(item => item.id));
  const establishmentIds = new Set(world.establishments.map(item => item.id));
  const keys = new Set<string>();
  for (const herd of world.domesticHerds ?? []) {
    const key = `${herd.settlementId}:${herd.species}`;
    if (keys.has(key)) issues.push(`Стадо ${herd.id}: повторный источник истины для ${herd.species} в поселении ${herd.settlementId}.`);
    keys.add(key);
    if (!settlementIds.has(herd.settlementId)) issues.push(`Стадо ${herd.id}: не существует поселение.`);
    if (!buildingIds.has(herd.buildingId)) issues.push(`Стадо ${herd.id}: не существует физическое укрытие.`);
    if (herd.establishmentId && !establishmentIds.has(herd.establishmentId)) issues.push(`Стадо ${herd.id}: не существует хозяйство-владелец.`);
    if (herd.adults < 0 || herd.young < 0) issues.push(`Стадо ${herd.id}: отрицательная численность.`);
    if (herd.health < 0 || herd.health > 100 || herd.nutrition < 0 || herd.nutrition > 100) issues.push(`Стадо ${herd.id}: состояние вышло за пределы 0–100.`);
  }
  for (const settlement of world.settlements) {
    for (const species of Object.keys(SPECIES) as DomesticSpecies[]) {
      const physical = (world.domesticHerds ?? []).filter(item => item.settlementId === settlement.id && item.species === species).reduce((sum, item) => sum + herdCount(item), 0);
      const projected = settlement.livestock?.[species] ?? 0;
      if (Math.abs(physical - projected) > .001) issues.push(`${settlement.name}: сводка скота «${species}» не совпадает с физическими стадами.`);
    }
  }
  return [...new Set(issues)];
}
