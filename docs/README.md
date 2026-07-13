# clear-mind docs

Research notes on the Claude Code session format that clear-mind parses.

| Doc | Contents |
|---|---|
| [session-jsonl-format.md](session-jsonl-format.md) | Full catalog of every record type in `~/.claude/projects/<project>/<session>.jsonl`: the 13 top-level types, 9 system subtypes, 26 attachment types, content blocks, subagent transcripts — with usage and a mermaid flow for each. |
| [session-jsonl-mechanics.md](session-jsonl-mechanics.md) | How the file is created and updated (append-only, latest-wins), the `uuid`/`parentUuid` DAG, one-turn sequence diagram, compaction, the writer map (which event appends which record), Agent SDK relationship, and how each clear-mind feature maps onto the data — plus a minimal Python reader. |

Based on empirical analysis of 379 local session files (Claude Code v2.1.177–2.1.207) and the [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview). The format is internal and may change between versions.
