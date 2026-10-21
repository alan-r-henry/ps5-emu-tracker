import {
  Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal, viewChild,
} from '@angular/core';
import { fmt, niceTicks, shortDate } from '../format';

export interface LinePoint {
  date: string;
  value: number;
  live: boolean;
}

export interface LineSeries {
  name: string;
  color: string;
  points: LinePoint[];
}

/** Several series over time, drawn point to point and labelled at their ends. */
@Component({
  selector: 'app-line-chart',
  template: `
    <div class="chart tall" #box (mouseleave)="hoverDate.set(null)">
      @if (width() > 0 && dates().length) {
        <svg [attr.viewBox]="'0 0 ' + width() + ' ' + height" [attr.width]="width()" [attr.height]="height"
             role="img" [attr.aria-label]="label()" (mousemove)="move($event)">
          @for (t of ticks(); track t) {
            <line class="gridline" [attr.x1]="left()" [attr.x2]="width() - right()" [attr.y1]="y(t)" [attr.y2]="y(t)" />
            <text class="tick" [attr.x]="left() - 8" [attr.y]="y(t)" dy="0.32em" text-anchor="end">{{ fmt(t) }}</text>
          }
          <line class="axis" [attr.x1]="left()" [attr.x2]="width() - right()" [attr.y1]="y(0)" [attr.y2]="y(0)" />
          @for (l of xLabels(); track l.date) {
            <text class="tick" [attr.x]="x(l.date)" [attr.y]="height - 4" [attr.text-anchor]="l.anchor">{{ l.text }}</text>
          }
          @if (hoverDate(); as hd) {
            <line class="ref" [attr.x1]="x(hd)" [attr.x2]="x(hd)" [attr.y1]="top" [attr.y2]="y(0)" />
          }
          @for (s of series(); track s.name) {
            <path [attr.d]="path(s)" fill="none" [attr.stroke]="s.color" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            @for (p of s.points; track p.date) {
              <circle [attr.cx]="x(p.date)" [attr.cy]="y(p.value)" [attr.r]="p.live ? 4 : 2.5"
                      [attr.fill]="p.live ? 'var(--panel)' : s.color" [attr.stroke]="s.color" [attr.stroke-width]="p.live ? 2 : 0" />
            }
          }
          @for (e of ends(); track e.name) {
            <text class="end" [attr.x]="e.x + 8" [attr.y]="e.y" dy="0.32em" [attr.fill]="e.color">{{ e.text }}</text>
          }
        </svg>
      }
      @if (tip(); as t) {
        <div class="tip" [style.left.px]="t.left" [style.top.px]="12">
          <div class="tip-d">{{ t.date }}</div>
          @for (r of t.rows; track r.name) {
            <div><span class="sw" [style.background]="r.color"></span>{{ r.name }}: {{ r.value }}</div>
          }
        </div>
      }
    </div>
  `,
})
export class LineChart {
  readonly series = input.required<LineSeries[]>();
  readonly label = input('');

  protected readonly height = 280;
  protected readonly top = 12;
  private readonly bottom = 28;
  protected readonly fmt = fmt;
  protected readonly width = signal(0);
  protected readonly hoverDate = signal<string | null>(null);
  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  protected readonly dates = computed(() =>
    Array.from(new Set(this.series().flatMap((s) => s.points.map((p) => p.date)))).sort(),
  );
  protected readonly ticks = computed(() =>
    niceTicks(Math.max(1, ...this.series().flatMap((s) => s.points.map((p) => p.value))), 4),
  );
  protected readonly left = computed(() => fmt(this.ticks().at(-1) ?? 0).length * 9 + 16);
  protected readonly right = computed(() => {
    const longest = Math.max(0, ...this.series().map((s) => fmt(s.points.at(-1)?.value).length));
    return longest * 10 + 16;
  });
  private readonly t0 = computed(() => Date.parse(this.dates()[0] ?? '1970-01-01'));
  private readonly t1 = computed(() => Date.parse(this.dates().at(-1) ?? '1970-01-02'));

  protected readonly xLabels = computed(() => {
    const d = this.dates();
    if (!d.length) return [];
    const n = Math.max(2, Math.min(6, Math.floor((this.width() - this.left() - this.right()) / 120)));
    const picks: string[] = [];
    for (let k = 0; k < n; k++) {
      const target = this.t0() + ((this.t1() - this.t0()) * k) / (n - 1);
      const near = d.reduce((a, b) => (Math.abs(Date.parse(b) - target) < Math.abs(Date.parse(a) - target) ? b : a));
      if (!picks.includes(near)) picks.push(near);
    }
    return picks.map((date, k) => ({
      date, text: shortDate(date), anchor: k === 0 ? 'start' : k === picks.length - 1 ? 'end' : 'middle',
    }));
  });

  protected readonly ends = computed(() => {
    const items = this.series()
      .filter((s) => s.points.length)
      .map((s) => {
        const last = s.points.at(-1)!;
        return { name: s.name, color: s.color, text: fmt(last.value), x: this.x(last.date), y: this.y(last.value) };
      })
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 20) items[i].y = items[i - 1].y + 20;
    return items;
  });

  protected readonly tip = computed(() => {
    const hd = this.hoverDate();
    if (!hd) return null;
    const rows = this.series()
      .map((s) => {
        const p = [...s.points].reverse().find((pt) => pt.date <= hd);
        return p ? { name: s.name, color: s.color, value: fmt(p.value) + (p.live ? ' (live)' : '') } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const left = Math.min(this.width() - 90, Math.max(90, this.x(hd)));
    return { date: shortDate(hd), rows, left };
  });

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const ro = new ResizeObserver(([e]) => this.width.set(Math.floor(e.contentRect.width)));
      ro.observe(this.box().nativeElement);
      destroy.onDestroy(() => ro.disconnect());
    });
  }

  protected x(date: string): number {
    const span = Math.max(1, this.t1() - this.t0());
    return this.left() + ((Date.parse(date) - this.t0()) / span) * (this.width() - this.left() - this.right());
  }

  protected y(v: number): number {
    const max = this.ticks().at(-1) || 1;
    return this.top + (1 - v / max) * (this.height - this.top - this.bottom);
  }

  protected path(s: LineSeries): string {
    return s.points.map((p, i) => `${i ? 'L' : 'M'}${this.x(p.date).toFixed(1)},${this.y(p.value).toFixed(1)}`).join('');
  }

  protected move(ev: MouseEvent): void {
    const svg = ev.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * this.width();
    const d = this.dates();
    if (!d.length) return;
    const near = d.reduce((a, b) => (Math.abs(this.x(b) - px) < Math.abs(this.x(a) - px) ? b : a));
    this.hoverDate.set(near);
  }
}
