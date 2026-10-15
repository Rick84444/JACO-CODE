import crypto from 'node:crypto';

export type ActuatorSurface = 'BROWSER' | 'DESKTOP' | 'ANDROID';

export interface ActuatorLease {
  leaseId: string;
  surface: ActuatorSurface;
  holder: string;
  missionId: string | null;
  acquiredAt: string;
  expiresAt: string;
}

export class ActuatorLeaseManager {
  private readonly leases = new Map<ActuatorSurface, ActuatorLease>();

  get(surface: ActuatorSurface): ActuatorLease | null {
    const lease = this.leases.get(surface) || null;
    if (lease && Date.parse(lease.expiresAt) <= Date.now()) {
      this.leases.delete(surface);
      return null;
    }
    return lease;
  }

  acquire(surface: ActuatorSurface, holder: string, missionId: string | null = null, ttlMs = 30_000): ActuatorLease {
    const owner = String(holder || '').trim();
    if (!owner) throw new Error('lease holder is required');
    const current = this.get(surface);
    if (current && current.holder !== owner) {
      throw new Error(`${surface} actuator is leased by '${current.holder}' until ${current.expiresAt}`);
    }
    const now = Date.now();
    const lease: ActuatorLease = {
      leaseId: current?.leaseId || crypto.randomUUID(),
      surface,
      holder: owner,
      missionId,
      acquiredAt: current?.acquiredAt || new Date(now).toISOString(),
      expiresAt: new Date(now + Math.max(5_000, Math.min(ttlMs, 120_000))).toISOString(),
    };
    this.leases.set(surface, lease);
    return lease;
  }

  release(surface: ActuatorSurface, holder: string): boolean {
    const current = this.get(surface);
    if (!current) return true;
    if (current.holder !== holder) return false;
    this.leases.delete(surface);
    return true;
  }

  snapshot(): Record<ActuatorSurface, ActuatorLease | null> {
    return { BROWSER: this.get('BROWSER'), DESKTOP: this.get('DESKTOP'), ANDROID: this.get('ANDROID') };
  }
}

export const actuatorLeases = new ActuatorLeaseManager();
