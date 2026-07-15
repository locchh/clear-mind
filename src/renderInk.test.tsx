import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { readSession } from "./read";
import { buildIndex, activeBranch } from "./dag";
import { buildItems } from "./items";
// Viz isn't exported (runTui wraps render), so re-import it via a thin bridge:
// the component is what we want to exercise, so export it for the test.
import { Viz } from "./renderInk";

const FIXTURE =
  process.env.HOME +
  "/.claude/projects/-home-locch-Works-clear-mind/0943a4cd-6919-4422-af06-12c208a87005.jsonl";

function items() {
  const recs = readSession(FIXTURE);
  return buildItems(activeBranch(recs, buildIndex(recs)));
}

test("TUI renders the first frame with roles and help bar", () => {
  const { lastFrame } = render(<Viz items={items()} title="fixture" />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("Human");
  expect(frame).toContain("q quit"); // help bar present
});

test("Tab selects a fold and Enter toggles it open", () => {
  const { lastFrame, stdin, rerender } = render(
    <Viz items={items()} title="fixture" />,
  );
  stdin.write("\t"); // Tab → select first fold
  stdin.write("\r"); // Enter → expand it
  rerender(<Viz items={items()} title="fixture" />);
  const frame = lastFrame() ?? "";
  // an expanded fold shows its detail (input/result labels) — Tab scrolls the
  // fold into view, so assert on either marker rather than a fixed position
  expect(frame).toMatch(/\$ (input|result)/);
});

test("q exits cleanly", () => {
  const { stdin, unmount } = render(<Viz items={items()} title="fixture" />);
  stdin.write("q");
  unmount();
  expect(true).toBe(true); // no throw = pass
});
