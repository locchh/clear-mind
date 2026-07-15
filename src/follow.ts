import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { SessionRecordSchema, type SessionRecord } from "./types";
import { buildIndex, activeBranch } from "./dag";
import { buildItems, type Item } from "./items";

/**
 * Incremental follower for a live session file.
 *
 * Session .jsonl is append-only, so new content only ever arrives as bytes
 * past the last offset we read. Each poll():
 *   1. reads ONLY the new bytes (no whole-file re-read),
 *   2. parses the complete new lines (a partially-written last line is kept
 *      as a byte remainder until its newline arrives — split on "\n" bytes,
 *      never mid-character: '\n' is single-byte in UTF-8),
 *   3. rebuilds branch+items (cheap — string ops over a few thousand records)
 *   4. returns the new items plus `changedFrom`: the first item index that
 *      differs from the previous poll. Renderers keep everything before it —
 *      that's what preserves scroll and fold state instead of a full rerun.
 *
 * Returns null when nothing changed.
 */
export type FollowUpdate = { items: Item[]; changedFrom: number };

export class SessionFollower {
  readonly path: string;
  private offset = 0;
  private pending: Buffer = Buffer.alloc(0); // bytes after the last "\n"
  private records: SessionRecord[] = [];
  private lastKeys: string[] = []; // JSON of each item, for the prefix diff

  constructor(path: string) {
    this.path = path;
  }

  poll(): FollowUpdate | null {
    const grew = this.ingestNewBytes();
    if (!grew) return null;

    const branch = activeBranch(this.records, buildIndex(this.records));
    const items = buildItems(branch);

    // prefix diff: first item that differs from last time
    const keys = items.map((it) => JSON.stringify(it));
    let changedFrom = 0;
    while (
      changedFrom < keys.length &&
      changedFrom < this.lastKeys.length &&
      keys[changedFrom] === this.lastKeys[changedFrom]
    ) {
      changedFrom++;
    }
    // nothing visible changed (e.g. only metadata records arrived)
    if (changedFrom === keys.length && keys.length === this.lastKeys.length)
      return null;

    this.lastKeys = keys;
    return { items, changedFrom };
  }

  /** Read bytes [offset..EOF), buffer any trailing partial line. */
  private ingestNewBytes(): boolean {
    let fd: number;
    try {
      fd = openSync(this.path, "r");
    } catch {
      return false; // file briefly missing (rotation?) — try again next poll
    }
    try {
      const size = fstatSync(fd).size;
      if (size < this.offset) {
        // truncated/replaced — start over (defensive; shouldn't happen for
        // append-only files)
        this.offset = 0;
        this.pending = Buffer.alloc(0);
        this.records = [];
      }
      if (size === this.offset) return false;

      const buf = Buffer.alloc(size - this.offset);
      readSync(fd, buf, 0, buf.length, this.offset);
      this.offset = size;

      const data = Buffer.concat([this.pending, buf]);
      const lastNl = data.lastIndexOf(0x0a);
      if (lastNl === -1) {
        this.pending = data; // still mid-line
        return false;
      }
      this.pending = data.subarray(lastNl + 1);

      let parsedAny = false;
      for (const line of data
        .subarray(0, lastNl)
        .toString("utf8")
        .split("\n")) {
        if (line.trim() === "") continue;
        let obj: unknown;
        try {
          obj = JSON.parse(line);
        } catch {
          continue; // corrupt line — same policy as readSession
        }
        const result = SessionRecordSchema.safeParse(obj);
        if (result.success) {
          this.records.push(result.data);
          parsedAny = true;
        }
      }
      return parsedAny;
    } finally {
      closeSync(fd);
    }
  }
}
