export const INVALID_NAME_PATTERN = /[<>:"/\\|?*]/;

export const isHttpLikeFile = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower.endsWith(".http") || lower.endsWith(".rest");
};

export const sanitizeFileName = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");

  const baseName = normalized || "request";
  return baseName.endsWith(".http") ? baseName : `${baseName}.http`;
};

export const getPathSeparator = (path: string): string => {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
};

export const joinPath = (basePath: string, segment: string): string => {
  const separator = getPathSeparator(basePath);
  if (basePath.endsWith("/") || basePath.endsWith("\\")) {
    return `${basePath}${segment}`;
  }

  return `${basePath}${separator}${segment}`;
};

export const getParentPath = (path: string): string => {
  const normalized = path.replace(/[\\/]+$/, "");
  const lastSlash = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  if (lastSlash <= 0) {
    return normalized;
  }

  return normalized.slice(0, lastSlash);
};

export const buildDefaultSavePath = (
  tabName: string,
  requestName: string | null,
  filePath: string | null,
  workspacePath: string | null,
): string => {
  if (filePath) {
    return filePath;
  }

  const nextName = requestName?.trim() ? requestName : tabName;
  const fileName = sanitizeFileName(nextName);

  return workspacePath ? joinPath(workspacePath, fileName) : fileName;
};
