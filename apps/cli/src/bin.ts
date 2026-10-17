#!/usr/bin/env node
import { run } from "./cli.js";

try {
  const result = await run(process.argv.slice(2), { cwd: process.cwd(), env: process.env });
  if (result.stdout) process.stdout.write(`${result.stdout}\n`);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
  process.exitCode = result.code;
} catch (error) {
  // `run` returns errors as values; anything thrown is a bug or an environment failure.
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`casefile: internal error, please report it\n${detail}\n`);
  process.exitCode = 1;
}
