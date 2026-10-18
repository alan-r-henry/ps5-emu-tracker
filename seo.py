"""Write the day's figures into the built page for search engines and link previews.

Usage: python -I seo.py <built site dir>   (e.g. web/dist/web/browser)

The Angular app replaces everything inside <app-root> when it starts, so the text written there is what
crawlers and link previews see before JavaScript runs: the current figures, every playable game, GTA status,
top contributors and the FAQ. It also refreshes the meta description, adds a dated WebPage/Dataset
structured-data block and stamps the sitemap. Everything taken from the data files is HTML-escaped.
Standard library only, so it runs on a bare CI runner.
"""
import datetime as dt
import html
import json
import re
import sys
from pathlib import Path

SITE = "https://alan-r-henry.github.io/ps5-emu-tracker/"
TOP_TIER = {"AnyPS5": "playable", "KytyPS5": "in-game", "SharpEmu": "playable"}
STAGE = {"none": "not tested", "boots": "boots", "menus": "reaches the menus", "ingame": "gets in-game",
         "playable": "is playable"}
STAGE_RANK = ["none", "boots", "menus", "ingame", "playable"]
FAQ = [
    ("Can I play GTA 6 on PC with a PS5 emulator?",
     "Not yet. GTA 6 comes out on PS5 and Xbox Series X|S on November 19, 2026, and Rockstar hasn't announced "
     "a PC version. No PS5 emulator can run it until the game is out and people test it. The GTA 6 readiness "
     "score on this page tracks the milestones that have to fall first."),
    ("Does GTA V run on PS5 emulators?", None),  # written from the day's data below
    ("Is there a working PS5 emulator?", None),
    ("Is PS5 emulation legal?",
     "Emulators themselves are generally legal to make and use. Downloading games you don't own is piracy. "
     "Beware sites offering PS5 emulator downloads: the real projects are free and only on their GitHub pages."),
]

e = html.escape


def load(data, name, default):
    try:
        return json.loads((data / f"{name}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def num(n):
    return f"{n:,}" if isinstance(n, (int, float)) else "—"


def long_date(iso):
    try:
        d = dt.date.fromisoformat(iso[:10])
    except (TypeError, ValueError):
        return ""
    return f"{d:%B} {d.day}, {d.year}"


def latest_snapshots(snapshots):
    latest = {}
    for s in snapshots:
        p = s.get("project")
        if p and (p not in latest or s.get("date", "") > latest[p].get("date", "")):
            latest[p] = s
    return latest


def gta_readiness(gta, lib_share, today):
    """Same milestones and weights as web/src/app/gta.ts; keep the two in step."""
    def best(game):
        reports = [r for r in (game or {}).get("projects", {}).values() if r]
        rank = max([STAGE_RANK.index(r["stage"]) for r in reports if r.get("stage") in STAGE_RANK] + [0])
        fps = max([r.get("fps") or 0 for r in reports
                   if r.get("stage") in STAGE_RANK and STAGE_RANK.index(r["stage"]) == rank] + [0])
        return rank, fps
    six, six_fps = best(gta.get("gta6"))
    five, _ = best(gta.get("gtav"))
    released = bool((gta.get("gta6") or {}).get("released")) and gta["gta6"]["released"] <= today
    score = 10 * released + 10 * (six >= 1) + 10 * (six >= 2) + 10 * (six >= 3) + 10 * (six >= 4)
    score += 10 * (six >= 4 and six_fps >= 30)
    score += 5 * (five >= 1) + 5 * (five >= 2) + 7.5 * (five >= 3) + 7.5 * (five >= 4)
    score += 15 * min(max(lib_share or 0, 0), 1)
    return round(score)


def build(data, today):
    all_snaps = load(data, "snapshots", [])
    snaps = latest_snapshots(all_snaps)
    first_day = min((s["date"][:10] for s in all_snaps if s.get("date")), default=today)
    games = load(data, "playable_games", [])
    gta = load(data, "gta", {})
    people = load(data, "top_contributors", {}).get("projects", {})

    any_ = snaps.get("AnyPS5", {})
    kyty = snaps.get("KytyPS5", {})
    sharp = snaps.get("SharpEmu", {})
    catalog = next((s.get("catalog") for s in snaps.values() if s.get("catalog")), None)
    lib = any_.get("lib_percent")
    lib_share = lib / 100 if isinstance(lib, (int, float)) else None
    readiness = gta_readiness(gta, lib_share, today) if gta else None
    unique_titles = len({g.get("titleId") or g.get("title") for g in games})

    gtav = (gta.get("gtav") or {}).get("projects", {})
    gtav_text = "; ".join(f"{p} {STAGE.get((r or {}).get('stage'), 'not tested')}" for p, r in gtav.items())
    answers = {
        "Does GTA V run on PS5 emulators?":
            f"As of {long_date(today)}, the PS5 version of GTA V: {gtav_text}. It uses the same RAGE engine as "
            "GTA 6, which makes it the best early sign of how GTA 6 will fare." if gtav else None,
        "Is there a working PS5 emulator?":
            f"Yes, in early form. AnyPS5, KytyPS5 and SharpEmu all run some PS5 games on PC today. "
            f"{num(unique_titles)} games reach gameplay on at least one of them, out of {num(catalog)} PS5 titles."
            if games else None,
    }
    faq = [(q, a or answers.get(q)) for q, a in FAQ]
    faq = [(q, a) for q, a in faq if a]

    description = (
        f"PS5 emulation, tracked daily: KytyPS5 runs {num(kyty.get('games_top'))} games in-game, SharpEmu "
        f"{num(sharp.get('games_top'))} playable, AnyPS5 {lib:.1f}% of system functions. Plus GTA 6 readiness."
        if lib is not None else None
    )

    out = ['<main class="seo-summary">', "<h1>PS5 Emulation Tracker</h1>",
           f"<p>Daily progress of PS5 emulation on PC, updated {e(long_date(today))}: the AnyPS5, KytyPS5 and "
           "SharpEmu emulators, every PS5 game that reaches gameplay with its frame rate, and a GTA 6 emulation "
           "readiness score built from checkable milestones.</p>",
           "<h2>PS5 emulator progress</h2>", "<ul>"]
    if any_ and lib is not None:
        out.append(f"<li>AnyPS5: {lib:.2f}% of known PS5 system functions implemented, "
                   f"{num(any_.get('games_top'))} games playable, {num(any_.get('stars'))} GitHub stars.</li>")
    if kyty:
        out.append(f"<li>KytyPS5: {num(kyty.get('games_top'))} PS5 games reach in-game out of "
                   f"{num(kyty.get('games_tested'))} tested, {num(kyty.get('stars'))} GitHub stars.</li>")
    if sharp:
        out.append(f"<li>SharpEmu: {num(sharp.get('games_top'))} PS5 games playable out of "
                   f"{num(sharp.get('games_tested'))} tested, {num(sharp.get('stars'))} GitHub stars.</li>")
    out.append("</ul>")

    if gta:
        six = gta.get("gta6") or {}
        out += ["<h2>GTA 6 and GTA V on PS5 emulators</h2>",
                f"<p>GTA 6 emulation readiness: {readiness}%. GTA 6 comes out on PS5 on "
                f"{e(long_date(six.get('released') or ''))}; no emulator can test it before then.</p>"]
        if gtav_text:
            out.append(f"<p>GTA V (PS5 version, same RAGE engine): {e(gtav_text)}.</p>")

    if games:
        out.append("<h2>Playable PS5 games on PC emulators</h2>")
        for project in ("SharpEmu", "KytyPS5", "AnyPS5"):
            rows = sorted((g for g in games if g.get("project") == project), key=lambda g: (g.get("title") or ""))
            if not rows:
                continue
            out.append(f"<h3>{e(project)}: {len(rows)} games {e(TOP_TIER[project])}</h3><ul>")
            for g in rows:
                extra = [x for x in (g.get("fps") and f"{g['fps']} FPS",
                                     g.get("tested") and f"tested {long_date(g['tested'])}") if x]
                out.append(f"<li>{e(g.get('title') or '')} ({e(g.get('titleId') or '')})"
                           f"{e(', ' + ', '.join(extra)) if extra else ''}</li>")
            out.append("</ul>")

    if people:
        out.append("<h2>Top contributors</h2><ul>")
        for project, rows in people.items():
            names = ", ".join(p.get("login", "") for p in rows[:10])
            out.append(f"<li>{e(project)}: {e(names)}</li>")
        out.append("</ul>")

    out.append("<h2>Questions</h2>")
    for q, a in faq:
        out.append(f"<h3>{e(q)}</h3><p>{e(a)}</p>")
    out += ["<p>Turn on JavaScript to see the live figures, charts and game list.</p>", "</main>"]

    graph = [
        {"@type": "WebSite", "@id": SITE + "#website", "name": "PS5 Emulation Tracker", "url": SITE,
         "description": "Daily tracker of PS5 emulation on PC: AnyPS5, KytyPS5 and SharpEmu progress, playable "
                        "PS5 games and GTA 6 emulation readiness."},
        {"@type": "WebPage", "@id": SITE + "#page", "url": SITE, "name": "PS5 Emulation Tracker",
         "dateModified": today, "inLanguage": "en", "isPartOf": {"@id": SITE + "#website"},
         "about": [{"@type": "SoftwareApplication", "name": n, "applicationCategory": "GameApplication",
                    "operatingSystem": "Windows"} for n in ("AnyPS5", "KytyPS5", "SharpEmu")]},
        {"@type": "Dataset", "name": "PS5 emulator compatibility and progress",
         "description": "Daily snapshots of PS5 emulator progress on PC: games reaching each compatibility stage "
                        "on AnyPS5, KytyPS5 and SharpEmu, project activity on GitHub, and GTA 6 readiness.",
         "url": SITE, "dateModified": today, "isAccessibleForFree": True,
         "creator": {"@type": "Person", "name": "Alan Henry", "url": "https://github.com/alan-r-henry"},
         "license": "https://creativecommons.org/licenses/by/4.0/",
         "temporalCoverage": f"{first_day}/..",
         "variableMeasured": ["Games reaching each compatibility stage", "Share of PS5 system functions implemented",
                              "Merged pull requests", "Contributors", "GTA 6 readiness score"],
         "keywords": ["PS5 emulation", "PS5 emulator", "GTA 6 PS5 emulation", "AnyPS5", "KytyPS5", "SharpEmu"],
         "distribution": [{"@type": "DataDownload", "encodingFormat": "application/json",
                           "contentUrl": SITE + f"data/{n}.json"}
                          for n in ("snapshots", "compat_history", "playable_games", "gta")]},
        {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q,
                                             "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]},
    ]
    ld = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False)
    ld = ld.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return "\n".join(out), description, ld


def replace_once(text, pattern, repl, what):
    new, n = re.subn(pattern, lambda _: repl, text, count=1, flags=re.S)
    if n != 1:
        sys.exit(f"seo.py: couldn't find the {what} in index.html")
    return new


def main():
    site = Path(sys.argv[1]).resolve()
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    body, description, ld = build(site / "data", today)
    page = (site / "index.html").read_text(encoding="utf-8")
    # Anchored on <body>: the page's top comment mentions <app-root> too.
    page = replace_once(page, r"<body>\s*<app-root>.*?</app-root>", f"<body>\n  <app-root>\n{body}\n  </app-root>",
                        "<app-root> block")
    page = replace_once(page, r'<script type="application/ld\+json">.*?</script>',
                        f'<script type="application/ld+json">{ld}</script>', "structured data")
    if description:
        for attr in ('name="description"', 'property="og:description"', 'name="twitter:description"'):
            page = replace_once(page, rf'<meta {attr} content="[^"]*">',
                                f'<meta {attr} content="{e(description)}">', attr)
    (site / "index.html").write_text(page, encoding="utf-8")

    sitemap = site / "sitemap.xml"
    xml = sitemap.read_text(encoding="utf-8")
    xml = re.sub(r"\s*<lastmod>[^<]*</lastmod>", "", xml)
    xml = replace_once(xml, r"</loc>", f"</loc>\n    <lastmod>{today}</lastmod>", "sitemap <loc>")
    sitemap.write_text(xml, encoding="utf-8")
    print(f"seo.py: wrote {len(body):,} characters of summary, dated {today}")


if __name__ == "__main__":
    main()
