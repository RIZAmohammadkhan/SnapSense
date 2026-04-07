const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snapsense', {
  onCaptureInit: (fn) => {
    const handler = (_, payload) => fn(payload);
    ipcRenderer.on('capture-init', handler);
    return () => ipcRenderer.removeListener('capture-init', handler);
  },
  sendCaptureResult: (payload) => ipcRenderer.send('capture-result', payload),
  sendCaptureCancel: () => ipcRenderer.send('capture-cancel'),

  onModeStripInit: (fn) => {
    const handler = (_, payload) => fn(payload);
    ipcRenderer.on('mode-strip-init', handler);
    return () => ipcRenderer.removeListener('mode-strip-init', handler);
  },
  sendCaptureMode: (mode) => ipcRenderer.send('capture-mode-selected', mode),

  onPanelOpen: (fn) => {
    const handler = (_, payload) => fn(payload);
    ipcRenderer.on('panel-open', handler);
    return () => ipcRenderer.removeListener('panel-open', handler);
  },
  panelChat: async (messages) => {
    const r = await ipcRenderer.invoke('openai-chat', { messages });
    if (r && r.error) {
      throw new Error(r.error);
    }
    return r;
  },
  extractText: async (imageDataUrl) => {
    const r = await ipcRenderer.invoke('extract-text', { imageDataUrl });
    if (r && r.error) {
      throw new Error(r.error);
    }
    return r;
  },
  createLensSession: async (imageDataUrl) => {
    const r = await ipcRenderer.invoke('lens-upload', { imageDataUrl });
    if (r && r.error) {
      throw new Error(r.error);
    }
    return r;
  },
  openExternal: (url) => ipcRenderer.invoke('open-external', { url }),
  openLensInBrowser: (imageDataUrl) => ipcRenderer.invoke('open-lens-in-browser', { imageDataUrl }),
  getApiKeyStatus: () => ipcRenderer.invoke('get-api-key-status'),
  getGroqKeyState: () => ipcRenderer.invoke('get-groq-key-state'),
  saveGroqKey: (key) => ipcRenderer.invoke('save-groq-key', { key }),
  clearGroqKey: () => ipcRenderer.invoke('clear-groq-key'),
  getModelMode: () => ipcRenderer.invoke('get-model-mode'),
  setModelMode: (mode) => ipcRenderer.invoke('set-model-mode', { mode }),
  closePanel: () => ipcRenderer.send('panel-close')
});
