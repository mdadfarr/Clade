import { test } from 'node:test';
import * as assert from 'node:assert';
import { accountLine, parseAuthStatus, UNKNOWN } from './account';

// The shape Claude Code 2.1.326 prints (values made up).
const FULL = {
  loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', analyticsDisabled: false,
  projectsDirectory: '/Users/x/.claude/projects', configDirectory: '/Users/x/.claude', loginExpiresAt: '2027-01-01T00:00:00Z',
  consoleProfileSignInOffered: false, email: 'someone@example.com', orgId: 'org-123', orgName: 'Org', subscriptionType: 'pro',
  storedClaudeAiLogin: true, planTier: 'Pro',
};

test('signed in: only the email and the plan word come out', () => {
  const a = parseAuthStatus(JSON.stringify(FULL), 0);
  assert.deepStrictEqual(a, { state: 'in', email: 'someone@example.com', plan: 'pro' });
  assert.deepStrictEqual(Object.keys(a).sort(), ['email', 'plan', 'state']); // no ids, paths, dates
});

test('extra and unknown keys are ignored', () => {
  assert.deepStrictEqual(parseAuthStatus(JSON.stringify({ ...FULL, token: 'secret', newKey: { a: 1 } }), 0), { state: 'in', email: 'someone@example.com', plan: 'pro' });
});

test('logged out', () => {
  assert.deepStrictEqual(parseAuthStatus(JSON.stringify({ loggedIn: false }), 0), { state: 'out', email: '', plan: '' });
});

test('bad JSON, a non-zero exit, a wrong shape: unknown', () => {
  assert.deepStrictEqual(parseAuthStatus('not json', 0), UNKNOWN);
  assert.deepStrictEqual(parseAuthStatus(JSON.stringify(FULL), 1), UNKNOWN);
  assert.deepStrictEqual(parseAuthStatus(JSON.stringify(FULL), null), UNKNOWN); // killed (timeout)
  assert.deepStrictEqual(parseAuthStatus('[]', 0), UNKNOWN);
  assert.deepStrictEqual(parseAuthStatus(JSON.stringify({ email: 'a@b.co' }), 0), UNKNOWN); // no loggedIn
});

test('missing or odd email: signed in without a name; odd plan dropped', () => {
  assert.deepStrictEqual(parseAuthStatus(JSON.stringify({ ...FULL, email: undefined }), 0), { state: 'unknown', email: '', plan: 'pro' });
  assert.deepStrictEqual(parseAuthStatus(JSON.stringify({ ...FULL, email: '<script>@x.y' }), 0).email, '');
  assert.deepStrictEqual(parseAuthStatus(JSON.stringify({ ...FULL, planTier: 'x'.repeat(40) }), 0).plan, '');
});

test('the row line: email, hidden name, signed out, unknown', () => {
  const a = parseAuthStatus(JSON.stringify(FULL), 0);
  assert.strictEqual(accountLine(a, true), 'someone@example.com');
  assert.strictEqual(accountLine(a, false), 'Signed in with Claude Code');
  assert.strictEqual(accountLine(parseAuthStatus('{"loggedIn":false}', 0), true), 'Not signed in');
  assert.strictEqual(accountLine(UNKNOWN, true), 'Signed in with Claude Code');
});
