import { net, shell } from 'electron';
import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { AuthProfile, AuthState } from '../../shared/ipc';
import { clearRefreshToken, loadRefreshToken, saveRefreshToken } from './token-store';

/**
 * Desktop Google OAuth — system-browser loopback + PKCE.
 *
 * This is the desktop equivalent of the mobile app's native Google sign-in
 * sheet. The end result is the same: a Google OIDC ID token whose `aud` is a
 * client id registered in the shared convex/auth.config.ts, which Convex
 * verifies against Google's JWKS. No auth server sits in between.
 *
 * Security posture, matching the mobile model:
 *   - Runs entirely in the main process; the renderer only ever receives the
 *     short-lived ID token, on demand, over IPC.
 *   - The ID token is held in memory only (see `idToken`), never persisted.
 *   - The refresh token is the sole durable credential and lives in the OS
 *     keychain via `token-store` — never in the renderer, never logged.
 *   - The client secret Google issues for a Desktop app client is
 *     non-confidential; PKCE is what secures the exchange. It stays in the main
 *     process (a GOOGLE_* env var) and never reaches a web context.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPES = ['openid', 'email', 'profile'];

// Loaded into the main bundle only (vite.main.config.ts envPrefix: GOOGLE_*).
const CLIENT_ID = import.meta.env.GOOGLE_DESKTOP_CLIENT_ID as string | undefined;
const CLIENT_SECRET = import.meta.env.GOOGLE_DESKTOP_CLIENT_SECRET as string | undefined;

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode a JWT payload without verifying — used only to surface display claims.
 *  Trust comes from Convex verifying the same token server-side, never from here. */
function decodeClaims(idToken: string): AuthProfile {
  const [, payload] = idToken.split('.');
  const json = Buffer.from(payload, 'base64').toString('utf8');
  const claims = JSON.parse(json) as Record<string, unknown>;
  return {
    subject: String(claims.sub ?? ''),
    email: typeof claims.email === 'string' ? claims.email : null,
    name: typeof claims.name === 'string' ? claims.name : null,
    picture: typeof claims.picture === 'string' ? claims.picture : null,
  };
}

interface TokenResponse {
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export class SessionManager {
  private idToken: string | null = null;
  private idTokenExpiresAt = 0;
  private profile: AuthProfile | null = null;
  private status: AuthState['status'] = 'loading';
  private listeners = new Set<(state: AuthState) => void>();

  constructor() {
    // Even a remembered account (one with a stored refresh token) starts
    // signed-out until the first token fetch renews it — mirroring the mobile
    // rule that a remembered account reports as not-authenticated until it
    // actually holds a token.
    this.status = 'signed-out';
  }

  onChange(listener: (state: AuthState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): AuthState {
    return { status: this.status, profile: this.profile };
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  private assertConfigured(): void {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      throw new Error(
        'GOOGLE_DESKTOP_CLIENT_ID / GOOGLE_DESKTOP_CLIENT_SECRET are not set. Copy ' +
          '.env.example to .env.local and fill in the Desktop app OAuth client.',
      );
    }
  }

  /** Full interactive sign-in: opens the system browser, catches the code on a
   *  loopback server, and exchanges it (with the PKCE verifier) for tokens. */
  async signIn(): Promise<AuthState> {
    this.assertConfigured();

    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    const state = base64url(randomBytes(16));

    const { code, redirectUri } = await this.awaitLoopbackCode(challenge, state);
    const tokens = await this.exchange({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });

    if (!tokens.id_token) throw new Error('Google returned no ID token.');
    this.applyTokens(tokens);
    if (tokens.refresh_token) saveRefreshToken(tokens.refresh_token);
    return this.getState();
  }

  /** Returns a valid ID token, refreshing via the stored refresh token when the
   *  cached one is missing, expired, or a refresh is forced. Null when signed out. */
  async getIdToken(forceRefresh: boolean): Promise<string | null> {
    const stillValid = this.idToken && Date.now() < this.idTokenExpiresAt - 30_000;
    if (stillValid && !forceRefresh) return this.idToken;

    const refresh = loadRefreshToken();
    if (!refresh) {
      this.applySignedOut();
      return null;
    }

    try {
      this.assertConfigured();
      const tokens = await this.exchange({ grant_type: 'refresh_token', refresh_token: refresh });
      if (!tokens.id_token) throw new Error('Google returned no ID token on refresh.');
      this.applyTokens(tokens);
      // Google usually omits refresh_token on refresh; keep the existing one.
      if (tokens.refresh_token) saveRefreshToken(tokens.refresh_token);
      return this.idToken;
    } catch {
      this.applySignedOut();
      return null;
    }
  }

  signOut(): AuthState {
    clearRefreshToken();
    this.applySignedOut();
    return this.getState();
  }

  private applyTokens(tokens: TokenResponse): void {
    this.idToken = tokens.id_token ?? null;
    this.idTokenExpiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000;
    this.profile = this.idToken ? decodeClaims(this.idToken) : null;
    this.status = this.idToken ? 'signed-in' : 'signed-out';
    this.emit();
  }

  private applySignedOut(): void {
    this.idToken = null;
    this.idTokenExpiresAt = 0;
    this.profile = null;
    this.status = 'signed-out';
    this.emit();
  }

  private async exchange(params: Record<string, string>): Promise<TokenResponse> {
    const body = new URLSearchParams({
      client_id: CLIENT_ID as string,
      client_secret: CLIENT_SECRET as string,
      ...params,
    });

    // Chromium's network stack, not undici's global fetch: it honours the OS
    // proxy configuration and does Happy-Eyeballs dual-stack the way the browser
    // does, so a machine that reaches Google in a browser reaches it here too.
    // Global fetch on Linux can hang on a broken IPv6 route until ETIMEDOUT —
    // the symptom this replaced. Same choice as reader.ts. Bounded so a dead
    // network fails the sign-in fast instead of leaving the UI connecting.
    let res: Response;
    try {
      res = await net.fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
      throw new Error(
        timedOut
          ? 'Timed out reaching Google to complete sign-in. Check your network or proxy and try again.'
          : 'Could not reach Google to complete sign-in. Check your network or proxy and try again.',
      );
    }

    const json = (await res.json()) as TokenResponse;
    if (!res.ok || json.error) {
      // Never include the response body verbatim — it can echo tokens.
      throw new Error(`Token exchange failed (${res.status}).`);
    }
    return json;
  }

  /** Spins a one-shot loopback server, opens the browser, resolves with the code. */
  private awaitLoopbackCode(
    challenge: string,
    state: string,
  ): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      let server: Server;
      // Bound the wait: if the reader abandons the browser flow, close the
      // loopback and reject so the UI leaves its "connecting" state instead of
      // hanging and the one-shot server does not linger.
      const timeout = setTimeout(
        () => done(() => reject(new Error('Sign-in timed out.'))),
        5 * 60_000,
      );
      const done = (fn: () => void) => {
        clearTimeout(timeout);
        try {
          server.close();
        } finally {
          fn();
        }
      };

      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        const returnedState = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<html><body style="font-family:system-ui;padding:2rem">You can close this window and return to Pidom.</body></html>',
        );

        if (error) return done(() => reject(new Error(`Google denied the request: ${error}.`)));
        if (returnedState !== state)
          return done(() => reject(new Error('OAuth state mismatch; aborting.')));
        if (!code) return done(() => reject(new Error('No authorization code returned.')));
        done(() => resolve({ code, redirectUri }));
      });

      let redirectUri = '';
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as AddressInfo).port;
        redirectUri = `http://127.0.0.1:${port}/callback`;
        const authUrl = new URL(AUTH_ENDPOINT);
        authUrl.searchParams.set('client_id', CLIENT_ID as string);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', SCOPES.join(' '));
        authUrl.searchParams.set('code_challenge', challenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');
        void shell.openExternal(authUrl.toString());
      });

      server.on('error', (err) => reject(err));
    });
  }
}
