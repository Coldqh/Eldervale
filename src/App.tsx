import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EntityRef, SimulationProfile, SimulationProgress, StorageProfile, WorldConfig, WorldSlotMeta, WorldSnapshotMeta, WorldState } from './types';
import { WorldMap, type MapLayer } from './components/WorldMap';
import { EntityPanel } from './components/EntityPanel';
import { Encyclopedia } from './components/Encyclopedia';
import { WorldSetup } from './components/WorldSetup';
import { SettingsPanel } from './components/SettingsPanel';
import { HistoricalAtlas } from './components/HistoricalAtlas';
import { LocalMapViewer } from './components/LocalMapViewer';
import {
  createWorldSlot, createWorldSnapshot, deleteWorldSlot, duplicateWorldSlot, getActiveWorldSlotId, listWorldSlots,
  listWorldSnapshots, loadWorld, loadWorldSlot, renameWorldSlot, restoreWorldSnapshot, saveWorld,
} from './lib/worldStorage';
import { advanceWorldInBackground, cancelWorldOperation, generateWorldInBackground, initializeWorldInBackground, setWorldFocusInBackground } from './lib/worldWorkerClient';
import { checkForUpdate, forceUpdate, type UpdateCheckResult } from './lib/appUpdate';
import { migrateWorld } from './sim/migrateWorld';
import { APP_VERSION } from './version';
import './styles.css';

type View = 'map' | 'archive' | 'chronicle' | 'atlas' | 'local';
const initialUpdate: UpdateCheckResult = { currentVersion: APP_VERSION, updateRequired: false, checkedAt: 0 };

export default function App() {
  const [world, setWorld] = useState<WorldState>();
  const [booting, setBooting] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [entityStack, setEntityStack] = useState<EntityRef[]>([]);
  const [layer, setLayer] = useState<MapLayer>('terrain');
  const [view, setView] = useState<View>('map');
  const [localPosition, setLocalPosition] = useState<{ x: number; y: number; level: number }>();

  useEffect(() => {
    void setWorldFocusInBackground(view === 'local' && localPosition ? { x: localPosition.x, y: localPosition.y, level: localPosition.level, radius: 1 } : undefined);
  }, [view, localPosition?.x, localPosition?.y, localPosition?.level]);
  const [simulating, setSimulating] = useState(false);
  const [loadingText, setLoadingText] = useState('Открываем сохранённый мир');
  const [progress, setProgress] = useState<SimulationProgress>();
  const [performanceProfile, setPerformanceProfile] = useState<SimulationProfile>();
  const [storageProfile, setStorageProfile] = useState<StorageProfile>();
  const [activeSlotId, setActiveSlotId] = useState<string>();
  const [worldSlots, setWorldSlots] = useState<WorldSlotMeta[]>([]);
  const [worldSnapshots, setWorldSnapshots] = useState<WorldSnapshotMeta[]>([]);
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
  const openLocal = useCallback((x: number, y: number, level = 0) => {
    setLocalPosition({ x, y, level });
    setEntityStack([]);
    setView('local');
  }, []);

  const refreshStorage = useCallback(async (slotId?: string) => {
    const slots = await listWorldSlots();
    setWorldSlots(slots);
    const resolved = slotId ?? activeSlotId ?? await getActiveWorldSlotId();
    setWorldSnapshots(resolved ? await listWorldSnapshots(resolved) : []);
  }, [activeSlotId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Сначала проверяем версию. Нельзя одновременно мигрировать большой старый мир
        // и через две секунды перезагружать страницу ради обновления.
        const update = await runUpdateCheck();
        if (!active) return;
        if (update.updateRequired) {
          setProgress(undefined);
          return;
        }

        const [saved, slotId] = await Promise.all([loadWorld(), getActiveWorldSlotId()]);
        if (!active) return;
        if (saved) {
          setProgress({ operation: 'загрузка', phase: 'Подготовка постоянного движка', completed: 0, total: 1, percent: 0, elapsedMs: 0 });
          const profile = await initializeWorldInBackground(saved, setProgress);
          if (!active) return;
          setPerformanceProfile(profile);
        }
        const resolvedSlotId = slotId ?? await getActiveWorldSlotId();
        setActiveSlotId(resolvedSlotId);
        setWorld(saved);
        setSetupOpen(!saved);
        setEntityStack([]);
        setLocalPosition(undefined);
        setProgress(saved ? { operation: 'загрузка', phase: 'Мир открыт', completed: 1, total: 1, percent: 100, elapsedMs: 0 } : undefined);
        // Список миров и снимков не должен удерживать экран загрузки.
        // Особенно важно для старых снимков, которые могут весить сотни МБ.
        void refreshStorage(resolvedSlotId);
      } catch (error) {
        console.error('Не удалось подготовить сохранённый мир', error);
        if (!active) return;
        setWorld(undefined);
        setSetupOpen(true);
        setProgress(undefined);
      } finally {
        if (active) setBooting(false);
      }
    })();
    return () => { active = false; };
  }, [runUpdateCheck]);


  useEffect(() => {
    const interval = window.setInterval(() => { void runUpdateCheck(); }, 5 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') void runUpdateCheck(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [runUpdateCheck]);

  useEffect(() => {
    if (booting || simulating || !updateState.updateRequired) return;
    const remoteVersion = updateState.remoteVersion ?? 'неизвестная';
    const attemptKey = `eldervale-auto-update:${remoteVersion}`;

    // Одна версия может автоматически отправить браузер на восстановление только один раз
    // за вкладку. Даже при ошибке публикации бесконечного цикла больше не будет.
    if (sessionStorage.getItem(attemptKey) === APP_VERSION) return;
    sessionStorage.setItem(attemptKey, APP_VERSION);

    const timer = window.setTimeout(() => { void forceUpdate(updateState.remoteVersion); }, 2200);
    return () => window.clearTimeout(timer);
  }, [booting, simulating, updateState.updateRequired, updateState.remoteVersion]);

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
    population: world.characters.length,
    activeWars: world.wars.filter(war => war.active).length,
    dragons: world.monsters.filter(monster => monster.species === 'dragon').length,
    realms: world.kingdoms.length,
  } : undefined, [world]);

  const generate = async (config: WorldConfig) => {
    setLoadingText('Создаём земли, народы и причинную историю');
    setProgress(undefined);
    setSimulating(true);
    const roundTripStarted = performance.now();
    try {
      const result = await generateWorldInBackground(config, setProgress);
      if (!result.world) throw new Error('Генератор не вернул созданный мир');
      const receivedAt = performance.now();
      setLoadingText('Сохраняем созданный мир');
      setProgress({ operation: 'сохранение', phase: 'Разделяем мир на безопасные части', completed: 0, total: 3, percent: 0, elapsedMs: 0 });
      const saveStarted = performance.now();
      const createdSlot = await createWorldSlot(result.world, undefined, { onProgress: setProgress });
      const saveMs = performance.now() - saveStarted;
      setProgress({ operation: 'сохранение', phase: 'Подготавливаем интерфейс', completed: 2, total: 3, percent: 98, elapsedMs: saveMs });
      setActiveSlotId(createdSlot.slotId);
      setStorageProfile(createdSlot.profile);
      const profile: SimulationProfile = {
        ...(result.profile ?? { operation: 'генерация', totalMs: receivedAt - roundTripStarted, generatedAt: Date.now() }),
        workerRoundTripMs: Math.max(0, receivedAt - roundTripStarted - (result.profile?.simulationMs ?? 0)),
        saveMs,
        totalMs: performance.now() - roundTripStarted,
      };
      setPerformanceProfile(profile);
      setWorld(result.world);
      setEntityStack([]);
      setSetupOpen(false);
      setView('map');
      setLocalPosition(undefined);
      setProgress({ operation: 'сохранение', phase: 'Мир открыт', completed: 3, total: 3, percent: 100, elapsedMs: performance.now() - saveStarted });
      void refreshStorage(createdSlot.slotId);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Не удалось создать мир.');
    } finally {
      setProgress(undefined);
      setSimulating(false);
    }
  };

  const advance = async (months: number) => {
    if (!world || simulating) return;
    setLoadingText(months >= 120 ? 'Проводим мир через десятилетие' : months >= 12 ? 'Симулируем новый год' : 'Мир проживает следующий месяц');
    setProgress(undefined);
    setSimulating(true);
    const roundTripStarted = performance.now();
    try {
      const result = await advanceWorldInBackground(months, setProgress);
      if (!result.world) throw new Error('Симуляция не вернула состояние мира');
      const receivedAt = performance.now();
      setLoadingText('Сохраняем изменения мира');
      setProgress({ operation: 'сохранение', phase: 'Подготовка сохранения', completed: 0, total: 100, percent: 0, elapsedMs: 0 });
      const saveStarted = performance.now();
      const stored = await saveWorld(result.world, activeSlotId, { onProgress: setProgress });
      const saveMs = performance.now() - saveStarted;
      setActiveSlotId(stored.slotId);
      setStorageProfile(stored);
      void refreshStorage(stored.slotId);
      const profile: SimulationProfile = {
        ...(result.profile ?? { operation: 'симуляция', months, totalMs: receivedAt - roundTripStarted, generatedAt: Date.now() }),
        workerRoundTripMs: Math.max(0, receivedAt - roundTripStarted - (result.profile?.simulationMs ?? 0)),
        saveMs,
        totalMs: performance.now() - roundTripStarted,
      };
      setPerformanceProfile(profile);
      setWorld(result.world);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Симуляция остановилась.');
    } finally {
      setProgress(undefined);
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
      await initializeWorldInBackground(migrated, setProgress);
      setWorld(migrated);
      setSetupOpen(false);
      setEntityStack([]);
      setView('map');
      setLocalPosition(undefined);
      const createdSlot = await createWorldSlot(migrated, `import-${Date.now()}`, { onProgress: setProgress });
      setActiveSlotId(createdSlot.slotId);
      setStorageProfile(createdSlot.profile);
      await refreshStorage(createdSlot.slotId);
    } catch {
      alert('Не удалось прочитать сохранение Eldervale.');
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  };

  useEffect(() => {
    if (settingsOpen) void refreshStorage(activeSlotId);
  }, [settingsOpen, activeSlotId, refreshStorage]);

  const switchWorld = async (slotId: string) => {
    if (slotId === activeSlotId || simulating) return;
    setLoadingText('Открываем выбранный мир');
    setProgress({ operation: 'загрузка', phase: 'Чтение разделённого сохранения', completed: 0, total: 1, percent: 0, elapsedMs: 0 });
    setSimulating(true);
    try {
      const loaded = await loadWorldSlot(slotId);
      if (!loaded) throw new Error('Мир не найден');
      const profile = await initializeWorldInBackground(loaded, setProgress);
      setPerformanceProfile(profile);
      setWorld(loaded);
      setActiveSlotId(slotId);
      setEntityStack([]);
      setLocalPosition(undefined);
      setView('map');
      void refreshStorage(slotId);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Не удалось открыть мир.');
    } finally {
      setProgress(undefined);
      setSimulating(false);
    }
  };

  const renameSlot = async (slotId: string) => {
    const current = worldSlots.find(slot => slot.id === slotId)?.name ?? '';
    const name = window.prompt('Новое название мира', current);
    if (!name?.trim()) return;
    await renameWorldSlot(slotId, name.trim());
    if (slotId === activeSlotId && world) setWorld({ ...world, name: name.trim() });
    await refreshStorage(slotId);
  };

  const removeSlot = async (slotId: string) => {
    const meta = worldSlots.find(slot => slot.id === slotId);
    if (!window.confirm(`Удалить мир «${meta?.name ?? slotId}» и его снимки?`)) return;
    await deleteWorldSlot(slotId);
    const remaining = await listWorldSlots();
    setWorldSlots(remaining);
    if (slotId === activeSlotId) {
      const next = remaining[0];
      if (next) await switchWorld(next.id);
      else {
        setWorld(undefined);
        setActiveSlotId(undefined);
        setSetupOpen(true);
        setSettingsOpen(false);
      }
    } else await refreshStorage(activeSlotId);
  };

  const duplicateSlot = async (slotId: string) => {
    await duplicateWorldSlot(slotId);
    await refreshStorage(activeSlotId);
  };

  const makeSnapshot = async () => {
    if (!world || !activeSlotId) return;
    await createWorldSnapshot(world, activeSlotId, 'ручной');
    await refreshStorage(activeSlotId);
  };

  const restoreSnapshot = async (snapshotId: string) => {
    if (!window.confirm('Вернуть мир к выбранному снимку? Текущее состояние останется в автоматическом снимке только если оно уже было сохранено.')) return;
    const restored = await restoreWorldSnapshot(snapshotId);
    await initializeWorldInBackground(restored.world, setProgress);
    setWorld(restored.world);
    setActiveSlotId(restored.slotId);
    setEntityStack([]);
    setView('map');
    await refreshStorage(restored.slotId);
  };

  if (booting) return <LoadingVeil text="Открываем сохранённый мир" progress={progress} />;

  const forcedUpdate = updateState.updateRequired
    ? <ForcedUpdate remoteVersion={updateState.remoteVersion ?? 'новая версия'} onUpdate={() => void forceUpdate(updateState.remoteVersion)} />
    : null;

  if (!world || setupOpen) return <>
    <WorldSetup initial={world?.config} onGenerate={generate} onClose={world ? () => setSetupOpen(false) : undefined} onOpenSettings={() => setSettingsOpen(true)} />
    {settingsOpen && <SettingsPanel world={world} update={updateState} performance={performanceProfile} storage={storageProfile} slots={worldSlots} activeSlotId={activeSlotId} snapshots={worldSnapshots} onSwitchWorld={slotId => void switchWorld(slotId)} onRenameWorld={slotId => void renameSlot(slotId)} onDeleteWorld={slotId => void removeSlot(slotId)} onDuplicateWorld={slotId => void duplicateSlot(slotId)} onCreateSnapshot={() => void makeSnapshot()} onRestoreSnapshot={snapshotId => void restoreSnapshot(snapshotId)} onCheck={() => void runUpdateCheck()} onForceUpdate={() => void forceUpdate(updateState.remoteVersion)} onClose={() => setSettingsOpen(false)} />}
    {simulating && <LoadingVeil text={loadingText} progress={progress} onCancel={progress?.operation === 'симуляция' ? cancelWorldOperation : undefined} />}
    {forcedUpdate}
  </>;

  const recentEvents = [...world.events].sort((a, b) => b.year - a.year || b.month - a.month || b.id - a.id).slice(0, 180);
  const landmarkEvents = world.history.landmarkEventIds.map(id => world.events.find(event => event.id === id)).filter((event): event is WorldState['events'][number] => Boolean(event)).sort((a, b) => a.year - b.year || a.month - b.month).slice(0, 24);

  return <div className="app-shell app-shell-v2">
    <header className="topbar topbar-v2">
      <button className="brand" onClick={() => setView('map')}><img src="./crest.svg" alt="" /><span><strong>Eldervale</strong><small>{world.name}</small></span></button>
      <nav className="desktop-view-tabs" aria-label="Разделы мира">
        <ViewButton active={view === 'map'} icon="⌾" label="Карта" onClick={() => setView('map')} />
        <ViewButton active={view === 'archive'} icon="⌕" label="Архив" onClick={() => setView('archive')} />
        <ViewButton active={view === 'chronicle'} icon="▤" label="Хроника" onClick={() => setView('chronicle')} />
        <ViewButton active={view === 'atlas'} icon="◫" label="Атлас" onClick={() => setView('atlas')} />
        {localPosition && <ViewButton active={view === 'local'} icon="▦" label="Местность" onClick={() => setView('local')} />}
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
            {(['terrain', 'realms', 'danger', 'population', 'ecology', 'trade'] as MapLayer[]).map(item => <button className={layer === item ? 'active' : ''} key={item} onClick={() => setLayer(item)}>{layerLabel(item)}</button>)}
          </div>
          <label className="layer-select-wrap"><span>Слой карты</span><select className="layer-select" value={layer} onChange={event => setLayer(event.target.value as MapLayer)}>{(['terrain', 'realms', 'danger', 'population', 'ecology', 'trade'] as MapLayer[]).map(item => <option key={item} value={item}>{layerLabel(item)}</option>)}</select></label>
          <div className="map-toolbar-right"><div className="map-legend"><span><i className="dot settlement-dot" />Поселение</span><span><i className="triangle" />Угроза</span><span><i className="army-mark" />Армия</span></div><button className="atlas-entry-button" onClick={() => setView('atlas')}>Исторический атлас</button></div>
        </div>
        <div className="map-wrap"><WorldMap world={world} layer={layer} onSelect={openEntity} onOpenTile={(x, y) => openLocal(x, y)} /><div className="map-vignette" /><div className="map-open-hint">Нажми на любой квадрат, чтобы открыть его локальную карту</div></div>
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

      {view === 'local' && localPosition && <LocalMapViewer world={world} globalX={localPosition.x} globalY={localPosition.y} initialLevel={localPosition.level} onMove={(x, y, level = 0) => setLocalPosition({ x, y, level })} onBack={() => setView('map')} onSelect={openEntity} />}

      {view === 'archive' && <section className="workspace-view archive-workspace scrollable-tab">
        <div className="workspace-heading"><div><span className="eyebrow">Архив мира</span><h1>Всё, что существует</h1></div><p>Выбери личность, государство, книгу, чудовище или другое связанное звено мира.</p></div>
        <div className="window-card archive-window"><Encyclopedia world={world} onSelect={openEntity} /></div>
      </section>}

      {view === 'atlas' && <HistoricalAtlas world={world} onSelect={openEntity} onClose={() => setView('map')} />}

      {view === 'chronicle' && <section className="workspace-view chronicle-workspace scrollable-tab">
        <div className="workspace-heading"><div><span className="eyebrow">Живая хроника</span><h1>Последние события</h1></div><p>Войны, смерти, книги, нападения и решения правителей в одном потоке.</p></div>
        <div className="window-card history-overview-window">
          <div className="history-overview-head"><div><span className="eyebrow">История мира</span><strong>{world.history.generatedYears} прожитых лет</strong></div><small>{world.history.fallenRealms.length} павших держав · {world.history.compressedEventCount.toLocaleString('ru-RU')} обычных изменений сведено в хроники</small></div>
          <div className="history-overview-eras">{world.history.eras.map(era => <div key={era.id}><span>{era.startYear}–{era.endYear}</span><strong>{era.name}</strong><small>{era.summary}</small></div>)}</div>
          <div className="landmark-event-grid">{landmarkEvents.map(event => <button key={event.id} onClick={() => { const ref = event.entityRefs[0]; if (ref) openEntity(ref); }}><time>{event.year}</time><span><strong>{event.title}</strong><small>{event.outcome}</small></span></button>)}</div>
        </div>
        <div className="window-card chronicle-window">
          <div className="event-list event-list-full">{recentEvents.map(event => <button key={event.id} className={`event-item importance-${event.importance}`} onClick={() => { const ref = event.entityRefs[0]; if (ref) openEntity(ref); }}>
            <time>{event.year}.{String(event.month).padStart(2, '0')}</time><span><strong>{event.title}</strong><small>{event.description}</small>{event.cause && <em>Причина: {event.cause}</em>}</span>
          </button>)}</div>
        </div>
      </section>}
    </main>

    <nav className="mobile-nav">
      <ViewButton active={view === 'archive'} icon="⌕" label="Архив" onClick={() => setView('archive')} />
      <ViewButton active={view === 'map' || view === 'atlas' || view === 'local'} icon="⌾" label="Карта" onClick={() => setView('map')} />
      <ViewButton active={view === 'chronicle'} icon="▤" label="Хроника" onClick={() => setView('chronicle')} />
    </nav>

    {selected && <EntityWindow world={world} selected={selected} canGoBack={entityStack.length > 1} onBack={backEntity} onClose={closeEntity} onSelect={openEntity} onOpenLocal={openLocal} />}
    {settingsOpen && <SettingsPanel world={world} update={updateState} performance={performanceProfile} storage={storageProfile} slots={worldSlots} activeSlotId={activeSlotId} snapshots={worldSnapshots} onSwitchWorld={slotId => void switchWorld(slotId)} onRenameWorld={slotId => void renameSlot(slotId)} onDeleteWorld={slotId => void removeSlot(slotId)} onDuplicateWorld={slotId => void duplicateSlot(slotId)} onCreateSnapshot={() => void makeSnapshot()} onRestoreSnapshot={snapshotId => void restoreSnapshot(snapshotId)} onCheck={() => void runUpdateCheck()} onForceUpdate={() => void forceUpdate(updateState.remoteVersion)} onClose={() => setSettingsOpen(false)} />}
    {simulating && <LoadingVeil text={loadingText} progress={progress} onCancel={progress?.operation === 'симуляция' ? cancelWorldOperation : undefined} />}
    {forcedUpdate}
  </div>;
}

function EntityWindow({ world, selected, canGoBack, onBack, onClose, onSelect, onOpenLocal }: {
  world: WorldState;
  selected: EntityRef;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  onSelect: (ref: EntityRef) => void;
  onOpenLocal: (x: number, y: number, level?: number) => void;
}) {
  return <div className="entity-window-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="entity-window" role="dialog" aria-modal="true" aria-label="Карточка объекта мира">
      <header className="entity-window-header">
        <div className="entity-window-nav">
          <button className="window-control" disabled={!canGoBack} onClick={onBack} aria-label="Назад" title="Назад">←</button>
          <span>Карточка мира</span>
        </div>
        <div className="entity-window-header-actions">{localCoordinates(world, selected) && <button className="entity-local-button" onClick={() => { const point = localCoordinates(world, selected); if (point) onOpenLocal(point.x, point.y); }}>Открыть местность</button>}<button className="window-control close-control" onClick={onClose} aria-label="Закрыть" title="Закрыть">×</button></div>
      </header>
      <div className="entity-window-body"><EntityPanel world={world} selected={selected} onSelect={onSelect} /></div>
    </section>
  </div>;
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

function ViewButton({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={onClick}><span>{icon}</span>{label}</button>;
}

function LoadingVeil({ text, progress, onCancel }: { text: string; progress?: SimulationProgress; onCancel?: () => void }) {
  const percent = Math.max(0, Math.min(100, progress?.percent ?? 0));
  return <div className="loading-veil">
    <div className="loading-sigil">E</div>
    <strong>{text}</strong>
    <span>{progress?.phase ?? 'Подготавливаем движок живого мира'}</span>
    <div className="generation-progress" aria-label={`Выполнено ${Math.round(percent)}%`}><i style={{ width: `${percent}%` }} /></div>
    <div className="generation-progress-meta"><b>{Math.round(percent)}%</b><span>{progress?.year ? `Год ${progress.year}, месяц ${progress.month}` : progress?.detail ?? ''}</span><em>{formatDuration(progress?.etaMs)}</em></div>
    {progress?.detail && progress.year && <small className="generation-detail">{progress.detail}</small>}
    {onCancel && <button className="ghost-button cancel-simulation" onClick={onCancel}>Остановить после текущего шага</button>}
  </div>;
}

function formatDuration(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return 'оцениваем время';
  const seconds = Math.max(0, Math.round(value / 1000));
  if (seconds < 2) return 'почти готово';
  if (seconds < 60) return `ещё около ${seconds} сек.`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `ещё около ${minutes} мин. ${rest ? `${rest} сек.` : ''}`.trim();
}
function ForcedUpdate({ remoteVersion, onUpdate }: { remoteVersion: string; onUpdate: () => void }) { return <div className="loading-veil forced-update"><div className="loading-sigil">↻</div><strong>Требуется обновление</strong><span>Найдена версия {remoteVersion}. Старый кэш очищается автоматически.</span><button className="primary-button update-now" onClick={onUpdate}>Обновить сейчас <b>→</b></button></div>; }
function Stat({ value, label }: { value: string | number; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
function monthName(month: number) { return ['Глубокая зима', 'Поздняя зима', 'Оттепель', 'Посев', 'Зелень', 'Высокое солнце', 'Жатва', 'Золотой месяц', 'Туманы', 'Листопад', 'Первые морозы', 'Долгая ночь'][month - 1]; }
function layerLabel(layer: MapLayer) { return ({ terrain: 'Земля', realms: 'Владения', danger: 'Опасность', population: 'Население', ecology: 'Природа', trade: 'Торговля' } as const)[layer]; }
