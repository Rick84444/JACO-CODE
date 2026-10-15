// Marketplace catalogue only.
// Canonical executable skill definitions live in the JACO Skill Runtime.
// SKILLS remains as a compatibility alias for existing agent imports.
// Operator-specific values come from the environment so a copy of this code never points at someone else's
// workers or wallet. Empty means "not configured": payment and worker features stay off.
export const WORKER_BASE = process.env.JACO_WORKER_BASE || '';
export const HF_USER     = process.env.JACO_HF_USER || '';
export const HF_SPACE    = process.env.JACO_HF_SPACE || '';
export const RECEIVER    = process.env.JACO_PAYMENT_RECEIVER || '';

export const MARKETPLACE_CATALOG = [
  { name: 'AI Copywriter',           worker: 'a2a-copywriter',              price: 5,  category: 'writing'      },
  { name: 'SEO Optimizer',           worker: 'a2a-seo-optimizer',           price: 12, category: 'marketing'    },
  { name: 'Data Analyst',            worker: 'a2a-data-analyst',            price: 15, category: 'data'         },
  { name: 'Cybersecurity Auditor',   worker: 'a2a-cyber-auditor',           price: 18, category: 'security'     },
  { name: 'Code Reviewer',           worker: 'a2a-coding-reviewer',         price: 8,  category: 'development'  },
  { name: 'Smart Contract Auditor',  worker: 'a2a-smart-contract-auditor',  price: 20, category: 'blockchain'   },
  { name: 'Global Translator',       worker: 'a2a-global-translator',       price: 5,  category: 'writing'      },
  { name: 'Marketing Analyst',       worker: 'a2a-marketing-analyst',       price: 12, category: 'marketing'    },
  { name: 'Image Generator',         worker: 'a2a-image-generator',         price: 8,  category: 'creative'     },
  { name: 'Video Editor',            worker: 'a2a-video-editor',            price: 10, category: 'creative'     },
  { name: 'HTML Builder',            worker: 'a2a-premium-html-builder',    price: 8,  category: 'development'  },
  { name: 'Smart Calculator',        worker: 'a2a-smart-calculator',        price: 4,  category: 'utility'      },
];

export const SKILLS = MARKETPLACE_CATALOG;
