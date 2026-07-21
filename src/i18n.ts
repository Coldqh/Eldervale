import type { Army, BuildingType, Monster, Settlement, Species, Terrain } from './types';
import { RACE_CATALOG } from './raceCatalog';

const professions: Record<string, string> = {
  child: 'ребёнок', farmer: 'земледелец', miller: 'мельник', hunter: 'охотник', guard: 'стражник',
  blacksmith: 'кузнец', carpenter: 'плотник', herbalist: 'травник', merchant: 'торговец', scribe: 'писец',
  priest: 'жрец', soldier: 'воин', fisher: 'рыбак', miner: 'шахтёр', weaver: 'ткач', brewer: 'пивовар', healer: 'лекарь', baker: 'пекарь', cook: 'повар', shopkeeper: 'лавочник', innkeeper: 'трактирщик', laborer: 'работник', tailor: 'портной', dyer: 'красильщик', tanner: 'кожевник', cobbler: 'сапожник', armorer: 'бронник', toolmaker: 'мастер инструментов', judge: 'судья', firefighter: 'пожарный', teacher: 'учитель', gravedigger: 'могильщик', official: 'чиновник',
};

const buildingTypes: Record<BuildingType, string> = {
  house: 'жилой дом', tenement: 'доходный дом', manor: 'большой семейный дом', barracks: 'казарма', monastery: 'монастырь', warehouse: 'склад',
  farm: 'ферма', mill: 'мельница', bakery: 'пекарня', tavern: 'таверна', inn: 'постоялый двор', brewery: 'пивоварня', winery: 'винодельня',
  blacksmith: 'кузница', carpenter: 'плотницкая мастерская', weaver: 'ткацкая мастерская', tailor: 'портная мастерская', dyehouse: 'красильня', tannery: 'кожевенная мастерская', cobbler: 'сапожная мастерская', armorer: 'бронная мастерская', toolmaker: 'инструментальная мастерская', kiln: 'кирпичная мастерская', quarry: 'каменоломня', market: 'рынок', shop: 'лавка', bathhouse: 'баня',
  healer: 'лечебница', temple: 'храм', guildhall: 'гильдейский дом', stable: 'конюшня', fishery: 'рыбный промысел', mine: 'рудник', cemetery: 'кладбищенская постройка', castle: 'замок', arsenal: 'арсенал', watchtower: 'сторожевая башня', siegeWorkshop: 'осадная мастерская', townHall: 'городская управа', courthouse: 'суд', prison: 'тюрьма', fireStation: 'пожарный двор', school: 'школа', shelter: 'приют', public: 'общественное здание',
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

export const speciesLabel = (value: Species | string) => RACE_CATALOG[value as Species]?.label ?? value;
export const professionLabel = (value: string) => professions[value] ?? value;
export const settlementTypeLabel = (value: Settlement['type'] | string) => settlementTypes[value as Settlement['type']] ?? value;
export const armyStatusLabel = (value: Army['status'] | string) => armyStatuses[value as Army['status']] ?? value;
export const monsterTierLabel = (value: Monster['tier'] | string) => monsterTiers[value as Monster['tier']] ?? value;
export const monsterSpeciesLabel = (value: string) => monsterSpecies[value] ?? value;
export const terrainLabel = (value: Terrain | string) => terrains[value as Terrain] ?? value;
export const artifactTypeLabel = (value: string) => artifactTypes[value] ?? value;
export const materialLabel = (value: string) => materials[value] ?? value;
export const buildingTypeLabel = (value: BuildingType | string) => buildingTypes[value as BuildingType] ?? value;
