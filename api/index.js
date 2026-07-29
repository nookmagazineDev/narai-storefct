// Vercel serverless function entry point. Vercel maps this file to the /api route and,
// combined with the rewrite in vercel.json, forwards every /api/* request here — the
// underlying Express app (server.js) still owns all the actual route definitions.
import app from '../server.js';

export default app;
