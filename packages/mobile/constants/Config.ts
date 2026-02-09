/**
 * App configuration
 */

export const API_URL = __DEV__ ? 'http://localhost:8787' : 'https://api.agentap.dev';

export const APP_SCHEME = 'agentap';

/**
 * Default headers for mobile API requests.
 * React Native fetch doesn't send an Origin header automatically,
 * so we set it explicitly for Better Auth CSRF validation.
 */
export const API_HEADERS: Record<string, string> = {
  Origin: `${APP_SCHEME}://`,
};
