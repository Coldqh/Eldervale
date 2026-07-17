import { useEffect, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent } from 'react';
import './appDialog.css';

export type AppDialogState =
  | { kind: 'notice'; title: string; message: string }
  | { kind: 'confirm'; title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void | Promise<void> }
  | { kind: 'prompt'; title: string; message: string; initialValue: string; confirmLabel: string; onConfirm: (value: string) => void | Promise<void> };

export function AppDialog({ state, busy, onClose }: { state?: AppDialogState; busy?: boolean; onClose: () => void }) {
  const [value, setValue] = useState('');
  useEffect(() => { if (state?.kind === 'prompt') setValue(state.initialValue); }, [state]);
  if (!state) return null;

  const confirm = async () => {
    if (busy) return;
    if (state.kind === 'confirm') await state.onConfirm();
    if (state.kind === 'prompt' && value.trim()) await state.onConfirm(value.trim());
    onClose();
  };

  return <div className="modal-backdrop app-dialog-backdrop" onPointerDown={(event: PointerEvent<HTMLDivElement>) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="app-dialog" role="dialog" aria-modal="true" aria-label={state.title}>
      <span className="eyebrow">Eldervale</span>
      <h2>{state.title}</h2>
      <p>{state.message}</p>
      {state.kind === 'prompt' && <input autoFocus value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value)} onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') void confirm(); }} />}
      <div className="app-dialog-actions">
        {state.kind !== 'notice' && <button className="ghost-button" disabled={busy} onClick={onClose}>Отмена</button>}
        <button className={state.kind === 'confirm' && state.danger ? 'danger-button' : 'primary-button compact-primary'} disabled={busy || (state.kind === 'prompt' && !value.trim())} onClick={() => void confirm()}>{state.kind === 'notice' ? 'Закрыть' : state.confirmLabel}</button>
      </div>
    </section>
  </div>;
}
