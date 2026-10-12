/* A szállítólevél webkamerája; a képek a meglévő mentési folyamatba kerülnek. */
(function (global) {
  'use strict';
  const byId = id => document.getElementById(id);
  const dialog = byId('cameraDialog');
  const video = byId('deliveryCameraVideo');
  const live = byId('deliveryCameraLive');
  const start = byId('startDeliveryCamera');
  const capture = byId('captureDeliveryPhoto');
  const status = byId('deliveryCameraStatus');
  const input = byId('cameraInput');
  if (!dialog || !video || !start || !capture || !input) return;

  let stream = null, generation = 0, files = [], previewUrls = [];

  /* ===== V97 – A KÉPEK MÉRETÉNEK CSÖKKENTÉSE =========================

     Egy nyers telefonos fotó 3-6 MB. A szállítólevélből viszont csak az
     olvashatóság számít, ezért a képet a hosszabb oldala mentén 1800 pixelre
     kicsinyítjük, és 72%-os minőséggel mentjük.

     Miért pont ennyi: egy A4-es lap 1800 pixel hosszú oldallal kb. 150 dpi,
     ami nyomtatásban is jól olvasható. A fájl így jellemzően 200-400 kB –
     tizede az eredetinek –, tehát gyorsabb a feltöltés a telefonos neten, és
     kevesebb helyet foglal a tárolóban.

     A PDF-hez és minden nem képfájlhoz nem nyúlunk. Ha a kicsinyítés bármi
     okból nem sikerül, az EREDETI fájl megy fel – a szállítólevél soha nem
     veszhet el a tömörítés miatt. */
  const MAX_EDGE_V97 = 1800;
  const JPEG_QUALITY_V97 = 0.72;

  function targetSizeV97(width, height, maxEdge = MAX_EDGE_V97) {
    const longest = Math.max(width, height);
    if (!longest || longest <= maxEdge) return { width, height, scaled: false };
    const ratio = maxEdge / longest;
    return { width: Math.round(width * ratio), height: Math.round(height * ratio), scaled: true };
  }

  function optimiseImageV97(file) {
    return new Promise(resolve => {
      if (!file || !/^image\//.test(file.type || '') || /svg/i.test(file.type || '')) return resolve(file);
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        try {
          const size = targetSizeV97(image.naturalWidth, image.naturalHeight);
          const canvas = document.createElement('canvas');
          canvas.width = size.width;
          canvas.height = size.height;
          const context = canvas.getContext('2d');
          if (!context) { URL.revokeObjectURL(url); return resolve(file); }
          context.drawImage(image, 0, 0, size.width, size.height);
          canvas.toBlob(blob => {
            URL.revokeObjectURL(url);
            // ha a tömörítés nem hozott nyereséget, marad az eredeti
            if (!blob || blob.size >= file.size) return resolve(file);
            const name = String(file.name || 'foto.jpg').replace(/\.[a-z0-9]+$/i, '') + '.jpg';
            resolve(new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }));
          }, 'image/jpeg', JPEG_QUALITY_V97);
        } catch (error) { URL.revokeObjectURL(url); resolve(file); }
      };
      image.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      image.src = url;
    });
  }

  async function addFilesV97(incoming) {
    for (const file of incoming) files.push(await optimiseImageV97(file));
    renderFiles();
  }


  function message(text) {
    status.textContent = text;
    status.classList.toggle('hidden', !text);
  }
  function stop() {
    generation++;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    video.pause();
    video.srcObject = null;
    live.classList.add('hidden');
    capture.disabled = true;
    start.disabled = false;
  }
  function renderFiles() {
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    previewUrls = [];
    const preview = byId('cameraPreview');
    preview.replaceChildren();
    files.forEach((file, index) => {
      const url = URL.createObjectURL(file);
      previewUrls.push(url);
      const card = document.createElement('figure');
      card.className = 'delivery-file-preview';
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      if (file.type.startsWith('image/')) {
        const image = document.createElement('img');
        image.src = url;
        image.alt = file.name;
        link.append(image);
      } else {
        link.className = 'delivery-pdf-preview';
        link.textContent = 'PDF · ' + file.name;
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Eltávolítás';
      remove.setAttribute('aria-label', file.name + ' eltávolítása');
      remove.onclick = () => { files.splice(index, 1); renderFiles(); };
      card.append(link, remove);
      preview.append(card);
    });
  }
  function reset() {
    stop();
    files = [];
    input.value = '';
    renderFiles();
    message('');
  }
  function ready() {
    capture.disabled = !stream || video.readyState < 2 || !video.videoWidth || !video.videoHeight;
  }
  video.addEventListener('canplay', ready);
  start.onclick = async () => {
    stop();
    const request = generation;
    if (!global.navigator.mediaDevices?.getUserMedia) {
      message(global.isSecureContext === false
        ? 'A kamera a HTTPS-címen nyitható meg. Fényképet vagy PDF-et fájlból is kiválaszthatsz.'
        : 'A böngésző nem éri el a kamerát. Fényképet vagy PDF-et fájlból is kiválaszthatsz.');
      if (/Android|iPhone|iPad|iPod/i.test(global.navigator.userAgent || '')) input.click();
      return;
    }
    start.disabled = true;
    message('Kamera indítása…');
    try {
      const acquired = await global.navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      // A bezárt vagy újranyitott ablakhoz későn érkező engedély nem indít kamerát.
      if (request !== generation || !dialog.open) {
        acquired.getTracks().forEach(track => track.stop());
        return;
      }
      stream = acquired;
      video.srcObject = acquired;
      live.classList.remove('hidden');
      await video.play();
      if (request !== generation) return;
      ready();
      message('A Fénykép készítése gombbal rögzítheted a szállítólevelet.');
      acquired.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
        if (stream !== acquired) return;
        stop();
        message('A kamera leállt. Újraindíthatod, vagy választhatsz fájlt.');
      }));
    } catch (error) {
      if (request !== generation) return;
      stop();
      const errors = {
        NotAllowedError: 'A kamera használata nincs engedélyezve. Engedélyezd a böngésző webhelybeállításaiban, majd próbáld újra.',
        NotFoundError: 'Nem található kamera. Csatlakoztass kamerát, vagy válassz fényképet / PDF-et.',
        NotReadableError: 'A kamerát nem sikerült elindítani. Zárd be a kamerát használó másik alkalmazást, majd próbáld újra.'
      };
      message(errors[error.name] || 'A kamera nem indult el. Próbáld újra, vagy válassz fényképet / PDF-et.');
    }
  };
  capture.onclick = () => {
    if (!stream || capture.disabled || !video.videoWidth || !video.videoHeight) return;
    const request = generation;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) { message('Nem sikerült fényképet készíteni. Válassz fájlt, vagy próbáld újra.'); return; }
    capture.disabled = true;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (request !== generation || !dialog.open) return;
      ready();
      if (!blob) { message('Nem sikerült fényképet készíteni. Próbáld újra.'); return; }
      const shot = new File([blob], 'szallitolevel-' + Date.now() + '-' + (files.length + 1) + '.jpg', { type: 'image/jpeg' });
      optimiseImageV97(shot).then(ready2 => {
        files.push(ready2);
        renderFiles();
        message('A fénykép elkészült. A Mentés a rendeléshez gombbal mentheted el.');
      });
    }, 'image/jpeg', 0.92);
  };
  byId('stopDeliveryCamera').onclick = () => { stop(); message('Kamera leállítva.'); };
  byId('chooseCameraFile').onclick = () => input.click();
  input.onchange = () => {
    const incoming = Array.from(input.files || []);
    input.value = '';
    addFilesV97(incoming);
  };
  dialog.addEventListener('close', reset);
  dialog.addEventListener('cancel', stop);
  global.addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && stream) { stop(); message('Kamera leállítva.'); }
  });
  global.V69DeliveryCamera = { reset, files: () => files.slice(), optimiseImageV97, targetSizeV97 };
})(window);
