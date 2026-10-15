import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * A2A node identity.
 *
 * Replaces the archived prototype's `Math.random()` node id with a persistent
 * Ed25519 key pair. The node id is derived from the public key, so a peer can
 * verify that the id, the card and the signature belong together instead of
 * trusting a self-declared string.
 *
 * Evidence discipline: nothing here claims a peer is verified. A card is signed
 * by this node only; `verifiedPeerStatus` stays false until a peer signature has
 * actually been checked by verifyDetached().
 */

export interface NodeIdentity {
  nodeId: string;
  name: string;
  publicKeyPem: string;
  publicKeyFingerprint: string;
  createdAt: string;
  keyAlgorithm: 'ed25519';
}

interface StoredIdentity extends NodeIdentity {
  privateKeyPem: string;
}

const IDENTITY_FILENAME = 'node_identity.json';

function identityPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.jaco', IDENTITY_FILENAME);
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function fingerprint(publicKeyPem: string): string {
  return crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 32);
}

function generate(name: string): StoredIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const fp = fingerprint(publicKeyPem);
  return {
    nodeId: `jaco-${fp.slice(0, 20)}`,
    name,
    publicKeyPem,
    publicKeyFingerprint: fp,
    createdAt: new Date().toISOString(),
    keyAlgorithm: 'ed25519',
    privateKeyPem,
  };
}

function isStored(value: unknown): value is StoredIdentity {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.nodeId === 'string' &&
    typeof candidate.publicKeyPem === 'string' &&
    typeof candidate.privateKeyPem === 'string' &&
    candidate.publicKeyPem.includes('BEGIN PUBLIC KEY') &&
    candidate.privateKeyPem.includes('BEGIN PRIVATE KEY')
  );
}

export class A2AIdentityStore {
  private cached: StoredIdentity | null = null;

  constructor(private readonly workspaceRoot: string, private readonly nodeName = 'JACO Cognitive IDE') {}

  /** Loads the persisted identity, creating one on first call. Private key never leaves this module. */
  private load(): StoredIdentity {
    if (this.cached) return this.cached;
    const file = identityPath(this.workspaceRoot);

    if (fs.existsSync(file)) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (isStored(parsed)) {
          // Re-derive the id so a hand-edited file cannot claim another node's id.
          const fp = fingerprint(parsed.publicKeyPem);
          this.cached = { ...parsed, publicKeyFingerprint: fp, nodeId: `jaco-${fp.slice(0, 20)}` };
          return this.cached;
        }
      } catch {
        /* fall through to regeneration */
      }
      // Corrupt or legacy (pre-Ed25519) identity: keep the old file as evidence, do not silently delete.
      try {
        fs.renameSync(file, `${file}.superseded-${Date.now()}`);
      } catch {
        /* non-fatal */
      }
    }

    const created = generate(this.nodeName);
    ensureDir(file);
    fs.writeFileSync(file, JSON.stringify(created, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* Windows and some mounts do not support chmod */
    }
    this.cached = created;
    return created;
  }

  /** Public identity. Safe to return over HTTP. */
  public get(): NodeIdentity {
    const { privateKeyPem: _ignored, ...pub } = this.load();
    return pub;
  }

  /** Detached Ed25519 signature over the canonical JSON of `payload`. */
  public signDetached(payload: unknown): { signature: string; algorithm: 'ed25519'; signedAt: string } {
    const identity = this.load();
    const key = crypto.createPrivateKey(identity.privateKeyPem);
    const message = Buffer.from(canonicalJson(payload), 'utf8');
    return {
      signature: crypto.sign(null, message, key).toString('base64'),
      algorithm: 'ed25519',
      signedAt: new Date().toISOString(),
    };
  }

  /** Verifies a peer's detached signature. Returns false on any malformed input. */
  public static verifyDetached(payload: unknown, signatureBase64: string, publicKeyPem: string): boolean {
    try {
      if (!signatureBase64 || !publicKeyPem.includes('BEGIN PUBLIC KEY')) return false;
      const key = crypto.createPublicKey(publicKeyPem);
      const message = Buffer.from(canonicalJson(payload), 'utf8');
      return crypto.verify(null, message, key, Buffer.from(signatureBase64, 'base64'));
    } catch {
      return false;
    }
  }

  /** True when the claimed node id actually derives from the presented public key. */
  public static nodeIdMatchesKey(nodeId: string, publicKeyPem: string): boolean {
    try {
      return nodeId === `jaco-${fingerprint(publicKeyPem).slice(0, 20)}`;
    } catch {
      return false;
    }
  }
}

/** Deterministic JSON so both sides sign byte-identical material. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
