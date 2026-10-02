#!/usr/bin/env python3
"""Rests and XP claims between the Ref Screen and a player's Play page, on the test instance, in two headless Firefoxes.

  python3 ref/test/run_live_rest_test.py            options: --headed (show the browsers), --keep (keep what it made)

test_player opens a new crow on the Play page (hurt, an expertise use spent) and shares it; test_ref adds it to a new
campaign from the link. The Ref finishing a rest must do the whole rest on the player's sheet: a ration eaten, Stamina
full, a wound healed, expertise uses back, and the dungeon turn recorded, and the sheet's Rest card must say the crow
rested with the party. A crow that rested from its own sheet must be skipped by the Ref's next rest in that dungeon
turn (no second ration). In the campaign, the player's treasure becomes an XP claim: the Ref sees it on the Party tab,
uses it for an award, and the player gets the pending XP with the claim answered. Everything it made is deleted.

Logs in through server/test_instance.py (never typing a password into a browser). Needs Firefox and geckodriver,
like run_combat_test.py.
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "server"))
from run_combat_test import WebDriver  # noqa: E402
from run_live_combat_test import JS  # noqa: E402
import test_instance  # noqa: E402

JS = JS + r"""
function sheet() { var p = window.CrowsRef.state.party.filter(function (x) { return x.link; })[0]; return p ? window.CrowsRef.sheet(p.link) : null; }
function tile() { return q('#sec-status .st-tile.linked'); }
function rations(st) { return st.inv.filter(function (c) { return c.key === 'Ration' && c.area !== 'none'; }).reduce(function (t, c) { return t + c.qty; }, 0); }
"""

passed = 0


def ok(what):
    global passed
    passed += 1
    print("  ok", what, flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--keep", action="store_true")
    a = ap.parse_args()
    base = test_instance.BASE
    ref, pl = test_instance.Client.login("test_ref"), test_instance.Client.login("test_player")
    print("running on the test instance", base, flush=True)
    R = P = None
    camp = char = acc = None
    good = False
    try:
        R, P = WebDriver(a.headed), WebDriver(a.headed)

        def r(script, *args): return R.js(JS + script, *args)
        def p(script, *args): return P.js(JS + script, *args)
        def rwait(script, what, s=20): R.wait(JS + script, what, s)
        def pwait(script, what, s=20): P.wait(JS + script, what, s)

        for wd, c in ((R, ref), (P, pl)):
            wd.go(base)   # cookies can only be set for the page's own site
            for k in c.jar:
                wd.add_cookie({"name": k.name, "value": k.value, "path": k.path, "secure": bool(k.secure), "httpOnly": True, "sameSite": "Lax"})

        # The player's new crow: two wounds, 1 Stamina, an expertise use spent.
        P.go(base + "play?new=1")
        pwait("return !!(window.CrowsCloud && window.CrowsCloud.active)", "the Play page to load")
        p("window.CrowsCloud.saveNow();")
        pwait("return !!window.CrowsCloud.recordId", "the new crow to be saved")
        char = p("return window.CrowsCloud.recordId")
        exp = p("""var st = window.CrowsApp.state, C = window.CrowsApp.core, e = Object.keys(C.expertiseUses())[0];
                   st.play.wounds = { '8': 'w', '9': 'w' }; st.play.stamina = 1; st.play.spent = {}; st.play.spent[e] = 1;
                   C.save(); C.render(); return e;""")
        r0 = p("return rations(window.CrowsApp.state)")
        assert r0 >= 2, r0
        ok(f"player's crow (record {char}) is hurt: 2 wounds, 1 Stamina, a use of {exp} spent, {r0} rations")
        link = pl.post("share.create", {"id": char})["link"]

        # The Ref: a new campaign, the crow added from the link, its sheet loaded under Party status.
        R.go(base + "ref.php?new=1")
        rwait("return !!(window.CrowsCloud && window.CrowsCloud.recordId)", "the new campaign to be saved")
        camp = R.js("return window.CrowsCloud.recordId")
        r("button('Party', q('#tabbar')).click();")
        r("type(q('input[aria-label=\"Character link\"]'), arguments[0]); button('Add from link').click();", link)
        rwait("return window.CrowsRef.state.party.some(function (x) { return x.link; })", "the crow to join the party")
        acc = r("return window.CrowsRef.state.party[0].link")
        rwait("var c = sheet(); return !!(c && c.play.stamina === 1 && /1 \\/ /.test(text(q('.st-stam', tile()))))", "the crow's sheet under Party status")
        assert r("return !document.querySelector('iframe')")
        ok("Ref adds the crow from the link, and its sheet shows under Party status (no iframe)")

        # The party rests.
        dt = r("return window.CrowsRef.state.session.dt")
        r("button('Session', q('#tabbar')).click(); button('Start rest', q('#sec-rest')).click();")
        r("button('Finish rest', q('#sec-rest')).click();")
        pwait("var lr = window.CrowsApp.state.play.lastRest; return !!(lr && lr.by === 'ref')", "the Ref's rest on the player's sheet")
        st = p("""var st = window.CrowsApp.state, p = st.play;
                  return { rations: rations(st), wounds: Object.keys(p.wounds).length, stamina: p.stamina, spent: p.spent, dt: p.dt, card: text(q('#play-time')) };""")
        assert st["rations"] == r0 - 1, st
        ok("the Ref's rest ate one ration on the sheet")
        assert st["stamina"] is None and st["wounds"] == 1, st
        ok("...restored Stamina and healed a wound")
        assert st["spent"] == {}, st
        ok("...and gave back the spent expertise use")
        assert st["dt"] == dt, (st["dt"], dt)
        ok(f"the sheet records that the rest used up dungeon turn {dt}")
        assert "You rested with the party" in st["card"] and "Rest again" in st["card"], st["card"]
        ok("the Rest card says the crow rested with the party, instead of offering a second rest")

        # A crow that rests from its own sheet isn't rested again by the Ref in the same dungeon turn.
        p("button('Rest again', q('#play-time')).click();")
        r1 = p("return rations(window.CrowsApp.state)")
        assert r1 == r0 - 2, r1
        rwait("var c = sheet(), lr = c && c.play.lastRest; return !!(lr && lr.by === 'self')", "the player's own rest on the Ref's copy of the sheet")
        r("button('Start rest', q('#sec-rest')).click(); button('Finish rest', q('#sec-rest')).click();")
        pwait("return window.CrowsApp.state.play.log.some(function (e) { return /already rested from your sheet/.test(e.m); })", "the skipped rest in the sheet's log")
        assert p("return rations(window.CrowsApp.state)") == r1
        ok("after resting from their own sheet, the Ref's rest that dungeon turn is skipped (no second ration)")

        # XP claims: the page learns it's in a campaign when it opens.
        P.go(base + "play?id=" + str(char))
        pwait("return qa('#play-advance button').some(function (b) { return text(b) === 'Ask the Ref for XP'; })", "Play's Experience card in campaign mode")
        ok("in a campaign, Play's Experience card asks the Ref for XP instead of adding it")
        p("""var box = q('#play-advance'); type(q('input[placeholder=\"e.g. silver chalice\"]', box), 'Jade mask');
             var n = qa('input[type=number]', box); type(n[0], '400'); type(n[1], '1'); button('Ask the Ref for XP', box).click();""")
        assert p("return window.CrowsApp.state.play.pendingXP") == 0
        assert p("return window.CrowsApp.state.play.xpClaims.length") == 1
        r("button('Party', q('#tabbar')).click();")
        rwait("return /Jade mask/.test(text(q('#sec-xp')))", "the claim on the Ref's Experience card")
        assert "XP" in r("return text(qa('#tabbar button').filter(function (b) { return /Party/.test(text(b)); })[0])")
        ok("the claim shows on the Ref's Experience card, with a badge on the Party tab")
        r("var li = qa('#sec-xp .claims li')[0]; button('Use', li).click();")
        r("var g = q('#sec-xp select'); g.value = '0'; g.dispatchEvent(new Event('change')); button('Award as pending XP', q('#sec-xp')).click();")
        pwait("var p = window.CrowsApp.state.play; return p.pendingXP === 400 && !p.xpClaims.length", "the award on the player's sheet")
        ok("the Ref uses the claim for the award: the player gets 400 pending XP and the claim is answered")
        rwait("return !/Jade mask/.test(text(q('#sec-xp .claims')))", "the claim to leave the Ref's list")
        ok("the answered claim leaves the Ref's list")

        # A hit from the Party status tile lands on the player's sheet: the Ref Screen deals it on its copy and saves it.
        v0 = p("return window.CrowsPlay.vitals()")
        r("var t = tile(); type(q('input[type=number]', t), '2'); q('label.check input', t).click(); button('Deal damage', t).click();")
        assert "2 piercing damage on their sheet" in r("return text(q('#side-log'))")
        pwait("return window.CrowsPlay.vitals().st === " + str(max(0, v0["st"] - 2)), "the Ref's hit on the player's sheet", 15)
        assert p("return window.CrowsApp.state.play.log.some(function (e) { return /^Ref: Hit for 2 piercing/.test(e.m); })")
        ok("a hit dealt from the Party status tile (2 piercing) lands on the player's sheet, in its log, without an iframe")
        rwait("return !(window.CrowsRef.state.party[0].owed || []).length", "the Ref's change to be saved", 10)
        ok("...and the Ref Screen has nothing left waiting to save")
        good = True
    except Exception as e:
        print("FAILED:", e)
        for name, wd, script in (("player", P, "return [text(q('#toast')), JSON.stringify(window.CrowsApp.state.play.log.slice(0, 4))]"),
                                 ("Ref", R, "return [text(q('#toast')), JSON.stringify(window.CrowsRef.state.log.slice(-4))]")):
            try:
                print(f"  {name} page:", wd.js(JS + script))
            except Exception as e2:
                print(f"  ({name} page unreadable: {e2})")
    finally:
        for wd in (R, P):
            if wd:
                wd.quit()
        if not a.keep:
            if acc:
                ref.post("link.remove", {"id": acc})
            if camp:
                ref.post("delete", {"id": camp}, kind="campaigns")
            if char:
                pl.post("delete", {"id": char}, kind="characters")
            print("  deleted what the test made")
    print(f"live rest: {passed} checks passed" if good else "FAILED")
    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(main())
