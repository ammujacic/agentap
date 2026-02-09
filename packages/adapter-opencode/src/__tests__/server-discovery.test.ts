import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { discoverServer } from '../server-discovery';

// ── Tests ────────────────────────────────────────────────────────────

describe('discoverServer', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns server info when default port (4096) is healthy', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ healthy: true, version: '0.2.0' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await discoverServer();

    expect(result).toEqual({
      url: 'http://127.0.0.1:4096',
      version: '0.2.0',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4096/global/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    vi.unstubAllGlobals();
  });

  it('returns null when no server is running on any port', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
    vi.stubGlobal('fetch', mockFetch);

    const result = await discoverServer();

    expect(result).toBeNull();
    // Should have tried default port + 10 additional ports = 11 total
    expect(mockFetch).toHaveBeenCalledTimes(11);

    vi.unstubAllGlobals();
  });

  it('returns server on alternate port when default fails', async () => {
    const mockFetch = vi
      .fn()
      // Port 4096 fails
      .mockRejectedValueOnce(new Error('Connection refused'))
      // Port 4097 fails
      .mockRejectedValueOnce(new Error('Connection refused'))
      // Port 4098 succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ healthy: true, version: '0.3.0' }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const result = await discoverServer();

    expect(result).toEqual({
      url: 'http://127.0.0.1:4098',
      version: '0.3.0',
    });

    vi.unstubAllGlobals();
  });

  it('returns null when health check returns unhealthy', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ healthy: false, version: '0.2.0' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await discoverServer();

    expect(result).toBeNull();

    vi.unstubAllGlobals();
  });

  it('returns null when health check returns non-OK status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await discoverServer();

    expect(result).toBeNull();

    vi.unstubAllGlobals();
  });

  it('handles aborted requests (timeout simulation)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    vi.stubGlobal('fetch', mockFetch);

    const result = await discoverServer();

    expect(result).toBeNull();
    // All 11 ports should have been tried
    expect(mockFetch).toHaveBeenCalledTimes(11);

    vi.unstubAllGlobals();
  });

  it('scans ports 4096 through 4106', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
    vi.stubGlobal('fetch', mockFetch);

    await discoverServer();

    // Verify port range
    const calledUrls = mockFetch.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(calledUrls[0]).toBe('http://127.0.0.1:4096/global/health');
    expect(calledUrls[calledUrls.length - 1]).toBe('http://127.0.0.1:4106/global/health');
    expect(calledUrls.length).toBe(11);

    vi.unstubAllGlobals();
  });
});
