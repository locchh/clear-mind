import { test, expect } from "bun:test";
import { buildItems, type Item } from "./items";
import type { SessionRecord } from "./types";

/** Hand-built mini branch: typed prompt → assistant (thinking + tool_use,
 *  split across two records sharing one requestId) → tool result → final text. */
const branch = [
  {
    type: "user",
    uuid: "u1",
    parentUuid: null,
    message: { role: "user", content: "hello" },
  },
  {
    type: "assistant",
    uuid: "a1",
    parentUuid: "u1",
    requestId: "req_1",
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "let me look" }],
      usage: {
        output_tokens: 50,
        input_tokens: 2,
        cache_read_input_tokens: 100,
      },
    },
  },
  {
    type: "assistant",
    uuid: "a2",
    parentUuid: "a1",
    requestId: "req_1", // same response — usage must NOT double-count
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
      ],
      usage: {
        output_tokens: 50,
        input_tokens: 2,
        cache_read_input_tokens: 100,
      },
    },
  },
  {
    type: "user",
    uuid: "u2",
    parentUuid: "a2",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "a.txt" }],
    },
  },
  {
    type: "assistant",
    uuid: "a3",
    parentUuid: "u2",
    requestId: "req_2",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      usage: {
        output_tokens: 10,
        input_tokens: 2,
        cache_read_input_tokens: 120,
      },
    },
  },
] as SessionRecord[];

function assistant(items: Item[]) {
  return items.filter((i) => i.kind === "assistant");
}

test("one agentic turn merges all consecutive assistant records", () => {
  const items = buildItems(branch);
  expect(assistant(items)).toHaveLength(1); // NOT three headers
  expect(items[0]).toEqual({ kind: "human", text: "hello" });
});

test("usage dedupes by requestId", () => {
  const turn = assistant(buildItems(branch))[0]!;
  if (turn.kind !== "assistant") throw new Error("unreachable");
  // req_1 counted once (50) + req_2 (10) = 60 — NOT 110
  expect(turn.header).toContain("↓60");
  expect(turn.header).toContain("2 calls");
});

test("tool call pairs with its result inside the fold detail", () => {
  const turn = assistant(buildItems(branch))[0]!;
  if (turn.kind !== "assistant") throw new Error("unreachable");
  const tool = turn.parts.find(
    (p) => p.kind === "fold" && p.variant === "tool",
  );
  if (!tool || tool.kind !== "fold") throw new Error("no tool fold");
  expect(tool.summary).toContain("Bash");
  // the paired result rides in its own labeled section
  const result = tool.sections.find((s) => s.label.startsWith("result"));
  expect(result?.body).toBe("a.txt");
  expect(tool.status).toBe("ok");
});

test("thinking becomes a collapsible fold, tool-result records emit nothing", () => {
  const items = buildItems(branch);
  const turn = assistant(items)[0]!;
  if (turn.kind !== "assistant") throw new Error("unreachable");
  const think = turn.parts.find(
    (p) => p.kind === "fold" && p.variant === "think",
  );
  expect(think).toBeDefined();
  // the tool_result user record must not surface as a human item
  expect(items.filter((i) => i.kind === "human")).toHaveLength(1);
});
