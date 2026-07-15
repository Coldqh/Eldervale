import { useMemo, useState } from 'react';
import type { EntityRef, WorldState } from '../types';
import { WorldMap, type MapLayer } from './WorldMap';
import {
  atlasEventGroup, atlasStats, atlasYearRange, buildAtlasMapState, eraTitle, eventsAtYear,
  importantEventsUntil, primaryRef, type AtlasEventGroup,
} from '../lib/historicalAtlas';

const groups: AtlasEventGroup[] = ['войны', 'чудовища', 'власть', 'знания', 'поселения', 'природа', 'жизни'];

export function HistoricalAtlas({ world, onSelect, onClose }: { world: WorldState; onSelect: (ref: EntityRef) => void; onClose: () => void }) {
  const range = useMemo(() => atlasYearRange(world), [world]);
  const [year, setYear] = useState(world.year);
  const [layer, setLayer] = useState<MapLayer>('realms');
  const [enabledGroups, setEnabledGroups] = useState<Set<AtlasEventGroup>>(() => new Set(groups));
  const atlas = useMemo(() => buildAtlasMapState(world, year), [world, year]);
  const stats = useMemo(() => atlasStats(world, atlas), [world, atlas]);
  const yearEvents = useMemo(() => eventsAtYear(world, atlas.year, enabledGroups), [world, atlas.year, enabledGroups]);
  const recent = useMemo(() => importantEventsUntil(world, atlas.year, enabledGroups, 90), [world, atlas.year, enabledGroups]);
  const wars = world.wars.filter(war => atlas.activeWarIds.has(war.id));
  const activeEra = world.history.eras.find(era => atlas.year >= era.startYear && atlas.year <= era.endYear);

  const setClampedYear = (value: number) => setYear(Math.max(range.min, Math.min(range.max, Math.round(value))));
  const toggleGroup = (group: AtlasEventGroup) => setEnabledGroups(current => {
    const next = new Set(current);
    if (next.has(group) && next.size > 1) next.delete(group); else next.add(group);
    return next;
  });

  return <section className="workspace-view atlas-workspace">
    <div className="atlas-topline">
      <div>
        <span className="eyebrow">Исторический атлас</span>
        <h1>{eraTitle(world, atlas.year)}</h1>
        <p>Год {atlas.year}{atlas.current ? ' · настоящее время' : ` · до настоящего времени ${world.year - atlas.year} лет`}</p>
      </div>
      <button className="ghost-button atlas-close" onClick={onClose}>Вернуться к карте</button>
    </div>

    {world.history.eras.length > 0 && <div className="history-era-strip">
      {world.history.eras.map(era => <button key={era.id} className={`history-era-card ${activeEra?.id === era.id ? 'active' : ''}`} onClick={() => setClampedYear(era.endYear)}>
        <span>{era.startYear}–{era.endYear}</span><strong>{era.name}</strong><small>{era.eventIds.length} подробных событий · шаг {era.stepYears} г.</small>
      </button>)}
    </div>}

    <div className="atlas-time-card">
      <div className="atlas-year-controls">
        <button onClick={() => setClampedYear(year - 10)}>−10</button>
        <button onClick={() => setClampedYear(year - 1)}>−1</button>
        <strong>{atlas.year}</strong>
        <button onClick={() => setClampedYear(year + 1)}>+1</button>
        <button onClick={() => setClampedYear(year + 10)}>+10</button>
        <button className="atlas-now" onClick={() => setClampedYear(world.year)}>Настоящее</button>
      </div>
      <input className="atlas-range" type="range" min={range.min} max={range.max} value={atlas.year} onChange={event => setClampedYear(Number(event.target.value))} />
      <div className="atlas-range-labels"><span>{range.min}</span><span>{world.year}</span></div>
    </div>

    <div className="atlas-grid">
      <div className="window-card atlas-map-window">
        <div className="map-toolbar atlas-map-toolbar">
          <div className="layer-tabs">
            {(['terrain', 'realms', 'danger', 'population', 'ecology', 'trade'] as MapLayer[]).map(item => <button className={layer === item ? 'active' : ''} key={item} onClick={() => setLayer(item)}>{layerLabel(item)}</button>)}
          </div>
          <span className="atlas-reconstruction">Реконструкция по летописям и контролю поселений</span>
        </div>
        <div className="atlas-map-wrap"><WorldMap world={world} layer={layer} onSelect={onSelect} historicalState={atlas} /><div className="map-vignette" /></div>
        <div className="atlas-stats">
          <AtlasStat value={stats.population.toLocaleString('ru-RU')} label="жителей" />
          <AtlasStat value={stats.settlements} label="поселений" />
          <AtlasStat value={stats.kingdoms} label="государств" />
          <AtlasStat value={stats.wars} label="войн" />
          <AtlasStat value={stats.monsters} label="чудовищ" />
          <AtlasStat value={stats.books} label="книг" />
        </div>
      </div>

      <aside className="atlas-sidebar">
        <div className="window-card atlas-filter-window">
          <div className="atlas-section-title"><span className="eyebrow">Слои хроники</span><strong>Что показывать</strong></div>
          <div className="atlas-filter-grid">{groups.map(group => <button key={group} className={enabledGroups.has(group) ? 'active' : ''} onClick={() => toggleGroup(group)}>{group}<small>{world.events.filter(event => event.year <= atlas.year && atlasEventGroup(event) === group).length}</small></button>)}</div>
        </div>

        <div className="window-card atlas-year-window">
          <div className="atlas-section-title"><span className="eyebrow">Год {atlas.year}</span><strong>{yearEvents.length ? 'События года' : 'Крупных событий не записано'}</strong></div>
          <div className="atlas-event-list">{yearEvents.slice(0, 18).map(event => <EventButton key={event.id} event={event} onSelect={onSelect} />)}</div>
        </div>

        {wars.length > 0 && <div className="window-card atlas-war-window">
          <div className="atlas-section-title"><span className="eyebrow">Войны</span><strong>Активные конфликты</strong></div>
          {wars.map(war => <button className="atlas-war-card" key={war.id} onClick={() => onSelect({ kind: 'war', id: war.id })}>
            <strong>{war.name}</strong><small>{war.cause}</small><span>{war.attackerLosses + war.defenderLosses} потерь · {war.battles} сражений</span>
          </button>)}
        </div>}
      </aside>
    </div>

    <div className="window-card atlas-chronicle-window">
      <div className="atlas-section-title"><span className="eyebrow">Лента до {atlas.year} года</span><strong>Последние известные события</strong></div>
      <div className="atlas-chronicle-list">{recent.map(event => <EventButton key={event.id} event={event} onSelect={onSelect} detailed />)}</div>
    </div>
  </section>;
}

function EventButton({ event, onSelect, detailed = false }: { event: WorldState['events'][number]; onSelect: (ref: EntityRef) => void; detailed?: boolean }) {
  const ref = primaryRef(event);
  return <button className={`atlas-event importance-${event.importance}`} onClick={() => ref && onSelect(ref)} disabled={!ref}>
    <time>{event.year}.{String(event.month).padStart(2, '0')}</time>
    <span><strong>{event.title}</strong><small>{event.description}</small>{detailed && <><em>Причина: {event.cause}</em><em>Действие: {event.decision}</em><em>Результат: {event.outcome}</em></>}</span>
  </button>;
}

function AtlasStat({ value, label }: { value: string | number; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function layerLabel(layer: MapLayer) {
  return ({ terrain: 'Земля', realms: 'Владения', danger: 'Опасность', population: 'Население', ecology: 'Природа', trade: 'Торговля' } as const)[layer];
}
