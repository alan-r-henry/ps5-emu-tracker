export type ProjectName = 'AnyPS5' | 'KytyPS5' | 'SharpEmu';

export interface Stage {
  key: string;
  label: string;
}

export interface ProjectDef {
  name: ProjectName;
  repo: string;
  approach: string;
  /** CSS custom property holding the project's series color. */
  color: string;
  topKey: string;
  ladder: Stage[];
}

/** One row per project per day, written by collect.py. */
export interface Snapshot {
  date: string;
  project: ProjectName;
  repo: string;
  stars: number;
  forks: number;
  open_issues: number;
  open_prs: number;
  merged_prs_30d: number;
  commits_30d: number;
  /** People with a GitHub account who committed: ever, and in the last 30 days. Bots excluded. */
  contributors?: number;
  contributors_30d?: number;
  /** Commits in the last 30 days that name an AI coding agent as author or co-author. */
  ai_commits_30d?: number;
  issues_closed_30d: number;
  games_tested: number;
  games_top: number;
  top_tier: string;
  catalog: number | null;
  hle_functions: number;
  latest_release: string;
  latest_release_at: string;
  lib_done?: number;
  lib_total?: number;
  lib_percent?: number;
  lib_inert?: number;
  shader_done?: number;
  shader_total?: number;
  open_blockers?: number;
}

export interface CompatRow {
  date: string;
  project: ProjectName;
  rank: number;
  status: string;
  games: number;
  top: boolean;
}

export interface ActivityRow {
  day: string;
  project: ProjectName;
  merged_prs: number;
  commits: number;
}

export interface MergeRow {
  project: ProjectName;
  number: number;
  merged_at: string;
  title: string;
  url: string;
}

export interface LibraryRow {
  library: string;
  done: number;
  todo: number;
  total: number;
  empty: number;
}

export interface SatelliteRow {
  repo: string;
  role: string;
  stars: number;
  last_push: string;
  commits_30d: number;
  archived: boolean;
}

/** A game at its project's top compatibility tier, written by collect.py. */
export interface PlayableGame {
  project: ProjectName;
  tier: string;
  titleId: string;
  title: string;
  cover: string | null;
  fps: string | null;
  fps_value: number | null;
  fps_note: string | null;
  os: string | null;
  hardware: string | null;
  tested: string | null;
  url: string | null;
  /** First release date of the game (YYYY-MM-DD), from the PS5 catalog or its store page. */
  released: string | null;
  /** PlayStation Store rating count, used as the popularity measure, and the average star rating. */
  ratings: number | null;
  rating: number | null;
  /** The game's static page (games/<slug>/), added by seo.py in the published build only. */
  page?: string;
}

export interface History {
  snapshots: Snapshot[];
  compat_history: CompatRow[];
  daily_activity: ActivityRow[];
  recent_merges: MergeRow[];
  anyps5_libraries: LibraryRow[];
  satellites: SatelliteRow[];
}

export interface LiveGithub {
  stars: number;
  openIssues: number;
  openPrs: number;
  mergedToday: number;
  today: string;
  release: string;
  releaseAt: string;
  recent: MergeRow[];
}

export interface LiveCompat {
  /** Games per ladder key. */
  counts: Record<string, number>;
  /** Size of the PS5 catalog, when the source lists untested games too. */
  catalog?: number;
}

export interface LiveLibraries {
  done: number;
  total: number;
  percent: number;
  inert: number;
  shaderDone: number;
  shaderTotal: number;
  groups: LibraryRow[];
}

export interface LiveProject {
  github?: LiveGithub;
  compat?: LiveCompat;
  libraries?: LiveLibraries;
  openBlockers?: number;
}
