// Aura is a small white point of light: no image, no colour sphere; it brightens slowly while she thinks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Aura is drawn as a white point with an accessible name', () => {
  const panel = fs.readFileSync(new URL('../../runtime/src/components/AuraChatPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /className="aura-avatar aura-dot"/);
  assert.match(panel, /aria-label="Aura"/);
  assert.doesNotMatch(panel, /aura-avatar\.png|aura-orb/);
});

test('the white point brightens while thinking and respects reduced motion', () => {
  const css = fs.readFileSync(new URL('../../runtime/src/cognitive-workspace.css', import.meta.url), 'utf8');
  assert.match(css, /\.aura-dot \{[^}]*background:#ffffff/);
  assert.match(css, /@keyframes aura-dot-breathe/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.aura-dot\[data-thinking\] \{ animation:none/);
  assert.doesNotMatch(css, /aura-orb/);
});
