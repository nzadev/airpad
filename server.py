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
        e.BTN_SELECT, e.BTN_START, e.BTN_MODE,
        e.BTN_THUMBL, e.BTN_THUMBR,
        e.BTN_DPAD_UP, e.BTN_DPAD_DOWN, e.BTN_DPAD_LEFT, e.BTN_DPAD_RIGHT
    ],
    e.EV_ABS: [
        (e.ABS_X, AbsInfo(value=0, min=-32768, max=32767, fuzz=16, flat=128, resolution=0)),
        (e.ABS_Y, AbsInfo(value=0, min=-32768, max=32767, fuzz=16, flat=128, resolution=0)),
        (e.ABS_RX, AbsInfo(value=0, min=-32768, max=32767, fuzz=16, flat=128, resolution=0)),
        (e.ABS_RY, AbsInfo(value=0, min=-32768, max=32767, fuzz=16, flat=128, resolution=0)),
        (e.ABS_Z, AbsInfo(value=0, min=0, max=255, fuzz=0, flat=0, resolution=0)),   # L2
        (e.ABS_RZ, AbsInfo(value=0, min=0, max=255, fuzz=0, flat=0, resolution=0)),  # R2
    ]
}

BTN_MAP = {
    "CROSS": e.BTN_A,
    "CIRCLE": e.BTN_B,
    "SQUARE": e.BTN_X,
    "TRIANGLE": e.BTN_Y,
    "L1": e.BTN_TL,
    "R1": e.BTN_TR,
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

class PlayerManager:
    def __init__(self):
        self.players = {}
        self.lock = asyncio.Lock()

    async def allocate(self, ws):
        async with self.lock:
            for slot in range(1, 9):
                if slot not in self.players:
                    try:
                        ui = UInput(GAMEPAD_CAP, name=f"AirPad Virtual Gamepad P{slot}", bustype=e.BUS_USB)
                        self.players[slot] = {"ws": ws, "ui": ui}
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

        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    payload = json.loads(msg.data)
                    mtype = payload[0]

                    if mtype == "b":
                        # ["b", btn_name, val]
                        btn_name = payload[1]
                        val = int(payload[2])
                        if btn_name in BTN_MAP:
                            ui.write(e.EV_KEY, BTN_MAP[btn_name], val)
                            ui.syn()

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
                        val = int(payload[2] * 255)
                        if trig == "L2":
                            ui.write(e.EV_ABS, e.ABS_Z, val)
                        elif trig == "R2":
                            ui.write(e.EV_ABS, e.ABS_RZ, val)
                        ui.syn()

                    elif mtype == "ping":
                        await ws.send_str(json.dumps(["pong", payload[1]]))

                except Exception as err:
                    logger.debug(f"Input error: {err}")

            elif msg.type == web.WSMsgType.ERROR:
                logger.error(f"WS error: {ws.exception()}")
    finally:
        await player_manager.release(slot)

    return ws

async def index_handler(request):
    static_file = os.path.join(os.path.dirname(__file__), "static", "index.html")
    return web.FileResponse(static_file)

async def init_app():
    app = web.Application()
    app.router.add_get("/", index_handler)
    app.router.add_get("/ws", ws_handler)
    static_dir = os.path.join(os.path.dirname(__file__), "static")
    app.router.add_static("/", static_dir, show_index=False)
    return app

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app = init_app()
    logger.info(f"Web Gamepad Server starting on http://0.0.0.0:{port}")
    web.run_app(app, host="0.0.0.0", port=port)
