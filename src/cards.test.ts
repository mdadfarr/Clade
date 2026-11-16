import { test } from 'node:test';
import * as assert from 'node:assert';
import { answerBody, answeredCalls, CardView, HOOK_MARK, makeCard, mergeHook, parseHookInput } from './cards';
import { DEFAULT_DESIGN, parseDesign } from './design';

const { timeLeft: tl, CARD_LIFETIME_MS } = require('./timeleft') as { timeLeft: typeof timeLeft; CARD_LIFETIME_MS: number };

// ---- time left ----

test('time left counts from the request arrival, 590 s', () => {
  const arrived = 1_000_000;
  const expires = arrived + CARD_LIFETIME_MS;
  assert.strictEqual(CARD_LIFETIME_MS, 590_000);
  const fresh = tl(expires, arrived);
  assert.deepStrictEqual(fresh, { ms: 590_000, fraction: 1, text: '9:50 left', level: 'normal' });
  // shown later (switched sessions and came back): the real time left, not a fresh 9:50
  const later = tl(expires, arrived + 26_000);
  assert.strictEqual(later.text, '9:24 left');
  assert.strictEqual(later.ms, 564_000);
  assert.ok(Math.abs(later.fraction - 564 / 590) < 1e-9);
});

test('time left rounds partial seconds up and pads seconds', () => {
  assert.strictEqual(tl(10_000, 0 + 10_000 - 61_500).text, '1:02 left');
  assert.strictEqual(tl(10_000, 10_000 - 1).text, '0:01 left');
  assert.strictEqual(tl(10_000, 10_000 - 9_000).text, '0:09 left');
});

test('time left level: urgent under 30 s (by the shown seconds), else normal', () => {
  const at = (msLeft: number) => tl(msLeft, 0).level;
  assert.strictEqual(at(590_000), 'normal');
  assert.strictEqual(at(120_000), 'normal');
  assert.strictEqual(at(30_000), 'normal');
  assert.strictEqual(at(29_001), 'normal'); // shows "0:30 left"
  assert.strictEqual(at(29_000), 'urgent'); // shows "0:29 left"
  assert.strictEqual(at(1), 'urgent');
});

test('time left at and after 0 is expired, never negative', () => {
  assert.deepStrictEqual(tl(5_000, 5_000), { ms: 0, fraction: 0, text: '0:00 left', level: 'expired' });
  assert.deepStrictEqual(tl(5_000, 99_000), { ms: 0, fraction: 0, text: '0:00 left', level: 'expired' });
});

test('time left never shows more than the lifetime (clock skew)', () => {
  assert.strictEqual(tl(2_000_000, 0).fraction, 1);
  assert.strictEqual(tl(2_000_000, 0).text, '9:50 left');
});

test('design.json timer colors: defaults, custom, invalid', () => {
  const base = { terminal: { background: '#000', textColor: '#fff', fontSize: 14 }, window: { background: '#111' }, panels: [] };
  assert.deepStrictEqual(parseDesign(JSON.stringify(base)).timer, DEFAULT_DESIGN.timer);
  const timer = { track: 'rgba(127,127,127,0.2)', fill: '#aaaaaa', urgent: 'rgb(150,80,80)' };
  assert.deepStrictEqual(parseDesign(JSON.stringify({ ...base, timer })).timer, timer);
  assert.throws(() => parseDesign(JSON.stringify({ ...base, timer: { track: 'grey', fill: 'silver' } })), /missing key "urgent" in timer/);
  assert.throws(() => parseDesign(JSON.stringify({ ...base, timer: { ...timer, urgent: 'url(x)' } })), /timer.urgent must be a color/);
  assert.throws(() => parseDesign(JSON.stringify({ ...base, timer: { ...timer, normal: 'blue' } })), /unknown key "normal" in timer/);
});

// ---- hook input and cards ----

const SID = '11111111-2222-4333-8444-555555555555';
const hook = (tool_name: string, tool_input: object, permission_suggestions: unknown[] = []) =>
  parseHookInput(JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: SID, transcript_path: '/x', cwd: '/x', tool_name, tool_input, permission_suggestions }));
const card = (input: ReturnType<typeof hook>): CardView => makeCard(input, 'c1', 1000, 590_000);
const decision = (body: string) => JSON.parse(body).hookSpecificOutput.decision;

test('hook input: anything unexpected is refused', () => {
  assert.throws(() => parseHookInput('nope'), /invalid JSON/);
  assert.throws(() => parseHookInput(JSON.stringify({ hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Bash', tool_input: {} })), /unexpected hook event/);
  assert.throws(() => parseHookInput(JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: '../x', tool_name: 'Bash', tool_input: {} })), /session id/);
  assert.throws(() => parseHookInput(JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: SID, tool_name: 'Bash', tool_input: 'ls' })), /tool input/);
});

test('Bash card: exact command, allow, deny with and without reason', () => {
  const input = hook('Bash', { command: 'rm -rf build && ls', description: 'Clean build' });
  const c = card(input);
  assert.strictEqual(c.kind, 'permission');
  assert.strictEqual(c.title, 'Claude wants to run');
  assert.strictEqual(c.target, 'rm -rf build && ls');
  assert.strictEqual(c.note, 'Clean build');
  assert.strictEqual(c.expires, 1000 + 590_000);
  assert.deepStrictEqual(decision(answerBody(input, c, { action: 'allow' })), { behavior: 'allow' });
  assert.deepStrictEqual(decision(answerBody(input, c, { action: 'deny', reason: '  use make clean  ' })), { behavior: 'deny', message: 'use make clean' });
  assert.deepStrictEqual(decision(answerBody(input, c, { action: 'deny', reason: '' })), { behavior: 'deny', message: 'The user denied this.' });
  assert.strictEqual(answerBody(input, c, { action: 'terminal' }), '');
  assert.strictEqual(JSON.parse(answerBody(input, c, { action: 'allow' })).hookSpecificOutput.hookEventName, 'PermissionRequest');
});

test('Write and Edit cards: path and what changes', () => {
  const w = card(hook('Write', { file_path: '/p/a.txt', content: 'one\ntwo' }));
  assert.strictEqual(w.title, 'Claude wants to edit');
  assert.strictEqual(w.target, '/p/a.txt');
  assert.deepStrictEqual(w.preview, [{ kind: 'text', text: 'one\ntwo' }]);
  const e = card(hook('Edit', { file_path: '/p/a.txt', old_string: 'one', new_string: 'uno\ndos', replace_all: true }));
  assert.deepStrictEqual(e.preview, [{ kind: 'diff', text: '- one\n+ uno\n+ dos' }]);
  assert.match(e.note, /every match/);
  assert.throws(() => card(hook('Write', { file_path: '/p/a.txt' })), /without a path or content/);
});

test('unknown tool: card with its exact input', () => {
  const c = card(hook('mcp__x__do', { a: 1 }));
  assert.deepStrictEqual(c.preview, [{ kind: 'json', text: '{\n  "a": 1\n}' }]);
});

test('Always allow: only addRules suggestions, saved exactly as suggested', () => {
  const rule = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' };
  const input = hook('Bash', { command: 'npm test' }, [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }, rule, { type: 'addRules', rules: [], behavior: 'allow', destination: 'session' }]);
  const c = card(input);
  assert.deepStrictEqual(c.rules, [{ label: 'Bash(npm test:*)', destination: 'this folder (.claude/settings.local.json)' }]);
  assert.deepStrictEqual(decision(answerBody(input, c, { action: 'always', rule: 0 })), { behavior: 'allow', updatedPermissions: [rule] });
  assert.throws(() => answerBody(input, c, { action: 'always', rule: 1 }), /no such rule/);
  // a setMode suggestion alone gives no button
  assert.deepStrictEqual(card(hook('Write', { file_path: '/a', content: '' }, [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }])).rules, []);
});

test('question card: answered through updatedInput, only with real options', () => {
  const questions = [{ question: 'Which color?', header: 'Color', options: [{ label: 'Red', description: 'warm' }, { label: 'Blue' }], multiSelect: false }];
  const input = hook('AskUserQuestion', { questions });
  const c = card(input);
  assert.strictEqual(c.kind, 'question');
  assert.strictEqual(c.title, 'Claude asks');
  assert.deepStrictEqual(c.questions[0].options, [{ label: 'Red', description: 'warm' }, { label: 'Blue', description: '' }]);
  assert.deepStrictEqual(decision(answerBody(input, c, { action: 'answer', answers: { 'Which color?': 'Blue' } })), {
    behavior: 'allow',
    updatedInput: { questions, answers: { 'Which color?': 'Blue' } },
  });
  assert.throws(() => answerBody(input, c, { action: 'answer', answers: { 'Which color?': 'Green' } }), /not one of the options/);
  assert.throws(() => answerBody(input, c, { action: 'allow' }), /not a permission card/);
  assert.strictEqual(answerBody(input, c, { action: 'terminal' }), '');
  const multi = hook('AskUserQuestion', { questions: [{ ...questions[0], multiSelect: true }] });
  assert.throws(() => answerBody(multi, card(multi), { action: 'answer', answers: { 'Which color?': 'Red' } }), /terminal/);
  assert.throws(() => card(hook('AskUserQuestion', { questions: [] })), /without questions/);
});

test('answered in the terminal: a new tool_result for the same tool and input', () => {
  const use = (id: string, input: object) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input }] } });
  const result = (id: string) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id }] } });
  const input = { description: 'list', command: 'ls' };
  const text = [use('a', { command: 'ls', description: 'list' }), result('a'), use('b', input), use('c', { command: 'pwd' }), result('c')].join('\n');
  assert.deepStrictEqual(answeredCalls(text, 'Bash', input), ['a']); // key order does not matter
  assert.deepStrictEqual(answeredCalls(text + '\n' + result('b'), 'Bash', input), ['a', 'b']);
  assert.deepStrictEqual(answeredCalls(text, 'Write', input), []);
});

// ---- settings.local.json merge ----

const CMD = `${HOOK_MARK} ELECTRON_RUN_AS_NODE=1 '/app/Electron' '/app/dist/hook.js' '/data/hook-1.json'`;

test('merge: new file gets only our entry', () => {
  assert.deepStrictEqual(JSON.parse(mergeHook(null, CMD, 600)!), {
    hooks: { PermissionRequest: [{ matcher: '*', hooks: [{ type: 'command', command: CMD, timeout: 600 }] }] },
  });
});

test('merge: everything already in the file is kept', () => {
  const old = {
    permissions: { allow: ['Bash(npm test:*)'] },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'mine.sh' }] }], PermissionRequest: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'other.sh' }] }] },
    env: { X: '1' },
  };
  const merged = JSON.parse(mergeHook(JSON.stringify(old), CMD, 600)!);
  assert.deepStrictEqual(merged.permissions, old.permissions);
  assert.deepStrictEqual(merged.env, old.env);
  assert.deepStrictEqual(merged.hooks.PreToolUse, old.hooks.PreToolUse);
  assert.deepStrictEqual(merged.hooks.PermissionRequest, [...old.hooks.PermissionRequest, { matcher: '*', hooks: [{ type: 'command', command: CMD, timeout: 600 }] }]);
});

test('merge: our entry already there is left alone, an old one of ours is updated in place', () => {
  const once = mergeHook(null, CMD, 600)!;
  assert.strictEqual(mergeHook(once, CMD, 600), null);
  const moved = CMD.replace('/app/', '/moved/');
  const updated = JSON.parse(mergeHook(once, moved, 600)!);
  assert.deepStrictEqual(updated.hooks.PermissionRequest, [{ matcher: '*', hooks: [{ type: 'command', command: moved, timeout: 600 }] }]);
});

test('merge: a file we cannot safely add to is refused, not overwritten', () => {
  assert.throws(() => mergeHook('{ broken', CMD, 600), /not valid JSON/);
  assert.throws(() => mergeHook('[]', CMD, 600), /top level/);
  assert.throws(() => mergeHook('{"hooks": []}', CMD, 600), /"hooks" is not an object/);
  assert.throws(() => mergeHook('{"hooks": {"PermissionRequest": {}}}', CMD, 600), /not a list/);
  assert.ok(mergeHook('', CMD, 600)); // empty file: treated as {}
});
