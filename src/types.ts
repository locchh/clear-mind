import { z } from "zod";

/**
 * Zod schemas + inferred types for session JSONL records.
 *
 * Parse defensively (see docs/session-jsonl-format.md caveat #9): the format is
 * undocumented and fields shift between versions, so every object is a
 * `z.looseObject` — fields we don't name pass through instead of being dropped —
 * and the top-level `SessionRecordSchema` accepts ANY `type` without throwing.
 * (`z.looseObject({...})` is Zod 4's replacement for the deprecated
 * `z.object({...}).passthrough()`.)
 */

/* --- content blocks: inside message.content[] --- */

export const TextBlockSchema = z.looseObject({
  type: z.literal("text"),
  text: z.string(),
});

export const ThinkingBlockSchema = z.looseObject({
  type: z.literal("thinking"),
  thinking: z.string(),
  signature: z.string().optional(), // may be present with an empty `thinking`
});

export const ToolUseBlockSchema = z.looseObject({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.unknown(), // arbitrary per-tool arguments — don't validate the shape
  caller: z.looseObject({ type: z.string() }).optional(), // {type:"direct"} = main loop
});

export const ToolResultBlockSchema = z.looseObject({
  type: z.literal("tool_result"),
  tool_use_id: z.string(), // pairs this result to its tool_use by id
  content: z.union([z.string(), z.array(z.unknown())]), // flattened string OR list of sub-blocks
  is_error: z.boolean().optional(), // present only on failed tool calls
});

/** Known blocks + an unknown-block fallback so new block types never crash the reader. */
export const ContentBlockSchema = z.union([
  TextBlockSchema,
  ThinkingBlockSchema,
  ToolUseBlockSchema,
  ToolResultBlockSchema,
  // fallback: any object with a string `type` — matches block kinds we haven't modeled.
  // The union is tried top-down, so this only catches what the four above reject,
  // keeping the reader forward-compatible instead of throwing on a new block type.
  z.looseObject({ type: z.string() }),
]);

/* --- usage: assistant.message.usage --- */

export const UsageSchema = z.looseObject({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  cache_creation: z
    .looseObject({
      ephemeral_1h_input_tokens: z.number().optional(),
      ephemeral_5m_input_tokens: z.number().optional(),
    })
    .optional(),
  service_tier: z.string().optional(),
  speed: z.string().optional(),
});

/* --- message: inside user/assistant records --- */

export const MessageSchema = z.looseObject({
  role: z.string(), // "user" | "assistant"
  content: z.union([z.string(), z.array(ContentBlockSchema)]), // string = typed prompt; array = blocks
  stop_reason: z.string().nullable().optional(), // "tool_use" | "end_turn" | null (cut off)
  usage: UsageSchema.optional(), // assistant only
  model: z.string().optional(), // assistant only
});

/* --- conversation envelope: user/assistant/system/attachment --- */

export const ConversationEnvelopeSchema = z.looseObject({
  type: z.string(),
  uuid: z.string(),
  parentUuid: z.string().nullable(), // null = chain root
  timestamp: z.string().optional(), // optional: renderers must survive its absence (caveat #9)
  sessionId: z.string().optional(),
  logicalParentUuid: z.string().optional(), // only on compact_boundary
  requestId: z.string().optional(), // assistant only
  isSidechain: z.boolean().optional(), // true inside subagent transcripts
  isMeta: z.boolean().optional(), // injected context, not typed by the user
  promptId: z.string().optional(), // user records only
  message: MessageSchema.optional(), // absent on system/attachment
});

/* --- metadata records: tiny, no envelope, latest-occurrence-wins --- */

/** `last-prompt` — its `leafUuid` marks the active-branch head (used to walk
 *  the DAG). `lastPrompt` is optional: real sessions exist where the record
 *  carries only `leafUuid` + `sessionId`, and requiring the text made the
 *  whole branch walk come up empty. */
export const LastPromptSchema = z.looseObject({
  type: z.literal("last-prompt"),
  lastPrompt: z.string().optional(),
  leafUuid: z.string(),
});

/* --- top-level: permissive, every line validates against this --- */

export const SessionRecordSchema = z.looseObject({
  type: z.string(),
  uuid: z.string().optional(),
  parentUuid: z.string().nullable().optional(),
  logicalParentUuid: z.string().optional(), // compact_boundary: link to pre-compact history
});

/* --- inferred types --- */

export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export type Usage = z.infer<typeof UsageSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ConversationEnvelope = z.infer<typeof ConversationEnvelopeSchema>;
export type SessionRecord = z.infer<typeof SessionRecordSchema>;

/* --- type guards: narrow a loose record by category --- */

/** Conversation records carry the DAG envelope (uuid + parentUuid). */
const CONVERSATION_TYPES = new Set([
  "user",
  "assistant",
  "system",
  "attachment",
]);

export function isConversation(r: SessionRecord): boolean {
  return CONVERSATION_TYPES.has(r.type);
}
