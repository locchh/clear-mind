import { test, expect } from "bun:test";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionFollower } from "./follow";

const line = (o: unknown) => JSON.stringify(o) + "\n";

function freshFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "cm-follow-"));
  const path = join(dir, "session.jsonl");
  writeFileSync(
    path,
    line({
      type: "user",
      uuid: "u1",
      parentUuid: null,
      message: { role: "user", content: "hello" },
    }) +
      line({ type: "last-prompt", lastPrompt: "hello", leafUuid: "u1" }) +
      line({
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        requestId: "r1",
        message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
      }),
  );
  return path;
}

test("first poll loads the initial branch; repeat poll is null", () => {
  const f = new SessionFollower(freshFile());
  const first = f.poll();
  expect(first).not.toBeNull();
  expect(first!.changedFrom).toBe(0);
  expect(first!.items.length).toBeGreaterThanOrEqual(2); // human + assistant
  expect(f.poll()).toBeNull(); // nothing new
});

test("appended records arrive incrementally with a stable prefix", () => {
  const path = freshFile();
  const f = new SessionFollower(path);
  const first = f.poll()!;

  appendFileSync(
    path,
    line({
      type: "user",
      uuid: "u2",
      parentUuid: "a1",
      message: { role: "user", content: "and then?" },
    }),
  );
  const update = f.poll();
  expect(update).not.toBeNull();
  expect(update!.items.length).toBe(first.items.length + 1);
  // everything before the change point is untouched — that's what lets the
  // TUI keep scroll/fold state instead of rerunning
  expect(update!.changedFrom).toBe(first.items.length);
  expect(update!.items[update!.changedFrom]).toEqual({
    kind: "human",
    text: "and then?",
  });
});

test("a partially-written line waits for its newline", () => {
  const path = freshFile();
  const f = new SessionFollower(path);
  f.poll();

  const rec = line({
    type: "user",
    uuid: "u2",
    parentUuid: "a1",
    message: { role: "user", content: "partial" },
  });
  appendFileSync(path, rec.slice(0, 25)); // mid-line, no newline yet
  expect(f.poll()).toBeNull(); // must NOT parse a half record

  appendFileSync(path, rec.slice(25)); // the rest arrives
  const update = f.poll();
  expect(update).not.toBeNull();
  expect(update!.items.at(-1)).toEqual({ kind: "human", text: "partial" });
});

test("metadata-only appends do not disturb the view", () => {
  const path = freshFile();
  const f = new SessionFollower(path);
  f.poll();
  appendFileSync(path, line({ type: "mode", mode: "plan", sessionId: "s" }));
  expect(f.poll()).toBeNull(); // records grew, items didn't — no update
});
