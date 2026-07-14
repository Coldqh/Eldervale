import { useEffect, useRef } from 'react';
import type { EntityRef, Terrain, TradeRoute, WorldState } from '../types';

export type MapLayer = 'terrain' | 'realms' | 'danger' | 'population' | 'trade';
const terrainColors: Record<Terrain, string> = {
  ocean: '#172b32', coast: '#496b69', plains: '#75865f', forest: '#3d624a', hills: '#776f53', mountains: '#6f706b', marsh: '#46675d', desert: '#9a8259', tundra: '#89918b',
};

export function WorldMap({ world, layer, onSelect }: { world: WorldState; layer: MapLayer; onSelect: (ref: EntityRef) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const draw = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(box.width * dpr);
      canvas.height = Math.floor(box.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, box.width, box.height);
      const cell = Math.min(box.width / world.config.width, box.height / world.config.height);
      const ox = (box.width - cell * world.config.width) / 2;
      const oy = (box.height - cell * world.config.height) / 2;

      for (const tile of world.tiles) {
        let fill = terrainColors[tile.terrain];
        if (layer === 'realms' && tile.terrain !== 'ocean') fill = world.kingdoms.find(kingdom => kingdom.id === tile.kingdomId)?.color ?? fill;
        if (layer === 'danger' && tile.terrain !== 'ocean') {
          const monster = world.monsters.find(item => item.alive && Math.hypot(item.x - tile.x, item.y - tile.y) <= item.territoryRadius);
          fill = monster ? (monster.species === 'dragon' ? '#8e3f35' : '#6d4a57') : '#526a57';
        }
        if (layer === 'population' && tile.terrain !== 'ocean') {
          const settlement = world.settlements.find(item => item.id === tile.settlementId);
          fill = settlement ? (settlement.population > 400 ? '#e1c078' : settlement.population > 150 ? '#a58f62' : '#6d795c') : '#34463c';
        }
        if (layer === 'trade' && tile.terrain !== 'ocean') fill = tile.terrain === 'mountains' ? '#2e322f' : '#26362e';
        ctx.fillStyle = fill;
        ctx.fillRect(ox + tile.x * cell, oy + tile.y * cell, Math.ceil(cell + .35), Math.ceil(cell + .35));
      }

      drawTradeRoutes(ctx, world, layer, cell, ox, oy);

      ctx.strokeStyle = 'rgba(232,216,173,.12)';
      ctx.lineWidth = 1;
      for (const settlement of world.settlements) {
        const x = ox + (settlement.x + .5) * cell;
        const y = oy + (settlement.y + .5) * cell;
        const radius = Math.max(2.5, Math.min(7, 2.2 + Math.sqrt(settlement.population) / 4.2));
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = settlement.shortages.length ? '#ef9a66' : settlement.damaged > 55 ? '#d06a4d' : '#f0db9b';
        ctx.fill();
        ctx.strokeStyle = '#171b15';
        ctx.stroke();
      }
      for (const dungeon of world.dungeons) {
        const x = ox + (dungeon.x + .5) * cell;
        const y = oy + (dungeon.y + .5) * cell;
        ctx.fillStyle = dungeon.discovered ? '#d8c7a0' : 'rgba(216,199,160,.25)';
        ctx.fillRect(x - 1.8, y - 1.8, 3.6, 3.6);
      }
      for (const monster of world.monsters.filter(item => item.alive)) {
        const x = ox + (monster.x + .5) * cell;
        const y = oy + (monster.y + .5) * cell;
        ctx.fillStyle = monster.species === 'dragon' ? '#ff8b5c' : '#c77981';
        ctx.beginPath();
        ctx.moveTo(x, y - 4.5);
        ctx.lineTo(x + 4.5, y + 4);
        ctx.lineTo(x - 4.5, y + 4);
        ctx.closePath();
        ctx.fill();
        if (layer === 'danger') {
          ctx.strokeStyle = monster.species === 'dragon' ? 'rgba(255,139,92,.3)' : 'rgba(199,121,129,.22)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, Math.max(8, monster.territoryRadius * cell), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      for (const army of world.armies.filter(item => item.status === 'marching')) {
        const x = ox + (army.x + .5) * cell;
        const y = oy + (army.y + .5) * cell;
        ctx.strokeStyle = '#f4e7bd';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 4, y + 4);
        ctx.lineTo(x, y - 5);
        ctx.lineTo(x + 4, y + 4);
        ctx.stroke();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [world, layer]);

  const handlePointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const cell = Math.min(box.width / world.config.width, box.height / world.config.height);
    const ox = (box.width - cell * world.config.width) / 2;
    const oy = (box.height - cell * world.config.height) / 2;
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    if (layer === 'trade') {
      const route = nearestRoute(world, px, py, cell, ox, oy);
      if (route) { onSelect({ kind: 'tradeRoute', id: route.id }); return; }
    }
    const x = Math.floor((px - ox) / cell);
    const y = Math.floor((py - oy) / cell);
    const tile = world.tiles.find(item => item.x === x && item.y === y);
    if (!tile) return;
    const monster = world.monsters.find(item => item.alive && item.x === x && item.y === y);
    if (monster) onSelect({ kind: 'monster', id: monster.id });
    else if (tile.settlementId) onSelect({ kind: 'settlement', id: tile.settlementId });
    else if (tile.dungeonId) onSelect({ kind: 'dungeon', id: tile.dungeonId });
    else if (tile.kingdomId) onSelect({ kind: 'kingdom', id: tile.kingdomId });
  };

  return <canvas ref={ref} className="world-canvas" onPointerUp={handlePointer} aria-label="Карта мира Eldervale" />;
}

function drawTradeRoutes(ctx: CanvasRenderingContext2D, world: WorldState, layer: MapLayer, cell: number, ox: number, oy: number) {
  for (const route of world.tradeRoutes) {
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

function nearestRoute(world: WorldState, px: number, py: number, cell: number, ox: number, oy: number): TradeRoute | undefined {
  return world.tradeRoutes.map(route => {
    const from = world.settlements.find(item => item.id === route.fromSettlementId)!;
    const to = world.settlements.find(item => item.id === route.toSettlementId)!;
    const ax = ox + (from.x + .5) * cell;
    const ay = oy + (from.y + .5) * cell;
    const bx = ox + (to.x + .5) * cell;
    const by = oy + (to.y + .5) * cell;
    return { route, distance: pointToSegment(px, py, ax, ay, bx, by) };
  }).sort((a, b) => a.distance - b.distance).find(item => item.distance <= 10)?.route;
}

function pointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
