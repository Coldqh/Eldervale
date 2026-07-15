import type { Army, BuildingType, Monster, Settlement, Species, Terrain } from './types';

const species: Record<Species, string> = {
  human: 'человек',
  elf: 'эльф',
  orc: 'орк',
  dwarf: 'дворф',
};

const professions: Record<string, string> = {
  child: 'ребёнок', farmer: 'земледелец', miller: 'мельник', hunter: 'охотник', guard: 'стражник',
  blacksmith: 'кузнец', carpenter: 'плотник', herbalist: 'травник', merchant: 'торговец', scribe: 'писец',
  priest: 'жрец', soldier: 'воин', fisher: 'рыбак', miner: 'шахтёр', weaver: 'ткач', brewer: 'пивовар', healer: 'лекарь', baker: 'пекарь', cook: 'повар', shopkeeper: 'лавочник', innkeeper: 'трактирщик', laborer: 'работник',
};


const buildingTypes: Record<BuildingType, string> = {
  house: 'жилой дом', tenement: 'доходный дом', manor: 'большой семейный дом', barracks: 'казарма', monastery: 'монастырь', warehouse: 'склад',
  farm: 'ферма', mill: 'мельница', bakery: 'пекарня', tavern: 'таверна', inn: 'постоялый двор', brewery: 'пивоварня', winery: 'винодельня',
  blacksmith: 'кузница', carpenter: 'плотницкая мастерская', weaver: 'ткацкая мастерская', market: 'рынок', shop: 'лавка', bathhouse: 'баня',
  healer: 'лечебница', temple: 'храм', guildhall: 'гильдейский дом', stable: 'конюшня', fishery: 'рыбный промысел', mine: 'рудник', cemetery: 'кладбищенская постройка', public: 'общественное здание',
};

const settlementTypes: Record<Settlement['type'], string> = {
  hamlet: 'хутор', village: 'деревня', town: 'городок', city: 'город', fortress: 'крепость', port: 'порт',
};

const armyStatuses: Record<Army['status'], string> = {
  garrison: 'в гарнизоне', marching: 'в походе', hunting: 'охотится на чудовище', raiding: 'совершает набег', battle: 'в бою', recovering: 'восстанавливается',
};

const monsterTiers: Record<Monster['tier'], string> = {
  common: 'обычное', elite: 'элитное', miniboss: 'мини-босс', boss: 'босс',
};

const monsterSpecies: Record<string, string> = {
  dragon: 'дракон', troll: 'тролль', wyvern: 'виверна', ogre: 'огр', manticore: 'мантикора',
  'giant serpent': 'гигантский змей', 'grave beast': 'могильный зверь', 'forest horror': 'лесной ужас',
};

const terrains: Record<Terrain, string> = {
  ocean: 'океан', coast: 'побережье', plains: 'равнина', forest: 'лес', hills: 'холмы', mountains: 'горы',
  marsh: 'болото', desert: 'пустыня', tundra: 'тундра',
};

const artifactTypes: Record<string, string> = {
  weapon: 'оружие', regalia: 'регалия', 'ritual object': 'ритуальный предмет', jewel: 'драгоценность', armor: 'доспех', instrument: 'инструмент',
};

const materials: Record<string, string> = {
  silver: 'серебро', 'black iron': 'чёрное железо', gold: 'золото', dragonbone: 'драконья кость', moonstone: 'лунный камень', bronze: 'бронза', yew: 'тис',
};

export const speciesLabel = (value: Species | string) => species[value as Species] ?? value;
export const professionLabel = (value: string) => professions[value] ?? value;
export const settlementTypeLabel = (value: Settlement['type'] | string) => settlementTypes[value as Settlement['type']] ?? value;
export const armyStatusLabel = (value: Army['status'] | string) => armyStatuses[value as Army['status']] ?? value;
export const monsterTierLabel = (value: Monster['tier'] | string) => monsterTiers[value as Monster['tier']] ?? value;
export const monsterSpeciesLabel = (value: string) => monsterSpecies[value] ?? value;
export const terrainLabel = (value: Terrain | string) => terrains[value as Terrain] ?? value;
export const artifactTypeLabel = (value: string) => artifactTypes[value] ?? value;
export const materialLabel = (value: string) => materials[value] ?? value;

export const buildingTypeLabel = (value: BuildingType | string) => buildingTypes[value as BuildingType] ?? value;
