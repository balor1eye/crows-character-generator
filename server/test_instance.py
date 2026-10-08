#!/usr/bin/env python3
"""Drives the test instance (https://joshuaramsey.com/crows-test/) as its seeded test accounts.

The accounts come from ~/crows-test-app/test-accounts.json on the server (made by seed_test.php), read over SSH,
so the ssh-agent must hold the site key. Logging in does the real two-step login: password, then a TOTP code
computed from the account's secret. Sessions are cached in ~/.cache/crows-test/ (chmod 600) and reused.

  python3 server/test_instance.py smoke                      run the end-to-end check of the whole API
  python3 server/test_instance.py call test_ref list kind=campaigns
  python3 server/test_instance.py call test_player create kind=characters '{"name": "Kestrel", "data": {}}'
  python3 server/test_instance.py mail                       the last emails the instance "sent" (mail.log)
  python3 server/test_instance.py reseed [--wipe]            new passwords/secrets for the test accounts

As a library: `from test_instance import Client; c = Client.login("test_ref"); c.get("list", kind="campaigns")`.
"""
import base64, hashlib, hmac, http.cookiejar, json, os, struct, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

BASE = os.environ.get("CROWS_TEST_URL", "https://joshuaramsey.com/crows-test/")
HOST = os.environ.get("CROWS_TEST_HOST", "joshuara@shared178.accountservergroup.com")
APP = "crows-test-app"
CACHE = os.path.expanduser("~/.cache/crows-test")
UA = "crows-test-client/1 (+server/test_instance.py)"   # the host's firewall turns away Python-urllib


def ssh(cmd):
    # One shared connection: the host's firewall blocks port 22 for a while after a burst of new SSH connections.
    os.makedirs(CACHE, mode=0o700, exist_ok=True)
    mux = ["-o", "ControlMaster=auto", "-o", f"ControlPath={CACHE}/ssh-%C", "-o", "ControlPersist=120"]
    return subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "LogLevel=ERROR", *mux, HOST, cmd],
                          check=True, capture_output=True, text=True).stdout


_accounts = None
def accounts():
    global _accounts
    if _accounts is None:
        _accounts = json.loads(ssh(f"cat ~/{APP}/test-accounts.json"))
    return _accounts


def totp(secret_b32, step):
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8))
    h = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    o = h[-1] & 15
    return "%06d" % ((struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 1000000)


class ApiError(Exception):
    def __init__(self, status, body):
        super().__init__(f"{status}: {body.get('error')}")
        self.status, self.body = status, body


class Client:
    """One browser-like session: a cookie jar plus the CSRF token. Client() alone is a logged-out visitor."""

    def __init__(self, name=None):
        self.name, self.csrf = name, None
        self.jar = http.cookiejar.LWPCookieJar()
        self.http = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def _req(self, method, action, body=None, **params):
        url = BASE + "api.php?" + urllib.parse.urlencode({"a": action, **params})
        data = None
        headers = {"Accept": "application/json", "User-Agent": UA}
        if method == "POST":
            data = json.dumps(body or {}).encode()
            headers["Content-Type"] = "application/json"
            if self.csrf:
                headers["X-CSRF-Token"] = self.csrf
        try:
            with self.http.open(urllib.request.Request(url, data, headers, method=method)) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                body = json.loads(raw or b"{}")
            except ValueError:
                body = {"error": raw[:200].decode("utf-8", "replace")}
            raise ApiError(e.code, body) from None

    def get(self, action, **params):
        return self._req("GET", action, **params)

    def post(self, action, body=None, **params):
        return self._req("POST", action, body, **params)

    def page(self, path=""):
        """Fetch a page (e.g. "ref.php") with this session's cookies: (status, final url, text)."""
        with self.http.open(urllib.request.Request(BASE + path, headers={"User-Agent": UA})) as r:
            return r.status, r.geturl(), r.read().decode("utf-8", "replace")

    # ---- login, with the session cached between runs
    def _cache_file(self):
        return os.path.join(CACHE, f"{self.name}.cookies")

    @classmethod
    def login(cls, name, fresh=False):
        c = cls(name)
        if not fresh and os.path.exists(c._cache_file()):
            c.jar.load(c._cache_file(), ignore_discard=True)
            me = c.get("me")
            if me["user"] and me["user"]["username"] == name:
                c.csrf = me["csrf"]
                return c
            c.jar.clear()
        acct = accounts()[name]
        r = c.post("login", {"login": name, "password": acct["password"]})
        tok = r["mfa"]["token"]
        step_file = os.path.join(CACHE, f"{name}.step")
        last = int(open(step_file).read()) if os.path.exists(step_file) else 0
        while int(time.time()) // 30 <= last:   # each TOTP step works once per account
            time.sleep(1)
        step = int(time.time()) // 30
        r = c.post("mfa.verify", {"token": tok, "code": totp(acct["totp"], step)})
        os.makedirs(CACHE, mode=0o700, exist_ok=True)
        with open(step_file, "w") as f:
            f.write(str(step))
        c.csrf = r["csrf"]
        c.jar.save(c._cache_file(), ignore_discard=True)
        os.chmod(c._cache_file(), 0o600)
        return c


def mail(n=10):
    out = ssh(f"tail -n {int(n)} ~/{APP}/mail.log 2>/dev/null || true")
    return [json.loads(l) for l in out.splitlines() if l.strip()]


# ------------------------------------------------------------------ the end-to-end check
def smoke():
    ok = 0
    def check(what, cond):
        nonlocal ok
        if not cond:
            raise AssertionError(what)
        ok += 1
        print("  ok", what)

    def fails(what, status, fn):
        try:
            fn()
        except ApiError as e:
            check(f"{what} -> {e.status}", e.status == status)
            return
        raise AssertionError(f"{what} should have failed with {status}")

    ssh(f"php ~/{APP}/seed_test.php --unthrottle")   # repeated runs would otherwise trip the site's rate limits
    anon = Client()
    check("logged out: me has no user", anon.get("me")["user"] is None)
    fails("logged out: list", 401, lambda: anon.get("list", kind="characters"))
    fails("wrong password", 401, lambda: anon.post("login", {"login": "test_player2", "password": "nope-nope-nope"}))
    st, url, _ = anon.page("ref.php")
    check("ref.php sends visitors to the login page", st == 200 and "ref.php" not in url)
    st, _, html = anon.page("play")
    check("/play serves the Character Generator", st == 200 and "<html" in html.lower())

    admin, ref, p1, p2 = (Client.login(n) for n in ("test_admin", "test_ref", "test_player", "test_player2"))
    check("all four test accounts logged in", all(c.csrf for c in (admin, ref, p1, p2)))
    forged = Client("test_player"); forged.jar, forged.http, forged.csrf = p1.jar, p1.http, "0" * 64
    fails("POST with a wrong CSRF token", 403, lambda: forged.post("create", {"name": "x", "data": {}}, kind="characters"))

    # characters
    ch = p1.post("create", {"name": "Smoke Kestrel", "summary": "smoke test", "data": {"name": "Smoke Kestrel", "notes": ""}},
                 kind="characters")["item"]
    check("player creates a character", ch["id"] > 0 and ch["version"] == 1)
    saved = p1.post("save", {"id": ch["id"], "version": 1, "name": "Smoke Kestrel", "summary": "saved",
                             "data": {"name": "Smoke Kestrel", "notes": "hi", "coins": 3}}, kind="characters")["item"]
    check("save bumps the version", saved["version"] == 2)
    fails("stale save conflicts", 409, lambda: p1.post("save", {"id": ch["id"], "version": 1, "name": "x",
                                                                 "data": {}}, kind="characters"))
    got = p1.get("get", kind="characters", id=ch["id"])["item"]
    check("get returns the saved data", got["data"]["notes"] == "hi")
    dup = p1.post("duplicate", {"id": ch["id"]}, kind="characters")["item"]
    check("duplicate", dup["id"] != ch["id"])
    p1.post("delete", {"id": dup["id"]}, kind="characters")
    check("list shows the character, not the deleted copy",
          {i["id"] for i in p1.get("list", kind="characters")["items"]} >= {ch["id"]} and
          dup["id"] not in {i["id"] for i in p1.get("list", kind="characters")["items"]})
    check("a crow made without the draft flag is not a draft", ch.get("draft") is False and got.get("draft") is False)
    dr = p1.post("create", {"name": "Smoke Draft", "summary": "", "draft": True, "data": {"name": "Smoke Draft"}}, kind="characters")["item"]
    check("a new crow can be saved as a draft", dr["draft"] is True)
    dr2 = p1.post("save", {"id": dr["id"], "version": dr["version"], "name": "Smoke Draft", "summary": "", "data": {"name": "Smoke Draft", "notes": "x"}},
                  kind="characters")["item"]
    check("saving keeps it a draft, and the list says so",
          dr2["draft"] is True and {i["id"]: i["draft"] for i in p1.get("list", kind="characters")["items"]}[dr["id"]] is True)
    dr3 = p1.post("save", {"id": dr["id"], "version": dr2["version"], "draft": False, "name": "Smoke Draft", "summary": "",
                           "data": {"name": "Smoke Draft", "notes": "x"}}, kind="characters")["item"]
    check("finishing the crow clears the draft flag", dr3["draft"] is False)
    p1.post("delete", {"id": dr["id"]}, kind="characters")
    fails("another player can't read it", 404, lambda: p2.get("get", kind="characters", id=ch["id"]))
    fails("players can't keep campaigns", 403, lambda: p1.get("list", kind="campaigns"))

    # sharing a character with a Ref
    link = p1.post("share.create", {"id": ch["id"]})["link"]
    tok = link.split("#share=")[1]
    check("share link points at the test instance", link.startswith(BASE))
    fails("players can't redeem share links", 403, lambda: p2.post("link.redeem", {"token": tok}))
    check("Ref previews the shared crow", ref.get("link.preview", token=tok)["name"] == "Smoke Kestrel")
    acc = ref.post("link.redeem", {"token": tok})["item"]
    check("Ref redeems the link", acc["owner"] == "test_player")
    cur = ref.get("link.get", id=acc["id"])["item"]
    ref.post("link.save", {"id": acc["id"], "fields": {"coins": 10}, "base": {"coins": cur["data"].get("coins")}})
    check("Ref's vitals change reaches the sheet", p1.get("get", kind="characters", id=ch["id"])["item"]["data"]["coins"] == 10)
    play = cur["data"].get("play") or {}
    ref.post("link.save", {"id": acc["id"], "fields": {"dt": 3, "spent": {}, "lastRest": {"dt": 3, "by": "ref", "t": 1}},
                           "base": {"dt": play.get("dt"), "spent": play.get("spent"), "lastRest": play.get("lastRest")}})
    check("Ref's rest reaches the sheet", p1.get("get", kind="characters", id=ch["id"])["item"]["data"]["play"]["lastRest"]["by"] == "ref")
    fails("Ref's rest fields are checked", 400, lambda: ref.post("link.save", {"id": acc["id"], "fields": {"lastRest": {"by": "someone"}},
                                                                              "base": {"lastRest": {"dt": 3, "by": "ref", "t": 1}}}))
    fails("Ref can't change other fields", 403, lambda: ref.post("link.save", {"id": acc["id"], "fields": {"name": "x"},
                                                                             "base": {"name": "Smoke Kestrel"}}))
    check("player sees the Ref has access", [r["username"] for r in p1.get("share.get", id=ch["id"])["refs"]] == ["test_ref"])

    # campaigns, invites and join requests
    camp = ref.post("create", {"name": "Smoke Campaign", "data": {"party": []}}, kind="campaigns")["item"]
    check("Ref creates a campaign", camp["id"] > 0)
    jtok = ref.post("invite.create", {"id": camp["id"]})["link"].split("#join=")[1]
    ch2 = p2.post("create", {"name": "Smoke Rook", "data": {"name": "Smoke Rook"}}, kind="characters")["item"]
    pv = p2.get("join.preview", token=jtok)
    check("player previews the invite", pv["campaign"] == "Smoke Campaign" and pv["ref"] == "test_ref")
    p2.post("join.request", {"token": jtok, "characterId": ch2["id"]})
    reqs = ref.get("invite.get", id=camp["id"])["requests"]
    check("Ref sees the join request", [r["name"] for r in reqs] == ["Smoke Rook"])
    ref.post("join.decline", {"id": reqs[0]["id"]})
    p2.post("join.request", {"token": jtok, "characterId": ch2["id"]})
    rid = ref.get("invite.get", id=camp["id"])["requests"][0]["id"]
    acc2 = ref.post("join.accept", {"id": rid})["item"]
    check("Ref accepts after a decline and re-ask", acc2["owner"] == "test_player2")
    notes = p2.get("notes.list")["items"]
    check("player is notified of both decisions", len(notes) >= 2)
    p2.post("notes.dismiss", {"all": True})
    check("notes dismissed", p2.get("notes.list")["items"] == [])
    check("characters.campaigns answers", "campaigns" in p2.get("characters.campaigns"))

    # listing a campaign in Find a campaign, and asking to join from there
    fails("an unlisted campaign can't be previewed by id", 404, lambda: p1.get("join.preview", campaign=camp["id"]))
    check("an unlisted campaign isn't found", all(c["id"] != camp["id"] for c in p1.get("campaigns.search", q="Smoke Campaign")["items"]))
    fails("players can't list campaigns", 403, lambda: p1.post("invite.list", {"id": camp["id"], "listed": True}))
    ref.post("invite.list", {"id": camp["id"], "listed": True, "note": "Smoke  note:\tThursdays"})
    inv = ref.get("invite.get", id=camp["id"])
    check("Ref sees the campaign listed, note tidied", inv["listed"] and inv["note"] == "Smoke note: Thursdays")
    found = [c for c in p1.get("campaigns.search", q="thursdays test_ref")["items"] if c["id"] == camp["id"]]
    check("player finds it by note and Ref", len(found) == 1 and found[0]["ref"] == "test_ref" and not found[0]["own"])
    check("a search with no match finds nothing", p1.get("campaigns.search", q="Smoke zzqqxx")["items"] == [])
    check("LIKE wildcards are literal", all(c["id"] != camp["id"] for c in p1.get("campaigns.search", q="Smoke_Campaign")["items"]))
    check("listed campaign previews by id", p1.get("join.preview", campaign=camp["id"])["campaign"] == "Smoke Campaign")
    p1.post("join.request", {"campaign": camp["id"], "characterId": ch["id"]})
    found = [c for c in p1.get("campaigns.search", q="Smoke Campaign")["items"] if c["id"] == camp["id"]]
    check("search shows the player's waiting request", found and found[0]["mine"] == "pending")
    lreq = [r for r in ref.get("invite.get", id=camp["id"])["requests"] if r["player"] == "test_player"]
    check("Ref sees the request made from the listing", len(lreq) == 1)
    ref.post("join.decline", {"id": lreq[0]["id"]})
    ref.post("invite.list", {"id": camp["id"], "listed": False})
    check("Ref unlists the campaign", not ref.get("invite.get", id=camp["id"])["listed"])
    fails("can't ask to join an unlisted campaign by id", 404, lambda: p1.post("join.request", {"campaign": camp["id"], "characterId": ch["id"]}))
    p1.post("notes.dismiss", {"all": True})
    check("decision emails were logged, not sent", any(m["to"] == accounts()["test_player2"]["email"] for m in mail(20)))

    # live combat: the Ref shares a fight; the linked crow's player sees it and acts in it
    mine = p1.get("combat.mine", id=ch["id"])
    check("no fight for the crow yet", mine["combat"] is None and mine.get("watch"))
    fight = {"active": True, "round": 1, "first": "crows", "feed": [], "list": [
        {"id": "f1", "kind": "foe", "name": "Smoke Rat 1", "health": "unhurt"},
        {"id": "c1", "kind": "pc", "name": "Smoke Kestrel", "link": acc["id"], "health": "unhurt"}]}
    pub = ref.post("combat.publish", {"campaign": camp["id"], "combat": fight, "members": [acc["id"], acc2["id"] + 999999]})
    check("Ref publishes a fight with one linked crow (unknown links ignored)", pub["members"] == 1 and "watch" in pub["actions"])
    fails("players can't publish fights", 403, lambda: p1.post("combat.publish", {"campaign": camp["id"], "combat": fight}))
    mine = p1.get("combat.mine", id=ch["id"])
    check("the crow's player sees the fight", mine["combat"]["list"][0]["name"] == "Smoke Rat 1"
          and mine["campaign"]["id"] == camp["id"] and mine["you"] == acc["id"])
    check("an unchanged fight answers 'unchanged'", p1.get("combat.mine", id=ch["id"], known=mine["version"]).get("unchanged"))
    fails("another player can't see the crow's fight", 404, lambda: p2.get("combat.mine", id=ch["id"]))
    check("a linked crow that isn't in the fight sees none", p2.get("combat.mine", id=ch2["id"])["combat"] is None)
    # Monster Expert: what only one crow knows reaches only that crow's player
    known = {"st": 7, "stMax": 10, "p": 2, "atk": ["Bite"], "traits": ["Pack"]}
    pub = ref.post("combat.publish", {"campaign": camp["id"], "combat": dict(fight, expert={str(acc["id"]): {"f1": known}, str(acc2["id"]): {"f1": dict(known, p=99)}}),
                                      "members": [acc["id"]]})
    check("the server says it keeps Monster Expert knowledge private", pub.get("expert") is True)
    mine = p1.get("combat.mine", id=ch["id"])["combat"]
    check("the crow's player gets only their own crow's Monster Expert knowledge", mine.get("expert") == {"f1": known})
    ref.post("combat.publish", {"campaign": camp["id"], "combat": dict(fight, expert={str(acc2["id"]): {"f1": known}}), "members": [acc["id"]]})
    check("...and none when only another crow knows", "expert" not in p1.get("combat.mine", id=ch["id"])["combat"])
    pub = ref.post("combat.publish", {"campaign": camp["id"], "combat": fight, "members": [acc["id"]]})
    p1.post("combat.act", {"id": ch["id"], "campaign": camp["id"], "action": {
        "type": "attack", "target": "f1", "targetName": "Smoke Rat 1", "label": "Attack with Dagger", "tier": 2, "damage": 4, "extra": "dropped"}})
    fails("a crow not in the fight can't act in it", 409, lambda: p2.post("combat.act", {"id": ch2["id"], "campaign": camp["id"], "action": {"type": "done"}}))
    fails("unknown kinds of action are refused", 400, lambda: p1.post("combat.act", {"id": ch["id"], "campaign": camp["id"], "action": {"type": "nuke"}}))
    acts = ref.get("combat.actions", campaign=camp["id"], after=pub["actions"]["latest"])
    a = acts["items"][-1] if acts["items"] else {}
    check("Ref receives the attack with its crow, target, tier, and damage", a.get("link") == acc["id"] and a["action"]["target"] == "f1"
          and a["action"]["tier"] == 2 and a["action"]["damage"] == 4 and "extra" not in a["action"] and acts["latest"] == a["id"])
    fails("players can't read the actions", 403, lambda: p1.get("combat.actions", campaign=camp["id"]))

    # handing a crow to another player (and the Ref) to play, and taking it back
    fails("can't hand a crow to yourself", 409, lambda: p1.post("control.give", {"id": ch["id"], "username": "test_player"}))
    fails("can't hand a crow to an unknown account", 404, lambda: p1.post("control.give", {"id": ch["id"], "username": "no_such_user_xyz"}))
    check("the hand-over panel suggests the Ref with access", p1.get("control.get", id=ch["id"])["refs"] == ["test_ref"])
    cv = ref.get("get", kind="campaigns", id=camp["id"])["item"]["version"]
    ref.post("save", {"id": camp["id"], "version": cv, "name": "Smoke Campaign", "data": {"party": [
        {"name": "Smoke Kestrel", "link": acc["id"]}, {"name": "Smoke Rook", "link": acc2["id"], "status": "away"},
        {"name": "Gone Crow", "link": acc2["id"] + 999999, "status": "retired"}]}}, kind="campaigns")
    check("in a campaign, the panel offers its Ref and the other players there",
          p1.get("control.get", id=ch["id"])["campaigns"] == [{"name": "Smoke Campaign", "ref": "test_ref", "players": ["test_player2"]}])
    p1.post("control.give", {"id": ch["id"], "username": "test_player2"})
    check("owner sees who has control", p1.get("control.get", id=ch["id"])["controller"]["username"] == "test_player2"
          and next(i for i in p1.get("list", kind="characters")["items"] if i["id"] == ch["id"])["controller"] == "test_player2")
    check("the other player is told", any(n["kind"] == "control_given" and n["detail"]["characterId"] == ch["id"] for n in p2.get("notes.list")["items"]))
    check("it's in their Handed to you list", [(i["id"], i["owner"]) for i in p2.get("control.list")["items"]] == [(ch["id"], "test_player")])
    held = p2.get("get", kind="characters", id=ch["id"])["item"]
    check("they open it, marked as the owner's", held["owner"] == "test_player" and held["data"]["name"] == "Smoke Kestrel")
    held = p2.post("save", {"id": ch["id"], "version": held["version"], "name": "Smoke Kestrel", "summary": "played by p2",
                            "data": dict(held["data"], notes="p2 was here")}, kind="characters")["item"]
    check("their save reaches the owner's sheet", p1.get("get", kind="characters", id=ch["id"])["item"]["data"]["notes"] == "p2 was here"
          and p1.get("get", kind="characters", id=ch["id"])["item"]["controller"] == "test_player2")
    fails("they can't share it", 404, lambda: p2.post("share.create", {"id": ch["id"]}))
    fails("they can't pass it on", 404, lambda: p2.post("control.give", {"id": ch["id"], "username": "test_ref"}))
    p2.post("delete", {"id": ch["id"]}, kind="characters")
    check("they can't delete it", p1.get("get", kind="characters", id=ch["id"])["item"]["id"] == ch["id"])
    check("they see its fight", p2.get("combat.mine", id=ch["id"])["you"] == acc["id"])
    act = p2.post("combat.act", {"id": ch["id"], "campaign": camp["id"], "action": {"type": "done"}})["id"]
    check("and act in it as the crow", ref.get("combat.actions", campaign=camp["id"], after=act - 1)["items"][0]["link"] == acc["id"])
    p1.post("control.take", {"id": ch["id"]})
    fails("after the owner takes it back they can't open it", 404, lambda: p2.get("get", kind="characters", id=ch["id"]))
    fails("or save it", 404, lambda: p2.post("save", {"id": ch["id"], "version": 0, "name": "x", "data": {}}, kind="characters"))
    fails("or act with it", 404, lambda: p2.post("combat.act", {"id": ch["id"], "campaign": camp["id"], "action": {"type": "done"}}))
    check("and are told", any(n["kind"] == "control_taken" for n in p2.get("notes.list")["items"]) and p2.get("control.list")["items"] == [])
    p1.post("control.give", {"id": ch["id"], "username": "test_ref"})
    check("the Ref can be handed it too", ref.get("get", kind="characters", id=ch["id"])["item"]["owner"] == "test_player")
    ref.post("control.release", {"id": ch["id"]})
    check("the Ref hands it back and the owner is told", p1.get("control.get", id=ch["id"])["controller"] is None
          and any(n["kind"] == "control_returned" and n["detail"]["by"] == "test_ref" for n in p1.get("notes.list")["items"]))
    # the Ref taking control of a crow in their campaign (here from the player it was handed to)
    fails("players can't take control through a Ref link", 403, lambda: p1.post("control.claim", {"id": acc["id"]}))
    p1.post("control.give", {"id": ch["id"], "username": "test_player2"})
    fails("the Ref can't take control until the player allows it", 403, lambda: ref.post("control.claim", {"id": acc["id"]}))
    fails("another player can't allow it for them", 404, lambda: p2.post("share.allowControl", {"accessId": acc["id"], "allow": True}))
    p1.post("share.allowControl", {"accessId": acc["id"], "allow": True})
    check("the player sees they allowed it", [r["canTakeControl"] for r in p1.get("share.get", id=ch["id"])["refs"]] == [True])
    got = ref.post("control.claim", {"id": acc["id"]})
    check("the Ref takes control of a crow in their campaign", got["characterId"] == ch["id"]
          and p1.get("control.get", id=ch["id"])["controller"]["username"] == "test_ref"
          and ref.get("get", kind="characters", id=ch["id"])["item"]["owner"] == "test_player")
    check("the player and the one it was handed to are told", all(any(n["kind"] == "control_claimed" and n["detail"]["by"] == "test_ref"
          and n["detail"]["campaign"] == "Smoke Campaign" for n in c.get("notes.list")["items"]) for c in (p1, p2)) and p2.get("control.list")["items"] == [])
    p1.post("control.take", {"id": ch["id"]})
    cv = ref.get("get", kind="campaigns", id=camp["id"])["item"]["version"]
    ref.post("save", {"id": camp["id"], "version": cv, "name": "Smoke Campaign", "data": {"party": [
        {"name": "Smoke Kestrel", "link": acc["id"], "status": "retired"}, {"name": "Smoke Rook", "link": acc2["id"]}]}}, kind="campaigns")
    fails("not once the crow has left play", 409, lambda: ref.post("control.claim", {"id": acc["id"]}))
    p1.post("share.allowControl", {"accessId": acc["id"], "allow": False})
    check("allowing it can be turned off", [r["canTakeControl"] for r in p1.get("share.get", id=ch["id"])["refs"]] == [False])
    p1.post("notes.dismiss", {"all": True}); p2.post("notes.dismiss", {"all": True})
    # the session (dungeon turn, timer, the party's rest) reaches the party's crows with no fight; a rest prompt takes rest choices
    sess = {"dt": 3, "running": True, "endAt": 1, "remain": None, "rooms": None, "greed": 20, "pending": True, "rest": {"active": True, "half": False, "chose": []}}
    pub = ref.post("combat.publish", {"campaign": camp["id"], "combat": {"active": False, "session": sess, "list": [{"id": "x"}]}, "members": [acc["id"], acc2["id"]]})
    mine2 = p2.get("combat.mine", id=ch2["id"])
    check("with no fight, the session reaches every linked crow", pub["members"] == 2 and mine2["combat"] == {"active": False, "session": sess}
          and mine2["you"] == acc2["id"])
    ra = p2.post("combat.act", {"id": ch2["id"], "campaign": camp["id"], "action": {"type": "rest", "food": "Hearty Ration", "activity": "repair",
                                                                                     "repair": "17", "tended": 1, "evil": "x"}})["id"]
    got = ref.get("combat.actions", campaign=camp["id"], after=ra - 1)["items"][0]
    check("a player sends rest choices while the party rests", got["link"] == acc2["id"] and got["action"]["food"] == "Hearty Ration"
          and got["action"]["activity"] == "repair" and got["action"]["repair"] == "17" and got["action"]["tended"] is True and "evil" not in got["action"])
    fails("only fight actions need a fight: none without one", 409, lambda: p2.post("combat.act", {"id": ch2["id"], "campaign": camp["id"], "action": {"type": "done"}}))
    ref.post("combat.publish", {"campaign": camp["id"], "combat": {"active": False, "session": dict(sess, rest={"active": False})}, "members": [acc["id"], acc2["id"]]})
    fails("no rest choices once the rest is over", 409, lambda: p2.post("combat.act", {"id": ch2["id"], "campaign": camp["id"], "action": {"type": "rest"}}))
    ref.post("combat.publish", {"campaign": camp["id"], "combat": None})
    check("ending the fight takes it off the player's page", p1.get("combat.mine", id=ch["id"])["combat"] is None)
    fails("acting after the fight is over", 409, lambda: p1.post("combat.act", {"id": ch["id"], "campaign": camp["id"], "action": {"type": "done"}}))

    # campaign chat
    cid = camp["id"]
    check("Ref and both players see the campaign's chat", all(any(c["id"] == cid for c in u.get("chat.campaigns")["campaigns"]) for u in (ref, p1, p2)))
    fails("someone outside the campaign can't read its chat", 404, lambda: admin.get("chat.list", campaign=cid))
    fails("or write in it", 404, lambda: admin.post("chat.send", {"campaign": cid, "text": "hi"}))
    check("the chat lists the players", {m["username"] for m in ref.get("chat.list", campaign=cid)["members"]} == {"test_player", "test_player2"})
    m1 = p1.post("chat.send", {"campaign": cid, "text": "Hello table"})["id"]
    check("everyone sees an open message", all(any(m["text"] == "Hello table" for m in u.get("chat.list", campaign=cid)["messages"]) for u in (ref, p2)))
    check("a player has no unread of their own message", [c for c in p1.get("chat.campaigns")["campaigns"] if c["id"] == cid][0]["unread"] == 0)
    check("others do", [c for c in p2.get("chat.campaigns")["campaigns"] if c["id"] == cid][0]["unread"] >= 1)
    p2.get("chat.list", campaign=cid, read=1)
    check("reading clears the unread count", [c for c in p2.get("chat.campaigns")["campaigns"] if c["id"] == cid][0]["unread"] == 0)
    fails("players can't announce", 403, lambda: p1.post("chat.send", {"campaign": cid, "kind": "announce", "text": "x"}))
    fails("empty messages are refused", 400, lambda: p1.post("chat.send", {"campaign": cid, "text": "   "}))
    pm = p1.post("chat.send", {"campaign": cid, "kind": "private", "text": "Secret for the Ref"})["id"]
    check("a player's private message reaches the Ref only", any(m["id"] == pm for m in ref.get("chat.list", campaign=cid)["messages"])
          and all(m["id"] != pm for m in p2.get("chat.list", campaign=cid)["messages"]))
    check("the Ref gets a notification of it", any(n["kind"] == "chat_private" and n["detail"]["from"] == "test_player" for n in ref.get("notes.list")["items"]))
    fails("the Ref must say which player", 400, lambda: ref.post("chat.send", {"campaign": cid, "kind": "private", "text": "x"}))
    rp = ref.post("chat.send", {"campaign": cid, "kind": "private", "to": "test_player2", "text": "Just for you"})["id"]
    check("the Ref's private message reaches that player only", any(m["id"] == rp for m in p2.get("chat.list", campaign=cid)["messages"])
          and all(m["id"] != rp for m in p1.get("chat.list", campaign=cid)["messages"]))
    an = ref.post("chat.send", {"campaign": cid, "kind": "announce", "text": "Session Friday", "email": True})
    check("an announcement goes to every player", an["players"] == 2)
    check("with a notification each", all(any(n["kind"] == "chat_announce" and n["detail"]["text"] == "Session Friday" for n in u.get("notes.list")["items"]) for u in (p1, p2)))
    check("and an email each", an["emailed"] == 2)
    p1.get("chat.list", campaign=cid, read=1)
    check("looking at the chat clears its notifications", not any(n["kind"].startswith("chat_") and n["detail"]["campaignId"] == cid for n in p1.get("notes.list")["items"]))
    check("only newer messages come back with after", [m["id"] for m in p1.get("chat.list", campaign=cid, after=an["id"] - 1)["messages"]] == [an["id"]])
    fails("players can't remove others' messages", 403, lambda: p2.post("chat.delete", {"id": m1}))
    p1.post("chat.delete", {"id": m1})
    ref.post("chat.delete", {"id": pm})
    check("the Ref and senders can remove messages", all(m["id"] not in (m1, pm) for m in ref.get("chat.list", campaign=cid)["messages"]))
    for pref in ("chatAlerts",):
        p2.post("account.setEmailPrefs", {pref: False})
    check("a player can turn chat emails off", p2.get("account.emailPrefs")["prefs"]["chatAlerts"] is False)
    check("and then isn't emailed", ref.post("chat.send", {"campaign": cid, "kind": "announce", "text": "Again", "email": True})["emailed"] == 1)
    p2.post("account.setEmailPrefs", {"chatAlerts": True})

    # page layouts (how each user arranged the blocks on a page)
    fails("logged out: no layouts", 401, lambda: anon.get("prefs.get"))
    lay = {"preset": "two", "cols": [["play-vitals", "summary"], ["play-attacks", "bad id!"]]}
    got = p1.post("prefs.save", {"page": "gen-play", "layout": lay})["prefs"]["layouts"]["gen-play"]
    check("a player saves a page layout (bad block ids dropped)", got == {"preset": "two", "cols": [["play-vitals", "summary"], ["play-attacks"]]})
    check("it comes back from prefs.get", p1.get("prefs.get")["prefs"]["layouts"]["gen-play"]["preset"] == "two")
    check("another user doesn't see it", "gen-play" not in (p2.get("prefs.get")["prefs"].get("layouts") or {}))
    fails("a malformed layout is refused", 400, lambda: p1.post("prefs.save", {"page": "gen-play", "layout": {"cols": "nope"}}))
    p1.post("prefs.save", {"page": "gen-play", "layout": None})
    check("a null layout resets the page", "gen-play" not in (p1.get("prefs.get")["prefs"].get("layouts") or {}))

    # account
    prefs = p1.get("account.emailPrefs")
    check("email prefs readable", isinstance(prefs, dict) and prefs["ok"])
    check("account.mfa shows the app method", p1.get("account.mfa").get("method") == "totp")

    # admin
    fails("non-admin can't list users", 403, lambda: ref.get("admin.users"))
    users = {u["username"]: u for u in admin.get("admin.users")["users"]}
    check("admin lists users", {"test_admin", "test_ref", "test_player", "test_player2"} <= set(users))
    admin.post("admin.setRole", {"id": users["test_player2"]["id"], "role": "ref"})
    check("admin makes a player a Ref", Client.login("test_player2").get("me")["user"]["canRef"])
    admin.post("admin.setRole", {"id": users["test_player2"]["id"], "role": "player"})
    check("admin audit log readable", len(admin.get("admin.audit")["events"]) > 0)
    st, url, html = ref.page("ref.php")
    check("ref.php serves the Ref Screen to a Ref", st == 200 and "ref.php" in url and len(html) > 100000)

    # forgot password: the reset email lands in mail.log
    anon.post("forgot", {"email": accounts()["test_player"]["email"]})
    reset = [m for m in mail(5) if m["subject"].startswith("Reset your password")]
    check("forgot-password email logged with a reset link", reset and BASE in reset[-1]["text"])

    # sign-up: the account is made only after the emailed code, and the answer never shows whether an email is in use
    stamp = str(int(time.time()))[-7:]
    new_name, new_email = "smoke_new" + stamp, "smoke-new-" + stamp + "@example.invalid"
    fails("sign-up refuses a taken username", 409, lambda: anon.post("register", {"username": "test_player", "email": new_email, "password": "Smoke-pass-" + stamp}))
    fresh = anon.post("register", {"username": new_name, "email": new_email, "password": "Smoke-pass-" + stamp})
    taken = Client().post("register", {"username": new_name + "x", "email": accounts()["test_player"]["email"], "password": "Smoke-pass-" + stamp})
    check("a new and a taken email get the same answer", set(fresh) == set(taken) and set(fresh["verify"]) == set(taken["verify"]))
    check("no account until the code is entered", new_name not in {u["username"] for u in admin.get("admin.users")["users"]})
    msgs = mail(10)
    code = next((m["text"].split("    ")[1][:6] for m in reversed(msgs) if m["to"] == new_email and m["subject"].startswith("Your code")), None)
    check("the new address gets a code; the taken one is told instead", code and any(m["to"] == accounts()["test_player"]["email"]
          and m["subject"].startswith("Someone tried to sign up") for m in msgs))
    fails("a wrong sign-up code is refused", 400, lambda: anon.post("register.verify", {"token": fresh["verify"]["token"], "code": "000000" if code != "000000" else "111111"}))
    fails("no code works for a taken email", 400, lambda: anon.post("register.verify", {"token": taken["verify"]["token"], "code": code}))
    done = anon.post("register.verify", {"token": fresh["verify"]["token"], "code": code})
    check("the right code makes the account and signs in (two-step login is optional)", "user" in done and "csrf" in done and "mfa" not in done)
    nu = next((u for u in admin.get("admin.users")["users"] if u["username"] == new_name), None)
    check("the new account exists", nu is not None)
    if nu: admin.post("admin.deleteUser", {"id": nu["id"]})

    # Ref pictures (maps and creature art kept in the account)
    import io
    from PIL import Image
    jpg = io.BytesIO(); Image.new("RGB", (40, 30), "#39c").save(jpg, "JPEG"); img64 = base64.b64encode(jpg.getvalue()).decode()
    th = "data:image/jpeg;base64," + img64
    ref.post("art.delete", {"key": "m:smoketest"})
    ref.post("art.save", {"key": "m:smoketest", "title": "Smoke map", "thumb": th, "image": img64})
    ref.post("art.save", {"key": "c:Smoke Wolf", "title": "Smoke Wolf", "thumb": th, "image": img64})
    lst = ref.get("art.list")["art"]
    check("a saved map and creature picture are listed", {"m:smoketest", "c:Smoke Wolf"} <= {a["key"] for a in lst})
    got = ref.http.open(urllib.request.Request(BASE + "api.php?" + urllib.parse.urlencode({"a": "art.file", "key": "m:smoketest"}), headers={"User-Agent": UA}))
    check("the image comes back as a JPEG", got.headers["Content-Type"] == "image/jpeg" and got.read()[:3] == b"\xff\xd8\xff")
    ref.post("art.save", {"key": "m:smoketest", "title": "Renamed", "thumb": th})
    check("a rename keeps the image", next(a for a in ref.get("art.list")["art"] if a["key"] == "m:smoketest")["title"] == "Renamed")
    fails("a player can't list pictures", 403, lambda: p1.get("art.list"))
    fails("a non-JPEG is refused", 400, lambda: ref.post("art.save", {"key": "m:smoketest2", "title": "x", "thumb": th, "image": base64.b64encode(b"not an image").decode()}))
    fails("a bad key is refused", 400, lambda: ref.post("art.save", {"key": "../x", "title": "x", "thumb": th, "image": img64}))
    try:
        p1.http.open(urllib.request.Request(BASE + "api.php?a=art.file&key=m:smoketest", headers={"User-Agent": UA})); other = 200
    except urllib.error.HTTPError as e:
        other = e.code
    check("another account can't fetch the image", other == 404)
    ref.post("art.delete", {"key": "m:smoketest"}); ref.post("art.delete", {"key": "c:Smoke Wolf"})
    check("deleted pictures are gone", not {"m:smoketest", "c:Smoke Wolf"} & {a["key"] for a in ref.get("art.list")["art"]})

    # the Ref's AI key vault (ciphertext only; the server never sees a key)
    b64 = lambda n: base64.b64encode(bytes(range(n))).decode()
    vault = {"v": 1, "kdf": "PBKDF2-SHA256", "iter": 600000, "salt": b64(16), "iv": b64(12), "ct": b64(40), "hint": "wxyz"}
    vjson = json.dumps(vault)
    ref.post("vault.delete")
    check("a Ref with no vault gets null", ref.get("vault.get")["vault"] is None)
    ref.post("vault.save", {"vault": vjson})
    check("a saved vault comes back unchanged", ref.get("vault.get")["vault"] == vjson)
    fails("a player can't read a vault", 403, lambda: p1.get("vault.get"))
    fails("a player can't save a vault", 403, lambda: p1.post("vault.save", {"vault": vjson}))
    fails("a vault with an extra key is refused", 400, lambda: ref.post("vault.save", {"vault": json.dumps({**vault, "key": "sk-x"})}))
    fails("a vault with too few iterations is refused", 400, lambda: ref.post("vault.save", {"vault": json.dumps({**vault, "iter": 1000})}))
    fails("a vault with a bad iv is refused", 400, lambda: ref.post("vault.save", {"vault": json.dumps({**vault, "iv": b64(8)})}))
    fails("a vault that isn't JSON is refused", 400, lambda: ref.post("vault.save", {"vault": "sk-ant-nope"}))
    fails("a vault over 8 KB is refused", 400, lambda: ref.post("vault.save", {"vault": json.dumps({**vault, "ct": "A" * 9000})}))
    check("a refused save leaves the vault alone", ref.get("vault.get")["vault"] == vjson)
    check("the vault is not in the admin audit log", "wxyz" not in json.dumps(admin.get("admin.audit")) and b64(40) not in json.dumps(admin.get("admin.users")))
    ref.post("vault.delete")
    check("a deleted vault is gone", ref.get("vault.get")["vault"] is None)

    # clean up what this run made
    ref.post("link.remove", {"id": acc["id"]}); ref.post("link.remove", {"id": acc2["id"]})
    ref.post("delete", {"id": camp["id"]}, kind="campaigns")
    p1.post("delete", {"id": ch["id"]}, kind="characters"); p2.post("delete", {"id": ch2["id"]}, kind="characters")
    print(f"smoke: {ok} checks passed")


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__); return
    cmd, rest = argv[0], argv[1:]
    if cmd == "smoke":
        smoke()
    elif cmd == "call":
        name, action, *more = rest
        params = dict(a.split("=", 1) for a in more if "=" in a and not a.startswith("{"))
        body = next((json.loads(a) for a in more if a.startswith("{")), None)
        c = Client.login(name) if name != "anon" else Client()
        try:
            out = c.post(action, body, **params) if body is not None else c.get(action, **params)
        except ApiError as e:
            out = {"status": e.status, **e.body}
        print(json.dumps(out, indent=2))
    elif cmd == "mail":
        for m in mail(int(rest[0]) if rest else 10):
            print(f"--- {m['at']}  to {m['to']}\n{m['subject']}\n\n{m['text']}")
    elif cmd == "reseed":
        print(ssh(f"php ~/{APP}/seed_test.php {' '.join(a for a in rest if a == '--wipe')}"), end="")
        for f in os.listdir(CACHE) if os.path.isdir(CACHE) else []:
            if f.endswith(".cookies"):
                os.remove(os.path.join(CACHE, f))
    else:
        sys.exit(f"unknown command {cmd!r}; see --help")


if __name__ == "__main__":
    main(sys.argv[1:])
