/**
 * Pure text helpers shared by every renderer (Ink TUI, HTML export).
 * No ANSI, no HTML, no Ink — just string → string, so both renderers and
 * their tests can use them freely.
 */

/** "1 line" / "42 lines" — pluralized, because "1 lines" reads as unfinished. */
export function lineCount(text: string): string {
  const n = text === "" ? 0 : text.split("\n").length;
  return `${n} ${n === 1 ? "line" : "lines"}`;
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

/** True when a typed prompt is only a shell stdout/echo, not something typed. */
export function isEcho(raw: string): boolean {
  return (
    /<bash-stdout>|<local-command-stdout>/.test(raw) &&
    !/<bash-input>/.test(raw)
  );
}

/** Collapse to a genuine single line: first line, clamped, "…" if truncated
 *  or if more lines follow (heredoc commands etc.). Summaries must be 1 line. */
function oneLine(text: string, max = 100): string {
  const first = text.split("\n")[0] ?? "";
  const hasMore = text.includes("\n");
  if (first.length > max) return first.slice(0, max - 1) + "…";
  return hasMore ? first + " …" : first;
}

/**
 * The one informative line of a tool call's input: a Bash command, a file
 * path — falling back to compact JSON only when we don't know better.
 */
export function toolInputLine(input: unknown): string {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (typeof o.command === "string") return oneLine(o.command);
    if (typeof o.file_path === "string") return oneLine(o.file_path);
    if (typeof o.path === "string") return oneLine(o.path);
    if (typeof o.pattern === "string") return oneLine(o.pattern);
  }
  return oneLine(JSON.stringify(input) ?? "");
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
