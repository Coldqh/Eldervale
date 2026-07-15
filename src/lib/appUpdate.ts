import { APP_VERSION, VERSION_URL } from '../version';

export interface UpdateCheckResult {
  currentVersion: string;
  remoteVersion?: string;
  remoteName?: string;
  remoteNotes?: string;
  updateRequired: boolean;
  checkedAt: number;
  error?: string;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const checkedAt = Date.now();
  try {
    const response = await fetch(`${VERSION_URL}?t=${checkedAt}`, {
      cache: 'no-store',
      headers: { 'cache-control': 'no-cache' },
    });
    if (!response.ok) throw new Error(`Сервер вернул ${response.status}`);
    const data = await response.json() as { version?: string; name?: string; notes?: string };
    const remoteVersion = data.version?.trim();
    if (!remoteVersion) throw new Error('Файл версии пуст');
    return { currentVersion: APP_VERSION, remoteVersion, remoteName: data.name?.trim(), remoteNotes: data.notes?.trim(), updateRequired: compareVersions(remoteVersion, APP_VERSION) > 0, checkedAt };
  } catch (error) {
    return {
      currentVersion: APP_VERSION,
      updateRequired: false,
      checkedAt,
      error: error instanceof Error ? error.message : 'Проверка обновления не удалась',
    };
  }
}

export async function forceUpdate(remoteVersion?: string): Promise<void> {
  try {
    const registrations = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
    await Promise.all(registrations.map(async registration => {
      await registration.update().catch(() => undefined);
      registration.waiting?.postMessage({ type: 'ПРИМЕНИТЬ_ОБНОВЛЕНИЕ' });
    }));
  } catch { /* Страница восстановления выполнит полную очистку. */ }

  const repairUrl = new URL(`${import.meta.env.BASE_URL}repair.html`, window.location.origin);
  repairUrl.searchParams.set('версия', remoteVersion ?? APP_VERSION);
  repairUrl.searchParams.set('обновление', String(Date.now()));
  window.location.replace(repairUrl.toString());
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(part => Number.parseInt(part, 10) || 0);
  const b = right.split('.').map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
