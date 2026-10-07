(() => {
  let ws = null;
  let vibrateEnabled = true;
  let playerNum = null;
  let pingInterval = null;

  const playerBadge = document.getElementById("player-badge");
  const playerText = document.getElementById("player-text");
  const pingText = document.getElementById("ping-text");
  const btnVibrate = document.getElementById("btn-vibrate");
  const btnFullscreen = document.getElementById("btn-fullscreen");
  const btnForceFs = document.getElementById("btn-force-fs");

  // Auth & Navigation Elements
  const authModal = document.getElementById("auth-modal");
  const modalCloseBtn = document.getElementById("modal-close-btn");
  const modalTabs = document.getElementById("modal-tabs");
  const tabBtnConnect = document.getElementById("tab-btn-connect");
  const tabBtnDownload = document.getElementById("tab-btn-download");
  const tabPaneConnect = document.getElementById("tab-pane-connect");
  const tabPaneDownload = document.getElementById("tab-pane-download");
  const btnOpenDownloadModal = document.getElementById("btn-open-download-modal");

  const inputCode = document.getElementById("input-code");
  const inputServer = document.getElementById("input-server");
  const serverInputGroup = document.getElementById("server-input-group");
  const serverStatusLabel = document.getElementById("server-status-label");
  const btnToggleServer = document.getElementById("btn-toggle-server");
  const btnQuickTunnel = document.getElementById("btn-quick-tunnel");
  const btnQuickLocal = document.getElementById("btn-quick-local");
  const btnSubmitCode = document.getElementById("btn-submit-code");
  const authError = document.getElementById("auth-error");

  // In-App QR Scanner Elements
  const btnOpenScanner = document.getElementById("btn-open-scanner");
  const btnCloseScanner = document.getElementById("btn-close-scanner");
  const qrScannerModal = document.getElementById("qr-scanner-modal");
  const qrVideo = document.getElementById("qr-video");
  const qrCanvas = document.getElementById("qr-canvas");
  const scannerStatus = document.getElementById("scanner-status");

  // Detect if running inside the Native Android APK
  const isNativeApp = Boolean(
    location.protocol === "file:" ||
    navigator.userAgent.includes("AirPadNative") ||
    window.AirPadBridge
  );

  const isExternalHost = isNativeApp || location.origin.startsWith("file:") || location.host.includes("github.io");
  let activeServerHost = "";
  window.lastLocalIp = "";
  window.liveTunnelHost = "";

  // Adjust UI if inside Native App
  if (isNativeApp) {
    if (modalTabs) modalTabs.style.display = "none";
    if (btnOpenDownloadModal) btnOpenDownloadModal.style.display = "none";
    const lw = document.getElementById("landscape-warning");
    if (lw) lw.style.display = "none";
  }

  // Tab switching logic (for browser mode)
  function switchTab(target) {
    if (target === "download") {
      if (tabBtnDownload) tabBtnDownload.classList.add("active");
      if (tabBtnConnect) tabBtnConnect.classList.remove("active");
      if (tabPaneDownload) tabPaneDownload.classList.add("active");
      if (tabPaneConnect) tabPaneConnect.classList.remove("active");
    } else {
      if (tabBtnConnect) tabBtnConnect.classList.add("active");
      if (tabBtnDownload) tabBtnDownload.classList.remove("active");
      if (tabPaneConnect) tabPaneConnect.classList.add("active");
      if (tabPaneDownload) tabPaneDownload.classList.remove("active");
    }
  }

  if (tabBtnConnect) tabBtnConnect.addEventListener("click", () => switchTab("connect"));
  if (tabBtnDownload) tabBtnDownload.addEventListener("click", () => switchTab("download"));

  if (btnOpenDownloadModal) {
    btnOpenDownloadModal.addEventListener("click", () => {
      authModal.classList.remove("hidden");
      switchTab("download");
      if (modalCloseBtn) modalCloseBtn.style.display = "flex";
    });
  }

  if (modalCloseBtn) {
    modalCloseBtn.addEventListener("click", () => {
      authModal.classList.add("hidden");
    });
  }

  // Check URL query parameters (e.g. ?code=1234&server=...)
  const urlParams = new URLSearchParams(window.location.search);
  const paramCode = urlParams.get("code") || localStorage.getItem("airpad_code") || "";
  const paramServer = urlParams.get("server") || "";

  if (paramCode) inputCode.value = paramCode;

  function cleanHost(str) {
    if (!str) return "";
    return str.trim()
      .replace(/^https?:\/\//i, "")
      .replace(/^wss?:\/\//i, "")
      .replace(/\/.*$/, "");
  }

  function saveServer(srv) {
    activeServerHost = cleanHost(srv);
    if (activeServerHost) {
      localStorage.setItem("airpad_server", activeServerHost);
      if (inputServer) inputServer.value = activeServerHost;
      if (serverStatusLabel) serverStatusLabel.textContent = activeServerHost;
    }
  }

  // Toggle server input drawer
  if (btnToggleServer && serverInputGroup) {
    btnToggleServer.addEventListener("click", (e) => {
      e.preventDefault();
      const isHidden = serverInputGroup.style.display === "none";
      serverInputGroup.style.display = isHidden ? "flex" : "none";
      if (isHidden && inputServer) inputServer.focus();
    });
  }

  if (btnQuickTunnel) {
    btnQuickTunnel.addEventListener("click", () => {
      if (window.liveTunnelHost) {
        saveServer(window.liveTunnelHost);
      } else {
        const saved = localStorage.getItem("airpad_server");
        if (saved && saved.includes(".trycloudflare.com")) {
          saveServer(saved);
        }
      }
    });
  }

  if (btnQuickLocal) {
    btnQuickLocal.addEventListener("click", () => {
      if (window.lastLocalIp) {
        saveServer(window.lastLocalIp);
      } else {
        const manual = prompt("Masukkan IP PC (Contoh: 192.168.1.15:8080):", "192.168.1.");
        if (manual) saveServer(manual);
      }
    });
  }

  // Server resolution logic
  async function resolveServerHost() {
    if (paramServer) {
      saveServer(paramServer);
      return activeServerHost;
    }

    if (!isExternalHost && location.host && location.host !== "localhost") {
      saveServer(location.host);
      return activeServerHost;
    }

    // Try fetching live server from GitHub raw config (updated by start.sh)
    if (isExternalHost) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2800);
        const res = await fetch("https://raw.githubusercontent.com/nzadev/airpad/main/config.json?_t=" + Date.now(), {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const cfg = await res.json();
          if (cfg) {
            if (cfg.server) {
              window.liveTunnelHost = cleanHost(cfg.server);
              saveServer(cfg.server);
            }
            if (cfg.local_ip) {
              window.lastLocalIp = cleanHost(cfg.local_ip);
            }
            if (cfg.code && !inputCode.value) {
              inputCode.value = cfg.code;
            }
            return activeServerHost;
          }
        }
      } catch (e) {}

      // Fallback: local asset config.json
      try {
        const res2 = await fetch("./config.json?_t=" + Date.now());
        if (res2.ok) {
          const cfg2 = await res2.json();
          if (cfg2 && cfg2.server) {
            window.liveTunnelHost = cleanHost(cfg2.server);
            saveServer(cfg2.server);
            if (cfg2.local_ip) window.lastLocalIp = cleanHost(cfg2.local_ip);
            return activeServerHost;
          }
        }
      } catch (e) {}
    }

    const saved = localStorage.getItem("airpad_server");
    if (saved && !saved.includes("victorian-internet") && !saved.includes("lung-medline")) {
      saveServer(saved);
      return activeServerHost;
    }

    if (serverStatusLabel) serverStatusLabel.textContent = "Belum Terhubung (Scan QR)";
    return activeServerHost;
  }

  // Service Worker Registration for PWA
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  // Vibration Helper
  function haptic(ms = 18) {
    if (vibrateEnabled && "vibrate" in navigator) {
      navigator.vibrate(ms);
    }
  }

  if (btnVibrate) {
    btnVibrate.addEventListener("click", () => {
      vibrateEnabled = !vibrateEnabled;
      btnVibrate.classList.toggle("active", vibrateEnabled);
    });
  }

  // Fullscreen Helper
  async function enterFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock("landscape").catch(() => {});
      }
    } catch (e) {}
  }

  if (btnFullscreen) btnFullscreen.addEventListener("click", enterFullscreen);
  if (btnForceFs) btnForceFs.addEventListener("click", enterFullscreen);

  const btnIgnorePortrait = document.getElementById("btn-ignore-portrait");
  const landscapeWarning = document.getElementById("landscape-warning");
  if (btnIgnorePortrait && landscapeWarning) {
    btnIgnorePortrait.addEventListener("click", () => {
      landscapeWarning.style.display = "none";
    });
  }

  // --- IN-APP CAMERA QR SCANNER ---
  let qrScannerStream = null;
  let qrScanAnimFrame = null;

  function parseQrPayload(text) {
    let code = "";
    let server = "";
    if (!text) return { code, server };

    text = text.trim();

    // Format 1: JSON payload {"code":"1234","server":"..."}
    if (text.startsWith("{")) {
      try {
        const obj = JSON.parse(text);
        code = String(obj.code || "");
        server = String(obj.server || "");
      } catch (e) {}
    }

    // Format 2: URL / Custom scheme airpad://connect?code=...&server=...
    if (!code || !server) {
      try {
        const safeUrl = text
          .replace(/^airpad:\/\/connect\?/i, "http://airpad.local/?")
          .replace(/^airpad:\/\//i, "http://airpad.local/");
        const parsed = new URL(safeUrl);
        if (parsed.searchParams.has("code")) code = parsed.searchParams.get("code");
        if (parsed.searchParams.has("server")) server = parsed.searchParams.get("server");

        if (!server && parsed.host && parsed.host !== "airpad.local" && !parsed.host.includes("github.io")) {
          server = parsed.host;
        }
      } catch (e) {}
    }

    // Format 3: Regex fallbacks
    if (!code) {
      const cm = text.match(/(?:code=|^)(\d{4,6})/i);
      if (cm) code = cm[1];
    }
    if (!server) {
      const sm = text.match(/server=([a-zA-Z0-9.-]+(?::\d+)?)/i);
      if (sm) server = sm[1];
    }

    return { code: code.trim(), server: cleanHost(server) };
  }

  async function startQrScanner() {
    if (!qrScannerModal || !qrVideo) return;
    qrScannerModal.classList.remove("hidden");
    if (scannerStatus) scannerStatus.textContent = "Membuka kamera HP...";

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      qrScannerStream = stream;
      qrVideo.srcObject = stream;
      await qrVideo.play();
      if (scannerStatus) scannerStatus.textContent = "Arahkan kamera ke QR Code di terminal PC";

      const canvasCtx = qrCanvas ? qrCanvas.getContext("2d", { willReadFrequently: true }) : null;
      let barcodeDetector = null;
      if ("BarcodeDetector" in window) {
        try {
          barcodeDetector = new BarcodeDetector({ formats: ["qr_code"] });
        } catch (e) {}
      }

      async function scanLoop() {
        if (!qrScannerStream) return;

        if (qrVideo.readyState === qrVideo.HAVE_ENOUGH_DATA) {
          let detectedText = null;

          if (barcodeDetector) {
            try {
              const codes = await barcodeDetector.detect(qrVideo);
              if (codes && codes.length > 0 && codes[0].rawValue) {
                detectedText = codes[0].rawValue;
              }
            } catch (e) {}
          }

          if (!detectedText && typeof jsQR === "function" && canvasCtx) {
            qrCanvas.width = qrVideo.videoWidth;
            qrCanvas.height = qrVideo.videoHeight;
            canvasCtx.drawImage(qrVideo, 0, 0, qrCanvas.width, qrCanvas.height);
            const imgData = canvasCtx.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
            const qrResult = jsQR(imgData.data, imgData.width, imgData.height, {
              inversionAttempts: "dontInvert"
            });
            if (qrResult && qrResult.data) {
              detectedText = qrResult.data;
            }
          }

          if (detectedText) {
            handleScannedResult(detectedText);
            return;
          }
        }

        qrScanAnimFrame = requestAnimationFrame(scanLoop);
      }

      qrScanAnimFrame = requestAnimationFrame(scanLoop);

    } catch (err) {
      console.error("Camera access error:", err);
      if (scannerStatus) {
        scannerStatus.textContent = "Gagal buka kamera: " + (err.message || "Izin ditolak");
      }
    }
  }

  function stopQrScanner() {
    if (qrScanAnimFrame) {
      cancelAnimationFrame(qrScanAnimFrame);
      qrScanAnimFrame = null;
    }
    if (qrScannerStream) {
      qrScannerStream.getTracks().forEach((track) => track.stop());
      qrScannerStream = null;
    }
    if (qrVideo) qrVideo.srcObject = null;
    if (qrScannerModal) qrScannerModal.classList.add("hidden");
  }

  function handleScannedResult(rawText) {
    stopQrScanner();
    haptic([40, 80, 40]);

    const { code, server } = parseQrPayload(rawText);
    if (code) inputCode.value = code;
    if (server) saveServer(server);

    authError.textContent = "QR Terbaca! Menghubungkan...";
    authError.style.color = "#38bdf8";

    if (code) {
      connect();
    }
  }

  if (btnOpenScanner) btnOpenScanner.addEventListener("click", startQrScanner);
  if (btnCloseScanner) btnCloseScanner.addEventListener("click", stopQrScanner);

  // --- WEBSOCKET CONNECTION ---
  let connectionTimeout = null;

  function getWsUrl(host) {
    let proto = "wss:";
    if (
      host.startsWith("192.168.") ||
      host.startsWith("10.") ||
      host.startsWith("172.") ||
      host.startsWith("127.") ||
      host.includes("localhost") ||
      host.includes(":8080") ||
      host.includes(":8000")
    ) {
      proto = "ws:";
    } else if (!isExternalHost && location.protocol === "http:") {
      proto = "ws:";
    }
    return `${proto}//${host}/ws`;
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      const codeToSend = inputCode.value.trim();
      if (codeToSend && ws.readyState === WebSocket.OPEN) {
        sendAuth(codeToSend);
      }
      return;
    }

    let host = activeServerHost;
    if (serverInputGroup && serverInputGroup.style.display !== "none" && inputServer && inputServer.value.trim()) {
      host = cleanHost(inputServer.value);
      saveServer(host);
    }

    if (!host) {
      authError.innerHTML = "Server PC belum terdeteksi!<br>Tap <b>SCAN QR PC</b> atau atur IP PC.";
      authError.style.color = "#ef4444";
      return;
    }

    const url = getWsUrl(host);

    if (serverStatusLabel) serverStatusLabel.textContent = host;
    playerText.textContent = "Menghubungkan...";
    playerBadge.classList.remove("connected");

    if (connectionTimeout) clearTimeout(connectionTimeout);
    connectionTimeout = setTimeout(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        if (!authModal.classList.contains("hidden")) {
          authError.innerHTML = `⚠️ Gagal hubungi PC (Timeout).<br>Pastikan 'start.sh' aktif & coba <b>SCAN QR PC</b>.`;
          authError.style.color = "#ef4444";
        }
      }
    }, 6000);

    try {
      ws = new WebSocket(url);
    } catch (e) {
      if (connectionTimeout) clearTimeout(connectionTimeout);
      authError.textContent = "Gagal membuka WebSocket: " + (e.message || "");
      authError.style.color = "#ef4444";
      return;
    }

    ws.onopen = () => {
      if (connectionTimeout) clearTimeout(connectionTimeout);
      playerText.textContent = "Server Terhubung";
      const codeToSend = inputCode.value.trim();
      if (codeToSend) {
        authError.textContent = "Memverifikasi kode...";
        authError.style.color = "#38bdf8";
        sendAuth(codeToSend);
      } else {
        authError.textContent = "";
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "init") {
          playerNum = data.player;
          playerText.textContent = `PLAYER ${playerNum}`;
          playerBadge.classList.add("connected");
          authModal.classList.add("hidden");
          if (modalCloseBtn) modalCloseBtn.style.display = "flex";
          authError.textContent = "";
          localStorage.setItem("airpad_code", inputCode.value.trim());
          haptic([30, 50, 30]);

          if (pingInterval) clearInterval(pingInterval);
          pingInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(["ping", Date.now()]));
            }
          }, 2000);

        } else if (data.type === "error") {
          authError.textContent = data.message || "Kode pairing salah!";
          authError.style.color = "#ef4444";
          authModal.classList.remove("hidden");
          haptic([50, 100, 50]);

        } else if (Array.isArray(data) && data[0] === "pong") {
          const latency = Date.now() - data[1];
          pingText.textContent = `${latency} ms`;
        }
      } catch (e) {}
    };

    ws.onclose = () => {
      if (connectionTimeout) clearTimeout(connectionTimeout);
      playerText.textContent = "Terputus (Reconnect...)";
      playerBadge.classList.remove("connected");
      if (pingInterval) clearInterval(pingInterval);

      if (!authModal.classList.contains("hidden")) {
        authError.innerHTML = `⚠️ Jaringan terputus ke server PC (${activeServerHost || "Server"}).<br><span style="font-size:10px;color:#94a3b8">Pastikan terminal PC jalan, atau tap <b>SCAN QR PC</b> lagi.</span>`;
        authError.style.color = "#ef4444";
      }

      setTimeout(() => {
        if (playerNum !== null) {
          connect();
        }
      }, 2500);
    };

    ws.onerror = () => {
      if (connectionTimeout) clearTimeout(connectionTimeout);
      if (!authModal.classList.contains("hidden")) {
        authError.innerHTML = `⚠️ Gagal hubungi PC! Coba tap <b>SCAN QR PC</b> untuk sambung otomatis.`;
        authError.style.color = "#ef4444";
      }
      try { ws.close(); } catch (e) {}
    };
  }

  function sendAuth(code) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "auth", code: String(code).trim() }));
    }
  }

  btnSubmitCode.addEventListener("click", () => {
    const code = inputCode.value.trim();
    if (!code) {
      authError.textContent = "Masukkan 4 digit kode terlebih dahulu!";
      authError.style.color = "#ef4444";
      return;
    }
    authError.textContent = "Menghubungkan ke server...";
    authError.style.color = "#38bdf8";

    if (!activeServerHost && inputServer && inputServer.value.trim()) {
      saveServer(inputServer.value);
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connect();
    } else {
      sendAuth(code);
    }
  });

  inputCode.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      btnSubmitCode.click();
    }
  });

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // --- MULTI-TOUCH BUTTON HANDLER ---
  const activeButtons = new Map();

  function handleTouchStart(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const btn = target ? target.closest("[data-btn]") : null;

      if (btn) {
        const btnName = btn.dataset.btn;
        btn.classList.add("active");
        activeButtons.set(touch.identifier, btn);
        haptic(18);

        if (btnName === "L2" || btnName === "R2") {
          send(["t", btnName, 1.0]);
        } else {
          send(["b", btnName, 1]);
        }
      }
    }
  }

  function handleTouchEnd(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (activeButtons.has(touch.identifier)) {
        const btn = activeButtons.get(touch.identifier);
        const btnName = btn.dataset.btn;
        btn.classList.remove("active");
        activeButtons.delete(touch.identifier);

        if (btnName === "L2" || btnName === "R2") {
          send(["t", btnName, 0.0]);
        } else {
          send(["b", btnName, 0]);
        }
      }
    }
  }

  const allButtons = document.querySelectorAll("[data-btn]");
  allButtons.forEach((el) => {
    el.addEventListener("touchstart", handleTouchStart, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: false });
    el.addEventListener("touchcancel", handleTouchEnd, { passive: false });

    // Desktop Mouse Testing Support
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const btnName = el.dataset.btn;
      el.classList.add("active");
      if (btnName === "L2" || btnName === "R2") {
        send(["t", btnName, 1.0]);
      } else {
        send(["b", btnName, 1]);
      }
    });

    el.addEventListener("mouseup", () => {
      const btnName = el.dataset.btn;
      el.classList.remove("active");
      if (btnName === "L2" || btnName === "R2") {
        send(["t", btnName, 0.0]);
      } else {
        send(["b", btnName, 0]);
      }
    });
  });

  // --- JOYSTICK ANALOG STICK MANAGER ---
  class TouchStick {
    constructor(zoneId, knobId, stickCode) {
      this.zone = document.getElementById(zoneId);
      this.knob = document.getElementById(knobId);
      this.stickCode = stickCode;
      this.touchId = null;
      this.maxRadius = 38;
      this.centerX = 0;
      this.centerY = 0;

      if (!this.zone || !this.knob) return;

      this.zone.addEventListener("touchstart", this.onTouchStart.bind(this), { passive: false });
      window.addEventListener("touchmove", this.onTouchMove.bind(this), { passive: false });
      window.addEventListener("touchend", this.onTouchEnd.bind(this), { passive: false });
      window.addEventListener("touchcancel", this.onTouchEnd.bind(this), { passive: false });
    }

    onTouchStart(e) {
      if (this.touchId !== null) return;
      const touch = e.changedTouches[0];
      this.touchId = touch.identifier;

      const rect = this.zone.getBoundingClientRect();
      this.centerX = rect.left + rect.width / 2;
      this.centerY = rect.top + rect.height / 2;

      this.updateStick(touch.clientX, touch.clientY);
      haptic(15);
    }

    onTouchMove(e) {
      if (this.touchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.touchId) {
          this.updateStick(touch.clientX, touch.clientY);
          break;
        }
      }
    }

    onTouchEnd(e) {
      if (this.touchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.touchId) {
          this.resetStick();
          break;
        }
      }
    }

    updateStick(clientX, clientY) {
      let dx = clientX - this.centerX;
      let dy = clientY - this.centerY;
      const dist = Math.hypot(dx, dy);

      if (dist > this.maxRadius) {
        dx = (dx / dist) * this.maxRadius;
        dy = (dy / dist) * this.maxRadius;
      }

      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;

      let nx = dx / this.maxRadius;
      let ny = dy / this.maxRadius;
      if (Math.abs(nx) < 0.05) nx = 0;
      if (Math.abs(ny) < 0.05) ny = 0;

      send(["a", this.stickCode, nx, ny]);
    }

    resetStick() {
      this.touchId = null;
      this.knob.style.transform = "translate(0px, 0px)";
      send(["a", this.stickCode, 0, 0]);
    }
  }

  // Initialize Analog Sticks
  new TouchStick("left-stick-zone", "left-knob", "L");
  new TouchStick("right-stick-zone", "right-knob", "R");

  // Prevent default scroll gestures
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  // Initialize server configuration and auto-connect if code exists
  resolveServerHost().then(() => {
    if (paramCode && paramServer) {
      connect();
    }
  });
})();
