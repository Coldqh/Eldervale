import type {
  Character, EmploymentContract, EquipmentProfile, EquipmentSlot, Establishment, Household, MarketTransaction,
  Settlement, SocialTier, TravelingMerchant, WorldItem, WorldState,
} from '../types';
import type { WorldIndexes } from './indexes';
import { moveResidentInIndexes } from './indexes';
import { appendCausalEvent } from './causality';
import { addMaterialItem, consumeOwnedMaterial, materialTemplateDetails, pruneEmptyMaterialItems, retailOffer } from './materialEconomy';
import { hashSeed, RNG } from './rng';
import { worldTick } from './scheduler';
import { workplaceConnectionScore } from './socialSystem';

const CLOTHING_SLOTS: EquipmentSlot[] = ['head', 'body', 'legs', 'feet', 'hands', 'cloak'];
const FOOD_IDS = ['stew', 'roast', 'bread', 'vegetables', 'salted_fish', 'smoked_meat', 'fish', 'meat', 'eggs', 'milk', 'fruit', 'grain'] as const;
const WATER_IDS = ['water'] as const;
const MAX_TRANSACTION_HISTORY = 1800;
const MAX_DETAILED_CHARACTERS = 420;

const professionTools: Record<string, string> = {
  farmer: 'sickle', miner: 'pickaxe', carpenter: 'wood_axe', blacksmith: 'smith_hammer', fisher: 'fishing_net',
  herbalist: 'herb_knife', healer: 'mortar', hunter: 'longbow', guard: 'spear', soldier: 'spear', tailor: 'tailoring_kit',
  weaver: 'spindle', tanner: 'tanner_knife', cobbler: 'cobbler_tools', armorer: 'smith_hammer', toolmaker: 'smith_hammer',
};

const professionPreferred: Record<string, string[]> = {
  farmer: ['ферма'], miner: ['рудник', 'каменоломня'], carpenter: ['плотницкая мастерская', 'инструментальная мастерская'],
  blacksmith: ['кузница', 'бронная мастерская', 'оружейная лавка'], fisher: ['рыбный промысел'], herbalist: ['лечебница'],
  healer: ['лечебница', 'баня'], hunter: ['рынок', 'лавка'], merchant: ['рынок', 'лавка', 'продовольственная лавка', 'одежная лавка', 'оружейная лавка'],
  weaver: ['ткацкая мастерская', 'красильня'], tailor: ['портная мастерская', 'одежная лавка'], tanner: ['кожевенная мастерская'],
  cobbler: ['сапожная мастерская'], armorer: ['бронная мастерская'], toolmaker: ['инструментальная мастерская'], cook: ['таверна', 'постоялый двор'],
  brewer: ['пивоварня', 'винодельня', 'таверна'], miller: ['мельница', 'пекарня'], guard: ['рынок', 'гильдейский дом'], soldier: ['гильдейский дом'],
};

function socialTier(character: Character, household?: Household): SocialTier {
  if (character.titles.some(title => /король|королева|правитель|вождь/i.test(title))) return 'правитель';
  if (character.titles.length || character.renown >= 75) return 'знатный';
  if (household?.status === 'богатые' || character.wealth >= 120) return 'богатый';
  if (household?.status === 'зажиточные' || character.wealth >= 45) return 'зажиточный';
  if (household?.status === 'бедные' || character.wealth < 8) return 'бедный';
  if (household?.status === 'нищие') return 'нищий';
  return 'обычный';
}

function profileFor(character: Character, household: Household | undefined, tick: number): EquipmentProfile {
  const tier = socialTier(character, household);
  const material = tier === 'правитель' || tier === 'знатный' ? 'тонкая шерсть и лён' : tier === 'богатый' || tier === 'зажиточный' ? 'шерсть и кожа' : 'лён и грубая шерсть';
  const color = tier === 'правитель' ? 'пурпурный' : tier === 'знатный' ? 'синий' : tier === 'богатый' ? 'красный' : tier === 'зажиточный' ? 'коричневый' : 'неокрашенный';
  const baseQuality = tier === 'правитель' ? 90 : tier === 'знатный' ? 78 : tier === 'богатый' ? 66 : tier === 'зажиточный' ? 56 : tier === 'обычный' ? 44 : tier === 'бедный' ? 32 : 20;
  return {
    material, color, quality: baseQuality, condition: Math.max(20, Math.min(100, baseQuality + (character.id % 19) - 9)),
    socialTier: tier, equippedItemIds: {}, compact: true, lastMaintainedTick: tick,
  };
}

function defaultTemplates(character: Character): Partial<Record<EquipmentSlot, string>> {
  const tier = character.equipment.socialTier;
  const result: Partial<Record<EquipmentSlot, string>> = {
    head: tier === 'правитель' || tier === 'знатный' ? 'linen_hood' : 'linen_hood',
    body: tier === 'правитель' ? 'wool_tunic' : tier === 'знатный' || tier === 'богатый' ? 'wool_tunic' : 'linen_shirt',
    legs: 'wool_trousers', feet: 'leather_shoes', hands: 'leather_gloves',
    cloak: tier === 'правитель' ? 'royal_cloak' : tier === 'нищий' ? undefined : 'wool_cloak',
  };
  if (character.profession === 'soldier' || character.profession === 'guard') {
    result.head = 'padded_cap';
    result.body = character.renown >= 65 ? 'chainmail' : character.renown >= 35 ? 'leather_armor' : 'gambeson';
    result.mainHand = character.renown >= 55 ? 'sword' : 'spear';
    result.offHand = 'wooden_shield';
  } else if (character.profession === 'hunter') {
    result.mainHand = 'longbow';
  } else if (tier === 'правитель' || tier === 'знатный') {
    result.mainHand = 'sword';
  }
  const tool = professionTools[character.profession];
  if (tool && tool !== result.mainHand) result.workTool = tool;
  return result;
}

function addTransaction(world: WorldState, data: Omit<MarketTransaction, 'id' | 'tick'>): void {
  world.marketTransactions ??= [];
  world.marketTransactions.push({ id: world.nextIds.marketTransaction++, tick: worldTick(world), ...data });
  if (world.marketTransactions.length > MAX_TRANSACTION_HISTORY) world.marketTransactions.splice(0, world.marketTransactions.length - MAX_TRANSACTION_HISTORY);
}

function materializeSlot(world: WorldState, character: Character, slot: EquipmentSlot, templateId: string, source: string, quality?: number, itemById?: Map<number, WorldItem>): WorldItem | undefined {
  const currentId = character.equipment.equippedItemIds[slot];
  const currentCandidate = currentId ? itemById?.get(currentId) ?? world.items.find(item => item.id === currentId) : undefined;
  const current = currentCandidate?.condition && currentCandidate.condition > 0 ? currentCandidate : undefined;
  if (current) return current;
  const item = addMaterialItem(world, templateId, 1, character.settlementId, { ownerCharacterId: character.id }, source, quality ?? character.equipment.quality, itemById, true, character);
  if (!item) return undefined;
  item.equippedByCharacterId = character.id;
  item.equipmentSlot = slot;
  item.condition = Math.min(item.maxCondition ?? 100, Math.max(20, character.equipment.condition));
  if (!item.dye && character.equipment.color !== 'неокрашенный') item.dye = character.equipment.color;
  character.equipment.equippedItemIds[slot] = item.id;
  itemById?.set(item.id, item);
  return item;
}

export function materializeCharacterEquipment(world: WorldState, character: Character, itemById?: Map<number, WorldItem>): void {
  if (!character.alive) return;
  const templates = defaultTemplates(character);
  for (const [rawSlot, templateId] of Object.entries(templates)) {
    if (!templateId) continue;
    materializeSlot(world, character, rawSlot as EquipmentSlot, templateId, 'личная экипировка', undefined, itemById);
  }
  character.equipment.compact = false;
}

function ensureCharacterProfile(world: WorldState, character: Character, household?: Household): void {
  const tick = worldTick(world);
  character.wallet ??= Math.max(0, Math.round((character.wealth ?? 0) * .18 * 100) / 100);
  character.equipment ??= profileFor(character, household, tick);
  character.equipment.equippedItemIds ??= {};
  character.equipment.lastMaintainedTick ??= tick;
  character.equipment.socialTier ??= socialTier(character, household);
  character.equipment.material ??= 'лён и шерсть';
  character.equipment.color ??= 'неокрашенный';
  character.equipment.quality ??= 40;
  character.equipment.condition ??= 55;
  character.equipment.compact ??= true;
}

function createTravelingMerchants(world: WorldState, rng: RNG): void {
  if (world.travelingMerchants.length || world.tradeRoutes.length === 0) return;
  const usedCharacters = new Set<number>();
  const target = Math.min(28, Math.max(2, Math.ceil(world.settlements.length / 4)));
  const routes = [...world.tradeRoutes].filter(route => route.active).sort((a, b) => b.volume - a.volume || a.id - b.id);
  for (const route of routes) {
    if (world.travelingMerchants.length >= target) break;
    const candidates = world.characters.filter(character => character.alive && character.age >= 18 && !usedCharacters.has(character.id)
      && [route.fromSettlementId, route.toSettlementId].includes(character.settlementId)
      && (character.profession === 'merchant' || character.wealth >= 35));
    const character = candidates.sort((a, b) => b.wealth - a.wealth || a.id - b.id)[0];
    if (!character) continue;
    usedCharacters.add(character.id);
    const activeContract = world.employments.find(contract => contract.characterId === character.id && contract.active);
    if (activeContract) {
      activeContract.active = false;
      const oldEstablishment = world.establishments.find(item => item.id === activeContract.establishmentId);
      if (oldEstablishment) oldEstablishment.workerIds = oldEstablishment.workerIds.filter(id => id !== character.id);
      const oldBuilding = oldEstablishment ? world.buildings.find(item => item.id === oldEstablishment.buildingId) : undefined;
      if (oldBuilding) oldBuilding.workerIds = oldBuilding.workerIds.filter(id => id !== character.id);
    }
    character.employerEstablishmentId = undefined;
    character.employmentContractId = undefined;
    character.workplaceBuildingId = undefined;
    character.profession = 'merchant';
    character.workplace = 'странствующая торговля';
    const merchant: TravelingMerchant = {
      id: world.nextIds.travelingMerchant++, characterId: character.id, routeSettlementIds: [route.fromSettlementId, route.toSettlementId],
      currentSettlementId: character.settlementId, nextSettlementId: character.settlementId === route.fromSettlementId ? route.toSettlementId : route.fromSettlementId,
      arrivalTick: worldTick(world) + Math.max(1, Math.ceil(Math.hypot(
        world.settlements.find(item => item.id === route.fromSettlementId)!.x - world.settlements.find(item => item.id === route.toSettlementId)!.x,
        world.settlements.find(item => item.id === route.fromSettlementId)!.y - world.settlements.find(item => item.id === route.toSettlementId)!.y,
      ) / 3)), wagonInventoryItemIds: [], cash: Math.max(25, character.wallet + character.wealth * .35), status: 'в пути', history: ['Начал странствовать между поселениями.'],
    };
    world.travelingMerchants.push(merchant);
    for (const templateId of rng.pick([
      ['linen_cloth', 'linen_shirt', 'leather_shoes', 'salt'],
      ['bread', 'salted_fish', 'ale', 'wool_cloth'],
      ['tools', 'sickle', 'dye_blue', 'dye_red'],
    ])) {
      const item = addMaterialItem(world, templateId, rng.int(2, 8), character.settlementId, { ownerCharacterId: character.id }, 'товар странствующего продавца', rng.int(42, 72));
      if (item && !merchant.wagonInventoryItemIds.includes(item.id)) merchant.wagonInventoryItemIds.push(item.id);
    }
  }
}

function seedSpecializedShop(world: WorldState, establishment: Establishment): void {
  const marker = 'Начальный специализированный товарный запас сформирован.';
  if (establishment.history.includes(marker)) return;
  const stock: Partial<Record<Establishment['type'], string[]>> = {
    'продовольственная лавка': ['bread', 'vegetables', 'salted_fish', 'water'],
    'одежная лавка': ['linen_hood', 'linen_shirt', 'wool_tunic', 'wool_trousers', 'leather_shoes', 'wool_cloak'],
    'оружейная лавка': ['spear', 'longbow', 'gambeson', 'wooden_shield', 'sickle', 'pickaxe'],
  };
  const templates = stock[establishment.type];
  if (!templates) return;
  for (const templateId of templates) {
    const hasStock = establishment.inventoryItemIds.some(id => {
      const item = world.items.find(candidate => candidate.id === id);
      return item?.templateId === templateId && item.quantity > .0001 && item.condition > 0;
    });
    if (!hasStock) {
      const quantity = 1 + hashSeed(`${world.config.seed}:специализированный-запас:${establishment.id}:${templateId}`) % 6;
      addMaterialItem(world, templateId, quantity, establishment.settlementId, { establishmentId: establishment.id, buildingId: establishment.buildingId }, marker, 45 + hashSeed(`${templateId}:${establishment.id}`) % 26);
    }
  }
  establishment.history.push(marker);
}

function synchronizeLivingEstablishments(world: WorldState): void {
  for (const settlement of world.settlements) {
    const shops = settlement.establishmentIds
      .map(id => world.establishments.find(item => item.id === id))
      .filter((item): item is Establishment => Boolean(item && item.type === 'лавка'));
    const specializations: Establishment['type'][] = ['продовольственная лавка', 'одежная лавка', 'оружейная лавка'];
    for (let index = 0; index < shops.length; index += 1) {
      if (shops.length < 2 && settlement.population < 500) break;
      shops[index]!.type = specializations[index % specializations.length]!;
      shops[index]!.history.push(`Лавка специализировалась как «${shops[index]!.type}».`);
    }
  }
  for (const establishment of world.establishments) {
    const matching = world.productionRecipes.filter(recipe => recipe.establishmentTypes.includes(establishment.type)).map(recipe => recipe.id);
    establishment.recipeIds = [...new Set([...(establishment.recipeIds ?? []), ...matching])];
    seedSpecializedShop(world, establishment);
  }
}

export function initializeLivingEconomy(world: WorldState, rng: RNG): void {
  world.travelingMerchants ??= [];
  world.marketTransactions ??= [];
  world.nextIds.travelingMerchant ??= Math.max(0, ...world.travelingMerchants.map(item => item.id)) + 1;
  world.nextIds.marketTransaction ??= Math.max(0, ...world.marketTransactions.map(item => item.id)) + 1;
  if (world.simulation.livingEconomyVersion === 1) return;
  synchronizeLivingEstablishments(world);
  const householdById = new Map(world.households.map(item => [item.id, item]));
  const itemById = new Map(world.items.map(item => [item.id, item]));
  for (const character of world.characters) ensureCharacterProfile(world, character, character.householdId ? householdById.get(character.householdId) : undefined);
  const important = world.characters.filter(character => character.alive && (character.titles.length || character.renown >= 70)).slice(0, 240);
  for (const character of important) materializeCharacterEquipment(world, character, itemById);
  createTravelingMerchants(world, rng);
  world.simulation.livingEconomyVersion = 1;
}

function settlementWaterAccess(world: WorldState, settlementId: number, character: Character): boolean {
  const home = character.homeBuildingId ? world.buildings.find(item => item.id === character.homeBuildingId) : undefined;
  return Boolean(home?.hasWater) || world.buildings.some(item => item.settlementId === settlementId && item.hasWater && item.condition > 25);
}

function retailPrice(settlement: Settlement, item: WorldItem): number {
  const local = settlement.economy.prices[item.templateId] ?? item.baseValue * settlement.economy.priceIndex;
  return Math.max(.05, local * (.72 + item.quality / 180));
}

function pay(character: Character, household: Household | undefined, amount: number): boolean {
  if (amount <= .0001) return true;
  const walletPart = Math.min(character.wallet, amount);
  character.wallet -= walletPart;
  const remaining = amount - walletPart;
  if (remaining <= .0001) return true;
  if (!household || household.wealth + .0001 < remaining) {
    character.wallet += walletPart;
    return false;
  }
  household.wealth -= remaining;
  return true;
}

function buyAndConsume(world: WorldState, character: Character, household: Household | undefined, settlement: Settlement, ids: readonly string[], quantity: number, purpose: string, itemById: ReadonlyMap<number, WorldItem>, establishments: readonly Establishment[]): number {
  const offer = retailOffer(world, settlement.id, ids, itemById, establishments);
  if (!offer) return 0;
  const moved = Math.min(quantity, offer.item.quantity);
  const price = retailPrice(settlement, offer.item) * moved;
  if (moved <= .0001 || !pay(character, household, price)) return 0;
  offer.item.quantity -= moved;
  offer.establishment.cash += price;
  offer.establishment.monthlyRevenue += price;
  settlement.economy.lastMonthlyTrade += price;
  addTransaction(world, {
    settlementId: settlement.id, buyerCharacterId: character.id, sellerCharacterId: offer.establishment.ownerCharacterId,
    establishmentId: offer.establishment.id, templateId: offer.item.templateId, quantity: moved, totalPrice: price, purpose,
  });
  return moved;
}

function consumeHouseholdFood(world: WorldState, household: Household | undefined, quantity: number, itemById: ReadonlyMap<number, WorldItem>): number {
  if (!household) return 0;
  return consumeOwnedMaterial(world, household.inventoryItemIds, FOOD_IDS, quantity, itemById);
}

function findReplacementTemplates(character: Character, slot: EquipmentSlot): string[] {
  const defaults = defaultTemplates(character);
  const preferred = defaults[slot];
  if (slot === 'body') return [preferred, 'linen_shirt', 'wool_tunic', 'gambeson'].filter((item): item is string => Boolean(item));
  if (slot === 'head') return [preferred, 'linen_hood', 'padded_cap'].filter((item): item is string => Boolean(item));
  if (slot === 'feet') return ['leather_shoes'];
  if (slot === 'hands') return ['leather_gloves'];
  if (slot === 'legs') return ['wool_trousers'];
  if (slot === 'cloak') return [preferred, 'wool_cloak'].filter((item): item is string => Boolean(item));
  if (slot === 'workTool') return [preferred].filter((item): item is string => Boolean(item));
  if (slot === 'mainHand') return [preferred, 'club', 'knife'].filter((item): item is string => Boolean(item));
  if (slot === 'offHand') return [preferred].filter((item): item is string => Boolean(item));
  return [];
}

function buyEquipment(world: WorldState, character: Character, household: Household | undefined, settlement: Settlement, slot: EquipmentSlot, itemById: Map<number, WorldItem>, establishments: readonly Establishment[]): boolean {
  const ids = findReplacementTemplates(character, slot);
  const offer = retailOffer(world, settlement.id, ids, itemById, establishments);
  if (!offer) return false;
  const price = retailPrice(settlement, offer.item);
  if (!pay(character, household, price)) return false;
  offer.item.quantity -= 1;
  offer.establishment.cash += price;
  offer.establishment.monthlyRevenue += price;
  const item = addMaterialItem(world, offer.item.templateId, 1, settlement.id, { ownerCharacterId: character.id }, `куплено у ${offer.establishment.name}`, offer.item.quality, itemById, true, character);
  if (!item) return false;
  item.condition = Math.max(25, Math.min(item.maxCondition ?? 100, offer.item.condition));
  item.dye = offer.item.dye;
  item.equippedByCharacterId = character.id;
  item.equipmentSlot = slot;
  character.equipment.equippedItemIds[slot] = item.id;
  itemById.set(item.id, item);
  character.equipment.compact = false;
  character.equipment.condition = Math.max(character.equipment.condition, item.condition);
  addTransaction(world, {
    settlementId: settlement.id, buyerCharacterId: character.id, sellerCharacterId: offer.establishment.ownerCharacterId,
    establishmentId: offer.establishment.id, templateId: offer.item.templateId, quantity: 1, totalPrice: price, purpose: `экипировка: ${slot}`,
  });
  return true;
}

function wearEquipment(world: WorldState, character: Character, rng: RNG, detailed: boolean, itemById: Map<number, WorldItem>): void {
  const professionWear = ['farmer', 'miner', 'carpenter', 'blacksmith', 'soldier', 'guard', 'hunter'].includes(character.profession) ? 1.5 : .8;
  if (character.equipment.compact || !detailed) {
    character.equipment.condition = Math.max(0, character.equipment.condition - professionWear * (detailed ? 1 : .35));
    return;
  }
  for (const [slot, itemId] of Object.entries(character.equipment.equippedItemIds)) {
    const item = itemById.get(itemId);
    if (!item) { delete character.equipment.equippedItemIds[slot as EquipmentSlot]; continue; }
    const extra = slot === 'workTool' || slot === 'feet' ? professionWear : professionWear * .55;
    item.condition = Math.max(0, item.condition - extra * (.7 + rng.next() * .6));
    if (item.condition <= 0) {
      item.history.push(`Окончательно износилось в ${world.year}.${String(world.month).padStart(2, '0')}.`);
      delete character.equipment.equippedItemIds[slot as EquipmentSlot];
    }
  }
  const equipped = Object.values(character.equipment.equippedItemIds).map(id => itemById.get(id)).filter((item): item is WorldItem => Boolean(item));
  character.equipment.condition = equipped.length ? Math.round(equipped.reduce((sum, item) => sum + item.condition, 0) / equipped.length) : 0;
}

function simulateDetailedNeeds(world: WorldState, settlement: Settlement, character: Character, household: Household | undefined, rng: RNG, itemById: Map<number, WorldItem>, establishments: readonly Establishment[]): void {
  const waterAccess = settlementWaterAccess(world, settlement.id, character);
  for (let day = 0; day < 30; day += 1) {
    character.needs.hunger = Math.min(100, character.needs.hunger + 3.4);
    character.needs.thirst = Math.min(100, character.needs.thirst + 4.8);
    character.needs.rest = Math.min(100, Math.max(0, character.needs.rest + (day % 7 === character.schedule.restDay ? -5 : 1.2)));
    if (character.needs.hunger >= 42) {
      const homeFood = consumeHouseholdFood(world, household, .045, itemById);
      const bought = homeFood > 0 ? 0 : buyAndConsume(world, character, household, settlement, FOOD_IDS, .045, 'личная еда', itemById, establishments);
      if (homeFood + bought > 0) character.needs.hunger = Math.max(0, character.needs.hunger - 52);
    }
    if (character.needs.thirst >= 38) {
      if (waterAccess) character.needs.thirst = Math.max(0, character.needs.thirst - 62);
      else {
        const homeWater = household ? consumeOwnedMaterial(world, household.inventoryItemIds, WATER_IDS, .06, itemById) : 0;
        const bought = homeWater > 0 ? 0 : buyAndConsume(world, character, household, settlement, WATER_IDS, .06, 'питьевая вода', itemById, establishments);
        if (homeWater + bought > 0) character.needs.thirst = Math.max(0, character.needs.thirst - 58);
      }
    }
    if (character.needs.hunger > 82 || character.needs.thirst > 82) character.health = Math.max(1, character.health - .25);
  }
  character.needs.lastUpdatedTick = worldTick(world);
  wearEquipment(world, character, rng, true, itemById);
  for (const slot of CLOTHING_SLOTS) {
    const itemId = character.equipment.equippedItemIds[slot];
    const item = itemId ? itemById.get(itemId) : undefined;
    if ((!item || item.condition < 24) && character.age >= 5) buyEquipment(world, character, household, settlement, slot, itemById, establishments);
  }
  const toolTemplate = professionTools[character.profession];
  if (toolTemplate) {
    const itemId = character.equipment.equippedItemIds.workTool;
    const tool = itemId ? itemById.get(itemId) : undefined;
    if (!tool || tool.condition < 22) buyEquipment(world, character, household, settlement, 'workTool', itemById, establishments);
  }
}

function compactWear(world: WorldState, rng: RNG, detailedCharacterIds: ReadonlySet<number>, itemById: Map<number, WorldItem>): void {
  if (world.month !== 1) return;
  for (const character of world.characters) {
    if (!character.alive || detailedCharacterIds.has(character.id)) continue;
    wearEquipment(world, character, rng, false, itemById);
    const household = character.householdId ? world.households.find(item => item.id === character.householdId) : undefined;
    if (character.equipment.condition < 24 && household && household.wealth > 4) {
      const cost = Math.min(household.wealth, 4 + character.equipment.quality * .08);
      household.wealth -= cost;
      character.equipment.condition = Math.min(75, character.equipment.condition + 38);
      character.equipment.lastMaintainedTick = worldTick(world);
    }
  }
}

function laborCapacity(establishment: Establishment, world: WorldState): number {
  const building = world.buildings.find(item => item.id === establishment.buildingId);
  if (!building) return 2;
  return Math.max(2, Math.min(28, Math.ceil(building.capacity / (['ферма', 'рудник', 'каменоломня'].includes(establishment.type) ? 4 : 7))));
}

function rebalanceLabor(world: WorldState, indexes: WorldIndexes): void {
  if (![1, 4, 7, 10].includes(world.month)) return;
  const aliveIds = new Set(world.characters.filter(character => character.alive).map(character => character.id));
  const employed = new Set<number>();
  const workerCounts = new Map<number, number>();
  const travelingCharacterIds = new Set((world.travelingMerchants ?? []).map(merchant => merchant.characterId));
  for (const contract of world.employments) {
    const establishment = indexes.establishmentById.get(contract.establishmentId);
    if (!aliveIds.has(contract.characterId) || !establishment?.active) contract.active = false;
    if (!contract.active) continue;
    employed.add(contract.characterId);
    workerCounts.set(contract.establishmentId, (workerCounts.get(contract.establishmentId) ?? 0) + 1);
  }
  for (const settlement of world.settlements) {
    const establishments = settlement.establishmentIds.map(id => indexes.establishmentById.get(id)).filter((item): item is Establishment => Boolean(item?.active));
    if (!establishments.length) continue;
    const capacityById = new Map(establishments.map(establishment => [establishment.id, laborCapacity(establishment, world)]));
    const unemployed = (indexes.residentsBySettlement.get(settlement.id) ?? []).filter(character => character.age >= 14 && character.age <= 75
      && !employed.has(character.id) && !travelingCharacterIds.has(character.id) && !character.titles.some(title => /король|правитель|вождь/i.test(title)));
    for (const character of unemployed) {
      const preferred = professionPreferred[character.profession] ?? [];
      let target: Establishment | undefined;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const establishment of establishments) {
        const capacity = capacityById.get(establishment.id) ?? 2;
        const current = workerCounts.get(establishment.id) ?? 0;
        if (current >= capacity) continue;
        const preference = preferred.includes(establishment.type) ? 100 : 0;
        const vacancy = (capacity - current) / Math.max(1, capacity) * 20;
        const socialConnection = workplaceConnectionScore(world, character, establishment);
        const familyPressure = character.householdId && establishment.workerIds.some(id => world.characters.find(item => item.id === id)?.householdId === character.householdId) ? 12 : 0;
        const score = preference + vacancy + establishment.reputation / 20 + socialConnection + familyPressure - establishment.id / 1_000_000;
        if (score > bestScore) { bestScore = score; target = establishment; }
      }
      if (!target) continue;
      const preferredRole = preferred.includes(target.type);
      const skill = character.skills[character.profession] ?? 8;
      const contract: EmploymentContract = {
        id: world.nextIds.employment++, characterId: character.id, establishmentId: target.id,
        role: preferredRole ? character.profession : 'подсобный работник', wage: Math.max(3, Math.round((2.5 + skill / 18) * settlement.economy.wageIndex)),
        hoursPerWeek: 40 + character.id % 15, sinceYear: world.year, active: true,
      };
      world.employments.push(contract);
      indexes.employmentById.set(contract.id, contract);
      employed.add(character.id);
      workerCounts.set(target.id, (workerCounts.get(target.id) ?? 0) + 1);
      if (!target.workerIds.includes(character.id)) target.workerIds.push(character.id);
      const building = indexes.buildingById.get(target.buildingId);
      if (building && !building.workerIds.includes(character.id)) building.workerIds.push(character.id);
      character.employerEstablishmentId = target.id;
      character.employmentContractId = contract.id;
      character.workplaceBuildingId = target.buildingId;
      character.workplace = target.name;
    }
  }
}

function moveTravelingMerchants(world: WorldState, rng: RNG, indexes: WorldIndexes): void {
  const tick = worldTick(world);
  for (const merchant of world.travelingMerchants) {
    const character = world.characters.find(item => item.id === merchant.characterId);
    if (!character?.alive) continue;
    if (merchant.status === 'в пути' && merchant.arrivalTick > tick) continue;
    if (merchant.status === 'в пути') {
      merchant.currentSettlementId = merchant.nextSettlementId ?? merchant.currentSettlementId;
      if (character.settlementId !== merchant.currentSettlementId) moveResidentInIndexes(indexes, character, merchant.currentSettlementId);
      merchant.status = 'торгует';
      merchant.history.push(`Прибыл в ${world.settlements.find(item => item.id === merchant.currentSettlementId)?.name ?? 'поселение'} в ${world.year}.${String(world.month).padStart(2, '0')}.`);
    }
    const settlement = world.settlements.find(item => item.id === merchant.currentSettlementId);
    if (!settlement) continue;
    const buyers = settlement.establishmentIds.map(id => world.establishments.find(item => item.id === id)).filter((item): item is Establishment => Boolean(item?.active && ['рынок', 'лавка', 'одежная лавка', 'продовольственная лавка', 'оружейная лавка', 'склад'].includes(item.type)));
    for (const itemId of [...merchant.wagonInventoryItemIds]) {
      const item = world.items.find(candidate => candidate.id === itemId && candidate.quantity > .1 && candidate.condition > 0);
      const buyer = buyers.sort((a, b) => b.cash - a.cash)[0];
      if (!item || !buyer) continue;
      const quantity = Math.min(item.quantity, Math.max(.5, item.quantity * .25));
      const unit = retailPrice(settlement, item) * .75;
      const paid = Math.min(buyer.cash, quantity * unit);
      const moved = paid / Math.max(.01, unit);
      if (moved <= .05) continue;
      item.quantity -= moved;
      buyer.cash -= paid;
      merchant.cash += paid;
      const stock = addMaterialItem(world, item.templateId, moved, settlement.id, { establishmentId: buyer.id, buildingId: buyer.buildingId }, `куплено у странствующего торговца ${character.name}`, item.quality);
      if (stock) stock.dye = item.dye;
      addTransaction(world, { settlementId: settlement.id, sellerCharacterId: character.id, establishmentId: buyer.id, travelingMerchantId: merchant.id, templateId: item.templateId, quantity: moved, totalPrice: paid, purpose: 'оптовая продажа странствующего торговца' });
    }
    const nextIndex = (merchant.routeSettlementIds.indexOf(merchant.currentSettlementId) + 1) % merchant.routeSettlementIds.length;
    merchant.nextSettlementId = merchant.routeSettlementIds[nextIndex];
    const next = world.settlements.find(item => item.id === merchant.nextSettlementId);
    const distance = next ? Math.hypot(next.x - settlement.x, next.y - settlement.y) : 1;
    const route = world.tradeRoutes.find(item => [item.fromSettlementId, item.toSettlementId].includes(merchant.currentSettlementId) && [item.fromSettlementId, item.toSettlementId].includes(merchant.nextSettlementId!));
    if (route && route.safety < 35 && rng.chance((35 - route.safety) / 180)) {
      merchant.cash *= .65;
      for (const itemId of merchant.wagonInventoryItemIds) {
        const item = world.items.find(candidate => candidate.id === itemId);
        if (item) item.quantity *= .6;
      }
      merchant.status = 'ограблен';
      merchant.history.push(`Ограблен на пути в ${world.year}.${String(world.month).padStart(2, '0')}.`);
    } else merchant.status = 'в пути';
    merchant.arrivalTick = tick + Math.max(1, Math.ceil(distance / 3));
  }
}

export interface DetailedPopulationContext {
  settlementIds: Set<number>;
  characterIds: Set<number>;
  householdIds: Set<number>;
}

export function detailedPopulationContext(world: WorldState, indexes: WorldIndexes, activeSettlementIds?: ReadonlySet<number>): DetailedPopulationContext {
  const context: DetailedPopulationContext = { settlementIds: new Set(), characterIds: new Set(), householdIds: new Set() };
  const settlementIds = activeSettlementIds ?? new Set<number>();
  if (!settlementIds.size) return context;
  const perSettlementLimit = Math.max(8, Math.floor(MAX_DETAILED_CHARACTERS / Math.max(1, settlementIds.size)));
  for (const settlementId of settlementIds) {
    const residents = indexes.residentsBySettlement.get(settlementId) ?? [];
    const candidates = residents
      .filter(character => character.alive)
      .sort((a, b) => Number(Boolean(b.titles.length)) - Number(Boolean(a.titles.length))
        || Number(Boolean(b.courtOfficeIds?.length)) - Number(Boolean(a.courtOfficeIds?.length))
        || b.renown - a.renown || a.id - b.id)
      .slice(0, perSettlementLimit);
    if (!candidates.length) continue;
    context.settlementIds.add(settlementId);
    for (const character of candidates) {
      if (context.characterIds.size >= MAX_DETAILED_CHARACTERS) break;
      context.characterIds.add(character.id);
      if (character.householdId) context.householdIds.add(character.householdId);
    }
  }
  return context;
}

export function advanceLivingEconomy(world: WorldState, rng: RNG, indexes: WorldIndexes, detailed: DetailedPopulationContext): void {
  initializeLivingEconomy(world, rng);
  const itemById = indexes.itemById;
  compactWear(world, rng, detailed.characterIds, itemById);
  rebalanceLabor(world, indexes);
  moveTravelingMerchants(world, rng, indexes);
  const householdById = indexes.householdById;
  for (const settlementId of detailed.settlementIds) {
    const settlement = indexes.settlementById.get(settlementId);
    if (!settlement) continue;
    const establishments = indexes.establishmentsBySettlement.get(settlementId) ?? [];
    const residents = [...detailed.characterIds].map(id => indexes.characterById.get(id)).filter((character): character is Character => Boolean(character?.alive && character.settlementId === settlementId));
    for (const character of residents) {
      const household = character.householdId ? householdById.get(character.householdId) : undefined;
      ensureCharacterProfile(world, character, household);
      materializeCharacterEquipment(world, character, itemById);
      simulateDetailedNeeds(world, settlement, character, household, rng, itemById, establishments);
    }
    for (const householdId of detailed.householdIds) {
      const household = householdById.get(householdId);
      if (!household) continue;
      const members = household.memberIds.map(id => indexes.characterById.get(id)).filter((item): item is Character => Boolean(item?.alive));
      if (!members.length) continue;
      household.needs.hunger = Math.round(members.reduce((sum, item) => sum + item.needs.hunger, 0) / members.length);
      household.needs.thirst = Math.round(members.reduce((sum, item) => sum + item.needs.thirst, 0) / members.length);
      household.needs.rest = Math.round(members.reduce((sum, item) => sum + item.needs.rest, 0) / members.length);
      household.needs.lastUpdatedTick = worldTick(world);
    }
  }
  pruneEmptyMaterialItems(world);
  if (world.month === 12 && detailed.settlementIds.size) appendCausalEvent(world, {
    kind: 'retail', title: 'Год местной торговли завершён', description: 'Жители активных районов получали жалование, покупали еду, воду, одежду и инструменты.',
    cause: 'работа рынков и личные потребности жителей', consequences: ['товары изнашивались', 'деньги переходили между жителями и лавками'],
    entityRefs: [...detailed.settlementIds].slice(0, 3).map(id => ({ kind: 'settlement' as const, id })), importance: 1,
  });
}


export function livingEconomyIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const characterById = new Map(world.characters.map(character => [character.id, character]));
  const itemById = new Map(world.items.map(item => [item.id, item]));
  const settlementIds = new Set(world.settlements.map(settlement => settlement.id));
  const merchantIds = new Set<number>();
  for (const character of world.characters) {
    if (typeof character.wallet !== 'number' || character.wallet < 0) issues.push(`${character.name}: неверный личный кошелёк`);
    if (!character.equipment) { issues.push(`${character.name}: отсутствует профиль экипировки`); continue; }
    for (const [slot, itemId] of Object.entries(character.equipment.equippedItemIds ?? {})) {
      const item = itemById.get(itemId);
      if (!item) { issues.push(`${character.name}: в слоте ${slot} отсутствует предмет ${itemId}`); continue; }
      if (item.ownerCharacterId !== character.id || item.equippedByCharacterId !== character.id) issues.push(`${character.name}: предмет ${itemId} экипирован чужим владельцем`);
      if (item.equipmentSlot && item.equipmentSlot !== slot) issues.push(`${character.name}: предмет ${itemId} находится в неверном слоте ${slot}`);
    }
  }
  for (const merchant of world.travelingMerchants ?? []) {
    if (merchantIds.has(merchant.id)) issues.push(`Странствующий торговец ${merchant.id}: повторяющийся ID`);
    merchantIds.add(merchant.id);
    const character = characterById.get(merchant.characterId);
    if (!character?.alive) issues.push(`Странствующий торговец ${merchant.id}: нет живого персонажа`);
    if (!settlementIds.has(merchant.currentSettlementId)) issues.push(`Странствующий торговец ${merchant.id}: неизвестное текущее поселение`);
    if (merchant.nextSettlementId && !settlementIds.has(merchant.nextSettlementId)) issues.push(`Странствующий торговец ${merchant.id}: неизвестная следующая остановка`);
    for (const itemId of merchant.wagonInventoryItemIds) if (!itemById.has(itemId)) issues.push(`Странствующий торговец ${merchant.id}: отсутствует товар ${itemId}`);
  }
  for (const transaction of world.marketTransactions ?? []) {
    if (!settlementIds.has(transaction.settlementId)) issues.push(`Сделка ${transaction.id}: неизвестное поселение`);
    if (transaction.quantity <= 0 || transaction.totalPrice < 0) issues.push(`Сделка ${transaction.id}: неверное количество или цена`);
  }
  return [...new Set(issues)];
}
