import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient, createApiClient } from '../../services/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'https://api.test.dev';

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch() {
  return vi.stubGlobal('fetch', vi.fn()) as unknown as ReturnType<typeof vi.fn>;
}

function lastFetchCall(): [string, RequestInit] {
  const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1] as [string, RequestInit];
}

function lastFetchUrl(): string {
  return lastFetchCall()[0];
}

function lastFetchOptions(): RequestInit {
  return lastFetchCall()[1];
}

function lastFetchHeaders(): Record<string, string> {
  return lastFetchOptions().headers as Record<string, string>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApiClient', () => {
  beforeEach(() => {
    mockFetch();
  });

  // ==========================================================================
  // Constructor & request basics
  // ==========================================================================

  describe('constructor & request basics', () => {
    it('sets Content-Type to application/json', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ user: null }));
      const client = new ApiClient({ baseUrl: BASE_URL });

      await client.getMe();

      expect(lastFetchHeaders()['Content-Type']).toBe('application/json');
    });

    it('includes credentials: include', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ user: null }));
      const client = new ApiClient({ baseUrl: BASE_URL });

      await client.getMe();

      expect(lastFetchOptions().credentials).toBe('include');
    });

    it('adds Bearer token when getToken returns a value', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ user: null }));
      const client = new ApiClient({
        baseUrl: BASE_URL,
        getToken: async () => 'my-token-123',
      });

      await client.getMe();

      expect(lastFetchHeaders()['Authorization']).toBe('Bearer my-token-123');
    });

    it('omits Authorization header when getToken returns null', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ user: null }));
      const client = new ApiClient({
        baseUrl: BASE_URL,
        getToken: async () => null,
      });

      await client.getMe();

      expect(lastFetchHeaders()['Authorization']).toBeUndefined();
    });

    it('omits Authorization header when no getToken is provided', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ user: null }));
      const client = new ApiClient({ baseUrl: BASE_URL });

      await client.getMe();

      expect(lastFetchHeaders()['Authorization']).toBeUndefined();
    });

    it('merges defaultHeaders into every request', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ user: null }));
      const client = new ApiClient({
        baseUrl: BASE_URL,
        defaultHeaders: { 'X-Custom': 'value', 'X-Another': 'other' },
      });

      await client.getMe();

      expect(lastFetchHeaders()['X-Custom']).toBe('value');
      expect(lastFetchHeaders()['X-Another']).toBe('other');
    });

    it('throws ApiError with { error, status } on non-ok response', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse({ error: 'Unauthorized', message: 'Bad creds' }, 401)
      );
      const client = new ApiClient({ baseUrl: BASE_URL });

      await expect(client.getMe()).rejects.toEqual({
        error: 'Unauthorized',
        message: 'Bad creds',
        status: 401,
      });
    });

    it('falls back to "Unknown error" when error response is not valid JSON', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response('not json', {
          status: 500,
          headers: { 'content-type': 'text/plain' },
        })
      );
      const client = new ApiClient({ baseUrl: BASE_URL });

      await expect(client.getMe()).rejects.toEqual({
        error: 'Unknown error',
        message: undefined,
        status: 500,
      });
    });
  });

  // ==========================================================================
  // Auth methods
  // ==========================================================================

  describe('auth methods', () => {
    it('getAuthUrl returns correct URL for a provider', () => {
      const client = new ApiClient({ baseUrl: BASE_URL });

      const url = client.getAuthUrl('github');

      expect(url).toBe(`${BASE_URL}/auth/github`);
    });

    it('getAuthUrl includes redirect query param when provided', () => {
      const client = new ApiClient({ baseUrl: BASE_URL });

      const url = client.getAuthUrl('google', '/callback');

      expect(url).toBe(`${BASE_URL}/auth/google?redirect=%2Fcallback`);
    });

    it('signInWithEmail POSTs to /auth/sign-in/email with email and password', async () => {
      const responseBody = { user: { id: '1' }, token: 'tok' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.signInWithEmail('a@b.com', 'pass');

      expect(lastFetchUrl()).toBe(`${BASE_URL}/auth/sign-in/email`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(JSON.parse(lastFetchOptions().body as string)).toEqual({
        email: 'a@b.com',
        password: 'pass',
      });
      expect(result).toEqual(responseBody);
    });

    it('signUpWithEmail POSTs to /auth/sign-up/email', async () => {
      const responseBody = { user: { id: '1' }, token: 'tok' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.signUpWithEmail('a@b.com', 'pass', 'Alice');

      expect(lastFetchUrl()).toBe(`${BASE_URL}/auth/sign-up/email`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(JSON.parse(lastFetchOptions().body as string)).toEqual({
        email: 'a@b.com',
        password: 'pass',
        name: 'Alice',
      });
      expect(result).toEqual(responseBody);
    });

    it('getMe GETs /auth/me', async () => {
      const responseBody = { user: { id: '1' } };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.getMe();

      expect(lastFetchUrl()).toBe(`${BASE_URL}/auth/me`);
      expect(lastFetchOptions().method).toBeUndefined();
      expect(result).toEqual(responseBody);
    });

    it('logout POSTs to /auth/logout', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ success: true }));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.logout();

      expect(lastFetchUrl()).toBe(`${BASE_URL}/auth/logout`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(result).toEqual({ success: true });
    });
  });

  // ==========================================================================
  // Two-Factor Authentication methods
  // ==========================================================================

  describe('2FA methods', () => {
    it('getTotpUri POSTs password to /auth/two-factor/get-totp-uri', async () => {
      const responseBody = { totpURI: 'otpauth://...', secret: 'abc' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.getTotpUri('mypass');

      expect(lastFetchUrl()).toBe(`${BASE_URL}/auth/two-factor/get-totp-uri`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(JSON.parse(lastFetchOptions().body as string)).toEqual({
        password: 'mypass',
      });
      expect(result).toEqual(responseBody);
    });

    it('enableTwoFactor POSTs password and code to /auth/two-factor/enable', async () => {
      const responseBody = { status: true, backupCodes: ['a', 'b'] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.enableTwoFactor('mypass', '123456');

      expect(lastFetchUrl()).toBe(`${BASE_URL}/auth/two-factor/enable`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(JSON.parse(lastFetchOptions().body as string)).toEqual({
        password: 'mypass',
        code: '123456',
      });
      expect(result).toEqual(responseBody);
    });

    it('disableTwoFactor POSTs password to /auth/two-factor/disable', async () => {
      const responseBody = { status: false };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.disableTwoFactor('mypass');

      expect(lastFetchUrl()).toBe(`${BASE_URL}/auth/two-factor/disable`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(JSON.parse(lastFetchOptions().body as string)).toEqual({
        password: 'mypass',
      });
      expect(result).toEqual(responseBody);
    });

    it('verifyTotp POSTs code and trustDevice to /auth/two-factor/verify-totp', async () => {
      const responseBody = { user: { id: '1' }, token: 'tok' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.verifyTotp('123456', true);

      expect(lastFetchUrl()).toBe(`${BASE_URL}/auth/two-factor/verify-totp`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(JSON.parse(lastFetchOptions().body as string)).toEqual({
        code: '123456',
        trustDevice: true,
      });
      expect(result).toEqual(responseBody);
    });

    it('verifyBackupCode POSTs code to /auth/two-factor/verify-backup-code', async () => {
      const responseBody = { user: { id: '1' }, token: 'tok' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.verifyBackupCode('backup-code-1');

      expect(lastFetchUrl()).toBe(`${BASE_URL}/auth/two-factor/verify-backup-code`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(JSON.parse(lastFetchOptions().body as string)).toEqual({
        code: 'backup-code-1',
      });
      expect(result).toEqual(responseBody);
    });

    it('generateBackupCodes POSTs password to /auth/two-factor/generate-backup-codes', async () => {
      const responseBody = { backupCodes: ['x', 'y', 'z'] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.generateBackupCodes('mypass');

      expect(lastFetchUrl()).toBe(`${BASE_URL}/auth/two-factor/generate-backup-codes`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(JSON.parse(lastFetchOptions().body as string)).toEqual({
        password: 'mypass',
      });
      expect(result).toEqual(responseBody);
    });

    it('viewBackupCodes POSTs password to /auth/two-factor/view-backup-codes', async () => {
      const responseBody = { backupCodes: ['a', 'b', 'c'] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.viewBackupCodes('mypass');

      expect(lastFetchUrl()).toBe(`${BASE_URL}/auth/two-factor/view-backup-codes`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(JSON.parse(lastFetchOptions().body as string)).toEqual({
        password: 'mypass',
      });
      expect(result).toEqual(responseBody);
    });
  });

  // ==========================================================================
  // Machine methods
  // ==========================================================================

  describe('machine methods', () => {
    it('createLinkRequest POSTs to /api/machines/link-request', async () => {
      const responseBody = { code: 'ABC123', expiresAt: '2025-01-01T00:00:00Z' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });
      const data = {
        tunnelId: 'tunnel-1',
        machineName: 'my-laptop',
        os: 'darwin',
        arch: 'arm64',
        agentsDetected: ['claude-code'],
      };

      const result = await client.createLinkRequest(data);

      expect(lastFetchUrl()).toBe(`${BASE_URL}/api/machines/link-request`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(JSON.parse(lastFetchOptions().body as string)).toEqual(data);
      expect(result).toEqual(responseBody);
    });

    it('linkMachine POSTs code to /api/machines/link', async () => {
      const responseBody = { machine: { id: 'm1' } };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.linkMachine('ABC123');

      expect(lastFetchUrl()).toBe(`${BASE_URL}/api/machines/link`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(JSON.parse(lastFetchOptions().body as string)).toEqual({
        code: 'ABC123',
      });
      expect(result).toEqual(responseBody);
    });

    it('getMachines GETs /api/machines', async () => {
      const responseBody = { machines: [] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.getMachines();

      expect(lastFetchUrl()).toBe(`${BASE_URL}/api/machines`);
      expect(lastFetchOptions().method).toBeUndefined();
      expect(result).toEqual(responseBody);
    });

    it('getMachine GETs /api/machines/:id', async () => {
      const responseBody = { machine: { id: 'm1' } };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.getMachine('m1');

      expect(lastFetchUrl()).toBe(`${BASE_URL}/api/machines/m1`);
      expect(lastFetchOptions().method).toBeUndefined();
      expect(result).toEqual(responseBody);
    });

    it('deleteMachine DELETEs /api/machines/:id', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ success: true }));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.deleteMachine('m1');

      expect(lastFetchUrl()).toBe(`${BASE_URL}/api/machines/m1`);
      expect(lastFetchOptions().method).toBe('DELETE');
      expect(result).toEqual({ success: true });
    });

    it('sendHeartbeat POSTs to /api/machines/:id/heartbeat', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ success: true }));
      const client = new ApiClient({ baseUrl: BASE_URL });
      const data = { tunnelId: 'tunnel-1', agentsDetected: ['claude-code'] };

      const result = await client.sendHeartbeat('m1', data);

      expect(lastFetchUrl()).toBe(`${BASE_URL}/api/machines/m1/heartbeat`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(JSON.parse(lastFetchOptions().body as string)).toEqual(data);
      expect(result).toEqual({ success: true });
    });
  });

  // ==========================================================================
  // Settings methods
  // ==========================================================================

  describe('settings methods', () => {
    it('getSessions GETs /api/settings/sessions', async () => {
      const responseBody = { sessions: [] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.getSessions();

      expect(lastFetchUrl()).toBe(`${BASE_URL}/api/settings/sessions`);
      expect(lastFetchOptions().method).toBeUndefined();
      expect(result).toEqual(responseBody);
    });

    it('revokeSession POSTs sessionId to /api/settings/sessions/revoke', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ success: true }));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.revokeSession('sess-1');

      expect(lastFetchUrl()).toBe(`${BASE_URL}/api/settings/sessions/revoke`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(JSON.parse(lastFetchOptions().body as string)).toEqual({
        sessionId: 'sess-1',
      });
      expect(result).toEqual({ success: true });
    });

    it('revokeOtherSessions POSTs to /api/settings/sessions/revoke-others', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ success: true }));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.revokeOtherSessions();

      expect(lastFetchUrl()).toBe(`${BASE_URL}/api/settings/sessions/revoke-others`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(result).toEqual({ success: true });
    });

    it('getConnectedAccounts GETs /api/settings/accounts', async () => {
      const responseBody = { accounts: [] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.getConnectedAccounts();

      expect(lastFetchUrl()).toBe(`${BASE_URL}/api/settings/accounts`);
      expect(lastFetchOptions().method).toBeUndefined();
      expect(result).toEqual(responseBody);
    });

    it('disconnectAccount POSTs providerId to /api/settings/accounts/disconnect', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ success: true }));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.disconnectAccount('github');

      expect(lastFetchUrl()).toBe(`${BASE_URL}/api/settings/accounts/disconnect`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(JSON.parse(lastFetchOptions().body as string)).toEqual({
        providerId: 'github',
      });
      expect(result).toEqual({ success: true });
    });

    it('deleteAccount POSTs to /api/settings/delete-account', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ success: true }));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.deleteAccount();

      expect(lastFetchUrl()).toBe(`${BASE_URL}/api/settings/delete-account`);
      expect(lastFetchOptions().method).toBe('POST');
      expect(result).toEqual({ success: true });
    });

    it('getPreferences GETs /api/settings/preferences', async () => {
      const responseBody = {
        preferences: {
          autoApproveLow: true,
          autoApproveMedium: false,
          autoApproveHigh: false,
          autoApproveCritical: false,
        },
      };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.getPreferences();

      expect(lastFetchUrl()).toBe(`${BASE_URL}/api/settings/preferences`);
      expect(lastFetchOptions().method).toBeUndefined();
      expect(result).toEqual(responseBody);
    });

    it('updatePreferences PUTs to /api/settings/preferences', async () => {
      const prefs = { autoApproveLow: true };
      const responseBody = {
        preferences: {
          autoApproveLow: true,
          autoApproveMedium: false,
          autoApproveHigh: false,
          autoApproveCritical: false,
        },
      };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.updatePreferences(prefs);

      expect(lastFetchUrl()).toBe(`${BASE_URL}/api/settings/preferences`);
      expect(lastFetchOptions().method).toBe('PUT');
      expect(JSON.parse(lastFetchOptions().body as string)).toEqual(prefs);
      expect(result).toEqual(responseBody);
    });
  });

  // ==========================================================================
  // Device methods
  // ==========================================================================

  describe('device methods', () => {
    it('getDevices GETs /api/devices', async () => {
      const responseBody = { devices: [] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(responseBody));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.getDevices();

      expect(lastFetchUrl()).toBe(`${BASE_URL}/api/devices`);
      expect(lastFetchOptions().method).toBeUndefined();
      expect(result).toEqual(responseBody);
    });

    it('deleteDevice DELETEs /api/devices/:id', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ success: true }));
      const client = new ApiClient({ baseUrl: BASE_URL });

      const result = await client.deleteDevice('dev-1');

      expect(lastFetchUrl()).toBe(`${BASE_URL}/api/devices/dev-1`);
      expect(lastFetchOptions().method).toBe('DELETE');
      expect(result).toEqual({ success: true });
    });
  });

  // ==========================================================================
  // Factory function
  // ==========================================================================

  describe('createApiClient factory', () => {
    it('uses default URL when none is provided', () => {
      const client = createApiClient();
      // We can verify by calling a sync method that exposes the baseUrl
      const url = client.getAuthUrl('github');
      expect(url).toBe('https://api.agentap.dev/auth/github');
    });

    it('uses custom URL and defaultHeaders when provided', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ user: null }));
      const client = createApiClient('https://custom.dev', {
        'X-App': 'test',
      });

      await client.getMe();

      expect(lastFetchUrl()).toBe('https://custom.dev/auth/me');
      expect(lastFetchHeaders()['X-App']).toBe('test');
    });
  });
});
