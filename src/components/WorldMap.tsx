import { useEffect, useRef, useState } from 'react';
import type { EntityRef, LocalMarker, TradeRoute, WorldState } from '../types';
import type { AtlasMapState } from '../lib/historicalAtlas';
import { paintGlobalTile, paintMarker as paintTextureMarker, terrainColor } from '../lib/texturePaint';

export type MapLayer = 'terrain' | 'realms' | 'danger' | 'population' | 'ecology' | 'trade';
const MIN_ZOOM = 1;
const MAX_ZOOM = 10;

type Point = { x: number; y: number };
type Viewport = { zoom: number; camera: Point };
type DragGesture = { kind: 'drag'; pointerId: number; start: Point; camera: Point; moved: boolean };
type PinchGesture = { kind: 'pinch'; startDistance: number; startZoom: number; anchor: Point };
type Gesture = DragGesture | PinchGesture;

export function WorldMap({ world, layer, onSelect, historicalState, onOpenTile }: {
  world: WorldState;
  layer: MapLayer;
  onSelect: (ref: EntityRef) => void;
  historicalState?: AtlasMapState;
  onOpenTile?: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, camera: { x: 0, y: 0 } });
  const viewportRef = useRef(viewport);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | undefined>(undefined);

  const applyViewport = (next: Viewport) => {
    const canvas = ref.current;
    const normalized = canvas ? normalizeViewport(canvas, world, next) : next;
    viewportRef.current = normalized;
    setViewport(normalized);
  };

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const canvas = ref.current;
      applyViewport({ zoom: canvas ? overviewZoom(canvas, world) : 1, camera: { x: 0, y: 0 } });
    });
    return () => window.cancelAnimationFrame(frame);
    // Сброс нужен только когда меняется сама сетка мира.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.config.width, world.config.height]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => drawWorldMap(canvas, world, layer, historicalState, viewportRef.current);
    draw();
    const observer = new ResizeObserver(() => {
      const current = viewportRef.current;
      const autoCentered = Math.abs(current.camera.x) < .01 && Math.abs(current.camera.y) < .01 && current.zoom <= 1.6;
      const candidate = autoCentered ? { zoom: overviewZoom(canvas, world), camera: { x: 0, y: 0 } } : current;
      const normalized = normalizeViewport(canvas, world, candidate);
      viewportRef.current = normalized;
      setViewport(normalized);
      drawWorldMap(canvas, world, layer, historicalState, normalized);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [world, layer, historicalState, viewport]);

  const beginPinch = () => {
    const canvas = ref.current;
    if (!canvas || pointers.current.size < 2) return;
    const [first, second] = [...pointers.current.values()].slice(0, 2);
    const current = viewportRef.current;
    const metrics = worldMetrics(canvas, world, current);
    const midpoint = midpointOf(first!, second!);
    const screen = { x: midpoint.x - metrics.box.left, y: midpoint.y - metrics.box.top };
    gesture.current = {
      kind: 'pinch',
      startDistance: Math.max(1, distanceBetween(first!, second!)),
      startZoom: current.zoom,
      anchor: { x: (screen.x - metrics.ox) / metrics.cell, y: (screen.y - metrics.oy) / metrics.cell },
    };
  };

  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      gesture.current = { kind: 'drag', pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, camera: { ...viewportRef.current.camera }, moved: false };
    } else if (pointers.current.size === 2) beginPinch();
  };

  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size >= 2) {
      if (gesture.current?.kind !== 'pinch') beginPinch();
      const pinch = gesture.current;
      const canvas = ref.current;
      if (!canvas || pinch?.kind !== 'pinch') return;
      const [first, second] = [...pointers.current.values()].slice(0, 2);
      const midpoint = midpointOf(first!, second!);
      const nextZoom = clamp(pinch.startZoom * distanceBetween(first!, second!) / pinch.startDistance, MIN_ZOOM, MAX_ZOOM);
      applyViewport(anchoredViewport(canvas, world, nextZoom, pinch.anchor, midpoint));
      return;
    }

    const active = gesture.current;
    if (active?.kind !== 'drag' || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.start.x;
    const dy = event.clientY - active.start.y;
    if (Math.hypot(dx, dy) > 4) active.moved = true;
    if (active.moved) applyViewport({ zoom: viewportRef.current.zoom, camera: { x: active.camera.x + dx, y: active.camera.y + dy } });
  };

  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const active = gesture.current;
    const wasTap = pointers.current.size === 1 && active?.kind === 'drag' && active.pointerId === event.pointerId && !active.moved;
    pointers.current.delete(event.pointerId);
    gesture.current = undefined;
    if (wasTap) selectAt(event.clientX, event.clientY);
  };

  const pointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(event.pointerId);
    gesture.current = undefined;
  };

  const zoomAt = (clientX: number, clientY: number, nextZoom: number) => {
    const canvas = ref.current;
    if (!canvas) return;
    const current = viewportRef.current;
    const metrics = worldMetrics(canvas, world, current);
    const anchor = {
      x: (clientX - metrics.box.left - metrics.ox) / metrics.cell,
      y: (clientY - metrics.box.top - metrics.oy) / metrics.cell,
    };
    applyViewport(anchoredViewport(canvas, world, clamp(nextZoom, MIN_ZOOM, MAX_ZOOM), anchor, { x: clientX, y: clientY }));
  };

  const wheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * .0015);
    zoomAt(event.clientX, event.clientY, viewportRef.current.zoom * factor);
  };

  const selectAt = (clientX: number, clientY: number) => {
    const canvas = ref.current;
    if (!canvas) return;
    const { box, cell, ox, oy } = worldMetrics(canvas, world, viewportRef.current);
    const px = clientX - box.left;
    const py = clientY - box.top;
    const x = Math.floor((px - ox) / cell);
    const y = Math.floor((py - oy) / cell);
    if (onOpenTile && (!historicalState || historicalState.current)) {
      const tile = world.tiles[y * world.config.width + x];
      if (tile?.x === x && tile.y === y) onOpenTile(x, y);
      return;
    }
    if (layer === 'trade') {
      const route = nearestRoute(world, px, py, cell, ox, oy, historicalState);
      if (route) { onSelect({ kind: 'tradeRoute', id: route.id }); return; }
    }
    const tile = world.tiles[y * world.config.width + x];
    if (!tile || tile.x !== x || tile.y !== y) return;
    const monster = world.monsters.find(item => monsterVisible(item.id, item.alive, historicalState) && item.x === x && item.y === y);
    if (monster) onSelect({ kind: 'monster', id: monster.id });
    else if (tile.settlementId && settlementVisible(tile.settlementId, historicalState)) onSelect({ kind: 'settlement', id: tile.settlementId });
    else if (tile.dungeonId && dungeonVisible(tile.dungeonId, historicalState)) onSelect({ kind: 'dungeon', id: tile.dungeonId });
    else {
      const tileIndex = tile.y * world.config.width + tile.x;
      const kingdomId = historicalState ? historicalState.tileKingdomIds[tileIndex] : tile.kingdomId;
      if (kingdomId) onSelect({ kind: 'kingdom', id: kingdomId });
    }
  };

  const centerClient = () => {
    const box = ref.current?.getBoundingClientRect();
    return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: 0, y: 0 };
  };

  return <div className="world-map-interactive">
    <canvas
      ref={ref}
      className={`world-canvas ${onOpenTile ? 'world-canvas-local-enabled' : ''}`}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerCancel}
      onWheel={wheel}
      onDoubleClick={event => zoomAt(event.clientX, event.clientY, viewportRef.current.zoom * 1.7)}
      aria-label={historicalState ? `Историческая карта мира Eldervale, ${historicalState.year} год` : 'Карта мира Eldervale'}
    />
    <div className="world-map-zoom" aria-label="Масштаб карты">
      <button onClick={() => { const point = centerClient(); zoomAt(point.x, point.y, viewportRef.current.zoom / 1.35); }} aria-label="Отдалить карту">−</button>
      <strong>{Math.round(viewport.zoom * 100)}%</strong>
      <button onClick={() => { const point = centerClient(); zoomAt(point.x, point.y, viewportRef.current.zoom * 1.35); }} aria-label="Приблизить карту">＋</button>
      <button className="world-map-center" onClick={() => { const canvas = ref.current; applyViewport({ zoom: canvas ? overviewZoom(canvas, world) : 1, camera: { x: 0, y: 0 } }); }}>Центр</button>
    </div>
  </div>;
}


function overviewZoom(canvas: HTMLCanvasElement, world: WorldState): number {
  if (typeof window === 'undefined' || window.innerWidth > 820) return 1;
  const box = canvas.getBoundingClientRect();
  if (!box.width || !box.height) return 1;
  const portraitPressure = box.height * world.config.width / Math.max(1, box.width * world.config.height);
  return clamp(portraitPressure * .88, 1, 1.85);
}

function drawWorldMap(canvas: HTMLCanvasElement, world: WorldState, layer: MapLayer, historicalState: AtlasMapState | undefined, viewport: Viewport) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { box, cell, ox, oy } = worldMetrics(canvas, world, viewport);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.floor(box.width * dpr));
  canvas.height = Math.max(1, Math.floor(box.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, box.width, box.height);
  ctx.fillStyle = '#0b120e';
  ctx.fillRect(0, 0, box.width, box.height);

  const startX = Math.max(0, Math.floor((-ox) / cell) - 1);
  const startY = Math.max(0, Math.floor((-oy) / cell) - 1);
  const endX = Math.min(world.config.width - 1, Math.ceil((box.width - ox) / cell) + 1);
  const endY = Math.min(world.config.height - 1, Math.ceil((box.height - oy) / cell) + 1);
  const animalByTile = new Map<string, number>();
  const resourceByTile = new Map<string, number>();
  for (const population of world.animalPopulations) animalByTile.set(`${population.x}:${population.y}`, (animalByTile.get(`${population.x}:${population.y}`) ?? 0) + population.count);
  for (const ingredient of world.ingredients) resourceByTile.set(`${ingredient.x}:${ingredient.y}`, (resourceByTile.get(`${ingredient.x}:${ingredient.y}`) ?? 0) + ingredient.abundance);

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const index = y * world.config.width + x;
      const tile = world.tiles[index];
      if (!tile) continue;
      const historicalOwner = historicalState?.tileKingdomIds[index];
      let fill = terrainColor(tile.terrain);
      if (layer === 'realms' && tile.terrain !== 'ocean') {
        const ownerId = historicalState ? historicalOwner : tile.kingdomId;
        fill = world.kingdoms.find(kingdom => kingdom.id === ownerId)?.color
          ?? world.history.fallenRealms.find(realm => realm.formerKingdomId === ownerId)?.color
          ?? fill;
      }
      if (layer === 'danger' && tile.terrain !== 'ocean') {
        const monster = world.monsters.find(item => monsterVisible(item.id, item.alive, historicalState) && Math.hypot(item.x - tile.x, item.y - tile.y) <= item.territoryRadius);
        fill = monster ? (monster.species === 'dragon' ? '#8e3f35' : '#6d4a57') : '#526a57';
      }
      if (layer === 'population' && tile.terrain !== 'ocean') {
        const settlement = tile.settlementId ? world.settlements.find(item => item.id === tile.settlementId && settlementVisible(item.id, historicalState)) : undefined;
        const population = settlement ? historicalState?.settlementPopulations.get(settlement.id) ?? settlement.population : 0;
        fill = settlement ? (population > 400 ? '#e1c078' : population > 150 ? '#a58f62' : '#6d795c') : '#34463c';
      }
      if (layer === 'trade' && tile.terrain !== 'ocean') fill = tile.terrain === 'mountains' ? '#2e322f' : '#26362e';
      if (layer === 'ecology' && tile.terrain !== 'ocean') {
        const animals = animalByTile.get(`${tile.x}:${tile.y}`) ?? 0;
        const resources = resourceByTile.get(`${tile.x}:${tile.y}`) ?? 0;
        const richness = Math.min(1, animals / 180 + resources / 220);
        fill = richness > .8 ? '#4f7f55' : richness > .45 ? '#526c4d' : richness > .15 ? '#475846' : '#303b35';
      }
      paintGlobalTile(ctx, tile.terrain, ox + tile.x * cell, oy + tile.y * cell, cell, (tile.x + 1) * 73856093 ^ (tile.y + 1) * 19349663, layer === 'terrain' ? undefined : fill);
    }
  }

  if (cell >= 11) {
    ctx.strokeStyle = 'rgba(9,14,11,.28)';
    ctx.lineWidth = Math.min(1.2, cell * .035);
    for (let x = startX; x <= endX + 1; x += 1) {
      ctx.beginPath(); ctx.moveTo(ox + x * cell, Math.max(0, oy + startY * cell)); ctx.lineTo(ox + x * cell, Math.min(box.height, oy + (endY + 1) * cell)); ctx.stroke();
    }
    for (let y = startY; y <= endY + 1; y += 1) {
      ctx.beginPath(); ctx.moveTo(Math.max(0, ox + startX * cell), oy + y * cell); ctx.lineTo(Math.min(box.width, ox + (endX + 1) * cell), oy + y * cell); ctx.stroke();
    }
  }

  drawTradeRoutes(ctx, world, layer, cell, ox, oy, historicalState);

  ctx.strokeStyle = 'rgba(232,216,173,.12)';
  ctx.lineWidth = 1;
  for (const settlement of world.settlements.filter(item => settlementVisible(item.id, historicalState) && item.x >= startX - 1 && item.x <= endX + 1 && item.y >= startY - 1 && item.y <= endY + 1)) {
    const x = ox + (settlement.x + .5) * cell;
    const y = oy + (settlement.y + .5) * cell;
    const population = historicalState?.settlementPopulations.get(settlement.id) ?? settlement.population;
    const radius = Math.max(2.5, Math.min(9, 2.2 + Math.sqrt(population) / 4.2 + Math.min(2, viewport.zoom * .18)));
    const marker: LocalMarker = { id: `settlement-${settlement.id}`, x: 0, y: 0, kind: 'settlement', label: settlement.name, refs: [{ kind: 'settlement', id: settlement.id }] };
    ctx.save();
    ctx.translate(x - radius, y - radius);
    paintTextureMarker(ctx, marker, 0, 0, radius * 2);
    ctx.restore();
  }
  for (const dungeon of world.dungeons.filter(item => dungeonVisible(item.id, historicalState) && item.x >= startX - 1 && item.x <= endX + 1 && item.y >= startY - 1 && item.y <= endY + 1)) {
    const x = ox + (dungeon.x + .5) * cell;
    const y = oy + (dungeon.y + .5) * cell;
    const size = Math.min(7, Math.max(3.6, cell * .22));
    ctx.save(); ctx.globalAlpha = dungeon.discovered ? 1 : .35;
    paintTextureMarker(ctx, { id: `dungeon-${dungeon.id}`, x: 0, y: 0, kind: 'dungeon', label: dungeon.name, refs: [{ kind: 'dungeon', id: dungeon.id }] }, x - size, y - size, size * 2);
    ctx.restore();
  }
  if (!historicalState || historicalState.current) {
    for (const cemetery of world.cemeteries.filter(item => item.globalX >= startX - 1 && item.globalX <= endX + 1 && item.globalY >= startY - 1 && item.globalY <= endY + 1)) {
      const x = ox + (cemetery.globalX + .5) * cell;
      const y = oy + (cemetery.globalY + .5) * cell;
      const size = Math.min(6, Math.max(2.8, cell * .16));
      paintTextureMarker(ctx, { id: `cemetery-${cemetery.id}`, x: 0, y: 0, kind: 'cemetery', label: cemetery.name, refs: [{ kind: 'cemetery', id: cemetery.id }], count: cemetery.burialIds.length }, x - size, y - size, size * 2);
    }
  }
  for (const monster of world.monsters.filter(item => monsterVisible(item.id, item.alive, historicalState) && item.x >= startX - 2 && item.x <= endX + 2 && item.y >= startY - 2 && item.y <= endY + 2)) {
    const x = ox + (monster.x + .5) * cell;
    const y = oy + (monster.y + .5) * cell;
    const radius = Math.min(9, Math.max(4.5, cell * .25));
    paintTextureMarker(ctx, { id: `monster-${monster.id}`, x: 0, y: 0, kind: 'monster', label: monster.name, refs: [{ kind: 'monster', id: monster.id }], footprintWidth: Math.max(1, Math.min(3, monster.footprintWidth)), footprintHeight: Math.max(1, Math.min(3, monster.footprintHeight)) }, x - radius, y - radius, radius * 2 / Math.max(1, Math.min(3, monster.footprintWidth)));
    if (layer === 'danger') {
      ctx.strokeStyle = monster.species === 'dragon' ? 'rgba(255,139,92,.3)' : 'rgba(199,121,129,.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(8, monster.territoryRadius * cell), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  if (!historicalState || historicalState.current) {
    for (const army of world.armies.filter(item => (item.status === 'marching' || item.status === 'hunting') && item.x >= startX - 1 && item.x <= endX + 1 && item.y >= startY - 1 && item.y <= endY + 1)) {
      const x = ox + (army.x + .5) * cell;
      const y = oy + (army.y + .5) * cell;
      const radius = Math.min(9, Math.max(4, cell * .22));
      paintTextureMarker(ctx, { id: `army-${army.id}`, x: 0, y: 0, kind: 'army', label: army.name, refs: [{ kind: 'army', id: army.id }], count: army.soldierIds?.length ?? army.strength, visualRole: 'army' }, x - radius, y - radius, radius * 2);
    }
    for (const wagon of (world.supplyWagons ?? []).filter(item => item.status !== 'уничтожен' && item.status !== 'склад' && item.x >= startX - 1 && item.x <= endX + 1 && item.y >= startY - 1 && item.y <= endY + 1)) {
      const x = ox + (wagon.x + .62) * cell;
      const y = oy + (wagon.y + .62) * cell;
      const radius = Math.min(7, Math.max(3.6, cell * .18));
      paintTextureMarker(ctx, { id: `wagon-${wagon.id}`, x: 0, y: 0, kind: 'army', label: `Военный обоз №${wagon.id}`, refs: [{ kind: 'supplyWagon', id: wagon.id }], count: wagon.wagonCount, visualRole: 'wagon' }, x - radius, y - radius, radius * 2);
    }
  }
}

function worldMetrics(canvas: HTMLCanvasElement, world: WorldState, viewport: Viewport) {
  const box = canvas.getBoundingClientRect();
  const fitCell = Math.min(box.width / world.config.width, box.height / world.config.height);
  const cell = Math.max(.01, fitCell * viewport.zoom);
  const baseX = (box.width - cell * world.config.width) / 2;
  const baseY = (box.height - cell * world.config.height) / 2;
  return { box, cell, baseX, baseY, ox: baseX + viewport.camera.x, oy: baseY + viewport.camera.y };
}

function normalizeViewport(canvas: HTMLCanvasElement, world: WorldState, viewport: Viewport): Viewport {
  const zoom = clamp(viewport.zoom, MIN_ZOOM, MAX_ZOOM);
  const box = canvas.getBoundingClientRect();
  const fitCell = Math.min(box.width / world.config.width, box.height / world.config.height);
  const cell = fitCell * zoom;
  const mapWidth = world.config.width * cell;
  const mapHeight = world.config.height * cell;
  const baseX = (box.width - mapWidth) / 2;
  const baseY = (box.height - mapHeight) / 2;
  return { zoom, camera: clampCamera(box.width, box.height, mapWidth, mapHeight, baseX, baseY, viewport.camera) };
}

function anchoredViewport(canvas: HTMLCanvasElement, world: WorldState, zoom: number, anchor: Point, clientMidpoint: Point): Viewport {
  const box = canvas.getBoundingClientRect();
  const fitCell = Math.min(box.width / world.config.width, box.height / world.config.height);
  const cell = fitCell * zoom;
  const mapWidth = world.config.width * cell;
  const mapHeight = world.config.height * cell;
  const baseX = (box.width - mapWidth) / 2;
  const baseY = (box.height - mapHeight) / 2;
  const screenX = clientMidpoint.x - box.left;
  const screenY = clientMidpoint.y - box.top;
  return normalizeViewport(canvas, world, { zoom, camera: { x: screenX - anchor.x * cell - baseX, y: screenY - anchor.y * cell - baseY } });
}

function clampCamera(boxWidth: number, boxHeight: number, mapWidth: number, mapHeight: number, baseX: number, baseY: number, camera: Point): Point {
  const margin = Math.max(28, Math.min(72, Math.min(boxWidth, boxHeight) * .13));
  const x = mapWidth <= boxWidth ? 0 : clamp(camera.x, margin - mapWidth - baseX, boxWidth - margin - baseX);
  const y = mapHeight <= boxHeight ? 0 : clamp(camera.y, margin - mapHeight - baseY, boxHeight - margin - baseY);
  return { x, y };
}

function settlementVisible(id: number, state?: AtlasMapState): boolean {
  return state ? state.visibleSettlementIds.has(id) : true;
}
function dungeonVisible(id: number, state?: AtlasMapState): boolean {
  return state ? state.visibleDungeonIds.has(id) : true;
}
function monsterVisible(id: number, alive: boolean, state?: AtlasMapState): boolean {
  return state ? state.visibleMonsterIds.has(id) : alive;
}

function drawTradeRoutes(ctx: CanvasRenderingContext2D, world: WorldState, layer: MapLayer, cell: number, ox: number, oy: number, historicalState?: AtlasMapState) {
  for (const route of world.tradeRoutes.filter(item => !historicalState || historicalState.visibleTradeRouteIds.has(item.id))) {
    const from = world.settlements.find(item => item.id === route.fromSettlementId);
    const to = world.settlements.find(item => item.id === route.toSettlementId);
    if (!from || !to) continue;
    ctx.strokeStyle = route.active
      ? layer === 'trade' ? `rgba(235,199,111,${.28 + route.safety / 180})` : 'rgba(220,193,126,.08)'
      : layer === 'trade' ? 'rgba(177,82,62,.55)' : 'rgba(177,82,62,.05)';
    ctx.lineWidth = layer === 'trade' ? Math.max(1, route.volume / 32) : .7;
    if (!route.active) ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(ox + (from.x + .5) * cell, oy + (from.y + .5) * cell);
    ctx.lineTo(ox + (to.x + .5) * cell, oy + (to.y + .5) * cell);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function nearestRoute(world: WorldState, px: number, py: number, cell: number, ox: number, oy: number, historicalState?: AtlasMapState): TradeRoute | undefined {
  return world.tradeRoutes.filter(route => !historicalState || historicalState.visibleTradeRouteIds.has(route.id)).map(route => {
    const from = world.settlements.find(item => item.id === route.fromSettlementId)!;
    const to = world.settlements.find(item => item.id === route.toSettlementId)!;
    const ax = ox + (from.x + .5) * cell;
    const ay = oy + (from.y + .5) * cell;
    const bx = ox + (to.x + .5) * cell;
    const by = oy + (to.y + .5) * cell;
    return { route, distance: pointToSegment(px, py, ax, ay, bx, by) };
  }).sort((a, b) => a.distance - b.distance).find(item => item.distance <= 12)?.route;
}

function pointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const distanceBetween = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpointOf = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
