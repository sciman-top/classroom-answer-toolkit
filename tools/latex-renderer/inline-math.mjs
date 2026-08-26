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

export function findLiteralDollarPositions(text) {
  // Dollar signs the renderer would not consume and therefore emit verbatim,
  // including the trailing member of ambiguous sequences like `$a$$b$`.
  const consumedRanges = [];
  const scanner = createInlineMathScanner(text);
  let match;
  while ((match = scanner.next()) !== null) {
    consumedRanges.push([
      match.index + match[1].length,
      match.index + match[0].length
    ]);
  }

  const positions = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "$" || text[index - 1] === "\\") {
      continue;
    }
    if (consumedRanges.some(([start, end]) => index >= start && index < end)) {
      continue;
    }
    positions.push(index);
  }

  return positions;
}
