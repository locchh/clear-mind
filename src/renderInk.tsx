import { useMemo, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import type { Item } from "./items";

/**
 * Interactive terminal viewer for a session's active branch.
 *
 * Visual language mirrors the HTML export (renderHtml.ts): each message is a
 * bounded block with a colored left gutter — green for Human, accent for
 * Assistant — matching labels (⚙ tool, ✱ thinking, ✓/✗ status) and the same
 * hex palette. Rows are pre-wrapped to terminal width so one logical row ==
 * one screen row, which lets us window a scroll viewport by exact line index.
 *
 * Keys: ↑/↓ or j/k scroll · Tab next fold · ⏎/space toggle · e/c expand/collapse
 * all · g/G top/bottom · q quit.
 */
export function runTui(items: Item[], title: string): void {
  render(<Viz items={items} title={title} />);
}

/* ---- palette (mirrors renderHtml.ts dark theme) ---- */

const C = {
  human: "#7cb98d",
  accent: "#d97757",
  think: "#b48ead",
  ok: "#7cb98d",
  err: "#e06c5b",
};
const BAR = "▎"; // colored left gutter, per message

/* ---- text wrapping (exact, so scroll math is exact) ---- */

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const out: string[] = [];
  let s = line;
  while (s.length > width) {
    let brk = s.lastIndexOf(" ", width);
    if (brk <= 0) brk = width; // no space to break on — hard cut
    out.push(s.slice(0, brk));
    s = s.slice(brk).replace(/^ /, "");
  }
  if (s !== "") out.push(s);
  return out;
}

function wrapMulti(text: string, width: number): string[] {
  return text.split("\n").flatMap((l) => wrapLine(l, width));
}

function truncate(text: string, width: number): string {
  return text.length > width
    ? text.slice(0, Math.max(0, width - 1)) + "…"
    : text;
}

function center(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return " ".repeat(pad) + text;
}

/* ---- rows model ---- */

type Row = {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
  foldIdx?: number; // set on a fold's summary row → selectable/highlightable
  gutter?: string; // colored left bar
  gutterColor?: string;
};

/** Flatten items into screen rows given the current open-fold set. */
function buildRows(
  items: Item[],
  open: Set<number>,
  width: number,
): { rows: Row[]; foldRows: number[] } {
  const rows: Row[] = [];
  const foldRows: number[] = [];
  let foldIdx = 0;
  const inner = width - 2; // account for "BAR "
  const push = (text: string, style: Omit<Row, "text"> = {}) =>
    rows.push({ text, ...style });
  const gut =
    (color: string, style: Omit<Row, "text" | "gutter" | "gutterColor"> = {}) =>
    (text: string) =>
      push(text, { ...style, gutter: BAR, gutterColor: color });

  for (const item of items) {
    if (item.kind === "human") {
      const g = gut(C.human);
      g("Human");
      for (const l of wrapMulti(item.text, inner))
        push(l, { gutter: BAR, gutterColor: C.human });
      push("");
    } else if (item.kind === "echo") {
      for (const l of wrapMulti(item.text, width)) push(l, { dim: true });
      push("");
    } else if (item.kind === "system") {
      push(center(`── ${item.label} ──`, width), { dim: true });
      push("");
    } else {
      push(item.header, {
        bold: true,
        color: C.accent,
        gutter: BAR,
        gutterColor: C.accent,
      });
      for (const part of item.parts) {
        if (part.kind === "text") {
          for (const l of wrapMulti(part.text, inner))
            push(l, { gutter: BAR, gutterColor: C.accent });
        } else {
          const i = foldIdx++;
          const isOpen = open.has(i);
          const chev = isOpen ? "▾" : "▸";
          const status =
            part.status === "ok" ? " ✓" : part.status === "error" ? " ✗" : "";
          const color = part.variant === "think" ? C.think : C.accent;
          foldRows.push(rows.length);
          push(truncate(`${chev} ${part.summary}${status}`, inner), {
            color,
            foldIdx: i,
            gutter: BAR,
            gutterColor: C.accent,
          });
          if (isOpen) {
            const detail = capLines(part.detail, 600);
            for (const l of wrapMulti(detail, inner - 2))
              push("  " + l, { dim: true, gutter: BAR, gutterColor: C.accent });
          }
        }
      }
      push("");
    }
  }
  return { rows, foldRows };
}

function capLines(text: string, max: number): string {
  const lines = text.split("\n");
  if (lines.length <= max) return text;
  return (
    lines.slice(0, max).join("\n") + `\n… (+${lines.length - max} more lines)`
  );
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/* ---- component ---- */

export function Viz({ items, title }: { items: Item[]; title: string }) {
  const { exit } = useApp();
  const width = Math.max(40, (process.stdout.columns ?? 80) - 2);
  const bodyHeight = Math.max(4, (process.stdout.rows ?? 24) - 2);

  const [open, setOpen] = useState<Set<number>>(new Set());
  const [sel, setSel] = useState(0);
  const [scroll, setScroll] = useState(0);

  const { rows, foldRows } = useMemo(
    () => buildRows(items, open, width),
    [items, open, width],
  );
  const maxScroll = Math.max(0, rows.length - bodyHeight);
  const selClamped =
    foldRows.length === 0 ? -1 : clamp(sel, 0, foldRows.length - 1);

  useInput((input, key) => {
    if (input === "q") return exit();
    if (key.downArrow || input === "j")
      setScroll((s) => Math.min(maxScroll, s + 1));
    else if (key.upArrow || input === "k") setScroll((s) => Math.max(0, s - 1));
    else if (key.pageDown)
      setScroll((s) => Math.min(maxScroll, s + bodyHeight));
    else if (key.pageUp) setScroll((s) => Math.max(0, s - bodyHeight));
    else if (input === "g") setScroll(0);
    else if (input === "G") setScroll(maxScroll);
    else if (input === "e") setOpen(new Set(foldRows.map((_, i) => i)));
    else if (input === "c") setOpen(new Set());
    else if (key.tab && foldRows.length > 0) {
      const next = (selClamped + 1) % foldRows.length;
      setSel(next);
      setScroll(clamp((foldRows[next] ?? 0) - 2, 0, maxScroll));
    } else if ((key.return || input === " ") && selClamped >= 0) {
      setOpen((o) => {
        const n = new Set(o);
        if (n.has(selClamped)) n.delete(selClamped);
        else n.add(selClamped);
        return n;
      });
    }
  });

  const view = rows.slice(scroll, scroll + bodyHeight);
  const pct = maxScroll === 0 ? 100 : Math.round((scroll / maxScroll) * 100);

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text wrap="truncate">
          <Text bold color={C.accent}>
            clear-mind
          </Text>
          <Text dimColor>
            {"  "}
            {truncate(title, 28)} · {rows.length} lines · {pct}%
            {"   ↑↓ scroll · Tab fold · ⏎ toggle · e/c all · q quit"}
          </Text>
        </Text>
      </Box>
      {view.map((row, i) => (
        <RowLine
          key={scroll + i}
          row={row}
          selected={row.foldIdx === selClamped}
        />
      ))}
    </Box>
  );
}

function RowLine({ row, selected }: { row: Row; selected: boolean }) {
  const text = row.text === "" ? " " : row.text;
  const content = (
    <Text
      color={selected ? undefined : row.color}
      dimColor={row.dim && !selected}
      bold={row.bold}
      inverse={selected}
    >
      {text}
    </Text>
  );
  if (!row.gutter) return content;
  return (
    <Text>
      <Text color={row.gutterColor}>{row.gutter} </Text>
      {content}
    </Text>
  );
}
