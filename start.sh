#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8080}"
CF_LOG="/tmp/cloudflared_webgamepad.log"

# Ambil pairing code tersimpan dari config.json jika ada, atau buat baru jika belum ada
if [[ -z "${AIRPAD_CODE:-}" && -f "$SCRIPT_DIR/config.json" ]]; then
    SAVED_CODE=$(jq -r '.code // empty' "$SCRIPT_DIR/config.json" 2>/dev/null || true)
    if [[ -n "$SAVED_CODE" && "$SAVED_CODE" != "----" && "$SAVED_CODE" != "null" ]]; then
        AIRPAD_CODE="$SAVED_CODE"
    fi
fi
export AIRPAD_CODE="${AIRPAD_CODE:-$((RANDOM % 9000 + 1000))}"

cleanup() {
    echo ""
    echo ">> Menghentikan Web Gamepad Server & Tunnel..."
    kill "$SERVER_PID" 2>/dev/null || true
    kill "$CF_PID" 2>/dev/null || true
    rm -f "$CF_LOG"
}

trap cleanup INT TERM

echo ">> Menjalankan Web Gamepad Server (Kode: $AIRPAD_CODE)..."
python3 "$SCRIPT_DIR/server.py" &
SERVER_PID=$!

echo ">> Menjalankan Cloudflare Tunnel (HTTP/2 mode untuk WebSocket)..."
rm -f "$CF_LOG"
cloudflared tunnel --protocol http2 --url "http://127.0.0.1:$PORT" > "$CF_LOG" 2>&1 &
CF_PID=$!

echo ">> Menghubungkan ke internet publik..."
PUBLIC_URL=""
for _ in {1..40}; do
    if grep -q "trycloudflare.com" "$CF_LOG" 2>/dev/null; then
        PUBLIC_URL=$(grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$CF_LOG" 2>/dev/null | head -n 1 || true)
        if [[ -n "$PUBLIC_URL" ]]; then
            break
        fi
    fi
    sleep 0.5
done

LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' || hostname -I | awk '{print $1}')
SERVER_HOST=$(echo "$PUBLIC_URL" | sed -E 's#^https?://##')
APP_URL="airpad://connect?code=$AIRPAD_CODE&server=$SERVER_HOST"
GITHUB_URL="https://nzadev.github.io/airpad/?code=$AIRPAD_CODE&server=$SERVER_HOST"
FULL_URL="$PUBLIC_URL/?code=$AIRPAD_CODE"
LOCAL_URL="http://$LOCAL_IP:$PORT/?code=$AIRPAD_CODE"

if [[ -n "$SERVER_HOST" ]]; then
    printf '{"server":"%s","local_ip":"%s:%s","code":"%s"}\n' "$SERVER_HOST" "$LOCAL_IP" "$PORT" "$AIRPAD_CODE" > "$SCRIPT_DIR/config.json"
    cp "$SCRIPT_DIR/config.json" "$SCRIPT_DIR/static/config.json" 2>/dev/null || true
    cp "$SCRIPT_DIR/config.json" "$SCRIPT_DIR/android_src/assets/config.json" 2>/dev/null || true
    qrencode -o "$SCRIPT_DIR/static/qr_connect.png" -s 8 -m 2 "$APP_URL" 2>/dev/null || true
    cp "$SCRIPT_DIR/static/qr_connect.png" "$SCRIPT_DIR/qr_connect.png" 2>/dev/null || true
    echo ">> Sinkronisasi host tunnel ke GitHub..."
    (
        cd "$SCRIPT_DIR"
        git add config.json static/config.json android_src/assets/config.json 2>/dev/null || true
        git commit -m "chore: sync live tunnel host to $SERVER_HOST" 2>/dev/null || true
        git push origin main 2>/dev/null || true
    ) || true
fi

echo ""
echo "=========================================================="
echo "🎮 AIRPAD - VIRTUAL GAMEPAD DENGAN KODE PAIRING!"
echo "=========================================================="
echo "🔑 KODE PAIRING STIK : [ $AIRPAD_CODE ]"
echo "=========================================================="
echo "📱 SCAN QR INI DARI APLIKASI AIRPAD HP (ATAU KAMERA HP):"
echo ">> Di aplikasi AirPad: Tap tombol [SCAN QR PC]"
echo ">> Lewat Kamera HP: Langsung buka aplikasi AirPad (Bukan Browser!)"
echo "=========================================================="
qrencode -t UTF8 "$APP_URL" 2>/dev/null || true
echo "=========================================================="
echo "🌐 Link Web (Jika main via Browser HP / Laptop):"
echo "   $GITHUB_URL"
echo ""
echo "🏠 Link Wi-Fi Lokal (1 Jaringan):"
echo "   $LOCAL_URL"
echo "=========================================================="
echo ">> Temen lu cukup buka AirPad & scan QR / ketik kode: $AIRPAD_CODE"
echo ">> Tiap HP yang konek otomatis terdaftar jadi P1, P2, dst!"
echo ">> Tekan Ctrl+C untuk mematikan server."
echo "=========================================================="

wait "$SERVER_PID"
