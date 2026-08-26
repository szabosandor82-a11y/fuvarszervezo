/* Fuvarszervező V50 – Supabase REST alapú online szinkron.
   Külső klienskönyvtár nélkül működik, a böngésző beépített fetch API-jával. */
(function (global) {
  'use strict';

  const config = global.FUVARSZERVEZO_ONLINE_CONFIG || {};
  const SESSION_KEY = 'fuvarszervezo_online_session_v44_2';
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
    const response = await fetch(url, { method, headers: requestHeaders, body: requestBody });
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

  async function refreshSession() {
    if (!session?.refresh_token) return null;
    try {
      const data = await authRequest('token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: session.refresh_token }
      });
      saveSession({ ...data, expires_at: nowSeconds() + (+data.expires_in || 3600) });
      return session;
    } catch (error) {
      saveSession(null); profile = null; throw error;
    }
  }
  async function ensureSession() {
    if (!session) restoreSession();
    if (!session?.access_token) throw new Error('Nincs aktív online munkamenet.');
    const expiresAt = +session.expires_at || 0;
    if (expiresAt && expiresAt < nowSeconds() + 90) await refreshSession();
    return session;
  }

  async function signIn(email, password) {
    emit('loading', 'Belépés…');
    const data = await authRequest('token?grant_type=password', { method: 'POST', body: { email: normalize(email), password } });
    saveSession({ ...data, expires_at: nowSeconds() + (+data.expires_in || 3600) });
    profile = await fetchProfile();
    emit('online', 'Online kapcsolat létrejött.');
    return { session, profile };
  }

  async function signOut() {
    try { if (session?.access_token) await authRequest('logout', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } }); }
    catch (_) {}
    stopPolling();
    saveSession(null); profile = null; remoteLoaded = false;
  }

  async function updatePassword(password) {
    await ensureSession();
    return rawRequest(`${baseUrl()}/auth/v1/user`, { method: 'PUT', body: { password } });
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

  async function fetchMasterData() {
    if (!profile) profile = await fetchProfile();
    if (profile?.role !== 'admin') return null;
    const rows = await dbRequest(`master_data?${qs({ select: 'payload,updated_at,updated_by', id: 'eq.current', limit: '1' })}`);
    return rows?.[0] ? { ...(rows[0].payload || {}), onlineUpdatedAt: rows[0].updated_at, onlineUpdatedBy: rows[0].updated_by } : null;
  }

  async function syncMasterData(source = global.state, currentProfile = profile) {
    if (!currentProfile) currentProfile = await fetchProfile();
    if (currentProfile?.role !== 'admin') return null;
    const payload = masterSnapshot(source);
    await dbRequest('master_data?on_conflict=id', {
      method: 'POST',
      body: [{ id: 'current', payload, updated_at: new Date().toISOString() }],
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
    });
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
      payload: order,
      updated_at: new Date().toISOString()
    };
  }
  function rowToOrder(row) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    return {
      ...payload,
      id: row.id,
      scheduleDate: row.schedule_date || payload.scheduleDate || '',
      vehicleId: row.vehicle_id || payload.vehicleId || '',
      orderNo: row.order_no || payload.orderNo || '',
      projectName: row.project_name || payload.projectName || '',
      sequence: row.sequence ?? payload.sequence ?? 999,
      onlineUpdatedAt: row.updated_at
    };
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
    const rows = (orders || []).map(orderToRow);
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
    return dbRequest('rpc/update_own_order_payload', { method: 'POST', body: { p_order_id: String(order.id), p_payload: order } });
  }

  async function syncOrders(orders, currentProfile = profile) {
    if (!currentProfile) currentProfile = await fetchProfile();
    emit('syncing', 'Fuvarok mentése…');
    if (currentProfile.role === 'admin') await upsertAdminOrders(orders || []);
    else await dbRequest('rpc/sync_own_orders', { method: 'POST', body: { p_orders: orders || [] } });
    await syncBacklog(global.state?.backlog || [], currentProfile);
    emit('online', 'Fuvarok és hátralékok szinkronizálva.');
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
    for (let index = 0; index < uploadFiles.length; index++) {
      const file = uploadFiles[index];
      const filename = `${String(index + 1).padStart(2, '0')}-${safeName(file.name || `foto-${index + 1}.jpg`)}`;
      const storagePath = `${String(order.id)}/${report.id}/${filename}`;
      await rawRequest(`${baseUrl()}/storage/v1/object/delivery-docs/${pathEncode(storagePath)}`, {
        method: 'POST', body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' }
      });
      fileRows.push({ report_id: report.id, order_id: String(order.id), storage_path: storagePath, file_name: file.name || filename, mime_type: file.type || 'application/octet-stream', file_size: +file.size || 0 });
    }
    if (fileRows.length) await dbRequest('delivery_report_files', { method: 'POST', body: fileRows, headers: { Prefer: 'return=minimal' } });
    return { report: { ...report, fileCount: fileRows.length }, files: fileRows };
  }

  async function listDeliveryFiles(orderId) {
    const rows = await dbRequest(`delivery_report_files?${qs({ select: 'id,report_id,order_id,storage_path,file_name,mime_type,file_size,created_at', order_id: `eq.${String(orderId)}`, order: 'created_at.desc' })}`);
    const result = [];
    for (const row of rows || []) {
      const signed = await rawRequest(`${baseUrl()}/storage/v1/object/sign/delivery-docs/${pathEncode(row.storage_path)}`, { method: 'POST', body: { expiresIn: 3600 } });
      const signedPath = signed?.signedURL || signed?.signedUrl || '';
      const signedUrl = !signedPath ? '' : /^https?:/i.test(signedPath) ? signedPath : signedPath.startsWith('/storage/v1') ? `${baseUrl()}${signedPath}` : `${baseUrl()}/storage/v1${signedPath.startsWith('/') ? '' : '/'}${signedPath}`;
      result.push({ ...row, url: signedUrl });
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
    signIn, signOut, updatePassword, refreshSession, ensureSession, fetchProfile, listUsers,
    fetchOrders, fetchBacklog, syncOrders, syncBacklog, loadOrdersIntoState, fetchMasterData, syncMasterData, loadMasterIntoState, masterSnapshot, requestTransfer, acceptTransfer, rejectTransfer, cancelTransfer, listTransfers,
    createDeliveryReport, listDeliveryFiles,
    startPolling, stopPolling, driverKeyFromOrder, DRIVER_VEHICLES
  };
})(typeof window !== 'undefined' ? window : globalThis);
