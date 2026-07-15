import { useEffect, useMemo, useRef, useState } from "react";
import { watch } from "node:fs";
import { Box, render, Text, useApp, useInput } from "ink";
import stringWidth from "string-width";
import type { Item } from "./items";
import type { SessionFollower } from "./follow";

/**
 * Interactive terminal viewer for a session's active branch.
 *
 * Visual language mirrors the HTML export (renderHtml.ts): each message is a
 * bounded block with a colored left gutter — green for Human, accent for
 * Assistant — same hex palette, same symbols (⚙ tool, ✱ thinking, ✓/✗).
 *
 * Rows are span-based: one screen row = a list of styled segments, so a tool
 * row can mix a dim chevron, a bold accent name, dim input text and a green
 * status mark on the same line. Emphasis follows purpose: summaries are for
 * scanning (dim), expanded detail is for reading (normal fg). All width math
 * is in terminal CELLS (string-width), not code points — CJK/emoji content
 * must not break wrapping or the right-aligned status column.
 *
 * Keys: ↑/↓ or j/k scroll · Tab/⇧Tab next/prev fold · ⏎/space toggle ·
 * e/c expand/collapse all · g/G top/bottom · q quit.
 *
 * Live: pass a SessionFollower and the view follows the file — new records
 * append IN PLACE (no rerun): items before the follower's `changedFrom` are
 * identical by construction, so existing rows, fold state and scroll position
 * all stay valid; if you're at the bottom the view sticks to the new bottom,
 * otherwise a "+N" hint appears in the header.
 */
export function runTui(
  items: Item[],
  title: string,
  follower?: SessionFollower,
): void {
  render(<Viz items={items} title={title} follower={follower} />);
}

/* ---- palette (mirrors renderHtml.ts dark theme) ---- */

const C = {
  human: "#7cb98d",
  accent: "#d97757",
  think: "#b48ead",
  ok: "#7cb98d",
  err: "#e06c5b",
  selBg: "#3f3f3b", // selection: tinted line, semantic colors stay intact
};
const BAR = "▎"; // colored left gutter, per message
const MAX_MEASURE = 110; // readable line length even on very wide terminals

/* ---- cell-accurate text helpers ---- */

/** Leading slice of at most `maxCells` terminal cells. */
function sliceCells(text: string, maxCells: number): string {
  let out = "";
  let used = 0;
  for (const ch of text) {
    const w = stringWidth(ch);
    if (used + w > maxCells) break;
    out += ch;
    used += w;
  }
  return out;
}

function truncate(text: string, width: number): string {
  return stringWidth(text) > width
    ? sliceCells(text, Math.max(0, width - 1)) + "…"
    : text;
}

/** Wrap one line by cells, preferring space breaks. */
function wrapLine(line: string, width: number): string[] {
  if (stringWidth(line) <= width) return [line];
  const out: string[] = [];
  let s = line;
  while (stringWidth(s) > width) {
    const head = sliceCells(s, width);
    const brk = head.lastIndexOf(" ");
    const cut = brk > 0 ? head.slice(0, brk) : head;
    out.push(cut);
    s = s.slice(cut.length).replace(/^ /, "");
  }
  if (s !== "") out.push(s);
  return out;
}

function wrapMulti(text: string, width: number): string[] {
  return text.split("\n").flatMap((l) => wrapLine(l, width));
}

/* ---- rows: lists of styled spans ---- */

type Span = {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
  italic?: boolean;
};

type Row = {
  spans: Span[];
  gutter?: string; // colored left bar
  foldIdx?: number; // set on a fold's summary row → selectable
};

const plainLen = (spans: Span[]) =>
  spans.reduce((n, s) => n + stringWidth(s.text), 0);

/** Flatten items into screen rows given the current open-fold set. */
function buildRows(
  items: Item[],
  open: Set<number>,
  width: number,
): { rows: Row[]; foldRows: number[] } {
  const rows: Row[] = [];
  const foldRows: number[] = [];
  let foldIdx = 0;
  const inner = width - 2; // account for "▎ "
  const blank = () => rows.push({ spans: [] });

  for (const item of items) {
    if (item.kind === "human") {
      rows.push({
        spans: [{ text: "Human", color: C.human, bold: true }],
        gutter: C.human,
      });
      for (const l of wrapMulti(item.text, inner))
        rows.push({ spans: [{ text: l }], gutter: C.human });
      blank();
    } else if (item.kind === "echo") {
      for (const l of wrapMulti(item.text, width - 2))
        rows.push({ spans: [{ text: "  " + l, dim: true }] });
      blank();
    } else if (item.kind === "system") {
      const label = `·  ${item.label}  ·`;
      const pad = Math.max(0, Math.floor((width - stringWidth(label)) / 2));
      rows.push({
        spans: [{ text: " ".repeat(pad) + label, dim: true, italic: true }],
      });
      blank();
    } else {
      // "Assistant   4 calls · ↓633 tok · ctx 43,136" — label bold, tally dim
      const [label, ...tally] = item.header.split("   ");
      rows.push({
        spans: [
          { text: label ?? "Assistant", color: C.accent, bold: true },
          ...(tally.length > 0
            ? [{ text: "  " + tally.join(" "), dim: true }]
            : []),
        ],
        gutter: C.accent,
      });
      for (const part of item.parts) {
        if (part.kind === "text") {
          for (const l of wrapMulti(part.text, inner))
            rows.push({ spans: [{ text: l }], gutter: C.accent });
        } else {
          const i = foldIdx++;
          const isOpen = open.has(i);
          foldRows.push(rows.length);
          rows.push({
            spans: foldSummarySpans(part, isOpen, inner),
            gutter: C.accent,
            foldIdx: i,
          });
          if (isOpen) {
            // detail is for READING: labels accent, bodies at normal fg —
            // sections are structural (items.ts), so body text starting with
            // "$ " can never be mistaken for a label
            for (const [si, sec] of part.sections.entries()) {
              if (si > 0) rows.push({ spans: [], gutter: C.accent });
              if (sec.label !== "")
                rows.push({
                  spans: [{ text: "   $ " + sec.label, color: C.accent }],
                  gutter: C.accent,
                });
              for (const l of wrapMulti(capLines(sec.body, 600), inner - 3))
                rows.push({
                  spans: [{ text: "   " + l }],
                  gutter: C.accent,
                });
            }
          }
        }
      }
      blank();
    }
  }
  return { rows, foldRows };
}

/** One fold summary line: dim chevron · colored marker+name · DIM input
 *  (summaries are for scanning) · status mark at the right edge. Every fold
 *  row pads to full width so the selection band is always full-width. */
function foldSummarySpans(
  part: { variant: "think" | "tool"; summary: string; status?: "ok" | "error" },
  isOpen: boolean,
  inner: number,
): Span[] {
  const chev = isOpen ? "▾ " : "▸ ";
  const color = part.variant === "think" ? C.think : C.accent;

  // summary shape from items.ts: "⚙ Name  input…" / "✱ Thought process · N lines"
  const [head = "", ...restParts] = part.summary.split("  ");
  const rest = restParts.join("  ");

  const spans: Span[] = [
    { text: chev, dim: true },
    { text: head, color, bold: part.variant === "tool" },
  ];
  if (rest !== "") spans.push({ text: "  " + rest, dim: true });

  const mark = part.status === "ok" ? "✓" : part.status === "error" ? "✗" : "";
  const markWidth = mark === "" ? 0 : 2; // " ✓"

  // clamp the input span so head + input + mark fit on one row
  const overflow = plainLen(spans) + markWidth - inner;
  if (overflow > 0 && spans[2]) {
    spans[2].text = truncate(
      spans[2].text,
      Math.max(4, stringWidth(spans[2].text) - overflow),
    );
  }

  // pad to full width (selection band), then the status mark if any —
  // markless rows must pad to exactly the same edge as marked ones
  const gap = Math.max(1, inner - plainLen(spans) - (mark === "" ? 0 : 1));
  spans.push({ text: " ".repeat(gap) });
  if (mark !== "") {
    spans.push({
      text: mark,
      color: part.status === "ok" ? C.ok : C.err,
      bold: true,
    });
  }
  return spans;
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

export function Viz({
  items,
  title,
  follower,
}: {
  items: Item[];
  title: string;
  follower?: SessionFollower;
}) {
  const { exit } = useApp();
  const width = Math.min(
    Math.max(40, (process.stdout.columns ?? 80) - 2),
    MAX_MEASURE,
  );
  const bodyHeight = Math.max(4, (process.stdout.rows ?? 24) - 4);

  const [open, setOpen] = useState<Set<number>>(new Set());
  const [sel, setSel] = useState(-1); // -1 = nothing selected until first Tab
  const [scroll, setScroll] = useState(0);
  const [liveItems, setLiveItems] = useState(items);
  const [fresh, setFresh] = useState(0); // rows appended while scrolled up
  // mirror of `sel` that updates synchronously — two keys arriving in the same
  // tick (Tab then Enter) must see each other's effect, and setState commits
  // too late for that
  const selRef = useRef(-1);

  // live mode: follow the file — new records append in place. Items before
  // the follower's changedFrom are identical, so rows/folds/scroll built from
  // them stay valid; only content below the change point re-renders.
  useEffect(() => {
    if (!follower) return;
    let disposed = false;
    const drain = () => {
      const update = follower.poll();
      if (update && !disposed) setLiveItems(update.items);
    };
    const watcher = watch(follower.path, drain);
    const fallback = setInterval(drain, 3000); // inotify events can coalesce
    return () => {
      disposed = true;
      watcher.close();
      clearInterval(fallback);
    };
  }, [follower]);

  const { rows, foldRows } = useMemo(
    () => buildRows(liveItems, open, width),
    [liveItems, open, width],
  );
  const maxScroll = Math.max(0, rows.length - bodyHeight);

  // sticky bottom: if the user was at the bottom when new rows arrived, stay
  // at the (new) bottom; otherwise count what they haven't seen
  const prevRowsRef = useRef({ len: rows.length, maxScroll });
  useEffect(() => {
    const prev = prevRowsRef.current;
    prevRowsRef.current = { len: rows.length, maxScroll };
    if (rows.length === prev.len) return;
    if (scroll >= prev.maxScroll) setScroll(maxScroll);
    else setFresh((n) => n + Math.max(0, rows.length - prev.len));
    // deps intentionally narrow: react only to growth
  }, [rows.length]);

  // clear the "+N" hint once the user reaches the bottom
  useEffect(() => {
    if (fresh > 0 && scroll >= maxScroll) setFresh(0);
  }, [scroll, maxScroll, fresh]);
  const selClamped =
    foldRows.length === 0 || sel < 0 ? -1 : clamp(sel, 0, foldRows.length - 1);

  const inView = (row: number) => row >= scroll && row < scroll + bodyHeight;
  /** Scroll only when the target row is offscreen — no lurching. */
  const ensureVisible = (row: number) => {
    if (!inView(row)) setScroll(clamp(row - 2, 0, maxScroll));
  };

  // expanding/collapsing folds above the viewport shifts everything below;
  // re-anchor on the selected fold so the view doesn't jump under the user
  useEffect(() => {
    const row = foldRows[selRef.current];
    if (row !== undefined && !inView(row))
      setScroll(clamp(row - 2, 0, maxScroll));
    // deps intentionally narrow: re-anchor only when the fold set changes
  }, [open]);

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
    else if (input === "e" || input === "c") {
      // adopt the first visible fold when nothing is selected — the re-anchor
      // effect needs a selection to hold the viewport steady
      if (selRef.current < 0) {
        const first = foldRows.findIndex((r) => inView(r));
        if (first >= 0) {
          selRef.current = first;
          setSel(first);
        }
      }
      setOpen(input === "e" ? new Set(foldRows.map((_, i) => i)) : new Set());
    } else if (key.tab && foldRows.length > 0) {
      const n = foldRows.length;
      // from the unselected state, ⇥ starts at the first fold, ⇧⇥ at the last
      const next =
        selRef.current < 0
          ? key.shift
            ? n - 1
            : 0
          : key.shift
            ? (selRef.current - 1 + n) % n
            : (selRef.current + 1) % n;
      selRef.current = next;
      setSel(next);
      ensureVisible(foldRows[next] ?? 0);
    } else if (key.return || input === " ") {
      const cur = selRef.current;
      const row = foldRows[cur];
      // no-op when nothing is selected or the selected fold is offscreen —
      // never toggle something the user can't see
      if (cur < 0 || row === undefined || !inView(row)) return;
      setOpen((o) => {
        const n = new Set(o);
        if (n.has(cur)) n.delete(cur);
        else n.add(cur);
        return n;
      });
    }
  });

  const view = rows.slice(scroll, scroll + bodyHeight);
  const pct = maxScroll === 0 ? 100 : Math.round((scroll / maxScroll) * 100);
  const foldPos =
    selClamped >= 0 ? ` · fold ${selClamped + 1}/${foldRows.length}` : "";

  return (
    <Box flexDirection="column" width={width + 2}>
      <Box
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        justifyContent="space-between"
      >
        <Text wrap="truncate">
          <Text bold color={C.accent}>
            clear-mind
          </Text>
          <Text dimColor>
            {"  "}
            {truncate(title, 20)} · {pct}%{foldPos}
          </Text>
          {fresh > 0 ? (
            <Text bold color={C.human}>
              {"  ▼ +" + fresh}
            </Text>
          ) : null}
        </Text>
        <Text wrap="truncate-start" dimColor>
          j/k g/G scroll · ⇥/⇧⇥ fold · ⏎ open · e/c all · q quit
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
  if (row.spans.length === 0 && !row.gutter) return <Text> </Text>;
  return (
    <Text wrap="truncate">
      {row.gutter ? <Text color={row.gutter}>{BAR} </Text> : null}
      {row.spans.map((s, i) => (
        <Text
          key={i}
          color={s.color}
          backgroundColor={selected ? C.selBg : undefined}
          dimColor={s.dim && !selected}
          bold={s.bold}
          italic={s.italic}
        >
          {s.text}
        </Text>
      ))}
      {row.spans.length === 0 ? " " : null}
    </Text>
  );
}
