import { contextBridge, ipcRenderer } from 'electron'
import type { Api, LoginStep } from '../shared/types'

const api: Api = {
  status: () => ipcRenderer.invoke('vault:status'),
  create: master => ipcRenderer.invoke('vault:create', master),
  unlock: master => ipcRenderer.invoke('vault:unlock', master),
  lock: () => ipcRenderer.invoke('vault:lock'),
  list: () => ipcRenderer.invoke('vault:list'),
  save: input => ipcRenderer.invoke('vault:save', input),
  remove: id => ipcRenderer.invoke('vault:remove', id),
  login: (id, launchGame, closeLeague) => ipcRenderer.invoke('riot:login', id, launchGame, closeLeague),
  cancelLogin: () => ipcRenderer.invoke('riot:cancel'),
  exportBackup: () => ipcRenderer.invoke('vault:export'),
  importBackup: () => ipcRenderer.invoke('vault:import'),
  onLoginStep(listener) {
    const wrapped = (_event: unknown, step: LoginStep): void => listener(step)
    ipcRenderer.on('riot:step', wrapped)
    return () => ipcRenderer.removeListener('riot:step', wrapped)
  },
  onLocked(listener) {
    const wrapped = (): void => listener()
    ipcRenderer.on('vault:locked', wrapped)
    return () => ipcRenderer.removeListener('vault:locked', wrapped)
  },
  windowControl: action => ipcRenderer.send('window:control', action),
}

contextBridge.exposeInMainWorld('api', api)
