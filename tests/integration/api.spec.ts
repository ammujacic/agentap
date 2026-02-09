import { test, expect } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://localhost:8787';

test.describe('API Health', () => {
  test('health endpoint returns ok', async ({ request }) => {
    const response = await request.get(`${API_URL}/health`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.status).toBe('ok');
  });

  test('root endpoint returns API info', async ({ request }) => {
    const response = await request.get(`${API_URL}/`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.name).toBe('Agentap API');
    expect(data.status).toBe('ok');
  });
});

test.describe('Authentication API', () => {
  test('can register a new user', async ({ request }) => {
    const uniqueEmail = `test-${Date.now()}@example.com`;

    const response = await request.post(`${API_URL}/auth/register`, {
      data: {
        email: uniqueEmail,
        password: 'testpassword123',
        name: 'Test User',
      },
    });

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.user.email).toBe(uniqueEmail.toLowerCase());
    expect(data.user.name).toBe('Test User');
  });

  test('rejects duplicate email registration', async ({ request }) => {
    const email = `duplicate-${Date.now()}@example.com`;

    // First registration
    await request.post(`${API_URL}/auth/register`, {
      data: { email, password: 'password123', name: 'First' },
    });

    // Second registration with same email
    const response = await request.post(`${API_URL}/auth/register`, {
      data: { email, password: 'password456', name: 'Second' },
    });

    expect(response.status()).toBe(409);
    const data = await response.json();
    expect(data.error).toContain('already registered');
  });

  test('rejects short passwords', async ({ request }) => {
    const response = await request.post(`${API_URL}/auth/register`, {
      data: {
        email: 'short@example.com',
        password: 'short',
        name: 'Short Password',
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('8 characters');
  });

  test('can login with valid credentials', async ({ request }) => {
    const email = `login-${Date.now()}@example.com`;
    const password = 'loginpassword123';

    // Register first
    await request.post(`${API_URL}/auth/register`, {
      data: { email, password, name: 'Login Test' },
    });

    // Then login
    const response = await request.post(`${API_URL}/auth/login`, {
      data: { email, password },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.user.email).toBe(email.toLowerCase());
  });

  test('rejects invalid credentials', async ({ request }) => {
    const response = await request.post(`${API_URL}/auth/login`, {
      data: {
        email: 'nonexistent@example.com',
        password: 'wrongpassword',
      },
    });

    expect(response.status()).toBe(401);
    const data = await response.json();
    expect(data.error).toContain('Invalid');
  });

  test('unauthenticated /me returns 401', async ({ request }) => {
    const response = await request.get(`${API_URL}/auth/me`);
    expect(response.status()).toBe(401);
  });
});
