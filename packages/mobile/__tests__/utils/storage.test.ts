import * as SecureStore from 'expo-secure-store';

describe('storage (native branch)', () => {
  // Default Platform.OS from jest-expo is 'ios', so native branch is used
  let storage: typeof import('../../utils/storage').storage;

  beforeEach(() => {
    jest.clearAllMocks();
    // Import fresh so we get the module with Platform.OS = 'ios' (default)
    storage = require('../../utils/storage').storage;
  });

  describe('getItem', () => {
    it('calls SecureStore.getItemAsync on native', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('test-value');

      const result = await storage.getItem('my-key');

      expect(SecureStore.getItemAsync).toHaveBeenCalledWith('my-key');
      expect(result).toBe('test-value');
    });

    it('returns null when key does not exist', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

      const result = await storage.getItem('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('setItem', () => {
    it('calls SecureStore.setItemAsync on native', async () => {
      await storage.setItem('my-key', 'my-value');

      expect(SecureStore.setItemAsync).toHaveBeenCalledWith('my-key', 'my-value');
    });
  });

  describe('deleteItem', () => {
    it('calls SecureStore.deleteItemAsync on native', async () => {
      await storage.deleteItem('my-key');

      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('my-key');
    });
  });
});

describe('storage (web branch)', () => {
  let storage: typeof import('../../utils/storage').storage;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up a mock localStorage
    const localStorageMap: Record<string, string> = {};
    const mockLocalStorage = {
      getItem: jest.fn((key: string) => localStorageMap[key] ?? null),
      setItem: jest.fn((key: string, value: string) => {
        localStorageMap[key] = value;
      }),
      removeItem: jest.fn((key: string) => {
        delete localStorageMap[key];
      }),
    };
    Object.defineProperty(global, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    });

    // Use isolateModules to re-evaluate storage.ts with Platform.OS = 'web'
    jest.isolateModules(() => {
      const { Platform } = require('react-native');
      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
      storage = require('../../utils/storage').storage;
    });
  });

  describe('getItem', () => {
    it('calls localStorage.getItem on web', async () => {
      (global.localStorage.getItem as jest.Mock).mockReturnValue('web-value');

      const result = await storage.getItem('web-key');

      expect(global.localStorage.getItem).toHaveBeenCalledWith('web-key');
      expect(result).toBe('web-value');
    });

    it('returns null when key does not exist on web', async () => {
      (global.localStorage.getItem as jest.Mock).mockReturnValue(null);

      const result = await storage.getItem('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('setItem', () => {
    it('calls localStorage.setItem on web', async () => {
      await storage.setItem('web-key', 'web-value');

      expect(global.localStorage.setItem).toHaveBeenCalledWith('web-key', 'web-value');
    });
  });

  describe('deleteItem', () => {
    it('calls localStorage.removeItem on web', async () => {
      await storage.deleteItem('web-key');

      expect(global.localStorage.removeItem).toHaveBeenCalledWith('web-key');
    });
  });
});
