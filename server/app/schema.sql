-- The Nest accounts: users, login sessions, saved characters and campaigns.
-- Applied by install.php (safe to re-run: every statement is IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(32) NOT NULL,
  email VARCHAR(190) NOT NULL,
  pass_hash VARCHAR(255) NOT NULL,
  role ENUM('player','ref') NOT NULL DEFAULT 'player',
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  last_login DATETIME NULL,
  UNIQUE KEY uq_username (username),
  UNIQUE KEY uq_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  csrf CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  KEY k_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  KEY k_user (user_id),
  CONSTRAINT fk_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ip VARCHAR(45) NOT NULL,
  login VARCHAR(190) NOT NULL,
  at DATETIME NOT NULL,
  KEY k_ip (ip, at),
  KEY k_login (login, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Characters (players) and campaigns (Refs) share one shape: the app's own JSON save in `data`,
-- plus a name and one-line summary for lists. `version` goes up on every save so two open
-- windows can't silently overwrite each other.
CREATE TABLE IF NOT EXISTS characters (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL DEFAULT '',
  summary VARCHAR(255) NOT NULL DEFAULT '',
  data MEDIUMTEXT NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY k_user (user_id, updated_at),
  CONSTRAINT fk_characters_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS campaigns (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL DEFAULT '',
  summary VARCHAR(255) NOT NULL DEFAULT '',
  data MEDIUMTEXT NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY k_user (user_id, updated_at),
  CONSTRAINT fk_campaigns_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Security events (logins, account changes, admin actions), kept 180 days. No passwords or tokens.
CREATE TABLE IF NOT EXISTS audit_log (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at DATETIME NOT NULL,
  event VARCHAR(40) NOT NULL,
  user_id INT UNSIGNED NULL,
  actor_id INT UNSIGNED NULL,
  ip VARCHAR(45) NOT NULL,
  detail VARCHAR(255) NOT NULL DEFAULT '',
  KEY k_at (at),
  KEY k_user (user_id, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A player's share link for one character (only the token's hash is kept). Making a new link replaces the old one.
CREATE TABLE IF NOT EXISTS share_links (
  character_id INT UNSIGNED NOT NULL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_token (token_hash),
  CONSTRAINT fk_share_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A Ref who added a shared character to a campaign: they can read it and change its conditions,
-- equipment, and notes until the player (or the Ref) removes the access.
CREATE TABLE IF NOT EXISTS character_access (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  character_id INT UNSIGNED NOT NULL,
  ref_user_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_char_ref (character_id, ref_user_id),
  KEY k_ref (ref_user_id),
  CONSTRAINT fk_access_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  CONSTRAINT fk_access_ref FOREIGN KEY (ref_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A Ref's invite link for one campaign (only the token's hash is kept). Making a new link replaces the old one.
CREATE TABLE IF NOT EXISTS campaign_invites (
  campaign_id INT UNSIGNED NOT NULL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_token (token_hash),
  CONSTRAINT fk_invite_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A player asking, through an invite link, to bring one of their characters into a campaign. Accepting it
-- gives the campaign's Ref a character_access row, just as a character link would.
CREATE TABLE IF NOT EXISTS join_requests (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT UNSIGNED NOT NULL,
  character_id INT UNSIGNED NOT NULL,
  status ENUM('pending','accepted','declined') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL,
  decided_at DATETIME NULL,
  UNIQUE KEY uq_campaign_character (campaign_id, character_id),
  KEY k_character (character_id),
  CONSTRAINT fk_join_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_join_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Messages for a user, shown in the apps and on the home page until dismissed (e.g. "your crow was accepted
-- into a campaign"). `detail` is JSON the pages turn into text. Seen ones are cleared after 90 days.
CREATE TABLE IF NOT EXISTS notifications (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  kind VARCHAR(30) NOT NULL,
  detail TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  seen_at DATETIME NULL,
  KEY k_user (user_id, seen_at),
  CONSTRAINT fk_notes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which emails a user wants. No row means the defaults (all on). new_accounts only matters for admins.
CREATE TABLE IF NOT EXISTS email_prefs (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  join_decisions TINYINT(1) NOT NULL DEFAULT 1,
  new_accounts TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_prefs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Two-step login (see mfa.php). Every account sets one up: an authenticator app (secret encrypted with
-- mfa.key; last_step stops a code being used twice) or a code emailed at each login.
CREATE TABLE IF NOT EXISTS mfa (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  method ENUM('totp','email') NOT NULL,
  secret VARCHAR(255) NULL,
  last_step BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_mfa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One-time recovery codes (hashes only), for when the phone or mailbox isn't at hand.
CREATE TABLE IF NOT EXISTS mfa_recovery (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  code_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  KEY k_user (user_id),
  CONSTRAINT fk_recovery_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A login (or setup) waiting for its second step: made after a correct password, before any session exists.
CREATE TABLE IF NOT EXISTS mfa_challenges (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  purpose ENUM('login','setup') NOT NULL,
  method ENUM('totp','email') NULL,
  secret VARCHAR(255) NULL,
  code_hash CHAR(64) NULL,
  code_sent_at DATETIME NULL,
  sends TINYINT UNSIGNED NOT NULL DEFAULT 0,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  KEY k_user (user_id),
  CONSTRAINT fk_challenge_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A fight the Ref is running, as the players see it: the Ref Screen publishes the combat tracker's public
-- side (round, initiative, enemies' names and how hurt they look, the crows, a short feed) whenever it changes.
-- `version` is a millisecond timestamp, so the change signals of every crow in it only ever go up.
CREATE TABLE IF NOT EXISTS combats (
  campaign_id INT UNSIGNED NOT NULL PRIMARY KEY,
  data MEDIUMTEXT NOT NULL,
  version BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME NOT NULL,
  CONSTRAINT fk_combats_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The linked crows in that fight: their players can see it and act in it.
CREATE TABLE IF NOT EXISTS combat_members (
  campaign_id INT UNSIGNED NOT NULL,
  character_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (campaign_id, character_id),
  KEY k_character (character_id),
  CONSTRAINT fk_cmember_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_cmember_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What players did in a fight (an attack on a target, a declared action, done for the round), for the Ref
-- Screen to pick up. `data` is the action as JSON. Only the newest few hundred per campaign are kept.
CREATE TABLE IF NOT EXISTS combat_actions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT UNSIGNED NOT NULL,
  character_id INT UNSIGNED NOT NULL,
  data TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  KEY k_campaign (campaign_id, id),
  KEY k_character (character_id, created_at),
  CONSTRAINT fk_caction_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_caction_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
