import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'agentap - Mobile bridge for your local coding agents',
  description:
    'Push notifications when Claude Code or Cursor needs permission. Approve file changes and commands from anywhere.',
  keywords: ['AI coding', 'Claude Code', 'Cursor', 'mobile approval', 'developer tools'],
  icons: {
    icon: '/favicon.svg',
    apple: '/favicon.svg',
  },
  openGraph: {
    title: 'agentap - Mobile bridge for your local coding agents',
    description: 'Push notifications when Claude Code or Cursor needs permission.',
    type: 'website',
    url: 'https://agentap.dev',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-gray-950 text-gray-300">{children}</body>
    </html>
  );
}
