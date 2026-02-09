'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, X, Github } from 'lucide-react';

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-gray-950/80 backdrop-blur-xl border-b border-white/5">
        <nav className="mx-auto max-w-6xl px-6" aria-label="Global">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-1 group">
              <img src="/logo-icon.svg" alt="" className="h-14 w-14" />
              <span className="font-bold text-lg text-white group-hover:gradient-text transition-all">
                agentap
              </span>
            </Link>

            {/* Desktop nav */}
            <div className="hidden md:flex items-center gap-6">
              <Link
                href="https://github.com/agentap-dev/agentap"
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                <Github className="h-4 w-4" />
                GitHub
              </Link>
              <Link
                href="https://portal.agentap.dev/login"
                className="text-sm font-medium text-white px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors"
              >
                Sign in
              </Link>
            </div>

            {/* Mobile menu button */}
            <button
              type="button"
              className="md:hidden p-2 text-gray-400 hover:text-white"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-6 w-6" />
            </button>
          </div>
        </nav>
      </header>

      <MobileMenu open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
    </>
  );
}

function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="md:hidden fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-gray-950/90 backdrop-blur-md" onClick={onClose} />
      {/* Panel */}
      <div className="absolute inset-y-0 right-0 w-full max-w-xs bg-gray-900 border-l border-white/10 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-8">
          <Link href="/" className="flex items-center gap-2" onClick={onClose}>
            <img src="/logo-icon.svg" alt="" className="h-11 w-11" />
            <span className="font-medium text-lg text-white">agentap</span>
          </Link>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white">
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="space-y-4">
          <Link
            href="https://github.com/agentap-dev/agentap"
            className="flex items-center gap-2 py-3 text-gray-300 hover:text-white text-lg"
            onClick={onClose}
          >
            <Github className="h-5 w-5" />
            GitHub
          </Link>
          <Link
            href="https://portal.agentap.dev/login"
            className="block text-center py-3 rounded-xl bg-white/10 text-white font-medium hover:bg-white/20 transition-colors text-lg"
            onClick={onClose}
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
