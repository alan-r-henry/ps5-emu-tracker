# Publishing the PS5 Emulation Tracker

The site is published to **https://alan-r-henry.github.io/ps5-emu-tracker/** by GitHub Actions
(`.github/workflows/deploy.yml`). The workflow collects fresh data every 3 hours, builds the Angular app
and deploys it to GitHub Pages. There is no server, database or login, so the only ways to change the
site are your GitHub account and this repository's settings. Steps 1 and 4 protect both.

## 1. Lock down your GitHub account (do this first)

Anyone who controls this account controls the site, including the UPI ID.

1. **Settings → Password and authentication**
   - Add a **passkey** or a hardware **security key**, and use it as your main second factor.
   - Remove SMS as a 2FA method if it's there; SIM-swap attacks defeat it.
   - Download your **recovery codes** and keep them offline, not in email or cloud notes.
2. **Settings → Sessions**: sign out any session you don't recognise.
3. **Settings → Applications** (Authorized OAuth Apps, Authorized GitHub Apps) and **Developer settings →
   Personal access tokens**: revoke anything you don't use. A leaked token can push to your repositories.
4. **Settings → Emails**: keep your primary email private, and secure that email account with 2FA too,
   since it can reset your GitHub password.

## 2. Create the repository

On github.com: **New repository** → name `ps5-emu-tracker`, **Public** (free GitHub Pages needs it),
with no README, licence or .gitignore (this folder already has them).

## 3. Push the code

From `C:\Users\csp\ps5-emu-tracker`:

```bash
git init -b main
git add .
git status
```

Check the list: you should see `collect.py`, `seo.py`, `HOSTING.md`, `.github/`, `.gitignore` and `web/`
(with `web/public/data/fund.json` as the only data file). No `cache/`, `out/`, `history/`, `__pycache__/`
or `node_modules/`.

```bash
git commit -m "PS5 emulation tracker"
git remote add origin https://github.com/alan-r-henry/ps5-emu-tracker.git
git push -u origin main
```

The first push starts the workflow; it fails at the UPI check until step 4 is done. That's expected.

## 4. Repository settings

All under the repository's **Settings** tab.

1. **Pages** → *Build and deployment* → Source: **GitHub Actions**.
2. **Secrets and variables → Actions → Variables** → *New repository variable*:
   `EXPECTED_UPI_ID` = `dream1999@ptyes`.
   The build stops if `fund.json` ever has a different UPI ID, so changing it takes two deliberate edits.
3. **Rules → Rulesets → New branch ruleset**
   - Name: `protect main`, Enforcement: **Active**
   - Target branches: **Include default branch**
   - Bypass list: **Repository admin** (that's you)
   - Rules: **Restrict updates**, **Restrict deletions**, **Block force pushes**
   This leaves you as the only one who can change `main`. The workflow's token is not an admin, so even
   a compromised workflow step can't touch the code or `fund.json`.
4. **Actions → General**
   - Actions permissions: **Allow alan-r-henry, and select non-alan-r-henry, actions and reusable
     workflows** → tick only **Allow actions created by GitHub**.
   - Workflow permissions: **Read repository contents and packages permissions**; untick **Allow
     GitHub Actions to create and approve pull requests**.
   - Fork pull request workflows: **Require approval for all external contributors**.
5. **Environments → github-pages** (appears after step 1) → Deployment branches and tags:
   **Selected branches and tags** → add `main`.
6. **Code security**: turn on **Dependabot alerts**, **Secret scanning** and **Push protection**.
7. **Collaborators**: add nobody.

Then **Actions → Collect and deploy → Run workflow**. The first run takes 10–20 minutes because it
rebuilds the compatibility history; later runs are quicker. The site appears at the URL above.

## 5. Visit counts (GoatCounter)

1. Sign up at https://www.goatcounter.com (free for personal sites) and choose a site code,
   e.g. `ps5tracker` for `ps5tracker.goatcounter.com`.
2. Put the code in `web/src/app/site.ts` (`goatcounter: 'ps5tracker'`), commit and push.
3. Daily visits, referrers and countries then show on your GoatCounter dashboard. The site never loads
   GoatCounter's script; it requests a 1×1 image, so no third-party code runs on the page and no cookies
   are set.

## 6. Search engines

1. **Google Search Console** (https://search.google.com/search-console) → *Add property* →
   **URL prefix** → `https://alan-r-henry.github.io/ps5-emu-tracker/` → verify with the **HTML tag**.
   Paste the tag into `web/src/index.prod.html` where the comment says, then commit and push.
2. In Search Console → **Sitemaps**, submit `https://alan-r-henry.github.io/ps5-emu-tracker/sitemap.xml`,
   and use **URL inspection → Request indexing** on the home page.
3. **Bing Webmaster Tools** (https://www.bing.com/webmasters) can import the property from Search Console.
   Bing also feeds DuckDuckGo and others.
4. **IndexNow** is already set up: after deploying, the workflow tells Bing, Yandex and other IndexNow
   engines the page changed (once a day, plus every push). The key file is
   `web/public/2081ad7c27b7fe7fcaee742d1ed6d703.txt`; keep it, and keep `KEY` in the workflow matching it.

Ranking takes weeks and depends heavily on other sites linking here. Posting the link where people
discuss PS5 emulation (the projects' Discords, Reddit threads, GitHub discussions) helps most.

## Everyday changes

- **Log a donation**: edit `web/public/data/fund.json` (add a line to `donations`), commit and push.
  You can do this from github.com's file editor too. The site redeploys in a few minutes.
- **Change the UPI ID**: update `upi.id` in `fund.json` *and* the `EXPECTED_UPI_ID` variable.
- **Add or change Ko-fi**: set `kofi` in `fund.json` to `https://ko-fi.com/yourname` *and* add a
  repository variable `EXPECTED_KOFI_URL` with exactly the same link. Like the UPI ID, the build stops if
  the two differ, so leave the variable unset while `kofi` is empty.

## What protects what

| Threat | Protection |
|---|---|
| Someone edits the UPI ID or Ko-fi link | Only your passkey-protected account can push `main`; the build also refuses a UPI ID or Ko-fi link that doesn't match `EXPECTED_UPI_ID` / `EXPECTED_KOFI_URL`; donors are told to check the payee name is "Alan Henry" before paying |
| Injected script swaps the page | Content Security Policy allows only the site's own scripts and styles, no inline code, plus Trusted Types and Subresource Integrity |
| Poisoned upstream data | Collector keeps only links and images on known hosts; Angular escapes all text; the build copies an allow-list of data files |
| Compromised npm package | Lockfile-pinned installs with install scripts off; no secrets in the build job |
| Compromised GitHub Action | Only GitHub's own actions, pinned to commit SHAs |
| Stolen deploy credentials | None exist: Pages deploys with a short-lived OIDC token |
| Domain or DNS hijack | No custom domain; github.io is HTTPS-only and HSTS-preloaded |

Nothing is unbreakable. The weakest link is your GitHub account, so step 1 matters most.
