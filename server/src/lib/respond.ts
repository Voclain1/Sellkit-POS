import { Response } from 'express';
import { HttpError, prismaErrorCode } from './httpError';

/**
 * The one way a controller reports a failure.
 *
 * - HttpError: its own status and message (validation, not found, conflict).
 * - Unique-constraint violation: 409.
 * - Anything else: logged in full here, and the client gets only `fallback`.
 *   Raw error messages used to be sent back as `details`, which handed database
 *   and schema internals to anyone who could provoke a 500.
 */
export function handleError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, ...error.details });
    return;
  }

  if (prismaErrorCode(error) === 'P2002') {
    res.status(409).json({ error: 'That value is already in use by another record' });
    return;
  }

  console.error(`${fallback}:`, error);
  res.status(500).json({ error: fallback });
}
