type JsonPathSegment =
  | { type: "property"; key: string }
  | { type: "index"; index: number }
  | { type: "wildcard" };

const SEGMENT_PATTERN = /([^.[\]]+)|(\[(\d+|\*)\])/g;

const tokenizeJsonPath = (path: string): JsonPathSegment[] => {
  const trimmedPath = path.trim();

  if (!trimmedPath) {
    return [];
  }

  const segments: JsonPathSegment[] = [];
  const pathParts = trimmedPath.split(".");

  for (const part of pathParts) {
    if (!part) {
      return [];
    }

    let lastIndex = 0;

    for (const match of part.matchAll(SEGMENT_PATTERN)) {
      const [token, propertyToken, bracketToken, bracketValue] = match;
      const matchIndex = match.index ?? 0;

      if (matchIndex !== lastIndex) {
        return [];
      }

      if (propertyToken) {
        segments.push({ type: "property", key: propertyToken });
      } else if (bracketToken) {
        if (bracketValue === "*") {
          segments.push({ type: "wildcard" });
        } else {
          segments.push({ type: "index", index: Number(bracketValue) });
        }
      }

      lastIndex += token.length;
    }

    if (lastIndex !== part.length) {
      return [];
    }
  }

  return segments;
};

const resolveSegment = (value: unknown, segment: JsonPathSegment): unknown => {
  if (segment.type === "property") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    return (value as Record<string, unknown>)[segment.key];
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  if (segment.type === "wildcard") {
    return value;
  }

  return value[segment.index];
};

export const resolveJsonPath = (obj: unknown, path: string): unknown => {
  const segments = tokenizeJsonPath(path);

  if (segments.length === 0) {
    return undefined;
  }

  let current: unknown = obj;

  for (const segment of segments) {
    current = resolveSegment(current, segment);

    if (current === undefined) {
      return undefined;
    }
  }

  return current;
};
