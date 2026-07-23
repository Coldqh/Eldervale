import type {
  Army, Artifact, Book, Character, Dynasty, Dungeon, EntityRef, Kingdom, Monster, Relationship,
  Settlement, Species, Terrain, Tile, TradeRoute, War, WorldConfig, WorldEvent, WorldState,
} from '../types';
import { APP_VERSION } from '../version';
import { RNG, hashSeed, noise2D } from './rng';
import { kingdomName, monsterName, personName, placeName } from './names';
import { causalEvent } from './causality';
import { generateAlchemyRecipes, generateAnimalPopulations, generateNaturalIngredients } from './ecology';
import { createHousingProfile } from './settlements';
import { createSimulationRuntime } from './scheduler';

export type GenerationProgressReporter = (phase: string, completed: number, total: number, detail?: string) => void;

const colors = ['#9f4d46', '#4c7396', '#6d8752', '#9a7741', '#735d8f', '#3f8a80', '#a45f78', '#7d6b55', '#587284', '#8d8248'];
const cultures = ['Речная Корона', 'Старый Камень', 'Зелёная Клятва', 'Солнечный Берег', 'Пепельное Знамя', 'Лунный Лес', 'Железный Очаг', 'Золотая Степь'];
const religions = ['Семь Светильников', 'Зелёный Двор', 'Первое Пламя', 'Молчаливые Звёзды', 'Глубинный Отец', 'Колесо Рассвета'];
const professions = ['farmer', 'miller', 'hunter', 'guard', 'blacksmith', 'carpenter', 'herbalist', 'merchant', 'scribe', 'priest', 'soldier', 'fisher', 'miner', 'weaver', 'brewer', 'healer'];
const ambitions = ['создать крепкую семью', 'стать великим мастером', 'получить дворянский титул', 'уйти за пределы известных дорог', 'написать книгу, которую запомнят', 'защитить родную землю', 'разбогатеть', 'найти древние руины', 'служить богам', 'отомстить за старую обиду'];
const laws = ['королевский мир на дорогах', 'налог с рынков', 'воинская повинность', 'право убежища в храмах', 'запрет кровной мести в городах', 'десятина с рудников'];
const resourcesByTerrain: Record<Terrain, string[]> = {
  ocean: ['рыба'], coast: ['рыба', 'соль', 'жемчуг'], plains: ['зерно', 'лошади', 'лён'], forest: ['древесина', 'мёд', 'лекарственные травы'],
  hills: ['овцы', 'камень', 'железо'], mountains: ['железо', 'серебро', 'драгоценные камни'], marsh: ['торф', 'тростник', 'целебные грибы'],
  desert: ['соль', 'стекольный песок', 'пряности'], tundra: ['меха', 'рыба', 'янтарь'],
};
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

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function monsterFootprint(species: string, tier: Monster['tier'], power: number, rng: RNG): { width: number; height: number } {
  if (species === 'dragon') return tier === 'boss'
    ? { width: rng.int(7, 11), height: rng.int(5, 8) }
    : { width: rng.int(5, 8), height: rng.int(4, 6) };
  if (species === 'giant serpent') return { width: rng.int(6, 10), height: rng.int(2, 3) };
  if (tier === 'boss') return { width: rng.int(4, 7), height: rng.int(4, 7) };
  if (tier === 'miniboss' || power >= 70) return { width: rng.int(2, 4), height: rng.int(2, 4) };
  if (species === 'ogre' || species === 'troll') return { width: 2, height: 2 };
  return { width: 1, height: 1 };
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
    hamlet: [24, 75], village: [90, 360], town: [320, 920], city: [900, 2500], fortress: [160, 620], port: [420, 1350],
  };
  const [min, max] = ranges[type];
  return Math.max(12, Math.round(rng.int(min, max) * scale));
}

function districtTarget(type: Settlement['type'], rng: RNG): number {
  if (type === 'city') return rng.int(4, 7);
  if (type === 'port') return rng.int(2, 4);
  if (type === 'town') return rng.int(2, 3);
  if (type === 'fortress') return rng.int(1, 2);
  return 1;
}

function districtRole(type: Settlement['type'], index: number, terrain: Terrain): Settlement['districts'][number]['role'] {
  if (index === 0) return type === 'fortress' ? 'крепость' : 'центр';
  if (type === 'port' && terrain === 'coast' && index === 1) return 'порт';
  const roles: Settlement['districts'][number]['role'][] = ['жилой район', 'рынок', 'ремесленный район', 'поля', 'окраина'];
  return roles[(index - 1) % roles.length]!;
}

function assignSettlementFootprints(settlements: Settlement[], tiles: Tile[], rng: RNG, width: number, height: number): void {
  const occupied = new Set<string>();
  const origins = new Set(settlements.map(item => `${item.x}:${item.y}`));
  const tileAt = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height ? tiles[y * width + x] : undefined;
  for (const settlement of [...settlements].sort((a, b) => b.population - a.population)) {
    const origin = tileAt(settlement.x, settlement.y);
    if (!origin) continue;
    const desired = districtTarget(settlement.type, rng);
    const queue = [{ x: settlement.x, y: settlement.y }];
    const chosen: Tile[] = [];
    const seen = new Set<string>();
    while (queue.length && chosen.length < desired) {
      const point = queue.shift()!;
      const key = `${point.x}:${point.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tile = tileAt(point.x, point.y);
      if (!tile || tile.terrain === 'ocean' || occupied.has(key) || (origins.has(key) && key !== `${settlement.x}:${settlement.y}`)) continue;
      chosen.push(tile);
      const neighbours = [
        { x: point.x + 1, y: point.y }, { x: point.x - 1, y: point.y },
        { x: point.x, y: point.y + 1 }, { x: point.x, y: point.y - 1 },
      ].sort(() => rng.next() - .5);
      queue.push(...neighbours);
    }
    settlement.districts = chosen.map((tile, index) => ({
      x: tile.x, y: tile.y, role: districtRole(settlement.type, index, tile.terrain),
      name: index === 0 ? 'Сердце поселения' : `${districtRole(settlement.type, index, tile.terrain)} ${index + 1}`,
    }));
    for (const district of settlement.districts) {
      const tile = tileAt(district.x, district.y)!;
      tile.settlementId = settlement.id;
      tile.settlementDistrict = district.name;
      occupied.add(`${district.x}:${district.y}`);
    }
  }
}

function workplaceFor(profession: string): string {
  const map: Record<string, string> = {
    farmer: 'поля и пастбища', miller: 'мельница', hunter: 'охотничьи угодья', guard: 'стража и ворота', blacksmith: 'кузница',
    carpenter: 'плотницкая мастерская', herbalist: 'травницкая мастерская', merchant: 'рынок', scribe: 'архив или канцелярия', priest: 'храм',
    soldier: 'казармы', fisher: 'берег или пристань', miner: 'шахта', weaver: 'ткацкая мастерская', brewer: 'пивоварня', healer: 'лечебница', child: 'дом семьи',
  };
  return map[profession] ?? 'местные работы';
}

function event(
  id: number,
  year: number,
  month: number,
  kind: WorldEvent['kind'],
  title: string,
  description: string,
  cause: string,
  consequences: string[],
  entityRefs: EntityRef[],
  importance: number,
  traces: EntityRef[] = entityRefs,
): WorldEvent {
  return causalEvent(id, year, month, {
    kind, title, description, cause, consequences, entityRefs, importance, traces,
    conditions: [cause, 'участники и ресурсы существовали в мире до события'],
    decision: description,
    outcome: consequences.join('; '),
  });
}

function createRelationships(rng: RNG, characters: Character[], settlements: Settlement[], historyYears: number): Relationship[] {
  const relationships: Relationship[] = [];
  let id = 1;
  const add = (a: Character, b: Character, kind: Relationship['kind'], strength: number, reason: string, isPublic = true) => {
    if (a.id === b.id || relationships.some(rel => (rel.characterAId === a.id && rel.characterBId === b.id) || (rel.characterAId === b.id && rel.characterBId === a.id))) return;
    const relation: Relationship = { id: id++, characterAId: a.id, characterBId: b.id, kind, strength, sinceYear: rng.int(Math.max(1, historyYears - Math.min(a.age, b.age)), historyYears), public: isPublic, reason };
    relationships.push(relation);
    a.relationshipIds.push(relation.id);
    b.relationshipIds.push(relation.id);
  };

  for (const settlement of settlements) {
    const locals = characters.filter(c => c.settlementId === settlement.id && c.age >= 18 && c.age <= 90);
    const available = [...locals].sort((a, b) => a.id - b.id);
    for (let i = 0; i + 1 < available.length; i += 2) {
      const a = available[i]!;
      const candidates = available.slice(i + 1).filter(b => !b.spouseId && Math.abs(a.age - b.age) < 26);
      if (!a.spouseId && candidates.length && rng.chance(0.54)) {
        const b = rng.pick(candidates);
        a.spouseId = b.id;
        b.spouseId = a.id;
        add(a, b, 'любовь', rng.int(48, 95), `совместная жизнь в ${settlement.name}`);
      }
    }
    const notable = locals.filter(c => c.renown > 8).slice(0, 22);
    for (let i = 0; i < Math.min(8, Math.floor(notable.length / 2)); i += 1) {
      const a = rng.pick(notable);
      const b = rng.pick(notable.filter(item => item.id !== a.id));
      const kind = rng.weighted<Relationship['kind']>([
        { value: 'дружба', weight: 34 }, { value: 'верность', weight: 22 }, { value: 'долг', weight: 15 },
        { value: 'соперничество', weight: 18 }, { value: 'ненависть', weight: 6 }, { value: 'страх', weight: 5 },
      ]);
      add(a, b, kind, rng.int(30, 90), kind === 'долг' ? 'неоплаченная услуга или заём' : `общая история в ${settlement.name}`, kind !== 'ненависть');
    }
  }

  for (const child of characters.filter(c => c.parentIds.length)) {
    for (const parentId of child.parentIds) {
      const parent = characters.find(c => c.id === parentId);
      if (parent) add(parent, child, 'родство', rng.int(55, 100), 'родитель и ребёнок');
    }
  }
  return relationships;
}

function createDynasties(rng: RNG, kingdoms: Kingdom[], characters: Character[], historyYears: number): Dynasty[] {
  const dynasties: Dynasty[] = [];
  let id = 1;
  for (const kingdom of kingdoms) {
    const ruler = characters.find(c => c.id === kingdom.rulerId)!;
    const familyIds = new Set<number>([ruler.id, ...ruler.parentIds, ...ruler.childIds]);
    if (ruler.spouseId) familyIds.add(ruler.spouseId);
    const dynasty: Dynasty = {
      id: id++, name: `Дом ${ruler.name}`, founderId: ruler.parentIds[0] ?? ruler.id, currentHeadId: ruler.id,
      memberIds: [...familyIds], kingdomId: kingdom.id, prestige: rng.int(60, 98), wealth: rng.int(700, 2800),
      claimKingdomIds: [kingdom.id], history: [`Дом утвердился при дворе государства ${kingdom.name}.`],
    };
    dynasties.push(dynasty);
    kingdom.dynastyId = dynasty.id;
    for (const memberId of dynasty.memberIds) {
      const member = characters.find(c => c.id === memberId);
      if (member) member.dynastyId = dynasty.id;
    }

    const nobles = characters.filter(c => c.kingdomId === kingdom.id && c.age >= 25 && !c.dynastyId).sort((a, b) => b.renown - a.renown).slice(0, 2);
    for (const noble of nobles) {
      const members = new Set<number>([noble.id, ...noble.childIds]);
      if (noble.spouseId) members.add(noble.spouseId);
      const house: Dynasty = {
        id: id++, name: `Дом ${noble.name}`, founderId: noble.id, currentHeadId: noble.id, memberIds: [...members], kingdomId: kingdom.id,
        prestige: rng.int(28, 72), wealth: rng.int(250, 1400), claimKingdomIds: rng.chance(0.22) ? [kingdom.id] : [],
        history: [`Род получил влияние в ${rng.int(Math.max(1, historyYears - 120), historyYears)} году.`],
      };
      dynasties.push(house);
      for (const memberId of house.memberIds) {
        const member = characters.find(c => c.id === memberId);
        if (member && !member.dynastyId) member.dynastyId = house.id;
      }
    }
  }
  return dynasties;
}

function createTradeRoutes(rng: RNG, settlements: Settlement[], kingdoms: Kingdom[]): TradeRoute[] {
  const routes: TradeRoute[] = [];
  const used = new Set<string>();
  for (const from of settlements) {
    const nearest = settlements.filter(to => to.id !== from.id).sort((a, b) => distance(from, a) - distance(from, b)).slice(0, from.type === 'city' || from.type === 'port' ? 3 : 1);
    for (const to of nearest) {
      const key = [from.id, to.id].sort((a, b) => a - b).join(':');
      if (used.has(key)) continue;
      used.add(key);
      const route: TradeRoute = {
        id: routes.length + 1, name: `${from.name} — ${to.name}`, fromSettlementId: from.id, toSettlementId: to.id,
        goods: [...new Set([from.resource, to.resource])], volume: rng.int(18, 86),
        safety: Math.max(15, Math.round(92 - distance(from, to) * 4 - rng.int(0, 18))), active: true,
        controlledByKingdomIds: [...new Set([from.kingdomId, to.kingdomId])],
        history: [`Маршрут связал ${from.name} и ${to.name}.`],
      };
      routes.push(route);
      from.tradeRouteIds.push(route.id);
      to.tradeRouteIds.push(route.id);
      if (from.kingdomId !== to.kingdomId) {
        const a = kingdoms.find(k => k.id === from.kingdomId)!;
        const b = kingdoms.find(k => k.id === to.kingdomId)!;
        a.treasury += route.volume;
        b.treasury += route.volume;
      }
    }
  }
  return routes;
}

export function generateWorld(config: WorldConfig, onProgress?: GenerationProgressReporter): WorldState {
  const report = (phase: string, completed: number, detail?: string) => onProgress?.(phase, completed, 100, detail);
  report('Создание рельефа и биомов', 2);
  const rng = new RNG(config.seed);
  const seed = hashSeed(config.seed);
  const tiles: Tile[] = [];
  for (let y = 0; y < config.height; y += 1) for (let x = 0; x < config.width; x += 1) tiles.push({ x, y, ...terrainAt(x, y, config.width, config.height, seed) });
  report('Размещение поселений и районов', 14, `${tiles.length.toLocaleString('ru-RU')} глобальных клеток`);

  const land = tiles.filter(tile => tile.terrain !== 'ocean' && tile.terrain !== 'mountains');
  const shuffled = [...land].sort((a, b) => noise2D(a.x, a.y, seed + 77) - noise2D(b.x, b.y, seed + 77));
  const selected: Tile[] = [];
  for (const tile of shuffled) {
    if (selected.length >= config.settlementCount) break;
    if (selected.every(other => distance(tile, other) > 3.1)) selected.push(tile);
  }

  const settlements: Settlement[] = selected.map((tile, index) => {
    const type = settlementType(rng, tile);
    const population = populationFor(type, rng, config.populationScale);
    const housing = createHousingProfile(population, type, rng);
    const resource = rng.pick(resourcesByTerrain[tile.terrain]);
    return {
      id: index + 1, name: placeName(rng), x: tile.x, y: tile.y, kingdomId: 0,
      population, prosperity: rng.int(35, 82),
      defense: rng.int(type === 'fortress' ? 65 : 18, type === 'city' ? 88 : 72), food: rng.int(55, 120),
      foundedYear: rng.int(1, Math.max(2, config.historyYears - 20)), type,
      buildings: housing.buildings, buildingCounts: housing.buildingCounts, households: housing.households,
      residentialCapacity: housing.residentialCapacity, districts: [], notableCharacterIds: [], damaged: 0, resource,
      stockpile: { [resource]: rng.int(18, 80), зерно: rng.int(20, 90), древесина: rng.int(12, 70), камень: rng.int(4, 45) },
      livestock: { куры: Math.max(0, Math.round(population / 8)), козы: Math.max(0, Math.round(population / 18)), лошади: type === 'city' || type === 'fortress' ? Math.round(population / 22) : Math.round(population / 50) },
      shortages: [], tradeRouteIds: [], unrest: rng.int(0, 18), history: [], buildingIds: [], householdIds: [], establishmentIds: [],
      economy: { currency: 'крона', coinSupply: 0, priceIndex: 1, wageIndex: 1, rentIndex: 1, taxRate: .08, prices: {}, supply: {}, demand: {}, imports: {}, exports: {}, lastMonthlyTrade: 0, bankruptcies: 0 },
    };
  });
  report('Формирование государств и границ', 28, `${settlements.length} поселений`);
  assignSettlementFootprints(settlements, tiles, rng, config.width, config.height);

  const kingdomCount = Math.max(2, Math.min(config.kingdomCount, settlements.length));
  const capitalChoices = [...settlements].sort((a, b) => b.population - a.population).slice(0, kingdomCount);
  const kingdoms: Kingdom[] = capitalChoices.map((capital, index) => ({
    id: index + 1, name: kingdomName(rng), color: colors[index % colors.length]!,
    species: rng.weighted([{ value: 'human' as const, weight: 50 }, { value: 'elf' as const, weight: 18 }, { value: 'orc' as const, weight: 18 }, { value: 'dwarf' as const, weight: 14 }]),
    rulerId: 0, capitalId: capital.id, treasury: rng.int(600, 2400), armyStrength: rng.int(120, 480), stability: rng.int(45, 88), aggression: rng.int(15, 90),
    culture: rng.pick(cultures), religion: rng.pick(religions), foundedYear: rng.int(1, Math.max(2, config.historyYears - 40)), enemies: [], claims: [], diplomacy: [],
    laws: [...laws].sort(() => rng.next() - .5).slice(0, rng.int(2, 4)),
  }));
  report('Создание жителей и семей', 40, `${kingdoms.length} государств`);

  for (const settlement of settlements) {
    const nearest = kingdoms.reduce((best, kingdom) => {
      const capital = settlements.find(item => item.id === kingdom.capitalId)!;
      const bestCapital = settlements.find(item => item.id === best.capitalId)!;
      return distance(settlement, capital) < distance(settlement, bestCapital) ? kingdom : best;
    }, kingdoms[0]!);
    settlement.kingdomId = nearest.id;
    settlement.history.push(`${settlement.name} основан под властью государства ${nearest.name}.`);
  }

  for (const tile of tiles) {
    if (tile.terrain === 'ocean') continue;
    const nearest = kingdoms.reduce((best, kingdom) => {
      const capital = settlements.find(item => item.id === kingdom.capitalId)!;
      const bestCapital = settlements.find(item => item.id === best.capitalId)!;
      return distance(tile, capital) < distance(tile, bestCapital) ? kingdom : best;
    }, kingdoms[0]!);
    tile.kingdomId = nearest.id;
  }

  for (const kingdom of kingdoms) {
    for (const other of kingdoms.filter(item => item.id !== kingdom.id)) {
      const score = rng.int(-55, 68);
      kingdom.diplomacy.push({ kingdomId: other.id, score, status: score > 40 ? 'союз' : score < -28 ? 'напряжение' : 'мир', reason: score < 0 ? 'старые споры о границах и пошлинах' : 'торговля и династические связи' });
    }
  }

  const characters: Character[] = [];
  let characterId = 1;
  const speciesList: Species[] = ['human', 'elf', 'orc', 'dwarf'];
  for (const settlement of settlements) {
    const kingdom = kingdoms.find(item => item.id === settlement.kingdomId)!;
    for (let index = 0; index < settlement.population; index += 1) {
      const species = rng.chance(.88) ? kingdom.species : rng.pick(speciesList);
      const maxAge = species === 'elf' ? 180 : species === 'dwarf' ? 110 : 78;
      const age = rng.int(0, maxAge);
      characters.push({
        id: characterId++, name: personName(rng, species), species, age, birthYear: config.historyYears - age, alive: true,
        settlementId: settlement.id, kingdomId: kingdom.id, profession: age < 14 ? 'child' : rng.pick(professions), workplace: '',
        homeDistrict: settlement.districts.length ? rng.pick(settlement.districts).name : 'Сердце поселения', renown: rng.int(0, 18), health: rng.int(58, 100),
        wealth: age < 14 ? 0 : rng.int(0, 180), loyalty: rng.int(25, 92), ambition: rng.pick(ambitions), parentIds: [], childIds: [], relationshipIds: [],
        titles: [], artifactIds: [], bookIds: [], injuries: [], kills: 0, biography: [`Родился в ${settlement.name}.`], inventoryItemIds: [],
        skills: { [age < 14 ? 'child' : professions[characterId % professions.length]!]: Math.max(1, Math.min(100, rng.int(6, 42) + Math.floor(age / 3))) },
        needs: { hunger: 10, thirst: 8, rest: 10, warmth: 10, safety: 12, social: 16, lastUpdatedTick: config.historyYears * 12 },
        schedule: { wakeHour: 6, workStartHour: age >= 14 ? 8 : 0, workEndHour: age >= 14 ? 17 : 0, sleepHour: 22, restDay: 1 + characterId % 7, currentActivity: age >= 14 ? 'занят обычной работой' : 'живёт в семье и учится' },
        wallet: age < 14 ? 0 : rng.int(0, 24), equipment: { material: 'лён и шерсть', color: 'неокрашенный', quality: 40, condition: rng.int(35, 82), socialTier: 'обычный', equippedItemIds: {}, compact: true, lastMaintainedTick: config.historyYears * 12 }, knowledge: { factIds: [], memoryIds: [], opinions: [], detailed: false, lastGossipTick: config.historyYears * 12 },
      });
    }
    const locals = characters.filter(character => character.settlementId === settlement.id);
    for (const local of locals) local.workplace = workplaceFor(local.profession);
    for (const child of locals.filter(character => character.age < 28)) {
      const candidates = locals.filter(character => character.age >= child.age + 18 && character.age <= child.age + 48);
      if (candidates.length && rng.chance(.72)) {
        const parentA = rng.pick(candidates);
        child.parentIds.push(parentA.id);
        parentA.childIds.push(child.id);
        const second = candidates.filter(character => character.id !== parentA.id);
        if (second.length && rng.chance(.82)) {
          const parentB = rng.pick(second);
          child.parentIds.push(parentB.id);
          parentB.childIds.push(child.id);
        }
      }
    }
    settlement.notableCharacterIds = locals.filter(character => character.age >= 16).sort((a, b) => b.renown - a.renown).slice(0, 8).map(character => character.id);
  }

  for (const kingdom of kingdoms) {
    const capitalPeople = characters.filter(character => character.settlementId === kingdom.capitalId && character.age >= 24);
    const ruler = capitalPeople.sort((a, b) => b.renown - a.renown)[0] ?? characters.find(character => character.kingdomId === kingdom.id)!;
    ruler.titles.push(kingdom.species === 'orc' ? 'Верховный вождь' : 'Правитель');
    ruler.renown = Math.max(70, ruler.renown);
    ruler.wealth += kingdom.treasury / 3;
    ruler.biography.push(`Взошёл на престол государства ${kingdom.name}.`);
    kingdom.rulerId = ruler.id;
  }

  const relationships = createRelationships(rng, characters, settlements, config.historyYears);
  const dynasties = createDynasties(rng, kingdoms, characters, config.historyYears);
  report('Армии, дворы и торговые пути', 58, `${characters.length.toLocaleString('ru-RU')} именных жителей`);
  const tradeRoutes = createTradeRoutes(rng, settlements, kingdoms);

  const armies: Army[] = kingdoms.map((kingdom, index) => {
    const capital = settlements.find(settlement => settlement.id === kingdom.capitalId)!;
    const commander = characters.filter(character => character.kingdomId === kingdom.id && character.age >= 20).sort((a, b) => b.renown - a.renown)[1] ?? characters.find(character => character.kingdomId === kingdom.id)!;
    commander.titles.push('Маршал');
    commander.profession = 'soldier';
    return { id: index + 1, name: `Войско ${capital.name}`, kingdomId: kingdom.id, commanderId: commander.id, x: capital.x, y: capital.y, strength: kingdom.armyStrength, morale: rng.int(55, 90), supplies: rng.int(60, 100), status: 'garrison', campaignHistory: [], soldierIds: [], unitIds: [], supplyWagonIds: [], inventoryItemIds: [], logistics: { foodDays: 45, waterDays: 35, medicine: 12, tents: 0, tools: 0, horses: 0, wagons: 0, equipmentCoverage: 0, armorCoverage: 0, rangedCoverage: 0, payrollDebt: 0, desertions: 0, wounded: 0 }, monthlyPayroll: 0, readiness: 35 };
  });

  const dungeons: Dungeon[] = [];
  const dungeonOrigins = ['забытая царская гробница', 'заброшенная шахта', 'разрушенный храм', 'запечатанная магическая обсерватория', 'павшая горная крепость', 'древний подземный город', 'катакомбы контрабандистов'];
  const dungeonTiles = shuffled.filter(tile => !tile.settlementId).slice(config.settlementCount, config.settlementCount + Math.max(8, Math.round(config.settlementCount * .45)));
  dungeonTiles.forEach((tile, index) => {
    const origin = rng.pick(dungeonOrigins);
    const dungeon: Dungeon = {
      id: index + 1, name: `${rng.pick(['Глубины', 'Хранилище', 'Курган', 'Руины', 'Чертоги'])} ${placeName(rng)}`, x: tile.x, y: tile.y,
      origin, purpose: origin.includes('шахта') ? 'добыча руды' : origin.includes('гробница') ? 'погребение правителей' : origin.includes('крепость') ? 'защита старой границы' : 'ритуалы и тайные исследования',
      builtYear: rng.int(-1200, config.historyYears - 30), danger: rng.int(2, 10), depth: rng.int(1, 8),
      currentInhabitants: rng.pick(['гоблины', 'беспокойные мертвецы', 'разбойники', 'гигантские твари', 'культисты', 'неизвестные существа']),
      ownerKingdomId: tile.kingdomId, discovered: rng.chance(.7), artifactIds: [], history: [`Место было создано как ${origin}.`],
    };
    dungeons.push(dungeon);
    tiles[tile.y * config.width + tile.x]!.dungeonId = dungeon.id;
  });

  const monsters: Monster[] = [];
  const monsterCount = Math.max(6, Math.round(config.settlementCount * config.monsterDensity * .45));
  const monsterSpecies = ['dragon', 'troll', 'wyvern', 'ogre', 'manticore', 'giant serpent', 'grave beast', 'forest horror'];
  for (let index = 0; index < monsterCount; index += 1) {
    const tile = rng.pick(shuffled.filter(item => !item.settlementId));
    const species = index < Math.max(1, Math.round(monsterCount * .16)) ? 'dragon' : rng.pick(monsterSpecies);
    const tier: Monster['tier'] = species === 'dragon' ? (rng.chance(.35) ? 'boss' : 'miniboss') : rng.weighted([{ value: 'common', weight: 48 }, { value: 'elite', weight: 32 }, { value: 'miniboss', weight: 16 }, { value: 'boss', weight: 4 }]);
    const behavior = species === 'dragon' ? rng.pick(['собирает золото и карает вторжение', 'охотится на стада и караваны', 'требует дань с поселений']) : rng.pick(['охотится ночью', 'защищает выводок', 'следует за запахом крови', 'занимает заброшенные руины']);
    const health = tier === 'boss' ? rng.int(700, 1200) : tier === 'miniboss' ? rng.int(320, 680) : rng.int(90, 300);
    const power = tier === 'boss' ? rng.int(80, 140) : tier === 'miniboss' ? rng.int(45, 95) : rng.int(15, 50);
    const footprint = monsterFootprint(species, tier, power, rng);
    const monster: Monster = {
      id: index + 1, name: monsterName(rng, species), species, tier, x: tile.x, y: tile.y,
      health, power, age: rng.int(4, species === 'dragon' ? 760 : 120), alive: true,
      hoard: rng.int(20, species === 'dragon' ? 1400 : 240), hunger: rng.int(15, 80), territoryRadius: species === 'dragon' ? rng.int(6, 10) : rng.int(2, 6),
      behavior, goal: species === 'dragon' ? 'расширить сокровищницу и сохранить логово' : 'удержать безопасную территорию',
      lairDungeonId: rng.chance(.65) ? rng.pick(dungeons).id : undefined, kills: rng.int(0, 18), history: [`Существо заняло территорию вокруг клетки ${tile.x}:${tile.y}.`],
      footprintWidth: footprint.width, footprintHeight: footprint.height,
    };
    monsters.push(monster);
    tiles[tile.y * config.width + tile.x]!.monsterId = monster.id;
  }

  const artifacts: Artifact[] = [];
  const artifactCount = Math.max(8, Math.round(config.settlementCount * config.artifactDensity * .65));
  const depictions = ['коронованный всадник под семью звёздами', 'падение красного дракона', 'эльфийская королева сажает первое серебряное дерево', 'оркские кланы переходят замёрзшую реку', 'безымянный святой закрывает чёрные врата', 'три луны над горящим флотом'];
  for (let index = 0; index < artifactCount; index += 1) {
    const creator = rng.pick(characters.filter(character => character.age >= 16));
    const owner = rng.pick(characters.filter(character => character.age >= 16));
    const artifact: Artifact = {
      id: index + 1, name: `${rng.pick(['Корона', 'Клинок', 'Чаша', 'Знамя', 'Маска', 'Кольцо', 'Рог', 'Щит'])} ${placeName(rng)}`,
      type: rng.pick(['оружие', 'регалия', 'ритуальный предмет', 'драгоценность', 'доспех', 'инструмент']),
      material: rng.pick(['серебро', 'чёрное железо', 'золото', 'драконья кость', 'лунный камень', 'бронза', 'тис']),
      creatorId: creator.id, ownerId: owner.id, settlementId: creator.settlementId, yearCreated: rng.int(Math.max(1, creator.birthYear), config.historyYears), power: rng.int(0, Math.round(config.magic * 22)), depiction: rng.pick(depictions),
      ownerHistory: [{ year: config.historyYears, characterId: owner.id, settlementId: owner.settlementId, reason: 'последний известный переход права владения' }],
      history: [`Создан мастером ${creator.name}.`, `Сейчас принадлежит ${owner.name}.`],
    };
    artifacts.push(artifact);
    creator.artifactIds.push(artifact.id);
    owner.artifactIds.push(artifact.id);
    if (rng.chance(.38)) rng.pick(dungeons).artifactIds.push(artifact.id);
  }

  const books: Book[] = [];
  const subjects = ['история династий', 'драконы', 'травничество', 'древние машины', 'богословие', 'военное дело', 'далёкие острова', 'чудовища', 'ремесло', 'поэзия'];
  for (let index = 0; index < Math.max(10, Math.round(config.settlementCount * .75)); index += 1) {
    const author = rng.pick(characters.filter(character => character.age >= 20));
    const subject = rng.pick(subjects);
    const book: Book = {
      id: index + 1, title: `${rng.pick(['О', 'Хроника:', 'Скрытая правда:', 'Песни о', 'Наблюдения о'])} ${subject}`,
      authorId: author.id, yearWritten: rng.int(Math.max(1, config.historyYears - author.age), config.historyYears), language: kingdoms.find(kingdom => kingdom.id === author.kingdomId)!.culture,
      subject, reliability: rng.int(25, 98), bias: rng.pick(['лояльность правящему дому', 'враждебность соседнему народу', 'религиозное толкование', 'сухое наблюдение', 'личная месть автора']),
      summary: `Труд о теме «${subject}», основанный на опыте автора в ${settlements.find(settlement => settlement.id === author.settlementId)!.name}.`, copies: rng.int(1, 45), settlementId: author.settlementId, referencedEventIds: [],
    };
    books.push(book);
    author.bookIds.push(book.id);
    author.biography.push(`Написал книгу «${book.title}».`);
  }

  const animalPopulations = generateAnimalPopulations(config.seed, tiles, config.ecologyDensity);
  const ingredients = generateNaturalIngredients(config.seed, tiles, config.ecologyDensity);
  const alchemyRecipes = generateAlchemyRecipes({ ingredients, characters, year: config.historyYears }, rng);
  report('Экология, промыслы и алхимия', 76, `${animalPopulations.length.toLocaleString('ru-RU')} популяций`);

  const events: WorldEvent[] = [];
  let eventId = 1;
  for (const settlement of settlements) events.push(event(eventId++, settlement.foundedYear, rng.int(1, 12), 'settlement', `Основан ${settlement.name}`, `${settlement.name} возник под властью государства ${kingdoms.find(kingdom => kingdom.id === settlement.kingdomId)!.name}.`, 'удобное место, ресурс и защита', [`появилось поселение`, `началась эксплуатация ресурса «${settlement.resource}»`], [{ kind: 'settlement', id: settlement.id }, { kind: 'kingdom', id: settlement.kingdomId }], 3));
  for (const dynasty of dynasties) events.push(event(eventId++, rng.int(1, config.historyYears), rng.int(1, 12), 'dynasty', `Возвысился ${dynasty.name}`, `Род получил землю, богатство и место при дворе.`, 'служба правителю и накопленное влияние', ['род получил политический вес', 'появились наследственные притязания'], [{ kind: 'dynasty', id: dynasty.id }, ...(dynasty.kingdomId ? [{ kind: 'kingdom' as const, id: dynasty.kingdomId }] : [])], 3));
  for (const route of tradeRoutes.slice(0, 60)) events.push(event(eventId++, rng.int(Math.max(1, config.historyYears - 140), config.historyYears), rng.int(1, 12), 'trade', `Открыт путь ${route.name}`, `Караваны начали перевозить ${route.goods.join(' и ')}.`, 'спрос поселений на чужие ресурсы', ['выросли рынки', 'дорога стала целью разбойников и сборщиков пошлин'], [{ kind: 'tradeRoute', id: route.id }, { kind: 'settlement', id: route.fromSettlementId }, { kind: 'settlement', id: route.toSettlementId }], 2));
  for (const population of animalPopulations.filter(item => item.count >= item.carryingCapacity * .72).slice(0, 32)) events.push(event(
    eventId++, rng.int(Math.max(1, config.historyYears - 90), config.historyYears), rng.int(1, 12), 'ecology',
    `Расширился ареал: ${population.species}`, `${population.count} животных заняли устойчивую территорию в клетке ${population.x}:${population.y}.`,
    'подходящий биом, доступная пища и умеренное давление хищников', ['появились новые охотничьи угодья', 'изменилась пищевая цепочка'],
    [{ kind: 'animalPopulation', id: population.id }], 2,
  ));
  for (const recipe of alchemyRecipes.slice(0, 18)) events.push(event(
    eventId++, recipe.discoveryYear, rng.int(1, 12), 'alchemy', `Открыт рецепт «${recipe.name}»`, `${recipe.source} привели к воспроизводимому составу.`,
    'доступ к нужным ингредиентам и серия опытов', ['появилось новое алхимическое знание', 'сырьё получило практическую ценность'],
    [{ kind: 'recipe', id: recipe.id }, ...(recipe.discoveredById ? [{ kind: 'character' as const, id: recipe.discoveredById }] : [])], 2,
  ));

  const wars: War[] = [];
  const pastWarCount = Math.max(1, Math.round(config.kingdomCount * config.warlike * 1.5));
  for (let index = 0; index < pastWarCount; index += 1) {
    const attacker = rng.pick(kingdoms);
    const defenders = kingdoms.filter(kingdom => kingdom.id !== attacker.id && settlements.some(settlement => settlement.kingdomId === kingdom.id));
    if (!defenders.length) continue;
    const defender = rng.pick(defenders);
    const defendedSettlements = settlements.filter(settlement => settlement.kingdomId === defender.id);
    if (!defendedSettlements.length) continue;
    const contested = rng.pick(defendedSettlements);
    const startYear = rng.int(Math.max(2, config.historyYears - 180), Math.max(3, config.historyYears - 4));
    const victor = rng.chance((attacker.armyStrength + attacker.aggression) / (attacker.armyStrength + defender.armyStrength + attacker.aggression + defender.stability)) ? attacker : defender;
    const cause = rng.pick(['спорная пограничная крепость', 'неуплаченные торговые пошлины', 'династические притязания', 'набеги на приграничные деревни', 'контроль над железными рудниками', 'убийство королевского посланника']);
    const war: War = {
      id: wars.length + 1, name: `Война ${attacker.name} и ${defender.name}`, attackerId: attacker.id, defenderId: defender.id, startYear, endYear: startYear + rng.int(1, 8), active: false,
      cause, goal: cause.includes('династические') ? `признать права дома ${dynasties.find(dynasty => dynasty.id === attacker.dynastyId)?.name ?? attacker.name}` : `получить контроль над ${contested.name}`,
      contestedSettlementIds: [contested.id], battles: rng.int(1, 7), attackerLosses: rng.int(40, 520), defenderLosses: rng.int(35, 500), victorId: victor.id,
      peaceTerms: victor.id === attacker.id ? `${contested.name} перешёл под власть государства ${attacker.name}` : `${attacker.name} отказалось от притязаний и выплатило серебро`,
      history: [],
    };
    war.history.push(`Война началась из-за причины: ${cause}.`, `Мир завершился условиями: ${war.peaceTerms}.`);
    wars.push(war);
    if (victor.id === attacker.id) {
      const oldKingdomId = contested.kingdomId;
      contested.kingdomId = attacker.id;
      contested.history.push(`После войны ${startYear} года поселение перешло от государства ${kingdoms.find(item => item.id === oldKingdomId)?.name} к государству ${attacker.name}.`);
      characters.filter(character => character.settlementId === contested.id).forEach(character => { character.kingdomId = attacker.id; });
      tiles.filter(tile => tile.settlementId === contested.id).forEach(tile => { tile.kingdomId = attacker.id; });
    }
    events.push(event(eventId++, startYear, rng.int(1, 12), 'war', `Началась ${war.name}`, `${attacker.name} собрало войско против государства ${defender.name}.`, cause, [`армии направились к ${contested.name}`, 'торговые пути стали опаснее'], [{ kind: 'war', id: war.id }, { kind: 'kingdom', id: attacker.id }, { kind: 'kingdom', id: defender.id }, { kind: 'settlement', id: contested.id }], 4));
    events.push(event(eventId++, war.endYear!, rng.int(1, 12), 'battle', `Завершилась ${war.name}`, war.peaceTerms!, 'истощение армий и исход сражений', [war.peaceTerms!], [{ kind: 'war', id: war.id }, { kind: 'kingdom', id: victor.id }, { kind: 'settlement', id: contested.id }], 4));
  }

  for (const monster of monsters.filter(item => item.tier === 'boss' || item.species === 'dragon').slice(0, 16)) {
    const target = [...settlements].sort((a, b) => distance(monster, a) - distance(monster, b))[0]!;
    if (rng.chance(.55)) {
      const year = rng.int(Math.max(1, config.historyYears - 90), config.historyYears);
      monster.history.push(`В ${year} году разорил земли у ${target.name}.`);
      target.history.push(`В ${year} году поселение пережило нападение существа ${monster.name}.`);
      events.push(event(eventId++, year, rng.int(1, 12), monster.species === 'dragon' ? 'dragon' : 'monster', `${monster.name} напал на ${target.name}`, `Существо уничтожило припасы и заставило жителей искать защиту.`, `голод и расширение территории существа`, ['поселение потеряло запасы', 'правитель назначил награду'], [{ kind: 'monster', id: monster.id }, { kind: 'settlement', id: target.id }, { kind: 'kingdom', id: target.kingdomId }], monster.species === 'dragon' ? 5 : 3));
    }
  }

  events.sort((a, b) => a.year - b.year || a.month - b.month || a.id - b.id);
  for (const book of books) {
    const candidates = events.filter(item => item.year <= book.yearWritten && item.entityRefs.some(ref => ref.kind === 'settlement' && ref.id === book.settlementId));
    const referenceCount = rng.int(0, Math.min(4, candidates.length));
    book.referencedEventIds = referenceCount > 0 ? candidates.slice(-referenceCount).map(item => item.id) : [];
  }

  report('Связывание причин и проверка мира', 94, `${events.length.toLocaleString('ru-RU')} исторических событий`);
  const world: WorldState = {
    version: 32, language: 'ru', appVersion: APP_VERSION, config, name: `Мир ${placeName(rng)}`, year: config.historyYears, month: 1,
    tiles, kingdoms, settlements, settlementExpeditions: [], politicalCommunities: [], politicalTransitions: [], characters, relationships, dynasties, armies, battleRecords: [], militaryUnits: [], supplyWagons: [], armyCamps: [], armyCampStructures: [], armyLocalPositions: [], monsters, cemeteries: [], burials: [], animalPopulations, ingredients, alchemyRecipes, artifacts, books, dungeons, wars, tradeRoutes, buildings: [], households: [], establishments: [], fields: [], constructionProjects: [], items: [], productionRecipes: [], employments: [], shipments: [], travelingMerchants: [], marketTransactions: [], knowledgeFacts: [], memories: [], rumors: [], messages: [], settlementKnowledge: [], settlementTechnologyKnowledge: [], technologyTransmissions: [], cultures: [], civilizations: [], languages: [], religions: [], settlementCultures: [], settlementGovernments: [], districtCivicStates: [], cityStates: [], urbanStates: [], civicPatrols: [], crimes: [], courtCases: [], fireIncidents: [], kingdomGovernments: [], nobleTitles: [], vassalContracts: [], courtOffices: [], courtFactions: [], royalOrders: [], stateCrises: [], diplomaticAgreements: [], socialObligations: [], healthConditions: [], pregnancies: [], epidemics: [], decisions: [], stateDeltas: [], territoryHistory: [], events, localMapChanges: [],
    simulation: createSimulationRuntime({ year: config.historyYears, month: 1 }),
    history: { engineVersion: 1, generatedYears: config.historyYears, eras: [], landmarkEventIds: [], fallenRealms: [], compressedEventCount: 0, logicWarnings: [] },
    nextIds: { kingdom: kingdoms.length + 1, settlement: settlements.length + 1, settlementExpedition: 1, politicalCommunity: 1, politicalTransition: 1, civilization: 1, army: armies.length + 1, event: eventId, character: characterId, relationship: relationships.length + 1, dynasty: dynasties.length + 1, tradeRoute: tradeRoutes.length + 1, war: wars.length + 1, artifact: artifacts.length + 1, book: books.length + 1, animalPopulation: animalPopulations.length + 1, ingredient: ingredients.length + 1, recipe: alchemyRecipes.length + 1, building: 1, household: 1, establishment: 1, item: 1, productionRecipe: 1, employment: 1, shipment: 1, travelingMerchant: 1, marketTransaction: 1, knowledgeFact: 1, memory: 1, rumor: 1, message: 1, settlementTechnologyKnowledge: 1, technologyTransmission: 1, settlementGovernment: 1, districtCivic: 1, patrol: 1, crime: 1, courtCase: 1, fireIncident: 1, militaryUnit: 1, supplyWagon: 1, field: 1, constructionProject: 1, territoryChange: 1, cemetery: 1, burial: 1, socialObligation: 1, healthCondition: 1, pregnancy: 1, epidemic: 1, battleRecord: 1, decision: 1, stateDelta: 1 },
  };
  report('Мир готов', 100);
  return world;
}

export const defaultConfig: WorldConfig = {
  seed: 'Eldervale-Первая-Эпоха', width: 54, height: 34, historyYears: 320, kingdomCount: 7,
  settlementCount: 30, populationScale: .72, magic: .38, warlike: .48, monsterDensity: 1, artifactDensity: 1, localMapSize: 128, ecologyDensity: 1, huntingPressure: 1,
};
