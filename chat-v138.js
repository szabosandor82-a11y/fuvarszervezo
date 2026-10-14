/* Fuvarszervező V138 – Csevegő
   Gyors, nem hivatalos üzenetváltás az iroda és a sofőrök között.

   SOFŐR: jobb alul lebegő gomb (olvasatlan-számlálóval) → teljes képernyős
   beszélgetés az irodával. A csoportos („Mindenkinek”) üzenetek is itt
   jelennek meg. Csak a saját beszélgetését látja – ezt a szerver garantálja.

   ADMIN: alul annyi buborék, ahány aktív beszélgetés van; kattintásra kis
   csevegőablak nyílik (Messenger-szerűen, több is lehet nyitva). A „+”
   gombbal bárkivel vagy mindenkivel (csoportos üzenet) beszélgetés kezdhető.

   Mindkét oldalon: kép- és fájlküldés (beillesztéssel is), saját üzenet
   szerkesztése és törlése, „Látta” jelzés, hang és rezgés új üzenetnél.

   Az üzenetek lekérdezéssel érkeznek: nyitott beszélgetésnél 3, egyébként
   15 másodpercenként; háttérben lévő lapon szünetel. */
(function (global) {
  'use strict';

  const ALL = '__all__';
  const FAST_MS = 3000;
  const SLOW_MS = 15000;
  const ACTIVE_MS = 24 * 3600 * 1000;
  const MAX_FILE = 50 * 1024 * 1024;
  const LS_OPENED = 'chatV138Opened';
  const LS_DISMISSED = 'chatV138Dismissed';
  const DRIVER_COLORS = { mario: '#0b8f9c', patrik: '#d68a00', martin: '#8a3fc8' };

  /* ===== tiszta segédfüggvények (tesztelhetők) ======================== */
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function linkify(text) {
    const parts = String(text || '').split(/(https?:\/\/[^\s<]+)/g);
    return parts.map((part, index) => index % 2
      ? `<a href="${esc(part)}" target="_blank" rel="noopener">${esc(part)}</a>`
      : esc(part)).join('');
  }

  function fmtTime(iso, now = new Date()) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const hm = d.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
    const same = d.toDateString() === now.toDateString();
    return same ? hm : `${d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' })} ${hm}`;
  }

  function initials(name) {
    const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return ((words[0]?.[0] || '?') + (words[1]?.[0] || '')).toUpperCase();
  }

  const isImage = att => /^image\//i.test(att?.type || '') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(att?.name || '');
  const humanSize = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((bytes || 0) / 1024))} kB`;

  function readKey(conversation, email) { return `${conversation}|${String(email || '').toLowerCase()}`; }

  function lastRead(reads, conversation, email) {
    return reads.get(readKey(conversation, email)) || '';
  }

  /* Olvasatlan: a másik féltől érkezett, nem törölt üzenet, amely az
     utolsó olvasás után jött. */
  function unreadCount(messages, reads, conversation, me) {
    const since = lastRead(reads, conversation, me);
    let count = 0;
    for (const m of messages) {
      if (m.conversation !== conversation || m.deleted || m.sender_email === me) continue;
      if (!since || String(m.created_at) > since) count++;
    }
    return count;
  }

  /* „Látta” a saját üzenetnél. Csoportos üzenetnél: hányan olvasták. */
  function seenLabel(message, reads, me, users, myRole) {
    if (message.sender_email !== me || message.deleted) return '';
    const at = String(message.created_at);
    if (message.conversation === ALL) {
      const drivers = (users || []).filter(user => user.role !== 'admin');
      const seen = drivers.filter(user => lastRead(reads, ALL, user.email) >= at).length;
      return drivers.length ? `Látta: ${seen}/${drivers.length}` : 'Elküldve';
    }
    if (myRole === 'admin') {
      return lastRead(reads, message.conversation, message.conversation) >= at ? 'Látta' : 'Elküldve';
    }
    for (const [key, value] of reads) {
      const [conversation, email] = key.split('|');
      if (conversation === message.conversation && email !== me && value >= at) return 'Látta';
    }
    return 'Elküldve';
  }

  /* Az admin aktív beszélgetései: van olvasatlan, vagy 24 órán belül volt
     üzenet, vagy megnyitotta – kivéve, ha elrejtette, és azóta nem jött új. */
  function activeConversations({ messages, reads, me, opened, dismissed, now = Date.now() }) {
    const last = new Map();
    for (const m of messages) {
      const t = Date.parse(m.created_at) || 0;
      if (t > (last.get(m.conversation) || 0)) last.set(m.conversation, t);
    }
    const candidates = new Set([...last.keys(), ...(opened || [])]);
    const result = [];
    for (const conversation of candidates) {
      const lastAt = last.get(conversation) || 0;
      const unread = conversation === ALL ? 0 : unreadCount(messages, reads, conversation, me);
      const isOpened = (opened || new Set()).has(conversation);
      const dismissedAt = Date.parse((dismissed || {})[conversation] || '') || 0;
      /* Az elrejtett buborék akkor is rejtve marad, ha volt benne olvasatlan
         – az admin tudatosan rejtette el. A következő új üzenet visszahozza. */
      if (!isOpened && dismissedAt && dismissedAt >= lastAt) continue;
      if (isOpened || unread > 0 || (lastAt && now - lastAt < ACTIVE_MS)) result.push({ conversation, unread, lastAt });
    }
    return result.sort((a, b) => (b.unread > 0) - (a.unread > 0) || b.lastAt - a.lastAt);
  }

  /* ===== állapot ======================================================= */
  const st = {
    started: false, me: '', role: '', profile: null,
    messages: new Map(), reads: new Map(), lastUpdated: '', users: [],
    seen: new Set(), initialised: false, timer: null, busy: false,
    views: new Map(), signed: new Map(), driverOpen: false, openWins: [],
    root: null, audio: null
  };
  const api = () => global.V44Online;
  const sortedMessages = () => [...st.messages.values()].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  function loadJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; } catch (_) { return fallback; } }
  function saveJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} }
  const opened = () => new Set(loadJson(`${LS_OPENED}:${st.me}`, []));
  const setOpened = set => saveJson(`${LS_OPENED}:${st.me}`, [...set]);
  const dismissed = () => loadJson(`${LS_DISMISSED}:${st.me}`, {}) || {};
  const setDismissed = map => saveJson(`${LS_DISMISSED}:${st.me}`, map);

  function userOf(email) { return st.users.find(user => String(user.email || '').toLowerCase() === String(email || '').toLowerCase()); }
  function nameOf(conversation) {
    if (conversation === ALL) return 'Mindenkinek';
    const user = userOf(conversation);
    return user?.display_name || String(conversation).split('@')[0];
  }
  function colorOf(conversation) {
    if (conversation === ALL) return '#2563c9';
    return DRIVER_COLORS[userOf(conversation)?.driver_key] || '#4a6b8a';
  }

  /* ===== hang, rezgés, fülcím ========================================== */
  function beep() {
    try {
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return;
      st.audio = st.audio || new Ctx();
      const osc = st.audio.createOscillator(), gain = st.audio.createGain();
      osc.frequency.value = 880; gain.gain.value = 0.06;
      osc.connect(gain); gain.connect(st.audio.destination);
      osc.start(); osc.stop(st.audio.currentTime + 0.15);
    } catch (_) {}
    try { global.navigator?.vibrate?.(150); } catch (_) {}
  }
  function updateTitle(total) {
    const base = String(document.title || '').replace(/^\(\d+\)\s*/, '');
    document.title = total ? `(${total}) ${base}` : base;
  }

  /* ===== szerver ======================================================= */
  function merge(rows) {
    for (const row of rows || []) {
      if (!row?.id) continue;
      st.messages.set(String(row.id), row);
      if (String(row.updated_at || '') > st.lastUpdated) st.lastUpdated = String(row.updated_at || '');
    }
  }

  async function tick() {
    if (!st.started) return;
    if (st.busy) return schedule();
    st.busy = true;
    try {
      const rows = await api().chatFetchV138(st.lastUpdated ? { since: st.lastUpdated } : { days: 30 });
      const fresh = (rows || []).filter(row => row?.id && !st.seen.has(String(row.id)));
      merge(rows);
      const reads = await api().chatReadsV138();
      st.reads = new Map((reads || []).map(row => [readKey(row.conversation, row.reader_email), String(row.last_read_at || '')]));
      for (const row of rows || []) st.seen.add(String(row.id));
      if (st.initialised) notifyIncoming(fresh.filter(row => row.sender_email !== st.me && !row.deleted));
      st.initialised = true;
      render();
      await markVisibleRead();
    } catch (error) {
      console.warn('[V138] csevegő frissítése', error);
    } finally {
      st.busy = false;
      schedule();
    }
  }

  function anyOpen() { return st.role === 'admin' ? st.openWins.length > 0 : st.driverOpen; }
  function schedule() {
    clearTimeout(st.timer);
    if (!st.started) return;
    st.timer = setTimeout(tick, document.hidden ? SLOW_MS * 2 : anyOpen() ? FAST_MS : SLOW_MS);
  }

  function notifyIncoming(rows) {
    if (!rows.length) return;
    beep();
    if (st.role === 'admin') {
      const map = dismissed();
      for (const row of rows) delete map[row.conversation];
      setDismissed(map);
    }
  }

  async function markRead(conversation) {
    try {
      const row = await api().chatMarkReadV138(conversation);
      st.reads.set(readKey(row.conversation, row.reader_email), row.last_read_at);
    } catch (error) { console.warn('[V138] olvasottság', error); }
  }

  async function markVisibleRead() {
    if (document.hidden) return;
    const messages = sortedMessages();
    const targets = st.role === 'admin' ? st.openWins.slice() : (st.driverOpen ? [st.me, ALL] : []);
    let changed = false;
    for (const conversation of targets) {
      const hasMessages = messages.some(m => m.conversation === conversation);
      if (!hasMessages) continue;
      if (unreadCount(messages, st.reads, conversation, st.me) > 0 || !lastRead(st.reads, conversation, st.me)) {
        await markRead(conversation);
        changed = true;
      }
    }
    if (changed) renderBadges();
  }

  /* ===== nézet (egy beszélgetés) ======================================= */
  function createView(conversation, host, { includeGroup = false } = {}) {
    host.innerHTML = `
      <div class="cv-list" aria-live="polite"></div>
      <div class="cv-editbar hidden"><span>Üzenet szerkesztése</span><button type="button" data-act="cancel-edit">Mégse</button></div>
      <div class="cv-pending"></div>
      <form class="cv-compose">
        <button type="button" class="cv-attach" title="Kép vagy fájl csatolása" aria-label="Kép vagy fájl csatolása">📎</button>
        <textarea rows="1" placeholder="Üzenet…" aria-label="Üzenet"></textarea>
        <button type="submit" class="cv-send" title="Küldés" aria-label="Küldés">➤</button>
        <input type="file" multiple hidden>
      </form>`;
    const view = {
      conversation, includeGroup, host,
      list: host.querySelector('.cv-list'),
      editBar: host.querySelector('.cv-editbar'),
      pendingEl: host.querySelector('.cv-pending'),
      form: host.querySelector('.cv-compose'),
      input: host.querySelector('textarea'),
      fileInput: host.querySelector('input[type=file]'),
      pending: [], editing: null, signature: ''
    };
    host.querySelector('.cv-attach').onclick = () => view.fileInput.click();
    view.fileInput.onchange = () => { addFiles(view, [...view.fileInput.files]); view.fileInput.value = ''; };
    view.input.addEventListener('input', () => autosize(view.input));
    view.input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); view.form.requestSubmit?.() || submit(view); }
    });
    view.input.addEventListener('paste', event => {
      const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
      if (files.length) { event.preventDefault(); addFiles(view, files); }
    });
    view.form.addEventListener('submit', event => { event.preventDefault(); submit(view); });
    host.addEventListener('click', event => onViewClick(view, event));
    st.views.set(conversation, view);
    renderView(view, true);
    return view;
  }

  function autosize(el) { el.style.height = 'auto'; el.style.height = `${Math.min(140, el.scrollHeight)}px`; }

  function addFiles(view, files) {
    for (const file of files) {
      if (file.size > MAX_FILE) { alert(`A fájl túl nagy (max. 50 MB): ${file.name}`); continue; }
      view.pending.push(file);
    }
    renderPending(view);
  }
  function renderPending(view) {
    view.pendingEl.innerHTML = view.pending.map((file, index) =>
      `<span class="cv-chip">${esc(file.name || 'fájl')} <small>${humanSize(file.size)}</small><button type="button" data-act="unpend" data-i="${index}" aria-label="Eltávolítás">×</button></span>`).join('');
  }

  function viewMessages(view) {
    return sortedMessages().filter(m => m.conversation === view.conversation || (view.includeGroup && m.conversation === ALL));
  }

  function attachmentsHtml(message) {
    return (message.attachments || []).map(att => isImage(att)
      ? `<button type="button" class="cv-img-btn" data-act="open" data-path="${esc(att.path)}" aria-label="Kép megnyitása: ${esc(att.name)}"><img class="cv-img" data-path="${esc(att.path)}" alt="${esc(att.name)}"></button>`
      : `<button type="button" class="cv-file" data-act="open" data-path="${esc(att.path)}">📎 ${esc(att.name)} <small>${humanSize(att.size)}</small></button>`).join('');
  }

  function messageHtml(message, view) {
    const mine = message.sender_email === st.me;
    const group = message.conversation === ALL;
    const who = mine ? 'Én' : (message.sender_name || nameOf(message.sender_email));
    const label = group && view.conversation !== ALL ? '<span class="cv-group-tag">📢 Mindenkinek</span>' : '';
    const edited = message.edited_at && !message.deleted ? ' · szerkesztve' : '';
    const body = message.deleted ? '<i>Az üzenet törölve.</i>' : `${message.body ? `<div class="cv-text">${linkify(message.body)}</div>` : ''}${attachmentsHtml(message)}`;
    const foot = mine ? `<div class="cv-foot">${esc(seenLabel(message, st.reads, st.me, st.users, st.role))}</div>` : '';
    const actions = mine && !message.deleted
      ? `<button type="button" class="cv-more" data-act="menu" aria-label="Műveletek">⋯</button><span class="cv-actions"><button type="button" data-act="edit">Szerkesztés</button><button type="button" data-act="delete">Törlés</button></span>`
      : '';
    return `<div class="cv-msg ${mine ? 'mine' : 'theirs'}${group ? ' group' : ''}${message.deleted ? ' deleted' : ''}" data-id="${esc(message.id)}">
      <div class="cv-meta">${label}${esc(who)} · ${esc(fmtTime(message.created_at))}${edited}</div>
      <div class="cv-bubble">${body}</div>${foot}${actions}</div>`;
  }

  function renderView(view, forceBottom = false) {
    const messages = viewMessages(view);
    const signature = messages.map(m => `${m.id}:${m.updated_at}`).join('|') + `#${[...st.reads.values()].join(',')}`;
    if (signature === view.signature && !forceBottom) return;
    const nearBottom = view.list.scrollHeight - view.list.scrollTop - view.list.clientHeight < 80;
    view.signature = signature;
    view.list.innerHTML = messages.length
      ? messages.map(m => messageHtml(m, view)).join('')
      : `<div class="cv-empty">${view.conversation === ALL ? 'Írj üzenetet mindenkinek.' : 'Még nincs üzenet. Írj egyet!'}</div>`;
    hydrateImages(view);
    if (nearBottom || forceBottom) view.list.scrollTop = view.list.scrollHeight;
  }

  async function signedUrl(path) {
    const cached = st.signed.get(path);
    if (cached && cached.until > Date.now()) return cached.url;
    const url = await api().chatSignV138(path);
    if (url) st.signed.set(path, { url, until: Date.now() + 50 * 60 * 1000 });
    return url;
  }
  function hydrateImages(view) {
    for (const img of view.list.querySelectorAll('img.cv-img[data-path]')) {
      if (img.getAttribute('src')) continue;
      signedUrl(img.dataset.path).then(url => { if (url) img.src = url; }).catch(() => { img.alt = 'A kép nem tölthető be'; });
    }
  }

  async function onViewClick(view, event) {
    const button = event.target.closest('[data-act]');
    if (!button || !view.host.contains(button)) return;
    const act = button.dataset.act;
    const msgEl = button.closest('.cv-msg');
    const message = msgEl ? st.messages.get(msgEl.dataset.id) : null;
    if (act === 'unpend') { view.pending.splice(+button.dataset.i, 1); renderPending(view); }
    else if (act === 'cancel-edit') { stopEdit(view); }
    else if (act === 'menu' && msgEl) { msgEl.classList.toggle('show-actions'); }
    else if (act === 'edit' && message) {
      view.editing = message.id;
      view.input.value = message.body || '';
      view.editBar.classList.remove('hidden');
      msgEl.classList.remove('show-actions');
      autosize(view.input); view.input.focus();
    } else if (act === 'delete' && message) {
      msgEl.classList.remove('show-actions');
      if (!confirm('Törlöd ezt az üzenetet? A másik fél „Az üzenet törölve” feliratot fog látni.')) return;
      try { merge([await api().chatUpdateV138(message.id, { deleted: true })]); render(); }
      catch (error) { alert(`A törlés nem sikerült: ${error.message}`); }
    } else if (act === 'open') {
      try {
        const url = await signedUrl(button.dataset.path);
        if (!url) return alert('A fájl nem nyitható meg.');
        if (typeof global.openAttachmentV71 === 'function') global.openAttachmentV71(url);
        else global.open(url, '_blank', 'noopener');
      } catch (error) { alert(`A fájl nem nyitható meg: ${error.message}`); }
    }
  }

  function stopEdit(view) {
    view.editing = null;
    view.input.value = '';
    view.editBar.classList.add('hidden');
    autosize(view.input);
  }

  async function submit(view) {
    const text = view.input.value.trim();
    const sendButton = view.form.querySelector('.cv-send');
    if (view.editing) {
      if (!text) return alert('Az üzenet nem lehet üres. Törléshez használd a Törlés gombot.');
      sendButton.disabled = true;
      try { merge([await api().chatUpdateV138(view.editing, { body: text })]); stopEdit(view); render(); }
      catch (error) { alert(`A szerkesztés nem sikerült: ${error.message}`); }
      finally { sendButton.disabled = false; }
      return;
    }
    if (!text && !view.pending.length) return;
    sendButton.disabled = true;
    view.form.classList.add('sending');
    try {
      const attachments = [];
      for (const file of view.pending) attachments.push(await api().chatUploadV138(view.conversation, file));
      const row = await api().chatSendV138({ conversation: view.conversation, body: text, attachments, senderName: st.profile?.display_name || '' });
      merge([row]); st.seen.add(String(row.id));
      view.input.value = ''; view.pending = []; renderPending(view); autosize(view.input);
      if (st.role === 'admin') { const set = opened(); set.add(view.conversation); setOpened(set); }
      render();
      renderView(view, true);
    } catch (error) {
      alert(`Az üzenet nem ment el: ${error.message}`);
    } finally {
      sendButton.disabled = false;
      view.form.classList.remove('sending');
    }
  }

  /* ===== sofőri felület ================================================ */
  function buildDriverUi() {
    const root = document.createElement('div');
    root.className = 'cv-root cv-driver';
    root.innerHTML = `
      <button type="button" class="cv-fab" aria-label="Üzenetek az irodával">💬<span class="cv-badge hidden"></span></button>
      <section class="cv-panel hidden" role="dialog" aria-label="Üzenetek az irodával">
        <header class="cv-panel-head"><b>Üzenetek az irodával</b><button type="button" class="cv-close" aria-label="Bezárás">×</button></header>
        <div class="cv-view"></div>
      </section>`;
    document.body.append(root);
    st.root = root;
    const panel = root.querySelector('.cv-panel');
    createView(st.me, root.querySelector('.cv-view'), { includeGroup: true });
    root.querySelector('.cv-fab').onclick = () => {
      st.driverOpen = true; panel.classList.remove('hidden'); root.querySelector('.cv-fab').classList.add('hidden');
      renderView(st.views.get(st.me), true); markVisibleRead(); schedule();
    };
    root.querySelector('.cv-close').onclick = () => {
      st.driverOpen = false; panel.classList.add('hidden'); root.querySelector('.cv-fab').classList.remove('hidden'); schedule();
    };
  }

  /* ===== admin felület ================================================= */
  function buildAdminUi() {
    const root = document.createElement('div');
    root.className = 'cv-root cv-admin';
    root.innerHTML = `
      <div class="cv-windows"></div>
      <div class="cv-heads"></div>
      <div class="cv-picker hidden" role="menu"></div>`;
    document.body.append(root);
    st.root = root;
    root.addEventListener('click', onAdminClick);
  }

  function maxWindows() { return global.innerWidth < 760 ? 1 : 3; }

  function openWindow(conversation) {
    if (!st.openWins.includes(conversation)) st.openWins.unshift(conversation);
    st.openWins = st.openWins.slice(0, maxWindows());
    const set = opened(); set.add(conversation); setOpened(set);
    const map = dismissed(); delete map[conversation]; setDismissed(map);
    renderAdmin();
    const view = st.views.get(conversation);
    if (view) { renderView(view, true); view.input.focus(); }
    markVisibleRead(); schedule();
  }
  function closeWindow(conversation) {
    st.openWins = st.openWins.filter(item => item !== conversation);
    st.views.delete(conversation);
    renderAdmin(); schedule();
  }
  function dismissConversation(conversation) {
    closeWindow(conversation);
    const set = opened(); set.delete(conversation); setOpened(set);
    const map = dismissed(); map[conversation] = new Date().toISOString(); setDismissed(map);
    renderAdmin();
  }

  function onAdminClick(event) {
    const el = event.target.closest('[data-cv]');
    if (!el) return;
    const conversation = el.dataset.conv;
    const action = el.dataset.cv;
    if (action === 'head') { st.openWins.includes(conversation) ? closeWindow(conversation) : openWindow(conversation); }
    else if (action === 'dismiss') { event.stopPropagation(); dismissConversation(conversation); }
    else if (action === 'close') closeWindow(conversation);
    else if (action === 'plus') togglePicker();
    else if (action === 'pick') { togglePicker(false); openWindow(conversation); }
  }

  function togglePicker(force) {
    const picker = st.root.querySelector('.cv-picker');
    const show = force ?? picker.classList.contains('hidden');
    if (!show) { picker.classList.add('hidden'); return; }
    const drivers = st.users.filter(user => user.role !== 'admin' && user.email);
    picker.innerHTML = `<div class="cv-picker-title">Új beszélgetés</div>`
      + `<button type="button" data-cv="pick" data-conv="${ALL}">📢 Mindenkinek (csoportos)</button>`
      + drivers.map(user => `<button type="button" data-cv="pick" data-conv="${esc(String(user.email).toLowerCase())}"><span class="cv-dot" style="background:${colorOf(String(user.email).toLowerCase())}"></span>${esc(user.display_name || user.email)}</button>`).join('');
    picker.classList.remove('hidden');
  }

  function renderAdmin() {
    if (!st.root) return;
    const messages = sortedMessages();
    const active = activeConversations({ messages, reads: st.reads, me: st.me, opened: opened(), dismissed: dismissed() });
    const heads = st.root.querySelector('.cv-heads');
    heads.innerHTML = active.map(item => {
      const name = nameOf(item.conversation);
      return `<button type="button" class="cv-head${st.openWins.includes(item.conversation) ? ' open' : ''}${item.unread ? ' unread' : ''}" data-cv="head" data-conv="${esc(item.conversation)}" title="${esc(name)}" style="--cv-color:${colorOf(item.conversation)}">
        ${item.conversation === ALL ? '📢' : esc(initials(name))}
        ${item.unread ? `<span class="cv-badge">${item.unread}</span>` : ''}
        <span class="cv-head-x" data-cv="dismiss" data-conv="${esc(item.conversation)}" title="Buborék elrejtése" aria-label="Buborék elrejtése">×</span>
      </button>`;
    }).join('') + `<button type="button" class="cv-head cv-plus" data-cv="plus" title="Új beszélgetés" aria-label="Új beszélgetés">+</button>`;

    const windows = st.root.querySelector('.cv-windows');
    for (const el of [...windows.children]) if (!st.openWins.includes(el.dataset.conv)) el.remove();
    st.openWins.forEach((conversation, index) => {
      let win = windows.querySelector(`.cv-win[data-conv="${CSS.escape(conversation)}"]`);
      if (!win) {
        win = document.createElement('section');
        win.className = 'cv-win';
        win.dataset.conv = conversation;
        win.innerHTML = `<header class="cv-win-head" style="--cv-color:${colorOf(conversation)}"><span class="cv-dot"></span><b>${esc(nameOf(conversation))}</b><button type="button" class="cv-close" data-cv="close" data-conv="${esc(conversation)}" aria-label="Ablak bezárása">×</button></header><div class="cv-view"></div>`;
        windows.append(win);
        createView(conversation, win.querySelector('.cv-view'));
      }
      win.style.order = String(index);
    });
    const total = active.reduce((sum, item) => sum + item.unread, 0);
    updateTitle(total);
  }

  /* ===== közös rajzolás ================================================ */
  function renderBadges() {
    const messages = sortedMessages();
    if (st.role === 'admin') return renderAdmin();
    const total = unreadCount(messages, st.reads, st.me, st.me) + unreadCount(messages, st.reads, ALL, st.me);
    const badge = st.root?.querySelector('.cv-fab .cv-badge');
    if (badge) { badge.textContent = total ? String(total) : ''; badge.classList.toggle('hidden', !total); }
    st.root?.querySelector('.cv-fab')?.classList.toggle('pulse', total > 0);
    updateTitle(total);
  }
  function render() {
    if (!st.root) return;
    if (st.role === 'admin') renderAdmin(); else renderBadges();
    for (const view of st.views.values()) renderView(view);
  }

  /* ===== indítás / leállítás ========================================== */
  async function start(profile, email) {
    stop();
    Object.assign(st, {
      started: true, me: email, role: profile.role === 'admin' ? 'admin' : (profile.role || 'driver'), profile,
      messages: new Map(), reads: new Map(), lastUpdated: '', users: [], seen: new Set(), initialised: false,
      views: new Map(), signed: new Map(), driverOpen: false, openWins: []
    });
    if (st.role === 'admin') {
      try { st.users = (await api().listUsers()) || []; } catch (error) { console.warn('[V138] felhasználók', error); }
      buildAdminUi();
    } else buildDriverUi();
    tick();
  }
  function stop() {
    clearTimeout(st.timer);
    st.started = false;
    st.root?.remove();
    st.root = null;
    st.views = new Map();
  }

  function watch() {
    const online = api();
    const profile = online?.getProfile?.();
    const body = document.body;
    const inApp = body && (body.classList.contains('mode-admin') || body.classList.contains('mode-driver'));
    if (!online?.chatFetchV138 || !profile || !inApp) { if (st.started) stop(); return; }
    const email = online.chatMyEmailV138();
    if (!email) return;
    if (!st.started || st.me !== email) start(profile, email);
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => { if (!document.hidden && st.started) tick(); });
    setInterval(watch, 1500);
  }

  global.ChatV138 = {
    start, stop, tick, state: st,
    _logic: { esc, linkify, unreadCount, seenLabel, activeConversations, initials, lastRead, readKey, ALL }
  };
})(typeof window !== 'undefined' ? window : globalThis);
