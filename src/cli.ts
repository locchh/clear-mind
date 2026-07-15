#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { readSession } from "./read";
import { buildIndex, activeBranch } from "./dag";
import { renderBranch } from "./render";
import { renderHtml } from "./renderHtml";

const USAGE = `clear-mind — inspect Claude Code session transcripts

Usage:
  clear-mind viz <path/to/transcript.jsonl>                 render to the terminal
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

  switch (command) {
    case "viz": {
      const records = readSession(path);
      const branch = activeBranch(records, buildIndex(records));

      const htmlFlag = args.indexOf("--html");
      if (htmlFlag === -1) {
        console.log(renderBranch(branch));
        break;
      }

      // --html [out]: next arg is the output path unless it's another flag
      const next = args[htmlFlag + 1];
      const out =
        next && !next.startsWith("--")
          ? next
          : basename(path).replace(/\.jsonl$/, "") + ".html";
      writeFileSync(out, renderHtml(branch, basename(path)));
      console.log(`wrote ${out}`);
      break;
    }
    default:
      console.error(`unknown command: ${command}\n\n${USAGE}`);
      process.exit(1);
  }
}

main(process.argv);
