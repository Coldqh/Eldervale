import { useMemo, useState } from 'react';
import type { EntityKind, EntityRef, WorldState } from '../types';
import { armyStatusLabel, materialLabel, monsterSpeciesLabel, monsterTierLabel, professionLabel, settlementTypeLabel, speciesLabel } from '../i18n';
import { getTitle } from './EntityPanel';

const groups: { kind: EntityKind; label: string }[] = [
  { kind: 'character', label: 'Личности' }, { kind: 'settlement', label: 'Поселения' }, { kind: 'kingdom', label: 'Государства' },
  { kind: 'monster', label: 'Существа' }, { kind: 'artifact', label: 'Артефакты' }, { kind: 'book', label: 'Книги' },
  { kind: 'dungeon', label: 'Подземелья' }, { kind: 'army', label: 'Армии' }, { kind: 'war', label: 'Войны' },
];

function listFor(world: WorldState, kind: EntityKind): any[] {
  const lists: Record<EntityKind, any[]> = { character: world.characters, settlement: world.settlements, kingdom: world.kingdoms, monster: world.monsters, artifact: world.artifacts, book: world.books, dungeon: world.dungeons, army: world.armies, war: world.wars };
  return lists[kind];
}

export function Encyclopedia({ world, onSelect }: { world: WorldState; onSelect: (ref: EntityRef) => void }) {
  const [kind, setKind] = useState<EntityKind>('character');
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listFor(world, kind)
      .filter(item => !q || String(item.name ?? item.title ?? '').toLowerCase().includes(q))
      .slice(0, 180);
  }, [world, kind, query]);
  return <div className="encyclopedia">
    <div className="search-box"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Найти имя, место или книгу…" /></div>
    <div className="chip-row">{groups.map(group => <button className={kind === group.kind ? 'chip active' : 'chip'} key={group.kind} onClick={() => setKind(group.kind)}>{group.label}<small>{listFor(world, group.kind).length}</small></button>)}</div>
    <div className="entity-list">{rows.map(item => {
      const ref: EntityRef = { kind, id: item.id };
      return <button key={item.id} className="entity-card" onClick={() => onSelect(ref)}>
        <span className="entity-rune">{kind === 'monster' ? '△' : kind === 'book' ? '▤' : kind === 'artifact' ? '✦' : kind === 'settlement' ? '⌂' : '◇'}</span>
        <span><strong>{getTitle(world, ref)}</strong><small>{subtitle(kind, item)}</small></span>
      </button>;
    })}</div>
  </div>;
}

function subtitle(kind: EntityKind, item: any): string {
  if (kind === 'character') return `${speciesLabel(item.species)} · ${professionLabel(item.profession)} · ${item.alive ? `${item.age} лет` : 'мёртв'}`;
  if (kind === 'settlement') return `${settlementTypeLabel(item.type)} · ${item.population} жителей`;
  if (kind === 'kingdom') return `${speciesLabel(item.species)} · ${item.culture}`;
  if (kind === 'monster') return `${monsterSpeciesLabel(item.species)} · ${monsterTierLabel(item.tier)} · ${item.alive ? 'живо' : 'убито'}`;
  if (kind === 'artifact') return `${materialLabel(item.material)} · сила ${item.power}`;
  if (kind === 'book') return `${item.subject} · ${item.copies} копий`;
  if (kind === 'dungeon') return `${item.origin} · опасность ${item.danger}/10`;
  if (kind === 'army') return `${item.strength} воинов · ${armyStatusLabel(item.status)}`;
  if (kind === 'war') return item.active ? 'война продолжается' : `окончена в ${item.endYear} году`;
  return '';
}
