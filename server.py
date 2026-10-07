import asyncio
import json
import logging
import os
import sys
from aiohttp import web
from evdev import UInput, AbsInfo, ecodes as e

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("WebGamepad")

GAMEPAD_CAP = {
    e.EV_KEY: [
        e.BTN_A, e.BTN_B, e.BTN_X, e.BTN_Y,
        e.BTN_TL, e.BTN_TR,
        e.BTN_TL2, e.BTN_TR2,
        e.BTN_SELECT, e.BTN_START, e.BTN_MODE,
        e.BTN_THUMBL, e.BTN_THUMBR,
        e.BTN_DPAD_UP, e.BTN_DPAD_DOWN, e.BTN_DPAD_LEFT, e.BTN_DPAD_RIGHT
    ],
    e.EV_ABS: [
        (e.ABS_X, AbsInfo(value=0, min=-32768, max=32767, fuzz=16, flat=128, resolution=0)),
        (e.ABS_Y, AbsInfo(value=0, min=-32768, max=32767, fuzz=16, flat=128, resolution=0)),
        (e.ABS_RX, AbsInfo(value=0, min=-32768, max=32767, fuzz=16, flat=128, resolution=0)),
        (e.ABS_RY, AbsInfo(value=0, min=-32768, max=32767, fuzz=16, flat=128, resolution=0)),
        (e.ABS_Z, AbsInfo(value=0, min=0, max=255, fuzz=0, flat=0, resolution=0)),       # L2 Analog
        (e.ABS_RZ, AbsInfo(value=0, min=0, max=255, fuzz=0, flat=0, resolution=0)),      # R2 Analog
        (e.ABS_BRAKE, AbsInfo(value=0, min=0, max=255, fuzz=0, flat=0, resolution=0)),   # L2 Brake
        (e.ABS_GAS, AbsInfo(value=0, min=0, max=255, fuzz=0, flat=0, resolution=0)),     # R2 Gas
        (e.ABS_HAT0X, AbsInfo(value=0, min=-1, max=1, fuzz=0, flat=0, resolution=0)),    # D-Pad X (-1=Left, 1=Right)
        (e.ABS_HAT0Y, AbsInfo(value=0, min=-1, max=1, fuzz=0, flat=0, resolution=0)),    # D-Pad Y (-1=Up, 1=Down)
    ]
}

BTN_MAP = {
    "CROSS": e.BTN_A,
    "CIRCLE": e.BTN_B,
    "SQUARE": e.BTN_X,
    "TRIANGLE": e.BTN_Y,
    "L1": e.BTN_TL,
    "R1": e.BTN_TR,
    "L2": e.BTN_TL2,
    "R2": e.BTN_TR2,
    "L3": e.BTN_THUMBL,
    "R3": e.BTN_THUMBR,
    "SELECT": e.BTN_SELECT,
    "START": e.BTN_START,
    "PS": e.BTN_MODE,
    "UP": e.BTN_DPAD_UP,
    "DOWN": e.BTN_DPAD_DOWN,
    "LEFT": e.BTN_DPAD_LEFT,
    "RIGHT": e.BTN_DPAD_RIGHT
}

PAIR_CODE = os.environ.get("AIRPAD_CODE", "1234")
monitors = set()

def get_server_metadata():
    cfg_file = os.path.join(os.path.dirname(__file__), "config.json")
    tunnel = ""
    local_ip = ""
    if os.path.exists(cfg_file):
        try:
            with open(cfg_file, "r") as f:
                c = json.load(f)
                tunnel = c.get("server", "")
                local_ip = c.get("local_ip", "")
        except Exception:
            pass
    return tunnel, local_ip

async def broadcast_monitor(data):
    for m in list(monitors):
        try:
            await m.send_str(json.dumps(data))
        except Exception:
            monitors.discard(m)

class PlayerManager:
    def __init__(self):
        self.players = {}
        self.lock = asyncio.Lock()

    async def allocate(self, ws):
        async with self.lock:
            for slot in range(1, 9):
                if slot not in self.players:
                    try:
                        ui = UInput(
                            GAMEPAD_CAP,
                            name=f"AirPad Virtual Gamepad P{slot}",
                            vendor=0x045e,
                            product=0x028e,
                            version=0x0114,
                            bustype=e.BUS_USB
                        )
                        self.players[slot] = {
                            "ws": ws,
                            "ui": ui,
                            "dpad": {"UP": 0, "DOWN": 0, "LEFT": 0, "RIGHT": 0}
                        }
                        logger.info(f"Player {slot} connected -> {ui.device.path}")
                        return slot, ui
                    except Exception as err:
                        logger.error(f"Failed to create UInput for Player {slot}: {err}")
                        return None, None
            return None, None

    async def release(self, slot):
        async with self.lock:
            if slot in self.players:
                data = self.players.pop(slot)
                try:
                    data["ui"].close()
                except Exception:
                    pass
                logger.info(f"Player {slot} disconnected")

player_manager = PlayerManager()

async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=15.0)
    await ws.prepare(request)

    slot = None
    ui = None

    try:
        # Step 1: Wait for authentication message
        auth_msg = await ws.receive()
        if auth_msg.type != web.WSMsgType.TEXT:
            await ws.close()
            return ws

        auth_data = json.loads(auth_msg.data)
        if auth_data.get("type") != "auth" or str(auth_data.get("code")).strip() != str(PAIR_CODE).strip():
            await ws.send_str(json.dumps({"type": "error", "message": "Kode pairing salah!"}))
            await ws.close()
            return ws

        # Step 2: Allocate player gamepad
        slot, ui = await player_manager.allocate(ws)
        if slot is None:
            await ws.send_str(json.dumps({"type": "error", "message": "Server penuh (Max 8 player)"}))
            await ws.close()
            return ws

        await ws.send_str(json.dumps({"type": "init", "player": slot, "total": len(player_manager.players)}))
        await broadcast_monitor({"type": "player_join", "player": slot, "total": len(player_manager.players)})

        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    payload = json.loads(msg.data)
                    mtype = payload[0]

                    if mtype == "b":
                        # ["b", btn_name, val]
                        btn_name = payload[1]
                        val = int(payload[2])

                        if btn_name in ("UP", "DOWN", "LEFT", "RIGHT"):
                            player_data = player_manager.players.get(slot)
                            if player_data:
                                player_data["dpad"][btn_name] = val
                                hat_x = player_data["dpad"]["RIGHT"] - player_data["dpad"]["LEFT"]
                                hat_y = player_data["dpad"]["DOWN"] - player_data["dpad"]["UP"]
                                ui.write(e.EV_ABS, e.ABS_HAT0X, hat_x)
                                ui.write(e.EV_ABS, e.ABS_HAT0Y, hat_y)
                            ui.write(e.EV_KEY, BTN_MAP[btn_name], val)
                            ui.syn()
                            await broadcast_monitor({"type": "input", "player": slot, "action": "button", "btn": btn_name, "val": val})

                        elif btn_name in ("L2", "R2"):
                            axis = e.ABS_Z if btn_name == "L2" else e.ABS_RZ
                            axis2 = e.ABS_BRAKE if btn_name == "L2" else e.ABS_GAS
                            ui.write(e.EV_KEY, BTN_MAP[btn_name], val)
                            ui.write(e.EV_ABS, axis, 255 * val)
                            ui.write(e.EV_ABS, axis2, 255 * val)
                            ui.syn()
                            await broadcast_monitor({"type": "input", "player": slot, "action": "button", "btn": btn_name, "val": val})

                        elif btn_name in BTN_MAP:
                            ui.write(e.EV_KEY, BTN_MAP[btn_name], val)
                            ui.syn()
                            await broadcast_monitor({"type": "input", "player": slot, "action": "button", "btn": btn_name, "val": val})

                    elif mtype == "a":
                        # ["a", "L"|"R", x_float, y_float]
                        stick = payload[1]
                        x_val = int(payload[2] * 32767)
                        y_val = int(payload[3] * 32767)
                        if stick == "L":
                            ui.write(e.EV_ABS, e.ABS_X, x_val)
                            ui.write(e.EV_ABS, e.ABS_Y, y_val)
                        elif stick == "R":
                            ui.write(e.EV_ABS, e.ABS_RX, x_val)
                            ui.write(e.EV_ABS, e.ABS_RY, y_val)
                        ui.syn()

                    elif mtype == "t":
                        # ["t", "L2"|"R2", val_float]
                        trig = payload[1]
                        val_float = float(payload[2])
                        val = int(val_float * 255)
                        btn_val = 1 if val_float > 0.1 else 0
                        axis = e.ABS_Z if trig == "L2" else e.ABS_RZ
                        axis2 = e.ABS_BRAKE if trig == "L2" else e.ABS_GAS
                        key = e.BTN_TL2 if trig == "L2" else e.BTN_TR2
                        ui.write(e.EV_ABS, axis, val)
                        ui.write(e.EV_ABS, axis2, val)
                        ui.write(e.EV_KEY, key, btn_val)
                        ui.syn()
                        await broadcast_monitor({"type": "input", "player": slot, "action": "button", "btn": trig, "val": btn_val})

                    elif mtype == "ping":
                        await ws.send_str(json.dumps(["pong", payload[1]]))

                except Exception as err:
                    logger.debug(f"Input error: {err}")

            elif msg.type == web.WSMsgType.ERROR:
                logger.error(f"WS error: {ws.exception()}")
    finally:
        if slot is not None:
            await player_manager.release(slot)
            await broadcast_monitor({"type": "player_leave", "player": slot, "total": len(player_manager.players)})

    return ws

async def index_handler(request):
    static_file = os.path.join(os.path.dirname(__file__), "static", "index.html")
    return web.FileResponse(static_file, headers={
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
    })

async def dashboard_handler(request):
    dash_file = os.path.join(os.path.dirname(__file__), "static", "dashboard.html")
    if os.path.exists(dash_file):
        return web.FileResponse(dash_file)
    return web.Response(text="Dashboard file not found", status=404)

async def status_handler(request):
    tunnel, local_ip = get_server_metadata()
    return web.json_response({
        "status": "online",
        "code": PAIR_CODE,
        "players": list(player_manager.players.keys()),
        "tunnel": tunnel,
        "local_ip": local_ip
    })

async def monitor_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    monitors.add(ws)
    tunnel, local_ip = get_server_metadata()
    await ws.send_str(json.dumps({
        "type": "state",
        "code": PAIR_CODE,
        "players": list(player_manager.players.keys()),
        "tunnel": tunnel,
        "local_ip": local_ip
    }))
    try:
        async for msg in ws:
            pass
    finally:
        monitors.discard(ws)
    return ws

async def download_apk_handler(request):
    apk_file = os.path.join(os.path.dirname(__file__), "static", "AirPad.apk")
    if not os.path.exists(apk_file):
        apk_file = os.path.join(os.path.dirname(__file__), "AirPad.apk")
    if os.path.exists(apk_file):
        return web.FileResponse(apk_file, headers={
            "Content-Disposition": 'attachment; filename="AirPad.apk"',
            "Content-Type": "application/vnd.android.package-archive"
        })
    return web.Response(text="APK file not found", status=404)

async def qr_handler(request):
    mode = request.query.get("mode", "cloud")
    tunnel, local_ip = get_server_metadata()
    if mode == "apk":
        target = "https://nzadev.github.io/airpad/AirPad.apk"
    elif mode == "local":
        target = f"airpad://connect?code={PAIR_CODE}&server={local_ip}"
    elif mode == "web":
        target = f"https://nzadev.github.io/airpad/?code={PAIR_CODE}&server={tunnel}"
    else:
        target = f"airpad://connect?code={PAIR_CODE}&server={tunnel}"

    try:
        proc = await asyncio.create_subprocess_exec(
            "qrencode", "-o", "-", "-s", "8", "-m", "2", target,
            stdout=asyncio.subprocess.PIPE
        )
        stdout, _ = await proc.communicate()
        return web.Response(body=stdout, content_type="image/png")
    except Exception as e:
        return web.Response(text=f"QR error: {e}", status=500)

async def init_app():
    app = web.Application()
    app.router.add_get("/", index_handler)
    app.router.add_get("/download", download_apk_handler)
    app.router.add_get("/AirPad.apk", download_apk_handler)
    app.router.add_get("/airpad.apk", download_apk_handler)
    app.router.add_get("/dashboard", dashboard_handler)
    app.router.add_get("/api/status", status_handler)
    app.router.add_get("/api/qr", qr_handler)
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/ws/monitor", monitor_handler)
    static_dir = os.path.join(os.path.dirname(__file__), "static")
    app.router.add_static("/", static_dir, show_index=False)
    return app

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app = init_app()
    logger.info(f"Web Gamepad Server starting on http://0.0.0.0:{port}")
    web.run_app(app, host="0.0.0.0", port=port)
