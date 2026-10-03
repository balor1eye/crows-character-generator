<?php
/*
 * Campaign chat. Every campaign has one chat, for its Ref (the campaign's owner) and the players whose crows are in it
 * (crows in its party, or accepted into it, whose owner or delegate is a player). Three kinds of message:
 *   chat     everyone in the campaign sees it
 *   announce the Ref's notice to all the players: also a notification on each player's pages, and optionally an email
 *   private  between the Ref and one player (a player's always goes to the Ref; the Ref picks who). Nobody else sees it.
 * The page watches the change signal ('chat', campaign id), whose version is the newest message id.
 * Included by api.php, which supplies q(), fail(), body(), str(), notify(), send_mail() and the rest.
 */
const CHAT_MAX_LEN = 2000;
const CHAT_KEEP = 2000;          // messages kept per campaign
const CHAT_RATE = 20;            // messages one person may send per minute
const CHAT_MAIL_GAP = 1800;      // seconds between emails about private messages from one person

/** The players of a campaign: user id => ['username' => ..., 'crows' => [names]]. The Ref is not listed. */
function chat_members(int $campaignId, int $refId): array {
    static $cache = [];
    if (isset($cache[$campaignId])) return $cache[$campaignId];
    $data = q('SELECT data FROM campaigns WHERE id = ?', [$campaignId])->fetchColumn();
    $party = is_string($data) ? (json_decode($data, true)['party'] ?? null) : null;
    $links = [];
    if (is_array($party)) foreach ($party as $pc) if (is_array($pc) && isset($pc['link']) && is_numeric($pc['link'])) $links[] = (int)$pc['link'];
    $chars = [];
    if ($links) {
        $in = implode(',', array_fill(0, count($links), '?'));
        foreach (q("SELECT character_id FROM character_access WHERE ref_user_id = ? AND id IN ($in)", array_merge([$refId], $links))->fetchAll(PDO::FETCH_COLUMN) as $c) $chars[(int)$c] = true;
    }
    foreach (q("SELECT j.character_id FROM join_requests j JOIN character_access a ON a.character_id = j.character_id AND a.ref_user_id = ?
                WHERE j.campaign_id = ? AND j.status = 'accepted'", [$refId, $campaignId])->fetchAll(PDO::FETCH_COLUMN) as $c) $chars[(int)$c] = true;
    $out = [];
    if ($chars) {
        $in = implode(',', array_fill(0, count($chars), '?'));
        $rows = q("SELECT c.name, c.user_id, k.user_id AS ctl FROM characters c LEFT JOIN character_control k ON k.character_id = c.id WHERE c.id IN ($in)", array_keys($chars))->fetchAll();
        $crows = [];
        foreach ($rows as $r) foreach (array_filter([(int)$r['user_id'], (int)$r['ctl']]) as $uid) {
            if ($uid !== $refId) $crows[$uid][] = $r['name'] !== '' ? $r['name'] : 'Unnamed crow';
        }
        if ($crows) {
            $in = implode(',', array_fill(0, count($crows), '?'));
            foreach (q("SELECT id, username FROM users WHERE id IN ($in)", array_keys($crows))->fetchAll() as $u) {
                $out[(int)$u['id']] = ['username' => $u['username'], 'crows' => array_values(array_unique($crows[(int)$u['id']]))];
            }
        }
    }
    return $cache[$campaignId] = $out;
}

/** The campaign if this user is its Ref or one of its players, with 'isRef' and 'members'; otherwise a 404. */
function chat_access(array $s, int $cid): array {
    $c = q('SELECT c.id, c.name, c.user_id, u.username AS ref FROM campaigns c JOIN users u ON u.id = c.user_id WHERE c.id = ?', [$cid])->fetch();
    if (!$c) fail('That campaign was not found.', 404);
    $m = chat_members($cid, (int)$c['user_id']);
    $isRef = (int)$c['user_id'] === $s['id'];
    if (!$isRef && !isset($m[$s['id']])) fail('That campaign was not found.', 404);
    return $c + ['isRef' => $isRef, 'members' => $m];
}

/** SQL (and its parameters) for the messages this user may read: all public ones, their own private ones, and every private one for the Ref. */
function chat_visible(array $s, bool $isRef, string $t = ''): array {
    return $isRef ? ['1=1', []] : ["({$t}kind <> 'private' OR {$t}sender_id = ? OR {$t}to_user_id = ?)", [$s['id'], $s['id']]];
}
function chat_name(array $c): string { return $c['name'] !== '' ? $c['name'] : 'Untitled campaign'; }

/** The campaigns this user can chat in: their own (as Ref) and the ones their crows are in, with unread counts. */
function a_chat_campaigns(): array {
    $s = need_login();
    $camps = [];
    foreach (q('SELECT c.id, c.name, c.user_id, u.username AS ref FROM campaigns c JOIN users u ON u.id = c.user_id WHERE c.user_id = ?', [$s['id']])->fetchAll() as $c) $camps[(int)$c['id']] = $c;
    $refs = q('SELECT DISTINCT a.ref_user_id FROM character_access a JOIN characters ch ON ch.id = a.character_id
               WHERE ch.user_id = ? OR ch.id IN (SELECT character_id FROM character_control WHERE user_id = ?)', [$s['id'], $s['id']])->fetchAll(PDO::FETCH_COLUMN);
    foreach ($refs as $refId) {
        foreach (q('SELECT c.id, c.name, c.user_id, u.username AS ref FROM campaigns c JOIN users u ON u.id = c.user_id WHERE c.user_id = ?', [(int)$refId])->fetchAll() as $c) {
            if (!isset($camps[(int)$c['id']]) && isset(chat_members((int)$c['id'], (int)$c['user_id'])[$s['id']])) $camps[(int)$c['id']] = $c;
        }
    }
    $items = [];
    foreach ($camps as $id => $c) {
        $isRef = (int)$c['user_id'] === $s['id'];
        [$vis, $vp] = chat_visible($s, $isRef, 'm.');
        $last = (int)q('SELECT last_id FROM chat_reads WHERE user_id = ? AND campaign_id = ?', [$s['id'], $id])->fetchColumn();
        $unread = (int)q("SELECT COUNT(*) FROM chat_messages m WHERE m.campaign_id = ? AND m.id > ? AND m.sender_id <> ? AND $vis", array_merge([$id, $last, $s['id']], $vp))->fetchColumn();
        $latest = q("SELECT m.body, m.created_at, u.username FROM chat_messages m JOIN users u ON u.id = m.sender_id WHERE m.campaign_id = ? AND $vis ORDER BY m.id DESC LIMIT 1",
            array_merge([$id], $vp))->fetch();
        $items[] = ['id' => $id, 'name' => chat_name($c), 'ref' => $c['ref'], 'isRef' => $isRef, 'unread' => $unread,
                    'players' => count(chat_members($id, (int)$c['user_id'])),
                    'last' => $latest ? ['from' => $latest['username'], 'text' => mb_substr($latest['body'], 0, 80), 'at' => $latest['created_at'] . 'Z'] : null];
    }
    usort($items, fn($a, $b) => ($b['unread'] <=> $a['unread']) ?: strcmp($b['last']['at'] ?? '', $a['last']['at'] ?? ''));
    return ['campaigns' => $items];
}

function chat_msg_out(array $r, array $s): array {
    return ['id' => (int)$r['id'], 'kind' => $r['kind'], 'from' => $r['sender'], 'mine' => (int)$r['sender_id'] === $s['id'],
            'to' => $r['recipient'], 'text' => $r['body'], 'at' => $r['created_at'] . 'Z'];
}

/** Messages in a campaign's chat: the newest 200, or those after ?after=<id>. With ?read=1 they count as read. */
function a_chat_list(): array {
    $s = need_login();
    $cid = combat_campaign_id();
    $c = chat_access($s, $cid);
    [$vis, $vp] = chat_visible($s, $c['isRef'], 'm.');
    $after = (int)($_GET['after'] ?? 0);
    $sel = "SELECT m.id, m.kind, m.sender_id, m.body, m.created_at, u.username AS sender, t.username AS recipient FROM chat_messages m
            JOIN users u ON u.id = m.sender_id LEFT JOIN users t ON t.id = m.to_user_id WHERE m.campaign_id = ?";
    if ($after > 0) $rows = q("$sel AND m.id > ? AND $vis ORDER BY m.id LIMIT 200", array_merge([$cid, $after], $vp))->fetchAll();
    else $rows = array_reverse(q("$sel AND $vis ORDER BY m.id DESC LIMIT 200", array_merge([$cid], $vp))->fetchAll());
    $latest = (int)q('SELECT COALESCE(MAX(id), 0) FROM chat_messages WHERE campaign_id = ?', [$cid])->fetchColumn();
    if (!empty($_GET['read']) && $rows) chat_mark_read($s, $cid, (int)end($rows)['id']);
    elseif (!empty($_GET['read'])) chat_mark_read($s, $cid, 0);
    $o = with_watch(['version' => $latest], 'chat', $cid);
    return ['campaign' => ['id' => $cid, 'name' => chat_name($c), 'ref' => $c['ref']], 'isRef' => $c['isRef'], 'latest' => $latest, 'watch' => $o['watch'] ?? null,
            'members' => array_values($c['members']), 'messages' => array_map(fn($r) => chat_msg_out($r, $s), $rows)];
}

function chat_mark_read(array $s, int $cid, int $upTo): void {
    if ($upTo > 0) q('INSERT INTO chat_reads (user_id, campaign_id, last_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE last_id = GREATEST(last_id, VALUES(last_id))', [$s['id'], $cid, $upTo]);
    // Notifications about this chat are answered by looking at it.
    foreach (q("SELECT id, detail FROM notifications WHERE user_id = ? AND seen_at IS NULL AND kind IN ('chat_announce','chat_private')", [$s['id']])->fetchAll() as $n) {
        $d = json_decode($n['detail'], true);
        if ((int)($d['campaignId'] ?? 0) === $cid) q('UPDATE notifications SET seen_at = ? WHERE id = ?', [now(), $n['id']]);
    }
}

/** A chat notification for a user; a second private message from the same person waits behind the first. */
function chat_notify(int $uid, string $kind, array $d): void {
    if ($kind === 'chat_private') {
        foreach (q("SELECT detail FROM notifications WHERE user_id = ? AND kind = 'chat_private' AND seen_at IS NULL", [$uid])->fetchAll(PDO::FETCH_COLUMN) as $j) {
            $o = json_decode($j, true);
            if ((int)($o['campaignId'] ?? 0) === $d['campaignId'] && ($o['from'] ?? '') === $d['from']) return;
        }
    }
    notify($uid, $kind, $d);
}

function chat_mail(int $uid, string $subject, string $text): bool {
    try {
        if (!wants_email($uid, 'chatAlerts')) return false;
        $u = q('SELECT username, email FROM users WHERE id = ?', [$uid])->fetch();
        if (!$u) return false;
        return send_mail($u['email'], $subject, "Hi {$u['username']},\n\n$text\n" . prefs_footer());
    } catch (Throwable $e) { error_log('crows chat mail: ' . $e->getMessage()); return false; }
}

const CHAT_KINDS = ['chat', 'announce', 'private'];
function a_chat_send(): array {
    $s = need_login();
    $cid = combat_campaign_id();
    $c = chat_access($s, $cid);
    $kind = body()['kind'] ?? 'chat';
    if (!in_array($kind, CHAT_KINDS, true)) fail('Unknown kind of message.');
    $text = trim(preg_replace("/\n{3,}/", "\n\n", str_replace("\r", '', str('text', 12000))));
    $text = mb_substr($text, 0, CHAT_MAX_LEN);
    if ($text === '') fail('Write a message first.');
    if ($kind === 'announce' && !$c['isRef']) fail('Only the Ref can send announcements.', 403);
    $to = null; $toName = null;
    if ($kind === 'private') {
        if ($c['isRef']) {
            $want = trim(str('to', 64));
            foreach ($c['members'] as $uid => $m) if (strcasecmp($m['username'], $want) === 0) { $to = $uid; $toName = $m['username']; }
            if ($to === null) fail('Pick which player to message.');
        } else { $to = (int)$c['user_id']; $toName = $c['ref']; }
    }
    if ((int)q('SELECT COUNT(*) FROM chat_messages WHERE sender_id = ? AND created_at > ?', [$s['id'], now(-60)])->fetchColumn() >= CHAT_RATE) {
        fail('Slow down a little: you\'re sending messages too quickly.', 429);
    }
    $prev = $kind === 'private' ? q("SELECT MAX(created_at) FROM chat_messages WHERE campaign_id = ? AND kind = 'private' AND sender_id = ? AND to_user_id = ?", [$cid, $s['id'], $to])->fetchColumn() : null;
    q('INSERT INTO chat_messages (campaign_id, sender_id, kind, to_user_id, body, created_at) VALUES (?,?,?,?,?,?)', [$cid, $s['id'], $kind, $to, $text, now()]);
    $id = (int)db()->lastInsertId();
    signal('chat', $cid, $id);
    chat_mark_read($s, $cid, $id);
    // Keep the newest CHAT_KEEP messages.
    $cut = q('SELECT id FROM chat_messages WHERE campaign_id = ? ORDER BY id DESC LIMIT 1 OFFSET ' . CHAT_KEEP, [$cid])->fetchColumn();
    if ($cut) q('DELETE FROM chat_messages WHERE campaign_id = ? AND id <= ?', [$cid, $cut]);

    $camp = chat_name($c);
    $link = site_link('#chat=' . $cid);
    $emailed = 0;
    $snippet = mb_substr($text, 0, 160);
    if ($kind === 'announce') {
        $email = !empty(body()['email']);
        foreach ($c['members'] as $uid => $m) {
            chat_notify((int)$uid, 'chat_announce', ['campaign' => $camp, 'campaignId' => $cid, 'from' => $s['username'], 'text' => $snippet]);
            if ($email && chat_mail((int)$uid, "$camp: announcement from {$s['username']}", "{$s['username']}, your Ref in $camp, sent everyone this announcement:\n\n$text\n\nReply in the campaign chat:\n$link\n")) $emailed++;
        }
        audit('chat_announce', $s['id'], 'campaign ' . $cid . ', ' . count($c['members']) . ' players' . ($email ? ', emailed' : ''));
    } elseif ($kind === 'private') {
        chat_notify($to, 'chat_private', ['campaign' => $camp, 'campaignId' => $cid, 'from' => $s['username'], 'text' => $snippet]);
        if (!$prev || strtotime($prev . ' UTC') < time() - CHAT_MAIL_GAP) {
            if (chat_mail($to, "$camp: private message from {$s['username']}", "{$s['username']} sent you a private message in $camp:\n\n$text\n\nReply in the campaign chat:\n$link\n")) $emailed++;
        }
    }
    return ['id' => $id, 'emailed' => $emailed, 'players' => count($c['members'])];
}

/** The Ref (any message) or a message's sender removes it. */
function a_chat_delete(): array {
    $s = need_login();
    $m = q('SELECT id, campaign_id, sender_id FROM chat_messages WHERE id = ?', [record_id()])->fetch();
    if (!$m) return [];
    $c = chat_access($s, (int)$m['campaign_id']);
    if (!$c['isRef'] && (int)$m['sender_id'] !== $s['id']) fail('You can only remove your own messages.', 403);
    q('DELETE FROM chat_messages WHERE id = ?', [$m['id']]);
    return [];
}
