import { useMemo, useState } from 'react';
import type { EntityKind, EntityRef, WorldState } from '../types';
import { armyStatusLabel, materialLabel, monsterSpeciesLabel, monsterTierLabel, professionLabel, settlementTypeLabel, speciesLabel } from '../i18n';
import { getTitle } from './EntityPanel';

const groups: { kind: EntityKind; label: string }[] = [
  { kind: 'character', label: 'Личности' }, { kind: 'dynasty', label: 'Династии' }, { kind: 'settlement', label: 'Поселения' }, { kind: 'kingdom', label: 'Государства' },
  { kind: 'monster', label: 'Существа' }, { kind: 'artifact', label: 'Артефакты' }, { kind: 'book', label: 'Книги' },
  { kind: 'dungeon', label: 'Подземелья' }, { kind: 'tradeRoute', label: 'Торговые пути' }, { kind: 'army', label: 'Армии' }, { kind: 'war', label: 'Войны' },
];

function listFor(world: WorldState, kind: EntityKind): any[] {
  const lists: Record<EntityKind, any[]> = {
    character: world.characters, settlement: world.settlements, kingdom: world.kingdoms, monster: world.monsters,
    artifact: world.artifacts, book: world.books, dungeon: world.dungeons, army: world.armies, war: world.wars,
    dynasty: world.dynasties, tradeRoute: world.tradeRoutes,
  };
  return lists[kind];
}

export function Encyclopedia({ world, onSelect }: { world: WorldState; onSelect: (ref: EntityRef) => void }) {
  const [kind, setKind] = useState<EntityKind>('character');
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return listFor(world, kind).filter(item => !normalized || String(item.name ?? item.title ?? '').toLowerCase().includes(normalized)).slice(0, 220);
  }, [world, kind, query]);
  return <div className="encyclopedia">
    <div className="search-box"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти имя, место или книгу…" /></div>
    <div className="chip-row">{groups.map(group => <button className={kind === group.kind ? 'chip active' : 'chip'} key={group.kind} onClick={() => setKind(group.kind)}>{group.label}<small>{listFor(world, group.kind).length}</small></button>)}</div>
    <div className="entity-list">{rows.map(item => {
      const ref: EntityRef = { kind, id: item.id };
      return <button key={item.id} className="entity-card" onClick={() => onSelect(ref)}>
        <span className="entity-rune">{rune(kind)}</span>
        <span><strong>{getTitle(world, ref)}</strong><small>{subtitle(kind, item)}</small></span>
      </button>;
    })}</div>
  </div>;
}

function rune(kind: EntityKind): string {
  return ({ monster: '△', book: '▤', artifact: '✦', settlement: '⌂', dynasty: '♜', tradeRoute: '⌁', war: '⚔', army: '♙', dungeon: '▣', kingdom: '♛', character: '◇' } as Record<EntityKind, string>)[kind];
}

function subtitle(kind: EntityKind, item: any): string {
  if (kind === 'character') return `${speciesLabel(item.species)} · ${professionLabel(item.profession)} · ${item.alive ? `${item.age} лет` : 'мёртв'}`;
  if (kind === 'settlement') return `${settlementTypeLabel(item.type)} · ${item.population} жителей · ${item.resource}`;
  if (kind === 'kingdom') return `${speciesLabel(item.species)} · ${item.culture} · стабильность ${item.stability}%`;
  if (kind === 'monster') return `${monsterSpeciesLabel(item.species)} · ${monsterTierLabel(item.tier)} · ${item.alive ? 'живо' : 'убито'}`;
  if (kind === 'artifact') return `${materialLabel(item.material)} · сила ${item.power}`;
  if (kind === 'book') return `${item.subject} · ${item.copies} копий`;
  if (kind === 'dungeon') return `${item.origin} · опасность ${item.danger}/10`;
  if (kind === 'army') return `${item.strength} воинов · ${armyStatusLabel(item.status)}`;
  if (kind === 'war') return item.active ? `${item.goal} · война продолжается` : `окончена в ${item.endYear} году`;
  if (kind === 'dynasty') return `${item.memberIds.length} членов · престиж ${item.prestige}`;
  if (kind === 'tradeRoute') return `${item.goods.join(', ')} · безопасность ${item.safety}% · ${item.active ? 'открыт' : 'закрыт'}`;
  return '';
}
