import path from 'node:path';

// MCP clients pin their workspace. GUI requests without a binding retain existing behavior.
export function createWorkbenchProjectBinding(projectRoot) {
  return (req, res, next) => {
    const expected = req.headers['x-jaco-project-root'];
    if (expected === undefined) return next();
    if (typeof expected !== 'string' || !expected || !path.isAbsolute(expected) || expected.includes('\0')) {
      return res.status(400).json({ success: false, error: 'WORKBENCH_PROJECT_BINDING_INVALID' });
    }
    const current = projectRoot.get();
    if (path.relative(path.resolve(expected), path.resolve(current)) !== '') {
      return res.status(409).json({ success: false, error: 'WORKBENCH_PROJECT_CONFLICT' });
    }
    next();
  };
}
