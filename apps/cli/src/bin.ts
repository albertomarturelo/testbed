#!/usr/bin/env node
import { run } from "./cli.js";

const result = await run(process.argv.slice(2), { cwd: process.cwd(), env: process.env });
if (result.stdout) process.stdout.write(`${result.stdout}\n`);
if (result.stderr) process.stderr.write(`${result.stderr}\n`);
process.exitCode = result.code;
