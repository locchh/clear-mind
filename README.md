# clear-mind

## Setup

- compile `bunx tsc --noEmit`

## Features

1. Visualize session jsonl `clear-mind viz <path/to/your/transcript.jsonl>`

2. Monitor `clear-mind monitor <path/to/your/transcript.jsonl>`

    - Cost
    - Token Usage
    - Loss in middle
    - Verification debt
    - Comprehension rot
    - Cognitive surrender
    - Token blowout

3. Context detox `clear-mind detox <path/to/your/transcript.jsonl>`

    - Token cleanup
    - Detox polluted tool results
    - Remove hallucinated / wrong-assumption content
    - Fact cache

4. [Mind Palace](https://artofmemory.com/blog/how-to-build-a-memory-palace/)

5. Support claude-code first, then maybe codex, opencode, deepagents, cursor, etc.

## Related to

[ponytail](https://github.com/DietrichGebert/ponytail) - I love the idea of combining JavaScript code, hooks, and skills.

[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) - Build production AI agents with Claude Code as a library.