(() => {
  let ws = null;
  let vibrateEnabled = true;
  let playerNum = null;
  let pingInterval = null;

  const playerBadge = document.getElementById("player-badge");
  const playerText = document.getElementById("player-text");
  const pingText = document.getElementById("ping-text");
  const btnForceFs = document.getElementById("btn-force-fs");
  const btnOpenSettings = document.getElementById("btn-open-settings");
  const btnDisconnect = document.getElementById("btn-disconnect");

  // Settings Modal & Custom Layout Elements
  const settingsModal = document.getElementById("settings-modal");
  const btnCloseSettings = document.getElementById("btn-close-settings");
  const toggleVibrate = document.getElementById("toggle-vibrate");
  const scaleBtns = document.querySelectorAll(".scale-btn");
  const btnStartEditLayout = document.getElementById("btn-start-edit-layout");
  const btnSettingsDisconnect = document.getElementById("btn-settings-disconnect");

  const editLayoutHud = document.getElementById("edit-layout-hud");
  const btnResetLayout = document.getElementById("btn-reset-layout");
  const btnCancelLayout = document.getElementById("btn-cancel-layout");
  const btnSaveLayout = document.getElementById("btn-save-layout");

  // Custom Layout & State
  window.isEditLayoutMode = false;
  let isExplicitDisconnect = false;
  let currentLayout = {};
  let tempLayout = {};
  let currentScale = 1.0;

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

  if (playerBadge) {
    playerBadge.style.cursor = "pointer";
    playerBadge.addEventListener("click", () => {
      authModal.classList.remove("hidden");
    });
  }

  // Purge dead/expired server hosts from localStorage
  const deadServers = ["victorian-internet", "lung-medline", "terminals-generate"];
  const curSaved = localStorage.getItem("airpad_server");
  if (curSaved && deadServers.some((d) => curSaved.includes(d))) {
    localStorage.removeItem("airpad_server");
  }

  // Check URL query parameters (e.g. ?code=1234&server=... or ?download=1)
  const urlParams = new URLSearchParams(window.location.search);
  const paramCode = urlParams.get("code") || localStorage.getItem("airpad_code") || "";
  const paramServer = urlParams.get("server") || "";
  const paramDownload = urlParams.has("download") || location.hash === "#download";

  if (paramCode) inputCode.value = paramCode;

  if (paramDownload && !isNativeApp) {
    switchTab("download");
    setTimeout(() => {
      const dlLink = document.createElement("a");
      dlLink.href = "AirPad.apk";
      dlLink.download = "AirPad.apk";
      document.body.appendChild(dlLink);
      dlLink.click();
      document.body.removeChild(dlLink);
    }, 450);
  }

  function cleanHost(str) {
    if (!str) return "";
    return str.trim()
      .replace(/^https?:\/\//i, "")
      .replace(/^wss?:\/\//i, "")
      .replace(/\/.*$/, "");
  }

  const serverStatusDot = document.getElementById("server-status-dot");

  function saveServer(srv) {
    activeServerHost = cleanHost(srv);
    if (activeServerHost) {
      localStorage.setItem("airpad_server", activeServerHost);
      if (inputServer) inputServer.value = activeServerHost;
      if (serverStatusDot) {
        serverStatusDot.style.background = "#22c55e";
        serverStatusDot.style.boxShadow = "0 0 8px #22c55e";
      }
    } else {
      if (serverStatusDot) {
        serverStatusDot.style.background = "#eab308";
        serverStatusDot.style.boxShadow = "0 0 8px #eab308";
      }
    }
  }

  // Keep inputServer synced with activeServerHost
  if (inputServer) {
    inputServer.addEventListener("input", () => {
      saveServer(inputServer.value);
    });
    inputServer.addEventListener("change", () => {
      saveServer(inputServer.value);
    });
  }

  if (btnQuickTunnel) {
    btnQuickTunnel.addEventListener("click", () => {
      const tunnel = window.liveTunnelHost || "reservations-gauge-safari-brother.trycloudflare.com";
      saveServer(tunnel);
      authError.textContent = "Menggunakan Cloudflare Tunnel";
      authError.style.color = "#38bdf8";
    });
  }

  if (btnQuickLocal) {
    btnQuickLocal.addEventListener("click", () => {
      const local = window.lastLocalIp || "10.150.55.154:8080";
      saveServer(local);
      authError.textContent = "Menggunakan Wi-Fi Lokal (" + local + ")";
      authError.style.color = "#22c55e";
    });
  }

  // Un-cached Server resolution logic
  async function resolveServerHost() {
    if (paramServer) {
      saveServer(paramServer);
      return activeServerHost;
    }

    if (!isExternalHost && location.host && location.host !== "localhost") {
      saveServer(location.host);
      return activeServerHost;
    }

    // 1. Fetch live config via un-cached GitHub API
    if (isExternalHost) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch("https://api.github.com/repos/nzadev/airpad/contents/config.json", {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data && data.content) {
            const cleanB64 = data.content.replace(/\s/g, "");
            const decoded = decodeURIComponent(escape(atob(cleanB64)));
            const cfg = JSON.parse(decoded);
            if (cfg && cfg.server && !deadServers.some((d) => cfg.server.includes(d))) {
              window.liveTunnelHost = cleanHost(cfg.server);
              saveServer(cfg.server);
              if (cfg.local_ip) window.lastLocalIp = cleanHost(cfg.local_ip);
              if (cfg.code && !inputCode.value) inputCode.value = cfg.code;
              return activeServerHost;
            }
          }
        }
      } catch (e) {}

      // 2. Fallback: Query latest commit SHA to bypass Fastly cache
      try {
        const resCommit = await fetch("https://api.github.com/repos/nzadev/airpad/commits/main");
        if (resCommit.ok) {
          const commitData = await resCommit.json();
          if (commitData && commitData.sha) {
            const rawRes = await fetch(`https://raw.githubusercontent.com/nzadev/airpad/${commitData.sha}/config.json`);
            if (rawRes.ok) {
              const cfgRaw = await rawRes.json();
              if (cfgRaw && cfgRaw.server && !deadServers.some((d) => cfgRaw.server.includes(d))) {
                window.liveTunnelHost = cleanHost(cfgRaw.server);
                saveServer(cfgRaw.server);
                if (cfgRaw.local_ip) window.lastLocalIp = cleanHost(cfgRaw.local_ip);
                if (cfgRaw.code && !inputCode.value) inputCode.value = cfgRaw.code;
                return activeServerHost;
              }
            }
          }
        }
      } catch (e) {}

      // 3. Fallback: local asset config.json
      try {
        const res2 = await fetch("./config.json?_t=" + Date.now());
        if (res2.ok) {
          const cfg2 = await res2.json();
          if (cfg2 && cfg2.server && !deadServers.some((d) => cfg2.server.includes(d))) {
            window.liveTunnelHost = cleanHost(cfg2.server);
            saveServer(cfg2.server);
            if (cfg2.local_ip) window.lastLocalIp = cleanHost(cfg2.local_ip);
            if (cfg2.code && !inputCode.value) inputCode.value = cfg2.code;
            return activeServerHost;
          }
        }
      } catch (e) {}
    }

    const saved = localStorage.getItem("airpad_server");
    if (saved && !deadServers.some((d) => saved.includes(d))) {
      saveServer(saved);
      return activeServerHost;
    }

    // Default to the current live tunnel if nothing else resolved
    saveServer("reservations-gauge-safari-brother.trycloudflare.com");
    return activeServerHost;
  }

  // Service Worker Registration for PWA
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      reg.update().catch(() => {});
    }).catch(() => {});
  }

  // Vibration Helper
  function haptic(ms = 18) {
    if (vibrateEnabled && "vibrate" in navigator) {
      navigator.vibrate(ms);
    }
  }

  // Fullscreen Helper (Used by landscape prompt)
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

  if (btnForceFs) btnForceFs.addEventListener("click", enterFullscreen);

  // --- OUT DEVICE / DISCONNECT CONTROLLER ---
  function disconnectDevice() {
    isExplicitDisconnect = true;
    if (ws) {
      try {
        send(["b", "SELECT", 0]);
        send(["b", "START", 0]);
        send(["b", "PS", 0]);
        ws.close(1000, "User disconnected");
      } catch (e) {}
      ws = null;
    }
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    playerNum = null;
    playerText.textContent = "Terputus";
    playerBadge.classList.remove("connected");
    pingText.textContent = "0 ms";

    if (settingsModal) settingsModal.classList.add("hidden");
    if (window.isEditLayoutMode) exitEditLayout(false);

    authModal.classList.remove("hidden");
    authError.textContent = "Controller telah diputuskan.";
    authError.style.color = "#94a3b8";
    switchTab("connect");
    haptic([30, 40]);
  }

  if (btnDisconnect) btnDisconnect.addEventListener("click", disconnectDevice);
  if (btnSettingsDisconnect) btnSettingsDisconnect.addEventListener("click", disconnectDevice);

  // --- SETTINGS MODAL LISTENERS ---
  if (btnOpenSettings) {
    btnOpenSettings.addEventListener("click", () => {
      if (settingsModal) settingsModal.classList.remove("hidden");
      haptic(20);
    });
  }

  if (btnCloseSettings) {
    btnCloseSettings.addEventListener("click", () => {
      if (settingsModal) settingsModal.classList.add("hidden");
    });
  }

  if (toggleVibrate) {
    toggleVibrate.addEventListener("change", () => {
      vibrateEnabled = toggleVibrate.checked;
      localStorage.setItem("airpad_vibrate", vibrateEnabled ? "1" : "0");
      if (vibrateEnabled) haptic(35);
    });
  }

  scaleBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      scaleBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentScale = parseFloat(btn.dataset.scale) || 1.0;
      localStorage.setItem("airpad_button_scale", String(currentScale));
      applyLayout(window.isEditLayoutMode ? tempLayout : currentLayout);
      haptic(20);
    });
  });

  if (btnStartEditLayout) {
    btnStartEditLayout.addEventListener("click", () => {
      startEditLayout();
    });
  }

  if (btnSaveLayout) {
    btnSaveLayout.addEventListener("click", () => {
      exitEditLayout(true);
      haptic([30, 40]);
    });
  }

  if (btnCancelLayout) {
    btnCancelLayout.addEventListener("click", () => {
      exitEditLayout(false);
      haptic(20);
    });
  }

  if (btnResetLayout) {
    btnResetLayout.addEventListener("click", () => {
      resetLayoutToDefault();
    });
  }

  // --- CUSTOM LAYOUT & POSITION ENGINE ---
  const CLUSTER_IDS = [
    "cluster-lshoulders",
    "cluster-center",
    "cluster-rshoulders",
    "cluster-dpad",
    "cluster-lstick",
    "cluster-rstick",
    "cluster-actions"
  ];

  function loadSavedSettings() {
    const savedVib = localStorage.getItem("airpad_vibrate");
    if (savedVib !== null) {
      vibrateEnabled = savedVib === "1";
    }
    if (toggleVibrate) {
      toggleVibrate.checked = vibrateEnabled;
    }

    const savedScale = localStorage.getItem("airpad_button_scale");
    if (savedScale) {
      currentScale = parseFloat(savedScale) || 1.0;
      scaleBtns.forEach((btn) => {
        btn.classList.toggle("active", parseFloat(btn.dataset.scale) === currentScale);
      });
    }

    try {
      const savedLayout = localStorage.getItem("airpad_custom_layout");
      if (savedLayout) {
        currentLayout = JSON.parse(savedLayout) || {};
      }
    } catch (e) {
      currentLayout = {};
    }

    applyLayout(currentLayout);
  }

  function applyLayout(layoutMap) {
    CLUSTER_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const pos = layoutMap[id];
      const x = pos && typeof pos.x === "number" ? pos.x : 0;
      const y = pos && typeof pos.y === "number" ? pos.y : 0;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${currentScale})`;
    });
  }

  function startEditLayout() {
    window.isEditLayoutMode = true;
    tempLayout = JSON.parse(JSON.stringify(currentLayout));
    if (settingsModal) settingsModal.classList.add("hidden");
    if (editLayoutHud) editLayoutHud.classList.remove("hidden");
    document.body.classList.add("edit-mode-active");
    haptic([30, 40]);
  }

  function exitEditLayout(shouldSave) {
    window.isEditLayoutMode = false;
    document.body.classList.remove("edit-mode-active");
    if (editLayoutHud) editLayoutHud.classList.add("hidden");

    if (shouldSave) {
      currentLayout = JSON.parse(JSON.stringify(tempLayout));
      localStorage.setItem("airpad_custom_layout", JSON.stringify(currentLayout));
    } else {
      applyLayout(currentLayout);
    }
  }

  function resetLayoutToDefault() {
    currentLayout = {};
    tempLayout = {};
    localStorage.removeItem("airpad_custom_layout");
    applyLayout({});
    exitEditLayout(false);
    haptic([40, 60]);
  }

  function initClusterDraggable() {
    CLUSTER_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.setAttribute("data-draggable-cluster", "true");

      let dragging = false;
      let startX = 0;
      let startY = 0;
      let initialClusterX = 0;
      let initialClusterY = 0;

      const onStart = (clientX, clientY) => {
        if (!window.isEditLayoutMode) return;
        dragging = true;
        el.classList.add("is-dragging");
        startX = clientX;
        startY = clientY;

        const currentPos = tempLayout[id] || currentLayout[id] || { x: 0, y: 0 };
        initialClusterX = currentPos.x || 0;
        initialClusterY = currentPos.y || 0;
        haptic(15);
      };

      const onMove = (clientX, clientY) => {
        if (!dragging || !window.isEditLayoutMode) return;
        const dx = clientX - startX;
        const dy = clientY - startY;

        let newX = Math.round(initialClusterX + dx);
        let newY = Math.round(initialClusterY + dy);

        // Clamp inside 45% screen width/height so elements can never get lost off-screen
        const maxW = Math.round(window.innerWidth * 0.45);
        const maxH = Math.round(window.innerHeight * 0.45);
        newX = Math.max(-maxW, Math.min(maxW, newX));
        newY = Math.max(-maxH, Math.min(maxH, newY));

        tempLayout[id] = { x: newX, y: newY };
        el.style.transform = `translate3d(${newX}px, ${newY}px, 0) scale(${currentScale})`;
      };

      const onEnd = () => {
        if (!dragging) return;
        dragging = false;
        el.classList.remove("is-dragging");
      };

      el.addEventListener("touchstart", (e) => {
        if (!window.isEditLayoutMode) return;
        e.preventDefault();
        e.stopPropagation();
        const t = e.changedTouches[0];
        onStart(t.clientX, t.clientY);
      }, { passive: false });

      window.addEventListener("touchmove", (e) => {
        if (!dragging || !window.isEditLayoutMode) return;
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          onMove(t.clientX, t.clientY);
          break;
        }
      }, { passive: false });

      window.addEventListener("touchend", () => onEnd());
      window.addEventListener("touchcancel", () => onEnd());

      el.addEventListener("mousedown", (e) => {
        if (!window.isEditLayoutMode) return;
        if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
        e.preventDefault();
        onStart(e.clientX, e.clientY);
      });

      window.addEventListener("mousemove", (e) => {
        if (!dragging || !window.isEditLayoutMode) return;
        onMove(e.clientX, e.clientY);
      });

      window.addEventListener("mouseup", () => onEnd());
    });
  }

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
      playerBadge.classList.remove("connected");
      if (pingInterval) clearInterval(pingInterval);

      if (isExplicitDisconnect) {
        isExplicitDisconnect = false;
        playerText.textContent = "Terputus";
        return;
      }

      playerText.textContent = "Terputus (Reconnect...)";
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

    if (inputServer && inputServer.value.trim()) {
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

  // --- ULTRA-SMOOTH D-PAD VECTOR ENGINE (8-WAY & FLUID SLIDING) ---
  class DPadManager {
    constructor() {
      this.wrapper = document.querySelector(".dpad-wrapper");
      if (!this.wrapper) return;

      this.buttons = {
        UP: this.wrapper.querySelector('[data-btn="UP"]'),
        DOWN: this.wrapper.querySelector('[data-btn="DOWN"]'),
        LEFT: this.wrapper.querySelector('[data-btn="LEFT"]'),
        RIGHT: this.wrapper.querySelector('[data-btn="RIGHT"]')
      };

      this.activeDirs = { UP: false, DOWN: false, LEFT: false, RIGHT: false };
      this.touchId = null;

      this.wrapper.addEventListener("touchstart", this.onTouchStart.bind(this), { passive: false });
      window.addEventListener("touchmove", this.onTouchMove.bind(this), { passive: false });
      window.addEventListener("touchend", this.onTouchEnd.bind(this), { passive: false });
      window.addEventListener("touchcancel", this.onTouchEnd.bind(this), { passive: false });

      // Desktop Mouse Fallback
      let isMouseDown = false;
      this.wrapper.addEventListener("mousedown", (e) => {
        if (window.isEditLayoutMode) return;
        if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
        isMouseDown = true;
        this.processPoint(e.clientX, e.clientY);
      });
      window.addEventListener("mousemove", (e) => {
        if (isMouseDown) this.processPoint(e.clientX, e.clientY);
      });
      window.addEventListener("mouseup", (e) => {
        if (isMouseDown) {
          isMouseDown = false;
          this.clearAll();
        }
      });
    }

    onTouchStart(e) {
      if (window.isEditLayoutMode) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.touchId !== null) return;
      const touch = e.changedTouches[0];
      this.touchId = touch.identifier;
      this.processPoint(touch.clientX, touch.clientY);
    }

    onTouchMove(e) {
      if (this.touchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.touchId) {
          e.preventDefault();
          this.processPoint(touch.clientX, touch.clientY);
          break;
        }
      }
    }

    onTouchEnd(e) {
      if (this.touchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this.touchId) {
          this.touchId = null;
          this.clearAll();
          break;
        }
      }
    }

    processPoint(clientX, clientY) {
      const rect = this.wrapper.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const dx = clientX - centerX;
      const dy = clientY - centerY;
      const dist = Math.hypot(dx, dy);

      // Deadzone: 14px radius in center
      const newDirs = { UP: false, DOWN: false, LEFT: false, RIGHT: false };
      if (dist >= 14) {
        // Angle in degrees: -180 to 180
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);

        // 8-Way angular slicing
        // UP: -157.5 to -22.5
        if (angle >= -157.5 && angle <= -22.5) newDirs.UP = true;
        // DOWN: 22.5 to 157.5
        if (angle >= 22.5 && angle <= 157.5) newDirs.DOWN = true;
        // RIGHT: -67.5 to 67.5
        if (angle >= -67.5 && angle <= 67.5) newDirs.RIGHT = true;
        // LEFT: > 112.5 or < -112.5
        if (angle >= 112.5 || angle <= -112.5) newDirs.LEFT = true;
      }

      let stateChanged = false;
      for (const dir in newDirs) {
        if (newDirs[dir] !== this.activeDirs[dir]) {
          stateChanged = true;
          this.activeDirs[dir] = newDirs[dir];
          send(["b", dir, newDirs[dir] ? 1 : 0]);
          if (this.buttons[dir]) {
            this.buttons[dir].classList.toggle("active", newDirs[dir]);
          }
        }
      }
      if (stateChanged && dist >= 14) {
        haptic(16);
      }
    }

    clearAll() {
      for (const dir in this.activeDirs) {
        if (this.activeDirs[dir]) {
          this.activeDirs[dir] = false;
          send(["b", dir, 0]);
          if (this.buttons[dir]) {
            this.buttons[dir].classList.remove("active");
          }
        }
      }
    }
  }

  // Initialize D-Pad Manager
  new DPadManager();

  // --- ACTION & SHOULDER BUTTONS ENGINE (MULTI-TOUCH + SLIDING) ---
  const activeBtnTouches = new Map();

  function pressButton(btn, touchId) {
    if (!btn) return;
    const btnName = btn.dataset.btn;
    if (!btnName) return;

    btn.classList.add("active");
    activeBtnTouches.set(touchId, btn);
    haptic(18);

    if (btnName === "L2" || btnName === "R2") {
      send(["t", btnName, 1.0]);
      send(["b", btnName, 1]);
    } else {
      send(["b", btnName, 1]);
    }
  }

  function releaseButton(btn, touchId) {
    if (!btn) return;
    const btnName = btn.dataset.btn;
    if (!btnName) return;

    btn.classList.remove("active");
    if (touchId !== undefined) {
      activeBtnTouches.delete(touchId);
    }

    if (btnName === "L2" || btnName === "R2") {
      send(["t", btnName, 0.0]);
      send(["b", btnName, 0]);
    } else {
      send(["b", btnName, 0]);
    }
  }

  const standardButtons = document.querySelectorAll("[data-btn]:not(.dpad-btn)");
  standardButtons.forEach((el) => {
    el.addEventListener("touchstart", (e) => {
      if (window.isEditLayoutMode) return;
      e.preventDefault();
      e.stopPropagation();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        pressButton(el, touch.identifier);
      }
    }, { passive: false });

    el.addEventListener("touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        releaseButton(el, touch.identifier);
      }
    }, { passive: false });

    el.addEventListener("touchcancel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        releaseButton(el, touch.identifier);
      }
    }, { passive: false });

    // Desktop mouse fallback (guarded from synthetic touch events)
    el.addEventListener("mousedown", (e) => {
      if (window.isEditLayoutMode) return;
      if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
      e.preventDefault();
      pressButton(el, "mouse_" + el.dataset.btn);
    });

    el.addEventListener("mouseup", (e) => {
      if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
      releaseButton(el, "mouse_" + el.dataset.btn);
    });

    el.addEventListener("mouseleave", (e) => {
      if (activeBtnTouches.has("mouse_" + el.dataset.btn)) {
        releaseButton(el, "mouse_" + el.dataset.btn);
      }
    });
  });

  // Global touchmove to allow smooth sliding between action buttons
  window.addEventListener("touchmove", (e) => {
    if (window.isEditLayoutMode) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (activeBtnTouches.has(touch.identifier)) {
        const currentBtn = activeBtnTouches.get(touch.identifier);
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        const newBtn = target ? target.closest("[data-btn]:not(.dpad-btn)") : null;

        if (newBtn && newBtn !== currentBtn) {
          releaseButton(currentBtn, touch.identifier);
          pressButton(newBtn, touch.identifier);
        }
      }
    }
  }, { passive: false });

  // --- ZERO-LAG ANALOG STICK ENGINE ---
  class TouchStick {
    constructor(zoneId, knobId, stickCode) {
      this.zone = document.getElementById(zoneId) || document.getElementById(zoneId.replace("cluster-", "") + "-zone");
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

      // Desktop Mouse Fallback
      let isMouseDown = false;
      this.zone.addEventListener("mousedown", (e) => {
        if (window.isEditLayoutMode) return;
        if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
        isMouseDown = true;
        const rect = this.zone.getBoundingClientRect();
        this.centerX = rect.left + rect.width / 2;
        this.centerY = rect.top + rect.height / 2;
        this.knob.style.transition = "none";
        this.updateStick(e.clientX, e.clientY);
      });
      window.addEventListener("mousemove", (e) => {
        if (isMouseDown) {
          this.updateStick(e.clientX, e.clientY);
        }
      });
      window.addEventListener("mouseup", (e) => {
        if (isMouseDown) {
          isMouseDown = false;
          this.resetStick();
        }
      });
    }

    onTouchStart(e) {
      if (window.isEditLayoutMode) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.touchId !== null) return;
      const touch = e.changedTouches[0];
      this.touchId = touch.identifier;

      const rect = this.zone.getBoundingClientRect();
      this.centerX = rect.left + rect.width / 2;
      this.centerY = rect.top + rect.height / 2;

      // 0ms input lag: disable transition when moving
      this.knob.style.transition = "none";
      this.updateStick(touch.clientX, touch.clientY);
      haptic(15);
    }

    onTouchMove(e) {
      if (this.touchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.touchId) {
          e.preventDefault();
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
      const mag = Math.hypot(nx, ny);

      // Smooth parabolic deadzone
      if (mag < 0.08) {
        nx = 0;
        ny = 0;
      } else {
        const smoothMag = (mag - 0.08) / 0.92;
        const curvedMag = Math.pow(smoothMag, 1.15);
        nx = (nx / mag) * curvedMag;
        ny = (ny / mag) * curvedMag;
      }

      send(["a", this.stickCode, nx, ny]);
    }

    resetStick() {
      this.touchId = null;
      // Spring snap-back transition
      this.knob.style.transition = "transform 0.12s cubic-bezier(0.18, 0.89, 0.32, 1.28)";
      this.knob.style.transform = "translate(0px, 0px)";
      send(["a", this.stickCode, 0, 0]);
    }
  }

  // Initialize Analog Sticks
  new TouchStick("cluster-lstick", "left-knob", "L");
  new TouchStick("cluster-rstick", "right-knob", "R");

  // Initialize Draggable Clusters & Load Saved Settings / Layout
  initClusterDraggable();
  loadSavedSettings();

  // Prevent default scroll & zoom gestures on the whole viewport
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  // Initialize server configuration and auto-connect if code exists
  resolveServerHost().then(() => {
    if (paramCode && paramServer) {
      connect();
    }
  });
})();
