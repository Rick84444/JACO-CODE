import React, { useState, useEffect } from 'react';
import { ShoppingCart, Zap, Lock, ExternalLink } from 'lucide-react';

interface PaymentLink {
  skillId: string;
  skillName: string;
  price: string;
  paymentLink?: string;
  description: string;
  benefits: string[];
}

const CATALOG: PaymentLink[] = [
  {
    skillId: 'a2a-smart-contract-auditor',
    skillName: 'Smart Contract Security Auditor',
    price: '200 SEK',
    description: 'Professional security auditing for smart contracts on Base, Ethereum, and Polygon.',
    benefits: ['Vulnerability scanning', 'Gas optimization', 'Best practices review', 'Live report']
  },
  {
    skillId: 'a2a-cyber-auditor',
    skillName: 'Cybersecurity Auditor',
    price: '150 SEK',
    description: 'Automated security assessment of web applications and infrastructure.',
    benefits: ['OWASP Top 10 check', 'SSL/TLS audit', 'API security review', 'Compliance report']
  },
  {
    skillId: 'a2a-data-analyst',
    skillName: 'Data Analysis & Insights Agent',
    price: '120 SEK',
    description: 'Transform raw data into actionable insights with AI-driven analytics.',
    benefits: ['Statistical analysis', 'Trend forecasting', 'Anomaly detection', 'Visual dashboards']
  }
];

// Stripe payment links are operator configuration, never source. VITE_JACO_PAYMENT_LINKS is a JSON object
// {"<skillId>": "https://buy.stripe.com/..."}; an entry that is missing or not a Stripe link leaves that
// product without a checkout button.
function configuredLinks(): Record<string, string> {
  try {
    const raw = (import.meta as any).env?.VITE_JACO_PAYMENT_LINKS;
    const parsed = raw ? JSON.parse(String(raw)) : {};
    return Object.fromEntries(Object.entries(parsed).filter(([, url]) => typeof url === 'string' && /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_-]+$/.test(url))) as Record<string, string>;
  } catch { return {}; }
}
const PAYMENT_LINKS = configuredLinks();
const ACTIVE_PAYMENT_LINKS = CATALOG.map(item => ({ ...item, paymentLink: PAYMENT_LINKS[item.skillId] || '' }));

export function QuickCheckout() {
  const [selectedLink, setSelectedLink] = useState<PaymentLink | null>(null);
  const [clickedLinks, setClickedLinks] = useState<Set<string>>(new Set());

  const handleCheckoutClick = (link: PaymentLink) => {
    if (!link.paymentLink) return;
    setClickedLinks(prev => new Set(prev).add(link.skillId));
    window.open(link.paymentLink, '_blank', 'noopener');
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-6">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <ShoppingCart className="w-8 h-8 text-emerald-600" />
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Premium AI Skills</h2>
        </div>
        <p className="text-gray-600 dark:text-gray-300">
          Pay-per-use AI agents powered by JACO. Stripe checkout. Instant delivery.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {ACTIVE_PAYMENT_LINKS.map((link) => (
          <div
            key={link.skillId}
            className="relative bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden hover:shadow-lg transition-shadow"
          >
            {/* Click counter badge */}
            {clickedLinks.has(link.skillId) && (
              <div className="absolute top-2 right-2 bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-100 text-xs font-bold px-2 py-1 rounded">
                Checkout opened
              </div>
            )}

            <div className="p-6">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                {link.skillName}
              </h3>
              <p className="text-gray-600 dark:text-gray-300 text-sm mb-4">
                {link.description}
              </p>

              <div className="mb-4">
                <div className="text-3xl font-bold text-emerald-600 mb-1">
                  {link.price}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  One-time payment • Stripe secure checkout
                </p>
              </div>

              {/* Benefits list */}
              <ul className="space-y-2 mb-6">
                {link.benefits.map((benefit, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <Zap className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                    {benefit}
                  </li>
                ))}
              </ul>

              {/* Checkout button */}
              <button
                onClick={() => handleCheckoutClick(link)}
                disabled={!link.paymentLink}
                className="w-full disabled:opacity-50 disabled:cursor-not-allowed bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 group"
              >
                <ShoppingCart className="w-5 h-5" />
                {link.paymentLink ? 'Checkout Now' : 'Betalningslänk ej konfigurerad'}
                <ExternalLink className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>

              <div className="mt-4 flex items-center gap-2 justify-center text-xs text-gray-500 dark:text-gray-400">
                <Lock className="w-3 h-3" />
                Secured by Stripe
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Conversion tracking */}
      <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
        <p className="text-sm text-blue-900 dark:text-blue-100">
          <strong>Betalningslänkar:</strong> {ACTIVE_PAYMENT_LINKS.filter(l => l.paymentLink).length} av {ACTIVE_PAYMENT_LINKS.length} konfigurerade (VITE_JACO_PAYMENT_LINKS). Klick på checkout visar bara att sidan öppnades, inte en betalning.
          {clickedLinks.size > 0 && ` ${clickedLinks.size} checkout(s) initiated.`}
        </p>
      </div>
    </div>
  );
}
