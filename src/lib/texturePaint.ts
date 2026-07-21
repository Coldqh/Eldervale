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
    for (let i = 0; i < 2; i += 1) { const yy = y + size * (.32 + i * .3) + ((h >> (i * 3)) & 3) - 1.5; ctx.beginPath(); ctx.moveTo(x + size * .12, yy); ctx.quadraticCurveTo(x + size * .5, yy - size * .12, x + size * .88, yy); ctx.stroke(); }
  } else if (terrain === 'forest') {
    for (let i = 0; i < 3; i += 1) { const px = x + size * (.22 + ((h >> (i * 4)) & 7) / 13); const py = y + size * (.25 + ((h >> (i * 5 + 2)) & 7) / 14); ctx.beginPath(); ctx.moveTo(px, py - size * .12); ctx.lineTo(px + size * .1, py + size * .09); ctx.lineTo(px - size * .1, py + size * .09); ctx.closePath(); ctx.fill(); }
  } else if (terrain === 'mountains' || terrain === 'hills') {
    ctx.beginPath(); ctx.moveTo(x + size * .08, y + size * .78); ctx.lineTo(x + size * .35, y + size * .28); ctx.lineTo(x + size * .55, y + size * .7); ctx.lineTo(x + size * .72, y + size * .38); ctx.lineTo(x + size * .94, y + size * .78); ctx.stroke();
  } else if (terrain === 'marsh') {
    for (let i = 0; i < 3; i += 1) { const px = x + size * (.2 + i * .27); ctx.beginPath(); ctx.moveTo(px, y + size * .76); ctx.lineTo(px + size * .03, y + size * .35); ctx.stroke(); }
  } else if (terrain === 'tundra') {
    ctx.beginPath(); ctx.moveTo(x + size * .15, y + size * .58); ctx.lineTo(x + size * .85, y + size * .42); ctx.stroke();
  } else {
    for (let i = 0; i < 4; i += 1) { const px = x + size * (.15 + ((h >> (i * 4)) & 7) / 10); const py = y + size * (.18 + ((h >> (i * 5 + 1)) & 7) / 11); ctx.fillRect(px, py, Math.max(1, size * .04), Math.max(1, size * .04)); }
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
  } else if (ground === 'road' || ground === 'dirt' || ground === 'stone' || ground === 'ash' || ground === 'floor') {
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
  else if (feature === 'trash') { ctx.fillStyle = '#17110b'; for (let i = 0; i < 5; i += 1) ctx.fillRect(x + size * (.12 + (i * .17) % .7), y + size * (.2 + (i % 3) * .22), size * .12, size * .1); }
  else if (feature === 'rubble' || feature === 'looted') { ctx.fillStyle = '#050505'; for (let i = 0; i < 4; i += 1) ctx.fillRect(x + size * (.14 + i * .18), y + size * (.2 + (i % 2) * .34), size * .18, size * .18); }
  else if (feature === 'fire') { ctx.fillStyle = '#e87842'; ctx.beginPath(); ctx.moveTo(cx, y + size * .08); ctx.quadraticCurveTo(x + size * .84, y + size * .62, cx, y + size * .9); ctx.quadraticCurveTo(x + size * .16, y + size * .62, cx, y + size * .08); ctx.fill(); }
  else if (feature === 'herb' || feature === 'berry' || feature === 'mushroom') { ctx.strokeStyle = feature === 'berry' ? '#9b4f6b' : '#75a95f'; ctx.fillStyle = feature === 'mushroom' ? '#b49a73' : ctx.strokeStyle; ctx.lineWidth = Math.max(1, size * .08); ctx.beginPath(); ctx.moveTo(cx, y + size * .85); ctx.lineTo(cx, y + size * .3); ctx.stroke(); ctx.beginPath(); ctx.arc(x + size * .4, y + size * .45, size * .16, 0, Math.PI * 2); ctx.arc(x + size * .62, y + size * .35, size * .15, 0, Math.PI * 2); ctx.fill(); }
  else if (feature === 'rock') { ctx.fillStyle = '#3e4140'; ctx.beginPath(); ctx.moveTo(x + size * .15, y + size * .78); ctx.lineTo(x + size * .35, y + size * .25); ctx.lineTo(x + size * .72, y + size * .18); ctx.lineTo(x + size * .88, y + size * .78); ctx.closePath(); ctx.fill(); }
  else if (feature === 'tent') { ctx.fillStyle = '#8f7653'; ctx.strokeStyle = '#3d3326'; ctx.lineWidth = Math.max(1, size * .08); ctx.beginPath(); ctx.moveTo(x + size * .08, y + size * .84); ctx.lineTo(cx, y + size * .14); ctx.lineTo(x + size * .92, y + size * .84); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx, y + size * .14); ctx.lineTo(cx, y + size * .84); ctx.stroke(); }
  else if (feature === 'campfire') { ctx.fillStyle = '#5c3b24'; ctx.fillRect(x + size * .18, y + size * .68, size * .64, size * .1); ctx.fillStyle = '#e87842'; ctx.beginPath(); ctx.moveTo(cx, y + size * .14); ctx.quadraticCurveTo(x + size * .78, y + size * .62, cx, y + size * .82); ctx.quadraticCurveTo(x + size * .22, y + size * .62, cx, y + size * .14); ctx.fill(); }
  else if (feature === 'latrine') { ctx.strokeStyle = '#342b20'; ctx.lineWidth = Math.max(1, size * .08); ctx.strokeRect(x + size * .18, y + size * .28, size * .64, size * .5); ctx.beginPath(); ctx.moveTo(x + size * .22, y + size * .7); ctx.lineTo(x + size * .78, y + size * .36); ctx.stroke(); }
  else if (feature === 'palisade') { ctx.strokeStyle = '#60492f'; ctx.lineWidth = Math.max(1.5, size * .12); for (let i = 0; i < 4; i += 1) { const xx = x + size * (.15 + i * .23); ctx.beginPath(); ctx.moveTo(xx, y + size * .88); ctx.lineTo(xx, y + size * .18); ctx.stroke(); } }
  else if (feature === 'hitching-post') { ctx.strokeStyle = '#59442c'; ctx.lineWidth = Math.max(1.5, size * .12); ctx.beginPath(); ctx.moveTo(x + size * .2, y + size * .82); ctx.lineTo(x + size * .2, y + size * .28); ctx.lineTo(x + size * .8, y + size * .28); ctx.lineTo(x + size * .8, y + size * .82); ctx.stroke(); }
  else if (feature === 'stairs-down' || feature === 'stairs-up') { ctx.fillStyle = gold; for (let i = 0; i < 3; i += 1) ctx.fillRect(x + size * (.16 + i * .12), y + size * (.2 + i * .22), size * (.68 - i * .12), size * .1); }
  else { ctx.fillStyle = '#536a4a'; ctx.beginPath(); ctx.arc(cx, cy, size * .23, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

export function paintMarker(ctx: CanvasRenderingContext2D, marker: LocalMarker, x0: number, y0: number, size: number) {
  const w = Math.max(1, marker.footprintWidth ?? 1) * size;
  const h = Math.max(1, marker.footprintHeight ?? 1) * size;
  const cx = x0 + w / 2; const cy = y0 + h / 2; const r = Math.max(2.5, Math.min(9, Math.min(w, h) * .3));
  ctx.save(); ctx.lineWidth = Math.max(1, size * .08); ctx.strokeStyle = '#0d120e';
  if (paintInteriorMarker(ctx, marker, x0, y0, w, h, size)) {
    // Интерьер уже нарисован отдельным понятным символом.
  } else if (marker.kind === 'person' || marker.kind === 'patrol' || marker.kind === 'group' || marker.kind === 'merchant') {
    const role = marker.visualRole ?? '';
    const military = ['soldier', 'militia', 'archer', 'cavalry', 'knight', 'officer', 'commander', 'military-group'].includes(role);
    ctx.fillStyle = marker.kind === 'patrol' ? '#a9b9ae' : marker.kind === 'merchant' ? '#d9ad58' : role === 'king' ? '#d9b95e' : military ? '#c9c5b4' : '#f2dfae';
    ctx.beginPath(); ctx.arc(cx, cy - r * .35, r * .45, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(cx, cy + r * .55, r * .65, Math.PI, 0); ctx.fill();
    if (role === 'king') { ctx.fillStyle = '#e7c76a'; ctx.beginPath(); ctx.moveTo(cx - r * .7, cy - r * .95); ctx.lineTo(cx - r * .35, cy - r * 1.55); ctx.lineTo(cx, cy - r * 1.05); ctx.lineTo(cx + r * .35, cy - r * 1.55); ctx.lineTo(cx + r * .7, cy - r * .95); ctx.closePath(); ctx.fill(); }
    else if (military) { ctx.strokeStyle = role === 'commander' || role === 'officer' ? '#d9b95e' : '#5f665f'; ctx.lineWidth = Math.max(1, r * .22); ctx.beginPath(); ctx.arc(cx, cy - r * .35, r * .58, Math.PI, 0); ctx.stroke(); if (role === 'archer') { ctx.beginPath(); ctx.arc(cx + r * .55, cy + r * .2, r * .8, -Math.PI / 2, Math.PI / 2); ctx.stroke(); } else if (role === 'knight') ctx.strokeRect(cx - r * .9, cy, r * .65, r * 1.05); else { ctx.beginPath(); ctx.moveTo(cx + r * .7, cy - r * .1); ctx.lineTo(cx + r * .7, cy + r * 1.2); ctx.stroke(); } }
    if (marker.kind === 'merchant') { ctx.strokeStyle = '#3d2912'; ctx.lineWidth = Math.max(1, r * .18); ctx.beginPath(); ctx.moveTo(cx - r * .85, cy + r * .2); ctx.lineTo(cx + r * .85, cy + r * .2); ctx.stroke(); }
  } else if (marker.kind === 'camp') {
    const role = marker.visualRole ?? '';
    ctx.strokeStyle = '#30281d'; ctx.fillStyle = role === 'campfire' || role === 'fieldKitchen' ? '#c86d3b' : role === 'horseLine' || role === 'wagonPark' ? '#6f573c' : '#9a825d'; ctx.lineWidth = Math.max(1, size * .08);
    if (role === 'campfire' || role === 'fieldKitchen') { ctx.beginPath(); ctx.arc(cx, cy, r * .75, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    else if (role === 'guardPost') { ctx.fillRect(cx - r * .25, cy - r, r * .5, r * 2); ctx.strokeRect(cx - r * .25, cy - r, r * .5, r * 2); }
    else { ctx.beginPath(); ctx.moveTo(x0 + size * .08, y0 + h - size * .08); ctx.lineTo(cx, y0 + size * .08); ctx.lineTo(x0 + w - size * .08, y0 + h - size * .08); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  } else if (marker.kind === 'building' || marker.kind === 'establishment' || marker.kind === 'settlement' || marker.kind === 'construction') {
    ctx.fillStyle = marker.kind === 'construction' ? '#c28b54' : marker.kind === 'establishment' ? '#d7a95b' : '#8e8068'; ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx + r, cy + r); ctx.lineTo(cx - r, cy + r); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (marker.kind === 'field') { ctx.fillStyle = '#a9b85c'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  else if (marker.kind === 'item' || marker.kind === 'artifact') { ctx.fillStyle = '#d8bd65'; ctx.fillRect(cx - r, cy - r * .65, r * 2, r * 1.3); ctx.strokeRect(cx - r, cy - r * .65, r * 2, r * 1.3); }
  else if (marker.kind === 'cemetery' || marker.kind === 'grave') { ctx.fillStyle = '#050505'; ctx.fillRect(cx - r * .18, cy - r, r * .36, r * 2); ctx.fillRect(cx - r * .65, cy - r * .35, r * 1.3, r * .32); }
  else if (marker.kind === 'corpse' || marker.kind === 'effect') { ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(2, r * .35); ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx - r * .45, cy - r); ctx.lineTo(cx + r * .45, cy + r); ctx.stroke(); }
  else if (marker.kind === 'monster') { ctx.fillStyle = '#e06f50'; ctx.beginPath(); ctx.moveTo(cx, y0 + size * .08); ctx.lineTo(x0 + w - size * .08, y0 + h - size * .08); ctx.lineTo(x0 + size * .08, y0 + h - size * .08); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  else if (marker.kind === 'fauna') { paintFauna(ctx, marker, cx, cy, r); }
  else if (marker.kind === 'army') { paintArmy(ctx, marker, cx, cy, r); }
  else { ctx.fillStyle = marker.kind === 'resource' ? '#80b89a' : '#d8c7a0'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  if ((marker.count ?? 0) > 1 && size >= 9) { ctx.fillStyle = '#121712'; ctx.font = `bold ${Math.max(7, r * 1.15)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(marker.count! > 99 ? '99+' : String(marker.count), cx, cy + .5); }
  ctx.restore();
}

function paintInteriorMarker(ctx: CanvasRenderingContext2D, marker: LocalMarker, x: number, y: number, w: number, h: number, size: number): boolean {
  const role = marker.visualRole ?? '';
  if (!role.startsWith('interior-')) return false;
  const kind = role.slice('interior-'.length);
  const cx = x + w / 2; const cy = y + h / 2;
  const wood = '#765536'; const lightWood = '#a47b4f'; const cloth = '#7d2f36'; const metal = '#5c6260'; const gold = '#c6a250';
  ctx.lineWidth = Math.max(1, size * .07); ctx.strokeStyle = '#21170e';
  if (['bed', 'double-bed', 'bunk-bed', 'prison-bed', 'treatment-bed'].includes(kind)) {
    ctx.fillStyle = kind === 'prison-bed' ? '#5c5547' : kind === 'treatment-bed' ? '#b6aa8d' : '#8f714b';
    ctx.fillRect(x + w * .08, y + h * .12, w * .84, h * .76); ctx.strokeRect(x + w * .08, y + h * .12, w * .84, h * .76);
    ctx.fillStyle = '#d7c9a4'; ctx.fillRect(x + w * .15, y + h * .18, w * .7, h * .2);
    if (kind === 'bunk-bed') { ctx.strokeStyle = metal; ctx.beginPath(); ctx.moveTo(x + w * .12, cy); ctx.lineTo(x + w * .88, cy); ctx.stroke(); }
  } else if (kind === 'student-desk' || kind === 'teacher-desk' || kind === 'writing-desk' || kind === 'workbench' || kind === 'kitchen-table') {
    ctx.fillStyle = kind === 'student-desk' ? lightWood : wood; ctx.fillRect(x + w * .08, y + h * .18, w * .84, h * .48); ctx.strokeRect(x + w * .08, y + h * .18, w * .84, h * .48);
    ctx.beginPath(); ctx.moveTo(x + w * .2, y + h * .66); ctx.lineTo(x + w * .18, y + h * .9); ctx.moveTo(x + w * .8, y + h * .66); ctx.lineTo(x + w * .82, y + h * .9); ctx.stroke();
    if (kind === 'student-desk') { ctx.strokeStyle = '#ddd1ae'; ctx.beginPath(); ctx.moveTo(x + w * .3, y + h * .32); ctx.lineTo(x + w * .7, y + h * .32); ctx.stroke(); }
  } else if (kind === 'table' || kind === 'bar-counter' || kind === 'counter' || kind === 'market-stall') {
    ctx.fillStyle = wood; ctx.fillRect(x + w * .05, y + h * .25, w * .9, h * .45); ctx.strokeRect(x + w * .05, y + h * .25, w * .9, h * .45);
  } else if (kind === 'chair' || kind === 'bench' || kind === 'throne') {
    ctx.fillStyle = kind === 'throne' ? gold : wood; ctx.fillRect(x + w * .22, y + h * .28, w * .56, h * .56); ctx.strokeRect(x + w * .22, y + h * .28, w * .56, h * .56);
    ctx.fillRect(x + w * .18, y + h * .08, w * .64, h * .34);
    if (kind === 'throne') { ctx.fillStyle = cloth; ctx.fillRect(x + w * .3, y + h * .18, w * .4, h * .5); }
  } else if (kind === 'rug' || kind === 'carpet-runner') {
    ctx.fillStyle = cloth; ctx.fillRect(x + w * .04, y + h * .1, w * .92, h * .8); ctx.strokeStyle = gold; ctx.strokeRect(x + w * .04, y + h * .1, w * .92, h * .8); ctx.beginPath(); ctx.moveTo(x + w * .16, cy); ctx.lineTo(x + w * .84, cy); ctx.stroke();
  } else if (kind === 'banner' || kind === 'tapestry') {
    ctx.fillStyle = cloth; ctx.fillRect(x + w * .2, y + h * .08, w * .6, h * .76); ctx.strokeStyle = gold; ctx.strokeRect(x + w * .2, y + h * .08, w * .6, h * .76);
  } else if (kind === 'anvil') {
    ctx.fillStyle = metal; ctx.fillRect(x + w * .12, y + h * .3, w * .76, h * .26); ctx.fillRect(x + w * .38, y + h * .5, w * .24, h * .4); ctx.strokeRect(x + w * .12, y + h * .3, w * .76, h * .26);
  } else if (kind === 'loom') {
    ctx.strokeStyle = wood; ctx.strokeRect(x + w * .14, y + h * .08, w * .72, h * .82); for (let i = 1; i < 5; i += 1) { const xx = x + w * (.14 + i * .144); ctx.beginPath(); ctx.moveTo(xx, y + h * .14); ctx.lineTo(xx, y + h * .82); ctx.stroke(); }
  } else if (kind === 'shelf' || kind === 'bookcase' || kind === 'wardrobe' || kind === 'weapon-rack') {
    ctx.fillStyle = wood; ctx.fillRect(x + w * .12, y + h * .08, w * .76, h * .84); ctx.strokeRect(x + w * .12, y + h * .08, w * .76, h * .84); ctx.strokeStyle = kind === 'weapon-rack' ? metal : lightWood; for (let i = 1; i < 4; i += 1) { const yy = y + h * (.08 + i * .21); ctx.beginPath(); ctx.moveTo(x + w * .16, yy); ctx.lineTo(x + w * .84, yy); ctx.stroke(); }
  } else if (kind === 'chest' || kind === 'crate' || kind === 'barrel') {
    ctx.fillStyle = wood; ctx.fillRect(x + w * .12, y + h * .22, w * .76, h * .62); ctx.strokeRect(x + w * .12, y + h * .22, w * .76, h * .62); if (kind === 'barrel') { ctx.strokeStyle = metal; ctx.beginPath(); ctx.moveTo(x + w * .12, y + h * .4); ctx.lineTo(x + w * .88, y + h * .4); ctx.moveTo(x + w * .12, y + h * .66); ctx.lineTo(x + w * .88, y + h * .66); ctx.stroke(); }
  } else if (kind === 'altar' || kind === 'lectern') {
    ctx.fillStyle = kind === 'altar' ? '#878078' : wood; ctx.fillRect(x + w * .16, y + h * .42, w * .68, h * .44); ctx.strokeRect(x + w * .16, y + h * .42, w * .68, h * .44); ctx.fillStyle = gold; ctx.fillRect(x + w * .42, y + h * .12, w * .16, h * .32);
  } else if (kind === 'guard-post' || kind === 'training-dummy') {
    ctx.strokeStyle = kind === 'guard-post' ? metal : wood; ctx.lineWidth = Math.max(1.5, size * .12); ctx.beginPath(); ctx.moveTo(cx, y + h * .1); ctx.lineTo(cx, y + h * .88); ctx.moveTo(x + w * .22, y + h * .34); ctx.lineTo(x + w * .78, y + h * .34); ctx.stroke();
  } else if (kind === 'wash-basin') {
    ctx.strokeStyle = metal; ctx.beginPath(); ctx.ellipse(cx, cy, w * .34, h * .24, 0, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#759aa1'; ctx.globalAlpha = .55; ctx.fill(); ctx.globalAlpha = 1;
  } else if (kind === 'interior-materials' || kind === 'materials') {
    ctx.fillStyle = '#8c7c64'; ctx.fillRect(x + w * .15, y + h * .15, w * .7, h * .7); ctx.strokeStyle = '#d4c39b'; ctx.strokeRect(x + w * .15, y + h * .15, w * .7, h * .7);
  } else return false;
  return true;
}

function paintFauna(ctx: CanvasRenderingContext2D, marker: LocalMarker, cx: number, cy: number, r: number): void {
  const species = marker.visualRole ?? marker.label; const rabbit = /заяц|кролик/i.test(species); const deer = /олень|лось|косул/i.test(species); const canine = /волк|лис|шакал|собак/i.test(species);
  ctx.fillStyle = rabbit ? '#b6aa8b' : deer ? '#9d7950' : canine ? '#777b72' : '#8a845f'; ctx.beginPath(); ctx.ellipse(cx - r * .15, cy + r * .2, r * .85, r * .48, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(cx + r * .65, cy - r * .18, r * .38, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.lineWidth = Math.max(1, r * .16); if (rabbit) { ctx.beginPath(); ctx.moveTo(cx + r * .52, cy - r * .48); ctx.lineTo(cx + r * .42, cy - r * 1.15); ctx.moveTo(cx + r * .78, cy - r * .48); ctx.lineTo(cx + r * .92, cy - r * 1.12); ctx.stroke(); } else if (deer) { ctx.beginPath(); ctx.moveTo(cx + r * .55, cy - r * .5); ctx.lineTo(cx + r * .35, cy - r * 1.05); ctx.moveTo(cx + r * .72, cy - r * .5); ctx.lineTo(cx + r * .95, cy - r * 1.05); ctx.stroke(); } else if (canine) { ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r * 1.45, cy - r * .45); ctx.lineTo(cx - r * 1.22, cy + r * .25); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(cx - r * .55, cy + r * .55); ctx.lineTo(cx - r * .55, cy + r); ctx.moveTo(cx + r * .25, cy + r * .55); ctx.lineTo(cx + r * .25, cy + r); ctx.stroke();
}

function paintArmy(ctx: CanvasRenderingContext2D, marker: LocalMarker, cx: number, cy: number, r: number): void {
  ctx.strokeStyle = '#f0e2b7'; ctx.fillStyle = marker.visualRole === 'wagon' ? '#8b6845' : '#777b72'; ctx.lineWidth = Math.max(1.5, r * .2);
  if (marker.visualRole === 'wagon') { ctx.fillRect(cx - r, cy - r * .5, r * 2, r); ctx.strokeRect(cx - r, cy - r * .5, r * 2, r); ctx.beginPath(); ctx.arc(cx - r * .65, cy + r * .72, r * .35, 0, Math.PI * 2); ctx.arc(cx + r * .65, cy + r * .72, r * .35, 0, Math.PI * 2); ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(cx - r, cy + r); ctx.lineTo(cx, cy - r); ctx.lineTo(cx + r, cy + r); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - r * 1.7); ctx.lineTo(cx + r * .8, cy - r * 1.35); ctx.lineTo(cx, cy - r * 1.05); ctx.stroke(); }
}

function hash(value: number): number {
  let h = value | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return h >>> 0;
}
