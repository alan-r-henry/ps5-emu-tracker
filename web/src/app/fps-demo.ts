import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, viewChildren } from '@angular/core';
import { Icon } from './icon';
import { SCENES } from './fps-scenes';

interface Rate {
  fps: number;
  label: string;
}

const RATES: Rate[] = [
  { fps: 30, label: 'GTA 6 on every console, PS5 Pro included' },
  { fps: 60, label: 'A console performance mode; GTA 6 has none announced' },
  { fps: 120, label: 'A high-refresh PC monitor' },
];
/** Common display refresh rates; a measured rate snaps to the nearest one. */
const REFRESH = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 170, 180, 200, 240, 280, 360];
const SAMPLES = 90;
/** Seconds each scene plays before the next, when cycling. */
const SCENE_SECS = 6;
/**
 * GTA 6 on PC, shown under the panels. Rumoured until Rockstar announces it: once it does, set `confirmed`,
 * the date and the source here (and in the FAQ answer "When is GTA 6 coming to PC?").
 */
const GTA6_PC = {
  confirmed: false,
  when: 'early 2027',
  source: 'GamesBeat reported on October 13, 2026, citing four industry sources,',
};

/**
 * The same scenes drawn live in several canvases, each redrawn only at its own frame rate.
 * One requestAnimationFrame loop drives them all: a panel slower than the screen spreads its frames evenly
 * over display refreshes, and a panel faster than the screen draws every refresh, which is all the screen
 * can show. Pauses off-screen, in background tabs, and starts paused when the viewer asks for less motion.
 */
@Component({
  selector: 'app-fps-demo',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sec" id="fps" aria-labelledby="fps-h">
      <div class="sec-head">
        <h2 id="fps-h">What frame rate looks like</h2>
        <p class="note">
          <a href="https://www.rockstargames.com/newswire/article/89834o94713o21/pre-load-grand-theft-auto-vi-now">Rockstar says</a>
          GTA 6 targets 30 fps on every console, PS5 Pro included. Below, five scenes drawn live in your browser,
          side by side at 30, 60 and 120 fps. The lower the rate, the more motion jumps instead of glides.
          Testers' FPS reports elsewhere on this page mean the same thing.
        </p>
      </div>
      <div class="fps-tools">
        <button type="button" class="chip with-icon" (click)="toggle()">
          <app-icon [name]="playing() ? 'pause' : 'play'" [size]="14" />{{ playing() ? 'Pause' : 'Play' }}
        </button>
        <div class="fps-scenes" role="group" aria-label="Scene">
          <button type="button" class="chip" [attr.aria-pressed]="pick() === null" (click)="choose(null)">All scenes</button>
          @for (s of scenes; track s.name; let i = $index) {
            <button type="button" class="chip" [attr.aria-pressed]="pick() === i" (click)="choose(i)">{{ s.name }}</button>
          }
        </div>
      </div>
      <p class="note">
        @if (pick() === null) { Now showing: {{ scenes[scene()].name }}. }
        <span role="status">
        @if (refresh(); as r) {
          Your screen shows up to {{ r }} fps@if (r < 120) {, so rates above {{ r }} look the same as {{ r }} here}.
        } @else if (!playing()) {
          Paused@if (reduced()) { because your device asks for less motion}. Press Play to start.
        } @else {
          Measuring your screen's refresh rate…
        }
        </span>
      </p>
      <div class="fps-grid">
        @for (p of panels(); track p.fps) {
          <figure class="fps-panel">
            <figcaption>
              <b class="num">{{ p.fps }} fps</b>
              <span class="note">{{ p.label }}@if (refresh() && p.fps > refresh()!) { · shown at {{ refresh() }} on this screen }</span>
            </figcaption>
            <canvas #canvas role="img" [attr.aria-label]="scenes[scene()].name + ', animated at ' + p.fps + ' frames per second'"></canvas>
          </figure>
        }
      </div>
      <p class="note fps-credit">
        @if (pc.confirmed) {
          GTA 6 comes to PC {{ pc.when }}, where high-refresh monitors can show 120 fps and more.
        } @else {
          Rockstar hasn't announced a PC version, where frame rates above 30 would be possible. {{ pc.source }}
          that one is planned for {{ pc.when }}.
        }
      </p>
    </section>
  `,
})
export class FpsDemo {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroy = inject(DestroyRef);
  private readonly canvases = viewChildren<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly sized = new ResizeObserver(() => this.drawAll(true));

  protected readonly scenes = SCENES;
  protected readonly pc = GTA6_PC;
  protected readonly playing = signal(true);
  protected readonly reduced = signal(false);
  protected readonly refresh = signal<number | null>(null);
  /** The scene the viewer picked, or null to cycle through them all. */
  protected readonly pick = signal<number | null>(null);
  protected readonly scene = signal(0);
  /** The three standard rates, plus the screen's own rate when it goes past 120. */
  protected readonly panels = computed<Rate[]>(() => {
    const r = this.refresh();
    return r && r > 130 ? [...RATES, { fps: r, label: 'Your screen\'s full refresh rate' }] : RATES;
  });

  private visible = false;
  private frame = 0;
  private last = 0;
  private clock = 0;
  private deltas: number[] = [];
  private credit: number[] = [];

  constructor() {
    afterNextRender(() => {
      const motion = matchMedia('(prefers-reduced-motion: reduce)');
      this.reduced.set(motion.matches);
      if (motion.matches) this.playing.set(false);
      const seen = new IntersectionObserver(([e]) => {
        this.visible = e.isIntersecting;
        this.schedule();
      });
      seen.observe(this.host.nativeElement);
      this.drawAll(true);
      this.destroy.onDestroy(() => seen.disconnect());
    });
    // A fourth panel appears once a fast screen is measured, so watch canvases as they come and go.
    effect(() => {
      for (const c of this.canvases()) this.sized.observe(c.nativeElement);
    });
    this.destroy.onDestroy(() => {
      this.sized.disconnect();
      cancelAnimationFrame(this.frame);
    });
  }

  protected toggle() {
    this.playing.update((p) => !p);
    this.schedule();
  }

  protected choose(i: number | null) {
    this.pick.set(i);
    this.clock = 0;
    this.scene.set(i ?? 0);
    this.drawAll();
  }

  private schedule() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.last = 0;
    if (this.visible && this.playing()) this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  private tick(now: number) {
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    // Long gaps (a dropped tab, a stall) aren't refresh intervals: skip them and don't jump the scene.
    if (dt > 0 && dt < 100) {
      this.clock += dt / 1000;
      this.measure(dt);
    }
    if (this.pick() === null) {
      const next = Math.floor(this.clock / SCENE_SECS) % SCENES.length;
      if (next !== this.scene()) this.scene.set(next);
    }
    const r = this.refresh() ?? 60;
    const canvases = this.canvases();
    this.panels().forEach((p, i) => {
      const c = canvases[i]?.nativeElement;
      if (!c) return;
      if (p.fps >= r * 0.95) return this.draw(c);
      this.credit[i] = (this.credit[i] ?? 1) + p.fps / r;
      if (this.credit[i] >= 1) {
        this.credit[i] -= 1;
        this.draw(c);
      }
    });
    this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  /** Median of recent frame intervals, snapped to a standard refresh rate. */
  private measure(dt: number) {
    this.deltas.push(dt);
    if (this.deltas.length < SAMPLES) return;
    const sorted = [...this.deltas].sort((a, b) => a - b);
    this.deltas = [];
    const hz = 1000 / sorted[SAMPLES >> 1];
    const snapped = REFRESH.reduce((best, x) => (Math.abs(x - hz) < Math.abs(best - hz) ? x : best));
    if (snapped !== this.refresh()) {
      this.refresh.set(snapped);
      this.credit = [];
    }
  }

  private drawAll(resize = false) {
    for (const c of this.canvases()) {
      const el = c.nativeElement;
      if (resize) {
        // Capped below 2x: four canvases redrawing up to the screen's refresh rate is a lot of pixels on a phone.
        const dpr = Math.min(devicePixelRatio || 1, 1.5);
        const w = Math.round(el.clientWidth * dpr);
        const h = Math.round(el.clientHeight * dpr);
        if (w && h && (el.width !== w || el.height !== h)) {
          el.width = w;
          el.height = h;
        }
      }
      this.draw(el);
    }
  }

  /** Paints the current scene; when cycling, each scene's own clock starts at zero. */
  private draw(c: HTMLCanvasElement) {
    const g = c.getContext('2d');
    const { width: w, height: h } = c;
    if (!g || !w || !h) return;
    const t = this.pick() === null ? this.clock % SCENE_SECS : this.clock;
    SCENES[this.scene()].draw(g, w, h, t);
  }
}
