import type { WorldState } from '../types';

const simple: Record<string, string> = {
  'raise a prosperous family': 'создать крепкую семью',
  'become a master artisan': 'стать великим мастером',
  'earn a noble title': 'получить дворянский титул',
  'travel beyond the known roads': 'уйти за пределы известных дорог',
  'write a lasting book': 'написать книгу, которую запомнят',
  'defend the homeland': 'защитить родную землю',
  'grow wealthy': 'разбогатеть',
  'discover an ancient ruin': 'найти древние руины',
  'serve the gods': 'служить богам',
  'avenge an old wrong': 'отомстить за старую обиду',
  'find a place in the world': 'найти своё место в мире',
  Sovereign: 'Правитель', Marshal: 'Маршал', 'High Chieftain': 'Верховный вождь',
  Dragonslayer: 'Драконоборец', Beastslayer: 'Убийца чудовищ',
};

const buildings: Record<string, string> = {
  well: 'колодец', 'grain shed': 'зерновой сарай', 'wayside shrine': 'придорожное святилище', 'communal oven': 'общая печь',
  inn: 'трактир', smithy: 'кузница', mill: 'мельница', chapel: 'часовня', 'market green': 'торговая площадь',
  guildhall: 'дом гильдии', 'stone bridge': 'каменный мост', temple: 'храм', barracks: 'казармы', brewery: 'пивоварня', library: 'библиотека',
  'royal keep': 'королевская цитадель', 'great market': 'большой рынок', cathedral: 'собор', arsenal: 'арсенал', academy: 'академия', 'city walls': 'городские стены',
  citadel: 'цитадель', armory: 'оружейная', 'training yard': 'учебный двор', granary: 'амбар', watchtowers: 'сторожевые башни',
  docks: 'доки', lighthouse: 'маяк', 'fish market': 'рыбный рынок', shipyard: 'верфь', 'customs house': 'таможня',
};

function text(value: string): string {
  let result = simple[value] ?? value;
  const replacements: [RegExp, string | ((...args: string[]) => string)][] = [
    [/^Born in (.+)\.$/, (_m, place) => `Родился в ${place}.`],
    [/^Born in (.+) in (\d+)\.$/, (_m, place, year) => `Родился в ${place} в ${year} году.`],
    [/^Died in (\d+)\.$/, (_m, year) => `Умер в ${year} году.`],
    [/^Wrote “(.+)”\.$/, (_m, title) => `Написал книгу «${title}».`],
    [/^Ascended to rule (.+)\.$/, (_m, realm) => `Взошёл на престол государства ${realm}.`],
    [/^Became ruler of (.+) in (\d+)\.$/, (_m, realm, year) => `Стал правителем государства ${realm} в ${year} году.`],
    [/^Created by (.+)\.$/, (_m, name) => `Создан мастером ${name}.`],
    [/^Now held by (.+)\.$/, (_m, name) => `Сейчас принадлежит ${name}.`],
    [/^Attacked (.+) in (\d+)\.$/, (_m, place, year) => `Напал на ${place} в ${year} году.`],
    [/^Raided lands near (.+)\.$/, (_m, place) => `Разорил земли у ${place}.`],
    [/^Slain by (.+)\.$/, (_m, name) => `Убит героем ${name}.`],
    [/^Slew (.+) in (\d+)\.$/, (_m, name, year) => `Убил ${name} в ${year} году.`],
    [/^Killed while hunting (.+)\.$/, (_m, name) => `Погиб во время охоты на ${name}.`],
    [/^Was wounded while hunting (.+)\.$/, (_m, name) => `Был ранен во время охоты на ${name}.`],
    [/^(.+) was founded$/, (_m, place) => `Основан ${place}`],
    [/^(.+) died$/, (_m, name) => `Умер ${name}`],
    [/^(.+) attacked (.+)$/, (_m, monster, place) => `${monster} напал на ${place}`],
    [/^(.+) threatened (.+)$/, (_m, monster, place) => `${monster} угрожает ${place}`],
    [/^(.+) fell$/, (_m, place) => `Пал ${place}`],
    [/^(.+) held its walls$/, (_m, place) => `${place} удержал стены`],
    [/^(.+) changed hands$/, (_m, item) => `${item} сменил владельца`],
    [/^Copies of “(.+)” spread$/, (_m, title) => `Распространились копии «${title}»`],
  ];
  for (const [pattern, replacement] of replacements) result = result.replace(pattern, replacement as any);
  return result
    .replaceAll('The dragon burned granaries', 'Дракон сжёг амбары')
    .replaceAll('Fire struck homes and granaries.', 'Огонь уничтожил дома и амбары.')
    .replaceAll('Farms were abandoned and travelers vanished along the road.', 'Фермы опустели, а путники начали исчезать на дороге.')
    .replaceAll('The expedition failed.', 'Экспедиция провалилась.')
    .replaceAll('The hunter returned alive.', 'Охотник вернулся живым.')
    .replaceAll('The succession followed the bloodline, though rivals watched closely.', 'Власть перешла по крови, но соперники следят за новым правителем.');
}

export function localizeLegacyWorld(source: WorldState): WorldState {
  if (source.language === 'ru') return source;
  const world = structuredClone(source);
  world.language = 'ru';
  for (const settlement of world.settlements) settlement.buildings = settlement.buildings.map(item => buildings[item] ?? item);
  for (const character of world.characters) {
    character.ambition = simple[character.ambition] ?? character.ambition;
    character.titles = character.titles.map(item => simple[item] ?? item);
    character.biography = character.biography.map(text);
  }
  for (const monster of world.monsters) monster.history = monster.history.map(text);
  for (const artifact of world.artifacts) artifact.history = artifact.history.map(text);
  for (const event of world.events) { event.title = text(event.title); event.description = text(event.description); }
  return world;
}
