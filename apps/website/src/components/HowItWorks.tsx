'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

const steps = [
  {
    step: '1',
    title: 'Install daemon',
    command: 'npx agentap',
    description: 'Runs in background, auto-detects Claude Code & Cursor',
  },
  {
    step: '2',
    title: 'Scan QR code',
    command: 'agentap pair',
    description: 'Open the mobile app, scan the code, done',
  },
  {
    step: '3',
    title: 'Start coding',
    command: 'claude "fix the auth bug"',
    description: 'Approvals come straight to your phone',
  },
];

export function HowItWorks() {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyCommand = (command: string, index: number) => {
    navigator.clipboard.writeText(command);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <section id="how-it-works" className="py-24 relative">
      <div className="mx-auto max-w-6xl px-6">
        {/* Section header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Three steps. Two minutes.
          </h2>
          <p className="text-gray-400 max-w-lg mx-auto">
            No accounts to create, no config files to edit.
          </p>
        </div>

        {/* Steps */}
        <div className="grid md:grid-cols-3 gap-6">
          {steps.map((item, index) => (
            <div key={item.step} className="relative">
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className="hidden md:block absolute top-8 left-full w-6 h-px bg-gradient-to-r from-white/20 to-transparent z-10" />
              )}

              <div className="bg-gray-900/50 rounded-2xl p-6 border border-white/5 h-full">
                {/* Step number */}
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-white/10 text-white font-bold mb-4">
                  {item.step}
                </div>

                {/* Title */}
                <h3 className="text-lg font-semibold text-white mb-2">{item.title}</h3>

                {/* Command */}
                <button
                  onClick={() => copyCommand(item.command, index)}
                  className="w-full flex items-center justify-between gap-2 bg-gray-950 rounded-lg px-3 py-2 mb-3 group hover:bg-gray-900 transition-colors"
                >
                  <code className="font-mono text-sm text-blue-400 truncate">{item.command}</code>
                  {copiedIndex === index ? (
                    <Check className="h-4 w-4 text-green-400 flex-shrink-0" />
                  ) : (
                    <Copy className="h-4 w-4 text-gray-500 group-hover:text-gray-300 flex-shrink-0 transition-colors" />
                  )}
                </button>

                {/* Description */}
                <p className="text-sm text-gray-500">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
