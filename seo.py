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
GTA_QUESTIONS = 3  # the first entries of FAQ, repeated on the gta-6/ page
FAQ = [
    ("Can I play GTA 6 on PC with a PS5 emulator?",
     "Not yet, and not at launch. GTA 6 comes out on PS5 and Xbox Series X|S on November 19, 2026. Before any "
     "emulator can try it, someone has to copy the game off a PS5, and that's blocked for now: GTA 6 reportedly "
     "needs firmware 14.10, and there's no public way to copy games off a PS5 on that firmware. Even then, no PS5 "
     "emulator runs a game this size yet. The GTA 6 readiness score tracks each step."),
    ("Does GTA 6 need PS5 firmware 14.10?",
     "Reportedly. A datamine of GTA 6's PlayStation Store listing says it needs firmware 14.10 or newer; Rockstar "
     "and Sony haven't confirmed it. Public PS5 jailbreaks only work up to firmware 13.60, so a jailbroken console "
     "would have to update, and lose its jailbreak, to play it."),
    ("When is GTA 6 coming to PC?",
     "Rockstar hasn't announced a PC version. GamesBeat reported on October 13, 2026 that one is planned for early "
     "2027, citing four industry sources. GTA V took about 18 months to reach PC."),
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


def gta_milestones(gta, lib_share, today, status):
    """Same milestones and weights as web/src/app/gta.ts; keep the two in step. Returns
    [(group, [(label, weight, progress 0-1, note or None)])]."""
    def best(game):
        reports = [r for r in (game or {}).get("projects", {}).values() if r]
        rank = max([STAGE_RANK.index(r["stage"]) for r in reports if r.get("stage") in STAGE_RANK] + [0])
        fps = max([r.get("fps") or 0 for r in reports
                   if r.get("stage") in STAGE_RANK and STAGE_RANK.index(r["stage"]) == rank] + [0])
        return rank, fps
    six, six_fps = best(gta.get("gta6"))
    five, _ = best(gta.get("gtav"))
    released = bool((gta.get("gta6") or {}).get("released")) and gta["gta6"]["released"] <= today
    copyable = status.get("copyable") is True or six >= 1  # a boot report proves someone copied it
    return [
        ("GTA 6 itself", [
            ("Out on PS5", 5, float(released), None),
            ("Can be copied from a PS5", 5, float(copyable), status.get("copy_blocker")),
            ("Boots on a PS5 emulator", 10, float(six >= 1), None),
            ("Reaches the menus", 10, float(six >= 2), None),
            ("Gets in-game", 10, float(six >= 3), None),
            ("Playable", 10, float(six >= 4), None),
            ("Playable at 30+ FPS", 10, float(six >= 4 and six_fps >= 30), None)]),
        ("GTA V on PS5 (same RAGE engine)", [
            ("Boots", 5, float(five >= 1), None), ("Reaches the menus", 5, float(five >= 2), None),
            ("Gets in-game", 7.5, float(five >= 3), None), ("Playable", 7.5, float(five >= 4), None)]),
        ("Emulator maturity", [
            ("Known PS5 system functions implemented (AnyPS5)", 15, min(max(lib_share or 0, 0), 1), None)]),
    ]


def gta_readiness(gta, lib_share, today, status):
    return round(sum(w * prog for _, items in gta_milestones(gta, lib_share, today, status) for _, w, prog, _ in items))


def gta_status(data):
    """data/gta_status.json, kept by hand: whether GTA 6 can be copied off a PS5, and the reported facts."""
    st = load(data, "gta_status", {})
    return st if isinstance(st, dict) and isinstance(st.get("copyable"), bool) else {}


GTA6_RELEASE = "2026-11-19"  # same as web/src/app/projects.ts
NAV = [("#projects", "Emulators"), ("#gta6", "GTA 6"), ("#playable", "Games"), ("#contributors", "People"), ("#faq", "FAQ")]


def hero_progress(snaps):
    """Each emulator's progress on its main measure, as the app's hero computes it (app.ts progress())."""
    def tested_share(s):
        top, tested = s.get("games_top"), s.get("games_tested")
        return top / tested if isinstance(top, (int, float)) and tested else None
    lib = snaps.get("AnyPS5", {}).get("lib_percent")
    return [("AnyPS5", 1, lib / 100 if isinstance(lib, (int, float)) else None, "of known system functions implemented"),
            ("KytyPS5", 2, tested_share(snaps.get("KytyPS5", {})), "of tested games reach in-game"),
            ("SharpEmu", 3, tested_share(snaps.get("SharpEmu", {})), "of tested games reach playable")]


def static_hero(snaps, games, today):
    """The app's top bar and hero as plain HTML, so the hero paints with the first frame. The app replaces it
    with the same markup when it starts; keep it in step with web/src/app/app.html. The CSP forbids inline
    styles, so each meter's colour comes from a class (.series-N in styles.css)."""
    pages = len(game_groups(games))
    days = (dt.date.fromisoformat(GTA6_RELEASE) - dt.date.fromisoformat(today)).days
    meters = "".join(
        f'<li class="series-{n}"><a href="#card-{name}"><span class="meter-name">{name}</span>'
        f'<span class="meter-value num">{"…" if share is None else f"{share * 100:.0f}%"}</span>'
        f'<meter min="0" max="1" value="{0 if share is None else round(min(max(share, 0), 1), 4)}" aria-hidden="true"></meter>'
        f'<span class="meter-measure">{measure}</span></a></li>' for name, n, share, measure in hero_progress(snaps))
    nav = "".join(f'<li><a class="nav-link" href="{h}">{label}</a></li>' for h, label in NAV)
    gta = (f'<a class="hero-gta" href="#gta6">GTA 6 reaches PS5 in <b class="num">{days}</b> {"day" if days == 1 else "days"}</a>'
           if days > 0 else '<a class="hero-gta" href="#gta6">GTA 6 is out on PS5</a>')
    return f"""<header class="topbar"><a class="brand" href="#top"><span class="reg" aria-hidden="true"></span><span>PS5 <span class="brand-mid">Emulation </span>Tracker</span></a>
<nav class="nav" aria-label="Sections"><ul class="nav-list">{nav}<li><a class="nav-link" href="games/">All games</a></li></ul></nav></header>
<div class="page" id="top">
<section class="hero" aria-labelledby="hero-h">
<div class="hero-copy"><h1 id="hero-h">PS5 Emulation Tracker</h1>
<p class="hero-lede">Three open-source projects are teaching PCs to run PS5 games. Here’s how far each one has got.</p>
<a class="cta" href="games/"><span>Browse the {pages} games that run on PC</span></a></div>
<ul class="meters" aria-label="Progress by emulator">{meters}</ul>
<div class="hero-foot"><div class="livebar" role="status"><span class="live-now"><span class="pulse" aria-hidden="true"></span>Loading live figures…</span><span class="muted">History saved through {e(long_date(max((s.get("date", "") for s in snaps.values()), default=today)))}</span></div>{gta}</div>
</section>"""


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
    status = gta_status(data)
    readiness = gta_readiness(gta, lib_share, today, status) if gta else None
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

    out = [static_hero(snaps, games, today), '<main class="seo-summary">',
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
                f"{e(long_date(six.get('released') or ''))}; no emulator can test it before then"
                f"{', or until someone can copy it off a PS5' if not status.get('copyable') else ''}. "
                f'<a href="{BASE}gta-6/">Can you play GTA 6 on PC?</a></p>']
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
    out += ["<p>Turn on JavaScript to see the live figures, charts and game list.</p>", "</main>", "</div>"]

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
INK = {"AnyPS5": "c", "KytyPS5": "m", "SharpEmu": "y"}  # each emulator's colour class (.ink-c etc. in styles.css)
FONT_PRELOAD = ""  # set by main() once the built font file is known


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


SMALL_WORDS = {"a", "an", "and", "of", "the", "to", "in", "on", "for"}


def initials(title):
    """Two letters for a game with no cover art, skipping small words like the app does."""
    words = re.sub(r"[^\w ]", "", title).split()
    big = [w for w in words if w.casefold() not in SMALL_WORDS] or words
    return "".join(w[0] for w in big[:2]).upper()


GAME_SORTS = [("tested", "Testing date (newest)"), ("title", "Alphabetical, A to Z"),
              ("popularity", "Popularity (most ratings)"), ("released", "Release date (newest)"),
              ("fps", "Frame rate (highest)")]
SORT_ICON = ('<span class="icon"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" '
             'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
             '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg></span>')


def short_date(iso):
    """2026-07-22 -> Jul 22, 2026."""
    d = dt.date.fromisoformat(iso[:10])
    return f"{d:%b} {d.day}, {d.year}"


def compact(n):
    """12345 -> 12.3K, like the tracker's Intl compact format."""
    for size, unit in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if n >= size:
            return f"{n / size:.1f}".rstrip("0").rstrip(".") + unit
    return str(n)


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


def page_shell(title, description, url, ld, body, style_link, image=None, robots="index, follow, max-image-preview:large, max-snippet:-1",
               script=None):
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
  <meta name="robots" content="{robots}">
  <meta name="theme-color" content="#0f141c">
{f'  <link rel="canonical" href="{e(url)}">' + chr(10) if url else ''}{FONT_PRELOAD}
  <link rel="icon" href="{BASE}favicon.ico" sizes="48x48">
  <link rel="icon" href="{BASE}icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="{BASE}apple-touch-icon.png">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="PS5 Emulation Tracker">
  <meta property="og:locale" content="en_US">
  <meta property="og:title" content="{e(title)}">
  <meta property="og:description" content="{e(description)}">
{f'  <meta property="og:url" content="{e(url)}">' + chr(10) if url else ''}{image_tags}  <script src="{BASE}theme.js"></script>
  {style_link}
  <link rel="stylesheet" href="{BASE}game.css">
{f'  <script src="{BASE}{script}" defer></script>' + chr(10) if script else ''}{f'  <script type="application/ld+json">{ld}</script>' + chr(10) if ld else ''}</head>
<body class="gp">
  <header class="gp-top"><a class="gp-brand" href="{BASE}"><span class="reg" aria-hidden="true"></span><span>PS5 Emulation Tracker</span></a><a class="gp-nav" href="{BASE}games/">All games</a></header>
  <main class="gp-main">
{body}
  </main>
  <footer class="gp-foot">
    <p>Statuses come from each project's public compatibility list and are checked every 3 hours. Frame rates are what
    testers reported on their own hardware. Not affiliated with Sony, Rockstar or the emulator projects.</p>
    <ul class="gp-foot-links"><li><a href="{BASE}">PS5 Emulation Tracker</a></li><li><a href="{BASE}games/">All games</a></li><li><a href="{BASE}gta-6/">GTA 6 on PC</a></li><li><a href="{BASE}#method">How this is measured</a></li></ul>
  </footer>
</body>
</html>
"""


# Each project's own status names, as a short label and as a phrase that follows the game's name.
STATUS = {
    "KytyPS5": {"doesnt-boot": ("Doesn't boot", "doesn't boot"), "logo": ("Shows the logo", "gets as far as the logo"),
                "main-menu": ("Reaches the main menu", "reaches the main menu"), "in-game": ("In-game", "gets in-game")},
    "SharpEmu": {"nothing": ("Doesn't start", "doesn't start"), "boots": ("Boots", "boots"),
                 "menus": ("Reaches the menus", "reaches the menus"), "ingame": ("In-game", "gets in-game"),
                 "playable": ("Playable", "is playable")},
    "AnyPS5": {"Converts": ("Converts", "converts"), "Loads": ("Loads", "loads"), "Starts": ("Starts", "starts"),
               "First draw": ("First draw", "gets to its first draw"), "Presents": ("Shows frames", "shows frames"),
               "Menus": ("Reaches the menus", "reaches the menus"), "Ingame": ("In-game", "gets in-game"),
               "Playable": ("Playable", "is playable")},
}
TOP_STATUS = {"AnyPS5": "Playable", "KytyPS5": "in-game", "SharpEmu": "playable"}
OS_NAMES = {"windows": "Windows", "linux": "Linux", "macos": "macOS"}


def status_label(project, status, phrase=False):
    label = STATUS.get(project, {}).get(status)
    return label[1 if phrase else 0] if label else (status or "").replace("-", " ")


def os_name(name):
    return OS_NAMES.get((name or "").lower(), name)


class Details:
    """The collector's per-game data (game_details.json): every tested game's status on each project,
    recent test reports, and engine and genres from AnyPS5's blocker map."""

    def __init__(self, raw):
        raw = raw if isinstance(raw, dict) else {}
        self.status = raw.get("status") or {}
        self.history = raw.get("history") or {}
        self.alias = raw.get("kyty_alias") or {}
        self.about_ids = raw.get("about") or {}
        self.meanings = raw.get("anyps5_stages") or {}
        self.available = bool(self.status)  # without the file, "not tested" can't be told from "no data"
        # Projects file games under different regional title IDs, so fall back to matching by name.
        self.by_name = {name: {slugify(clean_title(st.get("title")), None): tid
                               for tid, st in entries.items() if st.get("title")}
                        for name, entries in self.status.items()}

    def _tid(self, project, grp):
        entries = self.status.get(project) or {}
        for tid in grp["ids"]:
            tid = tid if tid in entries else self.alias.get(tid, tid) if project == "KytyPS5" else tid
            if tid in entries:
                return tid
        return self.by_name.get(project, {}).get(grp["slug"])

    def of(self, project, grp):
        tid = self._tid(project, grp)
        return (self.status.get(project) or {}).get(tid) if tid else None

    def reports(self, project, grp):
        tid = self._tid(project, grp)
        return (self.history.get(project) or {}).get(tid) or [] if tid else []

    def about(self, grp):
        for tid in [*grp["ids"], self._tid("AnyPS5", grp)]:
            if tid and tid in self.about_ids:
                return self.about_ids[tid]
        return {}


DETAILS = Details(None)  # set by main()


def emulator_card(project, row, grp):
    repo, compat = PROJECT_LINKS[project]
    tier = TOP_TIER[project]
    st = DETAILS.of(project, grp)
    reports = DETAILS.reports(project, grp)
    if not row:
        if not st and not DETAILS.available:
            return (f'<section class="gp-emu gp-none ink-{INK[project]}"><h2>{project}</h2><p class="gp-status">No {tier} report yet</p>'
                    f'<p>It may still boot or reach the menus; see <a href="{compat}">{project}\'s compatibility list</a>.</p>'
                    "</section>")
        if not st:
            return (f'<section class="gp-emu gp-none ink-{INK[project]}"><h2>{project}</h2><p class="gp-status">Not tested yet</p>'
                    f'<p>Nobody has reported this game on {project}. <a href="{compat}">{project}\'s compatibility list</a> '
                    "explains how to send a test report.</p></section>")
        meaning = DETAILS.meanings.get(st["status"]) if project == "AnyPS5" else None
        facts = [("Latest test", long_date(st.get("tested") or "") or None),
                 ("Test reports", num(st["reports"]) if st.get("reports") else None)]
        dl = "".join(f"<div><dt>{k}</dt><dd>{e(str(v))}</dd></div>" for k, v in facts if v)
        link = st.get("url") if SAFE_REPORT.match(st.get("url") or "") else compat
        return (f'<section class="gp-emu gp-none ink-{INK[project]}"><h2>{project}</h2>'
                f'<p class="gp-status">{e(status_label(project, st["status"]))}</p>'
                f'{f"<p>{e(meaning)}</p>" if meaning else ""}<dl>{dl}</dl>'
                f'<p>Not {tier} yet. <a href="{e(link)}">See the {project} reports</a></p></section>')
    # Only the newest reports are kept, so "first" is known only when none have been dropped.
    complete = not st or not st.get("reports") or st["reports"] <= len(reports)
    reached = min((r["date"] for r in reports if r.get("status") == TOP_STATUS[project] and r.get("date")),
                  default=None) if complete else None
    facts = [("Frame rate", f"{row['fps']} FPS" if row.get("fps") else "Not reported"),
             ("Tested", long_date(row.get("tested") or "") or None),
             (f"First {tier} report", long_date(reached) if reached and reached != (row.get("tested") or "")[:10] else None),
             ("Test reports", num(st["reports"]) if st and st.get("reports") else None),
             ("Hardware", None if re.fullmatch(r"[A-Z]{4}\d{5}", row.get("hardware") or "") else row.get("hardware")),
             ("OS", os_name(row.get("os"))), ("Title ID", row.get("titleId"))]
    dl = "".join(f"<div><dt>{k}</dt><dd>{e(str(v))}</dd></div>" for k, v in facts if v)
    quote = f'<blockquote>“{e(row["fps_note"])}”</blockquote>' if row.get("fps_note") else ""
    report = (f'<p><a href="{e(row["url"])}">Read the {project} test report</a></p>'
              if SAFE_REPORT.match(row.get("url") or "") else "")
    return (f'<section class="gp-emu gp-ok ink-{INK[project]}"><h2>{project}</h2><p class="gp-status">{tier.capitalize()}</p>'
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
    if missing and not DETAILS.available:
        tiers = join_and(sorted({TOP_TIER[p] for p in missing}))
        lead += f" {join_and(missing)} {'has' if len(missing) == 1 else 'have'} no {tiers} report for it yet."
    elif missing:
        known = [(p, DETAILS.of(p, grp)) for p in missing]
        tested = [f"{status_label(p, st['status'], True)} on {p}" for p, st in known if st]
        untested = [p for p, st in known if not st]
        if tested:
            lead += f" It {join_and(tested)}."
        if untested:
            lead += f" Nobody has tested it on {join_and(untested)} yet."
    description = f"Does {title} run on a PS5 emulator? It's {join_and([phrase(p) for p in have])}. Test reports and hardware for each emulator."
    if len(description) > 160:
        description = f"Does {title} run on a PS5 emulator? It's {join_and([phrase(p, False) for p in have])}. Test reports, FPS and hardware."
    page_title = f"{title} on PS5 emulators: status and FPS"
    if len(page_title) <= 45:
        page_title += " | PS5 Emulation Tracker"

    about = []
    facts = DETAILS.about(grp)
    if facts.get("engine"):
        about.append(f"Built with {facts['engine']}.")
    if facts.get("genres"):
        about.append(f"Genre: {join_and(facts['genres'][:3]).lower()}.")
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
    rel_items, rel_heading = related
    rel = "".join(f'<li><a href="{BASE}games/{o["slug"]}/">{e(o["title"])}</a></li>' for o in rel_items)
    history = test_history(grp)
    gta_note = (f'<section class="gp-text"><h2>What this means for GTA 6</h2><p>GTA V runs on the same RAGE engine as '
                f'GTA 6, so its progress is the best early sign of how GTA 6 will fare. <a href="{BASE}gta-6/">Can you '
                f'play GTA 6 on PC?</a> tracks every step.</p></section>' if grp["slug"].startswith("grand-theft-auto-v") else "")
    repos = {p: PROJECT_LINKS[p][0] for p in ORDER}
    body = f"""    <nav class="gp-crumbs" aria-label="Breadcrumb"><a href="{BASE}">Tracker</a> › <a href="{BASE}games/">Games</a> › <span>{e(title)}</span></nav>
    <div class="gp-hero ink-{INK[have[0]]}">
      {cover}
      <div>
        <h1>{e(title)} on PS5 emulators</h1>
        <p class="gp-lead">{e(lead)}</p>
        {f'<p class="gp-about">{e(" ".join(about))}</p>' if about else ''}
      </div>
    </div>
    <div class="gp-emus">
      {''.join(emulator_card(p, rows.get(p), grp) for p in ORDER)}
    </div>
    {history}
    <section class="gp-text">
      <h2>How to try {e(title)} on PC</h2>
      <p>You need your own copy of the game, dumped from your PS5, and one of the emulators above. All three are free,
      open source and published only on GitHub: <a href="{repos['SharpEmu']}">SharpEmu</a>,
      <a href="{repos['KytyPS5']}">KytyPS5</a> and <a href="{repos['AnyPS5']}">AnyPS5</a>. Sites offering PS5
      emulator downloads anywhere else are often malware.</p>
      <p>Results depend on your hardware and the emulator version, so check what the tester used.</p>
    </section>
    {gta_note}
    {f'<section class="gp-text"><h2>{e(rel_heading)}</h2><ul class="gp-related">{rel}</ul></section>' if rel else ''}"""
    image = {"primaryImageOfPage": {"@type": "ImageObject", "url": grp["cover"]}} if grp["cover"] else None
    ld = page_graph("WebPage", url, page_title, description, grp["tested"] or today,
                    [("PS5 Emulation Tracker", SITE), ("Games", SITE + "games/"), (title, url)], image)
    return page_shell(page_title, description, url, ld, body, style_link,
                      sized(grp["cover"], 1200) if grp["cover"] else None)


def test_history(grp, limit=12):
    """The game's recent test reports on every emulator, newest first, with a sentence that sums them up."""
    rows, seen = [], set()
    for p in ORDER:
        for r in DETAILS.reports(p, grp):
            key = (p, r.get("date"), r.get("status"), r.get("os"), r.get("hardware"), r.get("fps"))
            if r.get("date") and key not in seen:  # one tester often files the same result in several places
                seen.add(key)
                rows.append((r, p))
    rows.sort(key=lambda x: x[0]["date"], reverse=True)
    if not rows:
        return ""
    title = grp["title"]
    total = sum((DETAILS.of(p, grp) or {}).get("reports") or 0 for p in ORDER) or len(rows)
    projects = sorted({p for _, p in rows}, key=ORDER.index)
    first = min(r["date"] for r, _ in rows)
    summary = [f"{num(total)} test report{'s' if total != 1 else ''} on {join_and(projects)}, the first on {long_date(first)}."]
    for p in projects:
        ladder = list(STATUS[p])
        mine = sorted((r for r, q in rows if q == p and r.get("status") in ladder), key=lambda r: r["date"])
        mine = [r for r in mine if mine and r.get("os") == mine[-1].get("os")]  # compare like with like
        if len(mine) > 1 and ladder.index(mine[-1]["status"]) > ladder.index(mine[0]["status"]):
            where = f" on {os_name(mine[-1]['os'])}" if mine[-1].get("os") else ""
            summary.append(f"On {p}{where} it went from “{status_label(p, mine[0]['status']).lower()}” on "
                           f"{long_date(mine[0]['date'])} to “{status_label(p, mine[-1]['status']).lower()}” on "
                           f"{long_date(mine[-1]['date'])}.")
    body = []
    for r, p in rows[:limit]:
        result = e(status_label(p, r.get("status")))
        if r.get("url") and SAFE_REPORT.match(r["url"]):
            result = f'<a href="{e(r["url"])}">{result}</a>'
        system = " · ".join(e(x) for x in (os_name(r.get("os")), r.get("hardware")) if x)
        body.append(f'<tr><td class="num">{e(short_date(r["date"]))}</td><td>{p}</td><td>{result}</td>'
                    f'<td>{system or "Not reported"}</td><td class="num">{e(r["fps"]) + " FPS" if r.get("fps") else ""}</td></tr>')
    return f"""<section class="gp-text gp-history">
      <h2>{e(title)} test history</h2>
      <p>{e(" ".join(summary))}</p>
      <div class="tablebox"><table>
        <thead><tr><th scope="col">Date</th><th scope="col">Emulator</th><th scope="col">Result</th><th scope="col">System</th><th scope="col">FPS</th></tr></thead>
        <tbody>{''.join(body)}</tbody>
      </table></div>
    </section>"""


def games_index(groups, today, style_link):
    url = SITE + "games/"
    games = sorted(groups.values(), key=lambda g: g["title"].casefold())
    counts = {p: sum(p in g["rows"] for g in games) for p in ORDER}
    items = []
    for g in games:
        chips = "".join(
            f'<span class="gp-chip">{p}{" · " + e(g["rows"][p]["fps"]) + " FPS" if g["rows"][p].get("fps") else ""}</span>'
            for p in ORDER if p in g["rows"])
        ink = INK[next(p for p in ORDER if p in g["rows"])]
        if g["cover"]:
            src, hi = sized(g["cover"], 96), sized(g["cover"], 192)
            thumb = (f'<img class="gp-thumb" src="{e(src)}" srcset="{e(src)} 1x, {e(hi)} 2x" width="72" height="72" alt="" '
                     f'loading="lazy" decoding="async" referrerpolicy="no-referrer">')
        else:
            thumb = f'<span class="gp-thumb" aria-hidden="true">{e(initials(g["title"]))}</span>'
        fps = max((r["fps_value"] for r in g["rows"].values() if r.get("fps_value") is not None), default=None)
        meta = f'{g["rating"]}★ · {compact(g["ratings"])} ratings' if g["ratings"] and g["rating"] else "No ratings"
        if g["released"]:
            meta += f' · {g["released"][:4]}'
        tested = f'<span class="gp-meta">Tested {e(short_date(g["tested"]))}</span>' if g["tested"] else ""
        keys = {"tested": g["tested"], "ratings": g["ratings"] or None, "released": g["released"], "fps": fps}
        data = "".join(f' data-{k}="{e(str(v))}"' for k, v in keys.items() if v is not None)
        items.append(f'<li class="ink-{ink}"{data}>{thumb}<a href="{BASE}games/{g["slug"]}/">{e(g["title"])}</a>'
                     f'<span class="gp-chips">{chips}</span><span class="gp-meta">{e(meta)}</span>{tested}</li>')
    summary = (f"{len(games)} PS5 games reach gameplay on at least one PC emulator: {counts['SharpEmu']} are playable on "
               f"SharpEmu, {counts['KytyPS5']} get in-game on KytyPS5 and {counts['AnyPS5']} are playable on AnyPS5.")
    title = f"PS5 games that run on PC emulators ({len(games)} games)"
    description = f"{summary} Updated {long_date(today)}."
    body = f"""    <nav class="gp-crumbs" aria-label="Breadcrumb"><a href="{BASE}">Tracker</a> › <span>Games</span></nav>
    <p class="eyebrow">Updated {e(long_date(today))}</p>
    <h1>PS5 games that run on PC emulators</h1>
    <p class="gp-lead">{e(summary)} Each game's page has the test reports, hardware and frame rates.</p>
    <div class="tools gp-tools">
      <label class="sort-by with-icon">{SORT_ICON}<span class="sr-only">Sort games by</span>
        <select id="gp-sort">{''.join(f'<option value="{v}"{" selected" if v == "title" else ""}>{label}</option>' for v, label in GAME_SORTS)}</select>
      </label>
    </div>
    <ul class="gp-index" id="gp-index">
      {''.join(items)}
    </ul>"""
    ld = page_graph("CollectionPage", url, title, description, today,
                    [("PS5 Emulation Tracker", SITE), ("Games", url)])
    return page_shell(title + " | PS5 Emulation Tracker", description, url, ld, body, style_link, script="games.js")


def related_games(grp, groups, limit=6):
    """Other games on the same emulators, so pages link to each other: same engine first, then a shared genre,
    then the most-rated."""
    mine = set(grp["rows"])
    facts = DETAILS.about(grp)
    engine, genres = facts.get("engine"), set(facts.get("genres") or [])

    def score(o):
        f = DETAILS.about(o)
        return (2 if engine and f.get("engine") == engine else 0) + (1 if genres & set(f.get("genres") or []) else 0)
    others = [o for o in groups.values() if o["slug"] != grp["slug"] and mine & set(o["rows"])]
    picks = sorted(others, key=lambda o: (-score(o), -o["ratings"], o["title"].casefold()))[:limit]
    if engine and picks and all(DETAILS.about(o).get("engine") == engine for o in picks[:3]):
        heading = f"Other {engine} games that run on PC"
    elif picks and score(picks[0]):
        heading = f"Similar games that run on PC"
    else:
        heading = "Other PS5 games that run on PC"
    return picks, heading


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


GTA_STAGE = {"none": "Not tested", "boots": "Boots", "menus": "Reaches the menus", "ingame": "In-game",
             "playable": "Playable"}


def write_gta_page(site, groups, today, style_link):
    """gta-6/: the question everyone searches around GTA 6's launch, answered from the day's data."""
    data = site / "data"
    gta = load(data, "gta", {})
    if not gta.get("gta6"):
        return False
    status = gta_status(data)
    snaps = latest_snapshots(load(data, "snapshots", []))
    lib = snaps.get("AnyPS5", {}).get("lib_percent")
    lib_share = lib / 100 if isinstance(lib, (int, float)) else None
    milestones = gta_milestones(gta, lib_share, today, status)
    score = gta_readiness(gta, lib_share, today, status)
    six, gtav = gta["gta6"], gta.get("gtav") or {}
    released = six.get("released")
    days = (dt.date.fromisoformat(released) - dt.date.fromisoformat(today)).days if released else None
    url = SITE + "gta-6/"

    if days is not None and days > 0:
        when = f"GTA 6 comes out on PS5 and Xbox Series X|S on {long_date(released)}, in {days} day{'s' if days != 1 else ''}."
    elif released:
        when = f"GTA 6 came out on PS5 and Xbox Series X|S on {long_date(released)}."
    else:
        when = "GTA 6's PS5 release date isn't listed yet."
    best = max((STAGE_RANK.index(r["stage"]) for r in (six.get("projects") or {}).values()
                if r and r.get("stage") in STAGE_RANK), default=0)
    answer = "Not yet." if best < 4 else "Yes, on a PS5 emulator."
    lead = [answer, when]
    if best == 0 and not status.get("copyable") and status.get("copy_blocker"):
        lead.append(f"No PS5 emulator can run it at launch, because nobody can copy it off a PS5 yet. {status['copy_blocker']}")
    elif best:
        lead.append(f"The furthest any emulator has got with it: {GTA_STAGE[STAGE_RANK[best]].lower()}.")
    if status.get("pc_version"):
        lead.append(status["pc_version"])

    steps = []
    for group, items in milestones:
        lis = "".join(
            f'<li class="{"done" if prog >= 1 else "todo"}"><span class="gp-step-mark" aria-hidden="true">{"✓" if prog >= 1 else "–"}</span>'
            f'<span>{e(label)}{f"<span class=gp-why>{e(note)}</span>" if note and prog < 1 else ""}</span>'
            f'<span class="num">{round(w * prog, 1):g} / {w:g}</span></li>' for label, w, prog, note in items)
        steps.append(f"<h3>{e(group)}</h3><ul class=\"gp-steps\">{lis}</ul>")

    def cell(game, project):
        r = (game.get("projects") or {}).get(project)
        if not r:
            return "Not tested"
        text = e(GTA_STAGE.get(r.get("stage"), "Not tested"))
        if r.get("url") and SAFE_REPORT.match(r["url"]):
            text = f'<a href="{e(r["url"])}">{text}</a>'
        return text + (f'<span class="gp-meta">{e(short_date(r["tested"]))}</span>' if r.get("tested") else "")
    rows = "".join(f"<tr><td>{p}</td><td>{cell(six, p)}</td><td>{cell(gtav, p)}</td></tr>" for p in ORDER)
    gtav_page = next((g for g in groups.values() if g["slug"].startswith("grand-theft-auto-v")), None)
    gtav_link = f' <a href="{BASE}games/{gtav_page["slug"]}/">GTA V on PS5 emulators</a> has every test report.' if gtav_page else ""

    questions = [(q, a) for q, a in FAQ[:GTA_QUESTIONS] if a]
    qa = "".join(f"<h3>{e(q)}</h3><p>{e(a)}</p>" for q, a in questions)
    sources = "".join(f'<li><a href="{e(src["url"])}">{e(src["name"])}</a></li>' for src in status.get("sources") or []
                      if isinstance(src, dict) and str(src.get("url", "")).startswith("https://") and src.get("name"))

    title = "Can you play GTA 6 on PC? PS5 emulator readiness"
    description = (f"{answer} {when} GTA 6 emulation readiness is {score}%, from checkable milestones: whether it can "
                   "be copied off a PS5, then how far each emulator gets.")
    body = f"""    <nav class="gp-crumbs" aria-label="Breadcrumb"><a href="{BASE}">Tracker</a> › <span>GTA 6</span></nav>
    <h1>Can you play GTA 6 on PC?</h1>
    <p class="gp-lead">{e(" ".join(lead))}</p>
    <p class="gp-about">Updated {e(long_date(today))}. Emulator results update every 3 hours from each project's compatibility list.</p>
    <section class="gp-text gp-ready">
      <h2>GTA 6 emulation readiness: {score}%</h2>
      <meter class="gp-meter" min="0" max="100" value="{score}" aria-label="GTA 6 emulation readiness">{score}%</meter>
      <p>The score adds up milestones anyone can check. It reaches 100% only once GTA 6 is playable at 30+ FPS on a PS5 emulator.</p>
      {''.join(steps)}
    </section>
    <section class="gp-text">
      <h2>GTA 6 and GTA V on each PS5 emulator</h2>
      <p>GTA V's PS5 version runs on the same RAGE engine as GTA 6, so it's the best early sign of how GTA 6 will fare.{gtav_link}</p>
      <div class="tablebox"><table>
        <thead><tr><th scope="col">Emulator</th><th scope="col">GTA 6</th><th scope="col">GTA V (PS5)</th></tr></thead>
        <tbody>{rows}</tbody>
      </table></div>
    </section>
    <section class="gp-text">
      <h2>Questions</h2>
      {qa}
    </section>
    {f'<section class="gp-text"><h2>Sources</h2><p>Facts that no compatibility list tracks were last checked on {e(long_date(status["updated"]))}.</p><ul class="gp-sources">{sources}</ul></section>' if sources and status.get("updated") else ''}"""
    ld = page_graph("FAQPage", url, title, description, today,
                    [("PS5 Emulation Tracker", SITE), ("GTA 6", url)],
                    {"mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
                                    for q, a in questions]})
    (site / "gta-6").mkdir(exist_ok=True)
    (site / "gta-6" / "index.html").write_text(page_shell(title, description, url, ld, body, style_link), encoding="utf-8")
    return True


def write_404(site, style_link):
    """GitHub Pages serves this for any missing address, so every link is absolute."""
    body = f"""    <div class="gp-404">
      <div class="press-404" aria-hidden="true">404</div>
      <h1>This page doesn’t boot</h1>
      <p class="gp-lead">There’s nothing at this address. It may have moved, or the link may be mistyped.</p>
      <p class="gp-404-links"><a class="gp-cta" href="{BASE}">Back to the tracker</a><a href="{BASE}games/">Every game</a></p>
    </div>"""
    page = page_shell("Page not found | PS5 Emulation Tracker", "This page doesn't exist on the PS5 Emulation Tracker.",
                      None, None, body, style_link, robots="noindex")
    (site / "404.html").write_text(page, encoding="utf-8")


def write_sitemap(site, groups, today, gta_page=False):
    urls = [(SITE, today)] + ([(SITE + "gta-6/", today)] if gta_page else []) + ([(SITE + "games/", today)] if groups else [])
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
    # Preload the one font file so the hero's display type paints without a late swap.
    global FONT_PRELOAD
    font = next(iter(sorted((site / "media").glob("archivo-latin-wdth-normal-*.woff2"))), None)
    if font:
        tag = f'<link rel="preload" href="{BASE}media/{font.name}" as="font" type="font/woff2" crossorigin>'
        FONT_PRELOAD = f"  {tag}" + chr(10)
        if 'rel="preload"' not in page:
            page = page.replace(style.group(0), tag + chr(10) + "  " + style.group(0), 1)
            (site / "index.html").write_text(page, encoding="utf-8")
    global DETAILS
    DETAILS = Details(load(site / "data", "game_details", None))
    (site / "data" / "game_details.json").unlink(missing_ok=True)  # build input only; the app doesn't read it
    groups = game_groups(load(site / "data", "playable_games", []))
    write_game_pages(site, groups, today, style_link)
    gta_page = write_gta_page(site, groups, today, style_link)
    write_404(site, style_link)
    add_page_links(site, groups)
    urls = write_sitemap(site, groups, today, gta_page)
    print(f"seo.py: wrote {len(body):,} characters of summary and {len(groups)} game pages; "
          f"sitemap has {urls} URLs, dated {today}")


if __name__ == "__main__":
    main()
