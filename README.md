# clear-mind

Make Claude Code sessions legible.

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

## Usage

**Visualize a session** (shipped):

```sh
clear-mind viz <path/to/transcript.jsonl>            # interactive terminal viewer
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

## Roadmap

`viz` is built. The rest are planned:

2. **Monitor** `clear-mind monitor <path>` — cost · token usage · loss-in-middle
   · verification debt · comprehension rot · cognitive surrender · token blowout
3. **Context detox** `clear-mind detox <path>` — token cleanup · detox polluted
   tool results · remove hallucinated / wrong-assumption content · fact cache
4. [Mind Palace](https://artofmemory.com/blog/how-to-build-a-memory-palace/)
5. Support claude-code first, then maybe codex, opencode, deepagents, cursor, etc.

## Format reference

The session `.jsonl` format is internal and undocumented; these are reverse-
engineered from real session files:

- [session-jsonl-format.md](docs/session-jsonl-format.md) — every record type,
  field by field
- [session-jsonl-mechanics.md](docs/session-jsonl-mechanics.md) — how the file is
  created, updated, and consumed (the DAG, compaction, the writer map)

## Related to

[ponytail](https://github.com/DietrichGebert/ponytail) - I love the idea of combining JavaScript code, hooks, and skills.

[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) - Build production AI agents with Claude Code as a library.

[Ink](https://github.com/vadimdemedes/ink) -  🌈 React for interactive command-line apps.
