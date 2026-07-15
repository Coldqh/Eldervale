interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface PwaInstallState {
  canInstall: boolean;
  installed: boolean;
  online: boolean;
  offlineReady: boolean;
  ios: boolean;
}

const listeners = new Set<() => void>();
let deferredPrompt: BeforeInstallPromptEvent | undefined;
let initialized = false;
let state = readState();

function isStandalone(): boolean {
  const standaloneMedia = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return standaloneMedia || iosStandalone;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function readState(): PwaInstallState {
  return {
    canInstall: Boolean(deferredPrompt),
    installed: isStandalone(),
    online: navigator.onLine,
    offlineReady: Boolean(navigator.serviceWorker?.controller),
    ios: isIos(),
  };
}

function publish(): void {
  state = readState();
  for (const listener of listeners) listener();
}

export function initializePwaInstall(): void {
  if (initialized) return;
  initialized = true;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    publish();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = undefined;
    publish();
  });
  window.addEventListener('online', publish);
  window.addEventListener('offline', publish);
  navigator.serviceWorker?.addEventListener('controllerchange', publish);
  void navigator.serviceWorker?.ready.then(publish);
}

export function subscribePwaInstallState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPwaInstallState(): PwaInstallState {
  return state;
}

export async function installPwa(): Promise<boolean> {
  const prompt = deferredPrompt;
  if (!prompt) return false;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  if (choice.outcome === 'accepted') deferredPrompt = undefined;
  publish();
  return choice.outcome === 'accepted';
}
