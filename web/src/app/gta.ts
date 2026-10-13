import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { Icon } from './icon';
import { longDate, utcDay } from './format';
import { PROJECTS } from './projects';
import { ProjectName } from './models';

type Stage = 'none' | 'boots' | 'menus' | 'ingame' | 'playable';
const ORDER: Stage[] = ['none', 'boots', 'menus', 'ingame', 'playable'];
const LABEL: Record<Stage, string> = {
  none: 'Not tested',
  boots: 'Boots',
  menus: 'Menus',
  ingame: 'In-game',
  playable: 'Playable',
};

interface Report {
  stage: Stage;
  tested: string | null;
  url: string | null;
  fps: number | null;
}

interface GtaGame {
  name: string;
  titleIds: string[];
  released: string | null;
  projects: Record<ProjectName, Report | null>;
}

/** data/gta.json, written by collect.py from each project's compatibility list. */
interface GtaData {
  gta6: GtaGame;
  gtav: GtaGame;
}

interface Milestone {
  label: string;
  weight: number;
  /** 0 to 1: most milestones are met or not; system-function coverage counts partially. */
  progress: number;
}

interface MilestoneGroup {
  title: string;
  items: Milestone[];
}

const rank = (r: Report | null | undefined) => (r ? ORDER.indexOf(r.stage) : 0);

/** The furthest any emulator has got with a game, and the best frame rate reported at that stage. */
function best(game: GtaGame | undefined): { rank: number; fps: number } {
  const reports = Object.values(game?.projects ?? {}).filter((r): r is Report => !!r);
  const top = Math.max(0, ...reports.map(rank));
  const fps = Math.max(0, ...reports.filter((r) => rank(r) === top).map((r) => r.fps ?? 0));
  return { rank: top, fps };
}

/**
 * GTA 6 readiness: weighted milestones that can each be checked against the compatibility lists.
 * GTA 6 itself carries 60 points and reaching 100% needs it playable at 30+ FPS. GTA V's PS5 release
 * (same RAGE engine) carries 25, and AnyPS5's share of known PS5 system functions carries 15.
 */
@Component({
  selector: 'app-gta',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sec" id="gta6" aria-labelledby="gta6-h">
      <div class="sec-head">
        <h2 id="gta6-h"><app-icon name="gamepad" [size]="20" />GTA 6 on PS5 emulators</h2>
        <p class="note">How close PS5 emulation is to running Grand Theft Auto VI on PC. The score adds up checkable milestones, so it only reaches 100% once GTA 6 is playable at 30+ FPS on an emulator.</p>
      </div>
      @if (data(); as d) {
        <div class="grid two">
          <article class="card gta-score">
            <div class="gta-big num">{{ score() }}%</div>
            <div class="big-label">GTA 6 emulation readiness</div>
            <div class="track" role="progressbar" aria-label="GTA 6 emulation readiness" [attr.aria-valuenow]="score()" aria-valuemin="0" aria-valuemax="100">
              <div class="fill" [style.width.%]="score()"></div>
            </div>
            <p class="gta-release with-icon">
              <app-icon name="calendar" [size]="15" />
              @if (daysToRelease(); as n) {
                GTA 6 comes out on PS5 in {{ n }} {{ n === 1 ? 'day' : 'days' }} ({{ longDate(d.gta6.released!) }}). No emulator can test it before then.
              } @else if (d.gta6.released) {
                GTA 6 came out on PS5 on {{ longDate(d.gta6.released) }}.
              } @else {
                GTA 6's PS5 release date isn't listed yet.
              }
            </p>
            <table class="gta-table">
              <thead><tr><th>Emulator</th><th>GTA 6</th><th>GTA V (PS5)</th></tr></thead>
              <tbody>
                @for (p of projects; track p.name) {
                  <tr [style.--accent]="p.color">
                    <td><span class="with-icon"><span class="swatch" aria-hidden="true"></span>{{ p.name }}</span></td>
                    @for (g of [d.gta6, d.gtav]; track g.name) {
                      <td>
                        @if (g.projects[p.name]; as r) {
                          <span class="stage" [class]="'stage s-' + r.stage">{{ label(r.stage) }}</span>
                          @if (r.url) { <a class="gta-link" [href]="r.url" target="_blank" rel="noopener" [attr.aria-label]="g.name + ' report for ' + p.name"><app-icon name="external" [size]="12" /></a> }
                          @if (r.tested) { <span class="note num gta-date">{{ longDate(r.tested) }}</span> }
                        } @else {
                          <span class="stage s-none">Not tested</span>
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </article>
          <article class="card">
            <h3><app-icon name="flag" [size]="16" />Milestones</h3>
            @for (group of milestones(); track group.title) {
              <div class="gta-group">
                <h4>{{ group.title }}</h4>
                <ul class="gta-list">
                  @for (m of group.items; track m.label) {
                    <li [class.done]="m.progress >= 1">
                      <app-icon [name]="m.progress >= 1 ? 'check' : 'minus'" [size]="14" />
                      <span>{{ m.label }}</span>
                      <span class="note num">{{ points(m) }} / {{ m.weight }}</span>
                    </li>
                  }
                </ul>
              </div>
            }
          </article>
        </div>
      } @else {
        <div class="card"><div class="chart skeleton"></div></div>
      }
    </section>
  `,
})
export class GtaReadiness {
  /** AnyPS5's share of known PS5 system functions, 0 to 1. */
  readonly libraryShare = input<number | null>(null);

  protected readonly projects = PROJECTS;
  protected readonly longDate = longDate;
  protected readonly data = signal<GtaData | null>(null);

  protected readonly milestones = computed<MilestoneGroup[]>(() => {
    const d = this.data();
    if (!d) return [];
    const six = best(d.gta6);
    const five = best(d.gtav);
    const released = !!d.gta6.released && d.gta6.released <= utcDay(new Date());
    const met = (ok: boolean) => (ok ? 1 : 0);
    return [
      {
        title: 'GTA 6 itself',
        items: [
          { label: 'Out on PS5', weight: 10, progress: met(released) },
          { label: 'Boots on a PS5 emulator', weight: 10, progress: met(six.rank >= 1) },
          { label: 'Reaches the menus', weight: 10, progress: met(six.rank >= 2) },
          { label: 'Gets in-game', weight: 10, progress: met(six.rank >= 3) },
          { label: 'Playable', weight: 10, progress: met(six.rank >= 4) },
          { label: 'Playable at 30+ FPS', weight: 10, progress: met(six.rank >= 4 && six.fps >= 30) },
        ],
      },
      {
        title: 'GTA V on PS5 (same RAGE engine)',
        items: [
          { label: 'Boots', weight: 5, progress: met(five.rank >= 1) },
          { label: 'Reaches the menus', weight: 5, progress: met(five.rank >= 2) },
          { label: 'Gets in-game', weight: 7.5, progress: met(five.rank >= 3) },
          { label: 'Playable', weight: 7.5, progress: met(five.rank >= 4) },
        ],
      },
      {
        title: 'Emulator maturity',
        items: [
          {
            label: 'Known PS5 system functions implemented (AnyPS5)',
            weight: 15,
            progress: Math.min(Math.max(this.libraryShare() ?? 0, 0), 1),
          },
        ],
      },
    ];
  });

  protected readonly score = computed(() =>
    Math.round(this.milestones().flatMap((g) => g.items).reduce((sum, m) => sum + m.weight * m.progress, 0)),
  );

  protected readonly daysToRelease = computed(() => {
    const day = this.data()?.gta6.released;
    if (!day) return null;
    const days = Math.ceil((Date.parse(day + 'T00:00:00Z') - Date.now()) / 86_400_000);
    return days > 0 ? days : null;
  });

  constructor() {
    void fetch('data/gta.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: GtaData | null) => this.data.set(d?.gta6 && d?.gtav ? d : null))
      .catch(() => this.data.set(null));
  }

  protected label(stage: Stage): string {
    return LABEL[stage] ?? stage;
  }

  protected points(m: Milestone): string {
    return `${+(m.weight * m.progress).toFixed(1)}`;
  }
}
