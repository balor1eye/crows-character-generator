#!/usr/bin/env python3
"""Rearranging pages (src/layout.js) in both local builds, in headless Firefox.

  python3 ref/test/run_layout_test.py                    the built dist/ files, offline (saved in the browser)
  python3 ref/test/run_layout_test.py --test-instance    also: test_player's arrangement saves to the account
  options: --headed (show the browser)

Drags blocks with pointer events, checks the page during and after each drag, reloads, and checks the arrangement
stayed. On the test instance it logs in as test_player (through server/test_instance.py), rearranges Play, and
checks prefs.get, then resets it. See ref/test/README.md.
"""
import argparse, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from run_combat_test import WebDriver, serve_dist  # noqa: E402

SCRIPT = open(os.path.join(HERE, "layout_test.js"), encoding="utf-8").read()


def run(wd, step):
    res = wd.js_async(SCRIPT, step)
    for s in res.get("steps", []):
        print("  ok", s)
    if not res.get("ok"):
        print("FAILED:", res.get("error"))
    return len(res.get("steps", [])) if res.get("ok") else None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--test-instance", action="store_true")
    ap.add_argument("--headed", action="store_true")
    a = ap.parse_args()
    base = serve_dist()
    total, good = 0, True
    wd = WebDriver(headed=a.headed)
    try:
        wd._call("POST", f"/session/{wd.sid}/window/rect", {"width": 1400, "height": 1000})
        for page, steps in (("Crows_Character_Generator.html", ("gen", "gen-after-reload")), ("Crows_Ref_Screen.html", ("ref", "ref-after-reload"))):
            print(page)
            for st in steps:
                wd.go(base + page)
                wd.wait("return !!document.querySelector('.lay-btn') && document.querySelectorAll('main.layout > .lay-col').length > 0", "the page to load")
                n = run(wd, st)
                if n is None:
                    good = False
                    break
                total += n
            if not good:
                break
            if page == "Crows_Character_Generator.html":
                # The Play sub-tab choice (src/play.js SUBTAB_KEY) is its own localStorage key, independent of the block layout.
                wd.js("document.getElementById('btn-mode').click();")
                wd.wait("return !!document.querySelector('#play-subtabs button')", "Play's sub-tabs to render")
                wd.js("""Array.prototype.filter.call(document.querySelectorAll('#play-subtabs button'), function (b) {
                    return b.textContent.trim() === 'Growth'; })[0].click();""")
                wd.wait("return document.body.getAttribute('data-subtab') === 'growth'", "the Growth sub-tab to activate")
                wd.go(base + page)
                wd.wait("return document.body.getAttribute('data-mode') === 'play'", "Play mode after reload")
                ok = wd.js("return document.body.getAttribute('data-subtab') === 'growth'")
                print("  " + ("ok" if ok else "FAILED"), "the sub-tab choice survives a reload")
                total += 1
                good = good and ok
        if good and a.test_instance:
            sys.path.insert(0, os.path.join(ROOT, "server"))
            import test_instance
            pl = test_instance.Client.login("test_player")
            base = test_instance.BASE
            print("test instance, as test_player")
            pl.post("prefs.save", {"page": "gen-play-now", "layout": None})
            wd.go(base)
            for k in pl.jar:
                wd.add_cookie({"name": k.name, "value": k.value, "path": k.path, "secure": bool(k.secure), "httpOnly": True, "sameSite": "Lax"})
            wd.go(base + "play?new=1")
            wd.wait("return !!(window.CrowsCloud && window.CrowsCloud.active) && !!document.querySelector('.lay-btn')", "Play to load")
            time.sleep(1)
            wd.js("""var b = document.querySelector('.lay-btn'); b.click();
                     var v = document.getElementById('play-vitals'); v.focus();
                     v.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
                     document.querySelector('.lay-lock').click();""")
            time.sleep(2)
            got = pl.get("prefs.get")["prefs"].get("layouts", {}).get("gen-play-now")
            ok = bool(got) and "play-vitals" in got["cols"][1]
            print("  " + ("ok" if ok else "FAILED"), "moving Vitals to the sidebar column on Play saves it to test_player's account")
            total += ok
            good = ok
            if ok:
                wd.go(base + "play")
                wd.wait("return !!(window.CrowsCloud && window.CrowsCloud.active)", "Play to reload")
                wd.js("localStorage.removeItem('crows-layouts')")
                wd.go(base + "play")
                wd.wait("return !!(window.CrowsCloud && window.CrowsCloud.active) && document.getElementById('play-vitals').parentNode.getAttribute('data-col') === '1'", "the account's arrangement", 15)
                print("  ok with this browser's copy cleared, Play comes back arranged from the account")
                total += 1
            pl.post("prefs.save", {"page": "gen-play-now", "layout": None})
            print("  reset test_player's Play arrangement")
    finally:
        wd.quit()
    print(f"layout: {total} checks passed" if good else "FAILED")
    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(main())
