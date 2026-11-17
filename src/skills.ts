// Skills Claude Code can see: found by reading SKILL.md headers in the usual folders. On/off uses
// Claude Code's own "skillOverrides" setting in the project's .claude/settings.local.json, so the
// app never moves or edits a skill. "Add from a folder" copies a skill into the project.
import * as fs from 'fs';
import * as path from 'path';

export interface Skill {
  name: string;
  description: string;
  where: 'project' | 'home' | 'plugin';
  on: boolean;
  canSwitch: boolean; // plugin skills are listed only
}

/** name and description from a SKILL.md header (the block between the first two --- lines). */
export function skillHeader(text: string): { name: string; description: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const get = (key: string) => {
    const line = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(m?.[1] ?? '');
    return (line?.[1] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2');
  };
  return { name: get('name'), description: get('description') };
}

/** A folder name that is safe as a skill name: letters, digits, dashes. '' if nothing is left. */
export const cleanSkillName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** settings.local.json text with one skill switched (everything else kept). Uses Claude Code's skillOverrides: "off" hides a skill, no entry means on. */
export function mergeSkillSwitch(text: string | null, name: string, on: boolean): string {
  let raw: any = {};
  if (text !== null && text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new Error(`bad JSON: ${(e as Error).message}`);
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('expected a JSON object');
  const cur = typeof raw.skillOverrides === 'object' && raw.skillOverrides !== null && !Array.isArray(raw.skillOverrides) ? raw.skillOverrides : {};
  const next = { ...cur };
  if (on) delete next[name];
  else next[name] = 'off';
  const out = { ...raw, skillOverrides: next };
  if (!Object.keys(next).length) delete out.skillOverrides;
  return JSON.stringify(out, null, 2) + '\n';
}

export function skillOverrides(text: string | null): Record<string, string> {
  try {
    const o = JSON.parse(text ?? '{}')?.skillOverrides;
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

const read = (f: string) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return null;
  }
};
const dirs = (d: string) => {
  try {
    return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name);
  } catch {
    return [];
  }
};

/** Every skill found for a project: its own, the home folder's, and (listed only) installed plugins'. */
export function listSkills(project: string, home: string): Skill[] {
  const off = skillOverrides(read(path.join(project, '.claude', 'settings.local.json')));
  const out: Skill[] = [];
  const scan = (root: string, where: Skill['where'], prefix = '') => {
    for (const d of dirs(root)) {
      const text = read(path.join(root, d, 'SKILL.md'));
      if (text === null) continue;
      const h = skillHeader(text.slice(0, 4000));
      const name = prefix + (h.name || d);
      if (out.some((s) => s.name === name)) continue; // a project skill hides a home skill of the same name
      out.push({ name, description: h.description.slice(0, 300), where, on: off[name] !== 'off', canSwitch: where !== 'plugin' });
    }
  };
  scan(path.join(project, '.claude', 'skills'), 'project');
  scan(path.join(home, '.claude', 'skills'), 'home');
  // plugins: ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>/SKILL.md
  const cache = path.join(home, '.claude', 'plugins', 'cache');
  for (const market of dirs(cache)) for (const plugin of dirs(path.join(cache, market))) for (const ver of dirs(path.join(cache, market, plugin)).slice(-1)) scan(path.join(cache, market, plugin, ver, 'skills'), 'plugin', `${plugin}:`);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const MAX_SKILL_BYTES = 20_000_000;

/** Copy a skill folder into <project>/.claude/skills/<name>. Returns the name. Throws with a one-line reason. */
export function addSkill(project: string, from: string): string {
  const text = read(path.join(from, 'SKILL.md'));
  if (text === null) throw new Error('that folder has no SKILL.md');
  const name = cleanSkillName(skillHeader(text).name || path.basename(from));
  if (!name) throw new Error('the skill has no usable name');
  const to = path.join(project, '.claude', 'skills', name);
  if (fs.existsSync(to)) throw new Error(`a skill named "${name}" is already in this project`);
  let total = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isSymbolicLink()) throw new Error('the folder holds links; copy it by hand if you trust it');
      if (e.isDirectory()) walk(f);
      else if ((total += fs.statSync(f).size) > MAX_SKILL_BYTES) throw new Error('the folder is larger than 20 MB');
    }
  };
  walk(from);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
  return name;
}
