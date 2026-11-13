// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown, renderMarkdown } from "@/components/Markdown";

afterEach(cleanup);

/** The body of a case migrated in the company trial (#178), as its file has it. */
const MIGRATED = `Migrated from \`dashboard/docs/test-cases/alerts-body_responsiveness.md\` (section "Test Cases"), source ID \`TC_GUI_11\`. Draft pending QA review; no execution or approval was migrated.

Source metadata:

- **Module:** Alerts Page — Alert-Body column — Responsive Layout (Vertical & Horizontal)
- **Source document:** [alerts-body.md](../../../../docs/test-cases/alerts-body.md)
- **Zephyr Project:** EWS ID Watchdog Web
- **Zephyr Release:** Release 1.0

Original row:

| Column | Value |
|---|---|
| ID | TC_GUI_11 |
| Steps | 1. Log in with the browser viewport set to \`VP-MP\` 2. Open an alert with a long title |
| Priority | P1 |
`;

const view = (text: string) => {
  const { container } = render(<Markdown text={text} />);
  return container.firstElementChild as HTMLElement;
};

describe("Markdown (ADR case-body-markdown)", () => {
  it("renders the migrated company case as a document", () => {
    const body = view(MIGRATED);
    // Bold labels in a list, not raw asterisks.
    const items = within(body).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]?.querySelector("strong")?.textContent).toBe("Module:");
    expect(body.textContent).not.toContain("**");
    // Inline code.
    expect(within(body).getByText("TC_GUI_11", { selector: "code" })).toBeTruthy();
    // The GFM table, in its own scroll box.
    const table = within(body).getByRole("table");
    expect(table.parentElement?.className).toBe("md-table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Column", "Value"]);
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("VP-MP", { selector: "code" })).toBeTruthy();
    expect(body.textContent).not.toContain("|---|");
    // The relative link to the source document: its text, the path in the tooltip, no link.
    expect(within(body).queryByRole("link")).toBeNull();
    const source = within(body).getByText("alerts-body.md");
    expect(source.className).toBe("md-link-text");
    expect(source.getAttribute("title")).toBe("../../../../docs/test-cases/alerts-body.md");
  });

  it("keeps a plain-text body's lines and paragraphs", () => {
    const body = view("Needs real credentials: manual.\nNo automated test may sign in.\n\nSecond.");
    const paragraphs = body.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.querySelector("br")).not.toBeNull();
  });

  it("opens web and mail links in a new tab, bare URLs included", () => {
    view(
      "[docs](https://example.com/a) <https://example.com/b> https://example.com/c [mail](mailto:qa@acme.example)",
    );
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
      "mailto:qa@acme.example",
    ]);
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("runs nothing from a hostile body: raw HTML is text, script links and images go", () => {
    const html = renderMarkdown(
      [
        "<script>alert(1)</script>",
        "",
        '<img src="x" onerror="alert(2)">',
        "",
        "[js](javascript:alert(3)) [vb](vbscript:x) [data](data:text/html,<b>x</b>) [file](file:///etc/passwd)",
        "",
        "![tracker](https://evil.example/pixel.png) ![](https://evil.example/no-alt.png)",
        "",
        '<a href="javascript:alert(4)">x</a> <iframe src="https://evil.example"></iframe>',
      ].join("\n"),
    );
    const body = document.createElement("div");
    body.innerHTML = html;
    expect(body.querySelector("script, img, iframe, a[href^='javascript'], [onerror]")).toBeNull();
    expect(body.textContent).toContain("<script>alert(1)</script>");
    expect(body.textContent).toContain('<img src="x" onerror="alert(2)">');
    // No element names javascript:, vbscript:, data: or file: as a target.
    for (const element of body.querySelectorAll("[href], [src]")) {
      expect(element.getAttribute("href") ?? element.getAttribute("src")).toMatch(/^https?:/);
    }
    // An image is its alt text; one without alt is nothing.
    expect(body.querySelector(".md-image-alt")?.textContent).toBe("tracker");
    expect(html).not.toContain("evil.example/pixel.png");
    expect(html).not.toContain("no-alt.png");
  });

  it("escapes a relative link's target in its tooltip", () => {
    const body = view('[x](a"onmouseover="alert(1).md)');
    const text = within(body).getByText("x");
    expect(text.getAttribute("onmouseover")).toBeNull();
  });
});
