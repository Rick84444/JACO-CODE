// Aura's face is a CSS glass sphere, not an image; reduced motion stops the pulse.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Aura is drawn as a glass sphere with an accessible name', () => {
  const panel = fs.readFileSync(new URL('../../runtime/src/components/AuraChatPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /className="aura-avatar aura-orb"/);
  assert.match(panel, /aria-label="Aura"/);
  assert.doesNotMatch(panel, /aura-avatar\.png/);
});

test('the glass sphere pulses and respects reduced motion', () => {
  const css = fs.readFileSync(new URL('../../runtime/src/cognitive-workspace.css', import.meta.url), 'utf8');
  assert.match(css, /@keyframes aura-orb-pulse/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.aura-orb-core, \.aura-orb-core::after \{ animation:none; \} \}/);
});
