import crypto from 'node:crypto';
const sha = value => crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
const strip = value => String(value || '').replace(/\/+$/, '');

export class WordPressService {
  constructor({ env = process.env, providers } = {}) { this.env = env; this.providers = providers; }
  config() {
    const baseUrl = strip(this.env.WORDPRESS_BASE_URL || '');
    const username = this.env.WORDPRESS_USERNAME || '';
    const password = this.env.WORDPRESS_APP_PASSWORD || '';
    return { baseUrl, configured: Boolean(baseUrl && username && password), usernameConfigured: Boolean(username), applicationPasswordConfigured: Boolean(password) };
  }
  authHeaders() {
    const { baseUrl } = this.config();
    const username = this.env.WORDPRESS_USERNAME || ''; const password = this.env.WORDPRESS_APP_PASSWORD || '';
    if (!baseUrl || !username || !password) throw new Error('WORDPRESS_NOT_CONFIGURED');
    return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`, accept: 'application/json', 'content-type': 'application/json' };
  }
  async request(path, options = {}) {
    const cfg = this.config(); if (!cfg.baseUrl) throw new Error('WORDPRESS_BASE_URL_REQUIRED');
    const res = await fetch(`${cfg.baseUrl}${path}`, { ...options, headers: { ...this.authHeaders(), ...(options.headers || {}) }, signal: options.signal || AbortSignal.timeout(20_000) });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new Error(`WORDPRESS_HTTP_${res.status}: ${String(text).slice(0, 400)}`);
    return { status: res.status, data, responseHash: sha(text) };
  }
  async listPages({ search = '', perPage = 20 } = {}) {
    const q = new URLSearchParams({ context: 'edit', per_page: String(Math.max(1, Math.min(100, perPage))) });
    if (search) q.set('search', String(search));
    const r = await this.request(`/wp-json/wp/v2/pages?${q}`);
    return { pages: Array.isArray(r.data) ? r.data.map(p => ({ id: p.id, slug: p.slug, link: p.link, status: p.status, title: p.title?.raw ?? p.title?.rendered ?? '', content: p.content?.raw ?? p.content?.rendered ?? '', modified: p.modified_gmt || p.modified })) : [], receipt: { status: r.status, responseHash: r.responseHash } };
  }
  async getPage(pageId) {
    const r = await this.request(`/wp-json/wp/v2/pages/${encodeURIComponent(pageId)}?context=edit`);
    const p = r.data;
    return { id: p.id, slug: p.slug, link: p.link, status: p.status, title: p.title?.raw ?? p.title?.rendered ?? '', content: p.content?.raw ?? p.content?.rendered ?? '', modified: p.modified_gmt || p.modified, receipt: { status: r.status, responseHash: r.responseHash } };
  }
  async updatePage({ pageId, title, content, excerpt = undefined } = {}) {
    if (!pageId) throw new Error('WORDPRESS_PAGE_ID_REQUIRED');
    const before = await this.getPage(pageId);
    const payload = { ...(title != null ? { title: String(title) } : {}), ...(content != null ? { content: String(content) } : {}), ...(excerpt != null ? { excerpt: String(excerpt) } : {}) };
    if (!Object.keys(payload).length) throw new Error('WORDPRESS_UPDATE_PAYLOAD_REQUIRED');
    const write = await this.request(`/wp-json/wp/v2/pages/${encodeURIComponent(pageId)}`, { method: 'POST', body: JSON.stringify(payload) });
    const after = await this.getPage(pageId);
    const publicRes = await fetch(after.link, { signal: AbortSignal.timeout(20_000) });
    const html = await publicRes.text();
    const contentMatch = content == null ? true : (after.content === String(content));
    const titleMatch = title == null ? true : (after.title === String(title));
    if (!contentMatch || !titleMatch || !publicRes.ok) throw new Error('WORDPRESS_VERIFICATION_FAILED');
    return { before, after, publicRender: { url: after.link, status: publicRes.status, htmlHash: sha(html), bytes: Buffer.byteLength(html) }, evidence: [{ type: 'wordpress_rest_write', hash: write.responseHash }, { type: 'wordpress_context_edit_readback', hash: after.receipt.responseHash }, { type: 'wordpress_public_render', hash: sha(html), status: publicRes.status }] };
  }
  async improvePage({ pageId, providerId, model, objective = 'Improve clarity, conversion, accessibility and trust without inventing claims.' } = {}) {
    if (!this.providers) throw new Error('PROVIDER_REGISTRY_UNAVAILABLE');
    const before = await this.getPage(pageId);
    const completion = await this.providers.chat({ providerId, model, temperature: 0.2, messages: [
      { role: 'system', content: 'You are the JACO WordPress improvement worker. Return ONLY valid JSON with keys title and content. Preserve factual claims and existing URLs. Never invent testimonials, prices, certifications, or results.' },
      { role: 'user', content: JSON.stringify({ objective, page: { id: before.id, title: before.title, content: before.content, link: before.link } }) }
    ]});
    let proposal;
    try { proposal = JSON.parse(completion.content.replace(/^```json\s*/i, '').replace(/```$/,'').trim()); } catch { throw new Error('WORDPRESS_PROVIDER_OUTPUT_NOT_JSON'); }
    if (typeof proposal?.title !== 'string' || typeof proposal?.content !== 'string') throw new Error('WORDPRESS_PROVIDER_OUTPUT_SCHEMA_INVALID');
    const updated = await this.updatePage({ pageId, title: proposal.title, content: proposal.content });
    return { provider: completion, proposal: { title: proposal.title, contentHash: sha(proposal.content), contentBytes: Buffer.byteLength(proposal.content) }, ...updated };
  }
}
