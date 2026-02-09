import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'agentap | Portal',
  description: 'Manage your AI coding agents and machines',
  icons: {
    icon: '/favicon.svg',
    apple: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-gray-950 text-gray-300">{children}</body>
    </html>
  );
}
