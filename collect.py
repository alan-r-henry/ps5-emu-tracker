"""Collect a daily snapshot of PS5 emulation progress from GitHub.

Usage: python -I collect.py [work_dir] [--backfill]

work_dir (default: this script's folder) holds cloned repos (cache/), the
running history (history/*.json) and the files the dashboard reads (out/*.json).
Requires an authenticated `gh` CLI and `git` on PATH.
"""
import datetime as dt
import json
import os
import re
import subprocess
import sys
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

PROJECTS = {
    "AnyPS5": {
        "repo": "boykopovar/AnyPS5",
        "kind": "anyps5",
        "top": "Playable",
        "ladder": [("Converts", "Converts"), ("Loads", "Loads"), ("Starts", "Starts"),
                   ("First draw", "First draw"), ("Presents", "Presents"), ("Menus", "Menus"),
                   ("Ingame", "In-game"), ("Playable", "Playable")],
    },
    "KytyPS5": {
        "repo": "KytyPS5/KytyPS5",
        "site": "KytyPS5/kytyps5.github.io",
        "kind": "kyty",
        "top": "in-game",
        "ladder": [("doesnt-boot", "Doesn't boot"), ("logo", "Logo"),
                   ("main-menu", "Main menu"), ("in-game", "In-game")],
    },
    "SharpEmu": {
        "repo": "sharpemu/sharpemu",
        "site": "sharpemu/sharpemu-site",
        "kind": "sharp",
        "top": "playable",
        "ladder": [("nothing", "Nothing"), ("boots", "Boots"), ("menus", "Menus"),
                   ("ingame", "In-game"), ("playable", "Playable")],
    },
}
SATELLITES = [
    ("sharpemu/sharpemu-mac", "SharpEmu macOS port"),
    ("Jetsku/KytyPS5", "KytyPS5 fork with shader and renderer fixes"),
    ("Coder787-source/KytyPlus", "KytyPS5 fork with extra HLE work"),
    ("buberlo/madeira-anyps5", "AnyPS5 on iPad research prototype"),
    ("iStark/PS5PCEM", "Small independent emulator"),
    ("RPCSX/rpcsx", "PS4/PS5 emulator, boots PS5 Safe Mode"),
    ("InoriRus/Kyty", "Original Kyty, upstream of KytyPS5"),
]
WINDOW_DAYS = 30
MERGE_LIST_DAYS = 3
ANYPS5_PAGES = "https://boykopovar.github.io/AnyPS5"
ANYPS5_ROADMAP = "https://alxcbtw.github.io/anyps5-roadmap/roadmap.json"  # community blocker map AnyPS5 links to
STORE_CONCEPT = "https://store.playstation.com/{locale}/concept/{cid}"
STORE_LOCALES = ("en-us", "en-gb", "ja-jp")  # Japan-only titles appear only in the Japanese store
STORE_COVER_ROLES = ("MASTER", "GAMEHUB_COVER_ART")  # square art, matching the catalogs' covers
RATINGS_MAX_AGE_DAYS = 7
# Only links and images on these hosts reach the site; anything else from upstream data is dropped.
SAFE_LINK = re.compile(r"^https://(github\.com|kytyps5\.github\.io|sharpemu\.app|alxcbtw\.github\.io|boykopovar\.github\.io)/")
SAFE_IMAGE = re.compile(r"^https://image\.api\.playstation\.com/[\w./%-]+$")

# GTA titles followed by the readiness score. GTA V's PS5 release runs on the same RAGE engine as GTA VI,
# so it's the closest stand-in until GTA VI itself can be tested. Every regional title ID is listed.
GTA_TITLES = {
    "gta6": {"name": "Grand Theft Auto VI", "ids": ["PPSA01547", "PPSA29660", "PPSA38500"]},
    "gtav": {"name": "Grand Theft Auto V (PS5)",
             "ids": ["PPSA01721", "PPSA03420", "PPSA03421", "PPSA04263", "PPSA04264", "PPSA04265"]},
}
# Each project's own stage names, mapped onto one shared ladder: none < boots < menus < ingame < playable.
COMMON_STAGE = {
    "AnyPS5": {"Starts": "boots", "First draw": "boots", "Presents": "boots", "Menus": "menus",
               "Ingame": "ingame", "Playable": "playable"},
    "KytyPS5": {"logo": "boots", "main-menu": "menus", "in-game": "ingame"},
    "SharpEmu": {"boots": "boots", "menus": "menus", "ingame": "ingame", "playable": "playable"},
}
STAGE_ORDER = ["none", "boots", "menus", "ingame", "playable"]

# Store pages for games neither catalog lists, e.g. disc-only editions of a game sold digitally under another ID.
CONCEPT_OVERRIDES = {
    "PPSA17189": 10006414,  # Formula Retro Racing: World Tour – Special Edition (disc) -> the digital game
}


def gh(*args):
    return subprocess.run(["gh", "api", *args], capture_output=True, text=True,
                          encoding="utf-8", check=True).stdout


def gh_json(path):
    return json.loads(gh(path))


def gh_lines(path, jq):
    return [l for l in gh("--paginate", path, "--jq", jq).splitlines() if l.strip()]


def gh_raw(repo, path):
    return gh(f"repos/{repo}/contents/{path}", "-H", "Accept: application/vnd.github.raw")


def search_count(q):
    return gh_json(f"search/issues?q={q}&per_page=1")["total_count"]


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


@lru_cache(maxsize=None)
def kyty_detail(key):
    """One KytyPS5 game's test reports; fetched once per run and shared by the games list and the game details."""
    return fetch_json(f"https://kytyps5.github.io/data/compat/{key}.json")


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", check=True).stdout


def sync_clone(cache, repo, depth=None):
    dest = cache / repo.replace("/", "__")
    d = ["--depth", str(depth)] if depth else []
    if not dest.exists():
        subprocess.run(["git", "clone", "-q", *d, f"https://github.com/{repo}", str(dest)],
                       check=True, capture_output=True)
    else:
        git(dest, "fetch", "-q", *d, "origin")
        git(dest, "reset", "-q", "--hard", "FETCH_HEAD")
    return dest


def kyty_statuses(index):
    games = index.get("games", []) if isinstance(index, dict) else index
    return Counter(g.get("overall") for g in games if isinstance(g, dict))


def sharp_statuses(site_dir, rev=None):
    if rev is None:
        texts = [f.read_text(encoding="utf-8") for f in (site_dir / "src/content/compat").glob("*.md")]
    else:
        names = git(site_dir, "ls-tree", "--name-only", rev, "src/content/compat/").split()
        texts = [git(site_dir, "show", f"{rev}:{n}") for n in names if n.endswith(".md")]
    c = Counter()
    for t in texts:
        m = re.search(r'^status:\s*"?([a-z-]+)"?', t, re.M)
        if m:
            c[m.group(1)] += 1
    return c


def anyps5_statuses(roadmap):
    """Count titles by best verified stage on the AnyPS5 blocker map (skipping its template entry)."""
    return Counter(t["best_stage"]["stage"] for t in roadmap.get("titles", [])
                   if t.get("id") != "PPSA00000" and (t.get("best_stage") or {}).get("stage"))


def hle_functions(src_dir, kind):
    pat = re.compile(r'LIB_FUNC\("([^"]+)"') if kind == "kyty" else re.compile(r'Nid\s*=\s*"([^"]+)"')
    ext = (".cpp", ".h") if kind == "kyty" else (".cs",)
    nids = set()
    for root, _, files in os.walk(src_dir / "src"):
        for f in files:
            if f.endswith(ext):
                nids.update(pat.findall(Path(root, f).read_text(encoding="utf-8", errors="ignore")))
    return len(nids)


def compat_rows(date, name, counts):
    meta = PROJECTS[name]
    return [{"date": date, "project": name, "rank": i, "status": label,
             "games": counts.get(key, 0), "top": key == meta["top"]}
            for i, (key, label) in enumerate(meta["ladder"])]


def upsert(rows, new, keys):
    k = lambda r: tuple(r[x] for x in keys)
    seen = {k(r) for r in new}
    return sorted([r for r in rows if k(r) not in seen] + new, key=k)


def load(p):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []


def save(p, rows):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def backfill_compat(cache, history):
    """Rebuild past compatibility counts from each site's git history (last commit per day)."""
    rows = []
    sources = {
        "KytyPS5": (PROJECTS["KytyPS5"]["site"], "src/data/compat-index.json"),
        "SharpEmu": (PROJECTS["SharpEmu"]["site"], "src/content/compat"),
    }
    for name, (repo, path) in sources.items():
        site = sync_clone(cache, repo)
        last_per_day = {}
        for line in git(site, "log", "--since=120 days ago", "--format=%H %cs", "--", path).splitlines():
            sha, day = line.split()
            last_per_day.setdefault(day, sha)  # log is newest first
        for day, sha in sorted(last_per_day.items()):
            try:
                if name == "KytyPS5":
                    counts = kyty_statuses(json.loads(git(site, "show", f"{sha}:{path}")))
                else:
                    counts = sharp_statuses(site, sha)
            except (subprocess.CalledProcessError, json.JSONDecodeError, AttributeError):
                continue
            if sum(counts.values()):
                rows += compat_rows(day, name, counts)
    return upsert(history, rows, ["date", "project", "rank"])


FPS_RE = re.compile(
    r"(~|≈|about\s+|around\s+|avg\.?\s+|average\s+(?:of\s+)?)?(\d{1,3}(?:\.\d+)?)"
    r"(?:\s*(?:-|–|to)\s*(\d{1,3}(?:\.\d+)?))?\s*fps\b", re.I)
# "fps was 45 to 60", "average fps of ~30": the number comes after the word
FPS_AFTER_RE = re.compile(
    r"\bfps\s+(?:was|is|of|around|about|at|stays at|sits at)\s+(~|about\s+|around\s+)?(\d{1,3}(?:\.\d+)?)(?!\d)"
    r"(?:\s*(?:-|–|to)\s*(\d{1,3}(?:\.\d+)?)(?!\d))?(?!\s*x\s*\d)", re.I)
# a sentence ends at . ! ? followed by whitespace (so "COMPATIBILITY.md" stays whole) or at a line break
SENTENCE_END = re.compile(r"[.!?](?=\s)|\n")


def _num(x):
    return f"{x:g}"


def best_fps(text):
    """Highest frame rate a tester wrote in free text, with the sentence it came from."""
    best = None
    text = text or ""
    for m in [*FPS_RE.finditer(text), *FPS_AFTER_RE.finditer(text)]:
        lo = float(m.group(2))
        hi = float(m.group(3)) if m.group(3) else None
        top = hi if hi is not None else lo
        if not 0 < top <= 240 or (hi is not None and hi < lo):
            continue
        if best is None or top > best[0]:
            label = f"{_num(lo)}–{_num(hi)}" if hi is not None else ("~" if m.group(1) else "") + _num(lo)
            starts = [e.end() for e in SENTENCE_END.finditer(text, 0, m.start())]
            end = SENTENCE_END.search(text, m.end())
            raw = text[starts[-1] if starts else 0:end.start() + 1 if end else len(text)]
            sentence = re.sub(r"[*_`#>|]|\[([^\]]*)\]\([^)]*\)", r"\1", raw).strip(" -:\n")
            best = (top, label, sentence[:220])
    return {"fps": best[1], "fps_value": best[0], "fps_note": best[2]} if best else {"fps": None, "fps_value": None, "fps_note": None}


def game_catalog(cache):
    """titleId -> {name, cover, conceptId, released} from the PS5 catalogs the compatibility sites ship."""
    cat = {}
    for repo in ("sharpemu/sharpemu-site", "KytyPS5/kytyps5.github.io"):
        path = cache / repo.replace("/", "__") / "src/data/games.json"
        if not path.exists():
            continue
        for g in json.loads(path.read_text(encoding="utf-8")):
            entry = {"name": g.get("name"), "cover": g.get("cover"), "conceptId": g.get("conceptId"),
                     "released": (g.get("releaseDate") or "")[:10] or None}
            for tid in g.get("allTitleIds") or [g["titleId"]]:
                old = cat.get(tid)
                if old is None:
                    cat[tid] = entry
                else:  # the two catalogs overlap; fill whatever the first one lacked
                    for k, v in entry.items():
                        old[k] = old.get(k) or v
    return cat


def store_info(cid):
    """Rating count and average (the closest public popularity figure), release date and cover art
    from the game's PlayStation Store page."""
    found = {"ratings": None, "rating": None, "released": None, "cover": None}
    for locale in STORE_LOCALES:
        req = urllib.request.Request(STORE_CONCEPT.format(locale=locale, cid=cid),
                                     headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                html = resp.read().decode("utf-8", "replace")
        except Exception:
            continue
        start = html.find(f'"Concept:{cid}"')
        if start < 0:  # this store doesn't sell the game; try the next region
            continue
        # The page embeds data for related products too; take the first match after the game's own record.
        page = html[start:]
        m = re.search(r'"averageRating":([\d.]+),"totalRatingsCount":(\d+)', page)
        rel = re.search(r'"releaseDate":"(\d{4}-\d{2}-\d{2})', page)
        images = dict(reversed(re.findall(
            r'"role":"([A-Z_]+)","type":"IMAGE","url":"(https://image\.api\.playstation\.com/[^"]+)"', page)))
        found["ratings"] = found["ratings"] or (int(m.group(2)) if m else None)
        found["rating"] = found["rating"] or (float(m.group(1)) if m else None)
        found["released"] = found["released"] or (rel.group(1) if rel else None)
        found["cover"] = found["cover"] or next((images[k] for k in STORE_COVER_ROLES if k in images), None)
        if found["ratings"] is not None and found["cover"]:
            break
    return found


def store_lookup(cache, concept_ids):
    """conceptId -> store_info, cached for a week so each run fetches only new or stale games."""
    path = cache / "store_info.json"
    known = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    today = dt.date.today()
    stale = [cid for cid in {str(c) for c in concept_ids if c}
             if cid not in known or (today - dt.date.fromisoformat(known[cid]["fetched"])).days >= RATINGS_MAX_AGE_DAYS]
    with ThreadPoolExecutor(max_workers=4) as pool:
        for cid, res in zip(stale, pool.map(store_info, stale)):
            known[cid] = {**res, "fetched": today.isoformat()}
    path.write_text(json.dumps(known, separators=(",", ":")), encoding="utf-8")
    return known


def playable_games(cache):
    """Games at each project's top tier, with cover art and any frame rate a tester reported."""
    cat = game_catalog(cache)
    rows = []

    def add(project, tier, tid, title, report_text, **extra):
        c = cat.get(tid, {})
        rows.append({"project": project, "tier": tier, "titleId": tid, "title": title or c.get("name") or tid,
                     "cover": extra.pop("cover", None) or c.get("cover"),
                     "conceptId": c.get("conceptId") or CONCEPT_OVERRIDES.get(tid),
                     "released": c.get("released"), **best_fps(report_text), **extra})

    roadmap = fetch_json(ANYPS5_ROADMAP)
    for t in roadmap.get("titles", []):
        bs = t.get("best_stage") or {}
        if t.get("id") == "PPSA00000" or bs.get("stage") != "Playable":
            continue
        note = re.sub(r"^Archived report from the removed \S+:\s*", "", bs.get("note") or "")
        quote = bs.get("quote") if bs.get("quote") not in (None, bs.get("note")) else None
        add("AnyPS5", "Playable", t["id"], t.get("name"), " ".join(filter(None, [note, quote])),
            os=bs.get("os"), hardware=bs.get("gpu"), tested=(bs.get("date") or "")[:10] or None,
            url=bs.get("url"))

    index = fetch_json("https://kytyps5.github.io/data/compat-index.json")
    for g in (index.get("games", []) if isinstance(index, dict) else index):
        if g.get("overall") != "in-game":
            continue
        try:
            reports = sorted(kyty_detail(g["key"]).get("reports", []), key=lambda r: r.get("testedDate") or "", reverse=True)
        except Exception:  # one missing detail file shouldn't drop the game
            reports = []
        ingame = [r for r in reports if r.get("status") == "in-game"] or reports
        latest = ingame[0] if ingame else {}
        fps_text = next((r.get("notes", "") for r in ingame if best_fps(r.get("notes"))["fps"]), latest.get("notes", ""))
        add("KytyPS5", "In-game", g.get("titleId") or g["key"], g.get("title"), fps_text,
            cover=g.get("cover"), os=latest.get("os"), hardware=latest.get("hardware"),
            tested=latest.get("testedDate") or g.get("latestTested"),
            url=f"https://kytyps5.github.io/game/{g['key']}")

    site = cache / "sharpemu__sharpemu-site" / "src/content/compat"
    for f in sorted(site.glob("*.md")):
        text = f.read_text(encoding="utf-8")
        front = dict(re.findall(r'^(\w+):\s*"?(.*?)"?\s*$', text.split("---")[1], re.M)) if text.startswith("---") else {}
        if front.get("status") != "playable":
            continue
        body = text.split("---", 2)[2] if text.count("---") >= 2 else text
        tid = front.get("titleId", f.stem)
        add("SharpEmu", "Playable", tid, None, body, os=front.get("os"), hardware=front.get("hardware"),
            tested=front.get("testedDate"), url=f"https://sharpemu.app/game/{tid}")

    store = store_lookup(cache, (r["conceptId"] for r in rows))
    for row in rows:
        st = store.get(str(row.pop("conceptId") or ""), {})
        row["ratings"], row["rating"] = st.get("ratings"), st.get("rating")
        row["released"] = row["released"] or st.get("released")
        row["cover"] = row["cover"] or st.get("cover")
        row["cover"] = row["cover"] if SAFE_IMAGE.match(row["cover"] or "") else None
        row["url"] = row["url"] if SAFE_LINK.match(row["url"] or "") else None
    return sorted(rows, key=lambda r: (r["project"], r["tested"] or "", r["title"].lower()), reverse=True)


HISTORY_PER_GAME = 8
TITLE_ID = re.compile(r"^[A-Z]{4}\d{5}$")


def short(text, limit=90):
    text = re.sub(r"\s+", " ", (text or "").replace("\\n", " ")).strip()
    return text if len(text) <= limit else text[:limit - 1].rstrip(" ,;/") + "…"


def report(date, status, os_name, hardware, notes="", url=None):
    """One test report, trimmed for the game pages: CPU and GPU only, and no hardware field that just repeats the
    title ID. Only AnyPS5 reports carry their own link; the other projects have one page per game."""
    hw = None if TITLE_ID.match((hardware or "").strip()) else short(" / ".join(re.split(r"\s+/\s+(?![^()]*\))", hardware or "")[:2])) or None
    r = {"date": (date or "")[:10] or None, "status": status, "os": short(os_name, 30) or None, "hardware": hw,
         "fps": best_fps(notes)["fps"]}
    if SAFE_LINK.match(url or ""):
        r["url"] = url
    return {k: v for k, v in r.items() if v is not None}


def front_matter(text):
    return dict(re.findall(r'^(\w+):\s*"?(.*?)"?\s*$', text.split("---")[1], re.M)) if text.startswith("---") else {}


def game_details(cache):
    """For every game each project has tested: its current status, its recent test reports (newest first)
    and, from AnyPS5's blocker map, its engine and genres. The game pages use this to say how a game does on
    every emulator, not just the ones where it reaches the top tier."""
    status = {name: {} for name in PROJECTS}
    history = {name: {} for name in PROJECTS}
    alias = {}  # other title IDs of a KytyPS5 game -> the ID its entry is filed under
    about = {}

    index = fetch_json("https://kytyps5.github.io/data/compat-index.json")
    for g in (index.get("games", []) if isinstance(index, dict) else index):
        if not isinstance(g, dict) or not g.get("overall"):
            continue
        tid = g.get("titleId") or g["key"]
        for other in g.get("allTitleIds") or []:
            if other != tid:
                alias[other] = tid
        status["KytyPS5"][tid] = {"title": g.get("title"), "status": g["overall"], "tested": g.get("latestTested"),
                                  "reports": sum((g.get("reportCounts") or {}).values()) or None,
                                  "url": f"https://kytyps5.github.io/game/{g['key']}"}
        reports = []
        if g["overall"] == "in-game":  # the detail files are fetched for these games anyway
            try:
                reports = [report(r.get("testedDate"), r.get("status"), r.get("os"), r.get("hardware"), r.get("notes"))
                           for r in kyty_detail(g["key"]).get("reports", [])]
            except Exception:
                pass
        if reports:
            history["KytyPS5"][tid] = sorted(reports, key=lambda r: r.get("date") or "", reverse=True)[:HISTORY_PER_GAME]

    # SharpEmu keeps one file per game and overwrites it with each new report, so its git history is the timeline.
    site = cache / "sharpemu__sharpemu-site"
    folder = "src/content/compat/"
    revs = {}
    for block in git(site, "log", "--format=@%H", "--name-only", "--", folder).split("@")[1:]:
        sha, *files = block.split()
        for f in files:
            revs.setdefault(f, []).append(sha)
    for f in sorted((site / folder).glob("*.md")):
        path = folder + f.name
        front = front_matter(f.read_text(encoding="utf-8"))
        tid = front.get("titleId", f.stem)
        if not front.get("status"):
            continue
        seen, reports = set(), []
        for sha in revs.get(path, [])[:HISTORY_PER_GAME * 2]:
            try:
                text = git(site, "show", f"{sha}:{path}")
            except subprocess.CalledProcessError:
                continue
            fm = front_matter(text)
            key = (fm.get("status"), fm.get("testedDate"), fm.get("hardware"))
            if not fm.get("status") or key in seen:
                continue
            seen.add(key)
            reports.append(report(fm.get("testedDate"), fm["status"], fm.get("os"), fm.get("hardware"),
                                  text.split("---", 2)[2] if text.count("---") >= 2 else ""))
        status["SharpEmu"][tid] = {"status": front["status"], "tested": front.get("testedDate"),
                                   "reports": len(reports) or None, "url": f"https://sharpemu.app/game/{tid}"}
        if reports:
            history["SharpEmu"][tid] = sorted(reports, key=lambda r: r.get("date") or "", reverse=True)[:HISTORY_PER_GAME]

    roadmap = fetch_json(ANYPS5_ROADMAP)
    rank = {st["name"]: st.get("rank", i) for i, st in enumerate(roadmap.get("stages", [])) if st.get("name")}
    for t in roadmap.get("titles", []):
        tid = t.get("id")
        if not tid or tid == "PPSA00000":
            continue
        facts = {k: v for k, v in (("engine", t.get("engine")), ("genres", [x for x in t.get("tags") or [] if x])) if v}
        if facts:
            about[tid] = facts
        bs = t.get("best_stage") or {}
        if not bs.get("stage"):
            continue
        # Claims above the stage the map's maintainers confirmed are left out, so the history never shows a
        # game further along than its verified status.
        best = rank.get(bs["stage"], -1)
        evidence = [report(ev.get("date"), ev.get("stage"), ev.get("os"), ev.get("gpu"),
                           " ".join(filter(None, [ev.get("note"), ev.get("quote")])), ev.get("url"))
                    for ev in t.get("evidence") or [] if ev.get("stage") and rank.get(ev["stage"], 99) <= best]
        status["AnyPS5"][tid] = {"title": t.get("name"), "status": bs["stage"], "tested": (bs.get("date") or "")[:10] or None,
                                 "reports": len(evidence) or None,
                                 "fixed_blockers": len(t.get("resolved_blockers") or []) or None,
                                 "open_blockers": len(t.get("open_blockers") or []) or None}
        if evidence:
            history["AnyPS5"][tid] = sorted(evidence, key=lambda r: r.get("date") or "", reverse=True)[:HISTORY_PER_GAME]
    meanings = {st["name"]: st.get("meaning") for st in roadmap.get("stages", []) if st.get("name")}
    for name in status:
        status[name] = {tid: {k: v for k, v in st.items() if v is not None} for tid, st in status[name].items()}
    return {"status": status, "history": history, "kyty_alias": alias, "about": about, "anyps5_stages": meanings}


def gta_progress(cache):
    """Best stage each emulator has reached on GTA VI and on GTA V's PS5 release, for the readiness score."""
    cat = game_catalog(cache)
    roadmap = fetch_json(ANYPS5_ROADMAP)
    kyty = fetch_json("https://kytyps5.github.io/data/compat-index.json")
    kyty = kyty.get("games", []) if isinstance(kyty, dict) else kyty
    sharp_dir = cache / "sharpemu__sharpemu-site" / "src/content/compat"

    def better(a, b):
        return b if a is None or STAGE_ORDER.index(b["stage"]) > STAGE_ORDER.index(a["stage"]) else a

    result = {}
    for key, game in GTA_TITLES.items():
        ids = set(game["ids"])
        per = {name: None for name in PROJECTS}
        for t in roadmap.get("titles", []):
            bs = t.get("best_stage") or {}
            stage = COMMON_STAGE["AnyPS5"].get(bs.get("stage"))
            if t.get("id") in ids and stage:
                per["AnyPS5"] = better(per["AnyPS5"], {
                    "stage": stage, "tested": (bs.get("date") or "")[:10] or None, "url": bs.get("url"),
                    "fps": best_fps(" ".join(filter(None, [bs.get("note"), bs.get("quote")])))["fps_value"]})
        for g in kyty:
            stage = COMMON_STAGE["KytyPS5"].get(g.get("overall"))
            if (g.get("titleId") or g.get("key")) in ids and stage:
                fps = None
                try:
                    detail = fetch_json(f"https://kytyps5.github.io/data/compat/{g['key']}.json")
                    fps = max((best_fps(r.get("notes"))["fps_value"] or 0 for r in detail.get("reports", [])), default=0) or None
                except Exception:
                    pass
                per["KytyPS5"] = better(per["KytyPS5"], {
                    "stage": stage, "tested": g.get("latestTested"), "fps": fps,
                    "url": f"https://kytyps5.github.io/game/{g['key']}"})
        for f in sorted(sharp_dir.glob("*.md")):
            text = f.read_text(encoding="utf-8")
            front = dict(re.findall(r'^(\w+):\s*"?(.*?)"?\s*$', text.split("---")[1], re.M)) if text.startswith("---") else {}
            tid = front.get("titleId", f.stem)
            stage = COMMON_STAGE["SharpEmu"].get(front.get("status"))
            if tid in ids and stage:
                per["SharpEmu"] = better(per["SharpEmu"], {
                    "stage": stage, "tested": front.get("testedDate"), "url": f"https://sharpemu.app/game/{tid}",
                    "fps": best_fps(text.split("---", 2)[-1])["fps_value"]})
        for v in per.values():
            if v and not SAFE_LINK.match(v.get("url") or ""):
                v["url"] = None
        released = next((cat[i]["released"] for i in game["ids"] if cat.get(i, {}).get("released")), None)
        result[key] = {"name": game["name"], "titleIds": game["ids"], "released": released, "projects": per}
    return result


# How AI coding agents sign commits: as the author, or in a Co-authored-by / "Generated with" line.
AI_SIGNATURE = re.compile(r"noreply@anthropic\.com|\bclaude code\b|\+copilot@users\.noreply\.github\.com|copilot-swe-agent"
                          r"|cursoragent@cursor\.com|\bcodex\b|openai\.com|devin-ai-integration|google-labs-jules"
                          r"|gemini-code-assist", re.I)
AI_LINE = re.compile(r"(?im)^(?:co-authored-by:.*|.*generated (?:with|by) .*)$")


def ai_assisted(login, email, message):
    """True when a commit says an AI agent wrote it or helped. Undisclosed use can't be seen, so this is a floor."""
    if login in NOT_PEOPLE or AI_SIGNATURE.search(email or ""):
        return True
    return any(AI_SIGNATURE.search(line) for line in AI_LINE.findall(message or ""))


SAFE_LOGIN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
SAFE_AVATAR = re.compile(r"^https://avatars\.githubusercontent\.com/u/\d+\?v=\d+$")
TOP_CONTRIBUTORS = 10
# AI coding agents that GitHub lists as ordinary users; the list is meant for people.
NOT_PEOPLE = {"claude", "copilot", "codex", "devin-ai-integration", "cursoragent", "jules"}


def top_contributors(repo):
    """The ten people with the most commits on the main branch (GitHub's own contributor ranking), with
    how many of their pull requests were merged. Commits rank rather than PRs because some maintainers push
    straight to main; lines of code would reward generated files and reformatting."""
    people = []
    for line in gh_lines(f"repos/{repo}/contributors?per_page=100",
                         '.[]|select(.type == "User" and (.login | endswith("[bot]") | not))'
                         '|[.login,.avatar_url,.contributions]|@json'):
        login, avatar, commits = json.loads(line)
        if SAFE_LOGIN.match(login or "") and login.lower() not in NOT_PEOPLE:
            people.append({"login": login, "avatar": avatar if SAFE_AVATAR.match(avatar or "") else None,
                           "commits": commits})
        if len(people) == TOP_CONTRIBUTORS:
            break
    merged = Counter(l.lower() for l in gh_lines(f"repos/{repo}/pulls?state=closed&per_page=100",
                                                 ".[]|select(.merged_at != null)|.user.login"))
    for p in people:
        p["prs"] = merged.get(p["login"].lower(), 0)
    return people


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    work = Path(args[0] if args else Path(__file__).parent).resolve()
    cache, hist, out = work / "cache", work / "history", work / "out"
    for d in (cache, hist, out):
        d.mkdir(parents=True, exist_ok=True)
    if "--games-only" in sys.argv:
        for repo in ("sharpemu/sharpemu-site", "KytyPS5/kytyps5.github.io"):
            sync_clone(cache, repo)
        save(out / "playable_games.json", playable_games(cache))
        save(out / "game_details.json", game_details(cache))
        save(out / "gta.json", gta_progress(cache))
        publish_to_web(work, out)
        return
    now = dt.datetime.now(dt.timezone.utc)
    today = now.date().isoformat()
    since = now.date() - dt.timedelta(days=WINDOW_DAYS - 1)

    compat_hist = load(hist / "compat_history.json")
    if "--backfill" in sys.argv:
        compat_hist = backfill_compat(cache, compat_hist)

    snapshots = load(hist / "snapshots.json")
    activity, merges, today_compat, snaps, libraries = [], [], [], [], []
    top_people = {}
    catalog = None
    for name, meta in PROJECTS.items():
        repo, kind = meta["repo"], meta["kind"]
        info = gh_json(f"repos/{repo}")
        merged = []
        for line in gh_lines(f"repos/{repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100",
                             f'.[]|select(.merged_at!=null and .merged_at>="{since}")|[.number,.merged_at,.title,.html_url]|@json'):
            n, at, title, url = json.loads(line)
            merged.append({"project": name, "number": n, "merged_at": at, "title": title, "url": url})
        # One row per commit: [day, GitHub login, author email, message]. Commits whose email isn't linked to an
        # account have no login and aren't counted as contributors, since they may belong to someone already counted.
        commit_rows = [json.loads(l) for l in gh_lines(
            f"repos/{repo}/commits?since={since}T00:00:00Z&per_page=100",
            '.[]|[.commit.committer.date[0:10], ((.author.login // "") | ascii_downcase), .commit.author.email,'
            ' .commit.message]|@json')]
        commits = [row[0] for row in commit_rows]
        ai_commits = sum(ai_assisted(*row[1:]) for row in commit_rows)
        authors_30d = {row[1] for row in commit_rows if row[1] and not row[1].endswith("[bot]") and row[1] not in NOT_PEOPLE}
        # GitHub's contributor list is cached and can trail recent commits, so fold the 30-day authors in.
        contributors = authors_30d | {l.lower() for l in gh_lines(
            f"repos/{repo}/contributors?per_page=100",
            '.[]|select(.type != "Bot" and (.login | endswith("[bot]") | not))|.login')} - NOT_PEOPLE
        mc, cc = Counter(m["merged_at"][:10] for m in merged), Counter(commits)
        for i in range(WINDOW_DAYS):
            day = (since + dt.timedelta(days=i)).isoformat()
            activity.append({"day": day, "project": name, "merged_prs": mc.get(day, 0), "commits": cc.get(day, 0)})
        merges += merged
        top_people[name] = top_contributors(repo)

        snap = {"date": today, "project": name, "repo": repo,
                "stars": info["stargazers_count"], "forks": info["forks_count"]}
        if kind == "anyps5":
            prog = fetch_json(f"{ANYPS5_PAGES}/progress.json")
            lib, sh = prog["libraries"], prog["shaders"]
            inert = sum(len(g.get("inert_names", [])) for g in lib["groups"])
            snap.update(lib_done=lib["done"], lib_total=lib["total"], lib_percent=lib["percent"],
                        lib_inert=inert, shader_done=sh["done"], shader_total=sh["total"],
                        shader_percent=sh["percent"], hle_functions=lib["done"])
            libraries = sorted(({"library": g["label"], "done": g["done"], "todo": g["todo"],
                                 "total": g["done"] + g["todo"], "empty": len(g.get("inert_names", []))}
                                for g in lib["groups"]), key=lambda r: -r["todo"])
            roadmap = fetch_json(ANYPS5_ROADMAP)
            counts = anyps5_statuses(roadmap)
            snap.update(open_blockers=roadmap["stats"]["blockers_open"],
                        titles_reported=roadmap["stats"]["titles"] - 1)
        else:
            site = sync_clone(cache, meta["site"])
            if kind == "kyty":
                counts = kyty_statuses(fetch_json("https://kytyps5.github.io/data/compat-index.json"))
            else:
                counts = sharp_statuses(site)
            if catalog is None:
                catalog = len(json.loads((site / "src/data/games.json").read_text(encoding="utf-8")))
            snap["hle_functions"] = hle_functions(sync_clone(cache, repo, depth=1), kind)
        today_compat += compat_rows(today, name, counts)

        try:
            latest = gh_json(f"repos/{repo}/releases/latest")
        except subprocess.CalledProcessError:
            latest = {}
        snap.update(
            open_issues=search_count(f"repo:{repo}+is:issue+is:open"),
            open_prs=search_count(f"repo:{repo}+is:pr+is:open"),
            merged_prs_30d=len(merged), commits_30d=len(commits),
            contributors=len(contributors), contributors_30d=len(authors_30d), ai_commits_30d=ai_commits,
            issues_closed_30d=search_count(f"repo:{repo}+is:issue+is:closed+closed:>={since}"),
            games_tested=sum(counts.values()), games_top=counts.get(meta["top"], 0),
            top_tier=dict(meta["ladder"])[meta["top"]],
            latest_release=latest.get("tag_name", ""),
            latest_release_at=(latest.get("published_at") or "")[:10],
        )
        snaps.append(snap)
    for s in snaps:
        s["catalog"] = catalog

    sats = []
    for repo, role in SATELLITES:
        try:
            info = gh_json(f"repos/{repo}")
            n = len(gh_lines(f"repos/{repo}/commits?since={since}T00:00:00Z&per_page=100", ".[]|.sha"))
        except subprocess.CalledProcessError:
            continue
        sats.append({"repo": repo, "role": role, "stars": info["stargazers_count"],
                     "last_push": info["pushed_at"][:10], "commits_30d": n, "archived": info["archived"]})

    snapshots = upsert(snapshots, snaps, ["date", "project"])
    compat_hist = upsert(compat_hist, today_compat, ["date", "project", "rank"])
    cutoff = (now.date() - dt.timedelta(days=MERGE_LIST_DAYS - 1)).isoformat()
    save(hist / "snapshots.json", snapshots)
    save(hist / "compat_history.json", compat_hist)
    save(out / "snapshots.json", snapshots)
    save(out / "compat_history.json", compat_hist)
    save(out / "daily_activity.json", activity)
    save(out / "recent_merges.json",
         sorted((m for m in merges if m["merged_at"][:10] >= cutoff), key=lambda m: m["merged_at"], reverse=True))
    save(out / "anyps5_libraries.json", libraries)
    save(out / "satellites.json", sats)
    save(out / "top_contributors.json", {"date": today, "projects": top_people})
    save(out / "playable_games.json", playable_games(cache))
    save(out / "game_details.json", game_details(cache))
    save(out / "gta.json", gta_progress(cache))
    publish_to_web(work, out)
    print(json.dumps({"date": today, "snapshots": snaps}, indent=1))


def publish_to_web(work, out):
    """Copy the output files into the Angular site's public data folder, if the site is set up."""
    web_data = work / "web" / "public" / "data"
    if web_data.parent.exists():
        web_data.mkdir(parents=True, exist_ok=True)
        for f in out.glob("*.json"):
            (web_data / f.name).write_bytes(f.read_bytes())


if __name__ == "__main__":
    main()
