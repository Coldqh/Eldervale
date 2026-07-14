import { useEffect, useMemo, useRef, useState } from 'react';
import type { EntityRef, WorldConfig, WorldState } from './types';
import { WorldMap, type MapLayer } from './components/WorldMap';
import { EntityPanel } from './components/EntityPanel';
import { Encyclopedia } from './components/Encyclopedia';
import { WorldSetup } from './components/WorldSetup';
import { loadWorld, saveWorld } from './lib/worldStorage';
import { advanceWorldInBackground, generateWorldInBackground } from './lib/worldWorkerClient';
import { localizeLegacyWorld } from './sim/localizeLegacy';
import './styles.css';

type View = 'map' | 'archive' | 'chronicle';

export default function App() {
  const [world, setWorld] = useState<WorldState>();
  const [booting, setBooting] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [selected, setSelected] = useState<EntityRef>();
  const [layer, setLayer] = useState<MapLayer>('terrain');
  const [view, setView] = useState<View>('map');
  const [simulating, setSimulating] = useState(false);
  const [loadingText, setLoadingText] = useState('Открываем сохранённый мир');
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    loadWorld().then(saved => {
      if (!active) return;
      setWorld(saved);
      setSetupOpen(!saved);
      if (saved?.kingdoms[0]) setSelected({ kind: 'settlement', id: saved.kingdoms[0].capitalId });
      setBooting(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!world || booting) return;
    const timer = window.setTimeout(() => { void saveWorld(world); }, 600);
    return () => window.clearTimeout(timer);
  }, [world, booting]);

  const stats = useMemo(() => world ? {
    population: world.characters.filter(c => c.alive).length,
    activeWars: world.wars.filter(w => w.active).length,
    dragons: world.monsters.filter(m => m.alive && m.species === 'dragon').length,
    realms: world.kingdoms.length,
  } : undefined, [world]);

  const generate = async (config: WorldConfig) => {
    setLoadingText('Создаём земли, народы и историю');
    setSimulating(true);
    try {
      const created = await generateWorldInBackground(config);
      setWorld(created);
      setSelected({ kind: 'settlement', id: created.kingdoms[0]!.capitalId });
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
      const parsed = JSON.parse(await file.text()) as WorldState;
      if (parsed.version !== 1 || !parsed.tiles || !parsed.characters) throw new Error('Неверный формат сохранения');
      const localized = localizeLegacyWorld(parsed);
      setWorld(localized);
      setSetupOpen(false);
      setSelected(localized.kingdoms[0] ? { kind: 'settlement', id: localized.kingdoms[0].capitalId } : undefined);
      await saveWorld(localized);
    } catch {
      alert('Не удалось прочитать сохранение Eldervale.');
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  };

  if (booting) return <LoadingVeil text="Открываем сохранённый мир" />;
  if (!world || setupOpen) return <><WorldSetup initial={world?.config} onGenerate={generate} onClose={world ? () => setSetupOpen(false) : undefined} />{simulating && <LoadingVeil text={loadingText} />}</>;

  const recentEvents = [...world.events].sort((a, b) => b.year - a.year || b.month - a.month || b.id - a.id).slice(0, 100);

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setView('map')}><img src="./crest.svg" alt="" /><span><strong>Eldervale</strong><small>{world.name}</small></span></button>
      <div className="world-clock"><span>Год {world.year}</span><strong>{monthName(world.month)}</strong></div>
      <div className="top-actions">
        <button className="ghost-button new-world-button" onClick={() => setSetupOpen(true)} title="Создать новый мир"><span className="desktop-label">Новый мир</span><span className="mobile-label">＋</span></button>
        <button className="icon-button" onClick={exportWorld} title="Экспортировать мир" aria-label="Экспортировать мир">⇩</button>
        <button className="icon-button" onClick={() => importRef.current?.click()} title="Импортировать мир" aria-label="Импортировать мир">⇧</button>
        <input ref={importRef} hidden type="file" accept="application/json" onChange={e => void importWorld(e.target.files?.[0])} />
      </div>
    </header>

    <main className="main-grid">
      <aside className={`left-panel scrollable-tab ${view === 'archive' ? 'mobile-active' : ''}`}>
        <div className="panel-title"><span className="eyebrow">Архив мира</span><h2>Всё, что существует</h2></div>
        <Encyclopedia world={world} onSelect={ref => { setSelected(ref); setView('chronicle'); }} />
      </aside>

      <section className={`map-stage scrollable-tab ${view === 'map' ? 'mobile-active' : ''}`}>
        <div className="map-toolbar">
          <div className="layer-tabs">
            {(['terrain', 'realms', 'danger', 'population'] as MapLayer[]).map(item => <button className={layer === item ? 'active' : ''} key={item} onClick={() => setLayer(item)}>{layerLabel(item)}</button>)}
          </div>
          <div className="map-legend"><span><i className="dot settlement-dot" />Поселение</span><span><i className="triangle" />Угроза</span><span><i className="army-mark" />Армия</span></div>
        </div>
        <div className="map-wrap"><WorldMap world={world} layer={layer} onSelect={ref => { setSelected(ref); setView('chronicle'); }} /><div className="map-vignette" /></div>
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
      </section>

      <aside className={`right-panel scrollable-tab ${view === 'chronicle' ? 'mobile-active' : ''}`}>
        <div className="detail-scroll"><EntityPanel world={world} selected={selected} onSelect={ref => { setSelected(ref); setView('chronicle'); }} /></div>
        <div className="chronicle-block">
          <div className="panel-title compact"><span className="eyebrow">Живая хроника</span><h3>Последние события</h3></div>
          <div className="event-list">{recentEvents.map(event => <button key={event.id} className={`event-item importance-${event.importance}`} onClick={() => { const ref = event.entityRefs[0]; if (ref) setSelected(ref); }}>
            <time>{event.year}.{String(event.month).padStart(2, '0')}</time><span><strong>{event.title}</strong><small>{event.description}</small></span>
          </button>)}</div>
        </div>
      </aside>
    </main>

    <nav className="mobile-nav">
      <button className={view === 'archive' ? 'active' : ''} onClick={() => setView('archive')}><span>⌕</span>Архив</button>
      <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}><span>⌾</span>Карта</button>
      <button className={view === 'chronicle' ? 'active' : ''} onClick={() => setView('chronicle')}><span>▤</span>Хроника</button>
    </nav>
    {simulating && <LoadingVeil text={loadingText} />}
  </div>;
}

function LoadingVeil({ text }: { text: string }) { return <div className="loading-veil"><div className="loading-sigil">E</div><strong>{text}</strong><span>армии идут, люди стареют, чудовища выбирают добычу</span></div>; }
function Stat({ value, label }: { value: string | number; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
function monthName(month: number) { return ['Глубокая зима', 'Поздняя зима', 'Оттепель', 'Посев', 'Зелень', 'Высокое солнце', 'Жатва', 'Золотой месяц', 'Туманы', 'Листопад', 'Первые морозы', 'Долгая ночь'][month - 1]; }
function layerLabel(layer: MapLayer) { return ({ terrain: 'Земля', realms: 'Владения', danger: 'Опасность', population: 'Население' } as const)[layer]; }
