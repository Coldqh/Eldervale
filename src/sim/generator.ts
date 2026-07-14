import type {
  Army, Artifact, Book, Character, Dungeon, Kingdom, Monster, Settlement, Species,
  Terrain, Tile, War, WorldConfig, WorldEvent, WorldState,
} from '../types';
import { RNG, hashSeed, noise2D } from './rng';
import { kingdomName, monsterName, personName, placeName } from './names';

const colors = ['#9f4d46', '#4c7396', '#6d8752', '#9a7741', '#735d8f', '#3f8a80', '#a45f78', '#7d6b55', '#587284', '#8d8248'];
const cultures = ['Речная Корона', 'Старый Камень', 'Зелёная Клятва', 'Солнечный Берег', 'Пепельное Знамя', 'Лунный Лес', 'Железный Очаг', 'Золотая Степь'];
const religions = ['Семь Светильников', 'Зелёный Двор', 'Первое Пламя', 'Молчаливые Звёзды', 'Глубинный Отец', 'Колесо Рассвета'];
const professions = ['farmer', 'miller', 'hunter', 'guard', 'blacksmith', 'carpenter', 'herbalist', 'merchant', 'scribe', 'priest', 'soldier', 'fisher', 'miner', 'weaver', 'brewer', 'healer'];
const ambitions = ['создать крепкую семью', 'стать великим мастером', 'получить дворянский титул', 'уйти за пределы известных дорог', 'написать книгу, которую запомнят', 'защитить родную землю', 'разбогатеть', 'найти древние руины', 'служить богам', 'отомстить за старую обиду'];
const buildingPools: Record<Settlement['type'], string[]> = {
  hamlet: ['колодец', 'зерновой сарай', 'придорожное святилище', 'общая печь'],
  village: ['трактир', 'кузница', 'мельница', 'часовня', 'торговая площадь'],
  town: ['дом гильдии', 'каменный мост', 'храм', 'казармы', 'пивоварня', 'библиотека'],
  city: ['королевская цитадель', 'большой рынок', 'собор', 'арсенал', 'академия', 'городские стены'],
  fortress: ['цитадель', 'оружейная', 'учебный двор', 'амбар', 'сторожевые башни'],
  port: ['доки', 'маяк', 'рыбный рынок', 'верфь', 'таможня'],
};

function terrainAt(x: number, y: number, width: number, height: number, seed: number): { terrain: Terrain; elevation: number; moisture: number } {
  const nx = x / width - 0.5;
  const ny = y / height - 0.5;
  const edge = Math.sqrt(nx * nx * 0.72 + ny * ny);
  const broad = noise2D(Math.floor(x / 5), Math.floor(y / 5), seed);
  const fine = noise2D(x, y, seed + 991);
  const elevation = Math.max(0, Math.min(1, broad * 0.62 + fine * 0.38 + 0.34 - edge * 0.95));
  const moisture = noise2D(Math.floor(x / 4), Math.floor(y / 4), seed + 4049) * 0.7 + fine * 0.3;
  if (elevation < 0.28) return { terrain: 'ocean', elevation, moisture };
  if (elevation < 0.33) return { terrain: 'coast', elevation, moisture };
  if (elevation > 0.84) return { terrain: 'mountains', elevation, moisture };
  if (elevation > 0.7) return { terrain: 'hills', elevation, moisture };
  if (y < height * 0.16 && moisture < 0.55) return { terrain: 'tundra', elevation, moisture };
  if (moisture < 0.2) return { terrain: 'desert', elevation, moisture };
  if (moisture > 0.82 && elevation < 0.5) return { terrain: 'marsh', elevation, moisture };
  if (moisture > 0.58) return { terrain: 'forest', elevation, moisture };
  return { terrain: 'plains', elevation, moisture };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function settlementType(rng: RNG, tile: Tile): Settlement['type'] {
  if (tile.terrain === 'coast' && rng.chance(0.55)) return 'port';
  return rng.weighted([
    { value: 'hamlet' as const, weight: 24 }, { value: 'village' as const, weight: 35 },
    { value: 'town' as const, weight: 23 }, { value: 'city' as const, weight: 8 },
    { value: 'fortress' as const, weight: tile.terrain === 'hills' || tile.terrain === 'mountains' ? 14 : 4 },
  ]);
}

function populationFor(type: Settlement['type'], rng: RNG, scale: number): number {
  const ranges: Record<Settlement['type'], [number, number]> = {
    hamlet: [22, 55], village: [55, 140], town: [140, 320], city: [360, 750], fortress: [90, 220], port: [130, 350],
  };
  const [min, max] = ranges[type];
  return Math.max(12, Math.round(rng.int(min, max) * scale));
}

function historicalEvent(id: number, rng: RNG, year: number, kingdoms: Kingdom[], settlements: Settlement[], monsters: Monster[], artifacts: Artifact[], books: Book[]): WorldEvent {
  const kind = rng.weighted([
    { value: 'politics' as const, weight: 20 }, { value: 'war' as const, weight: 15 },
    { value: 'dragon' as const, weight: 9 }, { value: 'monster' as const, weight: 12 },
    { value: 'artifact' as const, weight: 10 }, { value: 'book' as const, weight: 9 },
    { value: 'settlement' as const, weight: 15 }, { value: 'trade' as const, weight: 10 },
  ]);
  const kingdom = rng.pick(kingdoms);
  const settlement = rng.pick(settlements.filter(s => s.kingdomId === kingdom.id).length ? settlements.filter(s => s.kingdomId === kingdom.id) : settlements);
  if (kind === 'dragon' && monsters.some(m => m.species === 'dragon')) {
    const monster = rng.pick(monsters.filter(m => m.species === 'dragon'));
    return { id, year, month: rng.int(1, 12), kind, title: `${monster.name} обрушился на ${settlement.name}`, description: `Дракон сжёг амбары у ${settlement.name}. ${kingdom.name} назначило награду и укрепило дороги.`, entityRefs: [{ kind: 'monster', id: monster.id }, { kind: 'settlement', id: settlement.id }, { kind: 'kingdom', id: kingdom.id }], importance: 4 };
  }
  if (kind === 'artifact' && artifacts.length) {
    const artifact = rng.pick(artifacts);
    return { id, year, month: rng.int(1, 12), kind, title: `${artifact.name} сменил владельца`, description: `Артефакт провезли через ${settlement.name}, и его история получила новую спорную главу.`, entityRefs: [{ kind: 'artifact', id: artifact.id }, { kind: 'settlement', id: settlement.id }], importance: 2 };
  }
  if (kind === 'book' && books.length) {
    const book = rng.pick(books);
    return { id, year, month: rng.int(1, 12), kind, title: `Распространились копии «${book.title}»`, description: `Писцы в ${settlement.name} переписали труд. Его утверждения начали влиять на местные взгляды.`, entityRefs: [{ kind: 'book', id: book.id }, { kind: 'settlement', id: settlement.id }], importance: 2 };
  }
  if (kind === 'war') {
    const rival = rng.pick(kingdoms.filter(k => k.id !== kingdom.id));
    return { id, year, month: rng.int(1, 12), kind, title: `Кровопролитие на границе ${kingdom.name} и ${rival.name}`, description: `Спорная дорога и неуплаченные пошлины привели к набегам, ответным ударам и сбору ополчения.`, entityRefs: [{ kind: 'kingdom', id: kingdom.id }, { kind: 'kingdom', id: rival.id }], importance: 3 };
  }
  const templates: Record<string, [string, string]> = {
    politics: [`Спор о наследовании в ${kingdom.name}`, `Знатный род бросил вызов двору и ослабил власть вокруг ${settlement.name}.`],
    monster: [`Существа собираются у ${settlement.name}`, `Охотники сообщили о согласованных нападениях на фермы и одиноких путников.`],
    settlement: [`${settlement.name} вступил в новую эпоху`, `Новые стены, мастерские и поля изменили положение поселения в регионе.`],
    trade: [`Дорога к ${settlement.name} процветает`, `Караваны привезли инструменты, зерно и вести из далёких земель.`],
  };
  const [title, description] = templates[kind] ?? templates.settlement;
  return { id, year, month: rng.int(1, 12), kind, title, description, entityRefs: [{ kind: 'settlement', id: settlement.id }, { kind: 'kingdom', id: kingdom.id }], importance: rng.int(1, 3) };
}

export function generateWorld(config: WorldConfig): WorldState {
  const rng = new RNG(config.seed);
  const seed = hashSeed(config.seed);
  const tiles: Tile[] = [];
  for (let y = 0; y < config.height; y += 1) {
    for (let x = 0; x < config.width; x += 1) {
      tiles.push({ x, y, ...terrainAt(x, y, config.width, config.height, seed) });
    }
  }
  const land = tiles.filter(t => t.terrain !== 'ocean' && t.terrain !== 'mountains');
  const selected: Tile[] = [];
  const shuffled = [...land].sort(() => rng.next() - 0.5);
  for (const tile of shuffled) {
    if (selected.length >= config.settlementCount) break;
    if (selected.every(other => distance(tile, other) > 2.2)) selected.push(tile);
  }
  const settlements: Settlement[] = selected.map((tile, i) => {
    const type = settlementType(rng, tile);
    return {
      id: i + 1, name: placeName(rng), x: tile.x, y: tile.y, kingdomId: 0,
      population: populationFor(type, rng, config.populationScale), prosperity: rng.int(35, 82),
      defense: rng.int(type === 'fortress' ? 65 : 18, type === 'city' ? 88 : 72), food: rng.int(55, 120),
      foundedYear: rng.int(1, Math.max(2, config.historyYears - 20)), type,
      buildings: [...buildingPools[type]].sort(() => rng.next() - 0.5).slice(0, rng.int(2, Math.min(5, buildingPools[type].length))),
      notableCharacterIds: [], damaged: 0,
    };
  });
  const kingdomCount = Math.max(2, Math.min(config.kingdomCount, settlements.length));
  const capitalChoices = [...settlements].sort((a, b) => b.population - a.population).slice(0, kingdomCount);
  const speciesList: Species[] = ['human', 'elf', 'orc', 'dwarf'];
  const kingdoms: Kingdom[] = capitalChoices.map((capital, i) => ({
    id: i + 1, name: kingdomName(rng), color: colors[i % colors.length]!, species: rng.weighted([{ value: 'human', weight: 50 }, { value: 'elf', weight: 18 }, { value: 'orc', weight: 18 }, { value: 'dwarf', weight: 14 }]),
    rulerId: 0, capitalId: capital.id, treasury: rng.int(600, 2400), armyStrength: rng.int(120, 480), stability: rng.int(45, 88), aggression: rng.int(15, 90),
    culture: rng.pick(cultures), religion: rng.pick(religions), foundedYear: rng.int(1, Math.max(2, config.historyYears - 40)), enemies: [],
  }));
  for (const settlement of settlements) {
    const nearest = kingdoms.reduce((best, kingdom) => {
      const capital = settlements.find(s => s.id === kingdom.capitalId)!;
      return distance(settlement, capital) < distance(settlement, settlements.find(s => s.id === best.capitalId)!) ? kingdom : best;
    }, kingdoms[0]!);
    settlement.kingdomId = nearest.id;
    tiles[settlement.y * config.width + settlement.x]!.settlementId = settlement.id;
  }
  for (const tile of tiles) {
    if (tile.terrain === 'ocean') continue;
    const nearest = kingdoms.reduce((best, kingdom) => {
      const capital = settlements.find(s => s.id === kingdom.capitalId)!;
      const bestCapital = settlements.find(s => s.id === best.capitalId)!;
      return distance(tile, capital) < distance(tile, bestCapital) ? kingdom : best;
    }, kingdoms[0]!);
    tile.kingdomId = nearest.id;
  }
  const characters: Character[] = [];
  let characterId = 1;
  for (const settlement of settlements) {
    const kingdom = kingdoms.find(k => k.id === settlement.kingdomId)!;
    const adults: number[] = [];
    for (let i = 0; i < settlement.population; i += 1) {
      const age = rng.int(0, kingdom.species === 'elf' ? 180 : kingdom.species === 'dwarf' ? 110 : 78);
      const character: Character = {
        id: characterId++, name: personName(rng, rng.chance(0.88) ? kingdom.species : rng.pick(speciesList)), species: rng.chance(0.88) ? kingdom.species : rng.pick(speciesList),
        age, birthYear: config.historyYears - age, alive: true, settlementId: settlement.id, kingdomId: kingdom.id,
        profession: age < 14 ? 'child' : rng.pick(professions), renown: rng.int(0, 18), health: rng.int(58, 100), ambition: rng.pick(ambitions),
        parentIds: [], childIds: [], titles: [], artifactIds: [], bookIds: [], kills: 0, biography: [`Родился в ${settlement.name}.`],
      };
      characters.push(character);
      if (age >= 18) adults.push(character.id);
    }
    const local = characters.filter(c => c.settlementId === settlement.id);
    for (const child of local.filter(c => c.age < 28)) {
      const candidates = local.filter(c => c.age >= child.age + 18 && c.age <= child.age + 48);
      if (candidates.length >= 1 && rng.chance(0.72)) {
        const parentA = rng.pick(candidates);
        const parentBOptions = candidates.filter(c => c.id !== parentA.id);
        child.parentIds = [parentA.id];
        parentA.childIds.push(child.id);
        if (parentBOptions.length && rng.chance(0.82)) {
          const parentB = rng.pick(parentBOptions);
          child.parentIds.push(parentB.id);
          parentB.childIds.push(child.id);
        }
      }
    }
    settlement.notableCharacterIds = local.filter(c => c.age >= 16).sort((a, b) => b.renown - a.renown).slice(0, 8).map(c => c.id);
  }
  for (const kingdom of kingdoms) {
    const capitalPeople = characters.filter(c => c.settlementId === kingdom.capitalId && c.age >= 24);
    const ruler = capitalPeople.sort((a, b) => b.renown - a.renown)[0] ?? characters.find(c => c.kingdomId === kingdom.id)!;
    ruler.titles.push(kingdom.species === 'orc' ? 'Верховный вождь' : 'Правитель');
    ruler.renown = Math.max(70, ruler.renown);
    ruler.biography.push(`Взошёл на престол государства ${kingdom.name}.`);
    kingdom.rulerId = ruler.id;
  }
  const armies: Army[] = kingdoms.map((kingdom, i) => {
    const capital = settlements.find(s => s.id === kingdom.capitalId)!;
    const commander = characters.filter(c => c.kingdomId === kingdom.id && c.age >= 20).sort((a, b) => b.renown - a.renown)[1] ?? characters.find(c => c.kingdomId === kingdom.id)!;
    commander.titles.push('Маршал'); commander.profession = 'soldier';
    return { id: i + 1, name: `Войско ${capital.name}`, kingdomId: kingdom.id, commanderId: commander.id, x: capital.x, y: capital.y, strength: kingdom.armyStrength, morale: rng.int(55, 90), status: 'garrison' };
  });
  const dungeons: Dungeon[] = [];
  const dungeonOrigins = ['забытая царская гробница', 'заброшенная шахта', 'разрушенный храм', 'запечатанная магическая обсерватория', 'павшая горная крепость', 'древний подземный город', 'катакомбы контрабандистов'];
  const dungeonTiles = shuffled.filter(t => !t.settlementId).slice(config.settlementCount, config.settlementCount + Math.max(8, Math.round(config.settlementCount * 0.45)));
  dungeonTiles.forEach((tile, i) => {
    const dungeon: Dungeon = { id: i + 1, name: `${rng.pick(['Глубины', 'Хранилище', 'Курган', 'Руины', 'Чертоги'])} ${placeName(rng)}`, x: tile.x, y: tile.y, origin: rng.pick(dungeonOrigins), builtYear: rng.int(-500, config.historyYears - 30), danger: rng.int(2, 10), depth: rng.int(1, 8), currentInhabitants: rng.pick(['гоблины', 'беспокойные мертвецы', 'разбойники', 'гигантские твари', 'культисты', 'неизвестные существа']), artifactIds: [], history: [] };
    dungeons.push(dungeon); tiles[tile.y * config.width + tile.x]!.dungeonId = dungeon.id;
  });
  const monsters: Monster[] = [];
  const monsterCount = Math.max(6, Math.round(config.settlementCount * config.monsterDensity * 0.45));
  const monsterSpecies = ['dragon', 'troll', 'wyvern', 'ogre', 'manticore', 'giant serpent', 'grave beast', 'forest horror'];
  for (let i = 0; i < monsterCount; i += 1) {
    const tile = rng.pick(shuffled.filter(t => !t.settlementId));
    const species = i < Math.max(1, Math.round(monsterCount * 0.16)) ? 'dragon' : rng.pick(monsterSpecies);
    const tier: Monster['tier'] = species === 'dragon' ? (rng.chance(0.35) ? 'boss' : 'miniboss') : rng.weighted([{ value: 'common', weight: 48 }, { value: 'elite', weight: 32 }, { value: 'miniboss', weight: 16 }, { value: 'boss', weight: 4 }]);
    const monster: Monster = { id: i + 1, name: monsterName(rng, species), species, tier, x: tile.x, y: tile.y, health: tier === 'boss' ? rng.int(700, 1200) : tier === 'miniboss' ? rng.int(320, 680) : rng.int(90, 300), power: tier === 'boss' ? rng.int(80, 140) : tier === 'miniboss' ? rng.int(45, 95) : rng.int(15, 50), age: rng.int(4, species === 'dragon' ? 760 : 120), alive: true, hoard: rng.int(20, species === 'dragon' ? 1400 : 240), lairDungeonId: rng.chance(0.65) ? rng.pick(dungeons).id : undefined, kills: rng.int(0, 18), history: [] };
    monsters.push(monster); tiles[tile.y * config.width + tile.x]!.monsterId = monster.id;
  }
  const artifacts: Artifact[] = [];
  const artifactCount = Math.max(8, Math.round(config.settlementCount * config.artifactDensity * 0.65));
  const depictions = ['коронованный всадник под семью звёздами', 'падение красного дракона', 'эльфийская королева сажает первое серебряное дерево', 'оркские кланы переходят замёрзшую реку', 'безымянный святой закрывает чёрные врата', 'три луны над горящим флотом'];
  for (let i = 0; i < artifactCount; i += 1) {
    const creator = rng.pick(characters.filter(c => c.age >= 16));
    const owner = rng.pick(characters.filter(c => c.age >= 16));
    const artifact: Artifact = { id: i + 1, name: `${rng.pick(['Корона', 'Клинок', 'Чаша', 'Знамя', 'Маска', 'Кольцо', 'Рог', 'Щит'])} ${placeName(rng)}`, type: rng.pick(['оружие', 'регалия', 'ритуальный предмет', 'драгоценность', 'доспех', 'инструмент']), material: rng.pick(['серебро', 'чёрное железо', 'золото', 'драконья кость', 'лунный камень', 'бронза', 'тис']), creatorId: creator.id, ownerId: owner.id, settlementId: creator.settlementId, yearCreated: rng.int(1, config.historyYears), power: rng.int(0, Math.round(config.magic * 22)), depiction: rng.pick(depictions), history: [`Создан мастером ${creator.name}.`, `Сейчас принадлежит ${owner.name}.`] };
    artifacts.push(artifact); creator.artifactIds.push(artifact.id); owner.artifactIds.push(artifact.id);
    if (rng.chance(0.45)) rng.pick(dungeons).artifactIds.push(artifact.id);
  }
  const books: Book[] = [];
  const subjects = ['история династий', 'драконы', 'травничество', 'древние машины', 'богословие', 'военное дело', 'далёкие острова', 'чудовища', 'ремесло', 'поэзия'];
  for (let i = 0; i < Math.max(10, Math.round(config.settlementCount * 0.75)); i += 1) {
    const author = rng.pick(characters.filter(c => c.age >= 20));
    const subject = rng.pick(subjects);
    const book: Book = { id: i + 1, title: `${rng.pick(['О', 'Хроника:', 'Скрытая правда:', 'Песни о', 'Наблюдения о'])} ${subject}`, authorId: author.id, yearWritten: rng.int(Math.max(1, config.historyYears - author.age), config.historyYears), language: kingdoms.find(k => k.id === author.kingdomId)!.culture, subject, reliability: rng.int(25, 98), summary: `Труд о теме «${subject}», основанный на опыте автора в ${settlements.find(s => s.id === author.settlementId)!.name}.`, copies: rng.int(1, 45), settlementId: author.settlementId };
    books.push(book); author.bookIds.push(book.id); author.biography.push(`Написал книгу «${book.title}».`);
  }
  const events: WorldEvent[] = [];
  let eventId = 1;
  for (const settlement of settlements) {
    events.push({ id: eventId++, year: settlement.foundedYear, month: rng.int(1, 12), kind: 'settlement', title: `Основан ${settlement.name}`, description: `${settlement.name} возник под властью государства ${kingdoms.find(k => k.id === settlement.kingdomId)!.name}.`, entityRefs: [{ kind: 'settlement', id: settlement.id }], importance: 3 });
  }
  const historyEvents = Math.min(900, Math.max(80, Math.round(config.historyYears * 1.45)));
  for (let i = 0; i < historyEvents; i += 1) events.push(historicalEvent(eventId++, rng, rng.int(1, config.historyYears), kingdoms, settlements, monsters, artifacts, books));
  events.sort((a, b) => a.year - b.year || a.month - b.month);
  const wars: War[] = [];
  const world: WorldState = {
    version: 1, language: 'ru', config, name: `Мир ${placeName(rng)}`, year: config.historyYears, month: 1,
    tiles, kingdoms, settlements, characters, armies, monsters, artifacts, books, dungeons, wars, events,
    nextIds: { event: eventId, character: characterId, war: 1, artifact: artifacts.length + 1, book: books.length + 1 },
  };
  return world;
}

export const defaultConfig: WorldConfig = {
  seed: 'Eldervale-Первая-Эпоха', width: 54, height: 34, historyYears: 320, kingdomCount: 7,
  settlementCount: 30, populationScale: 0.72, magic: 0.38, warlike: 0.48, monsterDensity: 1, artifactDensity: 1,
};
