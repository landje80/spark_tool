import type { Role } from '@prisma/client';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    role?: Role;
    csrfToken?: string;
    oidc?: { state: string; nonce: string; codeVerifier: string; returnTo: string };
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
    user?: { id: string; role: Role; name: string; email: string };
  }
}
