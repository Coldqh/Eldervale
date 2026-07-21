import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppHeader } from "../components/layout/AppHeader";
import { ScreenShell } from "../components/layout/ScreenShell";
import { Icon } from "../components/ui/Icon";
import { useCareerLibrary } from "../state/CareerLibraryProvider";
import { downloadBlob } from "../utils/downloadBlob";

const potentialLabels = {
  "role-player": "Role player",
  starter: "Starter ceiling",
  "high-upside": "High upside",
  "national-ceiling": "National ceiling",
} as const;

export default function CareerLibraryScreen() {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const { careers, loading, error, removeCareer, importCareer, exportCareer } = useCareerLibrary();
  const [busyCareer, setBusyCareer] = useState<string>();
  const [message, setMessage] = useState<string>();

  async function handleDelete(careerId: string) {
    if (!window.confirm("Удалить карьеру и все её резервные снимки?")) {
      return;
    }
    setBusyCareer(careerId);
    setMessage(undefined);
    try {
      await removeCareer(careerId);
    } finally {
      setBusyCareer(undefined);
    }
  }

  async function handleExport(careerId: string) {
    setBusyCareer(careerId);
    setMessage(undefined);
    try {
      const blob = await exportCareer(careerId);
      downloadBlob(blob, `prospect-career-${careerId.slice(0, 8)}.json`);
      setMessage("Карьера экспортирована.");
    } catch {
      setMessage("Экспорт не удался.");
    } finally {
      setBusyCareer(undefined);
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) {
      return;
    }
    setMessage(undefined);
    try {
      const save = await importCareer(file);
      navigate(`/career/${save.meta.id}`);
    } catch (caught) {
      console.error(caught);
      setMessage("Файл не является совместимым сохранением PROSPECT.");
    } finally {
      if (fileInput.current) {
        fileInput.current.value = "";
      }
    }
  }

  return (
    <ScreenShell header={<AppHeader />}>
      <section className="landing-hero">
        <div className="landing-hero__grid" />
        <div className="landing-hero__topline"><span>CAREER LIFE SIMULATOR</span><em>BUILD {__APP_VERSION__}</em></div>
        <div className="landing-hero__copy">
          <span className="eyebrow">AMERICAN FOOTBALL // ORIGIN</span>
          <h1>Талант даёт шанс.<br />Дальше решаешь ты.</h1>
          <p>Последний школьный сезон. Место в составе. Учёба. Тело. Люди. Первый выбор колледжа.</p>
          <div className="landing-hero__actions">
            <Link className="button button--primary button--launch" to="/new">Создать спортсмена <Icon name="arrow-right" /></Link>
            <button className="button button--ghost" onClick={() => fileInput.current?.click()}><Icon name="upload" /> Импорт</button>
          </div>
        </div>
        <div className="landing-hero__number">01</div>
        <div className="landing-hero__metrics">
          <span><small>SIMULATION</small><strong>Seeded</strong></span>
          <span><small>SAVE SYSTEM</small><strong>IndexedDB</strong></span>
          <span><small>MODE</small><strong>Offline PWA</strong></span>
        </div>
      </section>

      <input ref={fileInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void handleImport(event.target.files?.[0])} />

      <section className="library-section">
        <header className="library-heading">
          <div><span className="eyebrow">LOCAL CAREERS</span><h2>Твои истории</h2></div>
          <div className="library-count"><strong>{String(careers.length).padStart(2, "0")}</strong><span>CAREERS</span></div>
        </header>

        {message && <div className="inline-message">{message}</div>}
        {error && <div className="inline-message inline-message--error">{error}</div>}

        {loading ? (
          <div className="library-loading"><i /><span>Читаем локальные сохранения</span></div>
        ) : careers.length === 0 ? (
          <div className="empty-career">
            <div className="empty-career__mark"><Icon name="football" size={36} /></div>
            <div><small>NO ACTIVE PROSPECTS</small><h3>Создай первого спортсмена</h3><p>Происхождение, позиция, архетип, характер и школа будут созданы в одном постоянном мире.</p></div>
            <Link className="button button--primary" to="/new">Начать <Icon name="arrow-right" /></Link>
          </div>
        ) : (
          <div className="career-gallery">
            {careers.map((career, index) => (
              <article className="career-file" key={career.id}>
                <button className="career-file__open" onClick={() => navigate(`/career/${career.id}`)} disabled={busyCareer === career.id}>
                  <div className="career-file__top"><span>PRSPCT-{String(index + 1).padStart(3, "0")}</span><em>{career.stateCode}</em></div>
                  <div className="career-file__player">
                    <span className="career-file__position">{career.position}</span>
                    <div><small>#{String(career.jerseyNumber).padStart(2, "0")}</small><h3>{career.displayName}</h3><p>{career.schoolName}</p></div>
                    <strong>{career.overall}<small>OVR</small></strong>
                  </div>
                  <div className="career-file__meta">
                    <span><small>CEILING</small><strong>{potentialLabels[career.potentialBand]}</strong></span>
                    <span><small>PHASE</small><strong>Senior preseason</strong></span>
                  </div>
                  <div className="career-file__resume">Продолжить карьеру <Icon name="arrow-right" /></div>
                </button>
                <div className="career-file__actions">
                  <button aria-label="Экспортировать карьеру" onClick={() => void handleExport(career.id)}><Icon name="download" size={18} /></button>
                  <button aria-label="Удалить карьеру" onClick={() => void handleDelete(career.id)}><Icon name="trash" size={18} /></button>
                </div>
              </article>
            ))}
            <Link className="career-add" to="/new"><span><Icon name="spark" /></span><strong>Новая карьера</strong><small>Сгенерировать другой путь</small></Link>
          </div>
        )}
      </section>

      <section className="system-deck">
        <article><span>01</span><Icon name="database" /><strong>Локально</strong><p>Несколько карьер, экспорт, импорт и резервные снимки.</p></article>
        <article><span>02</span><Icon name="spark" /><strong>Детерминированно</strong><p>Один seed сохраняет личность мира между загрузками.</p></article>
        <article><span>03</span><Icon name="shield" /><strong>Без сервера</strong><p>PWA работает после первой загрузки и не требует аккаунта.</p></article>
      </section>
    </ScreenShell>
  );
}
