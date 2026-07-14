import { readFileSync } from "node:fs";
import { SessionRecordSchema, type SessionRecord } from "./types";

/**
 * Read a session .jsonl into validated records.
 *
 * Defensive (format doc caveat #9): a blank or malformed line is skipped,
 * never fatal — one bad line must not sink the whole session.
 */
export function readSession(path: string): SessionRecord[] {
  const records: SessionRecord[] = [];

  // 1. read the whole file as text
  //    (throws on a missing/unreadable path — that's a real error, not a line to skip)
  const text = readFileSync(path, "utf8");

  // 2. one record per line — split on "\n"
  for (const line of text.split("\n")) {
    // 2a. skip blanks — a trailing newline leaves an empty final entry
    if (line.trim() === "") continue;

    // 2b. parse JSON — a corrupt line must NOT throw
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    // 2c. validate WITHOUT throwing — safeParse returns {success, data}, never an exception
    const result = SessionRecordSchema.safeParse(parsed);
    if (!result.success) continue; // no valid `type` → skip
    records.push(result.data);
  }

  // 3. hand back everything that parsed
  return records;
}
