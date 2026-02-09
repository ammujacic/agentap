/**
 * Agentap API - Cloudflare Workers Entry Point
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env, Variables } from './types';
import { authMiddleware } from './middleware/auth';
import authRoutes from './routes/auth';
import machinesRoutes from './routes/machines';
import settingsRoutes from './routes/settings';
import sessionsRoutes from './routes/sessions';
import daemonRoutes from './routes/daemon';
import devicesRoutes from './routes/devices';
import notificationsRoutes from './routes/notifications';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================================
// Middleware
// ============================================================================

// CORS
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      // Allow requests from our web app and mobile deep links
      const allowedOrigins = [
        c.env.WEB_URL,
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:8081',
      ];

      if (!origin) {
        return null; // Reject requests without Origin header
      }

      if (allowedOrigins.includes(origin)) {
        return origin;
      }

      // Allow agentap:// scheme for mobile
      if (origin.startsWith('agentap://')) {
        return origin;
      }

      return null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// Logging (only in development)
app.use('*', async (c, next) => {
  if (c.env.API_URL.includes('localhost')) {
    return logger()(c, next);
  }
  return next();
});

// Auth middleware (extracts user from session cookie)
app.use('*', authMiddleware);

// ============================================================================
// Routes
// ============================================================================

// Health check
app.get('/', (c) => {
  return c.json({
    name: 'Agentap API',
    version: '0.1.0',
    status: 'ok',
  });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes
app.route('/auth', authRoutes);

// API routes
app.route('/api/machines', machinesRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/sessions', sessionsRoutes);
app.route('/api/daemon', daemonRoutes);
app.route('/api/devices', devicesRoutes);
app.route('/api/notifications', notificationsRoutes);

// ============================================================================
// Error handling
// ============================================================================

app.onError((err, c) => {
  console.error('API Error:', err);

  return c.json(
    {
      error: 'Internal Server Error',
      message: c.env.API_URL.includes('localhost') ? err.message : undefined,
    },
    500
  );
});

app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

export default app;
