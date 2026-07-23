import type { ReactNode, SVGProps } from 'react';

export type AppIconName =
  | 'map' | 'archive' | 'chronicle' | 'stories' | 'houses' | 'population' | 'city' | 'climate' | 'atlas' | 'local'
  | 'settings' | 'download' | 'upload' | 'plus' | 'more' | 'search' | 'close' | 'back' | 'chevron' | 'spark' | 'device' | 'world';

export function AppIcon({ name, size = 18, ...props }: { name: AppIconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  return <svg {...common} {...props}>{paths[name]}</svg>;
}

const paths: Record<AppIconName, ReactNode> = {
  map: <><path d="m3.5 6.5 5-2.5 7 2.5 5-2.5v13.5l-5 2.5-7-2.5-5 2.5Z"/><path d="M8.5 4v13.5M15.5 6.5V20"/></>,
  archive: <><path d="M4 5.5h16v4H4z"/><path d="M5.5 9.5v9h13v-9M9 13h6"/></>,
  chronicle: <><path d="M6 3.5h9.5L19 7v13.5H6z"/><path d="M15.5 3.5V7H19M9 11h7M9 14.5h7M9 18h5"/></>,
  stories: <><path d="m12 3 1.3 4.1L17.5 8.5l-4.2 1.4L12 14l-1.3-4.1-4.2-1.4 4.2-1.4Z"/><path d="m18 14 .7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7Z"/></>,
  houses: <><path d="M4 20V8.5L12 3l8 5.5V20"/><path d="M8 20v-7h8v7M3 20h18"/></>,
  population: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 20c.5-4 2.4-6 5.5-6s5 2 5.5 6M14 15c3.5-.5 5.5 1.2 6 5"/></>,
  city: <><path d="M3 21V8h6v13M9 21V3h7v18M16 21V10h5v11"/><path d="M6 11h0M6 15h0M12 7h1M12 11h1M12 15h1M19 14h0M19 17h0"/></>,
  climate: <><path d="M5 16.5a4 4 0 0 1 .8-7.9A6 6 0 0 1 17 9.5a3.5 3.5 0 0 1 .5 7H5Z"/><path d="M8 20l1-1M12 20l1-1M16 20l1-1"/></>,
  atlas: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.5 3.7 5.5 3.7 9S14.4 18.5 12 21c-2.4-2.5-3.7-5.5-3.7-9S9.6 5.5 12 3Z"/></>,
  local: <><path d="M4 4h16v16H4z"/><path d="M9 4v16M15 4v16M4 9h16M4 15h16"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2.1-.6a7 7 0 0 0-.8-1.9l1.1-1.9-2.1-2.1-1.9 1.1a7 7 0 0 0-1.9-.8L10.5 2h-3l-.6 2.1a7 7 0 0 0-1.9.8L3.1 3.8 1 5.9l1.1 1.9a7 7 0 0 0-.8 1.9L0 10.5v3l2.1.6a7 7 0 0 0 .8 1.9l-1.1 1.9L3.9 20l1.9-1.1a7 7 0 0 0 1.9.8l.6 2.1h3l.6-2.1a7 7 0 0 0 1.9-.8l1.9 1.1 2.1-2.1-1.1-1.9a7 7 0 0 0 .8-1.9Z" transform="translate(2) scale(.83)"/></>,
  download: <><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5"/><path d="M4 19.5h16"/></>,
  upload: <><path d="M12 21V9M7.5 13.5 12 9l4.5 4.5"/><path d="M4 4.5h16"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  back: <><path d="m14.5 5-7 7 7 7"/></>,
  chevron: <><path d="m9 5 7 7-7 7"/></>,
  spark: <><path d="m12 2 1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7Z"/></>,
  device: <><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M10 5h4M11 19h2"/></>,
  world: <><circle cx="12" cy="12" r="9"/><path d="M3.5 9h17M3.5 15h17M12 3c2 2.2 3 5.2 3 9s-1 6.8-3 9c-2-2.2-3-5.2-3-9s1-6.8 3-9Z"/></>,
};
