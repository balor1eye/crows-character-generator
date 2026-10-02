#!/usr/bin/env python3
"""The accounts portal's Crows list and Home page on the test instance, as test_player, in headless Firefox.

  python3 -u ref/test/run_portal_test.py      options: --headed

Makes a draft crow and a finished one through the API, then checks the status chips, the main button for each, the More
menu, that #play is an alias of #characters, and that Home shows Your crows. Deletes what it made. See ref/test/README.md.
"""
import argparse, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "server"))
from run_combat_test import WebDriver  # noqa: E402
import test_instance  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--headed", action="store_true")
    a = ap.parse_args()
    pl = test_instance.Client.login("test_player")
    base = test_instance.BASE
    made = []
    for name, draft in (("Portal Test Draft", True), ("Portal Test Ready", False)):
        j = pl.post("create", {"data": {"name": name}, "name": name, "summary": "portal test", "draft": draft}, kind="characters")
        made.append(j["item"]["id"])
    wd = WebDriver(headed=a.headed)
    good = True
    total = 0

    def check(what, ok):
        nonlocal good, total
        total += 1
        good = good and bool(ok)
        print("  " + ("ok" if ok else "FAILED"), what)

    try:
        wd.go(base)
        for k in pl.jar:
            wd.add_cookie({"name": k.name, "value": k.value, "path": k.path, "secure": bool(k.secure), "httpOnly": True, "sameSite": "Lax"})
        row = """var li = Array.prototype.filter.call(document.querySelectorAll('.rows li'), function (l) {
            return l.textContent.indexOf(NAME) >= 0; })[0];"""
        for page in ("#characters", "#play"):
            wd.go(base + page)
            wd.js("location.reload()")
            wd.wait("return !!document.querySelector('.rows .name')", "the list to load")
            check(page + " shows the Crows list", wd.js("return document.querySelector('h1').textContent === 'Crows'"))
            for name, chip, main in (("Portal Test Draft", "Draft", "Continue building"), ("Portal Test Ready", "Ready", "Play")):
                r = wd.js(row.replace("NAME", repr(name)) + """return li ? { chip: !!li.querySelector('.camp-chip b') && li.querySelector('.camp-chip b').textContent,
                    main: li.querySelector('.btns > a').textContent, more: Array.prototype.map.call(li.querySelectorAll('.more-menu .btn'),
                    function (b) { return b.textContent; }) } : null;""")
                check(f"{page}: {name} has the {chip} chip and main button {main!r}", r and r["chip"] == chip and r["main"] == main)
                if page == "#characters" and r:
                    want = ["Share", "Delegate Control", "Download", "Copy", "Delete"] + (["Edit", "Play"] if chip == "Ready" else [])
                    check(f"{name}'s More menu has the other buttons", sorted(want) == sorted(r["more"]))
        wd.go(base + "#home")
        wd.js("location.reload()")
        wd.wait("return !!document.querySelector('.rows .name')", "Home's crows")
        check("Home has Your crows with the new ones", wd.js("return document.body.textContent.indexOf('Your crows') >= 0 && document.body.textContent.indexOf('Portal Test') >= 0"))
        check("Home has no leftover My characters/Play tiles", wd.js("return !document.querySelector('.tile[href=\"#play\"]') && !document.querySelector('.tile[href=\"#characters\"]')"))
        check("Home keeps Find a campaign", wd.js("return !!document.querySelector('.tile[href=\"#find\"]')"))
    finally:
        wd.quit()
        for i in made:
            pl.post("delete", {"id": i}, kind="characters")
    print(f"portal: {total} checks passed" if good else "FAILED")
    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(main())
