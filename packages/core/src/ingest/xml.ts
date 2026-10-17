import { fail, ok, type Result } from "../errors.js";

/** An XML element with its attributes, child elements and concatenated text. */
export type XmlElement = {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** Text and CDATA directly inside the element, in order, entities decoded. */
  text: string;
  /** 1-based position of the `<` that opens the element. */
  line: number;
  column: number;
};

const NAME = /[A-Za-z_:][-A-Za-z0-9_.:]*/y;
const SPACE = /[ \t\r\n]*/y;
const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/**
 * A small XML reader for test reports (ADR ingester-contract §8): elements,
 * attributes, text, CDATA, comments, processing instructions, the five
 * predefined entities and character references. A `DOCTYPE` is refused, so
 * nothing is expanded or fetched. Iterative: nesting depth cannot overflow the
 * stack. Errors are `ingest.invalid_report` with the line and column in `path`.
 */
export function parseXml(source: string, path: string): Result<XmlElement> {
  const text = source.startsWith("﻿") ? source.slice(1) : source;
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const at = (offset: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((lineStarts[mid] as number) <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - (lineStarts[low] as number) + 1 };
  };
  const error = (offset: number, message: string): Result<XmlElement> =>
    fail<XmlElement>({ code: "ingest.invalid_report", path, ...at(offset), message });

  let i = 0;
  const skipSpace = () => {
    SPACE.lastIndex = i;
    SPACE.exec(text);
    i = SPACE.lastIndex;
  };
  const readName = (): string | null => {
    NAME.lastIndex = i;
    const match = NAME.exec(text);
    if (match === null) return null;
    i = NAME.lastIndex;
    return match[0];
  };
  /** Skips `<!-- -->` or `<? ?>` at `i`: true, false when neither starts there, else why not. */
  const skipMarkup = (): boolean | string => {
    for (const [open, close] of [
      ["<!--", "-->"],
      ["<?", "?>"],
    ] as const) {
      if (!text.startsWith(open, i)) continue;
      const end = text.indexOf(close, i + open.length);
      if (end === -1) return `${open} is never closed`;
      i = end + close.length;
      return true;
    }
    return false;
  };
  /** Skips whitespace, comments and processing instructions outside the root. */
  const skipMisc = (): Result<XmlElement> | null => {
    for (;;) {
      skipSpace();
      if (text.startsWith("<!DOCTYPE", i)) {
        return error(i, "a DOCTYPE is not supported in a test report");
      }
      const skipped = skipMarkup();
      if (skipped === false) return null;
      if (skipped !== true) return error(i, skipped);
    }
  };

  const misc = skipMisc();
  if (misc !== null) return misc;
  if (text[i] !== "<") return error(i, "expected the root element");

  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  while (root === null) {
    if (i >= text.length) {
      const open = stack[stack.length - 1] as XmlElement;
      return error(i, `<${open.name}> (line ${open.line}) is never closed`);
    }
    const parent = stack[stack.length - 1];
    if (text.startsWith("</", i)) {
      const start = i;
      i += 2;
      const name = readName();
      skipSpace();
      if (name === null || text[i] !== ">") return error(start, "malformed closing tag");
      if (parent === undefined || name !== parent.name) {
        return error(
          start,
          `</${name}> does not close ${parent ? `<${parent.name}>` : "anything"}`,
        );
      }
      i++;
      stack.pop();
      if (stack.length === 0) root = parent;
      continue;
    }
    if (text.startsWith("<![CDATA[", i) && parent !== undefined) {
      const end = text.indexOf("]]>", i);
      if (end === -1) return error(i, "<![CDATA[ is never closed");
      parent.text += text.slice(i + 9, end);
      i = end + 3;
      continue;
    }
    const skipped = parent === undefined ? false : skipMarkup();
    if (skipped === true) continue;
    if (skipped !== false) return error(i, skipped);
    if (text.startsWith("<!", i)) return error(i, "unexpected markup declaration");

    if (text[i] === "<") {
      const start = i;
      i++;
      const name = readName();
      if (name === null) return error(start, "expected an element name after <");
      const element: XmlElement = {
        name,
        attributes: {},
        children: [],
        text: "",
        ...at(start),
      };
      for (;;) {
        const before = i;
        skipSpace();
        if (text.startsWith("/>", i) || text[i] === ">") break;
        if (i === before) return error(i, `expected whitespace, > or /> in <${name}>`);
        const attrAt = i;
        const attr = readName();
        if (attr === null) return error(i, `malformed attribute in <${name}>`);
        skipSpace();
        if (text[i] !== "=") return error(i, `attribute ${attr} has no value`);
        i++;
        skipSpace();
        const quote = text[i];
        if (quote !== '"' && quote !== "'") return error(i, `attribute ${attr} is not quoted`);
        const end = text.indexOf(quote, i + 1);
        if (end === -1) return error(i, `attribute ${attr} is never closed`);
        const raw = text.slice(i + 1, end);
        if (raw.includes("<")) return error(i, `attribute ${attr} contains <`);
        const value = decode(raw);
        if (typeof value !== "string") return error(i + 1 + value.offset, value.message);
        if (Object.hasOwn(element.attributes, attr)) {
          return error(attrAt, `attribute ${attr} appears twice in <${name}>`);
        }
        element.attributes[attr] = value;
        i = end + 1;
      }
      if (parent === undefined) stack.push(element);
      else {
        parent.children.push(element);
        stack.push(element);
      }
      if (text[i] === "/") {
        i += 2;
        stack.pop();
        if (stack.length === 0) root = element;
      } else i++;
      continue;
    }

    // Text up to the next tag; whitespace between elements is text too.
    const end = text.indexOf("<", i);
    const stop = end === -1 ? text.length : end;
    const value = decode(text.slice(i, stop));
    if (typeof value !== "string") return error(i + value.offset, value.message);
    if (parent !== undefined) parent.text += value;
    i = stop;
  }

  const trailing = skipMisc();
  if (trailing !== null) return trailing;
  if (i < text.length) return error(i, "content after the root element");
  return ok(root);
}

/** Decodes entity and character references; an unknown one is an error at its offset. */
function decode(raw: string): string | { offset: number; message: string } {
  if (!raw.includes("&")) return raw;
  let out = "";
  let last = 0;
  for (let amp = raw.indexOf("&"); amp !== -1; amp = raw.indexOf("&", last)) {
    out += raw.slice(last, amp);
    const semi = raw.indexOf(";", amp);
    const body = semi === -1 ? "" : raw.slice(amp + 1, semi);
    const numeric = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(body);
    let char: string | undefined;
    if (Object.hasOwn(ENTITIES, body)) char = ENTITIES[body];
    else if (numeric !== null) {
      const code = Number.parseInt(numeric[1] ?? (numeric[2] as string), numeric[1] ? 16 : 10);
      const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
      if (valid) char = String.fromCodePoint(code);
    }
    if (char === undefined) {
      return { offset: amp, message: `unknown or malformed reference &${body.slice(0, 16)};` };
    }
    out += char;
    last = semi + 1;
  }
  return out + raw.slice(last);
}
