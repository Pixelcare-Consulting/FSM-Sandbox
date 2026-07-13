import { requireSession } from '../auth/requireSession';

export function withSession(handler) {
  return async (req, res) => {
    const session = await requireSession(req, res);
    if (!session) return;
    return handler(req, res, session);
  };
}
