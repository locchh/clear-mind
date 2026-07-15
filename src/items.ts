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
 * A flat, render-agnostic model of the active branch.
 *
 * Both the Ink TUI and (potentially) other renderers consume `Item[]` instead
 * of walking records themselves — the record→display logic (turn grouping,
 * tool/result pairing, echo detection) lives here once, tested without a
 * terminal.
 */
export type Item =
  | { kind: "human"; text: string }
  | { kind: "echo"; text: string }
  | { kind: "assistant"; header: string; parts: Part[] }
  | { kind: "system"; label: string };

/** A piece inside an assistant turn. `fold` pieces are collapsible in the UI. */
export type Part =
  | { kind: "text"; text: string }
  | {
      kind: "fold";
      variant: "think" | "tool";
      summary: string; // always-visible line
      detail: string; // shown when expanded
      status?: "ok" | "error";
    };

/** Build the display model from the active branch. */
export function buildItems(records: SessionRecord[]): Item[] {
  const results = collectToolResults(records);
  const items: Item[] = [];

  // one agentic turn spans many assistant records — buffer them into one turn
  let run: Part[] = [];
  let usages: { requestId: string | undefined; usage: Usage | undefined }[] =
    [];
  const flush = () => {
    if (run.length > 0) {
      items.push({ kind: "assistant", header: turnHeader(usages), parts: run });
    }
    run = [];
    usages = [];
  };

  for (const r of records) {
    const env = parse(r);
    if (!env) continue;

    if (r.type === "assistant") {
      const msg = env.message;
      if (msg) {
        run.push(...assistantParts(msg, results));
        usages.push({ requestId: env.requestId, usage: msg.usage });
      }
      continue;
    }
    // tool-result user records are folded into the tool rows above — skip
    if (r.type === "user" && env.message && !isString(env.message.content))
      continue;

    flush();

    if (r.type === "user") {
      const item = userItem(env.message);
      if (item) items.push(item);
    } else if (r.type === "system") {
      const label = typeof env.subtype === "string" ? env.subtype : "event";
      if (label !== "turn_duration") items.push({ kind: "system", label });
    }
  }
  flush();

  return items;
}

/* ------------------------------------------------------------------ */

type ToolResult = { body: string; isError: boolean };

function parse(r: SessionRecord) {
  const p = ConversationEnvelopeSchema.safeParse(r);
  return p.success ? p.data : undefined;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function collectToolResults(records: SessionRecord[]): Map<string, ToolResult> {
  const map = new Map<string, ToolResult>();
  for (const r of records) {
    if (r.type !== "user") continue;
    const env = parse(r);
    const content = env?.message?.content;
    if (!content || isString(content)) continue;
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

function userItem(message: Message | undefined): Item | undefined {
  if (!message || !isString(message.content)) return undefined;
  const raw = message.content;
  const text = cleanPrompt(raw);
  if (text === "") return undefined; // caveat-only cleans to nothing
  return isEcho(raw) ? { kind: "echo", text } : { kind: "human", text };
}

function assistantParts(
  message: Message,
  results: Map<string, ToolResult>,
): Part[] {
  const parts: Part[] = [];
  if (isString(message.content)) {
    const t = message.content.trim();
    if (t !== "") parts.push({ kind: "text", text: t });
    return parts;
  }
  for (const block of message.content) {
    if (block.type === "text") {
      const t = String(block.text).trim();
      if (t !== "") parts.push({ kind: "text", text: t });
    } else if (block.type === "thinking") {
      const thought = String(block.thinking).trim();
      if (thought !== "")
        parts.push({
          kind: "fold",
          variant: "think",
          summary: `✱ Thought process · ${lineCount(thought)}`,
          detail: thought,
        });
    } else if (block.type === "tool_use") {
      const result = results.get(String(block.id));
      const detail =
        `$ input\n${JSON.stringify(block.input, null, 2) ?? ""}` +
        (result
          ? `\n\n$ result · ${lineCount(result.body)}\n${result.body}`
          : "");
      parts.push({
        kind: "fold",
        variant: "tool",
        summary: `⚙ ${String(block.name)}  ${toolInputLine(block.input)}`,
        detail,
        status: result ? (result.isError ? "error" : "ok") : undefined,
      });
    }
  }
  return parts;
}

/** Token tally for a whole turn, deduped by requestId (usage is duplicated
 *  across the records that share one API response — summing raw double-counts). */
function turnHeader(
  usages: { requestId: string | undefined; usage: Usage | undefined }[],
): string {
  const byReq = new Map<string, Usage>();
  let output = 0;
  let context = 0;
  for (const u of usages) {
    if (!u.usage) continue;
    if (u.requestId) byReq.set(u.requestId, u.usage);
    else output += u.usage.output_tokens ?? 0;
  }
  for (const u of byReq.values()) {
    output += u.output_tokens ?? 0;
    context = Math.max(
      context,
      (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0),
    );
  }
  if (output === 0) return "Assistant";
  const calls = byReq.size > 1 ? `${byReq.size} calls · ` : "";
  return `Assistant   ${calls}↓${output.toLocaleString("en")} tok · ctx ${context.toLocaleString("en")}`;
}
