// Builds out/Clade.app (macOS, Apple silicon). Run: npm run package (it compiles first).
// The app is a copy: changes to src/ reach it only after running this again.
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out');
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });

// 1. assets/icon.png → out/icon.icns, with the tools macOS ships (sips, iconutil).
fs.rmSync(out, { recursive: true, force: true });
const iconset = path.join(out, 'icon.iconset');
fs.mkdirSync(iconset, { recursive: true });
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const px = String(size * scale);
    const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
    run('sips', ['-z', px, px, path.join(root, 'assets', 'icon.png'), '--out', path.join(iconset, name)]);
  }
}
const icns = path.join(out, 'icon.icns');
run('iconutil', ['-c', 'icns', iconset, '-o', icns]);

// 2. The app. No asar: index.html loads scripts from node_modules/ paths, node-pty needs its
// spawn-helper as a real file, and the permission hook runs dist/hook.js by its path.
const keep = /^\/(dist|node_modules|assets|index\.html|app\.css|tokens\.css|help\.md|package\.json)(\/|$)/;
// node-pty parts this app never loads: Windows prebuilds and the C++ sources for building it.
const unused = /^\/node_modules\/node-pty\/(prebuilds\/(win32|linux)-[^/]+|deps|third_party|src)(\/|$)/;
const [built] = await packager({
  dir: root,
  out,
  name: 'Clade',
  platform: 'darwin',
  arch: 'arm64',
  icon: icns,
  appBundleId: 'com.clade.app',
  appCategoryType: 'public.app-category.developer-tools',
  asar: false,
  prune: true, // devDependencies (electron, typescript, packager...) are left out
  overwrite: true,
  quiet: true,
  ignore: (p) => p !== '' && (!keep.test(p) || /\.test\.js$|stream\.fixtures\.js$/.test(p) || unused.test(p)),
});

// 3. Move to out/Clade.app and sign ad hoc (enough to run on this Mac; not notarized).
const app = path.join(out, 'Clade.app');
fs.renameSync(path.join(built, 'Clade.app'), app);
fs.rmSync(built, { recursive: true, force: true });
fs.rmSync(iconset, { recursive: true, force: true });
fs.rmSync(icns, { force: true });
run('codesign', ['--force', '--deep', '--sign', '-', app]);
console.log(`\nBuilt ${path.relative(root, app)}. Drag it into /Applications.`);
