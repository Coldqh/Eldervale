import { useState } from 'react';
import type { WorldConfig } from '../types';
import { defaultConfig } from '../sim/generator';

export function WorldSetup({ initial, onGenerate, onClose }: { initial?: WorldConfig; onGenerate: (config: WorldConfig) => void; onClose?: () => void }) {
  const [config, setConfig] = useState<WorldConfig>(initial ?? defaultConfig);
  const set = <K extends keyof WorldConfig>(key: K, value: WorldConfig[K]) => setConfig(current => ({ ...current, [key]: value }));
  return <div className="setup-screen">
    <div className="setup-art"><div className="crest-mark">E</div><p>THE LIVING WORLD SIMULATOR</p><h1>Eldervale</h1><span>Королевства рождаются. Драконы жгут города. Люди оставляют книги, детей, долги и могилы.</span></div>
    <div className="setup-panel">
      <div className="setup-heading"><div><span className="eyebrow">Создание мира</span><h2>Настрой первую эпоху</h2></div>{onClose && <button className="icon-button" onClick={onClose}>×</button>}</div>
      <label className="field"><span>Seed мира</span><input value={config.seed} onChange={e => set('seed', e.target.value)} /></label>
      <div className="field-grid">
        <Range label="Лет истории" value={config.historyYears} min={80} max={800} step={20} onChange={v => set('historyYears', v)} />
        <Range label="Государств" value={config.kingdomCount} min={3} max={10} onChange={v => set('kingdomCount', v)} />
        <Range label="Поселений" value={config.settlementCount} min={14} max={48} step={2} onChange={v => set('settlementCount', v)} />
        <Range label="Население" value={config.populationScale} min={0.35} max={1.4} step={0.05} onChange={v => set('populationScale', v)} />
        <Range label="Магия" value={config.magic} min={0.05} max={1} step={0.05} onChange={v => set('magic', v)} />
        <Range label="Воинственность" value={config.warlike} min={0.05} max={1} step={0.05} onChange={v => set('warlike', v)} />
        <Range label="Монстры" value={config.monsterDensity} min={0.4} max={2} step={0.1} onChange={v => set('monsterDensity', v)} />
        <Range label="Артефакты" value={config.artifactDensity} min={0.4} max={2} step={0.1} onChange={v => set('artifactDensity', v)} />
      </div>
      <div className="preset-row">
        <button onClick={() => setConfig({ ...defaultConfig, seed: `Age-of-Wars-${Date.now()}`, warlike: .9, monsterDensity: 1.1 })}>Эпоха войн</button>
        <button onClick={() => setConfig({ ...defaultConfig, seed: `Dragon-Age-${Date.now()}`, monsterDensity: 1.8, magic: .65 })}>Век драконов</button>
        <button onClick={() => setConfig({ ...defaultConfig, seed: `Quiet-Realm-${Date.now()}`, warlike: .18, monsterDensity: .5 })}>Тихие королевства</button>
      </div>
      <button className="primary-button" onClick={() => onGenerate(config)}>Сотворить Eldervale <span>→</span></button>
      <p className="setup-note">Каждый житель получает имя и запись жизни. Большие миры сильнее нагружают мобильный браузер.</p>
    </div>
  </div>;
}

function Range({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label className="range-field"><span>{label}<strong>{Number.isInteger(value) ? value : value.toFixed(2)}</strong></span><input type="range" value={value} min={min} max={max} step={step} onChange={e => onChange(Number(e.target.value))} /></label>;
}
