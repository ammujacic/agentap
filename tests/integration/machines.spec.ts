import { test, expect } from '../fixtures/auth';

const API_URL = process.env.API_URL || 'http://localhost:8787';

test.describe('Machines API', () => {
  test('authenticated user can list machines', async ({ authenticatedPage }) => {
    const response = await authenticatedPage.request.get(`${API_URL}/api/machines`);

    // Should return 200 for authenticated user
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data.machines)).toBeTruthy();
  });

  test('unauthenticated user cannot list machines', async ({ page }) => {
    const response = await page.request.get(`${API_URL}/api/machines`);
    expect(response.status()).toBe(401);
  });

  test('can create machine link request', async ({ authenticatedPage }) => {
    const response = await authenticatedPage.request.post(`${API_URL}/api/machines/link-request`, {
      data: {
        tunnelId: `test-tunnel-${Date.now()}`,
        machineName: 'Test Machine',
        os: 'darwin',
        arch: 'arm64',
        agentsDetected: ['claude-code'],
      },
    });

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.code).toBeDefined();
    expect(typeof data.code).toBe('string');
  });
});
