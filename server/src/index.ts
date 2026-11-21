// Must be the first import: modules below read process.env at load time
// (middleware/auth.ts captures JWT_SECRET), and imports are evaluated before any
// statement in this file runs, so a dotenv.config() call here would come too late.
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import apiRouter from './routes';
import { corsOriginMatcher, trustProxy } from './lib/env';

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Render's proxy: makes req.ip the client, which the login limiter keys on.
app.set('trust proxy', trustProxy());
app.disable('x-powered-by');

// Security headers. The API serves JSON only, so the default CSP costs nothing.
app.use(helmet());

// Only the till's own origins may call the API from a browser. Requests with no
// Origin (curl, health checks, server-to-server) are not browser requests and
// pass through; auth still applies to them.
const isAllowedOrigin = corsOriginMatcher();
app.use(
  cors({
    origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)),
    maxAge: 600,
  })
);

// A checkout is a few KB; nothing legitimate comes close to this.
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true, limit: '200kb' }));

// Mount API Router
app.use('/api', apiRouter);

// Base route redirect / healthcheck
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Sellkit POS Server API',
    version: '1.0.0',
    documentation: '/api/health',
  });
});

// 404 Handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global Error Handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled Server Error:', err);
  // Malformed JSON bodies surface here from express.json() as a 400.
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({
    error: status === 500 ? 'Internal Server Error' : err.message || 'Bad request',
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Sellkit POS API Server running on port ${PORT}`);
  console.log(`📡 Healthcheck: http://localhost:${PORT}/api/health`);
});

export default app;
