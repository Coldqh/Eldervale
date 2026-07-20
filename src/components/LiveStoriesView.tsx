import { useMemo } from 'react';
import type { EntityRef, WorldState } from '../types';
import { professionLabel } from '../i18n';
import { buildCharacterStory } from '../lib/liveStories';
import type { CharacterLifePlan, CharacterStoryEvent, CharacterStorySnapshot } from '../liveStoriesTypes';
import './liveStories.css';

export function LiveStoriesView({
  world, watchedCharacterIds, busy, onSelect, onToggleWatch, onAdvanceCharacter,
}: {
  world: WorldState;
  watchedCharacterIds: number[];
  busy: boolean;
  onSelect: (ref: EntityRef) => void;
  onToggleWatch: (characterId: number) => void;
  onAdvanceCharacter: (characterId: number) => void;
}) {
  const stories = useMemo(() => watchedCharacterIds
    .map(id => buildCharacterStory(world, id))
    .filter((story): story is CharacterStorySnapshot => Boolean(story)), [world, watchedCharacterIds]);
  const suggested = useMemo(() => [...world.characters]
    .filter(character => character.alive && !watchedCharacterIds.includes(character.id))
    .sort((a, b) => b.renown - a.renown || (b.mind?.goals[0]?.priority ?? 0) - (a.mind?.goals[0]?.priority ?? 0) || a.id - b.id)
    .slice(0, 6), [world, watchedCharacterIds]);

  return <section className="workspace-view live-stories-workspace scrollable-tab">
    <div className="workspace-heading live-stories-heading"><div><span className="eyebrow">Живые истории</span><h1>Судьбы, за которыми ты следишь</h1></div><p>Цель, текущий шаг, препятствия и события конкретных людей. Мир не подчиняется игроку — ты наблюдаешь, чем заканчиваются их решения.</p></div>
    {stories.length === 0 ? <div className="window-card live-stories-empty">
      <strong>Пока никто не выбран</strong><p>Открой карточку жителя и нажми «Следить», либо выбери одну из заметных фигур мира.</p>
      <div className="story-suggestions">{suggested.map(character => <button key={character.id} onClick={() => onToggleWatch(character.id)}><span>{character.name}</span><small>{professionLabel(character.profession)} · известность {Math.round(character.renown)}</small></button>)}</div>
    </div> : <div className="live-story-grid">{stories.map(story => <StoryCard key={story.characterId} story={story} world={world} busy={busy} onSelect={onSelect} onToggleWatch={onToggleWatch} onAdvanceCharacter={onAdvanceCharacter} />)}</div>}
  </section>;
}

export function CharacterStoryPanel({
  world, characterId, watched, busy, onToggleWatch, onAdvanceCharacter, onSelect,
}: {
  world: WorldState;
  characterId: number;
  watched: boolean;
  busy: boolean;
  onToggleWatch: (characterId: number) => void;
  onAdvanceCharacter: (characterId: number) => void;
  onSelect: (ref: EntityRef) => void;
}) {
  const story = useMemo(() => buildCharacterStory(world, characterId, 10), [world, characterId]);
  if (!story) return null;
  return <section className="character-story-panel">
    <div className="character-story-actions"><button className={watched ? 'story-watch-button active' : 'story-watch-button'} onClick={() => onToggleWatch(characterId)}>{watched ? '✓ Под наблюдением' : '＋ Следить за судьбой'}</button><button className="story-advance-button" disabled={busy || !story.alive} onClick={() => onAdvanceCharacter(characterId)}>До личного события ›</button></div>
    <PlanBlock plan={story.plan} compact />
    {!story.alive && <BiographyBlock story={story} onSelect={onSelect} compact />}
  </section>;
}

function StoryCard({ story, world, busy, onSelect, onToggleWatch, onAdvanceCharacter }: {
  story: CharacterStorySnapshot;
  world: WorldState;
  busy: boolean;
  onSelect: (ref: EntityRef) => void;
  onToggleWatch: (characterId: number) => void;
  onAdvanceCharacter: (characterId: number) => void;
}) {
  const settlement = story.settlementId ? world.settlements.find(item => item.id === story.settlementId) : undefined;
  return <article className={story.alive ? 'window-card live-story-card' : 'window-card live-story-card ended'}>
    <header><button className="story-character-link" onClick={() => onSelect({ kind: 'character', id: story.characterId })}><span className="story-status-dot" /><span><strong>{story.name}</strong><small>{professionLabel(story.profession)}{settlement ? ` · ${settlement.name}` : ''}</small></span></button><button className="story-remove-button" onClick={() => onToggleWatch(story.characterId)}>×</button></header>
    <PlanBlock plan={story.plan} />
    <div className="story-card-actions"><button disabled={busy || !story.alive} onClick={() => onAdvanceCharacter(story.characterId)}>До следующего личного события</button><button onClick={() => onSelect({ kind: 'character', id: story.characterId })}>Открыть карточку</button></div>
    {story.timeline.length > 0 && <section className="story-timeline"><h3>Последние главы</h3>{story.timeline.slice(0, 7).map(event => <StoryEventRow key={event.key} event={event} onSelect={onSelect} />)}</section>}
    {!story.alive && <BiographyBlock story={story} onSelect={onSelect} />}
  </article>;
}

function PlanBlock({ plan, compact = false }: { plan: CharacterLifePlan; compact?: boolean }) {
  return <section className={compact ? 'story-plan compact' : 'story-plan'}>
    <div className="story-plan-heading"><span><small>Главный план</small><strong>{plan.title}</strong></span><b>{plan.progress}%</b></div>
    <div className="story-plan-progress"><i style={{ width: `${plan.progress}%` }} /></div>
    <p><b>Сейчас:</b> {plan.currentStage}</p><p><b>Следующий шаг:</b> {plan.nextAction}</p>
    {!compact && <div className="story-plan-steps">{plan.completedSteps.map(step => <span className="done" key={step}>✓ {step}</span>)}{plan.remainingSteps.slice(0, 3).map((step, index) => <span className={index === 0 ? 'current' : ''} key={step}>{index === 0 ? '→' : '·'} {step}</span>)}</div>}
    {plan.blockers.length > 0 && <div className="story-blockers"><b>Мешает:</b>{plan.blockers.map(item => <span key={item}>{item}</span>)}</div>}
  </section>;
}

function StoryEventRow({ event, onSelect }: { event: CharacterStoryEvent; onSelect: (ref: EntityRef) => void }) {
  const target = event.refs.find(ref => ref.kind !== 'character') ?? event.refs[0];
  return <button className={`story-event source-${event.source}`} onClick={() => target && onSelect(target)}><time>{event.year}.{String(event.month).padStart(2, '0')}</time><span><strong>{event.title}</strong><small>{event.description}</small></span></button>;
}

function BiographyBlock({ story, onSelect, compact = false }: { story: CharacterStorySnapshot; onSelect: (ref: EntityRef) => void; compact?: boolean }) {
  return <section className={compact ? 'story-biography compact' : 'story-biography'}><span className="eyebrow">Итог жизни</span><h3>{story.biography.years}</h3><p>{story.biography.summary}</p>{!compact && <><div className="story-biography-columns"><div><b>Главные следы</b>{story.biography.milestones.map(item => <span key={item}>{item}</span>)}</div><div><b>Наследие</b>{story.biography.legacy.map(item => <span key={item}>{item}</span>)}</div></div><div className="story-relative-links">{story.biography.relativeRefs.slice(0, 8).map(ref => <button key={ref.id} onClick={() => onSelect(ref)}>Родственник #{ref.id}</button>)}{story.biography.burialRef && <button onClick={() => onSelect(story.biography.burialRef!)}>Место погребения</button>}</div></>}</section>;
}
