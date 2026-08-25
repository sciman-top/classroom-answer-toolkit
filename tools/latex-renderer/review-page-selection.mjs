function normalizePageToken(token, pageCount) {
  if (token === "last") {
    return pageCount;
  }

  const pageNumber = Number(token);
  if (!Number.isInteger(pageNumber)) {
    throw new Error(`Invalid page token: ${token}`);
  }

  return pageNumber;
}

export function parsePageSelection(selection, pageCount) {
  if (!selection || selection.toLowerCase() === "all") {
    return Array.from({ length: pageCount }, (_value, index) => index + 1);
  }

  const selected = [];
  const seen = new Set();
  const tokens = selection.split(",").map((token) => token.trim().toLowerCase()).filter(Boolean);

  for (const token of tokens) {
    if (token.includes("-")) {
      const [startToken, endToken] = token.split("-", 2);
      const start = normalizePageToken(startToken, pageCount);
      const end = normalizePageToken(endToken, pageCount);
      if (start > end) {
        throw new Error(`Invalid page range: ${token}`);
      }

      for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
        if (!seen.has(pageNumber)) {
          selected.push(pageNumber);
          seen.add(pageNumber);
        }
      }
      continue;
    }

    const pageNumber = normalizePageToken(token, pageCount);
    if (!seen.has(pageNumber)) {
      selected.push(pageNumber);
      seen.add(pageNumber);
    }
  }

  for (const pageNumber of selected) {
    if (pageNumber < 1 || pageNumber > pageCount) {
      throw new Error(`Page ${pageNumber} is outside 1-${pageCount}`);
    }
  }

  return selected;
}
