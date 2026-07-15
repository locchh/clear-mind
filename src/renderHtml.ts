import MarkdownIt from "markdown-it";
import {
  ConversationEnvelopeSchema,
  type Message,
  type SessionRecord,
  type Usage,
} from "./types";
import {
  cleanPrompt,
  isEcho,
  lineCount,
  toolInputLine,
  toolResultText,
} from "./text";

/**
 * Render the active branch as a single self-contained HTML page styled like a
 * modern chat app (claude.ai / ChatGPT): user prompts as right-aligned bubbles,
 * assistant turns as clean text blocks, and every bit of agent activity —
 * thinking, tool calls, tool results — preserved behind native <details>
 * folds (summary = core info, expand = full payload). No external assets,
 * no JavaScript.
 *
 * Markdown: message bodies go through markdown-it with html:false, which both
 * renders md AND escapes literal <tags> safely — everywhere, including code
 * fences — so transcript content can never break the page.
 */
export function renderHtml(
  records: SessionRecord[],
  title = "session",
): string {
  const results = collectToolResults(records);

  // One agentic "turn" spans MANY assistant records (one per API call, plus
  // interleaved tool-result user records). Rendering each record separately
  // stacks repeated "Assistant" headers — so buffer consecutive assistant
  // activity into a run and emit it as a single turn block, the way chat UIs
  // show one assistant message per response.
  const blocks: string[] = [];
  let run: AssistantPiece[] = [];
  const flush = () => {
    if (run.length > 0) blocks.push(assistantTurn(run));
    run = [];
  };

  for (const r of records) {
    if (r.type === "assistant") {
      const piece = assistantPiece(r, results);
      if (piece) run.push(piece);
      continue;
    }
    // tool-result user records are part of the assistant's activity — they
    // don't break the run (their content is already paired into tool rows)
    if (r.type === "user" && isToolResultRecord(r)) continue;

    flush();
    const card = renderCard(r);
    if (card !== "") blocks.push(card);
  }
  flush();

  return page(title, blocks.join("\n"));
}

/** True for user records that only carry tool_result blocks back to the API. */
function isToolResultRecord(r: SessionRecord): boolean {
  const parsed = ConversationEnvelopeSchema.safeParse(r);
  if (!parsed.success || !parsed.data.message) return false;
  return typeof parsed.data.message.content !== "string";
}

const md = new MarkdownIt({ html: false, linkify: true });

/** Markdown-render a message body (escapes any literal HTML as a side effect). */
function mdRender(text: string): string {
  return md.render(text);
}

/** Escape for the few places we emit text outside markdown (summaries, pre). */
function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* ------------------------------------------------------------------ *
 * Tool-call ↔ result pairing
 *
 * A tool call (assistant `tool_use` block, with an `id`) and its result
 * (`tool_result` block on a later user record, with `tool_use_id`) are
 * separate records in the file. Pairing them up front lets each tool row
 * show call AND result in one expandable block — the result records then
 * render nothing on their own.
 * ------------------------------------------------------------------ */

type ToolResult = { body: string; isError: boolean };

function collectToolResults(records: SessionRecord[]): Map<string, ToolResult> {
  const map = new Map<string, ToolResult>();
  for (const r of records) {
    if (r.type !== "user") continue;
    const parsed = ConversationEnvelopeSchema.safeParse(r);
    if (!parsed.success || !parsed.data.message) continue;
    const content = parsed.data.message.content;
    if (typeof content === "string") continue;
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      map.set(String(block.tool_use_id), {
        body: toolResultText(block.content),
        isError: block.is_error === true,
      });
    }
  }
  return map;
}

/* ------------------------------------------------------------------ *
 * Cards
 * ------------------------------------------------------------------ */

function renderCard(r: SessionRecord): string {
  const parsed = ConversationEnvelopeSchema.safeParse(r);
  if (!parsed.success) return "";
  const env = parsed.data;

  switch (r.type) {
    case "user":
      return userCard(env.message);
    case "system": {
      const subtype = typeof env.subtype === "string" ? env.subtype : "event";
      if (subtype === "turn_duration") return ""; // per-turn bookkeeping — noise
      return `<div class="sys"><span>${esc(subtype)}</span></div>`;
    }
    default:
      return ""; // attachments etc. — out of scope for now
  }
}

/** Typed prompt → right-aligned user bubble. Tool-result records → nothing
 *  (their content is folded into the paired tool row on the assistant side).
 *  Shell echoes (stdout the user didn't type) → muted left-aligned block:
 *  machine output shouldn't wear a human speech bubble. */
function userCard(message: Message | undefined): string {
  if (!message) return "";
  if (typeof message.content !== "string") return ""; // tool results: paired
  const raw = message.content;
  const text = cleanPrompt(raw);
  if (text === "") return ""; // caveat-only messages clean down to nothing

  // shell echoes (stdout the user didn't type) → muted block, not a bubble
  if (isEcho(raw)) return `<div class="echo"><pre>${esc(text)}</pre></div>`;

  return `<div class="row user"><div class="who you">Human</div><div class="bubble">${mdRender(text)}</div></div>`;
}

/** One assistant record's renderable pieces + the usage/requestId needed to
 *  tally the whole turn honestly (usage is DUPLICATED across records that
 *  share a requestId — summing naively double-counts). */
type AssistantPiece = {
  html: string;
  requestId: string | undefined;
  usage: Usage | undefined;
};

function assistantPiece(
  r: SessionRecord,
  results: Map<string, ToolResult>,
): AssistantPiece | undefined {
  const parsed = ConversationEnvelopeSchema.safeParse(r);
  if (!parsed.success || !parsed.data.message) return undefined;
  const message: Message = parsed.data.message;

  const parts: string[] = [];
  if (typeof message.content === "string") {
    parts.push(`<div class="prose">${mdRender(message.content)}</div>`);
  } else {
    for (const block of message.content) {
      if (block.type === "text") {
        const text = String(block.text).trim();
        if (text !== "")
          parts.push(`<div class="prose">${mdRender(text)}</div>`);
      } else if (block.type === "thinking") {
        const thought = String(block.thinking).trim();
        if (thought !== "")
          parts.push(
            `<details class="think"><summary><span class="chev"></span>✱ Thought process <span class="meta">${lineCount(thought)}</span></summary><div class="fold"><pre>${esc(thought)}</pre></div></details>`,
          );
      } else if (block.type === "tool_use") {
        parts.push(toolRow(block, results));
      }
    }
  }

  // keep usage even when nothing is visible (empty-thinking record): its
  // requestId-mate carries the same numbers, and the dedup handles overlap
  return {
    html: parts.join("\n"),
    requestId: parsed.data.requestId,
    usage: message.usage,
  };
}

/** A whole agentic turn — one header, all activity, honest token tally. */
function assistantTurn(run: AssistantPiece[]): string {
  const html = run
    .map((p) => p.html)
    .filter((h) => h !== "")
    .join("\n");
  if (html === "") return "";

  // dedupe usage by requestId (fallback: keep each unkeyed usage) then sum
  const byRequest = new Map<string, Usage>();
  let unkeyed = 0;
  let output = 0;
  let context = 0;
  for (const p of run) {
    if (!p.usage) continue;
    if (p.requestId) byRequest.set(p.requestId, p.usage);
    else {
      output += p.usage.output_tokens ?? 0;
      unkeyed++;
    }
  }
  for (const u of byRequest.values()) {
    output += u.output_tokens ?? 0;
    // context of the LAST call ≈ the turn's context size; keep the max
    context = Math.max(
      context,
      (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0),
    );
  }
  void unkeyed;

  const calls = byRequest.size > 1 ? `${byRequest.size} api calls · ` : "";
  const badge =
    output > 0
      ? `<span class="tokens" title="deduped by requestId">${calls}↓${output.toLocaleString("en")} tok · ctx ${context.toLocaleString("en")}</span>`
      : "";
  return `<div class="row assistant"><div class="turn"><div class="who">Assistant${badge}</div>${html}</div></div>`;
}

/** One tool call + its paired result, in a single expandable row.
 *  (index-signature param: the ContentBlock union includes a loose fallback
 *  member, so structural props must come through as unknown lookups) */
function toolRow(
  block: { [key: string]: unknown },
  results: Map<string, ToolResult>,
): string {
  const name = String(block.name);
  const oneLiner = toolInputLine(block.input);
  const result = results.get(String(block.id));

  const status = result
    ? result.isError
      ? `<span class="err">✗ error</span>`
      : `<span class="ok">✓</span>`
    : `<span class="meta">no result recorded</span>`;

  const inputJson = JSON.stringify(block.input, null, 2) ?? "";
  const resultBlock = result
    ? `<div class="lbl">Result <span class="meta">${lineCount(result.body)}</span></div><pre>${esc(result.body === "" ? "(empty)" : result.body)}</pre>`
    : "";

  return `<details class="tool"><summary><span class="chev"></span><span class="gear">⚙</span> <b>${esc(name)}</b> <code>${esc(oneLiner)}</code> ${status}</summary><div class="fold"><div class="lbl">Input</div><pre>${esc(inputJson)}</pre>${resultBlock}</div></details>`;
}

/* ------------------------------------------------------------------ *
 * Page shell — inline CSS only; light/dark via prefers-color-scheme
 * ------------------------------------------------------------------ */

function page(title: string, blocks: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — clear-mind</title>
<style>
  :root {
    --bg: #faf9f5; --fg: #1a1a18; --muted: #7d7a70;
    --bubble: #f0eee6; --line: #e4e1d7; --panel: #f5f4ee;
    --code-bg: #f0efe9; --accent: #c96442; --ok: #4a8c5c; --err: #c0392b;
    --card: #fffefb;
    --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #262624; --fg: #e8e6dc; --muted: #98958a;
      --bubble: #3a3a36; --line: #45443f; --panel: #30302d;
      --code-bg: #1f1e1c; --accent: #d97757; --ok: #7cb98d; --err: #e06c5b;
      --card: #2b2b28;
    }
  }
  * { box-sizing: border-box; }
  :root { interpolate-size: allow-keywords; }  /* lets block-size animate to auto */
  body { background: var(--bg); color: var(--fg); margin: 0;
         font: 16px/1.65 ui-sans-serif, system-ui, "Segoe UI", sans-serif; }
  .wrap { max-width: 46rem; margin: 0 auto; padding: 2rem 1.25rem 6rem; }
  h1 { font-size: .9rem; font-weight: 600; color: var(--muted); font-family: var(--mono);
       border-bottom: 1px solid var(--line); padding-bottom: 1rem; }

  /* ------- turns ------- */
  /* single-direction margins: bidirectional ones collapse (max wins), which
     silently killed the same-speaker rhythm overrides below */
  .row, .echo, .sys { margin: 1.6rem 0 0; }
  .row.user { display: flex; flex-direction: column; align-items: flex-end; }
  .row.user + .row.user { margin-top: .5rem; }  /* same-speaker rhythm */
  .row.user + .echo { margin-top: .3rem; }      /* output tucks under its command */
  .bubble { background: var(--bubble); border-radius: 18px 18px 4px 18px;
            padding: .15rem 1.1rem; max-width: 85%; }
  /* assistant turn gets its own card so both speakers read as bounded messages */
  .turn { border: 1px solid var(--line); border-radius: 18px 18px 18px 4px;
          padding: .55rem 1rem .35rem; background: var(--card, transparent); }
  /* metadata is bookkeeping, not content: label muted, badge pushed to the edge */
  .who { font-size: .75rem; font-weight: 600; color: var(--muted);
         margin-bottom: .25rem; display: flex; align-items: baseline;
         justify-content: space-between; gap: .6rem; }
  .who.you { justify-content: flex-end; padding-right: .35rem; }
  .tokens { font-weight: 400; color: var(--muted); font-family: var(--mono);
            font-size: .68rem; opacity: .75; }
  /* shell stdout echoes: machine output, not a human bubble */
  .echo pre { color: var(--muted); font-family: var(--mono); font-size: .78rem;
              margin: 0; padding: 0 .35rem; white-space: pre-wrap; overflow-wrap: anywhere; }

  /* ------- markdown body ------- */
  .prose, .bubble { overflow-wrap: anywhere; }
  .prose p, .bubble p { margin: .55rem 0; }
  .prose pre, .bubble pre { background: var(--code-bg); border: 1px solid var(--line);
        border-radius: 10px; padding: .75rem .9rem; overflow-x: auto;
        font-family: var(--mono); font-size: .82rem; line-height: 1.5; }
  .prose code, .bubble code { font-family: var(--mono); font-size: .85em;
        background: var(--code-bg); border-radius: 5px; padding: .08em .35em; }
  .prose pre code, .bubble pre code { background: none; padding: 0; }
  .prose ul, .prose ol { padding-left: 1.4rem; }
  .prose h1, .prose h2, .prose h3 { font-size: 1.05em; margin: 1em 0 .4em; }
  .prose blockquote { border-left: 3px solid var(--line); margin: .6rem 0;
        padding-left: .9rem; color: var(--muted); }
  .prose table { border-collapse: collapse; display: block; overflow-x: auto; }
  .prose th, .prose td { border: 1px solid var(--line); padding: .3rem .6rem; font-size: .9em; }
  /* keep the palette: default blue links / groove hr would leak through */
  .prose a, .bubble a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .prose hr { border: 0; border-top: 1px solid var(--line); margin: 1rem 0; }

  /* ------- folds: thinking + tools ------- */
  details { border: 1px solid var(--line); border-radius: 12px;
            margin: .6rem 0; background: var(--panel); }
  /* consecutive tool rows group into one visual card instead of a wall of boxes */
  details.tool:has(+ details.tool) { border-bottom-left-radius: 0;
        border-bottom-right-radius: 0; margin-bottom: 0; }
  details.tool + details.tool { margin-top: 0; border-top: 0;
        border-top-left-radius: 0; border-top-right-radius: 0; }
  details > summary { cursor: pointer; list-style: none; user-select: none;
        padding: .45rem .8rem; font-size: .85rem; color: var(--muted);
        display: flex; align-items: center; gap: .5rem; }
  details > summary::-webkit-details-marker { display: none; }
  details > summary:hover { color: var(--fg); }
  details > summary:hover .chev { border-color: var(--fg); }
  details > summary:focus-visible { outline: 2px solid var(--accent);
        outline-offset: -2px; border-radius: 11px; }
  .chev { flex: none; width: .45rem; height: .45rem; border-right: 1.5px solid var(--muted);
          border-bottom: 1.5px solid var(--muted); transform: rotate(-45deg); transition: transform .15s; }
  details[open] > summary .chev { transform: rotate(45deg); }
  /* ease the unfold (progressive enhancement; instant elsewhere) */
  details::details-content { block-size: 0; overflow-y: clip;
        transition: block-size .2s ease, content-visibility .2s allow-discrete; }
  details[open]::details-content { block-size: auto; }
  .fold { padding: 0 .9rem .7rem; }
  .fold pre { background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px;
              padding: .6rem .8rem; overflow-x: auto; font-family: var(--mono);
              font-size: .78rem; line-height: 1.5; margin: .25rem 0 .6rem;
              max-height: 24rem; overflow-y: auto; white-space: pre-wrap; }
  .lbl { font-size: .72rem; font-weight: 600; text-transform: uppercase;
         letter-spacing: .06em; color: var(--muted); margin-top: .4rem; }
  .lbl .meta { text-transform: none; font-size: .7rem; }
  /* long tool names (mcp__server__tool…) must ellipsize, not overflow the card */
  .tool summary b { color: var(--fg); font-weight: 600; flex: 0 1 auto; min-width: 5ch;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* one guaranteed line: chip shrinks-to-fit (never grows), status pins right */
  .tool summary code { font-family: var(--mono); font-size: .78rem; background: var(--code-bg);
        border-radius: 5px; padding: .1em .4em; flex: 0 1 auto; min-width: 0;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tool summary .ok, .tool summary .err, .tool summary .meta:last-child {
        margin-left: auto; flex: none; }
  .gear { color: var(--accent); flex: none; }
  .ok { color: var(--ok); } .err { color: var(--err); font-weight: 600; }
  .think summary { font-style: italic; }
  .meta { color: var(--muted); font-size: .75rem; font-weight: 400; }

  /* ------- system chips ------- */
  .sys { text-align: center; }
  .sys span { font-size: .72rem; color: var(--muted); border: 1px solid var(--line);
              border-radius: 999px; padding: .15rem .7rem; background: var(--panel); }
</style>
</head>
<body>
<div class="wrap">
<h1>${esc(title)}</h1>
${blocks}
</div>
</body>
</html>
`;
}
