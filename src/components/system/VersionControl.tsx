import { useState } from "react";
import { BottomSheet } from "../ui/BottomSheet";
import { Icon } from "../ui/Icon";
import { useVersion } from "./VersionProvider";

export function VersionControl() {
  const [open, setOpen] = useState(false);
  const { currentVersion, latestVersion, updateAvailable, checking, updating, error, checkForUpdate, forceUpdate } = useVersion();

  return (
    <>
      <button type="button" className={`version-chip ${updateAvailable ? "has-update" : ""}`} onClick={() => setOpen(true)}>
        <i /> <span>{updateAvailable ? "UPDATE" : `v${currentVersion}`}</span>
      </button>
      <BottomSheet open={open} title="Версия приложения" eyebrow="PWA CONTROL" onClose={() => setOpen(false)}>
        <div className="version-panel">
          <div className="version-panel__compare">
            <span><small>Установлена</small><strong>v{currentVersion}</strong></span>
            <Icon name="arrow-right" />
            <span><small>Опубликована</small><strong>{latestVersion ? `v${latestVersion}` : "—"}</strong></span>
          </div>
          <div className={`version-state ${updateAvailable ? "is-update" : "is-current"}`}>
            <Icon name={updateAvailable ? "download" : "check"} />
            <div><strong>{updateAvailable ? "Доступна новая сборка" : "Версия актуальна"}</strong><p>Проверка идёт напрямую по version.json и не использует кэш service worker.</p></div>
          </div>
          {error && <div className="inline-message inline-message--error">{error}</div>}
          <button type="button" className="button button--ghost button--wide" disabled={checking || updating} onClick={() => void checkForUpdate()}>
            {checking ? "Проверка…" : "Проверить версию"}
          </button>
          <button type="button" className="button button--primary button--wide" disabled={updating} onClick={() => void forceUpdate()}>
            {updating ? "Обновление…" : "Принудительно обновить"}
          </button>
          <p className="version-panel__note">Сохранения IndexedDB не удаляются. Очищаются только файлы интерфейса и service worker.</p>
        </div>
      </BottomSheet>
    </>
  );
}
