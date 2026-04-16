import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectLanguage, highlight } from '../renderer/lib/highlight';

test('detectLanguage maps extensions to languages', () => {
  assert.equal(detectLanguage('App.tsx'), 'typescript');
  assert.equal(detectLanguage('script.py'), 'python');
  assert.equal(detectLanguage('config.yml'), 'yaml');
  assert.equal(detectLanguage('data.json'), 'json');
  assert.equal(detectLanguage('README.md'), 'markdown');
  assert.equal(detectLanguage('Dockerfile'), 'plain');
  assert.equal(detectLanguage('unknownext.xyz'), 'plain');
});

test('highlight escapes HTML special characters', () => {
  const out = highlight('<script>alert(1)</script>', 'plain');
  assert.ok(out.includes('&lt;script&gt;'), 'should escape angle brackets');
  assert.ok(!out.includes('<script>'), 'should not emit raw script tag');
});

test('highlight wraps JavaScript keywords in purple span', () => {
  const out = highlight('const x = 1;', 'javascript');
  assert.ok(out.includes('text-[#c084fc]'), 'keyword color applied');
  assert.ok(out.includes('const'), 'original token preserved');
});

test('highlight marks Python comments', () => {
  const out = highlight('# this is a comment', 'python');
  assert.ok(out.includes('text-[#71717a]'), 'comment color applied');
});

test('highlight marks JSON strings and numbers distinctly', () => {
  const out = highlight('{"key": 42}', 'json');
  // Property key colored, number colored
  assert.ok(out.includes('text-[#93c5fd]'), 'JSON property key colored');
  assert.ok(out.includes('text-[#fbbf24]'), 'JSON number colored');
});

test('highlight falls back to escape-only on plain language', () => {
  const out = highlight('just text & more', 'plain');
  assert.equal(out, 'just text &amp; more');
});

test('highlight handles empty input', () => {
  assert.equal(highlight('', 'javascript'), '');
});
