import { useCallback, useEffect, useState } from 'react';
import type { SimulationProfile, SimulationProgress, StorageProfile, WorldConfig, WorldSlotMeta, WorldSnapshotMeta, WorldState } from '../types';
import {
  createWorldSlot, createWorldSnapshot, deleteWorldSlot, duplicateWorldSlot, getActiveWorldSlotId, listWorldSlots,
  listWorldSnapshots, loadWorld, loadWorldSlot, renameWorldSlot, restoreWorldSnapshot, saveWorld,
} from '../lib/worldStorage';
import {
  advanceToNextCharacterEventInBackground, advanceToNextEventInBackground, advanceWorldInBackground, generateWorldInBackground, initializeWorldInBackground,
} from '../lib/worldWorkerClient';
import { checkForUpdate, forceUpdate, type UpdateCheckResult } from '../lib/appUpdate';
import { migrateWorld } from '../sim/migrateWorld';
import { initializeClimateSystem } from '../sim/climateSystem';
import { initializeRaceDemography } from '../sim/raceDemography';
import { APP_VERSION } from '../version';
import { WORLD_STORAGE_ERROR_EVENT, type StorageFailureDetail } from '../lib/storageDiagnostics';

const initialUpdate: UpdateCheckResult = { currentVersion: APP_VERSION, updateRequired: false, checkedAt: 0 };

export function useWorldController() {
  const [world, setWorld] = useState<WorldState>();
  const [booting, setBooting] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingText, setLoadingText] = useState('Открываем сохранённый мир');
  const [progress, setProgress] = useState<SimulationProgress>();
  const [performanceProfile, setPerformanceProfile] = useState<SimulationProfile>();
  const [storageProfile, setStorageProfile] = useState<StorageProfile>();
  const [activeSlotId, setActiveSlotId] = useState<string>();
  const [worldSlots, setWorldSlots] = useState<WorldSlotMeta[]>([]);
  const [worldSnapshots, setWorldSnapshots] = useState<WorldSnapshotMeta[]>([]);
  const [updateState, setUpdateState] = useState<UpdateCheckResult>(initialUpdate);
  const [notice, setNotice] = useState<{ title: string; message: string }>();
  const [worldOpenedToken, setWorldOpenedToken] = useState(0);

  const showError = useCallback((error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message : fallback;
    setNotice({ title: 'Операция остановлена', message });
  }, []);

  const refreshStorage = useCallback(async (slotId?: string) => {
    const slots = await listWorldSlots();
    setWorldSlots(slots);
    const resolved = slotId ?? activeSlotId ?? await getActiveWorldSlotId();
    setWorldSnapshots(resolved ? await listWorldSnapshots(resolved) : []);
  }, [activeSlotId]);

  const runUpdateCheck = useCallback(async () => {
    const result = await checkForUpdate();
    setUpdateState(result);
    return result;
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<StorageFailureDetail>).detail;
      if (detail) setNotice({ title: 'Ошибка хранилища', message: detail.message });
    };
    window.addEventListener(WORLD_STORAGE_ERROR_EVENT, handler);
    return () => window.removeEventListener(WORLD_STORAGE_ERROR_EVENT, handler);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const update = await runUpdateCheck();
        if (!active || update.updateRequired) return;
        const [saved, slotId] = await Promise.all([loadWorld(), getActiveWorldSlotId()]);
        if (!active) return;
        if (saved) {
          initializeRaceDemography(saved);
          initializeClimateSystem(saved);
          setProgress({ operation: 'загрузка', phase: 'Подготовка постоянного движка', completed: 0, total: 1, percent: 0, elapsedMs: 0 });
          setPerformanceProfile(await initializeWorldInBackground(saved, setProgress));
        }
        const resolvedSlotId = slotId ?? await getActiveWorldSlotId();
        setActiveSlotId(resolvedSlotId);
        setWorld(saved);
        setSetupOpen(!saved);
        if (saved) setWorldOpenedToken(value => value + 1);
        setProgress(undefined);
        void refreshStorage(resolvedSlotId).catch(error => showError(error, 'Не удалось прочитать библиотеку миров.'));
      } catch (error) {
        if (active) {
          setWorld(undefined);
          setSetupOpen(true);
          setProgress(undefined);
          showError(error, 'Не удалось открыть сохранённый мир.');
        }
      } finally {
        if (active) setBooting(false);
      }
    })();
    return () => { active = false; };
  }, [runUpdateCheck, showError]);

  useEffect(() => {
    const interval = window.setInterval(() => { void runUpdateCheck(); }, 5 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') void runUpdateCheck(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [runUpdateCheck]);

  useEffect(() => {
    if (booting || busy || !updateState.updateRequired) return;
    const remoteVersion = updateState.remoteVersion ?? 'неизвестная';
    const attemptKey = `eldervale-auto-update:${remoteVersion}`;
    if (sessionStorage.getItem(attemptKey) === APP_VERSION) return;
    sessionStorage.setItem(attemptKey, APP_VERSION);
    const timer = window.setTimeout(() => { void forceUpdate(updateState.remoteVersion); }, 2200);
    return () => window.clearTimeout(timer);
  }, [booting, busy, updateState.updateRequired, updateState.remoteVersion]);

  useEffect(() => {
    if (!busy) return;
    const preventClose = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventClose);
    return () => window.removeEventListener('beforeunload', preventClose);
  }, [busy]);

  const generate = async (config: WorldConfig) => {
    if (busy) return false;
    setLoadingText('Создаём земли, народы и причинную историю');
    setProgress(undefined);
    setBusy(true);
    const roundTripStarted = performance.now();
    try {
      const result = await generateWorldInBackground(config, setProgress);
      if (!result.world) throw new Error('Генератор не вернул созданный мир');
      initializeRaceDemography(result.world);
      initializeClimateSystem(result.world);
      const receivedAt = performance.now();
      setLoadingText('Сохраняем созданный мир');
      const saveStarted = performance.now();
      const created = await createWorldSlot(result.world, undefined, { onProgress: setProgress });
      const saveMs = performance.now() - saveStarted;
      setWorld(result.world);
      setActiveSlotId(created.slotId);
      setStorageProfile(created.profile);
      setPerformanceProfile({
        ...(result.profile ?? { operation: 'генерация', totalMs: receivedAt - roundTripStarted, generatedAt: Date.now() }),
        workerRoundTripMs: Math.max(0, receivedAt - roundTripStarted - (result.profile?.simulationMs ?? 0)),
        saveMs, totalMs: performance.now() - roundTripStarted,
      });
      setSetupOpen(false);
      setWorldOpenedToken(value => value + 1);
      void refreshStorage(created.slotId);
      return true;
    } catch (error) {
      showError(error, 'Не удалось создать мир.');
      return false;
    } finally {
      setProgress(undefined);
      setBusy(false);
    }
  };

  const finishSimulation = async (result: Awaited<ReturnType<typeof advanceWorldInBackground>>, roundTripStarted: number) => {
    if (!result.world) throw new Error('Симуляция не вернула состояние мира');
    initializeRaceDemography(result.world);
    initializeClimateSystem(result.world);
    const receivedAt = performance.now();
    setLoadingText('Сохраняем изменения мира');
    const saveStarted = performance.now();
    const stored = await saveWorld(result.world, activeSlotId, { onProgress: setProgress });
    const saveMs = performance.now() - saveStarted;
    setWorld(result.world);
    setActiveSlotId(stored.slotId);
    setStorageProfile(stored);
    setPerformanceProfile({
      ...(result.profile ?? { operation: 'симуляция', totalMs: receivedAt - roundTripStarted, generatedAt: Date.now() }),
      workerRoundTripMs: Math.max(0, receivedAt - roundTripStarted - (result.profile?.simulationMs ?? 0)),
      saveMs, totalMs: performance.now() - roundTripStarted,
    });
    void refreshStorage(stored.slotId);
  };

  const advance = async (months: number) => {
    if (!world || busy) return false;
    setLoadingText(months >= 120 ? 'Проводим мир через десятилетие' : months >= 12 ? 'Симулируем новый год' : 'Мир проживает следующий месяц');
    setBusy(true);
    setProgress(undefined);
    const started = performance.now();
    try {
      const result = await advanceWorldInBackground(months, setProgress);
      await finishSimulation(result, started);
      return true;
    } catch (error) {
      showError(error, 'Симуляция остановилась.');
      return false;
    } finally {
      setProgress(undefined);
      setBusy(false);
    }
  };

  const advanceToNextEvent = async () => {
    if (!world || busy) return undefined;
    setLoadingText('Ищем следующее важное событие');
    setBusy(true);
    setProgress(undefined);
    const started = performance.now();
    try {
      const result = await advanceToNextEventInBackground(24, 2, setProgress);
      await finishSimulation(result, started);
      if (result.limitReached) setNotice({ title: 'Событие не найдено', message: 'За 24 месяца не произошло события важности 2 или выше. Мир сохранён в достигнутой дате.' });
      return result.stoppedOnEventId;
    } catch (error) {
      showError(error, 'Поиск следующего события остановился.');
      return undefined;
    } finally {
      setProgress(undefined);
      setBusy(false);
    }
  };


  const advanceToNextCharacterEvent = async (characterId: number) => {
    if (!world || busy) return undefined;
    const character = world.characters.find(item => item.id === characterId);
    setLoadingText(`Ищем следующий шаг истории: ${character?.name ?? `житель №${characterId}`}`);
    setBusy(true);
    setProgress(undefined);
    const started = performance.now();
    try {
      const result = await advanceToNextCharacterEventInBackground(characterId, 36, setProgress);
      await finishSimulation(result, started);
      if (result.limitReached) setNotice({ title: 'Личная история не изменилась', message: 'За 36 месяцев не появилось новой личной записи, памяти или исторического события. Мир сохранён в достигнутой дате.' });
      return result.stoppedOnCharacterEvent;
    } catch (error) {
      showError(error, 'Поиск личного события остановился.');
      return undefined;
    } finally {
      setProgress(undefined);
      setBusy(false);
    }
  };

  const importWorld = async (file?: File) => {
    if (!file || busy) return false;
    setBusy(true);
    setLoadingText('Импортируем сохранённый мир');
    try {
      const migrated = migrateWorld(JSON.parse(await file.text()));
      initializeRaceDemography(migrated);
      initializeClimateSystem(migrated);
      await initializeWorldInBackground(migrated, setProgress);
      const created = await createWorldSlot(migrated, `import-${Date.now()}`, { onProgress: setProgress });
      setWorld(migrated);
      setActiveSlotId(created.slotId);
      setStorageProfile(created.profile);
      setSetupOpen(false);
      setWorldOpenedToken(value => value + 1);
      await refreshStorage(created.slotId);
      return true;
    } catch (error) {
      showError(error, 'Не удалось прочитать сохранение Eldervale.');
      return false;
    } finally {
      setProgress(undefined);
      setBusy(false);
    }
  };

  const switchWorld = async (slotId: string) => {
    if (busy || slotId === activeSlotId) return false;
    setBusy(true);
    setLoadingText('Открываем выбранный мир');
    try {
      const loaded = await loadWorldSlot(slotId);
      if (!loaded) throw new Error('Мир не найден');
      initializeRaceDemography(loaded);
      initializeClimateSystem(loaded);
      setPerformanceProfile(await initializeWorldInBackground(loaded, setProgress));
      setWorld(loaded);
      setActiveSlotId(slotId);
      setWorldOpenedToken(value => value + 1);
      void refreshStorage(slotId);
      return true;
    } catch (error) {
      showError(error, 'Не удалось открыть мир.');
      return false;
    } finally {
      setProgress(undefined);
      setBusy(false);
    }
  };

  const renameSlot = async (slotId: string, name: string) => {
    if (busy || !name.trim()) return;
    try {
      await renameWorldSlot(slotId, name.trim());
      if (slotId === activeSlotId && world) setWorld({ ...world, name: name.trim() });
      await refreshStorage(slotId);
    } catch (error) { showError(error, 'Не удалось переименовать мир.'); }
  };

  const removeSlot = async (slotId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteWorldSlot(slotId);
      const remaining = await listWorldSlots();
      setWorldSlots(remaining);
      if (slotId === activeSlotId) {
        const next = remaining[0];
        if (next) {
          const loaded = await loadWorldSlot(next.id);
          if (!loaded) throw new Error('Следующий мир не найден');
          initializeRaceDemography(loaded);
          initializeClimateSystem(loaded);
          await initializeWorldInBackground(loaded, setProgress);
          setWorld(loaded);
          setActiveSlotId(next.id);
          setWorldOpenedToken(value => value + 1);
          await refreshStorage(next.id);
        } else {
          setWorld(undefined);
          setActiveSlotId(undefined);
          setWorldSnapshots([]);
          setSetupOpen(true);
        }
      } else await refreshStorage(activeSlotId);
    } catch (error) { showError(error, 'Не удалось удалить мир.'); }
    finally { setProgress(undefined); setBusy(false); }
  };

  const duplicateSlot = async (slotId: string) => {
    if (busy) return;
    try { await duplicateWorldSlot(slotId); await refreshStorage(activeSlotId); }
    catch (error) { showError(error, 'Не удалось создать копию мира.'); }
  };

  const makeSnapshot = async () => {
    if (!world || !activeSlotId || busy) return;
    try { await createWorldSnapshot(world, activeSlotId, 'ручной'); await refreshStorage(activeSlotId); }
    catch (error) { showError(error, 'Не удалось создать снимок.'); }
  };

  const restoreSnapshot = async (snapshotId: string) => {
    if (busy) return;
    setBusy(true);
    setLoadingText('Восстанавливаем снимок мира');
    try {
      const restored = await restoreWorldSnapshot(snapshotId);
      initializeRaceDemography(restored.world);
      initializeClimateSystem(restored.world);
      await initializeWorldInBackground(restored.world, setProgress);
      setWorld(restored.world);
      setActiveSlotId(restored.slotId);
      setWorldOpenedToken(value => value + 1);
      await refreshStorage(restored.slotId);
    } catch (error) { showError(error, 'Не удалось восстановить снимок.'); }
    finally { setProgress(undefined); setBusy(false); }
  };

  return {
    world, booting, setupOpen, setSetupOpen, busy, loadingText, progress, performanceProfile, storageProfile,
    activeSlotId, worldSlots, worldSnapshots, updateState, notice, setNotice, worldOpenedToken,
    runUpdateCheck, refreshStorage, generate, advance, advanceToNextEvent, advanceToNextCharacterEvent, importWorld, switchWorld, renameSlot,
    removeSlot, duplicateSlot, makeSnapshot, restoreSnapshot,
  };
}
