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
function cbt(name) { return qa('#sec-combat .cbt').filter(function (r) { var i = q('.cbt-name input', r); return i && i.value === name; })[0]; }
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
        p("""var st = window.CrowsApp.state; st.inv = [{ id: 9001, key: 'Sword', qty: 1, area: 'hand', idx: 0 }, { id: 9002, key: 'Light Armor', qty: 1, area: 'pack', idx: 0 }];
             window.CrowsApp.core.save(); window.CrowsApp.core.render();""")
        assert p("return window.CrowsPlay.vitals().ad") == 9
        ok("the crow carries a sword (Parry 4) and wears light armor (AD 5)")
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
        rwait("var x = combat().list.filter(function (x) { return x.kind === 'pc'; })[0]; return x.ad === 9 && x.adMax === 9", "the crow's AD from its sheet", 10)
        ok("the tracker takes the crow's AD (9) from its own sheet: armor and parry weapon")

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
        p("button('Done for this round', q('#play-combat')).click();")
        rwait("var me = combat().list.filter(function (x) { return x.kind === 'pc'; })[0]; return me.done === 1", "done for round 1")
        assert "done" in r("return text(qa('#sec-combat .cbt.pc')[0])")
        ok("'done for this round' shows on the crow's row in the Ref Screen")
        pwait("return /done/.test(text(row(arguments[0])))".replace("arguments[0]", repr(crow)), "the done mark on the player's page")
        ok("...and back on the player's page")

        # Automatic hits off: the next hit waits for Apply; Undo puts the creature back.
        r("var l = qa('#sec-combat label.check').filter(function (x) { return /Apply their actions automatically/.test(text(x)); })[0]; q('input', l).click();")
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
        r("var l = qa('#sec-combat label.check').filter(function (x) { return /Apply their actions automatically/.test(text(x)); })[0]; q('input', l).click();")
        assert r("return combat().auto") is True

        # A creature attacks the crow it targets: the hit lands on the crow, the player sees it coming, Undo takes it back.
        crow_id = r("return combat().list.filter(function (x) { return x.kind === 'pc'; })[0].id")
        r("""var row = cbt('Blood Creature A 1'), s = q('.tgt-pick select', row); s.value = arguments[0]; s.dispatchEvent(new Event('change'));""", crow_id)
        assert r("return combat().list.filter(function (x) { return x.name === 'Blood Creature A 1'; })[0].tgt") == crow_id
        ok("Ref picks the crow as Blood Creature A 1's target")
        pwait("return /attacking you/.test(text(row('Blood Creature A 1')))", "the player to see who it's attacking")
        ok("the player sees Blood Creature A 1 is attacking them")
        hp = "var x = combat().list.filter(function (x) { return x.kind === 'pc'; })[0]; return x.st + x.ad;"
        hp0 = r(hp)
        r("""var M = window.Math, rnd = M.random; M.random = function () { return 0.999; };
             try { button('Claws', cbt('Blood Creature A 1')).click(); } finally { M.random = rnd; }""")
        assert "→ " + crow in r("return text(q('#side-dice .result'))")
        assert r(hp) == hp0 - 3, (hp0, r(hp))
        ok("its crit (Claws, 3 damage) lands on the crow automatically")
        pwait("return window.CrowsPlay.vitals().ad === 6", "the hit on the player's own sheet", 10)
        ok("...through the crow's own armor on the player's sheet (AD 9 -> 6)")
        assert crow in p("return text(q('#play-combat .cbt-feed'))")
        r("button('Undo', q('#side-dice .result')).click();")
        assert r(hp) == hp0
        pwait("return window.CrowsPlay.vitals().ad === 9", "the Undo on the player's sheet", 10)
        ok("Undo in the Dice panel takes the hit back, on the sheet too")

        # A melee doom: the target counters at tier 3.
        p("button('Target', row('Blood Creature A 1')).click();")
        p("""var M = window.Math, rnd = M.random; M.random = function () { return 0; };
             try { var atk = qa('#play-attacks .atk').filter(function (x) { return /Unarmed/.test(text(x)); })[0]; button('Attack', atk).click(); }
             finally { M.random = rnd; }""")
        rwait("return combat().acts.some(function (a) { return a.doom && a.melee; })", "the doom to reach the Ref")
        assert "doom" in r("return text(q('#sec-combat .live-acts li'))")
        r("button('Blood Creature A 1 counters (3)', q('#sec-combat .live-acts')).click();")
        assert r(hp) == hp0 - 3, (hp0, r(hp))
        ok("after a melee doom the Ref's button has the target counter at tier 3 (3 damage to the crow)")
        r("button('Undo', q('#sec-combat .live-acts li')).click();")
        assert r(hp) == hp0
        ok("...and the counter can be undone")

        # A ranged doom hits a random ally next to the target; a doom casting is a backlash.
        r("""var box = q('#sec-combat'); var s = q('select[aria-label=Creature]', box); s.value = 'Sword Warrior (P4)'; s.dispatchEvent(new Event('change'));
             type(q('input[aria-label=\"How many\"]', box), '1'); var side = q('select[aria-label=Side]', box); side.value = 'ally'; side.dispatchEvent(new Event('change'));
             button('Add', box, true).click();""")
        rwait("return combat().list.some(function (x) { return x.kind === 'ally'; })", "the ally to join")
        camp_id = r("return window.CrowsCloud.recordId")
        tgt1 = r("return combat().list.filter(function (x) { return x.name === 'Blood Creature A 1'; })[0].id")
        pl.post("combat.act", {"id": char, "campaign": camp_id, "action": {"type": "attack", "target": tgt1, "label": "Attack with Shortbow",
                                                                          "tier": 1, "doom": True, "ranged": True, "allyDamage": 5}})
        pl.post("combat.act", {"id": char, "campaign": camp_id, "action": {"type": "attack", "target": tgt1, "label": "Cast Firebolt", "tier": 1,
                                                                          "doom": True, "cast": True, "rank": 2, "backlash": True}})
        rwait("return combat().acts.filter(function (a) { return a.doom; }).length === 3", "both dooms")
        ally = "var x = combat().list.filter(function (x) { return x.kind === 'ally'; })[0]; return x.st + x.ad;"
        a0 = r(ally)
        r("button('Hit a random ally (5)', q('#sec-combat .live-acts')).click();")
        assert r(ally) == a0 - 5, (a0, r(ally))
        ok("after a ranged doom the Ref's button hits the only other ally (Sword Warrior) for the weapon's tier 3 damage")
        r("button('Roll backlash (d100 + 2)', q('#sec-combat .live-acts')).click();")
        bl = r("return combat().acts.filter(function (a) { return a.backlash; })[0].backlashText")
        assert bl and bl.startswith("Backlash "), bl
        pwait("return /suffers a backlash/.test(text(q('#play-combat .cbt-feed')))", "the backlash in the player's feed")
        ok("after a doom casting the Ref rolls the backlash (" + bl[:60] + "...), and the player sees it")

        # The player's side of a monster's miss: a counter offered on the Play page, with their sword.
        r("""var M = window.Math, rnd = M.random; M.random = function () { return 0; };
             try { button('Claws', cbt('Blood Creature A 1')).click(); } finally { M.random = rnd; }""")
        pwait("return !!q('#play-combat .cbt-prompt')", "the counter offer on the Play page")
        offer = p("return text(q('#play-combat .cbt-prompt'))")
        assert "Counter Blood Creature A 1" in offer and "with Sword" in offer, offer
        ok("when Blood Creature A 1 misses the crow with a doom, the Play page offers a counter with the sword (tier 3)")
        b0 = r("var x = combat().list.filter(function (x) { return x.name === 'Blood Creature A 1'; })[0]; return x.st + x.ad;")
        p("button('Counter Blood Creature A 1', q('#play-combat .cbt-prompt')).click();")
        rwait("return combat().acts.some(function (a) { return a.rxn && /Counter with Sword/.test(a.label); })", "the counter in the Ref Screen")
        b1 = r("var x = combat().list.filter(function (x) { return x.name === 'Blood Creature A 1'; })[0]; return x.st + x.ad;")
        assert b1 < b0, (b0, b1)
        pwait("return !q('#play-combat .cbt-prompt')", "the offer to go away")
        ok("the player's counter lands on Blood Creature A 1 as a reaction, and the offer goes away")

        # A player's Grab (tier 3) on the second creature.
        p("button('Target', row('Blood Creature A 2')).click();")
        p("""var M = window.Math, rnd = M.random; M.random = function () { return 0.999; };
             try { button('Grab Blood Creature A 2', q('#cbt-act')).click(); } finally { M.random = rnd; }""")
        rwait("var x = combat().list.filter(function (x) { return x.name === 'Blood Creature A 2'; })[0]; return x.conds.Grabbed && !!x.grabbedBy", "the grab in the Ref Screen")
        pwait("return /grabbed by/.test(text(row('Blood Creature A 2')))", "the grab on the Play page")
        ok("the player's Grab (tier 3) grabs Blood Creature A 2, shown on both pages")

        # Taunt: the taunted creature's attacks at anyone else take a bane.
        r("""var box = q('#sec-combat'); var s = q('select[aria-label=Creature]', box); s.value = 'Blood Creature A'; s.dispatchEvent(new Event('change'));
             type(q('input[aria-label=\"How many\"]', box), '1'); var side = q('select[aria-label=Side]', box); side.value = 'foe'; side.dispatchEvent(new Event('change'));
             button('Add', box, true).click();""")
        pwait("return !!row('Blood Creature A 3')", "the third creature on the Play page")
        p("button('Target', row('Blood Creature A 3')).click();")
        p("button('Taunt Blood Creature A 3', q('#cbt-act')).click();")
        rwait("var x = combat().list.filter(function (x) { return x.name === 'Blood Creature A 3'; })[0]; return !!x.taunt", "the taunt")
        ally_id = r("return combat().list.filter(function (x) { return x.kind === 'ally'; })[0].id")
        r("""var row = cbt('Blood Creature A 3'), s = q('.tgt-pick select', row); s.value = arguments[0]; s.dispatchEvent(new Event('change'));""", ally_id)
        r("button('Claws', cbt('Blood Creature A 3')).click();")
        assert "taunted by " + crow in r("return text(q('#side-dice .result'))")
        ok("after the crow's Taunt, Blood Creature A 3's attack on someone else takes a bane")

        # Conditions both ways: the Ref knocks the crow prone, the player stands up.
        r("button('Prone', q('.conds', qa('#sec-combat .cbt.pc')[0])).click();")
        pwait("return !!window.CrowsPlay.conds().Prone && !!q('#cbt-act') && /Stand Up/.test(text(q('#cbt-act')))", "prone on the sheet")
        ok("the Ref marks the crow prone: it's on the player's sheet, and Stand Up appears")
        p("button('Stand Up', q('#cbt-act')).click();")
        rwait("return !combat().list.filter(function (x) { return x.kind === 'pc'; })[0].conds.Prone", "the crow to stand")
        ok("Stand Up clears prone on the sheet and in the Ref Screen")

        # A player's healing spell and a spell on 2 targets (sent as the sheet sends them).
        sw = r("var x = combat().list.filter(function (x) { return x.kind === 'ally'; })[0]; return [x.id, x.st];")
        r("var x = combat().list.filter(function (x) { return x.kind === 'ally'; })[0]; x.st = Math.max(1, x.st - 5);")
        sw_st = r("return combat().list.filter(function (x) { return x.kind === 'ally'; })[0].st")
        pl.post("combat.act", {"id": char, "campaign": camp_id, "action": {"type": "attack", "label": "Cast Minor Healing", "tier": 2, "cast": True,
                                                                          "heal": 3, "targets": [{"id": sw[0], "name": "Sword Warrior"}]}})
        rwait("return combat().list.filter(function (x) { return x.kind === 'ally'; })[0].st === arguments[0]".replace("arguments[0]", str(sw_st + 3)), "the heal")
        ok("a player's healing spell heals its target (+3 Stamina)")
        foes = r("return combat().list.filter(function (x) { return x.kind === 'foe' && !x.dead; }).map(function (x) { return [x.id, x.name, x.st + x.ad]; })")
        pl.post("combat.act", {"id": char, "campaign": camp_id, "action": {"type": "attack", "label": "Cast Spark", "tier": 2, "cast": True, "damage": 1,
                                                                          "targets": [{"id": f[0], "name": f[1]} for f in foes[:2]]}})
        rwait("return combat().acts.some(function (a) { return a.label === 'Cast Spark' && a.applied; })", "the spark")
        after = r("return combat().list.filter(function (x) { return x.kind === 'foe'; }).map(function (x) { return [x.id, x.st + x.ad]; })")
        hit = [f for f in foes[:2] if dict(after)[f[0]] == f[2] - 1]
        assert len(hit) == len(foes[:2]), (foes, after)
        ok(f"a spell on {len(foes[:2])} targets hits each of them with one roll")

        # Next round: an opportunity attack is a reaction.
        r("button('Next round + initiative', q('#sec-combat')).click();")
        pwait("return /^Round\\s*2$/.test(text(q('#play-combat .cbt-head .vital')))", "round 2 on the Play page")
        p("q('#cbt-act input[type=checkbox]').click();")
        p("""var M = window.Math, rnd = M.random; M.random = function () { return 0.6; };
             try { var atk = qa('#play-attacks .atk').filter(function (x) { return /^Sword/.test(text(x)); })[0]; button('Attack', atk).click(); }
             finally { M.random = rnd; }""")
        rwait("return combat().acts.some(function (a) { return a.rxn && /Attack with Sword/.test(a.label); })", "the opportunity attack")
        assert r("var x = combat().list.filter(function (x) { return x.kind === 'pc'; })[0]; return x.rx && x.rx.r === 2 && x.rx.n === 1")
        pwait("return /Reaction: used/.test(text(q('#play-combat .cbt-turn')))", "the reaction to show as used")
        ok("the player's attack marked as a reaction goes to the Ref as one, and uses the crow's reaction for round 2")

        # Unattended items: drops, pickups (first come, needing a free hand), creatures, hidden items, a dump, a death.
        p("button('Drop', qa('#play-items .zone-hand .item-row').filter(function (x) { return /Sword/.test(text(x)); })[0]).click();")
        rwait("return (combat().items || []).some(function (it) { return it.key === 'Sword' && it.by === arguments[0]; })".replace("arguments[0]", repr(crow)), "the dropped sword on the Ref's ground")
        pwait("return !window.CrowsApp.state.inv.some(function (c) { return c.key === 'Sword'; }) && /Sword/.test(text(q('#play-combat .cbt-ground')))", "the sword to leave the sheet and show on the ground")
        assert "drops" in p("return text(q('#play-combat .cbt-feed'))"), "no drop in the player's feed"
        ok("the player drops the sword from their hand: it leaves the sheet, lands on the Ref's ground list, and the feed says so")
        assert p("return !!q('#play-items .zone-ground') && /Sword/.test(text(q('#play-items .zone-ground')))"), "no sword in the Items card's ground zone"
        ok("the Items card shows an On the ground zone with the sword")
        r("""var box = q('#sec-combat .items-box'); type(q('input[aria-label=\"New item\"]', box), 'Silver key');
             q('label.check input', box).click(); button('Add item', box).click();""")
        r("""var box = q('#sec-combat .items-box'); type(q('input[aria-label=\"New item\"]', box), 'Torch'); button('Add item', box).click();""")
        listed = r("return combat().items.map(function (it) { return it.key + (it.hidden ? '*' : ''); }).join(',')")
        assert listed == "Sword,Silver key*,Torch", listed
        pwait("return /Torch/.test(text(q('#play-combat .cbt-ground')))", "the Ref's torch on the player's page")
        assert "Silver key" not in p("return text(q('#play-combat')) + text(q('#play-items'))"), 'the hidden key leaked to the player'
        ok("the Ref quickly creates a hidden Silver key and a visible Torch: the player sees only the torch")
        foe = r("return combat().list.filter(function (x) { return x.kind === 'foe' && !x.dead; })[0].name")
        r("""var nm = arguments[0], li = qa('#sec-combat .item-li').filter(function (x) { return /Torch/.test(text(x)); })[0], s = q('select', li);
             s.value = combat().list.filter(function (x) { return x.name === nm; })[0].id; button('Picks up', li).click();""", foe)
        assert r("var nm = arguments[0]; return combat().list.filter(function (x) { return x.name === nm; })[0].items[0].key", foe) == "Torch"
        pwait("return /holds Torch/.test(text(row(arguments[0]))) && !/Torch/.test(text(q('#play-combat .cbt-ground')))".replace("arguments[0]", repr(foe)), "the creature holding the torch")
        ok(f"the Ref has {foe} pick up the torch: the player sees it holding it, and it's off the ground")
        p("button('Pick up', qa('#play-combat .cbt-ground .cbt-row').filter(function (x) { return /Sword/.test(text(x)); })[0]).click();")
        pwait("return window.CrowsApp.state.inv.some(function (c) { return c.key === 'Sword' && c.area === 'hand'; })", "the sword back in hand")
        assert not r("return combat().items.some(function (it) { return it.key === 'Sword'; })"), "the sword is still on the Ref's ground"
        assert "picks up **Sword**" in r("return JSON.stringify(combat().feed)"), 'no pickup line in the feed'
        ok("the player picks the sword up (Pick Up Item): the Ref hands it over and it's back in their hand")
        r("""var box = q('#sec-combat .items-box'); type(q('input[aria-label=\"New item\"]', box), 'Greatsword'); button('Add item', box).click();""")
        pwait("return /Greatsword/.test(text(q('#play-combat .cbt-ground')))", "the greatsword on the player's page")
        gs = p("var b = button('Pick up', qa('#play-combat .cbt-ground .cbt-row').filter(function (x) { return /Greatsword/.test(text(x)); })[0]); return [b.disabled, b.title];")
        assert gs[0] and "both hands" in gs[1], gs
        ok("with a sword in one hand, picking up the two-handed greatsword isn't allowed (" + gs[1] + ")")
        r("button('Hidden', q('#sec-combat .items-box')).click();")
        pwait("return /Silver key/.test(text(q('#play-combat .cbt-ground')))", "the key to show once the Ref unhides it")
        ok("the Ref shows the hidden key, and it appears for the player")
        p("window.confirm = function () { return true; }; button('Dump Backpack', q('#cbt-act')).click();")
        rwait("return combat().items.some(function (it) { return it.key === 'Light Armor' && it.by === arguments[0]; })".replace("arguments[0]", repr(crow)), "the dumped armor")
        assert not p("return window.CrowsApp.state.inv.some(function (c) { return c.area === 'pack'; })"), "the backpack wasn't emptied"
        ok("Dump Backpack puts the backpack's contents (light armor) on the ground and empties it on the sheet")
        r("button('Mark dead', cbt(arguments[0])).click();", foe)
        rwait("return combat().items.some(function (it) { return it.key === 'Torch' && it.by === arguments[0]; })".replace("arguments[0]", repr(foe)), "the torch dropped by the dead creature")
        pwait("return /falls and drops/.test(text(q('#play-combat .cbt-feed')))", "the drop in the player's feed")
        ok(f"{foe} dies and drops the torch, and the player's feed says so")

        # The end.
        r("button('End combat', q('#sec-combat')).click();")
        assert "Left on the ground" in r("return JSON.stringify(window.CrowsRef.state.log.slice(-3))"), 'nothing about what was left on the ground'
        ok("ending the fight logs what was left on the ground")
        pwait("return q('#play-combat').hidden", "the Combat card to go away")
        ok("ending the fight takes the Combat card off the player's page")
        good = True
    except Exception as e:
        print("FAILED:", e)
        for name, wd, script in (("player", P, "return [text(q('#toast')), text(q('.roll-result'))]"),
                                 ("Ref", R, "return [text(q('#toast')), text(q('#sec-combat .live-acts')), text(q('#side-dice .result')), combat().lastAct]")):
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
