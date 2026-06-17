const path = require('path');

/**
 * Resolve path and ensure it stays under allowed directory
 */
function resolvePathWithinRoot(filePath, allowedRoot) {
  const resolvedRoot = path.resolve(allowedRoot);
  const resolvedPath = path.resolve(filePath);
  const relative = path.relative(resolvedRoot, resolvedPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return resolvedPath;
}

module.exports = {
  resolvePathWithinRoot,
};
