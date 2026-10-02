# Project rules

# CALLING CLAUDE CODE (Claude / Anthropic models)

Claude Code (`claude`) is available as a subprocess. Use it selectively — defer to it only when its capabilities or training genuinely outperform the local model for the task:

- **Defer to Claude Code** for complex reasoning, nuanced analysis, creative writing, code review or architecture decisions, and tasks that benefit from up-to-date training data where the quality delta matters.
- **Do it yourself** for simple file edits/reads/writes, git operations, builds, scripts, lookups of known facts, or anything where the round-trip overhead outweighs the quality gain.
- Never route everything through Claude Code just because it's available.

# AGENT EFFICIENCY & SUBAGENT PROTOCOL

## 1. Subagent Invocation & Lifecycle
- **Strict Necessity Only:** Do NOT spawn subagents for single-step, low-complexity, or purely sequential tasks. Handle these directly in the primary context.
- **Minimal Context Delegation:** When spawning a subagent, pass ONLY the minimal necessary task prompt, raw context slice, and explicit target parameters. Never forward the full conversation history.
- **Clear Termination:** Instruct subagents to return *only* final deliverables, structured data, or brief status confirmations. Prohibit conversational meta-commentary from subagents.
- **Parallel Dispatch:** If multiple independent sub-tasks are needed, dispatch subagents in parallel in a single turn rather than sequentially.

## 2. Output & Token Minimization
- **Direct Deliverables:** Omit introductory setups, summary wrapping, fluff, and robotic announcements (e.g., "I have completed the task").
- **Concise Reasoning:** Keep step-by-step thinking or internal tool explanations as compact as possible.
- **Structured Inter-Agent Formats:** When subagents report back to the orchestrator, use raw Markdown lists or minimal JSON rather than long narrative summaries.

## Deploying the accounts site (server/)

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
