import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { BarChart, BarDatum } from './charts/bar-chart';
import { LineChart, LineSeries } from './charts/line-chart';
import { FundButton } from './fund';
import { GtaReadiness } from './gta';
import { ContributorsBoard } from './contributors';
import { countVisit } from './site';
import { Forecast, Point, pace, project, when } from './forecast';
import { Icon, IconName } from './icon';
import { daysBefore, fmt, longDate, pct, signed, timeAgo, utcDay } from './format';
import { PlayableGame, ProjectDef, ProjectName, Snapshot } from './models';
import { GTA6_RELEASE, PROJECTS, PS5_CATALOG_FALLBACK } from './projects';
import { TrackerService } from './tracker.service';

interface Stat {
  label: string;
  value: string;
  live: boolean;
}

interface CardVm {
  def: ProjectDef;
  headline: string;
  headlineLabel: string;
  live: boolean;
  delta: string | null;
  /** A second line under the delta, where the headline figure alone would mislead. */
  deltaNote: string | null;
  deltaUp: boolean;
  deltaDown: boolean;
  groups: StatGroup[];
  mergesUrl: string;
}

interface StatGroup {
  title: string;
  icon: IconName;
  stats: Stat[];
}

/** One emulator's progress meter in the hero. */
interface Progress {
  name: ProjectName;
  color: string;
  share: number | null;
  value: string;
  measure: string;
}

interface RoadRow {
  metric: string;
  done: number;
  total: number;
  share: number;
  left: number;
}

interface Eta {
  goal: string;
  text: string;
  detail: string;
}

const AUTO_REFRESH_MS = 15 * 60 * 1000;
/** --stage-0 … --stage-7 in styles.css. */
const STAGE_COLORS = 8;

type Theme = 'light' | 'dark';
const THEME_KEY = 'ps5-tracker-theme';

/** The saved choice; light until the viewer picks dark. */
function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

@Component({
  selector: 'app-root',
  imports: [BarChart, LineChart, Icon, FundButton, GtaReadiness, ContributorsBoard],
  templateUrl: './app.html',
})
export class App {
  protected readonly svc = inject(TrackerService);
  protected readonly projects = PROJECTS;
  protected readonly fmt = fmt;
  protected readonly pct = pct;
  protected readonly longDate = longDate;
  protected readonly now = signal(new Date());

  protected readonly themes: { value: Theme; label: string; icon: IconName }[] = [
    { value: 'light', label: 'Light', icon: 'sun' },
    { value: 'dark', label: 'Dark', icon: 'moon' },
  ];
  protected readonly theme = signal<Theme>(readTheme());

  protected readonly navLinks = [
    { href: '#projects', label: 'Emulators' },
    { href: '#gta6', label: 'GTA 6' },
    { href: '#playable', label: 'Games' },
    { href: '#contributors', label: 'People' },
    { href: '#faq', label: 'FAQ' },
  ];

  constructor() {
    countVisit();
    void this.svc.refreshAll();
    const clock = setInterval(() => this.now.set(new Date()), 30_000);
    const auto = setInterval(() => void this.svc.refreshAll(), AUTO_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(clock);
      clearInterval(auto);
    });
  }

  protected setTheme(theme: Theme): void {
    this.theme.set(theme);
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Storage can be blocked; the choice then lasts until the page reloads.
    }
  }

  protected refresh(): void {
    void this.svc.refreshAll(true);
  }

  private readonly today = computed(() => utcDay(this.now()));

  private latestSnap(name: ProjectName): Snapshot | undefined {
    const rows = this.svc.history()?.snapshots.filter((s) => s.project === name) ?? [];
    return rows.reduce<Snapshot | undefined>((a, b) => (!a || b.date > a.date ? b : a), undefined);
  }

  /** AnyPS5's system-function counts, live when its progress report answered, else the last snapshot. */
  protected readonly anyLib = computed(() => {
    const live = this.svc.live().AnyPS5.libraries;
    if (live) return { done: live.done, total: live.total, percent: live.percent };
    const s = this.latestSnap('AnyPS5');
    return s?.lib_percent != null && s.lib_done != null && s.lib_total != null
      ? { done: s.lib_done, total: s.lib_total, percent: s.lib_percent } : null;
  });

  /** AnyPS5's share of known PS5 system functions, live when its progress report answered. */
  protected readonly anyLibShare = computed(() => {
    const live = this.svc.live().AnyPS5.libraries;
    if (live) return live.percent / 100;
    const pct = this.latestSnap('AnyPS5')?.lib_percent;
    return pct != null ? pct / 100 : null;
  });

  protected readonly catalog = computed(
    () => this.svc.live().SharpEmu.compat?.catalog ?? this.latestSnap('SharpEmu')?.catalog ?? PS5_CATALOG_FALLBACK,
  );

  protected readonly savedThrough = computed(() => {
    const dates = this.svc.history()?.snapshots.map((s) => s.date) ?? [];
    return dates.length ? dates.reduce((a, b) => (b > a ? b : a)) : null;
  });

  protected readonly liveStatus = computed(() => {
    const at = this.svc.liveAt();
    if (this.svc.loading() && !at) return 'Loading live figures…';
    if (!at) return 'Live figures not loaded';
    const gh = this.svc.githubAt();
    const ghText = gh ? ` · GitHub figures ${timeAgo(gh, this.now())}` : '';
    return `Live · updated ${timeAgo(at, this.now())}${ghText}`;
  });

  /** Days until GTA 6 reaches PS5, or null once it's out. */
  protected readonly gtaDays = computed(() => {
    const days = Math.round((Date.parse(GTA6_RELEASE) - Date.parse(this.today())) / 86_400_000);
    return days > 0 ? days : null;
  });

  /**
   * The hero's progress meters. AnyPS5 is measured by system functions implemented; KytyPS5 and SharpEmu by
   * the share of their tested games that reach their top tier, the closest each has to a progress figure.
   */
  protected readonly progress = computed<Progress[]>(() =>
    PROJECTS.map((p) => {
      let share: number | null;
      let measure: string;
      if (p.name === 'AnyPS5') {
        share = this.anyLibShare();
        measure = 'of known system functions implemented';
      } else {
        const top = this.topCount(p);
        const tested = this.testedCount(p);
        share = top != null && tested ? top / tested : null;
        measure = `of tested games reach ${p.ladder.find((s) => s.key === p.topKey)!.label.toLowerCase()}`;
      }
      if (share != null) share = Math.min(Math.max(share, 0), 1);
      return { name: p.name, color: p.color, share, measure, value: share == null ? '…' : pct(share, 0) };
    }),
  );

  /** Main figure per project: live where its source answered, else the last saved snapshot. */
  private headline(p: ProjectDef): { value: number | null; kind: 'share' | 'count'; live: boolean } {
    const lv = this.svc.live()[p.name];
    const snap = this.latestSnap(p.name);
    if (p.name === 'AnyPS5') {
      if (lv.libraries) return { value: lv.libraries.percent / 100, kind: 'share', live: true };
      return { value: snap?.lib_percent != null ? snap.lib_percent / 100 : null, kind: 'share', live: false };
    }
    if (lv.compat) return { value: lv.compat.counts[p.topKey] ?? 0, kind: 'count', live: true };
    return { value: snap?.games_top ?? null, kind: 'count', live: false };
  }

  /** Projected finish dates, from the saved daily history only so a live blip can't swing them. */
  private etas(p: ProjectDef, tier: string): Eta[] {
    const h = this.svc.history();
    if (!h) return [];
    const etas: Eta[] = [];
    if (p.name === 'AnyPS5') {
      const shares: Point[] = h.snapshots
        .filter((s) => s.project === 'AnyPS5' && s.lib_percent != null)
        .map((s) => ({ date: s.date, value: s.lib_percent! / 100 }));
      etas.push(this.eta('All known system functions implemented', project(shares, 1), (n) => `+${(n * 100).toFixed(1)} points`));
    }
    const byDay = new Map<string, number>();
    for (const r of h.compat_history) {
      if (r.project === p.name && r.top) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.games);
    }
    const tops: Point[] = [...byDay].map(([date, value]) => ({ date, value }));
    etas.push(this.eta(`All ${fmt(this.catalog())} catalog games ${tier}`, project(tops, this.catalog()), (n) => `+${fmt(Math.round(n))} games`));
    return etas;
  }

  private eta(goal: string, f: Forecast, unit: (n: number) => string): Eta {
    switch (f.kind) {
      case 'done':
        return { goal, text: 'Done', detail: '' };
      case 'early':
        return { goal, text: 'Not enough history yet', detail: `Needs ${f.needed} days of daily data; ${f.days ? `${f.days} so far` : 'collection starts today'}.` };
      case 'flat':
        return { goal, text: 'No forecast', detail: `No progress in the last ${f.window} days.` };
      case 'eta':
        return { goal, text: when(f), detail: pace(f, unit) };
    }
  }

  private topCount(p: ProjectDef): number | null {
    const lv = this.svc.live()[p.name];
    if (lv.compat) return lv.compat.counts[p.topKey] ?? 0;
    return this.latestSnap(p.name)?.games_top ?? null;
  }

  private testedCount(p: ProjectDef): number | null {
    const lv = this.svc.live()[p.name];
    if (lv.compat) return Object.values(lv.compat.counts).reduce((a, b) => a + b, 0);
    return this.latestSnap(p.name)?.games_tested ?? null;
  }

  protected readonly cards = computed<CardVm[]>(() =>
    PROJECTS.map((p) => {
      const h = this.svc.history();
      const lv = this.svc.live()[p.name];
      const gh = lv.github;
      const snap = this.latestSnap(p.name);
      const head = this.headline(p);
      const weekAgo = daysBefore(this.today(), 7);

      let delta: number | null = null;
      let deltaText: string | null = null;
      let deltaNote: string | null = null;
      if (head.value != null && h) {
        if (p.name === 'AnyPS5') {
          const before = h.snapshots
            .filter((s) => s.project === p.name && s.date <= weekAgo && s.lib_percent != null)
            .sort((a, b) => a.date.localeCompare(b.date))
            .at(-1);
          // The share is implemented ÷ known functions, and AnyPS5 keeps finding more of them, so the share
          // can fall in a week of real progress. Lead with functions implemented; explain the share below it.
          const done = lv.libraries?.done ?? snap?.lib_done;
          const total = lv.libraries?.total ?? snap?.lib_total;
          if (before) {
            const points = head.value - before.lib_percent! / 100;
            const pts = signed(points, (v) => (v * 100).toFixed(1));
            if (done != null && total != null && before.lib_done != null && before.lib_total != null) {
              delta = done - before.lib_done;
              const found = total - before.lib_total;
              deltaText = `${signed(delta, fmt)} functions implemented in 7 days`;
              deltaNote =
                found > 0 && points < 0
                  ? `The share is down ${pts.slice(1)} points only because AnyPS5 found ${fmt(found)} more functions it has to implement.`
                  : found > 0
                    ? `Share ${pts} points, while ${fmt(found)} more functions became known.`
                    : `Share ${pts} points.`;
            } else {
              delta = points;
              deltaText = `${pts} points in 7 days`;
            }
          }
        } else {
          const before = h.compat_history
            .filter((r) => r.project === p.name && r.top && r.date <= weekAgo)
            .sort((a, b) => a.date.localeCompare(b.date))
            .at(-1);
          if (before) {
            delta = head.value - before.games;
            deltaText = `${signed(delta, fmt)} games in 7 days`;
          }
        }
      }

      const todayRow = h?.daily_activity.find((r) => r.project === p.name && r.day === this.today());
      const ai = snap?.ai_commits_30d;
      const release = gh?.release || snap?.latest_release || '';
      const releaseAt = gh?.releaseAt || snap?.latest_release_at || '';
      const backlog: Stat[] = [
        { label: 'Open issues', value: fmt(gh?.openIssues ?? snap?.open_issues), live: !!gh },
        { label: 'Open pull requests', value: fmt(gh?.openPrs ?? snap?.open_prs), live: !!gh },
      ];
      if (p.name === 'AnyPS5') {
        backlog.push({ label: 'Open blockers', value: fmt(lv.openBlockers ?? snap?.open_blockers), live: lv.openBlockers != null });
      }
      const groups: StatGroup[] = [
        {
          title: 'Activity',
          icon: 'chart',
          stats: [
            { label: 'Merged today', value: fmt(gh?.mergedToday ?? todayRow?.merged_prs), live: !!gh },
            { label: 'Merged, 30 days', value: fmt(snap?.merged_prs_30d), live: false },
            {
              label: 'AI-assisted, 30 days',
              value: ai != null && snap?.commits_30d ? `${pct(ai / snap.commits_30d, 0)} · ${fmt(ai)}` : fmt(ai),
              live: false,
            },
          ],
        },
        { title: 'Backlog', icon: 'layers', stats: backlog },
        {
          title: 'Community',
          icon: 'users',
          stats: [
            { label: 'Contributors, 30 days', value: fmt(snap?.contributors_30d), live: false },
            { label: 'Contributors, all time', value: fmt(snap?.contributors), live: false },
            { label: 'Stars', value: fmt(gh?.stars ?? snap?.stars), live: !!gh },
          ],
        },
        {
          title: 'Release',
          icon: 'tag',
          stats: [
            { label: 'Latest version', value: release || 'None', live: !!gh },
            ...(releaseAt ? [{ label: 'Released', value: longDate(releaseAt), live: !!gh }] : []),
          ],
        },
      ];

      return {
        def: p,
        headline: head.kind === 'share' ? pct(head.value, 2) : fmt(head.value),
        headlineLabel:
          p.name === 'AnyPS5'
            ? 'of known system functions implemented'
            : p.name === 'KytyPS5'
              ? 'games reach in-game'
              : 'games playable',
        live: head.live,
        delta: deltaText,
        deltaNote,
        deltaUp: (delta ?? 0) > 0,
        deltaDown: (delta ?? 0) < 0,
        groups,
        mergesUrl: `https://github.com/${p.repo}/pulls?q=is%3Apr+is%3Amerged+sort%3Aupdated-desc`,
      };
    }),
  );

  protected readonly road = computed(() =>
    PROJECTS.map((p) => {
      const rows: RoadRow[] = [];
      const add = (metric: string, done: number | null | undefined, total: number | null | undefined) => {
        if (done == null || !total) return;
        rows.push({ metric, done, total, share: done / total, left: total - done });
      };
      if (p.name === 'AnyPS5') {
        const lib = this.svc.live().AnyPS5.libraries;
        const snap = this.latestSnap('AnyPS5');
        const done = lib?.done ?? snap?.lib_done;
        const total = lib?.total ?? snap?.lib_total;
        const inert = lib?.inert ?? snap?.lib_inert;
        add('Known system functions implemented', done, total);
        add('Known system functions doing real work', done != null && inert != null ? done - inert : null, total);
        add('Shader instructions decoded', lib?.shaderDone ?? snap?.shader_done, lib?.shaderTotal ?? snap?.shader_total);
      }
      const tier = p.ladder.find((s) => s.key === p.topKey)!.label.toLowerCase();
      add(`Catalog games at top tier (${tier})`, this.topCount(p), this.catalog());
      add('Catalog games tested', this.testedCount(p), this.catalog());
      return { def: p, rows, etas: this.etas(p, tier) };
    }),
  );

  protected readonly activity = computed(() =>
    PROJECTS.map((p) => {
      const gh = this.svc.live()[p.name].github;
      const data: BarDatum[] = (this.svc.history()?.daily_activity ?? [])
        .filter((r) => r.project === p.name)
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((r) => ({ day: r.day, value: r.merged_prs, commits: r.commits, live: false }));
      if (gh) {
        const i = data.findIndex((d) => d.day === gh.today);
        if (i >= 0) data[i] = { ...data[i], value: gh.mergedToday, live: true };
        else if (!data.length || gh.today > data.at(-1)!.day) {
          data.push({ day: gh.today, value: gh.mergedToday, commits: 0, live: true });
          if (data.length > 30) data.shift();
        }
      }
      const total = data.reduce((s, d) => s + d.value, 0);
      return { def: p, data, total };
    }),
  );

  protected readonly topSeries = computed<LineSeries[]>(() =>
    PROJECTS.map((p) => {
      const points = (this.svc.history()?.compat_history ?? [])
        .filter((r) => r.project === p.name && r.top)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => ({ date: r.date, value: r.games, live: false }));
      const lv = this.svc.live()[p.name].compat;
      if (lv) {
        const point = { date: this.today(), value: lv.counts[p.topKey] ?? 0, live: true };
        if (points.at(-1)?.date === point.date) points[points.length - 1] = point;
        else points.push(point);
      }
      const tier = p.ladder.find((s) => s.key === p.topKey)!.label.toLowerCase();
      return { name: `${p.name} (${tier})`, color: p.color, points };
    }).filter((s) => s.points.length),
  );

  protected readonly ladder = computed(() => {
    const groups = PROJECTS.map((p) => {
      const live = this.svc.live()[p.name].compat?.counts;
      let byKey: Record<string, number> | null = live ?? null;
      if (!byKey) {
        const rows = (this.svc.history()?.compat_history ?? []).filter((r) => r.project === p.name);
        const last = rows.reduce((m, r) => (r.date > m ? r.date : m), '');
        if (last) {
          byKey = {};
          for (const r of rows.filter((x) => x.date === last)) byKey[p.ladder[r.rank]?.key ?? r.status] = r.games;
        }
      }
      const n = p.ladder.length;
      const segs = p.ladder.map((s, i) => ({
        label: s.label,
        games: byKey?.[s.key] ?? 0,
        // a distinct hue per stage, red for the lowest; the top tier is always green
        color: `var(--stage-${i === n - 1 ? STAGE_COLORS - 1 : Math.min(i, STAGE_COLORS - 2)})`,
      }));
      return { def: p, segs, total: segs.reduce((a, s) => a + s.games, 0), live: !!live };
    }).filter((g) => g.total > 0);
    const max = Math.max(1, ...groups.map((g) => g.total));
    return groups.map((g) => ({ ...g, width: (g.total / max) * 100 }));
  });

  protected readonly gameSorts: { value: GameSort; label: string }[] = [
    { value: 'tested', label: 'Testing date (newest)' },
    { value: 'title', label: 'Alphabetical, A to Z' },
    { value: 'popularity', label: 'Popularity (most ratings)' },
    { value: 'released', label: 'Release date (newest)' },
    { value: 'fps', label: 'Frame rate (highest)' },
  ];
  protected readonly gameSort = signal<GameSort>('tested');
  protected readonly gameQuery = signal('');

  /** Games at each project's top tier, filtered by the search box and in the chosen order. */
  protected readonly playable = computed(() => {
    const all = this.svc.games() ?? [];
    const q = this.gameQuery().trim().toLowerCase();
    const order = GAME_ORDER[this.gameSort()];
    return PROJECTS.map((p) => {
      const mine = all.filter((g) => g.project === p.name);
      const withFps = mine.filter((g) => g.fps_value != null);
      const games = mine
        .filter((g) => !q || g.title.toLowerCase().includes(q) || g.titleId.toLowerCase().includes(q))
        .sort((a, b) => order(a, b) || a.title.localeCompare(b.title));
      return {
        def: p,
        games,
        total: mine.length,
        tier: p.ladder.find((s) => s.key === p.topKey)!.label,
        withFps: withFps.length,
        smooth: withFps.filter((g) => g.fps_value! >= 30).length,
      };
    });
  });

  protected readonly gameMatches = computed(() => this.playable().reduce((n, b) => n + b.games.length, 0));

  protected onGameQuery(ev: Event): void {
    this.gameQuery.set((ev.target as HTMLInputElement).value);
  }

  protected onGameSort(ev: Event): void {
    this.gameSort.set((ev.target as HTMLSelectElement).value as GameSort);
  }

  protected compact(n: number): string {
    return COMPACT.format(n);
  }

  protected readonly brokenCovers = signal<ReadonlySet<string>>(new Set());

  protected coverFailed(g: PlayableGame): void {
    this.brokenCovers.update((s) => new Set(s).add(g.project + g.titleId));
  }

  /** PlayStation's image server resizes on request; the originals are 3840px and ~300 KB each. */
  protected coverSrc(g: PlayableGame, width: number): string {
    const url = g.cover ?? '';
    return url.startsWith('https://image.api.playstation.com/') ? `${url}${url.includes('?') ? '&' : '?'}w=${width}` : url;
  }

  /** The game's own page, when the published build has one. */
  protected gamePage(g: PlayableGame): string | null {
    return g.page && GAME_PAGE.test(g.page) ? g.page : null;
  }

  protected readonly hasGamePages = computed(() => this.gamePageCount() > 0);

  /** Number of distinct game pages; a game listed by two emulators shares one page. */
  protected readonly gamePageCount = computed(
    () => new Set((this.svc.games() ?? []).map((g) => this.gamePage(g)).filter(Boolean)).size,
  );

  protected fpsClass(g: PlayableGame): string {
    const v = g.fps_value;
    return v == null ? 'none' : v >= 55 ? 'good' : v >= 25 ? 'ok' : 'low';
  }

  /** Just the GPU from a "CPU / GPU / RAM" hardware string, which is what decides frame rate. */
  protected gpu(hw: string | null): string | null {
    if (!hw) return null;
    const parts = hw.split(/\s*[/;]\s*|\s*,\s*(?=GPU)/i).map((x) => x.replace(/^GPU:\s*/i, '').trim());
    const gpu = parts.find((x) => /rtx|gtx|radeon|rx\s?\d|arc|geforce|intel (uhd|hd|iris)|\d{4}\s?(xt|ti)/i.test(x));
    return (gpu ?? parts[parts.length > 1 ? 1 : 0] ?? hw).slice(0, 48);
  }

  protected initials(title: string): string {
    const words = title.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean);
    const main = words.filter((w) => !/^(a|an|and|of|the|to|in|on|for)$/i.test(w));
    return (main.length ? main : words).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }

  protected readonly satellites = computed(() =>
    [...(this.svc.history()?.satellites ?? [])].sort((a, b) => b.commits_30d - a.commits_30d),
  );
}

type GameSort = 'tested' | 'title' | 'popularity' | 'released' | 'fps';

/** Sorts a nullable field with missing values always last, whichever direction. */
const GAME_PAGE = /^games\/[a-z0-9-]+\/$/;

function by<T>(get: (g: PlayableGame) => T | null, dir: 1 | -1, cmp: (a: T, b: T) => number) {
  return (a: PlayableGame, b: PlayableGame): number => {
    const x = get(a);
    const y = get(b);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    return cmp(x, y) * dir;
  };
}
const num = (a: number, b: number) => a - b;
const str = (a: string, b: string) => a.localeCompare(b);

const GAME_ORDER: Record<GameSort, (a: PlayableGame, b: PlayableGame) => number> = {
  tested: by((g) => g.tested, -1, str),
  title: by((g) => g.title, 1, (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
  popularity: by((g) => g.ratings, -1, num),
  released: by((g) => g.released, -1, str),
  fps: by((g) => g.fps_value, -1, num),
};

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
