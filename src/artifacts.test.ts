import { test } from 'node:test';
import * as assert from 'node:assert';
import { ALLOW_RULES, ARTIFACT_NAME, artifactName, CSP, mergeAllow, nextVersion, resolveUrl, svgPage, urlFor, versionNumbers, versionPath, versionsToPrune } from './artifacts';

test('artifacts: names', () => {
  for (const ok of ['a.html', 'loan-calculator.html', 'Chart_2.svg', 'notes.md', 'x'.repeat(60) + '.md']) assert.ok(ARTIFACT_NAME.test(ok), ok);
  for (const bad of ['.html', 'a.txt', 'a.js', 'a b.html', 'a/b.html', '../a.html', 'a.html.exe', 'a..html', 'x'.repeat(61) + '.md', 'a.HTML', '.versions', 'a.html\n']) assert.ok(!ARTIFACT_NAME.test(bad), bad);
});

test('artifacts: which tool paths count', () => {
  const f = '/p/proj';
  assert.strictEqual(artifactName('/p/proj/artifacts/a.html', f), 'a.html');
  assert.strictEqual(artifactName('artifacts/a.svg', f), 'a.svg');
  assert.strictEqual(artifactName('/p/proj/artifacts/../artifacts/a.md', f), 'a.md');
  for (const p of ['/p/proj/a.html', '/p/proj/artifacts/sub/a.html', '/p/other/artifacts/a.html', '/p/proj/artifacts/../a.html', '/p/proj/artifacts/a.txt', '/p/proj/artifacts/.versions/a.html/1.html'])
    assert.strictEqual(artifactName(p, f), null, p);
});

test('artifacts: URLs map to a file, a version, an svg page or a library', () => {
  assert.deepStrictEqual(resolveUrl('clade-artifact://current/a.html'), { kind: 'file', name: 'a.html', version: null });
  assert.deepStrictEqual(resolveUrl('clade-artifact://v12/a.svg'), { kind: 'file', name: 'a.svg', version: 12 });
  assert.deepStrictEqual(resolveUrl('clade-artifact://current/view/a.svg'), { kind: 'view', name: 'a.svg', version: null });
  assert.deepStrictEqual(resolveUrl('clade-artifact://v3/lib/chart.js?x=1#y'), { kind: 'lib', file: 'chart.js/dist/chart.umd.js', type: 'text/javascript' });
  assert.deepStrictEqual(resolveUrl('clade-artifact://current/lib/fonts/KaTeX_Main-Regular.woff2'), { kind: 'lib', file: 'katex/dist/fonts/KaTeX_Main-Regular.woff2', type: 'font/woff2' });
  assert.strictEqual(urlFor('a.html', null), 'clade-artifact://current/a.html');
  assert.strictEqual(urlFor('a.svg', 4), 'clade-artifact://v4/view/a.svg');
  assert.deepStrictEqual(resolveUrl(urlFor('pic.svg', 4)), { kind: 'view', name: 'pic.svg', version: 4 });
});

test('artifacts: nothing outside artifacts/ and the library list can be asked for', () => {
  const bad = [
    'clade-artifact://current/../design.json',
    'clade-artifact://current/%2e%2e/design.json',
    'clade-artifact://current/..%2fdesign.json',
    'clade-artifact://current/a%2fb.html',
    'clade-artifact://current/sub/a.html',
    'clade-artifact://current//etc/passwd',
    'clade-artifact://current/.versions/a.html/1.html',
    'clade-artifact://current/a.txt',
    'clade-artifact://current/',
    'clade-artifact://current/view/a.html', // only svg has a view page
    'clade-artifact://current/lib/unknown.js',
    'clade-artifact://current/lib/../../package.json',
    'clade-artifact://current/lib/fonts/../../../../package.json',
    'clade-artifact://current/lib/fonts/evil.woff2',
    'clade-artifact://current/lib/constructor',
    'clade-artifact://v0/a.html',
    'clade-artifact://v99999/a.html',
    'clade-artifact://other/a.html',
    'clade-artifact://user@current/a.html',
    'clade-artifact://current:80/a.html',
    'file:///etc/passwd',
    'https://current/a.html',
    'not a url',
  ];
  for (const u of bad) assert.strictEqual(resolveUrl(u), null, u);
});

test('artifacts: response policy allows no connections', () => {
  for (const part of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "frame-src 'none'", "base-uri 'none'"]) assert.ok(CSP.includes(part), part);
  assert.ok(!/https?:|\*|unsafe-eval/.test(CSP));
  assert.ok(svgPage('a.svg').includes('<img src="../a.svg"'));
});

test('artifacts: version numbering and the cap', () => {
  assert.deepStrictEqual(versionNumbers(['2.html', '10.html', '1.html', '3.svg', 'x.html', '01.html', '.DS_Store'], 'a.html'), [1, 2, 10]);
  assert.strictEqual(nextVersion([]), 1);
  assert.strictEqual(nextVersion([1, 2, 10]), 11);
  assert.strictEqual(versionPath('a.html', 3).replace(/\\/g, '/'), '.versions/a.html/3.html');
  const nums = Array.from({ length: 53 }, (_, i) => i + 1);
  assert.deepStrictEqual(versionsToPrune(nums), [1, 2, 3]);
  assert.deepStrictEqual(versionsToPrune([1, 2]), []);
});

test('artifacts: the permission merge adds exactly the two artifacts rules', () => {
  assert.deepStrictEqual([...ALLOW_RULES], ['Write(/artifacts/**)', 'Edit(/artifacts/**)']);
  assert.deepStrictEqual(JSON.parse(mergeAllow(null)!), { permissions: { allow: [...ALLOW_RULES] } });
  const before = { hooks: { PermissionRequest: [{ matcher: '*' }] }, permissions: { defaultMode: 'default', allow: ['Bash(echo hi:*)'], deny: ['Read(.env)'] } };
  const after = JSON.parse(mergeAllow(JSON.stringify(before))!);
  assert.deepStrictEqual(after, { ...before, permissions: { ...before.permissions, allow: ['Bash(echo hi:*)', ...ALLOW_RULES] } });
  assert.strictEqual(mergeAllow(JSON.stringify(after)), null); // already there: nothing to write
  assert.strictEqual(JSON.parse(mergeAllow(JSON.stringify({ permissions: { allow: [ALLOW_RULES[0]] } }))!).permissions.allow.length, 2);
  // every rule the merge can ever add is one of the two constants, both limited to artifacts/
  for (const start of [null, '{}', JSON.stringify(before)]) {
    const added = JSON.parse(mergeAllow(start)!).permissions.allow.filter((r: string) => !before.permissions.allow.includes(r));
    assert.deepStrictEqual(added, [...ALLOW_RULES]);
    assert.ok(added.every((r: string) => /^(Write|Edit)\(\/artifacts\/\*\*\)$/.test(r)));
  }
  assert.throws(() => mergeAllow('{ nope'), /bad JSON/);
  assert.throws(() => mergeAllow('[]'), /JSON object/);
  assert.throws(() => mergeAllow('{"permissions":{"allow":"all"}}'), /must be a list/);
});
