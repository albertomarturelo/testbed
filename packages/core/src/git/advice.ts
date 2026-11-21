/** The commit a writing operation returns: its author, when not git's own identity, and the files to stage. */
type AdvisedCommit = { author?: string; files: readonly string[] };

/** Up to this many files are named in the advice; past it, `<files>` stands for `commit.files`. */
const LISTED = 3;

/**
 * The `next` line that says how to commit what a writing operation returned
 * (ADR agent-runs-the-commit §2): stage the files first, then commit exactly
 * them, because `git commit -- <paths>` alone refuses a path Git does not track
 * yet. `what` names them for the reader ("the file", "both files").
 *
 * The paths are workspace-relative, so the advice says to run the commands
 * from the workspace root; it never prints an absolute path. Up to three files
 * are named, shell-quoted when they need it, so the commands can be run as
 * printed once `<message>` is a file holding `commit.message`. More would make
 * a line nobody reads: then `<files>` stands for the paths of `commit.files`,
 * each quoted as its own argument. A commit with an author (an agent's, CI's,
 * or a human's whose identity is not git's: ADR identity-override §4) runs as
 * that identity through `git -c user.name=… -c user.email=…`; one without is
 * the human's own git identity.
 */
export function commitAdvice(what: string, commit: AdvisedCommit): string {
  const { files } = commit;
  const listed = files.length <= LISTED;
  const paths = listed ? files.map(shellQuote).join(" ") : "<files>";
  const only = !listed
    ? "<files> (each path of commit.files, quoted, as its own argument)"
    : files.length === 1
      ? "it"
      : "them";
  const author = commit.author === undefined ? undefined : /^(.+?) <(.+)>$/.exec(commit.author);
  const as = author ? (author[1] as string) : "yourself";
  const git = author
    ? `git -c user.name=${shellQuote(author[1] as string)} -c user.email=${shellQuote(author[2] as string)}`
    : "git";
  return `Commit ${what} as ${as}, with commit.message from --json output saved to a file <message>, staging only ${only}, from the workspace root: \`git add -- ${paths}\` then \`${git} commit -F <message> -- ${paths}\``;
}

/** A path as one shell word: as is when it is plain, single-quoted otherwise. */
function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}
