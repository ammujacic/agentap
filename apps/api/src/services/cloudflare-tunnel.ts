/**
 * Cloudflare Tunnel management via Cloudflare API
 *
 * Creates named tunnels on a custom domain so each machine gets a
 * persistent, branded URL like t-<machineId>.tunnel.agentap.dev
 */

interface TunnelCreateResponse {
  success: boolean;
  result: {
    id: string;
    name: string;
    token: string;
  };
  errors: Array<{ code: number; message: string }>;
}

interface DnsRecordResponse {
  success: boolean;
  result: {
    id: string;
    name: string;
    type: string;
    content: string;
  };
  errors: Array<{ code: number; message: string }>;
}

/**
 * Create a named Cloudflare tunnel
 */
export async function createCloudflareTunnel(
  accountId: string,
  apiToken: string,
  tunnelName: string,
  tunnelSecret: string
): Promise<{ tunnelId: string; token: string }> {
  // Create the tunnel
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: tunnelName,
        tunnel_secret: btoa(tunnelSecret),
        config_src: 'cloudflare',
      }),
    }
  );

  const data = (await response.json()) as TunnelCreateResponse;

  if (!data.success) {
    throw new Error(`Failed to create tunnel: ${data.errors.map((e) => e.message).join(', ')}`);
  }

  return {
    tunnelId: data.result.id,
    token: data.result.token,
  };
}

/**
 * Configure tunnel ingress rules (route traffic to the daemon's local port)
 */
export async function configureTunnelIngress(
  accountId: string,
  apiToken: string,
  tunnelId: string,
  hostname: string
): Promise<void> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          ingress: [
            {
              hostname,
              service: 'http://localhost:9876',
              originRequest: {},
            },
            {
              service: 'http_status:404',
            },
          ],
        },
      }),
    }
  );

  const data = (await response.json()) as { success: boolean; errors: Array<{ message: string }> };
  if (!data.success) {
    throw new Error(
      `Failed to configure tunnel ingress: ${data.errors.map((e) => e.message).join(', ')}`
    );
  }
}

/**
 * Create a DNS CNAME record pointing to the tunnel
 */
export async function createTunnelDnsRecord(
  zoneId: string,
  apiToken: string,
  subdomain: string,
  tunnelId: string
): Promise<string> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'CNAME',
      name: subdomain,
      content: `${tunnelId}.cfargotunnel.com`,
      proxied: true,
    }),
  });

  const data = (await response.json()) as DnsRecordResponse;

  if (!data.success) {
    throw new Error(`Failed to create DNS record: ${data.errors.map((e) => e.message).join(', ')}`);
  }

  return data.result.id;
}

/**
 * Delete a Cloudflare tunnel
 */
export async function deleteCloudflareTunnel(
  accountId: string,
  apiToken: string,
  tunnelId: string
): Promise<void> {
  // First clean up connections
  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/connections`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    }
  );

  // Then delete the tunnel
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    }
  );

  const data = (await response.json()) as { success: boolean; errors: Array<{ message: string }> };

  if (!data.success) {
    // Don't throw on delete failures — best effort cleanup
    console.error(`Failed to delete tunnel ${tunnelId}:`, data.errors);
  }
}

/**
 * Delete a DNS record
 */
export async function deleteTunnelDnsRecord(
  zoneId: string,
  apiToken: string,
  subdomain: string
): Promise<void> {
  // First find the record by name
  const params = new URLSearchParams({ name: subdomain, type: 'CNAME' });
  const listResponse = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?${params}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    }
  );

  const listData = (await listResponse.json()) as {
    success: boolean;
    result: Array<{ id: string }>;
  };

  if (!listData.success || listData.result.length === 0) {
    return; // Record doesn't exist, nothing to delete
  }

  // Delete the record
  await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${listData.result[0].id}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    }
  );
}

/**
 * Full tunnel setup: create tunnel + DNS + configure ingress
 * Returns tunnel ID and token for the daemon to use
 */
export async function setupMachineTunnel(
  accountId: string,
  apiToken: string,
  zoneId: string,
  tunnelDomain: string,
  machineId: string
): Promise<{ cfTunnelId: string; tunnelToken: string; tunnelUrl: string }> {
  const tunnelName = `agentap-${machineId}`;
  const subdomain = `t-${machineId}.${tunnelDomain}`;
  const tunnelUrl = `https://${subdomain}`;

  // Generate a random tunnel secret
  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);
  const tunnelSecret = Array.from(secretBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Create the tunnel
  const { tunnelId, token } = await createCloudflareTunnel(
    accountId,
    apiToken,
    tunnelName,
    tunnelSecret
  );

  // Configure ingress rules
  await configureTunnelIngress(accountId, apiToken, tunnelId, subdomain);

  // Create DNS record
  await createTunnelDnsRecord(zoneId, apiToken, subdomain, tunnelId);

  return {
    cfTunnelId: tunnelId,
    tunnelToken: token,
    tunnelUrl,
  };
}

/**
 * Full tunnel teardown: delete DNS + tunnel
 */
export async function teardownMachineTunnel(
  accountId: string,
  apiToken: string,
  zoneId: string,
  tunnelDomain: string,
  machineId: string,
  cfTunnelId: string
): Promise<void> {
  const subdomain = `t-${machineId}.${tunnelDomain}`;

  await deleteTunnelDnsRecord(zoneId, apiToken, subdomain);
  await deleteCloudflareTunnel(accountId, apiToken, cfTunnelId);
}
