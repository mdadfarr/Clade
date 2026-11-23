// The chats folder the app opens at launch: the last one picked, saved in a small JSON file in the
// app's data folder. No Electron here: every path comes in as an argument, so this ports as it is.
import * as fs from 'fs';
import * as path from 'path';

const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** The saved folder, or null when there is none, the file is broken, or the folder is gone. */
export function readSavedFolder(file: string): string | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    const dir = v && typeof v === 'object' ? (v as { folder?: unknown }).folder : undefined;
    return typeof dir === 'string' && path.isAbsolute(dir) && isDir(dir) ? dir : null;
  } catch {
    return null;
  }
}

/** Saves the folder (written to a temp file, then renamed, so a crash never leaves half a file). */
export function saveFolder(file: string, dir: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ folder: path.resolve(dir) }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** The folder to open at launch: a folder given on the command line, else the saved one, else null
 *  (the caller then shows the folder dialog). */
export function pickStartFolder(o: { arg?: string | null; saved: string | null }): string | null {
  if (o.arg && isDir(o.arg)) return path.resolve(o.arg);
  return o.saved;
}
