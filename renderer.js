// renderer.js - 已修正版本：页签切换、快速记账、导入导出、查询、主题切换、数据持久化
// 主要：兼容后端返回格式，修正 id 类型处理，reload 后渲染查询表

const TOKEN_KEY = 'hp_token_v1';

// ---------- 工具 ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const todayISO = () => new Date().toISOString().slice(0,10);

function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ---- helper: 规范化后端返回的“列表”结构 ----
function normalizeListResponse(res) {
  try {
    if (!res) return [];
    // res may be { ok: true, data: ... }
    if (res.ok && res.data) {
      const d = res.data;
      if (Array.isArray(d)) return d;
      if (Array.isArray(d.items)) return d.items;
      if (Array.isArray(d.transactions)) return d.transactions;
      if (Array.isArray(d.list)) return d.list;
      if (Array.isArray(d.data)) return d.data;
    }
    // sometimes backend returns raw array or other wrappers
    if (Array.isArray(res)) return res;
    if (Array.isArray(res.value)) return res.value;
    if (Array.isArray(res.rows)) return res.rows;
    // guard: if res.data exists and is an object that contains a single array field:
    if (res && res.data && typeof res.data === 'object') {
      for (const k of ['items','transactions','rows','list','value','data']) {
        if (Array.isArray(res.data[k])) return res.data[k];
      }
    }
  } catch (e) {
    console.warn('normalizeListResponse error', e);
  }
  return [];
}

// ---------- 应用状态 ----------
const state = {
  authed: false,
  user: null,
  accounts: [],
  categories: [],
  tags: [],
  transactions: [],
  txTypes: []
};

// ---------- 主题 ----------
function initTheme() {
  const btn = $('#toggle-theme');
  const status = $('#theme-status');
  let theme = localStorage.getItem('hp_theme_v1') || 'light';
  apply(theme);
  btn && btn.addEventListener('click', () => {
    theme = theme === 'light' ? 'dark' : 'light';
    apply(theme);
    localStorage.setItem('hp_theme_v1', theme);
  });
  function apply(t) {
    document.body.classList.toggle('dark', t === 'dark');
    if (status) status.textContent = t === 'dark' ? '深色' : '浅色';
  }
}

// ---------- 导航 ----------
function initTabs() {
  $$('#nav button[data-tab]').forEach(btn => btn.addEventListener('click', () => setActiveTab(btn.dataset.tab)));
  const activeBtn = $('#nav button.active') || $('#nav button[data-tab="home"]');
  if (activeBtn) setActiveTab(activeBtn.dataset.tab);
}
function setActiveTab(tab) {
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.section').forEach(sec => sec.classList.toggle('active', sec.id === `tab-${tab}`));
}

// ---------- UI: 登录/注册弹窗 ----------
function openModal(id) {
  const bd = $('#modal-backdrop');
  if (bd) bd.style.display = 'block';
  const el = $(id);
  if (el) el.style.display = 'block';
}
function closeModals() {
  const bd = $('#modal-backdrop');
  if (bd) bd.style.display = 'none';
  $('#modal-login') && ($('#modal-login').style.display = 'none');
  $('#modal-register') && ($('#modal-register').style.display = 'none');
  $('#auth-status-login') && ($('#auth-status-login').textContent = '');
  $('#auth-status-register') && ($('#auth-status-register').textContent = '');
}

function wireAuthUI() {
  $('#btn-open-login')?.addEventListener('click', () => openModal('#modal-login'));
  $('#btn-open-register')?.addEventListener('click', () => openModal('#modal-register'));
  $('#btn-cancel-login')?.addEventListener('click', closeModals);
  $('#btn-cancel-register')?.addEventListener('click', closeModals);
  $('#modal-backdrop')?.addEventListener('click', closeModals);

  // 登录提交
  $('#form-login')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await api.auth.login(fd.get('username'), fd.get('password'));
    if (res && res.ok) {
      api.auth.setToken(res.data.token);
      localStorage.setItem(TOKEN_KEY, res.data.token);
      closeModals();
      await afterLogin(res.data.user);
    } else {
      $('#auth-status-login').textContent = res?.error?.message || '登录失败';
    }
  });

  // 注册提交
  $('#form-register')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await api.auth.register(fd.get('r_username'), fd.get('r_email'), fd.get('r_password'));
    if (res && res.ok) {
      api.auth.setToken(res.data.token);
      localStorage.setItem(TOKEN_KEY, res.data.token);
      closeModals();
      await afterLogin(res.data.user);
    } else {
      $('#auth-status-register').textContent = res?.error?.message || '注册失败';
    }
  });

  // 退出
  $('#btn-logout')?.addEventListener('click', async () => {
    await api.auth.logout();
    api.auth.setToken(null);
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  });
}

function updateAuthActions() {
  const hint = $('#auth-hint');
  const userSpan = $('#auth-user');
  const btnLogin = $('#btn-open-login');
  const btnRegister = $('#btn-open-register');
  const btnLogout = $('#btn-logout');

  if (state.authed) {
    if (hint) hint.style.display = 'none';
    if (btnLogin) btnLogin.style.display = 'none';
    if (btnRegister) btnRegister.style.display = 'none';
    if (userSpan) { userSpan.style.display = 'inline'; userSpan.textContent = `你好，${state.user.displayName || state.user.username}`; }
    if (btnLogout) btnLogout.style.display = 'inline-block';
  } else {
    if (hint) hint.style.display = 'inline';
    if (btnLogin) btnLogin.style.display = 'inline-block';
    if (btnRegister) btnRegister.style.display = 'inline-block';
    if (userSpan) userSpan.style.display = 'none';
    if (btnLogout) btnLogout.style.display = 'none';
  }

  // guest 样式遮罩
  document.body.classList.toggle('guest', !state.authed);
  $('#user-welcome') && ($('#user-welcome').textContent = state.authed ? `欢迎，${state.user.displayName || state.user.username}` : '欢迎');
  $('#profile-box') && ($('#profile-box').textContent = state.authed ? JSON.stringify(state.user, null, 2) : '登录后显示');
  // 资料表单回填
  if (state.authed) {
    const f = $('#form-profile');
    if (f) {
      f.p_username.value = state.user.username || '';
      f.p_email.value = state.user.email || '';
    }
    renderAccountsEditor();
  }
}

// ---------- 数据加载与渲染 ----------
async function loadBasicOptions() {
  const [accRes, catRes, tagRes] = await Promise.all([api.accounts.list(), api.categories.list(), api.tags.list()]);
  // 调试输出，开发时可查看真实结构
  console.log('accounts resp =>', accRes);
  console.log('categories resp =>', catRes);
  console.log('tags resp =>', tagRes);
  state.accounts = normalizeListResponse(accRes);
  state.categories = normalizeListResponse(catRes);
  state.tags = tagRes && tagRes.ok ? tagRes.data : [];
  populateSelects();
  renderHomeAccounts();
}

async function loadTransactions(filter = {}) {
  const res = await api.transactions.list(filter);
  console.log('transactions resp =>', res);
  state.transactions = normalizeListResponse(res);
  // 收集类型（去重）
  state.txTypes = Array.from(new Set(state.transactions.map(t => t.type).filter(Boolean)));
  syncTypeSelect();
  return state.transactions;
}

// 统一获取交易主键 id
function getTxnId(t, idx) {
  const raw = t?.id ?? t?.transactionId ?? t?.txId ?? t?._id;
  if (raw === undefined || raw === null || raw === '') return idx; // 后端缺 id 时用索引兜底（不可删除）
  return raw;
}

// 同步类型下拉：保持已有 EXPENSE/INCOME，追加后端出现的其它类型
function syncTypeSelect() {
  const sel = $('#type-select');
  if (!sel) return;
  const base = ['EXPENSE','INCOME'];
  const all = Array.from(new Set([...base, ...state.txTypes].filter(Boolean)));
  const current = sel.value;
  sel.innerHTML = all.map(t => `<option value="${t}">${t}</option>`).join('');
  // 尽量保留原选中
  if (current && all.includes(current)) sel.value = current;
}

function populateSelects() {
  const accountSel = $('#accountId');
  const qAccount = $('#q-account');
  const qTag = $('#q-tag');

  if (accountSel) accountSel.innerHTML = state.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');

  if (qAccount) qAccount.innerHTML = '<option value="">全部</option>' + state.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  if (qTag) qTag.innerHTML = '<option value="">全部</option>' + state.tags.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
}

function renderHomeAccounts() {
  const ul = $('#home-accounts');
  if (!ul) return;
  ul.innerHTML = state.accounts.map(a => `<li>${a.name}：${(a.balance ?? 0).toFixed(2)} ${a.currency || ''}</li>`).join('');
}

function renderHomeRecent() {
  const tbody = $('#home-recent tbody');
  if (!tbody) return;
  const accMap = new Map(state.accounts.map(a => [String(a.id), a.name]));
  const tagMap = new Map(state.tags.map(t => [String(t.id), t.name]));
  const arr = state.transactions.slice().sort((a,b)=> {
    if (a.date && b.date) return b.date.localeCompare(a.date);
    return 0;
  }).slice(0,5);
  tbody.innerHTML = arr.length ? arr.map(e => `<tr>
    <td>${e.date || ''}</td>
    <td>${e.type || ''}</td>
    <td>${e.amount ?? ''}</td>
    <td>${accMap.get(String(e.accountId)) || '-'}</td>
    <td>${formatTags(e.tags, tagMap)}</td>
    <td>${e.note || ''}</td>
  </tr>`).join('') : '<tr><td colspan="6">暂无数据</td></tr>';
}

function renderBillsTable(list) {
  const tbody = $('#bills-table tbody');
  if (!tbody) return;
  const data = (list && Array.isArray(list) ? list : state.transactions).slice().sort((a,b)=> {
    if (a.date && b.date) return b.date.localeCompare(a.date);
    return 0;
  });
  const accMap = new Map(state.accounts.map(a => [String(a.id), a.name]));
  const tagMap = new Map(state.tags.map(t => [String(t.id), t.name]));
  tbody.innerHTML = data.length ? data.map((e,i) => {
    const idRaw = getTxnId(e, i);
    const idAttr = String(idRaw);
    return `<tr data-id="${idAttr}">
      <td>${e.date || ''}</td>
      <td>${e.type || ''}</td>
      <td>${e.amount ?? ''}</td>
      <td>${accMap.get(String(e.accountId)) || '-'}</td>
      <td>${formatTags(e.tags, tagMap)}</td>
      <td>${e.note || ''}</td>
      <td><button class="del-btn" data-id="${idAttr}">删除</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="7">暂无账单</td></tr>';

  // 绑定删除事件
  $$('#bills-table .del-btn').forEach(btn => btn.addEventListener('click', async () => {
    const rawId = btn.dataset.id;
    // 如果是索引兜底的假 id（非数字）且后端没有真实 id，则不给删
    let idParsed = Number(rawId);
    if (Number.isNaN(idParsed)) idParsed = rawId;
    if (!rawId) return alert('无法识别要删除的账单 id');
    const res = await api.transactions.delete(idParsed);
    if (res && res.ok) {
      await reloadAll();
    } else {
      alert((res && res.error && res.error.message) || '删除失败');
    }
  }));
}

// 账单页：显示已记过的账户（出现过交易的账户统计笔数与总额）
function renderBillsAccounts() {
  const ul = $('#bills-accounts');
  if (!ul) return;
  const accStats = new Map();
  state.transactions.forEach(t => {
    const stat = accStats.get(String(t.accountId)) || { count:0, sum:0 };
    stat.count += 1;
    stat.sum += Number(t.amount) || 0;
    accStats.set(String(t.accountId), stat);
  });
  const accMap = new Map(state.accounts.map(a => [String(a.id), a]));
  const rows = Array.from(accStats.entries()).map(([id, s]) => {
    const a = accMap.get(id);
    return `<li>${a ? a.name : ('账户#'+id)}：${s.count} 笔，共 ${s.sum.toFixed(2)}</li>`;
  });
  ul.innerHTML = rows.length ? rows.join('') : '<li>暂无账单</li>';
}

function renderQueryTable(list) {
  const tbody = $('#q-table tbody');
  if (!tbody) return;
  const accMap = new Map(state.accounts.map(a => [String(a.id), a.name]));
  const tagMap = new Map(state.tags.map(t => [String(t.id), t.name]));
  tbody.innerHTML = (list || []).map(e => `<tr>
    <td>${e.date || ''}</td>
    <td>${e.type || ''}</td>
    <td>${e.amount ?? ''}</td>
    <td>${accMap.get(String(e.accountId)) || '-'}</td>
    <td>${formatTags(e.tags, tagMap)}</td>
    <td>${e.note || ''}</td>
  </tr>`).join('') || '<tr><td colspan="6">暂无结果</td></tr>';
}

// 将多种 tags 表示形式规范为文本（支持 id/字符串/对象）
function formatTags(tags, tagMap) {
  if (!Array.isArray(tags) || tags.length === 0) return '';
  const first = tags[0];
  if (typeof first === 'object') return tags.map(t => t.name || '').filter(Boolean).join(',');
  if (typeof first === 'number') return tags.map(id => tagMap.get(String(id)) || String(id)).join(',');
  return tags.join(',');
}

// ---------- 表单/按钮 ----------
function initAddForm() {
  const form = $('#form-add');
  const status = $('#add-status');
  if (!form) return;
  const tagPicker = createTagPicker({
    input: $('#tag-input'),
    chips: $('#tag-chips'),
    list: $('#tag-suggest-list'),
    getOptions: () => state.tags.map(t => t.name),
    max: 5
  });
  document.addEventListener('hp:tags-refresh', () => tagPicker.setOptions(state.tags.map(t => t.name)));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!state.authed) {
      status.textContent = '请先登录';
      setTimeout(()=> status.textContent='', 1500);
      return;
    }
    const fd = new FormData(form);
    const dto = {
      date: fd.get('date') || todayISO(),
      type: fd.get('type') || 'EXPENSE', // 仅支出/收入
      amount: Number(fd.get('amount') || 0),
      accountId: Number(fd.get('accountId')),
      tags: [],
      tagIds: [],
      note: fd.get('note') || '',
      categoryId: null // 分类废弃，统一传 null
    };

    // 标签处理保持不变
    const selectedNames = tagPicker.get();
    const known = new Map(state.tags.map(t => [t.name, t]));
    const toCreate = selectedNames.filter(n => !known.has(n));
    if (toCreate.length) {
      const creations = await Promise.all(toCreate.map(n => api.tags.create({ name: n })));
      const created = creations.filter(r => r && r.ok).map(r => r.data);
      state.tags = [...state.tags, ...created];
      document.dispatchEvent(new Event('hp:tags-refresh'));
    }
    const allNow = new Map(state.tags.map(t => [t.name, t]));
    const ids = selectedNames.map(n => allNow.get(n)?.id).filter(Boolean);
    dto.tags = selectedNames;
    dto.tagIds = ids;

    const res = await api.transactions.create(dto);
    if (res && res.ok) {
      status.textContent = '已记账 ✔';
      setTimeout(() => status.textContent = '', 800);
      form.reset();
      tagPicker.clear();
      $('#form-add input[name="date"]').value = todayISO();
      await reloadAll();
    } else {
      status.textContent = res?.error?.message || '保存失败';
    }
  });
}

function initExportImport() {
  $('#exp-csv')?.addEventListener('click', async () => {
    if (!state.authed) { alert('请先登录'); return; }
    const res = await api.export.run({ format: 'CSV', filter: {} });
    if (res && res.ok) downloadText(res.data.content, 'happy_packet_export.csv', res.data.mime);
    else alert(res?.error?.message || '导出失败');
  });
  $('#exp-json')?.addEventListener('click', async () => {
    if (!state.authed) { alert('请先登录'); return; }
    const res = await api.export.run({ format: 'JSON', filter: {} });
    if (res && res.ok) downloadText(res.data.content, 'happy_packet_export.json', res.data.mime);
    else alert(res?.error?.message || '导出失败');
  });
  $('#imp-run')?.addEventListener('click', async () => {
    if (!state.authed) { alert('请先登录'); return; }
    const txt = $('#imp-csv').value.trim();
    if (!txt) return alert('请粘贴 CSV');
    const res = await api.import.run({ csvText: txt });
    $('#imp-status').textContent = res && res.ok ? JSON.stringify(res.data, null, 2) : res?.error?.message || '导入失败';
    if (res && res.ok) await reloadAll();
  });

  // 加载导入模板示例
  (async () => {
    const tpl = await api.import.template();
    if (tpl && tpl.ok) {
      $('#imp-csv').placeholder = `${tpl.data.header}\n${tpl.data.example}\n\n${tpl.data.hint}`;
    }
  })();
}

function initBillsFilter() {
  const runSearch = async () => {
    if (!state.authed) { alert('请先登录'); return; }
    const k = ($('#bills-keyword')?.value || '').trim().toLowerCase();
    if (!k) { alert('请输入关键词'); return; }
    const res = await api.search.execute({ keyword: k });
    if (res && res.ok) {
      // 跳转到查询页并展示结果
      setActiveTab('search');
      const qInput = $('#q-keyword');
      if (qInput) qInput.value = k;
      renderQueryTable(normalizeListResponse(res));
    } else {
      alert(res?.error?.message || '搜索失败');
    }
  };
  $('#bills-search')?.addEventListener('click', runSearch);
  $('#bills-keyword')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch();
    }
  });
}

function initQuery() {
  $('#q-run')?.addEventListener('click', async () => {
    if (!state.authed) { alert('请先登录'); return; }
    const kw = ($('#q-keyword')?.value || '').trim().toLowerCase();
    const from = $('#q-from')?.value || '';
    const to = $('#q-to')?.value || '';
    const account = Number($('#q-account')?.value || '') || undefined;
    const tagId = Number($('#q-tag')?.value || '') || undefined;
    // 统一走 transactions.list，后端支持所有筛选同时生效
    const res = await api.transactions.list({
      keyword: kw || undefined,
      fromDate: from || undefined,
      toDate: to || undefined,
      accountId: account,
      tagId
    });
    if (res.ok) renderQueryTable(res.data);
  });
}

function renderAccountsEditor() {
  const host = $('#accounts-editor');
  if (!host) return;
  host.innerHTML = state.accounts.map(a =>
    `<label style="flex:1 1 160px;font-size:12px;">${a.id} - 昵称
      <input data-acc-id="${a.id}" value="${a.name || ''}" placeholder="账户昵称">
    </label>`).join('');
}

function initProfileForms() {
  // 个人资料
  $('#form-profile')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.authed) return alert('请先登录');
    const status = $('#profile-status');
    const fd = new FormData(e.target);
    const username = fd.get('p_username').trim();
    const email = fd.get('p_email').trim();
    if (!username) { status.textContent = '用户名不能为空'; return; }
    if (email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
      status.textContent = '邮箱格式不正确'; return;
    }
    status.textContent = '保存中...';
    const res = await api.auth.update({ username, email });
    if (res && res.ok) {
      status.textContent = '已保存';
      state.user = { ...state.user, username, email };
      updateAuthActions();
      setTimeout(()=> status.textContent='', 400);
    } else {
      status.textContent = res?.error?.message || '保存失败';
    }
  });

  // 修改密码
  $('#form-password')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.authed) return alert('请先登录');
    const status = $('#pwd-status');
    const fd = new FormData(e.target);
    const oldPwd = fd.get('old_password');
    const newPwd = fd.get('new_password');
    if (!oldPwd || !newPwd) { status.textContent = '请填写完整'; return; }
    if (newPwd.length < 6) { status.textContent = '新密码至少6位'; return; }
    status.textContent = '提交中...';
    const res = await api.auth.password(oldPwd, newPwd);
    if (res && res.ok) {
      status.textContent = '密码已修改';
      e.target.reset();
      setTimeout(()=> status.textContent='', 400);
    } else {
      status.textContent = res?.error?.message || '修改失败';
    }
  });

  // 账户昵称保存
  $('#form-accounts')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.authed) return alert('请先登录');
    const status = $('#accounts-status');
    status.textContent = '保存中...';
    const inputs = Array.from($('#accounts-editor')?.querySelectorAll('input[data-acc-id]') || []);
    const names = inputs.map(i => i.value.trim()).filter(n => n);
    const dup = names.find((n, idx) => names.indexOf(n) !== idx);
    if (dup) { status.textContent = '昵称重复: ' + dup; return; }
    const tasks = inputs.map(i => {
      const id = Number(i.dataset.accId);
      const name = i.value.trim();
      return api.accounts.update(id, { name });
    });
    const results = await Promise.all(tasks);
    const failed = results.filter(r => !(r && r.ok));
    if (failed.length) {
      status.textContent = '部分失败: ' + failed.map(f => f.error?.message).join(',');
    } else {
      status.textContent = '全部已保存';
      await loadBasicOptions();
      setTimeout(()=> status.textContent='', 400);
    }
  });
}

// ---------- 登录流 ----------
async function ensureAuth() {
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved) api.auth.setToken(saved);
  const me = await api.auth.me().catch(() => null);
  if (me && me.ok) {
    await afterLogin(me.data);
    return true;
  }
  state.authed = false;
  state.user = null;
  updateAuthActions();
  return false;
}

async function afterLogin(user) {
  state.authed = true;
  state.user = user;
  updateAuthActions();
  $('#form-add input[name="date"]')?.setAttribute('value', todayISO());
  await reloadAll();
  if (state.transactions && state.transactions.length) setActiveTab('bills');
}

async function reloadAll() {
  if (!state.authed) return;
  await loadBasicOptions();
  await loadTransactions();
  renderHomeRecent();
  renderBillsTable();
  renderBillsAccounts();
  // 刷新标签联想
  document.dispatchEvent(new Event('hp:tags-refresh'));
  // 同步把查询页也渲染一次（方便直接切换查看）
  renderQueryTable(state.transactions);
}

// ---------- 页面初始化 ----------
function initAll() {
  initTheme();
  initTabs();
  wireAuthUI();
  initAddForm();
  initExportImport();
  initBillsFilter();
  initQuery();
  initProfileForms();
  ensureAuth();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAll);
} else {
  initAll();
}

// 简易标签选择器（最多 max 个），支持回车/逗号添加与点击删除，提供联想
function createTagPicker({ input, chips, list, getOptions, max = 5 }) {
  let selected = [];
  let options = getOptions() || [];
  function setOptions(arr) {
    options = Array.from(new Set((arr || []).map(s => String(s))));
  }
  function syncChips() {
    chips.innerHTML = selected.map(name =>
      `<span class="tag-chip">${name}<button data-del="${name}" title="移除">×</button></span>`
    ).join('');
    chips.querySelectorAll('button[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const n = btn.getAttribute('data-del');
        selected = selected.filter(x => x !== n);
        syncChips(); renderSuggest();
      });
    });
  }
  function add(name) {
    const n = (name || '').trim();
    if (!n) return;
    if (selected.includes(n)) return;
    if (selected.length >= max) return;
    selected.push(n);
    input.value = '';
    syncChips(); renderSuggest();
  }
  function renderSuggest() {
    const q = (input.value || '').trim().toLowerCase();
    const pool = options.filter(o => !selected.includes(o));
    const items = q ? pool.filter(o => o.toLowerCase().includes(q)) : pool.slice(0, 8);
    list.style.display = items.length ? 'block' : 'none';
    list.innerHTML = items.map(it => `<div class="tag-suggest-item" data-pick="${it}">${it}</div>`).join('');
    list.querySelectorAll('[data-pick]').forEach(el => el.addEventListener('click', () => add(el.dataset.pick)));
  }
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',' ) {
      e.preventDefault();
      add(input.value);
    } else if (e.key === 'Backspace' && !input.value && selected.length) {
      selected.pop(); syncChips(); renderSuggest();
    }
  });
  input?.addEventListener('input', renderSuggest);
  document.addEventListener('click', (e) => {
    if (!list.contains(e.target) && e.target !== input) list.style.display = 'none';
  });
  // 初始化
  setOptions(options); syncChips(); renderSuggest();
  return {
    get: () => selected.slice(),
    clear: () => { selected = []; syncChips(); renderSuggest(); },
    setOptions
  };
}
