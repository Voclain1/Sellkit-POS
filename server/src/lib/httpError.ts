/**
 * An error that knows its HTTP status.
 *
 * The till's offline queue treats 4xx as "never going to work, isolate it" and
 * 5xx / network failures as "try again later". Throwing one of these is how a
 * controller says which it is; anything else that escapes is a 500, so an
 * unexpected fault (a dropped database connection, a transaction timeout) is
 * retried rather than written off as a rejected sale.
 */
export class HttpError extends Error {
  status: number;
  details?: Record<string, unknown>;

  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

/** Prisma's known-request error codes we map to client errors. */
export function prismaErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  return undefined;
}
