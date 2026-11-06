const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('debugWorkspace', {
  action: (action, input) => ipcRenderer.invoke('workspace:action', action, input),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('workspace:state', listener);
    return () => ipcRenderer.removeListener('workspace:state', listener);
  }
});
