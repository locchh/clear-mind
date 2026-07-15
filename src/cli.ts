#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { readSession } from "./read";
import { buildIndex, activeBranch } from "./dag";
import { buildItems } from "./items";
import { runTui } from "./renderInk";
import { renderHtml } from "./renderHtml";

const USAGE = `clear-mind — inspect Claude Code session transcripts

Usage:
  clear-mind viz <path/to/transcript.jsonl>                 interactive terminal viewer (TUI)
  clear-mind viz <path/to/transcript.jsonl> --html [out]    export a chat-style HTML page
                                                            (default out: <session>.html)`;

function main(argv: string[]): void {
  // argv[0] = bun, argv[1] = this script — real args start at [2]
  const args = argv.slice(2);
  const [command, path] = args;

  if (!command || !path) {
    console.error(USAGE);
    process.exit(1);
  }

  if (command !== "viz") {
    console.error(`unknown command: ${command}\n\n${USAGE}`);
    process.exit(1);
  }

  const records = readSession(path);
  const branch = activeBranch(records, buildIndex(records));

  // --html [out]: next arg is the output path unless it's another flag
  const htmlFlag = args.indexOf("--html");
  if (htmlFlag !== -1) {
    const next = args[htmlFlag + 1];
    const out =
      next && !next.startsWith("--")
        ? next
        : basename(path).replace(/\.jsonl$/, "") + ".html";
    writeFileSync(out, renderHtml(branch, basename(path)));
    console.log(`wrote ${out}`);
    return;
  }

  // interactive TUI — needs a real terminal; it can't be piped/redirected
  if (!process.stdout.isTTY) {
    console.error(
      "viz is an interactive terminal viewer and needs a TTY.\n" +
        "Piping/redirect isn't supported — export instead:\n" +
        `  clear-mind viz ${path} --html`,
    );
    process.exit(1);
  }

  runTui(buildItems(branch), basename(path));
}

main(process.argv);
