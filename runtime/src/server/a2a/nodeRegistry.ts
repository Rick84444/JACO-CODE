import fs from 'fs';
import path from 'path';
import { A2AAgentCard, A2APeerNode, A2ASkillCapability } from './a2aTypes';
import { listInstalledSkills } from './skillStore';

const PEERS_FILE = path.join(process.cwd(), '.jaco', 'a2a_peers.json');
const NODE_CONFIG_FILE = path.join(process.cwd(), '.jaco', 'node_identity.json');

const startTime = Date.now();

function ensureJacoDir() {
  const dir = path.join(process.cwd(), '.jaco');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getLocalNodeIdentity(): { nodeId: string; name: string } {
  ensureJacoDir();
  if (fs.existsSync(NODE_CONFIG_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(NODE_CONFIG_FILE, 'utf8'));
      if (data.nodeId) return data;
    } catch {}
  }

  const generatedId = `jaco-node-${Math.random().toString(36).substring(2, 10)}`;
  const ident = {
    nodeId: generatedId,
    name: 'JACO Autonomous Node',
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(NODE_CONFIG_FILE, JSON.stringify(ident, null, 2), 'utf8');
  return ident;
}

export function getLocalAgentCard(baseUrl: string): A2AAgentCard {
  const ident = getLocalNodeIdentity();
  const installed = listInstalledSkills();

  const builtInCapabilities: A2ASkillCapability[] = [
    {
      id: 'code-review-audit',
      name: 'Automated Code Audit',
      version: '1.0.0',
      description: 'Analyserar kodfiler för säkerhetsluckor, logiska fel och typ-defekter.',
      inputSchema: { code: 'string', language: 'string' },
      outputSchema: { issues: 'array', score: 'number' },
      pricePerCallCredits: 0,
      tags: ['security', 'audit', 'code'],
    },
    {
      id: 'adversarial-falsifier',
      name: 'Adversarial Decision Falsifier',
      version: '1.0.0',
      description: 'Stresstestar strategiska beslut genom motståndsresonemang (Explorer-Falsifier).',
      inputSchema: { proposal: 'string', context: 'string' },
      outputSchema: { survives: 'boolean', criticism: 'string' },
      pricePerCallCredits: 0,
      tags: ['planning', 'decision', 'reasoning'],
    },
  ];

  const dynamicCapabilities: A2ASkillCapability[] = installed
    .filter((s) => s.enabled)
    .map((s) => ({
      id: s.id,
      name: s.name,
      version: s.version,
      description: s.description,
      inputSchema: {},
      outputSchema: {},
      pricePerCallCredits: 0,
      tags: ['custom-skill'],
    }));

  return {
    protocolVersion: '1.0.0',
    nodeId: ident.nodeId,
    name: ident.name,
    description: 'JACO OS Autonomous Agent Node med självförbättrande slingor och A2A-protokoll.',
    endpointUrl: baseUrl,
    capabilities: [...builtInCapabilities, ...dynamicCapabilities],
    supportedProtocols: ['http-json-rpc'],
    status: 'online',
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
  };
}

export function listPeerNodes(): A2APeerNode[] {
  ensureJacoDir();
  if (fs.existsSync(PEERS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(PEERS_FILE, 'utf8'));
      if (Array.isArray(data)) return data;
    } catch {}
  }
  return [];
}

export function registerPeerNode(node: { nodeId: string; endpointUrl: string; name: string; capabilities?: A2ASkillCapability[] }): A2APeerNode {
  ensureJacoDir();
  const peers = listPeerNodes();
  const existingIdx = peers.findIndex((p) => p.nodeId === node.nodeId || p.endpointUrl === node.endpointUrl);

  const peerObj: A2APeerNode = {
    nodeId: node.nodeId,
    endpointUrl: node.endpointUrl,
    name: node.name,
    lastSeen: new Date().toISOString(),
    status: 'online',
    capabilities: node.capabilities || [],
  };

  if (existingIdx >= 0) {
    peers[existingIdx] = peerObj;
  } else {
    peers.push(peerObj);
  }

  fs.writeFileSync(PEERS_FILE, JSON.stringify(peers, null, 2), 'utf8');
  return peerObj;
}

export async function pingAndSyncPeer(endpointUrl: string): Promise<{ success: boolean; agentCard?: A2AAgentCard; error?: string }> {
  try {
    const cleanUrl = endpointUrl.replace(/\/$/, '');
    const cardUrl = `${cleanUrl}/.well-known/agent.json`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(cardUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return { success: false, error: `Noden svarade med HTTP ${res.status}` };
    }

    const card: A2AAgentCard = await res.json();
    if (!card.nodeId || !card.capabilities) {
      return { success: false, error: 'Ogiltigt AgentCard format.' };
    }

    registerPeerNode({
      nodeId: card.nodeId,
      endpointUrl: cleanUrl,
      name: card.name,
      capabilities: card.capabilities,
    });

    return { success: true, agentCard: card };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Kunde inte nå noden.' };
  }
}
