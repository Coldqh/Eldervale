import type { EntityKind, EntityRef, Relationship, WorldState } from '../types';
import {
  armyStatusLabel, artifactTypeLabel, materialLabel, monsterSpeciesLabel, monsterTierLabel,
  professionLabel, settlementTypeLabel, speciesLabel,
} from '../i18n';

const labels: Record<EntityKind, string> = {
  kingdom: 'Государство', settlement: 'Поселение', character: 'Личность', army: 'Армия', monster: 'Существо',
  artifact: 'Артефакт', book: 'Книга', dungeon: 'Подземелье', war: 'Война', dynasty: 'Династия', tradeRoute: 'Торговый путь',
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
      <div><strong>{event.title}</strong><small>{event.description}</small><em>Причина: {event.cause}</em>{event.consequences.length > 0 && <em>Последствия: {event.consequences.join('; ')}</em>}</div>
    </div>)}</section>}
  </div>;
}

function getEntity(world: WorldState, ref: EntityRef): any {
  const map: Record<EntityKind, any[]> = {
    kingdom: world.kingdoms, settlement: world.settlements, character: world.characters, army: world.armies, monster: world.monsters,
    artifact: world.artifacts, book: world.books, dungeon: world.dungeons, war: world.wars, dynasty: world.dynasties, tradeRoute: world.tradeRoutes,
  };
  return map[ref.kind].find(item => item.id === ref.id);
}

export function getTitle(world: WorldState, ref: EntityRef): string {
  const entity = getEntity(world, ref);
  return entity?.name ?? entity?.title ?? 'Неизвестно';
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

function renderStats(world: WorldState, ref: EntityRef, entity: any, onSelect: (ref: EntityRef) => void) {
  if (ref.kind === 'kingdom') {
    const diplomacy = entity.diplomacy.slice().sort((a: any, b: any) => a.score - b.score).slice(0, 5);
    return <>
      {row('Правитель', link(getTitle(world, { kind: 'character', id: entity.rulerId }), { kind: 'character', id: entity.rulerId }, onSelect))}
      {row('Правящий дом', entity.dynastyId ? link(getTitle(world, { kind: 'dynasty', id: entity.dynastyId }), { kind: 'dynasty', id: entity.dynastyId }, onSelect) : 'не закреплён')}
      {row('Столица', link(getTitle(world, { kind: 'settlement', id: entity.capitalId }), { kind: 'settlement', id: entity.capitalId }, onSelect))}
      {row('Народ', speciesLabel(entity.species))}{row('Культура', entity.culture)}{row('Вера', entity.religion)}
      {row('Стабильность', `${entity.stability}%`)}{row('Казна', `${Math.round(entity.treasury)} крон`)}{row('Войско', `${entity.armyStrength} воинов`)}
      {row('Законы', entity.laws.join(', '))}
      {row('Притязания', links(world, entity.claims.map((id: number) => ({ kind: 'settlement' as const, id })), onSelect))}
      {row('Отношения', <span className="relationship-stack">{diplomacy.map((record: any) => <span key={record.kingdomId}>{link(getTitle(world, { kind: 'kingdom', id: record.kingdomId }), { kind: 'kingdom', id: record.kingdomId }, onSelect)}<small>{record.status}, {record.score}: {record.reason}</small></span>)}</span>)}
    </>;
  }
  if (ref.kind === 'settlement') return <>
    {row('Государство', link(getTitle(world, { kind: 'kingdom', id: entity.kingdomId }), { kind: 'kingdom', id: entity.kingdomId }, onSelect))}
    {row('Тип', settlementTypeLabel(entity.type))}{row('Население', `${entity.population} жителей`)}{row('Ресурс', entity.resource)}
    {row('Благосостояние', `${entity.prosperity}%`)}{row('Защита', `${entity.defense}%`)}{row('Запасы пищи', entity.food)}
    {row('Беспорядки', `${entity.unrest}%`)}{row('Нехватка', entity.shortages.join(', ') || 'нет')}{row('Повреждения', `${entity.damaged}%`)}
    {row('Пути', links(world, entity.tradeRouteIds.map((id: number) => ({ kind: 'tradeRoute' as const, id })), onSelect))}
    {row('Постройки', entity.buildings.join(', '))}{row('История', entity.history.join(' '))}
  </>;
  if (ref.kind === 'character') {
    const relationships = world.relationships.filter(relation => entity.relationshipIds.includes(relation.id)).slice(0, 10);
    return <>
      {row('Состояние', entity.alive ? `${entity.age} лет` : `умер в ${entity.deathYear} году`)}{row('Вид', speciesLabel(entity.species))}
      {row('Профессия', professionLabel(entity.profession))}{row('Родина', link(getTitle(world, { kind: 'settlement', id: entity.settlementId }), { kind: 'settlement', id: entity.settlementId }, onSelect))}
      {row('Династия', entity.dynastyId ? link(getTitle(world, { kind: 'dynasty', id: entity.dynastyId }), { kind: 'dynasty', id: entity.dynastyId }, onSelect) : 'нет')}
      {row('Супруг', entity.spouseId ? link(getTitle(world, { kind: 'character', id: entity.spouseId }), { kind: 'character', id: entity.spouseId }, onSelect) : 'нет')}
      {row('Родители', links(world, entity.parentIds.map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
      {row('Дети', links(world, entity.childIds.slice(0, 12).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
      {row('Известность', entity.renown)}{row('Здоровье', `${entity.health}%`)}{row('Богатство', `${Math.round(entity.wealth)} крон`)}{row('Верность', `${entity.loyalty}%`)}
      {row('Цель', entity.ambition)}{row('Титулы', entity.titles.join(', ') || 'нет')}{row('Травмы', entity.injuries.join(', ') || 'нет')}
      {row('Отношения', relationships.length ? <span className="relationship-stack">{relationships.map(relation => relationshipText(world, entity.id, relation, onSelect))}</span> : 'нет заметных связей')}
      {row('Биография', entity.biography.join(' '))}
    </>;
  }
  if (ref.kind === 'monster') return <>
    {row('Вид', monsterSpeciesLabel(entity.species))}{row('Ранг', monsterTierLabel(entity.tier))}{row('Состояние', entity.alive ? 'живо' : 'мертво')}
    {row('Поведение', entity.behavior)}{row('Цель', entity.goal)}{row('Голод', `${entity.hunger}%`)}{row('Территория', `${entity.territoryRadius} клеток`)}
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
  return null;
}
