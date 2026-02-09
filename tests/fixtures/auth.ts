import { test as base, expect, type Page } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://localhost:8787';

interface DemoUser {
  email: string;
  password: string;
}

interface AuthFixtures {
  demoUser: DemoUser;
  authenticatedPage: Page;
}

/**
 * Extended test fixture with authentication helpers
 */
export const test = base.extend<AuthFixtures>({
  demoUser: async ({}, use) => {
    await use({
      email: 'demo@agentap.dev',
      password: 'demo1234',
    });
  },

  authenticatedPage: async ({ page, demoUser }, use) => {
    // Login via API
    const response = await page.request.post(`${API_URL}/auth/login`, {
      data: {
        email: demoUser.email,
        password: demoUser.password,
      },
    });

    if (response.ok()) {
      // Extract and set session cookie
      const cookies = response.headers()['set-cookie'];
      if (cookies) {
        const sessionCookie = cookies.split(';')[0];
        const [name, value] = sessionCookie.split('=');
        await page.context().addCookies([
          {
            name,
            value,
            domain: 'localhost',
            path: '/',
          },
        ]);
      }
    }

    await use(page);
  },
});

export { expect };
