import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { registerSW } from "virtual:pwa-register";

interface RemoteVersionPayload {
  version: string;
  builtAt?: string;
}

interface VersionContextValue {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  checking: boolean;
  updating: boolean;
  error?: string;
  checkForUpdate(): Promise<void>;
  forceUpdate(): Promise<void>;
}

const VersionContext = createContext<VersionContextValue | undefined>(undefined);

function isDifferentVersion(current: string, latest: string): boolean {
  return current.trim() !== latest.trim();
}

export function VersionProvider({ children }: { children: ReactNode }) {
  const [latestVersion, setLatestVersion] = useState<string>();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string>();
  const updateServiceWorker = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);
  const lastCheck = useRef(0);

  const checkForUpdate = useCallback(async () => {
    setChecking(true);
    setError(undefined);
    try {
      const url = `${import.meta.env.BASE_URL}version.json?check=${Date.now()}`;
      const response = await fetch(url, { cache: "no-store", headers: { "cache-control": "no-cache" } });
      if (!response.ok) throw new Error(`Version request failed: ${response.status}`);
      const payload = await response.json() as RemoteVersionPayload;
      if (!payload.version) throw new Error("Version payload is empty");
      setLatestVersion(payload.version);
      setUpdateAvailable(isDifferentVersion(__APP_VERSION__, payload.version));
      lastCheck.current = Date.now();
    } catch (caught) {
      console.error(caught);
      setError("Не удалось проверить опубликованную версию.");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    updateServiceWorker.current = registerSW({
      immediate: true,
      onNeedRefresh() {
        setUpdateAvailable(true);
      },
      onRegisteredSW(_scriptUrl, registration) {
        void registration?.update();
      },
      onRegisterError(caught) {
        console.error(caught);
        setError("Service worker не зарегистрирован.");
      },
    });

    void checkForUpdate();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && Date.now() - lastCheck.current > 5 * 60_000) {
        void checkForUpdate();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [checkForUpdate]);

  const forceUpdate = useCallback(async () => {
    setUpdating(true);
    setError(undefined);
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.update()));
      }
      if (updateServiceWorker.current) {
        await updateServiceWorker.current(true);
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.includes("workbox") || key.includes("precache") || key.includes("prospect")).map((key) => caches.delete(key)));
      }
      const registrations = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistrations() : [];
      await Promise.all(registrations.map((registration) => registration.unregister()));
      const target = `${window.location.pathname}?force-update=${Date.now()}${window.location.hash}`;
      window.location.replace(target);
    } catch (caught) {
      console.error(caught);
      setError("Принудительное обновление не удалось. Проверь подключение.");
      setUpdating(false);
    }
  }, []);

  const value = useMemo<VersionContextValue>(() => ({
    currentVersion: __APP_VERSION__,
    ...(latestVersion ? { latestVersion } : {}),
    updateAvailable,
    checking,
    updating,
    ...(error ? { error } : {}),
    checkForUpdate,
    forceUpdate,
  }), [latestVersion, updateAvailable, checking, updating, error, checkForUpdate, forceUpdate]);

  return <VersionContext.Provider value={value}>{children}</VersionContext.Provider>;
}

export function useVersion(): VersionContextValue {
  const context = useContext(VersionContext);
  if (!context) throw new Error("useVersion must be used inside VersionProvider");
  return context;
}
