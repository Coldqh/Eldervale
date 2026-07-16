import type {
  Character, CharacterKnowledgeState, CharacterOpinion, EntityRef, KnowledgeFact, KnowledgeSourceKind,
  Message, PersonalMemory, Rumor, Settlement, SettlementKnowledge, WorldEvent, WorldState,
} from '../types';
import type { WorldIndexes } from './indexes';
import type { DetailedPopulationContext } from './livingEconomy';
import { RNG } from './rng';
import { worldTick } from './scheduler';

const MAX_FACTS = 2600;
const MAX_RUMORS = 1100;
const MAX_MESSAGES = 900;
const MAX_MEMORIES = 3200;
const MAX_CHARACTER_FACTS = 28;
const MAX_CHARACTER_MEMORIES = 14;
const MAX_SETTLEMENT_FACTS = 120;
const MAX_SETTLEMENT_RUMORS = 36;

export interface KnowledgeAdvanceResult {
  confirmedMonsterThreats: { factId: number; monsterId: number; kingdomId: number; settlementId: number }[];
  deliveredMessages: number;
  spreadRumors: number;
}

function pushUniqueLimited(list: number[], value: number, limit: number): void {
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
  list.push(value);
  if (list.length > limit) list.splice(0, list.length - limit);
}

function ensureCollections(world: WorldState): void {
  world.knowledgeFacts ??= [];
  world.memories ??= [];
  world.rumors ??= [];
  world.messages ??= [];
  world.settlementKnowledge ??= [];
  world.nextIds ??= {};
  world.nextIds.knowledgeFact ??= Math.max(0, ...world.knowledgeFacts.map(item => item.id)) + 1;
  world.nextIds.memory ??= Math.max(0, ...world.memories.map(item => item.id)) + 1;
  world.nextIds.rumor ??= Math.max(0, ...world.rumors.map(item => item.id)) + 1;
  world.nextIds.message ??= Math.max(0, ...world.messages.map(item => item.id)) + 1;
}

export function emptyCharacterKnowledge(tick: number): CharacterKnowledgeState {
  return { factIds: [], memoryIds: [], opinions: [], detailed: false, lastGossipTick: tick };
}

export function ensureCharacterKnowledge(character: Character, tick: number): CharacterKnowledgeState {
  character.knowledge ??= emptyCharacterKnowledge(tick);
  character.knowledge.factIds ??= [];
  character.knowledge.memoryIds ??= [];
  character.knowledge.opinions ??= [];
  character.knowledge.detailed ??= false;
  character.knowledge.lastGossipTick ??= tick;
  return character.knowledge;
}

function settlementKnowledge(world: WorldState, settlementId: number): SettlementKnowledge {
  let state = world.settlementKnowledge.find(item => item.settlementId === settlementId);
  if (!state) {
    state = { settlementId, factIds: [], verifiedFactIds: [], rumorIds: [], lastUpdatedTick: worldTick(world) };
    world.settlementKnowledge.push(state);
  }
  state.factIds ??= [];
  state.verifiedFactIds ??= [];
  state.rumorIds ??= [];
  return state;
}

function addFactToSettlement(world: WorldState, settlementId: number, factId: number, verified = false): void {
  const state = settlementKnowledge(world, settlementId);
  pushUniqueLimited(state.factIds, factId, MAX_SETTLEMENT_FACTS);
  if (verified) pushUniqueLimited(state.verifiedFactIds, factId, MAX_SETTLEMENT_FACTS);
  state.lastUpdatedTick = worldTick(world);
}

function addFactToCharacter(world: WorldState, character: Character | undefined, factId: number, source: KnowledgeSourceKind, confidence: number, emotionalWeight = 20, privateMemory = false): void {
  if (!character?.alive) return;
  const tick = worldTick(world);
  const knowledge = ensureCharacterKnowledge(character, tick);
  pushUniqueLimited(knowledge.factIds, factId, MAX_CHARACTER_FACTS);
  const existing = world.memories.find(memory => memory.characterId === character.id && memory.factId === factId);
  if (existing) {
    existing.confidence = Math.max(existing.confidence, confidence);
    existing.lastRecalledTick = tick;
    return;
  }
  if (!knowledge.detailed && emotionalWeight < 55 && knowledge.memoryIds.length >= 5) return;
  const fact = world.knowledgeFacts.find(item => item.id === factId);
  const memory: PersonalMemory = {
    id: world.nextIds.memory++, characterId: character.id, factId, eventId: fact?.eventId,
    kind: memoryKind(fact), summary: fact?.statement ?? 'Смутное известие', learnedTick: tick, sourceKind: source,
    confidence: Math.max(1, Math.min(100, confidence)), emotionalWeight: Math.max(0, Math.min(100, emotionalWeight)),
    distortion: source === 'слух' ? Math.max(5, 100 - confidence) : Math.max(0, Math.round((100 - confidence) / 4)),
    private: privateMemory, lastRecalledTick: tick,
  };
  world.memories.push(memory);
  pushUniqueLimited(knowledge.memoryIds, memory.id, MAX_CHARACTER_MEMORIES);
}

function memoryKind(fact?: KnowledgeFact): PersonalMemory['kind'] {
  if (!fact) return 'слух';
  if (fact.topic === 'чудовище') return 'опасность';
  if (fact.topic === 'война') return 'война';
  if (fact.tags.includes('смерть')) return 'потеря';
  if (fact.tags.includes('долг')) return 'долг';
  if (fact.tags.includes('спасение')) return 'спасение';
  if (fact.tags.includes('предательство')) return 'предательство';
  return 'слух';
}

function eventTopic(event: WorldEvent): KnowledgeFact['topic'] {
  if (event.kind === 'monster' || event.kind === 'dragon') return 'чудовище';
  if (event.kind === 'war' || event.kind === 'battle' || event.kind === 'military') return 'война';
  if (event.kind === 'trade' || event.kind === 'market' || event.kind === 'retail') return 'торговля';
  if (event.kind === 'politics' || event.kind === 'dynasty') return 'государство';
  if (event.kind === 'settlement' || event.kind === 'construction' || event.kind === 'agriculture') return 'поселение';
  if (event.kind === 'death' || event.kind === 'birth' || event.kind === 'hero' || event.kind === 'employment' || event.kind === 'equipment') return 'личность';
  return 'событие';
}

function subjectForEvent(event: WorldEvent): EntityRef | undefined {
  const priority: EntityRef['kind'][] = ['monster', 'character', 'war', 'army', 'kingdom', 'settlement', 'tradeRoute', 'artifact', 'book'];
  for (const kind of priority) {
    const ref = event.entityRefs.find(item => item.kind === kind);
    if (ref) return ref;
  }
  return event.entityRefs[0];
}

function settlementForRef(world: WorldState, ref?: EntityRef): Settlement | undefined {
  if (!ref) return undefined;
  if (ref.kind === 'settlement') return world.settlements.find(item => item.id === ref.id);
  if (ref.kind === 'character') {
    const character = world.characters.find(item => item.id === ref.id);
    return character ? world.settlements.find(item => item.id === character.settlementId) : undefined;
  }
  if (ref.kind === 'kingdom') {
    const kingdom = world.kingdoms.find(item => item.id === ref.id);
    return kingdom ? world.settlements.find(item => item.id === kingdom.capitalId) : undefined;
  }
  if (ref.kind === 'army') {
    const army = world.armies.find(item => item.id === ref.id);
    return army ? nearestSettlement(world, army.x, army.y) : undefined;
  }
  if (ref.kind === 'monster') {
    const monster = world.monsters.find(item => item.id === ref.id);
    if (!monster) return undefined;
    return monster.targetSettlementId ? world.settlements.find(item => item.id === monster.targetSettlementId) : nearestSettlement(world, monster.x, monster.y);
  }
  if (ref.kind === 'tradeRoute') {
    const route = world.tradeRoutes.find(item => item.id === ref.id);
    return route ? world.settlements.find(item => item.id === route.fromSettlementId) : undefined;
  }
  return undefined;
}

function originSettlementForEvent(world: WorldState, event: WorldEvent): Settlement | undefined {
  const direct = event.entityRefs.find(item => item.kind === 'settlement');
  if (direct) return world.settlements.find(item => item.id === direct.id);
  for (const ref of event.entityRefs) {
    const result = settlementForRef(world, ref);
    if (result) return result;
  }
  return undefined;
}

function factCoordinates(world: WorldState, subject?: EntityRef, origin?: Settlement): { x?: number; y?: number } {
  if (subject?.kind === 'monster') {
    const monster = world.monsters.find(item => item.id === subject.id);
    if (monster) return { x: monster.x, y: monster.y };
  }
  if (subject?.kind === 'army') {
    const army = world.armies.find(item => item.id === subject.id);
    if (army) return { x: army.x, y: army.y };
  }
  return origin ? { x: origin.x, y: origin.y } : {};
}

function tagsForEvent(event: WorldEvent): string[] {
  const text = `${event.title} ${event.description} ${event.cause}`.toLowerCase();
  const tags: string[] = [event.kind];
  if (text.includes('погиб') || text.includes('умер')) tags.push('смерть');
  if (text.includes('спас') || text.includes('защит')) tags.push('спасение');
  if (text.includes('предал') || text.includes('измен')) tags.push('предательство');
  if (text.includes('долг') || text.includes('заём')) tags.push('долг');
  if (event.kind === 'monster' || event.kind === 'dragon') tags.push('угроза');
  return [...new Set(tags)];
}

function eventFact(world: WorldState, event: WorldEvent): KnowledgeFact {
  const origin = originSettlementForEvent(world, event);
  const subject = subjectForEvent(event);
  const coordinates = factCoordinates(world, subject, origin);
  return {
    id: world.nextIds.knowledgeFact++, topic: eventTopic(event), subjectRef: subject, eventId: event.id,
    statement: `${event.title}. ${event.description}`, canonicalStatement: `${event.title}. ${event.description}`,
    truth: 100, verified: true, importance: event.importance, secrecy: event.kind === 'politics' ? 18 : 0,
    originSettlementId: origin?.id, originCharacterId: event.entityRefs.find(ref => ref.kind === 'character')?.id,
    createdTick: event.year * 12 + event.month - 1, ...coordinates, tags: tagsForEvent(event), history: ['Факт возник из реально произошедшего события.'],
  };
}

function witnessCharacters(world: WorldState, event: WorldEvent, origin?: Settlement): Character[] {
  const ids = new Set(event.entityRefs.filter(ref => ref.kind === 'character').map(ref => ref.id));
  const direct = [...ids].map(id => world.characters.find(item => item.id === id)).filter((item): item is Character => Boolean(item?.alive));
  if (!origin) return direct;
  const locals = world.characters.filter(character => character.alive && character.settlementId === origin.id);
  const preferred = locals.filter(character => ['guard', 'hunter', 'merchant', 'scribe', 'priest', 'soldier'].includes(character.profession) || character.renown >= 40);
  return [...direct, ...preferred.slice(0, Math.max(2, Math.min(7, event.importance + 1)))].filter((item, index, list) => list.findIndex(other => other.id === item.id) === index);
}

function distortText(text: string, rng: RNG, distortion: number): string {
  if (distortion < 8) return text;
  let value = text;
  const substitutions: [RegExp, string][] = [
    [/несколько/gi, 'десятки'], [/ранен/gi, 'едва остался жив'], [/чудовище/gi, 'огромное чудовище'],
    [/нехватка/gi, 'полное исчезновение'], [/часть/gi, 'почти весь'], [/маленьк/gi, 'крупн'],
  ];
  for (const [pattern, replacement] of substitutions) if (rng.chance(Math.min(.6, distortion / 100))) value = value.replace(pattern, replacement);
  if (distortion >= 35 && rng.chance(.45)) value += rng.pick([' Говорят, власти скрывают истинный масштаб.', ' Очевидцы называют другие числа.', ' Некоторые уверены, что это только начало.']);
  return value;
}

function createRumor(world: WorldState, fact: KnowledgeFact, originSettlementId: number, rng: RNG, confidence?: number): Rumor {
  const distortion = Math.max(4, Math.min(70, 10 + rng.int(0, 18) + Math.max(0, 70 - fact.truth) / 3));
  const rumor: Rumor = {
    id: world.nextIds.rumor++, factId: fact.id, text: distortText(fact.statement, rng, distortion),
    originSettlementId, currentSettlementId: originSettlementId, confidence: confidence ?? Math.max(20, Math.min(92, fact.truth - distortion + rng.int(-8, 8))),
    distortion, spreadCount: 0, status: fact.verified ? 'подтверждён' : 'местный', createdTick: worldTick(world), lastSpreadTick: worldTick(world),
    history: [`Возник в поселении ${world.settlements.find(item => item.id === originSettlementId)?.name ?? originSettlementId}.`],
  };
  world.rumors.push(rumor);
  const state = settlementKnowledge(world, originSettlementId);
  pushUniqueLimited(state.rumorIds, rumor.id, MAX_SETTLEMENT_RUMORS);
  return rumor;
}

function messageTravelMonths(world: WorldState, fromSettlementId: number, toSettlementId: number): number {
  const from = world.settlements.find(item => item.id === fromSettlementId);
  const to = world.settlements.find(item => item.id === toSettlementId);
  if (!from || !to || from.id === to.id) return 0;
  const distance = Math.hypot(from.x - to.x, from.y - to.y);
  const route = world.tradeRoutes.find(item => (item.fromSettlementId === from.id && item.toSettlementId === to.id) || (item.fromSettlementId === to.id && item.toSettlementId === from.id));
  const routeFactor = route?.active ? Math.max(.6, 1.25 - route.safety / 160) : 1.35;
  return Math.max(1, Math.ceil(distance / 6 * routeFactor));
}

function queueMessage(world: WorldState, data: Omit<Message, 'id' | 'departedTick' | 'arrivalTick' | 'status' | 'history'>): Message | undefined {
  if (!data.knowledgeFactIds.length) return undefined;
  const existing = world.messages.find(message => message.status === 'в пути' && message.fromSettlementId === data.fromSettlementId && message.toSettlementId === data.toSettlementId && data.knowledgeFactIds.some(id => message.knowledgeFactIds.includes(id)));
  if (existing) return existing;
  const tick = worldTick(world);
  const travel = messageTravelMonths(world, data.fromSettlementId, data.toSettlementId);
  const message: Message = {
    id: world.nextIds.message++, ...data, departedTick: tick, arrivalTick: tick + travel,
    status: travel === 0 ? 'доставлено' : 'в пути', history: [travel === 0 ? 'Передано внутри поселения.' : `Отправлено в путь на ${travel} мес.`],
  };
  world.messages.push(message);
  return message;
}

function reportImportantFact(world: WorldState, fact: KnowledgeFact, origin: Settlement, witness?: Character): void {
  const kingdom = world.kingdoms.find(item => item.id === origin.kingdomId);
  const capital = kingdom ? world.settlements.find(item => item.id === kingdom.capitalId) : undefined;
  if (!kingdom || !capital) return;
  const ruler = world.characters.find(item => item.id === kingdom.rulerId);
  const kind: Message['kind'] = fact.topic === 'чудовище' ? 'донесение' : fact.topic === 'война' ? 'военный рапорт' : fact.topic === 'торговля' ? 'торговая весть' : 'письмо';
  const message = queueMessage(world, {
    kind, senderCharacterId: witness?.id, recipientCharacterId: ruler?.id, recipientKingdomId: kingdom.id,
    fromSettlementId: origin.id, toSettlementId: capital.id, knowledgeFactIds: [fact.id], reliability: fact.verified ? 92 : 64, sealed: kind === 'донесение' || kind === 'военный рапорт',
  });
  if (message?.status === 'доставлено') deliverMessage(world, message, new RNG(`${world.config.seed}:мгновенное-донесение:${message.id}`));
}

export function registerWorldEventKnowledge(world: WorldState, event: WorldEvent, options: { historicalSeed?: boolean; createRumor?: boolean } = {}): KnowledgeFact {
  ensureCollections(world);
  const existing = world.knowledgeFacts.find(item => item.eventId === event.id);
  if (existing) return existing;
  const fact = eventFact(world, event);
  world.knowledgeFacts.push(fact);
  const origin = fact.originSettlementId ? world.settlements.find(item => item.id === fact.originSettlementId) : undefined;
  if (origin) addFactToSettlement(world, origin.id, fact.id, fact.verified);
  const witnesses = witnessCharacters(world, event, origin);
  for (const witness of witnesses) addFactToCharacter(world, witness, fact.id, 'свидетель', 96, Math.min(100, 25 + event.importance * 13));
  if (origin && (options.createRumor ?? event.importance >= 2)) createRumor(world, fact, origin.id, new RNG(`${world.config.seed}:слух-события:${event.id}`));
  if (!options.historicalSeed && origin && event.importance >= 3) reportImportantFact(world, fact, origin, witnesses[0]);
  trimKnowledgeCollections(world);
  return fact;
}

function addOpinion(character: Character, opinion: CharacterOpinion): void {
  const knowledge = ensureCharacterKnowledge(character, opinion.updatedTick);
  const existing = knowledge.opinions.find(item => item.target.kind === opinion.target.kind && item.target.id === opinion.target.id);
  if (existing) {
    existing.trust = Math.max(-100, Math.min(100, Math.round((existing.trust + opinion.trust) / 2)));
    existing.fear = Math.max(0, Math.min(100, Math.max(existing.fear, opinion.fear)));
    existing.respect = Math.max(-100, Math.min(100, Math.round((existing.respect + opinion.respect) / 2)));
    existing.affinity = Math.max(-100, Math.min(100, Math.round((existing.affinity + opinion.affinity) / 2)));
    existing.reason = opinion.reason;
    existing.updatedTick = opinion.updatedTick;
  } else {
    knowledge.opinions.push(opinion);
    if (knowledge.opinions.length > 12) knowledge.opinions.splice(0, knowledge.opinions.length - 12);
  }
}

function seedOpinions(world: WorldState): void {
  const tick = worldTick(world);
  const characterById = new Map(world.characters.map(item => [item.id, item]));
  for (const relation of world.relationships) {
    const a = characterById.get(relation.characterAId);
    const b = characterById.get(relation.characterBId);
    if (!a || !b) continue;
    const positive = relation.kind === 'дружба' || relation.kind === 'любовь' || relation.kind === 'верность' || relation.kind === 'родство';
    const negative = relation.kind === 'ненависть' || relation.kind === 'соперничество';
    const fear = relation.kind === 'страх' ? relation.strength : 0;
    for (const [source, target] of [[a, b], [b, a]] as const) addOpinion(source, {
      target: { kind: 'character', id: target.id }, trust: positive ? relation.strength : negative ? -relation.strength : 0,
      fear, respect: relation.kind === 'верность' ? relation.strength : relation.kind === 'соперничество' ? Math.round(relation.strength / 3) : 0,
      affinity: positive ? relation.strength : negative ? -relation.strength : 0, reason: relation.reason, updatedTick: tick,
    });
  }
}

function seedRouteKnowledge(world: WorldState, rng: RNG): void {
  for (const route of world.tradeRoutes) {
    if (world.knowledgeFacts.some(fact => fact.topic === 'дорога' && fact.subjectRef?.kind === 'tradeRoute' && fact.subjectRef.id === route.id)) continue;
    const fact: KnowledgeFact = {
      id: world.nextIds.knowledgeFact++, topic: 'дорога', subjectRef: { kind: 'tradeRoute', id: route.id },
      statement: `Путь ${route.name} связывает два поселения и перевозит ${route.goods.join(', ')}.`, canonicalStatement: `Путь ${route.name} существует.`,
      truth: 100, verified: true, importance: 2, secrecy: 0, originSettlementId: route.fromSettlementId, createdTick: worldTick(world),
      tags: ['карта', 'дорога', 'торговля'], history: ['Сведения известны торговцам и дорожным службам.'],
    };
    world.knowledgeFacts.push(fact);
    addFactToSettlement(world, route.fromSettlementId, fact.id, true);
    addFactToSettlement(world, route.toSettlementId, fact.id, true);
    const merchants = world.characters.filter(character => character.alive && ['merchant', 'guard', 'scribe'].includes(character.profession) && [route.fromSettlementId, route.toSettlementId].includes(character.settlementId)).slice(0, 8);
    merchants.forEach(character => addFactToCharacter(world, character, fact.id, 'личный опыт', rng.int(78, 100), 20));
  }
}

function seedMonsterLore(world: WorldState, rng: RNG): void {
  const lore: Record<string, string[]> = {
    dragon: ['дракон уязвим во время сна после долгого полёта', 'глаза и перепонки крыльев защищены хуже чешуи'],
    troll: ['огонь мешает троллю восстанавливать раны'], ogre: ['огр плохо защищает ноги и быстро устаёт'],
    'giant serpent': ['гигантская змея теряет подвижность на холодном камне'],
  };
  const loreCandidates = world.characters.filter(character => character.alive && ['hunter', 'scribe', 'soldier', 'herbalist'].includes(character.profession));
  const settlementById = new Map(world.settlements.map(settlement => [settlement.id, settlement]));
  for (const monster of world.monsters.filter(item => item.alive && (item.tier !== 'common' || rng.chance(.18)))) {
    const statements = lore[monster.species] ?? ['следы и поведение существа позволяют опытному охотнику подготовиться к встрече'];
    const fact: KnowledgeFact = {
      id: world.nextIds.knowledgeFact++, topic: 'чудовище', subjectRef: { kind: 'monster', id: monster.id },
      statement: rng.pick(statements), canonicalStatement: rng.pick(statements), truth: rng.int(58, 96), verified: false,
      importance: monster.tier === 'boss' ? 4 : monster.tier === 'miniboss' ? 3 : 2, secrecy: rng.int(8, 42),
      originSettlementId: nearestSettlement(world, monster.x, monster.y)?.id, createdTick: worldTick(world), x: monster.x, y: monster.y,
      tags: ['слабость', 'охотничье знание'], history: ['Сведения собраны охотниками, выжившими и старыми книгами.'],
    };
    world.knowledgeFacts.push(fact);
    const targetCount = rng.int(1, 4);
    const nearest: { character: Character; distance: number }[] = [];
    for (const character of loreCandidates) {
      const settlement = settlementById.get(character.settlementId);
      const distance = Math.hypot((settlement?.x ?? 0) - monster.x, (settlement?.y ?? 0) - monster.y);
      if (nearest.length < targetCount) {
        nearest.push({ character, distance });
        nearest.sort((a, b) => a.distance - b.distance);
      } else if (distance < nearest[nearest.length - 1]!.distance) {
        nearest[nearest.length - 1] = { character, distance };
        nearest.sort((a, b) => a.distance - b.distance);
      }
    }
    nearest.forEach(({ character }) => addFactToCharacter(world, character, fact.id, rng.chance(.45) ? 'книга' : 'личный опыт', rng.int(52, 88), 42, true));
  }
}

export function initializeKnowledgeSystem(world: WorldState, rng: RNG): void {
  ensureCollections(world);
  const tick = worldTick(world);
  if (world.simulation.knowledgeSystemVersion === 1 && world.settlementKnowledge.length === world.settlements.length) {
    for (const character of world.characters) ensureCharacterKnowledge(character, tick);
    return;
  }
  world.settlementKnowledge = world.settlements.map(settlement => ({ settlementId: settlement.id, factIds: [], verifiedFactIds: [], rumorIds: [], lastUpdatedTick: tick }));
  for (const character of world.characters) {
    const knowledge = ensureCharacterKnowledge(character, tick);
    knowledge.detailed = character.renown >= 45 || character.titles.length > 0 || ['merchant', 'scribe', 'priest', 'guard', 'soldier', 'hunter'].includes(character.profession);
  }
  const selectedEvents = [...world.events]
    .filter(event => event.importance >= 3 || event.year >= world.year - 80)
    .sort((a, b) => b.importance - a.importance || b.year - a.year || b.id - a.id)
    .slice(0, 1200)
    .reverse();
  for (const event of selectedEvents) registerWorldEventKnowledge(world, event, { historicalSeed: true, createRumor: event.year >= world.year - 20 && event.importance >= 3 });
  seedRouteKnowledge(world, rng);
  seedMonsterLore(world, rng);
  seedOpinions(world);
  for (const kingdom of world.kingdoms) {
    const ruler = world.characters.find(character => character.id === kingdom.rulerId);
    const capitalState = settlementKnowledge(world, kingdom.capitalId);
    for (const factId of capitalState.verifiedFactIds.slice(-20)) addFactToCharacter(world, ruler, factId, 'чиновник', 95, 30);
  }
  for (const book of world.books) {
    const author = world.characters.find(character => character.id === book.authorId);
    for (const eventId of book.referencedEventIds.slice(-6)) {
      const fact = world.knowledgeFacts.find(item => item.eventId === eventId);
      if (!fact) continue;
      addFactToCharacter(world, author, fact.id, 'книга', book.reliability, 32);
      addFactToSettlement(world, book.settlementId, fact.id, book.reliability >= 80);
    }
  }
  world.simulation.knowledgeSystemVersion = 1;
  trimKnowledgeCollections(world);
}

function deliverMessage(world: WorldState, message: Message, rng: RNG): void {
  if (message.status === 'доставлено' && message.history.some(item => item.startsWith('Доставлено'))) return;
  const route = world.tradeRoutes.find(item => (item.fromSettlementId === message.fromSettlementId && item.toSettlementId === message.toSettlementId) || (item.fromSettlementId === message.toSettlementId && item.toSettlementId === message.fromSettlementId));
  const danger = route ? Math.max(0, 45 - route.safety) / 160 : .06;
  if (message.arrivalTick > message.departedTick && rng.chance(danger)) {
    message.status = rng.chance(.35) ? 'перехвачено' : 'утрачено';
    message.history.push(message.status === 'перехвачено' ? 'Послание перехвачено на дороге.' : 'Послание исчезло в пути.');
    if (message.status === 'перехвачено') {
      for (const factId of message.knowledgeFactIds) {
        const fact = world.knowledgeFacts.find(item => item.id === factId);
        if (fact) createRumor(world, fact, message.fromSettlementId, rng, Math.max(20, message.reliability - 30));
      }
    }
    return;
  }
  message.status = 'доставлено';
  message.history.push(`Доставлено в ${world.year}.${String(world.month).padStart(2, '0')}.`);
  const recipient = message.recipientCharacterId ? world.characters.find(item => item.id === message.recipientCharacterId) : message.recipientKingdomId ? world.characters.find(item => item.id === world.kingdoms.find(kingdom => kingdom.id === message.recipientKingdomId)?.rulerId) : undefined;
  for (const factId of message.knowledgeFactIds) {
    addFactToSettlement(world, message.toSettlementId, factId, message.reliability >= 75);
    addFactToCharacter(world, recipient, factId, message.kind === 'королевский указ' ? 'указ' : message.kind === 'военный рапорт' ? 'донесение' : message.kind === 'торговая весть' ? 'торговец' : 'письмо', message.reliability, 48, message.sealed);
    const fact = world.knowledgeFacts.find(item => item.id === factId);
    if (fact) fact.history.push(`Сведения доставлены в ${world.settlements.find(item => item.id === message.toSettlementId)?.name ?? message.toSettlementId}.`);
  }
}

function spreadSettlementRumors(world: WorldState, settlement: Settlement, rng: RNG, detailed: DetailedPopulationContext): number {
  const state = settlementKnowledge(world, settlement.id);
  const tick = worldTick(world);
  const rumorPool = state.rumorIds.map(id => world.rumors.find(item => item.id === id)).filter((item): item is Rumor => Boolean(item && item.status !== 'затих' && item.status !== 'опровергнут'));
  const factPool = state.factIds.map(id => world.knowledgeFacts.find(item => item.id === id)).filter((item): item is KnowledgeFact => Boolean(item));
  if (!rumorPool.length && factPool.length && rng.chance(.18)) createRumor(world, rng.pick(factPool), settlement.id, rng);
  const currentPool = state.rumorIds.map(id => world.rumors.find(item => item.id === id)).filter((item): item is Rumor => Boolean(item && item.status !== 'затих' && item.status !== 'опровергнут'));
  if (!currentPool.length) return 0;
  const locals = world.characters.filter(character => character.alive && character.settlementId === settlement.id && (detailed.characterIds.has(character.id) || character.knowledge.detailed || ['merchant', 'priest', 'guard', 'scribe'].includes(character.profession)));
  const attempts = detailed.settlementIds.has(settlement.id) ? Math.min(12, Math.max(2, Math.ceil(locals.length / 25))) : 1;
  let spread = 0;
  for (let index = 0; index < attempts && locals.length; index += 1) {
    const rumor = rng.pick(currentPool);
    const listener = rng.pick(locals);
    if (listener.knowledge.lastGossipTick === tick && rng.chance(.6)) continue;
    rumor.spreadCount += 1;
    rumor.lastSpreadTick = tick;
    rumor.confidence = Math.max(8, Math.min(98, rumor.confidence + rng.int(-8, 5)));
    rumor.distortion = Math.max(0, Math.min(90, rumor.distortion + rng.int(0, 4)));
    addFactToCharacter(world, listener, rumor.factId, 'слух', rumor.confidence, 18 + Math.min(55, rumor.spreadCount), false);
    listener.knowledge.lastGossipTick = tick;
    spread += 1;
  }
  return spread;
}

function merchantCarriesNews(world: WorldState, rng: RNG): void {
  const tick = worldTick(world);
  for (const merchant of world.travelingMerchants) {
    const character = world.characters.find(item => item.id === merchant.characterId);
    if (!character?.alive) continue;
    const state = settlementKnowledge(world, merchant.currentSettlementId);
    if (merchant.status === 'торгует' || merchant.status === 'отдыхает') {
      const candidates = state.factIds.map(id => world.knowledgeFacts.find(item => item.id === id)).filter((item): item is KnowledgeFact => Boolean(item && item.secrecy < 45)).sort((a, b) => b.importance - a.importance || b.createdTick - a.createdTick);
      for (const fact of candidates.slice(0, 3)) addFactToCharacter(world, character, fact.id, 'торговец', rng.int(45, 82), 20);
    }
    if (merchant.nextSettlementId && merchant.status === 'в пути') {
      const known = character.knowledge.factIds.map(id => world.knowledgeFacts.find(item => item.id === id)).filter((item): item is KnowledgeFact => Boolean(item && item.secrecy < 35)).slice(-3);
      for (const fact of known) {
        const existing = world.messages.find(message => message.status === 'в пути' && message.kind === 'торговая весть' && message.senderCharacterId === character.id && message.knowledgeFactIds.includes(fact.id));
        if (existing || rng.chance(.65)) continue;
        queueMessage(world, { kind: 'торговая весть', senderCharacterId: character.id, fromSettlementId: merchant.currentSettlementId, toSettlementId: merchant.nextSettlementId, knowledgeFactIds: [fact.id], reliability: rng.int(45, 78), sealed: false });
      }
    }
    character.knowledge.lastGossipTick = Math.min(character.knowledge.lastGossipTick, tick);
  }
}

function createOfficialReports(world: WorldState): void {
  const currentTick = worldTick(world);
  for (const state of world.settlementKnowledge) {
    const settlement = world.settlements.find(item => item.id === state.settlementId);
    const kingdom = settlement ? world.kingdoms.find(item => item.id === settlement.kingdomId) : undefined;
    const capital = kingdom ? world.settlements.find(item => item.id === kingdom.capitalId) : undefined;
    if (!settlement || !kingdom || !capital || settlement.id === capital.id) continue;
    const candidate = state.verifiedFactIds
      .map(id => world.knowledgeFacts.find(item => item.id === id))
      .filter((item): item is KnowledgeFact => Boolean(item && item.importance >= 4 && item.createdTick >= currentTick - 36 && !item.tags.includes('решение-принято')))
      .sort((a, b) => b.createdTick - a.createdTick)[0];
    if (!candidate) continue;
    const ruler = world.characters.find(item => item.id === kingdom.rulerId);
    if (ruler?.knowledge.factIds.includes(candidate.id)) continue;
    const sender = world.characters.find(character => character.alive && character.settlementId === settlement.id && ['guard', 'scribe', 'priest', 'merchant'].includes(character.profession));
    queueMessage(world, { kind: candidate.topic === 'чудовище' ? 'донесение' : candidate.topic === 'война' ? 'военный рапорт' : 'письмо', senderCharacterId: sender?.id, recipientCharacterId: ruler?.id, recipientKingdomId: kingdom.id, fromSettlementId: settlement.id, toSettlementId: capital.id, knowledgeFactIds: [candidate.id], reliability: 88, sealed: true });
  }
}

function seedPropaganda(world: WorldState, rng: RNG): void {
  if (world.month !== 3 && world.month !== 9) return;
  for (const war of world.wars.filter(item => item.active)) {
    const kingdom = world.kingdoms.find(item => item.id === war.attackerId);
    const capital = kingdom ? world.settlements.find(item => item.id === kingdom.capitalId) : undefined;
    if (!kingdom || !capital || rng.chance(.55)) continue;
    const fact: KnowledgeFact = {
      id: world.nextIds.knowledgeFact++, topic: 'война', subjectRef: { kind: 'war', id: war.id },
      statement: `Глашатаи государства ${kingdom.name} утверждают, что победа в войне близка.`, canonicalStatement: `Исход войны ${war.name} пока не решён.`,
      truth: rng.int(35, 75), verified: false, importance: 2, secrecy: 0, originSettlementId: capital.id, originCharacterId: kingdom.rulerId,
      createdTick: worldTick(world), tags: ['пропаганда', 'война'], history: ['Создано двором для поддержки морали.'],
    };
    world.knowledgeFacts.push(fact);
    addFactToSettlement(world, capital.id, fact.id, false);
    createRumor(world, fact, capital.id, rng, rng.int(55, 85));
  }
}

function updateDetailedKnowledge(world: WorldState, detailed: DetailedPopulationContext): void {
  const tick = worldTick(world);
  for (const character of world.characters) {
    const state = ensureCharacterKnowledge(character, tick);
    state.detailed = detailed.characterIds.has(character.id) || character.renown >= 45 || character.titles.length > 0 || ['merchant', 'scribe', 'priest', 'guard', 'soldier', 'hunter'].includes(character.profession);
    if (!state.detailed && state.memoryIds.length > 5) state.memoryIds.splice(0, state.memoryIds.length - 5);
  }
}

function loseDeadSecrets(world: WorldState): void {
  const living = new Set(world.characters.map(character => character.id));
  const removedMemoryIds = new Set<number>();
  for (const memory of world.memories) if (!living.has(memory.characterId)) removedMemoryIds.add(memory.id);
  if (!removedMemoryIds.size) return;
  world.memories = world.memories.filter(memory => !removedMemoryIds.has(memory.id));
  for (const character of world.characters) character.knowledge.memoryIds = character.knowledge.memoryIds.filter(id => !removedMemoryIds.has(id));
  for (const fact of world.knowledgeFacts) {
    const livingHolder = world.characters.some(character => character.knowledge.factIds.includes(fact.id));
    const publicHolder = world.settlementKnowledge.some(state => state.factIds.includes(fact.id));
    const inTransit = world.messages.some(message => message.status === 'в пути' && message.knowledgeFactIds.includes(fact.id));
    if (!livingHolder && !publicHolder && !inTransit && fact.secrecy >= 50 && !fact.tags.includes('утрачено')) {
      fact.tags.push('утрачено');
      fact.history.push('Последний известный носитель умер, не передав сведения.');
    }
  }
}

function confirmedThreats(world: WorldState): KnowledgeAdvanceResult['confirmedMonsterThreats'] {
  const result: KnowledgeAdvanceResult['confirmedMonsterThreats'] = [];
  for (const fact of world.knowledgeFacts) {
    if (fact.topic !== 'чудовище' || !fact.verified || fact.tags.includes('решение-принято') || fact.subjectRef?.kind !== 'monster' || !fact.originSettlementId) continue;
    const monster = world.monsters.find(item => item.id === fact.subjectRef!.id && item.alive);
    const settlement = world.settlements.find(item => item.id === fact.originSettlementId);
    const kingdom = settlement ? world.kingdoms.find(item => item.id === settlement.kingdomId) : undefined;
    const ruler = kingdom ? world.characters.find(item => item.id === kingdom.rulerId) : undefined;
    if (!monster || !settlement || !kingdom || !ruler?.knowledge.factIds.includes(fact.id)) continue;
    const capitalState = settlementKnowledge(world, kingdom.capitalId);
    if (!capitalState.verifiedFactIds.includes(fact.id)) continue;
    result.push({ factId: fact.id, monsterId: monster.id, kingdomId: kingdom.id, settlementId: settlement.id });
  }
  return result;
}

export function markKnowledgeDecision(world: WorldState, factId: number, note: string): void {
  const fact = world.knowledgeFacts.find(item => item.id === factId);
  if (!fact) return;
  if (!fact.tags.includes('решение-принято')) fact.tags.push('решение-принято');
  fact.history.push(note);
}

export function advanceKnowledgeSystem(world: WorldState, rng: RNG, indexes: WorldIndexes, detailed: DetailedPopulationContext): KnowledgeAdvanceResult {
  initializeKnowledgeSystem(world, rng);
  updateDetailedKnowledge(world, detailed);
  const tick = worldTick(world);
  let deliveredMessages = 0;
  for (const message of world.messages) {
    if (message.status !== 'в пути' || message.arrivalTick > tick) continue;
    deliverMessage(world, message, new RNG(`${world.config.seed}:доставка-сообщения:${message.id}:${tick}`));
    if ((message as Message).status === 'доставлено') deliveredMessages += 1;
  }
  let spreadRumors = 0;
  const activeSettlementIds = new Set(detailed.settlementIds);
  if ([1, 4, 7, 10].includes(world.month)) for (const settlement of world.settlements) activeSettlementIds.add(settlement.id);
  for (const settlementId of activeSettlementIds) {
    const settlement = indexes.settlementById.get(settlementId);
    if (settlement) spreadRumors += spreadSettlementRumors(world, settlement, new RNG(`${world.config.seed}:слухи:${settlement.id}:${tick}`), detailed);
  }
  merchantCarriesNews(world, rng);
  createOfficialReports(world);
  seedPropaganda(world, rng);
  loseDeadSecrets(world);
  decayRumors(world, tick);
  trimKnowledgeCollections(world);
  return { confirmedMonsterThreats: confirmedThreats(world), deliveredMessages, spreadRumors };
}

function decayRumors(world: WorldState, tick: number): void {
  for (const rumor of world.rumors) {
    if (rumor.status === 'опровергнут' || rumor.status === 'затих') continue;
    const age = tick - rumor.lastSpreadTick;
    if (age > 60 || (age > 24 && rumor.spreadCount < 2)) rumor.status = 'затих';
    const fact = world.knowledgeFacts.find(item => item.id === rumor.factId);
    if (fact?.verified && rumor.confidence >= 70) rumor.status = 'подтверждён';
  }
  for (const state of world.settlementKnowledge) state.rumorIds = state.rumorIds.filter(id => {
    const rumor = world.rumors.find(item => item.id === id);
    return Boolean(rumor && rumor.status !== 'затих' && rumor.status !== 'опровергнут');
  });
}

function trimKnowledgeCollections(world: WorldState): void {
  if (world.memories.length > MAX_MEMORIES) {
    const keep = [...world.memories].sort((a, b) => b.emotionalWeight - a.emotionalWeight || b.lastRecalledTick - a.lastRecalledTick).slice(0, MAX_MEMORIES);
    const ids = new Set(keep.map(item => item.id));
    world.memories = keep.sort((a, b) => a.id - b.id);
    for (const character of world.characters) character.knowledge.memoryIds = character.knowledge.memoryIds.filter(id => ids.has(id));
  }
  if (world.rumors.length > MAX_RUMORS) {
    const keep = [...world.rumors].sort((a, b) => Number(b.status !== 'затих') - Number(a.status !== 'затих') || b.lastSpreadTick - a.lastSpreadTick).slice(0, MAX_RUMORS);
    const ids = new Set(keep.map(item => item.id));
    world.rumors = keep.sort((a, b) => a.id - b.id);
    for (const state of world.settlementKnowledge) state.rumorIds = state.rumorIds.filter(id => ids.has(id));
  }
  if (world.messages.length > MAX_MESSAGES) world.messages = [...world.messages].sort((a, b) => Number(b.status === 'в пути') - Number(a.status === 'в пути') || b.departedTick - a.departedTick).slice(0, MAX_MESSAGES).sort((a, b) => a.id - b.id);
  if (world.knowledgeFacts.length > MAX_FACTS) {
    const protectedIds = new Set<number>();
    world.characters.forEach(character => character.knowledge.factIds.forEach(id => protectedIds.add(id)));
    world.settlementKnowledge.forEach(state => state.factIds.forEach(id => protectedIds.add(id)));
    world.messages.forEach(message => message.knowledgeFactIds.forEach(id => protectedIds.add(id)));
    const keep = [...world.knowledgeFacts].sort((a, b) => Number(protectedIds.has(b.id)) - Number(protectedIds.has(a.id)) || b.importance - a.importance || b.createdTick - a.createdTick).slice(0, MAX_FACTS);
    const ids = new Set(keep.map(item => item.id));
    world.knowledgeFacts = keep.sort((a, b) => a.id - b.id);
    for (const character of world.characters) character.knowledge.factIds = character.knowledge.factIds.filter(id => ids.has(id));
    for (const state of world.settlementKnowledge) {
      state.factIds = state.factIds.filter(id => ids.has(id));
      state.verifiedFactIds = state.verifiedFactIds.filter(id => ids.has(id));
    }
    world.rumors = world.rumors.filter(rumor => ids.has(rumor.factId));
    world.messages = world.messages.filter(message => message.knowledgeFactIds.some(id => ids.has(id))).map(message => ({ ...message, knowledgeFactIds: message.knowledgeFactIds.filter(id => ids.has(id)) }));
  }
}

function nearestSettlement(world: WorldState, x: number, y: number): Settlement | undefined {
  let best: Settlement | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const settlement of world.settlements) {
    const distance = Math.hypot(settlement.x - x, settlement.y - y);
    if (distance < bestDistance) { best = settlement; bestDistance = distance; }
  }
  return best;
}

export function knowledgeIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const factIds = new Set<number>();
  const characterIds = new Set(world.characters.map(item => item.id));
  const settlementIds = new Set(world.settlements.map(item => item.id));
  const memoryIds = new Set(world.memories.map(item => item.id));
  const rumorIds = new Set(world.rumors.map(item => item.id));
  for (const fact of world.knowledgeFacts) {
    if (factIds.has(fact.id)) issues.push(`Знания: повтор факта ${fact.id}`);
    factIds.add(fact.id);
    if (fact.originSettlementId && !settlementIds.has(fact.originSettlementId)) issues.push(`Знания: факт ${fact.id} ссылается на отсутствующее поселение`);
    if (fact.truth < 0 || fact.truth > 100) issues.push(`Знания: факт ${fact.id} имеет неверную достоверность`);
  }
  for (const memory of world.memories) {
    if (!characterIds.has(memory.characterId)) issues.push(`Память ${memory.id}: носитель отсутствует среди живых`);
    if (memory.factId && !factIds.has(memory.factId)) issues.push(`Память ${memory.id}: отсутствует факт ${memory.factId}`);
  }
  for (const rumor of world.rumors) {
    if (!factIds.has(rumor.factId)) issues.push(`Слух ${rumor.id}: отсутствует исходный факт`);
    if (!settlementIds.has(rumor.originSettlementId) || !settlementIds.has(rumor.currentSettlementId)) issues.push(`Слух ${rumor.id}: отсутствует поселение`);
  }
  for (const message of world.messages) {
    if (!settlementIds.has(message.fromSettlementId) || !settlementIds.has(message.toSettlementId)) issues.push(`Сообщение ${message.id}: отсутствует пункт пути`);
    if (message.knowledgeFactIds.some(id => !factIds.has(id))) issues.push(`Сообщение ${message.id}: отсутствует передаваемый факт`);
  }
  for (const state of world.settlementKnowledge) {
    if (!settlementIds.has(state.settlementId)) issues.push(`Знания поселения ${state.settlementId}: поселение отсутствует`);
    if (state.factIds.some(id => !factIds.has(id)) || state.verifiedFactIds.some(id => !factIds.has(id))) issues.push(`Знания поселения ${state.settlementId}: отсутствует факт`);
    if (state.rumorIds.some(id => !rumorIds.has(id))) issues.push(`Знания поселения ${state.settlementId}: отсутствует слух`);
  }
  for (const character of world.characters) {
    if (!character.knowledge) issues.push(`${character.name}: отсутствует память и знания`);
    else {
      if (character.knowledge.factIds.some(id => !factIds.has(id))) issues.push(`${character.name}: знает отсутствующий факт`);
      if (character.knowledge.memoryIds.some(id => !memoryIds.has(id))) issues.push(`${character.name}: ссылается на отсутствующую память`);
    }
  }
  return issues;
}
