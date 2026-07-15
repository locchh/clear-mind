import { useMemo, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import type { Item } from "./items";

/**
 * Interactive terminal viewer for a session's active branch.
 *
 * Rows are pre-wrapped to the terminal width so one logical row == one screen
 * row, which lets us window a scroll viewport by exact line index (Ink's own
 * auto-wrap would make line math unpredictable). Fold rows (thinking / tool
 * calls) collapse and expand in place, mirroring the HTML export.
 *
 * Keys: ↑/↓ or j/k scroll · Tab next fold · ⏎/space toggle · e/c expand/collapse
 * all · g/G top/bottom · q quit.
 */
export function runTui(items: Item[], title: string): void {
  render(<Viz items={items} title={title} />);
}

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

/* ---- rows model ---- */

type Row = {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
  foldIdx?: number; // set on a fold's summary row → selectable/highlightable
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
  const push = (text: string, style: Omit<Row, "text"> = {}) =>
    rows.push({ text, ...style });
  const pushWrapped = (text: string, style: Omit<Row, "text"> = {}) => {
    for (const l of wrapMulti(text, width)) push(l, style);
  };

  for (const item of items) {
    if (item.kind === "human") {
      push("▸ Human", { color: "green", bold: true });
      pushWrapped(item.text);
      push("");
    } else if (item.kind === "echo") {
      pushWrapped(item.text, { dim: true });
      push("");
    } else if (item.kind === "system") {
      push(`── ${item.label} ──`, { dim: true });
      push("");
    } else {
      push(item.header, { color: "cyan", bold: true });
      for (const part of item.parts) {
        if (part.kind === "text") {
          pushWrapped(part.text);
        } else {
          const i = foldIdx++;
          const isOpen = open.has(i);
          const chev = isOpen ? "▾" : "▸";
          const status =
            part.status === "ok" ? " ✓" : part.status === "error" ? " ✗" : "";
          const color = part.variant === "think" ? "magenta" : "cyan";
          foldRows.push(rows.length);
          push(truncate(`${chev} ${part.summary}${status}`, width), {
            color,
            foldIdx: i,
          });
          if (isOpen) {
            // cap pathological payloads so scroll stays snappy
            const detail = capLines(part.detail, 600);
            for (const l of wrapMulti(detail, width - 2))
              push("  " + l, { dim: true });
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
      <Text dimColor>
        {truncate(title, width - 40)} · {rows.length} lines · {pct}% · ↑↓ scroll
        · Tab fold · ⏎ toggle · e/c all · q quit
      </Text>
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
  return (
    <Text
      color={selected ? undefined : row.color}
      dimColor={row.dim && !selected}
      bold={row.bold}
      inverse={selected}
    >
      {text}
    </Text>
  );
}
