// src/app/app.ts
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import routes from './routes';
import gmailRoutes from './modules/gmail/gmail.routes';
import { errorHandler } from './middlewares/error.middleware';

const app = express();

// ── CORS ────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:4200',
  credentials: true,
}));

// ── Body parsing ─────────────────────────────────────────────────────
app.use(express.json());

// ── Routes ───────────────────────────────────────────────────────────
app.use('/api', routes);
app.use('/gmail', gmailRoutes);

// ── Error handler (must be LAST, after all routes) ───────────────────
app.use(errorHandler);

export default app;