import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  start: (cols: number, rows: number) => ipcRenderer.send('start', cols, rows),
  write: (data: string) => ipcRenderer.send('pty-write', data),
  resize: (cols: number, rows: number) => ipcRenderer.send('pty-resize', cols, rows),
  send: (text: string) => ipcRenderer.send('chat-send', text),
  onChat: (cb: (chat: unknown) => void) => ipcRenderer.on('chat', (_e, c) => cb(c)),
  branch: (replyId?: string, from?: string) => ipcRenderer.send('branch', replyId, from),
  retry: (replyId: string) => ipcRenderer.send('retry', replyId),
  copy: (text: string) => ipcRenderer.send('copy', text),
  onNote: (cb: (text: string) => void) => ipcRenderer.on('note', (_e, t) => cb(t)),
  onPrefill: (cb: (text: string) => void) => ipcRenderer.on('prefill', (_e, t) => cb(t)),
  openSession: (id: string) => ipcRenderer.send('open-session', id),
  onGraph: (cb: (graph: unknown) => void) => ipcRenderer.on('graph', (_e, g) => cb(g)),
  onToggleGraph: (cb: () => void) => ipcRenderer.on('toggle-graph', () => cb()),
  onTermReset: (cb: () => void) => ipcRenderer.on('term-reset', () => cb()),
  onToggleTerm: (cb: () => void) => ipcRenderer.on('toggle-term', () => cb()),
  onData: (cb: (data: string) => void) => ipcRenderer.on('pty-data', (_e, d) => cb(d)),
  onCards: (cb: (cards: unknown) => void) => ipcRenderer.on('cards', (_e, c) => cb(c)),
  onShowTerm: (cb: (why: string) => void) => ipcRenderer.on('show-term', (_e, w) => cb(w)),
  answerCard: (id: string, answer: unknown) => ipcRenderer.send('card-answer', id, answer),
  onDesign: (cb: (design: unknown, error: string | null) => void) => ipcRenderer.on('design', (_e, d, err) => cb(d, err)),
});
