(() => {
  // --- State ---
  const state = {
    vidAtoB: true,
    audAtoB: true,
    volAtoB: 1.0,
    vidBtoA: true,
    audBtoA: true,
    volBtoA: 1.0,
    monitorA: true,
    monitorB: true,
    monVolA: 0.85,
    monVolB: 0.85,
    blackoutA: false,
    blackoutB: false,
    micEnabled: false,
    micToA: false,
    micToB: false,
    micVol: 1.0,
    micMon: false,
    sfxToA: true,
    sfxToB: true,
    sfxVol: 0.9,
    sfxMonVol: 0.6,
    masterA: 1.0,
    masterB: 1.0,
    muteAllOut: false,
    sbCategory: 'sfx',
    cropA: 0,
    flipA: false,
    cropB: 0,
    flipB: false
  };

  // --- Video Mixer (OBS-style FX) State ---
  const videoFx = {
    enabled: false,
    applyA: true,
    applyB: true,
    previewSlot: 'A',
    presets: {
      disco: false,
      strobe: false,
      glitch: false,
      crt: false,
      invert: false,
      noir: false,
      thermal: false,
      pixelate: false,
      mirror: false,
      wobble: false,
      rec: false,
      wasted: false,
      censor: false
    },
    bright: 100,
    contrast: 100,
    sat: 100,
    hue: 0,
    blur: 0,
    shake: 0,
    textActive: false,
    overlayText: 'LIVE'
  };

  let pixelateCanvas = null;
  let pixelateCtx = null;

  function hasAnyVideoFx() {
    const p = videoFx.presets;
    const anyPreset = Object.values(p).some(Boolean);
    const anyColor = videoFx.bright !== 100 || videoFx.contrast !== 100 || videoFx.sat !== 100 || videoFx.hue !== 0 || videoFx.blur !== 0 || videoFx.shake !== 0;
    return anyPreset || anyColor || videoFx.textActive;
  }

  function hasVideoEffectsForSlot(sourceSlotId) {
    if (!videoFx.enabled || !hasAnyVideoFx()) return false;
    return sourceSlotId === 'A' ? videoFx.applyA : videoFx.applyB;
  }

  // --- Logs & Telemetry ---
  const logEntries = [];
  let activeLogFilter = 'all';
  const logListEl = document.getElementById('logList');
  const tele = {
    A: { bridge: '—', gum: 0, calls: 0, res: '—' },
    B: { bridge: '—', gum: 0, calls: 0, res: '—' }
  };

  function renderTelemetry() {
    document.getElementById('teleBridgeA').textContent = tele.A.bridge;
    document.getElementById('teleGumA').textContent = tele.A.gum;
    document.getElementById('teleCallsA').textContent = tele.A.calls;
    document.getElementById('teleResA').textContent = tele.A.res;
    document.getElementById('teleBridgeB').textContent = tele.B.bridge;
    document.getElementById('teleGumB').textContent = tele.B.gum;
    document.getElementById('teleCallsB').textContent = tele.B.calls;
    document.getElementById('teleResB').textContent = tele.B.res;
  }

  function renderLogs() {
    const filtered =
      activeLogFilter === 'all'
        ? logEntries
        : logEntries.filter((e) => e.tag === activeLogFilter);

    logListEl.innerHTML = filtered
      .map(
        (e) =>
          `<div class="log-entry"><span class="log-time">[${e.time}]</span><span class="log-tag log-tag-${e.tag}">[${e.tag.toUpperCase()}]</span><span class="log-msg">${e.msg}</span></div>`
      )
      .join('');
    logListEl.scrollTop = logListEl.scrollHeight;
  }

  function addLog(tag, msg) {
    const now = new Date();
    const time = now.toTimeString().slice(0, 8);
    const safeMsg = String(msg).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    logEntries.push({ time, tag, msg: safeMsg });
    if (logEntries.length > 400) logEntries.shift();
    if (activeLogFilter === 'all' || activeLogFilter === tag) {
      renderLogs();
    }
  }

  const startTs = Date.now();
  setInterval(() => {
    const sec = Math.floor((Date.now() - startTs) / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    document.getElementById('uptimeBadge').textContent = `${mm}:${ss}`;
  }, 1000);

  addLog('admin', 'Control Deck initialized');

  // --- Audio Context & Mixer ---
  const audioCtx = new AudioContext();
  const destToA = audioCtx.createMediaStreamDestination();
  const destToB = audioCtx.createMediaStreamDestination();

  // Keep destinations alive with silent oscillator
  const silentOsc = audioCtx.createOscillator();
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;
  silentOsc.connect(silentGain);
  silentGain.connect(destToA);
  silentGain.connect(destToB);
  silentOsc.start();

  const masterGainA = audioCtx.createGain();
  const masterGainB = audioCtx.createGain();
  masterGainA.connect(destToA);
  masterGainB.connect(destToB);

  const gainAtoB = audioCtx.createGain();
  const gainBtoA = audioCtx.createGain();
  const gainMonitorA = audioCtx.createGain();
  const gainMonitorB = audioCtx.createGain();
  gainMonitorA.gain.value = 0;
  gainMonitorB.gain.value = 0;

  gainAtoB.connect(masterGainB);
  gainBtoA.connect(masterGainA);
  gainMonitorA.connect(audioCtx.destination);
  gainMonitorB.connect(audioCtx.destination);

  const analyserA = audioCtx.createAnalyser();
  const analyserB = audioCtx.createAnalyser();
  const analyserMic = audioCtx.createAnalyser();
  analyserA.fftSize = 256;
  analyserB.fftSize = 256;
  analyserMic.fftSize = 256;

  // Admin Mic nodes
  const gainMicToA = audioCtx.createGain();
  const gainMicToB = audioCtx.createGain();
  const gainMicMonitor = audioCtx.createGain();
  gainMicToA.gain.value = 0;
  gainMicToB.gain.value = 0;
  gainMicMonitor.gain.value = 0;
  gainMicToA.connect(masterGainA);
  gainMicToB.connect(masterGainB);
  gainMicMonitor.connect(audioCtx.destination);

  // Soundboard nodes
  const sfxMasterGain = audioCtx.createGain();
  sfxMasterGain.gain.value = state.sfxVol;
  const gainSfxToA = audioCtx.createGain();
  const gainSfxToB = audioCtx.createGain();
  const gainSfxMonitor = audioCtx.createGain();
  gainSfxMonitor.gain.value = state.sfxMonVol;
  sfxMasterGain.connect(gainSfxToA);
  sfxMasterGain.connect(gainSfxToB);
  sfxMasterGain.connect(gainSfxMonitor);
  gainSfxToA.connect(masterGainA);
  gainSfxToB.connect(masterGainB);
  gainSfxMonitor.connect(audioCtx.destination);

  // --- Placeholder & Decoy Canvas Streams ---
  let decoyImg = null;
  let decoyActive = false;
  let realCamStream = null;
  let realCamTrack = null;
  let realCamVideoEl = null;

  function drawLoadingSpinner(ctx, cw, ch, now, bgSource) {
    ctx.fillStyle = '#0d1017';
    ctx.fillRect(0, 0, cw, ch);

    if (bgSource && bgSource.readyState >= 2 && bgSource.videoWidth > 0) {
      const vw = bgSource.videoWidth;
      const vh = bgSource.videoHeight;
      const scale = Math.max(cw / vw, ch / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      ctx.save();
      ctx.filter = 'blur(24px) brightness(0.32)';
      ctx.drawImage(bgSource, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      ctx.restore();
    }

    const cx = cw / 2;
    const cy = ch / 2;
    const r = Math.max(14, ch * 0.042);
    const angle = (now / 170) % (Math.PI * 2);

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = Math.max(3, ch * 0.008);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#f4f4f5';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r, angle, angle + Math.PI * 1.15);
    ctx.stroke();
    ctx.restore();
  }

  function createSlotOutboundVideoTrack(targetSlotId) {
    const otherSlotId = targetSlotId === 'A' ? 'B' : 'A';
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.001;pointer-events:none;z-index:-1;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    const draw = () => {
      const blackout = targetSlotId === 'A' ? state.blackoutA : state.blackoutB;
      if (blackout) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#3f3f46';
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Camera Paused', canvas.width / 2, canvas.height / 2);
        return;
      }

      if (decoyActive && decoyImg) {
        renderProcessedVideoFrame(ctx, canvas, decoyImg, otherSlotId, performance.now(), true);
        return;
      }

      const routeOther = targetSlotId === 'A' ? state.vidBtoA : state.vidAtoB;
      const otherSlot = slots[otherSlotId];
      if (
        routeOther &&
        otherSlot?.strangerConnected &&
        otherSlot?.remoteVideoTrack?.readyState === 'live' &&
        otherSlot.previewEl?.readyState >= 2 &&
        otherSlot.previewEl.videoWidth > 0
      ) {
        renderProcessedVideoFrame(ctx, canvas, otherSlot.previewEl, otherSlotId, performance.now());
        return;
      }

      if (realCamTrack && realCamVideoEl?.readyState >= 2 && realCamVideoEl.videoWidth > 0) {
        renderProcessedVideoFrame(ctx, canvas, realCamVideoEl, otherSlotId, performance.now());
        return;
      }

      drawLoadingSpinner(ctx, canvas.width, canvas.height, performance.now(), otherSlot?.previewEl);
    };

    draw();
    setInterval(draw, 33);
    return { draw, track: canvas.captureStream(30).getVideoTracks()[0] };
  }

  // --- WebRTC Connections to Slot A & Slot B ---
  const slots = {
    A: {
      pc: null,
      videoSender: null,
      audioSender: null,
      remoteStream: new MediaStream(),
      remoteVideoTrack: null,
      remoteAudioTrack: null,
      audioSource: null,
      strangerConnected: false,
      activeCallId: 0,
      previewEl: document.getElementById('previewA'),
      statusEl: document.getElementById('statusA')
    },
    B: {
      pc: null,
      videoSender: null,
      audioSender: null,
      remoteStream: new MediaStream(),
      remoteVideoTrack: null,
      remoteAudioTrack: null,
      audioSource: null,
      strangerConnected: false,
      activeCallId: 0,
      previewEl: document.getElementById('previewB'),
      statusEl: document.getElementById('statusB')
    }
  };

  const outboundA = createSlotOutboundVideoTrack('A');
  const outboundB = createSlotOutboundVideoTrack('B');
  const waitingTrackForA = outboundA.track;
  const waitingTrackForB = outboundB.track;

  function setSlotBadge(slotId, text, type) {
    const el = slots[slotId].statusEl;
    el.textContent = text;
    el.className = `badge badge-${type}`;
  }

  const monitorAudioA = document.createElement('audio');
  monitorAudioA.autoplay = true;
  monitorAudioA.playsInline = true;
  document.body.appendChild(monitorAudioA);

  const monitorAudioB = document.createElement('audio');
  monitorAudioB.autoplay = true;
  monitorAudioB.playsInline = true;
  document.body.appendChild(monitorAudioB);

  function syncAudioUI() {
    const setBtn = (id, active, onLbl, offLbl) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('active', active);
      if (onLbl && offLbl) el.textContent = active ? onLbl : offLbl;
    };
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };
    const setTxt = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };

    setBtn('btnAudAtoB', state.audAtoB, 'Mic ON', 'Mic OFF');
    setBtn('btnAudBtoA', state.audBtoA, 'Mic ON', 'Mic OFF');
    setBtn('btnMonitorA', state.monitorA, 'Monitoring A', 'Monitor A');
    setBtn('btnMonitorB', state.monitorB, 'Monitoring B', 'Monitor B');
    setBtn('btnMicToA', state.micToA);
    setBtn('btnMicToB', state.micToB);

    setBtn('smAudAtoB', state.audAtoB);
    setBtn('smAudBtoA', state.audBtoA);
    setBtn('smMonA', state.monitorA);
    setBtn('smMonB', state.monitorB);
    setBtn('smMicToA', state.micToA);
    setBtn('smMicToB', state.micToB);
    setBtn('smMicMon', state.micMon);
    setBtn('smSfxToA', state.sfxToA);
    setBtn('smSfxToB', state.sfxToB);

    setVal('volAtoB', state.volAtoB);
    setVal('smVolAtoB', state.volAtoB);
    setTxt('smValAtoB', `${Math.round(state.volAtoB * 100)}%`);

    setVal('volBtoA', state.volBtoA);
    setVal('smVolBtoA', state.volBtoA);
    setTxt('smValBtoA', `${Math.round(state.volBtoA * 100)}%`);

    setVal('volMonA', state.monVolA);
    setVal('smVolMonA', state.monVolA);
    setVal('volMonB', state.monVolB);
    setVal('smVolMonB', state.monVolB);

    setVal('smVolMic', state.micVol);
    setTxt('smValMic', `${Math.round(state.micVol * 100)}%`);

    setVal('volSfx', state.sfxVol);
    setVal('smVolSfx', state.sfxVol);
    setTxt('smValSfx', `${Math.round(state.sfxVol * 100)}%`);
    setVal('smVolSfxMon', state.sfxMonVol);

    document.querySelectorAll('.sb-tgt').forEach((b) => {
      const t = b.dataset.target;
      const match =
        (t === 'both' && state.sfxToA && state.sfxToB) ||
        (t === 'A' && state.sfxToA && !state.sfxToB) ||
        (t === 'B' && !state.sfxToA && state.sfxToB);
      b.classList.toggle('active', match);
    });
  }

  function updateAudioGains() {
    masterGainA.gain.value = state.muteAllOut ? 0 : state.masterA;
    masterGainB.gain.value = state.muteAllOut ? 0 : state.masterB;

    gainAtoB.gain.value = state.audAtoB ? state.volAtoB : 0;
    gainBtoA.gain.value = state.audBtoA ? state.volBtoA : 0;
    gainMonitorA.gain.value = 0;
    gainMonitorB.gain.value = 0;
    monitorAudioA.muted = !state.monitorA;
    monitorAudioA.volume = state.monVolA;
    monitorAudioB.muted = !state.monitorB;
    monitorAudioB.volume = state.monVolB;
    gainMicToA.gain.value = state.micEnabled && state.micToA ? state.micVol : 0;
    gainMicToB.gain.value = state.micEnabled && state.micToB ? state.micVol : 0;
    gainMicMonitor.gain.value = state.micEnabled && state.micMon ? state.micVol : 0;

    sfxMasterGain.gain.value = state.sfxVol;
    gainSfxMonitor.gain.value = state.sfxMonVol;
    gainSfxToA.gain.value = state.sfxToA ? 1.0 : 0;
    gainSfxToB.gain.value = state.sfxToB ? 1.0 : 0;
    syncAudioUI();
  }

  function renderProcessedVideoFrame(ctx, canvas, source, sourceSlotId, now, cover = false) {
    const cw = canvas.width;
    const ch = canvas.height;
    const vw = source.videoWidth || source.naturalWidth || source.width;
    const vh = source.videoHeight || source.naturalHeight || source.height;
    if (!vw || !vh) return;

    const cPct = sourceSlotId === 'A' ? state.cropA : state.cropB;
    const doFlip = sourceSlotId === 'A' ? state.flipA : state.flipB;
    const fxOn = hasVideoEffectsForSlot(sourceSlotId);
    const p = videoFx.presets;

    const trimPct = cPct * 0.8;
    const marginX = (vw * trimPct) / 200;
    const marginY = (vh * trimPct) / 200;
    const sw = Math.max(1, vw - marginX * 2);
    const sh = Math.max(1, vh - marginY * 2);

    const scale = cover ? Math.max(cw / sw, ch / sh) : Math.min(cw / sw, ch / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, cw, ch);

    // Build CSS filter chain
    const filters = [];
    if (fxOn) {
      if (videoFx.bright !== 100) filters.push(`brightness(${videoFx.bright}%)`);
      if (videoFx.contrast !== 100) filters.push(`contrast(${videoFx.contrast}%)`);
      if (videoFx.sat !== 100) filters.push(`saturate(${videoFx.sat}%)`);
      if (videoFx.hue !== 0) filters.push(`hue-rotate(${videoFx.hue}deg)`);
      if (videoFx.blur > 0) filters.push(`blur(${(videoFx.blur * (cw / 1280)).toFixed(1)}px)`);
      if (p.invert) filters.push('invert(1)');
      if (p.noir || p.wasted) filters.push('grayscale(1) contrast(1.35)');
      if (p.thermal) filters.push(`hue-rotate(${Math.floor((now / 15) % 360)}deg) saturate(4) contrast(1.5)`);
      if (p.strobe && Math.floor(now / 70) % 2 === 0) filters.push('invert(1) brightness(1.4)');
    }

    ctx.save();
    ctx.filter = filters.length ? filters.join(' ') : 'none';

    if (doFlip) {
      ctx.translate(cw, 0);
      ctx.scale(-1, 1);
    }

    if (fxOn && (p.wobble || videoFx.shake > 0 || p.disco)) {
      ctx.translate(cw / 2, ch / 2);
      if (p.wobble) {
        const angle = Math.sin(now / 260) * 0.08;
        const zoom = 1.08 + Math.sin(now / 190) * 0.05;
        ctx.rotate(angle);
        ctx.scale(zoom, zoom);
      }
      if (p.disco) {
        const beat = 1.0 + Math.abs(Math.sin(now / 160)) * 0.06;
        ctx.scale(beat, beat);
      }
      if (videoFx.shake > 0) {
        const amp = (videoFx.shake / 100) * (cw * 0.035);
        ctx.translate((Math.random() - 0.5) * amp * 2, (Math.random() - 0.5) * amp * 2);
      }
      ctx.translate(-cw / 2, -ch / 2);
    }

    if (fxOn && p.pixelate) {
      if (!pixelateCanvas) {
        pixelateCanvas = document.createElement('canvas');
        pixelateCanvas.width = 64;
        pixelateCanvas.height = 36;
        pixelateCtx = pixelateCanvas.getContext('2d');
      }
      pixelateCtx.drawImage(source, marginX, marginY, sw, sh, 0, 0, 64, 36);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pixelateCanvas, dx, dy, dw, dh);
      ctx.imageSmoothingEnabled = true;
    } else if (fxOn && p.mirror) {
      const halfW = cw / 2;
      ctx.drawImage(source, marginX, marginY, sw / 2, sh, 0, dy, halfW, dh);
      ctx.save();
      ctx.translate(cw, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(source, marginX, marginY, sw / 2, sh, 0, dy, halfW, dh);
      ctx.restore();
    } else {
      ctx.drawImage(source, marginX, marginY, sw, sh, dx, dy, dw, dh);
    }
    ctx.restore();

    if (!fxOn) return;

    // Glitch / VHS horizontal slice displacement + RGB flash
    if (p.glitch) {
      const sliceCount = 5;
      for (let i = 0; i < sliceCount; i++) {
        if (Math.random() < 0.55) {
          const sy = Math.random() * ch;
          const shSlice = 6 + Math.random() * (ch * 0.08);
          const offset = (Math.random() - 0.5) * (cw * 0.08);
          ctx.drawImage(canvas, 0, sy, cw, shSlice, offset, sy, cw, shSlice);
        }
      }
      if (Math.random() < 0.25) {
        ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,0,80,0.14)' : 'rgba(0,255,255,0.14)';
        ctx.fillRect(0, 0, cw, ch);
      }
    }

    // Disco color wash
    if (p.disco) {
      const hue = Math.floor((now / 8) % 360);
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = `hsla(${hue}, 100%, 55%, 0.55)`;
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

    // CRT scanlines + vignette
    if (p.crt) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      const step = Math.max(3, Math.round(ch / 120));
      for (let y = 0; y < ch; y += step * 2) {
        ctx.fillRect(0, y, cw, step);
      }
      const grad = ctx.createRadialGradient(cw / 2, ch / 2, cw * 0.25, cw / 2, ch / 2, cw * 0.65);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.65)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, cw, ch);
    }

    // Censor bar
    if (p.censor) {
      ctx.fillStyle = '#000000';
      const bw = cw * 0.44;
      const bh = ch * 0.11;
      ctx.fillRect((cw - bw) / 2, ch * 0.34, bw, bh);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(ch * 0.045)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CENSORED', cw / 2, ch * 0.34 + bh / 2);
    }

    // REC Camcorder HUD
    if (p.rec) {
      const pad = cw * 0.04;
      const br = cw * 0.04;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = Math.max(2, cw * 0.003);
      ctx.beginPath();
      ctx.moveTo(pad, pad + br); ctx.lineTo(pad, pad); ctx.lineTo(pad + br, pad);
      ctx.moveTo(cw - pad - br, pad); ctx.lineTo(cw - pad, pad); ctx.lineTo(cw - pad, pad + br);
      ctx.moveTo(pad, ch - pad - br); ctx.lineTo(pad, ch - pad); ctx.lineTo(pad + br, ch - pad);
      ctx.moveTo(cw - pad - br, ch - pad); ctx.lineTo(cw - pad, ch - pad); ctx.lineTo(cw - pad, ch - pad - br);
      ctx.stroke();

      if (Math.floor(now / 500) % 2 === 0) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(pad + cw * 0.03, pad + ch * 0.05, Math.max(5, ch * 0.015), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(ch * 0.04)}px monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('REC', pad + cw * 0.05, pad + ch * 0.05);
      const sec = Math.floor(now / 1000) % 3600;
      const tc = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
      ctx.textAlign = 'right';
      ctx.fillText(tc, cw - pad - cw * 0.02, pad + ch * 0.05);
    }

    // GTA WASTED banner
    if (p.wasted) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, ch * 0.38, cw, ch * 0.24);
      ctx.fillStyle = '#ef4444';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(3, ch * 0.01);
      ctx.font = `900 ${Math.round(ch * 0.13)}px Impact, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeText('WASTED', cw / 2, ch / 2);
      ctx.fillText('WASTED', cw / 2, ch / 2);
    }

    // Custom Text Overlay
    if (videoFx.textActive && videoFx.overlayText.trim()) {
      ctx.font = `900 ${Math.round(ch * 0.09)}px Impact, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = Math.max(3, ch * 0.012);
      ctx.strokeStyle = '#000000';
      ctx.fillStyle = '#ffffff';
      const txt = videoFx.overlayText.trim().toUpperCase();
      ctx.strokeText(txt, cw / 2, ch * 0.93);
      ctx.fillText(txt, cw / 2, ch * 0.93);
    }
  }

  function updateVideoRoutes() {
    outboundA.draw();
    outboundB.draw();
  }

  function attachRemoteAudio(slotId, track) {
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const slot = slots[slotId];
    if (slot.audioSource) {
      try {
        slot.audioSource.disconnect();
      } catch (_) {}
    }
    const stream = new MediaStream([track]);
    const src = audioCtx.createMediaStreamSource(stream);
    slot.audioSource = src;

    if (slotId === 'A') {
      monitorAudioA.srcObject = stream;
      monitorAudioA.play().catch(() => {});
      src.connect(analyserA);
      src.connect(gainAtoB);
    } else {
      monitorAudioB.srcObject = stream;
      monitorAudioB.play().catch(() => {});
      src.connect(analyserB);
      src.connect(gainBtoA);
    }
  }

  async function initSlotConnection(slotId) {
    const slot = slots[slotId];
    if (slot.pc) {
      try {
        slot.pc.close();
      } catch (_) {}
    }

    const pc = new RTCPeerConnection({ iceServers: [] });
    slot.pc = pc;

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        window.omeAdmin.sendSignal(slotId, {
          type: 'ice-candidate',
          candidate: ev.candidate.toJSON()
        });
      }
    };

    pc.ontrack = (ev) => {
      const track = ev.track;
      if (track.kind === 'video') {
        slot.remoteVideoTrack = track;
        // Rebuild preview MediaStream
        const newPreview = new MediaStream([track]);
        if (slot.remoteAudioTrack) newPreview.addTrack(slot.remoteAudioTrack);
        slot.remoteStream = newPreview;
        slot.previewEl.srcObject = newPreview;
        updateVideoRoutes();
      } else if (track.kind === 'audio') {
        slot.remoteAudioTrack = track;
        attachRemoteAudio(slotId, track);
      }
    };

    const initialVideo = slotId === 'A' ? waitingTrackForA : waitingTrackForB;
    const initialAudio = slotId === 'A' ? destToA.stream.getAudioTracks()[0] : destToB.stream.getAudioTracks()[0];

    const vTransceiver = pc.addTransceiver(initialVideo, { direction: 'sendrecv' });
    const aTransceiver = pc.addTransceiver(initialAudio, { direction: 'sendrecv' });

    slot.videoSender = vTransceiver.sender;
    slot.audioSender = aTransceiver.sender;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    window.omeAdmin.sendSignal(slotId, {
      type: 'offer',
      sdp: pc.localDescription.toJSON()
    });
  }

  // --- Signaling & Status from Slots ---
  window.omeAdmin.onSignal(async (slotId, msg) => {
    const slot = slots[slotId];
    if (!slot) return;

    if (msg.type === 'slot-hello') {
      addLog('bridge', `Slot ${slotId} announced ready -> sending WebRTC offer`);
      if (decoyActive && decoyDataUrl) {
        window.omeAdmin.sendSignal(slotId, { type: 'set-decoy', dataUrl: decoyDataUrl });
      }
      await initSlotConnection(slotId);
    } else if (msg.type === 'answer' && slot.pc) {
      await slot.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      addLog('bridge', `Slot ${slotId} accepted WebRTC answer`);
      updateVideoRoutes();
    } else if (msg.type === 'ice-candidate' && slot.pc) {
      await slot.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
    }
  });

  window.omeAdmin.onSlotStatus((slotId, status) => {
    const slot = slots[slotId];
    if (!slot) return;

    if (status.type === 'bridge-state') {
      tele[slotId].bridge = status.state;
      renderTelemetry();
      addLog('bridge', `Slot ${slotId} bridge state: ${status.state}`);
    } else if (status.type === 'gum-called') {
      tele[slotId].gum += 1;
      renderTelemetry();
      addLog(slotId, `getUserMedia(video=${status.video}, audio=${status.audio})`);
    } else if (status.type === 'pc-created') {
      tele[slotId].calls += 1;
      renderTelemetry();
      addLog(slotId, `New RTCPeerConnection (#${status.callId}) created by page`);
    } else if (status.type === 'video-debug') {
      addLog(slotId, status.msg);
    } else if (status.type === 'stranger-state') {
      if (status.state === 'connected') {
        slot.activeCallId = status.callId || slot.activeCallId;
        slot.strangerConnected = true;
        if (slot.previewEl) slot.previewEl.style.opacity = '1';
        setSlotBadge(slotId, 'Connected', 'ok');
        addLog(slotId, `Stranger connected (call #${status.callId}, video=${status.hasVideo}, audio=${status.hasAudio})`);
        updateVideoRoutes();
        setTimeout(() => {
          const v = slot.previewEl;
          if (v && v.videoWidth) {
            tele[slotId].res = `${v.videoWidth}x${v.videoHeight}`;
            renderTelemetry();
          }
        }, 600);
      } else if (status.state === 'disconnected') {
        if (status.callId && slot.activeCallId && status.callId < slot.activeCallId) return;
        slot.strangerConnected = false;
        if (slot.previewEl) slot.previewEl.style.opacity = '0';
        setSlotBadge(slotId, 'Waiting', 'idle');
        tele[slotId].res = '—';
        renderTelemetry();
        addLog(slotId, `Stranger disconnected (call #${status.callId})`);
        updateVideoRoutes();
      }
    }
  });

  window.omeAdmin.onSlotNav((slotId, url) => {
    addLog(slotId, `Navigated to ${url}`);
  });

  // Ping both slots on Admin startup in case they loaded first
  window.omeAdmin.sendSignal('A', { type: 'ping-slot' });
  window.omeAdmin.sendSignal('B', { type: 'ping-slot' });

  // --- VU Meters Loop ---
  const vuFillA = document.getElementById('vuFillA');
  const vuFillB = document.getElementById('vuFillB');
  const vuFillMic = document.getElementById('vuFillMic');
  const smVuA = document.getElementById('smVuA');
  const smVuB = document.getElementById('smVuB');
  const smVuMic = document.getElementById('smVuMic');
  const vuData = new Uint8Array(128);

  function getLevel(analyser) {
    analyser.getByteTimeDomainData(vuData);
    let max = 0;
    for (let i = 0; i < vuData.length; i++) {
      const v = Math.abs(vuData[i] - 128) / 128;
      if (v > max) max = v;
    }
    return Math.min(100, Math.round(max * 220));
  }

  function renderVU() {
    const lvlA = `${getLevel(analyserA)}%`;
    const lvlB = `${getLevel(analyserB)}%`;
    const lvlMic = state.micEnabled ? `${getLevel(analyserMic)}%` : '0%';
    vuFillA.style.width = lvlA;
    vuFillB.style.width = lvlB;
    vuFillMic.style.width = lvlMic;
    if (smVuA) smVuA.style.width = lvlA;
    if (smVuB) smVuB.style.width = lvlB;
    if (smVuMic) smVuMic.style.width = lvlMic;
    requestAnimationFrame(renderVU);
  }
  requestAnimationFrame(renderVU);

  // --- UI Bindings: Top Bar ---
  const presetSelect = document.getElementById('presetSelect');
  const urlInput = document.getElementById('urlInput');

  presetSelect.addEventListener('change', () => {
    urlInput.value = presetSelect.value;
    window.omeAdmin.loadUrl('both', urlInput.value);
  });

  document.getElementById('btnLoadBoth').addEventListener('click', () => {
    window.omeAdmin.loadUrl('both', urlInput.value);
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      window.omeAdmin.loadUrl('both', urlInput.value);
    }
  });

  document.getElementById('btnReloadA').addEventListener('click', () => window.omeAdmin.reloadSlot('A'));
  document.getElementById('btnReloadB').addEventListener('click', () => window.omeAdmin.reloadSlot('B'));

  // --- UI Bindings: Slot & Matrix Controls ---
  function bindToggle(id, key, labelOn, labelOff, onChange) {
    const btn = document.getElementById(id);
    btn.addEventListener('click', () => {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      state[key] = !state[key];
      btn.classList.toggle('active', state[key]);
      if (labelOn && labelOff) {
        btn.textContent = state[key] ? labelOn : labelOff;
      }
      onChange?.(state[key]);
    });
  }

  bindToggle('btnVidAtoB', 'vidAtoB', 'Cam ON', 'Cam OFF', updateVideoRoutes);
  bindToggle('btnAudAtoB', 'audAtoB', 'Mic ON', 'Mic OFF', updateAudioGains);
  bindToggle('btnVidBtoA', 'vidBtoA', 'Cam ON', 'Cam OFF', updateVideoRoutes);
  bindToggle('btnAudBtoA', 'audBtoA', 'Mic ON', 'Mic OFF', updateAudioGains);
  bindToggle('btnMonitorA', 'monitorA', 'Monitoring A', 'Monitor A', updateAudioGains);
  bindToggle('btnMonitorB', 'monitorB', 'Monitoring B', 'Monitor B', updateAudioGains);
  bindToggle('btnFlipA', 'flipA', null, null, updateVideoRoutes);
  bindToggle('btnFlipB', 'flipB', null, null, updateVideoRoutes);

  const cropValA = document.getElementById('cropValA');
  document.getElementById('cropA').addEventListener('input', (e) => {
    state.cropA = parseInt(e.target.value, 10) || 0;
    cropValA.textContent = `${state.cropA}%`;
    updateVideoRoutes();
  });

  const cropValB = document.getElementById('cropValB');
  document.getElementById('cropB').addEventListener('input', (e) => {
    state.cropB = parseInt(e.target.value, 10) || 0;
    cropValB.textContent = `${state.cropB}%`;
    updateVideoRoutes();
  });

  document.getElementById('volAtoB').addEventListener('input', (e) => {
    state.volAtoB = parseFloat(e.target.value);
    updateAudioGains();
  });

  document.getElementById('volBtoA').addEventListener('input', (e) => {
    state.volBtoA = parseFloat(e.target.value);
    updateAudioGains();
  });

  document.getElementById('volMonA').addEventListener('input', (e) => {
    state.monVolA = parseFloat(e.target.value);
    updateAudioGains();
  });

  document.getElementById('volMonB').addEventListener('input', (e) => {
    state.monVolB = parseFloat(e.target.value);
    updateAudioGains();
  });

  const btnBlackoutA = document.getElementById('btnBlackoutA');
  btnBlackoutA.addEventListener('click', () => {
    state.blackoutA = !state.blackoutA;
    btnBlackoutA.classList.toggle('btn-danger', state.blackoutA);
    updateVideoRoutes();
  });

  const btnBlackoutB = document.getElementById('btnBlackoutB');
  btnBlackoutB.addEventListener('click', () => {
    state.blackoutB = !state.blackoutB;
    btnBlackoutB.classList.toggle('btn-danger', state.blackoutB);
    updateVideoRoutes();
  });

  function markSlotSkipping(slotId) {
    const slot = slots[slotId];
    if (!slot) return;
    slot.strangerConnected = false;
    if (slot.previewEl) slot.previewEl.style.opacity = '0';
    setSlotBadge(slotId, 'Searching...', 'idle');
    updateVideoRoutes();
  }

  document.getElementById('btnNextA').addEventListener('click', () => {
    markSlotSkipping('A');
    window.omeAdmin.domAction('A', 'next');
    addLog('admin', 'Triggered Next A');
  });
  document.getElementById('btnNextB').addEventListener('click', () => {
    markSlotSkipping('B');
    window.omeAdmin.domAction('B', 'next');
    addLog('admin', 'Triggered Next B');
  });
  document.getElementById('btnNextBoth').addEventListener('click', () => {
    markSlotSkipping('A');
    markSlotSkipping('B');
    window.omeAdmin.domAction('both', 'next');
    addLog('admin', 'Triggered Next Both');
  });
  document.getElementById('btnStartBoth').addEventListener('click', () => {
    window.omeAdmin.domAction('both', 'start');
    addLog('admin', 'Triggered Start Both');
  });

  // --- Decoy Face Image & Real Cam (Wait) ---
  const decoyImgInput = document.getElementById('decoyImgInput');
  const btnLoadDecoy = document.getElementById('btnLoadDecoy');
  const btnToggleDecoy = document.getElementById('btnToggleDecoy');

  let decoyDataUrl = null;

  function makeDecoyDataUrl(img) {
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 720;
    const ctx = c.getContext('2d');
    const scale = Math.max(c.width / img.width, c.height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
    return c.toDataURL('image/jpeg', 0.85);
  }

  function setDecoyActive(active) {
    decoyActive = Boolean(active && decoyImg);
    btnToggleDecoy.classList.toggle('active', decoyActive);
    btnToggleDecoy.textContent = decoyActive ? 'Decoy: ON' : 'Decoy: OFF';
    const payload = { type: 'set-decoy', dataUrl: decoyActive ? decoyDataUrl : null };
    window.omeAdmin.sendSignal('A', payload);
    window.omeAdmin.sendSignal('B', payload);
    updateVideoRoutes();
  }

  btnLoadDecoy.addEventListener('click', () => decoyImgInput.click());
  decoyImgInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      decoyImg = img;
      decoyDataUrl = makeDecoyDataUrl(img);
      btnToggleDecoy.disabled = false;
      btnLoadDecoy.textContent = file.name.slice(0, 14);
      setDecoyActive(true);
      addLog('admin', `Loaded & activated decoy image: ${file.name}`);
    };
    img.src = URL.createObjectURL(file);
    decoyImgInput.value = '';
  });

  btnToggleDecoy.addEventListener('click', () => {
    setDecoyActive(!decoyActive);
    addLog('admin', `Decoy image ${decoyActive ? 'activated' : 'deactivated'}`);
  });

  const btnRealCamWait = document.getElementById('btnRealCamWait');
  btnRealCamWait.addEventListener('click', async () => {
    if (!realCamTrack) {
      try {
        realCamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        realCamTrack = realCamStream.getVideoTracks()[0];
        if (!realCamVideoEl) {
          realCamVideoEl = document.createElement('video');
          realCamVideoEl.muted = true;
          realCamVideoEl.autoplay = true;
          realCamVideoEl.playsInline = true;
          realCamVideoEl.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.001;pointer-events:none;z-index:-1;';
          document.body.appendChild(realCamVideoEl);
        }
        realCamVideoEl.srcObject = realCamStream;
        realCamVideoEl.onloadeddata = () => updateVideoRoutes();
        realCamVideoEl.play().catch(() => {});
        btnRealCamWait.classList.add('active');
        btnRealCamWait.textContent = 'Real Cam ON';
        updateVideoRoutes();
        addLog('admin', 'Real webcam enabled for waiting slots');
      } catch (err) {
        addLog('error', `Real webcam error: ${err.message}`);
      }
    } else {
      realCamStream?.getTracks().forEach((t) => t.stop());
      realCamStream = null;
      realCamTrack = null;
      if (realCamVideoEl) realCamVideoEl.srcObject = null;
      btnRealCamWait.classList.remove('active');
      btnRealCamWait.textContent = 'Real Cam (Wait)';
      updateVideoRoutes();
      addLog('admin', 'Real webcam disabled');
    }
  });

  // --- Admin Mic ---
  const btnEnableMic = document.getElementById('btnEnableMic');
  const btnMicToA = document.getElementById('btnMicToA');
  const btnMicToB = document.getElementById('btnMicToB');
  const smEnableMic = document.getElementById('smEnableMic');
  const smMicToA = document.getElementById('smMicToA');
  const smMicToB = document.getElementById('smMicToB');
  const smMicMon = document.getElementById('smMicMon');
  const micSelect = document.getElementById('micSelect');
  const smMicSelect = document.getElementById('smMicSelect');
  let micStream = null;
  let micSourceNode = null;
  let selectedMicId = '';

  async function refreshMicList() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');
      [micSelect, smMicSelect].forEach((sel) => {
        if (!sel) return;
        sel.innerHTML = '<option value="">Default Mic</option>';
        inputs.forEach((d, idx) => {
          const opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = d.label || `Microphone ${idx + 1}`;
          if (d.deviceId === selectedMicId) opt.selected = true;
          sel.appendChild(opt);
        });
      });
    } catch (_) {}
  }

  refreshMicList();
  navigator.mediaDevices?.addEventListener?.('devicechange', refreshMicList);

  async function startAdminMic() {
    if (micSourceNode) {
      try {
        micSourceNode.disconnect();
      } catch (_) {}
      micSourceNode = null;
    }
    micStream?.getTracks().forEach((t) => t.stop());

    const audioConstraint = selectedMicId ? { deviceId: { exact: selectedMicId } } : true;
    micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: false });
    micSourceNode = audioCtx.createMediaStreamSource(micStream);
    micSourceNode.connect(analyserMic);
    micSourceNode.connect(gainMicToA);
    micSourceNode.connect(gainMicToB);
    micSourceNode.connect(gainMicMonitor);
    await refreshMicList();
  }

  async function onMicSelectChange(newId) {
    selectedMicId = newId;
    if (micSelect) micSelect.value = newId;
    if (smMicSelect) smMicSelect.value = newId;
    if (state.micEnabled) {
      try {
        await startAdminMic();
        addLog('admin', `Switched Admin Mic to ${micSelect.options[micSelect.selectedIndex]?.text || 'Default'}`);
      } catch (err) {
        addLog('error', `Mic switch failed: ${err.message}`);
      }
    }
  }

  micSelect.addEventListener('change', (e) => onMicSelectChange(e.target.value));
  smMicSelect.addEventListener('change', (e) => onMicSelectChange(e.target.value));

  async function toggleAdminMic() {
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    if (!state.micEnabled) {
      try {
        await startAdminMic();
        state.micEnabled = true;
        [btnEnableMic, smEnableMic].forEach((b) => {
          b.textContent = 'Mic Active';
          b.classList.add('btn-primary');
        });
        [btnMicToA, btnMicToB, smMicToA, smMicToB, smMicMon].forEach((b) => (b.disabled = false));
        updateAudioGains();
      } catch (err) {
        alert('Could not access microphone: ' + err.message);
      }
    } else {
      if (micSourceNode) {
        try {
          micSourceNode.disconnect();
        } catch (_) {}
        micSourceNode = null;
      }
      micStream?.getTracks().forEach((t) => t.stop());
      micStream = null;
      state.micEnabled = false;
      state.micToA = false;
      state.micToB = false;
      state.micMon = false;
      [btnEnableMic, smEnableMic].forEach((b) => {
        b.textContent = 'Enable Mic';
        b.classList.remove('btn-primary');
      });
      [btnMicToA, btnMicToB, smMicToA, smMicToB, smMicMon].forEach((b) => {
        b.classList.remove('active');
        b.disabled = true;
      });
      updateAudioGains();
    }
  }

  btnEnableMic.addEventListener('click', toggleAdminMic);
  smEnableMic.addEventListener('click', toggleAdminMic);

  bindToggle('btnMicToA', 'micToA', null, null, updateAudioGains);
  bindToggle('btnMicToB', 'micToB', null, null, updateAudioGains);

  // --- Soundboard (MyInstants Categories & Custom Audio Files) ---
  const activeSfxNodes = new Set();
  const customSounds = [];

  function stopAllSfx() {
    for (const node of activeSfxNodes) {
      try {
        node.stop();
      } catch (_) {}
    }
    activeSfxNodes.clear();
  }

  document.querySelectorAll('.sb-tgt').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tgt = btn.dataset.target;
      state.sfxToA = tgt === 'both' || tgt === 'A';
      state.sfxToB = tgt === 'both' || tgt === 'B';
      updateAudioGains();
    });
  });

  document.getElementById('volSfx').addEventListener('input', (e) => {
    state.sfxVol = parseFloat(e.target.value);
    updateAudioGains();
  });

  document.getElementById('btnStopSfx').addEventListener('click', stopAllSfx);

  const sfxFileInput = document.getElementById('sfxFileInput');
  const sbGrid = document.getElementById('sbGrid');
  const sbSearchInput = document.getElementById('sbSearchInput');
  const btnLoadInstants = document.getElementById('btnLoadInstants');
  const audioBufferCache = new Map();

  function playDecodedBuffer(buf) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(sfxMasterGain);
    src.start();
    activeSfxNodes.add(src);
  }

  function renderCustomSounds() {
    sbGrid.innerHTML = '';
    if (customSounds.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--muted);font-size:12px;grid-column:1/-1;padding:12px 4px;';
      empty.textContent = 'No custom audio files loaded yet. Click "+ File" to add MP3/WAV.';
      sbGrid.appendChild(empty);
      return;
    }
    for (const item of customSounds) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sb';
      btn.textContent = item.name;
      btn.title = item.name;
      btn.addEventListener('click', () => playDecodedBuffer(item.buf));
      sbGrid.appendChild(btn);
    }
  }

  document.getElementById('btnUploadSfx').addEventListener('click', () => sfxFileInput.click());

  sfxFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const arrayBuf = await file.arrayBuffer();
    const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
    customSounds.push({ name: file.name.slice(0, 22), buf: audioBuf });
    if (state.sbCategory === 'custom') {
      renderCustomSounds();
    } else {
      document.querySelector('.sb-cat[data-cat="custom"]')?.click();
    }
    sfxFileInput.value = '';
  });

  async function loadMyInstants(query = '', category = state.sbCategory) {
    if (category === 'custom' && !query.trim()) {
      renderCustomSounds();
      return;
    }
    btnLoadInstants.disabled = true;
    btnLoadInstants.textContent = '...';
    try {
      const items = await window.omeAdmin.fetchMyInstants({ query, category });
      sbGrid.innerHTML = '';

      for (const item of items) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sb btn-sb-remote';
        btn.textContent = item.name;
        btn.title = item.name;
        btn.addEventListener('click', async () => {
          try {
            let buf = audioBufferCache.get(item.url);
            if (!buf) {
              btn.textContent = 'Loading...';
              const bytes = await window.omeAdmin.fetchAudio(item.url);
              const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
              buf = await audioCtx.decodeAudioData(ab);
              audioBufferCache.set(item.url, buf);
              btn.textContent = item.name;
            }
            playDecodedBuffer(buf);
          } catch (err) {
            btn.textContent = item.name;
            addLog('error', `Audio load failed (${item.name}): ${err.message}`);
          }
        });
        sbGrid.appendChild(btn);
      }
      addLog('admin', `Loaded ${items.length} sounds (${query ? `search: ${query}` : category})`);
    } catch (err) {
      addLog('error', `MyInstants fetch failed: ${err.message}`);
    } finally {
      btnLoadInstants.disabled = false;
      btnLoadInstants.textContent = 'Fetch';
    }
  }

  document.querySelectorAll('.sb-cat').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sb-cat').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.sbCategory = btn.dataset.cat;
      sbSearchInput.value = '';
      loadMyInstants('', state.sbCategory);
    });
  });

  btnLoadInstants.addEventListener('click', () => loadMyInstants(sbSearchInput.value, state.sbCategory));
  sbSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadMyInstants(sbSearchInput.value, state.sbCategory);
  });

  // Auto-load default MyInstants category on startup
  loadMyInstants('', 'sfx');

  // --- Dedicated Sound Mixer Bindings ---
  bindToggle('smAudAtoB', 'audAtoB', null, null, updateAudioGains);
  bindToggle('smAudBtoA', 'audBtoA', null, null, updateAudioGains);
  bindToggle('smMonA', 'monitorA', null, null, updateAudioGains);
  bindToggle('smMonB', 'monitorB', null, null, updateAudioGains);
  bindToggle('smMicToA', 'micToA', null, null, updateAudioGains);
  bindToggle('smMicToB', 'micToB', null, null, updateAudioGains);
  bindToggle('smMicMon', 'micMon', null, null, updateAudioGains);
  bindToggle('smSfxToA', 'sfxToA', null, null, updateAudioGains);
  bindToggle('smSfxToB', 'sfxToB', null, null, updateAudioGains);

  document.getElementById('smVolAtoB').addEventListener('input', (e) => {
    state.volAtoB = parseFloat(e.target.value);
    updateAudioGains();
  });
  document.getElementById('smVolBtoA').addEventListener('input', (e) => {
    state.volBtoA = parseFloat(e.target.value);
    updateAudioGains();
  });
  document.getElementById('smVolMonA').addEventListener('input', (e) => {
    state.monVolA = parseFloat(e.target.value);
    updateAudioGains();
  });
  document.getElementById('smVolMonB').addEventListener('input', (e) => {
    state.monVolB = parseFloat(e.target.value);
    updateAudioGains();
  });
  document.getElementById('smVolMic').addEventListener('input', (e) => {
    state.micVol = parseFloat(e.target.value);
    updateAudioGains();
  });
  document.getElementById('smVolSfx').addEventListener('input', (e) => {
    state.sfxVol = parseFloat(e.target.value);
    updateAudioGains();
  });
  document.getElementById('smVolSfxMon').addEventListener('input', (e) => {
    state.sfxMonVol = parseFloat(e.target.value);
    updateAudioGains();
  });
  document.getElementById('smMasterA').addEventListener('input', (e) => {
    state.masterA = parseFloat(e.target.value);
    updateAudioGains();
  });
  document.getElementById('smMasterB').addEventListener('input', (e) => {
    state.masterB = parseFloat(e.target.value);
    updateAudioGains();
  });
  document.getElementById('smStopSfx').addEventListener('click', stopAllSfx);

  const smMuteAllOut = document.getElementById('smMuteAllOut');
  smMuteAllOut.addEventListener('click', () => {
    state.muteAllOut = !state.muteAllOut;
    smMuteAllOut.textContent = state.muteAllOut ? 'UNMUTE ALL OUTBOUND' : 'Mute All Outbound';
    smMuteAllOut.classList.toggle('btn-primary', state.muteAllOut);
    smMuteAllOut.classList.toggle('btn-danger', !state.muteAllOut);
    updateAudioGains();
  });

  // --- Settings Modal ---
  const modal = document.getElementById('settingsModal');
  document.getElementById('btnSettings').addEventListener('click', () => {
    window.omeAdmin.setViewsVisible(false);
    modal.classList.remove('hidden');
  });
  document.getElementById('btnCloseModal').addEventListener('click', () => {
    modal.classList.add('hidden');
    window.omeAdmin.setViewsVisible(true);
  });

  document.getElementById('btnSaveProxyA').addEventListener('click', async () => {
    const val = document.getElementById('proxyAInput').value;
    await window.omeAdmin.setProxy('A', val);
    window.omeAdmin.reloadSlot('A');
  });
  document.getElementById('btnSaveProxyB').addEventListener('click', async () => {
    const val = document.getElementById('proxyBInput').value;
    await window.omeAdmin.setProxy('B', val);
    window.omeAdmin.reloadSlot('B');
  });

  document.getElementById('btnClearA').addEventListener('click', () => window.omeAdmin.clearSession('A'));
  document.getElementById('btnClearB').addEventListener('click', () => window.omeAdmin.clearSession('B'));

  document.getElementById('btnDevA').addEventListener('click', () => window.omeAdmin.openDevTools('A'));
  document.getElementById('btnDevB').addEventListener('click', () => window.omeAdmin.openDevTools('B'));
  document.getElementById('btnDevAdmin').addEventListener('click', () => window.omeAdmin.openDevTools('admin'));

  // --- Dashboard Tabs & Log Console Controls ---
  const tabMixer = document.getElementById('tabMixer');
  const tabSoundMixer = document.getElementById('tabSoundMixer');
  const tabVideoMixer = document.getElementById('tabVideoMixer');
  const tabLogs = document.getElementById('tabLogs');
  const mixerDeck = document.getElementById('mixerDeck');
  const soundMixerDeck = document.getElementById('soundMixerDeck');
  const videoMixerDeck = document.getElementById('videoMixerDeck');
  const logsDeck = document.getElementById('logsDeck');

  function showDeckTab(active) {
    tabMixer.classList.toggle('active', active === 'mixer');
    tabSoundMixer.classList.toggle('active', active === 'sound');
    tabVideoMixer.classList.toggle('active', active === 'video');
    tabLogs.classList.toggle('active', active === 'logs');
    mixerDeck.classList.toggle('hidden', active !== 'mixer');
    soundMixerDeck.classList.toggle('hidden', active !== 'sound');
    videoMixerDeck.classList.toggle('hidden', active !== 'video');
    logsDeck.classList.toggle('hidden', active !== 'logs');
    if (active === 'logs') renderLogs();
  }

  tabMixer.addEventListener('click', () => showDeckTab('mixer'));
  tabSoundMixer.addEventListener('click', () => showDeckTab('sound'));
  tabVideoMixer.addEventListener('click', () => showDeckTab('video'));
  tabLogs.addEventListener('click', () => showDeckTab('logs'));

  // --- Video Mixer (OBS-style FX) Controls ---
  const btnToggleVideoFx = document.getElementById('btnToggleVideoFx');
  const vmActiveCount = document.getElementById('vmActiveCount');
  const vmPreviewCanvas = document.getElementById('vmPreviewCanvas');
  const vmPreviewCtx = vmPreviewCanvas.getContext('2d');

  function syncVideoFxButton() {
    btnToggleVideoFx.classList.toggle('active', videoFx.enabled);
    btnToggleVideoFx.textContent = videoFx.enabled ? 'Video FX: ON' : 'Video FX: OFF';
  }

  btnToggleVideoFx.addEventListener('click', () => {
    videoFx.enabled = !videoFx.enabled;
    syncVideoFxButton();
    updateVideoRoutes();
  });

  function refreshVideoMixerStatus(autoEnable = false) {
    if (autoEnable && hasAnyVideoFx()) {
      videoFx.enabled = true;
    } else if (!hasAnyVideoFx()) {
      videoFx.enabled = false;
    }
    syncVideoFxButton();
    const activePresets = Object.values(videoFx.presets).filter(Boolean).length
      + (videoFx.textActive ? 1 : 0);
    vmActiveCount.textContent = `${activePresets} Active`;
    vmActiveCount.className = `badge ${videoFx.enabled && activePresets > 0 ? 'badge-ok' : 'badge-idle'}`;
    updateVideoRoutes();
  }

  document.querySelectorAll('.vm-fx-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fx = btn.dataset.fx;
      videoFx.presets[fx] = !videoFx.presets[fx];
      btn.classList.toggle('active', videoFx.presets[fx]);
      refreshVideoMixerStatus(videoFx.presets[fx]);
    });
  });

  const vmApplyA = document.getElementById('vmApplyA');
  const vmApplyB = document.getElementById('vmApplyB');
  vmApplyA.addEventListener('click', () => {
    videoFx.applyA = !videoFx.applyA;
    vmApplyA.classList.toggle('active', videoFx.applyA);
    updateVideoRoutes();
  });
  vmApplyB.addEventListener('click', () => {
    videoFx.applyB = !videoFx.applyB;
    vmApplyB.classList.toggle('active', videoFx.applyB);
    updateVideoRoutes();
  });

  const vmPreviewSrcA = document.getElementById('vmPreviewSrcA');
  const vmPreviewSrcB = document.getElementById('vmPreviewSrcB');
  vmPreviewSrcA.addEventListener('click', () => {
    videoFx.previewSlot = 'A';
    vmPreviewSrcA.classList.add('active');
    vmPreviewSrcB.classList.remove('active');
  });
  vmPreviewSrcB.addEventListener('click', () => {
    videoFx.previewSlot = 'B';
    vmPreviewSrcB.classList.add('active');
    vmPreviewSrcA.classList.remove('active');
  });

  const vmSliders = [
    { id: 'vmBright', valId: 'vmValBright', key: 'bright', unit: '%', def: 100 },
    { id: 'vmContrast', valId: 'vmValContrast', key: 'contrast', unit: '%', def: 100 },
    { id: 'vmSat', valId: 'vmValSat', key: 'sat', unit: '%', def: 100 },
    { id: 'vmHue', valId: 'vmValHue', key: 'hue', unit: '°', def: 0 },
    { id: 'vmBlur', valId: 'vmValBlur', key: 'blur', unit: 'px', def: 0 },
    { id: 'vmShake', valId: 'vmValShake', key: 'shake', unit: '%', def: 0 }
  ];

  for (const s of vmSliders) {
    const input = document.getElementById(s.id);
    const label = document.getElementById(s.valId);
    input.addEventListener('input', () => {
      videoFx[s.key] = parseInt(input.value, 10) || 0;
      label.textContent = `${videoFx[s.key]}${s.unit}`;
      refreshVideoMixerStatus(videoFx[s.key] !== s.def);
    });
  }

  function resetColorSliders() {
    for (const s of vmSliders) {
      videoFx[s.key] = s.def;
      document.getElementById(s.id).value = String(s.def);
      document.getElementById(s.valId).textContent = `${s.def}${s.unit}`;
    }
  }

  document.getElementById('vmResetColor').addEventListener('click', () => {
    resetColorSliders();
    updateVideoRoutes();
  });

  const vmToggleText = document.getElementById('vmToggleText');
  const vmOverlayText = document.getElementById('vmOverlayText');
  vmToggleText.addEventListener('click', () => {
    videoFx.textActive = !videoFx.textActive;
    vmToggleText.classList.toggle('active', videoFx.textActive);
    refreshVideoMixerStatus(videoFx.textActive);
  });
  vmOverlayText.addEventListener('input', () => {
    videoFx.overlayText = vmOverlayText.value;
  });

  document.getElementById('vmClearFx').addEventListener('click', () => {
    for (const key of Object.keys(videoFx.presets)) {
      videoFx.presets[key] = false;
    }
    document.querySelectorAll('.vm-fx-btn').forEach((b) => b.classList.remove('active'));
    resetColorSliders();
    videoFx.textActive = false;
    vmToggleText.classList.remove('active');
    refreshVideoMixerStatus();
  });

  setInterval(() => {
    if (videoMixerDeck.classList.contains('hidden')) return;
    const srcId = videoFx.previewSlot;
    if (decoyActive && decoyImg) {
      renderProcessedVideoFrame(vmPreviewCtx, vmPreviewCanvas, decoyImg, srcId, performance.now(), true);
      return;
    }
    const video = slots[srcId]?.previewEl;
    if (video && video.readyState >= 2 && video.videoWidth) {
      renderProcessedVideoFrame(vmPreviewCtx, vmPreviewCanvas, video, srcId, performance.now());
      return;
    }
    if (realCamTrack && realCamVideoEl && realCamVideoEl.readyState >= 2 && realCamVideoEl.videoWidth) {
      renderProcessedVideoFrame(vmPreviewCtx, vmPreviewCanvas, realCamVideoEl, srcId, performance.now());
      return;
    }
    vmPreviewCtx.fillStyle = '#090c12';
    vmPreviewCtx.fillRect(0, 0, vmPreviewCanvas.width, vmPreviewCanvas.height);
    vmPreviewCtx.fillStyle = '#52525b';
    vmPreviewCtx.font = 'bold 12px sans-serif';
    vmPreviewCtx.textAlign = 'center';
    vmPreviewCtx.textBaseline = 'middle';
    vmPreviewCtx.fillText(`Waiting for Slot ${srcId} video / Decoy / Real Cam...`, vmPreviewCanvas.width / 2, vmPreviewCanvas.height / 2);
  }, 40);

  document.querySelectorAll('.log-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.log-filter').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeLogFilter = btn.dataset.filter;
      renderLogs();
    });
  });

  document.getElementById('btnClearLogs').addEventListener('click', () => {
    logEntries.length = 0;
    renderLogs();
  });

  document.getElementById('btnCopyLogs').addEventListener('click', async () => {
    const text = logEntries.map((e) => `[${e.time}] [${e.tag.toUpperCase()}] ${e.msg}`).join('\n');
    await navigator.clipboard.writeText(text).catch(() => {});
  });

  // --- Keybinds Modal & Global Shortcut Engine ---
  const KEYBINDS_STORAGE_KEY = 'ometroll_keybinds_v1';
  const BUILTIN_KEYBIND_ACTIONS = [
    { group: 'Router & Slots', id: 'btnStartBoth', label: 'Start Both' },
    { group: 'Router & Slots', id: 'btnNextBoth', label: 'Next Both' },
    { group: 'Router & Slots', id: 'btnNextA', label: 'Next Stranger A' },
    { group: 'Router & Slots', id: 'btnNextB', label: 'Next Stranger B' },
    { group: 'Router & Slots', id: 'btnBlackoutA', label: 'Blackout A' },
    { group: 'Router & Slots', id: 'btnBlackoutB', label: 'Blackout B' },
    { group: 'Router & Slots', id: 'btnFlipA', label: 'Flip A' },
    { group: 'Router & Slots', id: 'btnFlipB', label: 'Flip B' },
    { group: 'Router & Slots', id: 'btnMonitorA', label: 'Monitoring A' },
    { group: 'Router & Slots', id: 'btnMonitorB', label: 'Monitoring B' },
    { group: 'Router & Slots', id: 'btnVidAtoB', label: 'Cam A -> B' },
    { group: 'Router & Slots', id: 'btnAudAtoB', label: 'Mic A -> B' },
    { group: 'Router & Slots', id: 'btnVidBtoA', label: 'Cam B -> A' },
    { group: 'Router & Slots', id: 'btnAudBtoA', label: 'Mic B -> A' },
    { group: 'Router & Slots', id: 'btnLoadDecoy', label: 'Load Decoy Image' },
    { group: 'Router & Slots', id: 'btnToggleDecoy', label: 'Toggle Decoy' },
    { group: 'Router & Slots', id: 'btnRealCamWait', label: 'Real Cam (Wait)' },
    { group: 'Router & Slots', id: 'btnToggleVideoFx', label: 'Video FX: ON / OFF' },

    { group: 'Admin Mic', id: 'btnEnableMic', label: 'Enable / Disable Mic' },
    { group: 'Admin Mic', id: 'btnMicToA', label: 'Talk -> A' },
    { group: 'Admin Mic', id: 'btnMicToB', label: 'Talk -> B' },

    { group: 'Soundboard & Mixer', id: 'btnStopSfx', label: 'Stop Soundboard SFX' },
    { group: 'Soundboard & Mixer', id: 'btnLoadInstants', label: 'Fetch MyInstants' },
    { group: 'Soundboard & Mixer', id: 'btnUploadSfx', label: 'Upload Custom SFX' },
    { group: 'Soundboard & Mixer', id: 'smStopSfx', label: 'Mixer: Stop All SFX' },
    { group: 'Soundboard & Mixer', id: 'smMuteAllOut', label: 'Mixer: Mute All Outbound' },
    { group: 'Soundboard & Mixer', id: 'smSfxToA', label: 'Mixer: SFX -> A' },
    { group: 'Soundboard & Mixer', id: 'smSfxToB', label: 'Mixer: SFX -> B' },
    { group: 'Soundboard & Mixer', id: 'smMicMon', label: 'Mixer: Mic Self-Monitor' },

    { group: 'Navigation & Tabs', id: 'btnLoadBoth', label: 'Load URL' },
    { group: 'Navigation & Tabs', id: 'btnReloadA', label: 'Reload Slot A' },
    { group: 'Navigation & Tabs', id: 'btnReloadB', label: 'Reload Slot B' },
    { group: 'Navigation & Tabs', id: 'tabMixer', label: 'Tab: Deck' },
    { group: 'Navigation & Tabs', id: 'tabSoundMixer', label: 'Tab: Sound Mixer' },
    { group: 'Navigation & Tabs', id: 'tabVideoMixer', label: 'Tab: Video Mixer' },
    { group: 'Navigation & Tabs', id: 'tabLogs', label: 'Tab: Logs' },

    { group: 'Video Mixer (OBS)', id: 'vmFxDisco', label: 'FX: Disco' },
    { group: 'Video Mixer (OBS)', id: 'vmFxStrobe', label: 'FX: Strobe' },
    { group: 'Video Mixer (OBS)', id: 'vmFxGlitch', label: 'FX: Glitch / VHS' },
    { group: 'Video Mixer (OBS)', id: 'vmFxCrt', label: 'FX: CRT Retro' },
    { group: 'Video Mixer (OBS)', id: 'vmFxInvert', label: 'FX: Invert' },
    { group: 'Video Mixer (OBS)', id: 'vmFxNoir', label: 'FX: B&W Noir' },
    { group: 'Video Mixer (OBS)', id: 'vmFxThermal', label: 'FX: Thermal' },
    { group: 'Video Mixer (OBS)', id: 'vmFxPixelate', label: 'FX: Pixelate' },
    { group: 'Video Mixer (OBS)', id: 'vmFxMirror', label: 'FX: Mirror Split' },
    { group: 'Video Mixer (OBS)', id: 'vmFxWobble', label: 'FX: Wobble' },
    { group: 'Video Mixer (OBS)', id: 'vmFxRec', label: 'Overlay: REC Cam' },
    { group: 'Video Mixer (OBS)', id: 'vmFxWasted', label: 'Overlay: WASTED' },
    { group: 'Video Mixer (OBS)', id: 'vmFxCensor', label: 'Overlay: Censored' },
    { group: 'Video Mixer (OBS)', id: 'vmToggleText', label: 'Overlay: Custom Text' },
    { group: 'Video Mixer (OBS)', id: 'vmClearFx', label: 'Video Mixer: Reset All FX' }
  ];

  // Stored format: { [actionKey]: { label, target: { type: 'id', id } | { type: 'soundboard', text }, bind: { code, ctrl, alt, shift, meta } } }
  let keybindsMap = {};
  try {
    const raw = localStorage.getItem(KEYBINDS_STORAGE_KEY);
    if (raw) keybindsMap = JSON.parse(raw) || {};
  } catch (_) {}

  const keybindsModal = document.getElementById('keybindsModal');
  const keybindsList = document.getElementById('keybindsList');
  const pickBindBanner = document.getElementById('pickBindBanner');
  let recordingActionKey = null;
  let pickMode = false;

  function saveKeybinds() {
    try {
      localStorage.setItem(KEYBINDS_STORAGE_KEY, JSON.stringify(keybindsMap));
    } catch (_) {}
  }

  function formatKeyCombo(bind) {
    if (!bind || !bind.code) return 'Unbound';
    const parts = [];
    if (bind.ctrl) parts.push('Ctrl');
    if (bind.alt) parts.push('Alt');
    if (bind.shift) parts.push('Shift');
    if (bind.meta) parts.push('Cmd');
    let keyName = bind.code;
    if (keyName.startsWith('Key')) keyName = keyName.slice(3);
    else if (keyName.startsWith('Digit')) keyName = keyName.slice(5);
    else if (keyName.startsWith('Numpad')) keyName = 'Num ' + keyName.slice(6);
    else if (keyName.startsWith('Arrow')) keyName = keyName.slice(5);
    parts.push(keyName);
    return parts.join(' + ');
  }

  function normalizeKeyboardInput(e) {
    const code = e.code || '';
    if (!code || ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(code)) {
      return null;
    }
    return {
      code,
      ctrl: !!(e.ctrlKey || e.control),
      alt: !!(e.altKey || e.alt),
      shift: !!(e.shiftKey || e.shift),
      meta: !!(e.metaKey || e.meta)
    };
  }

  function isSameCombo(a, b) {
    return a && b && a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.meta === !!b.meta;
  }

  function resolveTargetElement(target) {
    if (!target) return null;
    if (target.type === 'id') return document.getElementById(target.id);
    if (target.type === 'soundboard') {
      const pads = document.querySelectorAll('#sbGrid button');
      for (const pad of pads) {
        if (pad.textContent.trim() === target.text) return pad;
      }
    }
    if (target.type === 'selector') return document.querySelector(target.selector);
    return null;
  }

  function renderKeybindsList() {
    keybindsList.innerHTML = '';

    const groups = new Map();
    for (const item of BUILTIN_KEYBIND_ACTIONS) {
      if (!groups.has(item.group)) groups.set(item.group, []);
      groups.get(item.group).push({
        actionKey: `id:${item.id}`,
        label: item.label,
        target: { type: 'id', id: item.id }
      });
    }

    const customItems = [];
    for (const [actionKey, entry] of Object.entries(keybindsMap)) {
      if (!actionKey.startsWith('id:') || !BUILTIN_KEYBIND_ACTIONS.some((b) => `id:${b.id}` === actionKey)) {
        customItems.push({ actionKey, label: entry.label || actionKey, target: entry.target });
      }
    }
    if (customItems.length > 0) {
      groups.set('Custom / Soundboard', customItems);
    }

    for (const [groupName, items] of groups.entries()) {
      const titleEl = document.createElement('div');
      titleEl.className = 'kb-group-title';
      titleEl.textContent = groupName;
      keybindsList.appendChild(titleEl);

      for (const item of items) {
        const entry = keybindsMap[item.actionKey];
        const bind = entry ? entry.bind : null;
        const isRec = recordingActionKey === item.actionKey;

        const row = document.createElement('div');
        row.className = 'kb-row';

        const lbl = document.createElement('span');
        lbl.className = 'kb-label';
        lbl.textContent = item.label;

        const ctrls = document.createElement('div');
        ctrls.className = 'kb-controls';

        const bindBtn = document.createElement('button');
        bindBtn.className = `btn btn-xs kb-btn ${isRec ? 'recording' : bind ? 'bound' : 'btn-ghost'}`;
        bindBtn.textContent = isRec ? 'Press key...' : formatKeyCombo(bind);
        bindBtn.addEventListener('click', () => {
          recordingActionKey = item.actionKey;
          if (!keybindsMap[item.actionKey]) {
            keybindsMap[item.actionKey] = { label: item.label, target: item.target, bind: null };
          }
          renderKeybindsList();
        });

        const clearBtn = document.createElement('button');
        clearBtn.className = 'btn btn-xs btn-ghost';
        clearBtn.textContent = '×';
        clearBtn.title = 'Clear keybind';
        clearBtn.disabled = !bind && !actionKeyIsCustom(item.actionKey);
        clearBtn.addEventListener('click', () => {
          if (recordingActionKey === item.actionKey) recordingActionKey = null;
          delete keybindsMap[item.actionKey];
          saveKeybinds();
          renderKeybindsList();
        });

        ctrls.appendChild(bindBtn);
        ctrls.appendChild(clearBtn);
        row.appendChild(lbl);
        row.appendChild(ctrls);
        keybindsList.appendChild(row);
      }
    }
  }

  function actionKeyIsCustom(actionKey) {
    return !BUILTIN_KEYBIND_ACTIONS.some((b) => `id:${b.id}` === actionKey);
  }

  function openKeybindsModal() {
    recordingActionKey = null;
    window.omeAdmin.setViewsVisible(false);
    keybindsModal.classList.remove('hidden');
    renderKeybindsList();
  }

  function closeKeybindsModal() {
    recordingActionKey = null;
    keybindsModal.classList.add('hidden');
    if (modal.classList.contains('hidden')) {
      window.omeAdmin.setViewsVisible(true);
    }
  }

  function setPickMode(enabled) {
    pickMode = enabled;
    document.body.classList.toggle('kb-picking', enabled);
    pickBindBanner.classList.toggle('hidden', !enabled);
    if (enabled) {
      keybindsModal.classList.add('hidden');
      window.omeAdmin.setViewsVisible(true);
    }
  }

  document.getElementById('btnKeybinds').addEventListener('click', openKeybindsModal);
  document.getElementById('btnCloseKeybinds').addEventListener('click', closeKeybindsModal);
  document.getElementById('btnResetKeybinds').addEventListener('click', () => {
    keybindsMap = {};
    recordingActionKey = null;
    saveKeybinds();
    renderKeybindsList();
  });
  document.getElementById('btnPickButtonBind').addEventListener('click', () => {
    setPickMode(true);
  });

  // Intercept any button click when Pick Mode is active
  document.addEventListener('click', (e) => {
    if (!pickMode) return;
    const btn = e.target.closest('button');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    let actionKey;
    let label;
    let target;

    if (btn.id) {
      actionKey = `id:${btn.id}`;
      const builtin = BUILTIN_KEYBIND_ACTIONS.find((b) => b.id === btn.id);
      label = builtin ? builtin.label : (btn.textContent.trim() || btn.title || btn.id);
      target = { type: 'id', id: btn.id };
    } else if (btn.closest('#sbGrid')) {
      const text = btn.textContent.trim();
      actionKey = `sb:${text}`;
      label = `SFX: ${text}`;
      target = { type: 'soundboard', text };
    } else {
      const text = btn.textContent.trim() || 'Button';
      const idx = Array.from(document.querySelectorAll('button')).indexOf(btn);
      const selector = `button:nth-of-type(${idx + 1})`;
      actionKey = `custom:${text}:${idx}`;
      label = text;
      target = { type: 'selector', selector };
    }

    if (!keybindsMap[actionKey]) {
      keybindsMap[actionKey] = { label, target, bind: null };
    }
    setPickMode(false);
    openKeybindsModal();
    recordingActionKey = actionKey;
    renderKeybindsList();
  }, true);

  function handleKeybindTrigger(combo, fromInputOrSlot) {
    // When typing in an input or inside a browser slot, only allow combos with Ctrl/Alt/Meta or F1-F12
    const isFunctionKey = /^F\d{1,2}$/.test(combo.code);
    const hasModifier = combo.ctrl || combo.alt || combo.meta;
    if (fromInputOrSlot && !hasModifier && !isFunctionKey) return false;

    for (const entry of Object.values(keybindsMap)) {
      if (entry && entry.bind && isSameCombo(entry.bind, combo)) {
        const el = resolveTargetElement(entry.target);
        if (el) {
          el.click();
          return true;
        }
      }
    }
    return false;
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;

    if (pickMode) {
      if (e.code === 'Escape') {
        e.preventDefault();
        setPickMode(false);
        openKeybindsModal();
      }
      return;
    }

    if (recordingActionKey) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        if (!keybindsMap[recordingActionKey]?.bind) {
          delete keybindsMap[recordingActionKey];
        }
        recordingActionKey = null;
        renderKeybindsList();
        return;
      }
      if ((e.code === 'Backspace' || e.code === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        delete keybindsMap[recordingActionKey];
        recordingActionKey = null;
        saveKeybinds();
        renderKeybindsList();
        return;
      }
      const combo = normalizeKeyboardInput(e);
      if (!combo) return;
      keybindsMap[recordingActionKey].bind = combo;
      recordingActionKey = null;
      saveKeybinds();
      renderKeybindsList();
      return;
    }

    if (!keybindsModal.classList.contains('hidden')) {
      if (e.code === 'Escape') {
        e.preventDefault();
        closeKeybindsModal();
      }
      return;
    }

    if (!modal.classList.contains('hidden')) {
      if (e.code === 'Escape') {
        e.preventDefault();
        modal.classList.add('hidden');
        window.omeAdmin.setViewsVisible(true);
      }
      return;
    }

    const combo = normalizeKeyboardInput(e);
    if (!combo) return;
    const active = document.activeElement;
    const inTextInput = active && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable);
    if (handleKeybindTrigger(combo, inTextInput)) {
      e.preventDefault();
    }
  });

  if (window.omeAdmin.onSlotKeyDown) {
    window.omeAdmin.onSlotKeyDown((input) => {
      if (pickMode || recordingActionKey) return;
      if (!keybindsModal.classList.contains('hidden') || !modal.classList.contains('hidden')) return;
      const combo = normalizeKeyboardInput(input);
      if (!combo) return;
      handleKeybindTrigger(combo, true);
    });
  }

  updateAudioGains();
})();
