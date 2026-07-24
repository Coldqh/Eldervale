import { useMemo, useState } from 'react';
import { countries, getPropertiesForRegion, getRegionsForCountry } from '../../data/catalog';
import { STARTING_CASH, type GameMode, type NewGameSelection, type PropertyDefinition } from '../../domain/game';

interface OnboardingProps {
  onComplete: (selection: NewGameSelection) => void;
}

type Step = 'identity' | 'region' | 'property' | 'review';

const stepOrder: Step[] = ['identity', 'region', 'property', 'review'];

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>('identity');
  const [companyName, setCompanyName] = useState('');
  const [mode, setMode] = useState<GameMode>('standard');
  const [countryId, setCountryId] = useState(countries[0]?.id ?? '');
  const availableRegions = useMemo(() => getRegionsForCountry(countryId), [countryId]);
  const [regionId, setRegionId] = useState('');
  const selectedRegionId = regionId || availableRegions[0]?.id || '';
  const availableProperties = useMemo(() => getPropertiesForRegion(selectedRegionId), [selectedRegionId]);
  const [propertyId, setPropertyId] = useState('');
  const selectedProperty = availableProperties.find((item) => item.id === propertyId) ?? availableProperties[0];
  const selectedCountry = countries.find((country) => country.id === countryId);
  const selectedRegion = availableRegions.find((region) => region.id === selectedRegionId);
  const stepIndex = stepOrder.indexOf(step);

  function goNext() {
    const next = stepOrder[stepIndex + 1];
    if (next) setStep(next);
  }

  function goBack() {
    const previous = stepOrder[stepIndex - 1];
    if (previous) setStep(previous);
  }

  function finish() {
    if (!selectedProperty) return;
    onComplete({ companyName, mode, countryId, regionId: selectedRegionId, property: selectedProperty });
  }

  return (
    <div className="onboarding-shell">
      <aside className="onboarding-showcase">
        <img src="./art/bar.svg" alt="Премиальный бар с коктейльной стойкой" />
        <div className="onboarding-showcase-copy">
          <span>Drink Company</span>
          <h1>Построй дом напитков, которому принадлежат производство, бренды и лучшие бары города.</h1>
          <p>Один физический рынок. Реальные партии, поставки, полки, коктейли и деньги.</p>
        </div>
      </aside>
      <main className="onboarding">
      <header className="brand-header">
        <div className="brand-mark">DC</div>
        <div>
          <span className="eyebrow">рабочее название</span>
          <h1>Drink Company</h1>
        </div>
      </header>

      <div className="step-meter" aria-label={`Шаг ${stepIndex + 1} из ${stepOrder.length}`}>
        {stepOrder.map((item, index) => <span key={item} className={index <= stepIndex ? 'active' : ''} />)}
      </div>

      {step === 'identity' && (
        <section className="panel stack">
          <div>
            <span className="eyebrow">Шаг 1</span>
            <h2>Создай компанию</h2>
            <p className="muted">Название игры поменяем позже. Здесь ты называешь собственное предприятие.</p>
          </div>
          <label className="field">
            <span>Название компании</span>
            <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Например, North Glass" maxLength={32} />
          </label>
          <div className="choice-grid">
            <button className={`choice ${mode === 'standard' ? 'selected' : ''}`} onClick={() => setMode('standard')}>
              <strong>Стандарт</strong>
              <span>Можно восстановиться после ошибок</span>
              <b>{STARTING_CASH.standard.toLocaleString('ru-RU')} стартового капитала</b>
            </button>
            <button className={`choice ${mode === 'roguelike' ? 'selected' : ''}`} onClick={() => setMode('roguelike')}>
              <strong>Жёсткий режим</strong>
              <span>Банкротство завершает компанию</span>
              <b>{STARTING_CASH.roguelike.toLocaleString('ru-RU')} стартового капитала</b>
            </button>
          </div>
        </section>
      )}

      {step === 'region' && (
        <section className="panel stack">
          <div>
            <span className="eyebrow">Шаг 2</span>
            <h2>Выбери рынок</h2>
            <p className="muted">Спрос виден частично. Реальная реакция точек появится после образцов и переговоров.</p>
          </div>
          <div className="segmented">
            {countries.map((country) => (
              <button key={country.id} className={countryId === country.id ? 'active' : ''} onClick={() => { setCountryId(country.id); setRegionId(''); setPropertyId(''); }}>
                {country.name}
              </button>
            ))}
          </div>
          <div className="choice-grid">
            {availableRegions.map((region) => (
              <button key={region.id} className={`choice ${selectedRegionId === region.id ? 'selected' : ''}`} onClick={() => { setRegionId(region.id); setPropertyId(''); }}>
                <strong>{region.name}</strong>
                <span>{region.climateLabel}</span>
                <b>{region.demandLabel}</b>
                <small>Пиво {region.beerAffinity}/5 · Сидр {region.ciderAffinity}/5</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 'property' && (
        <section className="panel stack">
          <div>
            <span className="eyebrow">Шаг 3</span>
            <h2>Выбери объект</h2>
            <p className="muted">Решение важное, но быстрое. Объект задаёт расходы, объём и доступ к рынку.</p>
          </div>
          <div className="choice-grid">
            {availableProperties.map((property) => (
              <PropertyCard key={property.id} property={property} selected={selectedProperty?.id === property.id} onSelect={() => setPropertyId(property.id)} />
            ))}
          </div>
        </section>
      )}

      {step === 'review' && selectedProperty && (
        <section className="panel stack">
          <div>
            <span className="eyebrow">Шаг 4</span>
            <h2>Проверь старт</h2>
          </div>
          <dl className="review-list">
            <div><dt>Компания</dt><dd>{companyName || 'Без названия'}</dd></div>
            <div><dt>Режим</dt><dd>{mode === 'standard' ? 'Стандарт' : 'Жёсткий'}</dd></div>
            <div><dt>Регион</dt><dd>{selectedCountry?.name}, {selectedRegion?.name}</dd></div>
            <div><dt>Объект</dt><dd>{selectedProperty.name}</dd></div>
            <div><dt>Останется</dt><dd>{(STARTING_CASH[mode] - selectedProperty.upfrontCost).toLocaleString('ru-RU')}</dd></div>
            <div><dt>Расход в день</dt><dd>{selectedProperty.dailyCost.toLocaleString('ru-RU')}</dd></div>
          </dl>
          <div className="warning-card">
            <strong>Главный риск — сбыт</strong>
            <p>Объект и оборудование не гарантируют покупателей. Бары и магазины будут оценивать продукт по собственным требованиям.</p>
          </div>
        </section>
      )}

      <footer className="onboarding-actions">
        {stepIndex > 0 ? <button className="secondary" onClick={goBack}>Назад</button> : <span />}
        {step !== 'review' ? (
          <button className="primary" onClick={goNext} disabled={step === 'identity' && companyName.trim().length < 2}>Продолжить</button>
        ) : (
          <button className="primary" onClick={finish} disabled={!selectedProperty || companyName.trim().length < 2}>Открыть компанию</button>
        )}
      </footer>
      </main>
    </div>
  );
}

function PropertyCard({ property, selected, onSelect }: { property: PropertyDefinition; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`choice property-card ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <strong>{property.name}</strong>
      <span>{property.acquisition === 'buy' ? 'Покупка' : 'Аренда'} · {property.upfrontCost.toLocaleString('ru-RU')} сразу</span>
      <b>{property.summary}</b>
      <div className="stat-row">
        <small>Объём {property.capacity}/5</small>
        <small>Энергия {property.energyLimit}/5</small>
        <small>Рынок {property.marketAccess}/5</small>
      </div>
    </button>
  );
}
