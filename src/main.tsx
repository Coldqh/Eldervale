import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { APP_VERSION } from './version';
import { initializePwaInstall } from './lib/pwaInstall';

class AppErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Eldervale остановлен ошибкой интерфейса', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="fatal-screen">
      <div className="fatal-card">
        <div className="loading-sigil">!</div>
        <span className="eyebrow">Ошибка запуска</span>
        <h1>Eldervale не смог открыть интерфейс</h1>
        <p>Сохранённый мир не удалён. Очисти старый кэш приложения и загрузи текущую версию.</p>
        <a className="primary-button fatal-action" href={`${import.meta.env.BASE_URL}repair.html?ошибка=${Date.now()}`}>Восстановить приложение <b>→</b></a>
        <small>Версия {APP_VERSION}</small>
      </div>
    </main>;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Корневой элемент приложения не найден');

initializePwaInstall();
createRoot(root).render(<StrictMode><AppErrorBoundary><App /></AppErrorBoundary></StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).then(async registration => {
      void registration.update();
      const ready = await navigator.serviceWorker.ready;
      ready.active?.postMessage({ type: 'ПОДГОТОВИТЬ_ОФЛАЙН' });
      window.setInterval(() => { void registration.update(); }, 5 * 60 * 1000);
    }).catch(error => console.warn('Service Worker не зарегистрирован', error));
  });
}
