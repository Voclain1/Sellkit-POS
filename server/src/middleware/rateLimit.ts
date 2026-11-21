import rateLimit from 'express-rate-limit';

/**
 * Failed sign-ins allowed per client IP per window.
 *
 * A PIN is 4 digits and PIN-only login needs no username, so without a limit
 * all 10,000 PINs -- the admin's included -- can be tried in minutes. Only
 * failures count (`skipSuccessfulRequests`), so a busy shop where every till
 * shares one public IP is not throttled for signing in correctly.
 */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export const loginRateLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  limit: LOGIN_MAX_FAILURES,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    const minutes = Math.ceil(options.windowMs / 60000);
    res.status(429).json({
      error: `Too many failed sign-in attempts. Try again in up to ${minutes} minutes.`,
    });
  },
});
