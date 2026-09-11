/* Fuvarszervező – online többfelhasználós mobil felület.
   A hitelesítés, a fuvarok, átadások és szállítólevél-fotók Supabase-ben tárolódnak. */
(function (global) {
  'use strict';

  const VERSION = '52-online';
  const USERS = {
    'schmidt.martin@stand98.hu': { role: 'driver', driverKey: 'martin', displayName: 'Schmidt Martin' },
    'polgar.patrik@stand98.hu': { role: 'driver', driverKey: 'patrik', displayName: 'Polgár Patrik' },
    'berki.mario@stand98.hu': { role: 'driver', driverKey: 'mario', displayName: 'Berki Márió' },
    'szabo.sandor82@gmail.com': { role: 'admin', displayName: 'Szabó Sándor' },
    'szabo.sandor@stand98.hu': { role: 'test', displayName: 'Teszt felhasználó' }
  };
  const DRIVER_LABELS = { mario: 'Márió', patrik: 'Patrik', martin: 'Martin' };

  let currentSession = null;
  let currentProfile = null;
  let selectedDriverDate = typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10);
  let transferCache = [];
  let saveTimer = null;
  let suppressOnlineSave = false;
  let refreshInProgress = false;

  const byId = id => document.getElementById(id);
  const normalizeEmail = value => String(value || '').trim().toLowerCase();
  const safe = value => typeof esc === 'function' ? esc(value || '') : String(value || '').replace(/[&<>"']/g, '');
  const hasOutlookSource = order => !!(order && (order.sourceMail || order.outlookImport || order.outlookSourceFile || order.outlookPdfFile || /^outlook import/i.test(String(order.note || '')) || (order.deliveryReports || []).some(report => /^Outlook forrás/i.test(String(report.note || '')))));
  const localDate = offset => {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset);
    return typeof localISO === 'function' ? localISO(d) : d.toISOString().slice(0, 10);
  };
  const fallbackShiftWorkday = (date, amount = 1) => {
    const d = new Date(`${date}T12:00:00`);
    const direction = amount < 0 ? -1 : 1;
    let remaining = Math.abs(amount);
    while (remaining > 0) {
      d.setDate(d.getDate() + direction);
      if (d.getDay() !== 0 && d.getDay() !== 6) remaining -= 1;
    }
    return typeof localISO === 'function' ? localISO(d) : d.toISOString().slice(0, 10);
  };
  const allowedDates = () => {
    const rawToday = localDate(0);
    const current = typeof normalizeWorkday === 'function' ? normalizeWorkday(rawToday) : rawToday;
    const next = typeof shiftWorkday === 'function' ? shiftWorkday(current, 1) : fallbackShiftWorkday(current, 1);
    return [current, next];
  };
  const appUser = email => USERS[normalizeEmail(email)] || null;
  const isAdmin = () => currentProfile?.role === 'admin';
  const isRestrictedUser = () => !!currentProfile && !isAdmin();
  const activeProfile = () => currentProfile || appUser(currentSession?.user?.email);

  function vehicleForDriverKey(key) {
    const directId = global.V44Online?.DRIVER_VEHICLES?.[key];
    const direct = (global.state?.vehicles || []).find(v => v.id === directId);
    if (direct) return direct;
    const target = String(key || '').toLowerCase();
    return (global.state?.vehicles || []).find(vehicle => {
      const name = typeof norm === 'function' ? norm(vehicle.driverName || '') : String(vehicle.driverName || '').toLowerCase();
      return name.includes(target);
    }) || null;
  }
  function visibleVehicles() {
    const cfg = activeProfile();
    if (!cfg) return [];
    if (cfg.role === 'test') return typeof activeVehicles === 'function' ? activeVehicles() : state.vehicles || [];
    if (cfg.role === 'driver') {
      const vehicle = vehicleForDriverKey(cfg.driver_key || cfg.driverKey);
      return vehicle ? [vehicle] : [];
    }
    return [];
  }
  function canAccessOrder(orderOrId) {
    if (isAdmin()) return true;
    if (!currentProfile) return false;
    const order = typeof orderOrId === 'string' ? (state.orders || []).find(item => String(item.id) === String(orderOrId)) : orderOrId;
    if (!order || !allowedDates().includes(order.scheduleDate)) return false;
    if (currentProfile.role === 'test') return true;
    const vehicle = vehicleForDriverKey(currentProfile.driver_key);
    return !!vehicle && order.vehicleId === vehicle.id;
  }
  function orderDriverKey(order) { return global.V44Online?.driverKeyFromOrder(order) || ''; }

  // A verziószám egyetlen forrása a szétosztómotor VERSION konstansa.
  // Korábban itt beégetett szöveg állt, ezért a belépés után a fejléc
  // visszaugrott a régi verzióra.
  function appVersionLabel() {
    const version = global.V70Planner?.version||global.V55Planner?.version || global.V54Planner?.version
      || global.V53Planner?.version || global.V50Planner?.version || '';
    return version ? `Fuvarszervező V${version}` : 'Fuvarszervező';
  }
  function setAppTitle(text) {
    const label = text || appVersionLabel();
    document.title = label;
    const h1 = document.querySelector('#brandHome h1');
    if (h1) h1.textContent = label;
    document.querySelectorAll('[data-app-version]').forEach(node => { node.textContent = label; });
  }
  function authMessage(text, isError = true) {
    const message = byId('authMessage');
    if (!message) return;
    message.textContent = text || '';
    message.classList.toggle('hidden', !text);
    message.classList.toggle('success', !!text && !isError);
  }
  function loginErrorMessage(error) {
    const message = String(error?.message || error || '').trim();
    if (/invalid login credentials/i.test(message)) return 'Hibás e-mail-cím vagy jelszó.';
    if (/email not confirmed/i.test(message)) return 'Az e-mail-cím még nincs megerősítve a Supabase-ben.';
    if (/failed to fetch|networkerror|load failed/i.test(message)) return 'A Supabase jelenleg nem érhető el. Ellenőrizd, hogy a projekt aktív-e.';
    return message || 'Ismeretlen belépési hiba.';
  }
  function setSyncStatus(detail = {}) {
    const el = byId('onlineSyncStatus');
    if (!el) return;
    el.textContent = detail.message || 'Online';
    el.dataset.state = detail.state || 'online';
  }

  function captureViewScroll() {
    const scrolling = document.scrollingElement || document.documentElement;
    return {
      pageTop: scrolling?.scrollTop || global.scrollY || 0,
      routeTops: [...document.querySelectorAll('.route-list[id]')].map(element => [element.id, element.scrollTop]),
      navTop: document.querySelector('nav')?.scrollTop || 0
    };
  }

  function restoreViewScroll(snapshot) {
    if (!snapshot) return;
    const apply = () => {
      const scrolling = document.scrollingElement || document.documentElement;
      if (scrolling) scrolling.scrollTop = snapshot.pageTop || 0;
      document.querySelector('nav')?.scrollTo?.({ top: snapshot.navTop || 0, behavior: 'auto' });
      for (const [id, top] of snapshot.routeTops || []) {
        const element = byId(id);
        if (element) element.scrollTop = top || 0;
      }
    };
    global.requestAnimationFrame?.(() => global.requestAnimationFrame?.(apply));
    global.setTimeout(apply, 180);
  }

  function showLogin(message = '') {
    document.body.classList.remove('auth-pending', 'mode-admin', 'mode-driver');
    document.body.classList.add('mode-login');
    byId('authScreen')?.classList.remove('hidden');
    byId('driverPortal')?.classList.add('hidden');
    document.querySelector('.topbar')?.classList.add('auth-app-hidden');
    document.querySelector('main')?.classList.add('auth-app-hidden');
    document.querySelector('nav')?.classList.add('auth-app-hidden');
    byId('accountBar')?.classList.add('hidden');
    if (byId('authPassword')) byId('authPassword').value = '';
    authMessage(message, true);
    setAppTitle();
    if (!global.V44Online?.configured()) authMessage('Az online adatbázis még nincs beállítva. Töltsd ki az online-config.js fájlt a Supabase adataival.', true);
  }

  async function showAdmin() {
    document.body.classList.remove('auth-pending', 'mode-login', 'mode-driver');
    document.body.classList.add('mode-admin');
    byId('authScreen')?.classList.add('hidden');
    byId('driverPortal')?.classList.add('hidden');
    document.querySelector('.topbar')?.classList.remove('auth-app-hidden');
    document.querySelector('main')?.classList.remove('auth-app-hidden');
    document.querySelector('nav')?.classList.remove('auth-app-hidden');
    byId('accountBar')?.classList.remove('hidden');
    if (byId('accountIdentity')) byId('accountIdentity').textContent = `${currentProfile?.display_name || currentSession?.user?.email} · ADMIN`;
    setAppTitle(appVersionLabel());
    if (typeof render === 'function') render();
    await renderAdminOnlinePage();
  }

  async function showDriver() {
    document.body.classList.remove('auth-pending', 'mode-login', 'mode-admin');
    document.body.classList.add('mode-driver');
    byId('authScreen')?.classList.add('hidden');
    document.querySelector('.topbar')?.classList.add('auth-app-hidden');
    document.querySelector('main')?.classList.add('auth-app-hidden');
    document.querySelector('nav')?.classList.add('auth-app-hidden');
    byId('driverPortal')?.classList.remove('hidden');
    setAppTitle(appVersionLabel());
    selectedDriverDate = allowedDates().includes(selectedDriverDate) ? selectedDriverDate : allowedDates()[0];
    await renderDriverPortal();
  }

  async function applySession() {
    if (!currentSession || !currentProfile) return showLogin();
    if (isAdmin()) await showAdmin(); else await showDriver();
  }

  function formatDay(date) {
    const offset = date === allowedDates()[0] ? 'Ma' : 'Holnap';
    const d = new Date(`${date}T12:00:00`);
    const text = new Intl.DateTimeFormat('hu-HU', { month: 'short', day: 'numeric', weekday: 'short' }).format(d);
    return `${offset} · ${text}`;
  }
  function transferForOrder(orderId) {
    return transferCache.find(item => String(item.order_id) === String(orderId) && item.status === 'pending') || null;
  }
  function transferBadge(order) {
    const transfer = transferForOrder(order.id);
    if (!transfer) return '';
    return `<div class="transfer-pending-badge">Átadás folyamatban: ${safe(DRIVER_LABELS[transfer.from_driver_key] || transfer.from_driver_key)} → ${safe(DRIVER_LABELS[transfer.to_driver_key] || transfer.to_driver_key)}</div>`;
  }

  /* V57 – a sofőri oldal is listaszerű.

     Egy fuvar = egy sor:
         005714 — Hungarokomplex — Sofitel
         [Tétel/hátralék] [Szállítólevél] [Fuvar átadása]

     A tételablak ugyanaz, mint az admin oldalon; a fuvarátadás változatlan.
     A címek és a megjegyzések a sor kinyitásával érhetők el, hogy a lista
     áttekinthető maradjon. */
  function userBubble(order, index) {
    const items = order.items || [];
    const received = items.filter(item => item.received).length;
    const reportPhotos = (order.deliveryReports || []).reduce((sum, report) => sum + (+report.photoCount || +report.fileCount || 0), 0);
    const canTransfer = !order.completed && !transferForOrder(order.id);
    const commentClass = global.userCommentClass ? global.userCommentClass(order) : '';
    const hasSourceMail = order.sourceMail ? true : hasOutlookSource(order);
    const pickup = order.pickupName || 'Felrakó';
    const drop = order.projectName || 'Egyedi úticél';
    const detailId = `v57d-${safe(order.id)}`;
    return `<article class="mobile-user-row ${order.completed ? 'done' : ''}${commentClass}" data-id="${safe(order.id)}">
      <div class="v57-row-head">
        <span class="mobile-sequence">${index + 1}</span>
        <div class="v57-row-title">${safe(order.orderNo)} — ${safe(pickup)} — ${safe(drop)}</div>
        <button type="button" class="v57-detail-toggle" aria-expanded="false" title="Címek és megjegyzések"
          onclick="v57ToggleDriverDetail('${detailId}',this)">▾</button>
      </div>
      ${order.manualItems ? `<div class="v65-manual-note"><b>Megjegyzés:</b> ${safe(order.manualItems)}</div>` : ''}
      <div class="v57-row-actions">
        <button type="button" onclick="openItems('${safe(order.id)}')">Tételek${items.length ? ` (${received}/${items.length})` : ''}</button>
        <button type="button" class="camera-action" onclick="openCamera('${safe(order.id)}')">Szállítólevél</button>
        ${hasSourceMail ? `<button type="button" class="mail-action" onclick="openSourceMail('${safe(order.id)}')">Csatolmány</button>` : ''}
        ${canTransfer ? `<button type="button" class="transfer-action" onclick="openTransferDialog('${safe(order.id)}')">Fuvar átadása</button>` : ''}
      </div>
      ${transferBadge(order)}
      <div class="v57-row-detail" id="${detailId}" data-order-id="${safe(order.id)}" hidden>
        <div class="mobile-stop pickup"><b>Felrakó</b><span>${safe(pickup)}</span><small>${safe(order.pickupAddress || 'Cím nélkül')}</small></div>
        <div class="mobile-stop drop"><b>Lerakó</b><span>${safe(drop)}</span><small>${safe(order.dropAddress || 'Cím nélkül')}</small></div>
        ${order.pickupNote ? `<p><b>Felrakói megjegyzés:</b> ${safe(order.pickupNote)}</p>` : ''}
        ${order.note ? `<p><b>Fuvar megjegyzés:</b> ${safe(order.note)}</p>` : ''}
        ${order.recipientName || order.recipientPhone ? `<p><b>Átvevő:</b> ${safe(order.recipientName || '')}${order.recipientPhone ? ` · <a href="tel:${safe(order.recipientPhone)}">${safe(order.recipientPhone)}</a>` : ''}</p>` : ''}
        <div class="mobile-bubble-tags"><span>${items.length} tétel</span>${order.longMaterialReason ? `<span>${safe(order.longMaterialReason)}</span>` : ''}${reportPhotos ? `<span>📎 ${reportPhotos} fájl</span>` : ''}</div>
        <div class="v57-row-actions"><button type="button" class="secondary" onclick="openMediaGallery('${safe(order.id)}')">Mentett fotók</button></div>
      </div>
    </article>`;
  }

  global.v57ToggleDriverDetail = function (id, button) {
    const panel = document.getElementById(id);
    if (!panel) return;
    const opening = panel.hidden;
    panel.hidden = !panel.hidden;
    if (opening) global.markUserCommentRead?.(panel.dataset.orderId);
    button.textContent = panel.hidden ? '▾' : '▴';
    button.setAttribute('aria-expanded', String(!panel.hidden));
  };

  function pendingTransferCards() {
    const profileKey = currentProfile?.driver_key;
    if (!profileKey) return '';
    const pending = transferCache.filter(item => item.status === 'pending' && item.to_driver_key === profileKey);
    if (!pending.length) return '';
    return `<section class="incoming-transfers"><h2>Átvételre váró fuvarok</h2>${pending.map(item => `<article><div><b>${safe(item.order_no)} · ${safe(item.project_name || '')}</b><small>${safe(item.schedule_date || '')} · ${safe(DRIVER_LABELS[item.from_driver_key] || item.from_driver_key)} adná át</small></div><div><button type="button" onclick="respondTransfer('${safe(item.id)}','accept')">Elfogadom</button><button type="button" class="secondary" onclick="respondTransfer('${safe(item.id)}','reject')">Elutasítom</button></div></article>`).join('')}</section>`;
  }

  async function refreshTransfers() {
    try { transferCache = await global.V44Online.listTransfers(); }
    catch (error) { console.warn('[V48] Átadások betöltési hibája', error); transferCache = []; }
    return transferCache;
  }

  async function renderDriverPortal() {
    if (!currentProfile || isAdmin()) return;
    await refreshTransfers();
    const identity = byId('driverPortalIdentity');
    if (identity) identity.textContent = `${currentProfile.display_name || currentSession?.user?.email} · ${currentProfile.role === 'test' ? 'TESZT' : 'SOFŐR'}`;
    const tabs = byId('driverDateTabs');
    if (tabs) tabs.innerHTML = allowedDates().map(date => `<button type="button" data-driver-date="${date}" class="${date === selectedDriverDate ? 'active' : ''}">${formatDay(date)}</button>`).join('');
    tabs?.querySelectorAll('[data-driver-date]').forEach(button => button.addEventListener('click', async () => { selectedDriverDate = button.dataset.driverDate; await renderDriverPortal(); }));

    const vehicles = visibleVehicles();
    const host = byId('driverPortalContent');
    if (!host) return;
    if (!vehicles.length) {
      host.innerHTML = '<div class="mobile-empty">A belépett e-mail-címhez nem található aktív sofőr/jármű. Az admin ellenőrizze a sofőr nevét.</div>';
      return;
    }
    const sections = vehicles.map(vehicle => {
      const rows = (state.orders || []).filter(order => order.scheduleDate === selectedDriverDate && order.vehicleId === vehicle.id).sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
      return `<section class="mobile-driver-section"><div class="mobile-driver-title"><h2>${safe(vehicle.driverName)}</h2><span>${rows.length} fuvar</span></div>${rows.length ? rows.map(userBubble).join('') : '<div class="mobile-empty">Erre a napra nincs fuvar.</div>'}</section>`;
    }).join('');
    host.innerHTML = `${pendingTransferCards()}<div class="mobile-online-refresh"><button type="button" class="secondary" id="driverRefreshOnline">↻ Frissítés</button><span id="driverOnlineStatus">Online</span></div>${sections}`;
    byId('driverRefreshOnline')?.addEventListener('click', refreshOnlineNow);
  }

  async function refreshOnlineNow() {
    if (refreshInProgress) return;
    const scrollSnapshot = captureViewScroll();
    refreshInProgress = true;
    const refreshButton = byId('manualOnlineRefresh');
    if (refreshButton) { refreshButton.disabled = true; refreshButton.querySelector('small').textContent = 'Frissítés…'; }
    try {
      suppressOnlineSave = true;
      await global.V44Online.loadOrdersIntoState();
      if (isAdmin()) { await global.V44Online.loadMasterIntoState({ preserveLocalIfRemoteEmpty: true }); if (typeof render === 'function') render(); }
      await refreshTransfers();
      if (isAdmin()) await renderAdminOnlinePage(); else await renderDriverPortal();
    } catch (error) {
      alert(`Online frissítési hiba: ${error.message}`);
    } finally {
      suppressOnlineSave = false; refreshInProgress = false;
      if (refreshButton) { refreshButton.disabled = false; refreshButton.querySelector('small').textContent = 'Frissítés'; }
      restoreViewScroll(scrollSnapshot);
    }
  }
  global.refreshOnlineNow = refreshOnlineNow;

  async function handleLogin(event) {
    event.preventDefault();
    authMessage('');
    if (!global.V44Online?.configured()) return authMessage('Az online háttér nincs beállítva. Nyisd meg az ONLINE_BEALLITAS.md fájlt.', true);
    const email = normalizeEmail(byId('authEmail')?.value);
    const password = String(byId('authPassword')?.value || '');
    const cfg = appUser(email);
    if (!cfg) return authMessage('Ez az e-mail-cím nincs engedélyezve.', true);
    if (!password) return authMessage('Add meg a jelszót.', true);
    const submit = byId('authSubmit');
    if (submit) submit.disabled = true;
    try {
      await global.V44Online.signInWithPassword(email, password);
      currentSession = global.V44Online.getSession();
      currentProfile = await global.V44Online.fetchProfile();
      await initialOnlineLoad();
      await applySession();
      startPolling();
    } catch (error) {
      await global.V44Online.signOut().catch(() => {});
      currentSession = null;
      currentProfile = null;
      if (byId('authPassword')) byId('authPassword').value = '';
      authMessage(`Belépési hiba: ${loginErrorMessage(error)}`, true);
    } finally { if (submit) submit.disabled = false; }
  }

  /* V70 – ÖSSZEFÉSÜLÉS IDŐBÉLYEG ALAPJÁN

     Minden helyi módosítás kap egy localUpdatedAt bélyeget. Betöltéskor
     rekordonként azt tartjuk meg, amelyik frissebb. Így a másik napra
     áthelyezett fuvar nem ugrik vissza a régi dátumra.

     A szerveren nem létező, de helyben meglévő fuvar is megmarad – az vagy
     most keletkezett, vagy a feltöltése nem ment át. */
  function orderStampV70(order) {
    const value = order?.localUpdatedAt || order?.updated_at || order?.updatedAt || '';
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
  }

  function mergeOrdersByTimestampV70(localOrders, remoteOrders) {
    const remoteById = new Map((remoteOrders || []).map(order => [String(order.id), order]));
    const keptLocalIds = new Set();
    const orders = [];
    for (const local of localOrders || []) {
      const remote = remoteById.get(String(local.id));
      if (!remote) { orders.push(local); keptLocalIds.add(String(local.id)); continue; }
      remoteById.delete(String(local.id));
      if (orderStampV70(local) > orderStampV70(remote)) { orders.push(local); keptLocalIds.add(String(local.id)); }
      else orders.push(remote);
    }
    for (const remote of remoteById.values()) orders.push(remote);
    return { orders, keptLocalIds };
  }

  function mergeBacklogByTimestampV70(localBacklog, remoteBacklog, keptLocalIds) {
    if (!keptLocalIds || !keptLocalIds.size) return remoteBacklog || [];
    const kept = (localBacklog || []).filter(item => keptLocalIds.has(String(item.targetOrderId)));
    const keptIds = new Set(kept.map(item => String(item.id)));
    return [...(remoteBacklog || []).filter(item => !keptIds.has(String(item.id))), ...kept];
  }

  async function initialOnlineLoad() {
    const localOrders = [...(state.orders || [])];
    const [remoteOrders, remoteBacklog] = await Promise.all([global.V44Online.fetchOrders(), global.V44Online.fetchBacklog()]);
    suppressOnlineSave = true;
    try {
      if (currentProfile.role === 'admin') {
        try { await global.V44Online.loadMasterIntoState({ preserveLocalIfRemoteEmpty: true }); }
        catch (error) { console.warn('[V48] Online törzsadat betöltési hiba', error); }
      }
      if (currentProfile.role === 'admin' && !remoteOrders.length && localOrders.length) {
        const migrate = confirm(`Az online adatbázis üres, ezen az eszközön viszont ${localOrders.length} fuvar van. Feltöltsem őket az online adatbázisba?`);
        if (migrate) {
          await global.V44Online.syncOrders(localOrders, currentProfile);
          [state.orders, state.backlog] = await Promise.all([global.V44Online.fetchOrders(), global.V44Online.fetchBacklog()]);
        } else { state.orders = remoteOrders; state.backlog = remoteBacklog; }
      } else {
        // V70: NEM írjuk felül vakon a helyi állapotot. Ha egy fuvart helyben
        // módosítottunk (pl. másik napra raktuk), de a feltöltés még nem ment
        // át – mert 900 ms-en belül frissítettél, vagy hibára futott –, akkor
        // a régi szerveroldali állapot nyerne, és a változás elveszne.
        // Ezért időbélyeg alapján fésülünk: a frissebb rekord marad.
        const merged = mergeOrdersByTimestampV70(localOrders, remoteOrders);
        state.orders = merged.orders;
        state.backlog = mergeBacklogByTimestampV70(state.backlog || [], remoteBacklog, merged.keptLocalIds);
        if (merged.keptLocalIds.size) {
          console.info('[V70] Helyben frissebb fuvar megtartva:', merged.keptLocalIds.size);
          // a helyi többletet azonnal feltöltjük, hogy a szerver is kövesse
          try { await global.V44Online.syncOrders(state.orders, currentProfile); }
          catch (error) { console.warn('[V70] A helyi változás feltöltése nem sikerült', error); }
        }
      }
      if (typeof save === 'function') save(false);
      if (typeof render === 'function') render();
      await refreshTransfers();
    } finally { suppressOnlineSave = false; }
  }

  async function logout() {
    try { await global.V44Online.signOut(); } catch (_) {}
    currentSession = null; currentProfile = null; transferCache = [];
    showLogin('Sikeresen kijelentkeztél.');
  }

  function openTransferDialog(orderId) {
    if (!canAccessOrder(orderId)) return alert('Ehhez a fuvarhoz nincs jogosultságod.');
    const order = (state.orders || []).find(item => String(item.id) === String(orderId));
    if (!order) return;
    const fromKey = orderDriverKey(order);
    const select = byId('transferTarget');
    if (select) select.innerHTML = Object.entries(DRIVER_LABELS).filter(([key]) => key !== fromKey).map(([key, label]) => `<option value="${key}">${safe(label)}</option>`).join('');
    if (byId('transferOrderId')) byId('transferOrderId').value = order.id;
    if (byId('transferTitle')) byId('transferTitle').textContent = `${order.orderNo} · ${order.projectName || 'Fuvar'} átadása`;
    if (byId('transferInfo')) byId('transferInfo').textContent = `Jelenlegi sofőr: ${DRIVER_LABELS[fromKey] || fromKey || 'nincs kiosztva'}. A fuvar csak a másik sofőr elfogadása után kerül át.`;
    byId('transferDialog')?.showModal();
  }
  global.openTransferDialog = openTransferDialog;

  async function submitTransfer(event) {
    event.preventDefault();
    const orderId = byId('transferOrderId')?.value;
    const toDriver = byId('transferTarget')?.value;
    const note = byId('transferNote')?.value || '';
    try {
      await global.V44Online.requestTransfer(orderId, toDriver, note);
      byId('transferDialog')?.close();
      if (byId('transferNote')) byId('transferNote').value = '';
      await refreshTransfers();
      await renderDriverPortal();
      alert(`A fuvarátadási kérés elküldve ${DRIVER_LABELS[toDriver] || toDriver} részére.`);
    } catch (error) { alert(`Fuvarátadási hiba: ${error.message}`); }
  }

  async function respondTransfer(requestId, action) {
    try {
      if (action === 'accept') await global.V44Online.acceptTransfer(requestId);
      else await global.V44Online.rejectTransfer(requestId);
      await refreshOnlineNow();
      alert(action === 'accept' ? 'A fuvar átkerült hozzád.' : 'A fuvarátadást elutasítottad.');
    } catch (error) { alert(`Fuvarátadási hiba: ${error.message}`); }
  }
  global.respondTransfer = respondTransfer;

  async function listDeliveryFilesEventually(orderId) {
    let last = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        last = await global.V44Online.listDeliveryFiles(orderId);
        if (last.length || attempt === 2) return last;
      } catch (error) {
        if (attempt === 2) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    }
    return last;
  }

  /* V60 – az importált levél megnyitása a sofőri felületen.
     A levél szövege a fuvaron van, tehát hálózat nélkül is olvasható; a
     mellékleteket a szállítólevél-tárolóból töltjük be. */
  async function openSourceMail(orderId) {
    if (!canAccessOrder(orderId)) return alert('Ehhez a fuvarhoz nincs jogosultságod.');
    let order = (state.orders || []).find(item => String(item.id) === String(orderId));
    // A user portal régi munkamenetben is frissítse az Outlook-metaadatokat,
    // mert az admin által importált levél a szerver payloadjában lehet újabb.
    if (order && !order.sourceMail && global.V44Online?.fetchOrders) {
      try {
        const fresh = (await global.V44Online.fetchOrders()).find(item => String(item.id) === String(orderId));
        if (fresh) {
          if (fresh.sourceMail) order.sourceMail = fresh.sourceMail;
          ['outlookImport', 'outlookSourceFile', 'outlookPdfFile', 'note'].forEach(key => {
            if (fresh[key] !== undefined) order[key] = fresh[key];
          });
        }
      } catch (error) { console.warn('[V60] forráslevél frissítése sikertelen', error); }
    }
    if (!order) return alert('Ehhez a fuvarhoz nincs mentett levél.');
    const mail = order.sourceMail || {};
    if (!mail.subject && !mail.body && !hasOutlookSource(order)) {
      return alert('Ehhez a fuvarhoz nincs mentett Outlook-levél.');
    }
    global.markUserCommentRead?.(orderId);
    const host = byId('sourceMailBody');
    if (byId('sourceMailTitle')) byId('sourceMailTitle').textContent = mail.subject || 'Csatolmány';
    if (host) {
      host.innerHTML = `
        <div class="mail-meta">
          ${mail.from ? `<div><b>Feladó:</b> ${safe(mail.from)}</div>` : ''}
          ${mail.fileName ? `<div><b>Fájl:</b> ${safe(mail.fileName)}</div>` : ''}
          ${order.orderNo ? `<div><b>Rendelés:</b> ${safe(order.orderNo)}</div>` : ''}
        </div>
        ${order.manualItems ? `<div class="v65-manual-note"><b>Megjegyzés:</b> ${safe(order.manualItems)}</div>` : ''}
        <pre class="mail-body">${safe(mail.body || '(A levélnek nincs mentett szöveges tartalma.)')}</pre>
        ${(mail.attachmentNames || []).length ? `<div class="mail-meta"><b>Mellékletek:</b> ${safe(mail.attachmentNames.join(', '))}</div>` : ''}
        <div id="sourceMailFiles" class="mail-files"><small>Mellékletek betöltése…</small></div>`;
    }
    byId('sourceMailDialog')?.showModal();
    const files = byId('sourceMailFiles');
    if (!files) return;
    try {
      const list = await listDeliveryFilesEventually(orderId);
      // V70: itt fordítva – csak az Outlook-import forrásmellékletei.
      const all = (list || []).filter(file => /\.(pdf|jpe?g|png)$/i.test(file.file_name || ''));
      const sources = all.filter(file => file.is_source_mail).length
        ? all.filter(file => file.is_source_mail) : all;
      files.innerHTML = sources.length
        ? `<div class="mail-files-title">Mellékletek (${sources.length})</div>`
          + sources.map(file => `<a class="mail-file" href="${safe(file.url)}" target="_blank" rel="noopener"><i class="ti ti-paperclip" aria-hidden="true"></i> ${safe(file.file_name)}</a>`).join('')
        : '<small>Nincs feltöltött melléklet ehhez a fuvarhoz.</small>';
    } catch (error) {
      files.innerHTML = `<small>A mellékletek nem tölthetők be: ${safe(error.message)}</small>`;
    }
  }
  async function renderOrderPdfAttachments(orderIds, targetId) {
    const host = byId(targetId); if (!host) return;
    const ids = [...new Set((orderIds || []).flatMap(id => String(id || '').split(',')).map(id => id.trim()).filter(Boolean))];
    try {
      const lists = await Promise.all(ids.map(id => global.V44Online?.listDeliveryFiles ? listDeliveryFilesEventually(id) : Promise.resolve([])));
      const files = lists.flat().filter(file => /\.pdf$/i.test(file.file_name || ''));
      host.innerHTML = files.length
        ? `<div class="item-attachments-title">PDF mellékletek (${files.length})</div>${files.map(file => `<a class="mail-file item-pdf-link" href="${safe(file.url)}" target="_blank" rel="noopener">📄 ${safe(file.file_name || 'PDF melléklet')}</a>`).join('')}`
        : '<small>Nincs elérhető PDF-melléklet ehhez a tételhez.</small>';
    } catch (error) { host.innerHTML = `<small>A PDF-mellékletek nem tölthetők be: ${safe(error.message)}</small>`; }
  }
  async function openOrderPdfAttachments(orderIds) {
    const ids = [...new Set(String(orderIds || '').split(',').map(id => id.trim()).filter(Boolean))];
    const dialog = byId('sourceMailDialog'); const host = byId('sourceMailBody');
    if (!dialog || !host) return;
    ids.forEach(id => global.markUserCommentRead?.(id));
    if (byId('sourceMailTitle')) byId('sourceMailTitle').textContent = 'PDF mellékletek';
    host.innerHTML = '<div id="pdfAttachmentDialogFiles" class="mail-files"><small>PDF mellékletek betöltése…</small></div>';
    dialog.showModal();
    await renderOrderPdfAttachments(ids, 'pdfAttachmentDialogFiles');
  }
  global.renderOrderPdfAttachments = renderOrderPdfAttachments;
  global.openOrderPdfAttachments = openOrderPdfAttachments;
  global.openSourceMail = openSourceMail;

  async function openMediaGallery(orderIds) {
    const ids = String(orderIds || '').split(',').map(id => id.trim()).filter(Boolean);
    if (!ids.length || ids.some(id => !canAccessOrder(id))) return alert('Ehhez a fuvarhoz nincs jogosultságod.');
    ids.forEach(id => global.markUserCommentRead?.(id));
    const orders = ids.map(id => (state.orders || []).find(item => String(item.id) === id)).filter(Boolean);
    const orderNos = [...new Set(orders.map(order => order.orderNo).filter(Boolean))];
    const host = byId('mediaGalleryBody');
    if (byId('mediaGalleryTitle')) byId('mediaGalleryTitle').textContent = `${orderNos.join(', ') || 'Fuvar'} · mentett fotók`;
    if (host) host.innerHTML = '<div class="mobile-empty">Fotók betöltése…</div>';
    byId('mediaGalleryDialog')?.showModal();
    try {
      const groups = await Promise.all(ids.map(async id => {
        const order = (state.orders || []).find(item => String(item.id) === id);
        const files = await global.V44Online.listDeliveryFiles(id);
        return (files || []).map(file => ({ ...file, orderNo: order?.orderNo || '' }));
      }));
      /* V70: a Mentett fotók CSAK a sofőr által készített szállítóleveleket
         mutatja. Az Outlook-importból feltöltött forrásmellékletek a
         Csatolmány gomb mögé tartoznak, nem ide. */
      const files = groups.flat().filter(file => !file.is_source_mail);
      if (host) host.innerHTML = files.length ? files.map(file => file.mime_type?.startsWith('audio/') ? `<article><audio controls src="${safe(file.url)}"></audio><small>${safe(file.orderNo)} · ${safe(file.file_name || 'Hangjegyzet')}</small></article>` : `<article><a href="${safe(file.url)}" target="_blank" rel="noopener"><img src="${safe(file.url)}" alt="Szállítólevél"></a><small>${safe(file.orderNo)} · ${safe(file.file_name || 'Fotó')}</small></article>`).join('') : '<div class="mobile-empty">Ehhez a fuvarhoz még nincs elmentett fotó.</div>';
    } catch (error) { if (host) host.innerHTML = `<div class="mobile-empty">Betöltési hiba: ${safe(error.message)}</div>`; }
  }
  global.openMediaGallery = openMediaGallery;

  function scheduleSync() {
    if (suppressOnlineSave || !currentProfile || !global.V44Online?.configured()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      try {
        // A mobil állapot csak a felhasználó által látható fuvarokat és az általa frissen
        // létrehozott, jövőbeli hátralékos célfuvarokat tartalmazza. A szerveroldali RPC
        // újra ellenőrzi, hogy csak tétel-, hátralék- és fotóadat módosulhasson.
        const orders = state.orders || [];
        await global.V44Online.syncOrders(orders, currentProfile);
        if (currentProfile.role === 'admin') {
          try { await global.V44Online.syncMasterData(state, currentProfile); }
          catch (error) {
            console.warn('[V48] Törzsadat-szinkron hiba', error);
            setSyncStatus({ state: 'error', message: 'A fuvarok mentve, a törzsadat-szinkronhoz SQL-frissítés kell.' });
          }
        }
      } catch (error) {
        console.error('[V48] Online mentési hiba', error);
        setSyncStatus({ state: 'error', message: `Mentési hiba: ${error.message}` });
      }
    }, 900);
  }

  /* V70: ha a lap bezárul vagy háttérbe kerül, a függőben lévő mentést
     azonnal elindítjuk. Enélkül a 900 ms-es várakozás alatt elnavigálva a
     változás soha nem jutott fel a szerverre. */
  function flushPendingSyncV70() {
    if (!saveTimer) return;
    clearTimeout(saveTimer); saveTimer = null;
    if (suppressOnlineSave || !currentProfile || !global.V44Online?.configured()) return;
    try { global.V44Online.syncOrders(state.orders || [], currentProfile); }
    catch (error) { console.warn('[V70] Azonnali mentés nem sikerült', error); }
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPendingSyncV70(); });
    global.addEventListener?.('pagehide', flushPendingSyncV70);
    global.addEventListener?.('beforeunload', flushPendingSyncV70);
  }

  function installGuardsAndHooks() {
    const guardOrderFunction = (name, allowedForDrivers) => {
      const original = global[name];
      if (typeof original !== 'function') return;
      global[name] = function (orderId, ...args) {
        if (!isRestrictedUser()) return original.call(this, orderId, ...args);
        if (!allowedForDrivers || !canAccessOrder(orderId)) return alert('Ehhez a művelethez nincs jogosultságod.');
        return original.call(this, orderId, ...args);
      };
    };
    guardOrderFunction('openItems', true);
    guardOrderFunction('openCamera', true);
    guardOrderFunction('toggleItem', true);
    guardOrderFunction('updateMissingQty', true);
    guardOrderFunction('updateItemNote', true);
    guardOrderFunction('editOrder', false);
    guardOrderFunction('deleteOne', false);
    guardOrderFunction('toggleComplete', false);
    guardOrderFunction('failOrderToTomorrow', false);

    const originalSave = global.save;
    if (typeof originalSave === 'function') {
      global.save = function (...args) {
        const result = originalSave.apply(this, args);
        if (isRestrictedUser()) setTimeout(() => renderDriverPortal(), 0);
        scheduleSync();
        return result;
      };
    }

    byId('itemsDialog')?.addEventListener('close', () => { if (isRestrictedUser()) renderDriverPortal(); });
    const cameraForm = byId('cameraForm');
    if (cameraForm) cameraForm.onsubmit = async event => {
      event.preventDefault();
      const orderId = byId('cameraOrderId')?.value;
      if (!canAccessOrder(orderId)) return alert('Ehhez a fuvarhoz nincs jogosultságod.');
      const order = (state.orders || []).find(item => String(item.id) === String(orderId));
      if (!order) return;
      const files = global.V69DeliveryCamera?.files() || [...(byId('cameraInput')?.files || [])];
      if (!files.length && !(typeof audioBlob !== 'undefined' && audioBlob)) return alert('Készíts legalább egy fotót vagy hangjegyzetet.');
      const submit = cameraForm.querySelector('button[type="submit"]');
      if (submit) { submit.disabled = true; submit.textContent = 'Fotók feltöltése…'; }
      try {
        const result = await global.V44Online.createDeliveryReport(order, files, byId('cameraNote')?.value || '', typeof audioBlob !== 'undefined' ? audioBlob : null);
        order.deliveryReports = order.deliveryReports || [];
        const deliveryNote = byId('cameraNote')?.value || '';
        order.deliveryReports.push({ id: result.report.id, at: result.report.created_at || new Date().toISOString(), note: deliveryNote, photoCount: files.length, fileCount: result.report.fileCount, hasAudio: typeof audioBlob !== 'undefined' && !!audioBlob, createdBy: currentSession?.user?.email, createdRole: currentProfile?.role || 'driver', userComment: !!deliveryNote.trim(), commentAt: deliveryNote.trim() ? new Date().toISOString() : '' });
        cameraForm.closest('dialog')?.close();
        if (typeof audioBlob !== 'undefined') audioBlob = null;
        if (typeof save === 'function') save();
        alert('A szállítólevél fotói a rendeléshez elmentve.');
      } catch (error) { alert(`Szállítólevél-mentési hiba: ${error.message}`); }
      finally { if (submit) { submit.disabled = false; submit.textContent = 'Mentés a rendeléshez'; } }
    };
  }

  async function renderAdminOnlinePage() {
    const host = byId('onlineAdminContent');
    if (!host || !isAdmin()) return;
    host.innerHTML = '<div class="notice">Online adatok betöltése…</div>';
    try {
      const transfers = await global.V44Online.listTransfers();
      transferCache = transfers;
      host.innerHTML = `<div class="panel online-settings-card"><h3>Online szinkron</h3><small>A szállítólevél-fotók közvetlenül a rendeléshez kerülnek, és a Mentett fotók gombbal visszanézhetők.</small><div class="online-settings-actions"><button type="button" class="secondary" id="forceOnlineSync">Minden fuvar online mentése</button><button type="button" class="secondary" id="refreshOnlineAdmin">Online frissítés</button></div></div>
      <div class="panel"><h3>Fuvarátadások</h3><div class="transfer-admin-list">${transfers.length ? transfers.map(transfer => `<article class="transfer-admin-row status-${safe(transfer.status)}"><div><b>${safe(transfer.order_no)} · ${safe(transfer.project_name || '')}</b><small>${safe(transfer.schedule_date || '')}</small></div><div><span>${safe(DRIVER_LABELS[transfer.from_driver_key] || transfer.from_driver_key)} → ${safe(DRIVER_LABELS[transfer.to_driver_key] || transfer.to_driver_key)}</span><strong>${transfer.status === 'pending' ? 'Függőben' : transfer.status === 'accepted' ? 'Elfogadva' : transfer.status === 'rejected' ? 'Elutasítva' : 'Visszavonva'}</strong><small>${new Date(transfer.created_at).toLocaleString('hu-HU')}</small></div></article>`).join('') : '<div class="notice">Még nincs fuvarátadási esemény.</div>'}</div></div>`;
      byId('forceOnlineSync')?.addEventListener('click', async () => {
        try { await global.V44Online.syncOrders(state.orders || [], currentProfile); await global.V44Online.syncMasterData(state, currentProfile); alert('Minden fuvar és a teljes aktuális törzsadat online mentve.'); }
        catch (error) { alert(`Szinkronhiba: ${error.message}`); }
      });
      byId('refreshOnlineAdmin')?.addEventListener('click', refreshOnlineNow);
    } catch (error) { host.innerHTML = `<div class="notice">Online beállítások betöltési hibája: ${safe(error.message)}</div>`; }
  }

  function injectOnlineUi() {
    if (!byId('onlineSyncStatus')) {
      const badge = document.createElement('span');
      badge.id = 'onlineSyncStatus'; badge.className = 'online-sync-status'; badge.textContent = 'Kapcsolódás…';
      byId('accountBar')?.prepend(badge);
    }
    if (!byId('onlineAdmin')) {
      const section = document.createElement('section');
      section.id = 'onlineAdmin'; section.className = 'page';
      section.innerHTML = '<div class="page-head"><div><small>ONLINE</small><h2>Beállítások és fuvarátadások</h2></div></div><div id="onlineAdminContent"></div>';
      document.querySelector('main')?.append(section);
      const navButton = document.createElement('button');
      navButton.className = 'nav'; navButton.dataset.page = 'onlineAdmin'; navButton.innerHTML = '<span>⚙</span><small>Beállítások</small>';
      document.querySelector('nav')?.append(navButton);
      navButton.onclick = () => { if (typeof showPage === 'function') showPage('onlineAdmin'); renderAdminOnlinePage(); };
    }
    if (!byId('manualOnlineRefresh')) {
      const refreshButton = document.createElement('button');
      refreshButton.id = 'manualOnlineRefresh'; refreshButton.type = 'button'; refreshButton.className = 'nav manual-online-refresh';
      refreshButton.innerHTML = '<span>↻</span><small>Frissítés</small>';
      const nav = document.querySelector('nav');
      const controls = byId('plannerControls');
      if (nav) nav.insertBefore(refreshButton, controls?.parentElement === nav ? controls : null);
      refreshButton.onclick = refreshOnlineNow;
    }
    if (!byId('transferDialog')) {
      const dialog = document.createElement('dialog'); dialog.id = 'transferDialog';
      dialog.innerHTML = `<form id="transferForm"><div class="dialog-head"><h3 id="transferTitle">Fuvar átadása</h3><button type="button" class="close" data-close-transfer>×</button></div><input id="transferOrderId" type="hidden"><p id="transferInfo" class="notice"></p><label>Átvevő sofőr<select id="transferTarget"></select></label><label>Megjegyzés<textarea id="transferNote" rows="3" placeholder="Opcionális"></textarea></label><button type="submit">Átadási kérés elküldése</button></form>`;
      document.body.append(dialog);
      byId('transferForm')?.addEventListener('submit', submitTransfer);
      dialog.querySelector('[data-close-transfer]')?.addEventListener('click', () => dialog.close());
    }
  }

  function startPolling() {
    // V48: a főnézet nem frissül automatikusan. A felhasználó a Frissítés gombbal kér új adatokat.
    global.V44Online?.stopPolling?.();
  }

  async function restoreOnlineSession() {
    if (!global.V44Online?.configured()) return showLogin();
    const restored = global.V44Online.getSession();
    if (!restored?.access_token) return showLogin();
    try {
      await global.V44Online.ensureSession();
      currentSession = global.V44Online.getSession();
      currentProfile = await global.V44Online.fetchProfile();
      await initialOnlineLoad();
      await applySession();
      startPolling();
    } catch (error) {
      console.warn('[Fuvarszervező] Munkamenet visszaállítási hiba', error);
      await global.V44Online.signOut().catch(() => {});
      showLogin('A munkamenet lejárt. Jelentkezz be újra.');
    }
  }

  function bindUi() {
    byId('authForm')?.addEventListener('submit', handleLogin);
    byId('driverLogout')?.addEventListener('click', logout);
    byId('accountLogout')?.addEventListener('click', logout);
    document.querySelectorAll('[data-close="mediaGalleryDialog"]').forEach(button => button.addEventListener('click', () => byId('mediaGalleryDialog')?.close()));
    global.addEventListener('fuvar-online-status', event => setSyncStatus(event.detail));
    if (byId('authHint')) byId('authHint').textContent = 'Írd be az e-mail-címedet és a Supabase-ben beállított jelszavadat.';
  }

  async function init() {
    injectOnlineUi();
    bindUi();
    installGuardsAndHooks();
    await restoreOnlineSession();
    global.V44_2Auth = { version: VERSION, users: Object.keys(USERS), canAccessOrder, renderDriverPortal, logout, refreshOnlineNow, isRestrictedUser, currentUserKey: () => currentProfile?.role === 'admin' ? 'admin' : currentProfile?.role === 'driver' ? 'driver' : currentProfile?.role || '' };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
