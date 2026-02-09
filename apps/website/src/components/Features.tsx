'use client';

export function Features() {
  return (
    <section className="py-32 relative overflow-hidden">
      <div className="mx-auto max-w-5xl px-6 relative">
        {/* Feature 1: Buzz */}
        <div className="group relative mb-24">
          <div className="flex flex-col md:flex-row items-center gap-12 md:gap-20">
            {/* Phone Icon */}
            <div className="relative w-40 h-40 flex-shrink-0">
              <svg viewBox="0 0 120 120" className="w-full h-full" fill="none">
                <defs>
                  <linearGradient id="phoneGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#3B82F6" />
                    <stop offset="100%" stopColor="#8B5CF6" />
                  </linearGradient>
                </defs>
                {/* Phone outline */}
                <rect
                  x="35"
                  y="15"
                  width="50"
                  height="90"
                  rx="8"
                  stroke="url(#phoneGradient)"
                  strokeWidth="2.5"
                  className="group-hover:stroke-[3] transition-all duration-300"
                />
                {/* Screen */}
                <rect
                  x="40"
                  y="25"
                  width="40"
                  height="65"
                  rx="2"
                  stroke="url(#phoneGradient)"
                  strokeWidth="1"
                  strokeOpacity="0.4"
                />
                {/* Notification dot */}
                <circle
                  cx="60"
                  cy="50"
                  r="8"
                  fill="url(#phoneGradient)"
                  className="group-hover:animate-ping"
                  fillOpacity="0.8"
                />
                {/* Vibration lines */}
                <path
                  d="M25 40 L30 45 M25 60 L30 55 M25 50 L28 50"
                  stroke="url(#phoneGradient)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                />
                <path
                  d="M95 40 L90 45 M95 60 L90 55 M95 50 L92 50"
                  stroke="url(#phoneGradient)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                />
              </svg>
            </div>

            {/* Text */}
            <div className="text-center md:text-left">
              <h3 className="text-3xl font-bold text-white mb-4">
                <span className="gradient-text">Buzz.</span> Your pocket vibrates.
              </h3>
              <p className="text-gray-400 text-lg max-w-md leading-relaxed">
                Your agent wants to run{' '}
                <code className="text-blue-400 bg-blue-500/10 px-2 py-1 rounded font-mono text-base">
                  rm -rf node_modules
                </code>
                . You feel it. Anywhere. Even in the shower.
              </p>
            </div>
          </div>
        </div>

        {/* Feature 2: Tap */}
        <div className="group relative mb-24">
          <div className="flex flex-col md:flex-row-reverse items-center gap-12 md:gap-20">
            {/* Buttons Icon */}
            <div className="relative w-40 h-40 flex-shrink-0">
              <svg viewBox="0 0 120 120" className="w-full h-full" fill="none">
                <defs>
                  <linearGradient id="greenGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#22C55E" />
                    <stop offset="100%" stopColor="#10B981" />
                  </linearGradient>
                  <linearGradient id="redGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#EF4444" />
                    <stop offset="100%" stopColor="#F43F5E" />
                  </linearGradient>
                </defs>
                {/* Check circle */}
                <circle
                  cx="40"
                  cy="60"
                  r="24"
                  stroke="url(#greenGradient)"
                  strokeWidth="2.5"
                  className="group-hover:stroke-[3] group-hover:scale-105 origin-center transition-all duration-300"
                />
                <path
                  d="M30 60 L37 67 L52 52"
                  stroke="url(#greenGradient)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* X circle */}
                <circle
                  cx="80"
                  cy="60"
                  r="24"
                  stroke="url(#redGradient)"
                  strokeWidth="2.5"
                  className="group-hover:stroke-[3] group-hover:scale-105 origin-center transition-all duration-300"
                />
                <path
                  d="M72 52 L88 68 M88 52 L72 68"
                  stroke="url(#redGradient)"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            {/* Text */}
            <div className="text-center md:text-right">
              <h3 className="text-3xl font-bold text-white mb-4">
                <span className="gradient-text">Tap.</span> One thumb. Done.
              </h3>
              <p className="text-gray-400 text-lg max-w-md md:ml-auto leading-relaxed">
                Approve. Deny. That&apos;s it. Your agent keeps coding while you keep living. Coffee
                won&apos;t even get cold.
              </p>
            </div>
          </div>
        </div>

        {/* Feature 3: Private */}
        <div className="group relative mb-24">
          <div className="flex flex-col md:flex-row items-center gap-12 md:gap-20">
            {/* Lock Icon */}
            <div className="relative w-40 h-40 flex-shrink-0">
              <svg viewBox="0 0 120 120" className="w-full h-full" fill="none">
                <defs>
                  <linearGradient id="lockGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#8B5CF6" />
                    <stop offset="100%" stopColor="#06B6D4" />
                  </linearGradient>
                </defs>
                {/* Lock shackle */}
                <path
                  d="M45 50 L45 38 C45 28 52 20 60 20 C68 20 75 28 75 38 L75 50"
                  stroke="url(#lockGradient)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  className="group-hover:stroke-[3] transition-all duration-300"
                />
                {/* Lock body */}
                <rect
                  x="35"
                  y="50"
                  width="50"
                  height="45"
                  rx="6"
                  stroke="url(#lockGradient)"
                  strokeWidth="2.5"
                  className="group-hover:stroke-[3] transition-all duration-300"
                />
                {/* Keyhole */}
                <circle cx="60" cy="68" r="5" stroke="url(#lockGradient)" strokeWidth="2" />
                <path
                  d="M60 73 L60 82"
                  stroke="url(#lockGradient)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                {/* Shield glow effect */}
                <circle
                  cx="60"
                  cy="60"
                  r="45"
                  stroke="url(#lockGradient)"
                  strokeWidth="1"
                  strokeOpacity="0"
                  className="group-hover:stroke-opacity-20 transition-all duration-500"
                  strokeDasharray="8 4"
                />
              </svg>
            </div>

            {/* Text */}
            <div className="text-center md:text-left">
              <h3 className="text-3xl font-bold text-white mb-4">
                <span className="gradient-text">Private.</span> Zero knowledge.
              </h3>
              <p className="text-gray-400 text-lg max-w-md leading-relaxed">
                We never see your code. Not a single line. Powered by Cloudflare Zero Trust. Your
                secrets stay yours.
              </p>
            </div>
          </div>
        </div>

        {/* Feature 4: Bridge */}
        <div className="group relative mb-24">
          <div className="flex flex-col md:flex-row-reverse items-center gap-12 md:gap-20">
            {/* Bridge/Connector Icon */}
            <div className="relative w-40 h-40 flex-shrink-0">
              <svg viewBox="0 0 120 120" className="w-full h-full" fill="none">
                <defs>
                  <linearGradient id="bridgeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#F59E0B" />
                    <stop offset="100%" stopColor="#EF4444" />
                  </linearGradient>
                </defs>
                {/* Left node (your agent) */}
                <circle
                  cx="25"
                  cy="60"
                  r="12"
                  stroke="url(#bridgeGradient)"
                  strokeWidth="2.5"
                  className="group-hover:stroke-[3] transition-all duration-300"
                />
                <circle
                  cx="25"
                  cy="60"
                  r="4"
                  fill="url(#bridgeGradient)"
                  className="group-hover:scale-125 origin-center transition-transform duration-300"
                />
                {/* Right node (mobile) */}
                <circle
                  cx="95"
                  cy="60"
                  r="12"
                  stroke="url(#bridgeGradient)"
                  strokeWidth="2.5"
                  className="group-hover:stroke-[3] transition-all duration-300"
                />
                <circle
                  cx="95"
                  cy="60"
                  r="4"
                  fill="url(#bridgeGradient)"
                  className="group-hover:scale-125 origin-center transition-transform duration-300"
                />
                {/* Bridge connection */}
                <path
                  d="M37 60 L83 60"
                  stroke="url(#bridgeGradient)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray="0"
                  className="group-hover:stroke-[3] transition-all duration-300"
                />
                {/* Data flow dots */}
                <circle
                  cx="50"
                  cy="60"
                  r="3"
                  fill="url(#bridgeGradient)"
                  className="opacity-40 group-hover:opacity-100 group-hover:animate-pulse transition-opacity duration-300"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="3"
                  fill="url(#bridgeGradient)"
                  className="opacity-60 group-hover:opacity-100 group-hover:animate-pulse transition-opacity duration-300"
                  style={{ animationDelay: '150ms' }}
                />
                <circle
                  cx="70"
                  cy="60"
                  r="3"
                  fill="url(#bridgeGradient)"
                  className="opacity-40 group-hover:opacity-100 group-hover:animate-pulse transition-opacity duration-300"
                  style={{ animationDelay: '300ms' }}
                />
                {/* Labels */}
                <text
                  x="25"
                  y="85"
                  textAnchor="middle"
                  className="fill-gray-500 text-[8px] font-medium"
                >
                  AGENT
                </text>
                <text
                  x="95"
                  y="85"
                  textAnchor="middle"
                  className="fill-gray-500 text-[8px] font-medium"
                >
                  YOU
                </text>
              </svg>
            </div>

            {/* Text */}
            <div className="text-center md:text-right">
              <h3 className="text-3xl font-bold text-white mb-4">
                <span className="gradient-text">Bridge.</span> Not another agent.
              </h3>
              <p className="text-gray-400 text-lg max-w-md md:ml-auto leading-relaxed">
                Works with Claude Code, Codex, OpenCode, and more. Your local agents stay local. We
                just connect you.
              </p>
            </div>
          </div>
        </div>

        {/* Feature 5: Open Source */}
        <div className="group relative">
          <div className="flex flex-col md:flex-row items-center gap-12 md:gap-20">
            {/* Open Source Icon */}
            <div className="relative w-40 h-40 flex-shrink-0">
              <svg viewBox="0 0 120 120" className="w-full h-full" fill="none">
                <defs>
                  <linearGradient id="ossGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#3B82F6" />
                  </linearGradient>
                </defs>
                {/* Code brackets */}
                <path
                  d="M45 40 L30 60 L45 80"
                  stroke="url(#ossGradient)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="group-hover:stroke-[3] transition-all duration-300"
                />
                <path
                  d="M75 40 L90 60 L75 80"
                  stroke="url(#ossGradient)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="group-hover:stroke-[3] transition-all duration-300"
                />
                {/* Slash */}
                <path
                  d="M65 35 L55 85"
                  stroke="url(#ossGradient)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  className="group-hover:stroke-[3] transition-all duration-300"
                />
              </svg>
            </div>

            {/* Text */}
            <div className="text-center md:text-left">
              <h3 className="text-3xl font-bold text-white mb-4">
                <span className="gradient-text">Open source.</span> Free forever.
              </h3>
              <p className="text-gray-400 text-lg max-w-md leading-relaxed">
                MIT licensed. Self-host it, fork it, improve it. Contribute with your adapters. No
                subscriptions. No catch.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
