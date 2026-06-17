/**
 * Public URL helpers for static assets (covers, frames, clips).
 * Aligns with frontend base path (e.g. /movie/) when deployed under a subpath.
 */

const config = require('../config');

/**
 * Base path for static files in HTTP URLs, e.g. "/movie/static" or "/static".
 * @returns {string}
 */
function getStaticBasePath() {
  return config.publicPath ? `${config.publicPath}/static` : '/static';
}

/**
 * Build a public static asset URL.
 * @param {...string} segments - Path segments after /static/
 * @returns {string}
 */
function staticUrl(...segments) {
  const base = getStaticBasePath();
  const suffix = segments.filter(Boolean).join('/');
  return suffix ? `${base}/${suffix}` : base;
}

/**
 * Express mount paths for the static file directory (includes legacy /static).
 * @returns {string[]}
 */
function getStaticMountPaths() {
  const paths = ['/static'];
  const prefixed = getStaticBasePath();
  if (prefixed !== '/static') {
    paths.push(prefixed);
  }
  return paths;
}

module.exports = {
  getStaticBasePath,
  staticUrl,
  getStaticMountPaths,
};
