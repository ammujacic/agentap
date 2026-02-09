import { API_URL, APP_SCHEME, API_HEADERS } from '../../constants/Config';

describe('Config', () => {
  describe('API_URL', () => {
    it('is localhost in dev mode', () => {
      // __DEV__ is true in jest-expo preset
      expect(API_URL).toBe('http://localhost:8787');
    });

    it('is a valid URL string', () => {
      expect(typeof API_URL).toBe('string');
      expect(API_URL).toMatch(/^https?:\/\//);
    });
  });

  describe('APP_SCHEME', () => {
    it('is "agentap"', () => {
      expect(APP_SCHEME).toBe('agentap');
    });
  });

  describe('API_HEADERS', () => {
    it('has Origin header set', () => {
      expect(API_HEADERS).toHaveProperty('Origin');
    });

    it('Origin uses the app scheme', () => {
      expect(API_HEADERS.Origin).toBe('agentap://');
    });

    it('is a plain object with string values', () => {
      for (const [key, value] of Object.entries(API_HEADERS)) {
        expect(typeof key).toBe('string');
        expect(typeof value).toBe('string');
      }
    });
  });
});
