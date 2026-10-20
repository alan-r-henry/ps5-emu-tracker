import { ProjectDef } from './models';

/** Stage keys match what collect.py writes to compat_history.json. */
export const PROJECTS: ProjectDef[] = [
  {
    name: 'AnyPS5',
    repo: 'boykopovar/AnyPS5',
    approach: 'Converts PS5 game files into native Windows and Linux programs.',
    color: 'var(--series-1)',
    topKey: 'Playable',
    ladder: [
      { key: 'Converts', label: 'Converts' },
      { key: 'Loads', label: 'Loads' },
      { key: 'Starts', label: 'Starts' },
      { key: 'First draw', label: 'First draw' },
      { key: 'Presents', label: 'Presents' },
      { key: 'Menus', label: 'Menus' },
      { key: 'Ingame', label: 'In-game' },
      { key: 'Playable', label: 'Playable' },
    ],
  },
  {
    name: 'KytyPS5',
    repo: 'KytyPS5/KytyPS5',
    approach: 'C++ translation layer, based on the original Kyty emulator.',
    color: 'var(--series-2)',
    topKey: 'in-game',
    ladder: [
      { key: 'doesnt-boot', label: "Doesn't boot" },
      { key: 'logo', label: 'Logo' },
      { key: 'main-menu', label: 'Main menu' },
      { key: 'in-game', label: 'In-game' },
    ],
  },
  {
    name: 'SharpEmu',
    repo: 'sharpemu/sharpemu',
    approach: 'Emulator written from scratch in C#.',
    color: 'var(--series-3)',
    topKey: 'playable',
    ladder: [
      { key: 'nothing', label: 'Nothing' },
      { key: 'boots', label: 'Boots' },
      { key: 'menus', label: 'Menus' },
      { key: 'ingame', label: 'In-game' },
      { key: 'playable', label: 'Playable' },
    ],
  },
];

export const PS5_CATALOG_FALLBACK = 9215;

/** GTA 6's PS5 release day (UTC), for the hero countdown. gta.json carries the same date. */
export const GTA6_RELEASE = '2026-11-19';

export const SOURCES = {
  anyps5Progress: 'https://boykopovar.github.io/AnyPS5/progress.json',
  anyps5Roadmap: 'https://alxcbtw.github.io/anyps5-roadmap/roadmap.json',
  kytyCompat: 'https://kytyps5.github.io/data/compat-index.json',
  sharpCompat: 'https://sharpemu.app/games-index.json',
};
