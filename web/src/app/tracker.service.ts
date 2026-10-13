import { Injectable, signal } from '@angular/core';
import {
  History, LiveCompat, PlayableGame, LiveGithub, LiveLibraries, LiveProject, MergeRow, ProjectDef, ProjectName,
} from './models';
import { PROJECTS, SOURCES } from './projects';
import { utcDay } from './format';

const GITHUB = 'https://api.github.com/';
const GITHUB_CACHE_KEY = 'pt-live-github';
/** Unauthenticated GitHub allows 60 core and 10 search calls per hour/minute; one refresh uses 9 and 6. */
const GITHUB_CACHE_MS = 5 * 60 * 1000;
const HISTORY_FILES = [
  'snapshots', 'compat_history', 'daily_activity', 'recent_merges', 'anyps5_libraries', 'satellites',
] as const;

export class RateLimitError extends Error {}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-cache', headers: { Accept: 'application/json' } });
  if (res.status === 403 || res.status === 429) {
    const body = await res.text();
    if (res.status === 429 || /rate limit/i.test(body)) throw new RateLimitError('GitHub rate limit reached');
    throw new Error(`HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

const count = <T>(items: T[], key: (t: T) => string | null | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    if (k) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

const emptyLive = (): Record<ProjectName, LiveProject> => ({ AnyPS5: {}, KytyPS5: {}, SharpEmu: {} });

@Injectable({ providedIn: 'root' })
export class TrackerService {
  readonly history = signal<History | null>(null);
  readonly historyError = signal<string | null>(null);
  readonly games = signal<PlayableGame[] | null>(null);
  readonly live = signal<Record<ProjectName, LiveProject>>(emptyLive());
  readonly liveAt = signal<Date | null>(null);
  readonly githubAt = signal<Date | null>(null);
  readonly loading = signal(false);
  readonly problems = signal<string[]>([]);

  async refreshAll(force = false): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.problems.set([]);
    try {
      await Promise.all([this.loadHistory(), this.loadLive(force)]);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadHistory(): Promise<void> {
    try {
      const parts = await Promise.all(HISTORY_FILES.map((f) => getJson<unknown[]>(`data/${f}.json`)));
      const h = Object.fromEntries(HISTORY_FILES.map((f, i) => [f, parts[i]])) as unknown as History;
      this.history.set(h);
      this.historyError.set(null);
      this.games.set(await getJson<PlayableGame[]>('data/playable_games.json').catch(() => this.games() ?? []));
    } catch {
      this.historyError.set(
        'Saved history could not be loaded. Run collect.py so the out/ folder has its JSON files.',
      );
    }
  }

  private async loadLive(force: boolean): Promise<void> {
    const live = emptyLive();
    const problems: string[] = [];
    const note = (what: string) => (e: unknown) => {
      problems.push(e instanceof RateLimitError ? `${what}: GitHub's hourly limit for this network is used up` : `${what} did not load`);
    };

    const github = this.githubLive(force).then(({ data, stale }) => {
      for (const p of PROJECTS) if (data[p.name]) live[p.name].github = data[p.name];
      if (stale) problems.push('GitHub figures are from the last successful refresh');
    }, note('GitHub figures'));

    const any = Promise.all([
      getJson<any>(SOURCES.anyps5Progress).then((d) => { live.AnyPS5.libraries = this.parseProgress(d); }, note('AnyPS5 progress report')),
      getJson<any>(SOURCES.anyps5Roadmap).then((d) => {
        live.AnyPS5.compat = {
          counts: count((d.titles ?? []) as any[], (t) => (t.id === 'PPSA00000' ? null : t.best_stage?.stage)),
        };
        live.AnyPS5.openBlockers = d.stats?.blockers_open;
      }, note('AnyPS5 blocker map')),
    ]);
    const kyty = getJson<any>(SOURCES.kytyCompat).then((d) => {
      const games = (Array.isArray(d) ? d : d.games ?? []) as any[];
      live.KytyPS5.compat = { counts: count(games, (g) => g.overall) };
    }, note('KytyPS5 compatibility list'));
    const sharp = getJson<any[]>(SOURCES.sharpCompat).then((d) => {
      const c: LiveCompat = { counts: count(d, (g) => (g.s === 'untested' ? null : g.s)), catalog: d.length };
      live.SharpEmu.compat = c;
    }, note('SharpEmu compatibility list'));

    await Promise.all([github, any, kyty, sharp]);
    this.live.set(live);
    this.liveAt.set(new Date());
    this.problems.set(problems);
  }

  private parseProgress(d: any): LiveLibraries {
    const lib = d.libraries;
    const groups = (lib.groups ?? []) as any[];
    return {
      done: lib.done,
      total: lib.total,
      percent: lib.percent,
      inert: groups.reduce((s, g) => s + (g.inert_names?.length ?? 0), 0),
      shaderDone: d.shaders?.done ?? 0,
      shaderTotal: d.shaders?.total ?? 0,
      groups: groups
        .map((g) => ({ library: g.label, done: g.done, todo: g.todo, total: g.done + g.todo, empty: g.inert_names?.length ?? 0 }))
        .sort((a, b) => b.todo - a.todo),
    };
  }

  /** GitHub figures for all three projects, cached briefly so reloads stay inside the unauthenticated limit. */
  private async githubLive(force: boolean): Promise<{ data: Partial<Record<ProjectName, LiveGithub>>; stale: boolean }> {
    const cached = this.readCache();
    if (cached && !force && Date.now() - cached.at < GITHUB_CACHE_MS) {
      this.githubAt.set(new Date(cached.at));
      return { data: cached.data, stale: false };
    }
    try {
      const today = utcDay(new Date());
      const results = await Promise.all(PROJECTS.map((p) => this.githubProject(p, today)));
      const data = Object.fromEntries(PROJECTS.map((p, i) => [p.name, results[i]]));
      const at = Date.now();
      try { localStorage.setItem(GITHUB_CACHE_KEY, JSON.stringify({ at, data })); } catch { /* storage unavailable */ }
      this.githubAt.set(new Date(at));
      return { data, stale: false };
    } catch (e) {
      if (cached) {
        this.githubAt.set(new Date(cached.at));
        return { data: cached.data, stale: true };
      }
      throw e;
    }
  }

  private readCache(): { at: number; data: Partial<Record<ProjectName, LiveGithub>> } | null {
    try {
      const raw = localStorage.getItem(GITHUB_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private async githubProject(p: ProjectDef, today: string): Promise<LiveGithub> {
    const search = (q: string) =>
      getJson<{ total_count: number }>(`${GITHUB}search/issues?q=${encodeURIComponent(`repo:${p.repo} ${q}`)}&per_page=1`);
    const [repo, openPrs, mergedToday, release, pulls] = await Promise.all([
      getJson<any>(`${GITHUB}repos/${p.repo}`),
      search('is:pr is:open'),
      search(`is:pr is:merged merged:>=${today}`),
      getJson<any>(`${GITHUB}repos/${p.repo}/releases/latest`).catch((e) => {
        if (e instanceof RateLimitError) throw e;
        return null;
      }),
      getJson<any[]>(`${GITHUB}repos/${p.repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`),
    ]);
    const recent: MergeRow[] = pulls
      .filter((pr) => pr.merged_at)
      .map((pr) => ({ project: p.name, number: pr.number, merged_at: pr.merged_at, title: pr.title, url: pr.html_url }));
    return {
      stars: repo.stargazers_count,
      // GitHub's open_issues_count includes open pull requests.
      openIssues: Math.max(0, repo.open_issues_count - openPrs.total_count),
      openPrs: openPrs.total_count,
      mergedToday: mergedToday.total_count,
      today,
      release: release?.tag_name ?? '',
      releaseAt: (release?.published_at ?? '').slice(0, 10),
      recent,
    };
  }
}
