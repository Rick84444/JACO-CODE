// Account identity and repository ownership are observed from the configured credential.
export function createHuggingFaceAccount({ env = process.env, fetchImpl = fetch } = {}) {
  const token = () => env.HUGGINGFACE_TOKEN || env.HF_TOKEN;
  async function read(path) {
    if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('HF_TLS_VERIFICATION_REQUIRED');
    const response = await fetchImpl(`https://huggingface.co${path}`, {
      headers: { Authorization: `Bearer ${token()}` }, redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'HF_AUTH_REQUIRED' : 'HF_UNAVAILABLE');
    return response.json();
  }
  async function status() {
    const timestamp = new Date().toISOString();
    if (!token()) return { configured: false, available: false, status: 'NOT_CONFIGURED', timestamp };
    try {
      const data = await read('/api/whoami-v2');
      if (typeof data.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(data.name)) throw new Error('HF_IDENTITY_INVALID');
      return { configured: true, available: true, status: 'OBSERVED', user: data.name,
        fullname: typeof data.fullname === 'string' ? data.fullname.slice(0, 200) : null,
        role: typeof data.auth?.accessToken?.role === 'string' ? data.auth.accessToken.role.slice(0, 40) : null, timestamp };
    } catch (error) {
      return { configured: true, available: false, status: 'UNAVAILABLE', error: /^HF_[A-Z_]+$/.test(error.message) ? error.message : 'HF_UNAVAILABLE', timestamp };
    }
  }
  async function repos() {
    const account = await status();
    if (!account.available) return { ...account, repos: [], publishedEntities: [], success: false };
    try {
      const groups = await Promise.all(['models', 'datasets', 'spaces'].map(async collection => {
        const rows = await read(`/api/${collection}?author=${encodeURIComponent(account.user)}&limit=100`);
        if (!Array.isArray(rows)) throw new Error('HF_RESPONSE_INVALID');
        return rows.slice(0, 100).flatMap(row => {
          if (typeof row.id !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(row.id)) return [];
          return [{ id: row.id, name: row.id, type: collection === 'models' ? 'model' : collection === 'datasets' ? 'dataset' : 'space',
            url: `https://huggingface.co/${collection === 'models' ? '' : `${collection}/`}${row.id}`,
            downloads: Number.isFinite(row.downloads) ? row.downloads : null, likes: Number.isFinite(row.likes) ? row.likes : null,
            status: 'OBSERVED' }];
        });
      }));
      const repositories = groups.flat();
      return { ...account, success: true, author: account.user, repos: repositories, publishedEntities: repositories,
        limitPerType: 100, possiblyLimited: groups.some(group => group.length === 100) };
    } catch (error) {
      return { ...account, available: false, success: false, status: 'UNAVAILABLE', error: /^HF_[A-Z_]+$/.test(error.message) ? error.message : 'HF_UNAVAILABLE', repos: [], publishedEntities: [] };
    }
  }
  return { status, repos };
}
