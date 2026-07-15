import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EntityRef, WorldConfig, WorldState } from './types';
import { WorldMap, type MapLayer } from './components/WorldMap';
import { EntityPanel } from './components/EntityPanel';
import { Encyclopedia } from './components/Encyclopedia';
import { WorldSetup } from './components/WorldSetup';
import { SettingsPanel } from './components/SettingsPanel';
import { loadWorld, saveWorld } from './lib/worldStorage';
import { advanceWorldInBackground, generateWorldInBackground } from './lib/worldWorkerClient';
import { checkForUpdate, forceUpdate, type UpdateCheckResult } from './lib/appUpdate';
import { migrateWorld } from './sim/migrateWorld';
import { APP_VERSION } from './version';
import './styles.css';

type View = 'map' | 'archive' | 'chronicle';
const initialUpdate: UpdateCheckResult = { currentVersion: APP_VERSION, updateRequired: false, checkedAt: 0 };

export default function App() {
  const [world, setWorld] = useState<WorldState>();
  const [booting, setBooting] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [entityStack, setEntityStack] = useState<EntityRef[]>([]);
  const [layer, setLayer] = useState<MapLayer>('terrain');
  const [view, setView] = useState<View>('map');
  const [simulating, setSimulating] = useState(false);
  const [loadingText, setLoadingText] = useState('Открываем сохранённый мир');
  const [updateState, setUpdateState] = useState<UpdateCheckResult>(initialUpdate);
  const importRef = useRef<HTMLInputElement>(null);
  const selected = entityStack.at(-1);

  const runUpdateCheck = useCallback(async () => {
    const result = await checkForUpdate();
    setUpdateState(result);
    return result;
  }, []);

  const openEntity = useCallback((ref: EntityRef) => {
    setEntityStack(current => {
      const last = current.at(-1);
      if (last?.kind === ref.kind && last.id === ref.id) return current;
      return [...current, ref].slice(-24);
    });
  }, []);

  const closeEntity = useCallback(() => setEntityStack([]), []);
  const backEntity = useCallback(() => setEntityStack(current => current.length > 1 ? current.slice(0, -1) : []), []);

  useEffect(() => {
    let active = true;
    Promise.all([loadWorld(), runUpdateCheck()]).then(([saved]) => {
      if (!active) return;
      setWorld(saved);
      setSetupOpen(!saved);
      setEntityStack([]);
      setBooting(false);
    });
    return () => { active = false; };
  }, [runUpdateCheck]);

  useEffect(() => {
    const interval = window.setInterval(() => { void runUpdateCheck(); }, 5 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') void runUpdateCheck(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [runUpdateCheck]);

  useEffect(() => {
    if (!updateState.updateRequired) return;
    const timer = window.setTimeout(() => { void forceUpdate(updateState.remoteVersion); }, 2200);
    return () => window.clearTimeout(timer);
  }, [updateState]);

  useEffect(() => {
    if (!world || booting) return;
    const timer = window.setTimeout(() => { void saveWorld(world); }, 600);
    return () => window.clearTimeout(timer);
  }, [world, booting]);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeEntity();
      if (event.key === 'Backspace' && entityStack.length > 1 && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        backEntity();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, entityStack.length, closeEntity, backEntity]);

  const stats = useMemo(() => world ? {
    population: world.characters.filter(character => character.alive).length,
    activeWars: world.wars.filter(war => war.active).length,
    dragons: world.monsters.filter(monster => monster.alive && monster.species === 'dragon').length,
    realms: world.kingdoms.length,
  } : undefined, [world]);

  const generate = async (config: WorldConfig) => {
    setLoadingText('Создаём земли, народы и причинную историю');
    setSimulating(true);
    try {
      const created = await generateWorldInBackground(config);
      setWorld(created);
      setEntityStack([]);
      setSetupOpen(false);
      setView('map');
      await saveWorld(created);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Не удалось создать мир.');
    } finally {
      setSimulating(false);
    }
  };

  const advance = async (months: number) => {
    if (!world || simulating) return;
    setLoadingText(months >= 120 ? 'Проводим мир через десятилетие' : months >= 12 ? 'Симулируем новый год' : 'Мир проживает следующий месяц');
    setSimulating(true);
    try {
      const advanced = await advanceWorldInBackground(world, months);
      setWorld(advanced);
      await saveWorld(advanced);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Симуляция остановилась.');
    } finally {
      setSimulating(false);
    }
  };

  const exportWorld = () => {
    if (!world) return;
    const blob = new Blob([JSON.stringify(world)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `eldervale-${world.config.seed}-${world.year}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importWorld = async (file?: File) => {
    if (!file) return;
    try {
      const migrated = migrateWorld(JSON.parse(await file.text()));
      setWorld(migrated);
      setSetupOpen(false);
      setEntityStack([]);
      setView('map');
      await saveWorld(migrated);
    } catch {
      alert('Не удалось прочитать сохранение Eldervale.');
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  };

  if (booting) return <LoadingVeil text="Открываем сохранённый мир" />;

  const forcedUpdate = updateState.updateRequired
    ? <ForcedUpdate remoteVersion={updateState.remoteVersion ?? 'новая версия'} onUpdate={() => void forceUpdate(updateState.remoteVersion)} />
    : null;

  if (!world || setupOpen) return <>
    <WorldSetup initial={world?.config} onGenerate={generate} onClose={world ? () => setSetupOpen(false) : undefined} onOpenSettings={() => setSettingsOpen(true)} />
    {settingsOpen && <SettingsPanel world={world} update={updateState} onCheck={() => void runUpdateCheck()} onForceUpdate={() => void forceUpdate(updateState.remoteVersion)} onClose={() => setSettingsOpen(false)} />}
    {simulating && <LoadingVeil text={loadingText} />}
    {forcedUpdate}
  </>;

  const recentEvents = [...world.events].sort((a, b) => b.year - a.year || b.month - a.month || b.id - a.id).slice(0, 180);

  return <div className="app-shell app-shell-v2">
    <header className="topbar topbar-v2">
      <button className="brand" onClick={() => setView('map')}><img src="./crest.svg" alt="" /><span><strong>Eldervale</strong><small>{world.name}</small></span></button>
      <nav className="desktop-view-tabs" aria-label="Разделы мира">
        <ViewButton active={view === 'map'} icon="⌾" label="Карта" onClick={() => setView('map')} />
        <ViewButton active={view === 'archive'} icon="⌕" label="Архив" onClick={() => setView('archive')} />
        <ViewButton active={view === 'chronicle'} icon="▤" label="Хроника" onClick={() => setView('chronicle')} />
      </nav>
      <div className="world-clock"><span>Год {world.year}</span><strong>{monthName(world.month)}</strong></div>
      <div className="top-actions">
        <button className="ghost-button new-world-button" onClick={() => setSetupOpen(true)} title="Создать новый мир"><span className="desktop-label">Новый мир</span><span className="mobile-label">＋</span></button>
        <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Настройки" aria-label="Настройки">⚙</button>
        <button className="icon-button secondary-top-action" onClick={exportWorld} title="Экспортировать мир" aria-label="Экспортировать мир">⇩</button>
        <button className="icon-button secondary-top-action" onClick={() => importRef.current?.click()} title="Импортировать мир" aria-label="Импортировать мир">⇧</button>
        <input ref={importRef} hidden type="file" accept="application/json" onChange={event => void importWorld(event.target.files?.[0])} />
      </div>
    </header>

    <main className="world-workspace">
      {view === 'map' && <section className="map-stage workspace-view">
        <div className="map-toolbar">
          <div className="layer-tabs">
            {(['terrain', 'realms', 'danger', 'population', 'trade'] as MapLayer[]).map(item => <button className={layer === item ? 'active' : ''} key={item} onClick={() => setLayer(item)}>{layerLabel(item)}</button>)}
          </div>
          <div className="map-legend"><span><i className="dot settlement-dot" />Поселение</span><span><i className="triangle" />Угроза</span><span><i className="army-mark" />Армия</span></div>
        </div>
        <div className="map-wrap"><WorldMap world={world} layer={layer} onSelect={openEntity} /><div className="map-vignette" /></div>
        <div className="stats-ribbon">
          <Stat value={stats!.population.toLocaleString('ru-RU')} label="живых имён" />
          <Stat value={stats!.realms} label="государств" />
          <Stat value={stats!.activeWars} label="активных войн" />
          <Stat value={stats!.dragons} label="живых драконов" />
        </div>
        <div className="time-controls">
          <button onClick={() => void advance(1)}>+ месяц</button><button onClick={() => void advance(12)}>+ год</button><button onClick={() => void advance(120)}>+ 10 лет</button>
          <button className="primary-mini" onClick={() => void advance(1)}>Следующее событие <span>›</span></button>
        </div>
      </section>}

      {view === 'archive' && <section className="workspace-view archive-workspace scrollable-tab">
        <div className="workspace-heading"><div><span className="eyebrow">Архив мира</span><h1>Всё, что существует</h1></div><p>Выбери личность, государство, книгу, чудовище или другое связанное звено мира.</p></div>
        <div className="window-card archive-window"><Encyclopedia world={world} onSelect={openEntity} /></div>
      </section>}

      {view === 'chronicle' && <section className="workspace-view chronicle-workspace scrollable-tab">
        <div className="workspace-heading"><div><span className="eyebrow">Живая хроника</span><h1>Последние события</h1></div><p>Войны, смерти, книги, нападения и решения правителей в одном потоке.</p></div>
        <div className="window-card chronicle-window">
          <div className="event-list event-list-full">{recentEvents.map(event => <button key={event.id} className={`event-item importance-${event.importance}`} onClick={() => { const ref = event.entityRefs[0]; if (ref) openEntity(ref); }}>
            <time>{event.year}.{String(event.month).padStart(2, '0')}</time><span><strong>{event.title}</strong><small>{event.description}</small>{event.cause && <em>Причина: {event.cause}</em>}</span>
          </button>)}</div>
        </div>
      </section>}
    </main>

    <nav className="mobile-nav">
      <ViewButton active={view === 'archive'} icon="⌕" label="Архив" onClick={() => setView('archive')} />
      <ViewButton active={view === 'map'} icon="⌾" label="Карта" onClick={() => setView('map')} />
      <ViewButton active={view === 'chronicle'} icon="▤" label="Хроника" onClick={() => setView('chronicle')} />
    </nav>

    {selected && <EntityWindow world={world} selected={selected} canGoBack={entityStack.length > 1} onBack={backEntity} onClose={closeEntity} onSelect={openEntity} />}
    {settingsOpen && <SettingsPanel world={world} update={updateState} onCheck={() => void runUpdateCheck()} onForceUpdate={() => void forceUpdate(updateState.remoteVersion)} onClose={() => setSettingsOpen(false)} />}
    {simulating && <LoadingVeil text={loadingText} />}
    {forcedUpdate}
  </div>;
}

function EntityWindow({ world, selected, canGoBack, onBack, onClose, onSelect }: {
  world: WorldState;
  selected: EntityRef;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  onSelect: (ref: EntityRef) => void;
}) {
  return <div className="entity-window-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="entity-window" role="dialog" aria-modal="true" aria-label="Карточка объекта мира">
      <header className="entity-window-header">
        <div className="entity-window-nav">
          <button className="window-control" disabled={!canGoBack} onClick={onBack} aria-label="Назад" title="Назад">←</button>
          <span>Карточка мира</span>
        </div>
        <button className="window-control close-control" onClick={onClose} aria-label="Закрыть" title="Закрыть">×</button>
      </header>
      <div className="entity-window-body"><EntityPanel world={world} selected={selected} onSelect={onSelect} /></div>
    </section>
  </div>;
}

function ViewButton({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={onClick}><span>{icon}</span>{label}</button>;
}

function LoadingVeil({ text }: { text: string }) { return <div className="loading-veil"><div className="loading-sigil">E</div><strong>{text}</strong><span>армии идут, люди стареют, чудовища выбирают добычу</span></div>; }
function ForcedUpdate({ remoteVersion, onUpdate }: { remoteVersion: string; onUpdate: () => void }) { return <div className="loading-veil forced-update"><div className="loading-sigil">↻</div><strong>Требуется обновление</strong><span>Найдена версия {remoteVersion}. Старый кэш очищается автоматически.</span><button className="primary-button update-now" onClick={onUpdate}>Обновить сейчас <b>→</b></button></div>; }
function Stat({ value, label }: { value: string | number; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
function monthName(month: number) { return ['Глубокая зима', 'Поздняя зима', 'Оттепель', 'Посев', 'Зелень', 'Высокое солнце', 'Жатва', 'Золотой месяц', 'Туманы', 'Листопад', 'Первые морозы', 'Долгая ночь'][month - 1]; }
function layerLabel(layer: MapLayer) { return ({ terrain: 'Земля', realms: 'Владения', danger: 'Опасность', population: 'Население', trade: 'Торговля' } as const)[layer]; }
