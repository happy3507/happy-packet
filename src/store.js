const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const TransactionType = { INCOME: 'INCOME', EXPENSE: 'EXPENSE', TRANSFER: 'TRANSFER' };

class Store {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.dbDir = path.dirname(dbPath);
    this.db = null;
  }

  async init() {
    if (!fsSync.existsSync(this.dbDir)) fsSync.mkdirSync(this.dbDir, { recursive: true });
    if (!fsSync.existsSync(this.dbPath)) {
      this.db = this.defaultDb();
      await this.save();
    } else {
      const buf = await fs.readFile(this.dbPath, 'utf-8');
      this.db = JSON.parse(buf || '{}');
      this.db = { ...this.defaultDb(), ...this.db };
      const changed1 = this.migrateDefaultAccounts?.() || false;
      const changed2 = this.migrateMergeOldCash?.() || false;
      if (changed1 || changed2) await this.save(); else await this.save();
    }
  }

  defaultDb() {
    const now = new Date().toISOString();
    return {
      meta: { version: 2, createdAt: now, updatedAt: now, nextId: 100 },
      users: [], // {id,username,email,passwordHash,displayName,locale,createdAt,updatedAt}
      accounts: [],
      categories: [],
      tags: [],
      transactions: [],
      transactionTags: []
    };
  }

  async save() {
    this.db.meta.updatedAt = new Date().toISOString();
    await fs.writeFile(this.dbPath, JSON.stringify(this.db, null, 2), 'utf-8');
  }
  nextId() { return this.db.meta.nextId++; }

  // ===== Users =====
  async registerUser({ username, email, password }) {
    if (!username || !password) throw new Error('用户名和密码必填');
    if (this.db.users.some(u => u.username === username)) throw new Error('用户名已存在');
    const now = new Date().toISOString();
    const hash = await bcrypt.hash(password, 10);
    const user = {
      id: this.nextId(),
      username,
      email: email || '',
      passwordHash: hash,
      displayName: username,
      locale: 'zh-CN',
      createdAt: now,
      updatedAt: now
    };
    this.db.users.push(user);
    // 默认账户：现金 + 银行卡
    this.db.accounts.push({ id: this.nextId(), userId: user.id, name: '现金', balance: 0, currency: 'CNY', createdAt: now, updatedAt: now });
    this.db.accounts.push({ id: this.nextId(), userId: user.id, name: '银行卡', balance: 0, currency: 'CNY', createdAt: now, updatedAt: now });
    this.db.categories.push({ id: this.nextId(), userId: user.id, name: '餐饮', type: 'expense', color: '#F87171', createdAt: now, updatedAt: now });
    this.db.categories.push({ id: this.nextId(), userId: user.id, name: '工资', type: 'income', color: '#34D399', createdAt: now, updatedAt: now });
    await this.save();
    return this.stripUser(user);
  }

  async loginUser({ username, password }) {
    const user = this.db.users.find(u => u.username === username);
    if (!user) throw new Error('用户不存在');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new Error('密码错误');
    return this.stripUser(user);
  }

  async getUser(userId) {
    const user = this.db.users.find(u => u.id === userId);
    if (!user) throw new Error('用户不存在');
    return this.stripUser(user);
  }

  stripUser(u) { const { passwordHash, ...rest } = u; return rest; }

  // ===== Accounts =====
  async listAccounts(userId) { return this.db.accounts.filter(a => a.userId === userId); }
  async createAccount(userId, { name, currency = 'CNY' }) {
    if (!name) throw new Error('账户名称必填');
    const now = new Date().toISOString();
    const row = { id: this.nextId(), userId, name, balance: 0, currency, createdAt: now, updatedAt: now };
    this.db.accounts.push(row);
    await this.save();
    return row;
  }
  async updateAccount(userId, id, patch) {
    const acc = this.db.accounts.find(a => a.id === id && a.userId === userId);
    if (!acc) throw new Error('账户不存在');
    Object.assign(acc, patch, { updatedAt: new Date().toISOString() });
    await this.save();
    return acc;
  }
  async deleteAccount(userId, id) {
    if (this.db.transactions.some(t => t.accountId === id && t.userId === userId)) throw new Error('账户存在交易，无法删除');
    const before = this.db.accounts.length;
    this.db.accounts = this.db.accounts.filter(a => !(a.id === id && a.userId === userId));
    if (this.db.accounts.length === before) throw new Error('账户不存在');
    await this.save();
    return true;
  }

  // ===== Categories =====
  async listCategories(userId) { return this.db.categories.filter(c => c.userId === userId); }
  async createCategory(userId, { name, type = 'expense', color = '#60A5FA' }) {
    if (!name) throw new Error('分类名称必填');
    if (!['income', 'expense'].includes(type)) throw new Error('分类类型不合法');
    const now = new Date().toISOString();
    const row = { id: this.nextId(), userId, name, type, color, createdAt: now, updatedAt: now };
    this.db.categories.push(row);
    await this.save();
    return row;
  }
  async updateCategory(userId, id, patch) {
    const cat = this.db.categories.find(c => c.id === id && c.userId === userId);
    if (!cat) throw new Error('分类不存在');
    Object.assign(cat, patch, { updatedAt: new Date().toISOString() });
    await this.save();
    return cat;
  }
  async deleteCategory(userId, id) {
    if (this.db.transactions.some(t => t.categoryId === id && t.userId === userId)) throw new Error('分类存在交易，无法删除');
    const before = this.db.categories.length;
    this.db.categories = this.db.categories.filter(c => !(c.id === id && c.userId === userId));
    if (this.db.categories.length === before) throw new Error('分类不存在');
    await this.save();
    return true;
  }

  // ===== Tags =====
  async listTags(userId) { return this.db.tags.filter(t => t.userId === userId); }
  async createTag(userId, { name }) {
    if (!name) throw new Error('标签名称必填');
    const now = new Date().toISOString();
    const row = { id: this.nextId(), userId, name, createdAt: now, updatedAt: now };
    this.db.tags.push(row);
    await this.save();
    return row;
  }
  async updateTag(userId, id, patch) {
    const tag = this.db.tags.find(t => t.id === id && t.userId === userId);
    if (!tag) throw new Error('标签不存在');
    Object.assign(tag, patch, { updatedAt: new Date().toISOString() });
    await this.save();
    return tag;
  }
  async deleteTag(userId, id) {
    this.db.transactionTags = this.db.transactionTags.filter(tt => !(tt.tagId === id && tt.userId === userId));
    const before = this.db.tags.length;
    this.db.tags = this.db.tags.filter(t => !(t.id === id && t.userId === userId));
    if (this.db.tags.length === before) throw new Error('标签不存在');
    await this.save();
    return true;
  }

  // ===== Transactions =====
  async listTransactions(userId, { keyword, fromDate, toDate, accountId, tagId, tagIds } = {}) {
    let rows = this.db.transactions.filter(t => t.userId === userId);
    if (fromDate) rows = rows.filter(t => t.date >= fromDate);
    if (toDate) rows = rows.filter(t => t.date <= toDate);
    if (accountId) rows = rows.filter(t => t.accountId === Number(accountId));
    const tagSet = new Set(
      Array.isArray(tagIds) ? tagIds.map(n => Number(n)) :
      (tagId != null && tagId !== '' ? [Number(tagId)] : [])
    );
    if (tagSet.size) {
      const matchedTxIds = new Set(
        this.db.transactionTags
          .filter(tt => tt.userId === userId && tagSet.has(Number(tt.tagId)))
          .map(tt => tt.transactionId)
      );
      rows = rows.filter(t => matchedTxIds.has(t.id));
    }
    if (keyword && String(keyword).trim()) {
      const q = String(keyword).toLowerCase();
      // 建立 tagId -> tagName 映射
      const tagNameMap = new Map(
        this.db.tags
          .filter(t => t.userId === userId)
          .map(t => [t.id, (t.name || '').toLowerCase()])
      );
      // 预处理每条交易的标签名称数组
      const txTagNamesMap = new Map();
      for (const tt of this.db.transactionTags) {
        if (tt.userId !== userId) continue;
        const arr = txTagNamesMap.get(tt.transactionId) || [];
        const name = tagNameMap.get(tt.tagId);
        if (name) arr.push(name);
        txTagNamesMap.set(tt.transactionId, arr);
      }
      rows = rows.filter(t => {
        const note = (t.note || '').toLowerCase();
        const type = (t.type || '').toLowerCase();
        const tagNames = txTagNamesMap.get(t.id) || [];
        // 匹配条件：备注/类型 中包含关键词 或 任意标签名包含关键词
        return note.includes(q) || type.includes(q) || tagNames.some(n => n.includes(q));
      });
    }
    return rows
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(t => ({
        ...t,
        tags: this.db.transactionTags
          .filter(tt => tt.userId === userId && tt.transactionId === t.id)
          .map(tt => tt.tagId)
      }));
  }

  async createTransaction(userId, dto) {
    const { date, amount, categoryId = null, accountId, type, currency = 'CNY', note = '', tagIds = [], cleared = true } = dto;
    if (!date) throw new Error('日期必填');
    if (typeof amount !== 'number' || isNaN(amount) || amount === 0) throw new Error('金额必须为非零数字');
    if (![TransactionType.INCOME, TransactionType.EXPENSE].includes(type)) throw new Error('仅支持 INCOME / EXPENSE');
    const acc = this.db.accounts.find(a => a.id === accountId && a.userId === userId);
    if (!acc) throw new Error('账户不存在');
    // 分类已废弃，可为空；若传了 id 则校验存在
    if (categoryId != null) {
      const cat = this.db.categories.find(c => c.id === categoryId && c.userId === userId);
      if (!cat) throw new Error('分类不存在(可不传 categoryId)');
    }

    const now = new Date().toISOString();
    const row = {
      id: this.nextId(),
      userId,
      accountId,
      categoryId: categoryId ?? null,
      date,
      amount: round2(amount),
      type, currency, note, cleared,
      createdAt: now, updatedAt: now
    };
    this.db.transactions.push(row);

    for (const tid of (tagIds || [])) {
      this.db.transactionTags.push({ transactionId: row.id, tagId: tid, userId });
    }

    if (type === TransactionType.INCOME) acc.balance = round2(acc.balance + row.amount);
    if (type === TransactionType.EXPENSE) acc.balance = round2(acc.balance - row.amount);
    acc.updatedAt = now;

    await this.save();
    return { ...row, tags: tagIds || [] };
  }

  async updateTransaction(userId, id, patch) {
    const tx = this.db.transactions.find(t => t.id === id && t.userId === userId);
    if (!tx) throw new Error('交易不存在');

    // 回冲旧余额
    const accOld = this.db.accounts.find(a => a.id === tx.accountId && a.userId === userId);
    if (tx.type === TransactionType.INCOME) accOld.balance = round2(accOld.balance - tx.amount);
    if (tx.type === TransactionType.EXPENSE) accOld.balance = round2(accOld.balance + tx.amount);

    const merged = { ...tx, ...patch, updatedAt: new Date().toISOString() };
    if (!merged.date) throw new Error('日期必填');
    if (typeof merged.amount !== 'number' || isNaN(merged.amount) || merged.amount === 0) throw new Error('金额必须为非零数字');
    const accNew = this.db.accounts.find(a => a.id === merged.accountId && a.userId === userId);
    if (!accNew) throw new Error('账户不存在');
    if (merged.categoryId != null) {
      const cat = this.db.categories.find(c => c.id === merged.categoryId && c.userId === userId);
      if (!cat) throw new Error('分类不存在(可不传)');
    }

    Object.assign(tx, merged);

    if (Array.isArray(patch.tagIds)) {
      this.db.transactionTags = this.db.transactionTags.filter(tt => !(tt.transactionId === id && tt.userId === userId));
      for (const tid of patch.tagIds) this.db.transactionTags.push({ transactionId: id, tagId: tid, userId });
    }

    if (tx.type === TransactionType.INCOME) accNew.balance = round2(accNew.balance + tx.amount);
    if (tx.type === TransactionType.EXPENSE) accNew.balance = round2(accNew.balance - tx.amount);

    await this.save();
    return { ...tx, tags: this.db.transactionTags.filter(tt => tt.transactionId === id && tt.userId === userId).map(tt => tt.tagId) };
  }

  async deleteTransaction(userId, id) {
    const tx = this.db.transactions.find(t => t.id === id && t.userId === userId);
    if (!tx) throw new Error('交易不存在');
    const acc = this.db.accounts.find(a => a.id === tx.accountId && a.userId === userId);
    if (tx.type === TransactionType.INCOME) acc.balance = round2(acc.balance - tx.amount);
    if (tx.type === TransactionType.EXPENSE) acc.balance = round2(acc.balance + tx.amount);
    this.db.transactions = this.db.transactions.filter(t => !(t.id === id && t.userId === userId));
    this.db.transactionTags = this.db.transactionTags.filter(tt => !(tt.transactionId === id && tt.userId === userId));
    await this.save();
    return true;
  }

  // ===== Reports =====
  async reportSummary(userId, { fromDate, toDate, groupBy = 'category' }) {
    const rows = await this.listTransactions(userId, { fromDate, toDate });
    const groups = {};
    const keyFn = {
      category: (t) => String(t.categoryId),
      account: (t) => String(t.accountId),
      month: (t) => t.date.slice(0, 7)
    }[groupBy] || ((t) => String(t.categoryId));

    for (const t of rows) {
      const k = keyFn(t);
      if (!groups[k]) groups[k] = { income: 0, expense: 0, count: 0 };
      if (t.type === TransactionType.INCOME) groups[k].income = round2(groups[k].income + t.amount);
      if (t.type === TransactionType.EXPENSE) groups[k].expense = round2(groups[k].expense + t.amount);
      groups[k].count += 1;
    }
    return { groupBy, groups };
  }

  // ===== Export =====
  async exportData(userId, format = 'CSV', filter = {}) {
    const rows = await this.listTransactions(userId, filter);
    if (String(format).toUpperCase() === 'JSON') {
      return { mime: 'application/json', content: JSON.stringify(rows, null, 2) };
    }
    const header = ['id','date','type','amount','currency','accountId','categoryId','note','tagIds'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const tagIds = (r.tags || []).join('|');
      lines.push([r.id, r.date, r.type, r.amount, r.currency, r.accountId, r.categoryId, csvEsc(r.note || ''), csvEsc(tagIds)].join(','));
    }
    return { mime: 'text/csv', content: lines.join('\n') };
  }

  // ===== Import Template =====
  importTemplate() {
    return {
      header: 'date,type,amount,accountName,categoryName,tagNames,note',
      example: [
        '2025-01-01,EXPENSE,12.50,默认现金,餐饮,早餐|外卖,早餐外卖',
        '2025-01-02,INCOME,8000.00,默认现金,工资,一月|公司,一月工资'
      ].join('\n'),
      hint: 'tagNames 用 | 分隔；不存在的账户/分类/标签会自动创建'
    };
  }

  // ===== Import (dynamic create) =====
  async importCsv(userId, csvText) {
    const lines = csvText.split(/\r?\n/).filter(Boolean);
    if (!lines.length) throw new Error('CSV为空');
    const headerLine = lines[0];
    const cols = headerLine.split(',').map(s => s.trim());
    const required = ['date','type','amount','accountName','categoryName'];
    for (const c of required) if (!cols.includes(c)) throw new Error(`缺少列: ${c}`);
    const idx = (name) => cols.indexOf(name);
    const results = { total: lines.length - 1, success: 0, fail: 0, errors: [] };

    for (let i = 1; i < lines.length; i++) {
      const rawArr = parseCsvLine(lines[i], cols.length);
      try {
        const dtoRaw = {
          date: rawArr[idx('date')],
          type: rawArr[idx('type')],
          amount: parseFloat(rawArr[idx('amount')]),
          accountName: rawArr[idx('accountName')],
          categoryName: rawArr[idx('categoryName')],
          tagNames: (rawArr[idx('tagNames')] || '').split('|').filter(Boolean),
          note: rawArr[idx('note')] || ''
        };
        if (!dtoRaw.date || isNaN(dtoRaw.amount)) throw new Error('日期或金额不合法');

        // 找或建账户
        let account = this.db.accounts.find(a => a.userId === userId && a.name === dtoRaw.accountName);
        if (!account) {
          account = { id: this.nextId(), userId, name: dtoRaw.accountName || '新账户', balance: 0, currency: 'CNY', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          this.db.accounts.push(account);
        }
        // 找或建分类（默认根据金额类型推断 type）
        let category = this.db.categories.find(c => c.userId === userId && c.name === dtoRaw.categoryName);
        if (!category) {
          const typeGuess = dtoRaw.type === 'INCOME' ? 'income' : 'expense';
          category = { id: this.nextId(), userId, name: dtoRaw.categoryName || '新分类', type: typeGuess, color: '#60A5FA', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          this.db.categories.push(category);
        }
        // 标签批量建
        const tagIds = [];
        for (const name of dtoRaw.tagNames) {
          let tag = this.db.tags.find(t => t.userId === userId && t.name === name);
          if (!tag) {
            tag = { id: this.nextId(), userId, name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            this.db.tags.push(tag);
          }
          tagIds.push(tag.id);
        }

        await this.createTransaction(userId, {
          date: dtoRaw.date,
            type: dtoRaw.type,
            amount: dtoRaw.amount,
            accountId: account.id,
            categoryId: category.id,
            note: dtoRaw.note,
            tagIds
        });
        results.success++;
      } catch (e) {
        results.fail++;
        results.errors.push({ row: i + 1, message: e.message });
      }
    }
    await this.save();
    return results;
  }

  // 迁移：把旧库里每位用户的“默认现金”改为“现金”，并确保存在“银行卡”
  migrateDefaultAccounts() {
    let touched = false;
    const now = new Date().toISOString();
    for (const u of this.db.users) {
      const uid = u.id;
      const mine = this.db.accounts.filter(a => a.userId === uid);
      // 重命名第一个“默认现金”为“现金”
      const defaults = mine.filter(a => a.name === '默认现金');
      if (defaults.length) {
        // 若已存在“现金”，只把“默认现金”重命名为“现金(旧)”
        const hasCash = mine.some(a => a.name === '现金');
        if (!hasCash) {
          defaults[0].name = '现金';
          defaults[0].updatedAt = now;
          touched = true;
        } else {
          defaults.forEach((a, idx) => {
            a.name = idx === 0 ? '现金(旧)' : `现金(旧${idx})`;
            a.updatedAt = now;
            touched = true;
          });
        }
      }
      // 确保存在“现金”
      const hasCash2 = this.db.accounts.some(a => a.userId === uid && a.name === '现金');
      if (!hasCash2) {
        this.db.accounts.push({ id: this.nextId(), userId: uid, name: '现金', balance: 0, currency: 'CNY', createdAt: now, updatedAt: now });
        touched = true;
      }
      // 确保存在“银行卡”
      const hasCard = this.db.accounts.some(a => a.userId === uid && a.name === '银行卡');
      if (!hasCard) {
        this.db.accounts.push({ id: this.nextId(), userId: uid, name: '银行卡', balance: 0, currency: 'CNY', createdAt: now, updatedAt: now });
        touched = true;
      }
    }
    return touched;
  }

  // 将“现金(旧)”账户全部并入“现金”，随后删除旧账户并重算余额
  migrateMergeOldCash() {
    let touched = false;
    const now = new Date().toISOString();
    const isOldCash = (name) => typeof name === 'string' && (name === '现金(旧)' || name.startsWith('现金(旧'));
    for (const u of this.db.users) {
      const uid = u.id;
      const cash = this.db.accounts.find(a => a.userId === uid && a.name === '现金');
      if (!cash) continue;
      const olds = this.db.accounts.filter(a => a.userId === uid && isOldCash(a.name));
      if (!olds.length) continue;
      const oldIds = new Set(olds.map(a => a.id));
      // 迁移交易到账户“现金”
      for (const t of this.db.transactions) {
        if (t.userId === uid && oldIds.has(t.accountId)) {
          t.accountId = cash.id;
          t.updatedAt = now;
          touched = true;
        }
      }
      // 删除旧账户
      this.db.accounts = this.db.accounts.filter(a => !(a.userId === uid && oldIds.has(a.id)));
      touched = true;
    }
    if (touched) this.recomputeBalances();
    return touched;
  }

  // 根据交易重算所有账户余额
  recomputeBalances() {
    const map = new Map(this.db.accounts.map(a => [a.id, a]));
    for (const a of this.db.accounts) a.balance = 0;
    for (const t of this.db.transactions) {
      const acc = map.get(t.accountId);
      if (!acc) continue;
      if (t.type === TransactionType.INCOME) acc.balance = round2((acc.balance || 0) + Number(t.amount || 0));
      if (t.type === TransactionType.EXPENSE) acc.balance = round2((acc.balance || 0) - Number(t.amount || 0));
    }
    const now = new Date().toISOString();
    for (const a of this.db.accounts) a.updatedAt = now;
  }
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function csvEsc(s) { const need = /[",\n]/.test(s); return need ? `"${String(s).replace(/"/g, '""')}"` : String(s); }
function parseCsvLine(line, colCount) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { inQ = false; continue; }
      cur += ch;
    } else {
      if (ch === '"') { inQ = true; continue; }
      if (ch === ',') { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
  }
  out.push(cur);
  while (out.length < colCount) out.push('');
  return out.map(s => s.trim());
}

module.exports = Store;