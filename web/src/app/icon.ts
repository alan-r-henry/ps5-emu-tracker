import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Stroke icons on a 24-unit grid, drawn in the Lucide style (lucide.dev, ISC licence).
 * Each part is a path "d" string, "c:cx,cy,r" for a circle or "r:x,y,w,h,rx" for a rounded rect.
 * GitHub's mark is a filled 16-unit glyph, so it carries its own box and fill flag.
 */
interface IconDef {
  box?: number;
  fill?: boolean;
  parts: string[];
}

const ICONS = {
  refresh: { parts: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'] },
  sun: { parts: ['c:12,12,4', 'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'] },
  moon: { parts: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'] },
  merge: { parts: ['c:18,18,3', 'c:6,6,3', 'M6 21V9a9 9 0 0 0 9 9'] },
  pr: { parts: ['c:18,18,3', 'c:6,6,3', 'M13 6h3a2 2 0 0 1 2 2v7', 'M6 9v12'] },
  issue: { parts: ['c:12,12,10', 'c:12,12,1'] },
  star: { parts: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z'] },
  tag: { parts: ['M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z', 'c:7.5,7.5,.5'] },
  ban: { parts: ['c:12,12,10', 'm4.9 4.9 14.2 14.2'] },
  alert: { parts: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'] },
  trendUp: { parts: ['M22 7l-8.5 8.5-5-5L2 17', 'M16 7h6v6'] },
  trendDown: { parts: ['M22 17l-8.5-8.5-5 5L2 7', 'M16 17h6v-6'] },
  minus: { parts: ['M5 12h14'] },
  gamepad: { parts: ['M6 11h4', 'M8 9v4', 'M15 12h.01', 'M18 10h.01', 'M17.32 5H6.68a4 4 0 0 0-3.98 3.59C2.6 9.42 2 14.46 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.41-1.41A2 2 0 0 1 9.83 16h4.34a2 2 0 0 1 1.41.59L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.55-.6-6.58-.69-7.26A4 4 0 0 0 17.32 5z'] },
  flag: { parts: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'] },
  grid: { parts: ['r:3,3,7,7,1', 'r:14,3,7,7,1', 'r:14,14,7,7,1', 'r:3,14,7,7,1'] },
  chart: { parts: ['M3 3v16a2 2 0 0 0 2 2h16', 'M18 17V9', 'M13 17V5', 'M8 17v-3'] },
  library: { parts: ['m16 6 4 14', 'M12 6v14', 'M8 8v12', 'M4 4v16'] },
  layers: { parts: ['M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z', 'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65', 'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65'] },
  info: { parts: ['c:12,12,10', 'M12 16v-4', 'M12 8h.01'] },
  play: { parts: ['c:12,12,10', 'M10 8l6 4-6 4z'] },
  gauge: { parts: ['m12 14 4-4', 'M3.34 19a10 10 0 1 1 17.32 0'] },
  cpu: { parts: ['r:4,4,16,16,2', 'r:9,9,6,6,1', 'M15 2v2', 'M15 20v2', 'M2 15h2', 'M2 9h2', 'M20 15h2', 'M20 9h2', 'M9 2v2', 'M9 20v2'] },
  monitor: { parts: ['r:2,3,20,14,2', 'M8 21h8', 'M12 17v4'] },
  calendar: { parts: ['M8 2v4', 'M16 2v4', 'r:3,4,18,18,2', 'M3 10h18'] },
  external: { parts: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'] },
  motorbike: { parts: ['c:5,16,3.5', 'c:19,16,3.5', 'M19 16 15.5 7H18', 'M5 16h5l3-4h3.7', 'M6 11.5h6'] },
  close: { parts: ['M18 6 6 18', 'm6 6 12 12'] },
  copy: { parts: ['r:8,8,14,14,2', 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'] },
  check: { parts: ['M20 6 9 17l-5-5'] },
  coffee: { parts: ['M10 2v2', 'M14 2v2', 'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1', 'M6 2v2'] },
  card: { parts: ['r:2,5,20,14,2', 'M2 10h20'] },
  phone: { parts: ['r:5,2,14,20,2', 'M12 18h.01'] },
  heart: { parts: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'] },
  sort: { parts: ['m21 16-4 4-4-4', 'M17 20V4', 'm3 8 4-4 4 4', 'M7 4v16'] },
  sparkles: { parts: ['M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z', 'M20 3v4', 'M22 5h-4'] },
  users: { parts: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'c:9,7,4', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'] },
  search: { parts: ['c:11,11,8', 'm21 21-4.3-4.3'] },
  archive: { parts: ['r:2,3,20,5,1', 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8', 'M10 12h4'] },
  globe: { parts: ['c:12,12,10', 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20'] },
  commit: { parts: ['c:12,12,3', 'M3 12h6', 'M15 12h6'] },
  clock: { parts: ['c:12,12,10', 'M12 6v6l4 2'] },
  history: { parts: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M12 7v5l4 2'] },
  github: {
    box: 16,
    fill: true,
    parts: ['M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z'],
  },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

type Shape =
  | { kind: 'path'; d: string }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rx: number };

function toShape(part: string): Shape {
  const nums = () => part.slice(2).split(',').map(Number);
  if (part.startsWith('c:')) {
    const [cx, cy, r] = nums();
    return { kind: 'circle', cx, cy, r };
  }
  if (part.startsWith('r:')) {
    const [x, y, w, h, rx] = nums();
    return { kind: 'rect', x, y, w, h, rx };
  }
  return { kind: 'path', d: part };
}

const SHAPES = Object.fromEntries(
  Object.entries(ICONS).map(([name, def]: [string, IconDef]) => [name, def.parts.map(toShape)]),
) as Record<IconName, Shape[]>;

/** Decorative by default; pass `label` when the icon is the only content of a control. */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'icon' },
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + box() + ' ' + box()"
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.fill]="def().fill ? 'currentColor' : 'none'"
      [attr.stroke]="def().fill ? 'none' : 'currentColor'"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      [attr.role]="label() ? 'img' : null"
      [attr.aria-label]="label() || null"
      [attr.aria-hidden]="label() ? null : 'true'"
      focusable="false"
    >
      @for (s of shapes(); track $index) {
        @switch (s.kind) {
          @case ('path') { <svg:path [attr.d]="s.d" /> }
          @case ('circle') { <svg:circle [attr.cx]="s.cx" [attr.cy]="s.cy" [attr.r]="s.r" /> }
          @case ('rect') { <svg:rect [attr.x]="s.x" [attr.y]="s.y" [attr.width]="s.w" [attr.height]="s.h" [attr.rx]="s.rx" /> }
        }
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(16);
  readonly label = input('');

  protected readonly def = computed<IconDef>(() => ICONS[this.name()]);
  protected readonly box = computed(() => this.def().box ?? 24);
  protected readonly shapes = computed(() => SHAPES[this.name()]);
}
