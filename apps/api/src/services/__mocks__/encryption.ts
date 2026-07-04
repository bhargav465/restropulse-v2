import { vi } from 'vitest';

export const generateStateToken = vi.fn(() => 'mock-state-token');
export const encrypt = vi.fn((val: string) => `encrypted_${val}`);
export const decrypt = vi.fn((val: string) => val.replace('encrypted_', ''));
export const generateEncryptionKey = vi.fn(() => 'mock-key');
