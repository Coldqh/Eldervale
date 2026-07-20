import type {
  Character, EntityRef, PersonalGoal, PersonalGoalKind, PersonalMemory, WorldEvent, WorldState,
} from '../types';
import type { PersonalLifeEvent } from '../dailyLifeTypes';
import type {
  CharacterBiography, CharacterEventCursor, CharacterEventPointer, CharacterLifePlan,
  CharacterStoryEvent, CharacterStorySnapshot,
} from '../liveStoriesTypes';

const PLAN_TEMPLATES: Record<PersonalGoalKind, { title: string; stages: string[]; action: string }> = {
  survive: { title: 'Пережить тяжёлое время', stages: ['найти еду и безопасное место', 'восстановить здоровье', 'вернуться к обычной жизни'], action: 'заняться здоровьем и базовыми потребностями' },
  feed_family: { title: 'Обеспечить семью', stages: ['найти устойчивый доход', 'создать запас еды', 'закрыть семейные долги', 'сделать дом устойчивым'], action: 'искать заработок и пополнять домашние запасы' },
  earn_wealth: { title: 'Добиться достатка', stages: ['получить постоянную работу', 'собрать первый запас денег', 'купить нужные инструменты', 'открыть собственное дело'], action: 'работать, копить и искать выгодную возможность' },
  gain_power: { title: 'Получить влияние', stages: ['стать заметным в общине', 'найти покровителей', 'получить должность или титул', 'закрепить власть'], action: 'искать поддержку при дворе или местной власти' },
  protect_home: { title: 'Защитить дом', stages: ['понять источник угрозы', 'подготовить людей и припасы', 'снизить опасность', 'вернуть порядок'], action: 'служить общине и реагировать на угрозы' },
  serve_faith: { title: 'Служить вере', stages: ['укрепить личную веру', 'помогать прихожанам', 'получить уважение духовенства', 'оставить религиозный след'], action: 'посетить храм и выполнить обязанность перед общиной' },
  revenge: { title: 'Отомстить', stages: ['установить виновника', 'найти союзников', 'добраться до цели', 'завершить месть'], action: 'искать сведения о цели и готовиться к столкновению' },
  escape_justice: { title: 'Избежать закона', stages: ['скрыть следы', 'уйти от стражи', 'снять обвинения или покинуть место', 'вернуть свободу'], action: 'избегать стражи и искать путь к свободе' },
  master_craft: { title: 'Стать мастером ремесла', stages: ['освоить основы', 'работать самостоятельно', 'создавать качественные вещи', 'получить признание мастера'], action: 'работать по профессии и повышать навык' },
  explore: { title: 'Увидеть мир', stages: ['подготовить припасы', 'покинуть привычное место', 'пережить дорогу', 'вернуться с открытиями'], action: 'готовиться к дороге и искать новое место' },
};

export function latestCharacterEventCursor(world: WorldState, characterId: number): CharacterEventCursor {
  let personalEventId = 0;
  for (const event of world.personalLifeEvents ?? []) {
    if (personalEventBelongsTo(event, characterId)) personalEventId = Math.max(personalEventId, event.id);
  }
  let worldEventId = 0;
  for (const event of world.events) {
    if (worldEventBelongsTo(event, characterId)) worldEventId = Math.max(worldEventId, event.id);
  }
  let memoryId = 0;
  for (const memory of world.memories) {
    if (memory.characterId === characterId) memoryId = Math.max(memoryId, memory.id);
  }
  return { personalEventId, worldEventId, memoryId };
}

export function nextCharacterEvent(
  world: WorldState,
  characterId: number,
  cursor: CharacterEventCursor,
): CharacterEventPointer | undefined {
  const personal = (world.personalLifeEvents ?? [])
    .filter(event => event.id > cursor.personalEventId && personalEventBelongsTo(event, characterId))
    .sort((a, b) => a.id - b.id)[0];
  const historical = world.events
    .filter(event => event.id > cursor.worldEventId && worldEventBelongsTo(event, characterId))
    .sort((a, b) => a.id - b.id)[0];
  const memory = world.memories
    .filter(event => event.id > cursor.memoryId && event.characterId === characterId)
    .sort((a, b) => a.id - b.id)[0];
  const candidates: { pointer: CharacterEventPointer; tick: number }[] = [];
  if (personal) candidates.push({ pointer: { source: 'personal', id: personal.id }, tick: personal.tick });
  if (historical) candidates.push({ pointer: { source: 'world', id: historical.id }, tick: dateTick(historical.year, historical.month) });
  if (memory) candidates.push({ pointer: { source: 'memory', id: memory.id }, tick: memory.learnedTick });
  return candidates.sort((a, b) => a.tick - b.tick || a.pointer.id - b.pointer.id)[0]?.pointer;
}

export function buildCharacterStory(world: WorldState, characterId: number, limit = 28): CharacterStorySnapshot | undefined {
  const character = world.characters.find(item => item.id === characterId);
  const burial = world.burials.find(item => item.subjectKind === 'character' && item.subjectId === characterId);
  if (!character && !burial) return undefined;
  const name = character?.name ?? burial!.name;
  const timeline = collectTimeline(world, characterId).slice(0, limit);
  return {
    characterId,
    name,
    alive: character?.alive ?? false,
    profession: character?.profession ?? burial?.profession ?? 'неизвестно',
    settlementId: character?.settlementId ?? burial?.settlementId,
    plan: deriveLifePlan(world, characterId),
    timeline,
    biography: buildBiography(world, characterId, timeline),
  };
}

export function deriveLifePlan(world: WorldState, characterId: number): CharacterLifePlan {
  const character = world.characters.find(item => item.id === characterId);
  const burial = world.burials.find(item => item.subjectKind === 'character' && item.subjectId === characterId);
  if (!character || !character.alive) {
    return {
      kind: 'survive', title: 'Жизнь завершена', reason: burial?.cause ?? 'персонаж больше не жив', priority: 0,
      progress: 100, status: 'ended', currentStage: 'итог жизни сохранён в хронике', nextAction: 'следить за наследниками и близкими',
      completedSteps: ['жизненный путь завершён'], remainingSteps: [], blockers: [],
    };
  }

  const goal = primaryGoal(character);
  const kind = goal?.kind ?? fallbackGoal(character);
  const template = PLAN_TEMPLATES[kind];
  const progress = calculatePlanProgress(world, character, kind, goal);
  const thresholds = template.stages.map((_, index) => Math.round((index + 1) / template.stages.length * 100));
  const completedSteps = template.stages.filter((_, index) => progress >= thresholds[index]!);
  const remainingSteps = template.stages.filter((_, index) => progress < thresholds[index]!);
  const blockers = planBlockers(world, character, kind);
  const status: CharacterLifePlan['status'] = progress >= 100 ? 'completed' : blockers.length >= 2 || goal?.status === 'blocked' ? 'blocked' : 'active';
  const currentStage = remainingSteps[0] ?? 'цель достигнута';
  return {
    kind,
    title: planTitle(character, kind, template.title),
    reason: goal?.reason ?? character.ambition,
    priority: Math.round(goal?.priority ?? 45),
    progress,
    status,
    currentStage,
    nextAction: progress >= 100 ? 'выбрать новую цель после следующего изменения жизни' : nextAction(world, character, kind, template.action),
    completedSteps,
    remainingSteps,
    blockers,
    targetRef: goal?.targetRef,
  };
}

export function collectTimeline(world: WorldState, characterId: number): CharacterStoryEvent[] {
  const personal = (world.personalLifeEvents ?? [])
    .filter(event => personalEventBelongsTo(event, characterId))
    .map(event => personalStoryEvent(event));
  const historical = world.events
    .filter(event => worldEventBelongsTo(event, characterId))
    .map(event => worldStoryEvent(event));
  const memories = world.memories
    .filter(memory => memory.characterId === characterId)
    .map(memory => memoryStoryEvent(world, memory));
  const seen = new Set<string>();
  return [...personal, ...historical, ...memories]
    .sort((a, b) => b.tick - a.tick || b.importance - a.importance || b.sourceId - a.sourceId)
    .filter(event => {
      const signature = `${event.tick}:${event.title}:${event.description}`;
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
}

function buildBiography(world: WorldState, characterId: number, timeline: CharacterStoryEvent[]): CharacterBiography {
  const character = world.characters.find(item => item.id === characterId);
  const burial = world.burials.find(item => item.subjectKind === 'character' && item.subjectId === characterId);
  const birthYear = character?.birthYear ?? burial?.birthYear;
  const deathYear = character?.deathYear ?? burial?.deathYear;
  const years = birthYear === undefined ? 'годы жизни неизвестны' : deathYear === undefined ? `родился в ${birthYear} году` : `${birthYear}–${deathYear}`;
  const settlementId = character?.settlementId ?? burial?.settlementId;
  const settlement = settlementId ? world.settlements.find(item => item.id === settlementId) : undefined;
  const spouseId = character?.spouseId ?? burial?.spouseId;
  const relativeIds = new Set<number>([...(character?.parentIds ?? burial?.parentIds ?? []), ...(character?.childIds ?? burial?.childIds ?? []), ...(spouseId ? [spouseId] : [])]);
  const relativeRefs = [...relativeIds].map(id => ({ kind: 'character' as const, id }));
  const profession = character?.profession ?? burial?.profession ?? 'неизвестное занятие';
  const ending = burial ? ` Причина смерти: ${burial.cause}.` : '';
  const summary = `${character?.name ?? burial?.name ?? 'Неизвестный'} — ${profession}${settlement ? ` из ${settlement.name}` : ''}. ${years}.${ending}`;
  const milestones: string[] = [];
  if (character?.spouseId) milestones.push('создал семью');
  if (character?.childIds.length) milestones.push(`оставил детей: ${character.childIds.length}`);
  const titles = character?.titles ?? burial?.titles ?? [];
  if (titles.length) milestones.push(`получил титулы: ${titles.join(', ')}`);
  if (character?.courtOfficeIds?.length) milestones.push(`служил при дворе: ${character.courtOfficeIds.length} должн.`);
  if (character?.kills) milestones.push(`подтверждённых убийств или побед: ${character.kills}`);
  if (character?.bookIds.length) milestones.push(`связан с книгами: ${character.bookIds.length}`);
  if (character?.artifactIds.length) milestones.push(`владел артефактами: ${character.artifactIds.length}`);
  milestones.push(...(character?.biography ?? []).slice(-5));
  milestones.push(...timeline.filter(event => event.importance >= 2).slice(0, 5).map(event => event.title));

  const legacy: string[] = [];
  if ((character?.childIds.length ?? burial?.childIds.length ?? 0) > 0) legacy.push('род продолжают дети');
  if (character?.dynastyId) legacy.push('имя осталось в истории династии');
  if ((character?.renown ?? burial?.renown ?? 0) >= 60) legacy.push('сохранилась заметная известность');
  if (character?.bookIds.length) legacy.push('сохранились связанные книги');
  if (character?.artifactIds.length) legacy.push('остались связанные артефакты');
  if (burial?.cemeteryId) legacy.push('есть известное место погребения');
  if (!legacy.length) legacy.push('след остался в памяти близких и бытовой истории поселения');
  return { years, summary, milestones: unique(milestones).slice(0, 12), legacy, relativeRefs, burialRef: burial ? { kind: 'burial', id: burial.id } : undefined };
}

function primaryGoal(character: Character): PersonalGoal | undefined {
  return [...(character.mind?.goals ?? [])]
    .sort((a, b) => goalStatusWeight(b.status) - goalStatusWeight(a.status) || b.priority - a.priority || b.updatedTick - a.updatedTick)[0];
}

function goalStatusWeight(status: PersonalGoal['status']): number {
  return status === 'active' ? 4 : status === 'blocked' ? 3 : status === 'completed' ? 2 : 1;
}

function fallbackGoal(character: Character): PersonalGoalKind {
  if (character.age < 14 || character.health < 55) return 'survive';
  if (character.childIds.length || character.spouseId) return 'feed_family';
  if (character.profession === 'priest') return 'serve_faith';
  if (['guard', 'soldier'].includes(character.profession)) return 'protect_home';
  if ((character.skills[character.profession] ?? 0) >= 35) return 'master_craft';
  if (character.titles.length || character.courtOfficeIds?.length) return 'gain_power';
  return 'earn_wealth';
}

function calculatePlanProgress(world: WorldState, character: Character, kind: PersonalGoalKind, goal?: PersonalGoal): number {
  const household = character.householdId ? world.households.find(item => item.id === character.householdId) : undefined;
  const settlement = world.settlements.find(item => item.id === character.settlementId);
  const ownBusiness = world.establishments.some(item => item.ownerCharacterId === character.id && item.active);
  const base = goal?.progress ?? 0;
  let value = base;
  if (kind === 'survive') value = (character.health * .58) + ((100 - character.needs.hunger) * .18) + ((100 - character.needs.safety) * .12) + ((100 - character.needs.rest) * .12);
  else if (kind === 'feed_family') value = Math.min(100, (household?.foodReserveDays ?? 0) * 3 + Math.max(0, 35 - (household?.debt ?? 0)) + Math.max(0, 30 - (household?.needs.hunger ?? 0)));
  else if (kind === 'earn_wealth') value = Math.min(100, (character.wallet + character.wealth + (household?.wealth ?? 0)) * .55 + (character.employmentContractId ? 22 : 0) + (ownBusiness ? 45 : 0));
  else if (kind === 'gain_power') value = Math.min(100, (character.politicalInfluence ?? 0) * .55 + character.titles.length * 24 + (character.courtOfficeIds?.length ?? 0) * 20 + character.renown * .18);
  else if (kind === 'protect_home') value = Math.min(100, Math.max(0, 100 - (settlement?.unrest ?? 50) * .7 - (settlement?.damaged ?? 0) * .45) + (['guard', 'soldier'].includes(character.profession) ? 12 : 0));
  else if (kind === 'serve_faith') value = Math.min(100, (character.mind?.values.faith ?? 0) * .62 + (character.profession === 'priest' ? 28 : 0) + Math.max(0, reputation(character, 'clergy')) * .18);
  else if (kind === 'revenge') value = Math.max(base, Math.min(95, character.mind?.emotions.anger ?? 0));
  else if (kind === 'escape_justice') value = character.legalStatus === 'свободен' ? 100 : character.legalStatus === 'сбежал' ? 78 : character.legalStatus === 'разыскивается' ? 42 : character.legalStatus === 'под стражей' ? 18 : 6;
  else if (kind === 'master_craft') value = Math.min(100, character.skills[character.profession] ?? 0);
  else if (kind === 'explore') value = Math.min(100, character.renown * .35 + (world.travelingMerchants.some(item => item.characterId === character.id) ? 48 : 0) + (character.bookIds.length + character.artifactIds.length) * 8);
  return clamp(Math.max(base, value));
}

function planBlockers(world: WorldState, character: Character, kind: PersonalGoalKind): string[] {
  const blockers: string[] = [];
  const household = character.householdId ? world.households.find(item => item.id === character.householdId) : undefined;
  if (character.health < 45) blockers.push('слабое здоровье');
  if (character.legalStatus === 'заключён' || character.legalStatus === 'под стражей') blockers.push('лишение свободы');
  if ((household?.debt ?? 0) > 18) blockers.push('долг семьи');
  if (character.needs.hunger > 62) blockers.push('голод мешает долгим планам');
  if ((kind === 'earn_wealth' || kind === 'master_craft') && !character.employmentContractId && !character.employerEstablishmentId) blockers.push('нет постоянной работы');
  if (kind === 'master_craft' && !character.equipment.equippedItemIds.workTool) blockers.push('нет подходящего инструмента');
  if (kind === 'gain_power' && character.renown < 20) blockers.push('слишком мало известности');
  if (kind === 'protect_home') {
    const settlement = world.settlements.find(item => item.id === character.settlementId);
    if ((settlement?.unrest ?? 0) > 70) blockers.push('поселение охвачено беспорядками');
  }
  return unique(blockers);
}

function nextAction(world: WorldState, character: Character, kind: PersonalGoalKind, fallback: string): string {
  if (kind === 'earn_wealth' && !character.employmentContractId) return 'искать постоянную работу на рынке или в мастерской';
  if (kind === 'master_craft' && !character.equipment.equippedItemIds.workTool) return 'добыть или купить рабочий инструмент';
  if (kind === 'feed_family') {
    const household = character.householdId ? world.households.find(item => item.id === character.householdId) : undefined;
    if ((household?.foodReserveDays ?? 0) < 6) return 'добыть еду для дома';
  }
  if (kind === 'survive' && character.health < 55) return 'добраться до лекаря и отдохнуть';
  if (kind === 'gain_power' && !character.courtOfficeIds?.length) return 'найти покровителя среди власти и знати';
  return fallback;
}

function planTitle(character: Character, kind: PersonalGoalKind, base: string): string {
  if (kind === 'master_craft') return `Стать мастером: ${character.profession}`;
  if (kind === 'earn_wealth' && ['blacksmith', 'carpenter', 'weaver', 'tailor', 'brewer', 'merchant'].includes(character.profession)) return 'Открыть собственное дело';
  if (kind === 'survive' && character.age < 14) return 'Вырасти в безопасности';
  return base;
}

function reputation(character: Character, group: string): number {
  return character.mind?.reputations.find(item => item.group === group)?.score ?? 0;
}

function personalStoryEvent(event: PersonalLifeEvent): CharacterStoryEvent {
  return {
    key: `personal:${event.id}`, source: 'personal', sourceId: event.id, tick: event.tick, year: event.year, month: event.month,
    title: event.title, description: event.description, importance: event.importance, refs: event.relatedRefs,
  };
}

function worldStoryEvent(event: WorldEvent): CharacterStoryEvent {
  return {
    key: `world:${event.id}`, source: 'world', sourceId: event.id, tick: dateTick(event.year, event.month), year: event.year, month: event.month,
    title: event.title, description: event.outcome || event.description, importance: event.importance, refs: event.entityRefs,
  };
}

function memoryStoryEvent(world: WorldState, memory: PersonalMemory): CharacterStoryEvent {
  const year = Math.floor(memory.learnedTick / 12);
  const month = memory.learnedTick % 12 + 1;
  const refs: EntityRef[] = [{ kind: 'character', id: memory.characterId }];
  if (memory.eventId) {
    const event = world.events.find(item => item.id === memory.eventId);
    if (event) refs.push(...event.entityRefs);
  }
  return {
    key: `memory:${memory.id}`, source: 'memory', sourceId: memory.id, tick: memory.learnedTick, year, month,
    title: memory.summary, description: `Личная память · уверенность ${Math.round(memory.confidence)}% · эмоциональный вес ${Math.round(memory.emotionalWeight)}%`,
    importance: memory.emotionalWeight >= 70 ? 2 : memory.emotionalWeight >= 35 ? 1 : 0, refs,
  };
}

function personalEventBelongsTo(event: PersonalLifeEvent, characterId: number): boolean {
  return event.characterId === characterId || event.otherCharacterIds.includes(characterId);
}

function worldEventBelongsTo(event: WorldEvent, characterId: number): boolean {
  return event.entityRefs.some(ref => ref.kind === 'character' && ref.id === characterId)
    || event.traces.some(ref => ref.kind === 'character' && ref.id === characterId);
}

function dateTick(year: number, month: number): number { return year * 12 + Math.max(1, month) - 1; }
function clamp(value: number): number { return Math.max(0, Math.min(100, Math.round(value))); }
function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }
