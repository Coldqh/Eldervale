import type { UpdateCheckResult } from '../lib/appUpdate';
import type { WorldState } from '../types';
import { APP_VERSION } from '../version';

export function SettingsPanel({ world, update, onCheck, onForceUpdate, onClose }: {
  world?: WorldState;
  update: UpdateCheckResult;
  onCheck: () => void;
  onForceUpdate: () => void;
  onClose: () => void;
}) {
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
        {world && <><div className="stat-row"><span>Мир</span><strong>{world.name}</strong></div><div className="stat-row"><span>Последняя эпоха</span><strong>{world.year} год</strong></div></>}
      </div>
      <div className="settings-release-notes">
        <span className="eyebrow">Последнее обновление</span>
        <strong>0.4.0 · Исторический атлас</strong>
        <small>Выбор года, реконструкция границ, слои эпохи, фильтры хроники и исправление вкладок архива на ПК.</small>
      </div>
      <div className="settings-actions">
        <button className="ghost-button" onClick={onCheck}>Проверить обновление</button>
        <button className="primary-button compact-primary" onClick={onForceUpdate}>Принудительно обновить <span>↻</span></button>
      </div>
      <p className="setup-note">Мир хранится отдельно от файлов приложения. Обновление не удаляет сохранение.</p>
    </section>
  </div>;
}
