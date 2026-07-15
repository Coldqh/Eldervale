import { useEffect, useMemo, useRef, useState } from 'react';
import type { EntityRef, LocalFeature, LocalGround, LocalMapData, LocalMarker, WorldState } from '../types';
import { generateLocalMap, localCellSummary } from '../lib/localMap';

const groundColors: Record<LocalGround, string> = {
  grass: '#617853', dirt: '#745e43', sand: '#a58a5f', water: '#244d59', mud: '#4b5d50', snow: '#aeb7b3', stone: '#656862', road: '#8a7352', floor: '#8c7c64', ash: '#423f3a',
};
const featureColors: Partial<Record<LocalFeature, string>> = {
  tree: '#214d32', bush: '#375e3f', rock: '#3e4140', reeds: '#6b7951', wall: '#292d2b', door: '#bb9a5f', field: '#9b8150', rubble: '#5d5145', fire: '#e87842', blood: '#7d2d2c', body: '#201d1b', chest: '#d2aa5a',
  'stairs-down': '#d2bd83', 'stairs-up': '#e6d69f', bridge: '#7b6042', herb: '#75a95f', berry: '#9b4f6b', mushroom: '#b49a73', 'animal-trail': '#7b674c',
};
const markerColors: Record<LocalMarker['kind'], string> = {
  person: '#f2dfae', group: '#d9c28d', army: '#ded8c5', monster: '#f07b59', settlement: '#e2bb68', dungeon: '#aa92c2', artifact: '#e6d46d', effect: '#c66852', fauna: '#86a76a', resource: '#80b89a',
};

export function LocalMapViewer({ world, globalX, globalY, initialLevel = 0, onMove, onBack, onSelect }: {
  world: WorldState;
  globalX: number;
  globalY: number;
  initialLevel?: number;
  onMove: (x: number, y: number, level?: number) => void;
  onBack: () => void;
  onSelect: (ref: EntityRef) => void;
}) {
  const [level, setLevel] = useState(initialLevel);
  const [zoom, setZoom] = useState(1);
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const [selectedCell, setSelectedCell] = useState({ x: 0, y: 0 });
  const map = useMemo(() => generateLocalMap(world, globalX, globalY, level), [world, globalX, globalY, level]);
  const summary = useMemo(() => localCellSummary(map, selectedCell.x, selectedCell.y), [map, selectedCell]);

  useEffect(() => {
    if (!map.availableLevels.includes(level)) setLevel(0);
    setCamera({ x: 0, y: 0 });
    setZoom(1);
    setSelectedCell({ x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) });
  }, [map.key]);

  const move = (dx: number, dy: number) => {
    const x = globalX + dx;
    const y = globalY + dy;
    if (x < 0 || y < 0 || x >= world.config.width || y >= world.config.height) return;
    setLevel(0);
    onMove(x, y, 0);
  };

  return <section className="workspace-view local-map-workspace">
    <header className="local-map-header">
      <div className="local-map-title">
        <button className="window-control local-back" onClick={onBack} aria-label="Вернуться к глобальной карте">←</button>
        <div><span className="eyebrow">Локальная карта квадрата {globalX}:{globalY}</span><h1>{map.title}</h1><p>{map.subtitle}</p></div>
      </div>
      <div className="local-map-header-actions">
        <div className="local-levels" aria-label="Уровни местности">
          {map.availableLevels.map(item => <button key={item} className={level === item ? 'active' : ''} onClick={() => setLevel(item)}>{item === 0 ? 'Поверхность' : `Подземный ${Math.abs(item)}`}</button>)}
        </div>
        <button className="ghost-button" onClick={onBack}>Глобальная карта</button>
      </div>
    </header>

    <div className="local-map-grid">
      <div className="window-card local-canvas-window">
        <div className="local-map-toolbar">
          <div className="local-neighbours">
            <button onClick={() => move(0, -1)} disabled={globalY <= 0}>↑ Север</button>
            <button onClick={() => move(-1, 0)} disabled={globalX <= 0}>← Запад</button>
            <button onClick={() => move(1, 0)} disabled={globalX >= world.config.width - 1}>Восток →</button>
            <button onClick={() => move(0, 1)} disabled={globalY >= world.config.height - 1}>Юг ↓</button>
          </div>
          <div className="local-zoom-controls"><button onClick={() => setZoom(value => Math.max(.65, value - .2))}>−</button><strong>{Math.round(zoom * 100)}%</strong><button onClick={() => setZoom(value => Math.min(3, value + .2))}>＋</button><button onClick={() => { setZoom(1); setCamera({ x: 0, y: 0 }); }}>Центр</button></div>
        </div>
        <LocalCanvas map={map} zoom={zoom} camera={camera} onCamera={setCamera} selected={selectedCell} onSelectCell={setSelectedCell} />
        <div className="local-map-footnote"><span>Каждый житель на карте — реальная личность мира.</span><span>База восстанавливается из seed, история хранится отдельными изменениями: {world.localMapChanges.filter(effect => effect.globalX === globalX && effect.globalY === globalY).length}</span></div>
      </div>

      <aside className="window-card local-inspector">
        <div className="local-inspector-heading"><span className="eyebrow">Клетка {selectedCell.x}:{selectedCell.y}</span><h2>{summary.title}</h2></div>
        <div className="local-inspector-lines">{summary.lines.map(line => <p key={line}>{line}</p>)}</div>
        {summary.markers.length > 0 && <div className="local-marker-list">
          <h3>Существа и объекты</h3>
          {summary.markers.map(marker => <MarkerCard key={marker.id} marker={marker} world={world} onSelect={onSelect} />)}
        </div>}
        <div className="local-legend">
          <h3>Обозначения</h3>
          <div>{Object.entries(markerColors).map(([kind, color]) => <span key={kind}><i style={{ background: color }} />{markerLabel(kind as LocalMarker['kind'])}</span>)}</div>
        </div>
      </aside>
    </div>
  </section>;
}

function LocalCanvas({ map, zoom, camera, onCamera, selected, onSelectCell }: {
  map: LocalMapData;
  zoom: number;
  camera: { x: number; y: number };
  onCamera: (value: { x: number; y: number }) => void;
  selected: { x: number; y: number };
  onSelectCell: (value: { x: number; y: number }) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; cameraX: number; cameraY: number; moved: boolean } | undefined>(undefined);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => drawLocalMap(canvas, map, zoom, camera, selected);
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [map, zoom, camera, selected]);

  const metrics = () => {
    const canvas = ref.current!;
    const box = canvas.getBoundingClientRect();
    const base = Math.min(box.width / map.width, box.height / map.height);
    const cell = Math.max(4, base * zoom);
    return { box, cell, ox: (box.width - map.width * cell) / 2 + camera.x, oy: (box.height - map.height * cell) / 2 + camera.y };
  };

  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, cameraX: camera.x, cameraY: camera.y, moved: false };
  };
  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    if (Math.hypot(dx, dy) > 4) drag.current.moved = true;
    if (drag.current.moved) onCamera({ x: drag.current.cameraX + dx, y: drag.current.cameraY + dy });
  };
  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const active = drag.current;
    drag.current = undefined;
    if (!active || active.moved) return;
    const { box, cell, ox, oy } = metrics();
    const x = Math.floor((event.clientX - box.left - ox) / cell);
    const y = Math.floor((event.clientY - box.top - oy) / cell);
    if (x >= 0 && y >= 0 && x < map.width && y < map.height) onSelectCell({ x, y });
  };
  const wheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
  };

  return <canvas ref={ref} className="local-map-canvas" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = undefined; }} onWheel={wheel} aria-label={`Локальная карта квадрата ${map.globalX}:${map.globalY}`} />;
}

function drawLocalMap(canvas: HTMLCanvasElement, map: LocalMapData, zoom: number, camera: { x: number; y: number }, selected: { x: number; y: number }) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const box = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.floor(box.width * dpr));
  canvas.height = Math.max(1, Math.floor(box.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, box.width, box.height);
  ctx.fillStyle = '#080d0a';
  ctx.fillRect(0, 0, box.width, box.height);
  const base = Math.min(box.width / map.width, box.height / map.height);
  const cellSize = Math.max(4, base * zoom);
  const ox = (box.width - map.width * cellSize) / 2 + camera.x;
  const oy = (box.height - map.height * cellSize) / 2 + camera.y;

  const startX = Math.max(0, Math.floor((-ox) / cellSize) - 1);
  const startY = Math.max(0, Math.floor((-oy) / cellSize) - 1);
  const endX = Math.min(map.width - 1, Math.ceil((box.width - ox) / cellSize) + 1);
  const endY = Math.min(map.height - 1, Math.ceil((box.height - oy) / cellSize) + 1);

  for (let yIndex = startY; yIndex <= endY; yIndex += 1) {
    for (let xIndex = startX; xIndex <= endX; xIndex += 1) {
      const cell = map.cells[yIndex * map.width + xIndex]!;
      const x = ox + cell.x * cellSize;
      const y = oy + cell.y * cellSize;
      ctx.fillStyle = groundColors[cell.ground];
      ctx.fillRect(x, y, Math.ceil(cellSize + .4), Math.ceil(cellSize + .4));
      if (cell.feature) drawFeature(ctx, cell.feature, x, y, cellSize);
    }
  }
  if (cellSize >= 8) {
    ctx.strokeStyle = 'rgba(7,12,9,.16)';
    ctx.lineWidth = .5;
    for (let x = startX; x <= endX + 1; x += 1) { ctx.beginPath(); ctx.moveTo(ox + x * cellSize, Math.max(0, oy + startY * cellSize)); ctx.lineTo(ox + x * cellSize, Math.min(box.height, oy + (endY + 1) * cellSize)); ctx.stroke(); }
    for (let y = startY; y <= endY + 1; y += 1) { ctx.beginPath(); ctx.moveTo(Math.max(0, ox + startX * cellSize), oy + y * cellSize); ctx.lineTo(Math.min(box.width, ox + (endX + 1) * cellSize), oy + y * cellSize); ctx.stroke(); }
  }

  for (const marker of map.markers) {
    if (marker.x < startX || marker.x > endX || marker.y < startY || marker.y > endY) continue;
    drawMarker(ctx, marker, ox + (marker.x + .5) * cellSize, oy + (marker.y + .5) * cellSize, cellSize);
  }
  ctx.strokeStyle = '#f4d889';
  ctx.lineWidth = Math.max(1.5, cellSize * .13);
  ctx.strokeRect(ox + selected.x * cellSize + 1, oy + selected.y * cellSize + 1, Math.max(1, cellSize - 2), Math.max(1, cellSize - 2));
}

function drawFeature(ctx: CanvasRenderingContext2D, feature: LocalFeature, x: number, y: number, size: number) {
  ctx.fillStyle = featureColors[feature] ?? '#222';
  if (feature === 'wall' || feature === 'field' || feature === 'bridge') {
    ctx.fillRect(x + size * .08, y + size * .08, size * .84, size * .84);
  } else if (feature === 'door') {
    ctx.fillRect(x + size * .32, y + size * .08, size * .36, size * .84);
  } else if (feature === 'tree') {
    ctx.beginPath(); ctx.arc(x + size * .5, y + size * .48, size * .38, 0, Math.PI * 2); ctx.fill();
  } else if (feature === 'stairs-down' || feature === 'stairs-up') {
    ctx.fillRect(x + size * .18, y + size * .2, size * .64, size * .12);
    ctx.fillRect(x + size * .28, y + size * .43, size * .54, size * .12);
    ctx.fillRect(x + size * .38, y + size * .66, size * .44, size * .12);
  } else {
    ctx.beginPath(); ctx.arc(x + size * .5, y + size * .5, size * .25, 0, Math.PI * 2); ctx.fill();
  }
}

function drawMarker(ctx: CanvasRenderingContext2D, marker: LocalMarker, x: number, y: number, size: number) {
  const radius = Math.max(2.2, Math.min(6.5, size * .32));
  ctx.fillStyle = markerColors[marker.kind];
  ctx.strokeStyle = '#111712';
  ctx.lineWidth = 1;
  if (marker.kind === 'monster') {
    ctx.beginPath(); ctx.moveTo(x, y - radius); ctx.lineTo(x + radius, y + radius); ctx.lineTo(x - radius, y + radius); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (marker.kind === 'army') {
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2); ctx.strokeRect(x - radius, y - radius, radius * 2, radius * 2);
  } else {
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  if ((marker.count ?? 0) > 1 && size >= 9) {
    ctx.fillStyle = '#151a15';
    ctx.font = `bold ${Math.max(6, radius * 1.25)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(marker.count! > 99 ? '99+' : marker.count), x, y + .5);
  }
}

function MarkerCard({ marker, world, onSelect }: { marker: LocalMarker; world: WorldState; onSelect: (ref: EntityRef) => void }) {
  return <div className="local-marker-card">
    <div><i style={{ background: markerColors[marker.kind] }} /><span><strong>{marker.label}</strong>{marker.detail && <small>{marker.detail}</small>}</span></div>
    {marker.refs.length > 0 && <div className="local-marker-actions">
      {marker.refs.slice(0, 12).map(ref => <button key={`${ref.kind}-${ref.id}`} onClick={() => onSelect(ref)}>{entityName(world, ref)}</button>)}
      {marker.refs.length > 12 && <small>ещё {marker.refs.length - 12}</small>}
    </div>}
  </div>;
}

function entityName(world: WorldState, ref: EntityRef): string {
  const collections: Record<EntityRef['kind'], readonly { id: number; name?: string; title?: string }[]> = {
    kingdom: world.kingdoms, settlement: world.settlements, character: world.characters, army: world.armies, monster: world.monsters,
    artifact: world.artifacts, book: world.books, dungeon: world.dungeons, war: world.wars, dynasty: world.dynasties, tradeRoute: world.tradeRoutes,
    animalPopulation: world.animalPopulations, ingredient: world.ingredients, recipe: world.alchemyRecipes,
  };
  const entity = collections[ref.kind].find(item => item.id === ref.id);
  return entity?.name ?? entity?.title ?? `${ref.kind} ${ref.id}`;
}

function markerLabel(kind: LocalMarker['kind']): string {
  return ({ person: 'житель', group: 'группа жителей', army: 'армия', monster: 'чудовище', settlement: 'центр поселения', dungeon: 'подземелье', artifact: 'предмет', effect: 'след события', fauna: 'популяция животных', resource: 'природный ресурс' } as const)[kind];
}
