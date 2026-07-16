# 🧠 clear-mind

Make Claude Code sessions legible — because your agent's context window is a
hoarder's garage. 🗑️

Every Claude Code session is persisted as an append-only `.jsonl` log — every
prompt, model response, tool call, and token count. `clear-mind` reads that log
and turns it into something you can actually see and reason about: a transcript
viewer today, and — on the roadmap — monitors for cost and context rot, plus a
context "detox".

## Setup

```sh
bun install
bun run typecheck        # optional: verify the checkout
bun link                 # puts the `clear-mind` command on your PATH
```

## Features

1. 👁️ **Visualize session jsonl** — `clear-mind viz <path/to/your/transcript.jsonl>` — **built**

    - live interactive terminal viewer (Ink TUI) — follows the session as it
      grows, appending in place (scroll and fold state survive): scroll, Tab between folds,
      ⏎ to expand thinking/tool detail, `q` to quit
    - `--html [out]` exports a chat-style page instead (markdown,
      collapsible thinking/tool folds, paired call→result)

2. 📊 **Monitor** — _planned_

    - two scopes: **per session** (`monitor <transcript.jsonl>`) and **per
      codebase** (`monitor <project-dir>`, aggregating every session under
      `~/.claude/projects/<slug>/`)
    - **live TUI dashboard** (per session) — reuses the viz follower, but
      renders a fixed grid of stat tiles that recompute each tick instead of a
      scrolling transcript. Headline gauge: current context size climbing
      toward the compaction limit; plus running cost and per-turn sparklines
    - **Cost** is _derived_, not read — the log has token counts, no cost
      field. Compute `tokens × per-model rate` from each `assistant` record's
      `usage` + `model`, pricing input / output / cache-read / cache-write
      separately (rates live in a small model→price table). Dedupe by
      `requestId` before summing (usage is duplicated across the records of one
      response), and — for codebase scope — dedupe across files, since forked
      sessions can copy history
    - straightforward metrics: **Token Usage**, **Token blowout**
      (`compact_boundary` preTokens→postTokens drops)
    - harder behavioral signals — heuristic, all _planned_:
        - **Loss in middle** — token distance between where a fact entered (a
          `tool_result`) and where it's used again
        - **Verification debt** — `Edit`/`Write` tool calls not followed by a
          verifying `Bash`/`Read`/test before `end_turn`
        - **Comprehension rot** — repeated `Read`s of the same `filePath`
          across the session
        - **Cognitive surrender** — high `turn_duration` while assistant text
          tokens stay low; interrupt records (`interruptedMessageId`)

3. 🧹 **Context detox** — `clear-mind detox <path/to/your/transcript.jsonl>` — _planned_

    - Token cleanup
    - Detox polluted tool results
    - Remove hallucinated / wrong-assumption content
    - Fact cache

4. 🏛️ [Mind Palace](https://artofmemory.com/blog/how-to-build-a-memory-palace/) — _planned_

5. 🤝 **Share Mind** — one shared mind across your codebases — _planned_

    - each repo's agent keeps its own head; clear-mind reads every session,
      distills what each agent learned, and holds it in one provenance-tagged store?
    - reading: agents query the store over MCP
    - delivery: event-driven, no polling

6. 🔌 Support claude-code first, then maybe codex, opencode, deepagents, cursor, etc.

## Usage

**Visualize a session** (shipped):

```sh
clear-mind viz <path/to/transcript.jsonl>            # live terminal viewer (follows the file)
clear-mind viz <path/to/transcript.jsonl> --html     # → <session>.html
```

Sessions live under `~/.claude/projects/<cwd-slug>/<session-uuid>.jsonl`, where
`<cwd-slug>` is the project's path with `/` replaced by `-`.

- **TUI** — a chat-style, keyboard-driven view: Human/Assistant turns, collapsible
  thinking and tool-call folds (call paired with its result), per-turn token
  tallies. Keys: `j/k` scroll · `g`/`G` jump to head/end (`G` re-engages live
  follow) · `⇥`/`⇧⇥` next/prev fold · `⏎` open · `e`/`c` expand/collapse all ·
  `q` quit. Needs a real terminal.
- **`--html`** — a single self-contained page (no JS, no external assets) with
  the same layout, markdown-rendered, foldable via native `<details>`. Pipe-safe;
  good for sharing or grepping.

## Related to

[Ink](https://github.com/vadimdemedes/ink) -  🌈 React for interactive command-line apps.

[Zod](https://zod.dev/) - TypeScript-first schema validation with static type inference

[ponytail](https://github.com/DietrichGebert/ponytail) - I love the idea of combining JavaScript code, hooks, and skills.

[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) - Build production AI agents with Claude Code as a library.

[Claude Code Loops](https://claude.ai/public/artifacts/11bdc800-3d82-4cd1-8a05-a82ae516f8cb) - An applied coursebook on Claude Code loops.

[Claude - Hooks reference](https://code.claude.com/docs/en/hooks) - Reference for Claude Code hook events.