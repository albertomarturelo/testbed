import { describe, expect, it } from "vitest";
import { parseXml, type XmlElement } from "./xml.js";

const parsed = (text: string): XmlElement => {
  const result = parseXml(text, "report.xml");
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
};
const errorOf = (text: string) => {
  const result = parseXml(text, "report.xml");
  if (result.ok) throw new Error("expected an error");
  return result.errors[0];
};

describe("parseXml", () => {
  it("reads elements, attributes, text and CDATA with positions", () => {
    const root = parsed(
      `\uFEFF<?xml version="1.0"?>\n<!-- report -->\n<a x="1" y='two &amp; &#51;&#x34;'>hi <b/><c>&lt;x&gt;<![CDATA[<raw> & ]]></c><?pi skip?><!-- c --></a>\n`,
    );
    expect(root).toMatchObject({ name: "a", attributes: { x: "1", y: "two & 34" }, line: 3 });
    expect(root.text).toBe("hi ");
    expect(root.children.map((c) => [c.name, c.text, c.line, c.column])).toEqual([
      ["b", "", 3, 39],
      ["c", "<x><raw> & ", 3, 43],
    ]);
  });

  it("decodes &quot; &apos; and keeps whitespace inside attributes", () => {
    expect(parsed(`<a v="&quot;q&quot; &apos;s&apos;" w = "a  b"/>`).attributes).toEqual({
      v: `"q" 's'`,
      w: "a  b",
    });
  });

  it("does not overflow the stack on deep nesting", () => {
    const depth = 100_000;
    const root = parsed(`${"<a>".repeat(depth)}${"</a>".repeat(depth)}`);
    expect(root.name).toBe("a");
  });

  it.each([
    ["<!DOCTYPE a [<!ENTITY x 'y'>]><a/>", 1, 1, "a DOCTYPE is not supported"],
    ["<a><b></a>", 1, 7, "</a> does not close <b>"],
    ["<a>\n  <b>", 2, 6, "<b> (line 2) is never closed"],
    ['<a v="&nbsp;"/>', 1, 7, "unknown or malformed reference &nbsp;"],
    ["<a>&#0;</a>", 1, 4, "unknown or malformed reference &#0;"],
    ["<a>&#xD800;</a>", 1, 4, "unknown or malformed reference &#xD800;"],
    ["<a>a & b</a>", 1, 6, "unknown or malformed reference"],
    ['<a v="1" v="2"/>', 1, 10, "attribute v appears twice in <a>"],
    ["<a v=1/>", 1, 6, "attribute v is not quoted"],
    ['<a v="1/>', 1, 6, "attribute v is never closed"],
    ['<a v="<"/>', 1, 6, "attribute v contains <"],
    ["<a v/>", 1, 5, "attribute v has no value"],
    ['<a v="1"w="2"/>', 1, 9, "expected whitespace, > or /> in <a>"],
    ["<a/><b/>", 1, 5, "content after the root element"],
    ["text", 1, 1, "expected the root element"],
    ["", 1, 1, "expected the root element"],
    ["<a><!-- open</a>", 1, 4, "<!-- is never closed"],
    ["<!-- open", 1, 1, "<!-- is never closed"],
    ["<a><![CDATA[x</a>", 1, 4, "<![CDATA[ is never closed"],
    ["<a><!ELEMENT a></a>", 1, 4, "unexpected markup declaration"],
    ["<a></ a>", 1, 4, "malformed closing tag"],
    ["<a>< b/></a>", 1, 4, "expected an element name after <"],
    ["<a 1='x'/>", 1, 4, "malformed attribute in <a>"],
  ])("refuses %j at %i:%i", (text, line, column, message) => {
    const error = errorOf(text);
    expect(error).toMatchObject({
      code: "ingest.invalid_report",
      path: "report.xml",
      line,
      column,
    });
    expect(error?.message).toContain(message);
  });
});
