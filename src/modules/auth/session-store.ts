import type { PrismaClient } from '@prisma/client';
import { Store, type SessionData } from 'express-session';
import { sha256Hex } from '../../shared/security/tokens.js';

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

/** Persistente sessiestore op MySQL. Het cookie bevat het sid; in de database staat alleen de hash. */
export class PrismaSessionStore extends Store {
  constructor(private readonly db: PrismaClient) {
    super();
  }

  private key(sid: string): string {
    return sha256Hex(sid);
  }

  private expiry(session: SessionData): Date {
    const exp = session.cookie?.expires;
    return exp ? new Date(exp) : new Date(Date.now() + DEFAULT_TTL_MS);
  }

  override get(sid: string, cb: (err?: unknown, session?: SessionData | null) => void): void {
    this.db.session
      .findUnique({ where: { id: this.key(sid) } })
      .then((row) => {
        if (!row || row.expiresAt.getTime() <= Date.now()) return cb(null, null);
        cb(null, row.data as unknown as SessionData);
      })
      .catch((err: unknown) => cb(err));
  }

  override set(sid: string, session: SessionData, cb?: (err?: unknown) => void): void {
    const data = JSON.parse(JSON.stringify(session)) as object;
    const userId = session.userId ?? null;
    const expiresAt = this.expiry(session);
    this.db.session
      .upsert({
        where: { id: this.key(sid) },
        create: { id: this.key(sid), userId, data, expiresAt },
        update: { userId, data, expiresAt },
      })
      .then(() => cb?.())
      .catch((err: unknown) => cb?.(err));
  }

  override touch(sid: string, session: SessionData, cb?: (err?: unknown) => void): void {
    this.db.session
      .updateMany({ where: { id: this.key(sid) }, data: { expiresAt: this.expiry(session) } })
      .then(() => cb?.())
      .catch((err: unknown) => cb?.(err));
  }

  override destroy(sid: string, cb?: (err?: unknown) => void): void {
    this.db.session
      .deleteMany({ where: { id: this.key(sid) } })
      .then(() => cb?.())
      .catch((err: unknown) => cb?.(err));
  }

  /** Opruimen van verlopen sessies; aangeroepen door onderhoudsjob. */
  async purgeExpired(): Promise<number> {
    const r = await this.db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return r.count;
  }
}
