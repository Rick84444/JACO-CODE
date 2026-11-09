import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStylePath } from '../components/CognitivePreview';

test('a project stylesheet link resolves inside the project, never to the network', () => {
  const page = 'site/jacocode.com/public/index.html';
  assert.equal(projectStylePath(page, '/style.css?v=glass-4'), 'site/jacocode.com/public/style.css');
  assert.equal(projectStylePath(page, 'css/app.css'), 'site/jacocode.com/public/css/app.css');
  assert.equal(projectStylePath(page, '../shared.css'), 'site/jacocode.com/shared.css');
  for (const href of ['https://cdn.example/x.css', '//cdn.example/x.css', 'data:text/css,body{}', '/icon.png'])
    assert.equal(projectStylePath(page, href), null, href);
  assert.equal(projectStylePath('index.html', '../../outside.css'), null);
});
