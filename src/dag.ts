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
 * The active conversation, root → leaf.
 *
 * The file is a flat log that can branch (edit/rewind builds a tree); only one
 * branch is "live". Its head is the LAST `last-prompt` record's `leafUuid`
 * (append-latest-wins). Walk `parentUuid` from that leaf back to the root, then
 * reverse — the chain is collected leaf→root but reads root→leaf.
 */
export function activeBranch(
  records: SessionRecord[],
  index: Map<string, SessionRecord>,
): SessionRecord[] {
  // 1. find the live leaf uuid.
  //    `leafUuid` lives on `last-prompt` records, which the loose SessionRecord
  //    type doesn't expose — narrow with LastPromptSchema to read it. Take the
  //    LAST match: metadata is append-latest-wins.
  let leafUuid: string | undefined;
  for (const r of records) {
    if (r.type !== "last-prompt") continue;
    const parsed = LastPromptSchema.safeParse(r);
    if (parsed.success) leafUuid = parsed.data.leafUuid;
  }
  if (!leafUuid) return []; // no prompt recorded yet → nothing to draw

  // 2. walk parentUuid from leaf back to root
  const chain: SessionRecord[] = [];
  let cur = index.get(leafUuid);
  while (cur) {
    chain.push(cur);
    cur = cur.parentUuid ? index.get(cur.parentUuid) : undefined;
  }

  // 3. collected leaf→root; conversation reads root→leaf
  return chain.reverse();
}
