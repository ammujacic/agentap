import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock next/link - render as a plain anchor tag
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anchorProps: any = { href, ...props };
    // Remove Next.js-specific props that aren't valid HTML attributes
    delete anchorProps.prefetch;
    delete anchorProps.passHref;
    delete anchorProps.legacyBehavior;
    return <a {...anchorProps}>{children}</a>;
  },
}));

// Mock next/image
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text, @typescript-eslint/no-explicit-any
    return <img {...(props as any)} />;
  },
}));

// Mock CSS imports
vi.mock('../src/app/globals.css', () => ({}));

// Mock navigator.clipboard
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
  writable: true,
  configurable: true,
});
