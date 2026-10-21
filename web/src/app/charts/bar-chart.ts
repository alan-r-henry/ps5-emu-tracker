import {
  Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal, viewChild,
} from '@angular/core';
import { fmt, niceTicks, shortDate } from '../format';

export interface BarDatum {
  day: string;
  value: number;
  commits: number;
  live: boolean;
}

/** Daily counts as rounded bars, one chart per series, with a hover tooltip. */
@Component({
  selector: 'app-bar-chart',
  template: `
    <div class="chart" #box (mouseleave)="hover.set(null)">
      @if (width() > 0) {
        <svg [attr.viewBox]="'0 0 ' + width() + ' ' + height" [attr.width]="width()" [attr.height]="height"
             role="img" [attr.aria-label]="label()">
          @for (t of ticks(); track t) {
            <line class="gridline" [attr.x1]="left()" [attr.x2]="width()" [attr.y1]="y(t)" [attr.y2]="y(t)" />
            <text class="tick" [attr.x]="left() - 6" [attr.y]="y(t)" dy="0.32em" text-anchor="end">{{ fmt(t) }}</text>
          }
          @for (d of data(); track d.day; let i = $index) {
            <rect [attr.x]="x(i)" [attr.width]="bw()" [attr.y]="y(d.value)" [attr.height]="barH(d.value)"
                  [attr.rx]="radius()" [attr.fill]="color()"
                  [attr.opacity]="hover() === null || hover() === i ? 1 : 0.4"
                  [attr.stroke]="d.live ? 'var(--fg)' : null" [attr.stroke-dasharray]="d.live ? '2 2' : null" />
            <rect class="hit" [attr.x]="x(i) - gap() / 2" [attr.width]="bw() + gap()" [attr.y]="top" [attr.height]="height - top - bottom"
                  (mouseenter)="hover.set(i)" />
          }
          @for (l of xLabels(); track l.i) {
            <text class="tick" [attr.x]="x(l.i) + bw() / 2" [attr.y]="height - 4" [attr.text-anchor]="l.anchor">{{ l.text }}</text>
          }
        </svg>
      }
      @if (hovered(); as h) {
        <div class="tip" [style.left.px]="tipLeft()" [style.top.px]="tipTop()">
          <div class="tip-d">{{ h.date }}{{ h.live ? ' · live' : '' }}</div>
          <div>{{ h.merged }} merged PRs</div>
          @if (!h.live) { <div>{{ h.commits }} commits</div> }
        </div>
      }
    </div>
  `,
})
export class BarChart {
  readonly data = input.required<BarDatum[]>();
  readonly color = input.required<string>();
  readonly label = input('');

  protected readonly height = 150;
  protected readonly top = 8;
  protected readonly bottom = 26;
  protected readonly fmt = fmt;
  protected readonly hover = signal<number | null>(null);
  protected readonly width = signal(0);
  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  protected readonly ticks = computed(() => niceTicks(Math.max(1, ...this.data().map((d) => d.value)), 3));
  protected readonly left = computed(() => fmt(this.ticks().at(-1) ?? 0).length * 9 + 14);
  private readonly band = computed(() => (this.width() - this.left()) / Math.max(1, this.data().length));
  protected readonly gap = computed(() => this.band() * 0.25);
  protected readonly bw = computed(() => Math.max(1, this.band() - this.gap()));
  protected readonly radius = computed(() => Math.min(4, this.bw() / 2));
  protected readonly xLabels = computed(() => {
    const n = this.data().length;
    if (!n) return [];
    const idx = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : [0, n - 1];
    return Array.from(new Set(idx)).map((i, k, arr) => ({
      i, text: shortDate(this.data()[i].day), anchor: k === 0 ? 'start' : k === arr.length - 1 ? 'end' : 'middle',
    }));
  });
  protected readonly hovered = computed(() => {
    const i = this.hover();
    const d = i == null ? null : this.data()[i];
    return d ? { date: shortDate(d.day), merged: fmt(d.value), commits: fmt(d.commits), live: d.live } : null;
  });
  protected readonly tipLeft = computed(() => {
    const i = this.hover() ?? 0;
    return Math.min(this.width() - 80, Math.max(80, this.x(i) + this.bw() / 2));
  });
  protected readonly tipTop = computed(() => {
    const d = this.data()[this.hover() ?? 0];
    return d ? Math.max(0, this.y(d.value) - 8) : 0;
  });

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.box().nativeElement;
      const ro = new ResizeObserver(([e]) => this.width.set(Math.floor(e.contentRect.width)));
      ro.observe(el);
      destroy.onDestroy(() => ro.disconnect());
    });
  }

  protected x(i: number): number {
    return this.left() + i * this.band() + this.gap() / 2;
  }

  protected y(v: number): number {
    const max = this.ticks().at(-1) || 1;
    return this.top + (1 - v / max) * (this.height - this.top - this.bottom);
  }

  protected barH(v: number): number {
    return Math.max(0, this.y(0) - this.y(v));
  }
}
