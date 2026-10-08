#!/usr/bin/env python3
"""Runs the wall-editing test (ref/test/vtt_walls_test.js) on the local build, in headless Firefox.

  python3 ref/test/run_vtt_walls_test.py            options: --headed (show the browser)

Drags, joins, deletes and right-clicks walls on the Tabletop with the Select tool (no accounts or server needed). See ref/test/README.md.
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from run_combat_test import WebDriver, serve_dist  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--headed", action="store_true")
    a = ap.parse_args()
    if not os.path.exists(os.path.join(ROOT, "dist", "Crows_Ref_Screen.html")):
        sys.exit("dist/Crows_Ref_Screen.html is missing: run python3 ref/build/build.py first")
    base = serve_dist()
    wd = WebDriver(headed=a.headed)
    try:
        wd.go(base + "Crows_Ref_Screen.html")
        wd.wait("return document.querySelectorAll('#tabbar button').length > 0", "the Ref Screen to load")
        res = wd.js_async(open(os.path.join(HERE, "vtt_walls_test.js"), encoding="utf-8").read())
    finally:
        wd.quit()
    for s in res.get("steps", []):
        print("  ok", s)
    if not res.get("ok"):
        print("FAILED:", res.get("error"))
        return 1
    print(f"wall editing: {len(res['steps'])} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
