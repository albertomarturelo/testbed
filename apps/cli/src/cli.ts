import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

const USAGE = `casefile ${pkg.version} (preview)

Usage: casefile <command> [--cwd <dir>]

No commands are available yet; they arrive with the operation registry (#11).

Options:
  -h, --help     Show this help
  -v, --version  Show the version`;

export function run(argv: readonly string[]): CliResult {
  const [first] = argv;
  if (first === undefined || first === "-h" || first === "--help") {
    return { code: 0, stdout: USAGE, stderr: "" };
  }
  if (first === "-v" || first === "--version") {
    return { code: 0, stdout: pkg.version, stderr: "" };
  }
  return { code: 1, stdout: "", stderr: `casefile: unknown command '${first}'\n\n${USAGE}` };
}
