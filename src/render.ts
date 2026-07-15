import {
  ConversationEnvelopeSchema,
  type Message,
  type SessionRecord,
  type Usage,
} from "./types";

/* ------------------------------------------------------------------ *
 * ANSI styling — only when stdout is a real terminal; piped output
 * (| head, > file) stays plain so it diffs and greps cleanly.
 * ------------------------------------------------------------------ */

const tty = process.stdout.isTTY === true;
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
const cyan = (s: string) => (tty ? `\x1b[36m${s}\x1b[0m` : s);
const green = (s: string) => (tty ? `\x1b[32m${s}\x1b[0m` : s);
const yellow = (s: string) => (tty ? `\x1b[33m${s}\x1b[0m` : s);

/** Render the active branch as a readable, turn-by-turn transcript. */
export function renderBranch(records: SessionRecord[]): string {
  return records
    .map(renderRecord)
    .filter((block) => block !== "")
    .join("\n\n");
}

/** One record → one printable block; "" for records with nothing to show. */
function renderRecord(r: SessionRecord): string {
  // content/usage live on `message`, which the loose type doesn't expose —
  // narrow with ConversationEnvelopeSchema (same pattern as dag.ts).
  const parsed = ConversationEnvelopeSchema.safeParse(r);
  if (!parsed.success) return "";
  const env = parsed.data;

  switch (r.type) {
    case "user":
      return renderUser(env.message);
    case "assistant":
      return renderAssistant(env.message);
    case "system": {
      const subtype = typeof env.subtype === "string" ? env.subtype : "event";
      // turn_duration fires after every turn — pure bookkeeping, all noise
      if (subtype === "turn_duration") return "";
      return dim(`── system: ${subtype} ──`);
    }
    default:
      return ""; // attachments etc. — skip for the MVP
  }
}

/* ------------------------------------------------------------------ *
 * Text helpers
 * ------------------------------------------------------------------ */

/**
 * First `maxLines` lines, each clamped to `maxCols` columns; appends
 * "… (+N more lines)" when cut. Every detail block goes through this —
 * a raw Read result can be 2,000 lines, which would drown the transcript.
 */
function preview(text: string, maxLines = 3, maxCols = 100): string {
  const all = text.trim().split("\n");
  const kept = all.slice(0, maxLines).map((line) => {
    return line.length > maxCols ? line.slice(0, maxCols) + "…" : line;
  });
  const dropped = all.length - kept.length;
  if (dropped > 0) kept.push(`… (+${dropped} more lines)`);
  return kept.join("\n");
}

/**
 * Hang a block under a marker: first line follows the marker, continuation
 * lines are indented to line up beneath it — this is what keeps multi-line
 * previews from falling back to column 0.
 */
function hang(marker: string, block: string, pad = "     "): string {
  const [first = "", ...rest] = block.split("\n");
  const cont = rest.map((line) => pad + line);
  return [`  ${marker} ${first}`, ...cont].join("\n");
}

/**
 * Strip the harness's XML-ish wrappers from a typed prompt so the human
 * intent shows instead of tag soup:
 *   <bash-input>x</bash-input>          →  $ x
 *   <bash-stdout>…</bash-stdout>        →  (output preview)
 *   <command-name>/model</command-name> →  /model
 *   <local-command-caveat>…             →  (dropped — harness boilerplate)
 */
export function cleanPrompt(text: string): string {
  let t = text;
  // boilerplate wrappers: drop entirely, content and all
  t = t.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "");
  // bash echoes: keep the content, restyled
  t = t.replace(
    /<bash-input>([\s\S]*?)<\/bash-input>/g,
    (_, cmd) => `$ ${cmd}`,
  );
  t = t.replace(/<bash-stdout>([\s\S]*?)<\/bash-stdout>/g, (_, out) =>
    String(out).trim(),
  );
  t = t.replace(/<bash-stderr>([\s\S]*?)<\/bash-stderr>/g, (_, err) =>
    String(err).trim() === "" ? "" : `stderr: ${err}`,
  );
  // slash-command echoes: keep just the command name / output
  t = t.replace(/<command-name>([\s\S]*?)<\/command-name>/g, (_, c) => c);
  t = t.replace(/<command-message>[\s\S]*?<\/command-message>/g, "");
  t = t.replace(/<command-args>([\s\S]*?)<\/command-args>/g, (_, a) => a);
  t = t.replace(
    /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g,
    (_, out) => String(out).trim(),
  );
  // collapse the blank-line debris the removals leave behind
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The one informative line of a tool call's input: a Bash command, a file
 * path — falling back to compact JSON only when we don't know better.
 */
export function toolInputLine(input: unknown): string {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    // clamp to ONE line even for multi-line values (heredoc commands etc.)
    if (typeof o.command === "string") return preview(o.command, 1, 100);
    if (typeof o.file_path === "string") return preview(o.file_path, 1, 100);
    if (typeof o.path === "string") return preview(o.path, 1, 100);
    if (typeof o.pattern === "string") return preview(o.pattern, 1, 100);
  }
  return preview(JSON.stringify(input) ?? "", 1, 100);
}

/**
 * Flatten a tool_result's `content` (string | array of sub-blocks) to text.
 * Array form: keep the text fields, ignore non-text sub-blocks (images etc.).
 */
export function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((sub) =>
      sub && typeof sub === "object" && "text" in sub ? String(sub.text) : "",
    )
    .filter((s) => s !== "")
    .join("\n");
}

/* ------------------------------------------------------------------ *
 * Per-role rendering
 * ------------------------------------------------------------------ */

/** A user turn: either a typed string prompt or a batch of tool results. */
function renderUser(message: Message | undefined): string {
  if (!message) return "";

  // typed prompt — content is a plain string
  if (typeof message.content === "string") {
    const text = cleanPrompt(message.content);
    if (text === "") return ""; // caveat-only messages clean down to nothing
    return `${bold(green("▶ user"))}\n${text}`;
  }

  // otherwise it's tool results fed back as a user message — preview each
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type !== "tool_result") continue;
    const mark = block.is_error ? yellow("⎿ ✗") : dim("⎿");
    const body = toolResultText(block.content);
    parts.push(
      body === "" ? `  ${mark} (empty)` : dim(hang("⎿", preview(body))),
    );
  }
  return parts.join("\n");
}

/** An assistant turn: thinking, text, tool calls (with inputs), token tally. */
function renderAssistant(message: Message | undefined): string {
  if (!message) return "";

  const lines: string[] = [];
  if (typeof message.content === "string") {
    lines.push(message.content.trim());
  } else {
    for (const block of message.content) {
      if (block.type === "text") {
        lines.push(String(block.text));
      } else if (block.type === "thinking") {
        // skip empty-with-signature-only thinking; otherwise show a preview
        const thought = String(block.thinking).trim();
        if (thought !== "") lines.push(dim(hang("✱", preview(thought))));
      } else if (block.type === "tool_use") {
        lines.push(
          `  ${cyan(`⚙ ${String(block.name)}`)} ${toolInputLine(block.input)}`,
        );
      }
    }
  }

  // Skip records with no visible body (e.g. an empty-thinking-only record):
  // this session splits one response into paired records that SHARE usage,
  // so the paired record still shows the tokens — no loss.
  const body = lines.join("\n").trim();
  if (body === "") return "";

  const tokens = formatUsage(message.usage);
  const header = tokens
    ? `${bold(cyan("◀ assistant"))} ${dim(tokens)}`
    : bold(cyan("◀ assistant"));
  return `${header}\n${body}`;
}

/** Compact token summary from an assistant record's usage. */
function formatUsage(usage: Usage | undefined): string {
  if (!usage) return "";
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return `[↑${input} ↓${output} cache:${cacheRead}]`;
}
