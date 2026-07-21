import type {
  Character, CharacterCultureProfile, CultureDefinition, EducationLevel, LanguageDefinition,
  ReligionDefinition, Settlement, SettlementCultureState, WorldEvent, WorldState,
} from '../types';
import type { WorldIndexes } from './indexes';
import { appendCausalEvent } from './causality';
import { residents } from './indexes';
import { registerWorldEventKnowledge } from './knowledgeSystem';
import { RNG } from './rng';
import { worldTick } from './scheduler';
import { hasOperationalInteriorAssignment, operationalSchoolCapacity, schoolBuildingForCharacter } from './interiors';

const traditionsBySpecies: Record<Character['species'], string[]> = {
  human: ['ярмарки в день урожая', 'общественные клятвы перед свидетелями', 'поминовение основателей поселений', 'состязания ремесленных гильдий'],
  elf: ['песни родовых рощ', 'ночные собрания под открытым небом', 'обеты хранителей леса', 'передача имён через устную память'],
  orc: ['советы старших воинов', 'пир после общей охоты', 'клятвы у оружия рода', 'испытания совершеннолетия'],
  dwarf: ['праздник первой плавки', 'каменные родословные', 'суд мастеров ремесла', 'поминальные тосты в честь предков'],
};
const tabooPool = ['осквернение могил', 'нарушение гостеприимства', 'кража у собственного рода', 'ложная клятва', 'порча общественного колодца', 'продажа храмовых реликвий'];
const holidayPool = ['День Первого Огня', 'Ночь Долгой Памяти', 'Праздник Урожая', 'День Общей Клятвы', 'Неделя Ремесленников', 'Поминальный День'];
const doctrinePool = ['милосердие к бедным', 'почитание предков', 'служение общине', 'святость честной клятвы', 'защита путников', 'очищение трудом', 'смирение перед судьбой'];
const religionTaboos = ['кровопролитие в храме', 'осквернение священного огня', 'отказ в погребении', 'торговля в главный святой день', 'ложь перед служителем культа'];
const scripts = ['угловая руника', 'быстрая купеческая вязь', 'каменные знаки', 'узелковое письмо', 'храмовое письмо', 'лесная вязь'];
const phrases = ['мир дому', 'клятва крепче железа', 'дорога помнит шаги', 'предки видят', 'честь мастеру', 'пусть урожай будет полон'];

function clamp(value: number, min = 0, max = 100): number { return Math.max(min, Math.min(max, value)); }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function maxId(values: { id: number }[]): number { return Math.max(0, ...values.map(value => value.id)); }
function normalizedShares(values: { id: number; share: number }[]): { id: number; share: number }[] {
  const merged = new Map<number, number>();
  for (const value of values) merged.set(value.id, (merged.get(value.id) ?? 0) + Math.max(0, value.share));
  const total = [...merged.values()].reduce((sum, value) => sum + value, 0) || 1;
  const result = [...merged.entries()].map(([id, share]) => ({ id, share: share / total * 100 })).sort((a, b) => b.share - a.share || a.id - b.id);
  const rounded = result.map(value => ({ ...value, share: Math.round(value.share * 10) / 10 }));
  const delta = Math.round((100 - rounded.reduce((sum, value) => sum + value.share, 0)) * 10) / 10;
  if (rounded[0]) rounded[0].share = Math.round((rounded[0].share + delta) * 10) / 10;
  return rounded.filter(value => value.share >= .1);
}

function educationFor(character: Character, literacy: number): EducationLevel {
  if (character.age < 6) return 'нет';
  if (character.profession === 'priest') return 'духовное';
  if (character.profession === 'scribe' || literacy >= 82) return 'учёное';
  if (['blacksmith', 'carpenter', 'weaver', 'healer', 'herbalist', 'miller', 'brewer'].includes(character.profession)) return 'ученичество';
  if (literacy >= 35) return 'начальное';
  return 'семейное';
}

function baseLiteracy(character: Character, settlement: Settlement): number {
  if (character.age < 6) return 0;
  let value = character.age < 14 ? 8 : 14;
  if (['scribe', 'priest', 'healer', 'merchant'].includes(character.profession)) value += 42;
  if (['blacksmith', 'carpenter', 'herbalist', 'weaver'].includes(character.profession)) value += 18;
  if (character.titles.length || character.courtOfficeIds?.length) value += 22;
  if (settlement.buildings.some(name => /библиотек|академ|школ/i.test(name))) value += 16;
  return clamp(value + Math.floor(character.skills[character.profession] ?? 0) * .15);
}

function addEvent(world: WorldState, data: Parameters<typeof appendCausalEvent>[1]): WorldEvent {
  const event = appendCausalEvent(world, data);
  registerWorldEventKnowledge(world, event);
  return event;
}

function seedDefinitions(world: WorldState, rng: RNG): void {
  world.cultures ??= [];
  world.languages ??= [];
  world.religions ??= [];
  world.settlementCultures ??= [];
  world.nextIds.culture ??= maxId(world.cultures) + 1;
  world.nextIds.language ??= maxId(world.languages) + 1;
  world.nextIds.religion ??= maxId(world.religions) + 1;
  world.nextIds.settlementCulture ??= maxId(world.settlementCultures) + 1;

  const cultureByName = new Map(world.cultures.map(culture => [culture.name, culture]));
  const religionByName = new Map(world.religions.map(religion => [religion.name, religion]));

  for (const kingdom of world.kingdoms) {
    let culture = cultureByName.get(kingdom.culture);
    if (!culture) {
      const language: LanguageDefinition = {
        id: world.nextIds.language++, name: `${kingdom.culture} — общий язык`, script: rng.pick(scripts), difficulty: rng.int(28, 78),
        prestige: rng.int(35, 82), commonPhrases: [...phrases].sort(() => rng.next() - .5).slice(0, 3),
        history: [`Язык сложился в среде культуры «${kingdom.culture}».`],
      };
      world.languages.push(language);
      culture = {
        id: world.nextIds.culture++, name: kingdom.culture, species: kingdom.species, languageId: language.id,
        traditions: [...traditionsBySpecies[kingdom.species]].sort(() => rng.next() - .5).slice(0, 3),
        taboos: [...tabooPool].sort(() => rng.next() - .5).slice(0, 2), holidays: [...holidayPool].sort(() => rng.next() - .5).slice(0, 2),
        clothingStyle: kingdom.species === 'dwarf' ? 'плотные ткани, фартуки мастеров и металлические застёжки' : kingdom.species === 'elf' ? 'слоистые ткани, плащи и растительные узоры' : kingdom.species === 'orc' ? 'кожа, мех и знаки рода на поясе' : 'региональные ткани, пояса и знаки ремесла',
        namingStyle: kingdom.species === 'dwarf' ? 'имя и род мастерской' : kingdom.species === 'orc' ? 'личное имя и имя рода' : 'личное имя и семейное прозвание',
        marriageCustom: rng.pick(['союз подтверждается семьями', 'союз подтверждается общинным пиром', 'союз закрепляется храмовой клятвой']),
        burialCustom: rng.pick(['погребение рядом с предками', 'кремация и памятный камень', 'общинное погребение с записью имени']),
        openness: rng.int(28, 78), cohesion: rng.int(48, 92), prestige: rng.int(35, 88), settlementIds: [],
        history: [`Культура сформировалась вокруг первых земель государства ${kingdom.name}.`],
      };
      world.cultures.push(culture);
      cultureByName.set(culture.name, culture);
    }
    kingdom.cultureId = culture.id;
    kingdom.officialLanguageId = culture.languageId;

    let religion = religionByName.get(kingdom.religion);
    if (!religion) {
      religion = {
        id: world.nextIds.religion++, name: kingdom.religion,
        doctrines: [...doctrinePool].sort(() => rng.next() - .5).slice(0, 3),
        taboos: [...religionTaboos].sort(() => rng.next() - .5).slice(0, 2), holyDays: [...holidayPool].sort(() => rng.next() - .5).slice(0, 2),
        clergyTitle: rng.pick(['хранитель', 'жрец', 'наставник', 'служитель', 'певчий старейшина']),
        tolerance: rng.int(24, 82), conversionPressure: rng.int(18, 72), authority: rng.int(35, 88), settlementIds: [],
        history: [`Вера получила признание в землях государства ${kingdom.name}.`],
      };
      world.religions.push(religion);
      religionByName.set(religion.name, religion);
    }
    kingdom.religionId = religion.id;
  }
}

function settlementCapacities(world: WorldState, settlement: Settlement): { school: number; temple: number } {
  const buildings = world.buildings.filter(building => building.settlementId === settlement.id);
  const school = buildings.filter(building => building.type === 'school').reduce((sum, building) => sum + operationalSchoolCapacity(world, building), 0)
    + settlement.buildings.filter(name => /школ|академ|библиотек/i.test(name)).length * 45;
  const temple = buildings.filter(building => building.type === 'temple' || building.type === 'monastery').reduce((sum, building) => sum + building.capacity, 0)
    + settlement.buildings.filter(name => /храм|собор|часовн|монастыр/i.test(name)).length * 55;
  return { school, temple };
}

function seedSettlementStates(world: WorldState, rng: RNG): void {
  const existing = new Map(world.settlementCultures.map(state => [state.settlementId, state]));
  for (const settlement of world.settlements) {
    const kingdom = world.kingdoms.find(item => item.id === settlement.kingdomId) ?? world.kingdoms[0];
    const culture = world.cultures.find(item => item.id === kingdom?.cultureId) ?? world.cultures[0];
    const religion = world.religions.find(item => item.id === kingdom?.religionId) ?? world.religions[0];
    if (!culture || !religion) continue;
    const minorities = world.cultures.filter(item => item.id !== culture.id).sort(() => rng.next() - .5).slice(0, settlement.type === 'city' || settlement.type === 'port' ? 2 : 1);
    const minorityShare = settlement.type === 'city' || settlement.type === 'port' ? rng.int(8, 26) : rng.int(1, 12);
    const cultureShares = normalizedShares([{ id: culture.id, share: 100 - minorityShare }, ...minorities.map((item, index) => ({ id: item.id, share: index === 0 ? minorityShare * .7 : minorityShare * .3 }))]);
    const otherFaiths = world.religions.filter(item => item.id !== religion.id).sort(() => rng.next() - .5).slice(0, settlement.type === 'city' || settlement.type === 'port' ? 2 : 1);
    const faithMinority = settlement.type === 'city' || settlement.type === 'port' ? rng.int(5, 22) : rng.int(0, 9);
    const religionShares = normalizedShares([{ id: religion.id, share: 100 - faithMinority }, ...otherFaiths.map((item, index) => ({ id: item.id, share: index === 0 ? faithMinority * .75 : faithMinority * .25 }))]);
    const capacity = settlementCapacities(world, settlement);
    const current = existing.get(settlement.id);
    const state: SettlementCultureState = current ?? {
      id: world.nextIds.settlementCulture++, settlementId: settlement.id, dominantCultureId: culture.id, cultureShares,
      dominantReligionId: religion.id, religionShares, literacy: 0, educationAccess: 0, schoolCapacity: capacity.school,
      templeCapacity: capacity.temple, culturalTension: 0, lastUpdatedYear: world.year, history: [],
    };
    state.cultureShares = state.cultureShares?.length ? normalizedShares(state.cultureShares) : cultureShares;
    state.religionShares = state.religionShares?.length ? normalizedShares(state.religionShares) : religionShares;
    state.dominantCultureId = state.cultureShares[0]?.id ?? culture.id;
    state.dominantReligionId = state.religionShares[0]?.id ?? religion.id;
    state.schoolCapacity = capacity.school;
    state.templeCapacity = capacity.temple;
    state.educationAccess = clamp(capacity.school / Math.max(1, settlement.population) * 100 + (settlement.type === 'city' ? 18 : settlement.type === 'town' ? 10 : 2));
    state.literacy = clamp(state.literacy || 8 + state.educationAccess * .55 + settlement.prosperity * .12);
    state.culturalTension = clamp(state.culturalTension || (100 - (state.cultureShares[0]?.share ?? 100)) * .45 + settlement.unrest * .25);
    state.lastUpdatedYear ??= world.year;
    state.history ??= [`Культурный состав ${settlement.name} впервые описан в ${world.year} году.`];
    if (!current) world.settlementCultures.push(state);
    settlement.cultureStateId = state.id;
    if (!culture.settlementIds.includes(settlement.id)) culture.settlementIds.push(settlement.id);
    if (!religion.settlementIds.includes(settlement.id)) religion.settlementIds.push(settlement.id);
  }
}

function profileFor(world: WorldState, character: Character, rng: RNG): CharacterCultureProfile {
  const settlementState = world.settlementCultures.find(state => state.settlementId === character.settlementId);
  const kingdom = world.kingdoms.find(item => item.id === character.kingdomId);
  const cultureId = settlementState?.cultureShares.find((_, index) => index > 0 && rng.chance(.18))?.id
    ?? settlementState?.dominantCultureId ?? kingdom?.cultureId ?? world.cultures[0]?.id ?? 1;
  const culture = world.cultures.find(item => item.id === cultureId) ?? world.cultures[0]!;
  const religionId = settlementState?.religionShares.find((_, index) => index > 0 && rng.chance(.13))?.id
    ?? settlementState?.dominantReligionId ?? kingdom?.religionId ?? world.religions[0]?.id ?? 1;
  const settlement = world.settlements.find(item => item.id === character.settlementId)!;
  const literacy = baseLiteracy(character, settlement);
  const languages = [{ languageId: culture.languageId, fluency: 100 }];
  if (['merchant', 'scribe', 'priest'].includes(character.profession) && world.languages.length > 1 && rng.chance(.48)) {
    const foreign = rng.pick(world.languages.filter(language => language.id !== culture.languageId));
    languages.push({ languageId: foreign.id, fluency: rng.int(25, 78) });
  }
  return {
    cultureId: culture.id, nativeLanguageId: culture.languageId, languages, religionId,
    devotion: clamp((character.mind?.values.faith ?? 45) + rng.int(-18, 18)), literacy,
    education: educationFor(character, literacy), culturalOpenness: clamp(culture.openness + rng.int(-22, 22)), lastUpdatedTick: worldTick(world),
  };
}

export function ensureCharacterCultureProfile(world: WorldState, character: Character, rng: RNG): CharacterCultureProfile {
  if (!world.simulation.cultureSystemVersion || !world.cultures.length || !world.religions.length) initializeCultureSystem(world, rng);
  character.cultureProfile ??= profileFor(world, character, rng);
  return character.cultureProfile;
}

export function initializeCultureSystem(world: WorldState, rng = new RNG(`${world.config.seed}:культура-вера-образование-v1`)): void {
  seedDefinitions(world, rng);
  seedSettlementStates(world, rng);
  for (const character of world.characters) {
    if (!character.cultureProfile) character.cultureProfile = profileFor(world, character, rng);
    else {
      character.cultureProfile.languages ??= [{ languageId: character.cultureProfile.nativeLanguageId, fluency: 100 }];
      character.cultureProfile.lastUpdatedTick ??= worldTick(world);
      character.cultureProfile.education ??= educationFor(character, character.cultureProfile.literacy ?? 0);
    }
  }
  world.nextIds.culture = maxId(world.cultures) + 1;
  world.nextIds.language = maxId(world.languages) + 1;
  world.nextIds.religion = maxId(world.religions) + 1;
  world.nextIds.settlementCulture = maxId(world.settlementCultures) + 1;
  world.simulation.cultureSystemVersion = 1;
}

function shiftTowardDominant(shares: { id: number; share: number }[], pressure: number): { id: number; share: number }[] {
  if (shares.length < 2 || pressure <= 0) return normalizedShares(shares);
  const dominant = shares[0]!;
  const moved = Math.min(1.8, pressure, 100 - dominant.share);
  const minorities = shares.slice(1);
  const minorityTotal = minorities.reduce((sum, item) => sum + item.share, 0) || 1;
  return normalizedShares([
    { ...dominant, share: dominant.share + moved },
    ...minorities.map(item => ({ ...item, share: Math.max(0, item.share - moved * item.share / minorityTotal) })),
  ]);
}

function maybeTeachLanguage(world: WorldState, character: Character, state: SettlementCultureState, rng: RNG): void {
  const profile = character.cultureProfile;
  if (!profile || profile.languages.length >= 3 || profile.literacy < 20) return;
  const candidates = state.cultureShares.map(share => world.cultures.find(culture => culture.id === share.id)?.languageId).filter((id): id is number => Boolean(id) && !profile.languages.some(language => language.languageId === id));
  if (!candidates.length || !rng.chance(.22 + state.educationAccess / 300)) return;
  profile.languages.push({ languageId: rng.pick(candidates), fluency: rng.int(18, 45) });
}

function maybeCreateHeresy(world: WorldState, state: SettlementCultureState, settlement: Settlement, rng: RNG): void {
  const parent = world.religions.find(religion => religion.id === state.dominantReligionId);
  if (!parent || state.culturalTension < 52 || !rng.chance(.035 + state.culturalTension / 2200)) return;
  const religion: ReligionDefinition = {
    id: world.nextIds.religion++, name: `${rng.pick(['Обновлённый', 'Истинный', 'Тихий', 'Очищенный'])} ${parent.name}`,
    parentReligionId: parent.id, doctrines: unique([...parent.doctrines.slice(0, 2), rng.pick(doctrinePool)]), taboos: parent.taboos.slice(0, 2),
    holyDays: parent.holyDays.slice(0, 2), clergyTitle: rng.pick(['проповедник', 'старший брат', 'хранитель истины']),
    tolerance: clamp(parent.tolerance + rng.int(-24, 18)), conversionPressure: clamp(parent.conversionPressure + rng.int(5, 24)), authority: rng.int(12, 38),
    settlementIds: [settlement.id], history: [`Учение возникло в ${settlement.name} в ${world.year} году.`],
  };
  world.religions.push(religion);
  state.religionShares = normalizedShares([...state.religionShares.map(share => share.id === parent.id ? { ...share, share: Math.max(0, share.share - 7) } : share), { id: religion.id, share: 7 }]);
  state.culturalTension = clamp(state.culturalTension + 12);
  addEvent(world, {
    kind: 'religion', title: `В ${settlement.name} возникло учение «${religion.name}»`,
    description: `Часть верующих отвергла власть старого духовенства и начала собираться отдельно.`,
    cause: 'высокая культурная напряжённость и спор о толковании веры',
    consequences: ['появилась новая религиозная община', 'местные служители требуют решения власти', 'в семьях усилились споры'],
    entityRefs: [{ kind: 'settlement', id: settlement.id }, { kind: 'religion', id: parent.id }, { kind: 'religion', id: religion.id }], importance: 4,
  });
}

function maybeTranslateBook(world: WorldState, state: SettlementCultureState, settlement: Settlement, localResidents: Character[], rng: RNG): void {
  if (state.educationAccess < 28 || world.languages.length < 2 || !rng.chance(.08 + state.educationAccess / 900)) return;
  const scholar = localResidents.filter(character => character.cultureProfile && character.cultureProfile.literacy >= 65 && character.cultureProfile.languages.length >= 2).sort((a, b) => (b.cultureProfile?.literacy ?? 0) - (a.cultureProfile?.literacy ?? 0))[0];
  const availableBooks = world.books.filter(book => book.settlementId === settlement.id || book.copies >= 8);
  if (!scholar || !availableBooks.length) return;
  const original = rng.pick(availableBooks);
  const targetLanguage = scholar.cultureProfile!.languages.find(language => language.languageId !== scholar.cultureProfile!.nativeLanguageId)?.languageId;
  const language = world.languages.find(item => item.id === targetLanguage);
  if (!language) return;
  const translated = {
    ...original, id: world.nextIds.book++, title: `${original.title} — перевод на ${language.name}`,
    authorId: scholar.id, yearWritten: world.year, language: language.name, copies: rng.int(2, 12), settlementId: settlement.id,
    summary: `Перевод труда «${original.title}», выполненный ${scholar.name}.`,
  };
  world.books.push(translated);
  scholar.bookIds.push(translated.id);
  scholar.biography.push(`В ${world.year} году перевёл книгу «${original.title}» на ${language.name}.`);
  addEvent(world, {
    kind: 'education', title: `${scholar.name} перевёл книгу в ${settlement.name}`,
    description: `Труд «${original.title}» стал доступен читателям языка «${language.name}».`, cause: 'грамотный житель знал два языка и имел доступ к книге',
    consequences: ['знание стало доступно другой общине', 'престиж местной школы вырос', 'культурный обмен ускорился'],
    entityRefs: [{ kind: 'character', id: scholar.id }, { kind: 'book', id: translated.id }, { kind: 'language', id: language.id }, { kind: 'settlement', id: settlement.id }], importance: 3,
  });
}

export function advanceCultureSystem(world: WorldState, rng: RNG, indexes: WorldIndexes): void {
  if (!world.simulation.cultureSystemVersion) initializeCultureSystem(world, rng);
  for (const state of world.settlementCultures) {
    const settlement = indexes.settlementById.get(state.settlementId);
    if (!settlement) continue;
    const localResidents = residents(indexes, settlement.id);
    const capacity = settlementCapacities(world, settlement);
    state.schoolCapacity = capacity.school;
    state.templeCapacity = capacity.temple;
    state.educationAccess = clamp(capacity.school / Math.max(1, localResidents.length) * 100 + settlement.prosperity * .12);
    const scholarShare = localResidents.length ? localResidents.slice(0, 96).reduce((sum, character) => sum + (character.cultureProfile?.literacy ?? 0), 0) / Math.min(96, localResidents.length) : state.literacy;
    state.literacy = clamp(state.literacy * .72 + scholarShare * .18 + state.educationAccess * .1);

    const dominantCulture = world.cultures.find(culture => culture.id === state.dominantCultureId);
    const dominantReligion = world.religions.find(religion => religion.id === state.dominantReligionId);
    const culturalPressure = Math.max(0, ((dominantCulture?.cohesion ?? 50) + settlement.prosperity - state.culturalTension) / 170);
    const religiousPressure = Math.max(0, ((dominantReligion?.conversionPressure ?? 40) + state.templeCapacity / Math.max(8, localResidents.length) * 20 - (dominantReligion?.tolerance ?? 50) * .25) / 90);
    state.cultureShares = shiftTowardDominant(state.cultureShares, culturalPressure);
    state.religionShares = shiftTowardDominant(state.religionShares, religiousPressure);
    state.dominantCultureId = state.cultureShares[0]?.id ?? state.dominantCultureId;
    state.dominantReligionId = state.religionShares[0]?.id ?? state.dominantReligionId;
    const diversity = 100 - (state.cultureShares[0]?.share ?? 100) + 100 - (state.religionShares[0]?.share ?? 100);
    const tolerance = (dominantReligion?.tolerance ?? 50) + (dominantCulture?.openness ?? 50);
    state.culturalTension = clamp(state.culturalTension * .68 + diversity * .22 + settlement.unrest * .28 - tolerance * .1 - state.educationAccess * .08);
    state.activeFestival = rng.chance(.42) ? rng.pick(dominantCulture?.holidays ?? holidayPool) : undefined;
    state.lastUpdatedYear = world.year;

    const candidates = [...localResidents].sort((a, b) => a.id - b.id).slice(0, Math.min(64, localResidents.length));
    for (const character of candidates) {
      if (!character.cultureProfile) character.cultureProfile = profileFor(world, character, rng);
      const profile = character.cultureProfile;
      const school = schoolBuildingForCharacter(world, character);
      const hasSeat = school ? hasOperationalInteriorAssignment(world, character.id, school.id, 'school') : false;
      if (character.age >= 6 && character.age <= 18 && state.educationAccess > 12 && hasSeat) {
        profile.literacy = clamp(profile.literacy + Math.max(1, state.educationAccess / 24));
        profile.education = educationFor(character, profile.literacy);
      }
      maybeTeachLanguage(world, character, state, rng);
      if (profile.religionId !== state.dominantReligionId && rng.chance((dominantReligion?.conversionPressure ?? 30) / 2400 + state.templeCapacity / Math.max(1, localResidents.length) / 500)) {
        profile.religionId = state.dominantReligionId;
        profile.devotion = clamp(profile.devotion + rng.int(4, 16));
        character.biography.push(`В ${world.year} году принял веру «${dominantReligion?.name ?? 'местная вера'}».`);
      }
      profile.lastUpdatedTick = worldTick(world);
    }

    if (state.activeFestival && rng.chance(.1)) {
      state.history.push(`В ${world.year} году община широко отметила праздник «${state.activeFestival}».`);
      addEvent(world, {
        kind: 'culture', title: `${settlement.name} отметил праздник «${state.activeFestival}»`,
        description: `Работа остановилась на день, семьи собрались на площади, торговцы и служители провели общие обряды.`,
        cause: 'местная традиция сохранилась и получила поддержку общины', consequences: ['напряжённость временно снизилась', 'рынок получил дополнительный доход', 'традиция укрепилась'],
        entityRefs: [{ kind: 'settlement', id: settlement.id }, { kind: 'culture', id: state.dominantCultureId }], importance: 2,
      });
      state.culturalTension = clamp(state.culturalTension - 5);
    }
    maybeTranslateBook(world, state, settlement, localResidents, rng);
    maybeCreateHeresy(world, state, settlement, rng);

    if (state.culturalTension >= 72 && rng.chance(.12)) {
      settlement.unrest = clamp(settlement.unrest + rng.int(4, 12));
      addEvent(world, {
        kind: 'culture', title: `Культурные столкновения в ${settlement.name}`,
        description: `Спор о языке, вере и местных обычаях перерос в драки и отказ части жителей подчиняться общинным решениям.`,
        cause: 'в поселении живут крупные общины с разными обычаями при слабой способности власти улаживать конфликты',
        consequences: ['выросли беспорядки', 'часть семей задумалась о переселении', 'стража усилила патрули'],
        entityRefs: [{ kind: 'settlement', id: settlement.id }, { kind: 'culture', id: state.dominantCultureId }, { kind: 'religion', id: state.dominantReligionId }], importance: 3,
      });
    }
  }

  for (const culture of world.cultures) {
    culture.settlementIds = world.settlementCultures.filter(state => state.cultureShares.some(share => share.id === culture.id && share.share >= 5)).map(state => state.settlementId);
    culture.prestige = clamp(culture.prestige * .94 + culture.settlementIds.length * 2 + world.books.filter(book => book.language === world.languages.find(language => language.id === culture.languageId)?.name).length * .2);
  }
  for (const religion of world.religions) religion.settlementIds = world.settlementCultures.filter(state => state.religionShares.some(share => share.id === religion.id && share.share >= 5)).map(state => state.settlementId);
}

export function cultureIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const cultureIds = new Set(world.cultures.map(culture => culture.id));
  const languageIds = new Set(world.languages.map(language => language.id));
  const religionIds = new Set(world.religions.map(religion => religion.id));
  for (const culture of world.cultures) if (!languageIds.has(culture.languageId)) issues.push(`Культура ${culture.id} ссылается на отсутствующий язык ${culture.languageId}`);
  for (const state of world.settlementCultures) {
    if (!world.settlements.some(settlement => settlement.id === state.settlementId)) issues.push(`Культурное состояние ${state.id} не имеет поселения`);
    if (!cultureIds.has(state.dominantCultureId)) issues.push(`Культурное состояние ${state.id} не имеет доминирующей культуры`);
    if (!religionIds.has(state.dominantReligionId)) issues.push(`Культурное состояние ${state.id} не имеет доминирующей веры`);
    const cultureTotal = state.cultureShares.reduce((sum, share) => sum + share.share, 0);
    const religionTotal = state.religionShares.reduce((sum, share) => sum + share.share, 0);
    if (Math.abs(cultureTotal - 100) > .2) issues.push(`Культурные доли поселения ${state.settlementId} дают ${cultureTotal}`);
    if (Math.abs(religionTotal - 100) > .2) issues.push(`Религиозные доли поселения ${state.settlementId} дают ${religionTotal}`);
  }
  for (const character of world.characters) {
    const profile = character.cultureProfile;
    if (!profile) { issues.push(`У жителя ${character.id} нет культурного профиля`); continue; }
    if (!cultureIds.has(profile.cultureId)) issues.push(`Житель ${character.id} ссылается на отсутствующую культуру`);
    if (!languageIds.has(profile.nativeLanguageId)) issues.push(`Житель ${character.id} ссылается на отсутствующий родной язык`);
    if (!religionIds.has(profile.religionId)) issues.push(`Житель ${character.id} ссылается на отсутствующую веру`);
    if (issues.length >= 80) break;
  }
  return issues;
}
