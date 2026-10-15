export class SkillTelemetry {
  constructor({ maxEvents = 500 } = {}) {
    this.maxEvents = Math.max(50, Number(maxEvents) || 500);
    this.events = [];
    this.active = new Map();
    this.listeners = new Set();
  }

  emit(type, data = {}) {
    const event = Object.freeze({
      id: 'skill-event-' + Date.now() + '-' + Math.random().toString(16).slice(2, 10),
      at: new Date().toISOString(),
      type,
      data,
    });
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    if (data.executionId) {
      if (['skill.completed', 'skill.failed'].includes(type)) this.active.delete(data.executionId);
      else this.active.set(data.executionId, { ...data, type, updatedAt: event.at });
    }
    for (const listener of this.listeners) {
      try { listener(event); } catch {}
    }
    return event;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new Error('SKILL_TELEMETRY_LISTENER_REQUIRED');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot({ limit = 80 } = {}) {
    return {
      schema: 'jaco.skill-machine.snapshot/v1',
      observedAt: new Date().toISOString(),
      active: [...this.active.values()],
      recentEvents: this.events.slice(-Math.max(1, Math.min(Number(limit) || 80, 500))),
    };
  }
}
