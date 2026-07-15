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

2. 📊 **Monitor** — `clear-mind monitor <path/to/your/transcript.jsonl>` — _planned_

    - Cost
    - Token Usage
    - Loss in middle
    - Verification debt
    - Comprehension rot
    - Cognitive surrender
    - Token blowout

3. 🧹 **Context detox** — `clear-mind detox <path/to/your/transcript.jsonl>` — _planned_

    - Token cleanup
    - Detox polluted tool results
    - Remove hallucinated / wrong-assumption content
    - Fact cache

4. 🏛️ [Mind Palace](https://artofmemory.com/blog/how-to-build-a-memory-palace/) — _planned_

5. 🤝 **Share Mind** — one shared mind across your codebases — _planned_

    - each repo's agent keeps its own head; clear-mind reads every session,
      distills what each agent learned, and holds it in one provenance-tagged store
    - reading: agents query the store over MCP
    - delivery: event-driven, no polling — each agent runs a blocking
      background listener (`inotifywait` on its inbox) that exits when a
      message lands, and the harness re-invokes the agent on background-task
      exit; hooks (`UserPromptSubmit`/`Stop`) drain the backlog on normal
      turns; a closed session is woken by a watcher spawning `claude -p`
      headless — clear-mind stays the medium, never the messenger: the
      agent's own listener does the injecting

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
  tallies. Keys: `j/k` scroll · `⇥`/`⇧⇥` next/prev fold · `⏎` open · `e`/`c`
  expand/collapse all · `q` quit. Needs a real terminal.
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