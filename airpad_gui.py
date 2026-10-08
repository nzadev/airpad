#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import time
from urllib.request import urlopen, Request

from PyQt6.QtCore import Qt, QThread, pyqtSignal, QTimer, QUrl
from PyQt6.QtGui import QIcon, QPixmap, QFont, QColor
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QPushButton, QFrame, QTextEdit, QGridLayout, QMessageBox
)
from PyQt6.QtWebSockets import QWebSocket
from PyQt6.QtNetwork import QAbstractSocket

BASE_DIR = os.path.dirname(os.path.realpath(__file__))

STYLE_SHEET = """
QMainWindow {
    background-color: #0b0d17;
}

QWidget {
    color: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

QFrame.card {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #131728, stop:1 #0c0f1c);
    border: 1.5px solid rgba(56, 189, 248, 0.25);
    border-radius: 16px;
}

QLabel.title {
    font-size: 13px;
    font-weight: 800;
    color: #38bdf8;
    letter-spacing: 1.5px;
}

QLabel.code-display {
    font-size: 38px;
    font-weight: 900;
    color: #38bdf8;
    letter-spacing: 8px;
    background-color: #060810;
    border: 1.5px solid rgba(56, 189, 248, 0.4);
    border-radius: 12px;
    padding: 10px;
}

QPushButton.btn-primary {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #0284c7, stop:1 #2563eb);
    color: #ffffff;
    font-weight: 800;
    font-size: 13px;
    border: none;
    border-radius: 10px;
    padding: 10px 18px;
}
QPushButton.btn-primary:hover {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #38bdf8, stop:1 #3b82f6);
}
QPushButton.btn-primary:pressed {
    background: #0369a1;
}

QPushButton.btn-secondary {
    background: rgba(30, 41, 59, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #94a3b8;
    font-weight: 700;
    font-size: 12px;
    border-radius: 8px;
    padding: 6px 12px;
}
QPushButton.btn-secondary:hover {
    color: #38bdf8;
    border-color: #38bdf8;
}

QTextEdit.log-box {
    background-color: #060810;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    color: #94a3b8;
    font-family: monospace;
    font-size: 11px;
    padding: 8px;
}
"""

PLAYER_THEMES = {
    1: {"color": "#38bdf8", "bg_active": "rgba(14, 165, 233, 0.22)", "border_active": "#38bdf8", "badge_bg": "#0284c7"},
    2: {"color": "#f87171", "bg_active": "rgba(239, 68, 68, 0.22)", "border_active": "#f87171", "badge_bg": "#dc2626"},
    3: {"color": "#4ade80", "bg_active": "rgba(34, 197, 94, 0.22)", "border_active": "#4ade80", "badge_bg": "#16a34a"},
    4: {"color": "#facc15", "bg_active": "rgba(234, 179, 8, 0.22)", "border_active": "#facc15", "badge_bg": "#ca8a04"},
    5: {"color": "#c084fc", "bg_active": "rgba(168, 85, 247, 0.22)", "border_active": "#c084fc", "badge_bg": "#9333ea"},
    6: {"color": "#fb923c", "bg_active": "rgba(249, 115, 22, 0.22)", "border_active": "#fb923c", "badge_bg": "#ea580c"},
    7: {"color": "#2dd4bf", "bg_active": "rgba(20, 184, 166, 0.22)", "border_active": "#2dd4bf", "badge_bg": "#0d9488"},
    8: {"color": "#f472b6", "bg_active": "rgba(236, 72, 153, 0.22)", "border_active": "#f472b6", "badge_bg": "#db2777"},
}

class ServerPollWorker(QThread):
    status_updated = pyqtSignal(dict)

    def __init__(self):
        super().__init__()
        self.running = True

    def run(self):
        while self.running:
            try:
                req = Request("http://127.0.0.1:8080/api/status", headers={"User-Agent": "AirPadGUI"})
                with urlopen(req, timeout=3.0) as res:
                    if res.status == 200:
                        data = json.loads(res.read().decode())
                        self.status_updated.emit(data)
                    else:
                        self.status_updated.emit({"status": "offline"})
            except Exception:
                # If server not up yet
                self.status_updated.emit({"status": "offline"})
            time.sleep(1.8)

    def stop(self):
        self.running = False

class AirPadMainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("AirPad Control Center")
        self.resize(780, 580)
        self.setMinimumSize(700, 520)

        icon_path = os.path.join(BASE_DIR, "app_icon.png")
        if os.path.exists(icon_path):
            self.setWindowIcon(QIcon(icon_path))

        self.setStyleSheet(STYLE_SHEET)

        self.current_code = "----"
        self.current_tunnel = ""
        self.current_local_ip = ""
        self.qr_mode = "cloud"

        self.init_ui()
        self.load_initial_config()
        self.ensure_backend_running()

        self.poll_worker = ServerPollWorker()
        self.poll_worker.status_updated.connect(self.on_status_updated)
        self.poll_worker.start()

        self.setup_websocket()

    def load_initial_config(self):
        cfg_path = os.path.join(BASE_DIR, "config.json")
        if os.path.exists(cfg_path):
            try:
                with open(cfg_path, "r") as f:
                    data = json.load(f)
                    self.current_code = str(data.get("code", "----"))
                    self.current_tunnel = data.get("server", "")
                    self.current_local_ip = data.get("local_ip", "")
                    self.lbl_code_val.setText(self.current_code)
                    self.lbl_tunnel.setText("🌐 Tunnel: " + (self.current_tunnel or "-"))
                    self.lbl_local.setText("🏠 Wi-Fi: " + (self.current_local_ip or "-"))
                    self.update_qr_image()
            except Exception:
                pass

    def setup_websocket(self):
        self.ws = QWebSocket()
        self.ws.textMessageReceived.connect(self.on_ws_message)
        self.ws.connected.connect(self.on_ws_connected)
        self.ws.disconnected.connect(self.on_ws_disconnected)
        self.ws.errorOccurred.connect(self.on_ws_error)
        self.ws_timer = QTimer(self)
        self.ws_timer.setInterval(2500)
        self.ws_timer.timeout.connect(self.open_ws)
        self.open_ws()

    def open_ws(self):
        if self.ws.state() != QAbstractSocket.SocketState.ConnectedState and self.ws.state() != QAbstractSocket.SocketState.ConnectingState:
            self.ws.open(QUrl("ws://127.0.0.1:8080/ws/monitor"))

    def on_ws_connected(self):
        self.ws_timer.stop()

    def on_ws_disconnected(self):
        if not self.ws_timer.isActive():
            self.ws_timer.start()

    def on_ws_error(self, _):
        if not self.ws_timer.isActive():
            self.ws_timer.start()

    def init_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QVBoxLayout(central)
        main_layout.setContentsMargins(20, 18, 20, 18)
        main_layout.setSpacing(16)

        # Header bar
        header_bar = QHBoxLayout()
        logo_label = QLabel()
        logo_path = os.path.join(BASE_DIR, "app_icon.png")
        if os.path.exists(logo_path):
            pix = QPixmap(logo_path).scaled(42, 42, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            logo_label.setPixmap(pix)

        brand_vbox = QVBoxLayout()
        brand_title = QLabel("AirPad Control Center")
        brand_title.setStyleSheet("font-size: 20px; font-weight: 900; color: #f8fafc;")
        brand_sub = QLabel("Virtual Mobile Gamepad Server with Instant QR Pairing")
        brand_sub.setStyleSheet("font-size: 11px; color: #64748b;")
        brand_vbox.addWidget(brand_title)
        brand_vbox.addWidget(brand_sub)

        header_bar.addWidget(logo_label)
        header_bar.addLayout(brand_vbox)
        header_bar.addStretch()

        self.badge_status = QLabel("● SERVER ONLINE")
        self.badge_status.setStyleSheet("background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.4); color: #4ade80; font-weight: 800; font-size: 12px; border-radius: 14px; padding: 6px 14px;")
        header_bar.addWidget(self.badge_status)

        main_layout.addLayout(header_bar)

        # Two-column Grid
        grid_layout = QHBoxLayout()
        grid_layout.setSpacing(16)

        # --- LEFT CARD: QR Code & Pairing HUD ---
        card_left = QFrame()
        card_left.setProperty("class", "card")
        card_left_layout = QVBoxLayout(card_left)
        card_left_layout.setContentsMargins(18, 16, 18, 16)
        card_left_layout.setSpacing(12)

        lbl_qr_title = QLabel("📷 SCAN UNTUK KONEK OTOMATIS")
        lbl_qr_title.setProperty("class", "title")
        card_left_layout.addWidget(lbl_qr_title)

        # QR Mode Selector Buttons
        qr_tabs = QHBoxLayout()
        qr_tabs.setSpacing(6)
        self.btn_mode_cloud = QPushButton("🌐 Cloudflare")
        self.btn_mode_cloud.setProperty("class", "btn-secondary")
        self.btn_mode_cloud.setStyleSheet("background: rgba(56, 189, 248, 0.2); border-color: #38bdf8; color: #38bdf8; font-weight: 700; font-size: 11px;")
        self.btn_mode_cloud.clicked.connect(lambda: self.set_qr_mode("cloud"))

        self.btn_mode_local = QPushButton("🏠 Wi-Fi Lokal")
        self.btn_mode_local.setProperty("class", "btn-secondary")
        self.btn_mode_local.setStyleSheet("background: rgba(30, 41, 59, 0.8); border-color: rgba(255, 255, 255, 0.12); color: #94a3b8; font-weight: 700; font-size: 11px;")
        self.btn_mode_local.clicked.connect(lambda: self.set_qr_mode("local"))

        self.btn_mode_apk = QPushButton("📥 Unduh APK")
        self.btn_mode_apk.setProperty("class", "btn-secondary")
        self.btn_mode_apk.setStyleSheet("background: rgba(30, 41, 59, 0.8); border-color: rgba(255, 255, 255, 0.12); color: #94a3b8; font-weight: 700; font-size: 11px;")
        self.btn_mode_apk.clicked.connect(lambda: self.set_qr_mode("apk"))

        qr_tabs.addWidget(self.btn_mode_cloud)
        qr_tabs.addWidget(self.btn_mode_local)
        qr_tabs.addWidget(self.btn_mode_apk)
        card_left_layout.addLayout(qr_tabs)

        # QR Code Display
        self.lbl_qr_image = QLabel()
        self.lbl_qr_image.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_qr_image.setStyleSheet("background: #ffffff; border-radius: 12px; padding: 10px;")
        self.lbl_qr_image.setFixedSize(210, 210)
        card_left_layout.addWidget(self.lbl_qr_image, alignment=Qt.AlignmentFlag.AlignCenter)

        self.lbl_qr_hint = QLabel("Buka aplikasi AirPad di HP lalu tap [SCAN QR PC]")
        self.lbl_qr_hint.setStyleSheet("font-size: 11px; color: #94a3b8; text-align: center;")
        self.lbl_qr_hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        card_left_layout.addWidget(self.lbl_qr_hint)

        # Code display box
        code_box = QVBoxLayout()
        lbl_code_title = QLabel("KODE PAIRING (4 DIGIT):")
        lbl_code_title.setStyleSheet("font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 1px;")
        self.lbl_code_val = QLabel("----")
        self.lbl_code_val.setProperty("class", "code-display")
        self.lbl_code_val.setAlignment(Qt.AlignmentFlag.AlignCenter)
        code_box.addWidget(lbl_code_title)
        code_box.addWidget(self.lbl_code_val)
        card_left_layout.addLayout(code_box)

        # URL Shortcuts
        urls_layout = QVBoxLayout()
        urls_layout.setSpacing(6)

        row_tunnel = QHBoxLayout()
        self.lbl_tunnel = QLabel("🌐 Tunnel: Memuat...")
        self.lbl_tunnel.setStyleSheet("font-size: 11px; color: #94a3b8;")
        btn_copy_tunnel = QPushButton("Salin")
        btn_copy_tunnel.setProperty("class", "btn-secondary")
        btn_copy_tunnel.clicked.connect(self.copy_tunnel)
        row_tunnel.addWidget(self.lbl_tunnel, 1)
        row_tunnel.addWidget(btn_copy_tunnel)

        row_local = QHBoxLayout()
        self.lbl_local = QLabel("🏠 Wi-Fi: Memuat...")
        self.lbl_local.setStyleSheet("font-size: 11px; color: #94a3b8;")
        btn_copy_local = QPushButton("Salin")
        btn_copy_local.setProperty("class", "btn-secondary")
        btn_copy_local.clicked.connect(self.copy_local)
        row_local.addWidget(self.lbl_local, 1)
        row_local.addWidget(btn_copy_local)

        row_apk = QHBoxLayout()
        self.lbl_apk = QLabel("📥 APK HP: AirPad.apk (77 KB)")
        self.lbl_apk.setStyleSheet("font-size: 11px; color: #94a3b8;")
        btn_copy_apk = QPushButton("Salin")
        btn_copy_apk.setProperty("class", "btn-secondary")
        btn_copy_apk.clicked.connect(self.copy_apk)
        row_apk.addWidget(self.lbl_apk, 1)
        row_apk.addWidget(btn_copy_apk)

        urls_layout.addLayout(row_tunnel)
        urls_layout.addLayout(row_local)
        urls_layout.addLayout(row_apk)
        card_left_layout.addLayout(urls_layout)

        grid_layout.addWidget(card_left, 1)

        # --- RIGHT CARD: Players & Realtime Activity ---
        card_right = QFrame()
        card_right.setProperty("class", "card")
        card_right_layout = QVBoxLayout(card_right)
        card_right_layout.setContentsMargins(18, 16, 18, 16)
        card_right_layout.setSpacing(12)

        lbl_players_title = QLabel("🎮 STATUS STIK TERHUBUNG (MAX 8)")
        lbl_players_title.setProperty("class", "title")
        card_right_layout.addWidget(lbl_players_title)

        # Slots Grid (2 columns, default P1-P4, expandable up to 8)
        self.players_grid = QGridLayout()
        self.players_grid.setSpacing(8)
        self.slots = {}
        for p in range(1, 5):
            self.create_player_slot(p)
        card_right_layout.addLayout(self.players_grid)

        # Live Input Log
        lbl_log_title = QLabel("⚡ LIVE INPUT MONITOR")
        lbl_log_title.setStyleSheet("font-size: 12px; font-weight: 800; color: #38bdf8; margin-top: 6px;")
        card_right_layout.addWidget(lbl_log_title)

        self.log_box = QTextEdit()
        self.log_box.setProperty("class", "log-box")
        self.log_box.setReadOnly(True)
        self.log_box.append("AirPad Control Center aktif. Siap menerima input gamepad.")
        card_right_layout.addWidget(self.log_box, 1)

        # Bottom buttons
        btn_box = QHBoxLayout()
        btn_open_browser = QPushButton("🌐 Buka Web Dashboard")
        btn_open_browser.setProperty("class", "btn-secondary")
        btn_open_browser.clicked.connect(self.open_dashboard)

        self.btn_restart = QPushButton("🔄 Restart Server")
        self.btn_restart.setProperty("class", "btn-primary")
        self.btn_restart.clicked.connect(self.restart_server)

        btn_box.addWidget(btn_open_browser)
        btn_box.addWidget(self.btn_restart)
        card_right_layout.addLayout(btn_box)

        grid_layout.addWidget(card_right, 1)
        main_layout.addLayout(grid_layout)

    def set_qr_mode(self, mode):
        self.qr_mode = mode
        active_style = "background: rgba(56, 189, 248, 0.2); border-color: #38bdf8; color: #38bdf8; font-weight: 700; font-size: 11px;"
        inactive_style = "background: rgba(30, 41, 59, 0.8); border-color: rgba(255, 255, 255, 0.12); color: #94a3b8; font-weight: 700; font-size: 11px;"

        self.btn_mode_cloud.setStyleSheet(active_style if mode == "cloud" else inactive_style)
        self.btn_mode_local.setStyleSheet(active_style if mode == "local" else inactive_style)
        self.btn_mode_apk.setStyleSheet(active_style if mode == "apk" else inactive_style)

        if mode == "apk":
            self.lbl_qr_hint.setText("Arahkan kamera HP ke QR untuk langsung download APK")
        else:
            self.lbl_qr_hint.setText("Buka aplikasi AirPad di HP lalu tap [SCAN QR PC]")
        self.update_qr_image()

    def on_ws_message(self, message):
        try:
            ev = json.loads(message)
            mtype = ev.get("type")
            if mtype == "player_join":
                p = ev.get("player")
                self.log_box.append(f"🎮 Player {p} terhubung!")
                self.set_player_state(p, True)
            elif mtype == "player_leave":
                p = ev.get("player")
                self.log_box.append(f"⚠️ Player {p} terputus.")
                self.set_player_state(p, False)
            elif mtype == "input":
                p = ev.get("player")
                btn = ev.get("btn")
                val = ev.get("val")
                state = "DITEKAN" if val == 1 else "DILEPAS"
                self.log_box.append(f"P{p}: {btn} {state}")
            elif mtype == "state":
                self.on_status_updated(ev)
        except Exception:
            pass

    def create_player_slot(self, p):
        if p in self.slots:
            return
        theme = PLAYER_THEMES.get(p, PLAYER_THEMES[1])
        slot_frame = QFrame()
        slot_frame.setStyleSheet("background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 6px 10px;")
        slot_layout = QHBoxLayout(slot_frame)
        slot_layout.setContentsMargins(4, 4, 4, 4)
        slot_layout.setSpacing(8)

        # Player badge
        badge = QLabel(f"P{p}")
        badge.setStyleSheet(f"background: {theme['badge_bg']}; color: #ffffff; font-weight: 900; font-size: 11px; border-radius: 6px; padding: 4px 7px;")
        badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
        slot_layout.addWidget(badge)

        info_vbox = QVBoxLayout()
        info_vbox.setSpacing(2)
        p_name = QLabel(f"PLAYER {p}")
        p_name.setStyleSheet(f"font-size: 12px; font-weight: 800; color: {theme['color']};")
        p_status = QLabel("Menunggu HP...")
        p_status.setStyleSheet("font-size: 10px; color: #64748b;")
        info_vbox.addWidget(p_name)
        info_vbox.addWidget(p_status)
        slot_layout.addLayout(info_vbox)
        slot_layout.addStretch()

        self.slots[p] = {"frame": slot_frame, "status": p_status, "theme": theme}
        row = (p - 1) // 2
        col = (p - 1) % 2
        self.players_grid.addWidget(slot_frame, row, col)

    def set_player_state(self, p, active):
        if p not in self.slots:
            if p <= 8:
                self.create_player_slot(p)
            else:
                return

        theme = self.slots[p]["theme"]
        if active:
            self.slots[p]["frame"].setStyleSheet(f"background: {theme['bg_active']}; border: 1.5px solid {theme['border_active']}; border-radius: 10px; padding: 6px 10px;")
            self.slots[p]["status"].setText("🟢 Terhubung")
            self.slots[p]["status"].setStyleSheet("font-size: 10px; color: #4ade80; font-weight: 700;")
        else:
            self.slots[p]["frame"].setStyleSheet("background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 6px 10px;")
            self.slots[p]["status"].setText("Menunggu HP...")
            self.slots[p]["status"].setStyleSheet("font-size: 10px; color: #64748b;")

    def on_status_updated(self, data):
        if data.get("status") == "offline":
            self.badge_status.setText("● SERVER OFFLINE")
            self.badge_status.setStyleSheet("background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171; font-weight: 800; font-size: 12px; border-radius: 14px; padding: 6px 14px;")
            self.btn_restart.setText("▶ Nyalakan Server")
            return

        self.badge_status.setText("● SERVER ONLINE")
        self.badge_status.setStyleSheet("background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.4); color: #4ade80; font-weight: 800; font-size: 12px; border-radius: 14px; padding: 6px 14px;")
        self.btn_restart.setText("🔄 Restart Server")

        code = str(data.get("code", "----"))
        changed = False
        if code != self.current_code:
            self.current_code = code
            self.lbl_code_val.setText(code)
            changed = True

        tunnel = data.get("tunnel", "")
        if tunnel != self.current_tunnel:
            self.current_tunnel = tunnel
            self.lbl_tunnel.setText("🌐 Tunnel: " + (tunnel if tunnel else "Menghubungkan..."))
            changed = True

        local_ip = data.get("local_ip", "")
        if local_ip != self.current_local_ip:
            self.current_local_ip = local_ip
            self.lbl_local.setText("🏠 Wi-Fi: " + (local_ip if local_ip else "-"))
            changed = True

        if changed:
            self.update_qr_image()

        players = data.get("players", [])
        max_slot = max([4] + players)
        for p in range(1, max_slot + 1):
            if p <= 8:
                self.set_player_state(p, p in players)

    def update_qr_image(self):
        if self.qr_mode == "apk":
            qr_payload = "https://nzadev.github.io/airpad/AirPad.apk"
        else:
            target_server = self.current_local_ip if self.qr_mode == "local" else self.current_tunnel
            if not target_server or self.current_code == "----":
                return
            qr_payload = f"airpad://connect?code={self.current_code}&server={target_server}"

        try:
            res = subprocess.run(
                ["qrencode", "-o", "-", "-s", "8", "-m", "2", qr_payload],
                capture_output=True,
                check=True
            )
            pix = QPixmap()
            if pix.loadFromData(res.stdout):
                self.lbl_qr_image.setPixmap(pix.scaled(190, 190, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        except Exception:
            self.lbl_qr_image.setText("QR Gagal Digenerate")

    def copy_tunnel(self):
        if self.current_tunnel:
            QApplication.clipboard().setText(f"https://nzadev.github.io/airpad/?code={self.current_code}&server={self.current_tunnel}")
            QMessageBox.information(self, "Tersalin", "Link Tunnel berhasil disalin ke clipboard!")

    def copy_local(self):
        if self.current_local_ip:
            QApplication.clipboard().setText(f"http://{self.current_local_ip}/?code={self.current_code}")
            QMessageBox.information(self, "Tersalin", "Link Wi-Fi lokal berhasil disalin ke clipboard!")

    def copy_apk(self):
        url = "https://nzadev.github.io/airpad/AirPad.apk"
        QApplication.clipboard().setText(url)
        QMessageBox.information(self, "Tersalin", f"Link Download APK berhasil disalin ke clipboard:\n{url}")

    def open_dashboard(self):
        subprocess.Popen(["xdg-open", "http://127.0.0.1:8080/dashboard"])

    def ensure_backend_running(self):
        try:
            req = urllib.request.Request("http://127.0.0.1:8080/api/status", headers={"User-Agent": "AirPadControlCenter/1.0"})
            with urllib.request.urlopen(req, timeout=1.0) as res:
                if res.status == 200:
                    return
        except Exception:
            pass
        self.start_backend(force_new_code=False)

    def start_backend(self, force_new_code=False):
        self.log_box.append("Menjalankan backend server AirPad...")
        code = self.current_code if (not force_new_code and self.current_code and self.current_code != "----") else "6815"
        env = os.environ.copy()
        env["AIRPAD_CODE"] = code
        subprocess.run(["pkill", "-f", "server.py"], capture_output=True)
        subprocess.Popen([sys.executable, os.path.join(BASE_DIR, "server.py")], env=env, start_new_session=True)

        cf_running = subprocess.run(["pgrep", "-f", "cloudflared.*8080"], capture_output=True).returncode == 0
        if not cf_running:
            subprocess.Popen(["cloudflared", "tunnel", "--protocol", "http2", "--url", "http://127.0.0.1:8080"], start_new_session=True)

    def restart_server(self):
        is_online = ("ONLINE" in self.badge_status.text())
        if is_online:
            reply = QMessageBox.question(
                self, "Restart Server",
                "Mulai ulang server dan muat ulang koneksi?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
            )
            if reply != QMessageBox.StandardButton.Yes:
                return

        self.log_box.append("Memulai ulang server AirPad...")
        self.start_backend(force_new_code=False)

    def closeEvent(self, event):
        if hasattr(self, "ws_timer"):
            self.ws_timer.stop()
        if hasattr(self, "ws"):
            self.ws.close()
        self.poll_worker.stop()
        event.accept()

def main():
    app = QApplication(sys.argv)
    window = AirPadMainWindow()
    window.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
