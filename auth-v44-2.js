/* Fuvarszervező V44.2 – mobil felhasználói felület és helyi teszt-hitelesítés.
   FONTOS: GitHub Pages statikus tárhelyen fut. Ez a kliensoldali beléptetés és a helyi
   adatbázis tesztelésre alkalmas, de külön telefonok közötti biztonságos szinkronhoz
   szerveroldali hitelesítés és közös adatbázis szükséges.
*/
(function (global) {
  'use strict';

  const VERSION = '44.2';
  const AUTH_KEY = 'fuvarszervezo_auth_v44_2';
  const SESSION_KEY = 'fuvarszervezo_session_v44_2';
  const MEDIA_DB = 'fuvarszervezo_media_v44_2';
  const FIXED_HASHES = {
    admin: 'c7e616822f366fb1b5e0756af498cc11d2c0862edcb32ca65882f622ff39de1b',
    test: '29db0c6782dbd5000559ef4d9e953e300e2b479eed26d887ef3f92b921c06a67'
  };
  const USERS = {
    'schmidt.martin@stand98.hu': { role: 'driver', driverKey: 'martin', displayName: 'Schmidt Martin' },
    'polgar.patrik@stand98.hu': { role: 'driver', driverKey: 'patrik', displayName: 'Polgár Patrik' },
    'berki.mario@stand98.hu': { role: 'driver', driverKey: 'mario', displayName: 'Berki Márió' },
    'szabo.sandor82@gmail.hu': { role: 'admin', displayName: 'Szabó Sándor', fixedHash: FIXED_HASHES.admin },
    'szabo.sandor@stand98.hu': { role: 'test', displayName: 'Teszt felhasználó', fixedHash: FIXED_HASHES.test }
  };

  let currentSession = null;
  let selectedDriverDate = typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10);
  let mediaDbPromise = null;

  const byId = id => document.getElementById(id);
  const normalizeEmail = value => String(value || '').trim().toLowerCase();
  const safe = value => typeof esc === 'function' ? esc(value || '') : String(value || '').replace(/[&<>"']/g, '');
  const localDate = offset => {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset);
    return typeof localISO === 'function' ? localISO(d) : d.toISOString().slice(0, 10);
  };
  const allowedDates = () => [localDate(0), localDate(1)];

  async function sha256(value) {
    const bytes = new TextEncoder().encode(String(value));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function authStore() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || '{}'); }
    catch (_) { return {}; }
  }
  function saveAuthStore(data) { localStorage.setItem(AUTH_KEY, JSON.stringify(data)); }
  function saveSession(session) {
    currentSession = session;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
  function clearSession() {
    currentSession = null;
    localStorage.removeItem(SESSION_KEY);
  }
  function readSession() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!parsed || !USERS[normalizeEmail(parsed.email)]) return null;
      return { ...parsed, email: normalizeEmail(parsed.email) };
    } catch (_) { return null; }
  }

  function userConfig(email = currentSession?.email) { return USERS[normalizeEmail(email)] || null; }
  function isAdmin() { return userConfig()?.role === 'admin'; }
  function isRestrictedUser() { return !!currentSession && !isAdmin(); }
  function vehicleForDriverKey(key) {
    const target = String(key || '').toLowerCase();
    return (state?.vehicles || []).find(vehicle => {
      const name = typeof norm === 'function' ? norm(vehicle.driverName || '') : String(vehicle.driverName || '').toLowerCase();
      return name.includes(target);
    }) || null;
  }
  function visibleVehicles() {
    const cfg = userConfig();
    if (!cfg) return [];
    if (cfg.role === 'test') return (typeof activeVehicles === 'function' ? activeVehicles() : state.vehicles || []);
    if (cfg.role === 'driver') {
      const vehicle = vehicleForDriverKey(cfg.driverKey);
      return vehicle ? [vehicle] : [];
    }
    return [];
  }
  function canAccessOrder(orderOrId) {
    if (isAdmin()) return true;
    if (!currentSession) return false;
    const order = typeof orderOrId === 'string' ? (state.orders || []).find(item => item.id === orderOrId) : orderOrId;
    if (!order || !allowedDates().includes(order.scheduleDate)) return false;
    const cfg = userConfig();
    if (cfg?.role === 'test') return true;
    const vehicle = vehicleForDriverKey(cfg?.driverKey);
    return !!vehicle && order.vehicleId === vehicle.id;
  }

  function setAppTitle(text) {
    document.title = text;
    const h1 = document.querySelector('#brandHome h1');
    if (h1) h1.textContent = text;
  }

  function showLogin(message = '') {
    document.body.classList.remove('auth-pending', 'mode-admin', 'mode-driver');
    document.body.classList.add('mode-login');
    byId('authScreen')?.classList.remove('hidden');
    byId('driverPortal')?.classList.add('hidden');
    document.querySelector('.topbar')?.classList.add('auth-app-hidden');
    document.querySelector('main')?.classList.add('auth-app-hidden');
    document.querySelector('nav')?.classList.add('auth-app-hidden');
    const msg = byId('authMessage');
    if (msg) { msg.textContent = message; msg.classList.toggle('hidden', !message); }
    setAppTitle('Fuvarszervező');
  }

  function showAdmin() {
    document.body.classList.remove('auth-pending', 'mode-login', 'mode-driver');
    document.body.classList.add('mode-admin');
    byId('authScreen')?.classList.add('hidden');
    byId('driverPortal')?.classList.add('hidden');
    document.querySelector('.topbar')?.classList.remove('auth-app-hidden');
    document.querySelector('main')?.classList.remove('auth-app-hidden');
    document.querySelector('nav')?.classList.remove('auth-app-hidden');
    byId('accountBar')?.classList.remove('hidden');
    if (byId('accountIdentity')) byId('accountIdentity').textContent = `${userConfig()?.displayName || currentSession.email} · ADMIN`;
    setAppTitle('Fuvarszervező V44');
    if (typeof render === 'function') render();
  }

  function showDriver() {
    document.body.classList.remove('auth-pending', 'mode-login', 'mode-admin');
    document.body.classList.add('mode-driver');
    byId('authScreen')?.classList.add('hidden');
    document.querySelector('.topbar')?.classList.add('auth-app-hidden');
    document.querySelector('main')?.classList.add('auth-app-hidden');
    document.querySelector('nav')?.classList.add('auth-app-hidden');
    byId('driverPortal')?.classList.remove('hidden');
    setAppTitle('Fuvarszervező V44.2');
    selectedDriverDate = allowedDates().includes(selectedDriverDate) ? selectedDriverDate : allowedDates()[0];
    renderDriverPortal();
  }

  function applySession() {
    if (!currentSession) return showLogin();
    if (isAdmin()) showAdmin(); else showDriver();
  }

  function formatDay(date) {
    const offset = date === allowedDates()[0] ? 'Ma' : 'Holnap';
    const d = new Date(`${date}T12:00:00`);
    const text = new Intl.DateTimeFormat('hu-HU', { month: 'short', day: 'numeric', weekday: 'short' }).format(d);
    return `${offset} · ${text}`;
  }

  function userBubble(order, index) {
    const items = order.items || [];
    const received = items.filter(item => item.received).length;
    const reportPhotos = (order.deliveryReports || []).reduce((sum, report) => sum + (+report.photoCount || 0), 0);
    return `<article class="mobile-user-bubble ${order.completed ? 'done' : ''}" data-id="${safe(order.id)}">
      <header><span class="mobile-sequence">${index + 1}</span><div><h3>${safe(order.orderNo)} · ${safe(order.projectName || 'Egyedi úticél')}</h3><small>${received}/${items.length} tétel átvéve</small></div></header>
      <div class="mobile-stop pickup"><b>Felrakó</b><span>${safe(order.pickupName || 'Nincs megadva')}</span><small>${safe(order.pickupAddress || 'Cím nélkül')}</small></div>
      <div class="mobile-stop drop"><b>Lerakó</b><span>${safe(order.projectName || 'Egyedi úticél')}</span><small>${safe(order.dropAddress || 'Cím nélkül')}</small></div>
      ${order.pickupNote ? `<p><b>Felrakói megjegyzés:</b> ${safe(order.pickupNote)}</p>` : ''}
      ${order.note ? `<p><b>Fuvar megjegyzés:</b> ${safe(order.note)}</p>` : ''}
      ${order.recipientName || order.recipientPhone ? `<p><b>Átvevő:</b> ${safe(order.recipientName || '')}${order.recipientPhone ? ` · <a href="tel:${safe(order.recipientPhone)}">${safe(order.recipientPhone)}</a>` : ''}</p>` : ''}
      <div class="mobile-bubble-tags"><span>${items.length} tétel</span>${order.longMaterialReason ? `<span>${safe(order.longMaterialReason)}</span>` : ''}${reportPhotos ? `<span>📎 ${reportPhotos} fotó</span>` : ''}</div>
      <div class="mobile-user-actions"><button type="button" onclick="openItems('${safe(order.id)}')">Tételek / hátralék</button><button type="button" class="camera-action" onclick="openCamera('${safe(order.id)}')">📷 Szállítólevél</button>${reportPhotos ? `<button type="button" class="secondary" onclick="openMediaGallery('${safe(order.id)}')">Mentett fotók</button>` : ''}</div>
    </article>`;
  }

  function renderDriverPortal() {
    if (!currentSession || isAdmin()) return;
    const cfg = userConfig();
    const identity = byId('driverPortalIdentity');
    if (identity) identity.textContent = `${cfg?.displayName || currentSession.email} · ${cfg?.role === 'test' ? 'TESZT' : 'SOFŐR'}`;
    const tabs = byId('driverDateTabs');
    if (tabs) tabs.innerHTML = allowedDates().map(date => `<button type="button" data-driver-date="${date}" class="${date === selectedDriverDate ? 'active' : ''}">${formatDay(date)}</button>`).join('');
    tabs?.querySelectorAll('[data-driver-date]').forEach(button => button.addEventListener('click', () => { selectedDriverDate = button.dataset.driverDate; renderDriverPortal(); }));

    const vehicles = visibleVehicles();
    const host = byId('driverPortalContent');
    if (!host) return;
    if (!vehicles.length) {
      host.innerHTML = '<div class="mobile-empty">A belépett e-mail-címhez nem található aktív sofőr/jármű. Az admin ellenőrizze a sofőr nevét.</div>';
      return;
    }
    host.innerHTML = vehicles.map(vehicle => {
      const orders = (state.orders || []).filter(order => order.scheduleDate === selectedDriverDate && order.vehicleId === vehicle.id)
        .sort((a, b) => (+a.sequence || 999) - (+b.sequence || 999));
      return `<section class="mobile-driver-section"><div class="mobile-driver-heading"><div><small>${safe(vehicle.name || vehicle.type || '')}</small><h2>${safe(vehicle.driverName)}</h2></div><span>${orders.length} fuvar</span></div><div class="mobile-driver-bubbles">${orders.length ? orders.map(userBubble).join('') : '<div class="mobile-empty">Erre a napra nincs fuvar.</div>'}</div></section>`;
    }).join('');
  }

  async function handleLogin(event) {
    event.preventDefault();
    const email = normalizeEmail(byId('authEmail')?.value);
    const password = byId('authPassword')?.value || '';
    const confirmation = byId('authPasswordConfirm')?.value || '';
    const cfg = USERS[email];
    const message = byId('authMessage');
    if (!cfg) {
      if (message) { message.textContent = 'Ez az e-mail-cím nincs engedélyezve.'; message.classList.remove('hidden'); }
      return;
    }
    if (!password) {
      if (message) { message.textContent = 'Add meg a jelszót.'; message.classList.remove('hidden'); }
      return;
    }
    const hash = await sha256(password);
    const store = authStore();
    if (cfg.fixedHash) {
      if (hash !== cfg.fixedHash) {
        if (message) { message.textContent = 'Hibás jelszó.'; message.classList.remove('hidden'); }
        return;
      }
    } else if (!store[email]?.passwordHash) {
      byId('authConfirmWrap')?.classList.remove('hidden');
      if (password.length < 4) {
        if (message) { message.textContent = 'Az első jelszó legalább 4 karakter legyen.'; message.classList.remove('hidden'); }
        return;
      }
      if (!confirmation) {
        if (message) { message.textContent = 'Első belépés: írd be még egyszer a választott jelszót.'; message.classList.remove('hidden'); }
        return;
      }
      if (password !== confirmation) {
        if (message) { message.textContent = 'A két jelszó nem egyezik.'; message.classList.remove('hidden'); }
        return;
      }
      store[email] = { passwordHash: hash, createdAt: new Date().toISOString() };
      saveAuthStore(store);
    } else if (hash !== store[email].passwordHash) {
      if (message) { message.textContent = 'Hibás jelszó.'; message.classList.remove('hidden'); }
      return;
    }
    saveSession({ email, role: cfg.role, loginAt: new Date().toISOString() });
    if (byId('authPassword')) byId('authPassword').value = '';
    if (byId('authPasswordConfirm')) byId('authPasswordConfirm').value = '';
    applySession();
  }

  function updateLoginFormForEmail() {
    const email = normalizeEmail(byId('authEmail')?.value);
    const cfg = USERS[email];
    const firstLogin = cfg?.role === 'driver' && !authStore()[email]?.passwordHash;
    byId('authConfirmWrap')?.classList.toggle('hidden', !firstLogin);
    const hint = byId('authHint');
    if (hint) hint.textContent = firstLogin ? 'Első belépés: válassz legalább 4 karakteres saját jelszót, majd erősítsd meg.' : 'Add meg a belépési jelszót.';
    const button = byId('authSubmit');
    if (button) button.textContent = firstLogin ? 'Jelszó beállítása és belépés' : 'Belépés';
  }

  async function changeOwnPassword() {
    const cfg = userConfig();
    if (!cfg || cfg.fixedHash) return alert('Ennél a teszt/fix fióknál a jelszó nem módosítható az alkalmazásban.');
    const oldPassword = prompt('Jelenlegi jelszó:'); if (oldPassword === null) return;
    const newPassword = prompt('Új jelszó (legalább 4 karakter):'); if (newPassword === null) return;
    if (newPassword.length < 4) return alert('Az új jelszó legalább 4 karakter legyen.');
    const confirmPassword = prompt('Új jelszó ismét:'); if (confirmPassword !== newPassword) return alert('A két új jelszó nem egyezik.');
    const store = authStore(), record = store[currentSession.email];
    if (!record || await sha256(oldPassword) !== record.passwordHash) return alert('A jelenlegi jelszó hibás.');
    record.passwordHash = await sha256(newPassword); record.updatedAt = new Date().toISOString(); saveAuthStore(store);
    alert('A jelszó módosítva.');
  }

  function logout() { clearSession(); showLogin('Sikeresen kijelentkeztél.'); }

  function openMediaDb() {
    if (mediaDbPromise) return mediaDbPromise;
    mediaDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(MEDIA_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('files')) {
          const store = db.createObjectStore('files', { keyPath: 'id' });
          store.createIndex('orderId', 'orderId', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return mediaDbPromise;
  }
  async function saveMediaRecords(records) {
    if (!records.length || !('indexedDB' in global)) return;
    const db = await openMediaDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite'), store = tx.objectStore('files');
      records.forEach(record => store.put(record));
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  }
  async function mediaForOrder(orderId) {
    if (!('indexedDB' in global)) return [];
    const db = await openMediaDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction('files', 'readonly').objectStore('files').index('orderId').getAll(orderId);
      request.onsuccess = () => resolve(request.result || []); request.onerror = () => reject(request.error);
    });
  }
  async function openMediaGallery(orderId) {
    if (!canAccessOrder(orderId)) return alert('Ehhez a fuvarhoz nincs jogosultságod.');
    const order = (state.orders || []).find(item => item.id === orderId);
    const files = await mediaForOrder(orderId);
    const host = byId('mediaGalleryBody');
    if (byId('mediaGalleryTitle')) byId('mediaGalleryTitle').textContent = `${order?.orderNo || ''} · mentett szállítólevelek`;
    if (host) host.innerHTML = files.length ? files.sort((a, b) => String(b.at).localeCompare(String(a.at))).map(file => {
      const url = URL.createObjectURL(file.blob);
      return file.type?.startsWith('audio/') ? `<article><audio controls src="${url}"></audio><small>${safe(file.name || 'Hangjegyzet')}</small></article>` : `<article><img src="${url}" alt="Szállítólevél"><small>${safe(file.name || 'Fotó')}</small></article>`;
    }).join('') : '<div class="mobile-empty">Ezen az eszközön nincs elmentett fotó.</div>';
    byId('mediaGalleryDialog')?.showModal();
  }
  global.openMediaGallery = openMediaGallery;

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
        if (isRestrictedUser()) setTimeout(renderDriverPortal, 0);
        return result;
      };
    }

    byId('itemsDialog')?.addEventListener('close', () => { if (isRestrictedUser()) renderDriverPortal(); });
    const cameraForm = byId('cameraForm');
    if (cameraForm) cameraForm.onsubmit = async event => {
      event.preventDefault();
      const orderId = byId('cameraOrderId')?.value;
      if (!canAccessOrder(orderId)) return alert('Ehhez a fuvarhoz nincs jogosultságod.');
      const order = (state.orders || []).find(item => item.id === orderId); if (!order) return;
      const reportId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      const files = [...(byId('cameraInput')?.files || [])];
      const records = files.map((file, index) => ({ id: `${reportId}-photo-${index}`, orderId, reportId, at: new Date().toISOString(), name: file.name, type: file.type, blob: file }));
      if (typeof audioBlob !== 'undefined' && audioBlob) records.push({ id: `${reportId}-audio`, orderId, reportId, at: new Date().toISOString(), name: 'Hangjegyzet', type: audioBlob.type || 'audio/webm', blob: audioBlob });
      try { await saveMediaRecords(records); } catch (error) { console.warn('[V44.2] Média mentési hiba', error); }
      order.deliveryReports = order.deliveryReports || [];
      order.deliveryReports.push({ id: reportId, at: new Date().toISOString(), note: byId('cameraNote')?.value || '', photoCount: files.length, hasAudio: typeof audioBlob !== 'undefined' && !!audioBlob, createdBy: currentSession?.email || 'admin' });
      cameraForm.closest('dialog')?.close();
      if (typeof audioBlob !== 'undefined') audioBlob = null;
      if (typeof save === 'function') save();
      alert('A szállítólevél és a megjegyzés ezen az eszközön elmentve.');
    };
  }

  function bindUi() {
    byId('authForm')?.addEventListener('submit', handleLogin);
    byId('authEmail')?.addEventListener('input', updateLoginFormForEmail);
    byId('authLogout')?.addEventListener('click', logout);
    byId('driverLogout')?.addEventListener('click', logout);
    byId('driverChangePassword')?.addEventListener('click', changeOwnPassword);
    byId('accountLogout')?.addEventListener('click', logout);
    document.querySelectorAll('[data-close="mediaGalleryDialog"]').forEach(button => button.addEventListener('click', () => byId('mediaGalleryDialog')?.close()));
    updateLoginFormForEmail();
  }

  function init() {
    bindUi();
    installGuardsAndHooks();
    currentSession = readSession();
    applySession();
    global.V44_2Auth = { version: VERSION, users: Object.keys(USERS), canAccessOrder, renderDriverPortal, logout };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
