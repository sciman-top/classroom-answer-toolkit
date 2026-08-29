import crypto from "node:crypto";

// Single source of truth for the renderer's inline-math extraction. The answer
// validator consumes the same machinery; a divergence there lets documents that
// pass validation still leak literal `$` into the rendered PDF
// (2026-08-26 audit, renderer P2).

export function createInlineMathScanner(text) {
  // Mirrors replaceMath order exactly: this scanner runs after display math has
  // been replaced, with the same lazy-no-lookahead semantics the renderer uses.
  const regex = /(^|[^\\])\$([\s\S]+?)\$/g;
  return { next: () => regex.exec(text) };
}

export function mapInlineMath(text, replacer) {
  const scanner = createInlineMathScanner(text);
  let output = "";
  let cursor = 0;
  let match;
  while ((match = scanner.next()) !== null) {
    output += text.slice(cursor, match.index) + match[1] + replacer(match[2]);
    cursor = match.index + match[0].length;
  }

  return output + text.slice(cursor);
}

function isEscapedDelimiter(text, delimiterStart) {
  let precedingBackslashCount = 0;
  for (let index = delimiterStart - 1; index >= 0 && text[index] === "\\"; index -= 1) {
    precedingBackslashCount += 1;
  }

  return precedingBackslashCount % 2 === 1;
}

const LATEX_DELIMITER_ROLES = new Map([
  ["(", { kind: "inline", role: "open" }],
  [")", { kind: "inline", role: "close" }],
  ["[", { kind: "display", role: "open" }],
  ["]", { kind: "display", role: "close" }]
]);

// `\\(` is an escaped backslash followed by a literal bracket, not a delimiter.
function latexDelimiterAt(text, index) {
  if (text[index] !== "\\" || isEscapedDelimiter(text, index)) {
    return null;
  }
  return LATEX_DELIMITER_ROLES.get(text[index + 1]) ?? null;
}

// A `\(`, `\)`, `\[`, or `\]` the renderer's single pass would not consume
// prints verbatim (markdown-it degrades it to a plain bracket or swallows the
// backslash, 2015 regression10 class of delivery defects). The validator turns
// every reported position into a hard error; the renderer fails closed on the
// same detection before writing a broken PDF.
export function findUnbalancedLatexDelimiterPositions(text) {
  const positions = [];
  const openingDelimiters = { inline: null, display: null };

  for (let index = 0; index < text.length - 1; index += 1) {
    const delimiter = latexDelimiterAt(text, index);
    if (!delimiter) {
      continue;
    }

    if (delimiter.role === "open") {
      if (openingDelimiters[delimiter.kind] !== null) {
        positions.push(openingDelimiters[delimiter.kind]);
      }
      openingDelimiters[delimiter.kind] = index;
    } else if (openingDelimiters[delimiter.kind] === null) {
      positions.push(index);
    } else {
      openingDelimiters[delimiter.kind] = null;
    }

    index += 1;
  }

  for (const position of Object.values(openingDelimiters)) {
    if (position !== null) {
      positions.push(position);
    }
  }

  return positions;
}

function findLatexParenDelimiterPairs(text) {
  const pairs = [];
  let openingDelimiter = null;

  for (let index = 0; index < text.length - 1; index += 1) {
    if (text[index] !== "\\" || (text[index + 1] !== "(" && text[index + 1] !== ")") || isEscapedDelimiter(text, index)) {
      continue;
    }

    if (text[index + 1] === "(") {
      if (openingDelimiter === null) {
        openingDelimiter = index;
      }
    } else if (openingDelimiter !== null) {
      pairs.push({ openingDelimiter, closingDelimiter: index });
      openingDelimiter = null;
    }

    index += 1;
  }

  return pairs;
}

// `\(...\)` is standard LaTeX inline-math syntax, but the renderer only
// consumes `$...$` (and `\[...\]` display math). Un-normalized `\(...\)` reaches
// the PDF as literal source (2015 regression10 delivery defect). Both the
// renderer and the validator must normalize through this one implementation.
export function normalizeLatexParenDelimiters(text) {
  const pairs = findLatexParenDelimiterPairs(text);
  let output = "";
  let cursor = 0;
  for (const { openingDelimiter, closingDelimiter } of pairs) {
    output += text.slice(cursor, openingDelimiter);
    output += `$${text.slice(openingDelimiter + 2, closingDelimiter)}$`;
    cursor = closingDelimiter + 2;
  }

  return output + text.slice(cursor);
}

// `\frac` and friends need two braced arguments. A span whose `\frac` carries
// fewer groups than required is a command split across spans: the missing group
// lives in the adjacent span (2026 run3/5/7 delivery defect).
function hasIncompleteTwoArgCommand(content) {
  const commandPattern = /\\(?:d|t)?frac|\\binom|\\sqrt/g;
  for (const match of content.matchAll(commandPattern)) {
    let cursor = match.index + match[0].length;
    let requiredGroups = 2;
    // `\sqrt[3]{...}` takes one mandatory group after the optional one.
    const optional = /^\\\[[^\]]*\\\]/.exec(content.slice(cursor));
    if (optional) {
      cursor += optional[0].length;
      requiredGroups = 1;
    }
    let groups = 0;
    for (;;) {
      while (cursor < content.length && /\s/.test(content[cursor])) {
        cursor += 1;
      }
      if (content[cursor] !== "{") {
        break;
      }
      let depth = 0;
      const groupStart = cursor;
      for (; cursor < content.length; cursor += 1) {
        if (content[cursor] === "{") {
          depth += 1;
        } else if (content[cursor] === "}") {
          depth -= 1;
          if (depth === 0) {
            break;
          }
        }
      }
      if (depth !== 0) {
        // Unclosed group: the group itself is truncated in this span.
        return true;
      }
      groups += 1;
      cursor += 1;
      if (groups >= requiredGroups) {
        break;
      }
    }
    if (groups < requiredGroups) {
      return true;
    }
  }
  return false;
}

// Reference-review output repeatedly splits one `\frac{a}{b}` across two
// adjacent `$...$` spans (numerator span, denominator span). Each span alone is
// invalid KaTeX and strict validation blocks the whole delivery (2026 run3/5/7).
// Deterministic repair: when a math span ends with an incomplete two-argument
// command and the next span follows with only whitespace between, merge them
// into one span.
export function repairSplitMathSpans(text) {
  let output = text;
  const scanner = /(^|[^\\])\$([^$]+?)\$(\s*)\$([^$]+?)\$(?!\$)/g;
  for (let guard = 0; guard < 16; guard += 1) {
    let merged = false;
    output = output.replace(scanner, (match, lead, first, gap, second) => {
      if (!hasIncompleteTwoArgCommand(first)) {
        return match;
      }
      merged = true;
      return `${lead}$${first}${second}$`;
    });
    if (!merged) {
      break;
    }
  }
  return output;
}

// Code fences and inline code spans are opaque to math: Markdown semantics keep
// their content literal, so the validator must not demand KaTeX validity there
// and the renderer must not stash math from them (stashed KaTeX HTML injected
// into <pre><code> corrupts code output, and invalid KaTeX there crashed the
// whole render). Renderer and validator share this one implementation; the
// renderer restores the segments after math replacement, before Markdown
// rendering, so Markdown-It still escapes the restored code itself.
export function maskLatexCodeSegments(text) {
  const sourceLines = text.split("\n");
  const fenceRanges = findFencedCodeRanges(sourceLines);
  const endByStart = new Map(fenceRanges);
  const startByLine = new Map();
  for (const [start, end] of fenceRanges) {
    for (let index = start; index <= end; index += 1) {
      startByLine.set(index, start);
    }
  }
  const segments = [];

  const maskedLines = sourceLines.map((line, index) => {
    const fenceStart = startByLine.get(index);
    if (fenceStart === undefined) {
      return maskInlineCodeSpans(line, segments);
    }
    if (fenceStart !== index) {
      return "";
    }
    const token = makeCodeSegmentToken();
    segments.push({
      token,
      content: sourceLines.slice(fenceStart, endByStart.get(fenceStart) + 1).join("\n")
    });
    return token;
  });

  return { text: maskedLines.join("\n"), segments };
}

export function restoreLatexCodeSegments(text, segments) {
  let output = text;
  for (const { token, content } of segments) {
    output = output.split(token).join(content);
  }
  return output;
}

function makeCodeSegmentToken() {
  return `@@CLASSROOM_TOOLKIT_CODE_${crypto.randomUUID().replace(/-/g, "")}@@`;
}

// Only same-line spans are masked: cross-paragraph backtick pairing in
// Markdown-It differs from a whole-text scan, and a wrong pairing must never
// hide math from validation while Markdown-It still renders it.
function maskInlineCodeSpans(line, segments) {
  return line.replace(/(`+)[^`]*?\1/g, (span) => {
    const token = makeCodeSegmentToken();
    segments.push({ token, content: span });
    return token;
  });
}

function findFencedCodeRanges(sourceLines) {
  const ranges = [];
  let open = null;
  for (let index = 0; index < sourceLines.length; index += 1) {
    if (open === null) {
      const opening = /^ {0,3}(`{3,}|~{3,})/.exec(sourceLines[index]);
      if (opening) {
        open = { start: index, marker: opening[1][0], minLength: opening[1].length };
      }
      continue;
    }
    if (new RegExp(`^ {0,3}\\${open.marker}{${open.minLength},}\\s*$`).test(sourceLines[index])) {
      ranges.push([open.start, index]);
      open = null;
    }
  }
  if (open !== null) {
    ranges.push([open.start, sourceLines.length - 1]);
  }
  return ranges;
}
