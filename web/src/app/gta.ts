import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { Icon } from './icon';
import { fmt, longDate, utcDay } from './format';
import { PROJECTS } from './projects';
import { ProjectName, Snapshot } from './models';
import { LineChart, LineSeries } from './charts/line-chart';

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

/** data/gta_status.json: edited by hand when news breaks, since no compatibility list tracks it. */
interface GtaStatus {
  updated: string;
  copyable: boolean;
  copy_blocker: string;
}

interface Milestone {
  label: string;
  weight: number;
  /** 0 to 1: most milestones are met or not; system-function coverage counts partially. */
  progress: number;
  /** Why an unmet milestone is stuck, when that isn't obvious from its label. */
  note?: string;
}

interface MilestoneGroup {
  title: string;
  items: Milestone[];
}

/** AnyPS5's system-function counts on one day. */
export interface LibCount {
  done: number;
  total: number;
  percent: number;
}

type StageReport = Pick<Report, 'stage' | 'fps'>;
type Best = { rank: number; fps: number };

/** Everything the score depends on, for one day. */
interface ScoreInputs {
  six: Best;
  five: Best;
  released: boolean;
  copyable: boolean;
  copyBlocker?: string;
  lib: LibCount | null;
}

/** One milestone that moved between two days, and why. */
interface Change {
  label: string;
  before: number;
  after: number;
  detail: string;
}

const rank = (r: StageReport | null | undefined) => (r ? Math.max(ORDER.indexOf(r.stage), 0) : 0);

/** The furthest any emulator has got with a game, and the best frame rate reported at that stage. */
function best(reports: (StageReport | null | undefined)[]): Best {
  const got = reports.filter((r): r is StageReport => !!r);
  const top = Math.max(0, ...got.map(rank));
  const fps = Math.max(0, ...got.filter((r) => rank(r) === top).map((r) => r.fps ?? 0));
  return { rank: top, fps };
}

const met = (ok: boolean) => (ok ? 1 : 0);

function milestonesFor(i: ScoreInputs): MilestoneGroup[] {
  const { six, five } = i;
  return [
    {
      title: 'GTA 6 itself',
      items: [
        { label: 'Out on PS5', weight: 5, progress: met(i.released) },
        // A boot report proves someone copied it, whatever the hand-kept file says.
        { label: 'Can be copied from a PS5', weight: 5, progress: met(i.copyable || six.rank >= 1), note: i.copyBlocker },
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
          progress: Math.min(Math.max((i.lib?.percent ?? 0) / 100, 0), 1),
        },
      ],
    },
  ];
}

const pointsOf = (m: Milestone) => m.weight * m.progress;
const total = (groups: MilestoneGroup[]) => groups.flatMap((g) => g.items).reduce((sum, m) => sum + pointsOf(m), 0);
const one = (n: number) => Math.round(n * 10) / 10;
const pctText = (n: number) => `${n.toFixed(1)}%`;

/** Plain-language reason the system-function milestone moved. */
function libDetail(a: LibCount, b: LibCount): string {
  const found = b.total - a.total;
  const done = b.done - a.done;
  const parts: string[] = [];
  if (found) parts.push(`AnyPS5's list of known PS5 system functions ${found > 0 ? 'grew' : 'shrank'} by ${fmt(Math.abs(found))} to ${fmt(b.total)}`);
  if (done) parts.push(`${parts.length ? 'it' : 'AnyPS5'} ${done > 0 ? 'implemented' : 'lost'} ${fmt(Math.abs(done))} (${fmt(b.done)} done)`);
  const lead = parts.length ? parts.join(', while ') + '. ' : '';
  const fell = b.percent < a.percent;
  const tail = fell && done > 0
    ? " The share can fall while AnyPS5 makes progress: when it finds functions it hadn't counted, the total grows faster than the number done."
    : '';
  return `${lead}Its share ${fell ? 'fell' : 'rose'} from ${pctText(a.percent)} to ${pctText(b.percent)}.${tail}`;
}

/**
 * GTA 6 readiness: weighted milestones that can each be checked against the compatibility lists.
 * GTA 6 itself carries 60 points and reaching 100% needs it playable at 30+ FPS. Before any emulator can
 * test it, someone has to be able to copy it off a PS5 (data/gta_status.json, kept by hand). GTA V's PS5 release
 * (same RAGE engine) carries 25, and AnyPS5's share of known PS5 system functions carries 15.
 */
@Component({
  selector: 'app-gta',
  imports: [Icon, LineChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sec major" id="gta6" aria-labelledby="gta6-h">
      <div class="sec-head">
        <h2 id="gta6-h">GTA 6 on PS5 emulators</h2>
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
                GTA 6 comes out on PS5 in {{ n }} {{ n === 1 ? 'day' : 'days' }} ({{ longDate(d.gta6.released!) }}). No emulator can test it before then, and not until someone can copy it off a PS5.
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
                      @if (m.note && m.progress < 1) { <span class="note gta-why">{{ m.note }}</span> }
                    </li>
                  }
                </ul>
              </div>
            }
            @if (hasPage()) { <p class="gta-more"><a href="gta-6/">Can you play GTA 6 on PC? The full answer</a></p> }
          </article>
        </div>
        @if (why(); as w) {
          <div class="grid two gta-history">
            <article class="card gta-why-card" aria-labelledby="gta-why-h">
              <h3 id="gta-why-h"><app-icon name="info" [size]="16" />Why it changed</h3>
              <p class="gta-why-sum">
                <span class="num">{{ one(w.before) }}%</span> on {{ longDate(w.since) }}, <span class="num">{{ one(w.after) }}%</span> now
                @if (one(w.after) !== one(w.before)) {
                  <span class="note num">({{ signed(w.after - w.before) }} points)</span>
                }
              </p>
              @if (w.changes.length) {
                <ul class="gta-changes">
                  @for (c of w.changes; track c.label) {
                    <li>
                      <span class="gta-change-head"><b>{{ c.label }}</b><span class="num" [class.up]="c.after > c.before" [class.down]="c.after < c.before">{{ one(c.before) }} → {{ one(c.after) }} points</span></span>
                      <span class="note">{{ c.detail }}</span>
                    </li>
                  }
                </ul>
              } @else {
                <p class="note">No milestone has changed since then.</p>
              }
              @if (w.biggestDrop; as b) {
                <p class="note">Biggest one-day drop: {{ one(-b.points) }} points on {{ longDate(b.date) }}. {{ b.detail }}</p>
              }
            </article>
            <article class="card" aria-labelledby="gta-days-h">
              <h3 id="gta-days-h"><app-icon name="chart" [size]="16" />Readiness by day</h3>
              <app-line-chart [series]="series()" unit="%" label="GTA 6 emulation readiness score by day" />
            </article>
          </div>
        }
      } @else {
        <div class="card"><div class="chart skeleton"></div></div>
      }
    </section>
  `,
})
export class GtaReadiness {
  /** AnyPS5's system-function counts today: live when its progress report answered, else the last snapshot. */
  readonly libraries = input<LibCount | null>(null);
  /** Saved daily snapshots, for the score by day. */
  readonly snapshots = input<Snapshot[]>([]);
  /** The static gta-6/ page exists only in the published build (seo.py writes it). */
  readonly hasPage = input(false);

  protected readonly projects = PROJECTS;
  protected readonly longDate = longDate;
  protected readonly data = signal<GtaData | null>(null);
  protected readonly status = signal<GtaStatus | null>(null);

  private readonly today = utcDay(new Date());

  /** What the score rests on today, from the latest compatibility reports. */
  private readonly current = computed<ScoreInputs | null>(() => {
    const d = this.data();
    if (!d) return null;
    const st = this.status();
    return {
      six: best(Object.values(d.gta6.projects)),
      five: best(Object.values(d.gtav.projects)),
      released: !!d.gta6.released && d.gta6.released <= this.today,
      copyable: !!st?.copyable,
      copyBlocker: st?.copy_blocker,
      lib: this.libraries(),
    };
  });

  protected readonly milestones = computed<MilestoneGroup[]>(() => {
    const c = this.current();
    return c ? milestonesFor(c) : [];
  });

  protected readonly score = computed(() => Math.round(total(this.milestones())));

  /**
   * The inputs on each saved day. Snapshots record each emulator's GTA stages from late October 2026; for
   * earlier days a current report counts from its test date on, which matches every report so far.
   */
  private readonly days = computed(() => {
    const d = this.data();
    if (!d) return [];
    const st = this.status();
    const byDay = new Map<string, Snapshot[]>();
    for (const s of this.snapshots()) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
    const onDay = (key: 'gta6' | 'gtav', day: string, rows: Snapshot[]) =>
      best(PROJECTS.map((p): StageReport | null => {
        const row = rows.find((r) => r.project === p.name);
        if (row && `${key}_stage` in row) {
          const stage = row[`${key}_stage`] as Stage | null | undefined;
          return stage ? { stage, fps: row[`${key}_fps`] ?? null } : null;
        }
        const r = d[key].projects[p.name];
        return r && (!r.tested || r.tested <= day) ? r : null;
      }));
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([day, rows]) => {
        const any = rows.find((r) => r.project === 'AnyPS5');
        if (any?.lib_percent == null || any.lib_done == null || any.lib_total == null) return [];
        const inputs: ScoreInputs = {
          six: onDay('gta6', day, rows),
          five: onDay('gtav', day, rows),
          released: !!d.gta6.released && d.gta6.released <= day,
          copyable: !!st?.copyable && st.updated <= day,
          lib: { done: any.lib_done, total: any.lib_total, percent: any.lib_percent },
        };
        return [{ day, inputs, points: total(milestonesFor(inputs)) }];
      });
  });

  protected readonly series = computed<LineSeries[]>(() => {
    const points = this.days().map((x) => ({ date: x.day, value: one(x.points), live: false }));
    const c = this.current();
    if (c?.lib) {
      const now = { date: this.today, value: one(total(milestonesFor(c))), live: true };
      if (points.at(-1)?.date === now.date) points[points.length - 1] = now;
      else points.push(now);
    }
    return points.length > 1 ? [{ name: 'Readiness', color: 'var(--fg)', points }] : [];
  });

  /** Today against the last saved day before it, milestone by milestone. */
  protected readonly why = computed(() => {
    const c = this.current();
    const prev = this.days().filter((x) => x.day < this.today).at(-1);
    if (!c?.lib || !prev) return null;
    const before = milestonesFor(prev.inputs);
    const after = milestonesFor(c);
    return {
      since: prev.day,
      before: total(before),
      after: total(after),
      changes: this.diff(before, after, prev.inputs, c),
      biggestDrop: this.biggestDrop(),
    };
  });

  private diff(before: MilestoneGroup[], after: MilestoneGroup[], a: ScoreInputs, b: ScoreInputs): Change[] {
    const out: Change[] = [];
    after.forEach((g, gi) => g.items.forEach((m, mi) => {
      const old = before[gi].items[mi];
      if (Math.abs(pointsOf(m) - pointsOf(old)) < 0.05) return;
      const game = g.title.startsWith('GTA 6') ? 'GTA 6: ' : g.title.startsWith('GTA V') ? 'GTA V: ' : '';
      const detail = m.weight === 15 && a.lib && b.lib
        ? libDetail(a.lib, b.lib)
        : pointsOf(m) > pointsOf(old) ? 'Now met.' : 'No longer met: the latest report no longer shows it.';
      out.push({ label: game + m.label, before: pointsOf(old), after: pointsOf(m), detail });
    }));
    return out;
  }

  /** The largest fall between two saved days, with its reason when AnyPS5's function list drove it. */
  private biggestDrop(): { date: string; points: number; detail: string } | null {
    const days = this.days();
    let worst: { date: string; points: number; detail: string } | null = null;
    for (let i = 1; i < days.length; i++) {
      const drop = days[i].points - days[i - 1].points;
      if (drop > -0.5 || (worst && drop >= worst.points)) continue;
      const a = days[i - 1].inputs.lib!;
      const b = days[i].inputs.lib!;
      const detail = b.total > a.total
        ? `AnyPS5's list of known PS5 system functions grew from ${fmt(a.total)} to ${fmt(b.total)} that day, so its share fell from ${pctText(a.percent)} to ${pctText(b.percent)}.`
        : '';
      worst = { date: days[i].day, points: drop, detail };
    }
    return worst;
  }

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
    void fetch('data/gta_status.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: GtaStatus | null) => this.status.set(typeof s?.copyable === 'boolean' ? s : null))
      .catch(() => this.status.set(null));
  }

  protected label(stage: Stage): string {
    return LABEL[stage] ?? stage;
  }

  protected points(m: Milestone): string {
    return `${+(m.weight * m.progress).toFixed(1)}`;
  }

  protected one(n: number): number {
    return one(n);
  }

  /** "+0.4" or "−0.4", with a real minus sign. */
  protected signed(n: number): string {
    const v = one(n);
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
  }
}
