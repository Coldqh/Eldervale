import { useMemo, type ChangeEvent, type MouseEvent } from 'react';
import type { EntityRef, WorldState } from '../types';
import { WorldMap, type MapLayer } from './WorldMap';
import { EntityPanel } from './EntityPanel';
import { Encyclopedia } from './Encyclopedia';
import { HistoricalAtlas } from './HistoricalAtlas';
import { LocalMapViewer } from './LocalMapViewer';
import { PersonalLifePanel } from './PersonalLifePanel';
import { CharacterStoryPanel, LiveStoriesView } from './LiveStoriesView';
import { DynastyHousesView, DynastyLegacyPanel } from './DynastyHousesView';
import { ClimateCrisisView, SettlementClimatePanel } from './ClimateCrisisView';
import { PopulationEntityPanel, PopulationView } from './PopulationView';

export type WorldView = 'map' | 'archive' | 'chronicle' | 'stories' | 'houses' | 'population' | 'climate' | 'atlas' | 'local';
export interface LocalPosition { x: number; y: number; level: number }

export function WorldWorkspace({
  world, view, setView, layer, setLayer, localPosition, setLocalPosition, selected, canGoBack, busy,
  onSelect, onBackEntity, onCloseEntity, onOpenLocal, onNewWorld, onSettings, onExport, onImport,
  watchedCharacterIds, onToggleWatch, onAdvance, onAdvanceToNextEvent, onAdvanceCharacter,
}: {
  world: WorldState;
  view: WorldView;
  setView: (view: WorldView) => void;
  layer: MapLayer;
  setLayer: (layer: MapLayer) => void;
  localPosition?: LocalPosition;
  setLocalPosition: (position: LocalPosition) => void;
  selected?: EntityRef;
  canGoBack: boolean;
  busy: boolean;
  onSelect: (ref: EntityRef) => void;
  onBackEntity: () => void;
  onCloseEntity: () => void;
  onOpenLocal: (x: number, y: number, level?: number) => void;
  onNewWorld: () => void;
  onSettings: () => void;
  onExport: () => void;
  onImport: () => void;
  watchedCharacterIds: number[];
  onToggleWatch: (characterId: number) => void;
  onAdvance: (months: number) => void;
  onAdvanceToNextEvent: () => void;
  onAdvanceCharacter: (characterId: number) => void;
}) {
  const stats = useMemo(() => ({
    population: world.characters.length,
    activeWars: world.wars.filter(war => war.active).length,
    dragons: world.monsters.filter(monster => monster.species === 'dragon').length,
    realms: world.kingdoms.length,
  }), [world]);
  const recentEvents = [...world.events].sort((a, b) => b.year - a.year || b.month - a.month || b.id - a.id).slice(0, 180);
  const landmarkEvents = world.history.landmarkEventIds.map(id => world.events.find(event => event.id === id)).filter((event): event is WorldState['events'][number] => Boolean(event)).sort((a, b) => a.year - b.year || a.month - b.month).slice(0, 24);

  return <div className="app-shell app-shell-v2">
    <header className="topbar topbar-v2">
      <button className="brand" disabled={busy} onClick={() => setView('map')}><img src="./crest.svg" alt="" /><span><strong>Eldervale</strong><small>{world.name}</small></span></button>
      <nav className="desktop-view-tabs" aria-label="Разделы мира">
        <ViewButton active={view === 'map'} icon="⌾" label="Карта" disabled={busy} onClick={() => setView('map')} />
        <ViewButton active={view === 'archive'} icon="⌕" label="Архив" disabled={busy} onClick={() => setView('archive')} />
        <ViewButton active={view === 'chronicle'} icon="▤" label="Хроника" disabled={busy} onClick={() => setView('chronicle')} />
        <ViewButton active={view === 'stories'} icon="✦" label={`Истории${watchedCharacterIds.length ? ` ${watchedCharacterIds.length}` : ''}`} disabled={busy} onClick={() => setView('stories')} />
        <ViewButton active={view === 'houses'} icon="◆" label="Роды" disabled={busy} onClick={() => setView('houses')} />
        <ViewButton active={view === 'population'} icon="◌" label="Население" disabled={busy} onClick={() => setView('population')} />
        <ViewButton active={view === 'climate'} icon="≈" label="Климат" disabled={busy} onClick={() => setView('climate')} />
        <ViewButton active={view === 'atlas'} icon="◫" label="Атлас" disabled={busy} onClick={() => setView('atlas')} />
        {localPosition && <ViewButton active={view === 'local'} icon="▦" label="Местность" disabled={busy} onClick={() => setView('local')} />}
      </nav>
      <div className="world-clock"><span>Год {world.year}</span><strong>{monthName(world.month)}</strong></div>
      <div className="top-actions">
        <button className="ghost-button new-world-button" disabled={busy} onClick={onNewWorld} title="Создать новый мир"><span className="desktop-label">Новый мир</span><span className="mobile-label">＋</span></button>
        <button className="icon-button" disabled={busy} onClick={onSettings} title="Настройки" aria-label="Настройки">⚙</button>
        <button className="icon-button secondary-top-action" disabled={busy} onClick={onExport} title="Экспортировать мир" aria-label="Экспортировать мир">⇩</button>
        <button className="icon-button secondary-top-action" disabled={busy} onClick={onImport} title="Импортировать мир" aria-label="Импортировать мир">⇧</button>
      </div>
    </header>

    <main className="world-workspace">
      {view === 'map' && <section className="map-stage workspace-view">
        <div className="map-toolbar">
          <div className="layer-tabs">{mapLayers.map(item => <button disabled={busy} className={layer === item ? 'active' : ''} key={item} onClick={() => setLayer(item)}>{layerLabel(item)}</button>)}</div>
          <label className="layer-select-wrap"><span>Слой карты</span><select disabled={busy} className="layer-select" value={layer} onChange={(event: ChangeEvent<HTMLSelectElement>) => setLayer(event.target.value as MapLayer)}>{mapLayers.map(item => <option key={item} value={item}>{layerLabel(item)}</option>)}</select></label>
          <div className="map-toolbar-right"><div className="map-legend"><span><i className="dot settlement-dot" />Поселение</span><span><i className="triangle" />Угроза</span><span><i className="army-mark" />Армия</span></div><button className="population-entry-button" disabled={busy} onClick={() => setView('population')}>Население</button><button className="climate-entry-button" disabled={busy} onClick={() => setView('climate')}>Климат</button><button className="atlas-entry-button" disabled={busy} onClick={() => setView('atlas')}>Исторический атлас</button></div>
        </div>
        <div className="map-wrap"><WorldMap world={world} layer={layer} onSelect={onSelect} onOpenTile={(x: number, y: number) => onOpenLocal(x, y)} /><div className="map-vignette" /><div className="map-open-hint">Нажми на любой квадрат, чтобы открыть его локальную карту</div></div>
        <div className="stats-ribbon"><Stat value={stats.population.toLocaleString('ru-RU')} label="живых имён" /><Stat value={stats.realms} label="государств" /><Stat value={stats.activeWars} label="активных войн" /><Stat value={stats.dragons} label="живых драконов" /></div>
        <div className="time-controls">
          <button disabled={busy} onClick={() => onAdvance(1)}>+ месяц</button><button disabled={busy} onClick={() => onAdvance(12)}>+ год</button><button disabled={busy} onClick={() => onAdvance(120)}>+ 10 лет</button>
          <button className="primary-mini" disabled={busy} onClick={onAdvanceToNextEvent}>Следующее событие <span>›</span></button>
        </div>
      </section>}

      {view === 'local' && localPosition && <LocalMapViewer world={world} globalX={localPosition.x} globalY={localPosition.y} initialLevel={localPosition.level} onMove={(x: number, y: number, level = 0) => setLocalPosition({ x, y, level })} onBack={() => setView('map')} onSelect={onSelect} />}
      {view === 'archive' && <section className="workspace-view archive-workspace scrollable-tab"><div className="workspace-heading"><div><span className="eyebrow">Архив мира</span><h1>Всё, что существует</h1></div><p>Выбери личность, государство, книгу, чудовище или другое связанное звено мира.</p></div><div className="window-card archive-window"><Encyclopedia world={world} onSelect={onSelect} /></div></section>}
      {view === 'stories' && <LiveStoriesView world={world} watchedCharacterIds={watchedCharacterIds} busy={busy} onSelect={onSelect} onToggleWatch={onToggleWatch} onAdvanceCharacter={onAdvanceCharacter} />}
      {view === 'houses' && <DynastyHousesView world={world} onSelect={onSelect} />}
      {view === 'population' && <PopulationView world={world} onSelect={onSelect} />}
      {view === 'climate' && <ClimateCrisisView world={world} onSelect={onSelect} />}
      {view === 'atlas' && <HistoricalAtlas world={world} onSelect={onSelect} onClose={() => setView('map')} />}
      {view === 'chronicle' && <section className="workspace-view chronicle-workspace scrollable-tab">
        <div className="workspace-heading"><div><span className="eyebrow">Живая хроника</span><h1>Последние события</h1></div><p>Войны, смерти, книги, нападения и решения правителей в одном потоке.</p></div>
        <div className="window-card history-overview-window"><div className="history-overview-head"><div><span className="eyebrow">История мира</span><strong>{world.history.generatedYears} прожитых лет</strong></div><small>{world.history.fallenRealms.length} павших держав · {world.history.compressedEventCount.toLocaleString('ru-RU')} обычных изменений сведено в хроники</small></div><div className="history-overview-eras">{world.history.eras.map(era => <div key={era.id}><span>{era.startYear}–{era.endYear}</span><strong>{era.name}</strong><small>{era.summary}</small></div>)}</div><div className="landmark-event-grid">{landmarkEvents.map(event => <button key={event.id} onClick={() => { const ref = event.entityRefs[0]; if (ref) onSelect(ref); }}><time>{event.year}</time><span><strong>{event.title}</strong><small>{event.outcome}</small></span></button>)}</div></div>
        <div className="window-card chronicle-window"><div className="event-list event-list-full">{recentEvents.map(event => <button key={event.id} className={`event-item importance-${event.importance}`} onClick={() => { const ref = event.entityRefs[0]; if (ref) onSelect(ref); }}><time>{event.year}.{String(event.month).padStart(2, '0')}</time><span><strong>{event.title}</strong><small>{event.description}</small>{event.cause && <em>Причина: {event.cause}</em>}</span></button>)}</div></div>
      </section>}
    </main>

    <nav className="mobile-nav"><ViewButton active={view === 'archive'} icon="⌕" label="Архив" disabled={busy} onClick={() => setView('archive')} /><ViewButton active={view === 'map' || view === 'atlas' || view === 'local'} icon="⌾" label="Карта" disabled={busy} onClick={() => setView('map')} /><ViewButton active={view === 'stories'} icon="✦" label="Истории" disabled={busy} onClick={() => setView('stories')} /><ViewButton active={view === 'houses'} icon="◆" label="Роды" disabled={busy} onClick={() => setView('houses')} /><ViewButton active={view === 'chronicle'} icon="▤" label="Хроника" disabled={busy} onClick={() => setView('chronicle')} /></nav>
    {selected && <EntityWindow world={world} selected={selected} canGoBack={canGoBack} busy={busy} watched={selected.kind === 'character' && watchedCharacterIds.includes(selected.id)} onBack={onBackEntity} onClose={onCloseEntity} onSelect={onSelect} onOpenLocal={onOpenLocal} onToggleWatch={onToggleWatch} onAdvanceCharacter={onAdvanceCharacter} />}
  </div>;
}

const mapLayers: MapLayer[] = ['terrain', 'realms', 'danger', 'population', 'ecology', 'trade'];
function ViewButton({ active, icon, label, disabled, onClick }: { active: boolean; icon: string; label: string; disabled?: boolean; onClick: () => void }) { return <button disabled={disabled} className={active ? 'active' : ''} onClick={onClick}><span>{icon}</span>{label}</button>; }
function Stat({ value, label }: { value: string | number; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
function monthName(month: number) { return ['Глубокая зима', 'Поздняя зима', 'Оттепель', 'Посев', 'Зелень', 'Высокое солнце', 'Жатва', 'Золотой месяц', 'Туманы', 'Листопад', 'Первые морозы', 'Долгая ночь'][month - 1]; }
function layerLabel(layer: MapLayer) { return ({ terrain: 'Земля', realms: 'Владения', danger: 'Опасность', population: 'Население', ecology: 'Природа', trade: 'Торговля' } as const)[layer]; }

function EntityWindow({ world, selected, canGoBack, busy, watched, onBack, onClose, onSelect, onOpenLocal, onToggleWatch, onAdvanceCharacter }: { world: WorldState; selected: EntityRef; canGoBack: boolean; busy: boolean; watched: boolean; onBack: () => void; onClose: () => void; onSelect: (ref: EntityRef) => void; onOpenLocal: (x: number, y: number, level?: number) => void; onToggleWatch: (characterId: number) => void; onAdvanceCharacter: (characterId: number) => void }) {
  return <div className="entity-window-backdrop" onMouseDown={(event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onClose(); }}><section className="entity-window" role="dialog" aria-modal="true" aria-label="Карточка объекта мира"><header className="entity-window-header"><div className="entity-window-nav"><button className="window-control" disabled={!canGoBack} onClick={onBack}>←</button><span>Карточка мира</span></div><div className="entity-window-header-actions">{localCoordinates(world, selected) && <button className="entity-local-button" onClick={() => { const point = localCoordinates(world, selected); if (point) onOpenLocal(point.x, point.y); }}>Открыть местность</button>}<button className="window-control close-control" onClick={onClose}>×</button></div></header><div className="entity-window-body"><EntityPanel world={world} selected={selected} onSelect={onSelect} />{selected.kind === 'character' && <><CharacterStoryPanel world={world} characterId={selected.id} watched={watched} busy={busy} onToggleWatch={onToggleWatch} onAdvanceCharacter={onAdvanceCharacter} onSelect={onSelect} /><PersonalLifePanel world={world} characterId={selected.id} /></>}{selected.kind === 'dynasty' && <DynastyLegacyPanel world={world} dynastyId={selected.id} onSelect={onSelect} />}{(selected.kind === 'settlement' || selected.kind === 'kingdom') && <PopulationEntityPanel world={world} entityRef={{ kind: selected.kind, id: selected.id }} />}{selected.kind === 'settlement' && <SettlementClimatePanel world={world} settlementId={selected.id} />}</div></section></div>;
}

function localCoordinates(world: WorldState, ref: EntityRef): { x: number; y: number } | undefined {
  if (ref.kind === 'settlement') { const item = world.settlements.find(entity => entity.id === ref.id); return item && { x: item.x, y: item.y }; }
  if (ref.kind === 'monster') { const item = world.monsters.find(entity => entity.id === ref.id); const burial = !item ? world.burials.find(entity => entity.subjectKind === 'monster' && entity.subjectId === ref.id) : undefined; return item ? { x: item.x, y: item.y } : burial && { x: burial.globalX, y: burial.globalY }; }
  if (ref.kind === 'army') { const item = world.armies.find(entity => entity.id === ref.id); return item && { x: item.x, y: item.y }; }
  if (ref.kind === 'dungeon') { const item = world.dungeons.find(entity => entity.id === ref.id); return item && { x: item.x, y: item.y }; }
  if (ref.kind === 'character') { const item = world.characters.find(entity => entity.id === ref.id); const burial = !item ? world.burials.find(entity => entity.subjectKind === 'character' && entity.subjectId === ref.id) : undefined; const place = item && world.settlements.find(entity => entity.id === item.settlementId); return place ? { x: place.x, y: place.y } : burial && { x: burial.globalX, y: burial.globalY }; }
  if (ref.kind === 'kingdom') { const item = world.kingdoms.find(entity => entity.id === ref.id); const place = item && world.settlements.find(entity => entity.id === item.capitalId); return place && { x: place.x, y: place.y }; }
  if (ref.kind === 'book') { const item = world.books.find(entity => entity.id === ref.id); const place = item && world.settlements.find(entity => entity.id === item.settlementId); return place && { x: place.x, y: place.y }; }
  if (ref.kind === 'artifact') { const item = world.artifacts.find(entity => entity.id === ref.id); const owner = item?.ownerId ? world.characters.find(entity => entity.id === item.ownerId) : undefined; const settlementId = owner?.settlementId ?? item?.settlementId; const place = settlementId ? world.settlements.find(entity => entity.id === settlementId) : undefined; return place && { x: place.x, y: place.y }; }
  if (ref.kind === 'war') { const item = world.wars.find(entity => entity.id === ref.id); const place = item?.contestedSettlementIds[0] ? world.settlements.find(entity => entity.id === item.contestedSettlementIds[0]) : undefined; return place && { x: place.x, y: place.y }; }
  if (ref.kind === 'tradeRoute') { const item = world.tradeRoutes.find(entity => entity.id === ref.id); const place = item && world.settlements.find(entity => entity.id === item.fromSettlementId); return place && { x: place.x, y: place.y }; }
  if (ref.kind === 'dynasty') { const item = world.dynasties.find(entity => entity.id === ref.id); const kingdom = item?.kingdomId ? world.kingdoms.find(entity => entity.id === item.kingdomId) : undefined; const place = kingdom && world.settlements.find(entity => entity.id === kingdom.capitalId); return place && { x: place.x, y: place.y }; }
  if (ref.kind === 'animalPopulation') { const item = world.animalPopulations.find(entity => entity.id === ref.id); return item && { x: item.x, y: item.y }; }
  if (ref.kind === 'ingredient') { const item = world.ingredients.find(entity => entity.id === ref.id); return item && { x: item.x, y: item.y }; }
  if (ref.kind === 'recipe') { const item = world.alchemyRecipes.find(entity => entity.id === ref.id); const maker = item?.discoveredById ? world.characters.find(entity => entity.id === item.discoveredById) : undefined; const place = maker && world.settlements.find(entity => entity.id === maker.settlementId); return place && { x: place.x, y: place.y }; }
  if (ref.kind === 'building') { const item = world.buildings.find(entity => entity.id === ref.id); return item && { x: item.globalX, y: item.globalY }; }
  if (ref.kind === 'household') { const item = world.households.find(entity => entity.id === ref.id); const home = item?.homeBuildingId ? world.buildings.find(entity => entity.id === item.homeBuildingId) : undefined; const place = !home && item ? world.settlements.find(entity => entity.id === item.settlementId) : undefined; return home ? { x: home.globalX, y: home.globalY } : place && { x: place.x, y: place.y }; }
  if (ref.kind === 'establishment') { const item = world.establishments.find(entity => entity.id === ref.id); const building = item && world.buildings.find(entity => entity.id === item.buildingId); return building && { x: building.globalX, y: building.globalY }; }
  if (ref.kind === 'item') { const item = world.items.find(entity => entity.id === ref.id); const building = item?.buildingId ? world.buildings.find(entity => entity.id === item.buildingId) : item?.establishmentId ? world.buildings.find(entity => entity.establishmentId === item.establishmentId) : item?.householdId ? world.buildings.find(entity => entity.householdId === item.householdId) : undefined; const place = !building && item ? world.settlements.find(entity => entity.id === item.settlementId) : undefined; return building ? { x: building.globalX, y: building.globalY } : place && { x: place.x, y: place.y }; }
  if (ref.kind === 'productionRecipe') { const establishment = world.establishments.find(entity => entity.recipeIds.includes(ref.id)); const building = establishment && world.buildings.find(entity => entity.id === establishment.buildingId); return building && { x: building.globalX, y: building.globalY }; }
  if (ref.kind === 'cemetery') { const item = world.cemeteries.find(entity => entity.id === ref.id); return item && { x: item.globalX, y: item.globalY }; }
  if (ref.kind === 'burial') { const item = world.burials.find(entity => entity.id === ref.id); return item && { x: item.globalX, y: item.globalY }; }
  return undefined;
}
