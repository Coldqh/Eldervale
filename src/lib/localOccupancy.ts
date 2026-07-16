import type { LocalCell } from '../types';
import { hashSeed } from '../sim/rng';

export interface LocalPoint { x: number; y: number; }
export type LocalCellPredicate = (cell: LocalCell) => boolean;

function key(x: number, y: number): string { return `${x}:${y}`; }

export class LocalOccupancyGrid {
  private readonly occupiedCreatures = new Set<string>();
  private readonly reservedSolid = new Set<string>();

  constructor(
    private readonly cells: LocalCell[],
    readonly width: number,
    readonly height: number,
  ) {
    for (const cell of cells) if (cell.blocked) this.reservedSolid.add(key(cell.x, cell.y));
  }

  isCreatureOccupied(x: number, y: number): boolean {
    return this.occupiedCreatures.has(key(x, y));
  }

  canPlaceCreature(x: number, y: number, predicate?: LocalCellPredicate): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    const cell = this.cells[y * this.width + x];
    if (!cell || this.reservedSolid.has(key(x, y)) || this.occupiedCreatures.has(key(x, y))) return false;
    if (cell.blocked || (predicate && !predicate(cell))) return false;
    return true;
  }

  claim(point: LocalPoint, predicate?: LocalCellPredicate): LocalPoint | undefined {
    if (!this.canPlaceCreature(point.x, point.y, predicate)) return undefined;
    this.occupiedCreatures.add(key(point.x, point.y));
    return point;
  }

  claimNearest(preferred: LocalPoint, seed: string, predicate?: LocalCellPredicate, maxRadius?: number): LocalPoint | undefined {
    const radiusLimit = maxRadius ?? Math.max(this.width, this.height);
    for (let radius = 0; radius <= radiusLimit; radius += 1) {
      const ring: LocalPoint[] = [];
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          ring.push({ x: preferred.x + dx, y: preferred.y + dy });
        }
      }
      ring.sort((a, b) => hashSeed(`${seed}:${a.x}:${a.y}`) - hashSeed(`${seed}:${b.x}:${b.y}`));
      for (const point of ring) {
        const claimed = this.claim(point, predicate);
        if (claimed) return claimed;
      }
    }
    return undefined;
  }

  claimFromCandidates(candidates: readonly LocalCell[], seed: string, preferred?: LocalPoint): LocalPoint | undefined {
    const ranked = candidates
      .filter(cell => this.canPlaceCreature(cell.x, cell.y))
      .map(cell => ({
        cell,
        score: preferred
          ? Math.hypot(cell.x - preferred.x, cell.y - preferred.y) * 1000 + hashSeed(`${seed}:${cell.x}:${cell.y}`) % 1000
          : hashSeed(`${seed}:${cell.x}:${cell.y}`),
      }))
      .sort((a, b) => a.score - b.score);
    const selected = ranked[0]?.cell;
    return selected ? this.claim({ x: selected.x, y: selected.y }) : undefined;
  }

  reserveFootprint(topLeft: LocalPoint, width: number, height: number): boolean {
    for (let y = topLeft.y; y < topLeft.y + height; y += 1) {
      for (let x = topLeft.x; x < topLeft.x + width; x += 1) {
        if (!this.canPlaceCreature(x, y)) return false;
      }
    }
    for (let y = topLeft.y; y < topLeft.y + height; y += 1) {
      for (let x = topLeft.x; x < topLeft.x + width; x += 1) this.occupiedCreatures.add(key(x, y));
    }
    return true;
  }

  claimFootprintNear(center: LocalPoint, footprintWidth: number, footprintHeight: number, seed: string, predicate?: LocalCellPredicate): LocalPoint | undefined {
    const desired = {
      x: Math.max(1, Math.min(this.width - footprintWidth - 1, center.x - Math.floor(footprintWidth / 2))),
      y: Math.max(1, Math.min(this.height - footprintHeight - 1, center.y - Math.floor(footprintHeight / 2))),
    };
    const radiusLimit = Math.max(this.width, this.height);
    for (let radius = 0; radius <= radiusLimit; radius += 1) {
      const candidates: LocalPoint[] = [];
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          candidates.push({ x: desired.x + dx, y: desired.y + dy });
        }
      }
      candidates.sort((a, b) => hashSeed(`${seed}:${a.x}:${a.y}`) - hashSeed(`${seed}:${b.x}:${b.y}`));
      for (const point of candidates) {
        if (point.x < 0 || point.y < 0 || point.x + footprintWidth > this.width || point.y + footprintHeight > this.height) continue;
        let valid = true;
        for (let y = point.y; y < point.y + footprintHeight && valid; y += 1) {
          for (let x = point.x; x < point.x + footprintWidth; x += 1) {
            const cell = this.cells[y * this.width + x];
            if (!this.canPlaceCreature(x, y, predicate) || !cell) { valid = false; break; }
          }
        }
        if (valid && this.reserveFootprint(point, footprintWidth, footprintHeight)) return point;
      }
    }
    return undefined;
  }

  creatureCount(): number { return this.occupiedCreatures.size; }
}
