import React, { useState, useEffect } from 'react';
import { ShoppingCart, Zap, Lock, ExternalLink } from 'lucide-react';

interface PaymentLink {
  skillId: string;
  skillName: string;
  price: string;
  paymentLink: string;
  description: string;
  benefits: string[];
}

const ACTIVE_PAYMENT_LINKS: PaymentLink[] = [
  {
    skillId: 'a2a-smart-contract-auditor',
    skillName: 'Smart Contract Security Auditor',
    price: '200 SEK',
    paymentLink: 'https://buy.stripe.com/5kQ4gAdt37cs95R1LK7ZB0F',
    description: 'Professional security auditing for smart contracts on Base, Ethereum, and Polygon.',
    benefits: ['Vulnerability scanning', 'Gas optimization', 'Best practices review', 'Live report']
  },
  {
    skillId: 'a2a-cyber-auditor',
    skillName: 'Cybersecurity Auditor',
    price: '150 SEK',
    paymentLink: 'https://buy.stripe.com/3cI9AUdt37csfufdus7ZB0G',
    description: 'Automated security assessment of web applications and infrastructure.',
    benefits: ['OWASP Top 10 check', 'SSL/TLS audit', 'API security review', 'Compliance report']
  },
  {
    skillId: 'a2a-data-analyst',
    skillName: 'Data Analysis & Insights Agent',
    price: '120 SEK',
    paymentLink: 'https://buy.stripe.com/cNicN63StbsIa9Vaig7ZB0H',
    description: 'Transform raw data into actionable insights with AI-driven analytics.',
    benefits: ['Statistical analysis', 'Trend forecasting', 'Anomaly detection', 'Visual dashboards']
  }
];

export function QuickCheckout() {
  const [selectedLink, setSelectedLink] = useState<PaymentLink | null>(null);
  const [clickedLinks, setClickedLinks] = useState<Set<string>>(new Set());

  const handleCheckoutClick = (link: PaymentLink) => {
    setClickedLinks(prev => new Set(prev).add(link.skillId));
    window.open(link.paymentLink, '_blank');
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
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 group"
              >
                <ShoppingCart className="w-5 h-5" />
                Checkout Now
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
          <strong>Revenue Status:</strong> Payment links live & tracking checkout opens.
          {clickedLinks.size > 0 && ` ${clickedLinks.size} checkout(s) initiated.`}
        </p>
      </div>
    </div>
  );
}
