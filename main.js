const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Store = require('./src/store');
const crypto = require('crypto');

let win;
let store;
let sessions = new Map(); // token => userId

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile('index.html');

  // 调试：需要时打开控制台
  // win.webContents.openDevTools();
}

app.whenReady().then(async () => {
  const userDataDir = app.getPath('userData');
  console.log('[DB]', path.join(userDataDir, 'db.json')); // 显示数据库文件位置
  store = new Store(path.join(userDataDir, 'db.json'));
  await store.init();
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- 帮助函数 ----
function makeToken() { return crypto.randomBytes(24).toString('hex'); }
function getUserId(payload) {
  const token = payload && payload.__token;
  if (!token) throw new Error('未登录');
  const uid = sessions.get(token);
  if (!uid) throw new Error('会话无效或已过期');
  return uid;
}
function ok(data) { return { ok: true, data }; }
function err(message, code = 'ERR') { return { ok: false, error: { code, message } }; }

// ---- IPC handlers ----
function registerIpcHandlers() {
  // Auth
  ipcMain.handle('auth:register', async (_e, { username, email, password }) => {
    try {
      const user = await store.registerUser({ username, email, password });
      const token = makeToken();
      sessions.set(token, user.id);
      return ok({ token, user });
    } catch (e) { return err(e.message); }
  });
  ipcMain.handle('auth:login', async (_e, { username, password }) => {
    try {
      const user = await store.loginUser({ username, password });
      const token = makeToken();
      sessions.set(token, user.id);
      return ok({ token, user });
    } catch (e) { return err(e.message); }
  });
  ipcMain.handle('auth:me', async (_e, payload) => {
    try { return ok(await store.getUser(getUserId(payload))); } catch (e) { return err(e.message); }
  });

  // Accounts
  ipcMain.handle('accounts:list', async (_e, payload) => {
    try { return ok(await store.listAccounts(getUserId(payload))); } catch (e) { return err(e.message); }
  });
  ipcMain.handle('accounts:create', async (_e, payload) => {
    try { return ok(await store.createAccount(getUserId(payload), payload)); } catch (e) { return err(e.message); }
  });
  ipcMain.handle('accounts:update', async (_e, payload) => {
    try { return ok(await store.updateAccount(getUserId(payload), payload.id, payload.dto)); } catch (e) { return err(e.message); }
  });
  ipcMain.handle('accounts:delete', async (_e, payload) => {
    try { return ok(await store.deleteAccount(getUserId(payload), payload.id)); } catch (e) { return err(e.message); }
  });

  // Categories
  ipcMain.handle('categories:list', async (_e, payload) => {
    try { return ok(await store.listCategories(getUserId(payload))); } catch (e) { return err(e.message); }
  });
  ipcMain.handle('categories:create', async (_e, payload) => {
    try { return ok(await store.createCategory(getUserId(payload), payload)); } catch (e) { return err(e.message); }
  });
  ipcMain.handle('categories:update', async (_e, payload) => {
    try { return ok(await store.updateCategory(getUserId(payload), payload.id, payload.dto)); } catch (e) { return err(e.message); }
  });
  ipcMain.handle('categories:delete', async (_e, payload) => {
    try { return ok(await store.deleteCategory(getUserId(payload), payload.id)); } catch (e) { return err(e.message); }
  });

  // Tags
  ipcMain.handle('tags:list', async (_e, payload) => {
    try { return ok(await store.listTags(getUserId(payload))); } catch (e) { return err(e.message); }
  });
  ipcMain.handle('tags:create', async (_e, payload) => {
    try { return ok(await store.createTag(getUserId(payload), payload)); } catch (e) { return err(e.message); }
  });
  ipcMain.handle('tags:update', async (_e, payload) => {
    try { return ok(await store.updateTag(getUserId(payload), payload.id, payload.dto)); } catch (e) { return err(e.message); }
  });
  ipcMain.handle('tags:delete', async (_e, payload) => {
    try { return ok(await store.deleteTag(getUserId(payload), payload.id)); } catch (e) { return err(e.message); }
  });

  // Transactions & Search
  ipcMain.handle('transactions:list', async (_e, payload) => {
    try { return ok(await store.listTransactions(getUserId(payload), payload)); } catch (e) { return err(e.message); }
  });
  ipcMain.handle('transactions:create', async (_e, payload) => {
    try { return ok(await store.createTransaction(getUserId(payload), payload)); } catch (e) { return err(e.message); }
  });
  ipcMain.handle('transactions:update', async (_e, payload) => {
    try { return ok(await store.updateTransaction(getUserId(payload), payload.id, payload.dto)); } catch (e) { return err(e.message); }
  });
  ipcMain.handle('transactions:delete', async (_e, payload) => {
    try { return ok(await store.deleteTransaction(getUserId(payload), payload.id)); } catch (e) { return err(e.message); }
  });
  ipcMain.handle('search:execute', async (_e, payload) => {
    try { return ok(await store.listTransactions(getUserId(payload), payload)); } catch (e) { return err(e.message); }
  });

  // Reports
  ipcMain.handle('reports:summary', async (_e, payload) => {
    try { return ok(await store.reportSummary(getUserId(payload), payload)); } catch (e) { return err(e.message); }
  });

  // Export / Import / Template
  ipcMain.handle('export:run', async (_e, payload) => {
    try { return ok(await store.exportData(getUserId(payload), payload.format, payload.filter || {})); } catch (e) { return err(e.message); }
  });
  ipcMain.handle('import:run', async (_e, payload) => {
    try { return ok(await store.importCsv(getUserId(payload), payload.csvText)); } catch (e) { return err(e.message); }
  });
  ipcMain.handle('import:template', async (_e, payload) => {
    try { return ok(store.importTemplate()); } catch (e) { return err(e.message); }
  });
}
