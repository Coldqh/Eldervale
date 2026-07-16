import type { LocalFeature, LocalGround, LocalMarker, Terrain } from '../types';

const terrainBase: Record<Terrain, string> = {
  ocean: '#17313d', coast: '#557873', plains: '#72895d', forest: '#355d43', hills: '#756d50', mountains: '#6e716f', marsh: '#3f685c', desert: '#a1895c', tundra: '#89958f',
};
const localBase: Record<LocalGround, string> = {
  grass: '#617853', dirt: '#745e43', sand: '#a58a5f', water: '#244d59', mud: '#4b5d50', snow: '#aeb7b3', stone: '#656862', road: '#8a7352', floor: '#8c7c64', ash: '#423f3a',
};

export function terrainColor(terrain: Terrain): string { return terrainBase[terrain]; }
export function localGroundColor(ground: LocalGround): string { return localBase[ground]; }

export function paintGlobalTile(ctx: CanvasRenderingContext2D, terrain: Terrain, x: number, y: number, size: number, seed: number, tint?: string) {
  ctx.fillStyle = tint ?? terrainBase[terrain];
  ctx.fillRect(x, y, Math.ceil(size + .4), Math.ceil(size + .4));
  if (size < 5) return;
  const h = hash(seed);
  ctx.save();
  ctx.globalAlpha = tint ? .12 : .18;
  ctx.strokeStyle = terrain === 'ocean' || terrain === 'coast' ? '#b6d8d3' : terrain === 'desert' ? '#e0c88b' : '#e7e0b8';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = Math.max(.5, size * .035);
  if (terrain === 'ocean' || terrain === 'coast') {
    for (let i = 0; i < 2; i += 1) {
      const yy = y + size * (.32 + i * .3) + ((h >> (i * 3)) & 3) - 1.5;
      ctx.beginPath(); ctx.moveTo(x + size * .12, yy); ctx.quadraticCurveTo(x + size * .5, yy - size * .12, x + size * .88, yy); ctx.stroke();
    }
  } else if (terrain === 'forest') {
    for (let i = 0; i < 3; i += 1) {
      const px = x + size * (.22 + ((h >> (i * 4)) & 7) / 13);
      const py = y + size * (.25 + ((h >> (i * 5 + 2)) & 7) / 14);
      ctx.beginPath(); ctx.moveTo(px, py - size * .12); ctx.lineTo(px + size * .1, py + size * .09); ctx.lineTo(px - size * .1, py + size * .09); ctx.closePath(); ctx.fill();
    }
  } else if (terrain === 'mountains' || terrain === 'hills') {
    ctx.beginPath(); ctx.moveTo(x + size * .08, y + size * .78); ctx.lineTo(x + size * .35, y + size * .28); ctx.lineTo(x + size * .55, y + size * .7); ctx.lineTo(x + size * .72, y + size * .38); ctx.lineTo(x + size * .94, y + size * .78); ctx.stroke();
  } else if (terrain === 'marsh') {
    for (let i = 0; i < 3; i += 1) { const px = x + size * (.2 + i * .27); ctx.beginPath(); ctx.moveTo(px, y + size * .76); ctx.lineTo(px + size * .03, y + size * .35); ctx.stroke(); }
  } else if (terrain === 'tundra') {
    ctx.beginPath(); ctx.moveTo(x + size * .15, y + size * .58); ctx.lineTo(x + size * .85, y + size * .42); ctx.stroke();
  } else {
    for (let i = 0; i < 4; i += 1) {
      const px = x + size * (.15 + ((h >> (i * 4)) & 7) / 10);
      const py = y + size * (.18 + ((h >> (i * 5 + 1)) & 7) / 11);
      ctx.fillRect(px, py, Math.max(1, size * .04), Math.max(1, size * .04));
    }
  }
  ctx.restore();
}

export function paintLocalCell(ctx: CanvasRenderingContext2D, ground: LocalGround, x: number, y: number, size: number, seed: number) {
  ctx.fillStyle = localBase[ground];
  ctx.fillRect(x, y, Math.ceil(size + .4), Math.ceil(size + .4));
  if (size < 7) return;
  const h = hash(seed);
  ctx.save(); ctx.globalAlpha = .16; ctx.strokeStyle = ground === 'water' ? '#b8d9dc' : ground === 'snow' ? '#ffffff' : '#ece0b5'; ctx.lineWidth = Math.max(.5, size * .04);
  if (ground === 'water') {
    const yy = y + size * (.35 + (h & 3) * .08); ctx.beginPath(); ctx.moveTo(x + size * .12, yy); ctx.quadraticCurveTo(x + size * .5, yy - size * .1, x + size * .88, yy); ctx.stroke();
  } else if (ground === 'road' || ground === 'dirt' || ground === 'stone' || ground === 'ash') {
    for (let i = 0; i < 3; i += 1) { const px = x + size * (.18 + ((h >> (i * 4)) & 7) / 12); const py = y + size * (.2 + ((h >> (i * 5 + 1)) & 7) / 12); ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(px, py, Math.max(1, size * .05), Math.max(1, size * .035)); }
  } else {
    for (let i = 0; i < 2; i += 1) { const px = x + size * (.28 + i * .35); ctx.beginPath(); ctx.moveTo(px, y + size * .78); ctx.lineTo(px + ((h >> i) & 1 ? 1 : -1) * size * .07, y + size * .45); ctx.stroke(); }
  }
  ctx.restore();
}

export function paintFeature(ctx: CanvasRenderingContext2D, feature: LocalFeature, x: number, y: number, size: number) {
  ctx.save();
  const cx = x + size / 2; const cy = y + size / 2;
  const dark = '#111411'; const gold = '#c9a761';
  if (feature === 'tree') { ctx.fillStyle = '#214d32'; ctx.beginPath(); ctx.arc(cx, y + size * .42, size * .34, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#5b4330'; ctx.fillRect(cx - size * .06, y + size * .5, size * .12, size * .38); }
  else if (feature === 'wall') { ctx.fillStyle = '#303532'; ctx.fillRect(x + size * .06, y + size * .08, size * .88, size * .84); ctx.strokeStyle = '#6e726c'; ctx.strokeRect(x + size * .06, y + size * .08, size * .88, size * .84); }
  else if (feature === 'door') { ctx.fillStyle = '#aa8652'; ctx.fillRect(x + size * .28, y + size * .08, size * .44, size * .84); ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(x + size * .62, cy, Math.max(1, size * .05), 0, Math.PI * 2); ctx.fill(); }
  else if (feature === 'field' || feature === 'tilled-soil') { ctx.strokeStyle = feature === 'field' ? '#d1aa5e' : '#4d3525'; ctx.lineWidth = Math.max(1, size * .08); for (let i = 1; i <= 4; i += 1) { const xx = x + size * i / 5; ctx.beginPath(); ctx.moveTo(xx, y + size * .12); ctx.lineTo(xx, y + size * .88); ctx.stroke(); } }
  else if (feature === 'seedlings' || feature === 'crop' || feature === 'ripe-crop') { ctx.strokeStyle = feature === 'ripe-crop' ? '#d2ae55' : feature === 'crop' ? '#719f4d' : '#92b96b'; ctx.lineWidth = Math.max(1, size * .07); for (let i = 0; i < 3; i += 1) { const xx = x + size * (.22 + i * .28); ctx.beginPath(); ctx.moveTo(xx, y + size * .84); ctx.lineTo(xx, y + size * (.42 - i * .03)); ctx.stroke(); if (feature !== 'seedlings') { ctx.beginPath(); ctx.arc(xx + size * .07, y + size * (.5 - i * .02), size * .08, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); } } }
  else if (feature === 'construction-foundation') { ctx.fillStyle = '#6b665d'; ctx.fillRect(x + size * .08, y + size * .62, size * .84, size * .25); ctx.strokeStyle = '#b0a58e'; ctx.strokeRect(x + size * .08, y + size * .62, size * .84, size * .25); }
  else if (feature === 'construction-frame') { ctx.strokeStyle = '#a67a48'; ctx.lineWidth = Math.max(1, size * .1); ctx.strokeRect(x + size * .16, y + size * .18, size * .68, size * .68); ctx.beginPath(); ctx.moveTo(x + size * .16, y + size * .18); ctx.lineTo(x + size * .84, y + size * .86); ctx.stroke(); }
  else if (feature === 'construction-wall' || feature === 'scaffold') { ctx.strokeStyle = feature === 'scaffold' ? '#a77a48' : '#77766f'; ctx.lineWidth = Math.max(1, size * .08); ctx.strokeRect(x + size * .12, y + size * .16, size * .76, size * .7); ctx.beginPath(); ctx.moveTo(x + size * .2, y + size * .78); ctx.lineTo(x + size * .8, y + size * .24); ctx.stroke(); }
  else if (feature === 'grave') { ctx.fillStyle = '#171917'; ctx.fillRect(cx - size * .12, y + size * .2, size * .24, size * .58); ctx.fillRect(cx - size * .25, y + size * .34, size * .5, size * .12); }
  else if (feature === 'cemetery') { ctx.strokeStyle = '#0b0b0b'; ctx.lineWidth = Math.max(1, size * .08); ctx.strokeRect(x + size * .08, y + size * .08, size * .84, size * .84); paintFeature(ctx, 'grave', x, y, size); }
  else if (feature === 'body' || feature === 'bones') { ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(1.5, size * .12); ctx.beginPath(); ctx.moveTo(x + size * .2, cy); ctx.lineTo(x + size * .8, cy); ctx.moveTo(x + size * .35, y + size * .25); ctx.lineTo(x + size * .65, y + size * .75); ctx.moveTo(x + size * .65, y + size * .25); ctx.lineTo(x + size * .35, y + size * .75); ctx.stroke(); }
  else if (feature === 'blood') { ctx.fillStyle = '#3d0f12'; ctx.beginPath(); ctx.ellipse(cx, cy, size * .32, size * .2, .3, 0, Math.PI * 2); ctx.fill(); }
  else if (feature === 'rubble' || feature === 'looted') { ctx.fillStyle = '#050505'; for (let i = 0; i < 4; i += 1) ctx.fillRect(x + size * (.14 + i * .18), y + size * (.2 + (i % 2) * .34), size * .18, size * .18); }
  else if (feature === 'fire') { ctx.fillStyle = '#e87842'; ctx.beginPath(); ctx.moveTo(cx, y + size * .08); ctx.quadraticCurveTo(x + size * .84, y + size * .62, cx, y + size * .9); ctx.quadraticCurveTo(x + size * .16, y + size * .62, cx, y + size * .08); ctx.fill(); }
  else if (feature === 'herb' || feature === 'berry' || feature === 'mushroom') { ctx.strokeStyle = feature === 'berry' ? '#9b4f6b' : '#75a95f'; ctx.fillStyle = feature === 'mushroom' ? '#b49a73' : ctx.strokeStyle; ctx.lineWidth = Math.max(1, size * .08); ctx.beginPath(); ctx.moveTo(cx, y + size * .85); ctx.lineTo(cx, y + size * .3); ctx.stroke(); ctx.beginPath(); ctx.arc(x + size * .4, y + size * .45, size * .16, 0, Math.PI * 2); ctx.arc(x + size * .62, y + size * .35, size * .15, 0, Math.PI * 2); ctx.fill(); }
  else if (feature === 'rock') { ctx.fillStyle = '#3e4140'; ctx.beginPath(); ctx.moveTo(x + size * .15, y + size * .78); ctx.lineTo(x + size * .35, y + size * .25); ctx.lineTo(x + size * .72, y + size * .18); ctx.lineTo(x + size * .88, y + size * .78); ctx.closePath(); ctx.fill(); }
  else if (feature === 'stairs-down' || feature === 'stairs-up') { ctx.fillStyle = gold; for (let i = 0; i < 3; i += 1) ctx.fillRect(x + size * (.16 + i * .12), y + size * (.2 + i * .22), size * (.68 - i * .12), size * .1); }
  else { ctx.fillStyle = '#536a4a'; ctx.beginPath(); ctx.arc(cx, cy, size * .23, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

export function paintMarker(ctx: CanvasRenderingContext2D, marker: LocalMarker, x0: number, y0: number, size: number) {
  const w = Math.max(1, marker.footprintWidth ?? 1) * size;
  const h = Math.max(1, marker.footprintHeight ?? 1) * size;
  const cx = x0 + w / 2; const cy = y0 + h / 2; const r = Math.max(2.5, Math.min(9, Math.min(w, h) * .3));
  ctx.save(); ctx.lineWidth = Math.max(1, size * .08); ctx.strokeStyle = '#0d120e';
  if (marker.kind === 'person' || marker.kind === 'group' || marker.kind === 'merchant') { ctx.fillStyle = marker.kind === 'merchant' ? '#d9ad58' : '#f2dfae'; ctx.beginPath(); ctx.arc(cx, cy - r * .35, r * .45, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(cx, cy + r * .55, r * .65, Math.PI, 0); ctx.fill(); if (marker.kind === 'merchant') { ctx.strokeStyle = '#3d2912'; ctx.lineWidth = Math.max(1, r * .18); ctx.beginPath(); ctx.moveTo(cx - r * .85, cy + r * .2); ctx.lineTo(cx + r * .85, cy + r * .2); ctx.stroke(); } }
  else if (marker.kind === 'building' || marker.kind === 'establishment' || marker.kind === 'settlement' || marker.kind === 'construction') { ctx.fillStyle = marker.kind === 'construction' ? '#c28b54' : marker.kind === 'establishment' ? '#d7a95b' : '#8e8068'; ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx + r, cy + r); ctx.lineTo(cx - r, cy + r); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  else if (marker.kind === 'field') { ctx.fillStyle = '#a9b85c'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  else if (marker.kind === 'item' || marker.kind === 'artifact') { ctx.fillStyle = '#d8bd65'; ctx.fillRect(cx - r, cy - r * .65, r * 2, r * 1.3); ctx.strokeRect(cx - r, cy - r * .65, r * 2, r * 1.3); }
  else if (marker.kind === 'cemetery' || marker.kind === 'grave') { ctx.fillStyle = '#050505'; ctx.fillRect(cx - r * .18, cy - r, r * .36, r * 2); ctx.fillRect(cx - r * .65, cy - r * .35, r * 1.3, r * .32); }
  else if (marker.kind === 'corpse' || marker.kind === 'effect') { ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(2, r * .35); ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx - r * .45, cy - r); ctx.lineTo(cx + r * .45, cy + r); ctx.stroke(); }
  else if (marker.kind === 'monster') { ctx.fillStyle = '#e06f50'; ctx.beginPath(); ctx.moveTo(cx, y0 + size * .08); ctx.lineTo(x0 + w - size * .08, y0 + h - size * .08); ctx.lineTo(x0 + size * .08, y0 + h - size * .08); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  else if (marker.kind === 'army') { ctx.strokeStyle = '#f0e2b7'; ctx.lineWidth = Math.max(1.5, size * .12); ctx.beginPath(); ctx.moveTo(cx - r, cy + r); ctx.lineTo(cx, cy - r); ctx.lineTo(cx + r, cy + r); ctx.stroke(); }
  else { ctx.fillStyle = marker.kind === 'resource' ? '#80b89a' : marker.kind === 'fauna' ? '#86a76a' : '#d8c7a0'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  if ((marker.count ?? 0) > 1 && size >= 9) { ctx.fillStyle = '#121712'; ctx.font = `bold ${Math.max(7, r * 1.15)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(marker.count! > 99 ? '99+' : String(marker.count), cx, cy + .5); }
  ctx.restore();
}

function hash(value: number): number {
  let h = value | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return h >>> 0;
}
