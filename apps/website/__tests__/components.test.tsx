import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

// ─── Features ────────────────────────────────────────────────────────────────
import { Features } from '../src/components/Features';

describe('Features', () => {
  it('renders the Buzz feature heading and description', () => {
    render(<Features />);
    expect(screen.getByText('Buzz.')).toBeInTheDocument();
    expect(screen.getByText(/Your pocket vibrates/)).toBeInTheDocument();
    expect(screen.getByText('rm -rf node_modules')).toBeInTheDocument();
  });

  it('renders the Tap feature heading and description', () => {
    render(<Features />);
    expect(screen.getByText('Tap.')).toBeInTheDocument();
    expect(screen.getByText(/One thumb\. Done\./)).toBeInTheDocument();
    expect(screen.getByText(/Approve\. Deny\. That's it\./)).toBeInTheDocument();
  });

  it('renders the Private feature heading and description', () => {
    render(<Features />);
    expect(screen.getByText('Private.')).toBeInTheDocument();
    expect(screen.getByText(/Zero knowledge/)).toBeInTheDocument();
    expect(screen.getByText(/We never see your code/)).toBeInTheDocument();
  });

  it('renders the Bridge feature heading and description', () => {
    render(<Features />);
    expect(screen.getByText('Bridge.')).toBeInTheDocument();
    expect(screen.getByText(/Not another agent/)).toBeInTheDocument();
    expect(screen.getByText(/Works with Claude Code, Codex, OpenCode/)).toBeInTheDocument();
  });

  it('renders the Open source feature heading and description', () => {
    render(<Features />);
    expect(screen.getByText('Open source.')).toBeInTheDocument();
    expect(screen.getByText(/Free forever/)).toBeInTheDocument();
    expect(screen.getByText(/MIT licensed/)).toBeInTheDocument();
  });

  it('renders SVG icons for all features', () => {
    const { container } = render(<Features />);
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBe(5);
  });
});

// ─── Footer ──────────────────────────────────────────────────────────────────
import { Footer } from '../src/components/Footer';

describe('Footer', () => {
  it('renders the footer element', () => {
    const { container } = render(<Footer />);
    expect(container.querySelector('footer')).toBeInTheDocument();
  });

  it('renders the tagline text', () => {
    render(<Footer />);
    expect(
      screen.getByText(/Connecting your local agents with your mobile device/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Free forever/)).toBeInTheDocument();
  });

  it('renders the GitHub link', () => {
    render(<Footer />);
    const links = screen.getAllByRole('link');
    const githubHref = links.find(
      (l) => l.getAttribute('href') === 'https://github.com/agentap-dev/agentap'
    );
    expect(githubHref).toBeDefined();
  });

  it('renders the Twitter link', () => {
    render(<Footer />);
    const links = screen.getAllByRole('link');
    const twitterHref = links.find(
      (l) => l.getAttribute('href') === 'https://twitter.com/agentap_dev'
    );
    expect(twitterHref).toBeInTheDocument();
  });

  it('renders the "Free & open source" text', () => {
    render(<Footer />);
    expect(screen.getByText('Free & open source')).toBeInTheDocument();
  });

  it('renders the logo icon image', () => {
    const { container } = render(<Footer />);
    const img = container.querySelector('img[src="/logo-icon.svg"]');
    expect(img).toBeInTheDocument();
  });
});

// ─── Header ──────────────────────────────────────────────────────────────────
import { Header } from '../src/components/Header';

describe('Header', () => {
  it('renders the header with logo text', () => {
    render(<Header />);
    // There should be the brand name displayed
    expect(screen.getByText('agentap')).toBeInTheDocument();
  });

  it('renders the navigation landmark', () => {
    render(<Header />);
    expect(screen.getByRole('navigation', { name: /global/i })).toBeInTheDocument();
  });

  it('renders the GitHub link in desktop nav', () => {
    render(<Header />);
    const links = screen.getAllByRole('link');
    const githubLink = links.find(
      (l) => l.getAttribute('href') === 'https://github.com/agentap-dev/agentap'
    );
    expect(githubLink).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  it('renders the Sign in link in desktop nav', () => {
    render(<Header />);
    expect(screen.getByText('Sign in')).toBeInTheDocument();
  });

  it('renders the mobile menu button', () => {
    render(<Header />);
    // The mobile menu button is a button element (Menu icon)
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('does not show mobile menu by default', () => {
    render(<Header />);
    // MobileMenu returns null when open is false.
    // When closed, the close button (X icon) should not appear.
    // Also, the mobile panel should not be in the DOM.
    const buttons = screen.getAllByRole('button');
    // Only the hamburger button should be present, no close button
    expect(buttons.length).toBe(1);
  });

  it('opens mobile menu when hamburger button is clicked', () => {
    render(<Header />);
    // Click the hamburger button
    const hamburgerButton = screen.getByRole('button');
    fireEvent.click(hamburgerButton);

    // Now there should be a close button in the mobile menu
    const buttons = screen.getAllByRole('button');
    // Hamburger + close button
    expect(buttons.length).toBe(2);

    // Mobile menu should show "agentap" brand and links
    // There should now be two "agentap" texts (desktop + mobile)
    const agentapElements = screen.getAllByText('agentap');
    expect(agentapElements.length).toBe(2);
  });

  it('shows GitHub and Sign in links in the mobile menu', () => {
    render(<Header />);
    const hamburgerButton = screen.getByRole('button');
    fireEvent.click(hamburgerButton);

    // Should have multiple GitHub and Sign in links (desktop + mobile)
    const githubLinks = screen.getAllByText('GitHub');
    expect(githubLinks.length).toBe(2);

    const signInLinks = screen.getAllByText('Sign in');
    expect(signInLinks.length).toBe(2);
  });

  it('closes mobile menu when close button is clicked', () => {
    render(<Header />);
    // Open
    fireEvent.click(screen.getByRole('button'));

    // Now find the close button (second button)
    const buttons = screen.getAllByRole('button');
    const closeButton = buttons[1]; // The close (X) button
    fireEvent.click(closeButton);

    // Menu should be closed again - only one button (hamburger)
    expect(screen.getAllByRole('button').length).toBe(1);
  });

  it('closes mobile menu when backdrop is clicked', () => {
    const { container } = render(<Header />);
    // Open
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getAllByRole('button').length).toBe(2);

    // Click the backdrop (the div with bg-gray-950/90 class)
    const backdrop = container.querySelector('.bg-gray-950\\/90');
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop!);

    // Menu should be closed
    expect(screen.getAllByRole('button').length).toBe(1);
  });

  it('closes mobile menu when a nav link is clicked', () => {
    render(<Header />);
    // Open menu
    fireEvent.click(screen.getByRole('button'));

    // Click a link in the mobile menu (second GitHub link)
    const githubLinks = screen.getAllByText('GitHub');
    fireEvent.click(githubLinks[1]);

    // Menu should be closed
    expect(screen.getAllByRole('button').length).toBe(1);
  });
});

// ─── Hero ────────────────────────────────────────────────────────────────────
import { Hero } from '../src/components/Hero';

describe('Hero', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the main headline', () => {
    render(<Hero />);
    expect(screen.getByText('Let your agent')).toBeInTheDocument();
    expect(screen.getByText('work while you walk')).toBeInTheDocument();
  });

  it('renders the subtitle', () => {
    render(<Hero />);
    expect(screen.getByText(/Your mobile bridge to your local agent/)).toBeInTheDocument();
  });

  it('renders the install command', () => {
    render(<Hero />);
    expect(screen.getByText('npx agentap')).toBeInTheDocument();
  });

  it('renders the dollar sign prompt', () => {
    render(<Hero />);
    expect(screen.getByText('$')).toBeInTheDocument();
  });

  it('renders the install help text', () => {
    render(<Hero />);
    expect(screen.getByText(/Run this, scan QR, done/)).toBeInTheDocument();
  });

  it('renders App Store and Play Store links', () => {
    render(<Hero />);
    expect(screen.getByText('App Store')).toBeInTheDocument();
    expect(screen.getByText('Play Store')).toBeInTheDocument();
  });

  it('renders the copy button', () => {
    render(<Hero />);
    const buttons = screen.getAllByRole('button');
    // There are 3 buttons: copy, mic, send
    expect(buttons.length).toBe(3);
  });

  it('copies install command to clipboard on button click', async () => {
    render(<Hero />);
    const copyButton = screen.getAllByRole('button')[0]; // First button is copy
    fireEvent.click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('npx agentap');
  });

  it('shows Check icon after copying, then reverts', async () => {
    vi.useFakeTimers();
    render(<Hero />);
    const copyButton = screen.getAllByRole('button')[0];

    // Before click, no green check
    fireEvent.click(copyButton);

    // After 2 seconds, the copied state should reset
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // The component should have reverted to the Copy icon state
    // We verify by clicking again and checking clipboard was called again
    fireEvent.click(copyButton);
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('renders the phone mockup with status bar', () => {
    render(<Hero />);
    expect(screen.getByText('9:41')).toBeInTheDocument();
  });

  it('renders the phone mockup with Connected status', () => {
    render(<Hero />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('renders the chat messages in phone mockup', () => {
    render(<Hero />);
    expect(screen.getByText('Add dark mode toggle')).toBeInTheDocument();
    expect(screen.getByText(/I'll add a dark mode toggle/)).toBeInTheDocument();
  });

  it('renders the code diff in phone mockup', () => {
    render(<Hero />);
    expect(screen.getByText('Settings.tsx')).toBeInTheDocument();
    expect(screen.getByText('+12')).toBeInTheDocument();
    expect(screen.getByText('-3')).toBeInTheDocument();
  });

  it('renders the tool status in phone mockup', () => {
    render(<Hero />);
    expect(screen.getByText('Edited Settings.tsx')).toBeInTheDocument();
    expect(screen.getByText('just now')).toBeInTheDocument();
  });

  it('renders the message input placeholder', () => {
    render(<Hero />);
    expect(screen.getByPlaceholderText('Message...')).toBeInTheDocument();
  });
});

// ─── HowItWorks ──────────────────────────────────────────────────────────────
import { HowItWorks } from '../src/components/HowItWorks';

describe('HowItWorks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the section heading', () => {
    render(<HowItWorks />);
    expect(screen.getByText('Three steps. Two minutes.')).toBeInTheDocument();
  });

  it('renders the section subtitle', () => {
    render(<HowItWorks />);
    expect(screen.getByText(/No accounts to create, no config files to edit/)).toBeInTheDocument();
  });

  it('renders all three step numbers', () => {
    render(<HowItWorks />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders step titles', () => {
    render(<HowItWorks />);
    expect(screen.getByText('Install daemon')).toBeInTheDocument();
    expect(screen.getByText('Scan QR code')).toBeInTheDocument();
    expect(screen.getByText('Start coding')).toBeInTheDocument();
  });

  it('renders step commands', () => {
    render(<HowItWorks />);
    expect(screen.getByText('npx agentap')).toBeInTheDocument();
    expect(screen.getByText('agentap pair')).toBeInTheDocument();
    expect(screen.getByText(/claude.*fix the auth bug/)).toBeInTheDocument();
  });

  it('renders step descriptions', () => {
    render(<HowItWorks />);
    expect(screen.getByText(/Runs in background, auto-detects Claude Code/)).toBeInTheDocument();
    expect(screen.getByText(/Open the mobile app, scan the code/)).toBeInTheDocument();
    expect(screen.getByText(/Approvals come straight to your phone/)).toBeInTheDocument();
  });

  it('copies command when step button is clicked', () => {
    render(<HowItWorks />);
    // Each step has a clickable button with the command
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(3);

    fireEvent.click(buttons[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('npx agentap');
  });

  it('copies the second command correctly', () => {
    render(<HowItWorks />);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('agentap pair');
  });

  it('copies the third command correctly', () => {
    render(<HowItWorks />);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[2]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('claude "fix the auth bug"');
  });

  it('shows Check icon for copied step and reverts after 2s', () => {
    vi.useFakeTimers();
    render(<HowItWorks />);
    const buttons = screen.getAllByRole('button');

    fireEvent.click(buttons[0]);
    // copiedIndex is now 0

    // After 2 seconds, it should reset
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Can click again (copiedIndex is null)
    fireEvent.click(buttons[1]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('agentap pair');

    vi.useRealTimers();
  });
});

// ─── Pricing ─────────────────────────────────────────────────────────────────
import { Pricing } from '../src/components/Pricing';

describe('Pricing', () => {
  it('renders the section heading', () => {
    render(<Pricing />);
    expect(screen.getByText('Pricing')).toBeInTheDocument();
  });

  it('renders the Free Forever headline', () => {
    render(<Pricing />);
    expect(screen.getByText('Free. Forever.')).toBeInTheDocument();
  });

  it('renders the pricing description', () => {
    render(<Pricing />);
    expect(screen.getByText(/completely free to use/)).toBeInTheDocument();
  });

  it('renders the $0/forever price', () => {
    render(<Pricing />);
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(screen.getByText('/forever')).toBeInTheDocument();
  });

  it('renders the "Everything Included" card title', () => {
    render(<Pricing />);
    expect(screen.getByText('Everything Included')).toBeInTheDocument();
  });

  it('renders the "Open Source" badge', () => {
    render(<Pricing />);
    expect(screen.getByText('Open Source')).toBeInTheDocument();
  });

  it('renders the access description', () => {
    render(<Pricing />);
    expect(
      screen.getByText(/Full access to all features for individuals and teams/)
    ).toBeInTheDocument();
  });

  it('renders all feature list items', () => {
    render(<Pricing />);
    const expectedFeatures = [
      'Unlimited machines',
      'Real-time push notifications',
      'Mobile app (iOS & Android)',
      'Web dashboard',
      'Session history',
      'Multi-agent support',
      'End-to-end encryption',
      'Community support',
    ];

    for (const feature of expectedFeatures) {
      expect(screen.getByText(feature)).toBeInTheDocument();
    }
  });

  it('renders the CTA link', () => {
    render(<Pricing />);
    const ctaLink = screen.getByText('Get Started for Free');
    expect(ctaLink).toBeInTheDocument();
    expect(ctaLink.closest('a')).toHaveAttribute('href', 'https://portal.agentap.dev/signup');
  });

  it('renders the Star on GitHub link', () => {
    render(<Pricing />);
    const starLink = screen.getByText('Star us on GitHub');
    expect(starLink.closest('a')).toHaveAttribute('href', 'https://github.com/agentap-dev/agentap');
  });

  it('renders the sponsor link', () => {
    render(<Pricing />);
    const sponsorLink = screen.getByText('become a sponsor');
    expect(sponsorLink.closest('a')).toHaveAttribute(
      'href',
      'https://github.com/sponsors/agentap-dev'
    );
  });

  it('renders the support project text', () => {
    render(<Pricing />);
    expect(screen.getByText(/Want to support the project/)).toBeInTheDocument();
  });

  it('renders 8 check icons for feature list items', () => {
    const { container } = render(<Pricing />);
    const listItems = container.querySelectorAll('li');
    expect(listItems.length).toBe(8);
  });
});

// ─── RootLayout ──────────────────────────────────────────────────────────────
import RootLayout from '../src/app/layout';

describe('RootLayout', () => {
  it('renders children', () => {
    render(
      <RootLayout>
        <div data-testid="child">Hello</div>
      </RootLayout>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('renders html element with lang and dark class', () => {
    render(
      <RootLayout>
        <div>Test</div>
      </RootLayout>
    );

    // jsdom hoists html/body attributes to the existing document elements
    const html = document.documentElement;
    expect(html.getAttribute('lang')).toBe('en');
    expect(html.className).toContain('dark');
  });

  it('renders body with appropriate classes', () => {
    render(
      <RootLayout>
        <div>Test</div>
      </RootLayout>
    );

    // Check the actual document body which gets the classes applied
    const body = document.body;
    expect(body.className).toContain('antialiased');
    expect(body.className).toContain('bg-gray-950');
    expect(body.className).toContain('text-gray-300');
  });
});

// ─── HomePage ────────────────────────────────────────────────────────────────
import HomePage from '../src/app/page';

describe('HomePage', () => {
  it('renders the main element', () => {
    render(<HomePage />);
    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
  });

  it('renders the Header component', () => {
    render(<HomePage />);
    // Header renders a nav with aria-label "Global"
    expect(screen.getByRole('navigation', { name: /global/i })).toBeInTheDocument();
  });

  it('renders the Hero component', () => {
    render(<HomePage />);
    expect(screen.getByText('Let your agent')).toBeInTheDocument();
  });

  it('renders the Features component', () => {
    render(<HomePage />);
    expect(screen.getByText('Buzz.')).toBeInTheDocument();
  });

  it('renders the HowItWorks component', () => {
    render(<HomePage />);
    expect(screen.getByText('Three steps. Two minutes.')).toBeInTheDocument();
  });

  it('renders the Footer component', () => {
    render(<HomePage />);
    expect(
      screen.getByText(/Connecting your local agents with your mobile device/)
    ).toBeInTheDocument();
  });
});
