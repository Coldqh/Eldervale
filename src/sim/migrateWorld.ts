import type { Dynasty, Relationship, TradeRoute, WorldState } from '../types';
import { localizeLegacyWorld } from './localizeLegacy';
import { APP_VERSION } from '../version';
import { RNG } from './rng';
import { normalizeEventCausality } from './causality';
import { generateAlchemyRecipes, generateAnimalPopulations, generateNaturalIngredients } from './ecology';
import { createHousingProfile } from './settlements';
import { createSimulationRuntime, ensureSimulationRuntime } from './scheduler';

export function migrateWorld(input: unknown): WorldState {
  const raw = structuredClone(input) as any;
  if (!raw || !Array.isArray(raw.tiles) || !Array.isArray(raw.characters)) throw new Error('Неверный формат сохранения');
  const localized = localizeLegacyWorld(raw as WorldState) as any;
  const rng = new RNG(`${localized.config?.seed ?? 'Eldervale'}:переход-на-схему-6`);
  const previousLocalSize = localized.config?.localMapSize ?? 48;

  localized.version = 6;
  localized.language = 'ru';
  localized.appVersion = APP_VERSION;
  localized.config ??= {};
  localized.config.localMapSize = [96, 128, 160].includes(localized.config.localMapSize) ? localized.config.localMapSize : 128;
  localized.config.ecologyDensity ??= 1;
  localized.config.huntingPressure ??= 1;
  localized.relationships ??= [];
  localized.dynasties ??= [];
  localized.tradeRoutes ??= [];
  localized.wars ??= [];
  localized.events ??= [];
  localized.localMapChanges ??= [];
  localized.nextIds ??= {};
  localized.simulation ??= createSimulationRuntime({ year: localized.year ?? localized.config.historyYears ?? 1, month: localized.month ?? 1 });
  localized.history ??= {
    engineVersion: 1, generatedYears: localized.config.historyYears ?? localized.year ?? 1, eras: [],
    landmarkEventIds: [], fallenRealms: [], compressedEventCount: 0, logicWarnings: [],
  };
  localized.history.engineVersion = 1;
  localized.history.generatedYears ??= localized.config.historyYears ?? localized.year ?? 1;
  localized.history.eras ??= [];
  localized.history.landmarkEventIds ??= [...localized.events].sort((a: any, b: any) => (b.importance ?? 0) - (a.importance ?? 0)).slice(0, 32).map((event: any) => event.id);
  localized.history.fallenRealms ??= [];
  localized.history.compressedEventCount ??= 0;
  localized.history.logicWarnings ??= [];

  if (previousLocalSize !== localized.config.localMapSize) {
    const ratio = localized.config.localMapSize / Math.max(1, previousLocalSize);
    for (const effect of localized.localMapChanges) {
      effect.localX = Math.max(1, Math.min(localized.config.localMapSize - 2, Math.round(effect.localX * ratio)));
      effect.localY = Math.max(1, Math.min(localized.config.localMapSize - 2, Math.round(effect.localY * ratio)));
    }
  }

  for (const kingdom of localized.kingdoms) {
    kingdom.claims ??= [];
    kingdom.diplomacy ??= [];
    kingdom.laws ??= ['королевский мир на дорогах', 'налог с рынков', 'воинская повинность'];
  }
  for (const settlement of localized.settlements) {
    settlement.resource ??= resourceForTerrain(localized, settlement.x, settlement.y, rng);
    settlement.shortages ??= [];
    settlement.tradeRouteIds ??= [];
    settlement.unrest ??= 0;
    settlement.history ??= [`${settlement.name} существует с ${settlement.foundedYear} года.`];
    if (!settlement.buildingCounts || !settlement.residentialCapacity || !settlement.households) {
      const housing = createHousingProfile(settlement.population, settlement.type, rng);
      settlement.buildingCounts = housing.buildingCounts;
      settlement.residentialCapacity = housing.residentialCapacity;
      settlement.households = housing.households;
      settlement.buildings = housing.buildings;
    }
    settlement.districts ??= [{ x: settlement.x, y: settlement.y, name: 'Сердце поселения', role: settlement.type === 'fortress' ? 'крепость' : 'центр' }];
    settlement.stockpile ??= { [settlement.resource]: 30, зерно: Math.max(12, Math.round(settlement.food / 2)), древесина: 25, камень: 12 };
    settlement.livestock ??= { куры: Math.round(settlement.population / 8), козы: Math.round(settlement.population / 18), лошади: Math.round(settlement.population / 45) };
    for (const district of settlement.districts) {
      const tile = localized.tiles.find((item: any) => item.x === district.x && item.y === district.y);
      if (tile) { tile.settlementId = settlement.id; tile.settlementDistrict = district.name; }
    }
  }
  for (const character of localized.characters) {
    character.wealth ??= character.age < 14 ? 0 : rng.int(0, 140);
    character.loyalty ??= rng.int(30, 90);
    character.relationshipIds ??= [];
    character.injuries ??= [];
    character.workplace ??= workplaceFor(character.profession);
    const settlement = localized.settlements.find((item: any) => item.id === character.settlementId);
    character.homeDistrict ??= settlement?.districts?.[0]?.name ?? 'Сердце поселения';
  }
  for (const army of localized.armies) {
    army.supplies ??= 70;
    army.campaignHistory ??= [];
  }
  for (const monster of localized.monsters) {
    monster.hunger ??= rng.int(20, 65);
    monster.territoryRadius ??= monster.species === 'dragon' ? 7 : 4;
    monster.behavior ??= monster.species === 'dragon' ? 'охраняет логово и собирает сокровища' : 'охотится в своей области';
    monster.goal ??= monster.species === 'dragon' ? 'расширить сокровищницу' : 'найти безопасное логово';
  }
  for (const artifact of localized.artifacts) artifact.ownerHistory ??= [{ year: artifact.yearCreated, characterId: artifact.ownerId, settlementId: artifact.settlementId, reason: 'первый известный владелец' }];
  for (const book of localized.books) { book.bias ??= 'личный взгляд автора'; book.referencedEventIds ??= []; }
  for (const dungeon of localized.dungeons) { dungeon.purpose ??= dungeon.origin; dungeon.discovered ??= true; }
  for (const war of localized.wars) { war.goal ??= 'добиться уступок'; war.contestedSettlementIds ??= []; war.history ??= []; }
  localized.events = localized.events.map(normalizeEventCausality);

  localized.animalPopulations ??= generateAnimalPopulations(localized.config.seed, localized.tiles, localized.config.ecologyDensity);
  localized.ingredients ??= generateNaturalIngredients(localized.config.seed, localized.tiles, localized.config.ecologyDensity);
  localized.alchemyRecipes ??= generateAlchemyRecipes({ ingredients: localized.ingredients, characters: localized.characters, year: localized.year }, rng);

  backfillRelationships(localized, rng);
  backfillDynasties(localized, rng);
  backfillTradeRoutes(localized, rng);
  backfillDiplomacy(localized, rng);

  localized.nextIds.relationship = Math.max(0, ...localized.relationships.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.dynasty = Math.max(0, ...localized.dynasties.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.tradeRoute = Math.max(0, ...localized.tradeRoutes.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.event ??= Math.max(0, ...localized.events.map((event: any) => event.id ?? 0)) + 1;
  localized.nextIds.character ??= Math.max(0, ...localized.characters.map((character: any) => character.id ?? 0)) + 1;
  localized.nextIds.war ??= Math.max(0, ...localized.wars.map((war: any) => war.id ?? 0)) + 1;
  localized.nextIds.artifact ??= Math.max(0, ...localized.artifacts.map((artifact: any) => artifact.id ?? 0)) + 1;
  localized.nextIds.book ??= Math.max(0, ...localized.books.map((book: any) => book.id ?? 0)) + 1;
  localized.nextIds.animalPopulation = Math.max(0, ...localized.animalPopulations.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.ingredient = Math.max(0, ...localized.ingredients.map((item: any) => item.id ?? 0)) + 1;
  localized.nextIds.recipe = Math.max(0, ...localized.alchemyRecipes.map((item: any) => item.id ?? 0)) + 1;

  ensureSimulationRuntime(localized as WorldState);

  return localized as WorldState;
}

function workplaceFor(profession: string): string {
  const map: Record<string, string> = {
    child: 'дом семьи', farmer: 'поля и пастбища', miller: 'мельница', hunter: 'охотничьи угодья', guard: 'стража и ворота',
    blacksmith: 'кузница', carpenter: 'плотницкая мастерская', herbalist: 'травницкая мастерская', merchant: 'рынок', scribe: 'архив или канцелярия',
    priest: 'храм', soldier: 'казармы', fisher: 'берег или пристань', miner: 'шахта', weaver: 'ткацкая мастерская', brewer: 'пивоварня', healer: 'лечебница',
  };
  return map[profession] ?? 'местные работы';
}

function resourceForTerrain(world: any, x: number, y: number, rng: RNG): string {
  const terrain = world.tiles.find((tile: any) => tile.x === x && tile.y === y)?.terrain;
  const resources: Record<string, string[]> = {
    coast: ['рыба', 'соль'], plains: ['зерно', 'лён'], forest: ['древесина', 'мёд'], hills: ['камень', 'железо'],
    mountains: ['железо', 'серебро'], marsh: ['торф', 'тростник'], desert: ['соль', 'пряности'], tundra: ['меха', 'рыба'],
  };
  return rng.pick(resources[terrain] ?? ['зерно']);
}

function backfillRelationships(world: any, rng: RNG): void {
  if (world.relationships.length) return;
  const relationships: Relationship[] = [];
  let id = 1;
  const add = (characterAId: number, characterBId: number, kind: Relationship['kind'], strength: number, reason: string) => {
    if (characterAId === characterBId || relationships.some(item => (item.characterAId === characterAId && item.characterBId === characterBId) || (item.characterAId === characterBId && item.characterBId === characterAId))) return;
    const relation: Relationship = { id: id++, characterAId, characterBId, kind, strength, sinceYear: Math.max(1, world.year - rng.int(1, 40)), public: true, reason };
    relationships.push(relation);
    world.characters.find((item: any) => item.id === characterAId)?.relationshipIds.push(relation.id);
    world.characters.find((item: any) => item.id === characterBId)?.relationshipIds.push(relation.id);
  };
  for (const character of world.characters) {
    for (const parentId of character.parentIds ?? []) add(parentId, character.id, 'родство', rng.int(60, 100), 'родитель и ребёнок');
    if (character.spouseId && character.id < character.spouseId) add(character.id, character.spouseId, 'любовь', rng.int(45, 92), 'супружество');
  }
  world.relationships = relationships;
}

function backfillDynasties(world: any, rng: RNG): void {
  if (world.dynasties.length) return;
  const dynasties: Dynasty[] = [];
  for (const kingdom of world.kingdoms) {
    const ruler = world.characters.find((item: any) => item.id === kingdom.rulerId);
    if (!ruler) continue;
    const members = new Set<number>([ruler.id, ...(ruler.parentIds ?? []), ...(ruler.childIds ?? [])]);
    if (ruler.spouseId) members.add(ruler.spouseId);
    const dynasty: Dynasty = {
      id: dynasties.length + 1, name: `Дом ${ruler.name}`, founderId: ruler.parentIds?.[0] ?? ruler.id, currentHeadId: ruler.id,
      memberIds: [...members], kingdomId: kingdom.id, prestige: rng.int(55, 90), wealth: rng.int(500, 2200), claimKingdomIds: [kingdom.id],
      history: [`Дом восстановлен из старых родословных государства ${kingdom.name}.`],
    };
    dynasties.push(dynasty);
    kingdom.dynastyId = dynasty.id;
    for (const memberId of dynasty.memberIds) {
      const member = world.characters.find((item: any) => item.id === memberId);
      if (member) member.dynastyId = dynasty.id;
    }
  }
  world.dynasties = dynasties;
}

function backfillTradeRoutes(world: any, rng: RNG): void {
  if (world.tradeRoutes.length) return;
  const routes: TradeRoute[] = [];
  const used = new Set<string>();
  for (const from of world.settlements) {
    const candidates = world.settlements.filter((item: any) => item.id !== from.id).sort((a: any, b: any) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y)).slice(0, 1);
    for (const to of candidates) {
      const key = [from.id, to.id].sort((a, b) => a - b).join(':');
      if (used.has(key)) continue;
      used.add(key);
      const route: TradeRoute = {
        id: routes.length + 1, name: `${from.name} — ${to.name}`, fromSettlementId: from.id, toSettlementId: to.id,
        goods: [...new Set([from.resource, to.resource])], volume: rng.int(18, 70), safety: rng.int(45, 88), active: true,
        controlledByKingdomIds: [...new Set([from.kingdomId, to.kingdomId])], history: ['Путь восстановлен из старых торговых записей.'],
      };
      routes.push(route);
      from.tradeRouteIds.push(route.id);
      to.tradeRouteIds.push(route.id);
    }
  }
  world.tradeRoutes = routes;
}

function backfillDiplomacy(world: any, rng: RNG): void {
  for (const kingdom of world.kingdoms) {
    if (kingdom.diplomacy.length) continue;
    for (const other of world.kingdoms.filter((item: any) => item.id !== kingdom.id)) {
      const score = rng.int(-45, 60);
      kingdom.diplomacy.push({ kingdomId: other.id, score, status: score > 38 ? 'союз' : score < -25 ? 'напряжение' : 'мир', reason: score < 0 ? 'старые споры и пошлины' : 'торговля и общие интересы' });
    }
  }
}
