import type {
  Army, Building, Character, Establishment, MilitaryRole, MilitaryUnit, MilitaryUnitType, Settlement, SupplyWagon,
  WorldItem, WorldState,
} from '../types';
import type { WorldIndexes } from './indexes';
import { appendCausalEvent } from './causality';
import { requestConstructionProject } from './agricultureConstruction';
import { addMaterialItem } from './materialEconomy';
import { archiveCharactersBatch } from './mortality';
import { hashSeed, RNG } from './rng';
import { controlledCapital, normalizeKingdomCapitals } from './kingdomState';

const MILITARY_VERSION = 1;
const ACTIVE_STATUSES = new Set<Army['status']>(['marching', 'hunting', 'raiding', 'battle']);
const COMBAT_TEMPLATES = new Set(['spear', 'sword', 'longbow', 'crossbow', 'lance', 'mace', 'gambeson', 'leather_armor', 'chainmail', 'padded_cap', 'iron_helmet', 'wooden_shield']);
const FOOD_TEMPLATES = ['military_rations', 'bread', 'smoked_meat', 'salted_fish', 'grain'];

interface UnitPlan { type: MilitaryUnitType; roles: MilitaryRole[]; size: number; }

interface MilitaryRuntime {
  characterById: Map<number, Character>;
  buildingById: Map<number, Building>;
  itemById: Map<number, WorldItem>;
  activeEmploymentByCharacter: Map<number, WorldState['employments'][number]>;
}

function createMilitaryRuntime(world: WorldState, indexes?: WorldIndexes): MilitaryRuntime {
  const activeEmploymentByCharacter = new Map<number, WorldState['employments'][number]>();
  for (const employment of world.employments) if (employment.active) activeEmploymentByCharacter.set(employment.characterId, employment);
  return {
    characterById: indexes?.characterById ?? new Map(world.characters.map(character => [character.id, character])),
    buildingById: indexes?.buildingById ?? new Map(world.buildings.map(building => [building.id, building])),
    itemById: indexes?.itemById ?? new Map(world.items.map(item => [item.id, item])),
    activeEmploymentByCharacter,
  };
}

const UNIT_PLANS: UnitPlan[] = [
  { type: 'штаб', roles: ['командир', 'офицер', 'сержант'], size: 8 },
  { type: 'рыцари', roles: ['рыцарь'], size: 18 },
  { type: 'конница', roles: ['всадник'], size: 24 },
  { type: 'стрелки', roles: ['лучник', 'арбалетчик'], size: 36 },
  { type: 'копейщики', roles: ['копейщик'], size: 44 },
  { type: 'пехота', roles: ['пехотинец'], size: 48 },
  { type: 'ополчение', roles: ['ополченец'], size: 54 },
];

export function initializeMilitaryInfrastructure(world: WorldState, rng = new RNG(`${world.config.seed}:военная-инфраструктура`), indexes?: WorldIndexes): void {
  world.militaryUnits ??= [];
  world.supplyWagons ??= [];
  world.nextIds.militaryUnit ??= Math.max(0, ...world.militaryUnits.map(item => item.id)) + 1;
  world.nextIds.supplyWagon ??= Math.max(0, ...world.supplyWagons.map(item => item.id)) + 1;
  world.simulation.militaryInfrastructureVersion ??= MILITARY_VERSION;
  normalizeKingdomCapitals(world);
  const runtime = createMilitaryRuntime(world, indexes);

  convertLegacyMilitaryBuildings(world);
  for (const kingdom of world.kingdoms) {
    const ruler = world.characters.find(item => item.id === kingdom.rulerId);
    if (ruler) ruler.visualRole = 'king';
  }

  for (const army of world.armies) {
    ensureArmyShape(world, army);
    const kingdom = world.kingdoms.find(item => item.id === army.kingdomId);
    const capital = kingdom ? controlledCapital(world, kingdom.id) : undefined;
    if (!kingdom || !capital) continue;
    attachMilitaryBuildings(world, army, capital, rng, indexes);
    recruitToArmy(world, army, capital, rng, indexes, runtime, true);
    rebuildUnits(world, army, rng, runtime);
    seedArsenal(world, army, capital, rng, runtime);
    equipArmy(world, army, rng, runtime);
    ensureSupplyWagons(world, army, capital, rng, runtime);
    synchronizeArmyStrength(world, army, runtime);
  }
}

function ensureArmyShape(world: WorldState, army: Army): void {
  army.soldierIds ??= [];
  army.unitIds ??= [];
  army.supplyWagonIds ??= [];
  army.inventoryItemIds ??= [];
  army.logistics ??= {
    foodDays: Math.max(8, Math.round(army.supplies * .65)), waterDays: Math.max(6, Math.round(army.supplies * .5)), medicine: 12,
    tents: 0, tools: 0, horses: 0, wagons: 0, equipmentCoverage: 0, armorCoverage: 0, rangedCoverage: 0,
    payrollDebt: 0, desertions: 0, wounded: 0,
  };
  army.monthlyPayroll ??= 0;
  army.readiness ??= 35;
  army.strength = Math.max(0, army.strength || world.kingdoms.find(item => item.id === army.kingdomId)?.armyStrength || 0);
}

function convertLegacyMilitaryBuildings(world: WorldState): void {
  for (const building of world.buildings) {
    const name = building.name.toLowerCase();
    if (building.type === 'public' && /королевская цитадель|(^|\s)цитадель|замок/.test(name)) building.type = 'castle';
    else if ((building.type === 'public' || building.type === 'warehouse') && /арсенал|оружейная/.test(name)) building.type = 'arsenal';
    else if (building.type === 'public' && /сторожев.*баш|дозорн.*баш/.test(name)) building.type = 'watchtower';
    else if (building.type === 'public' && /учебн.*двор|военн.*двор/.test(name)) building.type = 'barracks';
  }
}

function attachMilitaryBuildings(world: WorldState, army: Army, capital: Settlement, rng: RNG, indexes?: WorldIndexes): void {
  const buildings = world.buildings.filter(item => item.settlementId === capital.id);
  const castle = buildings.find(item => item.type === 'castle');
  const barracks = buildings.find(item => item.type === 'barracks');
  const arsenal = buildings.find(item => item.type === 'arsenal');
  army.castleBuildingId = castle?.id;
  army.garrisonBuildingId = barracks?.id ?? castle?.id;
  army.arsenalBuildingId = arsenal?.id ?? castle?.id;

  if (!army.garrisonBuildingId && world.month === 1) requestConstructionProject(world, capital, 'barracks', 'государству негде размещать и обучать постоянный гарнизон', rng);
  if (!army.arsenalBuildingId && world.month === 1) requestConstructionProject(world, capital, 'arsenal', 'оружие и доспехи армии хранятся в случайных складах', rng);
  if (!army.castleBuildingId && ['city', 'fortress'].includes(capital.type) && world.month === 1) {
    requestConstructionProject(world, capital, 'castle', 'правителю и столичному гарнизону нужен защищённый центр власти', rng);
  }

  for (const building of [castle, barracks, arsenal].filter((item): item is Building => Boolean(item))) ensureMilitaryEstablishment(world, building, army, capital, rng, indexes);
}

function ensureMilitaryEstablishment(world: WorldState, building: Building, army: Army, settlement: Settlement, rng: RNG, indexes?: WorldIndexes): Establishment {
  const existing = building.establishmentId ? world.establishments.find(item => item.id === building.establishmentId) : world.establishments.find(item => item.buildingId === building.id);
  if (existing) return existing;
  const type: Establishment['type'] = building.type === 'castle' ? 'замковое хозяйство' : building.type === 'arsenal' ? 'арсенал' : building.type === 'siegeWorkshop' ? 'осадная мастерская' : 'казарма';
  const owner = world.characters.find(item => item.id === (building.type === 'castle' ? world.kingdoms.find(k => k.id === army.kingdomId)?.rulerId : army.commanderId))
    ?? world.characters.find(item => item.kingdomId === army.kingdomId && item.alive)!;
  const establishment: Establishment = {
    id: world.nextIds.establishment++, settlementId: settlement.id, buildingId: building.id, name: building.name, type,
    ownerCharacterId: owner.id, workerIds: [], supplierEstablishmentIds: [], customerHouseholdIds: [], inventoryItemIds: [],
    recipeIds: world.productionRecipes.filter(recipe => recipe.establishmentTypes.includes(type)).map(recipe => recipe.id),
    openHour: 0, closeHour: 24, reputation: 65, cash: Math.max(25, world.kingdoms.find(item => item.id === army.kingdomId)?.treasury ?? 25),
    debt: 0, monthlyRevenue: 0, monthlyExpenses: 0, active: true, menu: {}, history: [`Военное учреждение действует не позднее ${world.year} года.`],
  };
  world.establishments.push(establishment);
  settlement.establishmentIds.push(establishment.id);
  building.establishmentId = establishment.id;
  building.ownerCharacterId = owner.id;
  indexes?.establishmentById.set(establishment.id, establishment);
  const list = indexes?.establishmentsBySettlement.get(settlement.id);
  if (list) list.push(establishment);
  return establishment;
}

function militaryCapacity(world: WorldState, army: Army, capital: Settlement, runtime: MilitaryRuntime): number {
  const buildings = world.buildings.filter(item => item.settlementId === capital.id && ['barracks', 'castle'].includes(item.type) && item.condition > 25);
  const capacity = buildings.reduce((sum, item) => sum + item.capacity, 0);
  const adults = world.characters.filter(item => item.alive && item.kingdomId === army.kingdomId && item.age >= 17 && item.age <= 52).length;
  const kingdom = world.kingdoms.find(item => item.id === army.kingdomId);
  return Math.max(12, Math.min(kingdom?.armyStrength ?? 0, capacity || 24, Math.max(12, Math.floor(adults * .16))));
}

function recruitToArmy(world: WorldState, army: Army, capital: Settlement, rng: RNG, indexes: WorldIndexes | undefined, runtime: MilitaryRuntime, initial = false): void {
  army.soldierIds = army.soldierIds.filter(id => runtime.characterById.get(id)?.alive);
  const target = militaryCapacity(world, army, capital, runtime);
  if (army.soldierIds.length >= target) return;
  const serving = new Set(world.armies.flatMap(item => item.soldierIds ?? []));
  const candidates = world.characters
    .filter(character => character.alive && character.kingdomId === army.kingdomId && character.age >= 17 && character.age <= 48 && character.health >= 45 && !serving.has(character.id))
    .sort((a, b) => Number(['soldier', 'guard', 'hunter'].includes(b.profession)) - Number(['soldier', 'guard', 'hunter'].includes(a.profession)) || b.loyalty - a.loyalty || b.health - a.health || a.id - b.id);
  const needed = Math.min(target - army.soldierIds.length, initial ? target : Math.max(2, Math.ceil(target * .04)));
  const selected = candidates.slice(0, needed);
  for (const character of selected) {
    const contract = runtime.activeEmploymentByCharacter.get(character.id);
    if (contract) contract.active = false;
    character.profession = 'soldier';
    character.workplace = army.garrisonBuildingId ? runtime.buildingById.get(army.garrisonBuildingId)?.name ?? 'казармы' : 'военный лагерь';
    character.workplaceBuildingId = army.garrisonBuildingId;
    character.employerEstablishmentId = undefined;
    character.employmentContractId = undefined;
    character.serviceStatus = 'гарнизон';
    character.militaryExperience ??= rng.int(0, 18);
    character.servicePayArrears ??= 0;
    character.militaryRole = chooseRole(character, army, rng);
    character.visualRole = visualRole(character);
    if (!army.soldierIds.includes(character.id)) army.soldierIds.push(character.id);
    const garrison = army.garrisonBuildingId ? runtime.buildingById.get(army.garrisonBuildingId) : undefined;
    if (garrison && !garrison.workerIds.includes(character.id)) garrison.workerIds.push(character.id);
    indexes?.workersBySettlementAndProfession.get(character.settlementId)?.get('soldier')?.push(character);
  }
  if (selected.length && !initial) {
    appendCausalEvent(world, {
      kind: 'military', title: `${army.name} набирает пополнение`, description: `${selected.length} жителей поступили на военную службу.`,
      cause: 'потери, расширение гарнизона или приказ правителя', conditions: [`свободно мест: ${Math.max(0, target - army.soldierIds.length + selected.length)}`, `казна и казармы позволяют содержать людей`],
      decision: 'командование объявило набор', outcome: 'новобранцы размещены в гарнизоне', consequences: ['рынок труда потерял часть работников', 'военная сила государства вырастет после обучения'],
      entityRefs: [{ kind: 'army', id: army.id }, ...selected.slice(0, 4).map(item => ({ kind: 'character' as const, id: item.id }))], importance: 2,
    });
  }
}

function chooseRole(character: Character, army: Army, rng: RNG): MilitaryRole {
  if (character.id === army.commanderId) return 'командир';
  if (character.titles.length || character.renown >= 78) return rng.chance(.55) ? 'рыцарь' : 'офицер';
  if (character.renown >= 58 || character.militaryExperience! >= 45) return rng.chance(.55) ? 'сержант' : 'офицер';
  if ((character.skills.hunter ?? 0) >= 28 || character.profession === 'hunter') return rng.chance(.25) ? 'арбалетчик' : 'лучник';
  const roll = hashSeed(`${character.id}:${army.id}:${character.birthYear}`) % 100;
  if (roll < 9) return 'всадник';
  if (roll < 32) return 'копейщик';
  if (roll < 82) return 'пехотинец';
  return 'ополченец';
}

function visualRole(character: Character): string {
  if (character.equipment?.socialTier === 'правитель' || character.titles.some(title => /правитель|король|королева|император|императрица|верховный вождь/i.test(title))) return 'king';
  if (character.militaryRole === 'командир') return 'commander';
  if (character.militaryRole === 'офицер' || character.militaryRole === 'сержант') return 'officer';
  if (character.militaryRole === 'рыцарь') return 'knight';
  if (character.militaryRole === 'лучник' || character.militaryRole === 'арбалетчик') return 'archer';
  if (character.militaryRole === 'всадник') return 'cavalry';
  if (character.militaryRole === 'ополченец') return 'militia';
  return 'soldier';
}

function rebuildUnits(world: WorldState, army: Army, rng: RNG, runtime: MilitaryRuntime): void {
  const old = world.militaryUnits.filter(item => item.armyId === army.id);
  const oldByType = new Map<MilitaryUnitType, MilitaryUnit[]>(UNIT_PLANS.map(plan => [plan.type, old.filter(item => item.type === plan.type)]));
  const soldiers = army.soldierIds.map(id => runtime.characterById.get(id)).filter((item): item is Character => Boolean(item?.alive));
  const assigned = new Set<number>();
  const nextUnits: MilitaryUnit[] = [];
  for (const plan of UNIT_PLANS) {
    const members = soldiers.filter(character => !assigned.has(character.id) && plan.roles.includes(character.militaryRole ?? 'ополченец'));
    for (let offset = 0; offset < members.length; offset += plan.size) {
      const group = members.slice(offset, offset + plan.size);
      if (!group.length) continue;
      group.forEach(item => assigned.add(item.id));
      const prior = oldByType.get(plan.type)?.shift();
      const commander = [...group].sort((a, b) => militaryRank(b) - militaryRank(a) || b.renown - a.renown)[0]!;
      const unit: MilitaryUnit = prior ?? {
        id: world.nextIds.militaryUnit++, armyId: army.id, kingdomId: army.kingdomId, name: `${unitLabel(plan.type)} ${nextUnits.length + 1}`,
        type: plan.type, commanderId: commander.id, memberIds: [], training: rng.int(18, 58), cohesion: rng.int(42, 78), equipmentCoverage: 0,
        horseCount: 0, experience: 0, history: [`Сформировано в ${world.year} году.`],
      };
      unit.memberIds = group.map(item => item.id);
      unit.commanderId = commander.id;
      unit.horseCount = plan.type === 'конница' || plan.type === 'рыцари' ? group.length : 0;
      group.forEach(item => { item.militaryUnitId = unit.id; });
      nextUnits.push(unit);
    }
  }
  world.militaryUnits = world.militaryUnits.filter(item => item.armyId !== army.id).concat(nextUnits);
  army.unitIds = nextUnits.map(item => item.id);
}

function militaryRank(character: Character): number {
  const order: MilitaryRole[] = ['ополченец', 'пехотинец', 'лучник', 'арбалетчик', 'копейщик', 'всадник', 'рыцарь', 'сержант', 'офицер', 'командир'];
  return order.indexOf(character.militaryRole ?? 'ополченец');
}

function unitLabel(type: MilitaryUnitType): string {
  const labels: Record<MilitaryUnitType, string> = { ополчение: 'Отряд ополчения', пехота: 'Рота пехоты', стрелки: 'Рота стрелков', копейщики: 'Рота копейщиков', конница: 'Эскадрон', рыцари: 'Рыцарское знамя', штаб: 'Штаб' };
  return labels[type];
}

function seedArsenal(world: WorldState, army: Army, capital: Settlement, rng: RNG, runtime: MilitaryRuntime): void {
  const building = army.arsenalBuildingId ? runtime.buildingById.get(army.arsenalBuildingId) : undefined;
  if (!building || building.history.includes('Военный запас 1.7.0 сформирован.')) return;
  const n = Math.max(12, army.soldierIds.length);
  const stock: Array<[string, number]> = [
    ['spear', Math.ceil(n * .65)], ['gambeson', Math.ceil(n * .78)], ['padded_cap', Math.ceil(n * .72)], ['wooden_shield', Math.ceil(n * .45)],
    ['longbow', Math.ceil(n * .18)], ['arrow_bundle', Math.ceil(n * .45)], ['crossbow', Math.ceil(n * .07)], ['bolt_bundle', Math.ceil(n * .18)],
    ['chainmail', Math.ceil(n * .09)], ['iron_helmet', Math.ceil(n * .16)], ['sword', Math.ceil(n * .12)], ['lance', Math.ceil(n * .08)],
    ['military_rations', n * 18], ['bandages', Math.ceil(n * .35)], ['tent', Math.ceil(n / 6)], ['wagon_parts', Math.ceil(n / 45)], ['horse_feed', Math.ceil(n * .35)],
  ];
  for (const [templateId, amount] of stock) {
    const item = addMaterialItem(world, templateId, amount, capital.id, { buildingId: building.id, establishmentId: building.establishmentId }, 'накопленный запас гарнизона', rng.int(45, 72), runtime.itemById);
    if (item) runtime.itemById.set(item.id, item);
  }
  building.history.push('Военный запас 1.7.0 сформирован.');
}

function templatesForRole(role: MilitaryRole): Partial<Record<'head' | 'body' | 'mainHand' | 'offHand', string>> & { ammo?: string } {
  if (role === 'командир' || role === 'офицер') return { head: 'iron_helmet', body: 'chainmail', mainHand: 'sword', offHand: 'wooden_shield' };
  if (role === 'рыцарь') return { head: 'iron_helmet', body: 'chainmail', mainHand: 'mace', offHand: 'wooden_shield' };
  if (role === 'всадник') return { head: 'iron_helmet', body: 'leather_armor', mainHand: 'lance', offHand: 'wooden_shield' };
  if (role === 'лучник') return { head: 'padded_cap', body: 'gambeson', mainHand: 'longbow', ammo: 'arrow_bundle' };
  if (role === 'арбалетчик') return { head: 'padded_cap', body: 'gambeson', mainHand: 'crossbow', ammo: 'bolt_bundle' };
  if (role === 'копейщик') return { head: 'padded_cap', body: 'gambeson', mainHand: 'spear', offHand: 'wooden_shield' };
  if (role === 'пехотинец') return { head: 'padded_cap', body: 'gambeson', mainHand: 'spear', offHand: 'wooden_shield' };
  return { body: 'gambeson', mainHand: 'spear' };
}

function equipArmy(world: WorldState, army: Army, rng: RNG, runtime: MilitaryRuntime): void {
  const arsenal = army.arsenalBuildingId ? runtime.buildingById.get(army.arsenalBuildingId) : undefined;
  if (!arsenal) return;
  const stockByTemplate = new Map<string, WorldItem>();
  for (const itemId of arsenal.inventoryItemIds) {
    const item = runtime.itemById.get(itemId);
    if (item && item.quantity > 0 && item.condition > 0 && !stockByTemplate.has(item.templateId)) stockByTemplate.set(item.templateId, item);
  }
  for (const soldierId of army.soldierIds) {
    const soldier = runtime.characterById.get(soldierId);
    if (!soldier?.alive) continue;
    const templates = templatesForRole(soldier.militaryRole ?? 'ополченец');
    for (const [slot, templateId] of Object.entries(templates)) {
      if (slot === 'ammo' || !templateId) continue;
      const currentId = soldier.equipment?.equippedItemIds?.[slot as 'head' | 'body' | 'mainHand' | 'offHand'];
      const current = currentId ? runtime.itemById.get(currentId) : undefined;
      if (current && COMBAT_TEMPLATES.has(current.templateId)) continue;
      issueFromArsenal(world, arsenal, soldier, slot as 'head' | 'body' | 'mainHand' | 'offHand', templateId, rng, runtime, stockByTemplate);
    }
    if (templates.ammo && !soldier.inventoryItemIds.some(id => runtime.itemById.get(id)?.templateId === templates.ammo)) issueAmmo(world, arsenal, soldier, templates.ammo, rng, runtime, stockByTemplate);
  }
}

function issueFromArsenal(world: WorldState, arsenal: Building, soldier: Character, slot: 'head' | 'body' | 'mainHand' | 'offHand', templateId: string, rng: RNG, runtime: MilitaryRuntime, stockByTemplate: Map<string, WorldItem>): boolean {
  const stock = stockByTemplate.get(templateId);
  if (stock && (stock.quantity < 1 || stock.condition <= 0)) stockByTemplate.delete(templateId);
  if (!stock) return false;
  stock.quantity -= 1;
  const issued = addMaterialItem(world, templateId, 1, soldier.settlementId, { ownerCharacterId: soldier.id }, `выдано из ${arsenal.name}`, Math.max(25, Math.round(stock.quality + rng.int(-4, 4))), runtime.itemById, true, soldier);
  if (!issued) return false;
  runtime.itemById.set(issued.id, issued);
  issued.equippedByCharacterId = soldier.id;
  issued.equipmentSlot = slot;
  soldier.equipment.equippedItemIds[slot] = issued.id;
  soldier.equipment.compact = false;
  return true;
}

function issueAmmo(world: WorldState, arsenal: Building, soldier: Character, templateId: string, rng: RNG, runtime: MilitaryRuntime, stockByTemplate: Map<string, WorldItem>): void {
  const stock = stockByTemplate.get(templateId);
  if (stock && (stock.quantity < 1 || stock.condition <= 0)) stockByTemplate.delete(templateId);
  if (!stock) return;
  stock.quantity -= 1;
  const issued = addMaterialItem(world, templateId, 1, soldier.settlementId, { ownerCharacterId: soldier.id }, `боезапас из ${arsenal.name}`, Math.max(30, stock.quality + rng.int(-3, 3)), runtime.itemById, true, soldier);
  if (issued) runtime.itemById.set(issued.id, issued);
}

function ensureSupplyWagons(world: WorldState, army: Army, capital: Settlement, rng: RNG, runtime: MilitaryRuntime): void {
  army.supplyWagonIds = army.supplyWagonIds.filter(id => world.supplyWagons.some(item => item.id === id && item.status !== 'уничтожен'));
  const target = Math.max(1, Math.ceil(Math.max(1, army.soldierIds.length) / 85));
  while (army.supplyWagonIds.length < target) {
    const wagon: SupplyWagon = {
      id: world.nextIds.supplyWagon++, armyId: army.id, kingdomId: army.kingdomId, x: capital.x, y: capital.y,
      wagonCount: 1, horseCount: 2, capacity: 900, condition: rng.int(72, 100), escortIds: [], inventoryItemIds: [], status: 'склад',
      history: [`Собран при гарнизоне ${capital.name}.`],
    };
    world.supplyWagons.push(wagon);
    army.supplyWagonIds.push(wagon.id);
    const escort = army.soldierIds.filter(id => !world.supplyWagons.some(item => item.escortIds.includes(id))).slice(0, 3);
    wagon.escortIds = escort;
    addMaterialItem(world, 'military_rations', Math.max(40, army.soldierIds.length * 4), capital.id, { supplyWagonId: wagon.id }, 'запас обоза', 55, runtime.itemById, true);
    addMaterialItem(world, 'water', Math.max(30, army.soldierIds.length * 3), capital.id, { supplyWagonId: wagon.id }, 'запас обоза', 60, runtime.itemById, true);
    addMaterialItem(world, 'bandages', Math.max(8, Math.ceil(army.soldierIds.length / 5)), capital.id, { supplyWagonId: wagon.id }, 'медицинский запас обоза', 62, runtime.itemById, true);
    addMaterialItem(world, 'tent', Math.max(4, Math.ceil(army.soldierIds.length / 12)), capital.id, { supplyWagonId: wagon.id }, 'походное имущество', 58, runtime.itemById, true);
    addMaterialItem(world, 'horse_feed', Math.max(20, army.soldierIds.length), capital.id, { supplyWagonId: wagon.id }, 'корм обоза', 52, runtime.itemById, true);
    addMaterialItem(world, 'wagon_parts', 2, capital.id, { supplyWagonId: wagon.id }, 'ремонтный комплект обоза', 60, runtime.itemById, true);
  }
}

export function advanceMilitaryInfrastructure(world: WorldState, rng: RNG, indexes: WorldIndexes): void {
  const needsBootstrap = world.simulation.militaryInfrastructureVersion !== MILITARY_VERSION
    || !Array.isArray(world.militaryUnits) || !Array.isArray(world.supplyWagons)
    || world.armies.some(army => !Array.isArray(army.soldierIds) || !army.logistics);
  if (needsBootstrap) initializeMilitaryInfrastructure(world, rng, indexes);
  else {
    normalizeKingdomCapitals(world);
    for (const army of world.armies) ensureArmyShape(world, army);
  }
  const runtime = createMilitaryRuntime(world, indexes);
  for (const army of world.armies) {
    const kingdom = world.kingdoms.find(item => item.id === army.kingdomId);
    const capital = kingdom ? controlledCapital(world, kingdom.id) : undefined;
    if (!kingdom || !capital) continue;
    attachMilitaryBuildings(world, army, capital, rng, indexes);
    seedArsenal(world, army, capital, rng, runtime);
    army.soldierIds = army.soldierIds.filter(id => indexes.characterById.has(id));
    if (!army.soldierIds.includes(army.commanderId) && indexes.characterById.has(army.commanderId)) army.soldierIds.unshift(army.commanderId);
    const capacity = militaryCapacity(world, army, capital, runtime);
    if ([1, 4, 7, 10].includes(world.month) || army.soldierIds.length < capacity * .55) recruitToArmy(world, army, capital, rng, indexes, runtime, false);
    if (world.month === 1 || army.unitIds.some(id => !world.militaryUnits.some(unit => unit.id === id))) rebuildUnits(world, army, rng, runtime);
    payArmy(world, army, kingdom, rng);
    if (army.status === 'garrison' || army.status === 'recovering') {
      trainGarrison(world, army, rng);
      resupplyAtCapital(world, army, capital, rng);
      repairMilitaryEquipment(world, army, capital, rng, runtime);
    } else {
      consumeCampaignSupplies(world, army, rng, indexes);
    }
    moveSupplyWagons(world, army, rng);
    applyDesertion(world, army, rng);
    synchronizeArmyStrength(world, army, runtime);
  }
  world.supplyWagons = world.supplyWagons.filter(item => item.status !== 'уничтожен' || item.history.length < 40);
}

function payArmy(world: WorldState, army: Army, kingdom: WorldState['kingdoms'][number], rng: RNG): void {
  const soldiers = army.soldierIds.map(id => world.characters.find(item => item.id === id)).filter((item): item is Character => Boolean(item?.alive));
  let due = 0;
  for (const soldier of soldiers) due += payForRole(soldier.militaryRole ?? 'ополченец');
  army.monthlyPayroll = due;
  const paidRatio = due > 0 ? Math.min(1, kingdom.treasury / due) : 1;
  const paidTotal = due * paidRatio;
  kingdom.treasury = Math.max(0, kingdom.treasury - paidTotal);
  army.logistics.payrollDebt += due - paidTotal;
  for (const soldier of soldiers) {
    const personalDue = payForRole(soldier.militaryRole ?? 'ополченец');
    const paid = personalDue * paidRatio;
    soldier.wallet += paid * .35;
    const household = soldier.householdId ? world.households.find(item => item.id === soldier.householdId) : undefined;
    if (household) { household.wealth += paid * .65; household.monthlyIncome += paid; }
    soldier.servicePayArrears = Math.max(0, (soldier.servicePayArrears ?? 0) + personalDue - paid);
  }
  if (paidRatio < .65 && rng.chance(.18)) {
    appendCausalEvent(world, {
      kind: 'military', title: `${army.name} не получило полного жалования`, description: `Казна выплатила только ${Math.round(paidRatio * 100)}% причитающихся денег.`,
      cause: 'в государственной казне не хватило монет', conditions: [`долг армии ${Math.round(army.logistics.payrollDebt)} крон`], decision: 'командование распределило доступные деньги',
      outcome: 'часть жалования записана в долг', consequences: ['мораль снизилась', 'риск дезертирства вырос'], entityRefs: [{ kind: 'army', id: army.id }, { kind: 'kingdom', id: kingdom.id }], importance: 2,
    });
  }
}

function payForRole(role: MilitaryRole): number {
  if (role === 'командир') return 18;
  if (role === 'офицер') return 11;
  if (role === 'рыцарь') return 8;
  if (role === 'сержант') return 6;
  if (role === 'всадник' || role === 'арбалетчик') return 4.5;
  return role === 'ополченец' ? 1.5 : 3;
}

function trainGarrison(world: WorldState, army: Army, rng: RNG): void {
  for (const unitId of army.unitIds) {
    const unit = world.militaryUnits.find(item => item.id === unitId);
    if (!unit) continue;
    const instructors = unit.memberIds.map(id => world.characters.find(item => item.id === id)).filter((item): item is Character => Boolean(item?.alive && ['командир', 'офицер', 'сержант', 'рыцарь'].includes(item.militaryRole ?? ''))).length;
    unit.training = Math.min(100, unit.training + .5 + instructors * .18);
    unit.cohesion = Math.min(100, unit.cohesion + .35);
    for (const id of unit.memberIds) {
      const soldier = world.characters.find(item => item.id === id);
      if (!soldier) continue;
      soldier.militaryExperience = Math.min(100, (soldier.militaryExperience ?? 0) + .15 + unit.training / 800);
      soldier.skills.soldier = Math.min(100, (soldier.skills.soldier ?? 8) + .12);
      soldier.serviceStatus = 'гарнизон';
      soldier.visualRole = visualRole(soldier);
    }
    if (rng.chance(.02) && unit.training > 70) unit.history.push(`К ${world.year}.${String(world.month).padStart(2, '0')} подразделение стало опытным и слаженным.`);
  }
}

function resupplyAtCapital(world: WorldState, army: Army, capital: Settlement, rng: RNG): void {
  const wagons = army.supplyWagonIds.map(id => world.supplyWagons.find(item => item.id === id)).filter((item): item is SupplyWagon => Boolean(item));
  for (const wagon of wagons) {
    wagon.x = capital.x; wagon.y = capital.y; wagon.status = 'склад';
    restockWagon(world, wagon, capital, army.soldierIds.length, rng);
  }
  const rationUnits = wagons.reduce((sum, wagon) => sum + quantityInInventory(world, wagon.inventoryItemIds, FOOD_TEMPLATES), 0);
  const waterUnits = wagons.reduce((sum, wagon) => sum + quantityInInventory(world, wagon.inventoryItemIds, ['water']), 0);
  army.logistics.foodDays = Math.min(120, Math.round(rationUnits / Math.max(1, army.soldierIds.length) * 8));
  army.logistics.waterDays = Math.min(80, Math.round(waterUnits / Math.max(1, army.soldierIds.length) * 5));
  army.logistics.medicine = wagons.reduce((sum, wagon) => sum + quantityInInventory(world, wagon.inventoryItemIds, ['bandages', 'herbal_medicine']), 0);
  army.logistics.tents = wagons.reduce((sum, wagon) => sum + quantityInInventory(world, wagon.inventoryItemIds, ['tent']), 0);
  army.logistics.tools = wagons.reduce((sum, wagon) => sum + quantityInInventory(world, wagon.inventoryItemIds, ['wagon_parts', 'tools']), 0);
  army.logistics.wagons = wagons.reduce((sum, wagon) => sum + wagon.wagonCount, 0);
  army.logistics.horses = wagons.reduce((sum, wagon) => sum + wagon.horseCount, 0) + world.militaryUnits.filter(unit => unit.armyId === army.id).reduce((sum, unit) => sum + unit.horseCount, 0);
  army.logistics.lastSupplySettlementId = capital.id;
  army.supplies = Math.min(100, Math.round((army.logistics.foodDays + army.logistics.waterDays) / 2));
}

function restockWagon(world: WorldState, wagon: SupplyWagon, capital: Settlement, soldierCount: number, rng: RNG): void {
  const targets: Array<[string, number]> = [
    ['military_rations', soldierCount * 4], ['water', soldierCount * 3], ['bandages', Math.ceil(soldierCount / 5)],
    ['tent', Math.ceil(soldierCount / 12)], ['horse_feed', Math.max(20, soldierCount)], ['wagon_parts', 2],
  ];
  for (const [templateId, target] of targets) {
    const current = quantityInInventory(world, wagon.inventoryItemIds, [templateId]);
    if (current >= target) continue;
    let remaining = target - current;
    const candidates = world.items.filter(item => item.settlementId === capital.id && item.templateId === templateId && !item.householdId && !item.ownerCharacterId && item.quantity > 0 && item.condition > 0 && item.supplyWagonId !== wagon.id);
    for (const stock of candidates) {
      if (remaining <= 0) break;
      const moved = Math.min(remaining, stock.quantity);
      stock.quantity -= moved;
      addMaterialItem(world, templateId, moved, capital.id, { supplyWagonId: wagon.id }, `погружено в обоз из запасов ${capital.name}`, stock.quality, undefined, false);
      remaining -= moved;
    }
    if (remaining > 0 && world.year === world.config.historyYears) addMaterialItem(world, templateId, remaining, capital.id, { supplyWagonId: wagon.id }, 'исторически накопленный военный запас', rng.int(45, 65));
  }
}

function consumeCampaignSupplies(world: WorldState, army: Army, rng: RNG, indexes: WorldIndexes): void {
  const days = 30;
  const wagons = army.supplyWagonIds.map(id => world.supplyWagons.find(item => item.id === id && item.status !== 'уничтожен')).filter((item): item is SupplyWagon => Boolean(item));
  const soldiers = Math.max(1, army.soldierIds.length);
  const rationNeed = soldiers * days / 8;
  const waterNeed = soldiers * days / 5;
  const rationUsed = consumeFromWagons(world, wagons, FOOD_TEMPLATES, rationNeed);
  const waterUsed = consumeFromWagons(world, wagons, ['water'], waterNeed);
  army.logistics.foodDays = Math.max(0, army.logistics.foodDays - days * (rationUsed < rationNeed * .8 ? 1.35 : 1));
  army.logistics.waterDays = Math.max(0, army.logistics.waterDays - days * (waterUsed < waterNeed * .8 ? 1.5 : 1));
  const hunger = rationUsed / Math.max(1, rationNeed);
  const hydration = waterUsed / Math.max(1, waterNeed);
  if (hunger < .75 || hydration < .75) {
    army.morale = Math.max(5, army.morale - Math.round((1 - Math.min(hunger, hydration)) * 20));
    const victims = army.soldierIds.map(id => indexes.characterById.get(id)).filter((item): item is Character => Boolean(item)).sort((a, b) => a.health - b.health).slice(0, Math.ceil(soldiers * (1 - Math.min(hunger, hydration)) * .04));
    for (const soldier of victims) {
      soldier.health = Math.max(5, soldier.health - rng.int(2, 8));
      soldier.needs.hunger = Math.min(100, soldier.needs.hunger + Math.round((1 - hunger) * 35));
      soldier.needs.thirst = Math.min(100, soldier.needs.thirst + Math.round((1 - hydration) * 45));
    }
  }
  const medicineNeed = Math.max(0, army.logistics.wounded / 4);
  const medicineUsed = consumeFromWagons(world, wagons, ['bandages', 'herbal_medicine'], medicineNeed);
  if (medicineUsed < medicineNeed * .6 && army.logistics.wounded > 0) army.morale = Math.max(5, army.morale - 2);
  army.supplies = Math.max(0, Math.round(Math.min(rationUsed / Math.max(1, rationNeed), waterUsed / Math.max(1, waterNeed)) * 100));
}

function repairMilitaryEquipment(world: WorldState, army: Army, capital: Settlement, rng: RNG, runtime: MilitaryRuntime): void {
  const arsenal = army.arsenalBuildingId ? runtime.buildingById.get(army.arsenalBuildingId) : undefined;
  if (!arsenal) return;
  const repairers = world.characters.filter(item => item.alive && item.settlementId === capital.id && ['armorer', 'blacksmith', 'toolmaker'].includes(item.profession)).length;
  if (repairers > 0) {
    const soldierItems = army.soldierIds.flatMap(id => runtime.characterById.get(id)?.inventoryItemIds ?? []).map(id => runtime.itemById.get(id)).filter((item): item is WorldItem => Boolean(item && item.condition > 0 && (item.category === 'оружие' || item.category === 'броня'))).sort((a, b) => a.condition - b.condition);
    for (const item of soldierItems.slice(0, repairers * 4)) item.condition = Math.min(item.maxCondition ?? 100, item.condition + rng.int(5, 14));
  }
  equipArmy(world, army, rng, runtime);
}

function moveSupplyWagons(world: WorldState, army: Army, rng: RNG): void {
  for (const wagonId of army.supplyWagonIds) {
    const wagon = world.supplyWagons.find(item => item.id === wagonId);
    if (!wagon || wagon.status === 'уничтожен') continue;
    if (ACTIVE_STATUSES.has(army.status)) {
      wagon.status = 'следует за армией';
      const distance = Math.hypot(wagon.x - army.x, wagon.y - army.y);
      if (distance > 0) { wagon.x += Math.sign(army.x - wagon.x); wagon.y += Math.sign(army.y - wagon.y); }
      if (distance > 3) { wagon.status = 'отстал'; wagon.condition = Math.max(0, wagon.condition - rng.int(2, 7)); }
      if (wagon.condition <= 0) { wagon.status = 'уничтожен'; wagon.history.push(`Обоз разрушился в пути в ${world.year} году.`); }
    }
  }
}

function applyDesertion(world: WorldState, army: Army, rng: RNG): void {
  const pressure = Math.max(0, (45 - army.morale) / 100 + Math.min(.22, army.logistics.payrollDebt / Math.max(1, army.monthlyPayroll * 24)) + (army.supplies < 25 ? .08 : 0));
  if (pressure <= 0 || !rng.chance(pressure)) return;
  const candidates = army.soldierIds.map(id => world.characters.find(item => item.id === id)).filter((item): item is Character => Boolean(item?.alive && item.id !== army.commanderId && !['командир', 'офицер', 'рыцарь'].includes(item.militaryRole ?? ''))).sort((a, b) => a.loyalty - b.loyalty || (b.servicePayArrears ?? 0) - (a.servicePayArrears ?? 0));
  const count = Math.min(candidates.length, Math.max(1, Math.ceil(candidates.length * pressure * .08)));
  const deserters = candidates.slice(0, count);
  if (!deserters.length) return;
  const ids = new Set(deserters.map(item => item.id));
  army.soldierIds = army.soldierIds.filter(id => !ids.has(id));
  army.logistics.desertions += deserters.length;
  for (const character of deserters) {
    character.serviceStatus = 'дезертир'; character.militaryRole = undefined; character.militaryUnitId = undefined; character.visualRole = 'deserter';
    character.profession = 'unemployed'; character.workplace = 'скрывается после дезертирства'; character.workplaceBuildingId = undefined;
    character.biography.push(`Дезертировал из ${army.name} в ${world.year} году.`);
  }
  for (const unit of world.militaryUnits.filter(item => item.armyId === army.id)) unit.memberIds = unit.memberIds.filter(id => !ids.has(id));
  appendCausalEvent(world, {
    kind: 'military', title: `Из ${army.name} бежали солдаты`, description: `${deserters.length} человек покинули службу.`, cause: 'низкая мораль, голод или невыплаченное жалование',
    conditions: [`мораль ${Math.round(army.morale)}%`, `долг ${Math.round(army.logistics.payrollDebt)} крон`, `снабжение ${army.supplies}%`], decision: 'солдаты самовольно покинули часть', outcome: 'численность армии уменьшилась', consequences: ['боеспособность снизилась', 'в государстве появились разыскиваемые дезертиры'],
    entityRefs: [{ kind: 'army', id: army.id }, ...deserters.slice(0, 4).map(item => ({ kind: 'character' as const, id: item.id }))], importance: 2,
  });
}

export function applyArmyCasualties(world: WorldState, indexes: WorldIndexes, army: Army, count: number, cause: string, rng: RNG, globalX = army.x, globalY = army.y, settlementId?: number): number {
  const available = army.soldierIds.map(id => indexes.characterById.get(id)).filter((item): item is Character => Boolean(item?.alive));
  if (!available.length || count <= 0) return 0;
  const actual = Math.min(count, available.length);
  const shuffled = [...available].sort((a, b) => hashSeed(`${world.year}:${world.month}:${army.id}:${a.id}`) - hashSeed(`${world.year}:${world.month}:${army.id}:${b.id}`));
  const dead = shuffled.slice(0, actual);
  const deadIds = new Set(dead.map(item => item.id));
  archiveCharactersBatch(world, indexes, dead.map(character => ({ character, context: { cause, globalX, globalY, settlementId, createCorpse: true } })), rng);
  army.soldierIds = army.soldierIds.filter(id => !deadIds.has(id));
  for (const unit of world.militaryUnits.filter(item => item.armyId === army.id)) unit.memberIds = unit.memberIds.filter(id => !deadIds.has(id));
  army.logistics.wounded = Math.max(0, army.logistics.wounded + Math.ceil(actual * .7));
  return actual;
}

export function synchronizeArmyStrength(world: WorldState, army: Army, providedRuntime?: MilitaryRuntime): void {
  const runtime = providedRuntime ?? createMilitaryRuntime(world);
  const soldiers = army.soldierIds.map(id => runtime.characterById.get(id)).filter((item): item is Character => Boolean(item?.alive));
  let equipped = 0, armored = 0, ranged = 0, training = 0;
  for (const soldier of soldiers) {
    const items = Object.values(soldier.equipment?.equippedItemIds ?? {}).map(id => runtime.itemById.get(id)).filter((item): item is WorldItem => Boolean(item && item.condition > 0));
    if (items.some(item => item.category === 'оружие')) equipped += 1;
    if (items.some(item => item.category === 'броня')) armored += 1;
    if (items.some(item => ['longbow', 'crossbow'].includes(item.templateId))) ranged += 1;
    training += soldier.militaryExperience ?? soldier.skills.soldier ?? 0;
  }
  const count = soldiers.length;
  army.logistics.equipmentCoverage = count ? equipped / count : 0;
  army.logistics.armorCoverage = count ? armored / count : 0;
  army.logistics.rangedCoverage = count ? ranged / count : 0;
  const units = world.militaryUnits.filter(item => item.armyId === army.id);
  for (const unit of units) {
    const members = unit.memberIds.map(id => runtime.characterById.get(id)).filter((item): item is Character => Boolean(item?.alive));
    unit.equipmentCoverage = members.length ? members.filter(member => Object.values(member.equipment.equippedItemIds).some(id => runtime.itemById.get(id)?.category === 'оружие')).length / members.length : 0;
  }
  const avgTraining = count ? training / count : 0;
  const logisticsFactor = .45 + Math.min(1, army.supplies / 100) * .55;
  const equipmentFactor = .55 + army.logistics.equipmentCoverage * .25 + army.logistics.armorCoverage * .2;
  army.strength = Math.max(0, Math.round(count * (0.72 + avgTraining / 100) * equipmentFactor * logisticsFactor));
  army.readiness = Math.max(0, Math.min(100, Math.round(army.morale * .28 + avgTraining * .25 + army.logistics.equipmentCoverage * 25 + Math.min(100, army.supplies) * .22)));
}

function quantityInInventory(world: WorldState, ids: number[], templates: readonly string[]): number {
  const allowed = new Set(templates);
  return ids.reduce((sum, id) => { const item = world.items.find(candidate => candidate.id === id); return sum + (item && allowed.has(item.templateId) && item.condition > 0 ? item.quantity : 0); }, 0);
}

function consumeFromWagons(world: WorldState, wagons: SupplyWagon[], templates: readonly string[], quantity: number): number {
  const allowed = new Set(templates);
  let remaining = Math.max(0, quantity);
  for (const wagon of wagons) {
    for (const itemId of wagon.inventoryItemIds) {
      if (remaining <= .0001) break;
      const item = world.items.find(candidate => candidate.id === itemId);
      if (!item || !allowed.has(item.templateId) || item.quantity <= 0 || item.condition <= 0) continue;
      const used = Math.min(remaining, item.quantity);
      item.quantity -= used; remaining -= used;
    }
  }
  return quantity - remaining;
}

export function militaryInfrastructureIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const characterIds = new Set(world.characters.map(item => item.id));
  const itemIds = new Set(world.items.map(item => item.id));
  const unitIds = new Set(world.militaryUnits.map(item => item.id));
  const wagonIds = new Set(world.supplyWagons.map(item => item.id));
  for (const army of world.armies) {
    for (const id of army.soldierIds) if (!characterIds.has(id)) issues.push(`Армия ${army.id}: отсутствует солдат ${id}.`);
    for (const id of army.unitIds) if (!unitIds.has(id)) issues.push(`Армия ${army.id}: отсутствует подразделение ${id}.`);
    for (const id of army.supplyWagonIds) if (!wagonIds.has(id)) issues.push(`Армия ${army.id}: отсутствует обоз ${id}.`);
    if (army.garrisonBuildingId && !world.buildings.some(item => item.id === army.garrisonBuildingId)) issues.push(`Армия ${army.id}: отсутствует казарма.`);
  }
  for (const unit of world.militaryUnits) {
    if (!world.armies.some(item => item.id === unit.armyId)) issues.push(`Подразделение ${unit.id}: отсутствует армия.`);
    for (const id of unit.memberIds) if (!characterIds.has(id)) issues.push(`Подразделение ${unit.id}: отсутствует боец ${id}.`);
  }
  for (const wagon of world.supplyWagons) for (const id of wagon.inventoryItemIds) if (!itemIds.has(id)) issues.push(`Обоз ${wagon.id}: отсутствует предмет ${id}.`);
  return issues;
}
