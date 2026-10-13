import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { Icon } from './icon';
import { fmt, longDate } from './format';
import { PROJECTS } from './projects';
import { ProjectName } from './models';

interface Person {
  login: string;
  avatar: string | null;
  commits: number;
  prs: number;
}

/** data/top_contributors.json, written by collect.py from GitHub's contributor list and merged PRs. */
interface ContributorsData {
  date: string;
  projects: Partial<Record<ProjectName, Person[]>>;
}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const AVATAR = /^https:\/\/avatars\.githubusercontent\.com\/u\/\d+\?v=\d+$/;

@Component({
  selector: 'app-contributors',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sec" id="contributors" aria-labelledby="contributors-h">
      <div class="sec-head">
        <h2 id="contributors-h"><app-icon name="users" [size]="20" />Top contributors</h2>
        <p class="note">
          A thank-you to the people building these emulators. Ranked by commits on each project's main branch,
          GitHub's own contributor measure, with their merged pull requests alongside. AI coding agents aren't listed.
          @if (data(); as d) { Updated {{ longDate(d.date) }}. }
        </p>
      </div>
      @if (data(); as d) {
        <div class="grid">
          @for (p of projects; track p.name) {
            <article class="card people" [style.--accent]="p.color">
              <h3><span class="swatch" aria-hidden="true"></span>{{ p.name }}</h3>
              <ol class="people-list">
                @for (c of d.projects[p.name] ?? []; track c.login; let i = $index) {
                  <li>
                    <span class="people-rank num">{{ i + 1 }}</span>
                    @if (c.avatar) {
                      <img class="people-avatar" [src]="c.avatar + '&s=64'" alt="" width="28" height="28" loading="lazy" referrerpolicy="no-referrer">
                    } @else {
                      <span class="people-avatar" aria-hidden="true"></span>
                    }
                    <a class="people-name" [href]="'https://github.com/' + c.login" target="_blank" rel="noopener">{{ c.login }}</a>
                    <span class="people-stats note num">
                      <span class="with-icon" [attr.aria-label]="fmt(c.commits) + ' commits'"><app-icon name="commit" [size]="13" />{{ fmt(c.commits) }}</span>
                      <span class="with-icon" [attr.aria-label]="fmt(c.prs) + ' merged pull requests'"><app-icon name="merge" [size]="13" />{{ fmt(c.prs) }}</span>
                    </span>
                  </li>
                } @empty {
                  <li class="note">No contributor data yet.</li>
                }
              </ol>
            </article>
          }
        </div>
      } @else {
        <div class="card"><div class="chart skeleton"></div></div>
      }
    </section>
  `,
})
export class ContributorsBoard {
  protected readonly projects = PROJECTS;
  protected readonly fmt = fmt;
  protected readonly longDate = longDate;
  protected readonly data = signal<ContributorsData | null>(null);

  constructor() {
    void fetch('data/top_contributors.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ContributorsData | null) => this.data.set(d?.projects ? clean(d) : null))
      .catch(() => this.data.set(null));
  }
}

/** Drops entries with an unexpected login and avatars from anywhere but GitHub, whatever the file holds. */
function clean(d: ContributorsData): ContributorsData {
  const projects: ContributorsData['projects'] = {};
  for (const p of PROJECTS) {
    projects[p.name] = (d.projects[p.name] ?? [])
      .filter((c) => LOGIN.test(c.login ?? ''))
      .map((c) => ({ ...c, avatar: AVATAR.test(c.avatar ?? '') ? c.avatar : null }))
      .slice(0, 10);
  }
  return { date: d.date, projects };
}
