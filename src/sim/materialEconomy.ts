import type {
  Building, BuildingType, Character, EmploymentContract, Establishment, EstablishmentType, Household, HouseholdStatus,
  EquipmentSlot, ItemCategory, NeedState, ProductionRecipe, Settlement, SettlementEconomy, TradeShipment,
  WorldItem, WorldState,
} from '../types';
import type { WorldIndexes } from './indexes';
import { appendCausalEvent } from './causality';
import { hashSeed, RNG } from './rng';
import { worldTick } from './scheduler';
import { assignBuildingFootprint, buildingDimensions } from './spatial';

interface ItemTemplate {
  id: string;
  name: string;
  category: ItemCategory;
  material: string;
  unit: string;
  weight: number;
  perishability: number;
  value: number;
  equipmentSlot?: EquipmentSlot;
  dye?: string;
  warmth?: number;
  armor?: number;
  damage?: number;
  toolType?: string;
  requiredProfession?: string;
  maxCondition?: number;
}

const ITEM_TEMPLATES: ItemTemplate[] = [
  { id: 'grain', name: 'зерно', category: 'сырьё', material: 'зерно', unit: 'мешок', weight: 25, perishability: 18, value: 7 },
  { id: 'flour', name: 'мука', category: 'сырьё', material: 'мука', unit: 'мешок', weight: 20, perishability: 8, value: 11 },
  { id: 'bread', name: 'хлеб', category: 'еда', material: 'выпечка', unit: 'буханка', weight: .7, perishability: 1, value: 2.2 },
  { id: 'vegetables', name: 'овощи и коренья', category: 'еда', material: 'растительная пища', unit: 'корзина', weight: 8, perishability: 3, value: 5 },
  { id: 'fruit', name: 'фрукты и ягоды', category: 'еда', material: 'растительная пища', unit: 'корзина', weight: 6, perishability: 2, value: 6 },
  { id: 'meat', name: 'свежее мясо', category: 'еда', material: 'мясо', unit: 'туша', weight: 18, perishability: 1, value: 14 },
  { id: 'smoked_meat', name: 'копчёное мясо', category: 'еда', material: 'мясо', unit: 'связка', weight: 6, perishability: 10, value: 13 },
  { id: 'fish', name: 'свежая рыба', category: 'еда', material: 'рыба', unit: 'корзина', weight: 10, perishability: 1, value: 9 },
  { id: 'salted_fish', name: 'солёная рыба', category: 'еда', material: 'рыба', unit: 'бочонок', weight: 14, perishability: 12, value: 16 },
  { id: 'milk', name: 'молоко', category: 'еда', material: 'молоко', unit: 'кувшин', weight: 2, perishability: 1, value: 2 },
  { id: 'eggs', name: 'яйца', category: 'еда', material: 'яйца', unit: 'десяток', weight: .7, perishability: 2, value: 2.4 },
  { id: 'stew', name: 'горячая похлёбка', category: 'еда', material: 'готовое блюдо', unit: 'порция', weight: .6, perishability: 1, value: 2.8 },
  { id: 'roast', name: 'жаркое', category: 'еда', material: 'готовое блюдо', unit: 'порция', weight: .7, perishability: 1, value: 4.4 },
  { id: 'ale', name: 'эль', category: 'напиток', material: 'ячменный напиток', unit: 'кружка', weight: .6, perishability: 8, value: 1.7 },
  { id: 'wine', name: 'вино', category: 'напиток', material: 'виноградный напиток', unit: 'бутыль', weight: 1.2, perishability: 60, value: 8 },
  { id: 'water', name: 'чистая вода', category: 'напиток', material: 'вода', unit: 'бурдюк', weight: 3, perishability: 2, value: .4 },
  { id: 'firewood', name: 'дрова', category: 'топливо', material: 'древесина', unit: 'вязанка', weight: 12, perishability: 0, value: 3 },
  { id: 'charcoal', name: 'древесный уголь', category: 'топливо', material: 'уголь', unit: 'мешок', weight: 10, perishability: 0, value: 6 },
  { id: 'timber', name: 'строевая древесина', category: 'сырьё', material: 'древесина', unit: 'бревно', weight: 45, perishability: 0, value: 10 },
  { id: 'stone', name: 'тёсаный камень', category: 'сырьё', material: 'камень', unit: 'блок', weight: 35, perishability: 0, value: 8 },
  { id: 'iron_ore', name: 'железная руда', category: 'сырьё', material: 'руда', unit: 'корзина', weight: 30, perishability: 0, value: 9 },
  { id: 'iron', name: 'железная крица', category: 'сырьё', material: 'железо', unit: 'слиток', weight: 7, perishability: 0, value: 19 },
  { id: 'wool', name: 'шерсть', category: 'сырьё', material: 'шерсть', unit: 'тюк', weight: 8, perishability: 0, value: 8 },
  { id: 'cloth', name: 'ткань', category: 'сырьё', material: 'ткань', unit: 'рулон', weight: 4, perishability: 0, value: 18 },
  { id: 'clothes', name: 'простая одежда', category: 'одежда', material: 'ткань', unit: 'комплект', weight: 2, perishability: 0, value: 26 },
  { id: 'tools', name: 'рабочие инструменты', category: 'инструмент', material: 'железо и дерево', unit: 'набор', weight: 5, perishability: 0, value: 34 },
  { id: 'weapon', name: 'обычное оружие', category: 'оружие', material: 'железо и дерево', unit: 'штука', weight: 3, perishability: 0, value: 48 },
  { id: 'furniture', name: 'простая мебель', category: 'мебель', material: 'древесина', unit: 'предмет', weight: 16, perishability: 0, value: 22 },
  { id: 'herbal_medicine', name: 'лечебный отвар', category: 'лекарство', material: 'травы', unit: 'склянка', weight: .3, perishability: 4, value: 12 },
  { id: 'salt', name: 'соль', category: 'сырьё', material: 'соль', unit: 'мешочек', weight: 2, perishability: 0, value: 4 },
  { id: 'wheat_seed', name: 'семена пшеницы', category: 'семена', material: 'семена', unit: 'мера', weight: 1, perishability: 24, value: 4 },
  { id: 'barley_seed', name: 'семена ячменя', category: 'семена', material: 'семена', unit: 'мера', weight: 1, perishability: 24, value: 4 },
  { id: 'rye_seed', name: 'семена ржи', category: 'семена', material: 'семена', unit: 'мера', weight: 1, perishability: 24, value: 4 },
  { id: 'flax_seed', name: 'семена льна', category: 'семена', material: 'семена', unit: 'мера', weight: .8, perishability: 24, value: 5 },
  { id: 'vegetable_seed', name: 'семена овощей', category: 'семена', material: 'семена', unit: 'мешочек', weight: .6, perishability: 18, value: 5 },
  { id: 'wheat', name: 'пшеница', category: 'сырьё', material: 'зерно', unit: 'мешок', weight: 25, perishability: 18, value: 8 },
  { id: 'barley', name: 'ячмень', category: 'сырьё', material: 'зерно', unit: 'мешок', weight: 25, perishability: 18, value: 7 },
  { id: 'rye', name: 'рожь', category: 'сырьё', material: 'зерно', unit: 'мешок', weight: 25, perishability: 20, value: 7 },
  { id: 'flax', name: 'лён', category: 'сырьё', material: 'растительное волокно', unit: 'сноп', weight: 8, perishability: 10, value: 9 },
  { id: 'straw', name: 'солома', category: 'сырьё', material: 'солома', unit: 'тюк', weight: 7, perishability: 18, value: 3 },
  { id: 'planks', name: 'доски', category: 'сырьё', material: 'древесина', unit: 'связка', weight: 18, perishability: 0, value: 15 },
  { id: 'clay', name: 'глина', category: 'сырьё', material: 'глина', unit: 'корзина', weight: 28, perishability: 0, value: 5 },
  { id: 'bricks', name: 'обожжённый кирпич', category: 'сырьё', material: 'керамика', unit: 'партия', weight: 35, perishability: 0, value: 16 },
  { id: 'lime', name: 'строительная известь', category: 'сырьё', material: 'известь', unit: 'мешок', weight: 20, perishability: 0, value: 12 },
  { id: 'nails', name: 'железные гвозди', category: 'сырьё', material: 'железо', unit: 'короб', weight: 4, perishability: 0, value: 15 },
  { id: 'rope', name: 'льняная верёвка', category: 'инструмент', material: 'лён', unit: 'моток', weight: 3, perishability: 0, value: 14, toolType: 'верёвка', maxCondition: 90 },
  { id: 'flax_fiber', name: 'льняное волокно', category: 'сырьё', material: 'лён', unit: 'тюк', weight: 5, perishability: 0, value: 11 },
  { id: 'linen_thread', name: 'льняная нить', category: 'сырьё', material: 'лён', unit: 'моток', weight: 1.5, perishability: 0, value: 15 },
  { id: 'linen_cloth', name: 'льняная ткань', category: 'сырьё', material: 'лён', unit: 'рулон', weight: 3, perishability: 0, value: 23 },
  { id: 'wool_yarn', name: 'шерстяная пряжа', category: 'сырьё', material: 'шерсть', unit: 'моток', weight: 2, perishability: 0, value: 14 },
  { id: 'wool_cloth', name: 'шерстяная ткань', category: 'сырьё', material: 'шерсть', unit: 'рулон', weight: 4, perishability: 0, value: 28 },
  { id: 'raw_hide', name: 'сырая шкура', category: 'сырьё', material: 'шкура', unit: 'шкура', weight: 6, perishability: 2, value: 10 },
  { id: 'leather', name: 'дублёная кожа', category: 'сырьё', material: 'кожа', unit: 'лист', weight: 4, perishability: 0, value: 22 },
  { id: 'dye_blue', name: 'синий краситель', category: 'краситель', material: 'вайда', unit: 'мешочек', weight: .3, perishability: 24, value: 18, dye: 'синий' },
  { id: 'dye_red', name: 'красный краситель', category: 'краситель', material: 'марена', unit: 'мешочек', weight: .3, perishability: 24, value: 21, dye: 'красный' },
  { id: 'dye_yellow', name: 'жёлтый краситель', category: 'краситель', material: 'резеда', unit: 'мешочек', weight: .3, perishability: 24, value: 14, dye: 'жёлтый' },
  { id: 'dye_brown', name: 'коричневый краситель', category: 'краситель', material: 'кора и орех', unit: 'мешочек', weight: .4, perishability: 30, value: 9, dye: 'коричневый' },
  { id: 'dye_purple', name: 'пурпурный краситель', category: 'краситель', material: 'редкий пигмент', unit: 'склянка', weight: .2, perishability: 36, value: 90, dye: 'пурпурный' },
  { id: 'linen_hood', name: 'льняной капюшон', category: 'одежда', material: 'лён', unit: 'штука', weight: .3, perishability: 0, value: 11, equipmentSlot: 'head', warmth: 5, armor: 0, maxCondition: 70 },
  { id: 'linen_shirt', name: 'льняная рубаха', category: 'одежда', material: 'лён', unit: 'штука', weight: .7, perishability: 0, value: 18, equipmentSlot: 'body', warmth: 7, armor: 0, maxCondition: 75 },
  { id: 'wool_tunic', name: 'шерстяная туника', category: 'одежда', material: 'шерсть', unit: 'штука', weight: 1.1, perishability: 0, value: 30, equipmentSlot: 'body', warmth: 18, armor: 1, maxCondition: 85 },
  { id: 'wool_trousers', name: 'шерстяные штаны', category: 'одежда', material: 'шерсть', unit: 'штука', weight: .8, perishability: 0, value: 22, equipmentSlot: 'legs', warmth: 12, armor: 0, maxCondition: 80 },
  { id: 'leather_shoes', name: 'кожаные башмаки', category: 'одежда', material: 'кожа', unit: 'пара', weight: .9, perishability: 0, value: 27, equipmentSlot: 'feet', warmth: 7, armor: 1, maxCondition: 90 },
  { id: 'leather_gloves', name: 'кожаные перчатки', category: 'одежда', material: 'кожа', unit: 'пара', weight: .4, perishability: 0, value: 19, equipmentSlot: 'hands', warmth: 6, armor: 1, maxCondition: 85 },
  { id: 'wool_cloak', name: 'шерстяной плащ', category: 'одежда', material: 'шерсть', unit: 'штука', weight: 1.5, perishability: 0, value: 38, equipmentSlot: 'cloak', warmth: 22, armor: 1, maxCondition: 90 },
  { id: 'royal_cloak', name: 'пурпурный придворный плащ', category: 'одежда', material: 'тонкая шерсть', unit: 'штука', weight: 1.2, perishability: 0, value: 180, equipmentSlot: 'cloak', dye: 'пурпурный', warmth: 20, armor: 1, maxCondition: 100 },
  { id: 'padded_cap', name: 'стёганая шапка', category: 'броня', material: 'лён и шерсть', unit: 'штука', weight: .8, perishability: 0, value: 24, equipmentSlot: 'head', warmth: 10, armor: 3, maxCondition: 90 },
  { id: 'gambeson', name: 'гамбезон', category: 'броня', material: 'стёганый лён', unit: 'штука', weight: 5, perishability: 0, value: 70, equipmentSlot: 'body', warmth: 18, armor: 7, maxCondition: 100 },
  { id: 'leather_armor', name: 'кожаный доспех', category: 'броня', material: 'кожа', unit: 'штука', weight: 6, perishability: 0, value: 95, equipmentSlot: 'body', warmth: 12, armor: 10, maxCondition: 110 },
  { id: 'chainmail', name: 'кольчуга', category: 'броня', material: 'железо', unit: 'штука', weight: 11, perishability: 0, value: 230, equipmentSlot: 'body', warmth: 4, armor: 18, maxCondition: 125 },
  { id: 'iron_helmet', name: 'железный шлем', category: 'броня', material: 'железо', unit: 'штука', weight: 2.5, perishability: 0, value: 85, equipmentSlot: 'head', warmth: 2, armor: 14, maxCondition: 120 },
  { id: 'wooden_shield', name: 'деревянный щит', category: 'броня', material: 'дерево и кожа', unit: 'штука', weight: 4, perishability: 0, value: 38, equipmentSlot: 'offHand', armor: 8, maxCondition: 95 },
  { id: 'knife', name: 'рабочий нож', category: 'оружие', material: 'железо', unit: 'штука', weight: .5, perishability: 0, value: 18, equipmentSlot: 'mainHand', damage: 4, maxCondition: 85 },
  { id: 'club', name: 'дубина', category: 'оружие', material: 'дерево', unit: 'штука', weight: 2, perishability: 0, value: 5, equipmentSlot: 'mainHand', damage: 5, maxCondition: 70 },
  { id: 'spear', name: 'копьё', category: 'оружие', material: 'железо и дерево', unit: 'штука', weight: 2.5, perishability: 0, value: 34, equipmentSlot: 'mainHand', damage: 8, maxCondition: 95 },
  { id: 'sword', name: 'железный меч', category: 'оружие', material: 'железо', unit: 'штука', weight: 1.5, perishability: 0, value: 110, equipmentSlot: 'mainHand', damage: 11, maxCondition: 115 },
  { id: 'longbow', name: 'длинный лук', category: 'оружие', material: 'дерево и сухожилия', unit: 'штука', weight: 1.2, perishability: 0, value: 65, equipmentSlot: 'mainHand', damage: 9, maxCondition: 90 },
  { id: 'sickle', name: 'серп', category: 'инструмент', material: 'железо и дерево', unit: 'штука', weight: 1, perishability: 0, value: 22, equipmentSlot: 'workTool', toolType: 'земледелие', requiredProfession: 'farmer', maxCondition: 90 },
  { id: 'hoe', name: 'мотыга', category: 'инструмент', material: 'железо и дерево', unit: 'штука', weight: 2.5, perishability: 0, value: 28, equipmentSlot: 'workTool', toolType: 'земледелие', requiredProfession: 'farmer', maxCondition: 95 },
  { id: 'pickaxe', name: 'кирка', category: 'инструмент', material: 'железо и дерево', unit: 'штука', weight: 4, perishability: 0, value: 46, equipmentSlot: 'workTool', toolType: 'добыча', requiredProfession: 'miner', maxCondition: 105 },
  { id: 'wood_axe', name: 'лесной топор', category: 'инструмент', material: 'железо и дерево', unit: 'штука', weight: 2.8, perishability: 0, value: 42, equipmentSlot: 'workTool', toolType: 'лесозаготовка', requiredProfession: 'carpenter', maxCondition: 100 },
  { id: 'smith_hammer', name: 'кузнечный молот', category: 'инструмент', material: 'железо и дерево', unit: 'штука', weight: 3.5, perishability: 0, value: 55, equipmentSlot: 'workTool', toolType: 'кузнечное дело', requiredProfession: 'blacksmith', maxCondition: 115 },
  { id: 'carpenter_saw', name: 'плотницкая пила', category: 'инструмент', material: 'железо и дерево', unit: 'штука', weight: 2, perishability: 0, value: 48, equipmentSlot: 'workTool', toolType: 'плотницкое дело', requiredProfession: 'carpenter', maxCondition: 95 },
  { id: 'fishing_net', name: 'рыболовная сеть', category: 'инструмент', material: 'лён', unit: 'штука', weight: 4, perishability: 0, value: 36, equipmentSlot: 'workTool', toolType: 'рыболовство', requiredProfession: 'fisher', maxCondition: 80 },
  { id: 'herb_knife', name: 'нож травника', category: 'инструмент', material: 'железо и дерево', unit: 'штука', weight: .4, perishability: 0, value: 19, equipmentSlot: 'workTool', toolType: 'собирательство', requiredProfession: 'herbalist', maxCondition: 80 },
  { id: 'mortar', name: 'ступка и пестик', category: 'инструмент', material: 'камень', unit: 'набор', weight: 3, perishability: 0, value: 31, equipmentSlot: 'workTool', toolType: 'алхимия', requiredProfession: 'healer', maxCondition: 110 },
  { id: 'tailoring_kit', name: 'набор портного', category: 'инструмент', material: 'железо, дерево и нить', unit: 'набор', weight: 1.2, perishability: 0, value: 39, equipmentSlot: 'workTool', toolType: 'портняжное дело', requiredProfession: 'tailor', maxCondition: 90 },
  { id: 'spindle', name: 'веретено и челнок', category: 'инструмент', material: 'дерево', unit: 'набор', weight: .8, perishability: 0, value: 18, equipmentSlot: 'workTool', toolType: 'ткачество', requiredProfession: 'weaver', maxCondition: 80 },
  { id: 'tanner_knife', name: 'нож кожевника', category: 'инструмент', material: 'железо и дерево', unit: 'штука', weight: .8, perishability: 0, value: 27, equipmentSlot: 'workTool', toolType: 'кожевенное дело', requiredProfession: 'tanner', maxCondition: 90 },
  { id: 'crossbow', name: 'арбалет', category: 'оружие', material: 'дерево и железо', unit: 'штука', weight: 4.2, perishability: 0, value: 105, equipmentSlot: 'mainHand', damage: 13, maxCondition: 110 },
  { id: 'arrow_bundle', name: 'колчан стрел', category: 'оружие', material: 'дерево, железо и перо', unit: 'колчан', weight: 2.2, perishability: 0, value: 22, maxCondition: 100 },
  { id: 'bolt_bundle', name: 'связка арбалетных болтов', category: 'оружие', material: 'дерево и железо', unit: 'связка', weight: 2.8, perishability: 0, value: 28, maxCondition: 100 },
  { id: 'lance', name: 'кавалерийское копьё', category: 'оружие', material: 'железо и дерево', unit: 'штука', weight: 4.5, perishability: 0, value: 62, equipmentSlot: 'mainHand', damage: 14, maxCondition: 105 },
  { id: 'mace', name: 'железная булава', category: 'оружие', material: 'железо и дерево', unit: 'штука', weight: 2.4, perishability: 0, value: 78, equipmentSlot: 'mainHand', damage: 12, maxCondition: 120 },
  { id: 'bandages', name: 'чистые перевязочные материалы', category: 'лекарство', material: 'лён', unit: 'набор', weight: .6, perishability: 18, value: 10 },
  { id: 'military_rations', name: 'походный паёк', category: 'еда', material: 'сухари, соль и сушёное мясо', unit: 'паёк', weight: 1.1, perishability: 12, value: 4.5 },
  { id: 'tent', name: 'походная палатка', category: 'предмет быта', material: 'лён, кожа и дерево', unit: 'штука', weight: 18, perishability: 0, value: 65, maxCondition: 100 },
  { id: 'wagon_parts', name: 'детали для повозок', category: 'инструмент', material: 'дерево и железо', unit: 'комплект', weight: 26, perishability: 0, value: 58, toolType: 'ремонт обоза', maxCondition: 110 },
  { id: 'horse_feed', name: 'корм для лошадей', category: 'сырьё', material: 'овёс и сено', unit: 'мешок', weight: 20, perishability: 8, value: 6 },
  { id: 'cobbler_tools', name: 'инструменты сапожника', category: 'инструмент', material: 'железо и дерево', unit: 'набор', weight: 1.4, perishability: 0, value: 36, equipmentSlot: 'workTool', toolType: 'сапожное дело', requiredProfession: 'cobbler', maxCondition: 95 },
];
const ITEM_BY_ID = new Map(ITEM_TEMPLATES.map(item => [item.id, item]));

const PRODUCTION_TOOL_IDS: Partial<Record<string, string[]>> = {
  farmer: ['sickle', 'hoe', 'tools'], miner: ['pickaxe', 'tools'], carpenter: ['wood_axe', 'carpenter_saw', 'tools'], blacksmith: ['smith_hammer', 'tools'],
  toolmaker: ['smith_hammer', 'tools'], armorer: ['smith_hammer', 'tools'], fisher: ['fishing_net', 'tools'], herbalist: ['herb_knife', 'knife'],
  healer: ['mortar', 'tools'], tailor: ['tailoring_kit', 'tools'], weaver: ['spindle', 'tools'], dyer: ['tools'], tanner: ['tanner_knife', 'knife', 'tools'],
  cobbler: ['cobbler_tools', 'tools'], hunter: ['longbow', 'knife'], cook: ['knife', 'tools'], miller: ['tools'], brewer: ['tools'],
};

function equipmentMetadata(template: ItemTemplate): Partial<WorldItem> {
  return { equipmentSlot: template.equipmentSlot, dye: template.dye, warmth: template.warmth, armor: template.armor, damage: template.damage, toolType: template.toolType, requiredProfession: template.requiredProfession, maxCondition: template.maxCondition };
}

interface MaterialRuntime {
  itemById: Map<number, WorldItem>;
  characterById: Map<number, Character>;
  householdById: Map<number, Household>;
  establishmentById: Map<number, Establishment>;
  buildingById: WorldIndexes['buildingById'];
  buildingsBySettlement: Map<number, Building[]>;
  settlementById: Map<number, Settlement>;
  kingdomById: WorldIndexes['kingdomById'];
  recipeById: Map<number, ProductionRecipe>;
  establishmentsBySettlement: Map<number, Establishment[]>;
  employmentByEstablishment: Map<number, EmploymentContract[]>;
  stackByKey: Map<string, WorldItem>;
  offersBySettlementTemplate: Map<string, { establishment: Establishment; item: WorldItem }[]>;
}

let activeRuntime: MaterialRuntime | undefined;
const materialRuntimeCache = new WeakMap<WorldState, MaterialRuntime>();

function itemOwnerKey(item: Pick<WorldItem, 'householdId' | 'establishmentId' | 'buildingId' | 'ownerCharacterId' | 'supplyWagonId'>): string {
  return `${item.householdId ?? 0}:${item.establishmentId ?? 0}:${item.buildingId ?? 0}:${item.ownerCharacterId ?? 0}:${item.supplyWagonId ?? 0}`;
}

function itemStackKey(item: Pick<WorldItem, 'templateId' | 'householdId' | 'establishmentId' | 'buildingId' | 'ownerCharacterId' | 'quality' | 'freshness' | 'dye'>): string {
  return `${item.templateId}:${itemOwnerKey(item)}:${Math.round(item.quality / 10)}:${item.dye ?? 'без-красителя'}`;
}

function offerKey(settlementId: number, templateId: string): string { return `${settlementId}:${templateId}`; }

function registerRuntimeOffer(item: WorldItem): void {
  if (!activeRuntime || !item.establishmentId) return;
  const establishment = activeRuntime.establishmentById.get(item.establishmentId);
  if (!establishment) return;
  const key = offerKey(item.settlementId, item.templateId);
  const list = activeRuntime.offersBySettlementTemplate.get(key) ?? [];
  if (!list.some(entry => entry.item.id === item.id)) list.push({ establishment, item });
  activeRuntime.offersBySettlementTemplate.set(key, list);
}

function createGenerationRuntime(world: WorldState): MaterialRuntime {
  const establishmentsBySettlement = new Map<number, Establishment[]>();
  const buildingsBySettlement = new Map<number, Building[]>();
  for (const building of world.buildings) {
    const list = buildingsBySettlement.get(building.settlementId) ?? [];
    list.push(building);
    buildingsBySettlement.set(building.settlementId, list);
  }
  const employmentByEstablishment = new Map<number, EmploymentContract[]>();
  const stackByKey = new Map<string, WorldItem>();
  const offersBySettlementTemplate = new Map<string, { establishment: Establishment; item: WorldItem }[]>();
  return {
    itemById: new Map(world.items.map(item => [item.id, item])),
    characterById: new Map(world.characters.map(item => [item.id, item])),
    householdById: new Map(world.households.map(item => [item.id, item])),
    establishmentById: new Map(world.establishments.map(item => [item.id, item])),
    buildingById: new Map(world.buildings.map(item => [item.id, item])),
    buildingsBySettlement,
    settlementById: new Map(world.settlements.map(item => [item.id, item])),
    kingdomById: new Map(world.kingdoms.map(item => [item.id, item])),
    recipeById: new Map(world.productionRecipes.map(item => [item.id, item])),
    establishmentsBySettlement,
    employmentByEstablishment,
    stackByKey,
    offersBySettlementTemplate,
  };
}

function createMaterialRuntime(world: WorldState, indexes: WorldIndexes): MaterialRuntime {
  const cached = materialRuntimeCache.get(world);
  if (cached && cached.itemById === indexes.itemById && cached.establishmentById === indexes.establishmentById) return cached;
  const employmentByEstablishment = new Map<number, EmploymentContract[]>();
  for (const contract of world.employments) {
    const list = employmentByEstablishment.get(contract.establishmentId) ?? [];
    list.push(contract);
    employmentByEstablishment.set(contract.establishmentId, list);
  }
  const stackByKey = new Map<string, WorldItem>();
  const offersBySettlementTemplate = new Map<string, { establishment: Establishment; item: WorldItem }[]>();
  for (const item of world.items) {
    if (item.quantity <= .0001 || item.condition <= 0) continue;
    stackByKey.set(itemStackKey(item), item);
    if (!item.establishmentId) continue;
    const establishment = indexes.establishmentById.get(item.establishmentId);
    if (!establishment) continue;
    const key = offerKey(item.settlementId, item.templateId);
    const list = offersBySettlementTemplate.get(key) ?? [];
    list.push({ establishment, item });
    offersBySettlementTemplate.set(key, list);
  }
  const runtime: MaterialRuntime = {
    itemById: indexes.itemById,
    characterById: indexes.characterById,
    householdById: indexes.householdById,
    establishmentById: indexes.establishmentById,
    buildingById: indexes.buildingById,
    buildingsBySettlement: indexes.buildingsBySettlement,
    settlementById: indexes.settlementById,
    kingdomById: indexes.kingdomById,
    recipeById: indexes.productionRecipeById,
    establishmentsBySettlement: indexes.establishmentsBySettlement,
    employmentByEstablishment,
    stackByKey,
    offersBySettlementTemplate,
  };
  materialRuntimeCache.set(world, runtime);
  return runtime;
}

const recipeSeeds: Omit<ProductionRecipe, 'id'>[] = [
  { name: 'Сбор хвороста и дров', category: 'добыча', profession: 'farmer', establishmentTypes: ['ферма'], inputs: [], outputs: [{ templateId: 'firewood', quantity: 6 }], laborHours: 8, minimumSkill: 5, description: 'Сельские дворы заготавливают топливо в окрестных лесах и изгородях.' },
  { name: 'Молочное хозяйство', category: 'добыча', profession: 'farmer', establishmentTypes: ['ферма'], inputs: [], outputs: [{ templateId: 'milk', quantity: 7 }], laborHours: 10, minimumSkill: 6, description: 'Скот даёт молоко для семей, рынков и кухонь.' },
  { name: 'Птичий двор', category: 'добыча', profession: 'farmer', establishmentTypes: ['ферма'], inputs: [], outputs: [{ templateId: 'eggs', quantity: 6 }], laborHours: 7, minimumSkill: 5, description: 'Домашняя птица даёт яйца и поддерживает повседневное питание.' },
  { name: 'Заготовка древесины', category: 'добыча', profession: 'carpenter', establishmentTypes: ['плотницкая мастерская'], inputs: [], outputs: [{ templateId: 'timber', quantity: 5 }, { templateId: 'firewood', quantity: 7 }], laborHours: 22, minimumSkill: 12, description: 'Лес превращается в брёвна и топливо.' },
  { name: 'Рыбный промысел', category: 'добыча', profession: 'fisher', establishmentTypes: ['рыбный промысел'], inputs: [], outputs: [{ templateId: 'fish', quantity: 8 }], laborHours: 18, minimumSkill: 8, description: 'Рыбаки возвращаются с уловом.' },
  { name: 'Добыча железной руды', category: 'добыча', profession: 'miner', establishmentTypes: ['рудник'], inputs: [], outputs: [{ templateId: 'iron_ore', quantity: 6 }, { templateId: 'stone', quantity: 4 }], laborHours: 26, minimumSkill: 12, description: 'Шахтёры добывают руду и камень.' },
  { name: 'Помол муки', category: 'переработка', profession: 'miller', establishmentTypes: ['мельница'], inputs: [{ templateId: 'grain', quantity: 4 }], outputs: [{ templateId: 'flour', quantity: 4 }], laborHours: 8, minimumSkill: 8, description: 'Мельница превращает зерно в муку.' },
  { name: 'Выпечка хлеба', category: 'готовка', profession: 'baker', establishmentTypes: ['пекарня'], inputs: [{ templateId: 'flour', quantity: 2 }, { templateId: 'firewood', quantity: 1 }], outputs: [{ templateId: 'bread', quantity: 18 }], laborHours: 10, minimumSkill: 12, description: 'Пекари выпекают ежедневный хлеб.' },
  { name: 'Похлёбка', category: 'готовка', profession: 'cook', establishmentTypes: ['таверна', 'постоялый двор'], inputs: [{ templateId: 'vegetables', quantity: 2 }, { templateId: 'grain', quantity: 1 }, { templateId: 'firewood', quantity: 1 }], outputs: [{ templateId: 'stew', quantity: 14 }], laborHours: 7, minimumSkill: 7, description: 'Дешёвая горячая пища для жителей и путников.' },
  { name: 'Мясное жаркое', category: 'готовка', profession: 'cook', establishmentTypes: ['таверна', 'постоялый двор'], inputs: [{ templateId: 'meat', quantity: 1 }, { templateId: 'vegetables', quantity: 1 }, { templateId: 'firewood', quantity: 1 }], outputs: [{ templateId: 'roast', quantity: 10 }], laborHours: 9, minimumSkill: 16, description: 'Сытное блюдо из мяса и овощей.' },
  { name: 'Копчение мяса', category: 'переработка', profession: 'cook', establishmentTypes: ['таверна', 'склад'], inputs: [{ templateId: 'meat', quantity: 2 }, { templateId: 'firewood', quantity: 1 }], outputs: [{ templateId: 'smoked_meat', quantity: 4 }], laborHours: 12, minimumSkill: 12, description: 'Мясо хранится дольше после копчения.' },
  { name: 'Засолка рыбы', category: 'переработка', profession: 'fisher', establishmentTypes: ['рыбный промысел', 'склад'], inputs: [{ templateId: 'fish', quantity: 2 }, { templateId: 'salt', quantity: 1 }], outputs: [{ templateId: 'salted_fish', quantity: 3 }], laborHours: 8, minimumSkill: 10, description: 'Рыбу засаливают для долгого пути.' },
  { name: 'Варка эля', category: 'переработка', profession: 'brewer', establishmentTypes: ['пивоварня'], inputs: [{ templateId: 'grain', quantity: 3 }, { templateId: 'firewood', quantity: 1 }], outputs: [{ templateId: 'ale', quantity: 28 }], laborHours: 20, minimumSkill: 14, description: 'Пивоварня превращает зерно в эль.' },
  { name: 'Виноделие', category: 'переработка', profession: 'brewer', establishmentTypes: ['винодельня'], inputs: [{ templateId: 'fruit', quantity: 4 }], outputs: [{ templateId: 'wine', quantity: 8 }], laborHours: 24, minimumSkill: 18, description: 'Фрукты бродят и становятся вином.' },
  { name: 'Выплавка железа', category: 'переработка', profession: 'blacksmith', establishmentTypes: ['кузница'], inputs: [{ templateId: 'iron_ore', quantity: 3 }, { templateId: 'charcoal', quantity: 2 }], outputs: [{ templateId: 'iron', quantity: 2 }], laborHours: 18, minimumSkill: 18, description: 'Руда превращается в пригодное железо.' },
  { name: 'Ковка инструментов', category: 'ремесло', profession: 'blacksmith', establishmentTypes: ['кузница'], inputs: [{ templateId: 'iron', quantity: 1 }, { templateId: 'timber', quantity: 1 }], outputs: [{ templateId: 'tools', quantity: 1 }], laborHours: 14, minimumSkill: 20, description: 'Кузнец делает инструменты для других ремёсел.' },
  { name: 'Ковка оружия', category: 'ремесло', profession: 'blacksmith', establishmentTypes: ['кузница'], inputs: [{ templateId: 'iron', quantity: 2 }, { templateId: 'timber', quantity: 1 }], outputs: [{ templateId: 'weapon', quantity: 1, qualityBonus: 5 }], laborHours: 22, minimumSkill: 28, description: 'Оружие требует больше железа и мастерства.' },
  { name: 'Изготовление мебели', category: 'ремесло', profession: 'carpenter', establishmentTypes: ['плотницкая мастерская'], inputs: [{ templateId: 'timber', quantity: 2 }, { templateId: 'tools', quantity: .05 }], outputs: [{ templateId: 'furniture', quantity: 1 }], laborHours: 18, minimumSkill: 18, description: 'Плотники делают кровати, столы и сундуки.' },
  { name: 'Ткачество', category: 'переработка', profession: 'weaver', establishmentTypes: ['ткацкая мастерская'], inputs: [{ templateId: 'wool', quantity: 2 }], outputs: [{ templateId: 'cloth', quantity: 2 }], laborHours: 16, minimumSkill: 14, description: 'Шерсть превращается в ткань.' },
  { name: 'Пошив одежды', category: 'ремесло', profession: 'weaver', establishmentTypes: ['ткацкая мастерская'], inputs: [{ templateId: 'cloth', quantity: 2 }], outputs: [{ templateId: 'clothes', quantity: 1 }], laborHours: 15, minimumSkill: 18, description: 'Ткань превращается в одежду.' },
  { name: 'Помол пшеницы', category: 'переработка', profession: 'miller', establishmentTypes: ['мельница'], inputs: [{ templateId: 'wheat', quantity: 4 }], outputs: [{ templateId: 'flour', quantity: 4 }], laborHours: 8, minimumSkill: 8, description: 'Пшеница превращается в хлебную муку.' },
  { name: 'Помол ржи', category: 'переработка', profession: 'miller', establishmentTypes: ['мельница'], inputs: [{ templateId: 'rye', quantity: 4 }], outputs: [{ templateId: 'flour', quantity: 3 }], laborHours: 9, minimumSkill: 8, description: 'Рожь превращается в тёмную муку.' },
  { name: 'Ячменный солод', category: 'переработка', profession: 'brewer', establishmentTypes: ['пивоварня'], inputs: [{ templateId: 'barley', quantity: 3 }, { templateId: 'firewood', quantity: 1 }], outputs: [{ templateId: 'ale', quantity: 30 }], laborHours: 20, minimumSkill: 14, description: 'Ячмень проращивают, сушат и варят в эль.' },
  { name: 'Распиловка досок', category: 'переработка', profession: 'carpenter', establishmentTypes: ['плотницкая мастерская'], inputs: [{ templateId: 'timber', quantity: 2 }], outputs: [{ templateId: 'planks', quantity: 3 }], laborHours: 12, minimumSkill: 14, description: 'Брёвна распускают на строительные доски.' },
  { name: 'Обжиг кирпича', category: 'переработка', profession: 'carpenter', establishmentTypes: ['кирпичная мастерская'], inputs: [{ templateId: 'clay', quantity: 3 }, { templateId: 'firewood', quantity: 2 }], outputs: [{ templateId: 'bricks', quantity: 3 }], laborHours: 18, minimumSkill: 12, description: 'Глину формуют и обжигают в печи.' },
  { name: 'Обжиг извести', category: 'переработка', profession: 'miner', establishmentTypes: ['кирпичная мастерская'], inputs: [{ templateId: 'stone', quantity: 3 }, { templateId: 'firewood', quantity: 2 }], outputs: [{ templateId: 'lime', quantity: 2 }], laborHours: 20, minimumSkill: 16, description: 'Известняк обжигают для строительного раствора.' },
  { name: 'Ковка гвоздей', category: 'ремесло', profession: 'blacksmith', establishmentTypes: ['кузница'], inputs: [{ templateId: 'iron', quantity: 1 }, { templateId: 'charcoal', quantity: 1 }], outputs: [{ templateId: 'nails', quantity: 4 }], laborHours: 12, minimumSkill: 18, description: 'Кузнец делает крепёж для стройки и кораблей.' },
  { name: 'Витьё верёвки', category: 'ремесло', profession: 'weaver', establishmentTypes: ['ткацкая мастерская'], inputs: [{ templateId: 'flax', quantity: 2 }], outputs: [{ templateId: 'rope', quantity: 2 }], laborHours: 12, minimumSkill: 14, description: 'Льняное волокно превращается в прочную верёвку.' },
  { name: 'Добыча глины и камня', category: 'добыча', profession: 'miner', establishmentTypes: ['каменоломня'], inputs: [], outputs: [{ templateId: 'clay', quantity: 5 }, { templateId: 'stone', quantity: 4 }], laborHours: 24, minimumSkill: 10, description: 'Рабочие снимают глину и добывают строительный камень.' },
  { name: 'Трепание льна', category: 'переработка', profession: 'weaver', establishmentTypes: ['ткацкая мастерская'], inputs: [{ templateId: 'flax', quantity: 2 }], outputs: [{ templateId: 'flax_fiber', quantity: 2 }], laborHours: 12, minimumSkill: 10, description: 'Лён вымачивают, сушат и превращают в волокно.' },
  { name: 'Прядение льняной нити', category: 'переработка', profession: 'weaver', establishmentTypes: ['ткацкая мастерская'], inputs: [{ templateId: 'flax_fiber', quantity: 2 }], outputs: [{ templateId: 'linen_thread', quantity: 2 }], laborHours: 12, minimumSkill: 12, description: 'Волокно прядут в ровную льняную нить.' },
  { name: 'Ткачество льняной ткани', category: 'переработка', profession: 'weaver', establishmentTypes: ['ткацкая мастерская'], inputs: [{ templateId: 'linen_thread', quantity: 3 }], outputs: [{ templateId: 'linen_cloth', quantity: 2 }], laborHours: 18, minimumSkill: 16, description: 'Нить превращается в прочную льняную ткань.' },
  { name: 'Прядение шерсти', category: 'переработка', profession: 'weaver', establishmentTypes: ['ткацкая мастерская'], inputs: [{ templateId: 'wool', quantity: 2 }], outputs: [{ templateId: 'wool_yarn', quantity: 2 }], laborHours: 12, minimumSkill: 12, description: 'Очищенную шерсть превращают в пряжу.' },
  { name: 'Ткачество шерстяной ткани', category: 'переработка', profession: 'weaver', establishmentTypes: ['ткацкая мастерская'], inputs: [{ templateId: 'wool_yarn', quantity: 3 }], outputs: [{ templateId: 'wool_cloth', quantity: 2 }], laborHours: 18, minimumSkill: 16, description: 'Шерстяную пряжу ткут в тёплую ткань.' },
  { name: 'Дубление кожи', category: 'переработка', profession: 'tanner', establishmentTypes: ['кожевенная мастерская'], inputs: [{ templateId: 'raw_hide', quantity: 2 }, { templateId: 'salt', quantity: 1 }], outputs: [{ templateId: 'leather', quantity: 2 }], laborHours: 24, minimumSkill: 14, description: 'Шкуры очищают и дубят для обуви, ремней и брони.' },
  { name: 'Синий краситель из вайды', category: 'переработка', profession: 'dyer', establishmentTypes: ['красильня'], inputs: [{ templateId: 'flax', quantity: 1 }], outputs: [{ templateId: 'dye_blue', quantity: 2 }], laborHours: 14, minimumSkill: 14, description: 'Красильщики получают стойкий синий пигмент.' },
  { name: 'Красный краситель из марены', category: 'переработка', profession: 'dyer', establishmentTypes: ['красильня'], inputs: [{ templateId: 'vegetables', quantity: 1 }], outputs: [{ templateId: 'dye_red', quantity: 2 }], laborHours: 14, minimumSkill: 14, description: 'Корни марены дают красный пигмент.' },
  { name: 'Льняная одежда', category: 'ремесло', profession: 'tailor', establishmentTypes: ['портная мастерская'], inputs: [{ templateId: 'linen_cloth', quantity: 3 }], outputs: [{ templateId: 'linen_hood', quantity: 1 }, { templateId: 'linen_shirt', quantity: 1 }], laborHours: 20, minimumSkill: 16, description: 'Портной шьёт повседневную льняную одежду.' },
  { name: 'Шерстяная одежда', category: 'ремесло', profession: 'tailor', establishmentTypes: ['портная мастерская'], inputs: [{ templateId: 'wool_cloth', quantity: 4 }], outputs: [{ templateId: 'wool_tunic', quantity: 1 }, { templateId: 'wool_trousers', quantity: 1 }, { templateId: 'wool_cloak', quantity: 1 }], laborHours: 30, minimumSkill: 20, description: 'Портной шьёт тёплый комплект одежды.' },
  { name: 'Кожаная обувь и перчатки', category: 'ремесло', profession: 'cobbler', establishmentTypes: ['сапожная мастерская'], inputs: [{ templateId: 'leather', quantity: 3 }], outputs: [{ templateId: 'leather_shoes', quantity: 1 }, { templateId: 'leather_gloves', quantity: 1 }], laborHours: 22, minimumSkill: 18, description: 'Сапожник делает обувь и рабочие перчатки.' },
  { name: 'Стёганый доспех', category: 'ремесло', profession: 'armorer', establishmentTypes: ['бронная мастерская'], inputs: [{ templateId: 'linen_cloth', quantity: 4 }, { templateId: 'wool', quantity: 2 }], outputs: [{ templateId: 'padded_cap', quantity: 1 }, { templateId: 'gambeson', quantity: 1 }], laborHours: 34, minimumSkill: 24, description: 'Бронник шьёт защитный стёганый комплект.' },
  { name: 'Кожаный доспех', category: 'ремесло', profession: 'armorer', establishmentTypes: ['бронная мастерская'], inputs: [{ templateId: 'leather', quantity: 5 }, { templateId: 'iron', quantity: 1 }], outputs: [{ templateId: 'leather_armor', quantity: 1 }], laborHours: 36, minimumSkill: 28, description: 'Кожа усиливается металлическими пластинами.' },
  { name: 'Кольчуга', category: 'ремесло', profession: 'armorer', establishmentTypes: ['бронная мастерская'], inputs: [{ templateId: 'iron', quantity: 8 }, { templateId: 'charcoal', quantity: 3 }], outputs: [{ templateId: 'chainmail', quantity: 1 }], laborHours: 80, minimumSkill: 42, description: 'Тысячи колец соединяются в тяжёлую кольчугу.' },
  { name: 'Шлем и щит', category: 'ремесло', profession: 'armorer', establishmentTypes: ['бронная мастерская'], inputs: [{ templateId: 'iron', quantity: 3 }, { templateId: 'planks', quantity: 2 }, { templateId: 'leather', quantity: 1 }], outputs: [{ templateId: 'iron_helmet', quantity: 1 }, { templateId: 'wooden_shield', quantity: 1 }], laborHours: 36, minimumSkill: 30, description: 'Бронник делает шлем и щит.' },
  { name: 'Ковка копья', category: 'ремесло', profession: 'blacksmith', establishmentTypes: ['оружейная лавка', 'кузница'], inputs: [{ templateId: 'iron', quantity: 1 }, { templateId: 'timber', quantity: 1 }], outputs: [{ templateId: 'spear', quantity: 1 }], laborHours: 18, minimumSkill: 20, description: 'Кузнец куёт наконечник и сажает его на древко.' },
  { name: 'Ковка меча', category: 'ремесло', profession: 'blacksmith', establishmentTypes: ['оружейная лавка', 'кузница'], inputs: [{ templateId: 'iron', quantity: 3 }, { templateId: 'charcoal', quantity: 2 }], outputs: [{ templateId: 'sword', quantity: 1, qualityBonus: 8 }], laborHours: 42, minimumSkill: 35, description: 'Клинок требует хорошего железа и долгой работы.' },
  { name: 'Земледельческие инструменты', category: 'ремесло', profession: 'toolmaker', establishmentTypes: ['инструментальная мастерская'], inputs: [{ templateId: 'iron', quantity: 2 }, { templateId: 'timber', quantity: 2 }], outputs: [{ templateId: 'sickle', quantity: 1 }, { templateId: 'hoe', quantity: 1 }], laborHours: 24, minimumSkill: 20, description: 'Мастер делает серпы и мотыги.' },
  { name: 'Инструменты шахтёра', category: 'ремесло', profession: 'toolmaker', establishmentTypes: ['инструментальная мастерская'], inputs: [{ templateId: 'iron', quantity: 2 }, { templateId: 'timber', quantity: 1 }], outputs: [{ templateId: 'pickaxe', quantity: 1 }], laborHours: 22, minimumSkill: 24, description: 'Мастер делает прочную кирку.' },
  { name: 'Инструменты текстильщиков', category: 'ремесло', profession: 'toolmaker', establishmentTypes: ['инструментальная мастерская'], inputs: [{ templateId: 'iron', quantity: 1 }, { templateId: 'timber', quantity: 1 }], outputs: [{ templateId: 'tailoring_kit', quantity: 1 }, { templateId: 'spindle', quantity: 1 }], laborHours: 18, minimumSkill: 18, description: 'Мастер делает ножницы, иглы, веретено и челнок.' },
  { name: 'Инструменты кожевников', category: 'ремесло', profession: 'toolmaker', establishmentTypes: ['инструментальная мастерская'], inputs: [{ templateId: 'iron', quantity: 1 }, { templateId: 'timber', quantity: 1 }], outputs: [{ templateId: 'tanner_knife', quantity: 1 }, { templateId: 'cobbler_tools', quantity: 1 }], laborHours: 20, minimumSkill: 20, description: 'Мастер делает ножи, шилья и колодки для кожи и обуви.' },
  { name: 'Инструменты плотника', category: 'ремесло', profession: 'toolmaker', establishmentTypes: ['инструментальная мастерская'], inputs: [{ templateId: 'iron', quantity: 2 }, { templateId: 'timber', quantity: 2 }], outputs: [{ templateId: 'wood_axe', quantity: 1 }, { templateId: 'carpenter_saw', quantity: 1 }], laborHours: 30, minimumSkill: 26, description: 'Мастер делает топор и пилу.' },
  { name: 'Изготовление стрел', category: 'ремесло', profession: 'blacksmith', establishmentTypes: ['арсенал', 'оружейная лавка', 'кузница'], inputs: [{ templateId: 'iron', quantity: .4 }, { templateId: 'timber', quantity: .6 }], outputs: [{ templateId: 'arrow_bundle', quantity: 3 }], laborHours: 12, minimumSkill: 16, description: 'Кузнец и древодел готовят колчаны стрел.' },
  { name: 'Изготовление арбалетов и болтов', category: 'ремесло', profession: 'blacksmith', establishmentTypes: ['арсенал', 'осадная мастерская', 'кузница'], inputs: [{ templateId: 'iron', quantity: 2 }, { templateId: 'planks', quantity: 2 }, { templateId: 'rope', quantity: 1 }], outputs: [{ templateId: 'crossbow', quantity: 1 }, { templateId: 'bolt_bundle', quantity: 2 }], laborHours: 34, minimumSkill: 32, description: 'Сложное метательное оружие собирается для гарнизонов.' },
  { name: 'Походные пайки', category: 'готовка', profession: 'cook', establishmentTypes: ['казарма', 'замковое хозяйство', 'пекарня'], inputs: [{ templateId: 'bread', quantity: 4 }, { templateId: 'smoked_meat', quantity: 1 }, { templateId: 'salt', quantity: .3 }], outputs: [{ templateId: 'military_rations', quantity: 8 }], laborHours: 8, minimumSkill: 10, description: 'Сухие пайки готовятся для похода и осады.' },
  { name: 'Походные палатки', category: 'ремесло', profession: 'tailor', establishmentTypes: ['портная мастерская', 'арсенал'], inputs: [{ templateId: 'linen_cloth', quantity: 6 }, { templateId: 'leather', quantity: 2 }, { templateId: 'timber', quantity: 1 }], outputs: [{ templateId: 'tent', quantity: 1 }], laborHours: 28, minimumSkill: 22, description: 'Портные шьют прочные армейские палатки.' },
  { name: 'Ремонтные детали обоза', category: 'ремесло', profession: 'carpenter', establishmentTypes: ['плотницкая мастерская', 'осадная мастерская'], inputs: [{ templateId: 'planks', quantity: 3 }, { templateId: 'iron', quantity: 1 }, { templateId: 'nails', quantity: 1 }], outputs: [{ templateId: 'wagon_parts', quantity: 1 }], laborHours: 24, minimumSkill: 22, description: 'Колёса, оси и скобы готовятся для военных повозок.' },
];

const professionForEstablishment: Record<EstablishmentType, string[]> = {
  'таверна': ['cook', 'brewer', 'merchant'], 'постоялый двор': ['merchant', 'cook', 'brewer'], 'пекарня': ['baker', 'miller'], 'пивоварня': ['brewer'], 'винодельня': ['brewer'],
  'кузница': ['blacksmith'], 'плотницкая мастерская': ['carpenter'], 'ткацкая мастерская': ['weaver'], 'портная мастерская': ['tailor', 'weaver'], 'красильня': ['dyer', 'weaver'],
  'кожевенная мастерская': ['tanner'], 'сапожная мастерская': ['cobbler', 'tanner'], 'бронная мастерская': ['armorer', 'blacksmith'], 'инструментальная мастерская': ['toolmaker', 'blacksmith'],
  'кирпичная мастерская': ['carpenter', 'miner'], 'каменоломня': ['miner'], 'рынок': ['merchant'], 'лавка': ['merchant'], 'продовольственная лавка': ['merchant'], 'одежная лавка': ['merchant', 'tailor'], 'оружейная лавка': ['merchant', 'blacksmith'],
  'баня': ['healer', 'merchant'], 'лечебница': ['healer', 'herbalist'], 'храм': ['priest'], 'гильдейский дом': ['merchant', 'scribe'], 'склад': ['merchant'],
  'конюшня': ['farmer', 'guard'], 'мельница': ['miller'], 'ферма': ['farmer'], 'рыбный промысел': ['fisher'], 'рудник': ['miner'],
  'городская управа': ['scribe', 'merchant'], 'суд': ['scribe', 'priest'], 'тюрьма': ['guard'], 'пожарная команда': ['carpenter', 'guard', 'farmer'], 'школа': ['scribe', 'priest'], 'приют': ['healer', 'priest', 'cook'],
  'казарма': ['soldier', 'guard'], 'арсенал': ['armorer', 'blacksmith', 'guard'], 'замковое хозяйство': ['guard', 'soldier', 'scribe', 'cook'], 'осадная мастерская': ['carpenter', 'blacksmith', 'toolmaker'],
};

const establishmentForBuilding: Partial<Record<BuildingType, EstablishmentType>> = {
  tavern: 'таверна', inn: 'постоялый двор', bakery: 'пекарня', brewery: 'пивоварня', winery: 'винодельня', blacksmith: 'кузница', carpenter: 'плотницкая мастерская',
  weaver: 'ткацкая мастерская', tailor: 'портная мастерская', dyehouse: 'красильня', tannery: 'кожевенная мастерская', cobbler: 'сапожная мастерская', armorer: 'бронная мастерская', toolmaker: 'инструментальная мастерская', kiln: 'кирпичная мастерская', quarry: 'каменоломня', market: 'рынок', shop: 'лавка', bathhouse: 'баня', healer: 'лечебница', temple: 'храм', guildhall: 'гильдейский дом',
  warehouse: 'склад', townHall: 'городская управа', courthouse: 'суд', prison: 'тюрьма', fireStation: 'пожарная команда', school: 'школа', shelter: 'приют', barracks: 'казарма', arsenal: 'арсенал', castle: 'замковое хозяйство', siegeWorkshop: 'осадная мастерская', stable: 'конюшня', mill: 'мельница', farm: 'ферма', fishery: 'рыбный промысел', mine: 'рудник',
};

const buildingMapping: Record<string, BuildingType> = {
  'королевская цитадель': 'castle', 'цитадель': 'castle', 'замок': 'castle', 'арсенал': 'arsenal', 'оружейная': 'arsenal', 'сторожевые башни': 'watchtower', 'учебный двор': 'barracks', 'осадная мастерская': 'siegeWorkshop',
  'жилой дом': 'house', 'доходный дом': 'tenement', 'большой семейный дом': 'manor', 'казарма': 'barracks', 'казармы': 'barracks', 'монастырь': 'monastery',
  'зерновой сарай': 'warehouse', 'амбар': 'warehouse', 'склад': 'warehouse', 'поля и пастбища': 'farm', 'ферма': 'farm', 'мельница': 'mill',
  'пекарня': 'bakery', 'трактир': 'tavern', 'таверна': 'tavern', 'постоялый двор': 'inn', 'пивоварня': 'brewery', 'винодельня': 'winery',
  'кузница': 'blacksmith', 'плотницкая мастерская': 'carpenter', 'ткацкая мастерская': 'weaver', 'портная мастерская': 'tailor', 'красильня': 'dyehouse', 'кожевенная мастерская': 'tannery', 'сапожная мастерская': 'cobbler', 'бронная мастерская': 'armorer', 'инструментальная мастерская': 'toolmaker', 'кирпичная мастерская': 'kiln', 'обжиговая печь': 'kiln', 'каменоломня': 'quarry', 'карьер': 'quarry', 'торговая площадь': 'market', 'большой рынок': 'market',
  'рыбный рынок': 'market', 'дом гильдии': 'guildhall', 'лечебница': 'healer', 'храм': 'temple', 'собор': 'temple', 'часовня': 'temple',
  'городская управа': 'townHall', 'суд': 'courthouse', 'тюрьма': 'prison', 'пожарный двор': 'fireStation', 'школа': 'school', 'приют': 'shelter', 'конюшня': 'stable', 'доки': 'fishery', 'шахта': 'mine', 'рудник': 'mine', 'баня': 'bathhouse', 'лавка': 'shop',
};

const residentialTypes = new Set<BuildingType>(['house', 'tenement', 'manor', 'barracks', 'monastery']);
const foodTemplates = new Set(['bread', 'vegetables', 'fruit', 'meat', 'smoked_meat', 'fish', 'salted_fish', 'milk', 'eggs', 'stew', 'roast']);

function needState(tick: number): NeedState {
  return { hunger: 10, thirst: 8, rest: 12, warmth: 10, safety: 12, social: 18, lastUpdatedTick: tick };
}

function scheduleFor(character: Character): Character['schedule'] {
  const works = character.age >= 14 && character.profession !== 'child';
  const night = character.profession === 'guard' || character.profession === 'soldier';
  return {
    wakeHour: night ? 12 : 6, workStartHour: works ? (night ? 18 : 8) : 0, workEndHour: works ? (night ? 2 : 17) : 0,
    sleepHour: night ? 4 : 22, restDay: 1 + character.id % 7, currentActivity: works ? 'занят обычной работой' : character.age < 14 ? 'живёт в семье и учится' : 'ведёт домашнее хозяйство',
  };
}

function defaultEconomy(settlement: Settlement): SettlementEconomy {
  const prosperityFactor = .7 + settlement.prosperity / 100;
  return {
    currency: 'крона', coinSupply: Math.max(100, Math.round(settlement.population * 14 * prosperityFactor)), priceIndex: Math.max(.55, Math.min(1.8, 1.25 - settlement.prosperity / 180)),
    wageIndex: Math.max(.55, Math.min(1.8, .55 + settlement.prosperity / 90)), rentIndex: Math.max(.45, Math.min(2.2, .6 + settlement.population / Math.max(300, settlement.residentialCapacity * 1.2))),
    taxRate: .05 + (100 - settlement.prosperity) / 1800, prices: {}, supply: {}, demand: {}, imports: {}, exports: {}, lastMonthlyTrade: 0, bankruptcies: 0,
  };
}

function buildingTypeFor(label: string): BuildingType {
  const clean = label.replace(/^\d+\s*×\s*/, '').trim().toLowerCase();
  for (const [key, type] of Object.entries(buildingMapping)) if (clean.includes(key)) return type;
  if (clean.includes('дом')) return 'house';
  if (clean.includes('рынок')) return 'market';
  if (clean.includes('склад') || clean.includes('сарай')) return 'warehouse';
  return 'public';
}

function buildingCapacity(type: BuildingType, rng: RNG): number {
  if (type === 'house') return rng.int(4, 8);
  if (type === 'tenement') return rng.int(18, 36);
  if (type === 'manor') return rng.int(10, 22);
  if (type === 'barracks') return rng.int(45, 140);
  if (type === 'castle') return rng.int(120, 420);
  if (type === 'arsenal') return rng.int(100, 320);
  if (type === 'watchtower') return rng.int(8, 24);
  if (type === 'siegeWorkshop') return rng.int(18, 54);
  if (type === 'monastery') return rng.int(18, 75);
  if (type === 'tavern' || type === 'inn') return rng.int(24, 70);
  if (type === 'warehouse' || type === 'market') return rng.int(80, 220);
  if (type === 'kiln' || type === 'quarry') return rng.int(18, 46);
  return rng.int(8, 34);
}

function roomsFor(type: BuildingType): string[] {
  const rooms: Partial<Record<BuildingType, string[]>> = {
    house: ['общая комната', 'спальное место', 'кладовая'], tenement: ['общий коридор', 'жилые комнаты', 'общая кухня'], manor: ['зал', 'спальни', 'кухня', 'кладовая'],
    tavern: ['общий зал', 'кухня', 'кладовая', 'подвал'], inn: ['общий зал', 'кухня', 'комнаты постояльцев', 'конюшенный двор'], bakery: ['пекарня', 'склад муки', 'лавка'],
    blacksmith: ['горн', 'рабочий двор', 'склад металла'], barracks: ['спальные залы', 'оружейная комната', 'кухня', 'учебный двор'], arsenal: ['оружейный склад', 'бронная кладовая', 'ремонтная мастерская', 'караульная'], castle: ['донжон', 'тронный зал', 'внутренний двор', 'казармы', 'конюшни', 'кухня', 'темница', 'башни'], watchtower: ['караульная', 'лестница', 'сигнальная площадка'], siegeWorkshop: ['сборочный двор', 'склад древесины', 'кузнечный навес'], kiln: ['обжиговая печь', 'сушильный двор', 'склад глины'], quarry: ['карьер', 'навес инструментов', 'погрузочная площадка'], warehouse: ['главный склад', 'погрузочный двор'], market: ['торговые ряды', 'весовая'],
  };
  return rooms[type] ?? ['рабочее помещение', 'кладовая'];
}

function statusFor(members: Character[], wealth: number): HouseholdStatus {
  if (members.some(member => member.titles.length)) return 'знатные';
  if (wealth < 8) return 'нищие';
  if (wealth < 35) return 'бедные';
  if (wealth < 160) return 'обычные';
  if (wealth < 420) return 'зажиточные';
  return 'богатые';
}

function addItem(world: WorldState, data: Omit<WorldItem, 'id' | 'history'> & { history?: string[] }, itemIndex?: Map<number, WorldItem>, forceUnique = false, directOwnerCharacter?: Character): WorldItem {
  const template = ITEM_BY_ID.get(data.templateId);
  if (!template) throw new Error(`Неизвестный шаблон предмета: ${data.templateId}`);
  const key = itemStackKey(data);
  const indexed = forceUnique ? undefined : activeRuntime?.stackByKey.get(key);
  const existing = forceUnique ? undefined : indexed && indexed.settlementId === data.settlementId && Math.abs(indexed.quality - data.quality) <= 10
    ? indexed
    : activeRuntime ? undefined : world.items.find(item => item.templateId === data.templateId && item.settlementId === data.settlementId
      && itemOwnerKey(item) === itemOwnerKey(data) && Math.abs(item.quality - data.quality) <= 10 && item.condition > 0 && item.dye === data.dye);
  if (existing) {
    const previousQuantity = existing.quantity;
    const totalQuantity = previousQuantity + data.quantity;
    if (totalQuantity > .0001) {
      existing.quality = Math.round((existing.quality * previousQuantity + data.quality * data.quantity) / totalQuantity);
      existing.condition = Math.round((existing.condition * previousQuantity + data.condition * data.quantity) / totalQuantity);
      existing.freshness = Math.round((existing.freshness * previousQuantity + data.freshness * data.quantity) / totalQuantity);
    }
    existing.quantity = totalQuantity;
    return existing;
  }
  const item: WorldItem = { id: world.nextIds.item++, history: data.history ?? [], ...data };
  world.items.push(item);
  itemIndex?.set(item.id, item);
  activeRuntime?.itemById.set(item.id, item);
  activeRuntime?.stackByKey.set(key, item);
  registerRuntimeOffer(item);
  if (item.householdId) (activeRuntime?.householdById.get(item.householdId) ?? world.households.find(household => household.id === item.householdId))?.inventoryItemIds.push(item.id);
  if (item.establishmentId) (activeRuntime?.establishmentById.get(item.establishmentId) ?? world.establishments.find(establishment => establishment.id === item.establishmentId))?.inventoryItemIds.push(item.id);
  if (item.buildingId) (activeRuntime?.buildingById.get(item.buildingId) ?? world.buildings.find(building => building.id === item.buildingId))?.inventoryItemIds.push(item.id);
  if (item.ownerCharacterId) (directOwnerCharacter?.id === item.ownerCharacterId ? directOwnerCharacter : activeRuntime?.characterById.get(item.ownerCharacterId) ?? world.characters.find(character => character.id === item.ownerCharacterId))?.inventoryItemIds.push(item.id);
  if (item.supplyWagonId) { const wagon = world.supplyWagons?.find(candidate => candidate.id === item.supplyWagonId); if (wagon && !wagon.inventoryItemIds.includes(item.id)) wagon.inventoryItemIds.push(item.id); }
  return item;
}

function seedItem(world: WorldState, templateId: string, quantity: number, settlementId: number, owner: { householdId?: number; establishmentId?: number; buildingId?: number; ownerCharacterId?: number; supplyWagonId?: number }, rng: RNG, source: string): void {
  if (quantity <= 0) return;
  const template = ITEM_BY_ID.get(templateId)!;
  addItem(world, {
    templateId, name: template.name, category: template.category, material: template.material, quantity, unit: template.unit, weightPerUnit: template.weight,
    quality: rng.int(38, 76), condition: rng.int(70, 100), freshness: 100, perishabilityMonths: template.perishability, baseValue: template.value,
    settlementId, ...owner, createdYear: world.year, source, ...equipmentMetadata(template),
  });
}

export function addMaterialItem(world: WorldState, templateId: string, quantity: number, settlementId: number, owner: { householdId?: number; establishmentId?: number; buildingId?: number; ownerCharacterId?: number; supplyWagonId?: number }, source: string, quality = 55, itemIndex?: Map<number, WorldItem>, forceUnique = false, directOwnerCharacter?: Character): WorldItem | undefined {
  if (quantity <= .0001) return undefined;
  const template = ITEM_BY_ID.get(templateId);
  if (!template) return undefined;
  return addItem(world, { templateId, name: template.name, category: template.category, material: template.material, quantity, unit: template.unit, weightPerUnit: template.weight,
    quality, condition: template.maxCondition ?? 100, freshness: 100, perishabilityMonths: template.perishability, baseValue: template.value, settlementId, ...owner, createdYear: world.year, source, ...equipmentMetadata(template) }, itemIndex, forceUnique, directOwnerCharacter);
}

export function consumeSettlementMaterial(world: WorldState, settlementId: number, templateId: string, quantity: number): number {
  let remaining = Math.max(0, quantity);
  const candidates = world.items.filter(item => item.settlementId === settlementId && item.templateId === templateId && item.quantity > .0001 && item.condition > 0)
    .sort((a, b) => Number(Boolean(a.householdId)) - Number(Boolean(b.householdId)) || a.id - b.id);
  for (const item of candidates) {
    if (remaining <= .0001) break;
    const used = Math.min(item.quantity, remaining);
    item.quantity -= used;
    remaining -= used;
  }
  return quantity - remaining;
}

export function materialTemplateExists(templateId: string): boolean { return ITEM_BY_ID.has(templateId); }

function ensureBuilding(world: WorldState, settlement: Settlement, type: BuildingType, label: string, index: number, rng: RNG): Building {
  const district = settlement.districts[index % Math.max(1, settlement.districts.length)] ?? settlement.districts[0]!;
  const localSize = world.config.localMapSize ?? 128;
  const floors = type === 'tenement' || type === 'manor' ? rng.int(2, 3) : 1;
  const dimensions = buildingDimensions(type, floors);
  const building: Building = {
    id: world.nextIds.building++, settlementId: settlement.id, districtName: district.name, globalX: district.x, globalY: district.y,
    localX: 6 + hashSeed(`${world.config.seed}:здание:${settlement.id}:${index}:x`) % Math.max(8, localSize - 18),
    localY: 6 + hashSeed(`${world.config.seed}:здание:${settlement.id}:${index}:y`) % Math.max(8, localSize - 18),
    localWidth: dimensions.width, localHeight: dimensions.height, entranceX: 0, entranceY: 0,
    name: type === 'house' || type === 'tenement' || type === 'manor' ? `${label} №${index + 1}` : `${label} «${settlement.name.split(' ')[0]}-${index + 1}»`,
    type, floors, capacity: buildingCapacity(type, rng), condition: rng.int(58, 100),
    builtYear: rng.int(Math.max(1, settlement.foundedYear), world.year), residentIds: [], workerIds: [], inventoryItemIds: [], rooms: roomsFor(type),
    hasWater: rng.chance(type === 'house' ? .55 : .82), hasHearth: !['warehouse', 'market', 'mine', 'watchtower'].includes(type), history: [`Построено не позднее ${world.year} года.`],
  };
  assignBuildingFootprint(world, building);
  world.buildings.push(building);
  activeRuntime?.buildingById.set(building.id, building);
  settlement.buildingIds.push(building.id);
  return building;
}

function createBuildings(world: WorldState, rng: RNG): void {
  for (const settlement of world.settlements) {
    settlement.buildingIds = [];
    settlement.householdIds = [];
    settlement.establishmentIds = [];
    settlement.economy = defaultEconomy(settlement);
    const labels: string[] = [];
    for (const [label, count] of Object.entries(settlement.buildingCounts ?? {})) for (let i = 0; i < count; i += 1) labels.push(label);
    for (const label of settlement.buildings ?? []) if (!labels.some(existing => existing === label)) labels.push(label);
    if (!labels.some(label => residentialTypes.has(buildingTypeFor(label)))) {
      const count = Math.max(1, Math.ceil(settlement.population / 6));
      for (let i = 0; i < count; i += 1) labels.push('жилой дом');
    }
    labels.forEach((label, index) => ensureBuilding(world, settlement, buildingTypeFor(label), label, index, rng));
  }
}

function createHouseholds(world: WorldState, rng: RNG): void {
  const tick = worldTick(world);
  for (const settlement of world.settlements) {
    const local = world.characters.filter(character => character.alive && character.settlementId === settlement.id).sort((a, b) => a.id - b.id);
    const localById = new Map(local.map(character => [character.id, character]));
    const assigned = new Set<number>();
    const homes = world.buildings.filter(building => building.settlementId === settlement.id && residentialTypes.has(building.type)).sort((a, b) => a.id - b.id);
    let homeCursor = 0;

    for (const character of local) {
      if (assigned.has(character.id)) continue;
      const members: Character[] = [character];
      const candidateIds = [character.spouseId, ...character.childIds, ...character.parentIds].filter((id): id is number => typeof id === 'number');
      for (const id of candidateIds) {
        const candidate = localById.get(id);
        if (candidate && !assigned.has(candidate.id) && members.length < 12) members.push(candidate);
      }
      if (members.length === 1 && character.age < 18) {
        const guardian = local.find(other => !assigned.has(other.id) && other.age >= 24 && members.length < 6);
        if (guardian) members.push(guardian);
      }
      if (members.length === 1) {
        const roomMates = local.filter(other => !assigned.has(other.id) && other.id !== character.id && !other.spouseId && other.age >= 14).slice(0, rng.int(0, 3));
        members.push(...roomMates);
      }
      for (const member of members) assigned.add(member.id);
      const wealth = Math.max(0, members.reduce((sum, member) => sum + (member.wealth ?? 0), 0));
      const head = [...members].sort((a, b) => Number(Boolean(b.titles.length)) - Number(Boolean(a.titles.length)) || b.age - a.age || a.id - b.id)[0]!;
      let home = homes[homeCursor];
      while (home && home.residentIds.length + members.length > home.capacity && homeCursor < homes.length - 1) home = homes[++homeCursor];
      if (!home || home.residentIds.length + members.length > home.capacity) {
        home = ensureBuilding(world, settlement, members.some(member => member.titles.length) ? 'manor' : 'house', members.some(member => member.titles.length) ? 'усадьба' : 'жилой дом', settlement.buildingIds.length, rng);
        homes.push(home);
        homeCursor = homes.length - 1;
      }
      const household: Household = {
        id: world.nextIds.household++, settlementId: settlement.id, homeBuildingId: home.id, headCharacterId: head.id, memberIds: members.map(member => member.id),
        status: statusFor(members, wealth), wealth, debt: 0, monthlyIncome: 0, monthlyExpenses: 0, foodReserveDays: rng.int(16, 75), fuelReserveDays: rng.int(10, 65),
        inventoryItemIds: [], needs: needState(tick), history: [`Домохозяйство сформировано в ${settlement.name}.`],
      };
      world.households.push(household);
      activeRuntime?.householdById.set(household.id, household);
      settlement.householdIds.push(household.id);
      home.householdId ??= household.id;
      home.residentIds.push(...household.memberIds);
      for (const member of members) {
        member.householdId = household.id;
        member.homeBuildingId = home.id;
        member.homeDistrict = home.districtName;
        member.inventoryItemIds ??= [];
        member.skills ??= { [member.profession]: Math.max(1, Math.min(100, rng.int(8, 55) + Math.floor(member.age / 3))) };
        member.needs ??= needState(tick);
        member.schedule ??= scheduleFor(member);
      }
      seedItem(world, 'grain', Math.max(1, Math.ceil(members.length / 2)), settlement.id, { householdId: household.id, buildingId: home.id }, rng, 'семейный запас зерна');
      seedItem(world, 'vegetables', Math.max(1, Math.ceil(members.length / 3)), settlement.id, { householdId: household.id, buildingId: home.id }, rng, 'семейный огород и рынок');
      seedItem(world, 'firewood', Math.max(1, Math.ceil(members.length / 3)), settlement.id, { householdId: household.id, buildingId: home.id }, rng, 'запас топлива');
      if (!home.hasWater) seedItem(world, 'water', Math.max(2, members.length), settlement.id, { householdId: household.id, buildingId: home.id }, rng, 'запас воды из колодца');
      if (wealth > 40) seedItem(world, 'clothes', Math.max(1, Math.floor(members.length / 2)), settlement.id, { householdId: household.id, buildingId: home.id }, rng, 'семейное имущество');
    }
    settlement.households = settlement.householdIds.length;
  }
}

function establishmentName(type: EstablishmentType, settlement: Settlement, index: number, rng: RNG): string {
  const titles: Partial<Record<EstablishmentType, string[]>> = {
    'таверна': ['Красный кабан', 'Медный котёл', 'Три свечи', 'Старый мост'], 'постоялый двор': ['Последняя миля', 'Королевский тракт', 'Добрый очаг'],
    'пекарня': ['Тёплая корка', 'Белая мука'], 'пивоварня': ['Старая бочка', 'Ячменный двор'], 'винодельня': ['Золотая гроздь', 'Тихий погреб'],
    'кузница': ['Чёрный молот', 'Железный горн'], 'лавка': ['Полная корзина', 'Семь товаров'], 'рынок': [`Рынок ${settlement.name}`],
  };
  const title = rng.pick(titles[type] ?? [`${type} ${index + 1}`]);
  return title.startsWith(type) || title.includes(settlement.name) ? title : `${type[0]!.toUpperCase()}${type.slice(1)} «${title}»`;
}

function ensureRequiredBuildings(world: WorldState, settlement: Settlement, rng: RNG): void {
  const existingCounts = new Map<BuildingType, number>();
  for (const building of world.buildings.filter(item => item.settlementId === settlement.id)) existingCounts.set(building.type, (existingCounts.get(building.type) ?? 0) + 1);
  const population = Math.max(1, settlement.population);
  const required = new Map<BuildingType, number>([
    ['farm', Math.max(1, Math.ceil(population / 70))],
    ['warehouse', Math.max(1, Math.ceil(population / 650))],
    ['public', 1],
  ]);
  if (population >= 55) {
    required.set('mill', Math.max(1, Math.ceil(population / 520)));
    required.set('bakery', Math.max(1, Math.ceil(population / 320)));
    required.set('market', Math.max(1, Math.ceil(population / 1100)));
    required.set('tavern', Math.max(1, Math.ceil(population / 420)));
  }
  if (population >= 180) {
    required.set('blacksmith', Math.max(1, Math.ceil(population / 650)));
    required.set('carpenter', Math.max(1, Math.ceil(population / 450)));
    required.set('inn', Math.max(1, Math.ceil(population / 900)));
    required.set('healer', Math.max(1, Math.ceil(population / 1200)));
  }
  if (population >= 420) {
    required.set('brewery', Math.max(1, Math.ceil(population / 1400)));
    required.set('weaver', Math.max(1, Math.ceil(population / 900)));
    required.set('tailor', Math.max(1, Math.ceil(population / 850)));
    required.set('tannery', Math.max(1, Math.ceil(population / 1300)));
    required.set('cobbler', Math.max(1, Math.ceil(population / 1300)));
    required.set('toolmaker', Math.max(1, Math.ceil(population / 1500)));
    required.set('guildhall', Math.max(1, Math.ceil(population / 1800)));
    required.set('kiln', Math.max(1, Math.ceil(population / 1800)));
    required.set('bathhouse', Math.max(1, Math.ceil(population / 1600)));
  }
  if (population >= 900) {
    required.set('dyehouse', Math.max(1, Math.ceil(population / 2400)));
    required.set('armorer', Math.max(1, Math.ceil(population / 2200)));
  }
  const kingdom = world.kingdoms.find(item => item.id === settlement.kingdomId);
  const isCapital = kingdom?.capitalId === settlement.id;
  if (isCapital) {
    required.set('barracks', Math.max(1, Math.ceil(population / 1200)));
    required.set('arsenal', 1);
    if (settlement.type === 'city' || settlement.type === 'fortress' || population >= 650) required.set('castle', 1);
    if (population >= 1300 && (kingdom?.aggression ?? 0) >= 45) required.set('siegeWorkshop', 1);
  } else if (settlement.type === 'fortress' || population >= 900) {
    required.set('barracks', 1);
  }
  if (settlement.type === 'fortress') required.set('watchtower', Math.max(1, Math.ceil(population / 700)));
  if (settlement.type === 'port' || settlement.resource === 'рыба') required.set('fishery', Math.max(1, Math.ceil(population / 260)));
  if (settlement.resource === 'железо' || settlement.resource === 'серебро') required.set('mine', Math.max(1, Math.ceil(population / 420)));
  if (settlement.resource === 'камень' || settlement.resource === 'глина' || ['hills', 'mountains', 'plains'].includes(world.tiles[settlement.y * world.config.width + settlement.x]?.terrain ?? '')) required.set('quarry', Math.max(1, Math.ceil(population / 900)));
  for (const [type, target] of required) {
    let existing = existingCounts.get(type) ?? 0;
    while (existing < target) {
      const label = type === 'tavern' ? 'таверна' : type === 'inn' ? 'постоялый двор' : type === 'market' ? 'рынок' : type === 'guildhall' ? 'дом гильдии' : type === 'kiln' ? 'кирпичная мастерская' : type === 'quarry' ? 'каменоломня' : type === 'tailor' ? 'портная мастерская' : type === 'dyehouse' ? 'красильня' : type === 'tannery' ? 'кожевенная мастерская' : type === 'cobbler' ? 'сапожная мастерская' : type === 'armorer' ? 'бронная мастерская' : type === 'toolmaker' ? 'инструментальная мастерская' : type === 'castle' ? 'замок' : type === 'arsenal' ? 'арсенал' : type === 'barracks' ? 'казарма' : type === 'watchtower' ? 'сторожевая башня' : type === 'siegeWorkshop' ? 'осадная мастерская' : type === 'public' ? 'колодец и водоразбор' : type;
      const building = ensureBuilding(world, settlement, type, label, settlement.buildingIds.length, rng);
      if (type === 'public') building.hasWater = true;
      existing += 1;
    }
  }
}

function employmentCapacity(type: EstablishmentType, building: Building): number {
  if (type === 'ферма') return Math.max(12, Math.min(28, Math.ceil(building.capacity * .9)));
  if (type === 'рыбный промысел' || type === 'рудник') return Math.max(8, Math.min(24, Math.ceil(building.capacity * .7)));
  if (type === 'рынок' || type === 'склад' || type === 'гильдейский дом') return Math.max(6, Math.min(18, Math.ceil(building.capacity / 10)));
  if (type === 'таверна' || type === 'постоялый двор') return Math.max(5, Math.min(14, Math.ceil(building.capacity / 7)));
  if (type === 'мельница' || type === 'пекарня' || type === 'пивоварня' || type === 'винодельня') return Math.max(4, Math.min(12, Math.ceil(building.capacity / 5)));
  if (type === 'кузница' || type === 'плотницкая мастерская' || type === 'ткацкая мастерская' || type === 'портная мастерская' || type === 'красильня' || type === 'кожевенная мастерская' || type === 'сапожная мастерская' || type === 'бронная мастерская' || type === 'инструментальная мастерская') return Math.max(4, Math.min(10, Math.ceil(building.capacity / 5)));
  return Math.max(3, Math.min(10, Math.ceil(building.capacity / 6)));
}

function employRemainingResidents(world: WorldState): void {
  for (const settlement of world.settlements) {
    const establishments = (activeRuntime?.establishmentsBySettlement.get(settlement.id) ?? world.establishments.filter(item => item.settlementId === settlement.id))
      .filter(item => item.active);
    const unemployed = world.characters
      .filter(character => character.alive && character.settlementId === settlement.id && character.age >= 14 && !character.employerEstablishmentId)
      .sort((a, b) => a.id - b.id);
    for (const character of unemployed) {
      const ranked = establishments
        .map(establishment => {
          const building = activeRuntime?.buildingById.get(establishment.buildingId) ?? world.buildings.find(item => item.id === establishment.buildingId);
          const capacity = building ? employmentCapacity(establishment.type, building) : 4;
          const preferred = professionForEstablishment[establishment.type].includes(character.profession);
          return { establishment, building, capacity, preferred, load: establishment.workerIds.length / Math.max(1, capacity) };
        })
        .filter(entry => entry.building && entry.establishment.workerIds.length < entry.capacity)
        .sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.load - b.load || a.establishment.id - b.establishment.id);
      const chosen = ranked[0];
      if (!chosen?.building) continue;
      const skill = character.skills[character.profession] ?? 10;
      const contract: EmploymentContract = {
        id: world.nextIds.employment++, characterId: character.id, establishmentId: chosen.establishment.id,
        role: chosen.preferred ? character.profession : 'подсобный работник',
        wage: Math.max(3, Math.round((2.6 + skill / 17) * settlement.economy.wageIndex)), hoursPerWeek: 42 + character.id % 17,
        sinceYear: world.year, active: true,
      };
      world.employments.push(contract);
      const contracts = activeRuntime?.employmentByEstablishment.get(chosen.establishment.id);
      if (contracts) contracts.push(contract);
      else activeRuntime?.employmentByEstablishment.set(chosen.establishment.id, [contract]);
      chosen.establishment.workerIds.push(character.id);
      chosen.building.workerIds.push(character.id);
      character.employerEstablishmentId = chosen.establishment.id;
      character.workplaceBuildingId = chosen.building.id;
      character.employmentContractId = contract.id;
      character.workplace = chosen.establishment.name;
    }
  }
}

function createEstablishments(world: WorldState, rng: RNG): void {
  const adultsBySettlement = new Map<number, Character[]>();
  for (const settlement of world.settlements) adultsBySettlement.set(settlement.id, world.characters.filter(character => character.alive && character.settlementId === settlement.id && character.age >= 14));
  for (const settlement of world.settlements) {
    ensureRequiredBuildings(world, settlement, rng);
    const adults = adultsBySettlement.get(settlement.id) ?? [];
    const priority: Partial<Record<BuildingType, number>> = { farm: 1, fishery: 1, mine: 1, carpenter: 2, warehouse: 2, mill: 3, bakery: 4, brewery: 4, winery: 4, weaver: 4, tailor: 4, dyehouse: 4, tannery: 4, cobbler: 4, armorer: 4, toolmaker: 4, blacksmith: 4, market: 5, shop: 5, tavern: 6, inn: 6, healer: 6, bathhouse: 7, temple: 7, guildhall: 7, stable: 7 };
    const candidates = world.buildings
      .filter(building => building.settlementId === settlement.id && establishmentForBuilding[building.type])
      .sort((a, b) => (priority[a.type] ?? 10) - (priority[b.type] ?? 10) || a.id - b.id);
    for (const [index, building] of candidates.entries()) {
      const type = establishmentForBuilding[building.type]!;
      const preferred = professionForEstablishment[type];
      const available = adults.filter(character => !character.employerEstablishmentId && preferred.includes(character.profession));
      const fallback = adults.filter(character => !character.employerEstablishmentId);
      const owner = [...(available.length ? available : fallback.length ? fallback : adults)].sort((a, b) => b.wealth - a.wealth || b.age - a.age)[0];
      if (!owner) continue;
      const workerTarget = Math.max(1, Math.min(Math.ceil(building.capacity / 12), Math.ceil(settlement.population / 90) + (type === 'рынок' ? 3 : 0)));
      const workers = [owner, ...adults.filter(character => character.id !== owner.id && !character.employerEstablishmentId && preferred.includes(character.profession)).slice(0, workerTarget - 1)];
      const establishment: Establishment = {
        id: world.nextIds.establishment++, settlementId: settlement.id, buildingId: building.id, name: establishmentName(type, settlement, index, rng), type,
        ownerCharacterId: owner.id, workerIds: workers.map(worker => worker.id), supplierEstablishmentIds: [], customerHouseholdIds: [], inventoryItemIds: [],
        recipeIds: world.productionRecipes.filter(recipe => recipe.establishmentTypes.includes(type)).map(recipe => recipe.id), openHour: type === 'таверна' || type === 'постоялый двор' ? 10 : 7,
        closeHour: type === 'таверна' || type === 'постоялый двор' ? 1 : type === 'рынок' ? 17 : 19, reputation: rng.int(28, 82), cash: Math.max(20, Math.round(owner.wealth * .65 + rng.int(15, 120))),
        debt: 0, monthlyRevenue: 0, monthlyExpenses: 0, active: true, menu: {}, history: [`Открыто в ${settlement.name} не позднее ${world.year} года.`],
      };
      world.establishments.push(establishment);
      activeRuntime?.establishmentById.set(establishment.id, establishment);
      if (activeRuntime) { const list = activeRuntime.establishmentsBySettlement.get(settlement.id) ?? []; list.push(establishment); activeRuntime.establishmentsBySettlement.set(settlement.id, list); }
      settlement.establishmentIds.push(establishment.id);
      building.establishmentId = establishment.id;
      building.ownerCharacterId = owner.id;
      building.workerIds = [...establishment.workerIds];
      owner.wealth = Math.max(0, owner.wealth - Math.round(establishment.cash * .25));
      for (const worker of workers) {
        const skill = worker.skills[worker.profession] ?? 10;
        const contract: EmploymentContract = {
          id: world.nextIds.employment++, characterId: worker.id, establishmentId: establishment.id, role: worker.id === owner.id ? 'владелец и мастер' : preferred.includes(worker.profession) ? worker.profession : 'подсобный работник',
          wage: worker.id === owner.id ? 0 : Math.max(3, Math.round((2.8 + skill / 16) * settlement.economy.wageIndex)), hoursPerWeek: rng.int(36, 62), sinceYear: Math.max(settlement.foundedYear, world.year - rng.int(0, 18)), active: true,
        };
        world.employments.push(contract);
        if (activeRuntime) { const list = activeRuntime.employmentByEstablishment.get(establishment.id) ?? []; list.push(contract); activeRuntime.employmentByEstablishment.set(establishment.id, list); }
        worker.employerEstablishmentId = establishment.id;
        worker.workplaceBuildingId = building.id;
        worker.employmentContractId = contract.id;
        worker.workplace = establishment.name;
      }
    }
  }

  employRemainingResidents(world);

  for (const establishment of world.establishments) {
    const settlement = world.settlements.find(item => item.id === establishment.settlementId)!;
    establishment.customerHouseholdIds = settlement.householdIds.filter(id => hashSeed(`${world.config.seed}:клиент:${establishment.id}:${id}`) % 4 === 0).slice(0, 80);
    const sameSettlement = world.establishments.filter(other => other.settlementId === establishment.settlementId && other.id !== establishment.id);
    establishment.supplierEstablishmentIds = sameSettlement.filter(other => ['склад', 'рынок', 'ферма', 'мельница', 'рыбный промысел', 'рудник'].includes(other.type)).slice(0, 5).map(other => other.id);
    seedEstablishmentInventory(world, establishment, rng);
  }
}

function seedEstablishmentInventory(world: WorldState, establishment: Establishment, rng: RNG): void {
  const owner = { establishmentId: establishment.id, buildingId: establishment.buildingId };
  const add = (id: string, qty: number, source = 'начальный товарный запас') => seedItem(world, id, qty, establishment.settlementId, owner, rng, source);
  if (establishment.type === 'ферма') { add('grain', rng.int(18, 50)); add('vegetables', rng.int(8, 25)); add('eggs', rng.int(5, 18)); add('milk', rng.int(4, 14)); }
  if (establishment.type === 'рыбный промысел') { add('fish', rng.int(10, 35)); add('salt', rng.int(3, 12)); }
  if (establishment.type === 'рудник') { add('iron_ore', rng.int(12, 35)); add('stone', rng.int(8, 30)); }
  if (establishment.type === 'мельница') { add('grain', rng.int(12, 35)); add('flour', rng.int(8, 24)); }
  if (establishment.type === 'пекарня') { add('flour', rng.int(8, 22)); add('bread', rng.int(20, 70)); add('firewood', rng.int(5, 15)); }
  if (establishment.type === 'таверна' || establishment.type === 'постоялый двор') { add('ale', rng.int(20, 80)); add('stew', rng.int(8, 24)); add('grain', rng.int(4, 15)); add('vegetables', rng.int(4, 16)); add('firewood', rng.int(4, 12)); establishment.menu = { stew: 3, roast: 5, bread: 2, ale: 2, wine: 9 }; }
  if (establishment.type === 'пивоварня') { add('grain', rng.int(15, 45)); add('ale', rng.int(30, 110)); add('firewood', rng.int(8, 20)); }
  if (establishment.type === 'винодельня') { add('fruit', rng.int(12, 36)); add('wine', rng.int(12, 45)); }
  if (establishment.type === 'кузница') { add('iron_ore', rng.int(4, 16)); add('iron', rng.int(3, 12)); add('charcoal', rng.int(8, 25)); add('tools', rng.int(1, 6)); add('weapon', rng.int(0, 4)); }
  if (establishment.type === 'плотницкая мастерская') { add('timber', rng.int(10, 35)); add('tools', rng.int(1, 4)); add('furniture', rng.int(1, 7)); }
  if (establishment.type === 'ткацкая мастерская') { add('spindle', rng.int(1, 4)); add('wool', rng.int(8, 24)); add('cloth', rng.int(5, 16)); add('clothes', rng.int(1, 8)); }
  if (establishment.type === 'кирпичная мастерская') { add('clay', rng.int(12, 35)); add('firewood', rng.int(8, 24)); add('bricks', rng.int(4, 16)); add('lime', rng.int(2, 10)); }
  if (establishment.type === 'каменоломня') { add('clay', rng.int(10, 40)); add('stone', rng.int(12, 45)); add('tools', rng.int(1, 4)); }
  if (establishment.type === 'портная мастерская') { add('tailoring_kit', rng.int(1, 3)); add('linen_cloth', rng.int(4, 14)); add('wool_cloth', rng.int(4, 12)); add('linen_shirt', rng.int(1, 6)); add('wool_tunic', rng.int(1, 5)); add('wool_trousers', rng.int(1, 5)); add('wool_cloak', rng.int(0, 4)); }
  if (establishment.type === 'красильня') { add('dye_blue', rng.int(2, 8)); add('dye_red', rng.int(2, 8)); add('dye_yellow', rng.int(2, 8)); add('dye_brown', rng.int(4, 12)); }
  if (establishment.type === 'кожевенная мастерская') { add('tanner_knife', rng.int(1, 3)); add('raw_hide', rng.int(5, 18)); add('leather', rng.int(3, 12)); }
  if (establishment.type === 'сапожная мастерская') { add('cobbler_tools', rng.int(1, 3)); add('leather', rng.int(4, 12)); add('leather_shoes', rng.int(2, 8)); add('leather_gloves', rng.int(1, 6)); }
  if (establishment.type === 'бронная мастерская') { add('gambeson', rng.int(1, 5)); add('leather_armor', rng.int(0, 4)); add('iron_helmet', rng.int(0, 3)); add('wooden_shield', rng.int(1, 5)); }
  if (establishment.type === 'инструментальная мастерская') { add('smith_hammer', rng.int(1, 3)); add('sickle', rng.int(1, 6)); add('hoe', rng.int(1, 5)); add('pickaxe', rng.int(0, 4)); add('wood_axe', rng.int(1, 5)); add('carpenter_saw', rng.int(0, 4)); add('tailoring_kit', rng.int(0, 4)); add('spindle', rng.int(1, 5)); add('tanner_knife', rng.int(0, 4)); add('cobbler_tools', rng.int(0, 4)); }
  if (establishment.type === 'одежная лавка') { add('linen_hood', rng.int(2, 8)); add('linen_shirt', rng.int(2, 10)); add('wool_tunic', rng.int(1, 7)); add('wool_trousers', rng.int(1, 7)); add('leather_shoes', rng.int(2, 8)); add('wool_cloak', rng.int(1, 5)); }
  if (establishment.type === 'оружейная лавка') { add('spear', rng.int(2, 8)); add('sword', rng.int(0, 4)); add('longbow', rng.int(0, 4)); add('gambeson', rng.int(1, 5)); add('wooden_shield', rng.int(1, 5)); }
  if (establishment.type === 'продовольственная лавка') { add('bread', rng.int(15, 60)); add('vegetables', rng.int(8, 30)); add('salted_fish', rng.int(3, 15)); add('water', rng.int(15, 60)); }
  if (establishment.type === 'рынок' || establishment.type === 'лавка' || establishment.type === 'склад') {
    for (const [id, min, max] of [['grain', 8, 35], ['bread', 10, 45], ['vegetables', 5, 24], ['water', 12, 50], ['firewood', 6, 30], ['linen_cloth', 2, 12], ['wool_cloth', 2, 10], ['linen_shirt', 1, 5], ['leather_shoes', 1, 5], ['tools', 1, 6], ['sickle', 0, 3]] as const) add(id, rng.int(min, max));
  }
  if (establishment.type === 'лечебница') add('herbal_medicine', rng.int(4, 15));
}

export function generatePhysicalEconomy(world: WorldState, rng: RNG, report?: (phase: string, percent: number, detail?: string) => void): void {
  world.buildings ??= [];
  world.households ??= [];
  world.establishments ??= [];
  world.items ??= [];
  world.productionRecipes ??= [];
  world.employments ??= [];
  world.shipments ??= [];
  world.nextIds.building ??= 1;
  world.nextIds.household ??= 1;
  world.nextIds.establishment ??= 1;
  world.nextIds.item ??= 1;
  world.nextIds.productionRecipe ??= 1;
  world.nextIds.employment ??= 1;
  world.nextIds.shipment ??= 1;
  world.productionRecipes = world.productionRecipes.filter(recipe => !['Сбор урожая зерна', 'Сбор овощей и кореньев'].includes(recipe.name));
  const knownRecipeNames = new Set(world.productionRecipes.map(recipe => recipe.name));
  for (const recipe of recipeSeeds) if (!knownRecipeNames.has(recipe.name)) world.productionRecipes.push({ id: world.nextIds.productionRecipe++, ...recipe });
  world.nextIds.productionRecipe = Math.max(world.nextIds.productionRecipe, Math.max(0, ...world.productionRecipes.map(recipe => recipe.id)) + 1);
  if (world.buildings.length || world.households.length || world.establishments.length) return;
  report?.('Физические здания и имущество', 12, 'размещаем дома, склады и мастерские');
  createBuildings(world, rng);
  activeRuntime = createGenerationRuntime(world);
  try {
    report?.('Домохозяйства и распорядок', 38, 'связываем семьи с жильём и запасами');
    createHouseholds(world, rng);
    report?.('Заведения, работа и ремесло', 68, 'создаём владельцев, работников и производственные цепочки');
    createEstablishments(world, rng);
    report?.('Рынки и цены', 88, 'считаем местное предложение и деньги');
    recalculateAllMarkets(world);
  } finally {
    activeRuntime = undefined;
  }
  report?.('Повседневная жизнь готова', 100, `${world.buildings.length.toLocaleString('ru-RU')} зданий · ${world.households.length.toLocaleString('ru-RU')} домохозяйств · ${world.establishments.length.toLocaleString('ru-RU')} заведений`);
}

function inventoryItems(world: WorldState, ids: number[]): WorldItem[] {
  const itemById = activeRuntime?.itemById;
  if (itemById) return ids.map(id => itemById.get(id)).filter((item): item is WorldItem => Boolean(item && item.quantity > .0001 && item.condition > 0));
  const wanted = new Set(ids);
  return world.items.filter(item => wanted.has(item.id) && item.quantity > .0001 && item.condition > 0);
}

function quantityOf(world: WorldState, ids: number[], templateId: string): number {
  let total = 0;
  if (activeRuntime) {
    for (const id of ids) {
      const item = activeRuntime.itemById.get(id);
      if (item?.templateId === templateId && item.quantity > 0 && item.condition > 0) total += item.quantity;
    }
    return total;
  }
  const wanted = new Set(ids);
  for (const item of world.items) if (wanted.has(item.id) && item.templateId === templateId) total += item.quantity;
  return total;
}

function consume(world: WorldState, ids: number[], templateId: string, quantity: number): number {
  let remaining = quantity;
  if (activeRuntime) {
    for (const id of ids) {
      if (remaining <= .0001) break;
      const item = activeRuntime.itemById.get(id);
      if (!item || item.templateId !== templateId || item.quantity <= 0 || item.condition <= 0) continue;
      const used = Math.min(item.quantity, remaining);
      item.quantity -= used;
      remaining -= used;
    }
    return quantity - remaining;
  }
  const wanted = new Set(ids);
  for (const item of world.items) {
    if (remaining <= .0001) break;
    if (!wanted.has(item.id) || item.templateId !== templateId || item.quantity <= 0) continue;
    const used = Math.min(item.quantity, remaining);
    item.quantity -= used;
    remaining -= used;
  }
  return quantity - remaining;
}

function cleanEmptyItems(world: WorldState): boolean {
  const removedItems = world.items.filter(item => item.quantity <= .0001 || item.condition <= 0);
  if (!removedItems.length) return false;
  const removed = new Set(removedItems.map(item => item.id));
  const householdIds = new Set<number>();
  const establishmentIds = new Set<number>();
  const buildingIds = new Set<number>();
  const characterIds = new Set<number>();
  const offerKeys = new Set<string>();
  for (const item of removedItems) {
    if (item.householdId) householdIds.add(item.householdId);
    if (item.establishmentId) { establishmentIds.add(item.establishmentId); offerKeys.add(offerKey(item.settlementId, item.templateId)); }
    if (item.buildingId) buildingIds.add(item.buildingId);
    if (item.ownerCharacterId) characterIds.add(item.ownerCharacterId);
    if (activeRuntime) {
      activeRuntime.itemById.delete(item.id);
      const key = itemStackKey(item);
      if (activeRuntime.stackByKey.get(key)?.id === item.id) activeRuntime.stackByKey.delete(key);
    }
  }
  const clean = (ids: number[]) => ids.filter(id => !removed.has(id));
  for (const id of householdIds) { const entity = activeRuntime?.householdById.get(id) ?? world.households.find(item => item.id === id); if (entity) entity.inventoryItemIds = clean(entity.inventoryItemIds); }
  for (const id of establishmentIds) { const entity = activeRuntime?.establishmentById.get(id) ?? world.establishments.find(item => item.id === id); if (entity) entity.inventoryItemIds = clean(entity.inventoryItemIds); }
  for (const id of buildingIds) { const entity = activeRuntime?.buildingById.get(id) ?? world.buildings.find(item => item.id === id); if (entity) entity.inventoryItemIds = clean(entity.inventoryItemIds); }
  for (const id of characterIds) {
    const entity = activeRuntime?.characterById.get(id) ?? world.characters.find(item => item.id === id);
    if (entity) {
      entity.inventoryItemIds = clean(entity.inventoryItemIds);
      for (const [slot, itemId] of Object.entries(entity.equipment?.equippedItemIds ?? {})) if (removed.has(itemId)) delete entity.equipment.equippedItemIds[slot as EquipmentSlot];
    }
  }
  for (const merchant of world.travelingMerchants ?? []) merchant.wagonInventoryItemIds = clean(merchant.wagonInventoryItemIds);
  for (const army of world.armies) army.inventoryItemIds = clean(army.inventoryItemIds ?? []);
  for (const wagon of world.supplyWagons ?? []) wagon.inventoryItemIds = clean(wagon.inventoryItemIds ?? []);
  if (activeRuntime) for (const key of offerKeys) {
    const offers = activeRuntime.offersBySettlementTemplate.get(key);
    if (offers) activeRuntime.offersBySettlementTemplate.set(key, offers.filter(entry => !removed.has(entry.item.id)));
  }
  world.items = world.items.filter(item => !removed.has(item.id));
  return true;
}

export function invalidateMaterialRuntime(world: WorldState): void {
  if (activeRuntime?.itemById) activeRuntime = undefined;
  materialRuntimeCache.delete(world);
}

export function pruneEmptyMaterialItems(world: WorldState, indexes?: WorldIndexes): void {
  const changed = cleanEmptyItems(world);
  if (changed && indexes) indexes.itemById = new Map(world.items.map(item => [item.id, item]));
  if (changed) invalidateMaterialRuntime(world);
}

function spoilItems(world: WorldState, settlementIds: ReadonlySet<number>, elapsedMonths: number): void {
  for (const item of world.items) {
    if (!settlementIds.has(item.settlementId) || item.perishabilityMonths <= 0) continue;
    item.freshness = Math.max(0, item.freshness - Math.ceil(100 / item.perishabilityMonths) * elapsedMonths);
    if (item.freshness === 0) {
      item.condition = 0;
      item.history.push(`Испортилось в ${world.year}.${String(world.month).padStart(2, '0')}.`);
    }
  }
}

function transferItemBetweenEstablishments(world: WorldState, seller: Establishment, buyer: Establishment, item: WorldItem, quantity: number): number {
  const moved = Math.min(quantity, item.quantity);
  if (moved <= .0001) return 0;
  const settlement = activeRuntime?.settlementById.get(buyer.settlementId) ?? world.settlements.find(candidate => candidate.id === buyer.settlementId);
  const unitPrice = settlement ? priceFor(settlement, item.templateId, item.quality) * .72 : item.baseValue;
  const creditLimit = 160 + buyer.reputation * 6;
  const affordableQuantity = Math.min(moved, (buyer.cash + Math.max(0, creditLimit - buyer.debt)) / Math.max(.01, unitPrice));
  if (affordableQuantity <= .0001) return 0;
  const total = affordableQuantity * unitPrice;
  const paid = Math.min(buyer.cash, total);
  buyer.cash -= paid;
  buyer.debt += Math.max(0, total - paid);
  seller.cash += paid;
  seller.monthlyRevenue += paid;
  buyer.monthlyExpenses += total;
  item.quantity -= affordableQuantity;
  addItem(world, {
    templateId: item.templateId, name: item.name, category: item.category, material: item.material, quantity: affordableQuantity, unit: item.unit, weightPerUnit: item.weightPerUnit,
    quality: item.quality, condition: item.condition, freshness: item.freshness, perishabilityMonths: item.perishabilityMonths, baseValue: item.baseValue,
    settlementId: buyer.settlementId, establishmentId: buyer.id, buildingId: buyer.buildingId, createdYear: world.year,
    source: `поставка от ${seller.name}`, history: [`Передано заведению ${buyer.name} в ${world.year}.${String(world.month).padStart(2, '0')}.`],
  });
  return affordableQuantity;
}

function restockRecipeInputs(world: WorldState, establishment: Establishment, recipe: ProductionRecipe, elapsedMonths: number): void {
  const local = activeRuntime?.establishmentsBySettlement.get(establishment.settlementId) ?? world.establishments.filter(candidate => candidate.settlementId === establishment.settlementId);
  for (const input of recipe.inputs) {
    let missing = Math.max(0, input.quantity * 2 * elapsedMonths - quantityOf(world, establishment.inventoryItemIds, input.templateId));
    if (missing <= .0001) continue;
    const sellers = activeRuntime
      ? (activeRuntime.offersBySettlementTemplate.get(offerKey(establishment.settlementId, input.templateId)) ?? [])
          .filter(entry => entry.establishment.id !== establishment.id && entry.establishment.active && entry.item.quantity > .0001 && entry.item.condition > 0)
          .sort((a, b) => b.item.quantity - a.item.quantity || a.establishment.id - b.establishment.id)
      : local
          .filter(candidate => candidate.id !== establishment.id && candidate.active)
          .flatMap(candidate => candidate.inventoryItemIds.map(id => ({ establishment: candidate, item: world.items.find(entry => entry.id === id) })))
          .filter((entry): entry is { establishment: Establishment; item: WorldItem } => Boolean(entry.item && entry.item.templateId === input.templateId && entry.item.quantity > .0001 && entry.item.condition > 0))
          .sort((a, b) => b.item.quantity - a.item.quantity || a.establishment.id - b.establishment.id);
    for (const seller of sellers) {
      if (missing <= .0001) break;
      const moved = transferItemBetweenEstablishments(world, seller.establishment, establishment, seller.item, missing);
      missing -= moved;
    }
  }
}

function canRunRecipe(world: WorldState, establishment: Establishment, recipe: ProductionRecipe): boolean {
  if (!establishment.active || !recipe.establishmentTypes.includes(establishment.type)) return false;
  for (const input of recipe.inputs) if (quantityOf(world, establishment.inventoryItemIds, input.templateId) + .0001 < input.quantity) return false;
  return true;
}

function workerSkill(world: WorldState, establishment: Establishment, profession: string): { average: number; masterId?: number } {
  const workers = establishment.workerIds.map(id => activeRuntime?.characterById.get(id) ?? world.characters.find(character => character.id === id)).filter((character): character is Character => Boolean(character?.alive));
  if (!workers.length) return { average: 0 };
  const sorted = workers.map(character => ({ character, skill: character.skills[profession] ?? character.skills[character.profession] ?? 8 })).sort((a, b) => b.skill - a.skill);
  return { average: sorted.reduce((sum, item) => sum + item.skill, 0) / sorted.length, masterId: sorted[0]?.character.id };
}

function productionRuns(world: WorldState, establishment: Establishment, recipe: ProductionRecipe, skill: number, elapsedMonths: number): number {
  const workerFactor = Math.max(1, establishment.workerIds.length);
  let possible = Math.max(1, Math.floor(workerFactor * (18 + skill) / Math.max(12, recipe.laborHours * 2))) * elapsedMonths;
  for (const input of recipe.inputs) possible = Math.min(possible, Math.floor(quantityOf(world, establishment.inventoryItemIds, input.templateId) / input.quantity));
  if (recipe.category === 'добыча') possible = Math.min(possible, (3 + Math.floor(workerFactor / 2)) * elapsedMonths);
  return Math.max(0, Math.min(36, possible));
}

function productionTool(world: WorldState, establishment: Establishment, profession: string): WorldItem | undefined {
  const allowed = PRODUCTION_TOOL_IDS[profession];
  if (!allowed?.length) return undefined;
  const allowedSet = new Set(allowed);
  const establishmentTool = establishment.inventoryItemIds
    .map(id => activeRuntime?.itemById.get(id) ?? world.items.find(item => item.id === id))
    .filter((item): item is WorldItem => Boolean(item && item.quantity > .0001 && item.condition > 0 && allowedSet.has(item.templateId)))
    .sort((a, b) => b.condition - a.condition || b.quality - a.quality)[0];
  if (establishmentTool) return establishmentTool;
  for (const workerId of establishment.workerIds) {
    const worker = activeRuntime?.characterById.get(workerId) ?? world.characters.find(character => character.id === workerId);
    const toolId = worker?.equipment?.equippedItemIds?.workTool;
    const tool = toolId ? activeRuntime?.itemById.get(toolId) ?? world.items.find(item => item.id === toolId) : undefined;
    if (tool && tool.condition > 0 && allowedSet.has(tool.templateId)) return tool;
  }
  return undefined;
}

function availableDye(world: WorldState, establishment: Establishment, quantity: number): { item: WorldItem; color: string } | undefined {
  const dyes = establishment.inventoryItemIds
    .map(id => activeRuntime?.itemById.get(id) ?? world.items.find(item => item.id === id))
    .filter((item): item is WorldItem => Boolean(item && item.category === 'краситель' && item.dye && item.condition > 0 && item.quantity >= quantity))
    .sort((a, b) => a.baseValue - b.baseValue || b.quantity - a.quantity);
  const item = dyes[0];
  return item?.dye ? { item, color: item.dye } : undefined;
}

function runProduction(world: WorldState, establishment: Establishment, rng: RNG, elapsedMonths: number): void {
  const recipes = establishment.recipeIds.map(id => activeRuntime?.recipeById.get(id) ?? world.productionRecipes.find(recipe => recipe.id === id)).filter((recipe): recipe is ProductionRecipe => Boolean(recipe));
  for (const recipe of recipes) {
    restockRecipeInputs(world, establishment, recipe, elapsedMonths);
    const skill = workerSkill(world, establishment, recipe.profession);
    if (skill.average < recipe.minimumSkill * .45 || !canRunRecipe(world, establishment, recipe)) continue;
    const requiredTools = PRODUCTION_TOOL_IDS[recipe.profession];
    const tool = productionTool(world, establishment, recipe.profession);
    if (requiredTools?.length && !tool) continue;
    let runs = productionRuns(world, establishment, recipe, skill.average, elapsedMonths);
    if (tool) runs = Math.floor(runs * Math.max(.35, Math.min(1.2, .45 + tool.condition / 130 + tool.quality / 500)));
    if (recipe.category === 'добыча') {
      const crop = recipe.name.includes('урожая') || recipe.name.includes('овощ');
      const seasonFactor = crop ? (elapsedMonths >= 6 ? (world.month === 7 ? .5 : 0) : elapsedMonths > 1 ? (world.month === 7 ? 1 : 0) : ([7, 8, 9].includes(world.month) ? 1 : 0)) : 1;
      runs = Math.floor(runs * seasonFactor);
    }
    if (runs <= 0) continue;
    for (const input of recipe.inputs) consume(world, establishment.inventoryItemIds, input.templateId, input.quantity * runs);
    if (tool) {
      const wear = Math.max(.15, runs * (recipe.category === 'добыча' ? .75 : .35));
      tool.condition = Math.max(0, tool.condition - wear);
      if (tool.condition <= 0) tool.history.push(`Сломалось во время работы в ${world.year}.${String(world.month).padStart(2, '0')}.`);
    }
    for (const output of recipe.outputs) {
      const template = ITEM_BY_ID.get(output.templateId)!;
      const quality = Math.max(10, Math.min(100, Math.round(36 + skill.average * .65 + (output.qualityBonus ?? 0) + rng.int(-7, 7))));
      const dyeNeed = template.category === 'одежда' ? Math.max(.08, output.quantity * runs * .08) : 0;
      const dye = dyeNeed > 0 && !template.dye ? availableDye(world, establishment, dyeNeed) : undefined;
      if (dye) dye.item.quantity -= dyeNeed;
      addItem(world, {
        templateId: template.id, name: template.name, category: template.category, material: template.material, quantity: output.quantity * runs,
        unit: template.unit, weightPerUnit: template.weight, quality, condition: template.maxCondition ?? 100, freshness: 100, perishabilityMonths: template.perishability,
        baseValue: template.value, settlementId: establishment.settlementId, buildingId: establishment.buildingId, establishmentId: establishment.id,
        craftedByCharacterId: skill.masterId, createdYear: world.year, source: `${recipe.name} в заведении ${establishment.name}`, ...equipmentMetadata(template), dye: template.dye ?? dye?.color,
      });
    }
    const master = skill.masterId ? activeRuntime?.characterById.get(skill.masterId) ?? world.characters.find(character => character.id === skill.masterId) : undefined;
    if (master) master.skills[recipe.profession] = Math.min(100, (master.skills[recipe.profession] ?? 8) + .05 * runs);
  }
}

function priceFor(settlement: Settlement, templateId: string, quality = 50): number {
  const template = ITEM_BY_ID.get(templateId);
  const base = template?.value ?? 5;
  const market = settlement.economy;
  return Math.max(.1, (market.prices[templateId] ?? base * market.priceIndex) * (.7 + quality / 160));
}

function findSeller(world: WorldState, settlementId: number, templateIds: string[]): { establishment: Establishment; item: WorldItem } | undefined {
  let best: { establishment: Establishment; item: WorldItem } | undefined;
  let bestQuantity = 0;
  if (activeRuntime) {
    for (const templateId of templateIds) {
      const offers = activeRuntime.offersBySettlementTemplate.get(offerKey(settlementId, templateId)) ?? [];
      for (const offer of offers) {
        if (!offer.establishment.active || offer.item.condition <= 0 || offer.item.quantity <= bestQuantity) continue;
        best = offer;
        bestQuantity = offer.item.quantity;
      }
    }
    return best;
  }
  const allowed = new Set(templateIds);
  for (const establishment of world.establishments) {
    if (establishment.settlementId !== settlementId || !establishment.active) continue;
    for (const itemId of establishment.inventoryItemIds) {
      const item = world.items.find(candidate => candidate.id === itemId);
      if (!item || item.condition <= 0 || !allowed.has(item.templateId) || item.quantity <= bestQuantity) continue;
      best = { establishment, item };
      bestQuantity = item.quantity;
    }
  }
  return best;
}

function transferItemToHousehold(world: WorldState, seller: Establishment, item: WorldItem, household: Household, quantity: number): number {
  const moved = Math.min(quantity, item.quantity);
  if (moved <= 0) return 0;
  item.quantity -= moved;
  const template = ITEM_BY_ID.get(item.templateId)!;
  addItem(world, {
    templateId: item.templateId, name: item.name, category: item.category, material: item.material, quantity: moved, unit: item.unit, weightPerUnit: item.weightPerUnit,
    quality: item.quality, condition: item.condition, freshness: item.freshness, perishabilityMonths: item.perishabilityMonths, baseValue: item.baseValue,
    settlementId: household.settlementId, householdId: household.id, buildingId: household.homeBuildingId, createdYear: world.year,
    source: `куплено у ${seller.name}`, history: [`Куплено домохозяйством в ${world.year}.${String(world.month).padStart(2, '0')}.`], equipmentSlot: item.equipmentSlot, dye: item.dye, warmth: item.warmth, armor: item.armor, damage: item.damage, toolType: item.toolType, requiredProfession: item.requiredProfession, maxCondition: item.maxCondition,
  });
  return moved;
}

function settlementHasCommunityWater(world: WorldState, settlementId: number): boolean {
  const buildings = activeRuntime?.buildingsBySettlement.get(settlementId) ?? world.buildings.filter(building => building.settlementId === settlementId);
  return buildings.some(building => building.hasWater && building.condition > 30);
}

function householdAverageHealth(world: WorldState, household: Household): number {
  const members = household.memberIds
    .map(id => activeRuntime?.characterById.get(id) ?? world.characters.find(character => character.id === id))
    .filter((character): character is Character => Boolean(character?.alive));
  return members.length ? members.reduce((sum, member) => sum + member.health, 0) / members.length : 100;
}

function feedHousehold(world: WorldState, household: Household, elapsedMonths: number): void {
  const members = household.memberIds.map(id => activeRuntime?.characterById.get(id) ?? world.characters.find(character => character.id === id)).filter((character): character is Character => Boolean(character?.alive));
  const required = Math.max(.45, members.length * .25) * elapsedMonths;
  let consumed = 0;
  const preferred = ['stew', 'roast', 'bread', 'vegetables', 'salted_fish', 'smoked_meat', 'fish', 'meat', 'eggs', 'milk', 'fruit', 'grain'];
  for (const id of preferred) {
    if (consumed >= required) break;
    const valuePerUnit = id === 'stew' || id === 'roast' ? 1 : id === 'bread' ? .7 : id === 'grain' ? 2 : 1.2;
    const needUnits = (required - consumed) / valuePerUnit;
    const used = consume(world, household.inventoryItemIds, id, needUnits);
    consumed += used * valuePerUnit;
  }
  const home = household.homeBuildingId ? activeRuntime?.buildingById.get(household.homeBuildingId) ?? world.buildings.find(building => building.id === household.homeBuildingId) : undefined;
  const waterNeed = Math.max(.4, members.length * .22) * elapsedMonths;
  const hasWaterAccess = Boolean(home?.hasWater) || settlementHasCommunityWater(world, household.settlementId);
  const waterRatio = hasWaterAccess ? 1 : Math.min(1, consume(world, household.inventoryItemIds, 'water', waterNeed) / waterNeed);
  const fuelNeed = Math.max(.08, members.length * .028) * elapsedMonths;
  const fuelUsed = home?.hasHearth ? consume(world, household.inventoryItemIds, 'firewood', fuelNeed) : 0;
  const foodRatio = Math.min(1, consumed / required);
  household.needs.hunger = Math.max(0, Math.min(100, household.needs.hunger + ((1 - foodRatio) * 32 - foodRatio * 18) * elapsedMonths));
  household.needs.thirst = Math.max(0, Math.min(100, household.needs.thirst + ((1 - waterRatio) * 42 - waterRatio * 18) * elapsedMonths));
  household.needs.rest = Math.max(0, household.needs.rest - 8 * elapsedMonths);
  household.needs.warmth = Math.max(0, Math.min(100, household.needs.warmth + (home?.hasHearth && fuelUsed >= fuelNeed * .5 ? -7 : 14) * elapsedMonths));
  let foodUnits = 0;
  let fuelUnits = 0;
  for (const id of household.inventoryItemIds) {
    const item = activeRuntime?.itemById.get(id) ?? world.items.find(candidate => candidate.id === id);
    if (!item || item.quantity <= 0 || item.condition <= 0) continue;
    if (foodTemplates.has(item.templateId)) foodUnits += item.quantity;
    if (item.templateId === 'firewood' || item.templateId === 'charcoal') fuelUnits += item.quantity;
  }
  household.foodReserveDays = Math.max(0, Math.round(foodUnits / Math.max(1, members.length) * 30));
  household.fuelReserveDays = Math.max(0, Math.round(fuelUnits / Math.max(1, members.length) * 36));
  const hunger = household.needs.hunger;
  const thirst = household.needs.thirst;
  for (const member of members) {
    member.needs = { ...household.needs, lastUpdatedTick: worldTick(world) };
    if (hunger > 70 || thirst > 70) member.health = Math.max(1, member.health - 1);
  }
}

function produceHouseholdSubsistence(world: WorldState, settlement: Settlement, household: Household, elapsedMonths: number): void {
  const members = household.memberIds
    .map(id => activeRuntime?.characterById.get(id) ?? world.characters.find(character => character.id === id))
    .filter((character): character is Character => Boolean(character?.alive));
  if (!members.length) return;
  const rural = settlement.type === 'hamlet' || settlement.type === 'village' || settlement.type === 'fortress';
  const semiRural = rural || settlement.type === 'town';
  const owner = { householdId: household.id, buildingId: household.homeBuildingId };
  const add = (templateId: string, quantity: number, source: string) => {
    if (quantity <= .01) return;
    const template = ITEM_BY_ID.get(templateId)!;
    addItem(world, {
      templateId, name: template.name, category: template.category, material: template.material, quantity, unit: template.unit, weightPerUnit: template.weight,
      quality: 42, condition: 100, freshness: 100, perishabilityMonths: template.perishability, baseValue: template.value, settlementId: settlement.id,
      householdId: household.id, buildingId: household.homeBuildingId, createdYear: world.year, source,
    });
  };
  if (rural) add('vegetables', members.length * .008 * elapsedMonths, 'малый семейный огород');
  else if (semiRural) add('vegetables', members.length * .003 * elapsedMonths, 'дворовый огород');
  if (members.some(member => member.profession === 'hunter')) add('meat', members.length * .018 * elapsedMonths, 'мелкая охотничья добыча');
  if (members.some(member => member.profession === 'fisher')) add('fish', members.length * .025 * elapsedMonths, 'часть рыбацкого улова');
  const tile = world.tiles[settlement.y * world.config.width + settlement.x];
  if (semiRural || tile?.terrain === 'forest' || tile?.terrain === 'hills') add('firewood', members.length * .03 * elapsedMonths, 'сбор топлива на общинных землях');
}

function buyHouseholdNeeds(world: WorldState, settlement: Settlement, household: Household, elapsedMonths: number): void {
  household.monthlyExpenses = 0;
  const members = Math.max(1, household.memberIds.length);
  const home = household.homeBuildingId ? activeRuntime?.buildingById.get(household.homeBuildingId) ?? world.buildings.find(building => building.id === household.homeBuildingId) : undefined;
  const hasWaterAccess = Boolean(home?.hasWater) || settlementHasCommunityWater(world, settlement.id);
  const shopping: { ids: string[]; target: number }[] = [
    { ids: ['bread', 'grain', 'vegetables'], target: members * .18 * elapsedMonths },
    { ids: ['meat', 'fish', 'eggs', 'milk'], target: members * .045 * elapsedMonths },
    { ids: ['firewood', 'charcoal'], target: members * .035 * elapsedMonths },
    ...(!hasWaterAccess ? [{ ids: ['water'], target: members * .24 * elapsedMonths }] : []),
  ];
  if (world.month === 2 || world.month === 8) shopping.push({ ids: ['clothes'], target: Math.max(.1, members * .12) });
  if (world.month === 3) shopping.push({ ids: ['tools'], target: Math.max(.04, members * .035) });
  if (householdAverageHealth(world, household) < 75) shopping.push({ ids: ['herbal_medicine'], target: Math.max(.03, members * .025) });
  if (household.wealth > members * 5) shopping.push({ ids: ['stew', 'roast', 'ale', 'wine'], target: members * .06 * elapsedMonths });
  if (world.month === 6 && household.wealth > members * 12) shopping.push({ ids: ['furniture'], target: Math.max(.02, members * .018) });
  for (const need of shopping) {
    const current = need.ids.reduce((sum, id) => sum + quantityOf(world, household.inventoryItemIds, id), 0);
    if (current >= need.target || household.wealth <= .2) continue;
    const seller = findSeller(world, settlement.id, need.ids);
    if (!seller) continue;
    const desired = Math.min(need.target - current, seller.item.quantity);
    const unitPrice = priceFor(settlement, seller.item.templateId, seller.item.quality);
    const affordable = Math.min(desired, household.wealth / unitPrice);
    const moved = transferItemToHousehold(world, seller.establishment, seller.item, household, affordable);
    const paid = moved * unitPrice;
    household.wealth = Math.max(0, household.wealth - paid);
    household.monthlyExpenses += paid;
    seller.establishment.cash += paid;
    seller.establishment.monthlyRevenue += paid;
    settlement.economy.lastMonthlyTrade += paid;
  }
}

function payWagesAndTaxes(world: WorldState, settlement: Settlement, establishment: Establishment, elapsedMonths: number): void {
  establishment.monthlyRevenue = Math.max(0, establishment.monthlyRevenue);
  establishment.monthlyExpenses = 0;
  const contracts = activeRuntime?.employmentByEstablishment.get(establishment.id) ?? world.employments.filter(item => item.establishmentId === establishment.id);
  for (const contract of contracts) {
    if (!contract.active || contract.wage <= 0) continue;
    const character = activeRuntime?.characterById.get(contract.characterId) ?? world.characters.find(item => item.id === contract.characterId);
    const household = character?.householdId ? activeRuntime?.householdById.get(character.householdId) ?? world.households.find(item => item.id === character.householdId) : undefined;
    if (!character || !household) continue;
    const dueWage = contract.wage * elapsedMonths;
    const paid = Math.min(establishment.cash, dueWage);
    establishment.cash -= paid;
    establishment.monthlyExpenses += paid;
    const personalShare = paid * .25;
    const familyShare = paid - personalShare;
    character.wallet = Math.max(0, (character.wallet ?? 0) + personalShare);
    household.wealth += familyShare;
    household.monthlyIncome += paid;
    character.wealth = Math.round(household.wealth / Math.max(1, household.memberIds.length) + character.wallet);
    if (paid < dueWage) {
      const missing = dueWage - paid;
      establishment.debt += missing;
      household.debt += Math.min(.2, missing * .03);
      household.needs.safety = Math.min(100, household.needs.safety + 3);
    }
  }
  const owner = activeRuntime?.characterById.get(establishment.ownerCharacterId) ?? world.characters.find(item => item.id === establishment.ownerCharacterId);
  const ownerHousehold = owner?.householdId ? activeRuntime?.householdById.get(owner.householdId) ?? world.households.find(item => item.id === owner.householdId) : undefined;
  if (ownerHousehold && establishment.cash > 8) {
    const ownerDraw = Math.min(establishment.cash * .08, (4 + establishment.reputation / 30) * elapsedMonths);
    establishment.cash -= ownerDraw;
    establishment.monthlyExpenses += ownerDraw;
    ownerHousehold.wealth += ownerDraw;
    ownerHousehold.monthlyIncome += ownerDraw;
    if (owner) owner.wealth = Math.round(ownerHousehold.wealth / Math.max(1, ownerHousehold.memberIds.length));
  }
  const profit = Math.max(0, establishment.monthlyRevenue - establishment.monthlyExpenses);
  const tax = Math.min(establishment.cash, profit * settlement.economy.taxRate);
  if (tax > 0) {
    establishment.cash -= tax;
    establishment.monthlyExpenses += tax;
    const kingdom = activeRuntime?.kingdomById.get(settlement.kingdomId) ?? world.kingdoms.find(item => item.id === settlement.kingdomId);
    if (kingdom) kingdom.treasury += tax;
  }
  const inventoryValue = establishment.inventoryItemIds.reduce((sum, id) => {
    const item = activeRuntime?.itemById.get(id) ?? world.items.find(candidate => candidate.id === id);
    return sum + (item && item.condition > 0 ? item.quantity * item.baseValue : 0);
  }, 0);
  if (establishment.cash < 1 && establishment.debt > 5000 && inventoryValue < 40 && establishment.active) {
    establishment.active = false;
    establishment.history.push(`Закрылось в ${world.year} году из-за долгов.`);
    settlement.economy.bankruptcies += 1;
    appendCausalEvent(world, {
      kind: 'establishment', title: `Закрылось заведение ${establishment.name}`, description: `Работники потеряли место, а товары распродаются кредиторам.`,
      cause: 'долги превысили способность заведения платить поставщикам и работникам', conditions: [`долг ${Math.round(establishment.debt)} крон`, 'касса почти пуста'],
      decision: 'владелец прекратил работу', outcome: 'заведение закрыто', consequences: ['работники остались без заработка', 'местное предложение товаров сократилось'],
      entityRefs: [{ kind: 'establishment', id: establishment.id }, { kind: 'building', id: establishment.buildingId }, { kind: 'settlement', id: settlement.id }], importance: 2,
    });
    for (const contract of contracts) contract.active = false;
  }
}

function recalculateMarket(world: WorldState, settlement: Settlement): void {
  const supply: Record<string, number> = {};
  const demand: Record<string, number> = {};
  for (const establishmentId of settlement.establishmentIds) {
    const establishment = activeRuntime?.establishmentById.get(establishmentId) ?? world.establishments.find(item => item.id === establishmentId);
    if (!establishment) continue;
    for (const itemId of establishment.inventoryItemIds) {
      const item = activeRuntime?.itemById.get(itemId) ?? world.items.find(candidate => candidate.id === itemId);
      if (item && item.quantity > 0 && item.condition > 0) supply[item.templateId] = (supply[item.templateId] ?? 0) + item.quantity;
    }
  }
  const people = Math.max(1, settlement.population);
  for (const template of ITEM_TEMPLATES) {
    demand[template.id] = template.category === 'еда' ? people * .09 : template.category === 'топливо' ? people * .025 : template.category === 'одежда' ? people * .004 : people * .002;
    const pressure = (demand[template.id]! + 1) / ((supply[template.id] ?? 0) + 1);
    settlement.economy.prices[template.id] = Math.max(template.value * .35, Math.min(template.value * 4.5, template.value * settlement.economy.priceIndex * (.65 + Math.sqrt(pressure))));
  }
  settlement.economy.supply = supply;
  settlement.economy.demand = demand;
  settlement.economy.coinSupply = Math.round(
    settlement.householdIds.reduce((sum, id) => sum + ((activeRuntime?.householdById.get(id) ?? world.households.find(item => item.id === id))?.wealth ?? 0), 0)
    + settlement.establishmentIds.reduce((sum, id) => sum + ((activeRuntime?.establishmentById.get(id) ?? world.establishments.find(item => item.id === id))?.cash ?? 0), 0),
  );
  const marketFoodSupply = [...foodTemplates].reduce((sum, id) => sum + (supply[id] ?? 0), 0);
  let householdFoodSupply = 0;
  for (const householdId of settlement.householdIds) {
    const household = activeRuntime?.householdById.get(householdId) ?? world.households.find(item => item.id === householdId);
    if (!household) continue;
    for (const itemId of household.inventoryItemIds) {
      const item = activeRuntime?.itemById.get(itemId) ?? world.items.find(candidate => candidate.id === itemId);
      if (item && item.quantity > 0 && item.condition > 0 && foodTemplates.has(item.templateId)) householdFoodSupply += item.quantity;
    }
  }
  const foodSupply = marketFoodSupply + householdFoodSupply;
  settlement.food = Math.max(0, Math.min(180, Math.round(foodSupply / Math.max(1, people) * 36)));
  const shortage = foodSupply < people * .055;
  const had = settlement.shortages.includes('пища');
  if (shortage && !had) settlement.shortages.push('пища');
  if (!shortage && had && foodSupply > people * .11) settlement.shortages = settlement.shortages.filter(item => item !== 'пища');
}

function recalculateAllMarkets(world: WorldState): void {
  for (const settlement of world.settlements) recalculateMarket(world, settlement);
}

function arriveShipments(world: WorldState, tick: number): void {
  for (const shipment of world.shipments) {
    if (shipment.status !== 'в пути' || shipment.arrivalTick > tick) continue;
    const route = world.tradeRoutes.find(item => item.id === shipment.routeId);
    const lost = !route?.active || route.safety < 18;
    if (lost) {
      shipment.status = 'потерян';
      shipment.cause = route?.active ? 'караван исчез на опасной дороге' : 'путь был перекрыт';
      appendCausalEvent(world, {
        kind: 'trade', title: 'Караван не дошёл до места назначения', description: `Партия товаров стоимостью ${Math.round(shipment.value)} крон потеряна.`,
        cause: shipment.cause, consequences: ['поставщик понёс убыток', 'дефицит в пункте назначения усилился'],
        entityRefs: [{ kind: 'tradeRoute', id: shipment.routeId }, { kind: 'settlement', id: shipment.toSettlementId }], importance: 2,
      });
      continue;
    }
    const buyer = shipment.buyerEstablishmentId ? activeRuntime?.establishmentById.get(shipment.buyerEstablishmentId) ?? world.establishments.find(item => item.id === shipment.buyerEstablishmentId) : undefined;
    if (!buyer) { shipment.status = 'потерян'; shipment.cause = 'покупатель прекратил работу'; continue; }
    for (const goods of shipment.goods) seedItem(world, goods.templateId, goods.quantity, shipment.toSettlementId, { establishmentId: buyer.id, buildingId: buyer.buildingId }, new RNG(`${world.config.seed}:доставка:${shipment.id}:${goods.templateId}`), `доставлено по пути ${route?.name ?? shipment.routeId}`);
    shipment.status = 'доставлен';
    const destination = activeRuntime?.settlementById.get(shipment.toSettlementId) ?? world.settlements.find(item => item.id === shipment.toSettlementId);
    if (destination) for (const goods of shipment.goods) destination.economy.imports[goods.templateId] = (destination.economy.imports[goods.templateId] ?? 0) + goods.quantity;
  }
}

function createShipments(world: WorldState, settlementIds: ReadonlySet<number>): void {
  if (![1, 4, 7, 10].includes(world.month)) return;
  const tick = worldTick(world);
  for (const route of world.tradeRoutes) {
    if (!route.active || (!settlementIds.has(route.fromSettlementId) && !settlementIds.has(route.toSettlementId))) continue;
    if (world.shipments.some(shipment => shipment.routeId === route.id && shipment.status === 'в пути')) continue;
    const from = activeRuntime?.settlementById.get(route.fromSettlementId) ?? world.settlements.find(item => item.id === route.fromSettlementId);
    const to = activeRuntime?.settlementById.get(route.toSettlementId) ?? world.settlements.find(item => item.id === route.toSettlementId);
    if (!from || !to) continue;
    const candidates = Object.entries(from.economy.supply).filter(([templateId, quantity]) => quantity > (from.economy.demand[templateId] ?? 0) * 1.4 && (to.economy.supply[templateId] ?? 0) < (to.economy.demand[templateId] ?? 0));
    if (!candidates.length) continue;
    const [templateId, available] = candidates.sort((a, b) => b[1] - a[1])[0]!;
    const sellerFound = findSeller(world, from.id, [templateId]);
    const buyer = (activeRuntime?.establishmentsBySettlement.get(to.id) ?? world.establishments.filter(item => item.settlementId === to.id)).find(item => item.active && ['рынок', 'лавка', 'склад'].includes(item.type));
    if (!sellerFound || !buyer) continue;
    const quantity = Math.max(1, Math.min(sellerFound.item.quantity * .25, available * .15, route.volume / 10));
    const unitPrice = priceFor(from, templateId, sellerFound.item.quality);
    const value = quantity * unitPrice;
    const paid = Math.min(buyer.cash, value);
    const actualQuantity = quantity * (paid / Math.max(.01, value));
    if (actualQuantity < .2) continue;
    buyer.cash -= paid;
    sellerFound.establishment.cash += paid;
    sellerFound.item.quantity -= actualQuantity;
    from.economy.exports[templateId] = (from.economy.exports[templateId] ?? 0) + actualQuantity;
    const distance = Math.hypot(from.x - to.x, from.y - to.y);
    const shipment: TradeShipment = {
      id: world.nextIds.shipment++, routeId: route.id, fromSettlementId: from.id, toSettlementId: to.id, sellerEstablishmentId: sellerFound.establishment.id, buyerEstablishmentId: buyer.id,
      goods: [{ templateId, quantity: actualQuantity, unitPrice }], departedTick: tick, arrivalTick: tick + Math.max(1, Math.ceil(distance / 3)), status: 'в пути', value: paid,
    };
    world.shipments.push(shipment);
  }
}

export function ensureEstablishmentOwners(world: WorldState, indexes: WorldIndexes): void {
  for (const establishment of world.establishments) {
    const current = indexes.characterById.get(establishment.ownerCharacterId);
    if (current?.alive) continue;
    const successor = establishment.workerIds.map(id => indexes.characterById.get(id)).find(character => character?.alive)
      ?? (indexes.residentsBySettlement.get(establishment.settlementId) ?? []).find(character => character.alive && character.age >= 18);
    if (!successor) { establishment.active = false; continue; }
    establishment.ownerCharacterId = successor.id;
    const building = indexes.buildingById.get(establishment.buildingId);
    if (building) building.ownerCharacterId = successor.id;
    if (!establishment.workerIds.includes(successor.id)) establishment.workerIds.unshift(successor.id);
    establishment.history.push(`После смерти или ухода прежнего владельца дело перешло к ${successor.name}.`);
  }
}

export function advanceMaterialEconomy(world: WorldState, rng: RNG, indexes: WorldIndexes, settlementIds: ReadonlySet<number>, activeSettlementIds: ReadonlySet<number>, detailedHouseholdIds: ReadonlySet<number> = new Set()): void {
  if (!world.buildings?.length || !world.households?.length || !world.establishments?.length) generatePhysicalEconomy(world, rng);
  activeRuntime = createMaterialRuntime(world, indexes);
  ensureEstablishmentOwners(world, indexes);
  try {
    const tick = worldTick(world);
    arriveShipments(world, tick);
    const annualBulk = world.month === 1 && settlementIds.size >= world.settlements.length;
    const economyElapsedMonths = annualBulk ? 12 : 1;
    spoilItems(world, settlementIds, economyElapsedMonths);
    for (const settlementId of settlementIds) {
      const settlement = indexes.settlementById.get(settlementId);
      if (!settlement) continue;
      settlement.economy.lastMonthlyTrade = 0;
      for (const establishmentId of settlement.establishmentIds) {
        const establishment = indexes.establishmentById.get(establishmentId);
        if (establishment) { establishment.monthlyRevenue = 0; establishment.monthlyExpenses = 0; }
      }
      const elapsedMonths = economyElapsedMonths;
      const productionPriority: Partial<Record<EstablishmentType, number>> = { 'ферма': 1, 'рыбный промысел': 1, 'рудник': 1, 'плотницкая мастерская': 2, 'каменоломня': 2, 'кирпичная мастерская': 3, 'склад': 2, 'мельница': 3, 'пекарня': 4, 'пивоварня': 4, 'винодельня': 4, 'ткацкая мастерская': 4, 'кузница': 4, 'рынок': 5, 'лавка': 5, 'таверна': 6, 'постоялый двор': 6 };
      const localEstablishments = settlement.establishmentIds
        .map(id => indexes.establishmentById.get(id))
        .filter((item): item is Establishment => Boolean(item))
        .sort((a, b) => (productionPriority[a.type] ?? 10) - (productionPriority[b.type] ?? 10) || a.id - b.id);
      for (const establishment of localEstablishments) runProduction(world, establishment, rng, elapsedMonths);
      for (const householdId of settlement.householdIds) {
        const household = indexes.householdById.get(householdId);
        if (!household) continue;
        household.monthlyIncome = 0;
        produceHouseholdSubsistence(world, settlement, household, elapsedMonths);
        if (!detailedHouseholdIds.has(household.id)) {
          buyHouseholdNeeds(world, settlement, household, elapsedMonths);
          feedHousehold(world, household, elapsedMonths);
        }
      }
      for (const establishment of localEstablishments) payWagesAndTaxes(world, settlement, establishment, elapsedMonths);
      for (const householdId of settlement.householdIds) {
        const household = indexes.householdById.get(householdId);
        if (!household) continue;
        const householdTax = Math.min(household.wealth, Math.max(0, household.monthlyIncome * settlement.economy.taxRate * .35));
        if (householdTax <= 0) continue;
        household.wealth -= householdTax;
        const kingdom = indexes.kingdomById.get(settlement.kingdomId);
        if (kingdom) kingdom.treasury += householdTax;
      }
      recalculateMarket(world, settlement);
    }
    createShipments(world, settlementIds);
  } finally {
    activeRuntime = undefined;
  }
}

export function materialEconomyIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const characterIds = new Set(world.characters.map(item => item.id));
  const settlementIds = new Set(world.settlements.map(item => item.id));
  const buildingIds = new Set(world.buildings.map(item => item.id));
  const householdIds = new Set(world.households.map(item => item.id));
  const establishmentIds = new Set(world.establishments.map(item => item.id));
  const itemIds = new Set(world.items.map(item => item.id));
  const locations = new Map<number, number>();
  const countLocation = (ids: number[]) => { for (const id of ids) locations.set(id, (locations.get(id) ?? 0) + 1); };
  for (const settlement of world.settlements) {
    if (!settlement.economy) issues.push(`${settlement.name}: отсутствует экономика`);
    if (settlement.householdIds.some(id => !householdIds.has(id))) issues.push(`${settlement.name}: ссылка на несуществующее домохозяйство`);
    if (settlement.buildingIds.some(id => !buildingIds.has(id))) issues.push(`${settlement.name}: ссылка на несуществующее здание`);
  }
  for (const building of world.buildings) {
    if (!settlementIds.has(building.settlementId)) issues.push(`${building.name}: нет поселения`);
    if (building.ownerCharacterId && !characterIds.has(building.ownerCharacterId)) issues.push(`${building.name}: не существует владелец`);
    countLocation(building.inventoryItemIds);
  }
  for (const household of world.households) {
    if (!settlementIds.has(household.settlementId)) issues.push(`Домохозяйство ${household.id}: нет поселения`);
    if (household.memberIds.some(id => !characterIds.has(id))) issues.push(`Домохозяйство ${household.id}: отсутствует член семьи`);
    if (household.homeBuildingId && !buildingIds.has(household.homeBuildingId)) issues.push(`Домохозяйство ${household.id}: нет дома`);
    countLocation(household.inventoryItemIds);
  }
  for (const establishment of world.establishments) {
    if (!buildingIds.has(establishment.buildingId)) issues.push(`${establishment.name}: нет здания`);
    if (establishment.active && !characterIds.has(establishment.ownerCharacterId)) issues.push(`${establishment.name}: нет владельца`);
    countLocation(establishment.inventoryItemIds);
  }
  for (const character of world.characters) countLocation(character.inventoryItemIds ?? []);
  for (const army of world.armies) countLocation(army.inventoryItemIds ?? []);
  for (const wagon of world.supplyWagons ?? []) countLocation(wagon.inventoryItemIds ?? []);
  for (const item of world.items) {
    if (item.quantity <= 0) issues.push(`${item.name} ${item.id}: неположительное количество`);
    if (!settlementIds.has(item.settlementId)) issues.push(`${item.name} ${item.id}: нет поселения`);
    if ((locations.get(item.id) ?? 0) === 0 && !item.ownerCharacterId) issues.push(`${item.name} ${item.id}: предмет не находится ни в одном инвентаре`);
    if ((locations.get(item.id) ?? 0) > 3) issues.push(`${item.name} ${item.id}: предмет продублирован в инвентарях`);
  }
  for (const shipment of world.shipments) if (shipment.status === 'в пути' && shipment.arrivalTick < shipment.departedTick) issues.push(`Поставка ${shipment.id}: неверный срок доставки`);
  return [...new Set(issues)];
}

export function itemTemplateName(templateId: string): string {
  return ITEM_BY_ID.get(templateId)?.name ?? templateId;
}

export function ensureHouseholdPhysicalCapacity(world: WorldState, household: Household, rng: RNG, indexes?: WorldIndexes): Building | undefined {
  const settlement = indexes?.settlementById.get(household.settlementId) ?? world.settlements.find(item => item.id === household.settlementId);
  if (!settlement) return undefined;
  const memberSet = new Set(household.memberIds);
  const aliveMembers = household.memberIds
    .map(id => indexes?.characterById.get(id) ?? world.characters.find(character => character.id === id))
    .filter((character): character is Character => Boolean(character?.alive));
  const current = household.homeBuildingId ? indexes?.buildingById.get(household.homeBuildingId) ?? world.buildings.find(building => building.id === household.homeBuildingId) : undefined;
  if (current && current.residentIds.filter(id => !memberSet.has(id)).length + aliveMembers.length <= current.capacity) {
    current.residentIds = [...current.residentIds.filter(id => !memberSet.has(id)), ...aliveMembers.map(member => member.id)];
    for (const member of aliveMembers) { member.homeBuildingId = current.id; member.homeDistrict = current.districtName; }
    return current;
  }
  const buildings = indexes?.buildingsBySettlement.get(settlement.id) ?? world.buildings.filter(building => building.settlementId === settlement.id);
  let destination = buildings
    .filter(building => residentialTypes.has(building.type))
    .filter(building => building.residentIds.filter(id => !memberSet.has(id)).length + aliveMembers.length <= building.capacity)
    .sort((a, b) => (a.residentIds.length - b.residentIds.length) || a.id - b.id)[0];
  if (!destination) {
    // Новое жильё больше не возникает мгновенно. Семья временно остаётся в прежнем доме
    // или без закреплённого адреса, а планировщик поселения создаёт реальный строительный проект.
    if (current) {
      current.residentIds = [...current.residentIds.filter(id => !memberSet.has(id)), ...aliveMembers.map(member => member.id)];
      for (const member of aliveMembers) { member.homeBuildingId = current.id; member.homeDistrict = current.districtName; }
      return current;
    }
    return undefined;
  }
  if (current) current.residentIds = current.residentIds.filter(id => !memberSet.has(id));
  destination.householdId ??= household.id;
  destination.residentIds = [...destination.residentIds.filter(id => !memberSet.has(id)), ...aliveMembers.map(member => member.id)];
  household.homeBuildingId = destination.id;
  for (const member of aliveMembers) {
    member.householdId = household.id;
    member.homeBuildingId = destination.id;
    member.homeDistrict = destination.districtName;
  }
  return destination;
}

export function materializeNewHousing(world: WorldState, settlement: Settlement, houses: number, rng: RNG, indexes?: WorldIndexes): Building[] {
  const created: Building[] = [];
  for (let index = 0; index < houses; index += 1) {
    const building = ensureBuilding(world, settlement, 'house', 'жилой дом', settlement.buildingIds.length, rng);
    created.push(building);
    indexes?.buildingById.set(building.id, building);
    if (indexes) {
      const list = indexes.buildingsBySettlement.get(settlement.id) ?? [];
      list.push(building);
      indexes.buildingsBySettlement.set(settlement.id, list);
    }
  }
  return created;
}

export function materialTemplateDetails(templateId: string): Readonly<ItemTemplate> | undefined {
  return ITEM_BY_ID.get(templateId);
}

export function consumeOwnedMaterial(world: WorldState, inventoryIds: number[], templateIds: readonly string[], quantity: number, itemIndex?: ReadonlyMap<number, WorldItem>): number {
  let remaining = Math.max(0, quantity);
  const allowed = new Set(templateIds);
  const items = inventoryIds
    .map(id => itemIndex?.get(id) ?? activeRuntime?.itemById.get(id) ?? world.items.find(item => item.id === id))
    .filter((item): item is WorldItem => Boolean(item && item.quantity > .0001 && item.condition > 0 && allowed.has(item.templateId)))
    .sort((a, b) => a.freshness - b.freshness || a.id - b.id);
  for (const item of items) {
    if (remaining <= .0001) break;
    const used = Math.min(item.quantity, remaining);
    item.quantity -= used;
    remaining -= used;
  }
  return quantity - remaining;
}

export function retailOffer(world: WorldState, settlementId: number, templateIds: readonly string[], itemIndex?: ReadonlyMap<number, WorldItem>, establishments?: readonly Establishment[]): { establishment: Establishment; item: WorldItem } | undefined {
  if (!itemIndex || !establishments) return findSeller(world, settlementId, [...templateIds]);
  const allowed = new Set(templateIds);
  let best: { establishment: Establishment; item: WorldItem } | undefined;
  let bestQuantity = 0;
  for (const establishment of establishments) {
    if (!establishment.active || establishment.settlementId !== settlementId) continue;
    for (const itemId of establishment.inventoryItemIds) {
      const item = itemIndex.get(itemId);
      if (!item || item.condition <= 0 || item.quantity <= bestQuantity || !allowed.has(item.templateId)) continue;
      best = { establishment, item };
      bestQuantity = item.quantity;
    }
  }
  return best;
}
