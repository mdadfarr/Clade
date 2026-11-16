// Permission and question cards: hook input -> card, card click -> hook answer, and the
// settings.local.json merge. Pure functions: no file or network access here.

import { UUID } from './branches';

export interface HookInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  permission_suggestions: unknown[];
}

export interface Question {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

export interface CardView {
  id: string;
  session: string;
  kind: 'permission' | 'question';
  tool: string; // tool name exactly as Claude Code sent it
  title: string; // "Claude asks", "Claude wants to run" or "Claude wants to edit"
  targetLabel: string; // "Command", "File", ... ('' when there is no single target)
  target: string; // the exact command, path or URL
  note: string; // e.g. the command's description
  preview: { kind: 'text' | 'diff' | 'json'; text: string }[];
  rules: { label: string; destination: string }[]; // one "Always allow" button each
  questions: Question[];
  arrived: number; // epoch ms when the hook request arrived
  expires: number; // arrived + lifetime
  expired: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Hook stdin JSON -> HookInput. Throws (one line) on anything unexpected. */
export function parseHookInput(text: string): HookInput {
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    throw new Error('the hook sent invalid JSON');
  }
  if (!isObj(d)) throw new Error('the hook data is not an object');
  if (d.hook_event_name !== 'PermissionRequest') throw new Error(`unexpected hook event ${JSON.stringify(d.hook_event_name)}`);
  if (!isStr(d.session_id) || !UUID.test(d.session_id)) throw new Error('the hook data has no valid session id');
  if (!isStr(d.tool_name) || !d.tool_name) throw new Error('the hook data has no tool name');
  if (!isObj(d.tool_input)) throw new Error('the hook data has no tool input');
  const s = d.permission_suggestions;
  return { session_id: d.session_id, tool_name: d.tool_name, tool_input: d.tool_input, permission_suggestions: Array.isArray(s) ? s : [] };
}

// ---- "Always allow": only addRules suggestions that allow, shown exactly as Claude Code gave them ----

interface RuleSuggestion {
  type: 'addRules';
  behavior: 'allow';
  destination: string;
  rules: { toolName: string; ruleContent?: string }[];
}

const DESTINATIONS: Record<string, string> = {
  session: 'this session',
  localSettings: 'this folder (.claude/settings.local.json)',
  projectSettings: 'this project (.claude/settings.json)',
  userSettings: 'all your projects (~/.claude/settings.json)',
};

function ruleSuggestion(s: unknown): RuleSuggestion | null {
  if (!isObj(s) || s.type !== 'addRules' || s.behavior !== 'allow' || !isStr(s.destination) || !(s.destination in DESTINATIONS)) return null;
  if (!Array.isArray(s.rules) || !s.rules.length) return null;
  for (const r of s.rules) {
    if (!isObj(r) || !isStr(r.toolName) || !r.toolName) return null;
    if (r.ruleContent !== undefined && !isStr(r.ruleContent)) return null;
  }
  return s as unknown as RuleSuggestion;
}

/** Indexes into permission_suggestions that may become an "Always allow" button. */
export function ruleIndexes(input: HookInput): number[] {
  return input.permission_suggestions.flatMap((s, i) => (ruleSuggestion(s) ? [i] : []));
}

export const ruleText = (r: { toolName: string; ruleContent?: string }) => (r.ruleContent !== undefined ? `${r.toolName}(${r.ruleContent})` : r.toolName);

// ---- card content ----

const json = (v: unknown) => JSON.stringify(v, null, 2);

function diff(oldText: string, newText: string): string {
  const side = (t: string, mark: string) => (t === '' ? [] : t.split('\n').map((l) => mark + l));
  return [...side(oldText, '- '), ...side(newText, '+ ')].join('\n');
}

function questions(input: Record<string, unknown>): Question[] {
  const qs = input.questions;
  if (!Array.isArray(qs) || !qs.length) throw new Error('AskUserQuestion without questions');
  return qs.map((q) => {
    if (!isObj(q) || !isStr(q.question) || !Array.isArray(q.options) || !q.options.length) throw new Error('a question the app cannot read');
    const options = q.options.map((o) => {
      if (!isObj(o) || !isStr(o.label)) throw new Error('a question option the app cannot read');
      return { label: o.label, description: isStr(o.description) ? o.description : '' };
    });
    return { question: q.question, header: isStr(q.header) ? q.header : '', options, multiSelect: q.multiSelect === true };
  });
}

/** Build the card for a hook request. Throws when the app cannot show it clearly. */
export function makeCard(input: HookInput, id: string, arrived: number, lifetime: number): CardView {
  const t = input.tool_input;
  const card: CardView = {
    id,
    session: input.session_id,
    kind: 'permission',
    tool: input.tool_name,
    title: 'Claude wants to run',
    targetLabel: '',
    target: '',
    note: '',
    preview: [],
    rules: ruleIndexes(input).map((i) => {
      const s = ruleSuggestion(input.permission_suggestions[i])!;
      return { label: s.rules.map(ruleText).join(', '), destination: DESTINATIONS[s.destination] };
    }),
    questions: [],
    arrived,
    expires: arrived + lifetime,
    expired: false,
  };
  const raw = () => card.preview.push({ kind: 'json', text: json(t) });
  const EDIT = 'Claude wants to edit';

  switch (input.tool_name) {
    case 'AskUserQuestion':
      card.kind = 'question';
      card.title = 'Claude asks';
      card.questions = questions(t);
      card.rules = [];
      break;
    case 'Bash':
      if (!isStr(t.command)) throw new Error('a Bash request without a command');
      card.title = 'Claude wants to run';
      card.targetLabel = 'Command';
      card.target = t.command;
      card.note = isStr(t.description) ? t.description : '';
      break;
    case 'Write':
      if (!isStr(t.file_path) || !isStr(t.content)) throw new Error('a Write request without a path or content');
      card.title = EDIT;
      card.targetLabel = 'File';
      card.target = t.file_path;
      card.preview.push({ kind: 'text', text: t.content });
      break;
    case 'Edit':
      if (!isStr(t.file_path) || !isStr(t.old_string) || !isStr(t.new_string)) throw new Error('an Edit request the app cannot read');
      card.title = EDIT;
      card.targetLabel = 'File';
      card.target = t.file_path;
      card.note = t.replace_all === true ? 'Replaces every match in the file.' : '';
      card.preview.push({ kind: 'diff', text: diff(t.old_string, t.new_string) });
      break;
    case 'MultiEdit': {
      const edits = t.edits;
      if (!isStr(t.file_path) || !Array.isArray(edits) || !edits.every((e) => isObj(e) && isStr(e.old_string) && isStr(e.new_string))) {
        throw new Error('a MultiEdit request the app cannot read');
      }
      card.title = EDIT;
      card.note = `${edits.length} changes`;
      card.targetLabel = 'File';
      card.target = t.file_path;
      for (const e of edits as Record<string, string>[]) card.preview.push({ kind: 'diff', text: diff(e.old_string, e.new_string) });
      break;
    }
    case 'NotebookEdit':
      if (!isStr(t.notebook_path)) throw new Error('a NotebookEdit request without a path');
      card.title = EDIT;
      card.targetLabel = 'Notebook';
      card.target = t.notebook_path;
      raw();
      break;
    case 'WebFetch':
      if (!isStr(t.url)) throw new Error('a WebFetch request without a URL');
      card.targetLabel = 'URL';
      card.target = t.url;
      card.note = isStr(t.prompt) ? t.prompt : '';
      break;
    case 'WebSearch':
      if (!isStr(t.query)) throw new Error('a WebSearch request without a query');
      card.targetLabel = 'Query';
      card.target = t.query;
      break;
    case 'Read':
      if (!isStr(t.file_path)) throw new Error('a Read request without a path');
      card.targetLabel = 'File';
      card.target = t.file_path;
      break;
    default:
      card.targetLabel = `Tool input (${input.tool_name})`; // an unknown tool: its name is the only way to tell what runs
      raw();
  }
  return card;
}

// ---- answers (the JSON the hook prints) ----

export type Action =
  | { action: 'allow' }
  | { action: 'always'; rule: number } // index into the card's rules
  | { action: 'deny'; reason: string }
  | { action: 'answer'; answers: Record<string, string> }
  | { action: 'terminal' };

const decision = (d: Record<string, unknown>) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: d } });

/** The hook's stdout for a click. '' = no decision (the terminal prompt stays). Throws on a click that does not fit the card. */
export function answerBody(input: HookInput, card: CardView, a: Action): string {
  switch (a.action) {
    case 'terminal':
      return '';
    case 'allow':
      if (card.kind !== 'permission') throw new Error('not a permission card');
      return decision({ behavior: 'allow' });
    case 'always': {
      if (card.kind !== 'permission') throw new Error('not a permission card');
      const i = ruleIndexes(input)[a.rule];
      if (i === undefined) throw new Error('no such rule');
      return decision({ behavior: 'allow', updatedPermissions: [input.permission_suggestions[i]] }); // exactly as suggested
    }
    case 'deny': {
      if (card.kind !== 'permission') throw new Error('not a permission card');
      const reason = typeof a.reason === 'string' ? a.reason.trim().slice(0, 2000) : '';
      return decision({ behavior: 'deny', message: reason || 'The user denied this.' });
    }
    case 'answer': {
      if (card.kind !== 'question') throw new Error('not a question card');
      if (!isObj(a.answers)) throw new Error('no answers');
      const answers: Record<string, string> = {};
      for (const q of card.questions) {
        const label = a.answers[q.question];
        if (q.multiSelect) throw new Error('several-answer questions are answered in the terminal');
        if (!q.options.some((o) => o.label === label)) throw new Error('an answer that is not one of the options');
        answers[q.question] = label;
      }
      if (Object.keys(a.answers).length !== card.questions.length) throw new Error('answers for unknown questions');
      return decision({ behavior: 'allow', updatedInput: { ...input.tool_input, answers } });
    }
  }
}

// ---- was the request answered in the terminal? ----

/** JSON with sorted object keys, so two equal inputs compare equal. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

/** Ids of tool calls in session text with this name and input that already have a tool_result. */
export function answeredCalls(text: string, name: string, input: unknown): string[] {
  const want = canonical(input);
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const line of text.split('\n')) {
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const c = d?.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (d.type === 'assistant' && b?.type === 'tool_use' && b.name === name && canonical(b.input) === want) calls.add(String(b.id));
      if (d.type === 'user' && b?.type === 'tool_result') results.add(String(b.tool_use_id));
    }
  }
  return [...calls].filter((id) => results.has(id));
}

// ---- .claude/settings.local.json ----

/** Marks the app's own hook entry; nothing else in the file is ever changed. */
export const HOOK_MARK = 'CLAUDE_DESIGN_TERMINAL_HOOK=1';

/**
 * The file's text with our PermissionRequest hook entry added (or our old entry updated).
 * null: the file already has exactly this entry. Throws when the file is not something we can
 * safely add to (then it is left alone). text null = the file does not exist.
 */
export function mergeHook(text: string | null, command: string, timeout: number): string | null {
  let settings: unknown = {};
  if (text !== null && text.trim()) {
    try {
      settings = JSON.parse(text);
    } catch (e) {
      throw new Error(`it is not valid JSON (${(e as Error).message})`);
    }
  }
  if (!isObj(settings)) throw new Error('its top level is not a JSON object');
  if (settings.hooks === undefined) settings.hooks = {};
  const hooks = settings.hooks;
  if (!isObj(hooks)) throw new Error('its "hooks" is not an object');
  if (hooks.PermissionRequest === undefined) hooks.PermissionRequest = [];
  const groups = hooks.PermissionRequest;
  if (!Array.isArray(groups)) throw new Error('its "hooks.PermissionRequest" is not a list');

  const entry = { type: 'command', command, timeout };
  for (const g of groups) {
    if (!isObj(g) || !Array.isArray(g.hooks)) continue;
    const i = g.hooks.findIndex((h) => isObj(h) && isStr(h.command) && h.command.includes(HOOK_MARK));
    if (i < 0) continue;
    if (canonical(g.hooks[i]) === canonical(entry)) return null;
    g.hooks[i] = entry; // our entry from an older app version or path
    return JSON.stringify(settings, null, 2) + '\n';
  }
  groups.push({ matcher: '*', hooks: [entry] });
  return JSON.stringify(settings, null, 2) + '\n';
}
