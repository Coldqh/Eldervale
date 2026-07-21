import type { Character, FieldPlot, Household, Settlement, Tile, TradeRoute, WorldState } from '../types';
import type {
  ClimateHistoryEntry, ClimateSystemState, NaturalCrisis, NaturalCrisisKind, SettlementClimateState, WeatherKind,
} from '../climateTypes';
import { hashSeed } from './rng';
import { worldTick } from './scheduler';
import { seasonForMonth } from '../lib/climate';

const MAX_SETTLEMENT_HISTORY = 30;
const MAX_WORLD_HISTORY = 180;
const MAX_CRISES = 180;
const ACTIVE_FIELD_STATES = new Set<FieldPlot['state']>(['подготовка', 'посеяно', 'всходы', 'рост', 'созревание', 'готово к жатве']);

interface ClimateIndexes {
  fieldsBySettlement: Map<number, FieldPlot[]>;
  householdsBySettlement: Map<number, Household[]>;
  charactersBySettlement: Map<number, Character[]>;
  routesBySettlement: Map<number, TradeRoute[]>;
}

interface CrisisCandidate {
  kind: NaturalCrisisKind;
  severity: number;
  cause: string;
  effects: string[];
}

export function initializeClimateSystem(world: WorldState): ClimateSystemState {
  const tick = worldTick(world);
  const existing = world.simulation.climate;
  if (existing?.version === 1) {
    normalizeClimateState(world, existing);
    world.simulation.climateSystemVersion = 1;
    world.simulation.lastClimateTick = existing.lastTick;
    return existing;
  }

  const settlements = world.settlements.map(settlement => deriveSettlementClimate(world, settlement, tick, undefined));
  const state: ClimateSystemState = { version: 1, lastTick: tick, settlements, crises: [], history: [] };
  world.simulation.climate = state;
  world.simulation.climateSystemVersion = 1;
  world.simulation.lastClimateTick = tick;
  return state;
}

export function advanceClimateSystem(
  world: WorldState,
  options: { elapsedMonths?: number; recordEvents?: boolean } = {},
): ClimateSystemState {
  const state = initializeClimateSystem(world);
  const targetTick = worldTick(world);
  const elapsedMonths = Math.max(1, Math.floor(options.elapsedMonths ?? Math.max(1, targetTick - state.lastTick)));
  const firstTick = Math.max(state.lastTick + 1, targetTick - elapsedMonths + 1);
  for (let tick = firstTick; tick <= targetTick; tick += 1) advanceClimateTick(world, state, tick, options.recordEvents !== false);
  state.lastTick = Math.max(state.lastTick, targetTick);
  world.simulation.lastClimateTick = state.lastTick;
  return state;
}

export function applyClimateStateToWorld(
  world: WorldState,
  climate: SettlementClimateState,
  options: { tick?: number; recordEvents?: boolean } = {},
): void {
  const state = initializeClimateSystem(world);
  const tick = options.tick ?? worldTick(world);
  const index = state.settlements.findIndex(item => item.settlementId === climate.settlementId);
  if (index >= 0) state.settlements[index] = climate;
  else state.settlements.push(climate);
  const indexes = buildIndexes(world);
  updateSettlementCrisisState(world, state, climate, tick, options.recordEvents !== false);
  applyConsequences(world, climate, indexes, tick);
}

export function climateIntegrityIssues(world: WorldState): string[] {
  const state = world.simulation.climate;
  if (!state) return ['отсутствует состояние климата'];
  const issues: string[] = [];
  const settlementIds = new Set(world.settlements.map(item => item.id));
  const seen = new Set<number>();
  for (const climate of state.settlements) {
    if (seen.has(climate.settlementId)) issues.push(`повтор климата поселения ${climate.settlementId}`);
    seen.add(climate.settlementId);
    if (!settlementIds.has(climate.settlementId)) issues.push(`климат ссылается на отсутствующее поселение ${climate.settlementId}`);
    for (const [name, value] of Object.entries({
      precipitation: climate.precipitation, moisture: climate.moisture, snowCover: climate.snowCover, wind: climate.wind,
      roadCondition: climate.roadCondition, harvestPressure: climate.harvestPressure, waterStress: climate.waterStress,
      diseasePressure: climate.diseasePressure, migrationPressure: climate.migrationPressure,
    })) if (!Number.isFinite(value) || value < 0 || value > 100) issues.push(`${climate.settlementId}: неверный показатель ${name}`);
  }
  for (const settlement of world.settlements) if (!seen.has(settlement.id)) issues.push(`${settlement.name}: отсутствует климат`);
  const crisisIds = new Set<string>();
  for (const crisis of state.crises) {
    if (crisisIds.has(crisis.id)) issues.push(`повтор кризиса ${crisis.id}`);
    crisisIds.add(crisis.id);
    if (!Number.isFinite(crisis.severity) || crisis.severity < 0 || crisis.severity > 100) issues.push(`${crisis.id}: неверная тяжесть`);
  }
  return [...new Set(issues)];
}

function advanceClimateTick(world: WorldState, state: ClimateSystemState, tick: number, recordEvents: boolean): void {
  const indexes = buildIndexes(world);
  const nextStates: SettlementClimateState[] = [];
  for (const settlement of world.settlements) {
    const previous = state.settlements.find(item => item.settlementId === settlement.id);
    const next = deriveSettlementClimate(world, settlement, tick, previous);
    nextStates.push(next);
    updateSettlementCrisisState(world, state, next, tick, recordEvents);
    applyConsequences(world, next, indexes, tick);
  }
  state.settlements = nextStates;
  state.lastTick = tick;
  const worldEntry = worldClimateEntry(nextStates, tick);
  state.history.push(worldEntry);
  if (state.history.length > MAX_WORLD_HISTORY) state.history.splice(0, state.history.length - MAX_WORLD_HISTORY);
  settleFadingCrises(world, state, tick, recordEvents);
  state.crises = state.crises.sort((a, b) => b.startedTick - a.startedTick).slice(0, MAX_CRISES);
}

function deriveSettlementClimate(
  world: WorldState,
  settlement: Settlement,
  tick: number,
  previous?: SettlementClimateState,
): SettlementClimateState {
  const month = tick % 12 + 1;
  const year = Math.floor(tick / 12);
  const tile = tileForSettlement(world, settlement);
  const normalizedElevation = normalizeTerrainValue(tile?.elevation ?? 0);
  const normalizedTileMoisture = normalizeTerrainValue(tile?.moisture ?? .5);
  const latitude = world.config.height <= 1 ? .5 : settlement.y / (world.config.height - 1);
  const polarDistance = Math.abs(latitude - .5) * 2;
  const terrainTemperature = terrainTemperatureOffset(tile?.terrain);
  const seasonalTemperature = Math.cos((month - 7) / 12 * Math.PI * 2) * (8 + polarDistance * 9);
  const anomaly = noise(world, settlement.id, tick, 'температура', -7, 7);
  const baseTemperature = 27 - polarDistance * 27 - normalizedElevation * 17 + terrainTemperature;
  const temperature = round(baseTemperature + seasonalTemperature + anomaly);

  const wetSeason = Math.sin((month - 2) / 12 * Math.PI * 2) * 13;
  const terrainRain = terrainPrecipitationOffset(tile?.terrain);
  const precipitation = clamp(round(normalizedTileMoisture * 58 + wetSeason + terrainRain + noise(world, settlement.id, tick, 'осадки', -22, 22)));
  const previousMoisture = previous?.moisture ?? normalizedTileMoisture * 100;
  const evaporation = Math.max(0, temperature - 12) * .55 + Math.max(0, noise(world, settlement.id, tick, 'ветер', 0, 22) - 12) * .1;
  const moisture = clamp(round(previousMoisture * .72 + precipitation * .38 - evaporation));
  const wind = clamp(round(18 + noise(world, settlement.id, tick, 'ветер', 0, 68) + (tile?.terrain === 'coast' ? 10 : 0) + (tile?.terrain === 'mountains' ? 7 : 0)));
  const snowCover = temperature < 2 ? clamp(round((previous?.snowCover ?? 0) * .65 + precipitation * .7 + Math.max(0, -temperature) * 1.5)) : clamp(round((previous?.snowCover ?? 0) - temperature * 3.2));
  const waterStress = clamp(round(100 - moisture * .82 - precipitation * .16 + Math.max(0, temperature - 28) * 2.6));
  const floodPressure = clamp(round(Math.max(0, precipitation - 65) * 1.8 + Math.max(0, moisture - 84) * 2 + (tile?.terrain === 'marsh' || tile?.terrain === 'coast' ? 9 : 0)));
  const frostPressure = clamp(round(Math.max(0, -temperature - 3) * 4 + snowCover * .18));
  const heatPressure = clamp(round(Math.max(0, temperature - 29) * 6 + waterStress * .35));
  const stormPressure = clamp(round(Math.max(0, wind - 62) * 2 + Math.max(0, precipitation - 55) * .9));
  const droughtPressure = clamp(round(waterStress * .82 + Math.max(0, 24 - precipitation) * 1.1));
  const harvestPressure = clamp(round(Math.max(droughtPressure, floodPressure, frostPressure * .75, heatPressure * .82, stormPressure * .55)));
  const roadCondition = clamp(round(100 - floodPressure * .7 - snowCover * .35 - stormPressure * .32 - Math.max(0, moisture - 78) * .4));
  const diseasePressure = clamp(round(
    Math.max(0, moisture - 58) * .55 + Math.max(0, precipitation - 52) * .35 + (temperature > 8 && temperature < 26 ? 14 : 0)
    + Math.max(0, -temperature - 8) * 1.4 + floodPressure * .25,
  ));
  const migrationPressure = clamp(round(harvestPressure * .45 + waterStress * .28 + (100 - roadCondition) * .16));
  const weather = classifyWeather({ temperature, precipitation, moisture, snowCover, wind, waterStress, floodPressure });
  const summary = weatherSummary(weather, temperature, precipitation, roadCondition, harvestPressure);
  const entry: ClimateHistoryEntry = { tick, year, month, weather, temperature, precipitation, summary };
  const history = [...(previous?.history ?? []), entry].slice(-MAX_SETTLEMENT_HISTORY);

  return {
    settlementId: settlement.id, season: seasonForMonth(month), weather, temperature, precipitation, moisture, snowCover, wind,
    roadCondition, harvestPressure, waterStress, diseasePressure, migrationPressure, anomaly: round(anomaly), lastTick: tick, history,
  };
}

function updateSettlementCrisisState(
  world: WorldState,
  state: ClimateSystemState,
  climate: SettlementClimateState,
  tick: number,
  recordEvents: boolean,
): void {
  const settlement = world.settlements.find(item => item.id === climate.settlementId);
  if (!settlement) return;
  const candidates = crisisCandidates(climate);
  const candidateKinds = new Set(candidates.map(item => item.kind));
  for (const candidate of candidates) {
    const active = state.crises.find(item => item.kind === candidate.kind && item.settlementIds.includes(settlement.id) && item.status !== 'завершён');
    if (!active) {
      const crisis: NaturalCrisis = {
        id: `climate:${candidate.kind}:${settlement.id}:${tick}`, kind: candidate.kind, settlementIds: [settlement.id], startedTick: tick,
        severity: candidate.severity, peakSeverity: candidate.severity, status: candidate.severity >= 82 ? 'пик' : 'развивается',
        cause: candidate.cause, effects: candidate.effects, history: [`${formatTick(tick)}: кризис начался, тяжесть ${Math.round(candidate.severity)}`],
      };
      state.crises.push(crisis);
      settlement.history.push(`${formatTick(tick)}: ${candidate.kind}, тяжесть ${Math.round(candidate.severity)}.`);
      if (recordEvents) addCrisisEvent(world, settlement, crisis, tick, 'начало');
      continue;
    }
    const previousPeak = active.peakSeverity;
    active.severity = round(active.severity * .38 + candidate.severity * .62);
    active.peakSeverity = Math.max(active.peakSeverity, active.severity);
    active.status = active.severity >= 82 ? 'пик' : active.severity >= 42 ? 'развивается' : 'спад';
    active.effects = candidate.effects;
    active.cause = candidate.cause;
    if (active.peakSeverity >= previousPeak + 12) {
      active.history.push(`${formatTick(tick)}: кризис усилился до ${Math.round(active.peakSeverity)}`);
      if (recordEvents && active.peakSeverity >= 78) addCrisisEvent(world, settlement, active, tick, 'усиление');
    }
  }

  for (const crisis of state.crises) {
    if (crisis.status === 'завершён' || !crisis.settlementIds.includes(settlement.id) || candidateKinds.has(crisis.kind)) continue;
    crisis.severity = clamp(round(crisis.severity - 22));
    crisis.status = crisis.severity <= 12 ? 'завершён' : 'спад';
    if (crisis.status === 'завершён') {
      crisis.endedTick = tick;
      crisis.history.push(`${formatTick(tick)}: кризис завершился`);
      settlement.history.push(`${formatTick(tick)}: последствия кризиса «${crisis.kind}» пошли на спад.`);
      if (recordEvents && crisis.peakSeverity >= 70) addCrisisEvent(world, settlement, crisis, tick, 'завершение');
    }
  }
}

function crisisCandidates(climate: SettlementClimateState): CrisisCandidate[] {
  const result: CrisisCandidate[] = [];
  const drought = Math.max(climate.waterStress, climate.weather === 'засуха' ? climate.harvestPressure : 0);
  if (drought >= 62) result.push({ kind: 'засуха', severity: drought, cause: 'долгий дефицит осадков и высокая потеря влаги', effects: ['снижается урожай', 'дорожают еда и вода', 'семьи расходуют запасы'] });
  const flood = climate.weather === 'паводок' ? Math.max(68, 100 - climate.roadCondition) : Math.max(0, climate.precipitation - 72) * 2;
  if (flood >= 62) result.push({ kind: 'паводок', severity: clamp(flood), cause: 'почва и водоёмы не приняли объём осадков', effects: ['размываются дороги', 'портятся поля и склады', 'растёт риск болезней'] });
  const frost = Math.max(0, -climate.temperature - 7) * 7 + climate.snowCover * .25;
  if (frost >= 62) result.push({ kind: 'сильный мороз', severity: clamp(frost), cause: 'температура долго держится ниже безопасного уровня', effects: ['растёт расход топлива', 'ухудшается здоровье', 'останавливаются дороги'] });
  const heat = Math.max(0, climate.temperature - 32) * 10 + climate.waterStress * .35;
  if (heat >= 62) result.push({ kind: 'аномальная жара', severity: clamp(heat), cause: 'температура и испарение превышают сезонную норму', effects: ['иссякает вода', 'падает урожай', 'люди и животные слабеют'] });
  const storm = Math.max(0, climate.wind - 68) * 4 + Math.max(0, climate.precipitation - 58) * .8;
  if (storm >= 62) result.push({ kind: 'шторм', severity: clamp(storm), cause: 'сильный ветер совпал с тяжёлыми осадками', effects: ['повреждаются здания', 'опасны дороги и торговля', 'страдают обозы'] });
  if (climate.harvestPressure >= 76) result.push({ kind: 'неурожай', severity: climate.harvestPressure, cause: 'поля пережили несколько несовместимых с урожаем условий', effects: ['сокращаются запасы зерна', 'растут цены', 'усиливаются голод и беспорядки'] });
  return result;
}

function applyConsequences(world: WorldState, climate: SettlementClimateState, indexes: ClimateIndexes, tick: number): void {
  const settlement = world.settlements.find(item => item.id === climate.settlementId);
  if (!settlement) return;
  const pressure = climate.harvestPressure;
  const severe = Math.max(pressure, climate.waterStress, 100 - climate.roadCondition);

  for (const field of indexes.fieldsBySettlement.get(settlement.id) ?? []) {
    field.moisture = clamp(round(field.moisture * .64 + climate.moisture * .36));
    field.pests = clamp(round(field.pests + (climate.temperature > 18 && climate.moisture > 62 ? climate.diseasePressure * .025 : -1.2)));
    field.weeds = clamp(round(field.weeds + (climate.moisture > 60 ? 1.5 : -.7)));
    if (ACTIVE_FIELD_STATES.has(field.state)) {
      field.expectedYield = Math.max(0, round(field.expectedYield * (1 - pressure / 100 * .045)));
      if (pressure >= 90 && deterministicChance(world, `field:${field.id}:failure`, tick, (pressure - 82) / 70)) {
        field.state = 'погибло';
        field.expectedYield = 0;
        field.history.push(`${formatTick(tick)}: посевы погибли из-за погодного кризиса.`);
      }
    }
  }

  const foodLoss = pressure >= 45 ? pressure * .028 : -Math.max(0, 35 - pressure) * .012;
  settlement.food = Math.max(0, round(settlement.food - foodLoss));
  settlement.prosperity = clamp(round(settlement.prosperity - Math.max(0, severe - 48) * .025));
  settlement.unrest = clamp(round(settlement.unrest + Math.max(0, climate.migrationPressure - 45) * .035));
  settlement.damaged = clamp(round(settlement.damaged + Math.max(0, 55 - climate.roadCondition) * .018 + (climate.weather === 'шторм' ? climate.wind * .012 : 0)));
  syncShortage(settlement, 'вода', climate.waterStress >= 62, climate.waterStress <= 28);
  syncShortage(settlement, 'еда', pressure >= 68 || settlement.food < 24, pressure <= 30 && settlement.food > 42);

  const priceShock = Math.max(0, pressure - 35) * .0012 + Math.max(0, climate.waterStress - 55) * .0007;
  settlement.economy.priceIndex = clampRange(round(settlement.economy.priceIndex * (1 + priceShock)), .25, 8);
  for (const [key, value] of Object.entries(settlement.economy.prices)) {
    if (!isClimateSensitiveGood(key)) continue;
    settlement.economy.prices[key] = Math.max(.01, round(value * (1 + priceShock * 1.35)));
  }

  for (const household of indexes.householdsBySettlement.get(settlement.id) ?? []) {
    if (pressure >= 48) household.foodReserveDays = Math.max(0, round(household.foodReserveDays - pressure / 34));
    if (climate.temperature < -5) household.fuelReserveDays = Math.max(0, round(household.fuelReserveDays - Math.abs(climate.temperature) / 16));
    household.needs.hunger = clamp(round(household.needs.hunger + Math.max(0, pressure - 52) * .035));
    household.needs.thirst = clamp(round(household.needs.thirst + Math.max(0, climate.waterStress - 48) * .05));
    household.needs.warmth = clamp(round(household.needs.warmth + Math.max(0, -climate.temperature - 4) * .45));
    if (climate.migrationPressure >= 74 && !household.history.at(-1)?.includes('покинуть поселение')) household.history.push(`${formatTick(tick)}: семья обсуждает возможность покинуть поселение из-за погоды и нехватки запасов.`);
  }

  for (const character of indexes.charactersBySettlement.get(settlement.id) ?? []) {
    character.needs.thirst = clamp(round(character.needs.thirst + Math.max(0, climate.waterStress - 55) * .025));
    character.needs.warmth = clamp(round(character.needs.warmth + Math.max(0, -climate.temperature - 6) * .22));
    if (climate.diseasePressure >= 75 || climate.temperature <= -15 || climate.temperature >= 39) {
      character.health = clamp(round(character.health - Math.max(0, severe - 68) * .012));
    }
  }

  const processedRoutes = new Set<number>();
  for (const route of indexes.routesBySettlement.get(settlement.id) ?? []) {
    if (processedRoutes.has(route.id)) continue;
    processedRoutes.add(route.id);
    const roadPenalty = Math.max(0, 62 - climate.roadCondition);
    route.safety = clamp(round(route.safety - roadPenalty * .025));
    route.volume = Math.max(0, round(route.volume * (1 - roadPenalty * .0018)));
    if (roadPenalty >= 35 && !route.history.at(-1)?.includes(formatTick(tick))) route.history.push(`${formatTick(tick)}: перевозки замедлились из-за ${climate.weather}.`);
  }

  for (const army of world.armies.filter(item => item.x === settlement.x && item.y === settlement.y)) {
    const logisticsPenalty = Math.max(0, 55 - climate.roadCondition) + Math.max(0, climate.waterStress - 65);
    army.supplies = clamp(round(army.supplies - logisticsPenalty * .02));
    army.morale = clamp(round(army.morale - logisticsPenalty * .012));
    army.readiness = clamp(round(army.readiness - logisticsPenalty * .016));
    if (logisticsPenalty >= 42) army.campaignHistory.push(`${formatTick(tick)}: погода нарушила снабжение армии.`);
  }

  for (const population of world.animalPopulations.filter(item => item.x === settlement.x && item.y === settlement.y)) {
    const ecologyPenalty = Math.max(climate.waterStress, climate.harvestPressure) - 58;
    if (ecologyPenalty <= 0) continue;
    population.health = clamp(round(population.health - ecologyPenalty * .035));
    population.count = Math.max(0, Math.round(population.count * (1 - ecologyPenalty * .0007)));
    population.migrationDrive = clamp(round(population.migrationDrive + ecologyPenalty * .08));
    population.lastCause = `${climate.weather} и нехватка кормов`;
  }

  for (const ingredient of world.ingredients.filter(item => item.x === settlement.x && item.y === settlement.y)) {
    if (ingredient.kind === 'минерал') continue;
    const resourcePenalty = Math.max(0, pressure - 45);
    ingredient.abundance = Math.max(0, round(ingredient.abundance * (1 - resourcePenalty * .0008)));
  }
}

function settleFadingCrises(world: WorldState, state: ClimateSystemState, tick: number, recordEvents: boolean): void {
  for (const crisis of state.crises) {
    if (crisis.status !== 'спад' || crisis.severity > 12) continue;
    crisis.status = 'завершён';
    crisis.endedTick = tick;
    const settlement = world.settlements.find(item => item.id === crisis.settlementIds[0]);
    if (settlement && recordEvents && crisis.peakSeverity >= 70) addCrisisEvent(world, settlement, crisis, tick, 'завершение');
  }
}

function addCrisisEvent(world: WorldState, settlement: Settlement, crisis: NaturalCrisis, tick: number, phase: 'начало' | 'усиление' | 'завершение'): void {
  const { year, month } = tickDate(tick);
  const title = phase === 'завершение'
    ? `${capitalize(crisis.kind)} в ${settlement.name} завершился`
    : phase === 'усиление'
      ? `${capitalize(crisis.kind)} усиливается в ${settlement.name}`
      : `${CapitalizeWeather(crisis.kind)} в ${settlement.name}`;
  if (world.events.some(event => event.year === year && event.month === month && event.title === title)) return;
  world.nextIds.event ??= Math.max(0, ...world.events.map(event => event.id)) + 1;
  const refs = [{ kind: 'settlement' as const, id: settlement.id }, { kind: 'kingdom' as const, id: settlement.kingdomId }];
  const severity = Math.round(phase === 'завершение' ? crisis.peakSeverity : crisis.severity);
  world.events.push({
    id: world.nextIds.event++, year, month, kind: 'disaster', title,
    description: phase === 'завершение'
      ? `После тяжести ${Math.round(crisis.peakSeverity)} природный кризис пошёл на спад.`
      : `${crisis.cause}. Текущая тяжесть: ${severity}.`,
    cause: crisis.cause,
    conditions: [`поселение ${settlement.name}`, `тяжесть ${severity}`, `фаза ${phase}`],
    decision: 'жители, торговцы и власти приспосабливаются к условиям',
    outcome: phase === 'завершение' ? 'условия стабилизировались, но последствия остались' : crisis.effects.join('; '),
    consequences: crisis.effects,
    traces: refs,
    entityRefs: refs,
    importance: severity >= 88 ? 4 : severity >= 72 ? 3 : 2,
  });
}

function buildIndexes(world: WorldState): ClimateIndexes {
  return {
    fieldsBySettlement: groupBy(world.fields, item => item.settlementId),
    householdsBySettlement: groupBy(world.households, item => item.settlementId),
    charactersBySettlement: groupBy(world.characters.filter(item => item.alive), item => item.settlementId),
    routesBySettlement: routesBySettlement(world.tradeRoutes),
  };
}

function normalizeClimateState(world: WorldState, state: ClimateSystemState): void {
  state.version = 1;
  state.history ??= [];
  state.crises ??= [];
  const bySettlement = new Map(state.settlements?.map(item => [item.settlementId, item]) ?? []);
  state.settlements = world.settlements.map(settlement => {
    const current = bySettlement.get(settlement.id);
    if (!current) return deriveSettlementClimate(world, settlement, state.lastTick || worldTick(world), undefined);
    current.history ??= [];
    current.season ??= seasonForMonth(world.month);
    current.lastTick ??= state.lastTick || worldTick(world);
    current.roadCondition = clamp(current.roadCondition ?? 100);
    current.harvestPressure = clamp(current.harvestPressure ?? 0);
    current.waterStress = clamp(current.waterStress ?? 0);
    current.diseasePressure = clamp(current.diseasePressure ?? 0);
    current.migrationPressure = clamp(current.migrationPressure ?? 0);
    return current;
  });
  state.lastTick = Math.min(worldTick(world), state.lastTick ?? worldTick(world));
}

function worldClimateEntry(states: SettlementClimateState[], tick: number): ClimateHistoryEntry {
  const { year, month } = tickDate(tick);
  const temperature = average(states.map(item => item.temperature));
  const precipitation = average(states.map(item => item.precipitation));
  const worst = [...states].sort((a, b) => Math.max(b.harvestPressure, b.waterStress, 100 - b.roadCondition) - Math.max(a.harvestPressure, a.waterStress, 100 - a.roadCondition))[0];
  return {
    tick, year, month, weather: worst?.weather ?? 'ясно', temperature, precipitation,
    summary: worst ? `Самые тяжёлые условия: поселение №${worst.settlementId}, ${worst.weather}.` : 'Климат спокоен.',
  };
}

function classifyWeather(values: { temperature: number; precipitation: number; moisture: number; snowCover: number; wind: number; waterStress: number; floodPressure: number }): WeatherKind {
  if (values.floodPressure >= 68) return 'паводок';
  if (values.wind >= 78 && values.precipitation >= 55) return 'шторм';
  if (values.temperature <= -12 && values.wind >= 58 && values.snowCover >= 35) return 'метель';
  if (values.temperature <= -10) return 'мороз';
  if (values.temperature <= 1 && values.precipitation >= 34) return 'снег';
  if (values.temperature >= 36) return 'жара';
  if (values.waterStress >= 72 && values.precipitation <= 24) return 'засуха';
  if (values.precipitation >= 72) return 'ливень';
  if (values.precipitation >= 42) return 'дождь';
  if (values.precipitation >= 22) return 'облачно';
  return 'ясно';
}

function weatherSummary(weather: WeatherKind, temperature: number, precipitation: number, roadCondition: number, harvestPressure: number): string {
  const tail = harvestPressure >= 65 ? ' Урожай под угрозой.' : roadCondition <= 45 ? ' Дороги тяжело проходимы.' : '';
  return `${weather}: ${temperature > 0 ? '+' : ''}${Math.round(temperature)}°, осадки ${Math.round(precipitation)}%, дороги ${Math.round(roadCondition)}%.${tail}`;
}

function tileForSettlement(world: WorldState, settlement: Settlement): Tile | undefined {
  return world.tiles[settlement.y * world.config.width + settlement.x] ?? world.tiles.find(item => item.x === settlement.x && item.y === settlement.y);
}

function terrainTemperatureOffset(terrain?: Tile['terrain']): number {
  return ({ ocean: -2, coast: 0, plains: 2, forest: -1, hills: -2, mountains: -8, marsh: 0, desert: 8, tundra: -11 } as const)[terrain ?? 'plains'];
}

function terrainPrecipitationOffset(terrain?: Tile['terrain']): number {
  return ({ ocean: 18, coast: 15, plains: 0, forest: 13, hills: 2, mountains: 8, marsh: 20, desert: -28, tundra: -8 } as const)[terrain ?? 'plains'];
}

function syncShortage(settlement: Settlement, name: string, add: boolean, remove: boolean): void {
  if (add && !settlement.shortages.includes(name)) settlement.shortages.push(name);
  if (remove) settlement.shortages = settlement.shortages.filter(item => item !== name);
}

function routesBySettlement(routes: TradeRoute[]): Map<number, TradeRoute[]> {
  const result = new Map<number, TradeRoute[]>();
  for (const route of routes) {
    for (const settlementId of [route.fromSettlementId, route.toSettlementId]) {
      const list = result.get(settlementId) ?? [];
      list.push(route);
      result.set(settlementId, list);
    }
  }
  return result;
}

function groupBy<T>(items: T[], key: (item: T) => number): Map<number, T[]> {
  const result = new Map<number, T[]>();
  for (const item of items) {
    const id = key(item);
    const list = result.get(id) ?? [];
    list.push(item);
    result.set(id, list);
  }
  return result;
}

function isClimateSensitiveGood(key: string): boolean {
  const value = key.toLowerCase();
  return ['food', 'bread', 'grain', 'wheat', 'barley', 'rye', 'water', 'еда', 'хлеб', 'зерно', 'пшени', 'ячм', 'рожь', 'овощ', 'вода', 'топливо', 'дров'].some(part => value.includes(part));
}

function deterministicChance(world: WorldState, key: string, tick: number, probability: number): boolean {
  return (hashSeed(`${world.config.seed}:${key}:${tick}`) % 10_000) / 10_000 < Math.max(0, Math.min(1, probability));
}

function noise(world: WorldState, settlementId: number, tick: number, key: string, min: number, max: number): number {
  const fraction = (hashSeed(`${world.config.seed}:climate:${settlementId}:${tick}:${key}`) % 100_000) / 99_999;
  return min + (max - min) * fraction;
}

function normalizeTerrainValue(value: number): number {
  if (!Number.isFinite(value)) return .5;
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
}

function tickDate(tick: number): { year: number; month: number } {
  return { year: Math.floor(tick / 12), month: tick % 12 + 1 };
}

function formatTick(tick: number): string {
  const { year, month } = tickDate(tick);
  return `${year}.${String(month).padStart(2, '0')}`;
}

function average(values: number[]): number {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
function CapitalizeWeather(value: string): string { return capitalize(value); }
function round(value: number): number { return Math.round(value * 100) / 100; }
function clamp(value: number): number { return Math.max(0, Math.min(100, value)); }
function clampRange(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
