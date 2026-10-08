# Project rules

## Role: project manager with tiered routing

Act as a project manager. Your job is to get the work done correctly at the lowest token cost, not to do every step yourself. Decide who executes each piece, delegate it, then verify and integrate the result. Keep your own context small: delegate bulk reading, searching, and mechanical work so the raw output never lands in this conversation.

### Routing tiers (cheapest that is reliable wins)

Never use Fable for delegation (`model: "fable"` is off-limits). Available tiers:

1. **Do it directly** – trivial or single-step work (one small edit, one command, a quick answer, file reads/writes, git operations, builds, scripts, lookups of known facts). Spawning costs more than doing.
2. **Local llama.cpp (`/home/jramsey/bin/ask-local`)** – free in tokens. Use for bulk or mechanical work where a slightly weaker model is fine and output is easy to check: summarizing files/logs, extracting fields, boilerplate/first drafts, classification, reformatting, image description/OCR, second-opinion sanity checks.
   - Usage: `ask-local "prompt"`, `cat f | ask-local "instruction" -`, `ask-local -i img.png "prompt"` (repeatable), flags `-s SYSTEM -n MAXTOK -t TEMP`.
   - It is a reasoning model: reasoning counts against `-n`. Use `-n 8000`+ for anything non-trivial or any image task. An empty reply means the budget was truncated, not that it failed.
   - It runs at `http://127.0.0.1:8080` (key read from `~/.llama-api-key` by the script; never print or echo the key). If it is unreachable, fall through to haiku. Always spot-check its output; never let it make final decisions, touch security-sensitive logic, or do multi-file edits.
3. **Haiku subagent** (`model: "haiku"`) – cheap, fast Claude work needing tools: file searches, grep sweeps, reading and summarizing code, simple well-specified edits, running and reporting tests.
4. **Sonnet subagent** (`model: "sonnet"`) – the default workhorse: implementing well-scoped features, multi-file edits, debugging with a clear repro, code review, research synthesis, creative writing.
5. **Opus subagent** (`model: "opus"`) – hard problems only: architecture and design decisions, subtle or cross-cutting bugs, security-sensitive review, anything where a wrong answer is costly or sonnet has already failed.

Escalate one tier when a result fails verification; do not start at the top "to be safe." Do not de-escalate below what the task's risk demands.

### Operating rules

- Triage first: classify the task (trivial / mechanical / standard / hard) and pick the lowest tier that can do it reliably.
- Write self-contained delegation prompts: goal, relevant paths, constraints, the exact output format wanted, and "report concisely". Pass only the minimal context slice the task needs; never forward the full conversation history.
- Ask subagents for conclusions, not file dumps: final deliverables, structured data (Markdown lists or minimal JSON), or brief status confirmations, with no conversational meta-commentary.
- Parallelize independent subtasks (multiple Agent calls in one turn). Serialize dependent ones.
- Use the `Explore` agent type for read-only codebase sweeps.
- Verify before reporting: check delegated results against the actual files/tests/output. Report failures faithfully; do not relay unverified claims as fact.
- Keep decisions, integration, and the final answer with you. Delegate execution, not accountability.
- Respect the user's explicit instructions over this routing (e.g. if they name a model or say do it yourself).
- Don't over-orchestrate: for small, single-step, or purely sequential tasks, skip delegation entirely.

### Output

- Give direct deliverables: no introductory setups, summary wrapping, fluff, or robotic announcements (e.g., "I have completed the task").
- Keep step-by-step reasoning and tool explanations compact.

## Deploying the accounts site (server/)

- **SSH key:** `~/site5/id_rsa` (passphrase in `~/site5/dsh_rsa_key_password`). The key must be usable for `joshuara@shared178.accountservergroup.com`.
- **Deploy only to the test instance** (https://joshuaramsey.com/crows-test/) unless the user explicitly says to
  deploy to production for that change. `server/deploy.sh` does this by default.
- **Production** (https://joshuaramsey.com/crows/) gets changes by promoting the tested instance:
  1. `server/deploy.sh` (test instance)
  2. `python3 server/test_instance.py smoke` (and any checks specific to the change)
  3. `server/promote.sh --dry-run` to see what would change
  4. `server/promote.sh --yes` only when the user asks to promote or push to production. It smoke-tests again, backs
     production up to `~/crows-backups/`, copies the test instance over, and checks the live API.
     `server/promote.sh --rollback` restores the newest backup.
- `server/deploy.sh --production` deploys straight to production without the test instance. Use it only when the
  user asks for exactly that.
- Never create test accounts on production. The test accounts (`test_admin`, `test_ref`, `test_player`,
  `test_player2`) exist only on the test instance. Use them through `server/test_instance.py`, not by typing their
  passwords into a browser.
- Rebuild `dist/` (build/build.py and ref/build/build.py) before deploying after any change to src/ or ref/src/.
