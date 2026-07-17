import type { WorldState } from '../types';
import { DAY_PHASES, dayPhaseLabel, personalEventsForCharacter, routineForCharacter } from '../sim/dailyLife';
import '../dailyLife.css';

export function PersonalLifePanel({ world, characterId }: { world: WorldState; characterId: number }) {
  const character = world.characters.find(item => item.id === characterId);
  if (!character) return null;
  const routine = routineForCharacter(world, character);
  const events = personalEventsForCharacter(world, characterId);

  return <section className="personal-life-panel">
    <div className="personal-life-heading">
      <div><span className="eyebrow">Повседневная жизнь</span><h3>Обычный день</h3></div>
      <small>{routine.year}.{String(routine.month).padStart(2, '0')}</small>
    </div>
    <div className="daily-routine-grid">
      {DAY_PHASES.map(phase => {
        const stop = routine.stops.find(item => item.phase === phase);
        return <div key={phase} className={`daily-routine-stop phase-${phase}`}>
          <span>{dayPhaseLabel(phase)}</span>
          <strong>{stop?.activity ?? 'нет записи'}</strong>
          <small>{stop?.placeLabel ?? 'место неизвестно'}</small>
        </div>;
      })}
    </div>
    <div className="personal-life-feed">
      <h3>Личные события</h3>
      {events.length === 0 && <p className="personal-life-empty">Пока в личной памяти нет заметных бытовых событий.</p>}
      {events.map(event => {
        const isOther = event.characterId !== characterId;
        const owner = isOther ? world.characters.find(item => item.id === event.characterId)?.name : undefined;
        return <article key={event.id} className={`personal-life-event importance-${event.importance}`}>
          <time>{event.year}.{String(event.month).padStart(2, '0')} · {dayPhaseLabel(event.phase).toLowerCase()}</time>
          <strong>{event.title}</strong>
          <p>{event.description}</p>
          {owner && <small>Событие записано со стороны: {owner}</small>}
        </article>;
      })}
    </div>
  </section>;
}
