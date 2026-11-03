# PS5 Emulation Tracker

**Website: https://alan-r-henry.github.io/ps5-emu-tracker/**

A daily tracker of PS5 emulation on PC. It follows the three open-source PS5 emulators
([AnyPS5](https://github.com/boykopovar/AnyPS5), [KytyPS5](https://github.com/KytyPS5/KytyPS5) and
[SharpEmu](https://github.com/sharpemu/sharpemu)) and answers the questions people actually ask:

- **Can I play GTA 6 on PC?** A readiness score built from checkable milestones, with the reason each day it moved:
  [GTA 6 on PC](https://alan-r-henry.github.io/ps5-emu-tracker/gta-6/).
- **Which PS5 games run on PC?** Every game that reaches gameplay on at least one emulator, with frame rates where
  testers reported them: [all games](https://alan-r-henry.github.io/ps5-emu-tracker/games/).
- **How fast are the emulators improving?** Compatibility over time, system functions implemented, merged pull
  requests and contributors, from each project's own data.

The site never links to exploits, jailbreak tools or game downloads.

## Data

Everything on the site comes from public sources: each project's compatibility list and GitHub activity. The daily
figures are published as JSON, free to reuse under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/):

| File | What it holds |
|---|---|
| [`data/snapshots.json`](https://alan-r-henry.github.io/ps5-emu-tracker/data/snapshots.json) | One row per emulator per day: games at each stage, stars, contributors, AnyPS5's system functions |
| [`data/compat_history.json`](https://alan-r-henry.github.io/ps5-emu-tracker/data/compat_history.json) | Games at each compatibility stage, by day |
| [`data/playable_games.json`](https://alan-r-henry.github.io/ps5-emu-tracker/data/playable_games.json) | Games at each emulator's top tier, with test date and frame rate |
| [`data/gta.json`](https://alan-r-henry.github.io/ps5-emu-tracker/data/gta.json) | The best stage each emulator has reached on GTA 6 and GTA V (PS5) |

## How it works

- `collect.py` gathers the data in GitHub Actions every 3 hours and saves the history on the `data` branch.
- `web/` is the Angular site. `seo.py` runs after the build and writes the crawler-readable summary, a static page
  for every game, the `gta-6/` page and the sitemap.
- `.github/workflows/deploy.yml` builds and publishes to GitHub Pages. [HOSTING.md](HOSTING.md) covers the setup and
  the account security it relies on; [DESIGN.md](DESIGN.md) records the design decisions.

To run the site locally:

```bash
cd web
npm ci
npx ng serve
```
