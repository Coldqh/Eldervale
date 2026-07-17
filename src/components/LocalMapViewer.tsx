import { useEffect, useMemo, useRef, useState } from 'react';
import type { EntityRef, LocalFeature, LocalGround, LocalMapData, LocalMarker, WorldState } from '../types';
import { generateLocalMap, localCellSummary } from '../lib/localMap';
import { paintFeature as paintTextureFeature, paintLocalCell, paintMarker as paintTextureMarker } from '../lib/texturePaint';
import { TextureIcon } from './TextureIcon';

const groundColors: Record<LocalGround, string> = {
  grass: '#617853', dirt: '#745e43', sand: '#a58a5f', water: '#244d59', mud: '#4b5d50', snow: '#aeb7b3', stone: '#656862', road: '#8a7352', floor: '#8c7c64', ash: '#423f3a',
};
const featureColors: Partial<Record<LocalFeature, string>> = {
  tree: '#214d32', bush: '#375e3f', rock: '#3e4140', reeds: '#6b7951', wall: '#292d2b', door: '#bb9a5f', field: '#9b8150', rubble: '#080808', looted: '#020202', fire: '#e87842', trash: '#15100b', blood: '#3d1515', body: '#000000', chest: '#d2aa5a',
  'stairs-down': '#d2bd83', 'stairs-up': '#e6d69f', bridge: '#7b6042', herb: '#75a95f', berry: '#9b4f6b', mushroom: '#b49a73', 'animal-trail': '#7b674c',
};
const LOCAL_MIN_ZOOM = .65;
const LOCAL_MAX_ZOOM = 12;

const markerColors: Record<LocalMarker['kind'], string> = {
  person: '#f2dfae', patrol: '#9fb5a7', group: '#d9c28d', army: '#ded8c5', camp: '#9a825d', monster: '#f07b59', settlement: '#e2bb68', dungeon: '#aa92c2', artifact: '#e6d46d', effect: '#080808', fauna: '#86a76a', resource: '#80b89a', building: '#8e8068', establishment: '#d7a95b', field: '#a9b85c', construction: '#c28b54', cemetery: '#171917', grave: '#050505', item: '#d8bd65', corpse: '#000000', merchant: '#d6a75d',
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
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | undefined>(undefined);
  const map = useMemo(() => generateLocalMap(world, globalX, globalY, level), [world, globalX, globalY, level]);
  const summary = useMemo(() => selectedCell ? localCellSummary(map, selectedCell.x, selectedCell.y) : { title: 'Выбери клетку', lines: ['Первое нажатие показывает содержимое клетки. Повторное открывает главную сущность.'], markers: [] }, [map, selectedCell]);

  useEffect(() => {
    if (!map.availableLevels.includes(level)) setLevel(0);
    setCamera({ x: 0, y: 0 });
    setZoom(1);
    setSelectedCell(undefined);
  }, [map.key]);

  const move = (dx: number, dy: number) => {
    const x = globalX + dx;
    const y = globalY + dy;
    if (x < 0 || y < 0 || x >= world.config.width || y >= world.config.height) return;
    setLevel(0);
    onMove(x, y, 0);
  };

  const handleCellTap = (cell: { x: number; y: number }) => {
    const repeated = Boolean(selectedCell && selectedCell.x === cell.x && selectedCell.y === cell.y);
    if (!repeated) {
      setSelectedCell(cell);
      return;
    }
    const ref = preferredEntityRef(localCellSummary(map, cell.x, cell.y).markers);
    if (ref) onSelect(ref);
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
          <div className="local-zoom-controls"><button onClick={() => setZoom(value => Math.max(LOCAL_MIN_ZOOM, value / 1.35))}>−</button><strong>{Math.round(zoom * 100)}%</strong><button onClick={() => setZoom(value => Math.min(LOCAL_MAX_ZOOM, value * 1.35))}>＋</button><button onClick={() => { setZoom(1); setCamera({ x: 0, y: 0 }); }}>Центр</button></div>
        </div>
        <LocalCanvas map={map} zoom={zoom} camera={camera} onViewport={value => { setZoom(value.zoom); setCamera(value.camera); }} selected={selectedCell} onSelectCell={handleCellTap} />
        <div className="local-map-footnote"><span>Перетаскивай карту одним пальцем, растягивай двумя. Максимальный масштаб показывает клетки почти вплотную.</span><span>База восстанавливается из seed, история хранится отдельными изменениями: {world.localMapChanges.filter(effect => effect.globalX === globalX && effect.globalY === globalY).length}</span></div>
      </div>

      <aside className={`window-card local-inspector ${selectedCell ? 'is-open' : ''}`}>
        <div className="local-inspector-grip" aria-hidden="true" />
        <button className="local-inspector-close" onClick={() => setSelectedCell(undefined)} aria-label="Закрыть информацию о клетке">×</button>
        <div className="local-inspector-heading"><span className="eyebrow">{selectedCell ? `Клетка ${selectedCell.x}:${selectedCell.y}` : 'Локальная карта'}</span><h2>{summary.title}</h2></div>
        <div className="local-inspector-lines">{summary.lines.map(line => <p key={line}>{line}</p>)}</div>
        {summary.markers.length > 0 && <div className="local-marker-list">
          <h3>Существа и объекты</h3>
          {summary.markers.map(marker => <MarkerCard key={marker.id} marker={marker} world={world} onSelect={onSelect} />)}
        </div>}
        <div className="local-legend">
          <h3>Обозначения</h3>
          <div>{Object.entries(markerColors).filter(([kind]) => kind !== 'group' && kind !== 'patrol').map(([kind, color]) => <span key={kind}><i style={{ background: color }} />{markerLabel(kind as LocalMarker['kind'])}</span>)}</div>
        </div>
      </aside>
    </div>
  </section>;
}

function LocalCanvas({ map, zoom, camera, onViewport, selected, onSelectCell }: {
  map: LocalMapData;
  zoom: number;
  camera: { x: number; y: number };
  onViewport: (value: { zoom: number; camera: { x: number; y: number } }) => void;
  selected?: { x: number; y: number };
  onSelectCell: (value: { x: number; y: number }) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef({ zoom, camera });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: 'drag'; pointerId: number; startX: number; startY: number; cameraX: number; cameraY: number; moved: boolean }
    | { kind: 'pinch'; startDistance: number; startZoom: number; anchorX: number; anchorY: number }
    | undefined
  >(undefined);

  useEffect(() => {
    viewportRef.current = { zoom, camera };
  }, [zoom, camera]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => drawLocalMap(canvas, map, zoom, camera, selected);
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [map, zoom, camera, selected]);

  const metrics = (viewport = viewportRef.current) => {
    const canvas = ref.current!;
    const box = canvas.getBoundingClientRect();
    const base = Math.min(box.width / map.width, box.height / map.height);
    const cell = Math.max(4, base * viewport.zoom);
    const mapWidth = map.width * cell;
    const mapHeight = map.height * cell;
    const baseX = (box.width - mapWidth) / 2;
    const baseY = (box.height - mapHeight) / 2;
    return { box, base, cell, mapWidth, mapHeight, baseX, baseY, ox: baseX + viewport.camera.x, oy: baseY + viewport.camera.y };
  };

  const normalizeViewport = (value: { zoom: number; camera: { x: number; y: number } }) => {
    const zoomValue = Math.max(LOCAL_MIN_ZOOM, Math.min(LOCAL_MAX_ZOOM, value.zoom));
    const current = metrics({ zoom: zoomValue, camera: value.camera });
    const margin = Math.max(26, Math.min(70, Math.min(current.box.width, current.box.height) * .12));
    const cameraX = current.mapWidth <= current.box.width ? 0 : Math.max(margin - current.mapWidth - current.baseX, Math.min(current.box.width - margin - current.baseX, value.camera.x));
    const cameraY = current.mapHeight <= current.box.height ? 0 : Math.max(margin - current.mapHeight - current.baseY, Math.min(current.box.height - margin - current.baseY, value.camera.y));
    return { zoom: zoomValue, camera: { x: cameraX, y: cameraY } };
  };

  const applyViewport = (value: { zoom: number; camera: { x: number; y: number } }) => {
    const next = normalizeViewport(value);
    viewportRef.current = next;
    onViewport(next);
  };

  const beginPinch = () => {
    if (pointers.current.size < 2) return;
    const [first, second] = [...pointers.current.values()].slice(0, 2);
    const current = metrics();
    const midpointX = (first!.x + second!.x) / 2;
    const midpointY = (first!.y + second!.y) / 2;
    gesture.current = {
      kind: 'pinch',
      startDistance: Math.max(1, Math.hypot(first!.x - second!.x, first!.y - second!.y)),
      startZoom: viewportRef.current.zoom,
      anchorX: (midpointX - current.box.left - current.ox) / current.cell,
      anchorY: (midpointY - current.box.top - current.oy) / current.cell,
    };
  };

  const zoomAt = (clientX: number, clientY: number, nextZoom: number) => {
    const current = metrics();
    const anchorX = (clientX - current.box.left - current.ox) / current.cell;
    const anchorY = (clientY - current.box.top - current.oy) / current.cell;
    const zoomValue = Math.max(LOCAL_MIN_ZOOM, Math.min(LOCAL_MAX_ZOOM, nextZoom));
    const next = metrics({ zoom: zoomValue, camera: viewportRef.current.camera });
    applyViewport({
      zoom: zoomValue,
      camera: {
        x: clientX - next.box.left - anchorX * next.cell - next.baseX,
        y: clientY - next.box.top - anchorY * next.cell - next.baseY,
      },
    });
  };

  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      gesture.current = { kind: 'drag', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, cameraX: viewportRef.current.camera.x, cameraY: viewportRef.current.camera.y, moved: false };
    } else if (pointers.current.size === 2) beginPinch();
  };

  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size >= 2) {
      if (gesture.current?.kind !== 'pinch') beginPinch();
      const pinch = gesture.current;
      if (pinch?.kind !== 'pinch') return;
      const [first, second] = [...pointers.current.values()].slice(0, 2);
      const midpointX = (first!.x + second!.x) / 2;
      const midpointY = (first!.y + second!.y) / 2;
      const distance = Math.max(1, Math.hypot(first!.x - second!.x, first!.y - second!.y));
      const zoomValue = Math.max(LOCAL_MIN_ZOOM, Math.min(LOCAL_MAX_ZOOM, pinch.startZoom * distance / pinch.startDistance));
      const next = metrics({ zoom: zoomValue, camera: viewportRef.current.camera });
      applyViewport({
        zoom: zoomValue,
        camera: {
          x: midpointX - next.box.left - pinch.anchorX * next.cell - next.baseX,
          y: midpointY - next.box.top - pinch.anchorY * next.cell - next.baseY,
        },
      });
      return;
    }

    const active = gesture.current;
    if (active?.kind !== 'drag' || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (Math.hypot(dx, dy) > 4) active.moved = true;
    if (active.moved) applyViewport({ zoom: viewportRef.current.zoom, camera: { x: active.cameraX + dx, y: active.cameraY + dy } });
  };

  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const active = gesture.current;
    const wasTap = pointers.current.size === 1 && active?.kind === 'drag' && active.pointerId === event.pointerId && !active.moved;
    pointers.current.delete(event.pointerId);
    gesture.current = undefined;
    if (!wasTap) return;
    const { box, cell, ox, oy } = metrics();
    const x = Math.floor((event.clientX - box.left - ox) / cell);
    const y = Math.floor((event.clientY - box.top - oy) / cell);
    if (x >= 0 && y >= 0 && x < map.width && y < map.height) onSelectCell({ x, y });
  };

  const pointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(event.pointerId);
    gesture.current = undefined;
  };

  const wheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, viewportRef.current.zoom * Math.exp(-event.deltaY * .0015));
  };

  return <canvas
    ref={ref}
    className="local-map-canvas"
    onPointerDown={pointerDown}
    onPointerMove={pointerMove}
    onPointerUp={pointerUp}
    onPointerCancel={pointerCancel}
    onWheel={wheel}
    aria-label={`Локальная карта квадрата ${map.globalX}:${map.globalY}`}
  />;
}

function drawLocalMap(canvas: HTMLCanvasElement, map: LocalMapData, zoom: number, camera: { x: number; y: number }, selected?: { x: number; y: number }) {
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
      paintLocalCell(ctx, cell.ground, x, y, cellSize, (cell.x + 1) * 73856093 ^ (cell.y + 1) * 19349663);
      if (cell.feature) paintTextureFeature(ctx, cell.feature, x, y, cellSize);
    }
  }
  if (cellSize >= 8) {
    ctx.strokeStyle = 'rgba(7,12,9,.16)';
    ctx.lineWidth = .5;
    for (let x = startX; x <= endX + 1; x += 1) { ctx.beginPath(); ctx.moveTo(ox + x * cellSize, Math.max(0, oy + startY * cellSize)); ctx.lineTo(ox + x * cellSize, Math.min(box.height, oy + (endY + 1) * cellSize)); ctx.stroke(); }
    for (let y = startY; y <= endY + 1; y += 1) { ctx.beginPath(); ctx.moveTo(Math.max(0, ox + startX * cellSize), oy + y * cellSize); ctx.lineTo(Math.min(box.width, ox + (endX + 1) * cellSize), oy + y * cellSize); ctx.stroke(); }
  }

  for (const marker of map.markers) {
    if (marker.kind === 'building' || marker.kind === 'establishment' || marker.kind === 'field' || marker.kind === 'resource') continue;
    const footprintWidth = marker.footprintWidth ?? 1;
    const footprintHeight = marker.footprintHeight ?? 1;
    if (marker.x + footprintWidth < startX || marker.x > endX || marker.y + footprintHeight < startY || marker.y > endY) continue;
    const visualSize = markerVisualSize(marker, cellSize);
    const x = ox + marker.x * cellSize + (footprintWidth * cellSize - footprintWidth * visualSize) / 2;
    const y = oy + marker.y * cellSize + (footprintHeight * cellSize - footprintHeight * visualSize) / 2;
    drawMarker(ctx, marker, x, y, visualSize);
  }
  if (selected) {
    ctx.strokeStyle = '#f4d889';
    ctx.lineWidth = Math.max(1.5, cellSize * .13);
    ctx.strokeRect(ox + selected.x * cellSize + 1, oy + selected.y * cellSize + 1, Math.max(1, cellSize - 2), Math.max(1, cellSize - 2));
  }
}

function drawFeature(ctx: CanvasRenderingContext2D, feature: LocalFeature, x: number, y: number, size: number) {
  paintTextureFeature(ctx, feature, x, y, size);
}

function markerVisualSize(marker: LocalMarker, cellSize: number): number {
  const important = ['person', 'patrol', 'group', 'monster', 'army', 'merchant', 'item', 'artifact', 'resource'].includes(marker.kind);
  if (!important || cellSize >= 11) return cellSize;
  const boost = marker.kind === 'resource' ? .38 : .58;
  return Math.min(12, cellSize + (11 - cellSize) * boost);
}

function preferredEntityRef(markers: LocalMarker[]): EntityRef | undefined {
  const priority: Record<LocalMarker['kind'], number> = {
    person: 100, patrol: 97, group: 100, merchant: 95, monster: 90, army: 80, camp: 64, corpse: 76, item: 72, artifact: 70,
    establishment: 62, construction: 58, building: 55, field: 42, cemetery: 50, grave: 48, dungeon: 45, fauna: 40,
    resource: 35, settlement: 30, effect: 20,
  };
  const marker = [...markers].sort((a, b) => priority[b.kind] - priority[a.kind] || a.id.localeCompare(b.id))[0];
  if (!marker) return undefined;
  if (marker.kind === 'person' || marker.kind === 'group') return marker.refs.find(ref => ref.kind === 'character');
  if (marker.kind === 'establishment' || marker.kind === 'building') {
    return marker.refs.find(ref => ref.kind === 'character')
      ?? marker.refs.find(ref => ref.kind === 'establishment')
      ?? marker.refs.find(ref => ref.kind === 'building')
      ?? marker.refs[0];
  }
  return marker.refs[0];
}

function drawMarker(ctx: CanvasRenderingContext2D, marker: LocalMarker, x0: number, y0: number, size: number) {
  paintTextureMarker(ctx, marker, x0, y0, size);
}

function MarkerCard({ marker, world, onSelect }: { marker: LocalMarker; world: WorldState; onSelect: (ref: EntityRef) => void }) {
  const iconKind = marker.kind === 'corpse' ? 'corpse' : marker.kind === 'grave' ? 'grave' : marker.kind === 'cemetery' ? 'cemetery' : marker.kind === 'item' ? 'item' : marker.kind === 'merchant' ? 'travelingMerchant' : marker.kind === 'person' || marker.kind === 'group' ? 'character' : marker.kind === 'patrol' ? 'patrol' : marker.kind === 'building' || marker.kind === 'establishment' || marker.kind === 'settlement' ? 'building' : marker.kind === 'field' ? 'field' : marker.kind === 'construction' ? 'constructionProject' : marker.kind === 'monster' ? 'monster' : marker.kind === 'army' || marker.kind === 'camp' ? 'army' : marker.kind === 'artifact' ? 'artifact' : marker.kind === 'resource' ? 'ingredient' : marker.kind === 'dungeon' ? 'dungeon' : 'terrain';
  return <div className="local-marker-card">
    <div><TextureIcon kind={iconKind} subtype={marker.visualRole} /><span><strong>{marker.label}</strong>{marker.detail && <small>{marker.detail}</small>}</span></div>
    {marker.refs.length > 0 && <div className="local-marker-actions">
      {marker.refs.slice(0, 12).map(ref => <button key={`${ref.kind}-${ref.id}`} onClick={() => onSelect(ref)}>{entityName(world, ref)}</button>)}
      {marker.refs.length > 12 && <small>ещё {marker.refs.length - 12}</small>}
    </div>}
  </div>;
}

function entityName(world: WorldState, ref: EntityRef): string {
  const collections: Record<EntityRef['kind'], readonly { id: number; name?: string; title?: string }[]> = {
    kingdom: world.kingdoms, settlement: world.settlements, character: world.characters, army: world.armies, battleRecord: world.battleRecords, monster: world.monsters,
    artifact: world.artifacts, book: world.books, dungeon: world.dungeons, war: world.wars, dynasty: world.dynasties, tradeRoute: world.tradeRoutes,
    animalPopulation: world.animalPopulations, ingredient: world.ingredients, recipe: world.alchemyRecipes, building: world.buildings, household: world.households, establishment: world.establishments, item: world.items, productionRecipe: world.productionRecipes, field: world.fields, constructionProject: world.constructionProjects, cemetery: world.cemeteries, burial: world.burials, travelingMerchant: world.travelingMerchants, militaryUnit: world.militaryUnits, supplyWagon: world.supplyWagons, knowledgeFact: world.knowledgeFacts, rumor: world.rumors, message: world.messages, settlementGovernment: world.settlementGovernments, districtCivic: world.districtCivicStates, patrol: world.civicPatrols, crime: world.crimes, courtCase: world.courtCases, fireIncident: world.fireIncidents, kingdomGovernment: world.kingdomGovernments, nobleTitle: world.nobleTitles, vassalContract: world.vassalContracts, courtOffice: world.courtOffices, courtFaction: world.courtFactions, royalOrder: world.royalOrders, stateCrisis: world.stateCrises, diplomaticAgreement: world.diplomaticAgreements,
  };
  let entity = collections[ref.kind].find(item => item.id === ref.id);
  if (!entity && (ref.kind === 'character' || ref.kind === 'monster')) entity = world.burials.find(item => item.subjectKind === ref.kind && item.subjectId === ref.id);
  if (ref.kind === 'battleRecord') return `сражение №${ref.id}`;
  if (ref.kind === 'knowledgeFact') return world.knowledgeFacts.find(item => item.id === ref.id)?.statement ?? `знание ${ref.id}`;
  if (ref.kind === 'rumor') return world.rumors.find(item => item.id === ref.id)?.text ?? `слух ${ref.id}`;
  if (ref.kind === 'settlementGovernment') return `власть ${ref.id}`;
  if (ref.kind === 'districtCivic') return world.districtCivicStates.find(item => item.id === ref.id)?.districtName ?? `район ${ref.id}`;
  if (ref.kind === 'patrol') return `патруль ${ref.id}`;
  if (ref.kind === 'crime') return world.crimes.find(item => item.id === ref.id)?.type ?? `преступление ${ref.id}`;
  if (ref.kind === 'courtCase') return `судебное дело ${ref.id}`;
  if (ref.kind === 'fireIncident') return `пожар ${ref.id}`;
  if (ref.kind === 'message') return `${world.messages.find(item => item.id === ref.id)?.kind ?? 'сообщение'} ${ref.id}`;
  return entity?.name ?? entity?.title ?? `${ref.kind} ${ref.id}`;
}

function markerLabel(kind: LocalMarker['kind']): string {
  return ({ person: 'житель', patrol: 'патруль стражи', group: 'группа жителей', army: 'армия', camp: 'полевое сооружение', monster: 'чудовище', settlement: 'центр поселения', dungeon: 'подземелье', artifact: 'артефакт', effect: 'след события', fauna: 'животное', resource: 'природный ресурс', building: 'здание', establishment: 'заведение', field: 'поле', construction: 'стройплощадка', cemetery: 'кладбище', grave: 'могила', item: 'предмет', corpse: 'тело', merchant: 'странствующий торговец' } as const)[kind];
}
