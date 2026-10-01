#!/usr/bin/env python3
"""Live combat between the Ref Screen and a player's Play page, on the test instance, in two headless Firefoxes.

  python3 ref/test/run_live_combat_test.py            options: --headed (show the browsers), --keep (keep what it made)

test_player opens a new crow on the Play page and shares it; test_ref adds it to a new campaign from the link,
puts two Blood Creature A and the party in the combat tracker, and starts the fight. Then the player's page must
show the fight; the player targets the second creature and attacks (dice forced to a crit), the hit must land on
that creature in the Ref Screen and come back to the player as its feed and health. A described action and "done
for this round" must reach the Ref; with automatic hits off, a hit must wait for Apply, and Undo must put the
creature back. Ending the fight must take the Combat card off the player's page. Everything it made is deleted.

Logs in through server/test_instance.py (never typing a password into a browser). Needs Firefox and geckodriver,
like run_combat_test.py.
"""
import argparse, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "server"))
from run_combat_test import WebDriver  # noqa: E402
import test_instance  # noqa: E402

# Helpers put in front of every script run in a page.
JS = r"""
function q(s, r) { return (r || document).querySelector(s); }
function qa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function text(n) { return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; }
function button(label, root, exact) {
  var b = qa('button', root).filter(function (x) { return exact ? text(x) === label : text(x).indexOf(label) === 0; })[0];
  if (!b) throw new Error('no button "' + label + '"');
  return b;
}
function type(input, value) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }
function combat() { return window.CrowsRef.state.session.combat; }
function row(name) { return qa('#play-combat .cbt-row').filter(function (r) { return text(q('.cbt-who b', r)).indexOf(name) === 0; })[0]; }
"""

passed = 0


def ok(what):
    global passed
    passed += 1
    print("  ok", what)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--keep", action="store_true")
    a = ap.parse_args()
    base = test_instance.BASE
    ref, pl = test_instance.Client.login("test_ref"), test_instance.Client.login("test_player")
    print("running on the test instance", base)
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

        # The player's new crow, saved to the account, on the Play page.
        P.go(base + "play?new=1")
        pwait("return !!(window.CrowsCloud && window.CrowsCloud.active)", "the Play page to load")
        p("window.CrowsCloud.saveNow();")
        pwait("return !!window.CrowsCloud.recordId", "the new crow to be saved")
        char = p("return window.CrowsCloud.recordId")
        crow = p("return window.CrowsApp.state.name")
        ok(f"player's new crow {crow} is saved (record {char}) and Play is open")
        link = pl.post("share.create", {"id": char})["link"]

        # The Ref: a new campaign, the crow added from the link.
        R.go(base + "ref.php?new=1")
        rwait("return !!(window.CrowsCloud && window.CrowsCloud.recordId)", "the new campaign to be saved")
        camp = R.js("return window.CrowsCloud.recordId")
        r("button('Party', q('#tabbar')).click();")
        r("type(q('input[aria-label=\"Character link\"]'), arguments[0]); button('Add from link').click();", link)
        rwait("return window.CrowsRef.state.party.some(function (x) { return x.link; })", "the crow to join the party")
        acc = r("return window.CrowsRef.state.party[0].link")
        ok("Ref adds the crow to a new campaign from the player's link")

        # The fight: two Blood Creature A and the party, round 1.
        r("button('Session', q('#tabbar')).click();")
        r("""var box = q('#sec-combat'); var s = q('select[aria-label=Creature]', box); s.value = 'Blood Creature A'; s.dispatchEvent(new Event('change'));
             type(q('input[aria-label=\"How many\"]', box), '2'); button('Add', box, true).click();""")
        r("button('Add party', q('#sec-combat')).click();")
        r("button('Start combat + initiative', q('#sec-combat')).click();")
        rwait("return combat().round === 1 && combat().list.length === 3", "round 1 with three combatants")
        ok("Ref starts round 1 with two Blood Creature A and the crow")

        pwait("var b = q('#play-combat'); return b && !b.hidden && !!row('Blood Creature A 2');", "the Combat card on the Play page")
        names = p("return qa('#play-combat .cbt-row .cbt-who b').map(text)")
        assert names == ["Blood Creature A 1", "Blood Creature A 2", crow + " (you)"], names
        ok("player sees the fight: both creatures, and their crow marked as theirs")
        assert "unhurt" in p("return text(row('Blood Creature A 1'))") and "Stamina" not in p("return text(row('Blood Creature A 1'))")
        ok("foes show how hurt they look, not their Stamina")
        assert p("return /^Round\\s*1$/.test(text(q('#play-combat .cbt-head .vital')))")
        ok("the round shows on the player's page")

        # Target the second creature and attack (dice forced high: a crit).
        p("button('Target', row('Blood Creature A 2')).click();")
        pwait("return /Target ✓/.test(text(row('Blood Creature A 2')))", "the second creature to be the target", 5)
        assert "Blood Creature A 2" in p("var s = q('#cbt-target-bar select'); return s.options[s.selectedIndex].text")
        ok("player targets Blood Creature A 2 (the Attacks card's target follows)")

        def attack():
            # The page's own Math (a WebDriver script has its own globals).
            p("""var M = window.Math, rnd = M.random; M.random = function () { return 0.999; };
                 try { var atk = qa('#play-attacks .atk').filter(function (x) { return /Unarmed/.test(text(x)); })[0]; button('Attack', atk).click(); }
                 finally { M.random = rnd; }""")
            pwait("return !!q('.roll-result .cbt-sent')", "the roll to be sent to the Ref", 10)

        attack()
        sent = p("return text(q('.roll-result'))")
        assert "Sent to the Ref (target: Blood Creature A 2)" in sent, sent
        ok("the crit is sent to the Ref with its target")
        rwait("var a = combat().acts; return a.length === 1 && a[0].applied", "the hit to land in the Ref Screen")
        act = r("return combat().acts[0]")
        bc2 = r("return combat().list.filter(function (x) { return x.name === 'Blood Creature A 2'; })[0]")
        bc1 = r("return combat().list.filter(function (x) { return x.name === 'Blood Creature A 1'; })[0]")
        assert act["damage"] > 0 and act["tier"] == 3 and act["who"] == crow, act
        assert bc2["st"] + bc2["ad"] == max(0, bc2["stMax"] + bc2["adMax"] - act["damage"]) and bc1["st"] == bc1["stMax"], (bc2, bc1)
        ok(f"Ref Screen applies the {act['damage']} damage to Blood Creature A 2 only")
        assert crow in r("return text(q('#sec-combat .live-acts'))")
        ok("Ref sees the attack in the Players panel")
        pwait("return /takes \\d+ damage/.test(text(q('#play-combat .cbt-feed'))) && !/unhurt/.test(text(row('Blood Creature A 2')))",
              "the hit to show on the player's page")
        ok("player sees the hit in the feed and the creature's new health")

        # Words, and done for the round.
        p("type(q('#play-combat input[aria-label=\"Other action\"]'), 'I kick sand in its eyes'); button('Send', q('#cbt-act')).click();")
        rwait("return combat().acts.some(function (a) { return a.text === 'I kick sand in its eyes' && a.type === 'declare'; })", "the described action")
        ok("a described action reaches the Ref")
        p("button('Done for this round', q('#cbt-act')).click();")
        rwait("var me = combat().list.filter(function (x) { return x.kind === 'pc'; })[0]; return me.done === 1", "done for round 1")
        assert "done" in r("return text(qa('#sec-combat .cbt.pc')[0])")
        ok("'done for this round' shows on the crow's row in the Ref Screen")
        pwait("return /done/.test(text(row(arguments[0])))".replace("arguments[0]", repr(crow)), "the done mark on the player's page")
        ok("...and back on the player's page")

        # Automatic hits off: the next hit waits for Apply; Undo puts the creature back.
        r("var l = qa('#sec-combat label.check').filter(function (x) { return /automatically/.test(text(x)); })[0]; q('input', l).click();")
        assert r("return combat().auto") is False
        before = r("return combat().list.filter(function (x) { return x.name === 'Blood Creature A 1'; })[0]")
        p("button('Target', row('Blood Creature A 1')).click();")
        attack()
        rwait("return combat().acts.filter(function (a) { return a.type === 'attack'; }).length === 2", "the second hit")
        assert r("return combat().list.filter(function (x) { return x.name === 'Blood Creature A 1'; })[0].st") == before["st"]
        ok("with automatic hits off, the hit waits")
        r("button('Apply', q('#sec-combat .live-acts')).click();")
        after = r("return combat().list.filter(function (x) { return x.name === 'Blood Creature A 1'; })[0]")
        assert after["st"] < before["st"], after
        ok("Apply deals it")
        r("button('Undo', q('#sec-combat .live-acts')).click();")
        undone = r("return combat().list.filter(function (x) { return x.name === 'Blood Creature A 1'; })[0]")
        assert undone["st"] == before["st"] and undone["dead"] == before["dead"], undone
        ok("Undo puts the creature back")

        # The end.
        r("button('End combat', q('#sec-combat')).click();")
        pwait("return q('#play-combat').hidden", "the Combat card to go away")
        ok("ending the fight takes the Combat card off the player's page")
        good = True
    except Exception as e:
        print("FAILED:", e)
        for name, wd, script in (("player", P, "return [text(q('#toast')), text(q('.roll-result'))]"),
                                 ("Ref", R, "return [text(q('#toast')), JSON.stringify(combat().acts), combat().lastAct]")):
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
    print(f"live combat: {passed} checks passed" if good else "FAILED")
    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(main())
