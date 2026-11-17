import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addSkill, cleanSkillName, listSkills, mergeSkillSwitch, skillHeader, skillOverrides } from './skills';
const C = require('./composer');

const chip = (p: string, size = 10, dir = false) => ({ path: p, name: p.slice(p.lastIndexOf('/') + 1), size, dir });

test('attach: only paths are sent, as mentions before the message', () => {
  assert.strictEqual(C.buildMessage('what is this?', [chip('/a/b.txt')]), '@/a/b.txt what is this?');
  assert.strictEqual(C.buildMessage(' compare ', [chip('/a/b.txt'), chip('/my docs/sea life.pdf')]), '@/a/b.txt @"/my docs/sea life.pdf" compare');
  assert.strictEqual(C.buildMessage('line one\nline two', [chip('/a/b.txt')]), '@/a/b.txt line one\nline two');
  assert.strictEqual(C.buildMessage('', [chip('/a/b.txt')]), '@/a/b.txt');
  assert.strictEqual(C.buildMessage('hi', []), 'hi');
});

test('attach: a path that cannot be a mention goes on its own line', () => {
  assert.strictEqual(C.mention('/a/we"ird.txt'), null);
  assert.strictEqual(C.mention('relative.txt'), null);
  assert.strictEqual(C.mention('/a/b\nc'), null);
  assert.strictEqual(C.buildMessage('look', [chip('/a/we"ird.txt'), chip('/ok.md')]), '@/ok.md look\nAttached file: /a/we"ird.txt');
  assert.ok(!C.buildMessage('x', [chip('/a/b\nrm -rf.txt')]).includes('\nrm')); // a line break in a name can not start a new line
});

test('attach: kinds, warnings, sizes, limits', () => {
  assert.deepStrictEqual(['a.PNG', 'a.pdf', 'a.zip', 'a.ts', 'Makefile', 'a.docx', 'a.mp4'].map((n) => C.fileKind({ name: n, dir: false })), ['image', 'pdf', 'unreadable', 'text', 'text', 'unreadable', 'unreadable']);
  assert.strictEqual(C.fileKind({ name: 'src', dir: true }), 'folder');
  assert.strictEqual(C.chipWarning(chip('/a.txt', 100)), '');
  assert.match(C.chipWarning(chip('/a.pdf', C.BIG_FILE + 1)), /Large file/);
  assert.match(C.chipWarning(chip('/a.zip', 5)), /cannot read this type/);
  assert.deepStrictEqual([C.sizeText(900), C.sizeText(45_000), C.sizeText(2_400_000), C.sizeText(31_000_000)], ['900 B', '45 KB', '2.4 MB', '31 MB']);
  const many = Array.from({ length: 30 }, (_, i) => chip(`/f${i}.txt`));
  assert.strictEqual(C.addChips([], many).length, C.MAX_CHIPS);
  assert.strictEqual(C.addChips([chip('/a')], [chip('/a'), chip('/b')]).length, 2); // no doubles
});

test('attach: pasted image file names', () => {
  const when = new Date(2026, 10, 16, 23, 5, 2);
  assert.strictEqual(C.pastedName('image/png', when, 1), 'pasted-20261116-230502-1.png');
  assert.strictEqual(C.pastedName('image/jpeg', when, 12), 'pasted-20261116-230502-12.jpg');
  assert.strictEqual(C.pastedName('text/html', when, 1), null);
  assert.strictEqual(C.pastedName('image/svg+xml', when, 1), null);
});

test('skills: header, names, switch', () => {
  assert.deepStrictEqual(skillHeader('---\nname: pdf-tools\ndescription: "Work with PDF files"\n---\nbody'), { name: 'pdf-tools', description: 'Work with PDF files' });
  assert.deepStrictEqual(skillHeader('no header\nname: x'), { name: '', description: '' });
  assert.deepStrictEqual(skillHeader('---\ndescription: only this\n---'), { name: '', description: 'only this' });
  assert.strictEqual(cleanSkillName('My Skill (v2)!'), 'my-skill-v2');
  assert.strictEqual(cleanSkillName('../..'), '');
  const off = mergeSkillSwitch('{"hooks":{"x":1},"permissions":{"allow":["a"]}}', 'pdf-tools', false);
  assert.deepStrictEqual(JSON.parse(off), { hooks: { x: 1 }, permissions: { allow: ['a'] }, skillOverrides: { 'pdf-tools': 'off' } });
  assert.deepStrictEqual(skillOverrides(off), { 'pdf-tools': 'off' });
  assert.deepStrictEqual(JSON.parse(mergeSkillSwitch(off, 'pdf-tools', true)), { hooks: { x: 1 }, permissions: { allow: ['a'] } }); // on = no entry
  assert.deepStrictEqual(JSON.parse(mergeSkillSwitch(null, 'a', false)), { skillOverrides: { a: 'off' } });
  assert.throws(() => mergeSkillSwitch('{ nope', 'a', false), /bad JSON/);
});

test('skills: listing and adding touch only the project', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clade-skills-'));
  try {
    const project = path.join(tmp, 'proj');
    const home = path.join(tmp, 'home');
    const mk = (dir: string, text: string) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), text);
    };
    mk(path.join(home, '.claude', 'skills', 'cv'), '---\nname: cv\ndescription: Home skill\n---');
    mk(path.join(home, '.claude', 'plugins', 'cache', 'mk', 'tools', '1.0', 'skills', 'lint'), '---\nname: lint\ndescription: Plugin skill\n---');
    mk(path.join(tmp, 'incoming', 'My Skill'), '---\nname: My Skill\ndescription: To add\n---');
    fs.writeFileSync(path.join(tmp, 'incoming', 'My Skill', 'extra.txt'), 'x');
    fs.mkdirSync(path.join(tmp, 'empty'));
    assert.strictEqual(addSkill(project, path.join(tmp, 'incoming', 'My Skill')), 'my-skill');
    assert.ok(fs.existsSync(path.join(project, '.claude', 'skills', 'my-skill', 'extra.txt')));
    assert.throws(() => addSkill(project, path.join(tmp, 'incoming', 'My Skill')), /already in this project/); // never overwrites
    assert.throws(() => addSkill(project, path.join(tmp, 'empty')), /no SKILL\.md/);
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(project, '.claude', 'settings.local.json'), mergeSkillSwitch(null, 'cv', false));
    assert.deepStrictEqual(
      listSkills(project, home).map((s) => [s.name, s.where, s.on, s.canSwitch]),
      [['cv', 'home', false, true], ['My Skill', 'project', true, true], ['tools:lint', 'plugin', true, false]],
    );
    assert.deepStrictEqual(fs.readdirSync(path.join(home, '.claude', 'skills')), ['cv']); // the home folder was only read
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
