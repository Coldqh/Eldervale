import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const css = read('src/designSystem.css');
const workspace = read('src/components/WorldWorkspace.tsx');
const setup = read('src/components/WorldSetup.tsx');
const encyclopedia = read('src/components/Encyclopedia.tsx');
const app = read('src/App.tsx');
const icon = read('src/components/AppIcon.tsx');

for (const token of [
  '--color-background', '--color-surface', '--color-surface-raised', '--color-text-primary', '--color-text-secondary',
  '--color-text-muted', '--color-border', '--color-accent', '--color-danger', '--color-success', '--radius-sm',
  '--radius-md', '--shadow-raised', '--space-1', '--text-sm', '--control-md',
]) assert.ok(css.includes(token), `отсутствует токен ${token}`);

for (const state of [
  ':focus-visible', ':hover', ':active', ':disabled', '.selected', '.skeleton', '.empty-state', '.error-state', '.success-feedback',
  '@media (max-width: 820px)', '@media (prefers-reduced-motion: reduce)',
]) assert.ok(css.includes(state), `не оформлено состояние ${state}`);

assert.ok(css.includes('overflow-x: hidden'), 'рабочая область не защищена от горизонтального переполнения');
assert.ok(workspace.includes('className="mobile-nav"'), 'нет мобильной нижней навигации');
assert.ok(workspace.includes('className="mobile-more-sheet"'), 'нет мобильного меню остальных разделов');
assert.ok(workspace.includes("event.key === 'Escape'"), 'модальное меню не закрывается клавишей Escape');
assert.ok(workspace.includes('<AppIcon'), 'навигация не использует единую систему иконок');
assert.ok(icon.includes('<svg'), 'система иконок не создаёт SVG');
assert.ok(setup.includes('aria-pressed'), 'профили генерации не сообщают выбранное состояние');
assert.ok(setup.includes('setup-preview'), 'экран генерации не показывает содержательную сводку мира');
assert.ok(encyclopedia.includes('aria-label="Поиск по архиву"'), 'поиск архива не имеет доступного имени');
assert.ok(encyclopedia.includes('className="entity-card"'), 'архив не использует контентные карточки');
assert.ok(encyclopedia.includes('empty-state'), 'архив не имеет пустого состояния');
assert.ok(app.indexOf("import './designSystem.css'") > app.indexOf("import './styles.css'"), 'дизайн-система должна подключаться после старых стилей');
assert.ok(!app.includes('blackTheme.css'), 'устаревшая тема не должна подключаться к приложению');

console.log('OK UI INTERFACE: токены, состояния, навигация, поиск, карточки и адаптивная оболочка проверены.');
