import type { WorldConfig, WorldState } from '../types';
import { generateWorld, type GenerationProgressReporter } from './generator';
import { buildLivedHistoricalWorld } from './livedHistory';

export function generateHistoricalWorld(config: WorldConfig, onProgress?: GenerationProgressReporter): WorldState {
  const scaffoldConfig: WorldConfig = {
    ...config,
    historyYears: 1,
    populationScale: Math.max(.035, Math.min(.07, config.populationScale * .075)),
  };
  const base = generateWorld(scaffoldConfig, (phase, completed, total, detail) => {
    const scaled = Math.round(completed / Math.max(1, total) * 34);
    onProgress?.(phase, scaled, 100, detail);
  });
  onProgress?.('Подготовка родовых общин', 35, 100, 'убираем готовые города и оставляем только первые постоянные центры');
  return buildHistoricalTimeline(base, config, onProgress);
}

export function buildHistoricalTimeline(world: WorldState, config: WorldConfig, onProgress?: GenerationProgressReporter): WorldState {
  return buildLivedHistoricalWorld(world, config, onProgress);
}
