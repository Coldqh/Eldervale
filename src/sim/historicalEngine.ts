import type {
  Artifact, Character, CausalEventInput, FallenRealm, HistoricalEraKind, HistoricalEraSummary,
  Kingdom, Settlement, Species, War, WorldConfig, WorldEvent, WorldState,
} from '../types';
import { causalEvent } from './causality';
import { generateWorld, type GenerationProgressReporter } from './generator';
import { inspectWorldIntegrity } from './integrity';
import { personName, placeName } from './names';
import { RNG } from './rng';
import { generatePhysicalEconomy } from './materialEconomy';
import { initializeAgricultureAndConstruction } from './agricultureConstruction';
import { advanceHistoricalTerritories, captureTerritoryAroundSettlement, initializeTerritorialHistory } from './territory';
import { compactDeadEntities, ensureCemeteries, synchronizeMortalityIds } from './mortality';

interface EraPlan {
  kind: HistoricalEraKind;
  name: string;
  startYear: number;
  endYear: number;
  stepYears: number;
}

export function generateHistoricalWorld(config: WorldConfig, onProgress?: GenerationProgressReporter): WorldState {
  const base = generateWorld(config, (phase, completed, total, detail) => {
    const scaled = Math.round(completed / Math.max(1, total) * 34);
    onProgress?.(phase, scaled, 100, detail);
  });
  onProgress?.('Подготовка настоящей истории', 35, 100, 'Сводим основания, династии и древние следы');
  return buildHistoricalTimeline(base, config, onProgress);
}

export function buildHistoricalTimeline(world: WorldState, config: WorldConfig, onProgress?: GenerationProgressReporter): WorldState {
  const rng = new RNG(`${config.seed}:исторический-движок-v1`);
  const presentYear = Math.max(1, config.historyYears);
  world.events = [];
  world.wars = [];
  world.nextIds.event = 1;
  world.nextIds.war = 1;
  world.year = presentYear;
  world.month = 1;
  initializeTerritorialHistory(world);

  const foundationalIds = seedFoundations(world, rng);
  const fallenRealms = createFallenRealms(world, rng, presentYear);
  const plans = eraPlans(presentYear);
  const eras: HistoricalEraSummary[] = [];
  const totalSteps = plans.reduce((sum, plan) => sum + Math.max(1, Math.ceil((plan.endYear - plan.startYear + 1) / plan.stepYears)), 0);
  let completedSteps = 0;

  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index]!;
    const eraEventIds: number[] = [];
    for (let year = plan.startYear; year <= plan.endYear; year += plan.stepYears) {
      const span = Math.min(plan.stepYears, plan.endYear - year + 1);
      advanceHistoricalTerritories(world, new RNG(`${config.seed}:границы:${year}:${span}`), year, span);
      const created = simulateHistoricalPeriod(world, rng, year, span, plan.kind);
      eraEventIds.push(...created);
      completedSteps += 1;
      const progress = 36 + Math.round(completedSteps / Math.max(1, totalSteps) * 55);
      onProgress?.(`История: ${plan.name}`, progress, 100, `${year}–${Math.min(plan.endYear, year + span - 1)} годы · событий ${world.events.length}`);
    }
    eras.push({
      id: index + 1,
      kind: plan.kind,
      name: plan.name,
      startYear: plan.startYear,
      endYear: plan.endYear,
      stepYears: plan.stepYears,
      eventIds: eraEventIds,
      summary: summarizeEra(world, plan, eraEventIds),
    });
  }

  onProgress?.('Связывание книг, артефактов и руин', 89, 100, 'Источники получают реальные события и владельцев');
  linkKnowledgeAndArtifacts(world, rng);
  generatePhysicalEconomy(world, new RNG(`${config.seed}:повседневная-жизнь-v1`), (phase, percent, detail) => {
    onProgress?.(phase, 90 + Math.round(percent * .055), 100, detail);
  });
  onProgress?.('Поля и строительные цепочки', 96, 100, 'размечаем пашни, семенные запасы и реальные стройматериалы');
  initializeAgricultureAndConstruction(world, new RNG(`${config.seed}:земледелие-и-стройка-v1`));
  onProgress?.('Кладбища и архив павших', 98, 100, 'переносим умерших и убитых существ из активной симуляции');
  ensureCemeteries(world, rng);
  compactDeadEntities(world, rng);
  world.events.sort((a, b) => a.year - b.year || a.month - b.month || a.id - b.id);
  const landmarkEventIds = [...world.events]
    .sort((a, b) => b.importance - a.importance || b.year - a.year || b.id - a.id)
    .slice(0, 32)
    .map(event => event.id);

  const report = inspectWorldIntegrity(world);
  world.history = {
    engineVersion: 1,
    generatedYears: presentYear,
    eras,
    landmarkEventIds: [...new Set([...foundationalIds, ...landmarkEventIds])].slice(0, 40),
    fallenRealms,
    compressedEventCount: estimateCompressedEvents(config, totalSteps),
    logicWarnings: [...report.errors, ...report.warnings].slice(0, 40),
  };
  world.nextIds.event = Math.max(0, ...world.events.map(event => event.id)) + 1;
  world.nextIds.war = Math.max(0, ...world.wars.map(war => war.id)) + 1;
  synchronizeMortalityIds(world);
  world.nextIds.artifact = Math.max(0, ...world.artifacts.map(artifact => artifact.id)) + 1;
  world.nextIds.book = Math.max(0, ...world.books.map(book => book.id)) + 1;
  world.version = 11;
  onProgress?.('Живой мир готов', 100, 100, `${world.events.length} подробных событий · ${world.history.compressedEventCount} обычных изменений сведены в хроники`);
  return world;
}

function eraPlans(years: number): EraPlan[] {
  if (years <= 120) return [
    { kind: 'династическая эпоха', name: 'Эпоха становления держав', startYear: 1, endYear: Math.max(1, years - 30), stepYears: 3 },
    { kind: 'современная эпоха', name: 'Живая память поколений', startYear: Math.max(1, years - 29), endYear: years, stepYears: 1 },
  ];
  const ancientEnd = Math.max(20, years - 220);
  const formationEnd = Math.max(ancientEnd + 1, years - 100);
  const dynasticEnd = Math.max(formationEnd + 1, years - 30);
  const plans: EraPlan[] = [
    { kind: 'древняя эпоха', name: 'Древние века', startYear: 1, endYear: ancientEnd, stepYears: years > 500 ? 20 : 10 },
    { kind: 'эпоха становления', name: 'Становление королевств', startYear: ancientEnd + 1, endYear: formationEnd, stepYears: 5 },
    { kind: 'династическая эпоха', name: 'Век династий и великих войн', startYear: formationEnd + 1, endYear: dynasticEnd, stepYears: 2 },
    { kind: 'современная эпоха', name: 'Последние поколения', startYear: dynasticEnd + 1, endYear: years, stepYears: 1 },
  ];
  return plans.filter(plan => plan.startYear <= plan.endYear);
}

function seedFoundations(world: WorldState, rng: RNG): number[] {
  const ids: number[] = [];
  for (const kingdom of world.kingdoms) {
    const capital = settlement(world, kingdom.capitalId);
    ids.push(addHistoricalEvent(world, Math.max(1, kingdom.foundedYear), rng.int(1, 12), {
      kind: 'politics',
      title: `Основано государство ${kingdom.name}`,
      description: `${kingdom.culture} объединила земли вокруг ${capital?.name ?? 'первой крепости'}.`,
      cause: 'местным владениям требовались общая защита, законы и контроль дорог',
      conditions: [`в регионе существовали устойчивые поселения`, `правящий дом собрал сторонников и припасы`],
      decision: 'вожди, жрецы и землевладельцы признали единую власть',
      outcome: `возникло государство ${kingdom.name}`,
      consequences: ['появились постоянные налоги и армия', 'границы получили политическое значение'],
      entityRefs: [{ kind: 'kingdom', id: kingdom.id }, ...(capital ? [{ kind: 'settlement' as const, id: capital.id }] : [])],
      importance: 5,
    }).id);
  }
  for (const place of world.settlements) {
    ids.push(addHistoricalEvent(world, Math.max(1, place.foundedYear), rng.int(1, 12), {
      kind: 'settlement', title: `Основан ${place.name}`, description: `Первые семьи закрепились у ресурса «${place.resource}».`,
      cause: `доступ к ресурсу «${place.resource}», воде и защищаемой земле`,
      conditions: ['существовал путь снабжения', 'окрестности могли прокормить первые домохозяйства'],
      decision: 'поселенцы построили жильё, склады и укреплённый центр', outcome: `${place.name} стал постоянным поселением`,
      consequences: ['началось освоение окрестных клеток', 'возник рынок труда и пищи'],
      entityRefs: [{ kind: 'settlement', id: place.id }, { kind: 'kingdom', id: place.kingdomId }], importance: place.type === 'city' ? 4 : 3,
    }).id);
  }
  return ids;
}

function createFallenRealms(world: WorldState, rng: RNG, presentYear: number): FallenRealm[] {
  const count = Math.max(1, Math.min(6, Math.round(world.kingdoms.length * .7)));
  const result: FallenRealm[] = [];
  for (let index = 0; index < count; index += 1) {
    const successor = rng.pick(world.kingdoms);
    const foundedYear = rng.int(1, Math.max(2, Math.floor(presentYear * .45)));
    const fallenYear = rng.int(Math.min(presentYear - 1, foundedYear + 12), Math.max(foundedYear + 12, presentYear - 25));
    const capitalName = placeName(rng);
    const causeOfFall = rng.pick(['война наследников', 'голод после изменения рек', 'натиск чудовищ', 'распад торговых путей', 'религиозный раскол', 'восстание зависимых земель']);
    const tile = rng.pick(world.tiles.filter(tile => tile.terrain !== 'ocean'));
    const dungeonId = Math.max(0, ...world.dungeons.map(dungeon => dungeon.id)) + 1;
    world.dungeons.push({
      id: dungeonId, name: `Руины ${capitalName}`, x: tile.x, y: tile.y, origin: 'столица исчезнувшего государства',
      purpose: 'дворец, архивы, подземные склады и городские святилища', builtYear: foundedYear,
      danger: rng.int(3, 9), depth: rng.int(1, 4), currentInhabitants: rng.pick(['разбойники', 'нежить', 'дикие звери', 'культ древних машин', 'никто']),
      ownerKingdomId: successor.id, discovered: rng.chance(.72), artifactIds: [],
      history: [`Город основан в ${foundedYear} году.`, `Государство погибло в ${fallenYear} году: ${causeOfFall}.`],
    });
    tile.dungeonId ??= dungeonId;
    const realm: FallenRealm = {
      id: index + 1, name: `Держава ${placeName(rng)}`, species: rng.pick(['human', 'elf', 'orc', 'dwarf'] as Species[]),
      foundedYear, fallenYear, capitalName, causeOfFall, successorKingdomId: successor.id, ruinDungeonId: dungeonId,
    };
    result.push(realm);
    addHistoricalEvent(world, foundedYear, rng.int(1, 12), {
      kind: 'politics', title: `Возникла ${realm.name}`, description: `${realm.capitalName} стал центром древней державы.`,
      cause: 'богатая земля и военная власть позволили подчинить соседние владения', consequences: ['возникла древняя граница', 'началось строительство столицы'],
      entityRefs: [{ kind: 'dungeon', id: dungeonId }, { kind: 'kingdom', id: successor.id }], importance: 4,
    });
    addHistoricalEvent(world, fallenYear, rng.int(1, 12), {
      kind: 'disaster', title: `Пала ${realm.name}`, description: `${realm.capitalName} был оставлен после причины: ${causeOfFall}.`,
      cause: causeOfFall, conditions: ['власть потеряла способность защищать и снабжать столицу'],
      decision: 'оставшиеся жители бежали, подчинились победителям или укрылись в глубине руин', outcome: `держава исчезла, а ${capitalName} превратился в руины`,
      consequences: ['появился древний комплекс', 'сокровища и знания оказались потеряны', 'соседние народы заняли освободившиеся земли'],
      entityRefs: [{ kind: 'dungeon', id: dungeonId }, { kind: 'kingdom', id: successor.id }], traces: [{ kind: 'dungeon', id: dungeonId }], importance: 5,
    });
  }
  return result;
}

function simulateHistoricalPeriod(world: WorldState, rng: RNG, year: number, span: number, era: HistoricalEraKind): number[] {
  const created: number[] = [];
  const intensity = era === 'древняя эпоха' ? 1 : era === 'эпоха становления' ? 2 : 3;
  const attempts = Math.max(1, Math.round(intensity + world.config.warlike * 2 + world.config.monsterDensity * .55));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const roll = rng.next();
    if (roll < .22 * world.config.warlike) created.push(...historicalWar(world, rng, year, span));
    else if (roll < .37) created.push(...monsterAndHero(world, rng, year, span));
    else if (roll < .52) created.push(historicalMigration(world, rng, year, span));
    else if (roll < .66) created.push(tradeAndCraft(world, rng, year, span));
    else if (roll < .79) created.push(dynasticEvent(world, rng, year, span));
    else if (roll < .9) created.push(religiousOrCulturalEvent(world, rng, year, span));
    else created.push(disasterOrRecovery(world, rng, year, span));
  }
  return created.filter((id): id is number => typeof id === 'number');
}

function historicalWar(world: WorldState, rng: RNG, year: number, span: number): number[] {
  if (world.kingdoms.length < 2) return [];
  const attacker = rng.pick(world.kingdoms);
  const defender = rng.pick(world.kingdoms.filter(item => item.id !== attacker.id));
  const targets = world.settlements.filter(item => item.kingdomId === defender.id);
  if (!targets.length) return [];
  const target = [...targets].sort((a, b) => distanceToCapital(world, attacker, a) - distanceToCapital(world, attacker, b))[0]!;
  const startYear = clampYear(year + rng.int(0, Math.max(0, span - 1)), world.year);
  const endYear = clampYear(startYear + rng.int(1, Math.max(1, Math.min(8, span + 2))), world.year);
  const cause = rng.pick(['спор за речную переправу', `контроль над ресурсом «${target.resource}»`, 'династическое притязание', 'набеги на пограничные земли', 'неуплаченные пошлины', 'убийство посланника']);
  const attackerPower = attacker.armyStrength + attacker.treasury / 15 + attacker.aggression * 2 + rng.int(0, 180);
  const defenderPower = defender.armyStrength + defender.treasury / 15 + defender.stability * 2 + target.defense * 2 + rng.int(0, 180);
  const victor = attackerPower > defenderPower ? attacker : defender;
  const war: War = {
    id: world.nextIds.war++, name: `${rng.pick(['Пограничная', 'Королевская', 'Железная', 'Речная', 'Наследственная'])} война ${attacker.name} и ${defender.name}`,
    attackerId: attacker.id, defenderId: defender.id, startYear, endYear, active: false, cause,
    goal: `добиться контроля над ${target.name}`, contestedSettlementIds: [target.id], battles: rng.int(1, 8),
    attackerLosses: rng.int(20, 640), defenderLosses: rng.int(20, 640), victorId: victor.id,
    peaceTerms: victor.id === attacker.id ? `${target.name} признал власть ${attacker.name}` : `${attacker.name} отказалось от притязаний`, history: [],
  };
  war.history.push(`Война началась в ${startYear} году: ${cause}.`, `Завершилась в ${endYear} году: ${war.peaceTerms}.`);
  world.wars.push(war);
  if (victor.id === attacker.id && rng.chance(.38)) {
    target.kingdomId = attacker.id;
    captureTerritoryAroundSettlement(world, target, attacker.id, endYear, rng, Math.max(4, Math.min(10, 4 + Math.floor(attacker.armyStrength / 140))));
    target.history.push(`В ${endYear} году власть перешла к государству ${attacker.name}.`);
  }
  const start = addHistoricalEvent(world, startYear, rng.int(1, 12), {
    kind: 'war', title: `Началась ${war.name}`, description: `${attacker.name} направило армии против ${defender.name}.`, cause,
    conditions: [`правитель ${attacker.name} считал выгоду выше риска`, `${target.name} имел военное или хозяйственное значение`],
    decision: `двор ${attacker.name} приказал собрать войско`, outcome: `армии вступили в борьбу за ${target.name}`,
    consequences: ['дороги стали опаснее', 'налоги и рекрутские наборы выросли', 'торговля между сторонами сократилась'],
    entityRefs: [{ kind: 'war', id: war.id }, { kind: 'kingdom', id: attacker.id }, { kind: 'kingdom', id: defender.id }, { kind: 'settlement', id: target.id }], importance: 5,
  });
  const end = addHistoricalEvent(world, endYear, rng.int(1, 12), {
    kind: 'battle', title: `Завершилась ${war.name}`, description: war.peaceTerms ?? 'Стороны заключили мир.',
    cause: 'потери, истощение припасов и исход решающих сражений', conditions: [`война длилась ${Math.max(1, endYear - startYear)} лет`],
    decision: 'победитель продиктовал мир, проигравший признал прекращение походов', outcome: war.peaceTerms ?? 'война закончилась',
    consequences: ['границы и претензии изменились', 'ветераны и беженцы вернулись в поселения'],
    entityRefs: [{ kind: 'war', id: war.id }, { kind: 'kingdom', id: victor.id }, { kind: 'settlement', id: target.id }], importance: 5,
  });
  return [start.id, end.id];
}

function monsterAndHero(world: WorldState, rng: RNG, year: number, span: number): number[] {
  const candidates = world.monsters.filter(monster => monster.alive && (monster.tier === 'boss' || monster.tier === 'miniboss' || monster.species === 'dragon'));
  if (!candidates.length) return [];
  const monster = rng.pick(candidates);
  const target = nearestSettlement(world, monster.x, monster.y);
  if (!target) return [];
  const attackYear = clampYear(year + rng.int(0, Math.max(0, span - 1)), world.year);
  const kingdom = world.kingdoms.find(item => item.id === target.kingdomId)!;
  const attack = addHistoricalEvent(world, attackYear, rng.int(1, 12), {
    kind: monster.species === 'dragon' ? 'dragon' : 'monster', title: `${monster.name} напал на ${target.name}`,
    description: `Существо вышло из логова, уничтожило припасы и убило жителей на окраинах.`,
    cause: rng.pick(['голод', 'расширение территории', 'поиск сокровищ', 'месть охотникам', 'разрушение прежнего логова']),
    conditions: [`${target.name} находился в пределах досягаемости`, `местная защита не могла гарантировать безопасность`],
    decision: `${monster.name} выбрал поселение целью`, outcome: `${target.name} понёс потери и потребовал помощи`,
    consequences: ['торговые пути опустели', 'правитель объявил награду', 'часть жителей покинула опасный район'],
    entityRefs: [{ kind: 'monster', id: monster.id }, { kind: 'settlement', id: target.id }, { kind: 'kingdom', id: kingdom.id }], importance: monster.tier === 'boss' ? 5 : 4,
  });
  const hero = createHistoricalFigure(world, rng, target, kingdom, attackYear, 'герой охоты на чудовищ');
  const heroPower = 45 + hero.renown + rng.int(0, 90);
  const monsterPower = monster.power + monster.health / 3 + rng.int(0, 90);
  const victory = heroPower > monsterPower && rng.chance(.58);
  const resolutionYear = clampYear(attackYear + rng.int(0, Math.max(1, Math.min(3, span))), world.year);
  if (victory) {
    monster.alive = false;
    monster.health = 0;
    monster.history.push(`В ${resolutionYear} году убит героем ${hero.name}.`);
    hero.kills += 1;
    hero.renown = Math.max(hero.renown, 82);
    hero.biography.push(`Убил существо ${monster.name}.`);
  } else {
    hero.alive = false;
    hero.deathYear = resolutionYear;
    hero.biography.push(`Погиб во время охоты на ${monster.name}.`);
    monster.kills += 1;
    monster.history.push(`В ${resolutionYear} году пережил поход героя ${hero.name}.`);
  }
  const resolution = addHistoricalEvent(world, resolutionYear, rng.int(1, 12), {
    kind: 'hero', title: victory ? `${hero.name} победил ${monster.name}` : `${hero.name} погиб у логова ${monster.name}`,
    description: victory ? `Отряд добрался до логова и уничтожил угрозу.` : `Поход закончился гибелью героя и его людей.`,
    cause: `правитель ${kingdom.name} ответил на нападение и награду`,
    conditions: [`герой собрал сведения, припасы и проводников`, `${monster.name} оставался в своей территории`],
    decision: `${hero.name} принял поручение и отправился к логову`, outcome: victory ? 'существо погибло' : 'существо сохранило логово',
    consequences: victory ? ['дороги вновь открылись', 'добыча из логова перешла победителям', 'имя героя вошло в хроники'] : ['награда выросла', 'в логове осталось снаряжение погибших', 'страх жителей усилился'],
    entityRefs: [{ kind: 'character', id: hero.id }, { kind: 'monster', id: monster.id }, { kind: 'settlement', id: target.id }], importance: 5,
  });
  return [attack.id, resolution.id];
}

function historicalMigration(world: WorldState, rng: RNG, year: number, span: number): number {
  const from = rng.pick(world.settlements);
  const destinations = world.settlements.filter(item => item.id !== from.id && item.residentialCapacity > item.population && item.kingdomId === from.kingdomId);
  const to = destinations.length ? rng.pick(destinations) : rng.pick(world.settlements.filter(item => item.id !== from.id));
  const amount = rng.int(8, Math.max(10, Math.min(140, Math.round(from.population * .12))));
  const eventYear = clampYear(year + rng.int(0, Math.max(0, span - 1)), world.year);
  const cause = rng.pick(['неурожай', 'нехватка земли', 'религиозный конфликт', 'последствия войны', 'новые ремесленные работы', 'опасность чудовищ']);
  from.history.push(`В ${eventYear} году часть семей ушла в ${to.name}: ${cause}.`);
  return addHistoricalEvent(world, eventYear, rng.int(1, 12), {
    kind: 'migration', title: `Переселение из ${from.name} в ${to.name}`, description: `${amount} жителей и их семьи сменили место жизни.`,
    cause, conditions: [`в ${from.name} возникло устойчивое давление`, `${to.name} мог принять новых работников`],
    decision: 'семьи выбрали переселение вместо ожидания дальнейшего ухудшения', outcome: `новые жители прибыли в ${to.name}`,
    consequences: ['изменилась численность рабочих рук', 'культуры и семейные связи смешались', 'на дороге появились новые стоянки'],
    entityRefs: [{ kind: 'settlement', id: from.id }, { kind: 'settlement', id: to.id }], importance: 2,
  }).id;
}

function tradeAndCraft(world: WorldState, rng: RNG, year: number, span: number): number {
  const route = rng.pick(world.tradeRoutes);
  const from = settlement(world, route.fromSettlementId)!;
  const to = settlement(world, route.toSettlementId)!;
  const eventYear = clampYear(year + rng.int(0, Math.max(0, span - 1)), world.year);
  const flourishing = rng.chance(.68);
  route.history.push(flourishing ? `В ${eventYear} году путь пережил торговый подъём.` : `В ${eventYear} году путь временно пришёл в упадок.`);
  return addHistoricalEvent(world, eventYear, rng.int(1, 12), {
    kind: 'trade', title: flourishing ? `Расцвёл путь ${route.name}` : `Ослаб путь ${route.name}`,
    description: flourishing ? `Караваны увеличили перевозки ${route.goods.join(' и ')}.` : 'Караваны сократили движение, склады опустели.',
    cause: flourishing ? 'спрос на товары, безопасность дорог и урожай' : rng.pick(['война', 'разбойники', 'обвал моста', 'падёж вьючных животных', 'нападения чудовищ']),
    conditions: [`маршрут связывал ${from.name} и ${to.name}`], decision: flourishing ? 'купцы объединили охрану и вложились в караваны' : 'купцы выбрали обходные пути',
    outcome: flourishing ? 'объём торговли вырос' : 'объём торговли временно упал',
    consequences: flourishing ? ['богатство поселений выросло', 'мастера получили сырьё'] : ['цены выросли', 'местные запасы стали важнее'],
    entityRefs: [{ kind: 'tradeRoute', id: route.id }, { kind: 'settlement', id: from.id }, { kind: 'settlement', id: to.id }], importance: flourishing ? 2 : 3,
  }).id;
}

function dynasticEvent(world: WorldState, rng: RNG, year: number, span: number): number {
  const dynasty = rng.pick(world.dynasties);
  const kingdom = dynasty.kingdomId ? world.kingdoms.find(item => item.id === dynasty.kingdomId) : rng.pick(world.kingdoms);
  const capital = settlement(world, kingdom?.capitalId ?? rng.pick(world.settlements).id)!;
  const eventYear = clampYear(year + rng.int(0, Math.max(0, span - 1)), world.year);
  const figure = createHistoricalFigure(world, rng, capital, kingdom, eventYear, rng.pick(['регент', 'воевода', 'наследник', 'королева', 'мятежный князь']));
  dynasty.memberIds.push(figure.id);
  dynasty.history.push(`В ${eventYear} году ${figure.name} изменил положение рода.`);
  return addHistoricalEvent(world, eventYear, rng.int(1, 12), {
    kind: 'dynasty', title: `${figure.name} возвысил ${dynasty.name}`, description: `При дворе произошла смена влияния и должностей.`,
    cause: rng.pick(['смерть прежнего наследника', 'удачный брак', 'победа в походе', 'богатство торговых владений', 'поддержка храмов']),
    conditions: ['у рода были сторонники, деньги или военная сила'], decision: `${figure.name} принял власть и распределил должности`,
    outcome: `${dynasty.name} укрепил положение`, consequences: ['изменился порядок наследования', 'соперники потеряли влияние', 'род получил новые обязательства'],
    entityRefs: [{ kind: 'dynasty', id: dynasty.id }, { kind: 'character', id: figure.id }, ...(kingdom ? [{ kind: 'kingdom' as const, id: kingdom.id }] : [])], importance: 3,
  }).id;
}

function religiousOrCulturalEvent(world: WorldState, rng: RNG, year: number, span: number): number {
  const kingdom = rng.pick(world.kingdoms);
  const capital = settlement(world, kingdom.capitalId)!;
  const eventYear = clampYear(year + rng.int(0, Math.max(0, span - 1)), world.year);
  const schism = rng.chance(.52);
  return addHistoricalEvent(world, eventYear, rng.int(1, 12), {
    kind: 'politics', title: schism ? `Раскол веры «${kingdom.religion}»` : `Новый обычай ${kingdom.culture}`,
    description: schism ? `Жрецы ${capital.name} спорили о власти храмов и толковании обрядов.` : 'Гильдии, семьи и дружины закрепили новый общественный обычай.',
    cause: schism ? 'разные интересы храмов, двора и общин' : 'изменение торговли, войны и состава населения',
    conditions: [`событие развивалось внутри ${kingdom.name}`], decision: schism ? 'часть жрецов создала отдельное течение' : 'правитель признал обычай законом или привилегией',
    outcome: schism ? 'появилось новое религиозное течение' : 'обычай стал частью культуры',
    consequences: schism ? ['храмы разделились', 'появились паломничества и конфликты'] : ['изменились права гильдий и семей', 'обычай распространился в поселениях'],
    entityRefs: [{ kind: 'kingdom', id: kingdom.id }, { kind: 'settlement', id: capital.id }], importance: 3,
  }).id;
}

function disasterOrRecovery(world: WorldState, rng: RNG, year: number, span: number): number {
  const place = rng.pick(world.settlements);
  const eventYear = clampYear(year + rng.int(0, Math.max(0, span - 1)), world.year);
  const disaster = rng.chance(.55);
  const cause = rng.pick(['пожар после засухи', 'весеннее наводнение', 'болезнь скота', 'обвал шахты', 'мор среди жителей', 'буря и разрушение пристани']);
  return addHistoricalEvent(world, eventYear, rng.int(1, 12), {
    kind: disaster ? 'disaster' : 'construction', title: disaster ? `${place.name} пережил бедствие` : `${place.name} восстановил старый район`,
    description: disaster ? `Причиной стало: ${cause}.` : 'Жители отстроили дома, склады и защитные сооружения.',
    cause: disaster ? cause : 'рост населения и память о прежнем бедствии', conditions: [`у ${place.name} были уязвимые здания и запасы`],
    decision: disaster ? 'жители спасали семьи, запасы и скот' : 'община направила материалы на восстановление',
    outcome: disaster ? 'часть имущества и построек погибла' : 'жилые и хозяйственные площади выросли',
    consequences: disaster ? ['возникли беженцы', 'цены на материалы выросли', 'местность сохранила следы разрушений'] : ['вместимость поселения выросла', 'появились новые рабочие места'],
    entityRefs: [{ kind: 'settlement', id: place.id }], importance: disaster ? 3 : 2,
  }).id;
}

function createHistoricalFigure(world: WorldState, rng: RNG, place: Settlement, kingdom: Kingdom | undefined, activeYear: number, title: string): Character {
  const species = kingdom?.species ?? rng.pick(['human', 'elf', 'orc', 'dwarf'] as Species[]);
  const lifespan = species === 'elf' ? rng.int(95, 210) : species === 'dwarf' ? rng.int(65, 135) : rng.int(38, 92);
  const ageAtEvent = rng.int(20, Math.min(65, lifespan - 1));
  const birthYear = Math.max(1, activeYear - ageAtEvent);
  const deathYear = Math.min(world.year, birthYear + lifespan);
  const alive = deathYear >= world.year;
  const figure: Character = {
    id: world.nextIds.character++, name: personName(rng, species), species, age: alive ? world.year - birthYear : deathYear - birthYear,
    birthYear, deathYear: alive ? undefined : deathYear, alive, settlementId: place.id, kingdomId: kingdom?.id ?? place.kingdomId,
    profession: title.includes('герой') ? 'hunter' : title.includes('воевода') ? 'soldier' : 'scribe', workplace: title.includes('герой') ? 'дороги и логова чудовищ' : 'двор и владения',
    homeDistrict: place.districts[0]?.name, renown: rng.int(42, 78), health: alive ? rng.int(45, 90) : 0, wealth: rng.int(40, 900), loyalty: rng.int(30, 94),
    ambition: rng.pick(['защитить родную землю', 'получить власть', 'оставить имя в книгах', 'уничтожить древнюю угрозу']),
    parentIds: [], childIds: [], relationshipIds: [], titles: [title], artifactIds: [], bookIds: [], injuries: [], kills: 0,
    biography: [`Родился в ${birthYear} году.`, `В ${activeYear} году получил известность как ${title}.`], inventoryItemIds: [],
    skills: { [title.includes('герой') ? 'hunter' : title.includes('воевода') ? 'soldier' : 'scribe']: rng.int(45, 88) },
    needs: { hunger: 8, thirst: 8, rest: 10, warmth: 10, safety: 15, social: 18, lastUpdatedTick: world.year * 12 + world.month - 1 },
    schedule: { wakeHour: 6, workStartHour: 8, workEndHour: 18, sleepHour: 23, restDay: 1 + world.nextIds.character % 7, currentActivity: title.includes('герой') ? 'путешествует и ищет угрозы' : 'исполняет обязанности' },
  };
  world.characters.push(figure);
  return figure;
}

function linkKnowledgeAndArtifacts(world: WorldState, rng: RNG): void {
  for (const artifact of world.artifacts) {
    const source = nearestEvent(world.events, artifact.yearCreated, event => event.importance >= 3);
    if (source) {
      artifact.history.push(`Создание связано с событием «${source.title}».`);
      addHistoricalEvent(world, artifact.yearCreated, rng.int(1, 12), {
        kind: 'artifact', title: `Создан артефакт «${artifact.name}»`, description: `${artifact.material} был обработан и украшен изображением: ${artifact.depiction}.`,
        cause: `потребность сохранить или использовать последствия события «${source.title}»`,
        conditions: ['мастер имел редкий материал, знания и покровителя'], decision: 'заказчик поручил создать уникальный предмет',
        outcome: `появился артефакт «${artifact.name}»`, consequences: ['предмет получил первого владельца', 'его изображение сохранило часть истории'],
        entityRefs: [{ kind: 'artifact', id: artifact.id }, ...source.entityRefs.slice(0, 2)], importance: Math.round(Math.max(3, Math.min(5, artifact.power / 25))),
      });
    }
  }
  for (const book of world.books) {
    const candidates = world.events.filter(event => event.year <= book.yearWritten && event.importance >= 2);
    const source = candidates.length ? rng.pick(candidates.slice(-Math.min(80, candidates.length))) : undefined;
    if (source) {
      book.referencedEventIds = [...new Set([source.id, ...book.referencedEventIds])].slice(0, 5);
      book.subject = source.title;
      book.summary = `Автор разбирает событие «${source.title}», его причины и последствия. Достоверность ограничена позицией автора.`;
    }
    addHistoricalEvent(world, book.yearWritten, rng.int(1, 12), {
      kind: 'book', title: `Написана книга «${book.title}»`, description: book.summary,
      cause: source ? `автор стремился объяснить событие «${source.title}»` : 'накопленные знания и заказ покровителя',
      conditions: ['автор имел доступ к письму, материалам и источникам'], decision: 'автор собрал свидетельства и завершил рукопись',
      outcome: `появилось ${book.copies} копий книги`, consequences: ['знание стало доступно читателям', 'ошибки и предвзятость автора тоже распространились'],
      entityRefs: [{ kind: 'book', id: book.id }, { kind: 'character', id: book.authorId }, ...(source ? source.entityRefs.slice(0, 1) : [])], importance: 2,
    });
  }
}

function addHistoricalEvent(world: WorldState, year: number, month: number, input: CausalEventInput): WorldEvent {
  const event = causalEvent(world.nextIds.event++, clampYear(year, world.year), Math.max(1, Math.min(12, month)), input);
  world.events.push(event);
  return event;
}

function summarizeEra(world: WorldState, plan: EraPlan, eventIds: number[]): string {
  const events = world.events.filter(event => eventIds.includes(event.id));
  const wars = events.filter(event => event.kind === 'war' || event.kind === 'battle').length;
  const threats = events.filter(event => event.kind === 'dragon' || event.kind === 'monster' || event.kind === 'hero').length;
  const migrations = events.filter(event => event.kind === 'migration').length;
  return `${plan.startYear}–${plan.endYear}: ${events.length} подробных событий, военных эпизодов ${wars}, историй чудовищ и героев ${threats}, переселений ${migrations}.`;
}

function estimateCompressedEvents(config: WorldConfig, steps: number): number {
  const populationWeight = Math.max(1, config.settlementCount * config.populationScale);
  return Math.round(config.historyYears * populationWeight * 2.4 + steps * config.width * .8);
}

function nearestSettlement(world: WorldState, x: number, y: number): Settlement | undefined {
  let best: Settlement | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const place of world.settlements) {
    const distance = Math.hypot(place.x - x, place.y - y);
    if (distance < bestDistance) { best = place; bestDistance = distance; }
  }
  return best;
}

function distanceToCapital(world: WorldState, kingdom: Kingdom, place: Settlement): number {
  const capital = settlement(world, kingdom.capitalId);
  return capital ? Math.hypot(capital.x - place.x, capital.y - place.y) : Number.POSITIVE_INFINITY;
}

function settlement(world: WorldState, id: number): Settlement | undefined {
  return world.settlements.find(item => item.id === id);
}

function nearestEvent(events: WorldEvent[], year: number, filter: (event: WorldEvent) => boolean): WorldEvent | undefined {
  return events.filter(filter).sort((a, b) => Math.abs(a.year - year) - Math.abs(b.year - year) || b.importance - a.importance)[0];
}

function clampYear(year: number, presentYear: number): number {
  return Math.max(1, Math.min(presentYear, Math.round(year)));
}
