import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { EntityRef, SimulationProgress, WorldConfig } from './types';
import type { MapLayer } from './components/WorldMap';
import { WorldSetup } from './components/WorldSetup';
import { SettingsPanel } from './components/SettingsPanel';
import { AppDialog, type AppDialogState } from './components/AppDialog';
import { WorldWorkspace, type LocalPosition, type WorldView } from './components/WorldWorkspace';
import { cancelWorldOperation, setWatchedCharactersInBackground, setWorldFocusInBackground } from './lib/worldWorkerClient';
import { forceUpdate } from './lib/appUpdate';
import { useWorldController } from './hooks/useWorldController';
import { useWatchedCharacters } from './hooks/useWatchedCharacters';
import './styles.css';
import './designSystem.css';

export default function App() {
  const controller = useWorldController();
  const watchedCharacters = useWatchedCharacters(controller.world, controller.activeSlotId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [entityStack, setEntityStack] = useState<EntityRef[]>([]);
  const [layer, setLayer] = useState<MapLayer>('terrain');
  const [view, setView] = useState<WorldView>('map');
  const [localPosition, setLocalPosition] = useState<LocalPosition>();
  const [dialog, setDialog] = useState<AppDialogState>();
  const importRef = useRef<HTMLInputElement>(null);
  const selected = entityStack.at(-1);

  useEffect(() => {
    setEntityStack([]);
    setLocalPosition(undefined);
    setView('map');
  }, [controller.worldOpenedToken]);

  useEffect(() => {
    void setWorldFocusInBackground(view === 'local' && localPosition ? { ...localPosition, radius: 1 } : undefined);
  }, [view, localPosition?.x, localPosition?.y, localPosition?.level]);

  useEffect(() => {
    void setWatchedCharactersInBackground(watchedCharacters.ids);
  }, [watchedCharacters.ids.join(',')]);

  const openEntity = useCallback((ref: EntityRef) => {
    setEntityStack(current => {
      const last = current.at(-1);
      if (last?.kind === ref.kind && last.id === ref.id) return current;
      return [...current, ref].slice(-24);
    });
  }, []);
  const closeEntity = useCallback(() => setEntityStack([]), []);
  const backEntity = useCallback(() => setEntityStack(current => current.length > 1 ? current.slice(0, -1) : []), []);
  const openLocal = useCallback((x: number, y: number, level = 0) => { setLocalPosition({ x, y, level }); setEntityStack([]); setView('local'); }, []);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeEntity();
      if (event.key === 'Backspace' && entityStack.length > 1 && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); backEntity(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, entityStack.length, closeEntity, backEntity]);

  useEffect(() => {
    if (settingsOpen) void controller.refreshStorage(controller.activeSlotId);
  }, [settingsOpen, controller.activeSlotId]);

  const exportWorld = () => {
    if (!controller.world || controller.busy) return;
    const blob = new Blob([JSON.stringify(controller.world)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `eldervale-${controller.world.config.seed}-${controller.world.year}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const requestRename = (slotId: string) => {
    const current = controller.worldSlots.find(slot => slot.id === slotId)?.name ?? '';
    setDialog({ kind: 'prompt', title: 'Переименовать мир', message: 'Введи новое название сохранения.', initialValue: current, confirmLabel: 'Сохранить', onConfirm: name => controller.renameSlot(slotId, name) });
  };
  const requestDelete = (slotId: string) => {
    const name = controller.worldSlots.find(slot => slot.id === slotId)?.name ?? slotId;
    setDialog({ kind: 'confirm', title: 'Удалить мир?', message: `Мир «${name}» и все его снимки будут удалены из браузера.`, confirmLabel: 'Удалить', danger: true, onConfirm: () => controller.removeSlot(slotId) });
  };
  const requestRestore = (snapshotId: string) => {
    setDialog({ kind: 'confirm', title: 'Восстановить снимок?', message: 'Текущее состояние мира будет заменено выбранным снимком.', confirmLabel: 'Восстановить', onConfirm: () => controller.restoreSnapshot(snapshotId) });
  };

  const visibleDialog = dialog ?? (controller.notice ? { kind: 'notice' as const, title: controller.notice.title, message: controller.notice.message } : undefined);
  const closeDialog = () => { setDialog(undefined); controller.setNotice(undefined); };

  if (controller.booting) return <LoadingVeil text="Открываем сохранённый мир" progress={controller.progress} />;
  const forcedUpdate = controller.updateState.updateRequired
    ? <ForcedUpdate remoteVersion={controller.updateState.remoteVersion ?? 'новая версия'} onUpdate={() => void forceUpdate(controller.updateState.remoteVersion)} />
    : null;

  if (!controller.world || controller.setupOpen) return <>
    <WorldSetup initial={controller.world?.config} onGenerate={(config: WorldConfig) => void controller.generate(config)} onClose={controller.world ? () => controller.setSetupOpen(false) : undefined} onOpenSettings={() => setSettingsOpen(true)} />
    <input ref={importRef} hidden type="file" accept="application/json" onChange={(event: ChangeEvent<HTMLInputElement>) => { void controller.importWorld(event.target.files?.[0]); event.currentTarget.value = ''; }} />
    {settingsOpen && <SettingsPanel world={controller.world} update={controller.updateState} performance={controller.performanceProfile} storage={controller.storageProfile} slots={controller.worldSlots} activeSlotId={controller.activeSlotId} snapshots={controller.worldSnapshots} onSwitchWorld={(slotId: string) => void controller.switchWorld(slotId)} onRenameWorld={requestRename} onDeleteWorld={requestDelete} onDuplicateWorld={(slotId: string) => void controller.duplicateSlot(slotId)} onCreateSnapshot={() => void controller.makeSnapshot()} onRestoreSnapshot={requestRestore} onCheck={() => void controller.runUpdateCheck()} onForceUpdate={() => void forceUpdate(controller.updateState.remoteVersion)} onClose={() => setSettingsOpen(false)} />}
    {controller.busy && <LoadingVeil text={controller.loadingText} progress={controller.progress} onCancel={controller.progress?.operation === 'симуляция' ? cancelWorldOperation : undefined} />}
    <AppDialog state={visibleDialog} busy={controller.busy} onClose={closeDialog} />
    {forcedUpdate}
  </>;

  return <>
    <WorldWorkspace
      world={controller.world} view={view} setView={setView} layer={layer} setLayer={setLayer}
      localPosition={localPosition} setLocalPosition={setLocalPosition} selected={selected} canGoBack={entityStack.length > 1} busy={controller.busy}
      onSelect={openEntity} onBackEntity={backEntity} onCloseEntity={closeEntity} onOpenLocal={openLocal}
      onNewWorld={() => controller.setSetupOpen(true)} onSettings={() => setSettingsOpen(true)} onExport={exportWorld} onImport={() => importRef.current?.click()}
      watchedCharacterIds={watchedCharacters.ids} onToggleWatch={watchedCharacters.toggle}
      onAdvance={months => void controller.advance(months)} onAdvanceToNextEvent={() => void controller.advanceToNextEvent().then(eventId => { if (eventId) setView('chronicle'); })}
      onAdvanceCharacter={characterId => void controller.advanceToNextCharacterEvent(characterId).then(event => { if (event) setView('stories'); })}
    />
    <input ref={importRef} hidden type="file" accept="application/json" onChange={(event: ChangeEvent<HTMLInputElement>) => { void controller.importWorld(event.target.files?.[0]); event.currentTarget.value = ''; }} />
    {settingsOpen && <SettingsPanel world={controller.world} update={controller.updateState} performance={controller.performanceProfile} storage={controller.storageProfile} slots={controller.worldSlots} activeSlotId={controller.activeSlotId} snapshots={controller.worldSnapshots} onSwitchWorld={(slotId: string) => void controller.switchWorld(slotId)} onRenameWorld={requestRename} onDeleteWorld={requestDelete} onDuplicateWorld={(slotId: string) => void controller.duplicateSlot(slotId)} onCreateSnapshot={() => void controller.makeSnapshot()} onRestoreSnapshot={requestRestore} onCheck={() => void controller.runUpdateCheck()} onForceUpdate={() => void forceUpdate(controller.updateState.remoteVersion)} onClose={() => setSettingsOpen(false)} />}
    {controller.busy && <LoadingVeil text={controller.loadingText} progress={controller.progress} onCancel={controller.progress?.operation === 'симуляция' ? cancelWorldOperation : undefined} />}
    <AppDialog state={visibleDialog} busy={controller.busy} onClose={closeDialog} />
    {forcedUpdate}
  </>;
}

function LoadingVeil({ text, progress, onCancel }: { text: string; progress?: SimulationProgress; onCancel?: () => void }) {
  const percent = Math.max(0, Math.min(100, progress?.percent ?? 0));
  return <div className="loading-veil"><div className="loading-sigil">E</div><strong>{text}</strong><span>{progress?.phase ?? 'Подготавливаем движок живого мира'}</span><div className="generation-progress"><i style={{ width: `${percent}%` }} /></div><div className="generation-progress-meta"><b>{Math.round(percent)}%</b><span>{progress?.year ? `Год ${progress.year}, месяц ${progress.month}` : progress?.detail ?? ''}</span><em>{formatDuration(progress?.etaMs)}</em></div>{progress?.detail && progress.year && <small className="generation-detail">{progress.detail}</small>}{onCancel && <button className="ghost-button cancel-simulation" onClick={onCancel}>Остановить после текущего шага</button>}</div>;
}
function formatDuration(value?: number): string { if (value === undefined || !Number.isFinite(value)) return 'оцениваем время'; const seconds = Math.max(0, Math.round(value / 1000)); if (seconds < 2) return 'почти готово'; if (seconds < 60) return `ещё около ${seconds} сек.`; const minutes = Math.floor(seconds / 60); const rest = seconds % 60; return `ещё около ${minutes} мин. ${rest ? `${rest} сек.` : ''}`.trim(); }
function ForcedUpdate({ remoteVersion, onUpdate }: { remoteVersion: string; onUpdate: () => void }) { return <div className="loading-veil forced-update"><div className="loading-sigil">↻</div><strong>Требуется обновление</strong><span>Найдена версия {remoteVersion}. Старый кэш очищается автоматически.</span><button className="primary-button update-now" onClick={onUpdate}>Обновить сейчас <b>→</b></button></div>; }
