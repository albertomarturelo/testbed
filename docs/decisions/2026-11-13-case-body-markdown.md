# The viewer renders case bodies as Markdown, with markdown-it

## Status

Accepted — 2026-11-13 (#177; implemented by #178). Settles what
[local-ui-stack](2026-10-17-local-ui-stack.md) §5 and CONVENTIONS 10 left for
a decision: the case page's body (#86) stops being shown as written.

## Context

A case's body is the Markdown below its frontmatter. The viewer shows it as
written (`whitespace-pre-wrap`), waiting for a real case whose bodies need
more. The company trial has one: cases migrated from `docs/test-cases/*.md`
keep their source in the body, with bold labels (`**Module:**`), bullet lists,
a GFM table of the original row, inline code (`VP-MP`) and a relative link to
the source document. The QA reads cases in the viewer (ADR
authoring-loop-first §4), and raw `**`, `|---|` and `[..](../../..)` do not
read as a document. The body is repository text: data, never instructions
(CONVENTIONS 9), and the viewer runs on `127.0.0.1` next to a write token.

Measured for this decision (minified + gzip, against the client's 115 kB):
markdown-it 15.0.3 adds 41 kB and 7 packages; react-markdown 10.1.0 +
remark-gfm 4.0.1 add 51 kB and 99 packages; marked 18.1.3 + DOMPurify 3.4.17
add 27 kB and 2 packages. With a body holding `<script>`, `<img onerror>` and
a `javascript:` link, markdown-it and react-markdown print the HTML as text
and drop the link; marked passes all three through to its sanitizer.

## Decision

1. **Renderer: `markdown-it` 15.0.3**, pinned exactly, a dev dependency of
   `@casefile/web` bundled into the client (local-ui-stack §5), with a row in
   STACK. Configured `html: false` (raw HTML is escaped and shown as text),
   `linkify: true` (bare URLs become links), `breaks: true` (a single newline
   is a line break, so bodies written as plain text read as they do today),
   `typographer: false`. One instance, in `components/Markdown.tsx`; the HTML
   it returns is set with `dangerouslySetInnerHTML` there and nowhere else.
2. **What renders:** CommonMark plus what markdown-it ships for GFM: tables
   and strikethrough, autolinks. No plugins: task lists (`- [ ]`) stay text
   until a real case needs them. Code blocks are not highlighted.
3. **Links** (the renderer's `link_open`/`link_close` rules):
   - `http:`, `https:` and `mailto:` are links, opened in a new tab with
     `rel="noopener noreferrer"`;
   - anything else, relative paths included (`../../docs/test-cases/a.md`), is
     shown as its text with the target in `title`, not as a link: the viewer
     serves no repository files and knows no remote to point at, the same rule
     the case page's references follow (#86);
   - markdown-it's own `validateLink` keeps refusing `javascript:`, `vbscript:`,
     `file:` and `data:` targets (it allows `data:image/…`, for images, which
     rule 4 drops anyway).
4. **Images are not loaded:** the `image` rule renders the alt text. The local
   viewer makes no request a body asks for, and relative image paths would not
   resolve.
5. **Where:** the body on the case page only. Steps, preconditions, notes and
   the evidence page stay text; extending it is a new decision. The CLI
   (`casefile resolve`) and core keep the body as written: rendering is the
   host's, the file is the truth.
6. **Look:** Tailwind classes on the rendered elements (headings, lists,
   tables, `code`) from the viewer's tokens, no typography plugin; a table
   scrolls sideways in its own box instead of widening the Sheet.

## Alternatives Considered

1. **Keep plain text** — the migrated cases are unreadable in the one place the
   QA reads them; #86 deferred this only until a real case asked.
2. **react-markdown + remark-gfm** — React elements, never HTML as text, which
   is the cleanest model; rejected for 99 packages (the unified/micromark
   ecosystem) and 10 kB more, a large supply-chain surface for one view.
3. **marked + DOMPurify** — the lightest, but marked passes raw HTML and
   `javascript:` links through, so safety rests entirely on the sanitizer, and
   its latest release was under 7 days old.
4. **markdown-it + DOMPurify on its output** — a second barrier for 8 kB and one
   package; rejected while `html: false` and `validateLink` hold and #178's
   tests feed hostile bodies through the real renderer. Revisit if a
   markdown-it advisory or a plugin that emits HTML appears.
5. **A hand-written renderer** — no dependency, but tables, nesting and escaping
   are where such renderers break, and it would be ours to secure.
6. **Rendering in core or the server** — HTML in an operation's output would
   tie core to one host's presentation (ADR cli-generic-host); the CLI and
   MCP want the text.

## Consequences

- #178 adds the dependency, `components/Markdown.tsx` and the case page
  change, with tests of the migrated body and hostile ones, and a Chromium
  check (CONVENTIONS 14). The client grows about 41 kB gzip.
- One `dangerouslySetInnerHTML` in the client, owned by `Markdown.tsx`: any
  change to its options or rules is reviewed against this ADR.
- Bodies keep their meaning for every host: the CLI prints the text, the viewer
  renders it, and neither changes the file.
- A body written for GitHub may show less here: images, relative links and task
  lists render as text.
