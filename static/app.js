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

  // Auth Elements
  const authModal = document.getElementById("auth-modal");
  const inputCode = document.getElementById("input-code");
  const btnSubmitCode = document.getElementById("btn-submit-code");
  const authError = document.getElementById("auth-error");

  // Check URL query param or localStorage for code
  const urlParams = new URLSearchParams(window.location.search);
  let savedCode = urlParams.get("code") || localStorage.getItem("airpad_code") || "";
  if (savedCode) {
    inputCode.value = savedCode;
  }

  // Service Worker Registration for PWA WebAPK
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  // PWA Install prompt handling
  let deferredPrompt = null;
  const btnInstall = document.getElementById("btn-install");

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btnInstall) btnInstall.style.display = "flex";
  });

  if (btnInstall) {
    btnInstall.addEventListener("click", async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === "accepted") {
          btnInstall.style.display = "none";
        }
        deferredPrompt = null;
      }
    });
  }

  // Vibration Helper
  function haptic(ms = 15) {
    if (vibrateEnabled && "vibrate" in navigator) {
      navigator.vibrate(ms);
    }
  }

  btnVibrate.addEventListener("click", () => {
    vibrateEnabled = !vibrateEnabled;
    btnVibrate.classList.toggle("active", vibrateEnabled);
  });

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

  btnFullscreen.addEventListener("click", enterFullscreen);
  btnForceFs.addEventListener("click", enterFullscreen);

  // WebSocket Connection
  function connect() {
    let host = location.host;
    let proto = "wss:";
    if (!host || location.origin.startsWith("file:")) {
      host = localStorage.getItem("airpad_host") || "victorian-internet-unexpected-license.trycloudflare.com";
      proto = "wss:";
    } else {
      proto = location.protocol === "https:" ? "wss:" : "ws:";
    }

    const url = `${proto}//${host}/ws`;

    playerText.textContent = "Menghubungkan...";
    playerBadge.classList.remove("connected");

    try {
      ws = new WebSocket(url);
    } catch (e) {
      authError.textContent = "Gagal menghubungi server!";
      return;
    }

    ws.onopen = () => {
      // If code is ready, send auth immediately
      const codeToSend = inputCode.value.trim();
      if (codeToSend) {
        sendAuth(codeToSend);
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
          authError.textContent = "";
          localStorage.setItem("airpad_code", inputCode.value.trim());
          haptic([30, 50, 30]);

          // Start ping loop
          if (pingInterval) clearInterval(pingInterval);
          pingInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(["ping", Date.now()]));
            }
          }, 2000);

        } else if (data.type === "error") {
          authError.textContent = data.message || "Kode salah!";
          authModal.classList.remove("hidden");
          haptic([50, 100, 50]);

        } else if (Array.isArray(data) && data[0] === "pong") {
          const latency = Date.now() - data[1];
          pingText.textContent = `${latency} ms`;
        }
      } catch (e) {}
    };

    ws.onclose = () => {
      playerText.textContent = "Terputus (Reconnect...)";
      playerBadge.classList.remove("connected");
      if (pingInterval) clearInterval(pingInterval);
      setTimeout(connect, 1500);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  function sendAuth(code) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "auth", code: code }));
    }
  }

  btnSubmitCode.addEventListener("click", () => {
    const code = inputCode.value.trim();
    if (!code) {
      authError.textContent = "Masukkan kode terlebih dahulu!";
      return;
    }
    authError.textContent = "Memverifikasi...";
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

  // Multi-Touch Button Handler
  const activeButtons = new Map(); // touchId -> element

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

  // Setup Button Listeners
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

  // Joystick Manager
  class TouchStick {
    constructor(zoneId, knobId, stickCode) {
      this.zone = document.getElementById(zoneId);
      this.knob = document.getElementById(knobId);
      this.stickCode = stickCode;
      this.touchId = null;
      this.maxRadius = 38;
      this.centerX = 0;
      this.centerY = 0;

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

      // Normalize to -1.0 .. 1.0 with deadzone
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

  // Prevent default scroll/pinch gestures
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  connect();
})();
