(() => {
  if (window.__omeTrollHooked) return;
  window.__omeTrollHooked = true;

  const bridge = window.__omeTroll;
  if (!bridge) {
    console.warn('[OmeTroll] __omeTroll bridge not found in main world');
    return;
  }

  // Differentiate Slot B browser fingerprint so Ome.TV treats A & B as distinct browsers
  if (bridge.slotId === 'B') {
    try {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 6, configurable: true });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 4, configurable: true });
    } catch (_) {}

    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      if (this.width > 0 && this.width < 400 && this.height > 0 && this.height < 200) {
        const ctx = this.getContext('2d');
        if (ctx) {
          try {
            const img = ctx.getImageData(0, 0, 1, 1);
            img.data[0] = (img.data[0] ^ 1) & 255;
            ctx.putImageData(img, 0, 0);
          } catch (_) {}
        }
      }
      return origToDataURL.apply(this, args);
    };
  }

  const NativeRTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;

  // --- Bridge WebRTC state (Slot <-> Admin) ---
  let bridgePC = null;
  let adminVideoTrack = null;
  let adminAudioTrack = null;
  let outboundVideoSender = null;
  let outboundAudioSender = null;

  let currentStrangerVideoTrack = null;
  let currentStrangerAudioTrack = null;
  let localDecoyImg = null;

  // Hidden <video> element so Chromium actively decodes the incoming bridge video track
  const bridgeVideoEl = document.createElement('video');
  bridgeVideoEl.muted = true;
  bridgeVideoEl.autoplay = true;
  bridgeVideoEl.playsInline = true;
  bridgeVideoEl.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.001;pointer-events:none;z-index:-1;';

  function ensureVideoMounted() {
    if (!document.body) return;
    if (bridgeVideoEl.parentNode !== document.body) {
      document.body.appendChild(bridgeVideoEl);
      bridgeVideoEl.play().catch(() => {});
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureVideoMounted, { once: true });
  } else {
    ensureVideoMounted();
  }

  function attachBridgeVideo(track) {
    adminVideoTrack = track;
    ensureVideoMounted();
    bridgeVideoEl.srcObject = new MediaStream([track]);
    bridgeVideoEl.play().catch((err) => {
      bridge.sendStatus({ type: 'video-debug', msg: `play() err: ${err.message}` });
    });
  }

  function createVirtualVideoTrack() {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    let tick = 0;

    const drawFrame = () => {
      if (
        adminVideoTrack &&
        adminVideoTrack.readyState === 'live' &&
        bridgeVideoEl.readyState >= 2 &&
        bridgeVideoEl.videoWidth > 0
      ) {
        // Preserve aspect ratio (no stretching) inside 1280x720
        const vw = bridgeVideoEl.videoWidth;
        const vh = bridgeVideoEl.videoHeight;
        const scale = Math.min(canvas.width / vw, canvas.height / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bridgeVideoEl, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      } else if (localDecoyImg) {
        const scale = Math.max(canvas.width / localDecoyImg.width, canvas.height / localDecoyImg.height);
        const w = localDecoyImg.width * scale;
        const h = localDecoyImg.height * scale;
        ctx.drawImage(localDecoyImg, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      } else {
        tick++;
        ctx.fillStyle = '#0d1017';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        const r = 28;
        const angle = (tick * 0.16) % (Math.PI * 2);
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#e4e4e7';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(cx, cy, r, angle, angle + Math.PI * 1.15);
        ctx.stroke();
        ctx.restore();
      }
    };

    drawFrame();
    const timer = setInterval(drawFrame, 33);
    const stream = canvas.captureStream(30);
    const track = stream.getVideoTracks()[0];

    const origStop = track.stop.bind(track);
    track.stop = () => {
      clearInterval(timer);
      origStop();
    };

    Object.defineProperty(track, 'label', {
      configurable: true,
      get: () => 'HD Pro Webcam C920 (046d:082d)'
    });

    track.getSettings = () => ({
      width: 1280,
      height: 720,
      frameRate: 30,
      aspectRatio: 1280 / 720,
      deviceId: `cam-${devSeed}`,
      facingMode: 'user',
      resizeMode: 'none'
    });

    track.getCapabilities = () => ({
      width: { min: 320, max: 1280 },
      height: { min: 240, max: 720 },
      frameRate: { min: 15, max: 30 },
      deviceId: `cam-${devSeed}`,
      facingMode: ['user']
    });

    return track;
  }

  // --- Persistent Virtual Audio Pipeline (Slot receives Admin mix even if getUserMedia ran early) ---
  const virtualAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const virtualAudioDest = virtualAudioCtx.createMediaStreamDestination();
  const silentOsc = virtualAudioCtx.createOscillator();
  const silentGain = virtualAudioCtx.createGain();
  silentGain.gain.value = 0.0;
  silentOsc.connect(silentGain);
  silentGain.connect(virtualAudioDest);
  silentOsc.start();

  let bridgeAudioSource = null;
  const bridgeAudioEl = document.createElement('audio');
  bridgeAudioEl.muted = true;
  bridgeAudioEl.autoplay = true;
  bridgeAudioEl.playsInline = true;

  function attachBridgeAudio(track) {
    adminAudioTrack = track;
    if (virtualAudioCtx.state === 'suspended') {
      virtualAudioCtx.resume().catch(() => {});
    }
    if (bridgeAudioSource) {
      try {
        bridgeAudioSource.disconnect();
      } catch (_) {}
    }
    const stream = new MediaStream([track]);
    bridgeAudioEl.srcObject = stream;
    bridgeAudioEl.play().catch(() => {});
    bridgeAudioSource = virtualAudioCtx.createMediaStreamSource(stream);
    bridgeAudioSource.connect(virtualAudioDest);
  }

  function createVirtualAudioTrack() {
    if (virtualAudioCtx.state === 'suspended') {
      virtualAudioCtx.resume().catch(() => {});
    }
    const baseTrack = virtualAudioDest.stream.getAudioTracks()[0].clone();

    Object.defineProperty(baseTrack, 'label', {
      configurable: true,
      get: () => 'Default - Microphone (Realtek Audio)'
    });

    baseTrack.getSettings = () => ({
      deviceId: `mic-${devSeed}`,
      sampleRate: 48000,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    });

    return baseTrack;
  }

  let pendingIce = [];

  async function handleAdminOffer(sdp) {
    pendingIce = [];
    if (bridgePC) {
      try {
        bridgePC.close();
      } catch (_) {}
    }

    bridgePC = new NativeRTCPeerConnection({ iceServers: [] });

    bridgePC.onicecandidate = (ev) => {
      if (ev.candidate) {
        bridge.sendSignal({ type: 'ice-candidate', candidate: ev.candidate.toJSON() });
      }
    };

    bridgePC.onconnectionstatechange = () => {
      bridge.sendStatus({ type: 'bridge-state', state: bridgePC.connectionState });
      if (bridgePC.connectionState === 'connected') {
        setTimeout(() => {
          if (bridgeVideoEl.videoWidth === 0) {
            bridge.sendStatus({
              type: 'video-debug',
              msg: `Bridge connected but videoWidth=0 (readyState=${bridgeVideoEl.readyState}, muted=${adminVideoTrack?.muted}, state=${adminVideoTrack?.readyState})`
            });
          }
        }, 2000);
      }
    };

    bridgePC.ontrack = (ev) => {
      if (ev.track.kind === 'video') {
        attachBridgeVideo(ev.track);
      } else if (ev.track.kind === 'audio') {
        attachBridgeAudio(ev.track);
      }
    };

    await bridgePC.setRemoteDescription(new RTCSessionDescription(sdp));
    for (const c of pendingIce) {
      await bridgePC.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
    pendingIce = [];

    const transceivers = bridgePC.getTransceivers();
    outboundVideoSender = null;
    outboundAudioSender = null;
    for (const t of transceivers) {
      t.direction = 'sendrecv';
      if (t.receiver.track?.kind === 'video') {
        outboundVideoSender = t.sender;
      } else if (t.receiver.track?.kind === 'audio') {
        outboundAudioSender = t.sender;
      }
    }

    if (currentStrangerVideoTrack && outboundVideoSender) {
      await outboundVideoSender.replaceTrack(currentStrangerVideoTrack).catch(() => {});
    }
    if (currentStrangerAudioTrack && outboundAudioSender) {
      await outboundAudioSender.replaceTrack(currentStrangerAudioTrack).catch(() => {});
    }

    const answer = await bridgePC.createAnswer();
    await bridgePC.setLocalDescription(answer);
    bridge.sendSignal({ type: 'answer', sdp: bridgePC.localDescription.toJSON() });
  }

  bridge.onSignal(async (msg) => {
    try {
      if (msg.type === 'offer') {
        await handleAdminOffer(msg.sdp);
      } else if (msg.type === 'ice-candidate') {
        if (bridgePC && bridgePC.remoteDescription) {
          await bridgePC.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
        } else {
          pendingIce.push(msg.candidate);
        }
      } else if (msg.type === 'ping-slot') {
        bridge.sendSignal({ type: 'slot-hello' });
      } else if (msg.type === 'dom-action') {
        handleDomAction(msg.action);
      } else if (msg.type === 'set-decoy') {
        if (!msg.dataUrl) {
          localDecoyImg = null;
        } else {
          const img = new Image();
          img.onload = () => {
            localDecoyImg = img;
          };
          img.src = msg.dataUrl;
        }
      }
    } catch (err) {
      console.error('[OmeTroll] Signal handling error:', err);
    }
  });

  bridge.sendSignal({ type: 'slot-hello' });

  // --- DOM helper for Start / Next / Stop actions ---
  function triggerEsc() {
    for (const type of ['keydown', 'keyup']) {
      const evInit = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
      window.dispatchEvent(new KeyboardEvent(type, evInit));
      document.dispatchEvent(new KeyboardEvent(type, evInit));
      if (document.body) document.body.dispatchEvent(new KeyboardEvent(type, evInit));
    }
  }

  function isVisibleEl(el) {
    if (!el || el.disabled) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function clickEl(el) {
    try {
      el.focus?.();
    } catch (_) {}
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  function getElText(el) {
    return (
      el.innerText ||
      el.textContent ||
      el.value ||
      el.getAttribute?.('aria-label') ||
      el.title ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findVisibleButton(selectors, textRegex) {
    if (selectors) {
      const matches = Array.from(document.querySelectorAll(selectors)).filter(isVisibleEl);
      if (textRegex) {
        const filtered = matches.filter((el) => textRegex.test(getElText(el)));
        if (filtered.length > 0) return filtered[0];
      } else if (matches.length > 0) {
        return matches[0];
      }
    }
    if (!textRegex) return null;
    const candidates = Array.from(
      document.querySelectorAll('button, input[type="button"], [role="button"], a, div, span')
    ).filter((el) => {
      if (!isVisibleEl(el)) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width > 420 || rect.height > 150) return false;
      if (el.children.length > 3) return false;
      return textRegex.test(getElText(el));
    });
    // Prefer actual <button> or innermost matching element
    candidates.sort((a, b) => {
      const aBtn = a.tagName === 'BUTTON' || a.getAttribute('role') === 'button' ? 0 : 1;
      const bBtn = b.tagName === 'BUTTON' || b.getAttribute('role') === 'button' ? 0 : 1;
      if (aBtn !== bBtn) return aBtn - bBtn;
      return a.children.length - b.children.length;
    });
    return candidates[0] || null;
  }

  function handleDomAction(action) {
    if (action === 'start') {
      const btn =
        findVisibleButton(
          '.start-button, .btn-start, [data-action="start"], #startbtn, .newchatbtn, .disconnectbtn',
          /^(start|new|new chat|video|start chat|next|další|začít|nový)\b/i
        ) ||
        findVisibleButton('.start-button, .btn-start, [data-action="start"], #startbtn, .newchatbtn', null) ||
        findVisibleButton(null, /^(start|new|new chat|start chat|začít|nový)\b/i);

      if (btn) {
        clickEl(btn);
        bridge.sendStatus({ type: 'video-debug', msg: `Start clicked <${btn.tagName.toLowerCase()}> "${getElText(btn).slice(0, 24)}"` });
      } else {
        triggerEsc();
        bridge.sendStatus({ type: 'video-debug', msg: 'Start button not found, sent Escape' });
      }
      return;
    }

    if (action === 'next') {
      // Step 1: Prefer explicit Next/Skip/Really/New button, then Stop/Disconnect button
      const btn =
        findVisibleButton(
          '.btn-next, .next-btn, [data-action="next"], button.next, .skip-button, .start-button, .disconnectbtn, #disconnectbtn',
          /^(next|skip|really\??|confirm|sure\??|new|new chat|další|přeskočit|opravdu\??|nový)\b/i
        ) ||
        findVisibleButton(
          '.disconnectbtn, #disconnectbtn, .btn-next, .next-btn, .start-button, .stop-button',
          null
        ) ||
        findVisibleButton(
          null,
          /^(next|skip|really\??|confirm|sure\??|new|stop|end|disconnect|esc|další|přeskočit|ukončit|zastavit|nový)\b/i
        );

      if (btn) {
        clickEl(btn);
        bridge.sendStatus({ type: 'video-debug', msg: `Next clicked <${btn.tagName.toLowerCase()}> "${getElText(btn).slice(0, 24)}"` });

        // Follow-up for 2-step / 3-step skip flows (e.g. Umingle/Uhmegle: Stop -> Really? -> New)
        const followUp = () => {
          const confirmOrNewBtn =
            findVisibleButton(
              '.disconnectbtn, #disconnectbtn, .newchatbtn, .start-button, .btn-next, .next-btn',
              /^(really\??|confirm|sure\??|yes|new|new chat|start|start chat|opravdu\??|nový|začít)\b/i
            ) ||
            findVisibleButton(
              null,
              /^(really\??|confirm|sure\??|new|new chat|opravdu\??|nový)\b/i
            );
          if (confirmOrNewBtn) {
            clickEl(confirmOrNewBtn);
            bridge.sendStatus({
              type: 'video-debug',
              msg: `Next follow-up clicked <${confirmOrNewBtn.tagName.toLowerCase()}> "${getElText(confirmOrNewBtn).slice(0, 24)}"`
            });
          }
        };
        setTimeout(followUp, 90);
        setTimeout(followUp, 230);
      } else {
        triggerEsc();
        setTimeout(triggerEsc, 90);
        bridge.sendStatus({ type: 'video-debug', msg: 'Next button not found, sent double Escape' });
      }
    }
  }

  // --- Spoof navigator.mediaDevices ---
  let devSeed = '01';
  try {
    devSeed = localStorage.getItem('__omeTrollDevSeed');
    if (!devSeed) {
      devSeed = Math.random().toString(36).slice(2, 10);
      localStorage.setItem('__omeTrollDevSeed', devSeed);
    }
  } catch (_) {}

  if (navigator.mediaDevices) {
    const fakeDevices = [
      {
        deviceId: `cam-${devSeed}`,
        kind: 'videoinput',
        label: 'HD Pro Webcam C920 (046d:082d)',
        groupId: `grp-cam-${devSeed}`,
        toJSON() {
          return this;
        }
      },
      {
        deviceId: `mic-${devSeed}`,
        kind: 'audioinput',
        label: 'Default - Microphone (Realtek Audio)',
        groupId: `grp-mic-${devSeed}`,
        toJSON() {
          return this;
        }
      },
      {
        deviceId: 'default',
        kind: 'audiooutput',
        label: 'Default Audio Output',
        groupId: 'ometroll-group-spk',
        toJSON() {
          return this;
        }
      }
    ];

    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
      configurable: true,
      writable: true,
      value: async () => fakeDevices.map((d) => ({ ...d }))
    });

    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      writable: true,
      value: async (constraints = { video: true, audio: true }) => {
        const outStream = new MediaStream();
        const wantVideo = Boolean(constraints && constraints.video);
        const wantAudio = Boolean(constraints && constraints.audio);

        if (wantVideo) {
          outStream.addTrack(createVirtualVideoTrack());
        }
        if (wantAudio) {
          outStream.addTrack(createVirtualAudioTrack());
        }

        bridge.sendStatus({ type: 'gum-called', video: wantVideo, audio: wantAudio });
        return outStream;
      }
    });
  }

  // --- Hook window.RTCPeerConnection to intercept Stranger's incoming MediaStream ---
  let activeCallId = 0;

  class HookedRTCPeerConnection extends NativeRTCPeerConnection {
    constructor(config, constraints) {
      super(config, constraints);
      const callId = ++activeCallId;
      let hasVideo = false;
      let hasAudio = false;

      bridge.sendStatus({ type: 'pc-created', callId });

      this.addEventListener('track', (ev) => {
        const track = ev.track;
        if (!track) return;

        if (track.kind === 'video') {
          hasVideo = true;
          currentStrangerVideoTrack = track;
          if (outboundVideoSender) {
            outboundVideoSender.replaceTrack(track).catch(() => {});
          }
          track.addEventListener('ended', () => {
            if (currentStrangerVideoTrack === track) {
              currentStrangerVideoTrack = null;
              outboundVideoSender?.replaceTrack(null).catch(() => {});
              if (callId === activeCallId) {
                bridge.sendStatus({ type: 'stranger-state', state: 'disconnected', callId });
              }
            }
          });
        } else if (track.kind === 'audio') {
          hasAudio = true;
          currentStrangerAudioTrack = track;
          if (outboundAudioSender) {
            outboundAudioSender.replaceTrack(track).catch(() => {});
          }
          track.addEventListener('ended', () => {
            if (currentStrangerAudioTrack === track) {
              currentStrangerAudioTrack = null;
              outboundAudioSender?.replaceTrack(null).catch(() => {});
            }
          });
        }

        bridge.sendStatus({
          type: 'stranger-state',
          state: 'connected',
          callId,
          hasVideo,
          hasAudio
        });
      });

      const handleDisconnect = (force = false) => {
        if (callId !== activeCallId) return;
        const state = this.connectionState || this.iceConnectionState;
        if (force === true || state === 'disconnected' || state === 'failed' || state === 'closed') {
          currentStrangerVideoTrack = null;
          currentStrangerAudioTrack = null;
          outboundVideoSender?.replaceTrack(null).catch(() => {});
          outboundAudioSender?.replaceTrack(null).catch(() => {});
          bridge.sendStatus({ type: 'stranger-state', state: 'disconnected', callId });
        }
      };

      const origClose = this.close.bind(this);
      this.close = () => {
        handleDisconnect(true);
        return origClose();
      };

      this.addEventListener('connectionstatechange', () => handleDisconnect(false));
      this.addEventListener('iceconnectionstatechange', () => handleDisconnect(false));
    }
  }

  window.RTCPeerConnection = HookedRTCPeerConnection;
  if (window.webkitRTCPeerConnection) {
    window.webkitRTCPeerConnection = HookedRTCPeerConnection;
  }
})();
