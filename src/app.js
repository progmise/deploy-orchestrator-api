import express from 'express';
import { systemRouter } from './infrastructure/adapters/input/rest/routes/system.js';
import { authRouter } from './infrastructure/adapters/input/rest/routes/auth.js';
import { proxyRouter } from './infrastructure/adapters/input/rest/routes/proxy.js';
import { componentsRouter } from './infrastructure/adapters/input/rest/routes/components.js';

// Express wiring: middleware + routers. Receives already-built use cases —
// nothing here knows about GitHub, Supabase, or env vars.
export const createApp = ({ pkg, env, usecases, catalogReady, provisioningEnabled }) => {
  const app = express();
  app.use(express.json());

  app.use(authRouter({ env, usecases }));
  app.use(proxyRouter({ usecases }));
  app.use(componentsRouter({ usecases, catalogReady, provisioningEnabled }));
  app.use(systemRouter({ version: pkg.version }));

  // Unknown API routes return JSON 404.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));
  return app;
};
