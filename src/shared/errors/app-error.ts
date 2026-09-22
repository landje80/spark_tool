export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INVALID_TRANSITION'
  | 'SUPPRESSED'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  SUPPRESSED: 409,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  INTERNAL: 500,
};

/** Fout met een stabiele code; de boodschap is veilig om aan de gebruiker te tonen. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[code];
  }
}
