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

  function makeCanvasTrack(label, bgColor = '#09090b', fgColor = '#71717a', allowDecoy = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.001;pointer-events:none;z-index:-1;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const draw = () => {
      if (allowDecoy && decoyActive && decoyImg) {
        const scale = Math.max(canvas.width / decoyImg.width, canvas.height / decoyImg.height);
        const w = decoyImg.width * scale;
        const h = decoyImg.height * scale;
        ctx.drawImage(decoyImg, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        return;
      }
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = fgColor;
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, canvas.width / 2, canvas.height / 2);
    };
    draw();
    setInterval(draw, 66);
    return canvas.captureStream(15).getVideoTracks()[0];
  }

  const waitingTrackForA = makeCanvasTrack('Waiting for Stranger B...', '#09090b', '#71717a', true);
  const waitingTrackForB = makeCanvasTrack('Waiting for Stranger A...', '#09090b', '#71717a', true);
  const blackoutTrack = makeCanvasTrack('Camera Paused', '#000000', '#3f3f46', false);

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
      previewEl: document.getElementById('previewB'),
      statusEl: document.getElementById('statusB')
    }
  };

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

  function getOutboundVideoTrack(sourceSlotId) {
    const slot = slots[sourceSlotId];
    const rawTrack = slot.remoteVideoTrack;
    if (!rawTrack || rawTrack.readyState !== 'live') return null;

    const cropPct = sourceSlotId === 'A' ? state.cropA : state.cropB;
    const flip = sourceSlotId === 'A' ? state.flipA : state.flipB;

    if (cropPct === 0 && !flip) {
      return rawTrack;
    }

    if (!slot.processor) {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(30);
      const track = stream.getVideoTracks()[0];

      const timer = setInterval(() => {
        const video = slot.previewEl;
        if (!video || video.readyState < 2 || !video.videoWidth) return;

        const cPct = sourceSlotId === 'A' ? state.cropA : state.cropB;
        const doFlip = sourceSlotId === 'A' ? state.flipA : state.flipB;
        if (cPct === 0 && !doFlip) return;

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        // Map 0..100% slider to 0..80% edge trim (up to 5x zoom) while preserving aspect ratio
        const trimPct = cPct * 0.8;
        const marginX = (vw * trimPct) / 200;
        const marginY = (vh * trimPct) / 200;
        const sw = Math.max(1, vw - marginX * 2);
        const sh = Math.max(1, vh - marginY * 2);

        const scale = Math.min(canvas.width / sw, canvas.height / sh);
        const dw = sw * scale;
        const dh = sh * scale;
        const dx = (canvas.width - dw) / 2;
        const dy = (canvas.height - dh) / 2;

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        if (doFlip) {
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, marginX, marginY, sw, sh, dx, dy, dw, dh);
        ctx.restore();
      }, 33);

      slot.processor = { canvas, track, timer };
    }

    return slot.processor.track;
  }

  function updateVideoRoutes() {
    const slotA = slots.A;
    const slotB = slots.B;

    if (slotA.videoSender) {
      let trackForA = decoyActive ? waitingTrackForA : realCamTrack || waitingTrackForA;
      if (state.blackoutA) {
        trackForA = blackoutTrack;
      } else if (state.vidBtoA) {
        const processedB = getOutboundVideoTrack('B');
        if (processedB) trackForA = processedB;
      }
      slotA.videoSender.replaceTrack(trackForA).catch(() => {});
    }

    if (slotB.videoSender) {
      let trackForB = decoyActive ? waitingTrackForB : realCamTrack || waitingTrackForB;
      if (state.blackoutB) {
        trackForB = blackoutTrack;
      } else if (state.vidAtoB) {
        const processedA = getOutboundVideoTrack('A');
        if (processedA) trackForB = processedA;
      }
      slotB.videoSender.replaceTrack(trackForB).catch(() => {});
    }
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
        setSlotBadge(slotId, 'Connected', 'ok');
        addLog(slotId, `Stranger connected (call #${status.callId}, video=${status.hasVideo}, audio=${status.hasAudio})`);
        setTimeout(() => {
          const v = slot.previewEl;
          if (v && v.videoWidth) {
            tele[slotId].res = `${v.videoWidth}x${v.videoHeight}`;
            renderTelemetry();
          }
        }, 600);
      } else if (status.state === 'disconnected') {
        setSlotBadge(slotId, 'Waiting', 'idle');
        tele[slotId].res = '—';
        renderTelemetry();
        addLog(slotId, `Stranger disconnected (call #${status.callId})`);
        slot.remoteVideoTrack = null;
        slot.remoteAudioTrack = null;
        slot.previewEl.srcObject = null;
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

  document.getElementById('btnNextA').addEventListener('click', () => window.omeAdmin.domAction('A', 'next'));
  document.getElementById('btnNextB').addEventListener('click', () => window.omeAdmin.domAction('B', 'next'));
  document.getElementById('btnNextBoth').addEventListener('click', () => window.omeAdmin.domAction('both', 'next'));
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
  const tabLogs = document.getElementById('tabLogs');
  const mixerDeck = document.getElementById('mixerDeck');
  const soundMixerDeck = document.getElementById('soundMixerDeck');
  const logsDeck = document.getElementById('logsDeck');

  function showDeckTab(active) {
    tabMixer.classList.toggle('active', active === 'mixer');
    tabSoundMixer.classList.toggle('active', active === 'sound');
    tabLogs.classList.toggle('active', active === 'logs');
    mixerDeck.classList.toggle('hidden', active !== 'mixer');
    soundMixerDeck.classList.toggle('hidden', active !== 'sound');
    logsDeck.classList.toggle('hidden', active !== 'logs');
    if (active === 'logs') renderLogs();
  }

  tabMixer.addEventListener('click', () => showDeckTab('mixer'));
  tabSoundMixer.addEventListener('click', () => showDeckTab('sound'));
  tabLogs.addEventListener('click', () => showDeckTab('logs'));

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

  updateAudioGains();
})();
