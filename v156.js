/* ===== FUVARSZERVEZŐ V156 – A FÜGGŐ RENDELÉS MELLÉKLETE A SZERVEREN ========
   Eddig a függő rendelés levele és PDF-je CSAK annak a gépnek a böngészőjében
   (IndexedDB) volt meg, amelyiken beimportáltad; a szerverre csak a „Megjött →
   fuvarok közé” után került fel. Ezért más gépen (és az E-mail gombnál, amely
   ezt a helyi tárat nem is nézte) a PDF hiányzott – üres levél nyílt.
   Most:
     - a függő rendelés mellékletei feltöltődnek a szerverre (pending-files
       tároló, csak admin – SUPABASE_V156.sql), amint a függő rendelések
       között vannak;
     - ha egy gépen hiányoznak, onnan letöltődnek a helyi tárba – így a
       „Levél / csatolmány”, az E-mail gomb és a fuvarok közé tétel is
       bármelyik gépen működik. */
(function (global) {
  'use strict';
  const st = () => (typeof state !== 'undefined' ? state : (global.state || {}));
  const isAdmin = () => {
    try { if (global.V44Online?.getProfile?.()?.role === 'admin') return true; } catch (_) {}
    return !!document.body?.classList?.contains('mode-admin');
  };
  const api = () => global.V44Online || {};
  let unavailable = false;           // nincs még lefuttatva az SQL (nincs tároló)
  const done = new Map();            // id → utolsó sikeres egyeztetés ideje

  async function localFiles(id) {
    try { return (await global.mailAttachmentsV108?.(String(id))) || []; } catch (_) { return []; }
  }

  /* egy függő rendelés mellékleteinek egyeztetése: helyi → szerver, szerver → helyi */
  async function syncOneV156(id, { upload = true, download = true } = {}) {
    id = String(id || '');
    if (!id || unavailable || !isAdmin() || typeof api().pendingFilesListV156 !== 'function') return { ok: false };
    let remote;
    try { remote = await api().pendingFilesListV156(id); }
    catch (error) {
      if (/bucket|not found|404|400/i.test(String(error?.message || error))) unavailable = true;
      console.warn('[V156] a függő melléklet listázása', error);
      return { ok: false, error };
    }
    const local = await localFiles(id);
    const remoteNames = new Set(remote.map(r => r.name));
    const localNames = new Set(local.map(f => f.name));
    let up = 0, down = 0;
    if (upload) for (const f of local) {
      if (remoteNames.has(f.name) || !f.bytes) continue;
      try { await api().pendingFileUploadV156(id, f.name, f.type, f.bytes); up++; }
      catch (error) { console.warn('[V156] feltöltés', f.name, error); }
    }
    if (download) {
      const fetched = [];
      for (const r of remote) {
        if (localNames.has(r.name)) continue;
        try { fetched.push({ name: r.name, type: r.type || (/\.pdf$/i.test(r.name) ? 'application/pdf' : 'application/octet-stream'), bytes: await api().pendingFileBytesV156(r.path) }); }
        catch (error) { console.warn('[V156] letöltés', r.name, error); }
      }
      if (fetched.length) { ownWrite = true; try { await global.saveMailAttachmentsV108?.(id, fetched); down = fetched.length; } catch (error) { console.warn('[V156] helyi mentés', error); } finally { ownWrite = false; } }
    }
    done.set(id, Date.now());
    return { ok: true, up, down, remote: remote.length, local: local.length };
  }

  /* a fájlok legyenek meg ezen a gépen; ha a fuvar új azonosítót kapott,
     annak a neve alatt is */
  async function ensureLocalFilesV156(id, alsoAsId) {
    await syncOneV156(id, { upload: true, download: true });
    if (alsoAsId && String(alsoAsId) !== String(id)) {
      const files = await localFiles(id);
      if (files.length) { ownWrite = true; try { await global.saveMailAttachmentsV108?.(String(alsoAsId), files.map(f => ({ name: f.name, type: f.type, bytes: f.bytes }))); } catch (_) {} finally { ownWrite = false; } }
    }
  }

  /* az összes nyitott függő rendelés – ritkán, a háttérben */
  let running = false;
  async function syncAllV156(force = false) {
    if (running || unavailable || !isAdmin()) return;
    running = true;
    try {
      for (const rec of st().pendingOrdersV151 || []) {
        if ((rec.status || 'open') !== 'open' || !rec.order?.id) continue;
        const last = done.get(String(rec.order.id)) || 0;
        if (!force && Date.now() - last < 10 * 60 * 1000) continue;
        await syncOneV156(rec.order.id);
        if (unavailable) break;
      }
    } finally { running = false; }
  }

  /* ha egy függő rendeléshez melléklet kerül (import, kézi csatolás), pár
     másodperc múlva feltöltjük – nem kell kivárni a háttérfrissítést */
  let ownWrite = false;
  function wrapSave() {
    const orig = global.saveMailAttachmentsV108;
    if (typeof orig !== 'function' || orig.__v156) return;
    const wrapped = async function (orderId, files) {
      const result = await orig.apply(this, arguments);
      if (!ownWrite && isAdmin()) setTimeout(() => {
        const isPending = (st().pendingOrdersV151 || []).some(r => (r.status || 'open') === 'open' && String(r.order?.id) === String(orderId));
        if (isPending) syncOneV156(orderId, { upload: true, download: false });
      }, 3000);
      return result;
    };
    wrapped.__v156 = true;
    global.saveMailAttachmentsV108 = wrapped;
  }

  global.v156SyncPendingFiles = syncOneV156;
  global.v156EnsureLocalFiles = ensureLocalFilesV156;
  global.v156SyncAll = syncAllV156;
  global.__v156Reset = () => { unavailable = false; done.clear(); };
  global.__v156WrapSave = wrapSave;
  if (typeof document !== 'undefined') {
    const start = () => {
      wrapSave();
      setTimeout(() => syncAllV156(true), 8000);
      setInterval(() => syncAllV156(false), 60 * 1000);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
