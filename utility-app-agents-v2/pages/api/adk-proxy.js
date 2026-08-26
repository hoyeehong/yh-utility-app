/**
 * pages/api/adk-proxy.js
 *
 * Thin Next.js API proxy that forwards requests to the Python ADK backend.
 * Keeps the ADK URL and Firebase Admin credentials server-side (not exposed to browser).
 *
 * Supported actions (via ?action= query param):
 *   POST ?action=scan-bill   — forward 3-image multipart to /api/scan-bill
 *   POST ?action=chat        — forward JSON body to ADK /run endpoint
 */

export const config = {
  api: {
    bodyParser: false,  // Required for multipart passthrough
  },
};

export default async function handler(req, res) {
  const ADK_URL = process.env.ADK_BACKEND_URL || 'http://localhost:8000';
  const { action } = req.query;

  if (!req.headers.authorization?.toLowerCase().startsWith('bearer ')) {
    return res.status(401).json({ error: 'authentication_required' });
  }

  // ── scan-bill: forward multipart/form-data with 3 images ──────────────────
  if (action === 'scan-bill' && req.method === 'POST') {
    try {
      const response = await fetch(`${ADK_URL}/api/scan-bill`, {
        method:  'POST',
        headers: req.headers,
        body:    req,
        duplex:  'half',
      });
      const rawText = await response.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { error: 'backend_error', detail: rawText || 'Unexpected response from backend' };
      }
      return res.status(response.status).json(data);
    } catch (err) {
      return res.status(502).json({
        error: 'backend_unreachable',
        detail: 'The AI backend server is starting up or unreachable. Please wait a few seconds and try again.',
      });
    }
  }

  // ── chat: forward JSON to ADK /run ────────────────────────────────────────
  if (action === 'chat' && req.method === 'POST') {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();

      const response = await fetch(`${ADK_URL}/run`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const rawText = await response.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { error: 'backend_error', detail: rawText || 'Unexpected response from backend' };
      }
      return res.status(response.status).json(data);
    } catch (err) {
      return res.status(502).json({
        error: 'backend_unreachable',
        detail: 'The AI backend server is starting up or unreachable. Please wait a few seconds and try again.',
      });
    }
  }

  return res.status(404).json({ error: `Unknown action: ${action}` });
}
