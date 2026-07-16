import type { EntityKind } from '../types';

export function TextureIcon({ kind, subtype, className = '' }: { kind: EntityKind | 'terrain' | 'corpse' | 'grave'; subtype?: string; className?: string }) {
  const key = `${kind}:${subtype ?? ''}`;
  return <svg className={`texture-icon ${className}`} viewBox="0 0 32 32" aria-hidden="true">
    <rect x="1" y="1" width="30" height="30" rx="7" className="texture-icon-bg" />
    {shape(key, kind, subtype)}
  </svg>;
}

function shape(key: string, kind: EntityKind | 'terrain' | 'corpse' | 'grave', subtype?: string) {
  if (kind === 'character') return <><circle cx="16" cy="11" r="5" /><path d="M7 28c1-8 5-11 9-11s8 3 9 11" /><path className="texture-cut" d="M13 10h1m4 0h1" /></>;
  if (kind === 'travelingMerchant') return <><circle cx="16" cy="9" r="4"/><path d="M8 27c1-8 4-12 8-12s7 4 8 12"/><path d="M5 18h22v5H5z"/><circle className="texture-cut" cx="10" cy="25" r="2"/><circle className="texture-cut" cx="22" cy="25" r="2"/></>;
  if (kind === 'monster') {
    if (subtype === 'dragon') return <><path d="M4 20 11 8l5 5 5-8 7 15-6-3-6 10-6-10z"/><circle className="texture-cut" cx="20" cy="12" r="1.5" /></>;
    return <><path d="m5 25 3-15 6 4 4-8 4 8 5-4v15l-6-4-5 6-5-6z"/><circle className="texture-cut" cx="12" cy="17" r="1.5"/><circle className="texture-cut" cx="20" cy="17" r="1.5"/></>;
  }
  if (kind === 'building' || kind === 'establishment' || kind === 'settlement') return <><path d="M4 15 16 5l12 10v13H4z"/><rect className="texture-cut" x="13" y="19" width="6" height="9"/><rect className="texture-cut" x="7" y="17" width="4" height="4"/><rect className="texture-cut" x="21" y="17" width="4" height="4"/></>;
  if (kind === 'item' || kind === 'artifact') return <><path d="M6 9h20l2 7-4 12H8L4 16z"/><path className="texture-cut" d="M9 9c0-4 14-4 14 0M10 17h12"/></>;
  if (kind === 'army') return <><path d="M7 28V5l13 4-13 5"/><path d="M12 28h14l-4-7-4 3-3-6-3 4z"/></>;
  if (kind === 'cemetery' || kind === 'grave') return <><path d="M12 28V9h8v19"/><path d="M9 13h14M16 5v8"/><path className="texture-cut" d="M5 28h22"/></>;
  if (kind === 'burial' || kind === 'corpse') return <><circle cx="10" cy="17" r="4"/><path d="M14 18h12v5H14zM5 25h22"/><path className="texture-cut" d="M8 16h1m2 0h1"/></>;
  if (kind === 'dungeon') return <><path d="M5 28V11l5-6 6 6 6-6 5 6v17z"/><path className="texture-cut" d="M12 28V17h8v11M8 13h3m10 0h3"/></>;
  if (kind === 'book' || kind === 'recipe' || kind === 'productionRecipe') return <><path d="M5 6h10c2 0 3 1 3 3v18c-1-2-3-3-6-3H5z"/><path d="M27 6H17c-2 0-3 1-3 3v18c1-2 3-3 6-3h7z"/><path className="texture-cut" d="M8 11h6m-6 4h6m4-4h6m-6 4h6"/></>;
  if (kind === 'field') return <><path d="M5 27V8m7 19V8m7 19V8m7 19V8"/><path className="texture-cut" d="M3 14h26M3 21h26"/></>;
  if (kind === 'constructionProject') return <><path d="M5 27V9h22v18M9 9l7-5 7 5"/><path className="texture-cut" d="M8 15h16M8 21h16M11 9v18m10-18v18"/></>;
  if (kind === 'animalPopulation') return <><circle cx="9" cy="11" r="3"/><circle cx="16" cy="8" r="3"/><circle cx="23" cy="11" r="3"/><circle cx="16" cy="20" r="7"/></>;
  if (kind === 'ingredient') return <><path d="M16 28V12M16 17c-7 0-10-4-10-9 7 0 10 4 10 9Zm0 4c7 0 10-4 10-9-7 0-10 4-10 9Z"/></>;
  if (kind === 'kingdom' || kind === 'dynasty') return <><path d="m5 10 6 5 5-10 5 10 6-5-3 17H8z"/><path className="texture-cut" d="M9 22h14"/></>;
  if (kind === 'war') return <><path d="m7 5 18 22M25 5 7 27"/><path className="texture-cut" d="m5 9 4-4m14 0 4 4M5 23l4 4m14 0 4-4"/></>;
  if (kind === 'tradeRoute') return <><path d="M5 23c5-13 8 5 13-8s7 1 9-7"/><circle cx="5" cy="23" r="3"/><circle cx="27" cy="8" r="3"/></>;
  if (kind === 'household') return <><path d="M4 16 16 6l12 10v12H4z"/><circle className="texture-cut" cx="12" cy="20" r="3"/><circle className="texture-cut" cx="20" cy="20" r="3"/></>;
  if (kind === 'terrain') return <><path d="M2 23 10 11l6 7 5-9 9 14v7H2z"/><path className="texture-cut" d="M2 25c7-3 12 3 18 0s7 0 10-1"/></>;
  return <text x="16" y="21" textAnchor="middle" fontSize="14">{key.slice(0, 1).toUpperCase()}</text>;
}
