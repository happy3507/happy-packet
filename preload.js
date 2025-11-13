const { contextBridge, ipcRenderer } = require('electron');

let sessionToken = null;
function invoke(channel, payload = {}) {
  if (sessionToken) payload.__token = sessionToken;
  return ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld('api', {
  auth: {
    register: (username, email, password) => invoke('auth:register', { username, email, password }),
    login: (username, password) => invoke('auth:login', { username, password }),
    logout: () => { sessionToken = null; return Promise.resolve({ ok: true }); },
    me: () => invoke('auth:me'),
    setToken: (t) => { sessionToken = t; },
    update: (dto) => invoke('auth:update', dto),
    password: (oldPassword, newPassword) => invoke('auth:password', { oldPassword, newPassword })
  },
  accounts: {
    list: () => invoke('accounts:list'),
    create: (dto) => invoke('accounts:create', dto),
    update: (id, dto) => invoke('accounts:update', { id, dto }),
    delete: (id) => invoke('accounts:delete', { id })
  },
  categories: {
    list: () => invoke('categories:list'),
    create: (dto) => invoke('categories:create', dto),
    update: (id, dto) => invoke('categories:update', { id, dto }),
    delete: (id) => invoke('categories:delete', { id })
  },
  tags: {
    list: () => invoke('tags:list'),
    create: (dto) => invoke('tags:create', dto),
    update: (id, dto) => invoke('tags:update', { id, dto }),
    delete: (id) => invoke('tags:delete', { id })
  },
  transactions: {
    list: (filter) => invoke('transactions:list', filter || {}),
    create: (dto) => invoke('transactions:create', dto),
    update: (id, dto) => invoke('transactions:update', { id, dto }),
    delete: (id) => invoke('transactions:delete', { id })
  },
  search: {
    execute: (filter) => invoke('search:execute', filter || {})
  },
  reports: {
    summary: (opts) => invoke('reports:summary', opts)
  },
  export: {
    run: (opts) => invoke('export:run', opts)
  },
  import: {
    run: (opts) => invoke('import:run', opts),
    template: () => invoke('import:template')
  }
});