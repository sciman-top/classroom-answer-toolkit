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
// invalid KaTeX and strict validation blocks the whole delivery (2026 run3/5/7
// and run11's three-span variant). Deterministic repair: overlap-scan adjacent
// span pairs (a broken pair can share a span with an intact one), merge the
// first pair whose leading span carries an incomplete two-argument command,
// then rescan from the start.
export function repairSplitMathSpans(text) {
  let output = text;
  const pair = /(^|[^\\])\$([^$]+?)\$(\s*)\$([^$]+?)\$(?!\$)/g;
  for (let guard = 0; guard < 16; guard += 1) {
    let merge = null;
    let scan;
    pair.lastIndex = 0;
    while ((scan = pair.exec(output)) !== null) {
      const [full, lead, first, gap, second] = scan;
      if (hasIncompleteTwoArgCommand(first)) {
        merge = { index: scan.index, full, lead, first, second };
        break;
      }
      pair.lastIndex = scan.index + 1;
    }
    if (!merge) {
      break;
    }
    const { index, full, lead, first, second } = merge;
    output = output.slice(0, index) + `${lead}$${first}${second}$` + output.slice(index + full.length);
  }
  return output;
}

// Code fences and inline code spans are opaque to math: Markdown semantics keep
// their content literal, so the validator must not demand KaTeX validity there
// and the renderer must not stash math from them (stashed KaTeX HTML injected
// into <pre><code> corrupts code output, and invalid KaTeX there crashed the
// whole render). Renderer and validator share this one implementation; the
// renderer restores the segments after math replacement, before Markdown
// rendering, so Markdown-It still escapes the restored code itself. The mask
// preserves the line structure exactly, so every line number computed from the
// masked text is the document's real line.
export function maskLatexCodeSegments(text) {
  const sourceLines = text.split("\n");
  const fenceRanges = findFencedCodeRanges(sourceLines);
  const segments = [];

  const fenceStartByLine = new Map();
  const fenceEndByStart = new Map(fenceRanges);
  for (const [start, end] of fenceRanges) {
    for (let index = start; index <= end; index += 1) {
      fenceStartByLine.set(index, start);
    }
  }

  // Pass 1: a fence becomes one token on its first line and blank lines
  // afterwards, so the document's line count is preserved exactly.
  const maskedLines = sourceLines.map((line, index) => {
    const fenceStart = fenceStartByLine.get(index);
    if (fenceStart === undefined) {
      return line;
    }
    if (fenceStart !== index) {
      return "";
    }
    const token = makeCodeSegmentToken();
    segments.push({
      token,
      content: sourceLines.slice(fenceStart, fenceEndByStart.get(fenceStart) + 1).join("\n")
    });
    return token;
  });

  maskClosedInlineCodeSpans(maskedLines, segments, fenceStartByLine);
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

function lineIndexAtOffset(lineOffsets, offset) {
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (lineOffsets[middle] <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

// CommonMark inline code spans: a backtick run opens a span that the next run
// of EQUAL length closes; shorter or longer runs in between are content. A
// span may cross single newlines inside a paragraph and dies at blank lines or
// fences. Only closed spans are masked — markdown-it renders math inside an
// unclosed backtick run, so the validator must keep checking it.
function maskClosedInlineCodeSpans(maskedLines, segments, fenceStartByLine) {
  const lineOffsets = [];
  let offset = 0;
  for (const line of maskedLines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }
  const joined = maskedLines.join("\n");

  const spans = [];
  let pending = null;
  let index = 0;
  while (index < joined.length) {
    if (joined[index] === "`") {
      let runEnd = index;
      while (runEnd < joined.length && joined[runEnd] === "`") {
        runEnd += 1;
      }
      const runLength = runEnd - index;
      if (pending === null) {
        if (!isEscapedDelimiter(joined, index)) {
          pending = { start: index, length: runLength };
        }
      } else if (runLength === pending.length) {
        spans.push([pending.start, runEnd]);
        pending = null;
      }
      index = runEnd;
      continue;
    }
    if (pending !== null && joined[index] === "\n") {
      const lineIndex = lineIndexAtOffset(lineOffsets, index);
      const nextLineIndex = lineIndex + 1;
      const paragraphEnds = nextLineIndex >= maskedLines.length
        || maskedLines[nextLineIndex].trim() === ""
        || fenceStartByLine.has(nextLineIndex);
      if (paragraphEnds) {
        pending = null;
      }
    }
    index += 1;
  }

  // Apply edits right-to-left so the offsets of not-yet-applied spans remain
  // valid while the masked lines mutate.
  for (const [startOffset, endOffset] of spans.reverse()) {
    const startLine = lineIndexAtOffset(lineOffsets, startOffset);
    const endLine = lineIndexAtOffset(lineOffsets, endOffset - 1);
    if (startLine === endLine) {
      const lineStart = lineOffsets[startLine];
      const token = makeCodeSegmentToken();
      segments.push({ token, content: joined.slice(startOffset, endOffset) });
      maskedLines[startLine] = maskedLines[startLine].slice(0, startOffset - lineStart)
        + token
        + maskedLines[startLine].slice(endOffset - lineStart);
      continue;
    }
    // Multi-line span: each affected line segment gets its own token, which
    // keeps both the line count and the restored text exact.
    const closerLineStart = lineOffsets[endLine];
    const closerColumn = endOffset - closerLineStart;
    const closerToken = makeCodeSegmentToken();
    segments.push({ token: closerToken, content: maskedLines[endLine].slice(0, closerColumn) });
    maskedLines[endLine] = closerToken + maskedLines[endLine].slice(closerColumn);

    for (let line = endLine - 1; line > startLine; line -= 1) {
      const token = makeCodeSegmentToken();
      segments.push({ token, content: maskedLines[line] });
      maskedLines[line] = token;
    }

    const openerColumn = startOffset - lineOffsets[startLine];
    const openerToken = makeCodeSegmentToken();
    segments.push({ token: openerToken, content: maskedLines[startLine].slice(openerColumn) });
    maskedLines[startLine] = maskedLines[startLine].slice(0, openerColumn) + openerToken;
  }
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
