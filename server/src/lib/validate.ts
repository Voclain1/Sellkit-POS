import { z } from 'zod';
import { HttpError } from './httpError';

/**
 * Parse a request body against a schema, or throw a 400 naming the first
 * problem. Bodies used to be read field by field with ad-hoc checks, and a
 * value of the wrong type (a string float, an object PIN) reached Prisma and
 * came back as a 500 -- which the till's offline queue treats as retryable.
 */
export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
    throw new HttpError(400, `${path}${issue.message}`);
  }
  return result.data;
}

/** Money as sent by a form: a number, or a numeric string. Never negative. */
export const money = z.coerce
  .number({ invalid_type_error: 'must be a number' })
  .finite('must be a number')
  .nonnegative('cannot be negative');

/** An id or other short identifier. */
export const id = z.string().trim().min(1, 'is required').max(100);

export const pinSchema = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine((p) => /^\d{4}$/.test(p), 'PIN must be exactly 4 digits');
