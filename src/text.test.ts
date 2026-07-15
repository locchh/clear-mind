import { test, expect } from "bun:test";
import {
  cleanPrompt,
  isEcho,
  lineCount,
  preview,
  toolInputLine,
  toolResultText,
} from "./text";

/* ---- preview ---- */

test("preview clamps lines and columns, marks the cut", () => {
  const long = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
  const out = preview(long, 3, 100);
  expect(out.split("\n")).toHaveLength(4); // 3 kept + marker
  expect(out).toContain("… (+7 more lines)");
});

test("preview leaves short text alone", () => {
  expect(preview("one\ntwo", 3, 100)).toBe("one\ntwo");
});

/* ---- lineCount ---- */

test("lineCount pluralizes", () => {
  expect(lineCount("a")).toBe("1 line");
  expect(lineCount("a\nb")).toBe("2 lines");
  expect(lineCount("")).toBe("0 lines");
});

/* ---- cleanPrompt ---- */

test("cleanPrompt restyles bash echoes and drops boilerplate", () => {
  const raw =
    "<local-command-caveat>noise</local-command-caveat>\n" +
    "<bash-input>git add .</bash-input>\n" +
    "<bash-stdout>ok</bash-stdout><bash-stderr></bash-stderr>";
  const out = cleanPrompt(raw);
  expect(out).toContain("$ git add .");
  expect(out).toContain("ok");
  expect(out).not.toContain("caveat");
  expect(out).not.toContain("<bash-");
});

test("cleanPrompt keeps slash-command names", () => {
  expect(cleanPrompt("<command-name>/model</command-name>")).toBe("/model");
});

/* ---- isEcho ---- */

test("isEcho: stdout-only is an echo, typed bash-input is not", () => {
  expect(isEcho("<bash-stdout>done</bash-stdout>")).toBe(true);
  expect(
    isEcho("<bash-input>ls</bash-input><bash-stdout>x</bash-stdout>"),
  ).toBe(false);
  expect(isEcho("plain typed prompt")).toBe(false);
});

/* ---- toolInputLine ---- */

test("toolInputLine picks the informative field", () => {
  expect(toolInputLine({ command: "git status" })).toBe("git status");
  expect(toolInputLine({ file_path: "/x/y.ts" })).toBe("/x/y.ts");
});

test("toolInputLine collapses multi-line commands to ONE line", () => {
  const heredoc = 'git commit -m "$(cat <<EOF\nmsg\nEOF\n)"';
  const out = toolInputLine({ command: heredoc });
  expect(out).not.toContain("\n");
  expect(out).toContain("…"); // marks that more follows
});

/* ---- toolResultText ---- */

test("toolResultText flattens string and block-array forms", () => {
  expect(toolResultText("plain")).toBe("plain");
  expect(
    toolResultText([
      { type: "text", text: "a" },
      { type: "image" },
      { type: "text", text: "b" },
    ]),
  ).toBe("a\nb");
});
