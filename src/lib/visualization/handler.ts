import type { Actor, Reader } from './types';
import { parseOptions } from './time';
import { overview } from './service';
export type Session = { actor: Actor | null; reader: Reader; close(): void };
export type OpenSession = (request: Request) => Promise<Session | null>;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' } });
export function createGET(open: OpenSession) {
  return async function GET(request: Request): Promise<Response> {
    let session: Session | null = null;
    try {
      session = await open(request);
      if (!session?.actor) return json({ error: 'LOGIN_REQUIRED' }, 401);
      if (session.actor.role !== 'admin') return json({ error: 'FORBIDDEN', viewerRole: session.actor.role }, 403);
      let options;
      try { options = parseOptions(new URL(request.url)); }
      catch { return json({ error: 'INVALID_QUERY' }, 400); }
      return json(overview(session.reader, options));
    } catch { return json({ error: 'VISUALIZATION_UNAVAILABLE' }, 503); }
    finally { session?.close(); }
  };
}
