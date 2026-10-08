#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
import threading
import time
from urllib.request import urlopen, Request

from PyQt6.QtCore import Qt, QThread, pyqtSignal, QTimer, QUrl
from PyQt6.QtGui import QIcon, QPixmap
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QPushButton, QFrame, QTextEdit, QGridLayout, QMessageBox
)
from PyQt6.QtWebSockets import QWebSocket
from PyQt6.QtNetwork import QAbstractSocket

BASE_DIR = os.path.dirname(os.path.realpath(__file__))

STYLE_SHEET = """
QMainWindow {
    background-color: #070913;
}

QWidget {
    color: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

QFrame.card {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #111528, stop:1 #080b18);
    border: 1.5px solid rgba(168, 85, 247, 0.3);
    border-radius: 16px;
}

QLabel.title {
    font-size: 13px;
    font-weight: 800;
    color: #c084fc;
    letter-spacing: 1.5px;
}

QLabel.code-display {
    font-size: 38px;
    font-weight: 900;
    color: #c084fc;
    letter-spacing: 8px;
    background-color: #04060e;
    border: 1.5px solid rgba(168, 85, 247, 0.5);
    border-radius: 12px;
    padding: 10px;
}

QPushButton.btn-primary {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #7e22ce, stop:1 #9333ea);
    color: #ffffff;
    font-weight: 800;
    font-size: 13px;
    border: none;
    border-radius: 10px;
    padding: 10px 18px;
}
QPushButton.btn-primary:hover {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #a855f7, stop:1 #c084fc);
}
QPushButton.btn-primary:pressed {
    background: #6b21a8;
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
    color: #c084fc;
    border-color: #c084fc;
}

QTextEdit.log-box {
    background-color: #04060e;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    color: #94a3b8;
    font-family: monospace;
    font-size: 11px;
    padding: 8px;
}
"""

class ServerPollWorker(QThread):
    status_updated = pyqtSignal(dict)

    def __init__(self):
        super().__init__()
        self.running = True

    def run(self):
        while self.running:
            try:
                req = Request("http://127.0.0.1:8080/api/status", headers={"User-Agent": "AirPadTVGUI"})
                with urlopen(req, timeout=1.5) as res:
                    if res.status == 200:
                        data = json.loads(res.read().decode())
                        self.status_updated.emit(data)
                    else:
                        self.status_updated.emit({"status": "offline"})
            except Exception:
                self.status_updated.emit({"status": "offline"})
            time.sleep(1.5)

    def stop(self):
        self.running = False

class AirPadTVMainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("AirPad - Android TV Control Center")
        self.resize(780, 580)
        self.setMinimumSize(700, 520)

        icon_path = os.path.join(BASE_DIR, "app_icon.png")
        if os.path.exists(icon_path):
            self.setWindowIcon(QIcon(icon_path))

        self.setStyleSheet(STYLE_SHEET)

        self.tv_code = "7720"
        self.current_tunnel = ""
        self.current_local_ip = ""
        self.qr_mode = "cloud"

        self.init_ui()
        self.load_initial_config()

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
                    self.tv_code = str(data.get("tv_code", "7720"))
                    self.current_tunnel = data.get("server", "")
                    self.current_local_ip = data.get("local_ip", "")
                    self.lbl_code_val.setText(self.tv_code)
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
        brand_title = QLabel("AirPad Android TV Control Center")
        brand_title.setStyleSheet("font-size: 20px; font-weight: 900; color: #f8fafc;")
        brand_sub = QLabel("Bluetooth HID & Wi-Fi Gamepad Server untuk Android TV / Google TV")
        brand_sub.setStyleSheet("font-size: 11px; color: #a855f7;")
        brand_vbox.addWidget(brand_title)
        brand_vbox.addWidget(brand_sub)

        header_bar.addWidget(logo_label)
        header_bar.addLayout(brand_vbox)
        header_bar.addStretch()

        self.badge_status = QLabel("📺 TV SERVER ONLINE")
        self.badge_status.setStyleSheet("background: rgba(168, 85, 247, 0.18); border: 1px solid rgba(168, 85, 247, 0.4); color: #c084fc; font-weight: 800; font-size: 12px; border-radius: 14px; padding: 6px 14px;")
        header_bar.addWidget(self.badge_status)

        main_layout.addLayout(header_bar)

        grid_layout = QHBoxLayout()
        grid_layout.setSpacing(16)

        # --- LEFT CARD: QR Code & TV Pairing HUD ---
        card_left = QFrame()
        card_left.setProperty("class", "card")
        card_left_layout = QVBoxLayout(card_left)
        card_left_layout.setContentsMargins(18, 16, 18, 16)
        card_left_layout.setSpacing(12)

        lbl_qr_title = QLabel("📺 SCAN UNTUK KONEK KE TV")
        lbl_qr_title.setProperty("class", "title")
        card_left_layout.addWidget(lbl_qr_title)

        # QR Mode Selector Buttons
        qr_tabs = QHBoxLayout()
        qr_tabs.setSpacing(6)
        self.btn_mode_cloud = QPushButton("🌐 Cloudflare")
        self.btn_mode_cloud.setProperty("class", "btn-secondary")
        self.btn_mode_cloud.setStyleSheet("background: rgba(168, 85, 247, 0.2); border-color: #a855f7; color: #c084fc; font-weight: 700; font-size: 11px;")
        self.btn_mode_cloud.clicked.connect(lambda: self.set_qr_mode("cloud"))

        self.btn_mode_local = QPushButton("🏠 Wi-Fi TV")
        self.btn_mode_local.setProperty("class", "btn-secondary")
        self.btn_mode_local.setStyleSheet("background: rgba(30, 41, 59, 0.8); border-color: rgba(255, 255, 255, 0.12); color: #94a3b8; font-weight: 700; font-size: 11px;")
        self.btn_mode_local.clicked.connect(lambda: self.set_qr_mode("local"))

        self.btn_mode_apk = QPushButton("📥 Unduh APK TV")
        self.btn_mode_apk.setProperty("class", "btn-secondary")
        self.btn_mode_apk.setStyleSheet("background: rgba(30, 41, 59, 0.8); border-color: rgba(255, 255, 255, 0.12); color: #94a3b8; font-weight: 700; font-size: 11px;")
        self.btn_mode_apk.clicked.connect(lambda: self.set_qr_mode("apk"))

        qr_tabs.addWidget(self.btn_mode_cloud)
        qr_tabs.addWidget(self.btn_mode_local)
        qr_tabs.addWidget(self.btn_mode_apk)
        card_left_layout.addLayout(qr_tabs)

        self.lbl_qr_image = QLabel()
        self.lbl_qr_image.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_qr_image.setStyleSheet("background: #ffffff; border-radius: 12px; padding: 10px;")
        self.lbl_qr_image.setFixedSize(210, 210)
        card_left_layout.addWidget(self.lbl_qr_image, alignment=Qt.AlignmentFlag.AlignCenter)

        self.lbl_qr_hint = QLabel("Buka aplikasi AirPad di HP lalu scan QR atau masukkan kode TV")
        self.lbl_qr_hint.setStyleSheet("font-size: 11px; color: #94a3b8;")
        self.lbl_qr_hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        card_left_layout.addWidget(self.lbl_qr_hint)

        code_box = QVBoxLayout()
        lbl_code_title = QLabel("KODE PAIRING (ANDROID TV):")
        lbl_code_title.setStyleSheet("font-size: 11px; font-weight: 700; color: #a855f7; letter-spacing: 1px;")

        self.lbl_code_val = QLabel("7720")
        self.lbl_code_val.setProperty("class", "code-display")
        self.lbl_code_val.setAlignment(Qt.AlignmentFlag.AlignCenter)
        code_box.addWidget(lbl_code_title)
        code_box.addWidget(self.lbl_code_val)
        card_left_layout.addLayout(code_box)

        urls_layout = QVBoxLayout()
        urls_layout.setSpacing(6)

        row_tv_apk = QHBoxLayout()
        self.lbl_tv_apk = QLabel("📺 APK TV: AirPad-TV.apk (33 KB)")
        self.lbl_tv_apk.setStyleSheet("font-size: 11px; color: #94a3b8;")
        btn_copy_tv = QPushButton("Salin")
        btn_copy_tv.setProperty("class", "btn-secondary")
        btn_copy_tv.clicked.connect(self.copy_tv_apk)
        row_tv_apk.addWidget(self.lbl_tv_apk, 1)
        row_tv_apk.addWidget(btn_copy_tv)

        row_tunnel = QHBoxLayout()
        self.lbl_tunnel = QLabel("🌐 Tunnel: Memuat...")
        self.lbl_tunnel.setStyleSheet("font-size: 11px; color: #94a3b8;")
        btn_copy_tunnel = QPushButton("Salin")
        btn_copy_tunnel.setProperty("class", "btn-secondary")
        btn_copy_tunnel.clicked.connect(self.copy_tunnel)
        row_tunnel.addWidget(self.lbl_tunnel, 1)
        row_tunnel.addWidget(btn_copy_tunnel)

        row_local = QHBoxLayout()
        self.lbl_local = QLabel("🏠 Wi-Fi TV: Memuat...")
        self.lbl_local.setStyleSheet("font-size: 11px; color: #94a3b8;")
        btn_copy_local = QPushButton("Salin")
        btn_copy_local.setProperty("class", "btn-secondary")
        btn_copy_local.clicked.connect(self.copy_local)
        row_local.addWidget(self.lbl_local, 1)
        row_local.addWidget(btn_copy_local)

        urls_layout.addLayout(row_tv_apk)
        urls_layout.addLayout(row_tunnel)
        urls_layout.addLayout(row_local)
        card_left_layout.addLayout(urls_layout)

        grid_layout.addWidget(card_left, 1)

        # --- RIGHT CARD: Bluetooth & TV Activity ---
        card_right = QFrame()
        card_right.setProperty("class", "card")
        card_right_layout = QVBoxLayout(card_right)
        card_right_layout.setContentsMargins(18, 16, 18, 16)
        card_right_layout.setSpacing(12)

        lbl_bt_title = QLabel("📡 KONEKSI BLUETOOTH / WI-FI TV")
        lbl_bt_title.setProperty("class", "title")
        card_right_layout.addWidget(lbl_bt_title)

        box_bt_info = QFrame()
        box_bt_info.setStyleSheet("background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 10px; padding: 12px;")
        box_bt_layout = QVBoxLayout(box_bt_info)
        box_bt_layout.setSpacing(6)

        lbl_bt_1 = QLabel("1. Pasang <b>AirPad-TV.apk</b> di Android TV / Google TV.")
        lbl_bt_1.setStyleSheet("font-size: 12px; color: #e2e8f0;")
        lbl_bt_2 = QLabel("2. Buka aplikasi di TV, lalu buka <b>AirPad</b> di HP.")
        lbl_bt_2.setStyleSheet("font-size: 12px; color: #e2e8f0;")
        lbl_bt_3 = QLabel("3. Masukkan Kode TV <b>7720</b> atau pilih <b>Mode Bluetooth TV</b>.")
        lbl_bt_3.setStyleSheet("font-size: 12px; color: #e2e8f0;")
        lbl_bt_4 = QLabel("4. Gamepad HP langsung terdeteksi sebagai stik TV tanpa kabel!")
        lbl_bt_4.setStyleSheet("font-size: 12px; color: #4ade80; font-weight: 700;")

        box_bt_layout.addWidget(lbl_bt_1)
        box_bt_layout.addWidget(lbl_bt_2)
        box_bt_layout.addWidget(lbl_bt_3)
        box_bt_layout.addWidget(lbl_bt_4)
        card_right_layout.addWidget(box_bt_info)

        lbl_log_title = QLabel("⚡ TV INPUT MONITOR")
        lbl_log_title.setStyleSheet("font-size: 12px; font-weight: 800; color: #c084fc; margin-top: 6px;")
        card_right_layout.addWidget(lbl_log_title)

        self.log_box = QTextEdit()
        self.log_box.setProperty("class", "log-box")
        self.log_box.setReadOnly(True)
        self.log_box.append("AirPad TV Control Center aktif. Siap menerima koneksi TV.")
        card_right_layout.addWidget(self.log_box, 1)

        btn_box = QHBoxLayout()
        btn_open_tv_dash = QPushButton("🌐 Buka Web Dashboard TV")
        btn_open_tv_dash.setProperty("class", "btn-secondary")
        btn_open_tv_dash.clicked.connect(self.open_tv_dashboard)

        btn_box.addWidget(btn_open_tv_dash)
        card_right_layout.addLayout(btn_box)

        grid_layout.addWidget(card_right, 1)
        main_layout.addLayout(grid_layout)

    def set_qr_mode(self, mode):
        self.qr_mode = mode
        active_style = "background: rgba(168, 85, 247, 0.2); border-color: #a855f7; color: #c084fc; font-weight: 700; font-size: 11px;"
        inactive_style = "background: rgba(30, 41, 59, 0.8); border-color: rgba(255, 255, 255, 0.12); color: #94a3b8; font-weight: 700; font-size: 11px;"

        self.btn_mode_cloud.setStyleSheet(active_style if mode == "cloud" else inactive_style)
        self.btn_mode_local.setStyleSheet(active_style if mode == "local" else inactive_style)
        self.btn_mode_apk.setStyleSheet(active_style if mode == "apk" else inactive_style)

        if mode == "apk":
            self.lbl_qr_hint.setText("Arahkan kamera HP ke QR untuk unduh AirPad-TV.apk")
        else:
            self.lbl_qr_hint.setText(f"Scan QR atau masukkan kode TV: {self.tv_code}")
        self.update_qr_image()

    def on_ws_message(self, message):
        try:
            ev = json.loads(message)
            mtype = ev.get("type")
            if mtype == "player_join":
                dev = ev.get("device", "TV")
                p = ev.get("player")
                self.log_box.append(f"🎮 Player {p} [{dev}] terhubung ke TV!")
            elif mtype == "input":
                p = ev.get("player")
                btn = ev.get("btn")
                val = ev.get("val")
                state = "DITEKAN" if val == 1 else "DILEPAS"
                self.log_box.append(f"TV P{p}: {btn} {state}")
        except Exception:
            pass

    def on_status_updated(self, data):
        tv_code = str(data.get("tv_code", "7720"))
        if tv_code != self.tv_code:
            self.tv_code = tv_code
            self.lbl_code_val.setText(tv_code)
            self.update_qr_image()

        tunnel = data.get("tunnel", "")
        if tunnel != self.current_tunnel:
            self.current_tunnel = tunnel
            self.lbl_tunnel.setText("🌐 Tunnel: " + (tunnel or "-"))
            self.update_qr_image()

        local_ip = data.get("local_ip", "")
        if local_ip != self.current_local_ip:
            self.current_local_ip = local_ip
            self.lbl_local.setText("🏠 Wi-Fi TV: " + (local_ip or "-"))
            self.update_qr_image()

    def update_qr_image(self):
        if self.qr_mode == "apk":
            qr_payload = "https://nzadev.github.io/airpad/AirPad-TV.apk"
        else:
            target_server = self.current_local_ip if self.qr_mode == "local" else self.current_tunnel
            if not target_server:
                return
            qr_payload = f"airpad://connect?code={self.tv_code}&server={target_server}&device=tv"

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

    def copy_tv_apk(self):
        url = "https://nzadev.github.io/airpad/AirPad-TV.apk"
        QApplication.clipboard().setText(url)
        QMessageBox.information(self, "Tersalin", f"Link Download APK Android TV berhasil disalin ke clipboard:\n{url}")

    def copy_tunnel(self):
        if self.current_tunnel:
            QApplication.clipboard().setText(f"https://nzadev.github.io/airpad/?code={self.tv_code}&server={self.current_tunnel}&device=tv")
            QMessageBox.information(self, "Tersalin", "Link Tunnel TV berhasil disalin ke clipboard!")

    def copy_local(self):
        if self.current_local_ip:
            QApplication.clipboard().setText(f"http://{self.current_local_ip}/?code={self.tv_code}&device=tv")
            QMessageBox.information(self, "Tersalin", "Link Wi-Fi TV berhasil disalin ke clipboard!")

    def open_tv_dashboard(self):
        subprocess.Popen(["xdg-open", "http://127.0.0.1:8080/dashboard?device=tv"])

    def closeEvent(self, event):
        if hasattr(self, "ws_timer"):
            self.ws_timer.stop()
        if hasattr(self, "ws"):
            self.ws.close()
        self.poll_worker.stop()
        event.accept()

def main():
    app = QApplication(sys.argv)
    window = AirPadTVMainWindow()
    window.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
