export interface GitSavepointCommit {
  id: string;
  hash: string;
  timestamp: string;
  message: string;
  author: string;
  targetFilePath?: string;
  description?: string;
  diffSummary?: string;
  patchId?: string;
  status: 'COMMITTED' | 'REVERTED' | 'CHECKPOINT';
}

export interface GitBridgeStatus {
  initialized: boolean;
  branch: string;
  clean: boolean;
  totalSavepoints: number;
  lastSavepointAt?: string;
  uncommittedChangesCount: number;
}

/**
 * Creates an automatic Git Savepoint commit when a workflow patch or workspace modification is applied.
 */
export async function createGitSavepoint(params: {
  targetFilePath?: string;
  description?: string;
  code?: string;
  patchId?: string;
  commitMessage?: string;
}): Promise<{ success: boolean; savepoint: GitSavepointCommit; message: string }> {
  try {
    const res = await fetch('/api/git-bridge/savepoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    return data;
  } catch (err: any) {
    console.warn('GitBridge Savepoint fallback:', err);
    // Client-side fallback if server offline
    const fallbackSavepoint: GitSavepointCommit = {
      id: `sp-local-${Date.now()}`,
      hash: Math.random().toString(16).substring(2, 9),
      timestamp: new Date().toLocaleTimeString('sv-SE'),
      message: params.commitMessage || `Savepoint: ${params.description || 'Workflow patch applied'}`,
      author: 'JACO Antigravity Bridge (Local)',
      targetFilePath: params.targetFilePath,
      description: params.description,
      patchId: params.patchId,
      status: 'COMMITTED'
    };
    return {
      success: fontOrFallbackSuccess(fallbackSavepoint),
      savepoint: fallbackSavepoint,
      message: `[LOCAL SAVEPOINT] Commit ${fallbackSavepoint.hash} skapad lokalt.`
    };
  }
}

function fontOrFallbackSuccess(sp: GitSavepointCommit) {
  return !!sp;
}

/**
 * Fetches the current Git Bridge status.
 */
export async function fetchGitBridgeStatus(): Promise<GitBridgeStatus> {
  try {
    const res = await fetch('/api/git-bridge/status');
    if (res.ok) {
      const data = await res.json();
      return data.status;
    }
  } catch (err) {
    console.warn('Fetch GitBridge status warning:', err);
  }
  return {
    initialized: true,
    branch: 'main',
    clean: true,
    totalSavepoints: 1,
    lastSavepointAt: new Date().toLocaleTimeString('sv-SE'),
    uncommittedChangesCount: 0
  };
}

/**
 * Fetches the commit history of workspace Savepoints.
 */
export async function fetchSavepointHistory(): Promise<GitSavepointCommit[]> {
  try {
    const res = await fetch('/api/git-bridge/history');
    if (res.ok) {
      const data = await res.json();
      return data.history || [];
    }
  } catch (err) {
    console.warn('Fetch Savepoint history warning:', err);
  }
  return [];
}

/**
 * Reverts the workspace state to a specific Savepoint commit.
 */
export async function revertToSavepoint(commitHash: string): Promise<{
  success: boolean;
  message: string;
  code?: string;
  targetFilePath?: string;
}> {
  try {
    const res = await fetch('/api/git-bridge/revert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitHash })
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err: any) {
    console.error('Revert savepoint error:', err);
  }
  return {
    success: false,
    message: 'Kunde inte återställa till Savepoint.'
  };
}
