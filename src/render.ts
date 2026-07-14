import {
  ConversationEnvelopeSchema,
  type Message,
  type SessionRecord,
  type Usage,
} from "./types";

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
      return `[system: ${subtype}]`;
    }
    default:
      return ""; // attachments etc. — skip for the MVP
  }
}

/** A user turn: either a typed string prompt or a batch of tool results. */
function renderUser(message: Message | undefined): string {
  if (!message) return "";

  // typed prompt — content is a plain string
  if (typeof message.content === "string") {
    return `▶ user\n${message.content.trim()}`;
  }

  // otherwise it's tool results fed back as a user message — just count them
  const results = message.content.filter((b) => b.type === "tool_result");
  return results.length === 0 ? "" : `  ⎿ ${results.length} tool result(s)`;
}

/** An assistant turn: its text, any tool calls, and a token tally. */
function renderAssistant(message: Message | undefined): string {
  if (!message) return "";

  const lines: string[] = [];
  if (typeof message.content === "string") {
    lines.push(message.content.trim());
  } else {
    for (const block of message.content) {
      if (block.type === "text") lines.push(String(block.text));
      else if (block.type === "tool_use")
        lines.push(`  ⚙ ${String(block.name)}`);
      // thinking blocks: omitted for readability
    }
  }

  // Skip records with no visible body (e.g. a thinking-only record): this
  // session splits one response into a [thinking] record + a [tool_use] record
  // that SHARE usage, so the paired record still shows the tokens — no loss.
  const body = lines.join("\n").trim();
  if (body === "") return "";

  const tokens = formatUsage(message.usage);
  const header = tokens ? `◀ assistant ${tokens}` : "◀ assistant";
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
