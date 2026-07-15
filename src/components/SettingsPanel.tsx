import type { UpdateCheckResult } from '../lib/appUpdate';
import type { SimulationProfile, WorldState } from '../types';
import { APP_VERSION } from '../version';
import { inspectWorldIntegrity } from '../sim/integrity';

export function SettingsPanel({ world, update, performance, onCheck, onForceUpdate, onClose }: {
  world?: WorldState;
  update: UpdateCheckResult;
  performance?: SimulationProfile;
  onCheck: () => void;
  onForceUpdate: () => void;
  onClose: () => void;
}) {
  const integrity = world ? inspectWorldIntegrity(world) : undefined;
  const shownPerformance = performance ?? world?.simulation.lastProfile;
  const status = update.updateRequired
    ? `Доступна обязательная версия ${update.remoteVersion}`
    : update.error
      ? `Не удалось проверить: ${update.error}`
      : 'Установлена актуальная версия';
  return <div className="modal-backdrop" role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-panel" role="dialog" aria-modal="true" aria-label="Настройки Eldervale">
      <div className="settings-heading"><div><span className="eyebrow">Настройки</span><h2>Eldervale</h2></div><button className="icon-button" onClick={onClose} aria-label="Закрыть настройки">×</button></div>
      <div className="settings-version-card">
        <span>Текущая версия</span><strong>{APP_VERSION}</strong><small>{status}</small>
      </div>
      <div className="entity-stats settings-stats">
        <div className="stat-row"><span>Схема сохранения</span><strong>{world ? `версия ${world.version}` : 'нет активного мира'}</strong></div>
        <div className="stat-row"><span>Хранилище</span><strong>IndexedDB с резервным локальным сохранением</strong></div>
        <div className="stat-row"><span>Обновления</span><strong>обязательные, с очисткой старого кэша</strong></div>
        {world && <><div className="stat-row"><span>Мир</span><strong>{world.name}</strong></div><div className="stat-row"><span>Последняя эпоха</span><strong>{world.year} год</strong></div><div className="stat-row"><span>Локальная карта</span><strong>{world.config.localMapSize}×{world.config.localMapSize}</strong></div><div className="stat-row"><span>Животные</span><strong>{world.animalPopulations.length} популяций</strong></div><div className="stat-row"><span>Природные ресурсы</span><strong>{world.ingredients.length} источников</strong></div><div className="stat-row"><span>Алхимия</span><strong>{world.alchemyRecipes.length} рецептов</strong></div><div className="stat-row"><span>Активные регионы</span><strong>{world.simulation.activeRegionKeys.length} активных · {world.simulation.sleepingRegionCount} спящих</strong></div><div className="stat-row"><span>Очередь действий</span><strong>{world.simulation.queuedActions.length} запланировано</strong></div><div className="stat-row"><span>Проверка логики</span><strong>{integrity?.errors.length ? `${integrity.errors.length} ошибок` : `${integrity?.checks.toLocaleString('ru-RU')} проверок · ошибок нет`}</strong></div>{Boolean(integrity?.warnings.length) && <div className="stat-row"><span>Предупреждения</span><strong>{integrity!.warnings.slice(0, 3).join('; ')}</strong></div>}</>}
      </div>
      {shownPerformance && <div className="settings-release-notes performance-report"><span className="eyebrow">Последняя операция</span><strong>{shownPerformance.operation} · {formatMs(shownPerformance.totalMs)}</strong><small>Симуляция: {formatMs(shownPerformance.simulationMs)} · обмен с Worker: {formatMs(shownPerformance.workerRoundTripMs)} · сохранение: {formatMs(shownPerformance.saveMs)} · задач: {shownPerformance.processedTasks?.toLocaleString('ru-RU') ?? '—'}</small></div>}
      <div className="settings-release-notes">
        <span className="eyebrow">Последнее обновление</span>
        <strong>0.9.0 · Производительное ядро симуляции</strong>
        <small>Постоянный Worker, индексы мира, линейная экология, планировщик событий, активные и спящие регионы, шкала прогресса, ETA и раздельная диагностика времени.</small>
      </div>
      <div className="settings-actions">
        <button className="ghost-button" onClick={onCheck}>Проверить обновление</button>
        <button className="primary-button compact-primary" onClick={onForceUpdate}>Принудительно обновить <span>↻</span></button>
      </div>
      <p className="setup-note">Мир хранится отдельно от файлов приложения. Обновление не удаляет сохранение.</p>
    </section>
  </div>;
}

function formatMs(value?: number): string {
  if (value === undefined) return '—';
  if (value < 1000) return `${Math.round(value)} мс`;
  return `${(value / 1000).toFixed(value < 10000 ? 2 : 1)} сек.`;
}
