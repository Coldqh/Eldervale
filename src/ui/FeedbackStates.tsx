import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './Icon';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Ошибка интерфейса Drink Company', error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-state">
        <div className="fatal-state-card">
          <span className="fatal-state-icon"><Icon name="warning" /></span>
          <span className="eyebrow">Интерфейс остановлен</span>
          <h1>Не удалось открыть текущий экран</h1>
          <p>Сохранение осталось в браузере. Перезагрузи приложение, чтобы восстановить интерфейс.</p>
          <button className="button primary" onClick={() => window.location.reload()}>Перезагрузить</button>
        </div>
      </main>
    );
  }
}

export function AppSkeleton() {
  return (
    <div className="skeleton-shell" aria-label="Загрузка приложения" aria-busy="true">
      <aside className="skeleton-rail"><i /><span /><span /><span /><span /></aside>
      <main className="skeleton-stage">
        <header><i /><span /></header>
        <section className="skeleton-visual"><i /><span /><span /></section>
        <section className="skeleton-grid"><article /><article /><article /></section>
      </main>
    </div>
  );
}
