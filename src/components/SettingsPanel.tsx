import type { UpdateCheckResult } from '../lib/appUpdate';
import type { SimulationProfile, StorageProfile, WorldSlotMeta, WorldSnapshotMeta, WorldState } from '../types';
import { APP_VERSION } from '../version';
import { inspectWorldIntegrity } from '../sim/integrity';

export function SettingsPanel({
  world, update, performance, storage, slots, activeSlotId, snapshots,
  onSwitchWorld, onRenameWorld, onDeleteWorld, onDuplicateWorld, onCreateSnapshot, onRestoreSnapshot,
  onCheck, onForceUpdate, onClose,
}: {
  world?: WorldState;
  update: UpdateCheckResult;
  performance?: SimulationProfile;
  storage?: StorageProfile;
  slots: WorldSlotMeta[];
  activeSlotId?: string;
  snapshots: WorldSnapshotMeta[];
  onSwitchWorld: (slotId: string) => void;
  onRenameWorld: (slotId: string) => void;
  onDeleteWorld: (slotId: string) => void;
  onDuplicateWorld: (slotId: string) => void;
  onCreateSnapshot: () => void;
  onRestoreSnapshot: (snapshotId: string) => void;
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
    <section className="settings-panel settings-panel-wide" role="dialog" aria-modal="true" aria-label="Настройки Eldervale">
      <div className="settings-heading"><div><span className="eyebrow">Настройки и миры</span><h2>Eldervale</h2></div><button className="icon-button" onClick={onClose} aria-label="Закрыть настройки">×</button></div>
      <div className="settings-version-card">
        <span>Текущая версия</span><strong>{APP_VERSION}</strong><small>{status}</small>
      </div>

      <section className="world-library-section">
        <div className="settings-section-heading"><div><span className="eyebrow">Библиотека миров</span><h3>{slots.length} сохранений</h3></div>{world && activeSlotId && <button className="ghost-button" onClick={onCreateSnapshot}>Создать снимок</button>}</div>
        <div className="world-slot-list">
          {slots.map(slot => <article className={`world-slot-card ${slot.id === activeSlotId ? 'active' : ''}`} key={slot.id}>
            <button className="world-slot-main" onClick={() => onSwitchWorld(slot.id)} disabled={slot.id === activeSlotId}>
              <span><strong>{slot.name}</strong><small>{slot.seed}</small></span>
              <em>Год {slot.year} · {formatBytes(slot.sizeBytes)}</em>
            </button>
            <div className="world-slot-actions">
              <button onClick={() => onRenameWorld(slot.id)} title="Переименовать">✎</button>
              <button onClick={() => onDuplicateWorld(slot.id)} title="Создать копию">⧉</button>
              <button onClick={() => onDeleteWorld(slot.id)} title="Удалить">×</button>
            </div>
          </article>)}
          {!slots.length && <p className="setup-note">Сохранённых миров пока нет.</p>}
        </div>
        {snapshots.length > 0 && <div className="snapshot-list"><span className="eyebrow">Снимки активного мира</span>{snapshots.map(snapshot => <button key={snapshot.id} onClick={() => onRestoreSnapshot(snapshot.id)}><span>Год {snapshot.year}, месяц {snapshot.month}</span><small>{snapshot.reason} · {formatBytes(snapshot.sizeBytes)}</small></button>)}</div>}
      </section>

      <div className="entity-stats settings-stats">
        <div className="stat-row"><span>Схема сохранения</span><strong>{world ? `версия ${world.version}` : 'нет активного мира'}</strong></div>
        <div className="stat-row"><span>Хранилище</span><strong>раздельные записи IndexedDB и инкрементальные обновления</strong></div>
        <div className="stat-row"><span>Обновления</span><strong>обязательные, с очисткой старого кэша</strong></div>
        {world && <>
          <div className="stat-row"><span>Мир</span><strong>{world.name}</strong></div>
          <div className="stat-row"><span>Исторический движок</span><strong>{world.history.generatedYears} прожитых лет · {world.history.eras.length} эпох</strong></div>
          <div className="stat-row"><span>Исторические государства</span><strong>{world.history.fallenRealms.length} павших держав</strong></div>
          <div className="stat-row"><span>Сжатая обычная жизнь</span><strong>{world.history.compressedEventCount.toLocaleString('ru-RU')} изменений сведено в хроники</strong></div>
          <div className="stat-row"><span>Подробная хроника</span><strong>{world.events.length.toLocaleString('ru-RU')} событий</strong></div>
          <div className="stat-row"><span>Локальная карта</span><strong>{world.config.localMapSize}×{world.config.localMapSize}</strong></div>
          <div className="stat-row"><span>Активные регионы</span><strong>{world.simulation.activeRegionKeys.length} активных · {world.simulation.sleepingRegionCount} спящих</strong></div>
          <div className="stat-row"><span>Очередь действий</span><strong>{world.simulation.queuedActions.length} запланировано</strong></div>
          <div className="stat-row"><span>Проверка логики</span><strong>{integrity?.errors.length ? `${integrity.errors.length} ошибок` : `${integrity?.checks.toLocaleString('ru-RU')} проверок · ошибок нет`}</strong></div>
          {Boolean(integrity?.warnings.length) && <div className="stat-row"><span>Предупреждения</span><strong>{integrity!.warnings.slice(0, 3).join('; ')}</strong></div>}
        </>}
      </div>

      {shownPerformance && <div className="settings-release-notes performance-report"><span className="eyebrow">Последняя операция</span><strong>{shownPerformance.operation} · {formatMs(shownPerformance.totalMs)}</strong><small>Симуляция: {formatMs(shownPerformance.simulationMs)} · обмен с Worker: {formatMs(shownPerformance.workerRoundTripMs)} · сохранение: {formatMs(shownPerformance.saveMs)} · задач: {shownPerformance.processedTasks?.toLocaleString('ru-RU') ?? '—'}</small></div>}
      {storage && <div className="settings-release-notes storage-report"><span className="eyebrow">Последнее сохранение</span><strong>{storage.writtenRecords} записей изменено · {formatMs(storage.totalMs)}</strong><small>{storage.skippedRecords} неизменённых записей пропущено · удалено {storage.deletedRecords} · объём {formatBytes(storage.bytesEstimated)}{storage.snapshotCreated ? ' · создан снимок' : ''}</small></div>}
      <div className="settings-release-notes">
        <span className="eyebrow">Последнее обновление</span>
        <strong>1.0.0 · Хранилище и настоящий исторический движок</strong>
        <small>Несколько миров, инкрементальные сохранения, автоматические снимки, восстановление после сбоя и многоуровневая причинная история от древних эпох до настоящего.</small>
      </div>
      <div className="settings-actions">
        <button className="ghost-button" onClick={onCheck}>Проверить обновление</button>
        <button className="primary-button compact-primary" onClick={onForceUpdate}>Принудительно обновить <span>↻</span></button>
      </div>
      <p className="setup-note">Файлы приложения и миры хранятся отдельно. Обновление интерфейса не удаляет сохранения и снимки.</p>
    </section>
  </div>;
}

function formatMs(value?: number): string {
  if (value === undefined) return '—';
  if (value < 1000) return `${Math.round(value)} мс`;
  return `${(value / 1000).toFixed(value < 10000 ? 2 : 1)} сек.`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}
