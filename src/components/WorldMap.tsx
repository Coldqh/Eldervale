import { useEffect, useRef } from 'react';
import type { EntityRef, Terrain, WorldState } from '../types';

export type MapLayer = 'terrain' | 'realms' | 'danger' | 'population';
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
      canvas.width = Math.floor(box.width * dpr); canvas.height = Math.floor(box.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, box.width, box.height);
      const cell = Math.min(box.width / world.config.width, box.height / world.config.height);
      const ox = (box.width - cell * world.config.width) / 2;
      const oy = (box.height - cell * world.config.height) / 2;
      for (const tile of world.tiles) {
        let fill = terrainColors[tile.terrain];
        if (layer === 'realms' && tile.terrain !== 'ocean') fill = world.kingdoms.find(k => k.id === tile.kingdomId)?.color ?? fill;
        if (layer === 'danger' && tile.terrain !== 'ocean') {
          const monster = world.monsters.find(m => m.alive && Math.abs(m.x - tile.x) <= 2 && Math.abs(m.y - tile.y) <= 2);
          fill = monster ? (monster.species === 'dragon' ? '#8e3f35' : '#6d4a57') : '#526a57';
        }
        if (layer === 'population' && tile.terrain !== 'ocean') {
          const settlement = world.settlements.find(s => s.id === tile.settlementId);
          fill = settlement ? (settlement.population > 400 ? '#e1c078' : settlement.population > 150 ? '#a58f62' : '#6d795c') : '#34463c';
        }
        ctx.fillStyle = fill;
        ctx.fillRect(ox + tile.x * cell, oy + tile.y * cell, Math.ceil(cell + 0.35), Math.ceil(cell + 0.35));
      }
      ctx.strokeStyle = 'rgba(232,216,173,.12)'; ctx.lineWidth = 1;
      for (const settlement of world.settlements) {
        const x = ox + (settlement.x + 0.5) * cell; const y = oy + (settlement.y + 0.5) * cell;
        const radius = Math.max(2.5, Math.min(7, 2.2 + Math.sqrt(settlement.population) / 4.2));
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = settlement.damaged > 55 ? '#d06a4d' : '#f0db9b'; ctx.fill(); ctx.strokeStyle = '#171b15'; ctx.stroke();
      }
      for (const dungeon of world.dungeons) {
        const x = ox + (dungeon.x + 0.5) * cell; const y = oy + (dungeon.y + 0.5) * cell;
        ctx.fillStyle = '#d8c7a0'; ctx.fillRect(x - 1.8, y - 1.8, 3.6, 3.6);
      }
      for (const monster of world.monsters.filter(m => m.alive)) {
        const x = ox + (monster.x + 0.5) * cell; const y = oy + (monster.y + 0.5) * cell;
        ctx.fillStyle = monster.species === 'dragon' ? '#ff8b5c' : '#c77981';
        ctx.beginPath(); ctx.moveTo(x, y - 4.5); ctx.lineTo(x + 4.5, y + 4); ctx.lineTo(x - 4.5, y + 4); ctx.closePath(); ctx.fill();
      }
      for (const army of world.armies.filter(a => a.status === 'marching')) {
        const x = ox + (army.x + 0.5) * cell; const y = oy + (army.y + 0.5) * cell;
        ctx.strokeStyle = '#f4e7bd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 4, y + 4); ctx.lineTo(x, y - 5); ctx.lineTo(x + 4, y + 4); ctx.stroke();
      }
    };
    draw();
    const observer = new ResizeObserver(draw); observer.observe(canvas);
    return () => observer.disconnect();
  }, [world, layer]);

  const handlePointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current; if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const cell = Math.min(box.width / world.config.width, box.height / world.config.height);
    const ox = (box.width - cell * world.config.width) / 2; const oy = (box.height - cell * world.config.height) / 2;
    const x = Math.floor((event.clientX - box.left - ox) / cell); const y = Math.floor((event.clientY - box.top - oy) / cell);
    const tile = world.tiles.find(t => t.x === x && t.y === y); if (!tile) return;
    if (tile.monsterId) onSelect({ kind: 'monster', id: tile.monsterId });
    else if (tile.settlementId) onSelect({ kind: 'settlement', id: tile.settlementId });
    else if (tile.dungeonId) onSelect({ kind: 'dungeon', id: tile.dungeonId });
    else if (tile.kingdomId) onSelect({ kind: 'kingdom', id: tile.kingdomId });
  };

  return <canvas ref={ref} className="world-canvas" onPointerUp={handlePointer} aria-label="Карта мира Eldervale" />;
}
