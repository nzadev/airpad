#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8080}"
CF_LOG="/tmp/cloudflared_webgamepad.log"

# Generate 4-digit pairing code (1000 - 9999) jika belum di-set
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

echo ">> Menjalankan Cloudflare Tunnel untuk akses beda jaringan..."
rm -f "$CF_LOG"
cloudflared tunnel --url "http://127.0.0.1:$PORT" > "$CF_LOG" 2>&1 &
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
GITHUB_URL="https://nzadev.github.io/airpad/?code=$AIRPAD_CODE&server=$SERVER_HOST"
FULL_URL="$PUBLIC_URL/?code=$AIRPAD_CODE"

if [[ -n "$SERVER_HOST" ]]; then
    printf '{"server":"%s"}\n' "$SERVER_HOST" > "$SCRIPT_DIR/config.json"
    (
        cd "$SCRIPT_DIR"
        git add config.json 2>/dev/null || true
        git commit -m "chore: sync live tunnel host to $SERVER_HOST" 2>/dev/null || true
        git push origin main 2>/dev/null || true
    ) >/dev/null 2>&1 &
fi

echo ""
echo "=========================================================="
echo "🎮 AIRPAD - VIRTUAL GAMEPAD DENGAN KODE PAIRING!"
echo "=========================================================="
echo "🔑 KODE PAIRING STIK : [ $AIRPAD_CODE ]"
echo "=========================================================="
echo "🌐 LINK RESMI GITHUB LU (PAKAI AKUN NZADEV):"
echo "   $GITHUB_URL"
echo ""
echo "🔗 Link Alternatif Langsung:"
echo "   $FULL_URL"
echo ""
echo "🏠 Link Lokal (Satu Wi-Fi):"
echo "   http://$LOCAL_IP:$PORT/?code=$AIRPAD_CODE"
echo "=========================================================="
echo "📷 SCAN QR CODE INI (LANGSUNG KE GITHUB NZADEV):"
echo "=========================================================="
qrencode -t UTF8 "$GITHUB_URL" 2>/dev/null || true
echo "=========================================================="
echo ">> Temen lu cukup buka link & masukkan kode: $AIRPAD_CODE"
echo ">> Tiap HP yang konek otomatis terdaftar jadi P1, P2, dst!"
echo ">> Tekan Ctrl+C untuk mematikan server."
echo "=========================================================="

wait "$SERVER_PID"
