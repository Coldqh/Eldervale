import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorldState } from '../types';

const STORAGE_PREFIX = 'eldervale-watched-characters:';
const MAX_WATCHED = 24;

export function useWatchedCharacters(world: WorldState | undefined, scope?: string) {
  const storageKey = useMemo(() => world ? `${STORAGE_PREFIX}${scope ?? world.config.seed}` : undefined, [scope, world?.config.seed]);
  const [ids, setIds] = useState<number[]>([]);

  useEffect(() => {
    if (!storageKey || !world) { setIds([]); return; }
    let loaded: number[] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      if (Array.isArray(parsed)) loaded = parsed.filter(value => Number.isInteger(value) && value > 0);
    } catch { /* Повреждённая пользовательская настройка не должна мешать открыть мир. */ }
    const known = new Set([
      ...world.characters.map(character => character.id),
      ...world.burials.filter(item => item.subjectKind === 'character' && item.subjectId).map(item => item.subjectId!),
    ]);
    setIds([...new Set(loaded)].filter(id => known.has(id)).slice(0, MAX_WATCHED));
  }, [storageKey, world]);

  const persist = useCallback((next: number[]) => {
    setIds(next);
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Наблюдение останется до перезагрузки. */ }
  }, [storageKey]);

  const toggle = useCallback((characterId: number) => {
    const next = ids.includes(characterId)
      ? ids.filter(id => id !== characterId)
      : [characterId, ...ids].slice(0, MAX_WATCHED);
    persist(next);
  }, [ids, persist]);

  const isWatched = useCallback((characterId: number) => ids.includes(characterId), [ids]);
  return { ids, toggle, isWatched };
}
