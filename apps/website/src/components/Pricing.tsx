import Link from 'next/link';
import { Check, Heart } from 'lucide-react';

const features = [
  'Unlimited machines',
  'Real-time push notifications',
  'Mobile app (iOS & Android)',
  'Web dashboard',
  'Session history',
  'Multi-agent support',
  'End-to-end encryption',
  'Community support',
];

export function Pricing() {
  return (
    <section id="pricing" className="py-24 bg-gray-50">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-base font-semibold leading-7 text-brand-600">Pricing</h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Free. Forever.
          </p>
          <p className="mt-6 text-lg leading-8 text-gray-600">
            Agentap is completely free to use. No credit card required, no hidden fees, no premium
            tiers. We believe everyone should have mobile access to their AI coding agents.
          </p>
        </div>

        <div className="mx-auto mt-16 max-w-lg">
          <div className="rounded-2xl bg-white p-8 shadow-2xl ring-2 ring-brand-600">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold leading-8 text-gray-900">Everything Included</h3>
              <div className="flex items-center gap-1 text-brand-600">
                <Heart className="h-5 w-5 fill-current" />
                <span className="text-sm font-medium">Open Source</span>
              </div>
            </div>

            <p className="mt-4 flex items-baseline gap-x-2">
              <span className="text-5xl font-bold tracking-tight text-gray-900">$0</span>
              <span className="text-base font-semibold leading-7 text-gray-600">/forever</span>
            </p>

            <p className="mt-4 text-sm leading-6 text-gray-600">
              Full access to all features for individuals and teams.
            </p>

            <ul className="mt-8 space-y-3 text-sm leading-6 text-gray-600">
              {features.map((feature) => (
                <li key={feature} className="flex gap-x-3">
                  <Check className="h-5 w-5 flex-shrink-0 text-brand-600" aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>

            <Link
              href="https://portal.agentap.dev/signup"
              className="mt-8 block rounded-lg bg-brand-600 px-3.5 py-3 text-center text-sm font-semibold text-white shadow-sm hover:bg-brand-500 transition-colors"
            >
              Get Started for Free
            </Link>
          </div>
        </div>

        <div className="mt-12 text-center">
          <p className="text-sm text-gray-500">
            Want to support the project?{' '}
            <Link
              href="https://github.com/agentap-dev/agentap"
              className="font-medium text-brand-600 hover:text-brand-500"
            >
              Star us on GitHub
            </Link>{' '}
            or{' '}
            <Link
              href="https://github.com/sponsors/agentap-dev"
              className="font-medium text-brand-600 hover:text-brand-500"
            >
              become a sponsor
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
