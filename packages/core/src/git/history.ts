import { execFile } from "node:child_process";

/**
 * A commit's signature as `git log` checks it where casefile runs (`%G?`):
 * `verified` (good and trusted), `unverified` (signed, but this Git cannot
 * vouch for it: unknown key, expired, revoked, or no key to check with),
 * `bad`, or `none`.
 */
export type CommitSignature = "verified" | "unverified" | "bad" | "none";

/** The commit that last wrote a file, as Git reports it. */
export type FileCommit = {
  sha: string;
  /** `Name <email>` of the author. */
  author: string;
  /** Committer date, ISO 8601 in UTC (`…Z`), like every date in the evidence. */
  at: string;
  signature: CommitSignature;
  /** Who signed, as Git names the key (`%GS`); `null` when unsigned or unknown. */
  signer: string | null;
  /** The file in the working tree differs from that commit. */
  modified: boolean;
};

/** `%G?` as a {@link CommitSignature} (ADR milestones-group-executions §6, #208). */
export function signatureStatus(code: string): CommitSignature {
  switch (code.trim()) {
    case "G":
      return "verified";
    case "B":
      return "bad";
    case "N":
    case "":
      return "none";
    default:
      // U (unknown validity), X / Y (expired signature / key), R (revoked), E (cannot check).
      return "unverified";
  }
}

/**
 * Git adapter: the last commit that touched `path` (relative to `dir`), with
 * its signature, or `null` outside a repository, when Git is unavailable, or
 * while the file is not committed yet. A thin adapter, like `gitBranch`.
 */
export async function gitLastCommit(
  dir: string,
  path: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<FileCommit | null> {
  const log = await git(dir, env, [
    "log",
    "-1",
    "--format=%H%x00%an <%ae>%x00%cI%x00%G?%x00%GS",
    "--",
    path,
  ]);
  if (log === null) return null;
  const [sha, author, at, code, signer] = log.replace(/\n$/, "").split("\0");
  if (sha === undefined || sha === "" || author === undefined || at === undefined) return null;
  const status = await git(dir, env, ["status", "--porcelain", "--", path]);
  let signature = signatureStatus(code ?? "");
  if (signature === "none") {
    // Without `gpg.ssh.allowedSignersFile` Git answers `N` for an SSH-signed
    // commit: the commit's own header says whether a signature is there.
    const raw = await git(dir, env, ["cat-file", "commit", sha]);
    if (raw !== null && /^gpgsig(-sha256)? /m.test(raw.split("\n\n", 1)[0] ?? "")) {
      signature = "unverified";
    }
  }
  const when = new Date(at);
  return {
    sha,
    author,
    at: Number.isNaN(when.getTime()) ? at : when.toISOString().replace(/\.\d{3}Z$/, "Z"),
    signature,
    signer:
      signature === "none" || signer === undefined || signer.trim() === "" ? null : signer.trim(),
    modified: status !== null && status.trim() !== "",
  };
}

/** stdout of `git <args>` in `dir`, or `null` when it fails. */
function git(
  dir: string,
  env: Readonly<Record<string, string | undefined>>,
  args: string[],
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: dir, env }, (error, stdout) => {
      resolve(error === null ? stdout : null);
    });
  });
}
