/* Fuvarszervező V51 – online többfelhasználós mobil felület.
   A hitelesítés, a fuvarok, átadások és szállítólevél-fotók Supabase-ben tárolódnak. */
(function (global) {
  'use strict';

  const VERSION = '51-online';
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

  function setAppTitle(text) {
    document.title = text;
    const h1 = document.querySelector('#brandHome h1');
    if (h1) h1.textContent = text;
  }
  function authMessage(text, isError = true) {
    const message = byId('authMessage');
    if (!message) return;
    message.textContent = text || '';
    message.classList.toggle('hidden', !text);
    message.classList.toggle('success', !!text && !isError);
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
    authMessage(message, true);
    setAppTitle('Fuvarszervező');
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
    setAppTitle('Fuvarszervező V51');
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
    setAppTitle('Fuvarszervező V51');
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

  function userBubble(order, index) {
    const items = order.items || [];
    const received = items.filter(item => item.received).length;
    const reportPhotos = (order.deliveryReports || []).reduce((sum, report) => sum + (+report.photoCount || +report.fileCount || 0), 0);
    const canTransfer = !order.completed && !transferForOrder(order.id);
    return `<article class="mobile-user-bubble ${order.completed ? 'done' : ''}" data-id="${safe(order.id)}">
      <header><span class="mobile-sequence">${index + 1}</span><div><h3>${safe(order.orderNo)} · ${safe(order.projectName || 'Egyedi úticél')}</h3><small>${received}/${items.length} tétel átvéve</small></div></header>
      ${transferBadge(order)}
      <div class="mobile-stop pickup"><b>Felrakó</b><span>${safe(order.pickupName || 'Nincs megadva')}</span><small>${safe(order.pickupAddress || 'Cím nélkül')}</small></div>
      <div class="mobile-stop drop"><b>Lerakó</b><span>${safe(order.projectName || 'Egyedi úticél')}</span><small>${safe(order.dropAddress || 'Cím nélkül')}</small></div>
      ${order.pickupNote ? `<p><b>Felrakói megjegyzés:</b> ${safe(order.pickupNote)}</p>` : ''}
      ${order.note ? `<p><b>Fuvar megjegyzés:</b> ${safe(order.note)}</p>` : ''}
      ${order.recipientName || order.recipientPhone ? `<p><b>Átvevő:</b> ${safe(order.recipientName || '')}${order.recipientPhone ? ` · <a href="tel:${safe(order.recipientPhone)}">${safe(order.recipientPhone)}</a>` : ''}</p>` : ''}
      <div class="mobile-bubble-tags"><span>${items.length} tétel</span>${order.longMaterialReason ? `<span>${safe(order.longMaterialReason)}</span>` : ''}${reportPhotos ? `<span>📎 ${reportPhotos} fájl</span>` : ''}</div>
      <div class="mobile-user-actions"><button type="button" onclick="openItems('${safe(order.id)}')">Tételek / hátralék</button><button type="button" class="camera-action" onclick="openCamera('${safe(order.id)}')">📷 Szállítólevél</button><button type="button" class="secondary" onclick="openMediaGallery('${safe(order.id)}')">Mentett fotók</button>${canTransfer ? `<button type="button" class="transfer-action" onclick="openTransferDialog('${safe(order.id)}')">⇄ Fuvar átadása</button>` : ''}</div>
    </article>`;
  }

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
    const cfg = appUser(email);
    if (!cfg) return authMessage('Ez az e-mail-cím nincs engedélyezve.', true);
    const submit = byId('authSubmit');
    if (submit) submit.disabled = true;
    try {
      await global.V44Online.requestLoginLink(email);
      authMessage('A belépési linket elküldtük. Nyisd meg az e-mailt ezen az eszközön, majd kattints a linkre.', false);
    } catch (error) {
      authMessage(`Belépési hiba: ${error.message}`, true);
    } finally { if (submit) submit.disabled = false; }
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
      } else { state.orders = remoteOrders; state.backlog = remoteBacklog; }
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

  async function openMediaGallery(orderIds) {
    const ids = String(orderIds || '').split(',').map(id => id.trim()).filter(Boolean);
    if (!ids.length || ids.some(id => !canAccessOrder(id))) return alert('Ehhez a fuvarhoz nincs jogosultságod.');
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
      const files = groups.flat();
      if (host) host.innerHTML = files.length ? files.map(file => file.mime_type?.startsWith('audio/') ? `<article><audio controls src="${safe(file.url)}"></audio><small>${safe(file.orderNo)} · ${safe(file.file_name || 'Hangjegyzet')}</small></article>` : `<article><a href="${safe(file.url)}" target="_blank" rel="noopener"><img src="${safe(file.url)}" alt="Szállítólevél"></a><small>${safe(file.orderNo)} · ${safe(file.file_name || 'Fotó')}</small></article>`).join('') : '<div class="mobile-empty">Ehhez a fuvarhoz még nincs elmentett fotó.</div>';
    } catch (error) { if (host) host.innerHTML = `<div class="mobile-empty">Betöltési hiba: ${safe(error.message)}</div>`; }
  }
  global.openMediaGallery = openMediaGallery;

  function scheduleSync() {
    if (suppressOnlineSave || !currentProfile || !global.V44Online?.configured()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
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
      const files = [...(byId('cameraInput')?.files || [])];
      if (!files.length && !(typeof audioBlob !== 'undefined' && audioBlob)) return alert('Készíts legalább egy fotót vagy hangjegyzetet.');
      const submit = cameraForm.querySelector('button[type="submit"]');
      if (submit) { submit.disabled = true; submit.textContent = 'Fotók feltöltése…'; }
      try {
        const result = await global.V44Online.createDeliveryReport(order, files, byId('cameraNote')?.value || '', typeof audioBlob !== 'undefined' ? audioBlob : null);
        order.deliveryReports = order.deliveryReports || [];
        order.deliveryReports.push({ id: result.report.id, at: result.report.created_at || new Date().toISOString(), note: byId('cameraNote')?.value || '', photoCount: files.length, fileCount: result.report.fileCount, hasAudio: typeof audioBlob !== 'undefined' && !!audioBlob, createdBy: currentSession?.user?.email });
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
    try { await global.V44Online.acceptLoginLink(); }
    catch (error) {
      console.warn('[V51] Belépési link feldolgozási hiba', error);
      await global.V44Online.signOut().catch(() => {});
      return showLogin(`Belépési hiba: ${error.message}`);
    }
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
      console.warn('[V51] Munkamenet visszaállítási hiba', error);
      await global.V44Online.signOut().catch(() => {});
      showLogin('A munkamenet lejárt. Kérj új belépési linket.');
    }
  }

  function bindUi() {
    byId('authForm')?.addEventListener('submit', handleLogin);
    byId('driverLogout')?.addEventListener('click', logout);
    byId('accountLogout')?.addEventListener('click', logout);
    document.querySelectorAll('[data-close="mediaGalleryDialog"]').forEach(button => button.addEventListener('click', () => byId('mediaGalleryDialog')?.close()));
    global.addEventListener('fuvar-online-status', event => setSyncStatus(event.detail));
    if (byId('authHint')) byId('authHint').textContent = 'Írd be az e-mail-címedet; belépési linket küldünk.';
  }

  async function init() {
    injectOnlineUi();
    bindUi();
    installGuardsAndHooks();
    await restoreOnlineSession();
    global.V44_2Auth = { version: VERSION, users: Object.keys(USERS), canAccessOrder, renderDriverPortal, logout, refreshOnlineNow };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
