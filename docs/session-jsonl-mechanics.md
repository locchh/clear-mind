# Session JSONL — Creation, Update & Consumption Mechanics

Companion to [session-jsonl-format.md](session-jsonl-format.md) (the record catalog). This doc covers **how the file comes to exist, how records get added, how "updates" work, and how to use it** — including the Agent SDK relationship and what it means for clear-mind.

## 1. Creation lifecycle

A session file is created lazily when the first record is written (typically at session start):

```mermaid
flowchart TD
    START[claude launched in /home/locch/Works/clear-mind] --> SID[generate session UUID]
    SID --> DIR["project dir = cwd with '/' → '-'<br/>~/.claude/projects/-home-locch-Works-clear-mind/"]
    DIR --> FILE["create &lt;session-uuid&gt;.jsonl"]
    FILE --> INIT["append initial metadata records<br/>(mode, permission-mode)"]
    INIT --> LOOP[event loop: every event appends one line]
    LOOP --> END[process exits — no finalization,<br/>file is already complete]
```

Key properties:

- **One writer**: the Claude Code process owns the file for the session's lifetime.
- **Append-only**: every event is one `JSON.stringify(record) + "\n"` appended to the end. Existing lines are **never modified or deleted**. This is why the file is always valid and crash-safe — a crash loses at most the last partial line.
- **No finalization**: there is no "session end" footer. A session is "over" when nothing appends anymore; it can be resumed at any time by appending more.

## 2. The update mechanism: append-latest-wins

Nothing is ever updated in place. "Updating" a value means **appending a new record of the same type**; readers scan the file and keep the last occurrence:

- `ai-title` appears up to 12× in one session — the title regenerates as the topic drifts; the last one is the current title.
- `mode` / `permission-mode` re-append on every switch (observed >1 per file in 100 files).
- `last-prompt` re-appends after every user prompt.
- `file-history-snapshot` appends follow-ups with `isSnapshotUpdate: true` and the same `messageId` rather than editing the original snapshot.

```mermaid
flowchart LR
    subgraph "file over time (append-only)"
        L1["{type: ai-title, aiTitle: 'Study Ponytail repo'}"] --> L2["...more records..."]
        L2 --> L3["{type: ai-title, aiTitle: 'Analyze session jsonl'}"]
    end
    L3 --> READER[reader scans file,<br/>last ai-title wins]
```

This is an **event-sourcing** design: the file is a log of facts, and any "current state" (title, mode, queue contents, file backups) is derived by replaying it.

## 3. The conversation DAG: `uuid` / `parentUuid`

Conversation records don't form a flat list — they form a **linked tree**:

- every `user`/`assistant`/`system`/`attachment` record has a `uuid` and a `parentUuid` pointing at the record it follows
- the first record of a session has `parentUuid: null`
- **branching**: when the user edits/rewinds to an earlier message, the new branch's first record points at that earlier `uuid` — both branches remain in the file; only the active branch is sent to the model
- `last-prompt.leafUuid` tells you which leaf is the active branch head
- `promptId` groups the `user` records of one turn (typed prompt + its tool results) — verified absent on `assistant`/`system`/`attachment` records, which link to the turn only via `parentUuid`
- tool results link back two ways: `parentUuid` (chain position) and `sourceToolAssistantUUID` (+ block-level `tool_use_id`) to the assistant record that requested them

```mermaid
flowchart TD
    R0["user #1 (parentUuid: null)"] --> A1[assistant #1]
    A1 --> U2["user #2"]
    U2 --> A2[assistant #2 — user didn't like this]
    A1 -.->|"user edits msg #2 → new branch<br/>parentUuid = assistant #1 (U2's parent), NOT U2<br/>→ U2' is a sibling of U2, not its child"| U2b["user #2' (edited)"]
    U2b --> A2b[assistant #2']
    A2b --> LEAF["...active branch...<br/>(last-prompt.leafUuid points here)"]
    A2 -.-> DEAD[abandoned branch — still in file, never sent to model]
```

## 4. Anatomy of one turn (full sequence)

What actually lands in the file when you send one message that triggers two tool calls:

```mermaid
sequenceDiagram
    participant U as User
    participant CC as Claude Code (writer)
    participant F as session.jsonl
    participant API as Claude API

    U->>CC: types prompt
    CC->>F: append last-prompt (metadata — position varies, often here, sometimes mid-turn)
    CC->>F: append file-history-snapshot
    CC->>F: append user record (promptSource: typed)
    CC->>F: append attachment records (IDE state, tool deltas, reminders…)
    CC->>API: request (active branch as context)
    API-->>CC: response (thinking + tool_use)
    CC->>F: append assistant record (with usage)
    CC->>CC: execute tool
    CC->>F: append user record (tool_result + toolUseResult)
    CC->>API: request
    API-->>CC: response (tool_use again)
    CC->>F: append assistant record
    CC->>CC: execute tool
    CC->>F: append user record (tool_result)
    CC->>API: request
    API-->>CC: response (text, stop_reason: end_turn)
    CC->>F: append assistant record (final text)
    CC->>F: append system record (turn_duration)
    Note over CC,F: occasionally: ai-title regenerated → append ai-title
```

## 5. Compaction

When context approaches the window limit (or the user runs `/compact`):

```mermaid
flowchart TD
    FULL["context ≈ full<br/>(e.g. 199k tokens)"] --> SUM[model writes a summary of older history]
    SUM --> B["append system/compact_boundary<br/>parentUuid: null · logicalParentUuid: old leaf<br/>compactMetadata: {trigger, preTokens: 199173, postTokens: 136769, preservedSegment}"]
    B --> CS["append user record (isCompactSummary: true)<br/>= the summary text"]
    CS --> GO[conversation continues from the boundary<br/>+ preserved recent segment]
    B -.->|old records stay in the file,<br/>just no longer sent to the model| OLD[(pre-compact history preserved on disk)]
```

Crucial detail for analysis tools: **the jsonl keeps the full pre-compact history** — only the model's view shrinks. `preTokens - postTokens` is the reclaimed amount; `preservedSegment` lists exactly which recent uuids survived verbatim.

## 6. How each kind of record gets added (writer map)

| Trigger | Records appended |
|---|---|
| Session start | `mode`, `permission-mode` |
| User sends prompt | `last-prompt`, `file-history-snapshot`, `user`, `attachment`* (verified order: snapshot immediately precedes the typed `user`; `last-prompt`'s exact position varies) |
| API response arrives | `assistant` |
| Tool finishes | `user` (tool_result) |
| Turn completes | `system/turn_duration` |
| File edited by tool | `file-history-snapshot` (`isSnapshotUpdate: true`) |
| IDE activity | `attachment` (opened_file / selected_lines / diagnostics) |
| Mode/permission switch | `mode` / `permission-mode` |
| Title (re)generated / renamed | `ai-title` / `custom-title` |
| User queues msg while agent busy | `queue-operation` (enqueue → dequeue/remove/popAll) |
| Compaction | `system/compact_boundary` + `user` (isCompactSummary) |
| Stop hook runs | `system/stop_hook_summary` |
| Model refusal fallback | `system/model_refusal_fallback` |
| `/command` executed locally | `system/local_command` |
| Subagent spawned | *nothing in main file* — new `subagents/agent-<id>.jsonl` + `.meta.json`; result returns as a normal tool_result |
| PR created | `pr-link` |

\* zero or more — a prompt may trigger no `attachment` records at all, or several (one per harness-injected item).

**Can external tools add records?** Mechanically yes — it's just a text append, and readers (resume, session picker) will pick it up. Safe only when the session is not live (single-writer assumption; concurrent appends risk interleaved partial lines). For clear-mind: treat live session files as **read-only streams** (tail them like `tail -f`), and write derived data (annotations, detox verdicts, fact cache) to your own sidecar files, keyed by record `uuid` — never mutate the transcript itself.

## 7. Relationship to the Agent SDK

The [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) is Claude Code as a library; **session state is explicitly "JSONL on your filesystem"** — the same files documented here (`promptSource: "sdk"` marks SDK-driven prompts; 329 observed).

| SDK concept | jsonl counterpart |
|---|---|
| `SystemMessage(subtype="init")` with `session_id` | the session UUID = the filename |
| `AssistantMessage` / `UserMessage` stream items | `assistant` / `user` records (same API shapes inside `message`) |
| `ResultMessage` (final result + cost) | derived from the last `assistant` + summed `usage` (not a stored record) |
| `options.resume = session_id` | reopen the file, replay active branch as context, keep appending |
| fork session | new file, new session UUID, history copied as context |
| subagent `parent_tool_use_id` | `meta.json.toolUseId` + `agentId` on sidechain records |
| Hooks (`SessionStart`, `PreToolUse`, …) | run around the same events that produce records; hook-injected context surfaces as `isMeta` user records / attachments |

So anything built on parsing these files works for both interactive Claude Code sessions **and** headless SDK agents — same format, same directories.

## 8. Usage — what you can build from this file (clear-mind mapping)

| Feature | How? |
|---|---|
| **Visualize session** | replay records, rebuild DAG via `uuid`/`parentUuid`, group by `promptId`, render branches + sidechain files |
| **Cost / Token Usage** | sum `assistant.message.usage` (input, output, cache_creation, cache_read; 1h vs 5m ephemeral split) |
| **Token blowout** | tbd |
| **Loss in middle** | tbd |
| **Verification debt** | tbd |
| **Comprehension rot** | tbd |
| **Cognitive surrender** | tbd |
| **Context detox** | tbd |
| **Fact cache** | tbd |

## 9. Caveats

- **Undocumented internal format** — fields appear/disappear between Claude Code versions (each record carries `version`; the corpus here spans 2.1.177–2.1.207). Parse defensively: unknown `type`s and fields must not crash a reader.
- `session_id` (snake) and `sessionId` (camel) coexist on newer records; older records may have only one.
- `thinking` blocks may be empty strings with only a `signature` (redacted-at-rest); don't assume content.
- Large tool outputs may be offloaded to `<session>/tool-results/*.txt` and referenced rather than inlined.
- Subagent transcripts multiply real cost: a session's true token usage = main file + all `subagents/*.jsonl` rollups.
