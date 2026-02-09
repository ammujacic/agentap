'use client';

import { useState } from 'react';
import { Copy, Check, CheckCircle, Code, Mic, Send } from 'lucide-react';

export function Hero() {
  const [copied, setCopied] = useState(false);
  const installCommand = 'npx agentap';

  const copyToClipboard = () => {
    navigator.clipboard.writeText(installCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="relative min-h-screen pt-20 pb-8 overflow-hidden flex items-center">
      {/* Background effects */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/4 left-0 w-[500px] h-[500px] bg-blue-500/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-purple-500/20 rounded-full blur-[120px]" />
      </div>

      <div className="mx-auto max-w-6xl px-6 w-full">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
          {/* Left: Install section */}
          <div className="space-y-8">
            {/* Headline */}
            <div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-[1.1]">
                Let your agent
                <br />
                <span className="gradient-text">work while you walk</span>
              </h1>
              <p className="mt-6 text-xl text-gray-400 max-w-md">
                Your mobile bridge to your local agent. Chat, approve, deny, or just watch the magic
                happen.
              </p>
            </div>

            {/* Install command */}
            <div className="space-y-4">
              <div className="relative group max-w-md">
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-2xl opacity-30 group-hover:opacity-50 blur-lg transition-opacity" />
                <div className="relative bg-gray-900 rounded-2xl p-5 border border-white/10">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <span className="text-blue-400 select-none font-mono">$</span>
                      <code className="font-mono text-lg sm:text-xl text-white truncate">
                        {installCommand}
                      </code>
                    </div>
                    <button
                      onClick={copyToClipboard}
                      className="flex-shrink-0 p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white transition-all"
                    >
                      {copied ? (
                        <Check className="h-5 w-5 text-green-400" />
                      ) : (
                        <Copy className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-sm text-gray-500">Run this, scan QR, done. Takes 30 seconds.</p>
            </div>

            {/* App store links */}
            <div className="flex flex-wrap gap-3 pt-2 pb-8 lg:pb-0 justify-center lg:justify-start">
              <a
                href="#"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white text-gray-900 text-sm font-medium hover:bg-gray-100 transition-all"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                </svg>
                App Store
              </a>
              <a
                href="#"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/10 border border-white/10 text-sm font-medium text-white hover:bg-white/20 transition-all"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 20.5v-17c0-.59.34-1.11.84-1.35L13.69 12l-9.85 9.85c-.5-.25-.84-.76-.84-1.35zm13.81-5.38L6.05 21.34l8.49-8.49 2.27 2.27zm3.35-4.31c.34.27.55.69.55 1.19 0 .5-.21.92-.55 1.19l-2.56 1.52-2.49-2.49 2.49-2.49 2.56 1.08zM6.05 2.66l10.76 6.22-2.27 2.27-8.49-8.49z" />
                </svg>
                Play Store
              </a>
            </div>
          </div>

          {/* Right: Phone mockup */}
          <div className="relative flex justify-center lg:justify-end">
            <div className="animate-float">
              {/* Phone frame - larger */}
              <div className="relative w-[320px] h-[660px] bg-gray-900 rounded-[3.5rem] p-3 border-4 border-gray-800 shadow-2xl shadow-blue-500/20">
                {/* Screen */}
                <div className="w-full h-full bg-gray-950 rounded-[2.75rem] overflow-hidden flex flex-col">
                  {/* Status bar */}
                  <div className="flex items-center justify-between px-8 py-4 text-xs text-gray-500">
                    <span className="font-medium">9:41</span>
                    <div className="flex items-center gap-1">
                      <div className="w-5 h-2.5 rounded-sm border border-gray-600">
                        <div className="w-3 h-full bg-green-400 rounded-sm" />
                      </div>
                    </div>
                  </div>

                  {/* App header - compact */}
                  <div className="px-5 py-3 border-b border-white/5">
                    <div className="flex items-center gap-3">
                      <img src="/logo-icon.svg" alt="" className="h-10 w-10" />
                      <div className="flex-1">
                        <div className="text-white font-semibold text-base">agentap</div>
                      </div>
                      <div className="text-xs text-green-400 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                        Connected
                      </div>
                    </div>
                  </div>

                  {/* Chat / Code diff view */}
                  <div className="flex-1 p-4 space-y-3 overflow-hidden">
                    {/* User message */}
                    <div className="flex justify-end">
                      <div className="bg-gradient-to-r from-blue-500 to-purple-500 rounded-2xl rounded-br-md px-4 py-2.5 max-w-[85%]">
                        <p className="text-sm text-white">Add dark mode toggle</p>
                      </div>
                    </div>

                    {/* Assistant message */}
                    <div className="flex justify-start">
                      <div className="bg-gray-800/80 rounded-2xl rounded-bl-md px-4 py-2.5 max-w-[85%] border border-white/5">
                        <p className="text-sm text-gray-300">
                          I'll add a dark mode toggle to your settings component.
                        </p>
                      </div>
                    </div>

                    {/* Code diff card */}
                    <div className="bg-gray-900/80 rounded-2xl border border-white/10 overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-gray-800/50">
                        <Code className="h-3.5 w-3.5 text-gray-400" />
                        <span className="text-xs text-gray-400 font-mono">Settings.tsx</span>
                        <div className="ml-auto flex items-center gap-1.5">
                          <span className="text-xs text-green-400">+12</span>
                          <span className="text-xs text-red-400">-3</span>
                        </div>
                      </div>
                      <div className="p-3 font-mono text-[10px] leading-relaxed space-y-0.5">
                        <div className="text-gray-500"> const [theme, setTheme] = </div>
                        <div className="text-red-400/80 bg-red-500/10 -mx-3 px-3">
                          - useState('light');
                        </div>
                        <div className="text-green-400/80 bg-green-500/10 -mx-3 px-3">
                          + useState(() =&gt;{' '}
                        </div>
                        <div className="text-green-400/80 bg-green-500/10 -mx-3 px-3">
                          + localStorage.get('theme')
                        </div>
                        <div className="text-green-400/80 bg-green-500/10 -mx-3 px-3">+ );</div>
                      </div>
                    </div>

                    {/* Tool status */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/30 rounded-xl border border-white/5">
                      <CheckCircle className="h-4 w-4 text-green-400" />
                      <span className="text-xs text-gray-400">Edited Settings.tsx</span>
                      <span className="text-xs text-gray-600 ml-auto">just now</span>
                    </div>
                  </div>

                  {/* Input bar */}
                  <div className="px-4 pb-8 pt-2 mt-auto">
                    <div className="flex items-center gap-2 bg-gray-800/80 rounded-2xl border border-white/10 px-4 py-2.5">
                      <input
                        type="text"
                        placeholder="Message..."
                        className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
                        readOnly
                      />
                      <button className="p-1.5 rounded-full hover:bg-white/10 text-gray-400">
                        <Mic className="h-4 w-4" />
                      </button>
                      <button className="p-1.5 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 text-white">
                        <Send className="h-4 w-4" />
                      </button>
                    </div>
                    {/* Home indicator */}
                    <div className="mt-3 mx-auto w-32 h-1 bg-gray-700 rounded-full" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
