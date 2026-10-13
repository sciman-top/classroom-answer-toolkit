function normalizePageToken(token, pageCount) {
  if (token === "last") {
    return pageCount;
  }

  const pageNumber = Number(token);
  if (!/^\d+$/u.test(token) || !Number.isSafeInteger(pageNumber)) {
    throw new Error(`Invalid page token: ${token}`);
  }

  return pageNumber;
}

export function parsePageSelection(selection, pageCount) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new Error(`Invalid page count: ${pageCount}`);
  }
  const assertInBounds = (pageNumber) => {
    if (pageNumber < 1 || pageNumber > pageCount) {
      throw new Error(`Page ${pageNumber} is outside 1-${pageCount}`);
    }
  };
  if (!selection || selection.toLowerCase() === "all") {
    return Array.from({ length: pageCount }, (_value, index) => index + 1);
  }

  const selected = [];
  const seen = new Set();
  const tokens = selection.split(",").map((token) => token.trim().toLowerCase()).filter(Boolean);
  if (tokens.length === 0) {
    throw new Error("Page selection must contain at least one page.");
  }

  for (const token of tokens) {
    if (token.includes("-")) {
      const rangeParts = token.split("-");
      // "2-4-6" used to lose "-6" silently via split(...,2); require exactly two.
      if (rangeParts.length !== 2 || !rangeParts[0] || !rangeParts[1]) {
        throw new Error(`Invalid page range: ${token}`);
      }
      const start = normalizePageToken(rangeParts[0], pageCount);
      const end = normalizePageToken(rangeParts[1], pageCount);
      if (start > end) {
        throw new Error(`Invalid page range: ${token}`);
      }
      // Validate before expanding: an invalid huge range must never allocate
      // millions of entries or stall the review process.
      assertInBounds(start);
      assertInBounds(end);

      for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
        if (!seen.has(pageNumber)) {
          selected.push(pageNumber);
          seen.add(pageNumber);
        }
      }
      continue;
    }

    const pageNumber = normalizePageToken(token, pageCount);
    assertInBounds(pageNumber);
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
