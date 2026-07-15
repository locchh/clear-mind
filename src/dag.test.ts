import { test, expect } from "bun:test";
import { buildIndex, activeBranch } from "./dag";
import type { SessionRecord } from "./types";

const walk = (records: SessionRecord[]) =>
  activeBranch(records, buildIndex(records)).map((r) => r.uuid);

/* Failure modes below were each found in real session files by auditing all
 * ~370 transcripts under ~/.claude/projects — not hypothetical. */

test("basic: walks leaf → root and returns reading order", () => {
  const records = [
    { type: "user", uuid: "a", parentUuid: null },
    { type: "assistant", uuid: "b", parentUuid: "a" },
    { type: "user", uuid: "c", parentUuid: "b" },
    { type: "last-prompt", lastPrompt: "hi", leafUuid: "c" },
  ] as SessionRecord[];
  expect(walk(records)).toEqual(["a", "b", "c"]);
});

test("tail below leafUuid is included (leafUuid is written at prompt-submit)", () => {
  const records = [
    { type: "user", uuid: "u1", parentUuid: null },
    { type: "last-prompt", lastPrompt: "hi", leafUuid: "u1" },
    // the whole turn that follows the prompt hangs BELOW the recorded leaf
    { type: "assistant", uuid: "a1", parentUuid: "u1" },
    { type: "user", uuid: "t1", parentUuid: "a1" }, // tool result
    { type: "assistant", uuid: "a2", parentUuid: "t1" },
  ] as SessionRecord[];
  expect(walk(records)).toEqual(["u1", "a1", "t1", "a2"]);
});

test("descending a fork below the leaf takes the latest-appended child", () => {
  const records = [
    { type: "user", uuid: "u1", parentUuid: null },
    { type: "last-prompt", lastPrompt: "hi", leafUuid: "u1" },
    { type: "assistant", uuid: "old", parentUuid: "u1" }, // abandoned
    { type: "assistant", uuid: "new", parentUuid: "u1" }, // active (appended later)
  ] as SessionRecord[];
  expect(walk(records)).toEqual(["u1", "new"]);
});

test("crosses a compact boundary via logicalParentUuid", () => {
  const records = [
    { type: "user", uuid: "pre", parentUuid: null }, // pre-compact history
    {
      type: "system",
      uuid: "boundary",
      parentUuid: null, // physical chain restarts here…
      logicalParentUuid: "pre", // …but the logical link survives
    },
    { type: "user", uuid: "post", parentUuid: "boundary" },
    { type: "last-prompt", lastPrompt: "hi", leafUuid: "post" },
  ] as SessionRecord[];
  expect(walk(records)).toEqual(["pre", "boundary", "post"]);
});

test("no usable last-prompt: falls back to the last uuid-bearing record", () => {
  const records = [
    { type: "user", uuid: "a", parentUuid: null },
    { type: "assistant", uuid: "b", parentUuid: "a" },
    // real sessions exist whose last-prompt has NO lastPrompt text field —
    // and some have no last-prompt at all
    { type: "last-prompt", leafUuid: "b" },
  ] as SessionRecord[];
  expect(walk(records)).toEqual(["a", "b"]);
});

test("unresolvable leafUuid: falls back instead of returning empty", () => {
  const records = [
    { type: "user", uuid: "a", parentUuid: null },
    { type: "assistant", uuid: "b", parentUuid: "a" },
    { type: "last-prompt", lastPrompt: "hi", leafUuid: "ghost" }, // dangling
  ] as SessionRecord[];
  expect(walk(records)).toEqual(["a", "b"]);
});

test("a parentUuid cycle terminates instead of hanging", () => {
  const records = [
    { type: "user", uuid: "a", parentUuid: "b" }, // malformed: a↔b loop
    { type: "assistant", uuid: "b", parentUuid: "a" },
    { type: "last-prompt", lastPrompt: "hi", leafUuid: "b" },
  ] as SessionRecord[];
  const out = walk(records);
  expect(out.length).toBeLessThanOrEqual(2); // finished, didn't hang
});
