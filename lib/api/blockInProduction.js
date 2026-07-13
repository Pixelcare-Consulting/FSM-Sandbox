/**
 * Block dev/test API routes when NODE_ENV is production.
 * @returns {boolean} true when the request was blocked (caller should return early)
 */
export function blockIfProduction(req, res) {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'Not found' });
    return true;
  }
  return false;
}
