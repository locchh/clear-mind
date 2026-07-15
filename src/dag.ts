import { LastPromptSchema, type SessionRecord } from "./types";

/**
 * uuid → record lookup table.
 *
 * The branch walk follows `parentUuid` pointers; without an index each hop
 * would be an O(n) scan of every record. Only records that carry a `uuid`
 * (the conversation types) go in — metadata records have nothing to look up by.
 */
export function buildIndex(
  records: SessionRecord[],
): Map<string, SessionRecord> {
  const index = new Map<string, SessionRecord>();
  for (const r of records) {
    if (r.uuid) index.set(r.uuid, r);
  }
  return index;
}

/**
 * The active conversation, root → leaf. Three steps, each hardened against a
 * failure mode found by auditing all ~370 real session files:
 *
 * 1. Find the branch head: the LAST `last-prompt` record's `leafUuid`
 *    (append-latest-wins). Fallback — some sessions have no usable
 *    `last-prompt` at all — the last record in file order that carries a uuid.
 * 2. Extend to the true tip: `leafUuid` is written at prompt-SUBMIT time, so
 *    the records appended after it (the whole final assistant turn) hang
 *    BELOW it. Descend the children chain, taking the latest-appended child
 *    at each fork (later append == the active continuation).
 * 3. Walk back to the root via `parentUuid`, falling back to
 *    `logicalParentUuid` at compact boundaries (`parentUuid: null` there, but
 *    the file keeps full pre-compact history — only the model's view shrinks).
 *
 * Known bounded limitation (2 of ~373 real files): when compaction fires
 * mid-turn, the in-flight turn is replayed below the boundary and the file's
 * pointer graph becomes genuinely cyclic — the orphaned pre-compact history is
 * then unreachable by ANY pointer-following algorithm. The cycle guards keep
 * the walk terminating and correct for everything reachable.
 */
export function activeBranch(
  records: SessionRecord[],
  index: Map<string, SessionRecord>,
): SessionRecord[] {
  // 1a. the recorded branch head, if any
  let leafUuid: string | undefined;
  for (const r of records) {
    if (r.type !== "last-prompt") continue;
    const parsed = LastPromptSchema.safeParse(r);
    if (parsed.success) leafUuid = parsed.data.leafUuid;
  }
  // 1b. fallback: unrecorded or unresolvable head → last uuid-bearing record
  if (!leafUuid || !index.has(leafUuid)) {
    for (const r of records) if (r.uuid) leafUuid = r.uuid;
  }
  if (!leafUuid) return []; // nothing chained at all

  // 2. descend from the recorded head to the true tip
  const children = new Map<string, string[]>();
  for (const r of records) {
    if (!r.uuid || !r.parentUuid) continue;
    const siblings = children.get(r.parentUuid) ?? [];
    siblings.push(r.uuid); // records array is file order → append order
    children.set(r.parentUuid, siblings);
  }
  let tip = leafUuid;
  const descended = new Set<string>([tip]); // guard: cyclic files must not loop
  while (true) {
    const kids = children.get(tip);
    if (!kids || kids.length === 0) break;
    const next = kids[kids.length - 1]!; // latest append = active continuation
    if (descended.has(next)) break;
    descended.add(next);
    tip = next;
  }

  // 3. walk from tip back to the root
  const chain: SessionRecord[] = [];
  const seen = new Set<string>(); // guard: a malformed file must not loop us
  let cur = index.get(tip);
  while (cur && cur.uuid && !seen.has(cur.uuid)) {
    seen.add(cur.uuid);
    chain.push(cur);
    const parent = cur.parentUuid ?? cur.logicalParentUuid;
    cur = parent ? index.get(parent) : undefined;
  }

  // collected tip→root; conversation reads root→tip
  return chain.reverse();
}
