import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  start: (cols: number, rows: number) => ipcRenderer.send('start', cols, rows),
  write: (data: string) => ipcRenderer.send('pty-write', data),
  resize: (cols: number, rows: number) => ipcRenderer.send('pty-resize', cols, rows),
  send: (text: string) => ipcRenderer.send('chat-send', text),
  onChat: (cb: (chat: unknown) => void) => ipcRenderer.on('chat', (_e, c) => cb(c)),
  branch: () => ipcRenderer.send('branch'),
  openSession: (id: string) => ipcRenderer.send('open-session', id),
  onTree: (cb: (tree: unknown) => void) => ipcRenderer.on('tree', (_e, t) => cb(t)),
  onTermReset: (cb: () => void) => ipcRenderer.on('term-reset', () => cb()),
  onToggleTerm: (cb: () => void) => ipcRenderer.on('toggle-term', () => cb()),
  onData: (cb: (data: string) => void) => ipcRenderer.on('pty-data', (_e, d) => cb(d)),
  onDesign: (cb: (design: unknown, error: string | null) => void) => ipcRenderer.on('design', (_e, d, err) => cb(d, err)),
});
