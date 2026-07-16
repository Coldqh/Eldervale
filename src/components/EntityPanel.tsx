import type { BurialRecord, Cemetery, EntityKind, EntityRef, Relationship, WorldState } from '../types';
import {
  armyStatusLabel, artifactTypeLabel, materialLabel, monsterSpeciesLabel, monsterTierLabel,
  buildingTypeLabel, professionLabel, settlementTypeLabel, speciesLabel,
} from '../i18n';
import { TextureIcon } from './TextureIcon';

const labels: Record<EntityKind, string> = {
  kingdom: 'Государство', settlement: 'Поселение', character: 'Личность', army: 'Армия', monster: 'Существо',
  artifact: 'Артефакт', book: 'Книга', dungeon: 'Подземелье', war: 'Война', dynasty: 'Династия', tradeRoute: 'Торговый путь',
  animalPopulation: 'Популяция животных', ingredient: 'Природный ресурс', recipe: 'Алхимический рецепт',
  building: 'Здание', household: 'Домохозяйство', establishment: 'Заведение', item: 'Предмет', productionRecipe: 'Производственный рецепт', field: 'Поле', constructionProject: 'Строительный проект',
  cemetery: 'Кладбище', burial: 'Кладбищенская запись', travelingMerchant: 'Странствующий торговец', militaryUnit: 'Военное подразделение', supplyWagon: 'Военный обоз',
};

export function EntityPanel({ world, selected, onSelect }: { world: WorldState; selected?: EntityRef; onSelect: (ref: EntityRef) => void }) {
  if (!selected) return <div className="empty-state"><span>✦</span><strong>Выбери объект на карте</strong><p>Поселения, государства, чудовища, армии и руины связаны одной причинной историей.</p></div>;
  const entity = getEntity(world, selected);
  if (!entity) return null;
  const subjectRef = entityIsBurial(entity) && entity.subjectKind !== 'anonymous' && entity.subjectId
    ? { kind: entity.subjectKind, id: entity.subjectId } as EntityRef
    : undefined;
  const relatedEvents = world.events.filter(event => event.entityRefs.some(ref =>
    (ref.kind === selected.kind && ref.id === selected.id) || (subjectRef && ref.kind === subjectRef.kind && ref.id === subjectRef.id),
  )).slice(-12).reverse();
  return <div className="entity-panel">
    <div className="entity-panel-title"><TextureIcon kind={selected.kind} subtype={entity.species ?? entity.type ?? entity.tier} /><div><div className="eyebrow">{labels[selected.kind]}</div>
    <h2>{getTitle(world, selected)}</h2></div></div>
    <div className="entity-stats">{renderStats(world, selected, entity, onSelect)}</div>
    {relatedEvents.length > 0 && <section><h3>След в истории</h3>{relatedEvents.map(event => <div className="history-link detailed-history" key={event.id}>
      <span>{event.year}.{String(event.month).padStart(2, '0')}</span>
      <div><strong>{event.title}</strong><small>{event.description}</small><em>Причина: {event.cause}</em><em>Условия: {event.conditions.join('; ')}</em><em>Действие: {event.decision}</em><em>Результат: {event.outcome}</em>{event.consequences.length > 0 && <em>Последствия: {event.consequences.join('; ')}</em>}</div>
    </div>)}</section>}
  </div>;
}

function getEntity(world: WorldState, ref: EntityRef): any {
  const map: Record<EntityKind, any[]> = {
    kingdom: world.kingdoms, settlement: world.settlements, character: world.characters, army: world.armies, monster: world.monsters,
    artifact: world.artifacts, book: world.books, dungeon: world.dungeons, war: world.wars, dynasty: world.dynasties, tradeRoute: world.tradeRoutes,
    animalPopulation: world.animalPopulations, ingredient: world.ingredients, recipe: world.alchemyRecipes,
    building: world.buildings, household: world.households, establishment: world.establishments, item: world.items, productionRecipe: world.productionRecipes, field: world.fields, constructionProject: world.constructionProjects,
    cemetery: world.cemeteries ?? [], burial: world.burials ?? [], travelingMerchant: world.travelingMerchants ?? [], militaryUnit: world.militaryUnits ?? [], supplyWagon: world.supplyWagons ?? [],
  };
  const direct = map[ref.kind].find(item => item.id === ref.id);
  if (direct) return direct;
  if (ref.kind === 'character' || ref.kind === 'monster') return world.burials?.find(item => item.subjectKind === ref.kind && item.subjectId === ref.id);
  return undefined;
}

export function getTitle(world: WorldState, ref: EntityRef): string {
  const entity = getEntity(world, ref);
  if (!entity) return 'Неизвестно';
  if (ref.kind === 'household') {
    const head = world.characters.find(character => character.id === entity.headCharacterId)
      ?? world.burials?.find(item => item.subjectKind === 'character' && item.subjectId === entity.headCharacterId);
    return `Домохозяйство ${head?.name ?? `№${entity.id}`}`;
  }
  return entity.name ?? entity.title ?? `Объект №${entity.id}`;
}


function entityIsBurial(entity: any): entity is BurialRecord {
  return Boolean(entity && typeof entity === 'object' && typeof entity.subjectKind === 'string' && typeof entity.state === 'string' && typeof entity.deathYear === 'number');
}

function burialStateLabel(state: BurialRecord['state']): string {
  const labels: Record<BurialRecord['state'], string> = {
    corpse: 'тело ожидает погребения', buried: 'погребён', cremated: 'кремирован', 'mass-grave': 'общая могила', trophy: 'останки сохранены как трофей', decayed: 'останки истлели',
  };
  return labels[state];
}

function cemeteryOccupancy(world: WorldState, cemetery: Cemetery): number {
  const ids = new Set(cemetery.burialIds);
  return (world.burials ?? []).filter(item => ids.has(item.id)).reduce((sum, item) => sum + Math.max(1, item.count), 0);
}

function link(label: string, ref: EntityRef, onSelect: (ref: EntityRef) => void) {
  return <button className="inline-link" onClick={() => onSelect(ref)}>{label}</button>;
}
function links(world: WorldState, refs: EntityRef[], onSelect: (ref: EntityRef) => void) {
  if (!refs.length) return 'нет';
  return <span className="inline-links">{refs.map(ref => <span key={`${ref.kind}-${ref.id}`}>{link(getTitle(world, ref), ref, onSelect)}</span>)}</span>;
}
function row(label: string, value: React.ReactNode) { return <div className="stat-row"><span>{label}</span><strong>{value}</strong></div>; }

function relationshipText(world: WorldState, characterId: number, relationship: Relationship, onSelect: (ref: EntityRef) => void) {
  const otherId = relationship.characterAId === characterId ? relationship.characterBId : relationship.characterAId;
  return <span className="relationship-line" key={relationship.id}>{link(getTitle(world, { kind: 'character', id: otherId }), { kind: 'character', id: otherId }, onSelect)}<small>{relationship.kind}, сила {relationship.strength}: {relationship.reason}</small></span>;
}


function itemTemplateName(world: WorldState, templateId: string): string {
  return world.items.find(item => item.templateId === templateId)?.name ?? templateId.replaceAll('_', ' ');
}
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(value < 10 ? 1 : 0);
}

function renderStats(world: WorldState, ref: EntityRef, entity: any, onSelect: (ref: EntityRef) => void) {
  if (ref.kind === 'army') {
    const kingdom = world.kingdoms.find(item => item.id === entity.kingdomId);
    const commander = world.characters.find(item => item.id === entity.commanderId);
    const garrison = entity.garrisonBuildingId ? world.buildings.find(item => item.id === entity.garrisonBuildingId) : undefined;
    const arsenal = entity.arsenalBuildingId ? world.buildings.find(item => item.id === entity.arsenalBuildingId) : undefined;
    const castle = entity.castleBuildingId ? world.buildings.find(item => item.id === entity.castleBuildingId) : undefined;
    const soldierRefs = (entity.soldierIds ?? []).slice(0, 24).map((id: number) => ({ kind: 'character' as const, id }));
    const unitRefs = (entity.unitIds ?? []).map((id: number) => ({ kind: 'militaryUnit' as const, id }));
    const wagonRefs = (entity.supplyWagonIds ?? []).map((id: number) => ({ kind: 'supplyWagon' as const, id }));
    return <>{row('Государство', kingdom ? link(kingdom.name, { kind: 'kingdom', id: kingdom.id }, onSelect) : 'неизвестно')}{row('Командир', commander ? link(commander.name, { kind: 'character', id: commander.id }, onSelect) : 'нет')}{row('Состояние', armyStatusLabel(entity.status))}{row('Именные бойцы', `${entity.soldierIds?.length ?? 0}`)}{row('Боевая сила', entity.strength)}{row('Готовность', `${Math.round(entity.readiness ?? 0)}%`)}{row('Мораль', `${Math.round(entity.morale)}%`)}{row('Снабжение', `${Math.round(entity.supplies)}%`)}{row('Еда', `${Math.round(entity.logistics?.foodDays ?? 0)} дней`)}{row('Вода', `${Math.round(entity.logistics?.waterDays ?? 0)} дней`)}{row('Броня', `${Math.round(entity.logistics?.armorCoverage ?? 0)}%`)}{row('Оружие', `${Math.round(entity.logistics?.equipmentCoverage ?? 0)}%`)}{row('Дальний бой', `${Math.round(entity.logistics?.rangedCoverage ?? 0)}%`)}{row('Лошади', entity.logistics?.horses ?? 0)}{row('Повозки', entity.logistics?.wagons ?? 0)}{row('Долг по жалованию', `${Math.round(entity.logistics?.payrollDebt ?? 0)} крон`)}{row('Дезертиры', entity.logistics?.desertions ?? 0)}{row('Раненые', entity.logistics?.wounded ?? 0)}{row('Казарма', garrison ? link(garrison.name, { kind: 'building', id: garrison.id }, onSelect) : 'нет')}{row('Арсенал', arsenal ? link(arsenal.name, { kind: 'building', id: arsenal.id }, onSelect) : 'нет')}{row('Замок', castle ? link(castle.name, { kind: 'building', id: castle.id }, onSelect) : 'нет')}{row('Подразделения', links(world, unitRefs, onSelect))}{row('Обозы', links(world, wagonRefs, onSelect))}{row('Бойцы', links(world, soldierRefs, onSelect))}{row('История походов', entity.campaignHistory.join(' '))}</>;
  }
  if (ref.kind === 'militaryUnit') {
    const army = world.armies.find(item => item.id === entity.armyId);
    const commander = world.characters.find(item => item.id === entity.commanderId);
    return <>{row('Армия', army ? link(army.name, { kind: 'army', id: army.id }, onSelect) : 'нет')}{row('Тип', entity.type)}{row('Командир', commander ? link(commander.name, { kind: 'character', id: commander.id }, onSelect) : 'нет')}{row('Бойцы', `${entity.memberIds.length}`)}{row('Подготовка', `${Math.round(entity.training)}%`)}{row('Сплочённость', `${Math.round(entity.cohesion)}%`)}{row('Оснащение', `${Math.round(entity.equipmentCoverage)}%`)}{row('Лошади', entity.horseCount)}{row('Опыт', `${Math.round(entity.experience)}%`)}{row('Состав', links(world, entity.memberIds.slice(0, 32).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}{row('История', entity.history.join(' '))}</>;
  }
  if (ref.kind === 'supplyWagon') {
    const army = world.armies.find(item => item.id === entity.armyId);
    return <>{row('Армия', army ? link(army.name, { kind: 'army', id: army.id }, onSelect) : 'нет')}{row('Состояние', entity.status)}{row('Координаты', `${entity.x}:${entity.y}`)}{row('Повозки', entity.wagonCount)}{row('Лошади', entity.horseCount)}{row('Вместимость', entity.capacity)}{row('Состояние повозок', `${Math.round(entity.condition)}%`)}{row('Охрана', links(world, entity.escortIds.map((id: number) => ({ kind: 'character' as const, id })), onSelect))}{row('Груз', links(world, entity.inventoryItemIds.slice(0, 40).map((id: number) => ({ kind: 'item' as const, id })), onSelect))}{row('История', entity.history.join(' '))}</>;
  }
  if (ref.kind === 'travelingMerchant') {
    const character = world.characters.find(item => item.id === entity.characterId);
    const current = world.settlements.find(item => item.id === entity.currentSettlementId);
    const next = entity.nextSettlementId ? world.settlements.find(item => item.id === entity.nextSettlementId) : undefined;
    return <>{row('Торговец', character ? link(character.name, { kind: 'character', id: character.id }, onSelect) : 'неизвестен')}{row('Состояние', entity.status)}{row('Текущая стоянка', current ? link(current.name, { kind: 'settlement', id: current.id }, onSelect) : 'в пути')}{row('Следующая остановка', next ? link(next.name, { kind: 'settlement', id: next.id }, onSelect) : 'не назначена')}{row('Касса', `${Math.round(entity.cash)} крон`)}{row('Товары', links(world, entity.wagonInventoryItemIds.slice(0, 30).map((id: number) => ({ kind: 'item' as const, id })), onSelect))}{row('История', entity.history.join(' '))}</>;
  }
  if (ref.kind === 'field') {
    const farm = world.buildings.find(item => item.id === entity.farmBuildingId);
    const establishment = entity.establishmentId ? world.establishments.find(item => item.id === entity.establishmentId) : undefined;
    return <>
      {row('Культура', entity.crop)}{row('Состояние', entity.state)}{row('Площадь', `${entity.cells.length} клеток`)}
      {row('Плодородие', `${Math.round(entity.fertility)}%`)}{row('Влажность', `${Math.round(entity.moisture)}%`)}{row('Сорняки', `${Math.round(entity.weeds)}%`)}{row('Вредители', `${Math.round(entity.pests)}%`)}
      {row('Работы', `${Math.round(entity.laborDone)} / ${Math.round(entity.laborRequired)}`)}{row('Ожидаемый урожай', entity.expectedYield)}
      {row('Ферма', farm ? link(farm.name, { kind: 'building', id: farm.id }, onSelect) : 'не найдена')}
      {row('Хозяйство', establishment ? link(establishment.name, { kind: 'establishment', id: establishment.id }, onSelect) : 'нет отдельного заведения')}
      {row('Расположение', `квадрат ${entity.globalX}:${entity.globalY}`)}{row('История', entity.history.join(' '))}
    </>;
  }
  if (ref.kind === 'constructionProject') {
    const building = entity.buildingId ? world.buildings.find(item => item.id === entity.buildingId) : undefined;
    const materialLines = Object.entries(entity.requiredMaterials).map(([id, amount]) => `${itemTemplateName(world, id)} ${formatNumber(entity.deliveredMaterials[id] ?? 0)}/${formatNumber(amount as number)}`);
    return <>
      {row('Этап', entity.stage)}{row('Причина', entity.reason)}{row('Площадка', `квадрат ${entity.globalX}:${entity.globalY}, область ${entity.localX}:${entity.localY} — ${entity.localWidth}×${entity.localHeight}`)}
      {row('Материалы', materialLines.join('; '))}{row('Труд', `${Math.round(entity.laborDone)} / ${Math.round(entity.laborRequired)}`)}
      {row('Строители', links(world, entity.builderIds.slice(0, 18).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
      {row('Начато', `${entity.startedYear}.${String(entity.startedMonth).padStart(2, '0')}`)}
      {building && row('Готовое здание', link(building.name, { kind: 'building', id: building.id }, onSelect))}
      {row('История', entity.history.join(' '))}
    </>;
  }
  if (ref.kind === 'cemetery') {
    const cemetery = entity as Cemetery;
    const burialRefs = cemetery.burialIds.slice(-80).reverse().map(id => ({ kind: 'burial' as const, id }));
    return <>
      {row('Поселение', cemetery.settlementId ? link(getTitle(world, { kind: 'settlement', id: cemetery.settlementId }), { kind: 'settlement', id: cemetery.settlementId }, onSelect) : 'вне поселения')}
      {row('Расположение', `квадрат ${cemetery.globalX}:${cemetery.globalY}, участок ${cemetery.localX}:${cemetery.localY}`)}
      {row('Основано', `${cemetery.foundedYear} год`)}
      {row('Погребено', `${cemeteryOccupancy(world, cemetery)} / ${cemetery.capacity}`)}
      {row('Смотритель', cemetery.caretakerCharacterId ? link(getTitle(world, { kind: 'character', id: cemetery.caretakerCharacterId }), { kind: 'character', id: cemetery.caretakerCharacterId }, onSelect) : 'нет постоянного смотрителя')}
      {row('Последние захоронения', links(world, burialRefs, onSelect))}
      {row('История', cemetery.history.join(' ') || 'Записей пока нет.')}
    </>;
  }
  if (ref.kind === 'burial' || entityIsBurial(entity)) {
    const burial = entity as BurialRecord;
    const cemetery = burial.cemeteryId ? world.cemeteries.find(item => item.id === burial.cemeteryId) : undefined;
    return <>
      {row('Статус', burialStateLabel(burial.state))}
      {row('Кого хранит запись', burial.subjectKind === 'character' ? 'личность' : burial.subjectKind === 'monster' ? 'чудовище' : 'неизвестные погибшие')}
      {row('Количество', burial.count)}
      {row('Вид', burial.species)}
      {burial.birthYear !== undefined && row('Годы жизни', `${burial.birthYear}–${burial.deathYear}`)}
      {row('Дата смерти', `${burial.deathYear}.${String(burial.deathMonth).padStart(2, '0')}`)}
      {row('Причина смерти', burial.cause)}
      {row('Убийца или виновник', burial.killerName ?? 'не установлен')}
      {burial.profession && row('При жизни', professionLabel(burial.profession))}
      {burial.tier && row('Ранг существа', monsterTierLabel(burial.tier))}
      {burial.power !== undefined && row('Сила при жизни', burial.power)}
      {burial.titles?.length > 0 && row('Титулы', burial.titles.join(', '))}
      {row('Известность', burial.renown)}
      {row('Кладбище', cemetery ? link(cemetery.name, { kind: 'cemetery', id: cemetery.id }, onSelect) : burial.state === 'corpse' ? 'ещё не перенесено' : 'вне кладбища')}
      {row('Место', `квадрат ${burial.globalX}:${burial.globalY}, клетка ${burial.localX}:${burial.localY}`)}
      {row('Сводка', burial.summary)}
      {row('Записи', burial.history.join(' ') || 'Дополнительных записей нет.')}
    </>;
  }
  if (ref.kind === 'building') {
    const settlementRef = { kind: 'settlement' as const, id: entity.settlementId };
    return <>
      {row('Поселение', link(getTitle(world, settlementRef), settlementRef, onSelect))}
      {row('Тип', buildingTypeLabel(entity.type))}{row('Район', entity.districtName)}
      {row('Положение', `квадрат ${entity.globalX}:${entity.globalY}, область ${entity.localX}:${entity.localY} — ${entity.localWidth}×${entity.localHeight} клеток`)}
      {row('Вход', `клетка ${entity.entranceX}:${entity.entranceY}`)}
      {row('Этажи', entity.floors)}{row('Вместимость', entity.capacity)}{row('Состояние', `${entity.condition}%`)}{row('Построено', `${entity.builtYear} год`)}
      {row('Вода', entity.hasWater ? 'есть' : 'нет')}{row('Очаг', entity.hasHearth ? 'есть' : 'нет')}
      {row('Владелец', entity.ownerCharacterId ? link(getTitle(world, { kind: 'character', id: entity.ownerCharacterId }), { kind: 'character', id: entity.ownerCharacterId }, onSelect) : 'община или власть')}
      {row('Домохозяйство', entity.householdId ? link(getTitle(world, { kind: 'household', id: entity.householdId }), { kind: 'household', id: entity.householdId }, onSelect) : 'нет')}
      {row('Заведение', entity.establishmentId ? link(getTitle(world, { kind: 'establishment', id: entity.establishmentId }), { kind: 'establishment', id: entity.establishmentId }, onSelect) : 'нет')}
      {row('Жители', links(world, entity.residentIds.slice(0, 20).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
      {row('Работники', links(world, entity.workerIds.slice(0, 20).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
      {row('Предметы', links(world, entity.inventoryItemIds.slice(0, 24).map((id: number) => ({ kind: 'item' as const, id })), onSelect))}
      {row('Помещения', entity.rooms.join(', ') || 'не описаны')}{row('История', entity.history.join(' ') || 'Заметных событий не было.')}
    </>;
  }
  if (ref.kind === 'household') {
    return <>
      {row('Глава', link(getTitle(world, { kind: 'character', id: entity.headCharacterId }), { kind: 'character', id: entity.headCharacterId }, onSelect))}
      {row('Члены', links(world, entity.memberIds.map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
      {row('Поселение', link(getTitle(world, { kind: 'settlement', id: entity.settlementId }), { kind: 'settlement', id: entity.settlementId }, onSelect))}
      {row('Дом', entity.homeBuildingId ? link(getTitle(world, { kind: 'building', id: entity.homeBuildingId }), { kind: 'building', id: entity.homeBuildingId }, onSelect) : 'бездомные')}
      {row('Положение', entity.status)}{row('Богатство', `${Math.round(entity.wealth)} крон`)}{row('Долг', `${Math.round(entity.debt)} крон`)}
      {row('Доход в месяц', `${entity.monthlyIncome.toFixed(1)} крон`)}{row('Расходы в месяц', `${entity.monthlyExpenses.toFixed(1)} крон`)}
      {row('Запас еды', `${Math.round(entity.foodReserveDays)} дней`)}{row('Запас топлива', `${Math.round(entity.fuelReserveDays)} дней`)}
      {row('Потребности', `голод ${entity.needs.hunger}%, жажда ${entity.needs.thirst}%, усталость ${entity.needs.rest}%, холод ${entity.needs.warmth}%, безопасность ${entity.needs.safety}%, общение ${entity.needs.social}%`)}
      {row('Имущество', links(world, entity.inventoryItemIds.slice(0, 30).map((id: number) => ({ kind: 'item' as const, id })), onSelect))}
      {row('История', entity.history.join(' ') || 'Дом ведёт обычную жизнь.')}
    </>;
  }
  if (ref.kind === 'establishment') {
    return <>
      {row('Тип', entity.type)}
      {row('Поселение', link(getTitle(world, { kind: 'settlement', id: entity.settlementId }), { kind: 'settlement', id: entity.settlementId }, onSelect))}
      {row('Здание', link(getTitle(world, { kind: 'building', id: entity.buildingId }), { kind: 'building', id: entity.buildingId }, onSelect))}
      {row('Владелец', link(getTitle(world, { kind: 'character', id: entity.ownerCharacterId }), { kind: 'character', id: entity.ownerCharacterId }, onSelect))}
      {row('Работники', links(world, entity.workerIds.map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
      {row('Часы работы', `${String(entity.openHour).padStart(2, '0')}:00–${String(entity.closeHour).padStart(2, '0')}:00`)}
      {row('Состояние', entity.active ? 'работает' : 'закрыто')}{row('Репутация', `${entity.reputation}%`)}
      {row('Касса', `${entity.cash.toFixed(1)} крон`)}{row('Долг', `${entity.debt.toFixed(1)} крон`)}
      {row('Выручка за месяц', `${entity.monthlyRevenue.toFixed(1)} крон`)}{row('Расходы за месяц', `${entity.monthlyExpenses.toFixed(1)} крон`)}
      {row('Меню и цены', Object.entries(entity.menu).map(([template, price]) => `${itemTemplateName(world, template)} — ${Number(price).toFixed(1)}`).join(', ') || 'нет')}
      {row('Производство', links(world, entity.recipeIds.map((id: number) => ({ kind: 'productionRecipe' as const, id })), onSelect))}
      {row('Запасы', links(world, entity.inventoryItemIds.slice(0, 30).map((id: number) => ({ kind: 'item' as const, id })), onSelect))}
      {row('Поставщики', links(world, entity.supplierEstablishmentIds.map((id: number) => ({ kind: 'establishment' as const, id })), onSelect))}
      {row('История', entity.history.join(' ') || 'Заметных событий не было.')}
    </>;
  }
  if (ref.kind === 'item') return <>
    {row('Категория', entity.category)}{row('Материал', entity.material)}{row('Количество', `${formatNumber(entity.quantity)} ${entity.unit}`)}
    {row('Вес', `${formatNumber(entity.quantity * entity.weightPerUnit)} ед.`)}{row('Качество', `${entity.quality}%`)}{row('Состояние', `${entity.condition}%`)}{row('Свежесть', `${entity.freshness}%`)}
    {row('Базовая стоимость', `${formatNumber(entity.baseValue * entity.quantity)} крон`)}{row('Создано', `${entity.createdYear} год`)}{row('Источник', entity.source)}
    {entity.equipmentSlot && row('Слот', entity.equipmentSlot)}{entity.dye && row('Цвет', entity.dye)}{entity.warmth !== undefined && row('Тепло', entity.warmth)}{entity.armor !== undefined && row('Защита', entity.armor)}{entity.damage !== undefined && row('Урон', entity.damage)}{entity.toolType && row('Назначение', entity.toolType)}
    {row('Создатель', entity.craftedByCharacterId ? link(getTitle(world, { kind: 'character', id: entity.craftedByCharacterId }), { kind: 'character', id: entity.craftedByCharacterId }, onSelect) : 'не указан')}
    {row('Владелец', entity.ownerCharacterId ? link(getTitle(world, { kind: 'character', id: entity.ownerCharacterId }), { kind: 'character', id: entity.ownerCharacterId }, onSelect) : entity.householdId ? link(getTitle(world, { kind: 'household', id: entity.householdId }), { kind: 'household', id: entity.householdId }, onSelect) : entity.establishmentId ? link(getTitle(world, { kind: 'establishment', id: entity.establishmentId }), { kind: 'establishment', id: entity.establishmentId }, onSelect) : 'общий запас')}
    {row('Место', entity.buildingId ? link(getTitle(world, { kind: 'building', id: entity.buildingId }), { kind: 'building', id: entity.buildingId }, onSelect) : link(getTitle(world, { kind: 'settlement', id: entity.settlementId }), { kind: 'settlement', id: entity.settlementId }, onSelect))}
    {row('История', entity.history.join(' ') || 'Обычная партия товара.')}
  </>;
  if (ref.kind === 'productionRecipe') return <>
    {row('Категория', entity.category)}{row('Профессия', professionLabel(entity.profession))}{row('Где производится', entity.establishmentTypes.join(', '))}
    {row('Вход', entity.inputs.map((input: any) => `${itemTemplateName(world, input.templateId)} × ${formatNumber(input.quantity)}`).join(', '))}
    {row('Выход', entity.outputs.map((output: any) => `${itemTemplateName(world, output.templateId)} × ${formatNumber(output.quantity)}`).join(', '))}
    {row('Топливо', entity.fuelTemplateId ? `${itemTemplateName(world, entity.fuelTemplateId)} × ${entity.fuelQuantity ?? 1}` : 'не требуется')}
    {row('Труд', `${entity.laborHours} ч.`)}{row('Минимальный навык', entity.minimumSkill)}{row('Культура', entity.culture ?? 'распространённый рецепт')}{row('Описание', entity.description)}
  </>;
  if (ref.kind === 'kingdom') {
    const diplomacy = entity.diplomacy.slice().sort((a: any, b: any) => a.score - b.score).slice(0, 5);
    const controlledTiles = world.tiles.filter(tile => tile.kingdomId === entity.id).length;
    return <>
      {row('Правитель', link(getTitle(world, { kind: 'character', id: entity.rulerId }), { kind: 'character', id: entity.rulerId }, onSelect))}
      {row('Правящий дом', entity.dynastyId ? link(getTitle(world, { kind: 'dynasty', id: entity.dynastyId }), { kind: 'dynasty', id: entity.dynastyId }, onSelect) : 'не закреплён')}
      {row('Столица', link(getTitle(world, { kind: 'settlement', id: entity.capitalId }), { kind: 'settlement', id: entity.capitalId }, onSelect))}
      {row('Народ', speciesLabel(entity.species))}{row('Культура', entity.culture)}{row('Вера', entity.religion)}
      {row('Стабильность', `${entity.stability}%`)}{row('Казна', `${Math.round(entity.treasury)} крон`)}{row('Войско', `${entity.armyStrength} воинов`)}
      {row('Контролируемые земли', `${controlledTiles} глобальных клеток`)}{row('Освоение', controlledTiles ? 'границы растут от поселений, дорог и гарнизонов' : 'контроль ещё не закреплён')}
      {row('Законы', entity.laws.join(', '))}
      {row('Притязания', links(world, entity.claims.map((id: number) => ({ kind: 'settlement' as const, id })), onSelect))}
      {row('Отношения', <span className="relationship-stack">{diplomacy.map((record: any) => <span key={record.kingdomId}>{link(getTitle(world, { kind: 'kingdom', id: record.kingdomId }), { kind: 'kingdom', id: record.kingdomId }, onSelect)}<small>{record.status}, {record.score}: {record.reason}</small></span>)}</span>)}
    </>;
  }
  if (ref.kind === 'settlement') return <>
    {row('Государство', link(getTitle(world, { kind: 'kingdom', id: entity.kingdomId }), { kind: 'kingdom', id: entity.kingdomId }, onSelect))}
    {row('Тип', settlementTypeLabel(entity.type))}{row('Население', `${entity.population} жителей`)}{row('Жилая вместимость', `${entity.residentialCapacity} мест`)}
    {row('Домохозяйства', entity.households)}{row('Глобальные квадраты', `${entity.districts.length} · ${entity.districts.map((item: any) => item.name).join(', ')}`)}{row('Ресурс', entity.resource)}
    {row('Благосостояние', `${entity.prosperity}%`)}{row('Защита', `${entity.defense}%`)}{row('Запасы пищи', entity.food)}
    {row('Беспорядки', `${entity.unrest}%`)}{row('Нехватка', entity.shortages.join(', ') || 'нет')}{row('Повреждения', `${entity.damaged}%`)}
    {row('Пути', links(world, entity.tradeRouteIds.map((id: number) => ({ kind: 'tradeRoute' as const, id })), onSelect))}
    {row('Здания', links(world, (entity.buildingIds ?? []).slice(0, 30).map((id: number) => ({ kind: 'building' as const, id })), onSelect))}
    {row('Домохозяйства', links(world, (entity.householdIds ?? []).slice(0, 24).map((id: number) => ({ kind: 'household' as const, id })), onSelect))}
    {row('Заведения', links(world, (entity.establishmentIds ?? []).slice(0, 24).map((id: number) => ({ kind: 'establishment' as const, id })), onSelect))}
    {entity.economy && row('Экономика', `денежная масса ${Math.round(entity.economy.coinSupply)} ${entity.economy.currency}, цены ×${entity.economy.priceIndex.toFixed(2)}, зарплаты ×${entity.economy.wageIndex.toFixed(2)}, аренда ×${entity.economy.rentIndex.toFixed(2)}, налог ${(entity.economy.taxRate * 100).toFixed(1)}%`)}
    {entity.economy && row('Торговля за месяц', `${entity.economy.lastMonthlyTrade.toFixed(1)} крон · банкротств ${entity.economy.bankruptcies}`)}
    {row('Постройки по старому учёту', entity.buildings.join(', '))}{row('Склад', Object.entries(entity.stockpile).filter(([, value]) => Number(value) > 0).slice(0, 18).map(([name, value]) => `${name}: ${Math.round(Number(value))}`).join(', ') || 'пусто')}{row('Скот', Object.entries(entity.livestock).map(([name, value]) => `${name}: ${value}`).join(', ') || 'нет')}{row('История', entity.history.join(' '))}
  </>;
  if (ref.kind === 'character') {
    const relationships = world.relationships.filter(relation => entity.relationshipIds.includes(relation.id)).slice(0, 10);
    return <>
      {row('Состояние', entity.alive ? `${entity.age} лет` : `умер в ${entity.deathYear} году`)}{row('Вид', speciesLabel(entity.species))}
      {row('Профессия', professionLabel(entity.profession))}{row('Рабочее место', entity.workplace)}{row('Домашний район', entity.homeDistrict ?? 'не закреплён')}{row('Родина', link(getTitle(world, { kind: 'settlement', id: entity.settlementId }), { kind: 'settlement', id: entity.settlementId }, onSelect))}
      {row('Домохозяйство', entity.householdId ? link(getTitle(world, { kind: 'household', id: entity.householdId }), { kind: 'household', id: entity.householdId }, onSelect) : 'не закреплено')}
      {row('Дом', entity.homeBuildingId ? link(getTitle(world, { kind: 'building', id: entity.homeBuildingId }), { kind: 'building', id: entity.homeBuildingId }, onSelect) : 'нет постоянного жилья')}
      {row('Место работы', entity.workplaceBuildingId ? link(getTitle(world, { kind: 'building', id: entity.workplaceBuildingId }), { kind: 'building', id: entity.workplaceBuildingId }, onSelect) : 'не закреплено')}
      {row('Работодатель', entity.employerEstablishmentId ? link(getTitle(world, { kind: 'establishment', id: entity.employerEstablishmentId }), { kind: 'establishment', id: entity.employerEstablishmentId }, onSelect) : 'самостоятельный труд или нет работы')}
      {row('Династия', entity.dynastyId ? link(getTitle(world, { kind: 'dynasty', id: entity.dynastyId }), { kind: 'dynasty', id: entity.dynastyId }, onSelect) : 'нет')}
      {row('Супруг', entity.spouseId ? link(getTitle(world, { kind: 'character', id: entity.spouseId }), { kind: 'character', id: entity.spouseId }, onSelect) : 'нет')}
      {row('Родители', links(world, entity.parentIds.map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
      {row('Дети', links(world, entity.childIds.slice(0, 12).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
      {row('Известность', entity.renown)}{row('Здоровье', `${entity.health}%`)}{row('Богатство', `${Math.round(entity.wealth)} крон`)}{row('Верность', `${entity.loyalty}%`)}
      {row('Цель', entity.ambition)}{row('Титулы', entity.titles.join(', ') || 'нет')}{row('Травмы', entity.injuries.join(', ') || 'нет')}
      {entity.schedule && row('Распорядок', `подъём ${entity.schedule.wakeHour}:00, работа ${entity.schedule.workStartHour}:00–${entity.schedule.workEndHour}:00, сон ${entity.schedule.sleepHour}:00, выходной день ${entity.schedule.restDay}; сейчас ${entity.schedule.currentActivity}`)}
      {entity.needs && row('Потребности', `голод ${Math.round(entity.needs.hunger)}%, жажда ${Math.round(entity.needs.thirst)}%, усталость ${Math.round(entity.needs.rest)}%, холод ${Math.round(entity.needs.warmth)}%, безопасность ${Math.round(entity.needs.safety)}%, общение ${Math.round(entity.needs.social)}%`)}
      {row('Личный кошелёк', `${Math.round((entity.wallet ?? 0) * 10) / 10} крон`)}
      {entity.equipment && row('Одежда', `${entity.equipment.socialTier} · ${entity.equipment.material} · ${entity.equipment.color} · состояние ${Math.round(entity.equipment.condition)}%`)}
      {entity.equipment && row('Экипировка', links(world, Object.values(entity.equipment.equippedItemIds ?? {}).filter((id): id is number => typeof id === 'number').map(id => ({ kind: 'item' as const, id })), onSelect))}
      {entity.serviceStatus && entity.serviceStatus !== 'гражданский' && row('Военная служба', `${entity.serviceStatus}${entity.militaryRole ? ` · ${entity.militaryRole}` : ''}`)}
      {entity.militaryUnitId && row('Подразделение', link(getTitle(world, { kind: 'militaryUnit', id: entity.militaryUnitId }), { kind: 'militaryUnit', id: entity.militaryUnitId }, onSelect))}
      {typeof entity.militaryExperience === 'number' && row('Военный опыт', `${Math.round(entity.militaryExperience)}%`)}
      {(entity.servicePayArrears ?? 0) > 0 && row('Невыплаченное жалование', `${Math.round(entity.servicePayArrears)} крон`)}
      {entity.skills && row('Навыки', Object.entries(entity.skills).sort((a: any, b: any) => Number(b[1]) - Number(a[1])).slice(0, 10).map(([name, value]) => `${professionLabel(name)} ${value}`).join(', ') || 'нет развитых навыков')}
      {row('Личные вещи', links(world, (entity.inventoryItemIds ?? []).slice(0, 20).map((id: number) => ({ kind: 'item' as const, id })), onSelect))}
      {row('Отношения', relationships.length ? <span className="relationship-stack">{relationships.map(relation => relationshipText(world, entity.id, relation, onSelect))}</span> : 'нет заметных связей')}
      {row('Биография', entity.biography.join(' '))}
    </>;
  }
  if (ref.kind === 'monster') return <>
    {row('Вид', monsterSpeciesLabel(entity.species))}{row('Ранг', monsterTierLabel(entity.tier))}{row('Состояние', entity.alive ? 'живо' : 'мертво')}
    {row('Поведение', entity.behavior)}{row('Цель', entity.goal)}{row('Голод', `${entity.hunger}%`)}{row('Территория', `${entity.territoryRadius} клеток`)}{row('Физический размер', `${entity.footprintWidth ?? 1}×${entity.footprintHeight ?? 1} локальных клеток`)}
    {row('Сила', entity.power)}{row('Здоровье', entity.health)}{row('Возраст', `${entity.age} лет`)}{row('Жертвы', entity.kills)}{row('Сокровища', entity.hoard)}
    {row('Логово', entity.lairDungeonId ? link(getTitle(world, { kind: 'dungeon', id: entity.lairDungeonId }), { kind: 'dungeon', id: entity.lairDungeonId }, onSelect) : 'нет')}
    {row('История', entity.history.join(' ') || 'Пока не оставило заметного следа.')}
  </>;
  if (ref.kind === 'artifact') return <>
    {row('Тип', artifactTypeLabel(entity.type))}{row('Материал', materialLabel(entity.material))}{row('Создан', `${entity.yearCreated} год`)}{row('Изображение', entity.depiction)}{row('Сила', entity.power)}
    {row('Создатель', entity.creatorId ? link(getTitle(world, { kind: 'character', id: entity.creatorId }), { kind: 'character', id: entity.creatorId }, onSelect) : 'неизвестен')}
    {row('Владелец', entity.ownerId ? link(getTitle(world, { kind: 'character', id: entity.ownerId }), { kind: 'character', id: entity.ownerId }, onSelect) : 'утерян')}
    {row('Цепочка владения', entity.ownerHistory.map((record: any) => `${record.year}: ${record.characterId ? getTitle(world, { kind: 'character', id: record.characterId }) : 'неизвестно'} — ${record.reason}`).join('; '))}
    {row('История', entity.history.join(' '))}
  </>;
  if (ref.kind === 'book') return <>
    {row('Автор', link(getTitle(world, { kind: 'character', id: entity.authorId }), { kind: 'character', id: entity.authorId }, onSelect))}{row('Год', entity.yearWritten)}
    {row('Язык', entity.language)}{row('Тема', entity.subject)}{row('Достоверность', `${entity.reliability}%`)}{row('Предвзятость', entity.bias)}{row('Копии', entity.copies)}
    {row('Связанные события', entity.referencedEventIds.length)}{row('Содержание', entity.summary)}
  </>;
  if (ref.kind === 'dungeon') return <>
    {row('Происхождение', entity.origin)}{row('Первоначальная цель', entity.purpose)}{row('Построено', `${entity.builtYear} год`)}{row('Известно миру', entity.discovered ? 'да' : 'нет')}
    {row('Опасность', `${entity.danger}/10`)}{row('Глубина', `${entity.depth} уровней`)}{row('Обитатели', entity.currentInhabitants)}
    {row('Владелец земель', entity.ownerKingdomId ? link(getTitle(world, { kind: 'kingdom', id: entity.ownerKingdomId }), { kind: 'kingdom', id: entity.ownerKingdomId }, onSelect) : 'никто')}
    {row('Артефакты', links(world, entity.artifactIds.map((id: number) => ({ kind: 'artifact' as const, id })), onSelect))}{row('История', entity.history.join(' ') || 'История места ещё скрыта.')}
  </>;
  if (ref.kind === 'war') return <>
    {row('Нападающая сторона', link(getTitle(world, { kind: 'kingdom', id: entity.attackerId }), { kind: 'kingdom', id: entity.attackerId }, onSelect))}
    {row('Защитники', link(getTitle(world, { kind: 'kingdom', id: entity.defenderId }), { kind: 'kingdom', id: entity.defenderId }, onSelect))}
    {row('Причина', entity.cause)}{row('Цель', entity.goal)}{row('Спорные земли', links(world, entity.contestedSettlementIds.map((id: number) => ({ kind: 'settlement' as const, id })), onSelect))}
    {row('Начало', entity.startYear)}{row('Конец', entity.endYear ?? 'война идёт')}{row('Победитель', entity.victorId ? link(getTitle(world, { kind: 'kingdom', id: entity.victorId }), { kind: 'kingdom', id: entity.victorId }, onSelect) : 'не определён')}
    {row('Мирные условия', entity.peaceTerms ?? 'не заключены')}{row('Сражения', entity.battles)}{row('Потери атакующих', entity.attackerLosses)}{row('Потери защитников', entity.defenderLosses)}
    {row('Ход войны', entity.history.join(' '))}
  </>;
  if (ref.kind === 'dynasty') return <>
    {row('Основатель', link(getTitle(world, { kind: 'character', id: entity.founderId }), { kind: 'character', id: entity.founderId }, onSelect))}
    {row('Глава дома', link(getTitle(world, { kind: 'character', id: entity.currentHeadId }), { kind: 'character', id: entity.currentHeadId }, onSelect))}
    {row('Государство', entity.kingdomId ? link(getTitle(world, { kind: 'kingdom', id: entity.kingdomId }), { kind: 'kingdom', id: entity.kingdomId }, onSelect) : 'нет')}
    {row('Члены', links(world, entity.memberIds.slice(0, 18).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
    {row('Престиж', entity.prestige)}{row('Богатство', `${entity.wealth} крон`)}
    {row('Притязания', links(world, entity.claimKingdomIds.map((id: number) => ({ kind: 'kingdom' as const, id })), onSelect))}{row('История', entity.history.join(' '))}
  </>;
  if (ref.kind === 'tradeRoute') return <>
    {row('Начало', link(getTitle(world, { kind: 'settlement', id: entity.fromSettlementId }), { kind: 'settlement', id: entity.fromSettlementId }, onSelect))}
    {row('Конец', link(getTitle(world, { kind: 'settlement', id: entity.toSettlementId }), { kind: 'settlement', id: entity.toSettlementId }, onSelect))}
    {row('Товары', entity.goods.join(', '))}{row('Объём', entity.volume)}{row('Безопасность', `${entity.safety}%`)}{row('Состояние', entity.active ? 'действует' : 'закрыт')}
    {row('Контроль', links(world, entity.controlledByKingdomIds.map((id: number) => ({ kind: 'kingdom' as const, id })), onSelect))}{row('История', entity.history.join(' '))}
  </>;
  if (ref.kind === 'animalPopulation') return <>
    {row('Вид', entity.species)}{row('Координаты', `${entity.x}:${entity.y}`)}{row('Численность', `${entity.count} особей`)}{row('Вместимость биома', entity.carryingCapacity)}
    {row('Питание', entity.diet)}{row('Добыча', entity.preySpecies.join(', ') || 'растительность и падаль')}{row('Хищники', entity.predatorSpecies.join(', ') || 'нет обычных хищников')}
    {row('Здоровье', `${entity.health}%`)}{row('Размножение', entity.reproductionRate)}{row('Миграционное давление', `${entity.migrationDrive}%`)}{row('Добыто охотой за год', entity.huntedThisYear)}
    {row('Последняя причина изменения', entity.lastCause)}{row('История', entity.history.join(' ') || 'Заметных событий не было.')}
  </>;
  if (ref.kind === 'ingredient') return <>
    {row('Тип', entity.kind)}{row('Координаты', `${entity.x}:${entity.y}`)}{row('Запас', Math.round(entity.abundance))}{row('Предел восстановления', entity.carryingCapacity)}
    {row('Скорость восстановления', entity.regenerationRate)}{row('Сезон', entity.seasonMonths.join(', '))}{row('Свойства', entity.properties.join(', '))}{row('Токсичность', `${entity.toxicity}%`)}
    {row('Собрано за год', entity.harvestedThisYear)}{row('История', entity.history.join(' '))}
  </>;
  if (ref.kind === 'recipe') return <>
    {row('Результат', entity.result)}{row('Эффект', entity.effect)}{row('Риск', entity.risk)}{row('Открыт', `${entity.discoveryYear} год`)}
    {row('Открыватель', entity.discoveredById ? link(getTitle(world, { kind: 'character', id: entity.discoveredById }), { kind: 'character', id: entity.discoveredById }, onSelect) : 'неизвестен')}
    {row('Ингредиенты', links(world, entity.ingredientIds.map((id: number) => ({ kind: 'ingredient' as const, id })), onSelect))}{row('Источник знания', entity.source)}{row('Создано партий', entity.batchesCreated)}{row('История', entity.history.join(' '))}
  </>;
  return null;
}
