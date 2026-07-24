import type { ReactNode } from 'react';

export type EditorialVisualVariant = 'cellar' | 'production' | 'bar' | 'city';

interface EditorialVisualProps {
  variant: EditorialVisualVariant;
  eyebrow: string;
  title: string;
  metric: string;
  note: string;
  action?: ReactNode;
  compact?: boolean;
}

const artwork: Record<EditorialVisualVariant, { src: string; alt: string }> = {
  cellar: { src: './art/cellar.svg', alt: 'Тёмный винный погреб с бутылочными стеллажами' },
  production: { src: './art/production.svg', alt: 'Производственный зал с ёмкостями и линиями напитков' },
  bar: { src: './art/bar.svg', alt: 'Премиальный коктейльный бар с бутылочной полкой' },
  city: { src: './art/city.svg', alt: 'Ночной район с барами, клубами и ресторанами' },
};

export function EditorialVisual({ variant, eyebrow, title, metric, note, action, compact = false }: EditorialVisualProps) {
  const visual = artwork[variant];
  return (
    <section className={`editorial-visual visual-${variant} ${compact ? 'compact' : ''}`}>
      <img src={visual.src} alt={visual.alt} draggable={false} />
      <div className="editorial-visual-copy">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <div className="editorial-metric"><strong>{metric}</strong><small>{note}</small></div>
      </div>
      {action && <div className="editorial-action">{action}</div>}
    </section>
  );
}
