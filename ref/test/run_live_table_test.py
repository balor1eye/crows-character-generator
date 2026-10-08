#!/usr/bin/env python3
"""The graphical tabletop between the Ref Screen and a player's Play page, on the test instance, in two headless Firefoxes.

  python3 ref/test/run_live_table_test.py            options: --headed (show the browsers), --keep (keep what it made)

test_player opens a new crow on the Play page and shares it; test_ref adds it to a new campaign, makes a Dungeon scene on the
Tabletop tab (a walled room with a closed door, a creature inside and one outside), puts the crow on it, and shows it to the
players. Then the player's Table must show: the crow and the creature in the room, but not the creature beyond the wall
(fog of war); the fog mask must hide the far room; a move from the player must reach the Ref's token, and a move through the
wall must not; opening the door must reveal the creature; hiding a token must remove it; a ping must reach the Ref.
The environment the Ref turns on (rain, darkness) must reach the player's map: its chips, with the rules, and its weather layer.
Then a fight on the map: the player's turn strip and Fight drawer, an attack from the map's Attack drawer reaching the Ref, the
text lists (the player's own choice, then the Ref's default) and back, and the strip going when the Ref ends the fight.
In the fight, a weapon made in the Ref's Workshop is put on the ground: its card reaches the player's page, the player picks it
up, and the crow's saved sheet keeps the card.
Everything it made is deleted. Logs in through server/test_instance.py (never typing a password into a browser).
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "server"))
from run_combat_test import WebDriver  # noqa: E402
import test_instance  # noqa: E402

JS = r"""
function q(s, r) { return (r || document).querySelector(s); }
function qa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function text(n) { return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; }
function button(label, root, exact) {
  var b = qa('button', root).filter(function (x) { return exact ? text(x) === label : text(x).indexOf(label) === 0; })[0];
  if (!b) throw new Error('no button "' + label + '"');
  return b;
}
function scene() { var v = window.CrowsRef.state.vtt; return v.scenes.filter(function (s) { return s.id === v.cur; })[0]; }
function pub() { var d = window.CrowsCombat.tableData(); return d && d.table; }
function names() { var t = pub(); return t ? t.tokens.map(function (k) { return k.name; }).sort() : null; }
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
        def rwait(script, what, s=25): R.wait(JS + script, what, s)
        def pwait(script, what, s=25): P.wait(JS + script, what, s)

        for wd, c in ((R, ref), (P, pl)):
            wd.go(base)
            for k in c.jar:
                wd.add_cookie({"name": k.name, "value": k.value, "path": k.path, "secure": bool(k.secure), "httpOnly": True, "sameSite": "Lax"})

        P.go(base + "play?new=1")
        pwait("return !!(window.CrowsCloud && window.CrowsCloud.active)", "the Play page to load")
        pwait("return !!window.CrowsCloud.recordId", "the new crow to be saved")
        char = p("return window.CrowsCloud.recordId")
        link = pl.post("share.create", {"id": char})["link"]
        ok("the player's new crow is saved and shared")

        R.go(base + "ref.php?new=1")
        rwait("return !!(window.CrowsCloud && window.CrowsCloud.recordId)", "the new campaign to be saved")
        camp = R.js("return window.CrowsCloud.recordId")
        r("button('Party', q('#tabbar')).click();")
        r("var i = q('input[aria-label=\"Character link\"]'); i.value = arguments[0]; i.dispatchEvent(new Event('input', { bubbles: true })); button('Add from link').click();", link)
        rwait("return window.CrowsRef.state.party.some(function (x) { return x.link; })", "the crow to join the party")
        acc = r("return window.CrowsRef.state.party[0].link")
        ok("the Ref adds the crow to a new campaign")

        # A Dungeon scene: a room (1,1)-(10,8) squares with a closed door in its east wall, the crow carrying a torch.
        r("button('Tabletop', q('#tabbar')).click();")
        r("var s = q('select[aria-label=\"New scene\"]'); s.value = 'dungeon'; s.dispatchEvent(new Event('change'));")
        rwait("return !!scene() && !!q('.vtt-canvas')", "the scene and its canvas")
        ok("Ref makes a Dungeon scene on the Tabletop tab")
        r("q('#sec-vtt [aria-label^=\"Add tokens\"]').click();")   # the + at the start of the token strip opens the Add drawer
        r("button('Crows', q('#sec-vtt .vtt-drawer')).click();")
        rwait("return scene().tokens.some(function (t) { return t.pcId; })", "the crow's token")
        r("""var sc = scene(), g = sc.g, W = function (a, b, c, d, t) { sc.walls.push({ id: 'w' + sc.walls.length, a: [a * g, b * g], b: [c * g, d * g], t: t || 'wall', open: false }); };
             W(1, 1, 10, 1); W(10, 1, 10, 3); W(10, 3, 10, 4, 'door'); W(10, 4, 10, 8); W(10, 8, 1, 8); W(1, 8, 1, 1);
             var me = sc.tokens.filter(function (t) { return t.pcId; })[0]; me.x = 3.5 * g; me.y = 3.5 * g; me.light = { b: 5, d: 5, on: true }; me.speed = 5;
             window.CrowsRefApp.save(); window.CrowsRefApp.render();""")
        r("""var box = q('#sec-vtt .vtt-drawer'), s = q('select[aria-label=Creature]', box); s.value = 'Blood Creature A'; s.dispatchEvent(new Event('change'));
             var n = q('input[aria-label=\"How many\"]', box); n.value = '2'; button('Add', box, true).click();""")
        rwait("return scene().tokens.filter(function (t) { return t.kind === 'foe'; }).length === 2", "two creature tokens")
        r("""var sc = scene(), g = sc.g, foes = sc.tokens.filter(function (t) { return t.kind === 'foe'; });
             foes[0].x = 6.5 * g; foes[0].y = 5.5 * g; foes[0].hidden = false; foes[1].x = 12.5 * g; foes[1].y = 3.5 * g; foes[1].hidden = false;
             window.CrowsRefApp.save(); window.CrowsRefApp.render();""")
        ok("the crow, one creature inside the room and one beyond the closed door are on the map")
        r("button('Show to players', q('#sec-vtt')).click();")
        pwait("return !!pub()", "the scene on the player's page")
        ok("Show to players: the scene reaches the player's Play page")

        crow = r("return scene().tokens.filter(function (t) { return t.pcId; })[0].name")
        n = p("return names()")
        assert len(n) == 2 and crow in n and "Blood Creature A 1" in n and "Blood Creature A 2" not in n, n
        ok("fog of war: the player sees their crow and the creature in the lit room, not the one behind the wall")
        assert p("var t = pub(); var m = window.CrowsTable.unpackMask(t.fog); var g = t.g; return [window.CrowsTable.maskAt(m, 3.5 * g, 3.5 * g), window.CrowsTable.maskAt(m, 6.5 * g, 5.5 * g), window.CrowsTable.maskAt(m, 12.5 * g, 3.5 * g), window.CrowsTable.maskAt(m, 25 * g, 15 * g)]") in ([3, 3, 0, 0], [3, 2, 0, 0], [3, 3, 0, 0])
        ok("the fog mask lights the room and hides the far room and the rest of the map")
        assert p("return JSON.stringify(pub()).indexOf('walls') < 0")
        ok("the player's data holds no walls")

        # The player's Table.
        p("window.CrowsPlay.showTab('now');")
        pwait("return !!q('#play-table .vtt-canvas')", "the Table tab's canvas")
        ok("the player's Table tab shows the map")

        # A move.
        tok = p("var t = pub().tokens.filter(function (k) { return k.link; })[0]; return t.id;")
        g = p("return pub().g")
        p("window.CrowsCombat.sendTable({ type: 'move', token: arguments[0], x: 5.5 * arguments[1], y: 3.5 * arguments[1] });", tok, g)
        rwait("var t = scene().tokens.filter(function (k) { return k.pcId; })[0]; return Math.round(t.x) === Math.round(5.5 * scene().g)", "the move to reach the Ref Screen")
        ok("a move from the player reaches the Ref's token")
        pwait("var t = pub().tokens.filter(function (k) { return k.link; })[0]; return Math.round(t.x) === Math.round(5.5 * pub().g)", "the move to come back")
        ok("...and back to the player's map")
        # A move through the wall (out through the door's wall, east of x = 10).
        p("window.CrowsCombat.sendTable({ type: 'move', token: arguments[0], x: 11.5 * arguments[1], y: 6.5 * arguments[1] });", tok, g)
        R.js("return new Promise(function (ok) { setTimeout(ok, 4000); })")
        assert r("var t = scene().tokens.filter(function (k) { return k.pcId; })[0]; return Math.round(t.x) === Math.round(5.5 * scene().g)")
        ok("a move through a wall is refused")

        # The door.
        r("scene().walls.filter(function (w) { return w.t === 'door'; })[0].open = true; window.CrowsRefApp.save(); window.CrowsRefApp.render();")
        pwait("return names().indexOf('Blood Creature A 2') >= 0", "the creature beyond the door to appear")
        ok("opening the door shows the creature beyond it")

        # The party's marker: any player can move it.
        r("q('#sec-vtt [aria-label^=\"Add tokens\"]').click(); button('Party marker', q('#sec-vtt .vtt-drawer')).click();")
        rwait("return scene().tokens.some(function (t) { return t.marker; })", "the party marker")
        r("var sc = scene(), m = sc.tokens.filter(function (t) { return t.marker; })[0]; m.x = 4.5 * sc.g; m.y = 4.5 * sc.g; window.CrowsRefApp.save(); window.CrowsRefApp.render();")
        pwait("return pub().tokens.some(function (k) { return k.party; })", "the party marker on the player's map")
        ok("the party's marker reaches the player's map, flagged as the party's")
        pm = p("return pub().tokens.filter(function (k) { return k.party; })[0].id;")
        p("window.CrowsCombat.sendTable({ type: 'move', token: arguments[0], x: 7.5 * arguments[1], y: 6.5 * arguments[1] });", pm, g)
        rwait("var m = scene().tokens.filter(function (t) { return t.marker; })[0]; return Math.round(m.x) === Math.round(7.5 * scene().g)", "the party marker to move")
        ok("a player moves the party's marker")

        # Hide a token.
        r("scene().tokens.filter(function (t) { return t.name === 'Blood Creature A 1'; })[0].hidden = true; window.CrowsRefApp.save(); window.CrowsRefApp.render();")
        pwait("return names().indexOf('Blood Creature A 1') < 0", "the hidden token to vanish")
        ok("a token the Ref hides disappears from the player's map")

        # A ping.
        p("window.CrowsCombat.sendTable({ type: 'ping', x: 400, y: 300 });")
        rwait("return (scene().pings || []).some(function (k) { return Math.round(k.x) === 400 && Math.round(k.y) === 300; })", "the ping to reach the Ref")
        ok("a ping from the player reaches the Ref")

        # The environment (the Tabletop's Environment drawer): rain and darkness reach the player's map.
        r("q('#sec-vtt .vtt-tr button[title^=\"Environment\"]').click();")
        r("qa('#sec-vtt .env-tog').filter(function (x) { return /^Rain/.test(text(x)); })[0].click();")
        r("qa('#sec-vtt .env-tog').filter(function (x) { return /^Darkness/.test(text(x)); })[0].click();")
        assert r("var e = scene().env || {}; return !!(e.rain && e.dark)")
        pwait("var t = pub(); return !!(t && t.env && t.env.rain && t.env.dark)", "the environment in the player's copy of the scene")
        chips = p("return qa('#play-table .hud-chip.env').map(function (c) { return [text(c), c.title]; })")
        assert [c[0] for c in chips] == ["Darkness", "Rain"] and "double bane" in chips[0][1], chips
        assert p("return !!q('#play-table canvas.vtt-weather')")
        ok("the environment the Ref turns on (rain, darkness) reaches the player's map: chips with the rules, and the weather layer")
        r("window.CrowsRef.state.vtt.scenes.forEach(function (s) { if (s.env) s.env = {}; }); q('#sec-vtt .vtt-drawer .fab[title=Close]') && q('#sec-vtt .vtt-drawer .fab[title=Close]').click(); window.CrowsRefApp.save(); window.CrowsRefApp.render();")
        pwait("var t = pub(); return !!t && !t.env && !qa('#play-table .hud-chip.env').length", "the environment to clear on the player's map")
        ok("...and clears from it when the Ref turns it off")

        # A fight on the map (the battle map is the players' default view).
        r("""var A = window.CrowsRefApp; scene().tokens.forEach(function (t) { t.hidden = false; }); A.addParty();
             var c = window.CrowsRef.state.session.combat, me = c.list.filter(function (x) { return x.kind === 'pc'; })[0];
             c.list.forEach(function (x) { if (x.kind === 'foe') x.tgt = me.id; }); A.nextRound();""")
        pwait("return /Round 1/.test(text(q('#play-table .vtt-turn')))", "the turn strip on the player's map")
        assert p("return window.CrowsCombat.fight().view") == "map"
        ok("in a fight the player's map has the turn strip (the battle map is the default view)")
        p("button('Fight', q('#play-table .vtt-turn')).click();")
        pwait("return /Blood Creature A 1/.test(text(q('#play-table .vtt-drawer')))", "the map's Fight drawer")
        ok("the map's Fight drawer lists the fight")
        p("""button('Attack', q('#play-table .dr-tabs')).click(); button('Attack', q('#play-table .dr-body'), true).click();
             var b = qa('#play-table button').filter(function (x) { return text(x) === 'Send as it is'; })[0]; if (b) b.click();""")
        rwait("return (window.CrowsRef.state.session.combat.acts || []).some(function (a) { return a.type === 'attack'; })", "the attack from the map to reach the Ref")
        ok("an attack from the map's Attack drawer reaches the Ref")
        # A weapon from the Ref's Workshop on the ground: its card reaches the player, who picks it up onto their sheet.
        r("""var A = window.CrowsRefApp, h = window.CrowsRef.state.homebrew;
             h.items.push({ id: A.nid(), n: 'Thornblade (test)', kind: 'weapon', gc: 20, sl: 1, st: 1, txt: '', craft: { exp: '' }, wt: 'Stabbing', hands: 1, reach: 1,
               range: 0, ch: 'S', t2: 3, t3: 7, q: { Brutal: true }, metal: 'Steel', wood: '', ench: ['Vicious'] });
             A.syncHomebrew(); A.onGround().push(A.newItem('Thornblade (test)', 1, false)); A.save(); A.render();""")
        pwait("var c = CROWS.ITEMS['Thornblade (test)']; return !!(c && c.custom && /Vicious/.test(c.txt) && window.CrowsCombat.ground().some(function (it) { return it.key === 'Thornblade (test)'; }))",
              "the Workshop weapon's card on the player's page")
        ok("a weapon from the Ref's Workshop on the ground: its card reaches the player's page")
        p("window.CrowsApp.state.inv.forEach(function (c) { if (c.area === 'hand') c.area = 'none'; });")   # free hands (the crow's starting kit fills them)
        why = p("var it = window.CrowsCombat.ground().filter(function (x) { return x.key === 'Thornblade (test)'; })[0]; var w = window.CrowsCombat.cantPickUp(it); if (!w) window.CrowsCombat.pickUp(it); return w;")
        assert not why, why
        pwait("return window.CrowsApp.state.inv.some(function (c) { return c.key === 'Thornblade (test)'; })", "the weapon on the player's sheet")
        assert p("var h = window.CrowsApp.state.hb || {}, c = h['Thornblade (test)']; return !!(c && c.cat === 'weapon' && /Attack 2d10 \\+ S\\. 12-16: 4 \\+ S; 17\\+: 8 \\+ S/.test(c.txt))")
        ok("the player picks it up: the crow's sheet carries it and keeps its card")
        saved = None
        for _ in range(20):
            saved = pl.get("get", kind="characters", id=char)["item"]["data"]
            if "Thornblade (test)" in (saved.get("hb") or {}) and any(c.get("key") == "Thornblade (test)" for c in saved.get("inv", [])):
                break
            R.js("return new Promise(function (ok) { setTimeout(ok, 1500); })")
        assert "Thornblade (test)" in (saved.get("hb") or {}), "the server's copy of the crow has no card for the weapon"
        assert any(c.get("key") == "Thornblade (test)" for c in saved.get("inv", [])), "the server's copy of the crow doesn't carry the weapon"
        ok("the server's copy of the crow carries the weapon and its card")
        p("window.CrowsCombat.setView('text');")
        pwait("return q('#play-table').hidden && qa('#play-combat .cbt-row').length >= 3", "the fight as text lists")
        ok("As lists: the map steps aside and the Combat card lists the enemies and allies")
        p("window.CrowsCombat.setView('map');")
        pwait("return !q('#play-table').hidden", "the map to come back")
        r("window.CrowsRefApp.setPlayerView('text');")
        pwait("return q('#play-table').hidden", "the Ref's default (text lists) to reach the player")
        r("window.CrowsRefApp.setPlayerView('map');")
        pwait("return !q('#play-table').hidden", "the battle map default to come back")
        ok("the Ref's default view reaches the player, who follows it")
        r("window.CrowsRefApp.endCombat();")
        pwait("return !q('#play-table .ts-bar')", "the turn strip to go when the fight ends")
        ok("ending the fight takes the turn strip off the map")
        # Hide it all.
        r("button('Shown to players', q('#sec-vtt')).click();")
        pwait("return !pub()", "the scene to go away")
        ok("hiding the scene takes it off the player's page")
        good = True
    except Exception as e:
        print("FAILED:", e)
        for name, wd, script in (("player", P, "return [JSON.stringify(window.CrowsCombat.tableData() && window.CrowsCombat.tableData().table.tokens), text(q('#toast'))]"),
                                 ("Ref", R, "return [JSON.stringify(scene() && scene().tokens.map(function (t) { return [t.name, Math.round(t.x), Math.round(t.y), t.hidden]; })), text(q('#toast'))]")):
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
    print(f"live table: {passed} checks passed" if good else "FAILED")
    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(main())
