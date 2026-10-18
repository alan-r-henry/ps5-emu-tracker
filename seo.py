"""Write the day's figures into the built page for search engines and link previews, and build a page per game.

Usage: python -I seo.py <built site dir>   (e.g. web/dist/web/browser)

The Angular app replaces everything inside <app-root> when it starts, so the text written there is what
crawlers and link previews see before JavaScript runs: the current figures, every playable game, GTA status,
top contributors and the FAQ. It also refreshes the meta description, adds a dated WebPage/Dataset
structured-data block, writes a static page for every game that reaches gameplay (games/<slug>/) with an A-Z
index, and rewrites the sitemap to list them all. Everything taken from the data files is HTML-escaped.
Standard library only, so it runs on a bare CI runner.
"""
import datetime as dt
import html
import json
import re
import shutil
import sys
import unicodedata
from pathlib import Path
from urllib.parse import urlsplit

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
                out.append(f'<li><a href="{BASE}games/{game_slug(g)}/">{e(clean_title(g.get("title")))}</a> '
                           f"({e(g.get('titleId') or '')})"
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


# --- One page per game -------------------------------------------------------------------------------------
# Every game that reaches gameplay on at least one emulator gets a static page at games/<slug>/, plus an A-Z
# index at games/. They answer searches like "<game> PS5 emulator", which the single-page app can't.

ORDER = ("SharpEmu", "KytyPS5", "AnyPS5")
PROJECT_LINKS = {  # name: (GitHub repository, public compatibility list)
    "SharpEmu": ("https://github.com/sharpemu/sharpemu", "https://sharpemu.app/"),
    "KytyPS5": ("https://github.com/KytyPS5/KytyPS5", "https://kytyps5.github.io/"),
    "AnyPS5": ("https://github.com/boykopovar/AnyPS5", "https://alxcbtw.github.io/anyps5-roadmap/"),
}
# The workflow writes the data branch, so links and images are checked again here, as collect.py does.
SAFE_REPORT = re.compile(r"https://(github\.com|kytyps5\.github\.io|sharpemu\.app|alxcbtw\.github\.io|"
                         r"boykopovar\.github\.io)/[^\s\"'<>\\]*\Z")
SAFE_COVER = re.compile(r"https://image\.api\.playstation\.com/[\w./%-]+\Z")
PAGE_CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; "
            "img-src 'self' https://image.api.playstation.com; base-uri 'none'; form-action 'none'")
BASE = urlsplit(SITE).path  # "/ps5-emu-tracker/"


def clean_title(title):
    """Some titles arrive with U+FFFD where a curly quote or dash was lost upstream."""
    t = re.sub(r"(?<=\w)�(?=s\b)", "’", title or "")
    t = t.replace(" � ", " – ").replace("�", "")
    return re.sub(r"\s+", " ", t).strip()


def slugify(title, title_id):
    t = re.sub("[™®©'’]", "", title).replace("&", " and ")
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:80].strip("-")
    return s or re.sub(r"[^a-z0-9]+", "-", (title_id or "").lower()).strip("-")


def game_slug(g):
    return slugify(clean_title(g.get("title")) or g.get("titleId") or "", g.get("titleId"))


def game_groups(games):
    """slug -> {title, rows: {project: best row}, ...}. A game listed under several title IDs gets one page."""
    def rank(r):
        return r.get("fps_value") or 0, r.get("tested") or ""
    groups = {}
    for g in games:
        slug = game_slug(g)
        if g.get("project") not in TOP_TIER or not slug:
            continue
        grp = groups.setdefault(slug, {"slug": slug, "title": clean_title(g.get("title")) or g.get("titleId"),
                                       "rows": {}})
        old = grp["rows"].get(g["project"])
        if old is None or rank(g) > rank(old):
            grp["rows"][g["project"]] = g
    for grp in groups.values():
        rows = list(grp["rows"].values())
        top = max(rows, key=lambda r: r.get("ratings") or 0)
        grp["cover"] = next((r["cover"] for r in rows if SAFE_COVER.match(r.get("cover") or "")), None)
        grp["ids"] = sorted({r["titleId"] for r in rows if r.get("titleId")})
        grp["released"] = min((r["released"] for r in rows if r.get("released")), default=None)
        grp["ratings"], grp["rating"] = top.get("ratings") or 0, top.get("rating")
        grp["tested"] = max((r["tested"][:10] for r in rows if r.get("tested")), default=None)
    return groups


def join_and(parts):
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


def sized(url, width):
    return f"{url}{'&' if '?' in url else '?'}w={width}"


def ld_json(graph):
    ld = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False)
    return ld.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def page_graph(kind, url, name, description, modified, crumbs, extra=None):
    return ld_json([
        {"@type": kind, "@id": url + "#page", "url": url, "name": name, "description": description,
         "dateModified": modified, "inLanguage": "en",
         "isPartOf": {"@type": "WebSite", "@id": SITE + "#website", "name": "PS5 Emulation Tracker", "url": SITE},
         "breadcrumb": {"@id": url + "#breadcrumb"}, **(extra or {})},
        {"@type": "BreadcrumbList", "@id": url + "#breadcrumb", "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": n, "item": u} for i, (n, u) in enumerate(crumbs)]},
    ])


def page_shell(title, description, url, ld, body, style_link, image=None):
    image_tags = (f'  <meta property="og:image" content="{e(image)}">\n'
                  '  <meta name="twitter:card" content="summary_large_image">\n'
                  if image else '  <meta name="twitter:card" content="summary">\n')
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="{PAGE_CSP}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{e(title)}</title>
  <meta name="description" content="{e(description)}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <meta name="theme-color" content="#0f141c">
  <link rel="canonical" href="{e(url)}">
  <link rel="icon" href="{BASE}favicon.ico" sizes="48x48">
  <link rel="icon" href="{BASE}icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="{BASE}apple-touch-icon.png">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="PS5 Emulation Tracker">
  <meta property="og:locale" content="en_US">
  <meta property="og:title" content="{e(title)}">
  <meta property="og:description" content="{e(description)}">
  <meta property="og:url" content="{e(url)}">
{image_tags}  <script src="{BASE}theme.js"></script>
  {style_link}
  <link rel="stylesheet" href="{BASE}game.css">
  <script type="application/ld+json">{ld}</script>
</head>
<body class="gp">
  <header class="gp-top"><a class="gp-brand" href="{BASE}">PS5 Emulation Tracker</a><a href="{BASE}games/">All games</a></header>
  <main class="gp-main">
{body}
  </main>
  <footer class="gp-foot">
    <p>Statuses come from each project's public compatibility list and are checked every 3 hours. Frame rates are what
    testers reported on their own hardware. Not affiliated with Sony, Rockstar or the emulator projects.</p>
    <p><a href="{BASE}">PS5 Emulation Tracker</a> · <a href="{BASE}games/">All games</a> · <a href="{BASE}#method">How this is measured</a></p>
  </footer>
</body>
</html>
"""


def emulator_card(project, row):
    repo, compat = PROJECT_LINKS[project]
    tier = TOP_TIER[project]
    if not row:
        return (f'<section class="gp-emu gp-none"><h2>{project}</h2><p class="gp-status">No {tier} report yet</p>'
                f'<p>It may still boot or reach the menus; see <a href="{compat}">{project}\'s compatibility list</a>.</p>'
                "</section>")
    facts = [("Frame rate", f"{row['fps']} FPS" if row.get("fps") else "Not reported"),
             ("Tested", long_date(row.get("tested") or "") or None),
             ("Hardware", row.get("hardware")), ("OS", row.get("os")), ("Title ID", row.get("titleId"))]
    dl = "".join(f"<div><dt>{k}</dt><dd>{e(str(v))}</dd></div>" for k, v in facts if v)
    quote = f'<blockquote>“{e(row["fps_note"])}”</blockquote>' if row.get("fps_note") else ""
    report = (f'<p><a href="{e(row["url"])}">Read the {project} test report</a></p>'
              if SAFE_REPORT.match(row.get("url") or "") else "")
    return (f'<section class="gp-emu gp-ok"><h2>{project}</h2><p class="gp-status">{tier.capitalize()}</p>'
            f"<dl>{dl}</dl>{quote}{report}</section>")


def game_page(grp, related, today, style_link):
    title, rows = grp["title"], grp["rows"]
    url = f"{SITE}games/{grp['slug']}/"
    have = [p for p in ORDER if p in rows]
    missing = [p for p in ORDER if p not in rows]

    def phrase(p, fps=True):
        rate = f" at {rows[p]['fps']} FPS" if fps and rows[p].get("fps") else ""
        return f"{TOP_TIER[p]} on {p}{rate}"

    lead = f"As of {long_date(today)}, {title} is {join_and([phrase(p) for p in have])}."
    if missing:
        tiers = join_and(sorted({TOP_TIER[p] for p in missing}))
        lead += f" {join_and(missing)} {'has' if len(missing) == 1 else 'have'} no {tiers} report for it yet."
    description = f"Does {title} run on a PS5 emulator? It's {join_and([phrase(p) for p in have])}. Test reports and hardware for each emulator."
    if len(description) > 160:
        description = f"Does {title} run on a PS5 emulator? It's {join_and([phrase(p, False) for p in have])}. Test reports, FPS and hardware."
    page_title = f"{title} on PS5 emulators: status and FPS"
    if len(page_title) <= 45:
        page_title += " | PS5 Emulation Tracker"

    about = []
    if grp["released"]:
        about.append(f"First released {long_date(grp['released'])}.")
    if grp["ratings"]:
        stars = f"{grp['rating']:.1f} stars from " if isinstance(grp["rating"], (int, float)) else ""
        about.append(f"PlayStation Store: {stars}{num(grp['ratings'])} player ratings.")
    if len(grp["ids"]) > 1:
        about.append(f"Listed under title IDs {', '.join(grp['ids'])}.")
    cover = ""
    if grp["cover"]:
        src, hi = sized(grp["cover"], 240), sized(grp["cover"], 480)
        cover = (f'<img class="gp-cover" src="{e(src)}" srcset="{e(src)} 1x, {e(hi)} 2x" width="240" height="240" '
                 f'alt="{e(title)} cover art" decoding="async" referrerpolicy="no-referrer">')
    rel = "".join(f'<li><a href="{BASE}games/{o["slug"]}/">{e(o["title"])}</a></li>' for o in related)
    repos = {p: PROJECT_LINKS[p][0] for p in ORDER}
    body = f"""    <nav class="gp-crumbs" aria-label="Breadcrumb"><a href="{BASE}">Tracker</a> › <a href="{BASE}games/">Games</a> › <span>{e(title)}</span></nav>
    <div class="gp-hero">
      {cover}
      <div>
        <p class="eyebrow">PS5 game on PC emulators</p>
        <h1>{e(title)} on PS5 emulators</h1>
        <p class="gp-lead">{e(lead)}</p>
        {f'<p class="gp-about">{e(" ".join(about))}</p>' if about else ''}
      </div>
    </div>
    <div class="gp-emus">
      {''.join(emulator_card(p, rows.get(p)) for p in ORDER)}
    </div>
    <section class="gp-text">
      <h2>How to try {e(title)} on PC</h2>
      <p>You need your own copy of the game, dumped from your PS5, and one of the emulators above. All three are free,
      open source and published only on GitHub: <a href="{repos['SharpEmu']}">SharpEmu</a>,
      <a href="{repos['KytyPS5']}">KytyPS5</a> and <a href="{repos['AnyPS5']}">AnyPS5</a>. Sites offering PS5
      emulator downloads anywhere else are often malware.</p>
      <p>Results depend on your hardware and the emulator version, so check what the tester used.</p>
    </section>
    {f'<section class="gp-text"><h2>Other PS5 games that run on PC</h2><ul class="gp-related">{rel}</ul></section>' if rel else ''}"""
    image = {"primaryImageOfPage": {"@type": "ImageObject", "url": grp["cover"]}} if grp["cover"] else None
    ld = page_graph("WebPage", url, page_title, description, grp["tested"] or today,
                    [("PS5 Emulation Tracker", SITE), ("Games", SITE + "games/"), (title, url)], image)
    return page_shell(page_title, description, url, ld, body, style_link,
                      sized(grp["cover"], 1200) if grp["cover"] else None)


def games_index(groups, today, style_link):
    url = SITE + "games/"
    games = sorted(groups.values(), key=lambda g: g["title"].casefold())
    counts = {p: sum(p in g["rows"] for g in games) for p in ORDER}
    items = []
    for g in games:
        chips = "".join(
            f'<span class="gp-chip">{p}{" · " + e(g["rows"][p]["fps"]) + " FPS" if g["rows"][p].get("fps") else ""}</span>'
            for p in ORDER if p in g["rows"])
        items.append(f'<li><a href="{BASE}games/{g["slug"]}/">{e(g["title"])}</a><span class="gp-chips">{chips}</span></li>')
    summary = (f"{len(games)} PS5 games reach gameplay on at least one PC emulator: {counts['SharpEmu']} are playable on "
               f"SharpEmu, {counts['KytyPS5']} get in-game on KytyPS5 and {counts['AnyPS5']} are playable on AnyPS5.")
    title = f"PS5 games that run on PC emulators ({len(games)} games)"
    description = f"{summary} Updated {long_date(today)}."
    body = f"""    <nav class="gp-crumbs" aria-label="Breadcrumb"><a href="{BASE}">Tracker</a> › <span>Games</span></nav>
    <p class="eyebrow">Updated {e(long_date(today))}</p>
    <h1>PS5 games that run on PC emulators</h1>
    <p class="gp-lead">{e(summary)} Each game's page has the test reports, hardware and frame rates.</p>
    <ul class="gp-index">
      {''.join(items)}
    </ul>"""
    ld = page_graph("CollectionPage", url, title, description, today,
                    [("PS5 Emulation Tracker", SITE), ("Games", url)])
    return page_shell(title + " | PS5 Emulation Tracker", description, url, ld, body, style_link)


def related_games(grp, groups, limit=6):
    """The most-rated other games on the same emulators, so pages link to each other."""
    mine = set(grp["rows"])
    others = [o for o in groups.values() if o["slug"] != grp["slug"] and mine & set(o["rows"])]
    return sorted(others, key=lambda o: (-o["ratings"], o["title"].casefold()))[:limit]


def write_game_pages(site, groups, today, style_link):
    out = site / "games"
    if out.exists():
        shutil.rmtree(out)
    if not groups:  # no game data this run: publish no pages rather than an empty index
        return
    for grp in groups.values():
        (out / grp["slug"]).mkdir(parents=True)
        (out / grp["slug"] / "index.html").write_text(
            game_page(grp, related_games(grp, groups), today, style_link), encoding="utf-8")
    (out / "index.html").write_text(games_index(groups, today, style_link), encoding="utf-8")


def write_sitemap(site, groups, today):
    urls = [(SITE, today)] + ([(SITE + "games/", today)] if groups else [])
    urls += sorted((f"{SITE}games/{g['slug']}/", g["tested"] or today) for g in groups.values())
    entries = "\n".join(f"  <url>\n    <loc>{e(u)}</loc>\n    <lastmod>{d}</lastmod>\n  </url>" for u, d in urls)
    (site / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n'
                                      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                                      f"{entries}\n</urlset>\n", encoding="utf-8")
    return len(urls)


def add_page_links(site, groups):
    """Adds each game's page path to the built games list, so the app can link to it."""
    games = load(site / "data", "playable_games", None)
    if not isinstance(games, list):
        return
    for g in games:
        if game_slug(g) in groups:
            g["page"] = f"games/{game_slug(g)}/"
    (site / "data" / "playable_games.json").write_text(
        json.dumps(games, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


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

    # Game pages reuse the app's stylesheet (fonts and colours), keeping its integrity hash.
    style = re.search(r'<link rel="stylesheet" href="(styles-[\w-]+\.css)"[^>]*>', page)
    if not style:
        sys.exit("seo.py: couldn't find the stylesheet link in index.html")
    style_link = style.group(0).replace(f'href="{style.group(1)}"', f'href="{BASE}{style.group(1)}"')
    groups = game_groups(load(site / "data", "playable_games", []))
    write_game_pages(site, groups, today, style_link)
    add_page_links(site, groups)
    urls = write_sitemap(site, groups, today)
    print(f"seo.py: wrote {len(body):,} characters of summary and {len(groups)} game pages; "
          f"sitemap has {urls} URLs, dated {today}")


if __name__ == "__main__":
    main()
