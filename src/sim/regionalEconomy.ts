import { CIVILIZATION_CONTENT } from '../content/coreContent';
import type { ProductionRecipe, Settlement, TradeRoute, TradeShipment, WorldState } from '../types';
import type {
  RegionalEconomicCrisisKind, ResourceDeposit, SettlementRegionalEconomy,
  SettlementSpecializationKind, TradeContract,
} from '../regionalEconomyTypes';
import { appendCausalEvent } from './causality';
import { RNG } from './rng';
import { worldTick } from './scheduler';

interface DepositDefinition {
  templateId: string;
  kind: ResourceDeposit['kind'];
  terrains: WorldState['tiles'][number]['terrain'][];
  chance: number;
  amount: [number, number];
  quality: [number, number];
  difficulty: [number, number];
  renewable: boolean;
  regeneration: [number, number];
}

const DEPOSITS: DepositDefinition[] = [
  { templateId: 'iron_ore', kind: 'mineral', terrains: ['hills', 'mountains'], chance: .58, amount: [240, 1200], quality: [35, 92], difficulty: [38, 82], renewable: false, regeneration: [0, 0] },
  { templateId: 'stone', kind: 'mineral', terrains: ['hills', 'mountains', 'plains'], chance: .72, amount: [520, 2400], quality: [40, 90], difficulty: [20, 65], renewable: false, regeneration: [0, 0] },
  { templateId: 'clay', kind: 'soil', terrains: ['plains', 'marsh', 'coast'], chance: .52, amount: [360, 1500], quality: [38, 88], difficulty: [15, 48], renewable: false, regeneration: [0, 0] },
  { templateId: 'timber', kind: 'forest', terrains: ['forest', 'hills', 'tundra'], chance: .82, amount: [260, 980], quality: [35, 90], difficulty: [18, 55], renewable: true, regeneration: [24, 76] },
  { templateId: 'fish', kind: 'water', terrains: ['coast', 'marsh'], chance: .78, amount: [260, 1100], quality: [42, 94], difficulty: [18, 52], renewable: true, regeneration: [36, 110] },
  { templateId: 'salt', kind: 'mineral', terrains: ['coast', 'desert'], chance: .32, amount: [160, 700], quality: [35, 96], difficulty: [24, 64], renewable: false, regeneration: [0, 0] },
  { templateId: 'grain', kind: 'soil', terrains: ['plains', 'coast'], chance: .66, amount: [320, 1050], quality: [38, 92], difficulty: [10, 35], renewable: true, regeneration: [70, 180] },
  { templateId: 'herbal_medicine', kind: 'herb', terrains: ['forest', 'marsh', 'plains', 'hills'], chance: .28, amount: [80, 360], quality: [30, 98], difficulty: [12, 44], renewable: true, regeneration: [18, 62] },
];

const EXTRACTION_TEMPLATE_BY_OUTPUT = new Map<string, string>([
  ['iron_ore', 'iron_ore'], ['stone', 'stone'], ['clay', 'clay'], ['timber', 'timber'], ['firewood', 'timber'], ['fish', 'fish'],
]);

const FOOD_TEMPLATES = new Set(['grain', 'flour', 'bread', 'vegetables', 'fruit', 'meat', 'fish', 'smoked_meat', 'salted_fish', 'milk', 'eggs']);
const WORKSHOP_TYPES = new Set(['кузница', 'плотницкая мастерская', 'ткацкая мастерская', 'портная мастерская', 'красильня', 'кожевенная мастерская', 'сапожная мастерская', 'бронная мастерская', 'инструментальная мастерская', 'кирпичная мастерская']);

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function templateName(templateId: string): string {
  return CIVILIZATION_CONTENT.resourceById.get(templateId)?.name ?? templateId;
}

function nextDepositId(world: WorldState): number {
  return Math.max(0, ...(world.resourceDeposits ?? []).map(item => item.id)) + 1;
}

function nextContractId(world: WorldState): number {
  return Math.max(0, ...(world.tradeContracts ?? []).map(item => item.id)) + 1;
}

function depositDefinition(templateId: string): DepositDefinition | undefined {
  return DEPOSITS.find(item => item.templateId === templateId);
}

function makeDeposit(world: WorldState, definition: DepositDefinition, x: number, y: number, rng: RNG, id: number): ResourceDeposit {
  const initialAmount = rng.int(definition.amount[0], definition.amount[1]);
  return {
    id, x, y, templateId: definition.templateId, kind: definition.kind, initialAmount, remaining: initialAmount,
    quality: rng.int(definition.quality[0], definition.quality[1]), extractionDifficulty: rng.int(definition.difficulty[0], definition.difficulty[1]),
    renewable: definition.renewable, regenerationPerYear: rng.int(definition.regeneration[0], definition.regeneration[1]),
    history: [`Источник «${templateName(definition.templateId)}» сформирован в клетке ${x}:${y}.`],
  };
}

function generateDeposits(world: WorldState): ResourceDeposit[] {
  const result: ResourceDeposit[] = [];
  let id = 1;
  for (const tile of world.tiles) {
    if (tile.terrain === 'ocean') continue;
    const rng = new RNG(`${world.config.seed}:региональные-ресурсы:${tile.x}:${tile.y}`);
    const candidates = DEPOSITS.filter(item => item.terrains.includes(tile.terrain));
    const selected = candidates
      .filter(item => rng.chance(item.chance * (.72 + world.config.ecologyDensity * .2)))
      .sort((a, b) => b.chance - a.chance || a.templateId.localeCompare(b.templateId))
      .slice(0, rng.chance(.18) ? 2 : 1);
    for (const definition of selected) result.push(makeDeposit(world, definition, tile.x, tile.y, rng, id++));
  }
  return result;
}

function nearestSettlement(world: WorldState, deposit: ResourceDeposit): Settlement | undefined {
  return [...world.settlements]
    .map(settlement => ({ settlement, distance: Math.hypot(settlement.x - deposit.x, settlement.y - deposit.y) }))
    .filter(item => item.distance <= 5.5)
    .sort((a, b) => {
      const tile = world.tiles.find(item => item.x === deposit.x && item.y === deposit.y);
      const sameKingdomA = Number(tile?.kingdomId === a.settlement.kingdomId);
      const sameKingdomB = Number(tile?.kingdomId === b.settlement.kingdomId);
      return sameKingdomB - sameKingdomA || a.distance - b.distance || b.settlement.population - a.settlement.population;
    })[0]?.settlement;
}

function fallbackResourceForSettlement(world: WorldState, settlement: Settlement): string {
  const terrain = world.tiles.find(item => item.x === settlement.x && item.y === settlement.y)?.terrain;
  if (terrain === 'mountains' || terrain === 'hills') return 'iron_ore';
  if (terrain === 'forest' || terrain === 'tundra') return 'timber';
  if (terrain === 'coast') return 'fish';
  if (terrain === 'marsh') return 'clay';
  if (terrain === 'desert') return 'salt';
  return 'grain';
}

function assignDeposits(world: WorldState): void {
  for (const deposit of world.resourceDeposits) deposit.assignedSettlementId = nearestSettlement(world, deposit)?.id;
  let id = nextDepositId(world);
  for (const settlement of world.settlements) {
    const local = world.resourceDeposits.filter(item => item.assignedSettlementId === settlement.id && item.remaining > 0);
    if (local.length) continue;
    const templateId = fallbackResourceForSettlement(world, settlement);
    const definition = depositDefinition(templateId)!;
    const rng = new RNG(`${world.config.seed}:ресурс-поселения:${settlement.id}:${settlement.foundedYear}`);
    const deposit = makeDeposit(world, definition, settlement.x, settlement.y, rng, id++);
    deposit.assignedSettlementId = settlement.id;
    deposit.history.push(`Источник закреплён за поселением ${settlement.name}, чтобы его хозяйство имело физическую ресурсную базу.`);
    world.resourceDeposits.push(deposit);
  }
}

function quantityInSettlement(world: WorldState, settlementId: number, templateId: string): number {
  return world.items.reduce((sum, item) => sum + (item.settlementId === settlementId && item.templateId === templateId && item.condition > 0 ? Math.max(0, item.quantity) : 0), 0);
}

function localRecipes(world: WorldState, settlementId: number): ProductionRecipe[] {
  const recipeIds = new Set(world.establishments.filter(item => item.settlementId === settlementId && item.active).flatMap(item => item.recipeIds));
  return world.productionRecipes.filter(item => recipeIds.has(item.id));
}

function specializationScores(world: WorldState, settlement: Settlement, deposits: ResourceDeposit[]): Record<SettlementSpecializationKind, number> {
  const establishments = world.establishments.filter(item => item.settlementId === settlement.id && item.active);
  const fields = world.fields.filter(item => item.settlementId === settlement.id).length;
  const routes = world.tradeRoutes.filter(item => item.active && (item.fromSettlementId === settlement.id || item.toSettlementId === settlement.id));
  const books = world.books.filter(item => item.settlementId === settlement.id).length;
  const depositCount = (ids: string[]) => deposits.filter(item => ids.includes(item.templateId) && item.remaining > 0).reduce((sum, item) => sum + item.remaining / Math.max(1, item.initialAmount), 0);
  const typeCount = (types: string[]) => establishments.filter(item => types.includes(item.type)).length;
  return {
    subsistence: 10 + settlement.population / 30,
    agriculture: depositCount(['grain']) * 22 + fields * 7 + typeCount(['ферма', 'мельница', 'пекарня']) * 8,
    mining: depositCount(['iron_ore', 'stone', 'clay', 'salt']) * 24 + typeCount(['рудник', 'каменоломня', 'кирпичная мастерская']) * 10,
    forestry: depositCount(['timber']) * 26 + typeCount(['плотницкая мастерская']) * 12,
    fishing: depositCount(['fish']) * 28 + typeCount(['рыбный промысел']) * 14,
    craft: establishments.filter(item => WORKSHOP_TYPES.has(item.type)).length * 10 + world.settlementTechnologyKnowledge.filter(item => item.settlementId === settlement.id && ['practiced', 'institutional'].includes(item.level)).length * 3,
    trade: routes.length * 12 + typeCount(['рынок', 'лавка', 'склад', 'постоялый двор']) * 7 + settlement.prosperity * .12,
    military: typeCount(['казарма', 'арсенал', 'замковое хозяйство']) * 12 + settlement.defense * .18 + (settlement.type === 'fortress' ? 24 : 0),
    scholarly: typeCount(['школа', 'храм', 'гильдейский дом']) * 10 + books * 2.5 + (world.settlementCultures.find(item => item.settlementId === settlement.id)?.literacy ?? 0) * .25,
  };
}

function criticalImports(world: WorldState, settlement: Settlement, deposits: ResourceDeposit[]): string[] {
  const localDepositTemplates = new Set(deposits.filter(item => item.remaining > 0).map(item => item.templateId));
  const result = new Set<string>();
  for (const recipe of localRecipes(world, settlement.id)) {
    for (const input of recipe.inputs) {
      const available = quantityInSettlement(world, settlement.id, input.templateId);
      const expected = input.quantity * 3;
      if (available < expected && !localDepositTemplates.has(input.templateId)) result.add(input.templateId);
    }
  }
  if (settlement.food < 45) result.add('grain');
  return [...result].sort();
}

function exportTemplates(world: WorldState, settlement: Settlement, deposits: ResourceDeposit[]): string[] {
  const result = new Set(deposits.filter(item => item.remaining > item.initialAmount * .08).map(item => item.templateId));
  const supply = settlement.economy?.supply ?? {};
  const demand = settlement.economy?.demand ?? {};
  for (const [templateId, quantity] of Object.entries(supply)) if (quantity > (demand[templateId] ?? 0) * 1.25 + 2) result.add(templateId);
  return [...result].sort();
}

function routeAccess(world: WorldState, settlementId: number): number {
  const routes = world.tradeRoutes.filter(item => item.fromSettlementId === settlementId || item.toSettlementId === settlementId);
  if (!routes.length) return 0;
  return clamp(routes.reduce((sum, item) => sum + (item.active ? item.safety : 0), 0) / routes.length + Math.min(25, routes.length * 4));
}

function detectCrisis(world: WorldState, settlement: Settlement, state: SettlementRegionalEconomy): RegionalEconomicCrisisKind | undefined {
  const routes = world.tradeRoutes.filter(item => item.fromSettlementId === settlement.id || item.toSettlementId === settlement.id);
  const blocked = routes.length > 0 && routes.every(item => !item.active || item.safety < 18);
  if (blocked && state.criticalImportTemplateIds.length) return 'trade-blockade';
  if (settlement.food < 28 && state.importReliance >= 35) return 'food-import-shock';
  const exhausted = state.localDepositIds.map(id => world.resourceDeposits.find(item => item.id === id)).some(item => item && !item.renewable && item.remaining <= .01);
  if (exhausted && ['mining', 'forestry', 'fishing'].includes(state.specialization)) return 'deposit-exhaustion';
  const activeInbound = world.tradeContracts.some(item => item.toSettlementId === settlement.id && state.criticalImportTemplateIds.includes(item.templateId) && item.status === 'active');
  if (state.criticalImportTemplateIds.length >= 2 && !activeInbound) return 'raw-material-shortage';
  const activeWorkshops = world.establishments.filter(item => item.settlementId === settlement.id && item.active && WORKSHOP_TYPES.has(item.type)).length;
  if (activeWorkshops >= 3 && state.productionCapacity < 18 && state.importReliance > 45) return 'production-collapse';
  return undefined;
}

function evaluateSettlement(world: WorldState, settlement: Settlement, previous?: SettlementRegionalEconomy): SettlementRegionalEconomy {
  const deposits = world.resourceDeposits.filter(item => item.assignedSettlementId === settlement.id);
  const scores = specializationScores(world, settlement, deposits);
  const ranked = (Object.entries(scores) as [SettlementSpecializationKind, number][]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const imports = criticalImports(world, settlement, deposits);
  const exports = exportTemplates(world, settlement, deposits);
  const activeEstablishments = world.establishments.filter(item => item.settlementId === settlement.id && item.active);
  const workers = activeEstablishments.reduce((sum, item) => sum + item.workerIds.length, 0);
  const state: SettlementRegionalEconomy = {
    settlementId: settlement.id,
    specialization: ranked[0]?.[0] ?? 'subsistence',
    secondarySpecialization: ranked[1]?.[1] && ranked[1]![1] >= (ranked[0]?.[1] ?? 0) * .62 ? ranked[1]![0] : undefined,
    localDepositIds: deposits.map(item => item.id).sort((a, b) => a - b),
    criticalImportTemplateIds: imports,
    exportTemplateIds: exports,
    importReliance: clamp(imports.length * 18 + Math.max(0, 50 - settlement.food) * .45 - exports.length * 3),
    marketAccess: routeAccess(world, settlement.id),
    productionCapacity: clamp(activeEstablishments.length * 4 + workers * 1.8 + settlement.prosperity * .22),
    activeCrisis: undefined,
    crisisMonths: previous?.crisisMonths ?? 0,
    lastEvaluatedTick: worldTick(world),
    history: previous?.history ?? [],
  };
  state.activeCrisis = detectCrisis(world, settlement, state);
  if (state.activeCrisis) state.crisisMonths = (previous?.activeCrisis === state.activeCrisis ? previous.crisisMonths : 0) + 1;
  else state.crisisMonths = 0;
  if (!previous || previous.specialization !== state.specialization) state.history.push(`В ${world.year}.${String(world.month).padStart(2, '0')} хозяйство стало специализироваться на направлении «${state.specialization}».`);
  if (state.activeCrisis && previous?.activeCrisis !== state.activeCrisis) state.history.push(`Начался кризис: ${state.activeCrisis}.`);
  if (!state.activeCrisis && previous?.activeCrisis) state.history.push(`Кризис «${previous.activeCrisis}» завершился.`);
  if (state.history.length > 24) state.history.splice(0, state.history.length - 24);
  return state;
}

function contractKey(routeId: number, fromSettlementId: number, toSettlementId: number, templateId: string): string {
  return `${routeId}:${fromSettlementId}:${toSettlementId}:${templateId}`;
}

function desiredContracts(world: WorldState): Omit<TradeContract, 'id' | 'createdTick' | 'history'>[] {
  const states = new Map(world.settlementRegionalEconomies.map(item => [item.settlementId, item]));
  const result: Omit<TradeContract, 'id' | 'createdTick' | 'history'>[] = [];
  for (const route of world.tradeRoutes) {
    const pairs = [[route.fromSettlementId, route.toSettlementId], [route.toSettlementId, route.fromSettlementId]] as const;
    for (const [fromId, toId] of pairs) {
      const seller = states.get(fromId);
      const buyer = states.get(toId);
      const fromSettlement = world.settlements.find(item => item.id === fromId);
      const toSettlement = world.settlements.find(item => item.id === toId);
      if (!seller || !buyer || !fromSettlement || !toSettlement) continue;
      const candidates = seller.exportTemplateIds.filter(templateId => buyer.criticalImportTemplateIds.includes(templateId));
      for (const templateId of candidates.slice(0, 3)) {
        const demand = Math.max(1, toSettlement.economy?.demand?.[templateId] ?? 2);
        const supply = Math.max(0, fromSettlement.economy?.supply?.[templateId] ?? quantityInSettlement(world, fromId, templateId));
        const baseValue = CIVILIZATION_CONTENT.resourceById.get(templateId)?.value ?? 5;
        const sellerPrice = fromSettlement.economy?.prices?.[templateId] ?? baseValue;
        const expectedDeliveredPrice = regionalDeliveredUnitPrice(world, route, fromSettlement, toSettlement, templateId, sellerPrice);
        result.push({
          routeId: route.id, fromSettlementId: fromId, toSettlementId: toId, templateId,
          targetQuantity: Math.max(1, Math.min(route.volume / 8, demand * 1.5, Math.max(2, supply * .25))),
          minimumDestinationStock: Math.max(1, demand * .65), maxUnitPrice: Math.max(baseValue * 2.5, expectedDeliveredPrice * 1.2),
          priority: Math.round(40 + buyer.importReliance * .5 + (FOOD_TEMPLATES.has(templateId) ? 25 : 0)),
          status: route.active && route.safety >= 18 ? 'active' : 'suspended',
          disruptedSinceTick: route.active && route.safety >= 18 ? undefined : worldTick(world),
          cause: route.active ? (route.safety < 18 ? 'дорога слишком опасна' : undefined) : 'торговый путь закрыт',
        });
      }
    }
  }
  return result;
}

function synchronizeContracts(world: WorldState): void {
  const tick = worldTick(world);
  const desired = desiredContracts(world);
  const desiredKeys = new Set(desired.map(item => contractKey(item.routeId, item.fromSettlementId, item.toSettlementId, item.templateId)));
  const existing = new Map(world.tradeContracts.map(item => [contractKey(item.routeId, item.fromSettlementId, item.toSettlementId, item.templateId), item]));
  let id = nextContractId(world);
  for (const candidate of desired) {
    const key = contractKey(candidate.routeId, candidate.fromSettlementId, candidate.toSettlementId, candidate.templateId);
    const contract = existing.get(key);
    if (!contract) {
      world.tradeContracts.push({ id: id++, ...candidate, createdTick: tick, history: [`Договор создан для поставки «${templateName(candidate.templateId)}».`] });
      continue;
    }
    const oldStatus = contract.status;
    Object.assign(contract, candidate);
    if (oldStatus !== contract.status) contract.history.push(contract.status === 'active' ? 'Поставки возобновлены.' : `Поставки приостановлены: ${contract.cause ?? 'нет безопасного пути'}.`);
    if (contract.history.length > 18) contract.history.splice(0, contract.history.length - 18);
  }
  for (const contract of world.tradeContracts) {
    const key = contractKey(contract.routeId, contract.fromSettlementId, contract.toSettlementId, contract.templateId);
    if (!desiredKeys.has(key) && contract.status !== 'cancelled') {
      contract.status = 'fulfilled';
      contract.history.push('Потребность исчезла или поставщик утратил избыток товара.');
    }
  }
  if (world.tradeContracts.length > 900) world.tradeContracts = world.tradeContracts.filter(item => item.status === 'active' || item.status === 'suspended').concat(world.tradeContracts.filter(item => item.status === 'fulfilled' || item.status === 'cancelled').slice(-200));
}

function emitPersistentCrisis(world: WorldState, settlement: Settlement, state: SettlementRegionalEconomy): void {
  if (!state.activeCrisis || state.crisisMonths !== 3) return;
  appendCausalEvent(world, {
    kind: 'market', title: `Экономический кризис в ${settlement.name}`,
    description: `Специализация «${state.specialization}» столкнулась с кризисом «${state.activeCrisis}».`,
    cause: state.criticalImportTemplateIds.length ? `не хватает: ${state.criticalImportTemplateIds.map(templateName).join(', ')}` : 'местная ресурсная база больше не поддерживает производство',
    conditions: [`импортозависимость ${Math.round(state.importReliance)}%`, `доступ к рынкам ${Math.round(state.marketAccess)}%`],
    decision: 'местные хозяйства сократили производство и начали искать новый путь снабжения',
    outcome: 'цены выросли, часть рабочих мест оказалась под угрозой',
    consequences: ['производственные цепочки замедлились', 'возросло давление на торговые пути'],
    entityRefs: [{ kind: 'settlement', id: settlement.id }], importance: 3,
  });
}

export function initializeRegionalEconomy(world: WorldState, rng = new RNG(`${world.config.seed}:региональная-экономика-v1`)): void {
  world.resourceDeposits ??= [];
  world.settlementRegionalEconomies ??= [];
  world.tradeContracts ??= [];
  const firstInitialization = world.simulation.regionalEconomyVersion !== 1 || !world.resourceDeposits.length;
  if (firstInitialization) world.resourceDeposits = generateDeposits(world);
  // Consume the argument deliberately so initialization remains deterministic even if later definitions add optional deposits.
  if (rng.chance(0)) world.resourceDeposits.reverse();
  assignDeposits(world);
  const previous = new Map(world.settlementRegionalEconomies.map(item => [item.settlementId, item]));
  world.settlementRegionalEconomies = world.settlements.map(settlement => evaluateSettlement(world, settlement, previous.get(settlement.id)));
  synchronizeContracts(world);
  world.simulation.regionalEconomyVersion = 1;
}

export function advanceRegionalEconomy(world: WorldState, elapsedMonths = 1): void {
  if (world.simulation.regionalEconomyVersion !== 1) initializeRegionalEconomy(world);
  if (world.month === 1) {
    for (const deposit of world.resourceDeposits) {
      if (!deposit.renewable || deposit.remaining >= deposit.initialAmount) continue;
      const restored = Math.min(deposit.initialAmount - deposit.remaining, deposit.regenerationPerYear * Math.max(1, elapsedMonths / 12));
      deposit.remaining += restored;
      if (restored > 0) deposit.history.push(`К ${world.year} году источник восстановил ${restored.toFixed(1)} единиц.`);
    }
  }
  assignDeposits(world);
  const previous = new Map(world.settlementRegionalEconomies.map(item => [item.settlementId, item]));
  world.settlementRegionalEconomies = world.settlements.map(settlement => evaluateSettlement(world, settlement, previous.get(settlement.id)));
  synchronizeContracts(world);
  for (const settlement of world.settlements) {
    const state = world.settlementRegionalEconomies.find(item => item.settlementId === settlement.id);
    if (state) emitPersistentCrisis(world, settlement, state);
  }
}

export function reserveRegionalExtraction(world: WorldState, settlementId: number, recipe: ProductionRecipe, requestedRuns: number): number {
  if (requestedRuns <= 0 || recipe.category !== 'добыча') return Math.max(0, requestedRuns);
  const resourceTemplate = recipe.outputs.map(item => EXTRACTION_TEMPLATE_BY_OUTPUT.get(item.templateId)).find(Boolean);
  if (!resourceTemplate) return requestedRuns;
  if (world.simulation.regionalEconomyVersion !== 1) initializeRegionalEconomy(world);
  const output = recipe.outputs.find(item => EXTRACTION_TEMPLATE_BY_OUTPUT.get(item.templateId) === resourceTemplate);
  const unitsPerRun = Math.max(.01, output?.quantity ?? 1);
  const deposits = world.resourceDeposits
    .filter(item => item.assignedSettlementId === settlementId && item.templateId === resourceTemplate && item.remaining > .0001)
    .sort((a, b) => b.quality - a.quality || a.extractionDifficulty - b.extractionDifficulty || a.id - b.id);
  const total = deposits.reduce((sum, item) => sum + item.remaining, 0);
  const allowedRuns = Math.max(0, Math.min(requestedRuns, Math.floor(total / unitsPerRun)));
  let required = allowedRuns * unitsPerRun;
  const tick = worldTick(world);
  for (const deposit of deposits) {
    if (required <= .0001) break;
    const consumed = Math.min(required, deposit.remaining);
    deposit.remaining -= consumed;
    deposit.lastExtractionTick = tick;
    required -= consumed;
    if (deposit.remaining <= .0001 && !deposit.exhaustedYear) {
      deposit.remaining = 0;
      deposit.exhaustedYear = world.year;
      deposit.history.push(`Источник исчерпан в ${world.year}.${String(world.month).padStart(2, '0')}.`);
      const settlement = world.settlements.find(item => item.id === settlementId);
      if (settlement) appendCausalEvent(world, {
        kind: 'ecology', title: `Исчерпан источник «${templateName(resourceTemplate)}» у ${settlement.name}`,
        description: 'Добыча дошла до физического предела месторождения.', cause: 'многолетняя эксплуатация без достаточного восстановления',
        conditions: [`остаток 0`, `качество ${deposit.quality}%`], decision: 'добывающие хозяйства остановили работы и начали искать новое сырьё',
        outcome: 'поселение стало зависеть от импорта или смены специализации', consequences: ['местные рабочие теряют занятость', 'цена сырья растёт'],
        entityRefs: [{ kind: 'settlement', id: settlement.id }], importance: 3,
      });
    }
  }
  return allowedRuns;
}

export function activeTradeContractForRoute(world: WorldState, routeId: number): TradeContract | undefined {
  return world.tradeContracts
    .filter(item => item.routeId === routeId && item.status === 'active')
    .sort((a, b) => b.priority - a.priority || (a.lastShipmentTick ?? -1) - (b.lastShipmentTick ?? -1) || a.id - b.id)[0];
}

export function regionalDeliveredUnitPrice(world: WorldState, route: TradeRoute, from: Settlement, to: Settlement, templateId: string, sellerUnitPrice: number): number {
  const distance = Math.hypot(from.x - to.x, from.y - to.y);
  const risk = Math.max(0, 70 - route.safety) / 100;
  const tariff = from.kingdomId === to.kingdomId ? .02 : .12;
  const buyerState = world.settlementRegionalEconomies.find(item => item.settlementId === to.id);
  const scarcity = buyerState?.criticalImportTemplateIds.includes(templateId) ? .12 + (buyerState.importReliance / 500) : 0;
  return sellerUnitPrice * (1 + distance * .025 + risk * .45 + tariff + scarcity);
}

export function regionalPriceMultiplier(world: WorldState, settlementId: number, templateId: string): number {
  const state = world.settlementRegionalEconomies.find(item => item.settlementId === settlementId);
  if (!state) return 1;
  const imported = state.criticalImportTemplateIds.includes(templateId);
  const exported = state.exportTemplateIds.includes(templateId);
  const scarcityPremium = imported ? Math.min(.35, state.importReliance / 350) : 0;
  const accessPenalty = imported ? Math.min(.25, Math.max(0, 45 - state.marketAccess) / 180) : 0;
  const crisisRelevant = imported || (state.activeCrisis === 'food-import-shock' && FOOD_TEMPLATES.has(templateId));
  const crisisPremium = crisisRelevant && state.activeCrisis ? Math.min(.25, .1 + state.crisisMonths * .015) : 0;
  const multiplier = 1 + scarcityPremium + accessPenalty + crisisPremium - (exported ? .1 : 0);
  return FOOD_TEMPLATES.has(templateId)
    ? Math.max(.75, Math.min(1.75, multiplier))
    : Math.max(.7, Math.min(2.5, multiplier));
}

export function recordRegionalShipmentOutcome(world: WorldState, shipment: TradeShipment, delivered: boolean, cause?: string): void {
  const templateIds = new Set(shipment.goods.map(item => item.templateId));
  const contract = world.tradeContracts.find(item => item.routeId === shipment.routeId && item.fromSettlementId === shipment.fromSettlementId && item.toSettlementId === shipment.toSettlementId && templateIds.has(item.templateId));
  if (!contract) return;
  if (delivered) {
    contract.lastShipmentTick = shipment.arrivalTick;
    contract.disruptedSinceTick = undefined;
    contract.cause = undefined;
    contract.status = 'active';
    contract.history.push(`Поставка доставлена в ${world.year}.${String(world.month).padStart(2, '0')}.`);
  } else {
    contract.disruptedSinceTick ??= worldTick(world);
    contract.cause = cause ?? shipment.cause ?? 'поставка потеряна';
    const route = world.tradeRoutes.find(item => item.id === contract.routeId);
    if (!route?.active || (route.safety ?? 0) < 18) contract.status = 'suspended';
    contract.history.push(`Поставка сорвана: ${contract.cause}.`);
  }
  if (contract.history.length > 18) contract.history.splice(0, contract.history.length - 18);
}

export function regionalEconomyIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const settlementIds = new Set(world.settlements.map(item => item.id));
  const routeIds = new Set(world.tradeRoutes.map(item => item.id));
  const depositIds = new Set<number>();
  for (const deposit of world.resourceDeposits ?? []) {
    if (depositIds.has(deposit.id)) issues.push(`Региональный ресурс ${deposit.id}: повтор идентификатора`);
    depositIds.add(deposit.id);
    if (deposit.remaining < -.0001 || deposit.remaining > deposit.initialAmount + .0001) issues.push(`Региональный ресурс ${deposit.id}: неверный остаток`);
    if (deposit.assignedSettlementId && !settlementIds.has(deposit.assignedSettlementId)) issues.push(`Региональный ресурс ${deposit.id}: нет поселения-владельца`);
    if (!CIVILIZATION_CONTENT.resourceById.has(deposit.templateId)) issues.push(`Региональный ресурс ${deposit.id}: неизвестный шаблон ${deposit.templateId}`);
  }
  const states = new Set<number>();
  for (const state of world.settlementRegionalEconomies ?? []) {
    if (states.has(state.settlementId)) issues.push(`Региональная экономика ${state.settlementId}: повтор состояния`);
    states.add(state.settlementId);
    if (!settlementIds.has(state.settlementId)) issues.push(`Региональная экономика ${state.settlementId}: нет поселения`);
    if (state.localDepositIds.some(id => !depositIds.has(id))) issues.push(`Региональная экономика ${state.settlementId}: ссылка на отсутствующий ресурс`);
  }
  const contractKeys = new Set<string>();
  for (const contract of world.tradeContracts ?? []) {
    const key = contractKey(contract.routeId, contract.fromSettlementId, contract.toSettlementId, contract.templateId);
    if (contractKeys.has(key) && ['active', 'suspended'].includes(contract.status)) issues.push(`Торговый договор ${contract.id}: дублирует действующий договор`);
    contractKeys.add(key);
    if (!routeIds.has(contract.routeId)) issues.push(`Торговый договор ${contract.id}: нет маршрута`);
    if (!settlementIds.has(contract.fromSettlementId) || !settlementIds.has(contract.toSettlementId)) issues.push(`Торговый договор ${contract.id}: нет поселения`);
  }
  return [...new Set(issues)];
}

export function synchronizeRegionalTradeContracts(world: WorldState): void {
  if (world.simulation.regionalEconomyVersion !== 1) initializeRegionalEconomy(world);
  synchronizeContracts(world);
}
