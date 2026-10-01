#!/usr/bin/env python3
"""Runs the full combat encounter test (ref/test/combat_encounter.js) in headless Firefox.

  python3 ref/test/run_combat_test.py                   the built dist/Crows_Ref_Screen.html, served locally
  python3 ref/test/run_combat_test.py --test-instance   the Ref Screen on https://joshuaramsey.com/crows-test/ as test_ref
  options: --seed N (dice seed, default 1), --headed (show the browser), --keep (test instance: keep the campaign)

Needs only Python 3 and Firefox with geckodriver (the Ubuntu Firefox snap includes both): WebDriver is spoken
over plain HTTP, so there's nothing to pip install. See ref/test/README.md.

Locally, the page runs in a fresh browser profile, so it starts from an empty campaign and saves only to that
profile. On the test instance it logs in through server/test_instance.py (never typing a password into the
browser), opens a new campaign (ref.php?new=1), and after the run checks the campaign record the page saved
to the server through the API, then deletes it.
"""
import argparse, functools, http.server, json, os, shutil, socket, subprocess, sys, threading, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SCENARIO = os.path.join(HERE, "combat_encounter.js")


class WebDriver:
    """Just enough of the W3C WebDriver protocol, over urllib."""

    def __init__(self, headed=False):
        exe = shutil.which("geckodriver") or shutil.which("firefox.geckodriver")
        if not exe:
            sys.exit("geckodriver not found (it comes with the Firefox snap, or install it from Mozilla)")
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        self.proc = subprocess.Popen([exe, "--port", str(self.port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        args = [] if headed else ["-headless"]
        for _ in range(100):
            try:
                caps = {"capabilities": {"alwaysMatch": {"moz:firefoxOptions": {"args": args}}}}
                self.sid = self._call("POST", "/session", caps)["sessionId"]
                break
            except (urllib.error.URLError, ConnectionError):
                time.sleep(0.1)
        else:
            self.proc.kill()
            sys.exit("geckodriver did not start")
        self._call("POST", f"/session/{self.sid}/timeouts", {"script": 120000, "pageLoad": 60000})

    def _call(self, method, path, body=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read())["value"]
        except urllib.error.HTTPError as e:
            v = json.loads(e.read() or b"{}").get("value", {})
            raise RuntimeError(f"WebDriver {path}: {v.get('error')}: {v.get('message')}") from None

    def go(self, url):
        self._call("POST", f"/session/{self.sid}/url", {"url": url})

    def js(self, script, *args):
        return self._call("POST", f"/session/{self.sid}/execute/sync", {"script": script, "args": list(args)})

    def js_async(self, script, *args):
        return self._call("POST", f"/session/{self.sid}/execute/async", {"script": script, "args": list(args)})

    def add_cookie(self, cookie):
        self._call("POST", f"/session/{self.sid}/cookie", {"cookie": cookie})

    def wait(self, script, what, seconds=30):
        end = time.time() + seconds
        while time.time() < end:
            if self.js(script):
                return
            time.sleep(0.2)
        raise RuntimeError("timed out waiting for " + what)

    def quit(self):
        try:
            self._call("DELETE", f"/session/{self.sid}")
        except Exception:
            pass
        try:
            self.proc.terminate()
        except PermissionError:
            # A snap's confinement only takes signals from inside the snap.
            subprocess.run(["snap", "run", "--shell", "firefox", "-c", f"kill {self.proc.pid}"], capture_output=True)
        try:
            self.proc.wait(10)
        except subprocess.TimeoutExpired:
            print("  note: geckodriver (pid %d) is still running" % self.proc.pid)


def serve_dist():
    """Serve dist/ on a free localhost port; returns the base URL."""
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(ROOT, "dist"))
    handler.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{srv.server_address[1]}/"


def report(res):
    for s in res.get("steps", []):
        print("  ok", s)
    if not res.get("ok"):
        print("FAILED:", res.get("error"))
        if res.get("confirms"):
            print("  confirmations asked:", res["confirms"])
        return False
    print(f"combat encounter: {len(res['steps'])} checks passed")
    return True


def check_server_record(ref, rec_id, local):
    """The campaign the page autosaved must match what the page holds."""
    item = ref.get("get", kind="campaigns", id=rec_id)["item"]
    data = item["data"]
    enc = data["encounters"][0]
    checks = [
        ("the server has the campaign under its name", item["name"] == local["name"]),
        ("the server copy has the four crows", [p["name"] for p in data["party"]] == ["Ash", "Briar", "Corvin", "Dove"]),
        ("the server copy has the resolved encounter and its summary", enc["done"] and enc["outcome"] == "The crows won"
         and enc["notes"] == local["encounters"][0]["notes"]),
        ("the server copy has each crow's 100 pending XP", all(p["pending"] == 100 for p in data["party"])),
        ("the server copy has Dove's wounds", [p for p in data["party"] if p["name"] == "Dove"][0]["wounds"] == 2),
        ("the server copy has the cleared tracker", data["session"]["combat"]["list"] == [] and data["session"]["combat"]["encId"] is None),
    ]
    for what, good in checks:
        print("  " + ("ok" if good else "FAILED"), what)
    return all(good for _, good in checks)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--test-instance", action="store_true", help="run against https://joshuaramsey.com/crows-test/ as test_ref")
    ap.add_argument("--seed", type=int, default=1, help="dice seed (default 1)")
    ap.add_argument("--headed", action="store_true", help="show the browser window")
    ap.add_argument("--keep", action="store_true", help="test instance: don't delete the campaign afterwards")
    a = ap.parse_args()
    scenario = open(SCENARIO, encoding="utf-8").read()

    ref = None
    if a.test_instance:
        sys.path.insert(0, os.path.join(ROOT, "server"))
        import test_instance
        ref = test_instance.Client.login("test_ref")
        base = test_instance.BASE
        print("running on the test instance", base, "as test_ref, dice seed", a.seed)
    else:
        if not os.path.exists(os.path.join(ROOT, "dist", "Crows_Ref_Screen.html")):
            sys.exit("dist/Crows_Ref_Screen.html is missing: run python3 ref/build/build.py first")
        base = serve_dist()
        print("running on the local build (dist/Crows_Ref_Screen.html), dice seed", a.seed)

    wd = WebDriver(headed=a.headed)
    rec_id, good = None, False
    try:
        if ref:
            wd.go(base)   # cookies can only be set for the page's own site
            for c in ref.jar:
                wd.add_cookie({"name": c.name, "value": c.value, "path": c.path, "secure": bool(c.secure), "httpOnly": True, "sameSite": "Lax"})
            wd.go(base + "ref.php?new=1")
            wd.wait("return !!(window.CrowsCloud && window.CrowsCloud.recordId)", "the new campaign to be saved to the account")
            rec_id = wd.js("return window.CrowsCloud.recordId")
            print("  new campaign record", rec_id)
        else:
            wd.go(base + "Crows_Ref_Screen.html")
            wd.wait("return document.querySelectorAll('#tabbar button').length > 0", "the Ref Screen to load")
        res = wd.js_async(scenario, a.seed)
        good = report(res)
        if good:
            # The campaign survives a reload (browser copy, or the account copy on the server).
            if ref:
                time.sleep(2.5)   # autosave sends changes within 1.5 s
                wd.go(base + f"ref.php?id={rec_id}")
                wd.wait("return !!(window.CrowsCloud && window.CrowsCloud.active)", "the campaign to reload from the account")
            else:
                wd.go(base + "Crows_Ref_Screen.html")
                wd.wait("return document.querySelectorAll('#tabbar button').length > 0", "the Ref Screen to reload")
            after = wd.js("return JSON.parse(localStorage.getItem('crows-pt2-ref-campaign'))")
            same = after["encounters"][0]["notes"] == res["campaign"]["encounters"][0]["notes"] and len(after["party"]) == 4
            print("  " + ("ok" if same else "FAILED"), "the campaign is the same after reloading the page")
            good = same and (check_server_record(ref, rec_id, res["campaign"]) if ref else True)
    finally:
        wd.quit()
        if ref and rec_id and not a.keep:
            ref.post("delete", {"id": rec_id}, kind="campaigns")
            print("  deleted test campaign", rec_id)
    print("PASSED" if good else "FAILED")
    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(main())
