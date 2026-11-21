// Must be the first import: modules below read process.env at load time
// (middleware/auth.ts captures JWT_SECRET), and imports are evaluated before any
// statement in this file runs, so a dotenv.config() call here would come too late.
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import apiRouter from './routes';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
