/* Fuvarszervező – Supabase REST alapú online szinkron.
   Külső klienskönyvtár nélkül működik, a böngésző beépített fetch API-jával. */
(function (global) {
  'use strict';

  const config = global.FUVARSZERVEZO_ONLINE_CONFIG || {};
  const SESSION_KEY = 'fuvarszervezo_online_session_v52';
  const LEGACY_SESSION_KEYS = ['fuvarszervezo_online_session_v44_2'];
  const DRIVER_VEHICLES = { mario: 'v-mario', patrik: 'v-patrik', martin: 'v-martin' };
  let session = null;
  let profile = null;
  let remoteLoaded = false;
  let pollTimer = null;
  let statusListener = null;

  const normalize = value => String(value || '').trim().toLowerCase();
  const cleanBase = value => String(value || '').replace(/\/+$/, '');
  const baseUrl = () => cleanBase(config.supabaseUrl);
  const configured = () => /^https:\/\/.+\.supabase\.co$/i.test(baseUrl()) && config.anonKey && !String(config.anonKey).includes('YOUR-');
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const emit = (state, message) => {
    try { statusListener?.({ state, message, at: new Date().toISOString() }); } catch (_) {}
    global.dispatchEvent?.(new CustomEvent('fuvar-online-status', { detail: { state, message } }));
  };
  const qs = params => new URLSearchParams(params).toString();
  const pathEncode = value => String(value).split('/').map(encodeURIComponent).join('/');
  const safeName = value => String(value || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-140);
  const driverKeyFromOrder = order => {
    const vehicle = String(order?.vehicleId || '');
    if (vehicle === 'v-mario') return 'mario';
    if (vehicle === 'v-patrik') return 'patrik';
    if (vehicle === 'v-martin') return 'martin';
    const name = normalize((global.state?.vehicles || []).find(v => v.id === vehicle)?.driverName);
    if (name.includes('mario')) return 'mario';
    if (name.includes('patrik')) return 'patrik';
    if (name.includes('martin')) return 'martin';
    return null;
  };

  function saveSession(value) {
    session = value || null;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }
  function restoreSession() {
    for (const key of LEGACY_SESSION_KEYS) localStorage.removeItem(key);
    try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (_) { session = null; }
    return session;
  }

  async function rawRequest(url, { method = 'GET', body, auth = true, headers = {}, expectText = false } = {}) {
    if (!configured()) throw new Error('Az online háttér nincs beállítva. Töltsd ki az online-config.js fájlt.');
    if (auth) await ensureSession();
    const requestHeaders = {
      apikey: config.anonKey,
      ...headers
    };
    if (auth && session?.access_token) requestHeaders.Authorization = `Bearer ${session.access_token}`;
    let requestBody = body;
    if (body !== undefined && body !== null && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof FormData) && typeof body !== 'string') {
      requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
      requestBody = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(url, { method, headers: requestHeaders, body: requestBody });
    } catch (networkError) {
      /* V146: hálózati hiba (nincs térerő, alagút, ébredés) – átmeneti */
      const error = new Error(`Nincs kapcsolat a szerverrel (${networkError?.message || 'hálózati hiba'}).`);
      error.transient = true;
      throw error;
    }
    /* V146: ha a szerver lejárt bejelentkezési kulcs miatt utasít el, új
       kulcsot kérünk, és a kérést EGYSZER megismételjük. */
    if (response.status === 401 && auth && !arguments[1]?.__retriedV146 && session?.refresh_token) {
      const peek = await response.clone().text().catch(() => '');
      if (/jwt|expired|token/i.test(peek)) {
        await refreshSession({ force: true });
        return rawRequest(url, { ...(arguments[1] || {}), __retriedV146: true });
      }
    }
    const text = await response.text();
    let parsed = null;
    if (text && !expectText) {
      try { parsed = JSON.parse(text); } catch (_) { parsed = text; }
    } else parsed = text;
    if (!response.ok) {
      const message = parsed?.msg || parsed?.message || parsed?.error_description || parsed?.error || `${response.status} ${response.statusText}`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = parsed;
      if (response.status >= 500 || response.status === 429 || response.status === 408) error.transient = true;
      throw error;
    }
    return parsed;
  }

  async function authRequest(path, options = {}) {
    return rawRequest(`${baseUrl()}/auth/v1/${path}`, { ...options, auth: false });
  }
  async function dbRequest(path, options = {}) {
    return rawRequest(`${baseUrl()}/rest/v1/${path}`, options);
  }

  /* ===== V146 – A BEJELENTKEZÉS NEM VESZHET EL CSENDBEN ===============

     Eddig a bejelentkezési kulcs frissítésének BÁRMILYEN hibája (pl. egy
     pillanatnyi térerőhiány a telefon ébredésekor) véglegesen törölte a
     bejelentkezést. Utána minden frissítés elbukott, a felület pedig a régi
     állapotot mutatta – a sofőr nem látta az új fuvarokat, és semmi nem
     jelezte. Ráadásul két párhuzamos kérés két frissítést is indíthatott.

     Most:
       - egyszerre csak EGY kulcsfrissítés fut, a többi kérés azt várja meg;
       - átmeneti hibánál (hálózat, szerverhiba) a bejelentkezés megmarad, a
         következő kérés újra próbálkozik;
       - csak akkor töröljük, ha a szerver EGYÉRTELMŰEN érvénytelennek
         mondja a frissítő kulcsot – és akkor sem csendben: a
         'fuvar-session-expired' esemény a belépő képernyőre irányít. */
  let refreshPromiseV146 = null;
  function isDefinitiveAuthErrorV146(error) {
    if (!error || error.transient) return false;
    const status = +error.status || 0;
    const text = `${error.message || ''} ${JSON.stringify(error.payload || '')}`;
    return (status === 400 || status === 401 || status === 403)
      && /invalid[_ ]grant|refresh[_ ]token|not[_ ]found|revoked|already[_ ]used|invalid/i.test(text);
  }
  function sessionExpiredV146(reason) {
    saveSession(null); profile = null;
    const error = new Error('A bejelentkezés lejárt, kérlek, lépj be újra.');
    error.code = 'SESSION_EXPIRED';
    try { global.dispatchEvent?.(new (global.CustomEvent || CustomEvent)('fuvar-session-expired', { detail: { reason: String(reason || '') } })); } catch (_) {}
    return error;
  }
  async function refreshSession({ force = false } = {}) {
    if (!session?.refresh_token) return null;
    if (refreshPromiseV146) return refreshPromiseV146;
    const usedToken = session.refresh_token;
    refreshPromiseV146 = (async () => {
      try {
        const data = await authRequest('token?grant_type=refresh_token', {
          method: 'POST', body: { refresh_token: usedToken }
        });
        saveSession({ ...data, expires_at: nowSeconds() + (+data.expires_in || 3600) });
        return session;
      } catch (error) {
        if (isDefinitiveAuthErrorV146(error)) throw sessionExpiredV146(error.message);
        /* átmeneti hiba: a bejelentkezés MEGMARAD */
        error.transient = true;
        throw error;
      } finally {
        refreshPromiseV146 = null;
      }
    })();
    return refreshPromiseV146;
  }
  async function ensureSession() {
    if (!session) restoreSession();
    if (!session?.access_token) { const error = new Error('Nincs aktív online munkamenet.'); error.code = 'NO_SESSION'; throw error; }
    const expiresAt = +session.expires_at || 0;
    if (expiresAt && expiresAt < nowSeconds() + 90) {
      try { await refreshSession(); }
      catch (error) {
        /* V146: átmeneti hibánál, ha a régi kulcs még érvényes, azzal megyünk
           tovább; ha már lejárt, a kérés hibát ad, de a bejelentkezés marad. */
        if (error.code === 'SESSION_EXPIRED') throw error;
        if (!(expiresAt > nowSeconds())) throw error;
      }
    }
    return session;
  }

  async function signInWithPassword(email, password) {
    emit('loading', 'Belépés…');
    const data = await authRequest('token?grant_type=password', {
      method: 'POST',
      body: { email: normalize(email), password: String(password || '') }
    });
    if (!data?.access_token) throw new Error('A Supabase nem adott vissza érvényes munkamenetet.');
    const expiresIn = +(data.expires_in || 3600);
    saveSession({ ...data, expires_at: nowSeconds() + expiresIn });
    profile = null;
    emit('online', 'Sikeres belépés.');
    return session;
  }

  async function signOut() {
    try { if (session?.access_token) await authRequest('logout', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } }); }
    catch (_) {}
    stopPolling();
    saveSession(null); profile = null; remoteLoaded = false;
  }

  async function fetchProfile() {
    await ensureSession();
    const rows = await dbRequest(`allowed_users?${qs({ select: 'email,role,driver_key,vehicle_id,display_name,active', email: `eq.${normalize(session.user?.email)}` })}`);
    if (!rows?.[0]?.active) throw new Error('Ez az e-mail-cím nincs engedélyezve az alkalmazásban.');
    profile = rows[0];
    return profile;
  }

  async function listUsers() {
    return dbRequest(`allowed_users?${qs({ select: 'email,role,driver_key,vehicle_id,display_name,active', active: 'eq.true', order: 'display_name.asc' })}`);
  }

  function masterSnapshot(source = global.state || {}) {
    return {
      projects: source.projects || [],
      suppliers: source.suppliers || [],
      recipients: source.recipients || [],
      vehicles: source.vehicles || [],
      settings: source.settings || {},
      aliases: source.aliases || { projects: {}, suppliers: {} },
      masterDataVersion: source.masterDataVersion || '',
      savedAt: new Date().toISOString()
    };
  }

  /* ===== V112 – A HIÁNYZÓ master_data TÁBLA NEM ÁLLÍTHATJA MEG A MUNKÁT

     A törzsadat (projektek, beszállítók, átvevők, járművek) egy külön
     Supabase-táblában tárolódik. Ha ez a tábla nincs létrehozva, a lekérés
     hibát dobott, és az EGÉSZ frissítés megállt – pedig a fuvarok addigra
     már betöltődtek.

     Mostantól a hiányzó táblát úgy kezeljük, mintha üres volna: a helyi
     törzsadat marad érvényben, a fuvarok frissülnek, és csak a konzolba
     kerül megjegyzés. A tábla létrehozásához a SUPABASE_MASTER_DATA.sql
     fájl tartalmazza a parancsot. */
  function missingTableV112(error) {
    const szoveg = String(error?.message || error || '').toLowerCase();
    return szoveg.includes('master_data') &&
      (szoveg.includes('could not find the table') || szoveg.includes('does not exist')
        || szoveg.includes('schema cache') || szoveg.includes('pgrst205'));
  }

  async function fetchMasterData() {
    if (!profile) profile = await fetchProfile();
    if (profile?.role !== 'admin') return null;
    let rows;
    try {
      rows = await dbRequest(`master_data?${qs({ select: 'payload,updated_at,updated_by', id: 'eq.current', limit: '1' })}`);
    } catch (error) {
      if (!missingTableV112(error)) throw error;
      console.warn('[V112] a master_data tábla nincs létrehozva – a helyi törzsadat marad érvényben.');
      return null;
    }
    return rows?.[0] ? { ...(rows[0].payload || {}), onlineUpdatedAt: rows[0].updated_at, onlineUpdatedBy: rows[0].updated_by } : null;
  }

  /* V147: a járművek (távollétekkel) a törzsadat-táblából – sofőrnek is. */
  /* ===== V148 – ELHELYEZÉS-VÉDELEM ÉS ELŐZMÉNYEK ===================== */
  /* A feltöltött áthelyezések szerver szerinti állapota (elfogadta-e). */
  async function fetchPlacementsV148(ids = []) {
    const out = new Map();
    const list = [...new Set(ids.map(String))];
    for (let i = 0; i < list.length; i += 80) {
      const part = list.slice(i, i + 80);
      const rows = await dbRequest(`orders?${qs({ select: 'id,schedule_date,vehicle_id,sequence,payload->placementV148', id: `in.(${part.map(id => `"${id}"`).join(',')})` })}`);
      for (const row of rows || []) out.set(String(row.id), { scheduleDate: row.schedule_date, vehicleId: row.vehicle_id || '', sequence: row.sequence, placementV148: row.placementV148 || null });
    }
    return out;
  }
  async function protectionInstalledV148() {
    try { const r = await dbRequest('rpc/fuvar_vedelem_v148', { method: 'POST', body: {} }); return r === 'ok' || r === '"ok"'; }
    catch (_) { return false; }
  }
  async function fetchHistoryV148({ since, orderId = '', limit = 1000 } = {}) {
    const rows = [];
    for (let offset = 0; offset < 20000; offset += limit) {
      const params = { select: 'id,order_id,op,changed_at,changed_by,schedule_date,vehicle_id,sequence,payload', order: 'changed_at.asc,id.asc', limit: String(limit), offset: String(offset) };
      if (since) params.changed_at = `gt.${since}`;
      if (orderId) params.order_id = `eq.${orderId}`;
      const page = await dbRequest(`orders_history?${qs(params)}`);
      rows.push(...(page || []));
      if (!page || page.length < limit) break;
    }
    return rows;
  }

  async function fetchVehiclesV147() {
    try {
      const rows = await dbRequest(`master_data?${qs({ select: 'payload', id: 'eq.current', limit: '1' })}`);
      return rows?.[0]?.payload?.vehicles || null;
    } catch (error) {
      if (missingTableV112(error)) return null;
      throw error;
    }
  }

  /* ===== V147 – PUSH-ÉRTESÍTÉS ======================================= */
  async function pushConfigGetV147() {
    const rows = await dbRequest(`push_config?${qs({ select: 'vapid_public', id: 'eq.1' })}`);
    return rows?.[0]?.vapid_public || '';
  }
  async function pushConfigSetV147(vapidPublic) {
    await dbRequest('push_config?on_conflict=id', { method: 'POST', body: [{ id: 1, vapid_public: vapidPublic, updated_at: new Date().toISOString() }], headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    return true;
  }
  async function pushSaveSubscriptionV147(subscription, muted = false) {
    const json = typeof subscription?.toJSON === 'function' ? subscription.toJSON() : subscription;
    if (!json?.endpoint || !json?.keys?.p256dh || !json?.keys?.auth) throw new Error('Érvénytelen feliratkozás.');
    const email = normalize(profile?.email || session?.user?.email || '');
    await dbRequest('push_subscriptions?on_conflict=endpoint', {
      method: 'POST',
      body: [{ endpoint: json.endpoint, user_email: email, p256dh: json.keys.p256dh, auth: json.keys.auth, muted: !!muted, user_agent: String(global.navigator?.userAgent || '').slice(0, 200), updated_at: new Date().toISOString() }],
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
    });
    return true;
  }
  async function pushSetMutedV147(endpoint, muted) {
    if (!endpoint) return false;
    await dbRequest(`push_subscriptions?${qs({ endpoint: `eq.${endpoint}` })}`, { method: 'PATCH', body: { muted: !!muted, updated_at: new Date().toISOString() }, headers: { Prefer: 'return=minimal' } });
    return true;
  }
  async function pushDeleteSubscriptionV147(endpoint) {
    if (!endpoint) return false;
    await dbRequest(`push_subscriptions?${qs({ endpoint: `eq.${endpoint}` })}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return true;
  }
  async function pushTestV147() {
    return rawRequest(`${baseUrl()}/functions/v1/chat-push`, { method: 'POST', body: { test: true } });
  }

  async function syncMasterData(source = global.state, currentProfile = profile) {
    if (!currentProfile) currentProfile = await fetchProfile();
    if (currentProfile?.role !== 'admin') return null;
    const payload = masterSnapshot(source);
    try {
      await dbRequest('master_data?on_conflict=id', {
        method: 'POST',
        body: [{ id: 'current', payload, updated_at: new Date().toISOString() }],
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
      });
    } catch (error) {
      if (!missingTableV112(error)) throw error;
      console.warn('[V112] a master_data tábla nincs létrehozva – a törzsadat csak helyben mentődött.');
      return null;
    }
    return payload;
  }

  async function loadMasterIntoState({ preserveLocalIfRemoteEmpty = true } = {}) {
    const remote = await fetchMasterData();
    if (!global.state) throw new Error('Az alkalmazás állapota még nem érhető el.');
    if (!remote) {
      if (preserveLocalIfRemoteEmpty && profile?.role === 'admin') await syncMasterData(global.state, profile);
      return null;
    }
    ['projects', 'suppliers', 'recipients', 'vehicles'].forEach(key => { if (Array.isArray(remote[key])) global.state[key] = remote[key]; });
    if (remote.settings && typeof remote.settings === 'object') global.state.settings = remote.settings;
    if (remote.aliases && typeof remote.aliases === 'object') global.state.aliases = remote.aliases;
    if (remote.masterDataVersion) global.state.masterDataVersion = remote.masterDataVersion;
    return remote;
  }

  function orderToRow(order) {
    return {
      id: String(order.id),
      schedule_date: order.scheduleDate || null,
      vehicle_id: order.vehicleId || null,
      driver_key: driverKeyFromOrder(order),
      order_no: order.orderNo || '',
      project_name: order.projectName || '',
      sequence: +order.sequence || 999,
      /* V118: üres üzenetszálat nem küldünk fel – a puszta kirajzolás
         keletkeztethet ilyet, és felülírná a sofőr üzeneteit. */
      payload: (order && Array.isArray(order.threadV115) && !order.threadV115.length)
        ? (({ threadV115, ...tobbi }) => tobbi)(order)
        : order,
      updated_at: new Date().toISOString()
    };
  }
  function rowToOrder(row) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const order = {
      ...payload,
      id: row.id,
      scheduleDate: row.schedule_date || payload.scheduleDate || '',
      vehicleId: row.vehicle_id || payload.vehicleId || '',
      orderNo: row.order_no || payload.orderNo || '',
      projectName: row.project_name || payload.projectName || '',
      sequence: row.sequence ?? payload.sequence ?? 999,
      onlineUpdatedAt: row.updated_at
    };
    /* V148: a szerver szerinti elhelyezés (nap + sofőr) rekordja. A régi,
       még rekord nélküli fuvarnál a szerver oszlopaiból készül – nem
       függőben lévő, így a telefon nem tekinti saját módosításnak. */
    const pr = payload.placementV148;
    order.placementV148 = (pr && !pr.pending && pr.date === order.scheduleDate && String(pr.vehicleId || '') === String(order.vehicleId || ''))
      ? { ...pr }
      : { date: order.scheduleDate, vehicleId: order.vehicleId || '', at: pr && !pr.pending ? (pr.at || null) : null };
    return order;
  }

  /* V131: egy régi adminoldal teljes payloadot küldhetett vissza, és ezzel
     letörölhette a sofőr közben feltöltött szállítólevelét vagy pipáit.
     Admin mentés előtt most beolvassuk az érintett szerverrekordokat, és
     csak a sofőri mezőket fésüljük vissza az admin által szerkesztett fuvarba. */
  /* ===== V132 – A TELJESÍTÉS ESEMÉNYEK SORRENDJE SZERINT DŐL EL ========

     Eddig a teljesítés összefésülése vagy egyszerű VAGY-kapcsolat volt (a
     visszavonás soha nem ment át), vagy az utolsó író nyert (a régi
     adatpéldány letörölte a pipát). Most két eseményt ismerünk:
       - teljesítés: completed=true, ideje completedAt / completedAtV111
       - visszavonás: completedUndoneAtV132
     A legkésőbbi esemény dönt. A pipa nélküli, időbélyeg nélküli állapot
     nem esemény – így egy régi példány nem írhatja felül a friss pipát. */
  function completionStateV132(a, b) {
    const events = [];
    let undoneAt = '';
    for (const order of [a, b]) {
      if (!order) continue;
      if (order.completed) events.push({ at: String(order.completedAt || order.completedAtV111 || ''), done: true, order });
      const undo = String(order.completedUndoneAtV132 || '');
      if (undo) { events.push({ at: undo, done: false, order }); if (undo > undoneAt) undoneAt = undo; }
    }
    if (!events.length) return { completed: false, completedAt: '', completedAtV111: '', completedUndoneAtV132: '' };
    events.sort((x, y) => x.at.localeCompare(y.at) || (x.done === y.done ? 0 : x.done ? 1 : -1));
    const last = events[events.length - 1];
    if (last.done) {
      const at = last.at;
      return { completed: true, completedAt: at, completedAtV111: last.order.completedAtV111 || at, completedUndoneAtV132: undoneAt };
    }
    return { completed: false, completedAt: '', completedAtV111: '', completedUndoneAtV132: undoneAt };
  }
  function applyCompletionV132(target, result) {
    if (!target || !result) return target;
    target.completed = !!result.completed;
    target.completedAt = result.completedAt || '';
    if (result.completedAtV111) target.completedAtV111 = result.completedAtV111; else delete target.completedAtV111;
    if (result.completedUndoneAtV132) target.completedUndoneAtV132 = result.completedUndoneAtV132; else delete target.completedUndoneAtV132;
    return target;
  }

  /* ===== V133 – SZÁLLÍTÓLEVÉL-JELÖLÉS: TÖRLÉS ÉS ARCHIVÁLÁS ===========

     A két oldal szállítólevél-listája azonosító szerint egyesül, de:
       - a TÖRÖLT bejegyzés (deliveryReportsDeletedV133) egyik oldalról sem
         jöhet vissza – így tűnik el a jelölés, ha a galériából törölték az
         utolsó fájlját;
       - az ARCHIVÁLT bejegyzés (archivedAtV133) jelölése megmarad, akkor is,
         ha a másik oldal régi példánya még nem tud róla. */
  const reportKeyV133 = report => String(report?.id || report?.at || JSON.stringify(report));
  function mergeReportsV133(a, b) {
    const deleted = new Set([...(a?.deliveryReportsDeletedV133 || []), ...(b?.deliveryReportsDeletedV133 || [])].map(String));
    const reports = new Map();
    for (const report of [...(a?.deliveryReports || []), ...(b?.deliveryReports || [])]) {
      if (!report) continue;
      const key = reportKeyV133(report);
      if (deleted.has(key)) continue;
      const previous = reports.get(key);
      if (!previous) { reports.set(key, report); continue; }
      const combined = { ...previous, ...report };
      const archivedAt = report.archivedAtV133 || previous.archivedAtV133;
      if (archivedAt) combined.archivedAtV133 = archivedAt;
      reports.set(key, combined);
    }
    return {
      reports: [...reports.values()].sort((x, y) => String(x.at || '').localeCompare(String(y.at || ''))),
      deleted: [...deleted],
      had: !!((a?.deliveryReports || []).length || (b?.deliveryReports || []).length || deleted.size)
    };
  }
  function applyReportsV133(target, result) {
    if (!target || !result || !result.had) return target;
    target.deliveryReports = result.reports;
    if (result.deleted.length) target.deliveryReportsDeletedV133 = result.deleted;
    return target;
  }

  function mergeAdminDriverFieldsV131(order, remote) {
    if (!order || !remote) return order;
    const merged = { ...order };

    applyReportsV133(merged, mergeReportsV133(remote, order));

    const itemKey = (item, index) => String(item?._id || item?.code || `${item?.name || item?.description || ''}#${index}`);
    if (Array.isArray(order.items) && Array.isArray(remote.items)) {
      const remoteItems = new Map(remote.items.map((item, index) => [itemKey(item, index), item]));
      merged.items = order.items.map((item, index) => {
        const previous = remoteItems.get(itemKey(item, index));
        if (!previous) return item;
        const nonempty = value => String(value ?? '').trim() !== '';
        return {
          ...item,
          received: !!(item.received || previous.received),
          missingQty: nonempty(item.missingQty) ? item.missingQty : previous.missingQty,
          note: nonempty(item.note) ? item.note : previous.note,
          itemNote: nonempty(item.itemNote) ? item.itemNote : previous.itemNote,
          itemNoteAuthorRole: item.itemNoteAuthorRole || previous.itemNoteAuthorRole,
          itemNoteUpdatedByRole: item.itemNoteUpdatedByRole || previous.itemNoteUpdatedByRole,
          itemNoteUpdatedAt: item.itemNoteUpdatedAt || previous.itemNoteUpdatedAt,
          itemNoteCommentAt: item.itemNoteCommentAt || previous.itemNoteCommentAt
        };
      });
    }

    /* V132: a teljesítés és a visszavonás időbélyeg szerint dől el. Egy régi
       admin-példány pipa nélküli állapota nem esemény, ezért nem írhatja
       felül a sofőr pipáját; a sofőr TUDATOS visszavonása viszont érvényes. */
    applyCompletionV132(merged, completionStateV132(remote, order));

    const driverNotes = [remote, order].filter(value => String(value.driverNoteV111 || '').trim());
    if (driverNotes.length) {
      driverNotes.sort((a, b) => String(b.driverNoteAtV111 || '').localeCompare(String(a.driverNoteAtV111 || '')));
      const newest = driverNotes[0];
      merged.driverNoteV111 = newest.driverNoteV111;
      merged.driverNoteAtV111 = newest.driverNoteAtV111;
      merged.driverNoteByV111 = newest.driverNoteByV111;
    }

    const deleted = new Set([...(remote.threadDeletedV115 || []), ...(order.threadDeletedV115 || [])].map(String));
    const messages = new Map();
    for (const message of [...(remote.threadV115 || []), ...(order.threadV115 || [])]) {
      if (!message?.id || deleted.has(String(message.id))) continue;
      messages.set(String(message.id), message);
    }
    if (messages.size || deleted.size) {
      merged.threadV115 = [...messages.values()].sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
      if (deleted.size) merged.threadDeletedV115 = [...deleted];
    }
    return merged;
  }

  async function mergeFreshAdminDriverFieldsV131(orders) {
    const list = Array.isArray(orders) ? orders : [];
    const ids = [...new Set(list.map(order => String(order?.id || '')).filter(Boolean))];
    if (!ids.length) return list;
    const remoteById = new Map();
    for (let start = 0; start < ids.length; start += 50) {
      const chunk = ids.slice(start, start + 50);
      const values = chunk.map(id => `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
      const rows = await dbRequest(`orders?${qs({ select: 'id,payload,updated_at', id: `in.(${values})` })}`);
      for (const row of rows || []) remoteById.set(String(row.id), row);
    }
    return list.map(order => {
      const row = remoteById.get(String(order.id));
      if (!row) return order;
      const merged = mergeAdminDriverFieldsV131(order, row.payload || {});
      Object.assign(order, merged, { onlineUpdatedAt: row.updated_at });
      return order;
    });
  }

  async function fetchOrders() {
    const rows = await dbRequest(`orders?${qs({ select: 'id,schedule_date,vehicle_id,driver_key,order_no,project_name,sequence,payload,updated_at', order: 'schedule_date.asc,sequence.asc' })}`);
    remoteLoaded = true;
    return (rows || []).map(rowToOrder);
  }

  async function fetchBacklog() {
    const rows = await dbRequest(`backlog_entries?${qs({ select: 'id,source_order_id,target_order_id,moved_to_date,payload,updated_at', order: 'moved_to_date.asc,updated_at.asc' })}`);
    return (rows || []).map(row => ({ ...(row.payload || {}), id: row.id, sourceOrderId: row.source_order_id || row.payload?.sourceOrderId, targetOrderId: row.target_order_id || row.payload?.targetOrderId, movedToDate: row.moved_to_date || row.payload?.movedToDate }));
  }

  async function syncBacklog(entries, currentProfile = profile) {
    const list = (entries || []).map(entry => ({ ...entry, id: String(entry.id) }));
    if (currentProfile?.role === 'admin') {
      const rows = list.map(entry => ({ id: entry.id, source_order_id: entry.sourceOrderId || null, target_order_id: entry.targetOrderId || null, moved_to_date: entry.movedToDate || null, payload: entry, updated_at: new Date().toISOString() }));
      if (rows.length) await dbRequest('backlog_entries?on_conflict=id', { method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      const remote = await dbRequest('backlog_entries?select=id');
      const ids = new Set(rows.map(row => row.id));
      for (const row of remote || []) if (!ids.has(row.id)) await dbRequest(`backlog_entries?id=eq.${encodeURIComponent(row.id)}`, { method: 'DELETE' });
    } else {
      await dbRequest('rpc/sync_own_backlog', { method: 'POST', body: { p_entries: list } });
    }
  }

  async function upsertAdminOrders(orders) {
    const latestOrders = await mergeFreshAdminDriverFieldsV131(orders || []);
    const rows = latestOrders.map(orderToRow);
    if (rows.length) {
      await dbRequest('orders?on_conflict=id', {
        method: 'POST', body: rows,
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
      });
    }
    if (remoteLoaded) {
      const remote = await dbRequest('orders?select=id');
      const localIds = new Set(rows.map(row => row.id));
      const removeIds = (remote || []).map(row => row.id).filter(id => !localIds.has(id));
      for (let i = 0; i < removeIds.length; i += 50) {
        const chunk = removeIds.slice(i, i + 50).map(id => `"${String(id).replace(/"/g, '\\"')}"`).join(',');
        if (chunk) await dbRequest(`orders?id=in.(${encodeURIComponent(chunk)})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      }
    }
  }

  async function updateOwnOrder(order) {
    const payload = { ...order };
    /* A sofőri felület completedAtV111 mezőt használ, a szerveroldali
       restricted_payload_update viszont a régi completedAt nevet menti. */
    if (typeof payload.completed === 'boolean') {
      payload.completedAt = payload.completed
        ? (payload.completedAtV111 || payload.completedAt || '')
        : '';
    }
    return dbRequest('rpc/update_own_order_payload', { method: 'POST', body: { p_order_id: String(order.id), p_payload: payload } });
  }

  /* V116: szűk célú út CSAK az üzenetszálra. Akkor hasznos, ha a teljes
     fuvart író eljárás szűri a mezőket – ilyenkor az üzenet így is feljut.
     A SUPABASE_UZENETEK.sql fájl tartalmazza a létrehozását. */
  async function syncOrderThread(order) {
    return dbRequest('rpc/sync_order_thread', {
      method: 'POST',
      body: {
        p_order_id: String(order.id),
        p_thread: order.threadV115 || [],
        p_deleted: order.threadDeletedV115 || []
      }
    });
  }

  async function syncOrders(orders, currentProfile = profile) {
    if (!currentProfile) currentProfile = await fetchProfile();
    emit('syncing', 'Fuvarok mentése…');
    if (currentProfile.role === 'admin') await upsertAdminOrders(orders || []);
    else await dbRequest('rpc/sync_own_orders', { method: 'POST', body: { p_orders: orders || [] } });
    await syncBacklog(global.state?.backlog || [], currentProfile);
    emit('online', 'Fuvarok és hátralékok szinkronizálva.');
  }

  /* V129 – egyetlen nap műveletének mentése.
     A teljes syncOrders adminnál hiányzó rekordokat is törölhet, sofőrnél
     pedig minden látható fuvar payloadját újraküldi. Szétosztás és
     optimalizálás ezért csak a megnyitott nap fuvarait küldi fel, és nem
     szinkronizálja vagy törli a többi napot, illetve a hátraléklistát. */
  async function syncOrdersForDate(date, orders, currentProfile = profile) {
    const targetDate = String(date || '').trim();
    if (!targetDate) throw new Error('A napi mentéshez hiányzik a dátum.');
    if (!currentProfile) currentProfile = await fetchProfile();
    const submitted = Array.isArray(orders) ? orders : [];
    const scoped = submitted.filter(order => String(order?.scheduleDate || '') === targetDate);
    if (scoped.length !== submitted.length) {
      throw new Error('A napi mentés más dátumú fuvart is tartalmazna; a műveletet megszakítottam.');
    }
    emit('syncing', `${targetDate} fuvarjainak mentése…`);
    if (currentProfile.role === 'admin') {
      const latestOrders = await mergeFreshAdminDriverFieldsV131(scoped);
      const rows = latestOrders.map(orderToRow);
      if (rows.length) await dbRequest('orders?on_conflict=id', {
        method: 'POST', body: rows,
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
      });
    } else if (scoped.length) {
      await dbRequest('rpc/sync_own_orders', { method: 'POST', body: { p_orders: scoped } });
    }
    emit('online', `${targetDate} fuvarjai szinkronizálva.`);
    return { date: targetDate, count: scoped.length };
  }

  /* ===== V132 – CSAK A TÉNYLEGESEN MÓDOSÍTOTT FUVAROK MENNEK FEL ========

     A régi syncOrders minden mentéskor a TELJES fuvarlistát küldte, a
     helyben lévő (akár egy perce frissített, régi) példánnyal. Ha közben a
     másik fél módosított valamit, azt ez felülírta: így tűnt el a sofőr
     pipája és a szállítólevél jelölése. Adminnál ráadásul minden olyan
     szerverfuvart törölt, ami a saját listájában nem szerepelt – a sofőr
     által közben létrehozottakat is.

     Most a hívó megmondja, melyik fuvar változott és melyiket törölték
     TÉNYLEGESEN. Csak ezek mennek fel, más rekordhoz nem nyúlunk. */
  async function deleteOrdersByIdV132(ids) {
    const list = [...new Set((ids || []).map(String).filter(Boolean))];
    for (let i = 0; i < list.length; i += 50) {
      const chunk = list.slice(i, i + 50).map(id => `"${String(id).replace(/"/g, '\\"')}"`).join(',');
      if (chunk) await dbRequest(`orders?id=in.(${encodeURIComponent(chunk)})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    }
  }

  async function syncChangedOrdersV132({ orders = [], deletedIds = [], backlogChanged = [], backlogDeletedIds = [], backlogAll = null } = {}, currentProfile = profile) {
    if (!currentProfile) currentProfile = await fetchProfile();
    const changed = Array.isArray(orders) ? orders : [];
    emit('syncing', 'Változások mentése…');
    if (currentProfile.role === 'admin') {
      if (changed.length) {
        const latest = await mergeFreshAdminDriverFieldsV131(changed);
        const rows = latest.map(orderToRow);
        await dbRequest('orders?on_conflict=id', { method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      }
      if (deletedIds.length) await deleteOrdersByIdV132(deletedIds);
      const backlogRows = (backlogChanged || []).map(entry => ({ id: String(entry.id), source_order_id: entry.sourceOrderId || null, target_order_id: entry.targetOrderId || null, moved_to_date: entry.movedToDate || null, payload: { ...entry, id: String(entry.id) }, updated_at: new Date().toISOString() }));
      if (backlogRows.length) await dbRequest('backlog_entries?on_conflict=id', { method: 'POST', body: backlogRows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      for (const id of backlogDeletedIds || []) await dbRequest(`backlog_entries?id=eq.${encodeURIComponent(String(id))}`, { method: 'DELETE' });
    } else {
      if (changed.length) await dbRequest('rpc/sync_own_orders', { method: 'POST', body: { p_orders: changed } });
      if (backlogAll) await dbRequest('rpc/sync_own_backlog', { method: 'POST', body: { p_entries: backlogAll.map(entry => ({ ...entry, id: String(entry.id) })) } });
    }
    emit('online', 'Változások mentve.');
    return { orders: changed.length, deleted: deletedIds.length };
  }

  /* V132: adminnál a háttérfrissítés nem tölti le a teljes archívumot,
     csak a megadott naptól kezdve. */
  async function fetchOrdersSinceV132(fromDate) {
    const params = { select: 'id,schedule_date,vehicle_id,driver_key,order_no,project_name,sequence,payload,updated_at', order: 'schedule_date.asc,sequence.asc' };
    if (fromDate) params.schedule_date = `gte.${fromDate}`;
    const rows = await dbRequest(`orders?${qs(params)}`);
    return (rows || []).map(rowToOrder);
  }

  async function fetchOrderPayloadsV132(ids) {
    const list = [...new Set((ids || []).map(String).filter(Boolean))];
    const result = new Map();
    for (let start = 0; start < list.length; start += 50) {
      const values = list.slice(start, start + 50).map(id => `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
      const rows = await dbRequest(`orders?${qs({ select: 'id,payload,updated_at', id: `in.(${values})` })}`);
      for (const row of rows || []) result.set(String(row.id), row.payload || {});
    }
    return result;
  }

  /* V132: a sofőri mezők (teljesítés, szállítólevél-jelölés) szűk célú,
     atomi írása. A SUPABASE_SOFOR_MEZOK_V133.sql hozza létre. Ha nincs
     létrehozva, false-t ad, és a hívó a régi úton marad. */
  function missingFunctionV132(error) {
    return /set_driver_fields_v132|PGRST202|could not find the function|does not exist|schema cache/i.test(String(error?.message || error || ''))
      || error?.status === 404;
  }
  let driverFieldsMissingV132 = false;
  async function setDriverFieldsV132(order) {
    if (!order?.id || driverFieldsMissingV132) return false;
    const fields = {
      completed: !!order.completed,
      completedAt: order.completed ? (order.completedAtV111 || order.completedAt || '') : '',
      completedAtV111: order.completed ? (order.completedAtV111 || order.completedAt || '') : '',
      completedUndoneAtV132: order.completedUndoneAtV132 || '',
      deliveryReports: Array.isArray(order.deliveryReports) ? order.deliveryReports : [],
      deliveryReportsDeletedV133: Array.isArray(order.deliveryReportsDeletedV133) ? order.deliveryReportsDeletedV133 : []
    };
    try {
      await dbRequest('rpc/set_driver_fields_v132', { method: 'POST', body: { p_order_id: String(order.id), p_fields: fields } });
      return true;
    } catch (error) {
      if (missingFunctionV132(error)) { driverFieldsMissingV132 = true; console.warn('[V132] a set_driver_fields_v132 függvény nincs létrehozva (SUPABASE_SOFOR_MEZOK_V133.sql)'); return false; }
      throw error;
    }
  }

  /* V132 – SZÁLLÍTÓLEVÉL-SZÁM A FÁJLTÁBLÁBÓL

     A Mentett fotók gomb eddig csak a fuvar payloadjában tárolt jelölést
     nézte, a galéria viszont a delivery_report_files táblát. Ha a jelölés
     elveszett, a kép megvolt, a gomb mégis szürke maradt. Most a gomb a
     fájltáblából is kap számot – az Outlook-forrásmellékletek nélkül. */
  async function fetchDeliveryFileCountsV132() {
    const files = [];
    for (let offset = 0; offset < 200000; offset += 1000) {
      const page = await dbRequest(`delivery_report_files?${qs({ select: 'order_id,report_id', order: 'id.asc', limit: '1000', offset: String(offset) })}`);
      files.push(...(page || []));
      if (!page || page.length < 1000) break;
    }
    let sourceReports = new Set();
    try {
      const rows = await dbRequest(`delivery_reports?${qs({ select: 'id', note: 'ilike.*outlook*forr*' })}`);
      sourceReports = new Set((rows || []).map(row => String(row.id)));
    } catch (error) { console.warn('[V132] a forrásmellékletek azonosítása nem sikerült', error); }
    const counts = new Map();
    for (const file of files) {
      if (sourceReports.has(String(file.report_id))) continue;
      const id = String(file.order_id || '');
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }

  /* V133: a jelentések megjegyzése – ebből derül ki, hogy sofőri
     szállítólevél vagy Outlook-forrásmelléklet. */
  async function fetchReportNotesV133(ids) {
    const list = [...new Set((ids || []).map(String).filter(Boolean))];
    const result = new Map();
    for (let start = 0; start < list.length; start += 100) {
      const rows = await dbRequest(`delivery_reports?${qs({ select: 'id,note,created_at', id: `in.(${list.slice(start, start + 100).join(',')})` })}`);
      for (const row of rows || []) result.set(String(row.id), row);
    }
    return result;
  }

  /* V134: a sofőri felület a saját fuvarjaira kérdezi le a fájlszámot,
     ugyanazzal a szabállyal, mint az admin (Outlook-forrás nélkül). */
  async function fetchDeliveryFileCountsForOrdersV134(orderIds, knownSourceReportIds = []) {
    const ids = [...new Set((orderIds || []).map(String).filter(Boolean))];
    const files = [];
    for (let start = 0; start < ids.length; start += 100) {
      const values = ids.slice(start, start + 100).map(id => `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
      const rows = await dbRequest(`delivery_report_files?${qs({ select: 'order_id,report_id', order_id: `in.(${values})` })}`);
      files.push(...(rows || []));
    }
    const counts = new Map(ids.map(id => [id, 0]));
    let sourceReports = new Set();
    const known = new Set((knownSourceReportIds || []).map(String));
    const reportIds = [...new Set(files.map(file => String(file.report_id || '')).filter(Boolean))];
    if (reportIds.length) {
      try {
        const notes = await fetchReportNotesV133(reportIds);
        sourceReports = new Set([...notes.values()].filter(row => /outlook\s*forr/i.test(String(row.note || ''))).map(row => String(row.id)));
      } catch (error) { console.warn('[V134] a forrásmellékletek azonosítása nem sikerült', error); }
    }
    for (const file of files) {
      if (sourceReports.has(String(file.report_id)) || known.has(String(file.report_id))) continue;
      const id = String(file.order_id || '');
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }

  /* V135: mely fuvaroknak van a szerveren levélmelléklete (legalább egy
     fájl egy „Outlook forrás” bejegyzésben). */
  async function fetchSourceMailCoverageV135() {
    const sourceReports = new Set();
    for (let offset = 0; offset < 200000; offset += 1000) {
      const page = await dbRequest(`delivery_reports?${qs({ select: 'id', note: 'ilike.*outlook*forr*', order: 'id.asc', limit: '1000', offset: String(offset) })}`);
      for (const row of page || []) sourceReports.add(String(row.id));
      if (!page || page.length < 1000) break;
    }
    const covered = new Set();
    for (let offset = 0; offset < 200000; offset += 1000) {
      const page = await dbRequest(`delivery_report_files?${qs({ select: 'order_id,report_id', order: 'id.asc', limit: '1000', offset: String(offset) })}`);
      for (const file of page || []) if (sourceReports.has(String(file.report_id))) covered.add(String(file.order_id));
      if (!page || page.length < 1000) break;
    }
    return covered;
  }

  /* ===== V138 – CSEVEGŐ =================================================
     Gyors üzenetek a sofőrökkel. A beszélgetés azonosítója a sofőr belépési
     e-mail-címe (kisbetűvel), a csoportos üzeneteké „__all__”. Hogy ki mit
     láthat és írhat, azt a SUPABASE_CSEVEGO_V138.sql szabályai döntik el. */
  const CHAT_BUCKET_V138 = 'chat-files';
  function chatMyEmailV138() {
    return normalize(profile?.email || session?.user?.email || '');
  }
  async function chatFetchV138({ since = '', days = 30 } = {}) {
    const params = { select: '*', limit: '1000' };
    if (since) { params.updated_at = `gt.${since}`; params.order = 'updated_at.asc'; }
    else { params.created_at = `gte.${new Date(Date.now() - days * 86400000).toISOString()}`; params.order = 'created_at.asc'; }
    return (await dbRequest(`chat_messages?${qs(params)}`)) || [];
  }
  async function chatSendV138({ conversation, body = '', attachments = [], senderName = '' }) {
    const rows = await dbRequest('chat_messages?select=*', {
      method: 'POST',
      body: { conversation: normalize(conversation), body: String(body || ''), attachments, sender_name: senderName || null, sender_email: chatMyEmailV138() },
      headers: { Prefer: 'return=representation' }
    });
    if (!rows?.[0]) throw new Error('Az üzenet nem mentődött el.');
    return rows[0];
  }
  async function chatUpdateV138(id, patch) {
    const rows = await dbRequest(`chat_messages?${qs({ id: `eq.${id}`, select: '*' })}`, {
      method: 'PATCH', body: patch, headers: { Prefer: 'return=representation' }
    });
    if (!rows?.[0]) throw new Error('Az üzenet nem módosítható (csak a saját üzeneted szerkesztheted).');
    return rows[0];
  }
  async function chatReadsV138() {
    return (await dbRequest(`chat_reads?${qs({ select: 'conversation,reader_email,last_read_at' })}`)) || [];
  }
  async function chatMarkReadV138(conversation) {
    const row = { conversation: normalize(conversation), reader_email: chatMyEmailV138(), last_read_at: new Date().toISOString() };
    await dbRequest('chat_reads?on_conflict=conversation,reader_email', {
      method: 'POST', body: [row], headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
    });
    return row;
  }
  async function chatUploadV138(conversation, file) {
    const id = (global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const path = `${normalize(conversation)}/${id}/${safeName(file.name || 'fajl')}`;
    const type = mimeForFileV136(file);
    await rawRequest(`${baseUrl()}/storage/v1/object/${CHAT_BUCKET_V138}/${pathEncode(path)}`, {
      method: 'POST', body: file, headers: { 'Content-Type': type, 'x-upsert': 'false' }
    });
    return { path, name: file.name || 'fájl', type, size: +file.size || 0 };
  }
  async function chatSignV138(path) {
    const signed = await rawRequest(`${baseUrl()}/storage/v1/object/sign/${CHAT_BUCKET_V138}/${pathEncode(path)}`, { method: 'POST', body: { expiresIn: 3600 } });
    const p = signed?.signedURL || signed?.signedUrl || '';
    if (!p) return '';
    return /^https?:/i.test(p) ? p : p.startsWith('/storage/v1') ? `${baseUrl()}${p}` : `${baseUrl()}/storage/v1${p.startsWith('/') ? '' : '/'}${p}`;
  }

  async function loadOrdersIntoState({ preserveLocalIfRemoteEmpty = false } = {}) {
    emit('syncing', 'Fuvarok betöltése…');
    const [orders, backlog] = await Promise.all([fetchOrders(), fetchBacklog()]);
    if (!global.state) throw new Error('Az alkalmazás állapota még nem érhető el.');
    if (!(preserveLocalIfRemoteEmpty && !orders.length && (global.state.orders || []).length)) global.state.orders = orders;
    global.state.backlog = backlog;
    remoteLoaded = true;
    if (typeof global.save === 'function') global.save(false);
    if (typeof global.render === 'function') global.render();
    emit('online', `${orders.length} online fuvar betöltve.`);
    return orders;
  }

  async function requestTransfer(orderId, toDriverKey, note = '') {
    const result = await dbRequest('rpc/request_transfer', { method: 'POST', body: { p_order_id: String(orderId), p_to_driver_key: toDriverKey, p_note: note || '' } });
    emit('online', 'Fuvarátadási kérés elküldve.');
    return result;
  }
  async function acceptTransfer(requestId) {
    const result = await dbRequest('rpc/accept_transfer', { method: 'POST', body: { p_request_id: requestId } });
    emit('online', 'Fuvarátadás elfogadva.');
    return result;
  }
  async function rejectTransfer(requestId) {
    const result = await dbRequest('rpc/reject_transfer', { method: 'POST', body: { p_request_id: requestId } });
    emit('online', 'Fuvarátadás elutasítva.');
    return result;
  }
  async function cancelTransfer(requestId) {
    return dbRequest('rpc/cancel_transfer', { method: 'POST', body: { p_request_id: requestId } });
  }
  async function listTransfers() {
    return dbRequest(`transfer_requests?${qs({ select: 'id,order_id,order_no,project_name,schedule_date,from_driver_key,to_driver_key,status,requested_by,created_at,responded_at,response_by,note', order: 'created_at.desc' })}`);
  }

  /* ===== V136 – A FÁJL PONTOS TÍPUSSAL MEGY FEL ======================

     A tároló (delivery-docs) csak megadott fájltípusokat enged. A levélből
     érkező .msg, Word, Excel melléklet eddig „application/octet-stream”
     típussal ment, ezt a tároló elutasította. A típust most a kiterjesztésből
     is meghatározzuk, ha a böngésző nem adott pontosat. */
  const MIME_BY_EXT_V136 = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    heic: 'image/heic', heif: 'image/heif', msg: 'application/vnd.ms-outlook', eml: 'message/rfc822',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', txt: 'text/plain',
    webm: 'audio/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg'
  };
  function mimeForFileV136(file) {
    const given = String(file?.type || '').toLowerCase();
    if (given && given !== 'application/octet-stream') return given;
    const ext = String(file?.name || '').toLowerCase().split('.').pop();
    return MIME_BY_EXT_V136[ext] || given || 'application/octet-stream';
  }

  /* V136 – EGY ELUTASÍTOTT FÁJL NE VIGYE EL A TÖBBIT

     Eddig minden fájlt feltöltöttünk, és csak a végén írtuk be a
     nyilvántartó sorokat. Ha egyetlen fájlt elutasított a tároló, a művelet
     hibára futott, és a már feltöltött fájlok sem kerültek nyilvántartásba –
     a sofőr semmit nem látott. Most fájlonként haladunk: ami felment, az
     bekerül; ami nem, azt név szerint visszaadjuk (skipped). Ha egy sem
     ment fel, a bejegyzést eltakarítjuk, és hibát adunk. */
  async function createDeliveryReport(order, files, note = '', audio = null) {
    if (!order?.id) throw new Error('Hiányzó fuvarazonosító.');
    const reports = await dbRequest('delivery_reports?select=*', {
      method: 'POST',
      body: {
        order_id: String(order.id),
        order_no: order.orderNo || '',
        project_name: order.projectName || '',
        note: note || ''
      },
      headers: { Prefer: 'return=representation' }
    });
    const report = reports?.[0];
    if (!report?.id) throw new Error('A szállítólevél-bejegyzés nem jött létre.');
    const uploadFiles = [...(files || [])];
    if (audio) uploadFiles.push(new File([audio], 'hangjegyzet.webm', { type: audio.type || 'audio/webm' }));
    const fileRows = [];
    const uploadedPaths = [];
    const skipped = [];
    for (let index = 0; index < uploadFiles.length; index++) {
      const file = uploadFiles[index];
      const mime = mimeForFileV136(file);
      const filename = `${String(index + 1).padStart(2, '0')}-${safeName(file.name || `foto-${index + 1}.jpg`)}`;
      const storagePath = `${String(order.id)}/${report.id}/${filename}`;
      try {
        await rawRequest(`${baseUrl()}/storage/v1/object/delivery-docs/${pathEncode(storagePath)}`, {
          method: 'POST', body: file,
          headers: { 'Content-Type': mime, 'x-upsert': 'false' }
        });
      } catch (error) {
        skipped.push({ name: file.name || filename, error: String(error?.message || error) });
        continue;
      }
      uploadedPaths.push(storagePath);
      fileRows.push({ report_id: report.id, order_id: String(order.id), storage_path: storagePath, file_name: file.name || filename, mime_type: mime, file_size: +file.size || 0 });
    }
    if (!fileRows.length && uploadFiles.length) {
      try { await dbRequest(`delivery_reports?${qs({ id: `eq.${report.id}` })}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); }
      catch (error) { console.warn('[V136] az üres bejegyzés törlése', error); }
      throw new Error(`Egyik fájlt sem fogadta el a tároló: ${skipped.map(item => `${item.name} (${item.error})`).join('; ')}`);
    }
    if (fileRows.length) {
      try {
        await dbRequest('delivery_report_files', { method: 'POST', body: fileRows, headers: { Prefer: 'return=minimal' } });
      } catch (error) {
        /* A nyilvántartás nélkül maradt fájlokat ne hagyjuk a tárhelyen. */
        await removeStoragePathsV136(uploadedPaths).catch(() => {});
        try { await dbRequest(`delivery_reports?${qs({ id: `eq.${report.id}` })}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); } catch (_) {}
        throw error;
      }
    }
    return { report: { ...report, fileCount: fileRows.length }, files: fileRows, skipped };
  }

  /* V136: több fájl törlése a tárolóból egy kéréssel. */
  async function removeStoragePathsV136(paths) {
    const list = (paths || []).filter(Boolean);
    if (!list.length) return 0;
    await rawRequest(`${baseUrl()}/storage/v1/object/delivery-docs`, { method: 'DELETE', body: { prefixes: list } });
    return list.length;
  }

  /* V136: a sikertelen próbálkozások maradványai – nyilvántartás nélküli
     „Outlook forrás” bejegyzések (10 percnél régebbiek) és a fájljaik. */
  async function cleanupEmptySourceReportsV136(onProgress) {
    const reports = [];
    for (let offset = 0; offset < 200000; offset += 1000) {
      const page = await dbRequest(`delivery_reports?${qs({ select: 'id,order_id,created_at', note: 'ilike.*outlook*forr*', order: 'id.asc', limit: '1000', offset: String(offset) })}`);
      reports.push(...(page || []));
      if (!page || page.length < 1000) break;
    }
    const withFiles = new Set();
    for (let offset = 0; offset < 200000; offset += 1000) {
      const page = await dbRequest(`delivery_report_files?${qs({ select: 'report_id', order: 'id.asc', limit: '1000', offset: String(offset) })}`);
      for (const row of page || []) withFiles.add(String(row.report_id));
      if (!page || page.length < 1000) break;
    }
    const limit = Date.now() - 10 * 60 * 1000;
    const empty = reports.filter(report => !withFiles.has(String(report.id)) && (Date.parse(report.created_at) || 0) < limit);
    let reportsRemoved = 0, filesRemoved = 0, failed = 0;
    for (const report of empty) {
      try {
        /* A Supabase listázó a mappát perjel nélkül várja (mint a
           supabase-js list('mappa') hívása), és a neveket ahhoz képest adja. */
        const prefix = `${String(report.order_id)}/${String(report.id)}`;
        const listed = await rawRequest(`${baseUrl()}/storage/v1/object/list/delivery-docs`, { method: 'POST', body: { prefix, limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } } });
        const paths = (Array.isArray(listed) ? listed : []).filter(item => item?.name && item.id !== null).map(item => `${prefix}/${item.name}`);
        if (paths.length) filesRemoved += await removeStoragePathsV136(paths);
        await dbRequest(`delivery_reports?${qs({ id: `eq.${report.id}` })}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        reportsRemoved++;
      } catch (error) {
        failed++;
        console.warn('[V136] maradvány törlése', report.id, error);
      }
      onProgress?.({ done: reportsRemoved + failed, total: empty.length });
    }
    return { reportsRemoved, filesRemoved, failed, total: empty.length };
  }


  /* V107 – A RÉGI FUVAR MELLÉKLETEINEK ÁTKÖTÉSE

     Az import a meglévő fuvart törli, és ÚJ azonosítóval hozza létre. A
     korábban feltöltött fájlok viszont a régi azonosítóhoz tartoznak, ezért
     az új fuvarnál nem jelentek meg.

     Ez a művelet csak az adatbázis-hivatkozást írja át; magukat a fájlokat
     nem mozgatja, tehát gyors és visszafordítható. */
  async function relinkDeliveryFiles(oldOrderId, newOrderId) {
    const regi = String(oldOrderId || '').trim(), uj = String(newOrderId || '').trim();
    if (!regi || !uj || regi === uj) return { moved: 0, reports: 0 };
    /* V137: a bejegyzések (delivery_reports) is átkerülnek, nem csak a
       fájlsorok. A szerver a fuvar törlésekor mindkettőt magával vinné
       (ON DELETE CASCADE), ezért ennek a régi fuvar törlése ELŐTT kell
       megtörténnie. */
    const files = await dbRequest(`delivery_report_files?${qs({ order_id: `eq.${regi}`, select: 'id' })}`, {
      method: 'PATCH', body: { order_id: uj }, headers: { Prefer: 'return=representation' }
    });
    const reports = await dbRequest(`delivery_reports?${qs({ order_id: `eq.${regi}`, select: 'id' })}`, {
      method: 'PATCH', body: { order_id: uj }, headers: { Prefer: 'return=representation' }
    });
    return { moved: Array.isArray(files) ? files.length : 0, reports: Array.isArray(reports) ? reports.length : 0 };
  }


  /* ===== V119 – A FÁJL TÖRLÉSE A TÁROLÓBÓL IS ========================

     Eddig csak a listából lehetett eltüntetni egy képet, a fájl viszont
     ottmaradt a tárhelyen. Archiválás után ez fölöslegesen foglal helyet.

     A törlés KÉT helyen történik: a tárolóból maga a fájl, az adatbázisból
     a hozzá tartozó sor. Ha csak az egyik sikerülne, árva fájl vagy törött
     hivatkozás maradna, ezért a sorrend: előbb a fájl, utána a sor – így ha
     a tárolóból nem sikerül, a sor is marad, és újra próbálható. */
  /* ===== V119 – A KÉP TÖRLÉSE A TÁRHELYRŐL IS ========================

     Eddig nem volt mód törölni: a feltöltött szállítólevél a tárolóban
     maradt, akkor is, ha már nem kellett. Archiválás után ez fölösleges
     helyfoglalás.

     A törlés KÉT helyről szed le: magát a fájlt a tárolóból, és a hozzá
     tartozó sort az adatbázisból. Ha csak az egyiket tennénk, vagy árva
     fájl maradna a tárhelyen, vagy törött hivatkozás a listában. */
  async function deleteDeliveryFile(fileRow) {
    const azonosito = fileRow?.id, ut = fileRow?.storage_path;
    if (!azonosito || !ut) throw new Error('Hiányzó fájladat a törléshez.');

    // 1. a fájl a tárolóból
    try {
      await rawRequest(`${baseUrl()}/storage/v1/object/delivery-docs/${pathEncode(ut)}`, { method: 'DELETE' });
    } catch (error) {
      /* Ha a fájl már nincs ott, a sort akkor is takarítsuk el. */
      if (!/not.?found|404/i.test(String(error?.message || ''))) throw error;
      console.warn('[V119] a fájl már nem volt a tárolóban', ut);
    }

    // 2. a nyilvántartó sor
    /* V134: a jogosultsági szabály csendben 0 sort törölhet – ezt
       hibaként jelezzük, különben a felület törlést mutatna. */
    const toroltSorok = await dbRequest(`delivery_report_files?${qs({ id: `eq.${azonosito}`, select: 'id' })}`, {
      method: 'DELETE', headers: { Prefer: 'return=representation' }
    });
    if (Array.isArray(toroltSorok) && !toroltSorok.length) {
      throw new Error('A szerver nem engedte a törlést. Sofőrként csak a saját, MAI napi fuvar fájlja törölhető (hétvégén egyik sem). Ha hétköznap is ezt látod, az adminnak le kell futtatnia a SUPABASE_SOFOR_TORLES_V134.sql fájlt.');
    }
    return { deleted: true, path: ut, size: +fileRow.file_size || 0 };
  }

  /* Tömeges törléshez: egy fuvar vagy egy lista összes fájlja. Adagokban
     halad, hogy egy megszakadás ne vigyen mindent. */
  async function deleteDeliveryFiles(fileRows, onProgress) {
    const sorok = (fileRows || []).filter(row => row?.id && row?.storage_path);
    let kesz = 0, felszabadult = 0;
    const hibas = [];
    for (const sor of sorok) {
      try {
        const eredmeny = await deleteDeliveryFile(sor);
        kesz++; felszabadult += eredmeny.size;
      } catch (error) {
        hibas.push({ file: sor.file_name || sor.storage_path, message: error?.message || String(error) });
      }
      onProgress?.({ kesz, osszes: sorok.length, felszabadult, hibas: hibas.length });
    }
    return { kesz, osszes: sorok.length, felszabadult, hibas };
  }

  /* Minden feltöltött fájl, fuvarra bontva – az archiváláshoz és a
     tárhely-összesítéshez. */
  /* V144: az „Outlook forrás” (levélmelléklet) bejegyzések azonosítói –
     ezek NEM szállítólevelek, az archiválás nem nyúlhat hozzájuk. */
  async function fetchSourceReportIdsV144() {
    const ids = new Set();
    for (let offset = 0; offset < 200000; offset += 1000) {
      const page = await dbRequest(`delivery_reports?${qs({ select: 'id', note: 'ilike.*outlook*forr*', order: 'id.asc', limit: '1000', offset: String(offset) })}`);
      for (const row of page || []) ids.add(String(row.id));
      if (!page || page.length < 1000) break;
    }
    return ids;
  }

  async function listAllDeliveryFiles() {
    return dbRequest(`delivery_report_files?${qs({
      select: 'id,report_id,order_id,storage_path,file_name,mime_type,file_size,created_at',
      order: 'created_at.asc'
    })}`);
  }

  async function listDeliveryFiles(orderId) {
    const rows = await dbRequest(`delivery_report_files?${qs({ select: 'id,report_id,order_id,storage_path,file_name,mime_type,file_size,created_at', order_id: `eq.${String(orderId)}`, order: 'created_at.desc' })}`);
    const result = [];
    for (const row of rows || []) {
      /* V107 – EGY ROSSZ FÁJL NE VIGYE EL AZ EGÉSZ LISTÁT

         A hivatkozást fájlonként kell aláíratni a tárolóval. Ha EGY aláírás
         hibázott, a hiba kiszállt a ciklusból, és a hívó "a mellékletek nem
         tölthetők be" üzenetet kapott – az összes többi melléklet is eltűnt,
         pedig azok rendben voltak.

         Mostantól a hibás fájl url nélkül, de LÁTHATÓAN bekerül a listába, a
         többi pedig megnyitható marad. */
      let signedUrl = '';
      try {
      const signed = await rawRequest(`${baseUrl()}/storage/v1/object/sign/delivery-docs/${pathEncode(row.storage_path)}`, { method: 'POST', body: { expiresIn: 3600 } });
      const signedPath = signed?.signedURL || signed?.signedUrl || '';
      signedUrl = !signedPath ? '' : /^https?:/i.test(signedPath) ? signedPath : signedPath.startsWith('/storage/v1') ? `${baseUrl()}${signedPath}` : `${baseUrl()}/storage/v1${signedPath.startsWith('/') ? '' : '/'}${signedPath}`;
      } catch (error) {
        console.warn('[V107] a melléklet hivatkozása nem jött létre', row.file_name, error);
      }
      result.push({ ...row, url: signedUrl, urlError: !signedUrl });
    }
    /* V70: a fájl mellé odatesszük a jelentés megjegyzését. Ebből derül ki,
       hogy a sofőr által készített szállítólevél-fotóról van-e szó, vagy az
       Outlook-importból feltöltött forrásmellékletről – így a Mentett fotók
       és a Csatolmány nem keveredik. */
    try {
      const ids = [...new Set(result.map(row => row.report_id).filter(Boolean))];
      if (ids.length) {
        const reports = await dbRequest(`delivery_reports?${qs({ select: 'id,note', id: `in.(${ids.join(',')})` })}`);
        const noteById = new Map((reports || []).map(report => [String(report.id), String(report.note || '')]));
        for (const row of result) {
          row.report_note = noteById.get(String(row.report_id)) || '';
          /* V135: ha a jogosultsági szabály miatt a bejegyzés nem látszik, a
             válasz nem hiba, hanem üres – ez ISMERETLEN, nem „nem forrás”. */
          row.is_source_mail = noteById.has(String(row.report_id)) ? /outlook\s*forr[aá]s/i.test(row.report_note) : null;
        }
      }
    } catch (error) {
      /* V106: ha a megjegyzés-lekérdezés hibázik, EDDIG minden fájl
         "nem forrásmelléklet" lett – ezért tűnt el a Csatolmány tartalma.
         Most inkább ISMERETLEN marad, és a felület dönt a fájlnév alapján. */
      console.warn('[V70] A jelentés-megjegyzések nem tölthetők be', error);
      for (const row of result) { row.report_note = ''; row.is_source_mail = null; }
    }
    return result;
  }

  function startPolling(callback) {
    stopPolling();
    const interval = Math.max(5000, +config.pollIntervalMs || 15000);
    pollTimer = setInterval(async () => {
      if (document.hidden || !session?.access_token) return;
      try {
        const orders = await fetchOrders();
        await callback?.(orders);
        emit('online', 'Automatikus frissítés kész.');
      } catch (error) {
        emit('error', `Szinkronhiba: ${error.message}`);
      }
    }, interval);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  restoreSession();
  global.V44Online = {
    configured,
    getConfig: () => ({ ...config, anonKey: config.anonKey ? '***' : '' }),
    getSession: () => session,
    getProfile: () => profile,
    setStatusListener: listener => { statusListener = listener; },
    signInWithPassword, signOut, refreshSession, ensureSession, fetchProfile, listUsers,
    fetchOrders, fetchBacklog, syncOrders, syncOrdersForDate, syncBacklog, loadOrdersIntoState, fetchMasterData, syncMasterData, loadMasterIntoState, masterSnapshot, requestTransfer, acceptTransfer, rejectTransfer, cancelTransfer, listTransfers,
    createDeliveryReport, listDeliveryFiles, relinkDeliveryFiles,
    deleteDeliveryFile, deleteDeliveryFiles, listAllDeliveryFiles, updateOwnOrder, syncOrderThread,
    startPolling, stopPolling, driverKeyFromOrder, DRIVER_VEHICLES,
    /* V132 */
    syncChangedOrdersV132, fetchOrdersSinceV132, fetchOrderPayloadsV132, setDriverFieldsV132,
    fetchDeliveryFileCountsV132, completionStateV132, applyCompletionV132,
    mergeAdminDriverFieldsV131,
    /* V133 */
    mergeReportsV133, applyReportsV133, fetchReportNotesV133,
    /* V134 */
    fetchDeliveryFileCountsForOrdersV134,
    /* V135 */
    fetchSourceMailCoverageV135, fetchSourceReportIdsV144,
    /* V136 */
    mimeForFileV136, cleanupEmptySourceReportsV136, removeStoragePathsV136,
    /* V146 */
    isDefinitiveAuthErrorV146,
    /* V148 */
    fetchPlacementsV148, protectionInstalledV148, fetchHistoryV148,
    /* V147 */
    fetchVehiclesV147, pushConfigGetV147, pushConfigSetV147, pushSaveSubscriptionV147, pushSetMutedV147, pushDeleteSubscriptionV147, pushTestV147,
    /* V138 */
    chatMyEmailV138, chatFetchV138, chatSendV138, chatUpdateV138, chatReadsV138, chatMarkReadV138, chatUploadV138, chatSignV138
  };
})(typeof window !== 'undefined' ? window : globalThis);
