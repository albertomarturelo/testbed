import { execFile } from "node:child_process";
import { fail, ok, type Result } from "../errors.js";
import { Email } from "../schema/index.js";

/** Who the person is and which source said so (ADR identity-override). */
export type Identity = {
  email: string;
  name?: string;
  source: "explicit" | "env" | "git";
};

/**
 * What a host read before asking core who the person is: an explicit flag, the
 * `CASEFILE_USER_EMAIL` / `CASEFILE_USER_NAME` environment, `git config`. Core
 * reads no environment itself (ADR cli-generic-host §3).
 */
export type IdentitySources = {
  explicit?: string;
  env?: { email?: string; name?: string };
  git?: { email?: string | null; name?: string | null };
};

/**
 * The person's identity, first source that answers wins: explicit, then the
 * environment, then git (ADR identity-override §1). `null` when none does; the
 * operation that needs one says `identity.missing`. A malformed email is
 * `identity.invalid`, naming the source so a stale variable is found.
 */
export function resolveIdentity(sources: IdentitySources): Result<Identity | null> {
  const candidates: [Identity["source"], string | undefined, string | undefined][] = [
    ["explicit", sources.explicit, undefined],
    ["env", blank(sources.env?.email), blank(sources.env?.name)],
    ["git", blank(sources.git?.email), blank(sources.git?.name)],
  ];
  for (const [source, email, name] of candidates) {
    if (email === undefined) continue;
    if (!Email.safeParse(email).success) {
      return fail({
        code: "identity.invalid",
        field: "identity",
        message: `${WHERE[source]} is not an email: '${email}' (set it to the address the change should name, as user@example.com)`,
      });
    }
    return ok(name === undefined ? { email, source } : { email, name, source });
  }
  return ok(null);
}

const WHERE: Record<Identity["source"], string> = {
  explicit: "--requested-by",
  env: "CASEFILE_USER_EMAIL",
  git: "git config user.email",
};

/** An unset or empty value does not answer. */
function blank(value: string | null | undefined): string | undefined {
  return value === null || value === undefined || value.trim() === "" ? undefined : value.trim();
}

/**
 * Git adapter: `git config user.email` as Git resolves it in `dir` (local, then
 * global and system config), or `null` when it is unset or Git is unavailable.
 * Hosts fill the `identity` host input with it (ADR cli-generic-host §3).
 */
export function gitUserEmail(
  dir: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["config", "user.email"], { cwd: dir, env }, (error, stdout) => {
      const email = error === null ? stdout.trim() : "";
      resolve(email === "" ? null : email);
    });
  });
}
