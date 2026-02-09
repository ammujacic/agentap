import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createCloudflareTunnel,
  configureTunnelIngress,
  createTunnelDnsRecord,
  deleteCloudflareTunnel,
  deleteTunnelDnsRecord,
  setupMachineTunnel,
  teardownMachineTunnel,
} from '../../services/cloudflare-tunnel';

const ACCOUNT_ID = 'acc-123';
const API_TOKEN = 'tok-abc';
const ZONE_ID = 'zone-456';
const TUNNEL_DOMAIN = 'tunnel.agentap.dev';

function mockFetchResponse(body: unknown, ok = true) {
  return {
    ok,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('cloudflare-tunnel', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── createCloudflareTunnel ──────────────────────────────────────────

  describe('createCloudflareTunnel', () => {
    it('should send POST request with correct URL, headers, and body', async () => {
      const responseBody = {
        success: true,
        result: { id: 'tunnel-1', name: 'agentap-m1', token: 'tok-tunnel' },
        errors: [],
      };
      vi.mocked(fetch).mockResolvedValue(mockFetchResponse(responseBody));

      await createCloudflareTunnel(ACCOUNT_ID, API_TOKEN, 'agentap-m1', 'secret123');

      expect(fetch).toHaveBeenCalledWith(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel`,
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json',
          },
        })
      );

      // Verify body contains the tunnel name and base64-encoded secret
      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse((callArgs[1] as RequestInit).body as string);
      expect(body.name).toBe('agentap-m1');
      expect(body.tunnel_secret).toBe(btoa('secret123'));
      expect(body.config_src).toBe('cloudflare');
    });

    it('should return tunnelId and token on success', async () => {
      const responseBody = {
        success: true,
        result: { id: 'tunnel-1', name: 'agentap-m1', token: 'tok-tunnel' },
        errors: [],
      };
      vi.mocked(fetch).mockResolvedValue(mockFetchResponse(responseBody));

      const result = await createCloudflareTunnel(ACCOUNT_ID, API_TOKEN, 'agentap-m1', 'secret123');

      expect(result).toEqual({ tunnelId: 'tunnel-1', token: 'tok-tunnel' });
    });

    it('should throw on failure with error messages', async () => {
      const responseBody = {
        success: false,
        result: null,
        errors: [
          { code: 1001, message: 'Duplicate tunnel name' },
          { code: 1002, message: 'Rate limited' },
        ],
      };
      vi.mocked(fetch).mockResolvedValue(mockFetchResponse(responseBody));

      await expect(
        createCloudflareTunnel(ACCOUNT_ID, API_TOKEN, 'agentap-m1', 'secret123')
      ).rejects.toThrow('Failed to create tunnel: Duplicate tunnel name, Rate limited');
    });
  });

  // ─── configureTunnelIngress ──────────────────────────────────────────

  describe('configureTunnelIngress', () => {
    it('should send PUT with ingress config', async () => {
      vi.mocked(fetch).mockResolvedValue(mockFetchResponse({ success: true, errors: [] }));

      await configureTunnelIngress(ACCOUNT_ID, API_TOKEN, 'tunnel-1', 'my.host.com');

      expect(fetch).toHaveBeenCalledWith(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/tunnel-1/configurations`,
        expect.objectContaining({ method: 'PUT' })
      );

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse((callArgs[1] as RequestInit).body as string);
      expect(body.config.ingress).toHaveLength(2);
      expect(body.config.ingress[0]).toEqual({
        hostname: 'my.host.com',
        service: 'http://localhost:9876',
        originRequest: {},
      });
      expect(body.config.ingress[1]).toEqual({ service: 'http_status:404' });
    });

    it('should throw on failure', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockFetchResponse({ success: false, errors: [{ message: 'Bad config' }] })
      );

      await expect(
        configureTunnelIngress(ACCOUNT_ID, API_TOKEN, 'tunnel-1', 'my.host.com')
      ).rejects.toThrow('Failed to configure tunnel ingress: Bad config');
    });
  });

  // ─── createTunnelDnsRecord ───────────────────────────────────────────

  describe('createTunnelDnsRecord', () => {
    it('should send POST to create CNAME record', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockFetchResponse({
          success: true,
          result: {
            id: 'dns-rec-1',
            name: 't-m1.tunnel.agentap.dev',
            type: 'CNAME',
            content: 'tunnel-1.cfargotunnel.com',
          },
          errors: [],
        })
      );

      await createTunnelDnsRecord(ZONE_ID, API_TOKEN, 't-m1.tunnel.agentap.dev', 'tunnel-1');

      expect(fetch).toHaveBeenCalledWith(
        `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records`,
        expect.objectContaining({ method: 'POST' })
      );

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse((callArgs[1] as RequestInit).body as string);
      expect(body.type).toBe('CNAME');
      expect(body.name).toBe('t-m1.tunnel.agentap.dev');
      expect(body.content).toBe('tunnel-1.cfargotunnel.com');
      expect(body.proxied).toBe(true);
    });

    it('should return the DNS record id', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockFetchResponse({
          success: true,
          result: { id: 'dns-rec-1', name: 'sub', type: 'CNAME', content: 'x' },
          errors: [],
        })
      );

      const id = await createTunnelDnsRecord(ZONE_ID, API_TOKEN, 'sub', 'tunnel-1');
      expect(id).toBe('dns-rec-1');
    });

    it('should throw on failure', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockFetchResponse({
          success: false,
          result: null,
          errors: [{ message: 'Record already exists' }],
        })
      );

      await expect(createTunnelDnsRecord(ZONE_ID, API_TOKEN, 'sub', 'tunnel-1')).rejects.toThrow(
        'Failed to create DNS record: Record already exists'
      );
    });
  });

  // ─── deleteCloudflareTunnel ──────────────────────────────────────────

  describe('deleteCloudflareTunnel', () => {
    it('should delete connections first, then the tunnel', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(mockFetchResponse({ success: true })) // delete connections
        .mockResolvedValueOnce(mockFetchResponse({ success: true, errors: [] })); // delete tunnel

      await deleteCloudflareTunnel(ACCOUNT_ID, API_TOKEN, 'tunnel-1');

      expect(fetch).toHaveBeenCalledTimes(2);

      // First call: delete connections
      expect(fetch).toHaveBeenNthCalledWith(
        1,
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/tunnel-1/connections`,
        expect.objectContaining({ method: 'DELETE' })
      );

      // Second call: delete tunnel
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/tunnel-1`,
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should log error on failure but not throw', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(fetch)
        .mockResolvedValueOnce(mockFetchResponse({ success: true }))
        .mockResolvedValueOnce(
          mockFetchResponse({ success: false, errors: [{ message: 'Not found' }] })
        );

      // Should NOT throw
      await expect(
        deleteCloudflareTunnel(ACCOUNT_ID, API_TOKEN, 'tunnel-1')
      ).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith('Failed to delete tunnel tunnel-1:', [
        { message: 'Not found' },
      ]);

      consoleSpy.mockRestore();
    });
  });

  // ─── deleteTunnelDnsRecord ───────────────────────────────────────────

  describe('deleteTunnelDnsRecord', () => {
    it('should list records then delete matching record', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(mockFetchResponse({ success: true, result: [{ id: 'dns-rec-1' }] })) // list
        .mockResolvedValueOnce(mockFetchResponse({ success: true })); // delete

      await deleteTunnelDnsRecord(ZONE_ID, API_TOKEN, 't-m1.tunnel.agentap.dev');

      expect(fetch).toHaveBeenCalledTimes(2);

      // First: list DNS records
      expect(fetch).toHaveBeenNthCalledWith(
        1,
        `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?name=t-m1.tunnel.agentap.dev&type=CNAME`,
        expect.objectContaining({
          headers: { Authorization: `Bearer ${API_TOKEN}` },
        })
      );

      // Second: delete the found record
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/dns-rec-1`,
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should be a no-op when record is not found', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockFetchResponse({ success: true, result: [] }));

      await deleteTunnelDnsRecord(ZONE_ID, API_TOKEN, 't-m1.tunnel.agentap.dev');

      // Only the list call should happen
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should be a no-op when list request fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockFetchResponse({ success: false, result: [] }));

      await deleteTunnelDnsRecord(ZONE_ID, API_TOKEN, 't-m1.tunnel.agentap.dev');

      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  // ─── setupMachineTunnel ──────────────────────────────────────────────

  describe('setupMachineTunnel', () => {
    it('should call create, configure, and dns in order and return tunnel info', async () => {
      // Mock crypto.getRandomValues
      const mockGetRandomValues = vi.fn((arr: Uint8Array) => {
        arr.fill(0xab);
        return arr;
      });
      vi.stubGlobal('crypto', { getRandomValues: mockGetRandomValues });

      vi.mocked(fetch)
        // createCloudflareTunnel
        .mockResolvedValueOnce(
          mockFetchResponse({
            success: true,
            result: { id: 'tunnel-99', name: 'agentap-m1', token: 'tunnel-token-99' },
            errors: [],
          })
        )
        // configureTunnelIngress
        .mockResolvedValueOnce(mockFetchResponse({ success: true, errors: [] }))
        // createTunnelDnsRecord
        .mockResolvedValueOnce(
          mockFetchResponse({
            success: true,
            result: { id: 'dns-1', name: 't-m1.tunnel.agentap.dev', type: 'CNAME', content: 'x' },
            errors: [],
          })
        );

      const result = await setupMachineTunnel(ACCOUNT_ID, API_TOKEN, ZONE_ID, TUNNEL_DOMAIN, 'm1');

      expect(result).toEqual({
        cfTunnelId: 'tunnel-99',
        tunnelToken: 'tunnel-token-99',
        tunnelUrl: 'https://t-m1.tunnel.agentap.dev',
      });

      expect(fetch).toHaveBeenCalledTimes(3);

      // Verify order: 1) create tunnel, 2) configure ingress, 3) DNS
      const calls = vi.mocked(fetch).mock.calls;

      // First call: create tunnel
      expect(calls[0][0]).toContain('/cfd_tunnel');
      expect((calls[0][1] as RequestInit).method).toBe('POST');

      // Second call: configure ingress
      expect(calls[1][0]).toContain('/configurations');
      expect((calls[1][1] as RequestInit).method).toBe('PUT');

      // Third call: create DNS
      expect(calls[2][0]).toContain('/dns_records');
      expect((calls[2][1] as RequestInit).method).toBe('POST');
    });
  });

  // ─── teardownMachineTunnel ───────────────────────────────────────────

  describe('teardownMachineTunnel', () => {
    it('should call deleteDns then deleteTunnel', async () => {
      vi.mocked(fetch)
        // deleteTunnelDnsRecord: list
        .mockResolvedValueOnce(mockFetchResponse({ success: true, result: [{ id: 'dns-rec-1' }] }))
        // deleteTunnelDnsRecord: delete
        .mockResolvedValueOnce(mockFetchResponse({ success: true }))
        // deleteCloudflareTunnel: delete connections
        .mockResolvedValueOnce(mockFetchResponse({ success: true }))
        // deleteCloudflareTunnel: delete tunnel
        .mockResolvedValueOnce(mockFetchResponse({ success: true, errors: [] }));

      await teardownMachineTunnel(ACCOUNT_ID, API_TOKEN, ZONE_ID, TUNNEL_DOMAIN, 'm1', 'tunnel-99');

      expect(fetch).toHaveBeenCalledTimes(4);

      const calls = vi.mocked(fetch).mock.calls;

      // First two: DNS record list + delete
      expect(calls[0][0]).toContain('/dns_records?name=t-m1.tunnel.agentap.dev');
      expect(calls[1][0]).toContain('/dns_records/dns-rec-1');

      // Last two: tunnel connections delete + tunnel delete
      expect(calls[2][0]).toContain('/cfd_tunnel/tunnel-99/connections');
      expect(calls[3][0]).toContain('/cfd_tunnel/tunnel-99');
    });
  });
});
