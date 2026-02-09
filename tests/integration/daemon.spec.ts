import { test, expect } from '@playwright/test';

const DAEMON_URL = process.env.DAEMON_URL || 'http://localhost:9876';

test.describe('Daemon', () => {
  test.skip(!!process.env.CI, 'Skip daemon tests in CI for now');

  test('daemon health check responds', async ({ request }) => {
    const response = await request.get(`${DAEMON_URL}/health`);
    expect(response.ok()).toBeTruthy();
  });

  test('daemon WebSocket accepts connection', async ({ page }) => {
    const wsUrl = DAEMON_URL.replace('http', 'ws') + '/ws';

    const wsConnected = await page.evaluate(async (url) => {
      return new Promise<boolean>((resolve) => {
        const ws = new WebSocket(url);

        ws.onopen = () => {
          ws.close();
          resolve(true);
        };

        ws.onerror = () => {
          resolve(false);
        };

        setTimeout(() => {
          ws.close();
          resolve(false);
        }, 5000);
      });
    }, wsUrl);

    expect(wsConnected).toBeTruthy();
  });
});
