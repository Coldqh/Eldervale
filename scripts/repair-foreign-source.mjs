import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const requiredEldervaleFiles = [
  'src/App.tsx',
  'src/sim/simulation.ts',
  'src/workers/world.worker.ts',
  'src/lib/localMap.ts',
];

for (const relative of requiredEldervaleFiles) {
  if (!existsSync(resolve(relative))) {
    throw new Error(`Очистка остановлена: не найден обязательный файл Eldervale ${relative}`);
  }
}

const foreignPaths = [
  'src/app',
  'src/core',
  'src/screens',
  'src/sports',
  'src/state',
  'src/storage',
  'src/utils',
  'src/components/brand',
  'src/components/career',
  'src/components/feedback',
  'src/components/layout',
  'src/components/system',
  'src/components/ui',
  'src/hooks/useCareerSave.ts',
  // Загрязнение, попавшее в main вместе с интерфейсом другого проекта.
  'src/features/brand',
  'src/features/market',
  'src/features/onboarding',
  'src/features/production',
  'src/features/shell',
  'src/features/today',
  'src/features/world',
  'src/ui/EditorialVisual.tsx',
  'src/ui/FeedbackStates.tsx',
  'src/ui/Icon.tsx',
  'src/ui/MobileUI.tsx',
  'src/styles/global.css',
  'docs/FEATURE_SPEC_031_PREMIUM_INTERFACE.md',
  'docs/UX_AUDIT_031.md',
  'public/art/bar.svg',
  'public/art/cellar.svg',
  'public/art/city.svg',
  'public/art/production.svg',
];

const removed = [];
for (const relative of foreignPaths) {
  const absolute = resolve(relative);
  if (!existsSync(absolute)) continue;
  rmSync(absolute, { recursive: true, force: true });
  removed.push(relative);
}

console.log(removed.length
  ? `REPAIR SOURCE: удалены чужие файлы: ${removed.join(', ')}`
  : 'REPAIR SOURCE: чужие файлы не найдены.');
