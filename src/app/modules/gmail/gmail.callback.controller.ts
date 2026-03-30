// src/app/modules/gmail/gmail.callback.controller.ts
import { Request, Response } from 'express';
import { exchangeCodeForGmailTokens } from './gmail.oauth';
import prisma from '../../config/prisma';

const FRONTEND_ORIGIN = process.env.FRONTEND_URL || 'http://localhost:4200';

/**
 * WHY this header exists here:
 *
 * By default Express (or helmet) sends:
 *   Cross-Origin-Opener-Policy: same-origin
 *
 * That header cuts the browsing context group — the popup loses its
 * reference to window.opener, so postMessage never reaches Angular.
 * It ALSO makes popup.closed unreadable (the console errors you saw).
 *
 * We only relax COOP on this one callback endpoint because it is the
 * only page that needs to talk to its opener. Every other route keeps
 * the strict default.
 */
function popupResponse(res: Response, payload: object) {
  // ── Fix: allow this popup to reach window.opener ──────────────────
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');

  res.send(`<!DOCTYPE html>
<html>
<head><title>Connecting Gmail…</title></head>
<body>
<script>
  (function () {
    var payload = ${JSON.stringify(payload)};
    var origin  = '${FRONTEND_ORIGIN}';

    // postMessage to the Angular app that opened this popup
    if (window.opener) {
      try {
        window.opener.postMessage(payload, origin);
      } catch (e) {
        console.error('[Gmail Callback] postMessage failed:', e);
      }
    }

    // Close immediately — user should never see this page
    window.close();
  })();
</script>
<p style="font-family:sans-serif;color:#888;text-align:center;margin-top:40px">
  Connecting Gmail… you can close this window.
</p>
</body>
</html>`);
}

export const gmailCallback = async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    return popupResponse(res, { type: 'GMAIL_AUTH_ERROR', error: String(error) });
  }

  if (!code || !state) {
    return popupResponse(res, { type: 'GMAIL_AUTH_ERROR', error: 'Missing code or state' });
  }

  const userId = state as string;

  try {
    const tokenData = await exchangeCodeForGmailTokens(code as string);
    const { access_token, refresh_token, expires_in } = tokenData;

    if (!access_token || !refresh_token) {
      return popupResponse(res, {
        type: 'GMAIL_AUTH_ERROR',
        error: 'Invalid token response from Google',
      });
    }

    const expiresAt = new Date(Date.now() + expires_in * 1000);

    await prisma.gmailAccount.upsert({
      where:  { userId },
      update: { accessToken: access_token, refreshToken: refresh_token, expiresAt },
      create: { userId, accessToken: access_token, refreshToken: refresh_token, expiresAt },
    });

    return popupResponse(res, { type: 'GMAIL_AUTH_SUCCESS' });

  } catch (err) {
    console.error('[Gmail Callback] Error:', err);
    return popupResponse(res, { type: 'GMAIL_AUTH_ERROR', error: 'Failed to connect Gmail' });
  }
};