import { useMemo, useState } from 'react';
import type { EntityRef, WorldState } from '../types';
import { buildDynastyLegacySnapshot } from '../lib/dynastyLegacy';
import type { DynastyLegacySnapshot } from '../dynastyLegacyTypes';
import './dynastyLegacy.css';

export function DynastyHousesView({ world, onSelect }: { world: WorldState; onSelect: (ref: EntityRef) => void }) {
  const [filter, setFilter] = useState<'all' | 'ruling' | 'active' | 'extinct'>('all');
  const snapshots = useMemo(() => world.dynasties
    .map(dynasty => buildDynastyLegacySnapshot(world, dynasty.id))
    .filter((item): item is DynastyLegacySnapshot => Boolean(item))
    .filter(item => filter === 'all' || filter === 'ruling' ? (filter === 'all' || Boolean(item.kingdomId)) : filter === 'active' ? !item.extinct : item.extinct)
    .sort((a, b) => b.legacyScore - a.legacyScore || b.livingMemberIds.length - a.livingMemberIds.length || a.dynastyId - b.dynastyId), [world, filter]);

  const active = snapshots.filter(item => !item.extinct).length;
  const ruling = snapshots.filter(item => item.kingdomId).length;
  return <section className="workspace-view dynasty-workspace scrollable-tab">
    <div className="workspace-heading dynasty-heading"><div><span className="eyebrow">Династии и поколения</span><h1>Дома, которые переживают людей</h1></div><p>Главы рода, наследники, семейные ветви, брачные союзы и смена поколений. Смерть одного человека больше не обрывает историю.</p></div>
    <div className="dynasty-summary window-card"><div><strong>{snapshots.length}</strong><span>известных домов</span></div><div><strong>{active}</strong><span>живых линий</span></div><div><strong>{ruling}</strong><span>правящих домов</span></div><div><strong>{Math.max(0, ...snapshots.map(item => item.generationDepth))}</strong><span>поколений в глубину</span></div></div>
    <div className="dynasty-filter-row" role="tablist" aria-label="Фильтр династий">
      <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>Все</FilterButton>
      <FilterButton active={filter === 'ruling'} onClick={() => setFilter('ruling')}>Правящие</FilterButton>
      <FilterButton active={filter === 'active'} onClick={() => setFilter('active')}>Живые</FilterButton>
      <FilterButton active={filter === 'extinct'} onClick={() => setFilter('extinct')}>Угасшие</FilterButton>
    </div>
    <div className="dynasty-card-grid">{snapshots.map(snapshot => <DynastyOverviewCard key={snapshot.dynastyId} world={world} snapshot={snapshot} onSelect={onSelect} />)}</div>
    {!snapshots.length && <div className="window-card dynasty-empty">Нет домов, подходящих под выбранный фильтр.</div>}
  </section>;
}

export function DynastyLegacyPanel({ world, dynastyId, onSelect }: { world: WorldState; dynastyId: number; onSelect: (ref: EntityRef) => void }) {
  const snapshot = useMemo(() => buildDynastyLegacySnapshot(world, dynastyId), [world, dynastyId]);
  if (!snapshot) return null;
  const head = personName(world, snapshot.headId);
  const heir = personName(world, snapshot.heirId);
  return <section className="dynasty-legacy-panel">
    <header className="dynasty-panel-heading"><div><span className="eyebrow">Наследие дома</span><h3>{snapshot.motto}</h3></div><span className={snapshot.extinct ? 'dynasty-state extinct' : 'dynasty-state'}>{snapshot.extinct ? 'род угас' : `${snapshot.generation}-е поколение`}</span></header>
    <div className="dynasty-core-grid">
      <DynastyCoreStat label="Глава" value={head} onClick={snapshot.headId ? () => onSelect({ kind: 'character', id: snapshot.headId! }) : undefined} />
      <DynastyCoreStat label="Наследник" value={heir} onClick={snapshot.heirId ? () => onSelect({ kind: 'character', id: snapshot.heirId! }) : undefined} />
      <DynastyCoreStat label="Живых" value={String(snapshot.livingMemberIds.length)} />
      <DynastyCoreStat label="Наследие" value={String(snapshot.legacyScore)} />
    </div>

    <section className="dynasty-section"><h4>Поколения</h4><div className="dynasty-generation-list">{snapshot.generations.map(group => <div key={group.generation} className="dynasty-generation-row"><span>Поколение {group.generation}</span><div>{group.memberIds.slice(0, 14).map(id => <button key={id} className={group.livingMemberIds.includes(id) ? '' : 'dead'} onClick={() => onSelect({ kind: 'character', id })}>{personName(world, id)}</button>)}{group.memberIds.length > 14 && <small>ещё {group.memberIds.length - 14}</small>}</div></div>)}</div></section>

    <section className="dynasty-section"><h4>Ветви дома</h4><div className="dynasty-branch-grid">{snapshot.branches.map(branch => <article key={branch.id} className={branch.status === 'угасла' ? 'extinct' : ''}><span>{branch.kind}</span><strong>{branch.name}</strong><small>Глава: {personName(world, branch.headId)} · живых {branch.livingMemberIds.length} · престиж {branch.prestige}</small></article>)}</div></section>

    {snapshot.alliances.length > 0 && <section className="dynasty-section"><h4>Брачные союзы</h4><div className="dynasty-alliance-list">{snapshot.alliances.slice(0, 12).map(alliance => <button key={alliance.id} className={alliance.active ? '' : 'ended'} onClick={() => onSelect({ kind: 'dynasty', id: alliance.otherDynastyId })}><span>{alliance.active ? 'действует' : 'завершён'}</span><strong>{dynastyName(world, alliance.otherDynastyId)}</strong><small>{personName(world, alliance.characterIds[0])} и {personName(world, alliance.characterIds[1])}</small></button>)}</div></section>}

    {(snapshot.successions.length > 0 || snapshot.milestones.length > 0) && <section className="dynasty-section"><h4>Хроника рода</h4><div className="dynasty-timeline">{snapshot.milestones.slice(0, 18).map(item => <article key={item.id} className={`importance-${item.importance}`}><time>{item.year}.{String(item.month).padStart(2, '0')}</time><div><strong>{item.title}</strong><small>{item.description}</small></div></article>)}</div></section>}
  </section>;
}

function DynastyOverviewCard({ world, snapshot, onSelect }: { world: WorldState; snapshot: DynastyLegacySnapshot; onSelect: (ref: EntityRef) => void }) {
  const kingdom = snapshot.kingdomId ? world.kingdoms.find(item => item.id === snapshot.kingdomId) : undefined;
  return <button className={snapshot.extinct ? 'window-card dynasty-overview-card extinct' : 'window-card dynasty-overview-card'} onClick={() => onSelect({ kind: 'dynasty', id: snapshot.dynastyId })}>
    <header><span className="dynasty-sigil">◆</span><div><strong>{snapshot.name}</strong><small>{kingdom ? `Правящий дом: ${kingdom.name}` : snapshot.extinct ? `Угас в ${snapshot.extinctYear ?? 'неизвестном'} году` : 'Самостоятельный знатный дом'}</small></div><b>{snapshot.legacyScore}</b></header>
    <p>{snapshot.motto}</p>
    <div className="dynasty-overview-stats"><span><b>{personName(world, snapshot.headId)}</b><small>глава</small></span><span><b>{personName(world, snapshot.heirId)}</b><small>наследник</small></span><span><b>{snapshot.livingMemberIds.length}</b><small>живых</small></span><span><b>{snapshot.branches.filter(branch => branch.status === 'действует').length}</b><small>ветвей</small></span></div>
    <footer><span>{snapshot.generation}-е поколение</span><span>{snapshot.alliances.filter(item => item.active).length} союзов</span><span>престиж {Math.round(snapshot.prestige)}</span></footer>
  </button>;
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button className={active ? 'active' : ''} onClick={onClick}>{children}</button>;
}

function DynastyCoreStat({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return <div><span>{label}</span>{onClick ? <button onClick={onClick}>{value}</button> : <strong>{value}</strong>}</div>;
}

function personName(world: WorldState, id?: number): string {
  if (!id) return 'не определён';
  return world.characters.find(item => item.id === id)?.name
    ?? world.burials.find(item => item.subjectKind === 'character' && item.subjectId === id)?.name
    ?? `Личность №${id}`;
}

function dynastyName(world: WorldState, id: number): string {
  return world.dynasties.find(item => item.id === id)?.name ?? `Дом №${id}`;
}
