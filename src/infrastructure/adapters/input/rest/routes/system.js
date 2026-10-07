import { Router } from 'express';

// Health — open endpoint used by the platform and CI smoke checks.
export const systemRouter = ({ version }) =>
  Router()
    .get('/api/health', (_req, res) => res.json({ status: 'ok', version }));
