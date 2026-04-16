import { requestUrl } from 'obsidian';
import * as http from 'http';
import type DocMDPlugin from './main';

const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
];

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export class AuthManager {
  private plugin: DocMDPlugin;
  private activeServer: http.Server | null = null;

  constructor(plugin: DocMDPlugin) {
    this.plugin = plugin;
  }

  isAuthenticated(): boolean {
    return !!this.plugin.settings.tokens?.refresh_token;
  }

  async getAccessToken(): Promise<string> {
    const tokens = this.plugin.settings.tokens;
    if (!tokens?.refresh_token) {
      throw new Error('Not authenticated. Connect your Google account in DocMD settings.');
    }

    if (!tokens.access_token || Date.now() >= tokens.expiry_date - 60_000) {
      await this.refreshToken();
    }

    return this.plugin.settings.tokens!.access_token;
  }

  async startOAuthFlow(): Promise<void> {
    const { clientId, clientSecret } = this.plugin.settings;
    if (!clientId || !clientSecret) {
      throw new Error('Enter your Client ID and Client Secret in settings first.');
    }

    // Clean up any previous server
    this.destroyServer();

    const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
        const port = (server.address() as { port: number }).port;
        const reqUrl = new URL(req.url!, `http://localhost:${port}`);
        const authCode = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: -apple-system, sans-serif; text-align: center; padding: 60px; color: #333;">
              ${authCode
                ? '<h2>Authorization successful!</h2><p>You can close this tab and return to Obsidian.</p>'
                : `<h2>Authorization failed</h2><p>${error || 'Unknown error'}</p>`
              }
            </body>
          </html>
        `);

        this.destroyServer();
        if (authCode) resolve({ code: authCode, redirectUri: `http://localhost:${port}` });
        else reject(new Error(`OAuth error: ${error}`));
      });

      this.activeServer = server;

      // Listen on port 0 to let the OS assign a free port (no TOCTOU race)
      server.listen(0, 'localhost', () => {
        const port = (server.address() as { port: number }).port;
        const redirectUri = `http://localhost:${port}`;

        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: SCOPES.join(' '),
          access_type: 'offline',
          prompt: 'consent',
        });

        window.open(`${AUTH_URL}?${params.toString()}`);
      });

      server.on('error', (err) => {
        this.destroyServer();
        reject(err);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        this.destroyServer();
        reject(new Error('OAuth flow timed out after 5 minutes'));
      }, 5 * 60 * 1000);
    });

    // Exchange code for tokens
    const response = await requestUrl({
      url: TOKEN_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const data = response.json;
    this.plugin.settings.tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_date: Date.now() + data.expires_in * 1000,
      token_type: data.token_type,
    };
    await this.plugin.saveSettings();
  }

  disconnect(): void {
    this.plugin.settings.tokens = null;
  }

  /** Clean up the OAuth server. Called on plugin unload. */
  destroy(): void {
    this.destroyServer();
  }

  private destroyServer(): void {
    if (this.activeServer) {
      this.activeServer.close();
      this.activeServer = null;
    }
  }

  private async refreshToken(): Promise<void> {
    const { clientId, clientSecret, tokens } = this.plugin.settings;
    if (!tokens?.refresh_token) {
      throw new Error('No refresh token available. Please reconnect your Google account.');
    }

    const response = await requestUrl({
      url: TOKEN_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: tokens.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }).toString(),
    });

    const data = response.json;
    this.plugin.settings.tokens = {
      ...tokens,
      access_token: data.access_token,
      expiry_date: Date.now() + data.expires_in * 1000,
    };
    await this.plugin.saveSettings();
  }
}
