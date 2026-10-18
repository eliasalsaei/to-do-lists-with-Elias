/* To-dos with Elias — all app logic. Works from localStorage; sync.js mirrors it to a shared Firestore list. */
(() => {
  'use strict';

  const STORAGE_KEY = 'todoWithElias.v1';
  const OUTBOX_KEY = 'todoWithElias.outbox';
  const LINK_KEY = 'todoWithElias.syncedUid'; // set while this device's list belongs to a signed-in account

  const PALETTE = ['#d9665b', '#e8875a', '#e3b04b', '#8ab17d', '#4caf8e', '#2a9d8f', '#4fb0c6', '#5aa3e0',
    '#5b8def', '#7b8cde', '#9d86d8', '#b38ad6', '#c77dba', '#e07a9a', '#7d8597', '#a08f80'];
  const EMOJIS = ['🏠', '🛒', '🚗', '💼', '🙂', '📦', '🧹', '🍳', '👶', '🐾', '💊', '🎁', '✈️', '📚', '💡', '🔧', '🌱', '💳', '🎉', '📞'];

  const DEFAULT_CATEGORIES = [
    ['home', 'Home', '🏠', '#9d86d8'],
    ['groceries', 'Groceries', '🛒', '#8ab17d'],
    ['errands', 'Errands', '🚗', '#5aa3e0'],
    ['work', 'Work', '💼', '#e3b04b'],
    ['personal', 'Personal', '🙂', '#e07a9a'],
    ['other', 'Other', '📦', '#7d8597'],
  ].map(([id, name, icon, color]) => ({ id, name, icon, color }));

  const PRIORITIES = {
    high: { label: 'High', rank: 0 },
    medium: { label: 'Medium', rank: 1 },
    low: { label: 'Low', rank: 2 },
  };
  const PRIO_KEYS = Object.keys(PRIORITIES);

  const VIEW_TITLES = { todos: 'To-dos', categories: 'Categories', done: 'Done', settings: 'Settings' };

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => dateStr(new Date());
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dateStr(d); };
  const fmtDate = (s, opts = { day: 'numeric', month: 'short' }) => {
    if (!s) return '';
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', opts);
  };
  const dueLabel = (s) => {
    if (s === todayStr()) return 'Today';
    if (s === addDays(1)) return 'Tomorrow';
    if (s === addDays(-1)) return 'Yesterday';
    return fmtDate(s, s.slice(0, 4) === todayStr().slice(0, 4) ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const dayHeading = (ms) => {
    const s = dateStr(new Date(ms));
    if (s === todayStr()) return 'Today';
    if (s === addDays(-1)) return 'Yesterday';
    return fmtDate(s, { weekday: 'long', day: 'numeric', month: 'short' });
  };
  const ICONS = {
    check: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9"/></svg>',
    edit: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    trash: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    note: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM9 9h6M9 13h6M9 17h3"/></svg>',
    calendar: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    flag: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
    restore: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4"/></svg>',
    plus: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    search: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>',
  };

  // ---------- State ----------
  // item: { id, title, notes, priority, categoryId, due, qty, done, doneAt, doneBy, createdAt, updatedAt, addedBy, assignee }
  function freshState() {
    return {
      version: 1,
      items: [],
      categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      space: null, // { id, name, owner, members: [{ uid, name, email, photo }] } while signed in
      settings: { theme: 'auto', sort: 'priority' }, // device-only, never synced
    };
  }

  function normalizeItem(x) {
    return {
      id: String(x.id || uid()),
      title: String(x.title || '').slice(0, 300),
      notes: String(x.notes || ''),
      priority: PRIORITIES[x.priority] ? x.priority : 'medium',
      categoryId: String(x.categoryId || 'other'),
      due: /^\d{4}-\d{2}-\d{2}$/.test(x.due || '') ? x.due : '',
      qty: String(x.qty || ''),
      done: !!x.done,
      doneAt: Number(x.doneAt) || 0,
      doneBy: x.doneBy || '',
      createdAt: Number(x.createdAt) || Date.now(),
      updatedAt: Number(x.updatedAt) || Date.now(),
      addedBy: x.addedBy || '',
      assignee: x.assignee || '',
    };
  }

  function normalize(s) {
    const base = freshState();
    if (!s || typeof s !== 'object') return base;
    return {
      version: 1,
      items: Array.isArray(s.items) ? s.items.map(normalizeItem) : [],
      categories: Array.isArray(s.categories) && s.categories.length ? s.categories.map((c) => ({ ...c })) : base.categories,
      space: s.space || null,
      settings: { ...base.settings, ...(s.settings || {}) },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalize(JSON.parse(raw)) : freshState();
    } catch (e) {
      console.warn('Could not load saved data', e);
      return freshState();
    }
  }

  let state = loadState();
  let saveFailed = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      saveFailed = false;
    } catch {
      if (!saveFailed) toast('Could not save — browser storage is unavailable');
      saveFailed = true;
    }
  }

  // Every change goes through here. When the device is linked to an account the change is also
  // queued for the cloud (the queue survives reloads, so edits made before sync loads are not lost).
  const isLinked = () => { try { return !!localStorage.getItem(LINK_KEY); } catch { return false; } };
  function readOutbox() { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch { return []; } }
  function writeOutbox(ops) { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops)); } catch { /* storage blocked */ } }
  function commit(ops) {
    save();
    if (isLinked()) {
      writeOutbox([...readOutbox(), ...ops]);
      window.TodoSync?.flush();
    }
    render();
  }

  const itemById = (id) => state.items.find((i) => i.id === id);
  const catById = (id) => state.categories.find((c) => c.id === id) || { id, name: 'Other', icon: '📦', color: '#7d8597' };
  const me = () => window.TodoSync?.info.user?.uid || '';
  const members = () => state.space?.members || [];
  const memberName = (id) => {
    const m = members().find((x) => x.uid === id);
    return m ? (m.name || m.email || 'Someone').split(' ')[0] : '';
  };
  const isShared = () => members().length > 1;

  function putItem(item) {
    item = normalizeItem({ ...item, updatedAt: Date.now() });
    const i = state.items.findIndex((x) => x.id === item.id);
    if (i >= 0) state.items[i] = item; else state.items.push(item);
    commit([{ t: 'put', item }]);
    return item;
  }
  function deleteItems(ids) {
    const set = new Set(ids);
    state.items = state.items.filter((i) => !set.has(i.id));
    commit(ids.map((id) => ({ t: 'del', id })));
  }
  function setCategories(categories, extraOps = []) {
    state.categories = categories;
    commit([{ t: 'cats', categories }, ...extraOps]);
  }

  // ---------- Theme ----------
  function applyTheme() {
    const t = state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg, action) {
    const el = $('#toast'), btn = $('#toastAction');
    $('#toastText').textContent = msg;
    btn.hidden = !action;
    if (action) {
      btn.textContent = action.label;
      btn.onclick = () => { el.classList.remove('show'); action.run(); };
    }
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2400);
  }

  // ---------- Modal ----------
  const modal = $('#modal');
  function openModal(html, onMount) {
    $('#modalBody').innerHTML = html;
    if (!modal.open) modal.showModal();
    onMount && onMount($('#modalBody'));
  }
  function closeModal() { if (modal.open) modal.close(); }
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-close]')) closeModal();
  });

  function confirmBox(message, onYes, yesLabel = 'Delete', title = 'Are you sure?', danger = true) {
    openModal(`
      <div class="modal-head"><h2>${esc(title)}</h2></div>
      <p style="margin:0;color:var(--muted)">${esc(message)}</p>
      <div class="modal-foot">
        <button class="btn" data-close>Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirmYes">${esc(yesLabel)}</button>
      </div>`, (root) => {
      $('#confirmYes', root).onclick = () => { closeModal(); onYes(); };
    });
  }

  // ---------- UI state ----------
  const ui = {
    view: 'todos',
    cat: 'all',
    prio: 'all',
    q: '',
    mine: false,
    qaPrio: 'medium',
    qaCat: '',
  };

  // ---------- Sorting & filtering ----------
  function compareItems(a, b) {
    const sort = state.settings.sort;
    const due = (x) => x.due || '9999-99-99';
    if (sort === 'due') return due(a).localeCompare(due(b)) || PRIORITIES[a.priority].rank - PRIORITIES[b.priority].rank || a.createdAt - b.createdAt;
    if (sort === 'newest') return b.createdAt - a.createdAt;
    return PRIORITIES[a.priority].rank - PRIORITIES[b.priority].rank || due(a).localeCompare(due(b)) || a.createdAt - b.createdAt;
  }

  function matches(i, { ignoreCat = false } = {}) {
    if (!ignoreCat && ui.cat !== 'all' && i.categoryId !== ui.cat) return false;
    if (ui.prio !== 'all' && i.priority !== ui.prio) return false;
    if (ui.mine && i.assignee && i.assignee !== me()) return false;
    if (ui.q) {
      const q = ui.q.toLowerCase();
      if (![i.title, i.notes, i.qty, catById(i.categoryId).name].some((s) => String(s).toLowerCase().includes(q))) return false;
    }
    return true;
  }

  const openItems = () => state.items.filter((i) => !i.done);
  const doneItems = () => state.items.filter((i) => i.done).sort((a, b) => b.doneAt - a.doneAt);
  const isOverdue = (i) => !i.done && i.due && i.due < todayStr();

  // ---------- Rendering pieces ----------
  function catIcon(c, size = '') {
    return `<span class="emoji ${size}" style="background:color-mix(in srgb, ${c.color} 16%, var(--surface))">${esc(c.icon)}</span>`;
  }

  function avatar(id, small = true) {
    const m = members().find((x) => x.uid === id);
    if (!m) return '';
    const letter = esc((m.name || m.email || '?')[0].toUpperCase());
    return m.photo
      ? `<img class="avatar ${small ? 'xs' : ''}" src="${esc(m.photo)}" alt="" title="${esc(m.name)}" referrerpolicy="no-referrer">`
      : `<span class="avatar ${small ? 'xs' : ''}" style="background:var(--primary)" title="${esc(m.name)}">${letter}</span>`;
  }

  function todoRow(i, { showCat = true } = {}) {
    const c = catById(i.categoryId);
    const meta = [];
    if (showCat) meta.push(`<span class="meta-cat" style="--c:${c.color}">${esc(c.icon)} ${esc(c.name)}</span>`);
    if (i.due) meta.push(`<span class="meta-due ${isOverdue(i) ? 'overdue' : i.due === todayStr() ? 'today' : ''}">${ICONS.calendar}${isOverdue(i) ? 'Overdue · ' : ''}${esc(dueLabel(i.due))}</span>`);
    if (i.notes) meta.push(`<span class="meta-note" title="${esc(i.notes)}">${ICONS.note}${esc(i.notes.split('\n')[0].slice(0, 60))}</span>`);
    if (isShared() && i.assignee) meta.push(`<span class="meta-who">${avatar(i.assignee)} ${esc(memberName(i.assignee))}</span>`);
    else if (isShared() && i.addedBy && i.addedBy !== me()) meta.push(`<span class="meta-who muted">Added by ${esc(memberName(i.addedBy))}</span>`);
    if (i.done && i.doneAt) meta.push(`<span>Done ${esc(new Date(i.doneAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}${isShared() && i.doneBy ? ` by ${esc(memberName(i.doneBy))}` : ''}</span>`);
    return `
      <div class="todo prio-${i.priority} ${i.done ? 'is-done' : ''}">
        <button class="check" data-action="toggle" data-id="${esc(i.id)}" aria-label="${i.done ? 'Mark as not done' : 'Mark as done'}">${ICONS.check}</button>
        <div class="todo-main" data-action="edit" data-id="${esc(i.id)}" role="button" tabindex="0">
          <div class="todo-title">${esc(i.title)}${i.qty ? ` <span class="qty">${esc(i.qty)}</span>` : ''}</div>
          ${meta.length ? `<div class="todo-meta">${meta.join('')}</div>` : ''}
        </div>
        ${i.done
          ? `<button class="row-btn" data-action="delete" data-id="${esc(i.id)}" aria-label="Delete">${ICONS.trash}</button>`
          : `<button class="prio-tag ${i.priority}" data-action="cycle-prio" data-id="${esc(i.id)}" title="Tap to change priority">${PRIORITIES[i.priority].label}</button>`}
      </div>`;
  }

  function prioSeg(id, current, withAll = false) {
    const opts = withAll ? ['all', ...PRIO_KEYS] : PRIO_KEYS;
    return `<div class="seg prio-seg" id="${id}">${opts.map((p) => `<button type="button" data-prio="${p}" class="${p === current ? 'active' : ''} p-${p}">${p === 'all' ? 'All' : PRIORITIES[p].label}</button>`).join('')}</div>`;
  }

  function catOptions(selected) {
    return state.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('');
  }

  // ---------- Views ----------
  function renderTodos() {
    if (ui.cat !== 'all' && !state.categories.some((c) => c.id === ui.cat)) ui.cat = 'all';
    const open = openItems();
    const qaCat = state.categories.some((c) => c.id === ui.qaCat) ? ui.qaCat : (ui.cat !== 'all' ? ui.cat : state.categories[0]?.id);
    const counts = (catId) => open.filter((i) => catId === 'all' || i.categoryId === catId).length;
    const chips = [`<button class="chip ${ui.cat === 'all' ? 'active' : ''}" data-action="filter-cat" data-cat="all">All <b>${counts('all')}</b></button>`,
      ...state.categories.map((c) => `<button class="chip ${ui.cat === c.id ? 'active' : ''}" style="--c:${c.color}" data-action="filter-cat" data-cat="${esc(c.id)}">${esc(c.icon)} ${esc(c.name)} <b>${counts(c.id)}</b></button>`)].join('');

    const shown = open.filter((i) => matches(i)).sort(compareItems);
    const high = open.filter((i) => i.priority === 'high').length;
    const overdue = open.filter(isOverdue).length;
    const dueToday = open.filter((i) => i.due === todayStr()).length;
    const doneToday = state.items.filter((i) => i.done && i.doneAt && dateStr(new Date(i.doneAt)) === todayStr()).length;

    let list;
    if (!shown.length) {
      list = `<div class="card empty">${open.length
        ? 'Nothing matches these filters.'
        : `<div class="empty-big">${ICONS.check}</div><b>All done!</b><br>Add your first to-do above.`}</div>`;
    } else if (state.settings.sort === 'priority') {
      list = PRIO_KEYS.map((p) => {
        const group = shown.filter((i) => i.priority === p);
        if (!group.length) return '';
        return `<div class="card list-card"><div class="group-head prio-${p}"><span class="prio-dot"></span>${PRIORITIES[p].label} priority <span class="count">${group.length}</span></div>
          <div class="todo-list">${group.map((i) => todoRow(i, { showCat: ui.cat === 'all' })).join('')}</div></div>`;
      }).join('');
    } else {
      list = `<div class="card list-card"><div class="todo-list">${shown.map((i) => todoRow(i, { showCat: ui.cat === 'all' })).join('')}</div></div>`;
    }

    const recentDone = doneItems().filter((i) => matches(i)).slice(0, 5);
    const doneCount = doneItems().filter((i) => matches(i)).length;

    return `
      <div class="card quick-card">
        <form id="quickAdd" class="quick-add" autocomplete="off">
          <input id="qaTitle" class="input qa-title" placeholder="Add a to-do…" enterkeyhint="done" maxlength="300" aria-label="New to-do">
          <select id="qaCat" class="input qa-cat" aria-label="Category">${catOptions(qaCat)}</select>
          ${prioSeg('qaPrio', ui.qaPrio)}
          <button class="btn btn-primary qa-btn" type="submit">${ICONS.plus}<span>Add</span></button>
        </form>
        <button class="link-btn" data-action="add-full" style="margin-top:10px">Add with details (due date, notes, quantity)…</button>
      </div>

      <div class="summary-line">
        <span><b>${open.length}</b> to do</span>
        ${high ? `<span class="s-high"><b>${high}</b> high priority</span>` : ''}
        ${dueToday ? `<span><b>${dueToday}</b> due today</span>` : ''}
        ${overdue ? `<span class="s-overdue"><b>${overdue}</b> overdue</span>` : ''}
        ${doneToday ? `<span><b>${doneToday}</b> done today</span>` : ''}
      </div>

      <div class="chips" id="catChips">${chips}</div>

      <div class="filters">
        ${prioSeg('prioFilter', ui.prio, true)}
        <label class="search"><span>${ICONS.search}</span><input id="search" class="input" placeholder="Search" value="${esc(ui.q)}" aria-label="Search"></label>
        <select id="sortBy" class="input" aria-label="Sort by">
          <option value="priority" ${state.settings.sort === 'priority' ? 'selected' : ''}>Sort: priority</option>
          <option value="due" ${state.settings.sort === 'due' ? 'selected' : ''}>Sort: due date</option>
          <option value="newest" ${state.settings.sort === 'newest' ? 'selected' : ''}>Sort: newest</option>
        </select>
        ${isShared() ? `<label class="toggle-row compact"><span>Hide others' tasks</span><input type="checkbox" class="switch" id="mineOnly" ${ui.mine ? 'checked' : ''}></label>` : ''}
      </div>

      ${list}

      ${doneCount ? `
      <div class="card list-card">
        <div class="card-head"><h3 class="card-title">Recently done <span class="count">${doneCount}</span></h3>
          <div class="btn-row"><button class="link-btn" data-action="goto" data-view="done">See all</button><button class="link-btn danger" data-action="clear-done">Clear done</button></div></div>
        <div class="todo-list">${recentDone.map((i) => todoRow(i, { showCat: ui.cat === 'all' })).join('')}</div>
      </div>` : ''}`;
  }

  function renderCategories() {
    const open = openItems();
    const cards = state.categories.map((c) => {
      const mine = open.filter((i) => i.categoryId === c.id).sort(compareItems);
      const high = mine.filter((i) => i.priority === 'high').length;
      return `
        <div class="card cat-card" style="--c:${c.color}">
          <div class="cat-card-head" data-action="open-cat" data-cat="${esc(c.id)}" role="button" tabindex="0">
            ${catIcon(c, 'lg')}
            <div style="min-width:0;flex:1">
              <div class="cat-name">${esc(c.name)}</div>
              <div class="card-sub">${mine.length ? `${mine.length} to do${high ? ` · <span class="s-high">${high} high</span>` : ''}` : 'Nothing to do'}</div>
            </div>
            <button class="row-btn" data-action="edit-cat" data-cat="${esc(c.id)}" aria-label="Edit category">${ICONS.edit}</button>
          </div>
          ${mine.length ? `<ul class="peek">${mine.slice(0, 4).map((i) => `<li><span class="prio-dot prio-${i.priority}"></span>${esc(i.title)}${i.qty ? ` <span class="qty">${esc(i.qty)}</span>` : ''}</li>`).join('')}${mine.length > 4 ? `<li class="muted">+${mine.length - 4} more</li>` : ''}</ul>` : ''}
          <button class="btn btn-sm cat-add" data-action="add-full" data-cat="${esc(c.id)}">${ICONS.plus} Add to ${esc(c.name)}</button>
        </div>`;
    }).join('');
    return `
      <div class="grid cat-grid">
        ${cards}
        <button class="card cat-card new-cat" data-action="new-cat">${ICONS.plus}<b>New category</b><span class="card-sub">e.g. Kids, Car, Garden, Pharmacy</span></button>
      </div>`;
  }

  function renderDone() {
    const done = doneItems().filter((i) => matches(i, { ignoreCat: true }));
    if (!done.length) return `<div class="card empty"><div class="empty-big">${ICONS.check}</div>Completed to-dos will appear here.</div>`;
    const groups = new Map();
    for (const i of done) {
      const key = dayHeading(i.doneAt || i.updatedAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    return `
      <div class="card list-card">
        <div class="card-head"><span class="card-sub">${done.length} completed · tap the tick to bring one back</span>
          <button class="btn btn-sm btn-danger" data-action="clear-done">Clear all</button></div>
        ${[...groups].map(([day, list]) => `<div class="day-head">${esc(day)}</div><div class="todo-list">${list.map((i) => todoRow(i)).join('')}</div>`).join('')}
      </div>`;
  }

  // ---------- Sync & sharing UI ----------
  const SYNC_LABELS = {
    loading: 'Starting…',
    signedout: 'Not synced',
    connecting: 'Connecting…',
    waiting: 'Waiting for internet',
    syncing: 'Syncing…',
    synced: 'Synced',
    offline: 'Offline — saved on device',
    error: 'Sync problem',
    unavailable: 'Sync unavailable',
  };
  let syncUnavailable = false;
  const syncInfo = () => window.TodoSync?.info || { status: syncUnavailable ? 'unavailable' : 'loading', user: null, error: '' };

  function renderSyncBadge() {
    const info = syncInfo();
    const label = SYNC_LABELS[info.status] || SYNC_LABELS.loading;
    const el = $('#syncBadge');
    el.className = `sync-badge is-${info.status}`;
    el.innerHTML = `<span class="sync-dot"></span><span class="sync-text">${label}${isShared() && info.status === 'synced' ? ' · shared' : ''}</span>`;
    el.title = info.error || label;
    $('#brandSub').textContent = state.space?.name || 'Shared to-do lists';
  }

  const GOOGLE_ICON = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

  function syncCard() {
    const info = syncInfo();
    const label = SYNC_LABELS[info.status] || SYNC_LABELS.loading;
    const u = info.user;
    const invite = window.TodoSync?.pendingInvite?.();
    const body = u ? `
      <div class="sync-user">
        ${u.photo ? `<img class="avatar" src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar" style="background:var(--primary)">${esc((u.name || u.email || '?')[0].toUpperCase())}</span>`}
        <div style="min-width:0;flex:1">
          <div class="strong">${esc(u.name || 'Signed in')}</div>
          <div class="card-sub ellipsis">${esc(u.email)}</div>
        </div>
        <button class="btn btn-sm" data-action="sync-signout">Sign out</button>
      </div>
      <p class="card-sub" style="margin-bottom:0">Your to-dos are saved in the cloud and on this device. They work offline and sync as soon as you're back online, on any network.</p>`
      : `
      ${invite ? `<div class="alert green" style="margin-bottom:12px">You've been invited to a shared list. Sign in with Google to join it.</div>` : ''}
      <p class="card-sub" style="margin-top:0">Sign in with Google to save your to-dos in the cloud, use them on every device, and share a list with your family.</p>
      <button class="btn btn-primary" data-action="sync-signin" ${['loading', 'unavailable', 'connecting'].includes(info.status) ? 'disabled' : ''}>${GOOGLE_ICON} Sign in with Google</button>`;
    return `
      <div class="card">
        <div class="card-head"><h3 class="card-title">Cloud sync</h3><span class="pill sync-pill is-${info.status}"><span class="sync-dot"></span>${label}</span></div>
        ${body}
        ${info.error ? `<div class="alert red" style="margin-top:12px">${esc(info.error)}</div>` : ''}
      </div>`;
  }

  function shareCard() {
    const info = syncInfo();
    if (!info.user || !state.space) return '';
    const s = state.space;
    const spaces = window.TodoSync?.spaces() || [];
    const memberRows = s.members.map((m) => `
      <div class="member">${avatar(m.uid, false)}<div style="min-width:0"><div class="strong">${esc(m.name || 'Member')}${m.uid === info.user.uid ? ' <span class="pill">You</span>' : ''}${m.uid === s.owner ? ' <span class="pill">Owner</span>' : ''}</div><div class="card-sub ellipsis">${esc(m.email)}</div></div></div>`).join('');
    return `
      <div class="card">
        <div class="card-head"><h3 class="card-title">Share with family</h3><button class="link-btn" data-action="rename-space">Rename list</button></div>
        <div class="field"><label>Current list</label><div class="strong">${esc(s.name)}</div></div>
        <div class="members">${memberRows}</div>
        <p class="card-sub">Send this invite link to your wife (or anyone). When they open it and sign in with their Google account, you'll both see and edit the same to-dos in real time.</p>
        <div class="invite-box"><input class="input" id="inviteLink" readonly value="${esc(window.TodoSync.inviteLink())}" aria-label="Invite link"></div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn btn-primary" data-action="share-invite">Share invite link</button>
          <button class="btn" data-action="copy-invite">Copy</button>
        </div>
        <details class="more">
          <summary>Join another list or switch lists</summary>
          <form id="joinForm" class="join-form">
            <input class="input" id="joinCode" placeholder="Paste an invite link or code" aria-label="Invite link or code">
            <button class="btn" type="submit">Join</button>
          </form>
          ${spaces.length > 1 ? `<div class="field" style="margin-top:12px"><label for="spacePick">Your lists</label>
            <select class="input" id="spacePick">${spaces.map((x) => `<option value="${esc(x.id)}" ${x.id === s.id ? 'selected' : ''}>${esc(x.name)} (${x.memberCount} ${x.memberCount === 1 ? 'person' : 'people'})</option>`).join('')}</select></div>` : ''}
          ${s.members.length > 1 && s.owner !== info.user.uid ? '<button class="btn btn-sm btn-danger" style="margin-top:12px" data-action="leave-space">Leave this list</button>' : ''}
        </details>
      </div>`;
  }

  function renderSettings() {
    const theme = state.settings.theme;
    return `
      <div class="grid grid-2">
        <div class="grid">${syncCard()}${shareCard()}</div>
        <div class="grid">
          <div class="card">
            <div class="card-head"><h3 class="card-title">Appearance</h3></div>
            <div class="seg" id="themeSeg">${['auto', 'light', 'dark'].map((t) => `<button data-theme="${t}" class="${theme === t ? 'active' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
          </div>
          <div class="card">
            <div class="card-head"><h3 class="card-title">Categories</h3><button class="link-btn" data-action="goto" data-view="categories">Manage</button></div>
            <div class="chips">${state.categories.map((c) => `<span class="chip static" style="--c:${c.color}">${esc(c.icon)} ${esc(c.name)}</span>`).join('')}</div>
          </div>
          <div class="card">
            <div class="card-head"><h3 class="card-title">Backup</h3></div>
            <p class="card-sub" style="margin-top:0">Save a copy of your to-dos as a file, or restore one. Restoring adds to what's already here.</p>
            <div class="btn-row">
              <button class="btn" data-action="export">Download backup</button>
              <button class="btn" data-action="import">Restore backup</button>
              <input type="file" id="importFile" accept="application/json,.json" hidden>
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h3 class="card-title">Clean up</h3></div>
            <div class="btn-row">
              <button class="btn" data-action="demo">Add example to-dos</button>
              <button class="btn btn-danger" data-action="erase">Delete all to-dos</button>
            </div>
            <p class="card-sub" style="margin-bottom:0">${state.space ? 'Deleting removes the to-dos for everyone sharing this list.' : 'Without signing in, to-dos are stored only in this browser.'}</p>
          </div>
        </div>
      </div>`;
  }

  const RENDERERS = { todos: renderTodos, categories: renderCategories, done: renderDone, settings: renderSettings };

  function render() {
    $('#viewTitle').textContent = VIEW_TITLES[ui.view];
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === ui.view));
    renderSyncBadge();
    // Re-rendering (e.g. when the other person edits the list) must not interrupt typing.
    const a = document.activeElement;
    const typing = a?.matches?.('#view input.input') && a.id ? { id: a.id, value: a.value, pos: a.selectionStart } : null;
    $('#view').innerHTML = RENDERERS[ui.view]();
    if (typing) {
      const n = document.getElementById(typing.id);
      if (n) { n.value = typing.value; n.focus(); try { n.setSelectionRange(typing.pos, typing.pos); } catch { /* not a text input */ } }
    }
    bindViewInputs();
  }

  function bindViewInputs() {
    const v = $('#view');
    if (ui.view === 'todos') {
      $('#quickAdd', v).onsubmit = (e) => {
        e.preventDefault();
        const t = $('#qaTitle', v);
        const title = t.value.trim();
        if (!title) return t.focus();
        ui.qaCat = $('#qaCat', v).value;
        t.value = '';
        putItem({ id: uid(), title, priority: ui.qaPrio, categoryId: ui.qaCat, createdAt: Date.now(), addedBy: me() });
        $('#qaTitle').focus();
      };
      $('#qaCat', v).onchange = (e) => { ui.qaCat = e.target.value; };
      $$('#qaPrio button', v).forEach((b) => b.onclick = () => {
        ui.qaPrio = b.dataset.prio;
        $$('#qaPrio button', v).forEach((x) => x.classList.toggle('active', x === b));
      });
      $$('#prioFilter button', v).forEach((b) => b.onclick = () => { ui.prio = b.dataset.prio; render(); });
      $('#sortBy', v).onchange = (e) => { state.settings.sort = e.target.value; save(); render(); };
      const mine = $('#mineOnly', v);
      if (mine) mine.onchange = () => { ui.mine = mine.checked; render(); };
      $('#search', v).oninput = (e) => { ui.q = e.target.value; render(); };
    }
    if (ui.view === 'settings') {
      $$('#themeSeg button', v).forEach((b) => b.onclick = () => { state.settings.theme = b.dataset.theme; save(); applyTheme(); render(); });
      $('#importFile', v).onchange = (e) => importBackup(e.target.files[0]);
      const join = $('#joinForm', v);
      if (join) join.onsubmit = (e) => { e.preventDefault(); const code = $('#joinCode', v).value.trim(); if (code) window.TodoSync.join(code); };
      const pick = $('#spacePick', v);
      if (pick) pick.onchange = () => window.TodoSync.switchSpace(pick.value);
    }
  }

  // ---------- To-do form ----------
  function openItemForm(id, presetCat) {
    const existing = id ? itemById(id) : null;
    const it = existing || { priority: ui.qaPrio, categoryId: presetCat || (ui.cat !== 'all' ? ui.cat : state.categories[0]?.id), due: '', qty: '', notes: '', title: '', assignee: '' };
    let cat = it.categoryId, prio = it.priority;
    const assign = isShared() ? `
      <div class="field"><label for="fAssign">Who's doing it</label>
        <select class="input" id="fAssign"><option value="">Anyone</option>${members().map((m) => `<option value="${esc(m.uid)}" ${it.assignee === m.uid ? 'selected' : ''}>${esc(m.name || m.email)}${m.uid === me() ? ' (me)' : ''}</option>`).join('')}</select></div>` : '';
    openModal(`
      <div class="modal-head"><h2>${existing ? 'Edit to-do' : 'New to-do'}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
      <form id="itemForm" class="grid" style="gap:14px">
        <div class="field"><label for="fTitle">What needs doing?</label><input class="input" id="fTitle" required maxlength="300" value="${esc(it.title)}" placeholder="e.g. Buy milk, fix the kitchen tap"></div>
        <div class="field"><label>Priority</label>${prioSeg('fPrio', prio)}</div>
        <div class="field"><label>Category</label>
          <div class="cat-picker" id="fCat">${state.categories.map((c) => `<button type="button" class="cat-chip ${c.id === cat ? 'active' : ''}" style="--c:${c.color}" data-cat="${esc(c.id)}">${catIcon(c)}<span>${esc(c.name)}</span></button>`).join('')}
            <button type="button" class="cat-chip add-chip" data-action="new-cat-inline"><span class="emoji">＋</span><span>New</span></button></div></div>
        <div class="form-grid">
          <div class="field"><label for="fDue">Due date (optional)</label><input class="input" type="date" id="fDue" value="${esc(it.due)}">
            <div class="quick-dates"><button type="button" class="link-btn" data-due="${todayStr()}">Today</button><button type="button" class="link-btn" data-due="${addDays(1)}">Tomorrow</button><button type="button" class="link-btn" data-due="${addDays(7)}">Next week</button><button type="button" class="link-btn" data-due="">None</button></div></div>
          <div class="field"><label for="fQty">Quantity (optional)</label><input class="input" id="fQty" maxlength="40" value="${esc(it.qty)}" placeholder="e.g. 2, 1 kg, 6 pack"></div>
          ${assign ? `<div class="full">${assign}</div>` : ''}
          <div class="field full"><label for="fNotes">Notes (optional)</label><textarea class="input" id="fNotes" rows="3" placeholder="Details, brand, links…">${esc(it.notes)}</textarea></div>
        </div>
        <div class="modal-foot">
          ${existing ? `<button type="button" class="btn btn-danger" id="fDelete" style="margin-right:auto">Delete</button>` : ''}
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${existing ? 'Save' : 'Add to-do'}</button>
        </div>
      </form>`, (root) => {
      const f = $('#itemForm', root);
      $$('#fPrio button', root).forEach((b) => b.onclick = () => { prio = b.dataset.prio; $$('#fPrio button', root).forEach((x) => x.classList.toggle('active', x === b)); });
      const bindCats = () => $$('#fCat [data-cat]', root).forEach((b) => b.onclick = () => { cat = b.dataset.cat; $$('#fCat [data-cat]', root).forEach((x) => x.classList.toggle('active', x === b)); });
      bindCats();
      $('[data-action="new-cat-inline"]', root).onclick = () => {
        const name = prompt('Name of the new category');
        if (!name?.trim()) return;
        const c = addCategory({ name: name.trim() });
        cat = c.id;
        const chip = document.createElement('button');
        chip.type = 'button'; chip.className = 'cat-chip'; chip.style.setProperty('--c', c.color); chip.dataset.cat = c.id;
        chip.innerHTML = `${catIcon(c)}<span>${esc(c.name)}</span>`;
        $('[data-action="new-cat-inline"]', root).before(chip);
        bindCats();
        chip.click();
      };
      $$('[data-due]', root).forEach((b) => b.onclick = () => { $('#fDue', root).value = b.dataset.due; });
      if (existing) $('#fDelete', root).onclick = () => { closeModal(); removeWithUndo([existing.id]); };
      f.onsubmit = (e) => {
        e.preventDefault();
        const title = $('#fTitle', root).value.trim();
        if (!title) return;
        putItem({
          ...(existing || { id: uid(), createdAt: Date.now(), addedBy: me() }),
          title, priority: prio, categoryId: cat,
          due: $('#fDue', root).value, qty: $('#fQty', root).value.trim(), notes: $('#fNotes', root).value.trim(),
          assignee: $('#fAssign', root)?.value ?? it.assignee ?? '',
        });
        closeModal();
        toast(existing ? 'Saved' : 'To-do added');
      };
      if (!existing) setTimeout(() => $('#fTitle', root).focus(), 50);
    });
  }

  function removeWithUndo(ids) {
    const removed = ids.map(itemById).filter(Boolean);
    deleteItems(ids);
    toast(removed.length === 1 ? 'To-do deleted' : `${removed.length} to-dos deleted`, {
      label: 'Undo',
      run: () => {
        state.items.push(...removed);
        commit(removed.map((item) => ({ t: 'put', item })));
      },
    });
  }

  function toggleDone(id) {
    const i = itemById(id);
    if (!i) return;
    const done = !i.done;
    putItem({ ...i, done, doneAt: done ? Date.now() : 0, doneBy: done ? me() : '' });
    if (done) toast(`Done: ${i.title}`, { label: 'Undo', run: () => putItem({ ...itemById(id), done: false, doneAt: 0, doneBy: '' }) });
  }

  // ---------- Categories ----------
  function addCategory({ name, icon, color }) {
    const used = new Set(state.categories.map((c) => c.color));
    const c = {
      id: uid(),
      name: name.slice(0, 40),
      icon: icon || '📌',
      color: color || PALETTE.find((p) => !used.has(p)) || PALETTE[state.categories.length % PALETTE.length],
    };
    setCategories([...state.categories, c]);
    return c;
  }

  function openCategoryForm(id) {
    const existing = state.categories.find((c) => c.id === id);
    const c = existing || { name: '', icon: '📌', color: PALETTE.find((p) => !state.categories.some((x) => x.color === p)) || PALETTE[0] };
    let color = c.color;
    const count = existing ? state.items.filter((i) => i.categoryId === id).length : 0;
    openModal(`
      <div class="modal-head"><h2>${existing ? 'Edit category' : 'New category'}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
      <form id="catForm" class="grid" style="gap:14px">
        <div class="form-grid" style="grid-template-columns:90px 1fr">
          <div class="field"><label for="cIcon">Icon</label><input class="input center" id="cIcon" maxlength="4" value="${esc(c.icon)}"></div>
          <div class="field"><label for="cName">Name</label><input class="input" id="cName" required maxlength="40" value="${esc(c.name)}" placeholder="e.g. Kids"></div>
        </div>
        <div class="emoji-pick">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>
        <div class="field"><label>Colour</label><div class="swatches">${PALETTE.map((p) => `<button type="button" class="swatch ${p === color ? 'active' : ''}" style="--c:${p}" data-color="${p}" aria-label="Colour ${p}"></button>`).join('')}</div></div>
        <div class="modal-foot">
          ${existing && state.categories.length > 1 ? `<button type="button" class="btn btn-danger" id="cDelete" style="margin-right:auto">Delete</button>` : ''}
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>`, (root) => {
      $$('[data-emoji]', root).forEach((b) => b.onclick = () => { $('#cIcon', root).value = b.dataset.emoji; });
      $$('[data-color]', root).forEach((b) => b.onclick = () => { color = b.dataset.color; $$('[data-color]', root).forEach((x) => x.classList.toggle('active', x === b)); });
      if (existing && $('#cDelete', root)) $('#cDelete', root).onclick = () => {
        const rest = state.categories.filter((x) => x.id !== id);
        const target = rest.find((x) => x.id === 'other') || rest[0];
        confirmBox(count ? `${count} to-do${count === 1 ? '' : 's'} in "${existing.name}" will move to "${target.name}".` : `Delete the "${existing.name}" category?`, () => {
          const moved = state.items.filter((i) => i.categoryId === id).map((i) => normalizeItem({ ...i, categoryId: target.id, updatedAt: Date.now() }));
          state.items = state.items.map((i) => moved.find((m) => m.id === i.id) || i);
          setCategories(rest, moved.map((item) => ({ t: 'put', item })));
          toast('Category deleted');
        });
      };
      $('#catForm', root).onsubmit = (e) => {
        e.preventDefault();
        const name = $('#cName', root).value.trim();
        if (!name) return;
        const icon = $('#cIcon', root).value.trim() || '📌';
        if (existing) setCategories(state.categories.map((x) => (x.id === id ? { ...x, name, icon, color } : x)));
        else addCategory({ name, icon, color });
        closeModal();
        toast('Category saved');
      };
    });
  }

  // ---------- Backup ----------
  function exportBackup() {
    const data = JSON.stringify({ app: 'todo-with-elias', version: 1, exportedAt: new Date().toISOString(), categories: state.categories, items: state.items }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `todos-backup-${todayStr()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importBackup(file) {
    if (!file) return;
    file.text().then((txt) => {
      const data = JSON.parse(txt);
      if (!Array.isArray(data.items)) throw new Error('bad file');
      const cats = [...state.categories];
      for (const c of data.categories || []) if (c?.id && !cats.some((x) => x.id === c.id)) cats.push(c);
      const items = data.items.map(normalizeItem);
      const byId = new Map(state.items.map((i) => [i.id, i]));
      for (const i of items) byId.set(i.id, i);
      state.items = [...byId.values()];
      setCategories(cats, items.map((item) => ({ t: 'put', item })));
      toast(`Restored ${items.length} to-do${items.length === 1 ? '' : 's'}`);
    }).catch(() => toast('That file is not a to-do backup'));
  }

  function loadDemo() {
    const now = Date.now();
    const cat = (id) => (state.categories.some((c) => c.id === id) ? id : state.categories[0].id);
    const demo = [
      ['Fix the leaking kitchen tap', 'high', 'home', addDays(1), ''],
      ['Change AC filters', 'medium', 'home', addDays(5), ''],
      ['Hang the new curtains', 'low', 'home', '', ''],
      ['Milk', 'high', 'groceries', '', '2'],
      ['Eggs', 'medium', 'groceries', '', '1 tray'],
      ['Basmati rice', 'medium', 'groceries', '', '5 kg'],
      ['Olive oil', 'low', 'groceries', '', ''],
      ['Renew car registration', 'high', 'errands', addDays(-1), ''],
      ['Pick up dry cleaning', 'medium', 'errands', todayStr(), ''],
      ['Book a dentist appointment', 'low', 'personal', '', ''],
    ];
    const items = demo.map(([title, priority, c, due, qty], n) => normalizeItem({ id: uid(), title, priority, categoryId: cat(c), due, qty, createdAt: now - n * 60000, addedBy: me() }));
    state.items.push(...items);
    commit(items.map((item) => ({ t: 'put', item })));
    toast('Example to-dos added');
  }

  // ---------- Actions ----------
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('.nav-item');
    if (nav) { ui.view = nav.dataset.view; render(); window.scrollTo({ top: 0 }); return; }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id } = el.dataset;
    switch (action) {
      case 'goto': ui.view = el.dataset.view; render(); window.scrollTo({ top: 0 }); break;
      case 'add-full': openItemForm(null, el.dataset.cat); break;
      case 'edit': openItemForm(id); break;
      case 'toggle': toggleDone(id); break;
      case 'delete': removeWithUndo([id]); break;
      case 'cycle-prio': {
        const i = itemById(id);
        if (i) putItem({ ...i, priority: PRIO_KEYS[(PRIO_KEYS.indexOf(i.priority) + 1) % PRIO_KEYS.length] });
        break;
      }
      case 'filter-cat': ui.cat = el.dataset.cat; if (ui.cat !== 'all') ui.qaCat = ui.cat; render(); break;
      case 'open-cat': ui.cat = ui.qaCat = el.dataset.cat; ui.view = 'todos'; render(); window.scrollTo({ top: 0 }); break;
      case 'edit-cat': e.stopPropagation(); openCategoryForm(el.dataset.cat); break;
      case 'new-cat': openCategoryForm(null); break;
      case 'clear-done': {
        const ids = doneItems().filter((i) => (ui.view === 'todos' ? matches(i) : matches(i, { ignoreCat: true }))).map((i) => i.id);
        if (ids.length) confirmBox(`Remove ${ids.length} completed to-do${ids.length === 1 ? '' : 's'}?`, () => removeWithUndo(ids), 'Clear');
        break;
      }
      case 'export': exportBackup(); break;
      case 'import': $('#importFile').click(); break;
      case 'demo': loadDemo(); break;
      case 'erase':
        if (!state.items.length) { toast('There are no to-dos to delete'); break; }
        confirmBox(`Delete all ${state.items.length} to-dos${isShared() ? ' for everyone on this list' : ''}? This can't be undone.`, () => {
          const ids = state.items.map((i) => i.id);
          state.items = [];
          commit(ids.map((x) => ({ t: 'del', id: x })));
          toast('All to-dos deleted');
        }, 'Delete all');
        break;
      case 'sync-signin': window.TodoSync?.signIn(); break;
      case 'sync-signout':
        confirmBox('Your to-dos stay safe in your account and come back when you sign in again. They will be removed from this device.', () => window.TodoSync?.signOut(), 'Sign out', 'Sign out?', false);
        break;
      case 'share-invite': {
        const url = window.TodoSync.inviteLink();
        const text = `Join our to-do list "${state.space?.name}" — open this link and sign in with Google:`;
        if (navigator.share) navigator.share({ title: 'To-dos with Elias', text, url }).catch(() => {});
        else copyText(url);
        break;
      }
      case 'copy-invite': copyText(window.TodoSync.inviteLink()); break;
      case 'rename-space': {
        const name = prompt('Name of this list', state.space?.name || '');
        if (name?.trim()) window.TodoSync.renameSpace(name.trim().slice(0, 60));
        break;
      }
      case 'leave-space':
        confirmBox(`You'll stop seeing "${state.space?.name}". You can join again with the invite link.`, () => window.TodoSync.leaveSpace(), 'Leave');
        break;
    }
  });

  // Keyboard access for the row "buttons"
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]')) { e.preventDefault(); e.target.click(); }
  });

  function copyText(text) {
    (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast('Invite link copied'), () => {
      const inp = $('#inviteLink');
      if (inp) { inp.select(); document.execCommand('copy'); toast('Invite link copied'); }
    });
  }

  // ---------- Bridge for sync.js ----------
  window.TodoApp = {
    LINK_KEY,
    getState: () => state,
    // Local edits that have not reached the cloud yet (sync.js drains this).
    takeOutbox() { const ops = readOutbox(); writeOutbox([]); return ops; },
    clearOutbox() { writeOutbox([]); },
    // Cloud data arrived: show it and keep a copy for fast, offline start-up.
    replaceState(next) {
      state = normalize({ ...state, ...next, settings: state.settings });
      save();
      render();
    },
    resetLocal() { state = normalize({ settings: state.settings }); save(); render(); },
    onSyncChange() { renderSyncBadge(); if (ui.view === 'settings') render(); },
    toast,
    confirm: (message, onYes, yesLabel, title) => confirmBox(message, onYes, yesLabel, title, false),
    goto(view) { ui.view = view; render(); },
  };

  // ---------- Boot ----------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  setTimeout(() => { if (!window.TodoSync) { syncUnavailable = true; renderSyncBadge(); if (ui.view === 'settings') render(); } }, 10000);
  // Opened from an invite link: show the "sign in to join" card (sync.js handles the joining).
  if (/join=/.test(location.hash) && !isLinked()) ui.view = 'settings';
  applyTheme();
  render();
})();
