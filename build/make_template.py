"""
Builds the static PDF template used by the web generator:

  page 1  Character Record (stats page, drawn here in the style of the official sheet)
  page 2  The official Crows Playtest 2 Inventory Sheet (copied verbatim)
  pages 3-5  Player cheat sheet (max 3 pages; build fails if it overflows)

It also writes field_layout.json: the positions of every fillable field. The browser
app creates the AcroForm fields at those positions with pdf-lib and fills them, so the
downloaded PDF stays editable in any PDF viewer.

Usage: python make_template.py <official inventory sheet pdf> <out dir>
"""
import json
import sys
from io import BytesIO

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen import canvas
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageTemplate,
                                PageBreak, Paragraph, Spacer, Table, TableStyle)

W, H = 612, 792
INK = colors.HexColor('#1f1d1e')
fields = []  # top-origin rects; converted to PDF space in the browser


def fld(name, x, y, w, h, kind='text', size=None, align='left', page=0, multiline=False):
    fields.append(dict(name=name, page=page, x=round(x, 2), y=round(y, 2), w=round(w, 2), h=round(h, 2),
                       kind=kind, size=size, align=align, multiline=multiline))


# --------------------------------------------------------------------------- stats page
def stats_page():
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(W, H))
    c.setTitle('Crows Character Record')

    def T(y):  # top-origin -> pdf y
        return H - y

    def box(x, y, w, h, label=None, lsize=8.5):
        c.setStrokeColor(INK)
        c.setLineWidth(1)
        c.rect(x, T(y + h), w, h)
        if label:
            c.setFillColor(INK)
            c.setFont('Helvetica-Bold', lsize)
            c.drawString(x + 3, T(y + 10), label)

    def bar(y):
        c.setFillColor(INK)
        c.rect(18, T(y + 4), 576, 4, stroke=0, fill=1)

    # Title
    c.setFillColor(INK)
    c.setFont('Times-Bold', 22)
    c.drawString(18, T(38), 'CROWS')
    c.setFont('Times-Italic', 11)
    c.drawString(104, T(37), 'Fortune or Death')
    c.setFont('Helvetica-Bold', 10)
    c.drawRightString(594, T(30), 'Character Record')
    c.setFont('Helvetica', 7)
    c.drawRightString(594, T(39), 'MCDM Crows Public Playtest 2 (Aug-Sept 2026)')

    # Identity
    bar(44)
    y = 48
    box(18, y, 300, 30, 'Name');                    fld('Name', 20, y + 12, 296, 16, size=11)
    box(318, y, 170, 30, 'Background');            fld('Background', 320, y + 12, 166, 16, size=10)
    box(488, y, 106, 30, 'Player');                fld('Player', 490, y + 12, 102, 16, size=10)
    y = 78
    box(18, y, 400, 30, 'Distinguishing Feature'); fld('Feature', 20, y + 12, 396, 16, size=9)
    box(418, y, 176, 30, 'Village');               fld('Village', 420, y + 12, 172, 16, size=10)

    # Core numbers
    y = 108
    for i, (lab, key) in enumerate([('Agility (A)', 'Agility'), ('Mind (M)', 'Mind'), ('Strength (S)', 'Strength')]):
        x = 18 + i * 64
        box(x, y, 64, 60, lab, 8)
        fld(key, x + 4, y + 16, 56, 40, size=22, align='center')
    box(210, y, 74, 60, 'Stamina Max', 8);   fld('Stamina Max', 214, y + 16, 66, 40, size=22, align='center')
    box(284, y, 74, 60, 'Stamina Now', 8);   fld('Stamina Current', 288, y + 16, 66, 40, size=22, align='center')
    box(358, y, 50, 60, 'Speed', 8);         fld('Speed', 362, y + 16, 42, 40, size=20, align='center')
    box(408, y, 76, 60, 'Armor AD', 8);      fld('Armor AD', 412, y + 16, 68, 40, size=14, align='center', multiline=True)
    box(484, y, 110, 60, 'Coins (gc)', 8);   fld('Coins', 488, y + 16, 102, 40, size=20, align='center')

    # Conditions + cruelty
    y = 168
    box(18, y, 466, 22)
    c.setFont('Helvetica-Bold', 8.5)
    c.drawString(22, T(y + 14.5), 'Conditions:')
    cx = 78
    for cond in ['Blessed', 'Grabbed', 'Prone', 'Vulnerable', 'Unconscious', 'Weakened']:
        fld('Cond ' + cond, cx, y + 6, 10, 10, kind='check')
        c.setFont('Helvetica', 8)
        c.drawString(cx + 13, T(y + 14.5), cond)
        cx += 13 + c.stringWidth(cond, 'Helvetica', 8) + 12
    box(484, y, 110, 22)
    c.setFont('Helvetica-Bold', 8.5)
    c.drawString(488, T(y + 14.5), 'Cruelty')
    fld('Cruelty', 530, y + 3, 60, 16, size=10, align='center')

    # Expertises
    bar(194)
    y = 198
    box(18, y, 372, 290)
    c.setFont('Helvetica-Bold', 9)
    c.drawString(22, T(y + 11), 'Expertises')
    c.setFont('Helvetica', 6.5)
    c.drawString(80, T(y + 11), 'Use 1 after a roll to improve the result 1 tier (1 expertise per test). Tick uses spent; regain on a rest.')

    general = ['Alchemy', 'Athletics', 'Blacksmithing', 'Enchanting', 'Endurance', 'Gymnastics', 'Handle Pet',
               'Historical Lore', 'Lift', 'Magic Lore', 'Monster Lore', 'Nature Lore', 'Navigate', 'Pick Lock',
               'Religious Lore', 'Search', 'Stealth', 'Thievery']
    spell = ['Alteration', 'Benefaction', 'Conjuration', 'Elemental', 'Illusion', 'Necromancy']
    weapon = ['Bashing', 'Bow', 'Chopping', 'Slashing', 'Stabbing', 'Unarmed']

    def exp_header(x, y, title):
        c.setFillColor(colors.HexColor('#e6e2dc'))
        c.rect(x, T(y + 12), 182, 12, stroke=0, fill=1)
        c.setFillColor(INK)
        c.setFont('Helvetica-Bold', 7.5)
        c.drawString(x + 3, T(y + 9), title)
        c.drawCentredString(x + 128, T(y + 9), 'Uses')
        c.drawCentredString(x + 160, T(y + 9), 'Spent')

    def exp_rows(x, y, names):
        for i, n in enumerate(names):
            ry = y + i * 14
            c.setStrokeColor(colors.HexColor('#b8b2aa'))
            c.setLineWidth(0.5)
            c.line(x, T(ry + 14), x + 182, T(ry + 14))
            c.setFillColor(INK)
            c.setFont('Helvetica', 7.5)
            c.drawString(x + 3, T(ry + 10), n)
            fld('Exp ' + n, x + 117, ry + 1.5, 22, 11, size=8, align='center')
            for k in range(4):
                fld('Exp %s Spent %d' % (n, k + 1), x + 143 + k * 10, ry + 3, 8, 8, kind='check')

    exp_header(22, 214, 'General')
    exp_rows(22, 226, general)
    exp_header(206, 214, 'Spellcasting')
    exp_rows(206, 226, spell)
    exp_header(206, 314, 'Weapon')
    exp_rows(206, 326, weapon)
    c.setFillColor(INK)
    c.setFont('Helvetica-Bold', 7.5)
    c.drawString(209, T(422), 'Max uses per expertise')
    fld('Max Uses', 330, 413, 56, 12, size=8, align='center')
    c.setStrokeColor(INK)
    c.setLineWidth(0.5)
    c.rect(330, T(425), 56, 12)
    c.setFont('Helvetica', 6.4)
    tip = ['Spellcasting expertises apply only to castings;',
           'weapon expertises only to weapon attacks.',
           'Resting in the Miasma does not restore uses.',
           'Gymnastics: Agility RRs. Endurance: Mind/Str RRs.']
    for i, s in enumerate(tip):
        c.drawString(209, T(438 + i * 9), s)

    # Experience
    y = 198
    box(390, y, 204, 120, 'Experience')
    for i, lab in enumerate(['Total XP (TXP)', 'XP Spent', 'Unspent XP', 'Expertise/Stamina bonuses', 'Characteristic bonuses']):
        ry = 214 + i * 20
        c.setFont('Helvetica', 7.5)
        c.drawString(394, T(ry + 12), lab)
        fld(['TXP', 'XP Spent', 'XP Unspent', 'ES Bonuses', 'Char Bonuses'][i], 506, ry + 2, 84, 15, size=9, align='center')
        c.setStrokeColor(colors.HexColor('#b8b2aa'))
        c.setLineWidth(0.5)
        c.line(506, T(ry + 17), 590, T(ry + 17))

    # Magic item slots
    y = 318
    box(390, y, 204, 170, 'Magic Item Slots')
    c.setFont('Helvetica', 6.5)
    c.drawString(462, T(y + 10), '(2 in one slot: no rest, 1d6 wounds/DT)')
    for i, s in enumerate(['Head', 'Neck', 'Waist', 'Arms', 'Finger', 'Feet']):
        ry = 334 + i * 25
        c.setStrokeColor(colors.HexColor('#b8b2aa'))
        c.line(390, T(ry), 594, T(ry))
        c.setFillColor(INK)
        c.setFont('Helvetica-Bold', 7.5)
        c.drawString(394, T(ry + 14), s)
        fld('Slot ' + s, 428, ry + 2, 162, 21, size=8, multiline=True)

    # Traits + pets
    bar(488)
    y = 492
    box(18, y, 380, 164, 'Traits')
    fld('Traits', 21, y + 13, 374, 148, multiline=True)
    box(398, y, 196, 164, 'Pets & Hirelings')
    fld('Pets', 401, y + 13, 190, 148, multiline=True)

    # Connection + notes
    y = 656
    box(18, y, 290, 118, 'NPC Connection')
    c.setFont('Helvetica', 7.5)
    c.drawString(22, T(y + 24), 'Name')
    fld('Connection Name', 70, y + 14, 234, 14, size=9)
    c.drawString(22, T(y + 40), 'Relationship')
    fld('Connection Relationship', 70, y + 30, 234, 14, size=9)
    c.drawString(22, T(y + 56), 'Benefit')
    fld('Connection Benefit', 21, y + 60, 284, 56, multiline=True)
    box(308, y, 286, 118, 'Notes')
    fld('Notes', 311, y + 13, 280, 102, multiline=True)

    c.showPage()
    c.save()
    buf.seek(0)
    return buf


# --------------------------------------------------------------------------- inventory page fields
def inventory_fields(page=1):
    cols = [18.5, 126.5, 241.5, 357.5, 472.5, 588.5]
    for i in range(5):
        x0, x1 = cols[i] + 2, cols[i + 1] - 2
        w = x1 - x0
        # hand row (21.5-209.5); labelled cells 1-2, blank cells 3-5
        if i < 2:
            fld('Hand %d' % (i + 1), x0, 64, w, 143, multiline=True, page=page)
        else:
            fld('Hand Row Extra %d' % (i - 1), x0, 25, w, 182, multiline=True, page=page)
        # belt row (213.5-401.5)
        if i < 4:
            fld('Belt %d' % (i + 1), x0, 231, w, 168, multiline=True, page=page)
        else:
            fld('Belt Extra', x0, 217, w, 182, multiline=True, page=page)
        # backpack rows
        for r, (top, bottom) in enumerate([(405.5, 593.5), (593.5, 774.5)]):
            n = i + 1 + r * 5
            fld('Backpack %d' % n, x0, top + 33, w, bottom - top - 35, multiline=True, page=page)
            fld('Wound %d' % n, cols[i] + 43.2, top + 19.3, 9, 9, kind='check', page=page)


# --------------------------------------------------------------------------- cheat sheet
def cheat_sheet():
    buf = BytesIO()
    base = ParagraphStyle('b', fontName='Helvetica', fontSize=8.9, leading=10.6, textColor=INK, alignment=TA_LEFT,
                          spaceAfter=1.6)
    h1 = ParagraphStyle('h1', parent=base, fontName='Times-Bold', fontSize=13, leading=15, spaceBefore=4,
                        spaceAfter=2, textColor=INK, keepWithNext=1)
    h2 = ParagraphStyle('h2', parent=base, fontName='Helvetica-Bold', fontSize=9, leading=10.5, spaceBefore=3,
                        spaceAfter=1, keepWithNext=1)
    bul = ParagraphStyle('bul', parent=base, leftIndent=7, bulletIndent=0, spaceAfter=0.8)
    cell = ParagraphStyle('cell', parent=base, fontSize=8.4, leading=9.8, spaceAfter=0)
    cellb = ParagraphStyle('cellb', parent=cell, fontName='Helvetica-Bold')

    story = []
    K = (576 / 2 - 14) / 176.0  # scale table widths (authored for a 176pt column)

    def H1(t): story.append(Paragraph(t, h1))
    def H2(t): story.append(Paragraph(t, h2))
    def P(t): story.append(Paragraph(t, base))
    def B(items):
        for t in items:
            story.append(Paragraph(t, bul, bulletText='•'))

    def TBL(rows, widths, head=True):
        data = [[Paragraph(str(x), cellb if (head and r == 0) else cell) for x in row] for r, row in enumerate(rows)]
        t = Table(data, colWidths=[w * K for w in widths], hAlign='LEFT')
        st = [('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#8a847c')),
              ('VALIGN', (0, 0), (-1, -1), 'TOP'),
              ('LEFTPADDING', (0, 0), (-1, -1), 2), ('RIGHTPADDING', (0, 0), (-1, -1), 2),
              ('TOPPADDING', (0, 0), (-1, -1), 1), ('BOTTOMPADDING', (0, 0), (-1, -1), 1.2)]
        if head:
            st.append(('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e6e2dc')))
        t.setStyle(TableStyle(st))
        story.append(KeepTogether([t, Spacer(1, 3)]))

    def TIER(title, t1, t2, t3, w=(30, 146)):
        data = [[Paragraph(title, cellb), ''],
                [Paragraph('&lt;=11', cellb), Paragraph(t1, cell)],
                [Paragraph('12-16', cellb), Paragraph(t2, cell)],
                [Paragraph('17+', cellb), Paragraph(t3, cell)]]
        t = Table(data, colWidths=[x * K for x in w], hAlign='LEFT')
        t.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#8a847c')),
                               ('SPAN', (0, 0), (1, 0)),
                               ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e6e2dc')),
                               ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                               ('LEFTPADDING', (0, 0), (-1, -1), 2), ('RIGHTPADDING', (0, 0), (-1, -1), 2),
                               ('TOPPADDING', (0, 0), (-1, -1), 1), ('BOTTOMPADDING', (0, 0), (-1, -1), 1.2)]))
        story.append(KeepTogether([t, Spacer(1, 3)]))

    # ===== Page 1: Core rules
    H1('Tests')
    P('Roll <b>2d10 + a characteristic</b> (Agility, Mind, or Strength) the Ref picks. Only roll when failure is '
      'possible and matters; clever plans just work. You can\'t retry unless circumstances change.')
    TBL([['Tier', 'Total', 'Meaning'],
         ['1', '11 or lower', 'You fail; possible setback. (Attack: a miss.)'],
         ['2', '12-16', 'Partial success, or success at a cost.'],
         ['3', '17 or higher', 'Full success, no complications.']], [18, 44, 114])
    B(['<b>Crit:</b> natural 19-20 = tier 3 plus something extra (attacks: an extra action).',
       '<b>Doom:</b> natural 2-3 = tier 1 and a major setback, whatever your bonuses.',
       '<b>Edge</b> +2 / <b>bane</b> -2. <b>Double edge</b> (2+): no bonus, result goes up 1 tier. '
       '<b>Double bane</b>: result goes down 1 tier. Edge+bane cancel; double edge + 1 bane = 1 edge; '
       'double bane + 1 edge = 1 bane.',
       'Bonuses and penalties from gear or traits are not edges/banes.'])
    H2('Expertises')
    P('After rolling, spend 1 use of a relevant expertise to improve the result by 1 tier (max tier 3). One '
      'expertise, one use per test. All uses return when you finish a rest (not in the Miasma). Argue your case; '
      'the Ref decides if it applies. Experts can sometimes skip the test entirely.')
    H2('Special Tests')
    TIER('Assist (before the other test)', 'Assisted test takes -1', 'Assisted test gains +1', 'Assisted test gains +2')
    B(['<b>Group test:</b> pick a leader; everyone else assists the leader, whose roll decides for all.',
       '<b>Resistance roll (RR):</b> a test against danger; the effect gives its tiers. Doom may add 1d10 dam.',
       '<b>Castings</b> and <b>attacks</b> accept only spellcasting / weapon expertises.',
       '<b>Hide/sneak:</b> only when unobserved; sneaking faster than half speed takes a bane. Hidden: edge on '
       'attacks, targets take a bane on RRs you impose. Aggressive actions reveal you.'])
    H1('Damage & Death')
    B(['<b>Armor Defense (AD):</b> damage hits worn armor or wielded shield first (you choose which). At 0 AD it stops '
       'nothing. Restore one item\'s AD with the Repair Armor rest activity.',
       '<b>Piercing (P)</b> damage ignores AD.',
       '<b>Stamina:</b> damage past AD reduces Stamina.',
       '<b>Wounds:</b> at 0 AD and 0 Stamina, each 1 damage = 1 wound. Each wound fills a backpack slot of your '
       'choice (tick "Wound"). -1 speed for each slot holding both a wound and an item. '
       '<b>All 10 backpack slots wounded = dead.</b>'])
    H1('Conditions')
    TBL([['Condition', 'Effect'],
         ['Blessed', 'Edge on all tests; attacks deal extra damage equal to the characteristic used. Ends at end of DT.'],
         ['Grabbed', 'Speed 0, can\'t flank, attacks vs you gain an edge; you move with the grabber.'],
         ['Prone', 'Speed halved, bane on melee attacks, can\'t flank; melee vs you edge, ranged vs you bane. '
                   'Stand up = maneuver.'],
         ['Vulnerable', 'Take +1d6 each time you take damage. Ends at end of DT.'],
         ['Weakened', 'Bane on all tests. Ends at end of DT.'],
         ['Unconscious', 'Prone, speed 0, no actions; auto doom on Agility/Strength tests; attacks vs you are tier 3. '
                         'Damage or loud noise wakes you.']], [42, 134])
    H1('Usage Dice (UD)')
    P('UD are d6s. When told to roll UD, roll them all; each <b>1 or 2</b> is removed. At 0 UD the effect ends. '
      '<b>Useless</b>: item is spent. <b>Refuel</b>: restored by the named item (oil for lanterns). <b>Rest</b>: '
      'restored on a rest. <b>Activate</b>: roll after each use. <b>DT</b>: roll at the end of each dungeon turn.')
    H1('Inventory')
    B(['2 hand, 4 belt, 10 backpack slots (numbered 1-10). Clothes and the backpack itself are free.',
       'Multi-slot items use adjacent slots of one type. Stack only same-kind items (up to the card\'s Stack). '
       'Hands never stack.',
       'You must hold a weapon, tool, light, or spellbook in a hand slot to use it. One worn suit of armor sits in '
       'the backpack.',
       '<b>In combat:</b> swapping hand/belt items is a maneuver. <b>Draw From Pack</b> (maneuver): name the item, '
       'roll 1d10; if the roll >= one of its slot numbers you get it, otherwise you can only rearrange.',
       'Magic item slots: head, neck, waist, arms, finger, feet. Two items in one slot: you can\'t rest and take '
       '1d6 wounds at the end of each DT.'])
    H1('Light & Hazards')
    B(['Light X/Y = X squares bright, then Y squares dim. <b>Dim light</b>/light concealment: bane on attacks and '
       'searching. <b>Darkness</b>/heavy concealment/invisible: double bane; vs silent movers, guess their square.',
       '<b>Falling:</b> 1d6 P per 10 ft (reaction RR to reduce: 2 = -1d6, 3 = -2d6). '
       '<b>Suffocation:</b> hold breath 3 + S rounds, then 1d6 dam per round. '
       '<b>Starvation:</b> each day without a ration = 1 starvation wound (all removed when you eat).',
       '<b>Cover</b> (half blocked): bane on attacks against the target.'])

    # ===== Page 2: Combat
    story.append(PageBreak())
    H1('Combat')
    P('<b>Initiative:</b> each round a player rolls 1d10: <b>6+</b> PCs and allies act first, 5 or lower enemies act '
      'first. Players choose their order. <b>Surprised</b> creatures skip round 1 and attacks against them gain +1.')
    P('<b>Your turn:</b> 1 maneuver + 1 action, or 2 maneuvers. Plus <b>1 reaction</b> per round. Boring stuff '
      '(open a door, nock an arrow) is free.')
    H2('Common Maneuvers')
    B(['<b>Move Speed</b> (can split around your action) / <b>Shift</b> 1 square without opportunity attacks.',
       '<b>Draw From Belt</b> (1-2 items), <b>Draw From Pack</b> (d10 roll), <b>Pick Up Item</b>, '
       '<b>Dump Backpack</b>, <b>Stand Up</b>, <b>Command</b> a pet.'])
    TIER('Grab (2d10 + S; your size or smaller, in reach)', 'Target can counter', 'Push 1 or you Shift',
         'Target is grabbed')
    TIER('Escape Grab (2d10 + A or S)', 'Grabber can counter', 'Free, but grabber can counter',
         'Free and move 1 (no opp. attacks)')
    TIER('Knockback (2d10 + S; your size or smaller)', 'Target can counter', 'Push 1', 'Push 2')
    H2('Actions')
    B(['<b>Attack</b> with a wielded weapon or spell. <b>Taunt:</b> a creature within 10 takes a bane on attacks '
       'not including you until your next turn. <b>Ready</b> an action/maneuver with a trigger (uses your reaction).'])
    TIER('Unarmed / improvised (2d10 + A or S)', 'Target can counter', '1 + A or S dam', '2 + A or S dam')
    H2('Attacks')
    B(['<b>Melee:</b> target within reach (humans reach 1). On a miss the target can <b>counter</b>.',
       '<b>Ranged:</b> within range; -2 per square beyond. Bane if an enemy is adjacent to you. On a miss vs a '
       'target adjacent to your allies, roll any die: odd = you hit a random ally for tier 2 damage (doom: '
       'tier 3). Ammo is destroyed; thrown weapons can be recovered.',
       '<b>Crit:</b> you get another action (use it immediately if not your turn).',
       '<b>Flanking</b> (ally on the opposite side): edge on melee. <b>High ground</b> (1+ square above): edge. '
       '<b>Multiple targets:</b> one roll applies to all.'])
    H2('Reactions')
    B(['<b>Counter:</b> when a creature in your melee reach gets tier 1 on a melee attack, Grab, Knockback, or '
       'Escape Grab against you, deal your weapon\'s tier 2 damage (tier 3 if they rolled a doom).',
       '<b>Opportunity attack:</b> when a creature leaves your reach, attack it. A miss can\'t be countered.'])
    H2('Movement')
    B(['Difficult terrain, swimming, climbing: +1 square each. Submerged without swim speed: bane on A/S tests.',
       '<b>Push X</b> straight away; <b>Slide X</b> any direction. Forced moves ignore difficult terrain and '
       'don\'t provoke; mundane forced moves can\'t move creatures larger than you.'])
    TIER('Jump (2d10 + A or S; edge after moving 2+)', 'Jump 0 squares', 'Up to 2 squares, 1 high',
         '2 + A or S squares (min 3), 1 high')
    TIER('Topple object (action, 2d10 + S)', 'It doesn\'t move', 'Topples, but you take 1d6 P', 'It topples')
    P('Dropped objects: 1d10 dam + 2d10 per size category larger than the creature.')
    H2('Weapon Qualities')
    TBL([['Quality', 'Effect'],
         ['Brutal', 'Crit: double damage.'],
         ['Cumbersome', '1 slot in pack/belt, but needs both hands to wield.'],
         ['Disengage', 'Shift moves +1 square (stacks with two weapons).'],
         ['Dismember', 'Crit: roll d6 - 1-2 arm, 3-4 leg, 5 arm or leg, 6 head (dies).'],
         ['Light', 'Hit with melee while wielding two light weapons: + the other weapon\'s tier 2 damage '
                   '(without A/S). An empty hand counts as a light weapon.'],
         ['Parry X', 'Weapon absorbs damage like a shield with AD X; at 0 AD it takes -1 damage.'],
         ['Pummeling', 'Tier 3 vs your size or smaller: push 1. Crit: knock prone.'],
         ['Reload', 'Maneuver to load 1 ammo before each attack.']], [40, 136])
    H1('Pets')
    P('Command a pet with a maneuver (it takes an action or maneuver). For something complex or dangerous: '
      '<b>2d10 + M</b> - 1 refuses; 2 obeys, then weakened; 3 obeys. Ride pets larger than you (you fill 6 of '
      'their slots). Pets eat animal feed during rests.')
    H1('Hirelings')
    B(['Pay each hireling <b>power x 10 gc per day</b> (min 10 gc) plus a day\'s food, at the start of each day.',
       'If one dies in your service, their family is owed their gear, wages, and <b>power x 500 gc</b>. Skip '
       'payments and no hireling will work with your crew.',
       'Hirelings follow PC rules but never gain or spend XP.'])
    H1('Fight Smart')
    B(['Death is on the table. Sneak past, scare, distract, or trap foes before you draw steel.',
       'Prepare the battlefield: choke points, high ground, hiding spots, toppled bookshelves, oil and fire.',
       'Counters are your defensive fighting: stand ready with a melee weapon and punish misses.'])

    # ===== Page 3: Exploration, magic, travel, advancement
    story.append(PageBreak())
    H1('Dungeon Turns (DT)')
    B(['Each DT is <b>30 real-world minutes</b> on a shared timer. At the end of a DT: roll UD, then the Ref makes '
       'an <b>encounter check</b> (1d10 >= EN; default EN 9, lower if crowded or you left chaos behind). Loud '
       'actions also trigger checks.',
       '<b>Greed bonus</b> (first visit): treasure found in DT 1 +30%, DT 2 +20%, DT 3 +10%.'])
    H1('Resting')
    P('6 uninterrupted hours (4 asleep) and eat 1 ration. Regain all Stamina, lose 1 wound, regain expertise uses '
      '(not in the Miasma), recharge spellbooks. Take <b>one rest activity</b>; in town up to 4 per day.')
    TBL([['Activity', 'Benefit'],
         ['Craft Equipment', 'One crafting roll toward an item.'],
         ['Harvest', 'Destroy a corpse for parts: 1d6 (Medium-), 2d6 Large, 3d6 Huge, 4d6 Holy Shit.'],
         ['Identify Item', 'Learn a magic item\'s properties.'],
         ['Prepare for Task', '+2 on a specific, known future task until your next rest.'],
         ['Repair Armor', 'Restore one armor or shield to full AD.'],
         ['Seclude Camp', 'EN +1 during the rest (one per group).'],
         ['Tend Wounds', 'Another creature with 2+ wounds loses 2 wounds instead of 1.']], [48, 128])
    H1('Spellcasting')
    B(['Wield the spellbook in a hand. Casting = <b>Mind test</b>; the book lists outcomes. Roll the book\'s UD '
       'after casting (skip on a crit); books recharge on a rest.',
       '<b>Chaos roll:</b> a non-doom tier 1 casting makes you roll 1d6; on a <b>1</b>, a <b>backlash</b> '
       '(Ref rolls d100 + rank) happens instead. A doom always backlashes.',
       'Casting times: action, maneuver, reaction, or out of combat (10 min). Durations: instant, DT, or UD.'])
    H1('Crafting')
    P('Need the expertise uses, materials, and tools on the card. Crafting roll = Mind test (min 1; doom adds 0; '
      'crit = roll again). An expertise or double edge gives +4 (max 2 expertises). Points accumulate until they '
      'reach the item\'s goal.')
    H1('Overland Travel')
    P('Each day: set pace, take roles (supporters, guide, scouts, trackers), Ref checks for encounters, rest, then '
      'each human makes a <b>Mind RR vs the Miasma</b>. Hexes are 5 miles.')
    TBL([['Pace', 'Hexes', 'EN', 'Role tests'],
         ['Slow', '1', '8', 'edge'], ['Normal', '2', '7', '-'], ['Fast', '3', '6', 'bane']], [40, 30, 30, 76])
    P('Slowest speed 3-: -1 hex; 7-9: +1; 10+: +2. Road all day: +1 hex, EN -1. Crossing/upstream: -1 hex.')
    B(['<b>Guide</b> (M): normal route, safe route, or shortcut (risk getting lost).',
       '<b>Supporter</b>: Fight the Miasma (M), Make Camp (S), Support Everyone (M or S).',
       '<b>Scout</b>: Scout for Danger (A or M), Scout for Shelter (M), Treasure Hunt (S).',
       '<b>Tracker</b>: Forage (M), Hunt (A), Track Specific Creature (M).'])
    TIER('Miasma RR after a rest (2d10 + M)', 'Gain a cruelty level and roll 1d10 + cruelty on Miasma Effects',
         'No effect', 'Remove all cruelty, or improve another human\'s result 1 tier')
    P('Each cruelty level: -1 on Miasma RRs. Lose all cruelty resting where there\'s no Miasma. Resting in the '
      'Miasma doesn\'t restore expertise uses. A result of 13+ on Miasma Effects: your crow becomes an NPC.')
    H1('Advancement')
    P('Recovered treasure (not bought, crafted, taken from innocents, or an ally\'s) grants XP = its gc value / '
      'number of players. Spend XP and gain TXP bonuses only after a rest.')
    TBL([['TXP', 'Bonus', 'Max uses', 'TXP', 'Bonus', 'Max uses'],
         ['100', '1st', '2', '5,000', '6th', '3'],
         ['500', '2nd', '2', '10,000', '7th', '3'],
         ['1,250', '3rd', '2', '20,000', '8th', '4'],
         ['2,250', '4th', '2', '30,000', '9th', '4'],
         ['3,500', '5th', '2', 'each +30,000', '10th+', '4']], [28, 26, 34, 36, 26, 30])
    P('Each bonus: +3 expertise uses, <b>or</b> +2 Stamina max, <b>or</b> +1 use and +1 Stamina. Characteristic '
      '+1 (max 4) at 5,000 / 15,000 / 30,000 TXP and every 30,000 after. <b>Traits:</b> starting traits cost '
      '500 XP; others must connect by a line to a trait you own in that tree (1,000 / 1,500 / 2,000 XP). A '
      'trait never lowers a characteristic-based modifier below 1.')
    H1('Your Village')
    B(['Starts with a blacksmith, crypt, general store, inn, and temple (plus one more institution the group picks), '
       'all 1st level. Prosperity starts at 0. A village cycle is 10 days.',
       'Selling returns 50% of base price at Prosperity -1 to 1 (up to 70% at Prosperity 10).',
       'Your <b>NPC connection</b> gives one benefit (Caretaker, Foodie, Money Bags, Crafty...).',
       'Your home in the village is free; no need to track food or lodging while there.'])
    H1('When a Crow Dies')
    B(['Make a new crow. Roll on the Backgrounds table 1 extra time per Expertise & Stamina bonus the dead crow '
       'had, and choose any result.',
       'If every other crow has 5,000+ TXP, the Ref may start the new crow at the lowest TXP in the party '
       '(and half that in gc for gear).',
       'Inter the fallen in the village crypt to leave a boon for the living.'])

    def on_page(cv, doc):
        cv.saveState()
        cv.setFillColor(INK)
        cv.rect(18, H - 22, 576, 4, stroke=0, fill=1)
        cv.setFont('Times-Bold', 12)
        cv.drawString(18, H - 36, 'CROWS')
        cv.setFont('Helvetica-Bold', 9)
        cv.drawString(66, H - 36, 'Player Cheat Sheet  —  page %d of 3' % doc.page)
        cv.setFont('Helvetica', 6.5)
        cv.drawRightString(594, H - 36, 'Summary of the Crows Playtest 2 rules. The Ref has the final say.')
        cv.setStrokeColor(colors.HexColor('#8a847c'))
        cv.setLineWidth(0.5)
        cv.line(W / 2, 22, W / 2, H - 42)
        cv.restoreState()

    doc = BaseDocTemplate(buf, pagesize=(W, H), leftMargin=18, rightMargin=18, topMargin=44, bottomMargin=18,
                          title='Crows Cheat Sheet')
    cw = 576 / 2
    frames = [Frame(18 + i * (cw + 6), 18, cw - 6, H - 44 - 18, leftPadding=2, rightPadding=2, topPadding=2,
                    bottomPadding=0, id='c%d' % i) for i in range(2)]
    doc.addPageTemplates([PageTemplate(id='p', frames=frames, onPage=on_page)])
    doc.build(story)
    buf.seek(0)
    n = len(PdfReader(buf).pages)
    buf.seek(0)
    if n > 3:
        raise SystemExit('Cheat sheet overflowed to %d pages (max 3)' % n)
    print('cheat sheet pages:', n)
    return buf


def main():
    official, out_dir = sys.argv[1], sys.argv[2]
    stats = stats_page()
    inventory_fields()
    cheat = cheat_sheet()
    w = PdfWriter()
    w.append(PdfReader(stats))
    w.append(PdfReader(official))
    w.append(PdfReader(cheat))
    w.add_metadata({'/Title': 'Crows Character Sheet', '/Author': 'The Nest'})
    with open(out_dir + '/template.pdf', 'wb') as f:
        w.write(f)
    with open(out_dir + '/field_layout.json', 'w') as f:
        json.dump(fields, f, indent=0)
    print('fields:', len(fields))


if __name__ == '__main__':
    main()
