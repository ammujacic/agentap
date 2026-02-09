import Link from 'next/link';
import { Github, Twitter } from 'lucide-react';

export function Footer() {
  return (
    <footer className="py-12 border-t border-white/5">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Logo and tagline */}
          <div className="flex items-center gap-3">
            <img src="/logo-icon.svg" alt="" className="h-6 w-6" />
            <span className="text-gray-400 text-sm">
              Connecting your local agents with your mobile device. Free forever.
            </span>
          </div>

          {/* Links */}
          <div className="flex items-center gap-6">
            <Link
              href="https://github.com/agentap-dev/agentap"
              className="text-gray-500 hover:text-white transition-colors"
            >
              <Github className="h-5 w-5" />
            </Link>
            <Link
              href="https://twitter.com/agentap_dev"
              className="text-gray-500 hover:text-white transition-colors"
            >
              <Twitter className="h-5 w-5" />
            </Link>
            <span className="text-gray-600">|</span>
            <span className="text-xs text-gray-500">Free & open source</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
