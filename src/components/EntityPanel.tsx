import type { EntityKind, EntityRef, Relationship, WorldState } from '../types';
import {
  armyStatusLabel, artifactTypeLabel, materialLabel, monsterSpeciesLabel, monsterTierLabel,
  buildingTypeLabel, professionLabel, settlementTypeLabel, speciesLabel,
} from '../i18n';

const labels: Record<EntityKind, string> = {
  kingdom: 'Государство', settlement: 'Поселение', character: 'Личность', army: 'Армия', monster: 'Существо',
  artifact: 'Артефакт', book: 'Книга', dungeon: 'Подземелье', war: 'Война', dynasty: 'Династия', tradeRoute: 'Торговый путь',
  animalPopulation: 'Популяция животных', ingredient: 'Природный ресурс', recipe: 'Алхимический рецепт',
  building: 'Здание', household: 'Домохозяйство', establishment: 'Заведение', item: 'Предмет', productionRecipe: 'Производственный рецепт',
};

export function EntityPanel({ world, selected, onSelect }: { world: WorldState; selected?: EntityRef; onSelect: (ref: EntityRef) => void }) {
  if (!selected) return <div className="empty-state"><span>✦</span><strong>Выбери объект на карте</strong><p>Поселения, государства, чудовища, армии и руины связаны одной причинной историей.</p></div>;
  const entity = getEntity(world, selected);
  if (!entity) return null;
  const relatedEvents = world.events.filter(event => event.entityRefs.some(ref => ref.kind === selected.kind && ref.id === selected.id)).slice(-12).reverse();
  return <div className="entity-panel">
    <div className="eyebrow">{labels[selected.kind]}</div>
    <h2>{getTitle(world, selected)}</h2>
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
    building: world.buildings, household: world.households, establishment: world.establishments, item: world.items, productionRecipe: world.productionRecipes,
  };
  return map[ref.kind].find(item => item.id === ref.id);
}

export function getTitle(world: WorldState, ref: EntityRef): string {
  const entity = getEntity(world, ref);
  if (!entity) return 'Неизвестно';
  if (ref.kind === 'household') {
    const head = world.characters.find(character => character.id === entity.headCharacterId);
    return `Домохозяйство ${head?.name ?? `№${entity.id}`}`;
  }
  return entity.name ?? entity.title ?? `Объект №${entity.id}`;
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
  if (ref.kind === 'building') {
    const settlementRef = { kind: 'settlement' as const, id: entity.settlementId };
    return <>
      {row('Поселение', link(getTitle(world, settlementRef), settlementRef, onSelect))}
      {row('Тип', buildingTypeLabel(entity.type))}{row('Район', entity.districtName)}
      {row('Положение', `квадрат ${entity.globalX}:${entity.globalY}, клетка ${entity.localX}:${entity.localY}`)}
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
      {entity.needs && row('Потребности', `голод ${entity.needs.hunger}%, жажда ${entity.needs.thirst}%, усталость ${entity.needs.rest}%, холод ${entity.needs.warmth}%, безопасность ${entity.needs.safety}%, общение ${entity.needs.social}%`)}
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
  if (ref.kind === 'army') return <>
    {row('Государство', link(getTitle(world, { kind: 'kingdom', id: entity.kingdomId }), { kind: 'kingdom', id: entity.kingdomId }, onSelect))}
    {row('Командир', link(getTitle(world, { kind: 'character', id: entity.commanderId }), { kind: 'character', id: entity.commanderId }, onSelect))}
    {row('Численность', `${entity.strength} воинов`)}{row('Мораль', `${entity.morale}%`)}{row('Припасы', `${entity.supplies}%`)}{row('Состояние', armyStatusLabel(entity.status))}
    {row('Походы', entity.campaignHistory.join(' ') || 'Не участвовало в крупных походах.')}
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
