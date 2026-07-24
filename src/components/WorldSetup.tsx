import { useState } from 'react';
import type { WorldConfig } from '../types';
import { defaultConfig } from '../sim/generator';
import { APP_VERSION } from '../version';
import { AppIcon } from './AppIcon';

const deviceProfiles: { id: string; label: string; hint: string; config: Partial<WorldConfig> }[] = [
  { id: 'phone', label: 'Телефон', hint: 'Быстрая генерация и меньше нагрев', config: { width: 46, height: 30, settlementCount: 24, populationScale: .58, historyYears: 240, localMapSize: 96, ecologyDensity: .8, huntingPressure: .85 } },
  { id: 'standard', label: 'Стандарт', hint: 'Оптимально для iPhone 14 Pro и ноутбука', config: { width: 54, height: 34, settlementCount: 30, populationScale: .72, historyYears: 320, localMapSize: 128, ecologyDensity: 1, huntingPressure: 1 } },
  { id: 'large', label: 'Большой мир', hint: 'Больше территорий, людей и истории', config: { width: 68, height: 42, settlementCount: 42, populationScale: .92, historyYears: 480, localMapSize: 160, ecologyDensity: 1.2, huntingPressure: 1.1 } },
];

export function WorldSetup({ initial, onGenerate, onClose, onOpenSettings }: { initial?: WorldConfig; onGenerate: (config: WorldConfig) => void; onClose?: () => void; onOpenSettings: () => void }) {
  const [config, setConfig] = useState<WorldConfig>(() => ({ ...(initial ?? defaultConfig), seed: randomWorldSeed() }));
  const [selectedProfile, setSelectedProfile] = useState('standard');
  const set = <K extends keyof WorldConfig>(key: K, value: WorldConfig[K]) => setConfig(current => ({ ...current, [key]: value }));
  const applyProfile = (id: string, profile: Partial<WorldConfig>) => { setSelectedProfile(id); setConfig(current => ({ ...current, ...profile })); };

  return <div className="setup-screen">
    <aside className="setup-art">
      <div className="setup-brand"><div className="crest-mark">E</div><div><p>СИМУЛЯТОР ЖИВОГО МИРА</p><h1>Eldervale</h1></div></div>
      <span>Создай мир, который проживёт века по единым законам. Здесь города, знания и государства возникают из решений живых людей.</span>
      <div className="setup-preview" aria-label="Сводка будущего мира">
        <div className="setup-preview-map"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
        <div className="setup-preview-copy"><small>Будущая хроника</small><strong>{config.historyYears} лет причинной истории</strong><span>{config.settlementCount} поселений · карта {config.width}×{config.height}</span></div>
      </div>
      <div className="setup-preview-grid"><span><b>{config.kingdomCount}</b> исходных держав</span><span><b>{Math.round(config.populationScale * 100)}%</b> масштаб населения</span><span><b>{Math.round(config.magic * 100)}%</b> насыщенность магией</span></div>
    </aside>

    <div className="setup-panel">
      <div className="setup-heading">
        <div><span className="eyebrow">Создание мира</span><h2>Настрой первую эпоху</h2></div>
        <div className="setup-heading-actions"><button className="icon-button" onClick={onOpenSettings} aria-label="Открыть настройки"><AppIcon name="settings" /></button>{onClose && <button className="icon-button" onClick={onClose} aria-label="Закрыть создание мира"><AppIcon name="close" /></button>}</div>
      </div>

      <div className="profile-grid">
        {deviceProfiles.map(profile => <button className={selectedProfile === profile.id ? 'selected' : ''} aria-pressed={selectedProfile === profile.id} key={profile.id} onClick={() => applyProfile(profile.id, profile.config)}>
          <AppIcon name={profile.id === 'phone' ? 'device' : 'world'} /><span><strong>{profile.label}</strong><small>{profile.hint}</small></span>{selectedProfile === profile.id && <i>Выбран</i>}
        </button>)}
      </div>

      <div className="seed-field-row">
        <label className="field compact-field"><span>Ключ мира</span><input value={config.seed} onChange={e => set('seed', e.target.value)} /></label>
        <button type="button" onClick={() => set('seed', randomWorldSeed())}><AppIcon name="spark" />Новый ключ</button>
      </div>

      <div className="field-grid primary-settings">
        <Range label="Лет истории" value={config.historyYears} min={80} max={800} step={20} onChange={v => set('historyYears', v)} />
        <Range label="Государств" value={config.kingdomCount} min={3} max={10} onChange={v => set('kingdomCount', v)} />
        <Range label="Поселений" value={config.settlementCount} min={14} max={52} step={2} onChange={v => set('settlementCount', v)} />
        <Range label="Население" value={config.populationScale} min={0.35} max={1.4} step={0.05} onChange={v => set('populationScale', v)} />
      </div>

      <details className="advanced-settings">
        <summary>Дополнительные настройки</summary>
        <div className="field-grid">
          <Range label="Ширина карты" value={config.width} min={38} max={80} step={2} onChange={v => set('width', v)} />
          <Range label="Высота карты" value={config.height} min={24} max={50} step={2} onChange={v => set('height', v)} />
          <Range label="Магия" value={config.magic} min={0.05} max={1} step={0.05} onChange={v => set('magic', v)} />
          <Range label="Воинственность" value={config.warlike} min={0.05} max={1} step={0.05} onChange={v => set('warlike', v)} />
          <Range label="Монстры" value={config.monsterDensity} min={0.4} max={2} step={0.1} onChange={v => set('monsterDensity', v)} />
          <Range label="Артефакты" value={config.artifactDensity} min={0.4} max={2} step={0.1} onChange={v => set('artifactDensity', v)} />
          <Range label="Размер локальной карты" value={config.localMapSize} min={96} max={160} step={32} onChange={v => set('localMapSize', v as 96 | 128 | 160)} />
          <Range label="Плотность экологии" value={config.ecologyDensity} min={0.5} max={1.6} step={0.1} onChange={v => set('ecologyDensity', v)} />
          <Range label="Интенсивность охоты" value={config.huntingPressure} min={0.5} max={1.6} step={0.1} onChange={v => set('huntingPressure', v)} />
        </div>
      </details>

      <div className="preset-row">
        <button onClick={() => setConfig({ ...defaultConfig, seed: `Эпоха-войн-${Date.now()}`, warlike: .9, monsterDensity: 1.1 })}>Эпоха войн</button>
        <button onClick={() => setConfig({ ...defaultConfig, seed: `Век-драконов-${Date.now()}`, monsterDensity: 1.8, magic: .65 })}>Век драконов</button>
        <button onClick={() => setConfig({ ...defaultConfig, seed: `Тихие-королевства-${Date.now()}`, warlike: .18, monsterDensity: .5 })}>Тихие королевства</button>
      </div>

      <button className="primary-button" onClick={() => onGenerate({ ...config, seed: config.seed.trim() || randomWorldSeed() })}>Сотворить Eldervale <AppIcon name="chevron" /></button>
      <p className="setup-note">Каждый житель получает имя и собственную запись жизни. Животные существуют популяциями, природные ресурсы восстанавливаются по сезонам, а локальная карта каждого квадрата имеет размер {config.localMapSize}×{config.localMapSize}. Версия приложения: {APP_VERSION}.</p>
    </div>
  </div>;
}

function Range({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label className="range-field"><span>{label}<strong>{Number.isInteger(value) ? value : value.toFixed(2)}</strong></span><input type="range" value={value} min={min} max={max} step={step} onChange={e => onChange(Number(e.target.value))} /></label>;
}

function randomWorldSeed(): string {
  const time = Date.now().toString(36);
  const entropy = Math.floor(Math.random() * 0xFFFFFF).toString(36).padStart(5, '0');
  return `Eldervale-${time}-${entropy}`;
}
