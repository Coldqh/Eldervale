import type { EntityKind, EntityRef, WorldState } from '../types';

const labels: Record<EntityKind, string> = { kingdom: 'Государство', settlement: 'Поселение', character: 'Личность', army: 'Армия', monster: 'Существо', artifact: 'Артефакт', book: 'Книга', dungeon: 'Подземелье', war: 'Война' };

export function EntityPanel({ world, selected, onSelect }: { world: WorldState; selected?: EntityRef; onSelect: (ref: EntityRef) => void }) {
  if (!selected) return <div className="empty-state"><span>✦</span><strong>Выбери объект на карте</strong><p>Поселения, королевства, чудовища, армии и руины связаны одной историей.</p></div>;
  const entity = getEntity(world, selected);
  if (!entity) return null;
  const relatedEvents = world.events.filter(e => e.entityRefs.some(ref => ref.kind === selected.kind && ref.id === selected.id)).slice(-6).reverse();
  return <div className="entity-panel">
    <div className="eyebrow">{labels[selected.kind]}</div>
    <h2>{getTitle(world, selected)}</h2>
    <div className="entity-stats">{renderStats(world, selected, entity, onSelect)}</div>
    {relatedEvents.length > 0 && <section><h3>След в истории</h3>{relatedEvents.map(event => <button className="history-link" key={event.id}><span>{event.year}.{String(event.month).padStart(2, '0')}</span>{event.title}</button>)}</section>}
  </div>;
}

function getEntity(world: WorldState, ref: EntityRef): any {
  const map: Record<EntityKind, any[]> = { kingdom: world.kingdoms, settlement: world.settlements, character: world.characters, army: world.armies, monster: world.monsters, artifact: world.artifacts, book: world.books, dungeon: world.dungeons, war: world.wars };
  return map[ref.kind].find(item => item.id === ref.id);
}
export function getTitle(world: WorldState, ref: EntityRef): string {
  const e = getEntity(world, ref); return e?.name ?? e?.title ?? 'Неизвестно';
}
function link(label: string, ref: EntityRef, onSelect: (ref: EntityRef) => void) { return <button className="inline-link" onClick={() => onSelect(ref)}>{label}</button>; }
function row(label: string, value: React.ReactNode) { return <div className="stat-row"><span>{label}</span><strong>{value}</strong></div>; }

function renderStats(world: WorldState, ref: EntityRef, e: any, onSelect: (ref: EntityRef) => void) {
  if (ref.kind === 'kingdom') return <>{row('Правитель', link(getTitle(world, { kind: 'character', id: e.rulerId }), { kind: 'character', id: e.rulerId }, onSelect))}{row('Народ', e.species)}{row('Культура', e.culture)}{row('Вера', e.religion)}{row('Стабильность', `${e.stability}%`)}{row('Казна', `${e.treasury} крон`)}{row('Войско', e.armyStrength)}</>;
  if (ref.kind === 'settlement') return <>{row('Государство', link(getTitle(world, { kind: 'kingdom', id: e.kingdomId }), { kind: 'kingdom', id: e.kingdomId }, onSelect))}{row('Тип', e.type)}{row('Население', e.population)}{row('Благосостояние', `${e.prosperity}%`)}{row('Защита', `${e.defense}%`)}{row('Повреждения', `${e.damaged}%`)}{row('Постройки', e.buildings.join(', '))}</>;
  if (ref.kind === 'character') return <>{row('Состояние', e.alive ? `${e.age} лет` : `умер в ${e.deathYear}`)}{row('Вид', e.species)}{row('Профессия', e.profession)}{row('Родина', link(getTitle(world, { kind: 'settlement', id: e.settlementId }), { kind: 'settlement', id: e.settlementId }, onSelect))}{row('Известность', e.renown)}{row('Цель', e.ambition)}{row('Титулы', e.titles.join(', ') || 'нет')}{row('Биография', e.biography.join(' '))}</>;
  if (ref.kind === 'monster') return <>{row('Вид', e.species)}{row('Ранг', e.tier)}{row('Состояние', e.alive ? 'живо' : 'мертво')}{row('Сила', e.power)}{row('Возраст', e.age)}{row('Жертвы', e.kills)}{row('Сокровища', e.hoard)}{row('История', e.history.join(' ') || 'Пока не оставило следа.')}</>;
  if (ref.kind === 'artifact') return <>{row('Тип', e.type)}{row('Материал', e.material)}{row('Создан', e.yearCreated)}{row('Изображение', e.depiction)}{row('Сила', e.power)}{row('Владелец', e.ownerId ? link(getTitle(world, { kind: 'character', id: e.ownerId }), { kind: 'character', id: e.ownerId }, onSelect) : 'утерян')}{row('История', e.history.join(' '))}</>;
  if (ref.kind === 'book') return <>{row('Автор', link(getTitle(world, { kind: 'character', id: e.authorId }), { kind: 'character', id: e.authorId }, onSelect))}{row('Год', e.yearWritten)}{row('Тема', e.subject)}{row('Достоверность', `${e.reliability}%`)}{row('Копии', e.copies)}{row('Содержание', e.summary)}</>;
  if (ref.kind === 'dungeon') return <>{row('Происхождение', e.origin)}{row('Построено', e.builtYear)}{row('Опасность', `${e.danger}/10`)}{row('Глубина', `${e.depth} уровней`)}{row('Обитатели', e.currentInhabitants)}{row('История', e.history.join(' ') || 'История места ещё скрыта.')}</>;
  if (ref.kind === 'army') return <>{row('Государство', link(getTitle(world, { kind: 'kingdom', id: e.kingdomId }), { kind: 'kingdom', id: e.kingdomId }, onSelect))}{row('Командир', link(getTitle(world, { kind: 'character', id: e.commanderId }), { kind: 'character', id: e.commanderId }, onSelect))}{row('Численность', e.strength)}{row('Мораль', `${e.morale}%`)}{row('Состояние', e.status)}</>;
  if (ref.kind === 'war') return <>{row('Причина', e.cause)}{row('Начало', e.startYear)}{row('Конец', e.endYear ?? 'идёт')}{row('Сражения', e.battles)}{row('Потери атакующих', e.attackerLosses)}{row('Потери защитников', e.defenderLosses)}</>;
  return null;
}
