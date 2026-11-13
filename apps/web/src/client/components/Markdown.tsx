import MarkdownIt from "markdown-it";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

/**
 * Case bodies as Markdown (ADR case-body-markdown). Raw HTML is escaped
 * (`html: false`), bare URLs become links, a single newline is a line break so
 * plain-text bodies read as before. No plugins. Any change to these options or
 * the rules below is reviewed against the ADR: this is the only place the
 * client sets HTML.
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });
const { escapeHtml } = md.utils;

/** The only targets that stay links; anything else (relative paths included) reads as text. */
const LINKABLE = /^(?:https?:|mailto:)/i;

md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const token = tokens[idx];
  if (token === undefined) return "";
  const href = String(token.attrGet("href") ?? "");
  if (LINKABLE.test(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
    return self.renderToken(tokens, idx, options);
  }
  // The viewer serves no repository files: the link's text, its target in the tooltip.
  const close = tokens.findIndex(
    (t, j) => j > idx && t.type === "link_close" && t.level === token.level,
  );
  const closing = tokens[close];
  if (closing !== undefined) closing.meta = { asText: true };
  return `<span class="md-link-text" title="${escapeHtml(href)}">`;
};

md.renderer.rules.link_close = (tokens, idx, options, _env, self) =>
  tokens[idx]?.meta?.asText === true ? "</span>" : self.renderToken(tokens, idx, options);

// Images are not loaded: the local viewer makes no request a body asks for.
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const alt =
    token === undefined ? "" : self.renderInlineAsText(token.children ?? [], options, env);
  return alt === "" ? "" : `<span class="md-image-alt">${escapeHtml(alt)}</span>`;
};

// A table scrolls sideways in its own box instead of widening the page.
md.renderer.rules.table_open = () => '<div class="md-table"><table>\n';
md.renderer.rules.table_close = () => "</table></div>\n";

/** The HTML markdown-it gives for `text`, with the rules above. */
export function renderMarkdown(text: string): string {
  return md.render(text);
}

/** Styles for the rendered elements, from the viewer's tokens (no typography plugin). */
const PROSE = cn(
  "min-w-0 break-words text-sm leading-relaxed",
  "[&>*+*]:mt-3 [&_p]:max-w-prose [&_ul]:max-w-prose [&_ol]:max-w-prose",
  "[&_h1]:font-semibold [&_h1]:text-lg [&_h2]:font-semibold [&_h2]:text-base",
  "[&_h3]:font-semibold [&_h4]:font-medium [&_h5]:font-medium [&_h6]:font-medium",
  "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li+li]:mt-1",
  "[&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-primary",
  "[&_.md-link-text]:underline [&_.md-link-text]:decoration-dotted [&_.md-link-text]:underline-offset-2",
  "[&_.md-image-alt]:text-muted-foreground [&_.md-image-alt]:italic",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
  "[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_hr]:border-border",
  "[&_.md-table]:max-w-full [&_.md-table]:overflow-x-auto",
  "[&_table]:border-collapse [&_table]:text-xs",
  "[&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
  "[&_td]:border [&_td]:px-2 [&_td]:py-1 [&_td]:align-top",
);

/** A case body rendered as Markdown (ADR case-body-markdown). */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it escapes raw HTML (`html: false`) and the link and image rules above (ADR case-body-markdown)
  return <div className={cn(PROSE, className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
