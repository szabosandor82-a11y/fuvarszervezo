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
  let selectedDriverDate = '';   // az első megnyitáskor a mai munkanapra áll
  let driverDateInitialised = false;
  let transferCache = [];
  let saveTimer = null;
  let suppressOnlineSave = false;
  let refreshInProgress = false;

  /* ===== V132 – VÁLTOZÁSKÖVETÉS ======================================

     Minden fuvarról megjegyezzük, milyen állapotban volt, amikor utoljára
     a szerverrel egyeztettünk (betöltés vagy sikeres mentés). Ami azóta
     helyben változott, az „piszkos”: csak ez megy fel, és egy frissítés
     sem írhatja felül, amíg fel nem jutott.

       syncedV132        fuvar id → az utolsó egyeztetett állapot kulcsa
       syncedBacklogV132 hátralék id → ugyanez a hátraléklistára
       inflightV132      épp közvetlen mentés alatt álló fuvarok
       writtenAtV132     fuvar id → mikor jutott fel utoljára közvetlenül
       completedSeenV132 fuvar id → teljesített volt-e az előző mentéskor */
  const syncedV132 = new Map();
  const syncedBacklogV132 = new Map();
  const inflightV132 = new Set();
  const writtenAtV132 = new Map();
  const completedSeenV132 = new Map();
  const deletedThisSessionV132 = new Set();

  /* ===== V137 – A SZERVEREN TÖRÖLT FUVAR NEM TÉR VISSZA ================

     A telefon eddig nem tudta megkülönböztetni a helyben létrehozott, még
     fel nem töltött fuvart a szerveren közben TÖRÖLTTŐL – mindkettő „csak
     helyben létezett”. A törölt fuvart megtartotta, és minden mentéskor
     visszaküldte; a szerver ezt elutasította, és mivel a sofőr módosításai
     egyetlen kérésben mennek fel, emiatt a többi változása sem jutott fel.

     Most a program megjegyzi (tartósan), mely fuvarok voltak már a
     szerveren. Ami volt, de már nincs, az törölt: eltűnik. Helyben csak az
     maradhat meg, ami még soha nem volt fent, és sofőrnél csak akkor, ha
     hátralék-átütemezésből született (más új fuvart a szerver úgysem fogad
     el). */
  const KNOWN_IDS_KEY_V137 = 'fuvarszervezo_known_server_ids_v137';
  const knownServerIdsV137 = new Set();
  try { for (const id of JSON.parse(localStorage.getItem(KNOWN_IDS_KEY_V137) || '[]')) knownServerIdsV137.add(String(id)); } catch (_) {}
  function rememberServerIdsV137(ids) {
    let added = false;
    for (const id of ids || []) { const key = String(id || ''); if (key && !knownServerIdsV137.has(key)) { knownServerIdsV137.add(key); added = true; } }
    if (added) { try { localStorage.setItem(KNOWN_IDS_KEY_V137, JSON.stringify([...knownServerIdsV137])); } catch (_) {} }
  }
  function driverCreatedOrderV137(order) {
    return !!(order && (order.movedFromOrderId || order.failedMovedFrom || order.movedByDriverV121));
  }
  /* Megtartható-e egy helyben meglévő, a szerveren hiányzó fuvar? */
  function keepLocalOnlyOrderV137(order) {
    const id = String(order?.id || '');
    if (!id || knownServerIdsV137.has(id)) return false;
    if (currentProfile?.role === 'admin') return true;
    return driverCreatedOrderV137(order);
  }
  /* V137: az újraimport idejére a lecserélt fuvar szerveroldali törlése
     visszatartható, amíg a mellékletei át nem kerültek az új fuvarra
     (a szerver a fuvarral együtt a mellékletek nyilvántartását is törli). */
  const holdDeleteV137 = new Set();
  global.holdOrderDeletionV137 = ids => { for (const id of ids || []) holdDeleteV137.add(String(id)); };
  global.releaseOrderDeletionV137 = ids => { for (const id of ids || []) holdDeleteV137.delete(String(id)); retrySyncLaterV132(300); };
  let loadingV132 = false;

  function orderKeyV132(order) {
    if (!order) return '';
    const { localUpdatedAt, onlineUpdatedAt, ...rest } = order;
    try { return JSON.stringify(rest); } catch (_) { return String(Math.random()); }
  }
  function backlogKeyV132(entry) {
    try { return JSON.stringify(entry || {}); } catch (_) { return String(Math.random()); }
  }
  function isDirtyV132(order) {
    if (!order) return false;
    const id = String(order.id);
    return inflightV132.has(id) || syncedV132.get(id) !== orderKeyV132(order);
  }
  /* Egyeztetett állapot rögzítése. A `keepDirty` halmazban lévő fuvarok
     korábbi kulcsa megmarad, hogy továbbra is felmenjenek. */
  function resetSnapshotV132(keepDirty = new Set()) {
    const previous = new Map(syncedV132);
    syncedV132.clear();
    for (const order of state.orders || []) {
      const id = String(order.id);
      if (keepDirty.has(id)) { if (previous.has(id)) syncedV132.set(id, previous.get(id)); }
      else syncedV132.set(id, orderKeyV132(order));
    }
    syncedBacklogV132.clear();
    for (const entry of state.backlog || []) syncedBacklogV132.set(String(entry.id), backlogKeyV132(entry));
    rememberCompletionV132();
  }
  function rememberCompletionV132() {
    completedSeenV132.clear();
    for (const order of state.orders || []) completedSeenV132.set(String(order.id), !!order.completed);
  }
  /* A teljesítés visszavonása ESEMÉNY: időbélyeget kap, hogy az
     összefésülés (és a szerveroldali védelem) meg tudja különböztetni a
     régi, pipa nélküli adatpéldánytól. */
  function stampUndoV132() {
    const now = new Date().toISOString();
    for (const order of state.orders || []) {
      const id = String(order.id);
      const seen = completedSeenV132.get(id);
      if (seen === true && !order.completed) order.completedUndoneAtV132 = now;
      /* A tételenkénti pipálással teljesült fuvar is kapjon időpontot,
         különben egy korábbi visszavonás „későbbinek” látszana nála. */
      if (seen === false && order.completed && !order.completedAt && !order.completedAtV111) order.completedAt = now;
    }
    rememberCompletionV132();
  }
  function collectChangesV132() {
    const ids = new Set((state.orders || []).map(order => String(order.id)));
    const orders = (state.orders || []).filter(order => !inflightV132.has(String(order.id)) && syncedV132.get(String(order.id)) !== orderKeyV132(order));
    const deletedIds = [...syncedV132.keys()].filter(id => !ids.has(id) && !inflightV132.has(id) && !holdDeleteV137.has(id));
    const backlogIds = new Set((state.backlog || []).map(entry => String(entry.id)));
    const backlogChanged = (state.backlog || []).filter(entry => syncedBacklogV132.get(String(entry.id)) !== backlogKeyV132(entry));
    const backlogDeletedIds = [...syncedBacklogV132.keys()].filter(id => !backlogIds.has(id));
    return { orders, deletedIds, backlogChanged, backlogDeletedIds };
  }
  function hasChangesV132(changes) {
    return !!(changes.orders.length || changes.deletedIds.length || changes.backlogChanged.length || changes.backlogDeletedIds.length);
  }

  const byId = id => document.getElementById(id);
  const normalizeEmail = value => String(value || '').trim().toLowerCase();
  const safe = value => typeof esc === 'function' ? esc(value || '') : String(value || '').replace(/[&<>"']/g, '');
  /* V110: a kézzel feltöltött csatolmány is számít – enélkül a Csatolmány
     gomb csak az importált fuvaroknál jelent meg. */
  const hasOutlookSource = order => !!(order && (order.hasManualAttachV110 || order.sourceMail || order.outlookImport || order.outlookSourceFile || order.outlookPdfFile || /^outlook import/i.test(String(order.note || '')) || (order.deliveryReports || []).some(report => /^Outlook forrás/i.test(String(report.note || '')))));
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
  /* V71 – A SOFŐR HÁROM MUNKANAPOT LÁT

     Az előző munkanap azért kell, hogy utólag meg tudja nézni, mit vitt –
     de azt MÁR NEM SZERKESZTHETI, mert az a nap le van zárva. A mai és a
     következő munkanap szerkeszthető.

     Hétvégén nincs munkavégzés, ezért a lépegetés munkanapokat számol:
     pénteken a "következő" hétfő, hétfőn az "előző" péntek. */
  const allowedDates = () => {
    const rawToday = localDate(0);
    const current = typeof normalizeWorkday === 'function' ? normalizeWorkday(rawToday) : rawToday;
    const shift = (date, days) => typeof shiftWorkday === 'function'
      ? shiftWorkday(date, days) : fallbackShiftWorkday(date, days);
    const previous = shift(current, -1);
    const next = shift(current, 1);
    return [previous, current, next];
  };
  const currentWorkday = () => {
    const rawToday = localDate(0);
    return typeof normalizeWorkday === 'function' ? normalizeWorkday(rawToday) : rawToday;
  };
  /* Csak a MAI munkanap szerkeszthető. Az előző már lezárult, a következő
     pedig még nem aktuális – azt a sofőr csak előre megnézi, hogy tudja,
     mi vár rá. Ezt egy helyen döntjük el, hogy minden művelet ugyanazt a
     szabályt kövesse. */
  const isReadOnlyDate = date => String(date || '') !== currentWorkday();
  global.isDriverReadOnlyDate = isReadOnlyDate;
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
  function orderOf(orderOrId) {
    return typeof orderOrId === 'string'
      ? (state.orders || []).find(item => String(item.id) === String(orderOrId))
      : orderOrId;
  }
  /* Láthatóság: a sofőr a három munkanapot látja. */
  /* V113 – MEDDIG LÁTHAT A SOFŐR

     Visszafelé nincs korlát: a korábbi napok megtekinthetők. Előre a
     következő munkanapig, ahogy eddig. */
  function viewableDateV113(date) {
    const nap = String(date || '').slice(0, 10);
    if (!nap) return false;
    const utolso = allowedDates()[2];       // a következő munkanap
    return nap <= utolso;
  }

  function canAccessOrder(orderOrId) {
    if (isAdmin()) return true;
    if (!currentProfile) return false;
    const order = orderOf(orderOrId);
    /* V113: a MEGTEKINTÉS korlátlanul visszanyílik – a sofőr a saját autója
       bármelyik korábbi napját megnézheti. Előre marad holnapig, hogy ne
       lássa a félkész terveket.

       A SZERKESZTÉS szabálya nem változik: azt a canEditOrder dönti el, és
       az továbbra is csak a mai napot engedi. */
    if (!order || !viewableDateV113(order.scheduleDate)) return false;
    if (currentProfile.role === 'test') return true;
    const vehicle = vehicleForDriverKey(currentProfile.driver_key);
    return !!vehicle && order.vehicleId === vehicle.id;
  }
  /* Szerkeszthetőség: az ELŐZŐ munkanap csak olvasható. Ott a fuvar már
     lezárult, utólag nem módosítható – de megnézni meg lehet. */
  function canEditOrder(orderOrId) {
    if (!canAccessOrder(orderOrId)) return false;
    if (isAdmin()) return true;
    const order = orderOf(orderOrId);
    return !!order && !isReadOnlyDate(order.scheduleDate);
  }
  global.canEditOrder = canEditOrder;
  function orderDriverKey(order) { return global.V44Online?.driverKeyFromOrder(order) || ''; }

  // A verziószám egyetlen forrása a szétosztómotor VERSION konstansa.
  // Korábban itt beégetett szöveg állt, ezért a belépés után a fejléc
  // visszaugrott a régi verzióra.
  function appVersionLabel() {
    const version = global.V128Planner?.version||global.V123Planner?.version||global.V122Planner?.version||global.V121Planner?.version||global.V55Planner?.version || global.V54Planner?.version
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
    /* A nyitóoldal mindig a MAI napot mutatja. A felhasználó ezen belül
       válthat a tegnapi vagy a holnapi fülre, de újranyitáskor ismét a mai
       nap jön elő. */
    if (!driverDateInitialised) { selectedDriverDate = currentWorkday(); driverDateInitialised = true; }
    /* V71: ha az eltárolt nap már nem érvényes – például átfordult a nap, vagy
       hétvége után hétfő lett –, mindig a MAI munkanap nyílik meg, nem a
       lista első eleme (az a tegnapi volna). */
    /* V113: a korábbi napok is megmaradnak – csak a jövőbe nem engedünk. */
    selectedDriverDate = viewableDateV113(selectedDriverDate) ? selectedDriverDate : currentWorkday();
    await renderDriverPortal();
  }

  async function applySession() {
    if (!currentSession || !currentProfile) return showLogin();
    if (isAdmin()) await showAdmin(); else await showDriver();
  }

  /* V72: a fülek felirata. A középső a MAI nap, csak azon áll a "Ma" szó;
     a két szélső csak a dátumot mutatja. Korábban a lista első elemét hívta
     "Ma"-nak, ami a három napos nézet óta a tegnapi nap volt. */
  function formatDay(date) {
    const d = new Date(`${date}T12:00:00`);
    const text = new Intl.DateTimeFormat('hu-HU', { month: 'short', day: 'numeric' }).format(d);
    return date === currentWorkday() ? `Ma · ${text}` : text;
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
    /* V134: ugyanaz a szabály, mint az admin buborékon – a szám a
       ténylegesen meglévő fájlokból jön, üres galériánál alapállapot. */
    const delivery = typeof global.deliveryStateV134 === 'function'
      ? global.deliveryStateV134([order])
      : { files: 0, archived: 0, marked: false, label: 'Mentett fotók' };
    const reportPhotos = delivery.files;
    const canTransfer = !order.completed && !transferForOrder(order.id);
    const commentClass = global.userCommentClass ? global.userCommentClass(order) : '';
    const hasSourceMail = order.sourceMail ? true : hasOutlookSource(order);
    const pickup = order.pickupName || 'Felrakó';
    const drop = order.projectName || 'Egyedi úticél';
    const detailId = `v57d-${safe(order.id)}`;
    const locked = isReadOnlyDate(order.scheduleDate) && !isAdmin();
    return `<article class="mobile-user-row v126-${global.orderCompanyV126?.(order) || 'stand98'} ${order.completed ? 'done' : ''}${commentClass} ${locked ? 'locked-day' : ''}" data-id="${safe(order.id)}">
      ${locked ? `<div class="locked-note">${order.scheduleDate < currentWorkday() ? 'Lezárt nap' : 'Következő nap – előnézet'} – csak megtekinthető</div>` : ''}
      <div class="v57-row-head">
        <span class="mobile-sequence">${index + 1}</span>
        <div class="v57-row-title">${global.isFutureOrderV126?.(order) ? '<span class="v126-badge">Future</span>' : ''}${safe(order.orderNo)} — ${safe(pickup)} — ${safe(drop)}</div>
        <button type="button" class="v57-detail-toggle" aria-expanded="false" title="Címek és megjegyzések"
          onclick="v57ToggleDriverDetail('${detailId}',this)">▾</button>
      </div>
      ${(() => { const note = [order.note, order.manualItems].map(v => String(v || '').trim()).find(v => v && !/^outlook import/i.test(v)); return note ? `<div class="v65-manual-note"><b>Megjegyzés:</b> ${safe(note)}</div>` : ''; })()}
      <div class="v57-row-actions">
        <button type="button" onclick="openItems('${safe(order.id)}')">Tételek${items.length ? ` (${received}/${items.length})` : ''}</button>
        <button type="button" class="v111-done${order.completed ? ' active' : ''}"
          onclick="toggleOrderDoneV111('${safe(order.id)}')">${order.completed ? '✓ Teljesítve' : 'Fuvar teljesítve'}</button>
        <button type="button" class="v115-thread${global.threadHasUnreadV115?.(order) ? ' has-unread' : ''}"
          onclick="openThreadV115('${safe(order.id)}')">✉ Üzenetek${(global.orderThreadV115?.(order) || []).length
            ? ` (${(global.orderThreadV115?.(order) || []).length})` : ''}</button>
        <button type="button" class="camera-action${locked ? ' is-locked' : ''}" ${locked ? `disabled title="Csak az aktuális munkanapon tölthető fel"` : ''} onclick="openCamera('${safe(order.id)}')">Szállítólevél</button>
        <button type="button" class="secondary v133-saved-photos${delivery.marked ? ' has-photos' : ''}" onclick="openMediaGallery('${safe(order.id)}')">${safe(delivery.label)}</button>
        ${hasSourceMail ? `<button type="button" class="mail-action" onclick="openSourceMail('${safe(order.id)}')">Csatolmány</button>` : ''}
        ${canTransfer ? `<button type="button" class="transfer-action${locked ? ' is-locked' : ''}" ${locked ? `disabled title="Csak az aktuális munkanapon adható át"` : ''} onclick="openTransferDialog('${safe(order.id)}')">Fuvar átadása</button>` : ''}
      </div>
      ${transferBadge(order)}
      <div class="v57-row-detail" id="${detailId}" data-order-id="${safe(order.id)}" hidden>
        <div class="mobile-stop pickup"><b>Felrakó</b><span>${safe(pickup)}</span><small>${safe(order.pickupAddress || 'Cím nélkül')}</small></div>
        <div class="mobile-stop drop"><b>Lerakó</b><span>${safe(drop)}</span><small>${safe(order.dropAddress || 'Cím nélkül')}</small></div>
        ${order.pickupNote ? `<p><b>Felrakói megjegyzés:</b> ${safe(order.pickupNote)}</p>` : ''}
        ${order.note ? `<p><b>Fuvar megjegyzés:</b> ${safe(order.note)}</p>` : ''}
        ${order.recipientName || order.recipientPhone ? `<p><b>Átvevő:</b> ${safe(order.recipientName || '')}${order.recipientPhone ? ` · <a href="tel:${safe(order.recipientPhone)}">${safe(order.recipientPhone)}</a>` : ''}</p>` : ''}
        <div class="mobile-bubble-tags"><span>${items.length} tétel</span>${global.movedBubbleDateV124?.(order)||''}${order.longMaterialReason ? `<span>${safe(order.longMaterialReason)}</span>` : ''}${reportPhotos ? `<span>📎 ${reportPhotos} fájl</span>` : ''}</div>
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


  /* ===== V113 – NAPLÉPTETŐ ÉS KERESŐ A SOFŐRI FELÜLETEN ==============

     A sofőr eddig három munkanapot látott: tegnap, ma, holnap. Mostantól
     korlátlanul visszanézhet, és kereshet is a saját fuvarjai között.

     A SZERKESZTÉS szabálya nem változik: csak a mai nap módosítható. A
     korábbi napokon a felület megmutat mindent, de a műveletek nem futnak
     le – erre a canEditOrder figyel, és egy sáv is jelzi a képernyőn. */
  function driverOwnOrdersV113() {
    const sajat = visibleVehicles().map(vehicle => String(vehicle.id));
    return (state.orders || []).filter(order => sajat.includes(String(order.vehicleId)));
  }

  function driverSearchTextV113(order) {
    const tetelek = (order.items || [])
      .map(item => [item.code, item.description, item.name, item.note].filter(Boolean).join(' '))
      .join(' ');
    return [order.orderNo, order.pickupName, order.pickupAddress, order.projectName,
            order.dropAddress, order.recipientName, order.note, tetelek]
      .filter(Boolean).join(' ').toLowerCase();
  }

  function renderDriverSearchV113() {
    const mezo = byId('driverSearch'), host = byId('driverSearchResults');
    if (!mezo || !host) return;
    const q = String(mezo.value || '').trim().toLowerCase();
    byId('driverSearchClear')?.classList.toggle('hidden', !q);
    if (q.length < 2) { host.classList.add('hidden'); host.innerHTML = ''; return; }

    /* A legfrissebb naptól visszafelé – a gyakori eset pár hetes
       visszakeresés, az maradjon gyors akkor is, ha egy év adat gyűlt. */
    const talalt = driverOwnOrdersV113()
      .filter(order => viewableDateV113(order.scheduleDate) && driverSearchTextV113(order).includes(q))
      .sort((a, b) => String(b.scheduleDate || '').localeCompare(String(a.scheduleDate || '')))
      .slice(0, 60);

    host.classList.remove('hidden');
    host.innerHTML = talalt.length
      ? `<div class="v113-results-head">${talalt.length} találat</div>` + talalt.map(order => `
          <button type="button" class="v113-result" onclick="openDriverSearchHitV113('${safe(order.id)}')">
            <span class="v113-result-main"><b>${safe(order.orderNo || 'Rendelésszám nélkül')}</b>
              <small>${safe(order.pickupName || '')} → ${safe(order.projectName || order.dropAddress || '')}</small></span>
            <span class="v113-result-date">${safe(order.scheduleDate)}</span></button>`).join('')
      : '<div class="v113-results-empty">Nincs találat.</div>';
  }

  function openDriverSearchHitV113(orderId) {
    const order = (state.orders || []).find(item => String(item.id) === String(orderId));
    if (!order) return;
    selectedDriverDate = order.scheduleDate;
    byId('driverSearch').value = '';
    renderDriverSearchV113();
    renderDriverPortal();
    setTimeout(() => {
      const kartya = document.querySelector(`[data-order-id="${order.id}"]`);
      kartya?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
  }

  function stepDriverDayV113(irany) {
    const mostani = selectedDriverDate || currentWorkday();
    selectedDriverDate = typeof shiftWorkday === 'function'
      ? shiftWorkday(mostani, irany) : fallbackShiftWorkday(mostani, irany);
    if (!viewableDateV113(selectedDriverDate)) selectedDriverDate = mostani;
    renderDriverPortal();
  }

  function bindDriverToolsV113() {
    const mezo = byId('driverSearch');
    if (mezo && mezo.dataset.v113 !== '1') {
      mezo.dataset.v113 = '1';
      mezo.oninput = renderDriverSearchV113;
      byId('driverSearchClear').onclick = () => { mezo.value = ''; renderDriverSearchV113(); mezo.focus(); };
    }
    const picker = byId('driverDayPicker');
    if (picker && picker.dataset.v113 !== '1') {
      picker.dataset.v113 = '1';
      byId('driverDayPrev').onclick = () => stepDriverDayV113(-1);
      byId('driverDayNext').onclick = () => stepDriverDayV113(1);
      byId('driverDayToday').onclick = () => { selectedDriverDate = currentWorkday(); renderDriverPortal(); };
      picker.onchange = () => {
        const uj = String(picker.value || '').slice(0, 10);
        if (!uj) return;
        if (!viewableDateV113(uj)) { alert('A következő munkanapnál későbbi nap még nem nézhető meg.'); picker.value = selectedDriverDate; return; }
        selectedDriverDate = uj;
        renderDriverPortal();
      };
    }
  }

  /* A képernyő tetején jelezzük, ha a megnyitott nap csak megtekinthető. */
  function renderDriverReadOnlyBarV113() {
    const sav = byId('driverReadOnlyBar');
    if (!sav) return;
    const picker = byId('driverDayPicker');
    if (picker) picker.value = selectedDriverDate || '';
    const csakNezet = isReadOnlyDate(selectedDriverDate);
    sav.classList.toggle('hidden', !csakNezet);
    if (csakNezet) sav.textContent = `${selectedDriverDate} · csak megtekintés – módosítani a mai napon lehet`;
  }

  global.openDriverSearchHitV113 = openDriverSearchHitV113;
  global.bindDriverToolsV113 = bindDriverToolsV113;

  async function refreshTransfers() {
    try { transferCache = await global.V44Online.listTransfers(); }
    catch (error) { console.warn('[V48] Átadások betöltési hibája', error); transferCache = []; }
    return transferCache;
  }

  async function renderDriverPortal() {
    if (!currentProfile || isAdmin()) return;
    /* V113: a kereső és a napléptető bekötése, majd a megtekintés-sáv. */
    bindDriverToolsV113();
    await refreshTransfers();
    const identity = byId('driverPortalIdentity');
    if (identity) identity.textContent = `${currentProfile.display_name || currentSession?.user?.email} · ${currentProfile.role === 'test' ? 'TESZT' : 'SOFŐR'}`;
    const tabs = byId('driverDateTabs');
    if (tabs) tabs.innerHTML = allowedDates().map(date => `<button type="button" data-driver-date="${date}" class="${date === selectedDriverDate ? 'active' : ''} ${date === currentWorkday() ? 'today-tab' : 'readonly-tab'}" title="${date === currentWorkday() ? 'Az aktuális nap – szerkeszthető' : 'Csak megtekinthető'}">${formatDay(date)}</button>`).join('');
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
    renderDriverReadOnlyBarV113();
  }

  async function refreshOnlineNow() {
    if (refreshInProgress) return;
    const scrollSnapshot = captureViewScroll();
    refreshInProgress = true;
    const refreshButton = byId('manualOnlineRefresh');
    if (refreshButton) { refreshButton.disabled = true; refreshButton.querySelector('small').textContent = 'Frissítés…'; }
    try {
      suppressOnlineSave = true;
      await reloadOrdersV132();
      if (isAdmin()) { await global.V44Online.loadMasterIntoState({ preserveLocalIfRemoteEmpty: true }); if (typeof render === 'function') render(); }
      await refreshTransfers();
      if (isAdmin()) {
        await renderAdminOnlinePage();
        if (byId('onlineAdmin')?.classList.contains('active')) await global.renderArchiveSummaryV119?.();
      } else await renderDriverPortal();
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

  /* V104 – A SOFŐR MUNKÁJA MEZŐSZINTEN MARAD MEG

     Az összefésülés eddig EGÉSZBEN választott a helyi és a távoli fuvar
     közül, időbélyeg alapján. Ha a sofőr fotót töltött fel vagy hátralékot
     jelölt, majd az admin hozzányúlt ugyanahhoz a fuvarhoz – akár csak
     átrendezte a sorrendet –, az admin változata nyert, és a sofőr munkája
     ELTŰNT.

     Ez okozta mind a hármat: a hátralék nem került át, a Mentett fotók gomb
     nem zöldült be, és a tételek átvétele is visszaállhatott.

     Ezért a sofőri mezőket külön fésüljük: a szállítólevelek egyesülnek
     (azonosító szerint, duplikáció nélkül), a tételek átvétele és a
     hiányjelzés pedig onnan jön, ahol FRISSEBB. A sorrend és a sofőrkiosztás
     marad a győztes változaté – azt az admin kezeli. */
  function mergeDriverFieldsV104(nyertes, vesztes) {
    if (!nyertes || !vesztes) return nyertes;
    const egyesult = { ...nyertes };

    // szállítólevelek: minden fotó megmarad, azonosító szerint egyszer
    // V133: a törölt bejegyzés nem jön vissza, az archiválás jelölése marad
    const onlineV133 = (typeof globalThis !== 'undefined' && globalThis.V44Online) || null;
    if (onlineV133?.mergeReportsV133) {
      onlineV133.applyReportsV133(egyesult, onlineV133.mergeReportsV133(vesztes, nyertes));
    } else {
      const jelentesek = new Map();
      for (const forras of [vesztes.deliveryReports, nyertes.deliveryReports]) {
        for (const jelentes of forras || []) {
          const kulcs = String(jelentes?.id || jelentes?.at || JSON.stringify(jelentes));
          jelentesek.set(kulcs, jelentes);
        }
      }
      if (jelentesek.size) {
        egyesult.deliveryReports = [...jelentesek.values()]
          .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
      }
    }

    /* Tételek: az admin SOHA nem veszi vissza az átvételt, csak a sofőr
       jelöl. Ezért tételenként azt az oldalt vesszük, amelyik TÖBBET tud:
       ha az egyik oldalon át van véve vagy van hiányjelzés, az marad – a
       másik oldal üres állapota nem törölheti. */
    if (Array.isArray(vesztes.items) && Array.isArray(nyertes.items)) {
      /* V132: azonosító és cikkszám nélküli tételeknél a sorszám is a kulcs
         része – korábban ezek mind ugyanarra az üres kulcsra estek. */
      const tetelKulcs = (item, index) => String(item?._id || item?.code || `${item?.name || item?.description || ''}#${index}`);
      const vesztesTetel = new Map(vesztes.items.map((item, index) => [tetelKulcs(item, index), item]));
      egyesult.items = nyertes.items.map((item, index) => {
        const par = vesztesTetel.get(tetelKulcs(item, index));
        if (!par) return item;
        const hiany = value => String(value ?? '').trim() !== '';
        return {
          ...item,
          received: item.received || par.received,
          missingQty: hiany(item.missingQty) ? item.missingQty : par.missingQty,
          note: String(item.note || '').trim() ? item.note : par.note
        };
      });
    }
    /* V132: a teljesítés és a visszavonás időbélyeg szerint dől el. */
    const onlineV132 = (typeof globalThis !== 'undefined' && globalThis.V44Online) || null;
    if (onlineV132?.completionStateV132) {
      onlineV132.applyCompletionV132(egyesult, onlineV132.completionStateV132(nyertes, vesztes));
    } else {
      if (vesztes.completed) egyesult.completed = true;
      if (vesztes.completedAtV111 && !egyesult.completedAtV111) egyesult.completedAtV111 = vesztes.completedAtV111;
    }

    /* V114: a sofőr fuvar szintű megjegyzése is megmarad. A frissebb beírásé
       nyer; ha csak az egyik oldalon van, az marad. */
    /* V115: az üzenetszál mindkét oldalról egyesül, azonosító szerint
       egyszer, időrendben. A törölt üzenet NEM jöhet vissza. */
    /* V118: üres szál SOHA nem írhatja felül a meglévőt. */
    const szalFeso = (typeof globalThis !== 'undefined' && globalThis.mergeThreadsV115) || null;
    if (szalFeso) {
      const egyesitve = szalFeso(nyertes, vesztes);
      if (egyesitve.thread.length || egyesitve.deleted.length) {
        egyesult.threadV115 = egyesitve.thread;
        if (egyesitve.deleted.length) egyesult.threadDeletedV115 = egyesitve.deleted;
      }
    }

    const megjegyzesek = [nyertes, vesztes].filter(o => String(o?.driverNoteV111 || '').trim());
    if (megjegyzesek.length) {
      const forras = megjegyzesek.sort((a, b) =>
        String(b.driverNoteAtV111 || '').localeCompare(String(a.driverNoteAtV111 || '')))[0];
      egyesult.driverNoteV111 = forras.driverNoteV111;
      egyesult.driverNoteAtV111 = forras.driverNoteAtV111;
      egyesult.driverNoteByV111 = forras.driverNoteByV111;
    }
    return egyesult;
  }

  function mergeOrdersByTimestampV70(localOrders, remoteOrders) {
    const remoteById = new Map((remoteOrders || []).map(order => [String(order.id), order]));
    const keptLocalIds = new Set();
    const orders = [];
    for (const local of localOrders || []) {
      const remote = remoteById.get(String(local.id));
      if (!remote) { orders.push(local); keptLocalIds.add(String(local.id)); continue; }
      remoteById.delete(String(local.id));
      if (orderStampV70(local) > orderStampV70(remote)) { orders.push(mergeDriverFieldsV104(local, remote)); keptLocalIds.add(String(local.id)); }
      else orders.push(mergeDriverFieldsV104(remote, local));
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
        resetSnapshotV132();
      } else {
        // V70: NEM írjuk felül vakon a helyi állapotot. Ha egy fuvart helyben
        // módosítottunk (pl. másik napra raktuk), de a feltöltés még nem ment
        // át – mert 900 ms-en belül frissítettél, vagy hibára futott –, akkor
        // a régi szerveroldali állapot nyerne, és a változás elveszne.
        // Ezért időbélyeg alapján fésülünk: a frissebb rekord marad.
        const merged = mergeOrdersByTimestampV70(localOrders, remoteOrders);
        /* V137: a szerveren nem létező helyi fuvar közül csak a valóban új
           marad meg; a szerveren közben törölt eltűnik. */
        const remoteIdsV137 = new Set(remoteOrders.map(order => String(order.id)));
        const droppedV137 = [];
        merged.orders = merged.orders.filter(order => {
          const id = String(order.id);
          if (remoteIdsV137.has(id) || keepLocalOnlyOrderV137(order)) return true;
          droppedV137.push(order.orderNo || id);
          merged.keptLocalIds.delete(id);
          return false;
        });
        if (droppedV137.length) console.info('[V137] A szerveren már nem létező fuvar eltávolítva:', droppedV137.join(', '));
        rememberServerIdsV137(remoteIdsV137);
        state.orders = merged.orders;
        state.backlog = mergeBacklogByTimestampV70(state.backlog || [], remoteBacklog, merged.keptLocalIds);
        /* V132: csak a helyben frissebb fuvarok számítanak módosítottnak,
           és CSAK ezek mennek fel – a teljes lista nem, és törlés sincs. */
        resetSnapshotV132(merged.keptLocalIds);
        for (const id of merged.keptLocalIds) syncedV132.delete(id);
        if (merged.keptLocalIds.size) {
          console.info('[V70] Helyben frissebb fuvar megtartva:', merged.keptLocalIds.size);
          // a helyi többletet azonnal feltöltjük, hogy a szerver is kövesse
          try {
            const kept = state.orders.filter(order => merged.keptLocalIds.has(String(order.id)));
            await global.V44Online.syncChangedOrdersV132({ orders: kept }, currentProfile);
            for (const order of kept) syncedV132.set(String(order.id), orderKeyV132(order));
            rememberServerIdsV137(kept.map(order => order.id));
          }
          catch (error) { console.warn('[V70] A helyi változás feltöltése nem sikerült', error); }
        }
      }
      loadingV132 = true;
      try { if (typeof save === 'function') save(false); } finally { loadingV132 = false; }
      rememberCompletionV132();
      await refreshDeliveryCountsV132();
      if (typeof render === 'function') render();
      await refreshTransfers();
    } finally { suppressOnlineSave = false; }
  }

  /* ===== V132 – A FRISSÍTÉS ÖSSZEFÉSÜL, NEM CSERÉL ===================

     A régi loadOrdersIntoState egyszerűen lecserélte a helyi fuvarlistát
     a szerverről jöttre. Ha a lekérés a pipa megnyomása előtt indult el,
     vagy a mentés még úton volt, a régi szerverállapot felülírta a helyi
     pipát – és a késleltetett mentés ezt a régit vissza is írta.

     Most a még fel nem jutott (piszkos vagy épp mentés alatt álló) fuvar
     helyi változata marad meg, a szerver sofőri mezőivel összefésülve. Ha
     egy fuvar közvetlen mentése a lekérés indulása UTÁN fejeződött be, a
     szerver válasza már régi lehet, ezért annál is a helyi marad. */
  async function reloadOrdersV132() {
    const fetchStartedAt = Date.now();
    const [remoteOrders, remoteBacklog] = await Promise.all([global.V44Online.fetchOrders(), global.V44Online.fetchBacklog()]);
    loadingV132 = true;
    try {
      const localById = new Map((state.orders || []).map(order => [String(order.id), order]));
      const keep = new Set();
      for (const order of state.orders || []) {
        const id = String(order.id);
        if (isDirtyV132(order) || (writtenAtV132.get(id) || 0) >= fetchStartedAt) keep.add(id);
      }
      const remoteIds = new Set(remoteOrders.map(order => String(order.id)));
      const merged = remoteOrders.map(remote => {
        const id = String(remote.id);
        const local = localById.get(id);
        if (!local || !keep.has(id)) return remote;
        const egyesult = mergeDriverFieldsV104(local, remote);
        if (currentProfile?.role !== 'admin') egyesult.items = local.items;
        return egyesult;
      });
      /* A szerveren még nem létező, de helyben piszkos fuvar (pl. most
         létrehozott célfuvar) megmarad, amíg fel nem jut. */
      /* V137: csak a még soha fel nem jutott, valóban új fuvar marad meg. */
      for (const [id, local] of localById) if (keep.has(id) && !remoteIds.has(id) && !syncedV132.has(id) && keepLocalOnlyOrderV137(local)) merged.push(local);
      rememberServerIdsV137(remoteIds);
      const keptBacklog = (state.backlog || []).filter(entry => syncedBacklogV132.get(String(entry.id)) !== backlogKeyV132(entry));
      const keptBacklogIds = new Set(keptBacklog.map(entry => String(entry.id)));
      state.orders = merged;
      state.backlog = [...(remoteBacklog || []).filter(entry => !keptBacklogIds.has(String(entry.id))), ...keptBacklog];
      resetSnapshotV132(keep);
      for (const entry of keptBacklog) syncedBacklogV132.delete(String(entry.id));
      if (typeof global.save === 'function') global.save(false);
      if (typeof global.render === 'function') global.render();
    } finally { loadingV132 = false; }
    await refreshDeliveryCountsV132();
    if (hasChangesV132(collectChangesV132())) retrySyncLaterV132(1500);
    return state.orders;
  }
  global.reloadOrdersV132 = reloadOrdersV132;

  /* ===== V132 – SZÁLLÍTÓLEVÉL-SZÁM A FÁJLTÁBLÁBÓL ===================== */
  global.deliveryFileCountsV132 = global.deliveryFileCountsV132 || new Map();
  async function refreshDeliveryCountsV132() {
    if (!currentProfile || !global.V44Online) return false;
    try {
      /* V134: a sofőri felület is lekéri – a saját fuvarjaira. */
      const counts = isAdmin()
        ? await global.V44Online.fetchDeliveryFileCountsV132?.()
        : await global.V44Online.fetchDeliveryFileCountsForOrdersV134?.((state.orders || []).map(order => order.id),
          (state.orders || []).flatMap(order => order.sourceMailReportIdsV135 || []));
      if (!counts) return false;
      const before = JSON.stringify([...global.deliveryFileCountsV132].sort());
      const wasLoaded = !!global.deliveryFileCountsLoadedV134;
      global.deliveryFileCountsV132 = counts;
      global.deliveryFileCountsLoadedV134 = true;
      return !wasLoaded || before !== JSON.stringify([...counts].sort());
    } catch (error) { console.warn('[V132] szállítólevél-számok', error); return false; }
  }
  /* V134: feltöltés vagy törlés után a szám azonnal kövesse a változást,
     ne csak a következő frissítéskor. */
  function adjustDeliveryCountV134(orderId, delta) {
    const id = String(orderId || '');
    if (!id) return;
    const map = global.deliveryFileCountsV132 instanceof Map ? global.deliveryFileCountsV132 : new Map();
    map.set(id, Math.max(0, (+map.get(id) || 0) + delta));
    global.deliveryFileCountsV132 = map;
  }
  global.adjustDeliveryCountV134 = adjustDeliveryCountV134;


  /* ===== V132 – AZ ADMIN FELÜLET PERCENKÉNT ÁTVESZI A SOFŐRI JELZÉSEKET

     Az admin felület eddig semmit nem frissített magától, ezért a pipa és
     a szállítólevél csak kézi Frissítés után látszott. A tervezést (sorrend,
     kiosztás) továbbra sem írjuk felül: csak a sofőri mezők (teljesítés,
     átvételek, szállítólevelek, megjegyzés, üzenetek) olvadnak be, és a
     sofőr által létrehozott új fuvar jelenik meg. */
  async function adminPollV132() {
    if (!isAdmin() || refreshInProgress || loadingV132 || document.hidden) return;
    if ([...document.querySelectorAll('dialog')].some(dialog => dialog.open)) return;
    if (document.querySelector('.sortable-chosen, .sortable-ghost, .sortable-drag')) return;
    try {
      const from = typeof shiftWorkday === 'function' ? shiftWorkday(currentWorkday(), -5) : fallbackShiftWorkday(currentWorkday(), -5);
      const [remoteOrders, countsChanged] = await Promise.all([global.V44Online.fetchOrdersSinceV132(from), refreshDeliveryCountsV132()]);
      rememberServerIdsV137(remoteOrders.map(order => order.id));
      if (refreshInProgress || loadingV132) return;
      const localById = new Map((state.orders || []).map(order => [String(order.id), order]));
      const deletedLocally = new Set([...syncedV132.keys()].filter(id => !localById.has(id)));
      for (const id of deletedThisSessionV132) deletedLocally.add(id);
      let changed = countsChanged;
      loadingV132 = true;
      try {
        for (const remote of remoteOrders) {
          const id = String(remote.id);
          const local = localById.get(id);
          if (!local) {
            if (deletedLocally.has(id)) continue;
            state.orders.push(remote);
            syncedV132.set(id, orderKeyV132(remote));
            changed = true;
            continue;
          }
          const wasClean = !isDirtyV132(local);
          const before = orderKeyV132(local);
          const merged = global.V44Online.mergeAdminDriverFieldsV131(local, remote);
          Object.assign(local, merged);
          if (!merged.completedAtV111) delete local.completedAtV111;
          if (!merged.completedUndoneAtV132) delete local.completedUndoneAtV132;
          if (orderKeyV132(local) !== before) {
            changed = true;
            if (wasClean) syncedV132.set(id, orderKeyV132(local));
          }
        }
        if (changed) {
          rememberCompletionV132();
          const scroll = captureViewScroll();
          if (typeof global.saveLocalOnlyV129 === 'function') global.saveLocalOnlyV129();
          else if (typeof global.save === 'function') global.save(false);
          if (typeof global.render === 'function') global.render();
          restoreViewScroll(scroll);
        }
      } finally { loadingV132 = false; }
    } catch (error) { console.warn('[V132] admin háttérfrissítés', error); }
  }

  async function logout() {
    driverDateInitialised = false;   // a kovetkezo belepes ujra a mai napot nyitja
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
  /* V71 – MELLÉKLET MEGNYITÁSA MEGBÍZHATÓAN

     Eddig sima <a target="_blank"> volt. Ez két esetben nem nyílt meg:
       - ha az aláírt URL üresen jött vissza, a href="" a lapot töltötte újra
       - a kezdőképernyőről indított (telepített) alkalmazásban a böngésző
         gyakran blokkolja az új lapot, és nem történik semmi

     Ezért gombot használunk: ha van URL, előbb új lapon próbáljuk, és ha azt
     a rendszer blokkolja, ugyanabban az ablakban nyitjuk meg. Ha nincs URL,
     megmondjuk, miért, ahelyett hogy csendben nem történne semmi. */
  function attachmentLinkV71(file) {
    const name = safe(file.file_name || 'melléklet');
    if (!file.url) {
      return `<span class="mail-file mail-file-missing" title="A fájl hivatkozása nem jött létre">
        <i class="ti ti-alert-triangle" aria-hidden="true"></i> ${name} — nem elérhető</span>`;
    }
    return `<button type="button" class="mail-file" data-url="${safe(file.url)}"
      onclick="openAttachmentV71(this.dataset.url)">
      <i class="ti ti-paperclip" aria-hidden="true"></i> ${name}</button>`;
  }

  /* V107: a hivatkozás nélkül maradt fájlok is LÁTSZANAK, a feltöltés
     dátumával – így kiderül, hogy a melléklet fent van, csak a megnyitása
     akadt el, és nem úgy tűnik, mintha nem is létezne. */
  /* A tároló a feltöltéskor sorszámot tesz a név elé, és az ékezetes betűket
     aláhúzásra cseréli (Megrendelés.pdf → 01-Megrendel_s.pdf). Ezért a
     kulcsot UGYANAZZAL a cserével képezzük mindkét oldalon – így a két
     változat egyezik, és a fájl nem jelenik meg kétszer. */
  function nevKulcsV109(nev) {
    return String(nev || '')
      .replace(/^\d{2}-/, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .toLowerCase();
  }

  function missingLinkListV107(files) {
    const hibas = (files || []).filter(file => !file.url);
    if (!hibas.length) return '';
    return `<div class="mail-files-title">Nem megnyitható (${hibas.length})</div>`
      + hibas.map(file => `<span class="mail-file mail-file-missing"
          title="A fájl fent van, de a megnyitó hivatkozás nem jött létre. Frissítsd az oldalt.">
          <i class="ti ti-alert-triangle" aria-hidden="true"></i> ${safe(file.file_name || 'melléklet')}
          ${file.created_at ? '· ' + safe(String(file.created_at).slice(0, 10)) : ''}</span>`).join('');
  }

  global.openAttachmentV71 = function (url) {
    if (!url) return alert('Ehhez a melléklethez nem jött létre megnyitható hivatkozás. Frissítsd az oldalt, és próbáld újra.');
    let win = null;
    try { win = global.open(url, '_blank', 'noopener'); } catch (error) { win = null; }
    // telepített alkalmazásban az új lap blokkolva lehet – ilyenkor helyben nyitjuk
    if (!win || win.closed || typeof win.closed === 'undefined') {
      try { global.location.href = url; }
      catch (error) { alert('A melléklet nem nyitható meg: ' + error.message); }
    }
  };

  /* V73 – A LEVÉL SZÖVEGE, NEM A FORRÁSA

     Tovabbitott (FW:) leveleknel a beolvaso neha a teljes levelforrast adja
     vissza: Received, Content-Type, boundary, X-Mailer es tarsai. Ezt nem
     tesszuk a felhasznalo ele - kivagjuk a fejlecblokkot, es csak az erdemi
     szoveget mutatjuk. Ha a vegen semmi nem marad, inkabb az eredetit
     mutatjuk, mint egy ures ablakot. */
  const MIME_HEADER_RE = /^(received|return-path|delivered-to|dkim-signature|authentication-results|arc-[a-z-]+|x-[a-z-]+|content-type|content-transfer-encoding|content-language|mime-version|message-id|in-reply-to|references|thread-[a-z-]+|boundary|date|from|to|cc|bcc|subject|id|by|for|with|envelope-from)\b\s*[:=]/i;

  function readableMailBodyV73(raw) {
    const text = String(raw || '');
    if (!text.trim()) return '';
    const kept = [];
    let skipping = false;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (MIME_HEADER_RE.test(trimmed)) { skipping = true; continue; }
      if (skipping && (/^\s/.test(line) || /^[=-]{2,}/.test(trimmed) || !trimmed)) continue;
      skipping = false;
      kept.push(line);
    }
    const cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return cleaned || text.trim();
  }
  global.readableMailBodyV73 = readableMailBodyV73;

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
        ${(() => { const note = [order.note, order.manualItems].map(v => String(v || '').trim()).find(v => v && !/^outlook import/i.test(v)); return note ? `<div class="v65-manual-note"><b>Megjegyzés:</b> ${safe(note)}</div>` : ''; })()}
        <pre class="mail-body">${safe(readableMailBodyV73(mail.body) || '(A levélnek nincs mentett szöveges tartalma.)')}</pre>
        ${(mail.attachmentNames || []).length ? `<div class="mail-meta"><b>Mellékletek:</b> ${safe(mail.attachmentNames.join(', '))}</div>` : ''}
        <div id="sourceMailFiles" class="mail-files"><small>Mellékletek betöltése…</small></div>`;
    }
    byId('sourceMailDialog')?.showModal();
    const files = byId('sourceMailFiles');
    if (!files) return;
    /* V73: előbb a HELYBEN eltett fájlok – ezek hálózat nélkül is megnyílnak.
       A szerverről érkezők utánuk jönnek, ha vannak. */
    const local = typeof global.loadOrderAttachmentsV73 === 'function'
      ? global.loadOrderAttachmentsV73(orderId) : [];
    const localHtml = local.length
      ? `<div class="mail-files-title">Melléklet (${local.length})</div>`
        + local.map(file => `<button type="button" class="mail-file" data-url="${safe(file.dataUrl)}"
            onclick="openAttachmentV71(this.dataset.url)"><i class="ti ti-paperclip" aria-hidden="true"></i> ${safe(file.name)}</button>`).join('')
      : '';
    if (localHtml) files.innerHTML = localHtml;
    try {
      const list = await listDeliveryFilesEventually(orderId);
      /* V72: KIZÁRÓLAG az Outlook-import levélmellékletei. Korábban volt egy
         tartalék ág, ami minden fájlt megmutatott, ha nem találtunk
         forrásmellékletet – így a sofőr saját szállítólevél-fotói kerültek
         ide. Azokat a Mentett fotók gomb mutatja, ez a kettő nem keveredhet. */
      const all = (list || []).filter(file => /\.(pdf|docx?|xlsx?|xlsm|csv|msg|eml|txt)$/i.test(file.file_name || ''));

      /* V106 – A CSATOLMÁNY TÖBB JELRE TÁMASZKODIK

         A forrásmelléklet felismerése eddig EGYETLEN dolgon múlt: a jelentés
         megjegyzésében szerepel-e az "Outlook forrás". Azt viszont külön
         lekérdezés hozza, és ha az hibázott, MINDEN fájl kiesett – a
         Csatolmány üresen maradt, pedig a PDF fent volt.

         Mostantól három jel bármelyike elég:
           - a megjegyzés "Outlook forrás" (ez a biztos jel),
           - a fájl neve szerepel a levél mellékletei között,
           - a megjegyzés ISMERETLEN (a lekérdezés hibázott), és a fájl nem
             a sofőr fényképe.

         A sofőr fotói így sem keverednek ide: azok neve szallitolevel-… */
      const mellekletNevek = new Set([
        ...(mail.attachmentNames || []),
        mail.fileName || ''
      ].map(nev => String(nev || '').trim().toLowerCase()).filter(Boolean));
      const soforFotoja = file => /^szallitolevel-/i.test(String(file.file_name || ''))
        || /^(foto|photo|img)[-_]/i.test(String(file.file_name || ''));
      /* V135: a fuvar maga is tudja, melyik bejegyzés a levél melléklete. */
      const ismertForras = new Set((order.sourceMailReportIdsV135 || []).map(String));
      const sources = all.filter(file => {
        if (file.is_source_mail === true) return true;
        if (ismertForras.has(String(file.report_id || ''))) return true;
        const nev = String(file.file_name || '').trim().toLowerCase();
        if (nev && mellekletNevek.has(nev)) return true;
        return file.is_source_mail == null && !soforFotoja(file);
      });
      /* V108: ELŐSZÖR a levélből mentett eredeti mellékletek. Ezek mindig
         megnyithatók, kapcsolat nélkül is – a szerveri másolat csak
         kiegészítés. */
      let levelHtml = '';
      const levelNevek = new Set();
      try {
        const sajat = await (global.mailAttachmentsV108?.(orderId) || []);
        for (const rekord of sajat) levelNevek.add(nevKulcsV109(rekord.name));
        if (sajat.length) {
          levelHtml = `<div class="mail-files-title">Melléklet (${sajat.length})</div>`
            + sajat.map(rekord => {
                const url = global.attachmentUrlV108?.(rekord) || '';
                if (!url) return '';
                return `<button type="button" class="mail-file" data-url="${safe(url)}"
                  onclick="openAttachmentV71(this.dataset.url)">
                  <i class="ti ti-paperclip" aria-hidden="true"></i> ${safe(rekord.name)}</button>`;
              }).join('');
        }
      } catch (error) { console.warn('[V108] a levélből mentett mellékletek', error); }

      /* V109 – UGYANAZ A FÁJL NE SZEREPELJEN KÉTSZER

         Ugyanaz a melléklet két helyről is előkerül: a levélből mentett
         eredetiből és a szerverre feltöltött másolatból. Eddig mindkettő
         megjelent, ezért a PDF kétszer látszott.

         A levélből mentett változat az elsődleges – az kapcsolat nélkül is
         megnyílik –, ezért a szerveri listából kivesszük azt, ami név
         szerint már ott van. A tárolóban a név elé sorszám kerül
         (01-megrendeles.pdf), ezt a kulcsképzés leválasztja. */
      const megnyithato = sources.filter(file =>
        file.url && !levelNevek.has(nevKulcsV109(file.file_name)));
      /* V109 – HA A LEVÉLBŐL MEGVAN, CSAK AZ KELL

         A levélből mentett eredeti melléklet mindig megnyílik: a fájl bájtjai
         a fuvarnál vannak, kapcsolat sem kell hozzá. A szerveri másolat
         viszont aláírt hivatkozást igényel, ami néha nem jön létre – olyankor
         a sor ott állt, de nem nyílt meg.

         Ezért ha a levélből van melléklet, CSAK azt mutatjuk. A szerveri lista
         akkor jön elő, ha a levélből semmi nincs. */
      /* V135: az admin látja, hogy a melléklet elérhető-e a sofőr számára –
         a saját gépén tárolt eredeti ezt eddig elfedte. */
      if (isAdmin()) {
        const szerveren = sources.length;
        const vanHelyi = !!levelHtml || !!localHtml;
        const kimaradtV136 = order.sourceUploadPartialV136?.skipped || [];
        const allapot = szerveren && kimaradtV136.length
          ? `<div class="v135-source-status missing" id="v135SourceStatus">⚠ A sofőr ${szerveren} fájlt lát, de ezeket a tároló nem fogadta el: ${safe(kimaradtV136.join(', '))}<small>Futtasd le a SUPABASE_TAROLO_V136.sql fájlt, majd töltsd fel újra.</small><button type="button" class="v135-upload" onclick="uploadLocalSourceForOrderV135('${safe(order.id)}')">Kimaradtak feltöltése</button></div>`
          : szerveren
          ? `<div class="v135-source-status ok" id="v135SourceStatus">✓ A sofőr is látja: ${szerveren} fájl a szerveren.</div>`
          : vanHelyi
            ? `<div class="v135-source-status missing" id="v135SourceStatus">⚠ A sofőr NEM látja ezt a mellékletet: nincs feltöltve a szerverre.${order.sourceUploadFailedV135?.error ? ` <small>Utolsó hiba: ${safe(order.sourceUploadFailedV135.error)}</small>` : ''}<button type="button" class="v135-upload" onclick="uploadLocalSourceForOrderV135('${safe(order.id)}')">Feltöltés a sofőrnek</button></div>`
            : '';
        if (levelHtml) levelHtml += allapot;
        global.__v135StatusHtml = allapot;
      }
      files.innerHTML = (levelHtml ? levelHtml
        : localHtml + missingLinkListV107(sources.filter(file => !levelNevek.has(nevKulcsV109(file.file_name)))) + (megnyithato.length
        ? `<div class="mail-files-title">Szerverről (${megnyithato.length})</div>`
          + megnyithato.map(attachmentLinkV71).join('')
        : (localHtml ? '' : `<small>${mail.attachmentsUnreadable
            ? 'A levél mellékletét nem sikerült kibontani az importkor – ez továbbított (FW:) leveleknél fordul elő. Mentsd el az EREDETI levelet .msg fájlként, és azt húzd be az importba.'
            : (mail.attachmentNames || []).length
              ? (isAdmin() ? 'A levélnek volt melléklete, de a fájlok nincsenek feltöltve, és ezen a gépen sincs meg az eredeti. Húzd be újra az eredeti .msg fájlt az importba.' : 'A levélnek volt melléklete, de még nincs feltöltve a sofőröknek. Szólj az adminnak: a Beállítások lapon egy gombbal pótolja.')
              : 'Ehhez a levélhez nem tartozott melléklet.'}</small>`)))
        + (isAdmin() && !levelHtml ? (global.__v135StatusHtml || '') : '');
    } catch (error) {
      files.innerHTML = `<small>A mellékletek nem tölthetők be: ${safe(error.message)}</small>`;
    }
  }
  async function renderOrderPdfAttachments(orderIds, targetId) {
    const host = byId(targetId); if (!host) return;
    const ids = [...new Set((orderIds || []).flatMap(id => String(id || '').split(',')).map(id => id.trim()).filter(Boolean))];
    try {
      /* V109 – A TÉTELEK ALATTI GOMB IS A LEVÉLBŐL DOLGOZIK

         Ez a gomb eddig CSAK a szerveri másolatból listázott, a levélből
         mentett eredeti mellékletet nem is nézte – ezért nem nyitott meg
         semmit. Most ugyanúgy a levélből mentett fájlok az elsődlegesek,
         mint a Csatolmány gombnál, és a szerveri lista csak akkor jön elő,
         ha a levélből semmi nincs. */
      let levelHtml = '';
      for (const id of ids) {
        const sajat = await (global.mailAttachmentsV108?.(id) || []);
        for (const rekord of sajat) {
          const url = global.attachmentUrlV108?.(rekord) || '';
          if (!url) continue;
          levelHtml += `<button type="button" class="mail-file" data-url="${safe(url)}"
            onclick="openAttachmentV71(this.dataset.url)">
            <i class="ti ti-paperclip" aria-hidden="true"></i> ${safe(rekord.name)}</button>`;
        }
      }
      if (levelHtml) {
        host.innerHTML = `<div class="item-attachments-title">Mellékletek</div>${levelHtml}`;
        return;
      }
      const lists = await Promise.all(ids.map(id => global.V44Online?.listDeliveryFiles ? listDeliveryFilesEventually(id) : Promise.resolve([])));
      const files = lists.flat().filter(file => /\.(pdf|docx?|xlsx?|xlsm|csv|msg|eml|txt)$/i.test(file.file_name || '') && file.url);
      host.innerHTML = files.length
        ? `<div class="item-attachments-title">Mellékletek (${files.length})</div>${files.map(attachmentLinkV71).join('')}`
        : '<small>Nincs elérhető melléklet ehhez a fuvarhoz.</small>';
    } catch (error) { host.innerHTML = `<small>A mellékletek nem tölthetők be: ${safe(error.message)}</small>`; }
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

  /* ===== V111 – FUVAR TELJESÍTÉSE ÉS SOFŐRI MEGJEGYZÉS ===============

     Van olyan fuvar, amin nincs tétel – csak egy megjegyzés, hogy mit kell
     elvégezni. Ott eddig nem volt mit kipipálni, így a sofőr nem tudta
     lezárni. Ezért a buborék EGÉSZÉRE is kell egy teljesítés-gomb.

     A megjegyzés pedig arra való, hogy a sofőr visszajelezzen: "felvettem,
     de már nem tudtam az építkezésen lerakni". Ez a főoldalon pirossal
     kiemelve jelenik meg, hogy az admin azonnal lássa. */
  async function toggleOrderDoneV111(orderId) {
    const order = (state.orders || []).find(item => String(item.id) === String(orderId));
    if (!order) return;
    if (!canEditOrder(order.id)) return alert('Csak az aktuális munkanap szerkeszthető.');

    if (!order.completed) {
      const tetelek = (order.items || []).length;
      if (tetelek && !confirm(`${tetelek} tétel tartozik ehhez a fuvarhoz. Mindet átvettnek jelöljük, és a fuvart teljesítettnek?`)) return;
      for (const item of order.items || []) if (!item.received) item.received = true;
      order.completed = true;
      order.completedAtV111 = new Date().toISOString();
      order.completedAt = order.completedAtV111;
    } else {
      if (!confirm('Visszavonjuk a teljesítést?')) return;
      order.completed = false;
      order.completedAt = '';
      delete order.completedAtV111;
      order.completedUndoneAtV132 = new Date().toISOString();
    }
    /* V114: a módosítás idejét közvetlenül jelöljük. Korábban egy nem létező
       függvényt hívtunk (stampOrderChange), ezért a gomb HIBÁRA FUTOTT, és a
       változás sem mentődött el – az adminnál semmi nem látszott. */
    order.localUpdatedAt = new Date().toISOString();
    save();
    try {
      /* V132: közvetlen mentés „úton” jelöléssel – a késleltetett mentés és
         az automatikus frissítés nem írhatja felül közben. */
      if (global.V44Online?.configured?.()) await directOrderWriteV132(order);
    } catch (error) {
      alert(`A teljesítés helyben megmaradt, és automatikusan újrapróbáljuk, de az online mentés most nem sikerült: ${error.message}`);
    }
  }

  function openDriverNoteV111(orderId) {
    const order = (state.orders || []).find(item => String(item.id) === String(orderId));
    if (!order) return;
    if (!canEditOrder(order.id)) return alert('Csak az aktuális munkanap szerkeszthető.');
    const eddigi = String(order.driverNoteV111 || '');
    const uj = prompt('Megjegyzés a fuvarhoz – az admin a főoldalon látja:', eddigi);
    if (uj === null) return;
    const szoveg = String(uj).trim();
    if (szoveg) {
      order.driverNoteV111 = szoveg;
      order.driverNoteAtV111 = new Date().toISOString();
      order.driverNoteByV111 = activeProfile()?.driver_key || activeProfile()?.role || 'sofőr';
    } else {
      delete order.driverNoteV111; delete order.driverNoteAtV111; delete order.driverNoteByV111;
    }
    /* V114: a módosítás idejét közvetlenül jelöljük. Korábban egy nem létező
       függvényt hívtunk (stampOrderChange), ezért a gomb HIBÁRA FUTOTT, és a
       változás sem mentődött el – az adminnál semmi nem látszott. */
    order.localUpdatedAt = new Date().toISOString();
    save();
  }

  global.toggleOrderDoneV111 = toggleOrderDoneV111;
  global.openDriverNoteV111 = openDriverNoteV111;


  /* V119 – egy kép törlése a galériából ÉS a tárhelyről. */
  async function deleteGalleryFileV119(fileId) {
    const file = (global.__galleryFilesV119 || []).find(item => String(item.id) === String(fileId));
    if (!file) return;
    /* V134: a sofőr is törölhet – de csak a saját fuvarján, az aktív
       munkanapon, és archivált szállítólevelet nem. */
    if (!canDeleteGalleryFileV134(file)) return alert(isAdmin() ? 'Ez a fájl nem törölhető.' : 'Törölni csak az aktuális munkanapon, a saját fuvarodon lehet.');
    if (!confirm(`Véglegesen törlöd ezt a képet?\n\n${file.file_name || ''}\n\nA fájl a tárhelyről is törlődik, visszaállítani nem lehet.`)) return;
    try {
      await global.V44Online.deleteDeliveryFile(file);
      global.__galleryFilesV119 = (global.__galleryFilesV119 || []).filter(item => String(item.id) !== String(fileId));
      if (!file.is_source_mail) adjustDeliveryCountV134(file.order_id, -1);
      /* V133: a jelölés a törléshez igazodik. Archivált fájl törlésekor a
         jelölés megmarad „archiválva” felirattal; soha nem archivált fájl
         törlésekor a szállítólevél-bejegyzés fogy, és ha az utolsó fájlja is
         elment, a jelölés eltűnik – a buborék gombja visszaszürkül. */
      updateReportAfterDeleteV133(file, global.__galleryFilesV119 || []);
      await openMediaGallery(String(file.order_id || ''));
    } catch (error) {
      alert(`A törlés nem sikerült: ${error.message}`);
    }
  }
  global.deleteGalleryFileV119 = deleteGalleryFileV119;

  function canDeleteGalleryFileV134(file) {
    if (!file?.id || !file?.storage_path) return false;
    if (isAdmin()) return true;
    const orderId = String(file.order_id || '');
    if (!orderId || !canEditOrder(orderId)) return false;
    const order = (state.orders || []).find(item => String(item.id) === orderId);
    const report = (order?.deliveryReports || []).find(item => String(item?.id || '') === String(file.report_id || ''));
    return !report?.archivedAtV133;
  }
  global.canDeleteGalleryFileV134 = canDeleteGalleryFileV134;

  function wasArchivedV133(fileId) {
    try { return typeof global.archivedMapV119 === 'function' && !!global.archivedMapV119()[String(fileId)]; }
    catch (_) { return false; }
  }

  function updateReportAfterDeleteV133(file, remainingFiles) {
    const order = (state.orders || []).find(item => String(item.id) === String(file.order_id || ''));
    if (!order) return false;
    const reportId = String(file.report_id || '');
    const reports = order.deliveryReports || [];
    const report = reports.find(item => String(item?.id || '') === reportId);
    const now = new Date().toISOString();
    if (wasArchivedV133(file.id)) {
      if (report) report.archivedAtV133 = report.archivedAtV133 || now;
      else order.deliveryReports = [...reports, { id: reportId, at: file.created_at || now, fileCount: 1, photoCount: /^audio\//.test(file.mime_type || '') ? 0 : 1, archivedAtV133: now }];
    } else if (report) {
      const left = (remainingFiles || []).filter(item => String(item.report_id || '') === reportId && String(item.id) !== String(file.id));
      if (!left.length) {
        order.deliveryReports = reports.filter(item => item !== report);
        order.deliveryReportsDeletedV133 = [...new Set([...(order.deliveryReportsDeletedV133 || []), reportId])];
      } else {
        report.fileCount = left.length;
        report.photoCount = left.filter(item => !/^audio\//.test(item.mime_type || '')).length;
      }
    } else return false;
    order.localUpdatedAt = now;
    if (typeof save === 'function') save();
    return true;
  }
  global.updateReportAfterDeleteV133 = updateReportAfterDeleteV133;

  /* V133 – ARCHIVÁLT FÁJLOK TÖMEGES TÖRLÉSE UTÁN

     A „Archiváltak törlése” után a fuvar jelölése megmarad, de „archiválva”
     felirattal. Ha egy fuvarról a jelölés korábban elveszett, a fájlokból
     pótoljuk – az Outlook-forrásmellékletekből nem. */
  async function markArchivedReportsV133(files) {
    const list = (files || []).filter(file => file?.order_id && file?.report_id);
    if (!list.length) return 0;
    const now = new Date().toISOString();
    const byOrder = new Map();
    for (const file of list) {
      const key = String(file.order_id);
      if (!byOrder.has(key)) byOrder.set(key, []);
      byOrder.get(key).push(file);
    }
    const missing = [];
    for (const [orderId, orderFiles] of byOrder) {
      const order = (state.orders || []).find(item => String(item.id) === orderId);
      if (!order) continue;
      for (const file of orderFiles) if (!(order.deliveryReports || []).some(report => String(report?.id || '') === String(file.report_id))) missing.push(String(file.report_id));
    }
    let notes = new Map();
    if (missing.length && global.V44Online?.fetchReportNotesV133) {
      try { notes = await global.V44Online.fetchReportNotesV133(missing); }
      catch (error) { console.warn('[V133] a jelentések megjegyzése nem tölthető be', error); }
    }
    let changed = 0;
    for (const [orderId, orderFiles] of byOrder) {
      const order = (state.orders || []).find(item => String(item.id) === orderId);
      if (!order) continue;
      const byReport = new Map();
      for (const file of orderFiles) {
        const key = String(file.report_id);
        if (!byReport.has(key)) byReport.set(key, []);
        byReport.get(key).push(file);
      }
      for (const [reportId, reportFiles] of byReport) {
        const reports = order.deliveryReports || [];
        const report = reports.find(item => String(item?.id || '') === reportId);
        if (report) {
          if (/^outlook\s*forr/i.test(String(report.note || ''))) continue;
          if (!report.archivedAtV133) { report.archivedAtV133 = now; changed++; }
          continue;
        }
        const note = notes.get(reportId);
        if (!note || /outlook\s*forr/i.test(String(note.note || ''))) continue;
        order.deliveryReports = [...reports, {
          id: reportId, at: note.created_at || reportFiles[0].created_at || now, note: note.note || '',
          fileCount: reportFiles.length,
          photoCount: reportFiles.filter(file => !/^audio\//.test(file.mime_type || '')).length,
          archivedAtV133: now
        }];
        changed++;
      }
      order.localUpdatedAt = now;
    }
    if (changed && typeof save === 'function') save();
    return changed;
  }
  global.markArchivedReportsV133 = markArchivedReportsV133;


  /* ===== V121 – A FUVARÁTADÁSOK SAJÁT MENÜPONTOT KAPTAK ==============

     Eddig a Beállítások lap alján voltak, az online szinkron mellett. Ott
     nehéz volt észrevenni, pedig sofőrök közti művelet – a Sofőr menü alatt
     a helye. */
  async function renderTransfersPageV121() {
    const host = byId('transfersContent');
    if (!host || !isAdmin()) return;
    host.innerHTML = '<div class="notice">Betöltés…</div>';
    try {
      const transfers = await global.V44Online.listTransfers();
      transferCache = transfers;
      host.innerHTML = `<div class="panel"><div class="transfer-admin-list">${transfers.length
        ? transfers.map(transfer => `<article class="transfer-admin-row status-${safe(transfer.status)}">
            <div><b>${safe(transfer.order_no || transfer.order_id)}</b>
              <small>${safe(DRIVER_LABELS[transfer.from_driver_key] || transfer.from_driver_key)} →
                ${safe(DRIVER_LABELS[transfer.to_driver_key] || transfer.to_driver_key)}</small></div>
            <div class="transfer-admin-meta"><span>${safe(transfer.status)}</span>
              <small>${safe(String(transfer.created_at || '').slice(0, 16).replace('T', ' '))}</small></div>
          </article>`).join('')
        : '<div class="notice">Nincs fuvarátadási kérés.</div>'}</div></div>`;
    } catch (error) {
      host.innerHTML = `<div class="notice">A fuvarátadások nem tölthetők be: ${safe(error.message)}</div>`;
    }
  }
  global.renderTransfersPageV121 = renderTransfersPageV121;

  global.openSourceMail = openSourceMail;

  /* ===== V134 – A JELÖLÉS A TÉNYLEGES FÁJLOKHOZ IGAZODIK ==============

     Ha a galéria megnyitásakor kiderül, hogy egy szállítólevél-jelöléshez
     nincs fájl (pl. félbeszakadt feltöltés, máshonnan törölt fájl), és
     archiválva sem volt, a jelölés törlődik – a gomb alapállapotba kerül,
     és a régi szám nem jön vissza. Csak szerkeszthető fuvaron fut (a sofőr
     a régi napokat nem módosíthatja). */
  function healDeliveryMarksV134(orders, allFiles) {
    const reportIds = new Set((allFiles || []).map(file => String(file.report_id || '')).filter(Boolean));
    let changed = false, countsChanged = false;
    for (const order of orders || []) {
      const own = (allFiles || []).filter(file => String(file.order_id || '') === String(order.id));
      adjustDeliveryCountV134(order.id, 0);
      const knownSource = new Set((order.sourceMailReportIdsV135 || []).map(String));
      const fresh = own.filter(file => !file.is_source_mail && !knownSource.has(String(file.report_id || ''))).length;
      if (global.deliveryFileCountsV132.get(String(order.id)) !== fresh) countsChanged = true;
      global.deliveryFileCountsV132.set(String(order.id), fresh);
      if (!canEditOrder(order.id)) continue;
      const reports = order.deliveryReports || [];
      const stale = reports.filter(report => report && !report.archivedAtV133
        && !/^outlook\s*forr/i.test(String(report.note || ''))
        && (report.id ? !reportIds.has(String(report.id)) : !own.length));
      if (!stale.length) continue;
      const keys = stale.map(report => String(report.id || report.at || ''));
      order.deliveryReports = reports.filter(report => !stale.includes(report));
      order.deliveryReportsDeletedV133 = [...new Set([...(order.deliveryReportsDeletedV133 || []), ...keys.filter(Boolean)])];
      order.localUpdatedAt = new Date().toISOString();
      changed = true;
    }
    if (changed && typeof save === 'function') save();
    else if (countsChanged && isAdmin() && typeof global.render === 'function') global.render();
    else if (countsChanged && !isAdmin()) renderDriverPortal();
    return changed;
  }
  global.healDeliveryMarksV134 = healDeliveryMarksV134;

  /* ===== V133 – ARCHIVÁLT SZÁLLÍTÓLEVELEK ============================ */
  function archivedReportsV133(orders) {
    return (orders || []).flatMap(order => (order?.deliveryReports || []).filter(report => report?.archivedAtV133));
  }
  function formatDayV133(value) {
    const nap = String(value || '').slice(0, 10);
    return nap ? nap.replace(/-/g, '. ') + '.' : '';
  }
  function archivedReportsNoteV133(orders) {
    const reports = archivedReportsV133(orders);
    if (!reports.length) return '';
    const count = reports.reduce((sum, report) => sum + (+report.photoCount || +report.fileCount || 1), 0);
    const latest = reports.map(report => String(report.archivedAtV133)).sort().pop();
    return `<div class="v133-archived-note"><b>Archiválva</b> · ${count} fájl${latest ? ` · ${safe(formatDayV133(latest))}` : ''}<small>A fájlok a ZIP-archívumban vannak, a tárhelyről törölve.</small></div>`;
  }
  global.archivedReportsV133 = archivedReportsV133;

  /* ===== V138 – A MENTETT FOTÓK ABLAK TARTALMA ======================= */
  function galleryDeleteButtonV138(file) {
    return canDeleteGalleryFileV134(file)
      ? `<button type="button" class="v119-del" title="Törlés a tárhelyről is" onclick="deleteGalleryFileV119('${safe(file.id)}')">🗑</button>`
      : '';
  }
  function galleryNotesV138(orders, audioFiles) {
    /* A megjegyzés forrása a fuvar saját jelölése (ezt a sofőr is mindig
       látja), tartalékként a szerveri bejegyzés megjegyzése. */
    const bejegyzesek = new Map();
    for (const order of orders || []) {
      const torolt = new Set((order.deliveryReportsDeletedV133 || []).map(String));
      for (const report of order.deliveryReports || []) {
        const kulcs = String(report?.id || report?.at || '');
        if (!kulcs || torolt.has(kulcs)) continue;
        const note = String(report.note || '').trim();
        if (/^outlook\s*forr/i.test(note)) continue;
        bejegyzesek.set(kulcs, { kulcs, note, at: report.at || '', orderNo: order.orderNo || '', fuvarNap: order.scheduleDate || '', audio: [] });
      }
    }
    for (const file of audioFiles || []) {
      const kulcs = String(file.report_id || file.id);
      const meglevo = bejegyzesek.get(kulcs) || { kulcs, note: '', at: file.created_at || '', orderNo: file.orderNo || '', fuvarNap: file.fuvarNap || '', audio: [] };
      if (!meglevo.note && file.report_note && !/^outlook\s*forr/i.test(file.report_note)) meglevo.note = String(file.report_note).trim();
      meglevo.audio.push(file);
      bejegyzesek.set(kulcs, meglevo);
    }
    return [...bejegyzesek.values()].filter(item => item.note || item.audio.length)
      .sort((a, b) => String(b.at || b.fuvarNap).localeCompare(String(a.at || a.fuvarNap)));
  }
  function renderGalleryV138(orders, imageFiles, audioFiles, napja) {
    const nap = value => { const t = String(value || '').slice(0, 10); return t ? t.replace(/-/g, '. ') + '.' : ''; };
    const kepek = imageFiles.map(file => /^image\//i.test(file.mime_type || '') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.file_name || '')
      ? `<article><a href="${safe(file.url)}" target="_blank" rel="noopener"><img src="${safe(file.url)}" alt="Szállítólevél"></a><small><b>${safe(napja(file))}</b> · ${safe(file.orderNo)} · ${safe(file.file_name || 'Fotó')}${galleryDeleteButtonV138(file)}</small></article>`
      : `<article class="v138-file"><a href="${safe(file.url)}" target="_blank" rel="noopener">📎 ${safe(file.file_name || 'Fájl')}</a><small><b>${safe(napja(file))}</b> · ${safe(file.orderNo)}${galleryDeleteButtonV138(file)}</small></article>`).join('');
    const jegyzetek = galleryNotesV138(orders, audioFiles).map(item => `
      <article class="v138-note">
        <header><b>${safe(nap(item.at || item.fuvarNap))}</b> · ${safe(item.orderNo)}</header>
        ${item.note ? `<p class="v138-note-text">${safe(item.note)}</p>` : ''}
        ${item.audio.map(file => `<div class="v138-audio"><audio controls preload="none" src="${safe(file.url)}"></audio>${galleryDeleteButtonV138(file)}</div>`).join('')}
      </article>`).join('');
    if (!kepek && !jegyzetek) return '';
    return `${kepek ? `<h4 class="v138-gallery-title">Fotók és csatolmányok</h4><div class="v138-gallery-grid">${kepek}</div>` : ''}`
      + `${jegyzetek ? `<h4 class="v138-gallery-title">Megjegyzések és hangjegyzetek</h4><div class="v138-notes">${jegyzetek}</div>` : ''}`;
  }
  global.renderGalleryV138 = renderGalleryV138;

  async function openMediaGallery(orderIds) {
    const ids = String(orderIds || '').split(',').map(id => id.trim()).filter(Boolean);
    if (!ids.length || ids.some(id => !canAccessOrder(id))) return alert('Ehhez a fuvarhoz nincs jogosultságod.');
    ids.forEach(id => global.markUserCommentRead?.(id));
    let orders = ids.map(id => (state.orders || []).find(item => String(item.id) === id)).filter(Boolean);

    /* V104 – A SZÁLLÍTÓLEVELEK A RENDELÉSSZÁMHOZ TARTOZNAK

       Ha a sofőr egy hátralékos tételt fényképez le, a fotó az AZNAPI
       fuvarhoz kerül. Az admin viszont a rendelésre keres rá, és ott minden
       hozzá tartozó szállítólevelet látni akar – akár hetek alatt, több
       fuvaron gyűltek össze.

       Ezért valódi rendelésszámnál hozzávesszük az összes azonos számú
       fuvart. A 000000 gyűjtőkód és a kötőjel NEM azonosít: minden ilyen
       fuvar önálló, mindig más rendelés, ezért azoknál maradunk a fuvarnál. */
    const gyujtokod = no => {
      const t = String(no || '').trim();
      return !t || t === '-' || /^0+$/.test(t.replace(/\D/g, '')) && /^[0\s-]+$/.test(t);
    };
    const valodiSzamok = [...new Set(orders.map(order => String(order.orderNo || '').trim())
      .filter(no => no && !gyujtokod(no)))];
    if (valodiSzamok.length) {
      const bovitett = new Map(orders.map(order => [String(order.id), order]));
      for (const order of state.orders || []) {
        const no = String(order.orderNo || '').trim();
        if (no && valodiSzamok.includes(no)) bovitett.set(String(order.id), order);
      }
      orders = [...bovitett.values()].sort((a, b) =>
        String(a.scheduleDate || '').localeCompare(String(b.scheduleDate || '')));
    }
    const orderNos = [...new Set(orders.map(order => order.orderNo).filter(Boolean))];
    const host = byId('mediaGalleryBody');
    if (byId('mediaGalleryTitle')) byId('mediaGalleryTitle').textContent = `${orderNos.join(', ') || 'Fuvar'} · mentett fotók`;
    if (host) host.innerHTML = '<div class="mobile-empty">Fotók betöltése…</div>';
    byId('mediaGalleryDialog')?.showModal();
    try {
      /* V104: a KIBŐVÍTETT listából töltünk, hogy a rendelésszámhoz tartozó
         összes szállítólevél meglegyen, és mindegyik tudja, melyik napról
         való. */
      const groups = await Promise.all(orders.map(async order => {
        const files = await global.V44Online.listDeliveryFiles(String(order.id));
        return (files || []).map(file => ({
          ...file, orderNo: order?.orderNo || '', fuvarNap: order?.scheduleDate || ''
        }));
      }));
      /* V70: a Mentett fotók CSAK a sofőr által készített szállítóleveleket
         mutatja. Az Outlook-importból feltöltött forrásmellékletek a
         Csatolmány gomb mögé tartoznak, nem ide. */
      /* V104: időrendben, a LEGFRISSEBB elöl – utólagos kereséskor a
         legutóbbi szállítólevél az érdekes. A dátum a kép alatt látszik. */
      const knownSourceV135 = new Set(orders.flatMap(order => order.sourceMailReportIdsV135 || []).map(String));
      const files = groups.flat().filter(file => !file.is_source_mail && !knownSourceV135.has(String(file.report_id || '')))
        .sort((a, b) => String(b.created_at || b.fuvarNap || '').localeCompare(String(a.created_at || a.fuvarNap || '')));
      const napja = file => {
        const forras = String(file.created_at || file.fuvarNap || '').slice(0, 10);
        return forras ? forras.replace(/-/g, '. ') + '.' : '';
      };
      /* V119: minden kép mellé kuka. A törlés a TÁROLÓBÓL is levesz, nem
         csak a listából – archiválás után ne foglaljon helyet. Csak admin
         törölhet. */
      global.__galleryFilesV119 = files;
      /* V134: a galéria a pontos állapotot látja – a fájlszám ehhez igazodik,
         és a fájl nélküli, nem archivált maradványjelölés törlődik. */
      healDeliveryMarksV134(orders, groups.flat());
      /* V133: az archiválás után törölt szállítólevelek nem tűnnek el
         nyomtalanul – a galéria jelzi, hogy archiválva vannak. */
      const archivedNoteV133 = archivedReportsNoteV133(orders);
      /* V138 – MEGJEGYZÉSEK ÉS HANGJEGYZETEK KÜLÖN RÉSZBEN

         Eddig a hangjegyzet a fotók közé keveredett, a szöveges megjegyzés
         pedig sehol nem látszott. Most a galéria két részből áll: felül a
         fotók és csatolmányok, alatta – szállítólevelenként csoportosítva –
         a sofőr szöveges megjegyzése és hangjegyzete. */
      const hangE = file => String(file.mime_type || '').startsWith('audio/') || /\.(webm|m4a|mp3|ogg|wav)$/i.test(file.file_name || '');
      const kepek = files.filter(file => !hangE(file));
      const tartalomV138 = renderGalleryV138(orders, kepek, files.filter(hangE), napja);
      if (host) host.innerHTML = (tartalomV138 || (archivedNoteV133 ? '' : '<div class="mobile-empty">Ehhez a fuvarhoz még nincs elmentett fotó.</div>')) + archivedNoteV133;
    } catch (error) { if (host) host.innerHTML = `<div class="mobile-empty">Betöltési hiba: ${safe(error.message)}</div>`; }
  }
  global.openMediaGallery = openMediaGallery;

  /* ===== V132 – CÉLZOTT, ÜTKÖZÉSMENTES ONLINE MENTÉS ==================

     Korábban a 900 ms-os késleltetett mentés a lefutás pillanatában
     kiolvasta a TELJES state.orders-t és felküldte. Ha közben egy
     automatikus frissítés visszatöltötte a szerver régi állapotát, a
     mentés ezt a régi állapotot írta vissza – a sofőr pipája és a
     szállítólevél jelölése végleg elveszett.

     Most:
       - csak a ténylegesen módosított (piszkos) fuvarok mennek fel;
       - a közvetlen mentés alatt álló fuvart a késleltetett mentés kihagyja;
       - frissítés közben a mentés nem fut le, hanem utána újraütemeződik;
       - adminnál csak a TÉNYLEGESEN törölt fuvar törlődik a szerverről. */
  let syncRunningV132 = null;

  function scheduleSync(delay = 900) {
    if (suppressOnlineSave || !currentProfile || !global.V44Online?.configured()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; runSyncV132(); }, delay);
  }

  /* Újraütemezés a suppressOnlineSave jelzőtől függetlenül: a frissítés
     alatt elhalasztott mentés a frissítés után is lefusson. */
  function retrySyncLaterV132(delay = 1500) {
    if (!currentProfile || !global.V44Online?.configured()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; runSyncV132(); }, delay);
  }

  async function runSyncV132() {
    if (!currentProfile || !global.V44Online?.configured()) return;
    if (loadingV132 || refreshInProgress || syncRunningV132 || suppressOnlineSave) { retrySyncLaterV132(1500); return; }
    const changes = collectChangesV132();
    if (!hasChangesV132(changes)) return;
    const sentKeys = new Map(changes.orders.map(order => [String(order.id), orderKeyV132(order)]));
    const sentBacklog = new Map(changes.backlogChanged.map(entry => [String(entry.id), backlogKeyV132(entry)]));
    const isDriver = currentProfile.role !== 'admin';
    const backlogTouched = changes.backlogChanged.length || changes.backlogDeletedIds.length;
    syncRunningV132 = (async () => {
      try {
        /* V139: a sofőri hátralék-mentés a szerveren TÖRÖLNI fog minden
           bejegyzést, ami a küldött listában nincs benne. Ha közben az admin
           létrehozott egyet (pl. dátum nélküli hátralékot), a telefon régi
           listája törölné. Ezért küldés előtt beolvassuk a szerver friss
           hátralékait: ami ott új, és a telefon NEM maga törölte, megmarad. */
        if (isDriver && backlogTouched) {
          try {
            const remoteBacklog = await global.V44Online.fetchBacklog();
            const localIds = new Set((state.backlog || []).map(entry => String(entry.id)));
            const fresh = (remoteBacklog || []).filter(entry => !localIds.has(String(entry.id)) && !syncedBacklogV132.has(String(entry.id)));
            if (fresh.length) {
              state.backlog = [...(state.backlog || []), ...fresh];
              for (const entry of fresh) syncedBacklogV132.set(String(entry.id), backlogKeyV132(entry));
            }
            /* Fordítva is: amit az admin a szerveren már lezárt/törölt, és
               a telefon azóta nem módosított, azt ne küldjük vissza. */
            const remoteIds = new Set((remoteBacklog || []).map(entry => String(entry.id)));
            const before = (state.backlog || []).length;
            state.backlog = (state.backlog || []).filter(entry => {
              const id = String(entry.id);
              const clean = syncedBacklogV132.get(id) === backlogKeyV132(entry);
              if (!remoteIds.has(id) && clean) { syncedBacklogV132.delete(id); return false; }
              return true;
            });
            if (fresh.length || state.backlog.length !== before) {
              loadingV132 = true;
              try { if (typeof global.save === 'function') global.save(false); } finally { loadingV132 = false; }
            }
          } catch (error) { console.warn('[V139] a szerveri hátralék beolvasása mentés előtt', error); }
        }
        await global.V44Online.syncChangedOrdersV132({
          orders: changes.orders,
          deletedIds: isDriver ? [] : changes.deletedIds,
          backlogChanged: isDriver ? [] : changes.backlogChanged,
          backlogDeletedIds: isDriver ? [] : changes.backlogDeletedIds,
          backlogAll: isDriver && backlogTouched ? (state.backlog || []) : null
        }, currentProfile);
        /* Admin mentésnél a friss szerveradat beolvadt a fuvarba – az így
           kapott, ténylegesen felírt állapot az egyeztetett. */
        for (const order of changes.orders) {
          const id = String(order.id);
          if (!isDriver) syncedV132.set(id, orderKeyV132(order));
          else if (orderKeyV132(order) === sentKeys.get(id)) syncedV132.set(id, sentKeys.get(id));
        }
        rememberServerIdsV137(changes.orders.map(order => order.id));
        for (const id of changes.deletedIds) { syncedV132.delete(id); deletedThisSessionV132.add(id); }
        if (isDriver) syncedV132.forEach((_, id) => { if (!(state.orders || []).some(order => String(order.id) === id)) syncedV132.delete(id); });
        for (const [id, key] of sentBacklog) syncedBacklogV132.set(id, key);
        for (const id of changes.backlogDeletedIds) syncedBacklogV132.delete(id);
        if (isDriver && backlogTouched) for (const entry of state.backlog || []) syncedBacklogV132.set(String(entry.id), backlogKeyV132(entry));

        /* V117/V118: az üzenetszál a szűrt mentés UTÁN megy fel – de most
           csak a ténylegesen módosított fuvaroké, nem minden fuvaré. */
        if (isDriver) {
          for (const order of changes.orders.filter(order => (order.threadV115 || []).length)) {
            try { await global.V44Online.syncOrderThread(order); }
            catch (error) {
              const hianyzik = /sync_order_thread|PGRST202|does not exist|schema cache/i.test(String(error?.message || ''));
              if (hianyzik && !global.__threadSqlWarnedV118) {
                global.__threadSqlWarnedV118 = true;
                alert('Az üzenetek feltöltéséhez a Supabase-ben le kell futtatni a SUPABASE_UZENETEK.sql fájlt, és engedélyezni a sync_order_thread függvényt.');
              }
              console.warn('[V118] az üzenet feltöltése nem sikerült', order.orderNo, error);
              try { await global.V44Online.updateOwnOrder(order); }
              catch (masodik) { console.warn('[V118] a teljes fuvar feltöltése sem ment', masodik); }
            }
          }
          /* A sofőri teljesítés és a szállítólevél-jelölés atomi írása is. */
          for (const order of changes.orders) {
            try { await global.V44Online.setDriverFieldsV132?.(order); }
            catch (error) { console.warn('[V132] sofőri mezők írása', order.orderNo, error); }
          }
        } else {
          try { await global.V44Online.syncMasterData(state, currentProfile); }
          catch (error) {
            console.warn('[V48] Törzsadat-szinkron hiba', error);
            setSyncStatus({ state: 'error', message: 'A fuvarok mentve, a törzsadat-szinkronhoz SQL-frissítés kell.' });
          }
        }
      } catch (error) {
        console.error('[V132] Online mentési hiba', error);
        /* V137: sofőrnél egy elutasított fuvar ne akassza meg a többit –
           fuvaronként újrapróbáljuk, a szerveren már nem létezőt pedig
           helyben is eltávolítjuk. */
        if (isDriver && changes.orders.length) {
          try { await isolateDriverSyncV137(changes.orders, sentKeys); }
          catch (inner) { console.warn('[V137] fuvaronkénti mentés', inner); }
        }
        setSyncStatus({ state: 'error', message: `Mentési hiba: ${error.message}` });
        if (hasChangesV132(collectChangesV132())) retrySyncLaterV132(15000);
      }
    })();
    try { await syncRunningV132; } finally { syncRunningV132 = null; }
    if (hasChangesV132(collectChangesV132()) && !saveTimer) retrySyncLaterV132(900);
  }

  async function isolateDriverSyncV137(orders, sentKeys) {
    const removed = [];
    for (const order of orders) {
      const id = String(order.id);
      try {
        await global.V44Online.syncChangedOrdersV132({ orders: [order] }, currentProfile);
        if (orderKeyV132(order) === sentKeys.get(id)) syncedV132.set(id, sentKeys.get(id));
        rememberServerIdsV137([id]);
        try { await global.V44Online.setDriverFieldsV132?.(order); } catch (_) {}
      } catch (error) {
        let exists = true;
        try { exists = (await global.V44Online.fetchOrderPayloadsV132([id])).has(id); }
        catch (_) { exists = true; }
        if (!exists && !keepLocalOnlyOrderV137(order)) {
          state.orders = (state.orders || []).filter(item => String(item.id) !== id);
          syncedV132.delete(id);
          removed.push(order.orderNo || id);
        } else {
          console.warn('[V137] a fuvar mentése nem sikerült', order.orderNo || id, error);
        }
      }
    }
    if (removed.length) {
      console.info('[V137] A szerveren már nem létező fuvar eltávolítva:', removed.join(', '));
      loadingV132 = true;
      try { if (typeof global.save === 'function') global.save(false); } finally { loadingV132 = false; }
      if (!isAdmin()) renderDriverPortal();
    }
    return removed;
  }

  /* V132 – KÖZVETLEN MENTÉS EGY FUVARRA (pipa, szállítólevél, üzenet)

     A fuvar a mentés idejére „úton” jelölést kap, így a késleltetett
     mentés nem küld róla egy párhuzamos, esetleg régebbi példányt. */
  async function directOrderWriteV132(order) {
    if (!order?.id) return;
    const id = String(order.id);
    const keyBefore = orderKeyV132(order);
    inflightV132.add(id);
    try {
      if (currentProfile?.role === 'admin') {
        await global.V44Online.syncOrdersForDate(order.scheduleDate, [order], currentProfile);
        syncedV132.set(id, orderKeyV132(order));
      } else {
        await global.V44Online.updateOwnOrder(order);
        const atomic = await global.V44Online.setDriverFieldsV132?.(order);
        if (atomic === false) await verifyDriverWriteV132(order);
        if (orderKeyV132(order) === keyBefore) syncedV132.set(id, keyBefore);
      }
      writtenAtV132.set(id, Date.now());
    } finally {
      inflightV132.delete(id);
      if (isDirtyV132(order)) retrySyncLaterV132(900);
    }
  }
  global.directOrderWriteV132 = directOrderWriteV132;
  /* ===== V135 – A LEVÉL MELLÉKLETE MEGBÍZHATÓAN A SOFŐRHÖZ JUT =========

     Az import eddig a mellékleteket a fuvar online mentésével EGY IDŐBEN,
     annak megvárása nélkül kezdte feltölteni. Ha a fuvar még nem volt a
     szerveren, a szerver elutasította a mellékletet. Az admin ezt nem vette
     észre, mert a saját gépén tárolt eredetiből nyitotta meg – a sofőr
     viszont csak a szerveri példányt látja, így nála üres volt.

     Most:
       - a feltöltés előtt megvárjuk, hogy a fuvar biztosan a szerveren legyen;
       - a feltöltés hiba esetén újrapróbál;
       - siker esetén a fuvar megjegyzi a melléklet-bejegyzés azonosítóját
         (sourceMailReportIdsV135), így a sofőr külön lekérdezés nélkül is
         felismeri;
       - végleges hibánál maradandó jelzést kap (sourceUploadFailedV135),
         ami az admin buborékon látszik, és a Beállításokban pótolható. */
  const sleepV135 = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function ensureOrdersOnServerV135(orderIds) {
    const ids = [...new Set((orderIds || []).map(String).filter(Boolean))];
    if (!ids.length || !currentProfile || !global.V44Online?.configured?.()) return ids;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (syncRunningV132) { try { await syncRunningV132; } catch (_) {} }
    try { await runSyncV132(); } catch (error) { console.warn('[V135] mentés a feltöltés előtt', error); }
    let missing = ids;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const found = await global.V44Online.fetchOrderPayloadsV132(missing);
        missing = missing.filter(id => !found.has(id));
      } catch (error) { console.warn('[V135] a fuvarok ellenőrzése', error); }
      if (!missing.length) return [];
      const orders = (state.orders || []).filter(order => missing.includes(String(order.id)));
      if (orders.length) {
        try {
          await global.V44Online.syncChangedOrdersV132({ orders }, currentProfile);
          for (const order of orders) syncedV132.set(String(order.id), orderKeyV132(order));
        } catch (error) { console.warn('[V135] a fuvar közvetlen mentése', error); }
      }
      await sleepV135(400 * (attempt + 1));
    }
    return missing;
  }
  global.ensureOrdersOnServerV135 = ensureOrdersOnServerV135;

  async function uploadOrderSourceFilesV135(order, files, label) {
    if (!order?.id || !(files || []).length) return { ok: false, error: 'Nincs feltölthető fájl.' };
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await global.V44Online.createDeliveryReport(order, files, label || 'Outlook forrás');
        order.sourceMailReportIdsV135 = [...new Set([...(order.sourceMailReportIdsV135 || []), String(result.report.id)])];
        delete order.sourceUploadFailedV135;
        /* V136: ha egy-egy fájlt a tároló elutasított, a többi akkor is
           felkerül – a kimaradtakat név szerint megjegyezzük. */
        const skipped = (result.skipped || []).map(item => item.name);
        if (skipped.length) order.sourceUploadPartialV136 = { at: new Date().toISOString(), skipped, error: (result.skipped[0] || {}).error || '' };
        else delete order.sourceUploadPartialV136;
        order.localUpdatedAt = new Date().toISOString();
        if (typeof save === 'function') save(false);
        return { ok: true, count: result.report.fileCount || files.length, skipped };
      } catch (error) {
        lastError = error;
        console.warn('[V135] a melléklet feltöltése', order.orderNo, attempt + 1, error);
        await sleepV135(800 * (attempt + 1));
      }
    }
    order.sourceUploadFailedV135 = { at: new Date().toISOString(), error: String(lastError?.message || lastError || 'ismeretlen hiba'), count: files.length };
    order.localUpdatedAt = new Date().toISOString();
    if (typeof save === 'function') save(false);
    return { ok: false, error: order.sourceUploadFailedV135.error };
  }
  global.uploadOrderSourceFilesV135 = uploadOrderSourceFilesV135;

  /* A gépen tárolt eredeti mellékletek fájlként – előbb az IndexedDB-s
     (V108), ha nincs, a régi localStorage-os (V73) másolatból. */
  async function localSourceFilesV135(orderId) {
    const files = [];
    try {
      for (const record of await (global.mailAttachmentsV108?.(orderId) || [])) {
        if (record?.bytes) files.push(new File([record.bytes], record.name || 'melleklet', { type: record.type || 'application/octet-stream' }));
      }
    } catch (error) { console.warn('[V135] helyi mellékletek', error); }
    if (files.length) return files;
    for (const item of (typeof global.loadOrderAttachmentsV73 === 'function' ? global.loadOrderAttachmentsV73(orderId) : [])) {
      try {
        const match = /^data:([^;]*);base64,(.*)$/.exec(String(item.dataUrl || ''));
        if (!match) continue;
        const binary = atob(match[2]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        files.push(new File([bytes], item.name || 'melleklet', { type: match[1] || 'application/octet-stream' }));
      } catch (_) {}
    }
    return files;
  }
  global.localSourceFilesV135 = localSourceFilesV135;

  /* Egy fuvar mellékletének pótlása a Csatolmány ablakból. */
  async function uploadLocalSourceForOrderV135(orderId) {
    if (!isAdmin()) return alert('A mellékletet csak az admin töltheti fel.');
    const order = (state.orders || []).find(item => String(item.id) === String(orderId));
    if (!order) return;
    let files = await localSourceFilesV135(orderId);
    /* V136: részleges feltöltés után csak a kimaradt fájlok mennek fel. */
    const kimaradt = new Set((order.sourceUploadPartialV136?.skipped || []).map(String));
    if (kimaradt.size && (order.sourceMailReportIdsV135 || []).length) files = files.filter(file => kimaradt.has(String(file.name)));
    if (!files.length) return alert('Ezen a gépen nincs meg a levél eredeti melléklete. Húzd be újra az eredeti .msg fájlt az importba.');
    const status = byId('v135SourceStatus');
    if (status) status.textContent = 'Feltöltés a sofőrnek…';
    await ensureOrdersOnServerV135([order.id]);
    const result = await uploadOrderSourceFilesV135(order, files, `Outlook forrás · ${order.sourceMail?.fileName || ''}`.trim());
    if (typeof global.render === 'function') global.render();
    if (!result.ok) return alert(`A melléklet feltöltése nem sikerült: ${result.error}`);
    if (result.skipped?.length) alert(`A tároló ezeket a fájlokat nem fogadta el: ${result.skipped.join(', ')}\n\nFuttasd le a SUPABASE_TAROLO_V136.sql fájlt a Supabase-ben, majd próbáld újra.`);
    await openSourceMail(order.id);
  }
  global.uploadLocalSourceForOrderV135 = uploadLocalSourceForOrderV135;

  /* ===== V135 – HIÁNYZÓ MELLÉKLETEK PÓTLÁSA EGY GOMBBAL ================

     Minden fuvar, amelynek levélmelléklete nincs a szerveren, de az eredeti
     megvan ezen a gépen, feltöltődik. A végén lista mutatja, mit pótolt, és
     melyik fuvarnál nincs meg az eredeti (ott újra kell importálni). */
  function orderHasMailAttachmentV135(order) {
    const names = (Array.isArray(order?.sourceMail?.attachmentNames) ? order.sourceMail.attachmentNames : [])
      .filter(name => /\.(pdf|docx?|xlsx?|xlsm|csv|msg|eml)$/i.test(String(name || '')));
    return !!(order?.sourceMail && (names.length || order.sourceUploadFailedV135));
  }
  async function backfillSourceMailV135() {
    if (!isAdmin()) return;
    const host = byId('v135BackfillProgress');
    const button = byId('v135Backfill');
    const show = text => { if (host) { host.classList.remove('hidden'); host.textContent = text; } };
    if (button) button.disabled = true;
    try {
      /* V136: előbb a sikertelen próbálkozások maradványai. */
      let takaritas = null;
      if (global.V44Online.cleanupEmptySourceReportsV136) {
        show('Korábbi sikertelen feltöltések maradványainak takarítása…');
        try {
          takaritas = await global.V44Online.cleanupEmptySourceReportsV136(({ done, total }) => show(`Maradványok takarítása: ${done} / ${total}`));
        } catch (error) { console.warn('[V136] takarítás', error); }
      }
      show('A szerveren lévő mellékletek ellenőrzése…');
      const covered = await global.V44Online.fetchSourceMailCoverageV135();
      const candidates = [];
      for (const order of state.orders || []) {
        const kimaradt = new Set((order.sourceUploadPartialV136?.skipped || []).map(String));
        if (covered.has(String(order.id)) && !kimaradt.size) continue;
        let files = await localSourceFilesV135(order.id);
        if (covered.has(String(order.id))) files = files.filter(file => kimaradt.has(String(file.name)));
        if (files.length) candidates.push({ order, files });
        else if (!covered.has(String(order.id)) && orderHasMailAttachmentV135(order)) candidates.push({ order, files: [] });
      }
      const fillable = candidates.filter(item => item.files.length);
      const missingOriginals = candidates.filter(item => !item.files.length).map(item => item.order);
      if (!fillable.length && !missingOriginals.length) { show(`${takaritas?.total ? `Takarítás: ${takaritas.reportsRemoved} üres bejegyzés és ${takaritas.filesRemoved} fölösleges fájl törölve.\n` : ''}Minden levélmelléklet elérhető a sofőröknek.`); return; }
      if (fillable.length && !confirm(`${fillable.length} fuvar levélmelléklete hiányzik a szerverről, de megvan ezen a gépen. Feltöltsem őket, hogy a sofőrök is megnyithassák?`)) { show('A pótlás nem indult el.'); return; }
      let done = 0;
      const failed = [];
      const reszleges = [];
      for (const { order, files } of fillable) {
        show(`Feltöltés: ${done + failed.length + 1} / ${fillable.length} · ${order.orderNo || order.id}`);
        await ensureOrdersOnServerV135([order.id]);
        const result = await uploadOrderSourceFilesV135(order, files, `Outlook forrás · ${order.sourceMail?.fileName || ''}`.trim());
        if (result.ok) done++; else failed.push(`${order.orderNo || order.id}: ${result.error}`);
        if (result.ok && result.skipped?.length) reszleges.push(`${order.orderNo || order.id}: ${result.skipped.join(', ')}`);
      }
      if (typeof global.render === 'function') global.render();
      const lines = [`Kész: ${done} fuvar melléklete feltöltve.`];
      if (takaritas?.total) lines.push(`Takarítás: ${takaritas.reportsRemoved} üres bejegyzés és ${takaritas.filesRemoved} fölösleges fájl törölve${takaritas.failed ? `, ${takaritas.failed} nem sikerült` : ''}.`);
      if (reszleges.length) lines.push(`Egyes fájlokat a tároló nem fogadott el (${reszleges.length} fuvar) – futtasd le a SUPABASE_TAROLO_V136.sql fájlt, majd nyomd meg újra a gombot: ${reszleges.slice(0, 10).join(' · ')}`);
      if (failed.length) lines.push(`Sikertelen (${failed.length}): ${failed.slice(0, 10).join(' · ')}${failed.length > 10 ? ' …' : ''}`);
      if (missingOriginals.length) lines.push(`Ezen a gépen nincs meg az eredeti (${missingOriginals.length}) – ezeket újra kell importálni: ${missingOriginals.slice(0, 30).map(order => `${order.orderNo || '—'} (${order.scheduleDate || ''})`).join(', ')}${missingOriginals.length > 30 ? ' …' : ''}`);
      show(lines.join('\n'));
    } catch (error) {
      show(`A pótlás megszakadt: ${error.message}`);
    } finally { if (button) button.disabled = false; }
  }
  global.backfillSourceMailV135 = backfillSourceMailV135;

  /* V132: az automatikus tesztek ezen keresztül állítják be a belépett
     felhasználót és olvassák a változáskövetést. A felületről nem érhető el
     semmi olyan, ami jogosultságot adna: a szerver minden írást ellenőriz. */
  global.__V132SyncTest = {
    setProfile: value => { currentProfile = value; },
    resetSnapshot: () => resetSnapshotV132(),
    collect: () => collectChangesV132(),
    runSync: () => runSyncV132(),
    reload: () => reloadOrdersV132(),
    isDirty: order => isDirtyV132(order),
    installSaveHook: () => installGuardsAndHooks(),
    adminPoll: () => adminPollV132(),
    synced: () => syncedV132,
    knownIds: () => knownServerIdsV137,
    rememberIds: ids => rememberServerIdsV137(ids),
    initialLoad: () => initialOnlineLoad()
  };
  global.markOrdersSyncedV132 = orders => {
    for (const order of orders || []) if (order?.id) syncedV132.set(String(order.id), orderKeyV132(order));
    if (hasChangesV132(collectChangesV132())) retrySyncLaterV132(900);
  };

  /* Ha a szűk célú SQL-függvény még nincs létrehozva, visszaolvassuk, hogy
     a szerver tényleg eltárolta-e a teljesítést és a szállítólevelet. Ha
     nem, egyszer szólunk – ez a szerveroldali mezőszűrés jele. */
  async function verifyDriverWriteV132(order) {
    try {
      const payload = (await global.V44Online.fetchOrderPayloadsV132([order.id])).get(String(order.id));
      if (!payload) return;
      const reportIds = new Set((payload.deliveryReports || []).map(report => String(report?.id || report?.at)));
      const missingReport = (order.deliveryReports || []).some(report => !reportIds.has(String(report?.id || report?.at)));
      const wrongCompletion = !!payload.completed !== !!order.completed;
      if ((missingReport || wrongCompletion) && !global.__driverFieldsWarnedV132) {
        global.__driverFieldsWarnedV132 = true;
        console.warn('[V132] a szerver nem tárolta el a sofőri mezőt', { order: order.orderNo, missingReport, wrongCompletion });
        alert('A szerver nem tárolta el a teljesítést vagy a szállítólevél jelölését. Az adminnak le kell futtatnia a SUPABASE_SOFOR_MEZOK_V133.sql fájlt a Supabase-ben. A változás a telefonon megmarad, és újra megpróbáljuk felküldeni.');
      }
      if (missingReport || wrongCompletion) throw new Error('A szerver nem tárolta el a változást.');
    } catch (error) {
      if (/nem tárolta el/.test(String(error?.message))) throw error;
      console.warn('[V132] ellenőrző visszaolvasás', error);
    }
  }

  /* V70: ha a lap bezárul vagy háttérbe kerül, a függőben lévő mentést
     azonnal elindítjuk. Enélkül a 900 ms-es várakozás alatt elnavigálva a
     változás soha nem jutott fel a szerverre. */
  global.flushPendingSyncV70 = () => flushPendingSyncV70();
  function flushPendingSyncV70() {
    if (!saveTimer) return;
    clearTimeout(saveTimer); saveTimer = null;
    if (suppressOnlineSave || !currentProfile || !global.V44Online?.configured()) return;
    runSyncV132().catch(error => console.warn('[V70] Azonnali mentés nem sikerült', error));
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPendingSyncV70(); });
    global.addEventListener?.('pagehide', flushPendingSyncV70);
    global.addEventListener?.('beforeunload', flushPendingSyncV70);
  }

  function installGuardsAndHooks() {
    /* V71: a harmadik paraméter azt mondja meg, hogy a művelet MÓDOSÍT-e.
       A módosító műveletek a lezárt (előző munkanapi) fuvaron nem futnak le,
       a megtekintés viszont igen. */
    const guardOrderFunction = (name, allowedForDrivers, mutates = false) => {
      const original = global[name];
      if (typeof original !== 'function') return;
      global[name] = function (orderId, ...args) {
        if (!isRestrictedUser()) return original.call(this, orderId, ...args);
        if (!allowedForDrivers || !canAccessOrder(orderId)) return alert('Ehhez a művelethez nincs jogosultságod.');
        if (mutates && !canEditOrder(orderId)) {
          return alert('Csak az aktuális munkanap szerkeszthető. Ez a nap csak megtekinthető.');
        }
        return original.call(this, orderId, ...args);
      };
    };
    guardOrderFunction('openItems', true);
    guardOrderFunction('openCamera', true, true);
    guardOrderFunction('toggleItem', true, true);
    guardOrderFunction('updateMissingQty', true, true);
    guardOrderFunction('updateItemNote', true, true);
    guardOrderFunction('openShortage', true, true);
    guardOrderFunction('closeShortage', true, true);
    guardOrderFunction('setItemMoveDate', true, true);
    guardOrderFunction('rescheduleMovedItem', true, true);
    guardOrderFunction('undoBacklogMove', true, true);
    guardOrderFunction('moveUncheckedToUndatedV139', true, true);
    guardOrderFunction('openTransferDialog', true, true);
    guardOrderFunction('editOrder', false);
    guardOrderFunction('deleteOne', false);
    guardOrderFunction('toggleComplete', false);
    guardOrderFunction('failOrderToTomorrow', false);

    const originalSave = global.save;
    if (typeof originalSave === 'function') {
      global.save = function (...args) {
        if (!loadingV132) stampUndoV132();
        const result = originalSave.apply(this, args);
        if (isRestrictedUser()) setTimeout(() => renderDriverPortal(), 0);
        scheduleSync();
        return result;
      };
    }

    /* V129: fuvarszétosztás és optimalizálás után a helyi mentés ne indítsa
       el a régi teljes-listás online szinkront. A planner a rögzített napot
       külön, célzottan menti a syncOrdersForDate eljárással. */
    global.saveLocalOnlyV129 = function () {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      const wasSuppressed = suppressOnlineSave;
      suppressOnlineSave = true;
      try {
        if (typeof global.save === 'function') global.save(false);
      } finally {
        suppressOnlineSave = wasSuppressed;
      }
    };

    byId('itemsDialog')?.addEventListener('close', () => { if (isRestrictedUser()) renderDriverPortal(); });
    const cameraForm = byId('cameraForm');
    if (cameraForm) cameraForm.onsubmit = async event => {
      event.preventDefault();
      const orderId = byId('cameraOrderId')?.value;
      if (!canAccessOrder(orderId)) return alert('Ehhez a fuvarhoz nincs jogosultságod.');
      const order = (state.orders || []).find(item => String(item.id) === String(orderId));
      if (!order) return;
      if (cameraForm.__pendingDeliveryMetadataV131) {
        const pending = cameraForm.__pendingDeliveryMetadataV131;
        if (String(pending.orderId) !== String(order.id)) return alert('Előbb az előző szállítólevél fuvaradatát kell elmenteni. Nyisd meg annak a fuvarnak a fotóablakát, és nyomd meg az újrapróbálás gombot.');
        const retryButton = cameraForm.querySelector('button[type="submit"]');
        if (retryButton) { retryButton.disabled = true; retryButton.textContent = 'Fuvaradat mentése…'; }
        try {
          await directOrderWriteV132(order);
          cameraForm.__pendingDeliveryMetadataV131 = null;
          if (typeof audioBlob !== 'undefined') audioBlob = null;
          cameraForm.closest('dialog')?.close();
          alert('A korábban feltöltött szállítólevél fuvaradata is elmentve.');
        } catch (error) {
          alert(`A fájlok már feltöltődtek, de a fuvaradat mentése még nem sikerült: ${error.message}`);
        } finally {
          if (retryButton) { retryButton.disabled = false; retryButton.textContent = cameraForm.__pendingDeliveryMetadataV131 ? 'Fuvaradat mentésének újrapróbálása' : 'Mentés a rendeléshez'; }
        }
        return;
      }
      const files = global.V69DeliveryCamera?.files() || [...(byId('cameraInput')?.files || [])];
      if (!files.length && !(typeof audioBlob !== 'undefined' && audioBlob)) return alert('Készíts legalább egy fotót vagy hangjegyzetet.');
      const submit = cameraForm.querySelector('button[type="submit"]');
      if (submit) { submit.disabled = true; submit.textContent = 'Fotók feltöltése…'; }
      try {
        const result = await global.V44Online.createDeliveryReport(order, files, byId('cameraNote')?.value || '', typeof audioBlob !== 'undefined' ? audioBlob : null);
        order.deliveryReports = order.deliveryReports || [];
        const deliveryNote = byId('cameraNote')?.value || '';
        adjustDeliveryCountV134(order.id, +(result.report.fileCount || 0));
        order.deliveryReports.push({ id: result.report.id, at: result.report.created_at || new Date().toISOString(), note: deliveryNote, photoCount: files.length, fileCount: result.report.fileCount, hasAudio: typeof audioBlob !== 'undefined' && !!audioBlob, createdBy: currentSession?.user?.email, createdRole: currentProfile?.role || 'driver', userComment: !!deliveryNote.trim(), commentAt: deliveryNote.trim() ? new Date().toISOString() : '' });
        if (typeof save === 'function') save();
        try {
          await directOrderWriteV132(order);
        } catch (error) {
          cameraForm.__pendingDeliveryMetadataV131 = { orderId: String(order.id) };
          alert(`A fájlok feltöltődtek, de a fuvar buborékának mentése nem sikerült: ${error.message}\n\nNe töltsd fel újra a fájlokat. A gomb újrapróbálása csak a fuvaradatot menti.`);
          return;
        }
        cameraForm.__pendingDeliveryMetadataV131 = null;
        cameraForm.closest('dialog')?.close();
        if (typeof audioBlob !== 'undefined') audioBlob = null;
        if (result.skipped?.length) alert(`A szállítólevél elmentve, de ezeket a fájlokat a tároló nem fogadta el: ${result.skipped.map(item => item.name).join(', ')}`);
        else alert('A szállítólevél fotói a rendeléshez elmentve.');
      } catch (error) { alert(`Szállítólevél-mentési hiba: ${error.message}`); }
      finally { if (submit) { submit.disabled = false; submit.textContent = cameraForm.__pendingDeliveryMetadataV131 ? 'Fuvaradat mentésének újrapróbálása' : 'Mentés a rendeléshez'; } }
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
      <div class="panel v121-transfers-hidden" hidden><h3>Fuvarátadások</h3><div class="transfer-admin-list">${transfers.length ? transfers.map(transfer => `<article class="transfer-admin-row status-${safe(transfer.status)}"><div><b>${safe(transfer.order_no)} · ${safe(transfer.project_name || '')}</b><small>${safe(transfer.schedule_date || '')}</small></div><div><span>${safe(DRIVER_LABELS[transfer.from_driver_key] || transfer.from_driver_key)} → ${safe(DRIVER_LABELS[transfer.to_driver_key] || transfer.to_driver_key)}</span><strong>${transfer.status === 'pending' ? 'Függőben' : transfer.status === 'accepted' ? 'Elfogadva' : transfer.status === 'rejected' ? 'Elutasítva' : 'Visszavonva'}</strong><small>${new Date(transfer.created_at).toLocaleString('hu-HU')}</small></div></article>`).join('') : '<div class="notice">Még nincs fuvarátadási esemény.</div>'}</div></div>`;
      byId('forceOnlineSync')?.addEventListener('click', async () => {
        /* V132: minden fuvar felmegy, de a sofőri mezők beolvasztásával, és
           TÖRLÉS NÉLKÜL – a régi admin-példány nem törölheti a sofőr által
           közben létrehozott fuvarokat. */
        try { const all = state.orders || []; await global.V44Online.syncChangedOrdersV132({ orders: all }, currentProfile); global.markOrdersSyncedV132(all); await global.V44Online.syncMasterData(state, currentProfile); if (typeof render === 'function') render(); alert('Minden fuvar és a teljes aktuális törzsadat online mentve.'); }
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
      /* V120: a szállítólevelek archiválása a MEGLÉVŐ Beállítások lapra kerül.
         Korábban külön menüpontot csináltunk neki, pedig ez a lap már
         létezett – csak belépéskor épül, ezért nem volt az index.html-ben. */
      section.innerHTML = '<div class="page-head"><div><small>ONLINE</small><h2>Beállítások és fuvarátadások</h2></div></div><div id="onlineAdminContent"></div>'
        + '<section class="panel v119-archive"><h3>Szállítólevelek archiválása</h3><p class="v108-hint">Az új feltöltések is azonnal bekerülhetnek a ZIP-be. Törölni csak már archivált, legalább két napos fájlokat lehet, külön megerősítéssel.</p><div id="v119Summary" class="v119-summary">Összesítés betöltése…</div><div class="v119-buttons"><button type="button" id="v119ArchiveRefresh" class="secondary">Összesítés frissítése</button><button type="button" id="v119Archive">Archiválás</button><button type="button" id="v119Purge" class="v115-danger">Archiváltak törlése</button></div><div id="v119Progress" class="v119-progress hidden"></div></section>'
        + '<section class="panel v135-backfill"><h3>Levélmellékletek a sofőröknek</h3><p class="v108-hint">Azoknak a fuvaroknak a levélmellékletét, amelyek nem jutottak fel a szerverre, ezen a gépen tárolt eredetiből feltölti, hogy a sofőrök is megnyithassák. Azon a gépen futtasd, amelyiken az importok készültek.</p><div class="v119-buttons"><button type="button" id="v135Backfill">Hiányzó mellékletek feltöltése a sofőröknek</button></div><div id="v135BackfillProgress" class="v135-progress hidden"></div></section>';
      document.querySelector('main')?.append(section);
      section.querySelector('#v135Backfill')?.addEventListener('click', () => backfillSourceMailV135());
      const navButton = document.createElement('button');
      navButton.className = 'nav'; navButton.dataset.page = 'onlineAdmin'; navButton.innerHTML = '<span>⚙</span><small>Beállítások</small>';
      document.querySelector('nav')?.append(navButton);
      navButton.onclick = () => { if (typeof showPage === 'function') showPage('onlineAdmin'); renderAdminOnlinePage(); global.renderArchiveSummaryV119?.(); };
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

  /* ===== V115 – A SOFŐRI FELÜLET MAGÁTÓL FRISSÜL =====================

     Eddig a Frissítés gombra kellett várni, ezért az admin változása — új
     fuvar, átrendezés, üzenet — csak akkor jutott el a sofőrhöz, ha ő
     rányomott. Mostantól a sofőri felület percenként magától lekérdezi a
     fuvarokat.

     Két dologra ügyelünk. Nem frissítünk, ha épp NYITVA van egy ablak (a
     tételek, a kamera vagy az üzenetek) – különben kiesne a keze alól. És
     nem frissítünk, ha a lap háttérben van, hogy ne fogyassza az adatot. */
  let pollTimerV115 = null;

  function pollBusyV115() {
    if (document.hidden) return true;
    return [...document.querySelectorAll('dialog')].some(d => d.open);
  }

  async function pollOnceV115() {
    if (pollBusyV115() || refreshInProgress) return;
    try {
      suppressOnlineSave = true;
      await reloadOrdersV132();
      await refreshTransfers();
      if (isAdmin()) { if (typeof render === 'function') render(); }
      else await renderDriverPortal();
    } catch (error) {
      console.warn('[V115] automatikus frissítés', error);
    } finally { suppressOnlineSave = false; }
  }

  function startPolling() {
    global.V44Online?.stopPolling?.();
    if (pollTimerV115) clearInterval(pollTimerV115);
    /* Az ADMIN felületen marad a kézi Frissítés: ott épp tervezel, és egy
       magától érkező átrendezés zavaró volna. A sofőri felület viszont
       követi az adminét. */
    /* V132: az admin felület is percenként átveszi a sofőri jelzéseket
       (pipa, szállítólevél), de a tervezést nem írja felül. */
    if (isAdmin()) {
      pollTimerV115 = setInterval(adminPollV132, 60000);
      refreshDeliveryCountsV132().then(changed => { if (changed && typeof global.render === 'function') global.render(); });
    } else pollTimerV115 = setInterval(pollOnceV115, 60000);
    /* V132: a láthatóság-figyelő egyszer kerül fel, nem minden belépéskor. */
    if (!visibilityBoundV132) {
      visibilityBoundV132 = true;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden || !currentProfile) return;
        if (isAdmin()) adminPollV132(); else pollOnceV115();
      });
    }
  }
  let visibilityBoundV132 = false;

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
