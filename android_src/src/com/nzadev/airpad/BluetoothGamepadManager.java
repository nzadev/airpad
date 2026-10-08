package com.nzadev.airpad;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothHidDevice;
import android.bluetooth.BluetoothHidDeviceAppSdpSettings;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.os.Build;
import android.util.Log;

import java.util.Arrays;
import java.util.concurrent.Executors;

public class BluetoothGamepadManager {
    private static final String TAG = "AirPadBT";

    private static final byte[] HID_REPORT_DESCRIPTOR = new byte[] {
        (byte) 0x05, (byte) 0x01,        // Usage Page (Generic Desktop Ctrls)
        (byte) 0x09, (byte) 0x05,        // Usage (Game Pad)
        (byte) 0xA1, (byte) 0x01,        // Collection (Application)
        (byte) 0x85, (byte) 0x01,        //   Report ID (1)
        // 16 Buttons
        (byte) 0x05, (byte) 0x09,        //   Usage Page (Button)
        (byte) 0x19, (byte) 0x01,        //   Usage Minimum (Button 1)
        (byte) 0x29, (byte) 0x10,        //   Usage Maximum (Button 16)
        (byte) 0x15, (byte) 0x00,        //   Logical Minimum (0)
        (byte) 0x25, (byte) 0x01,        //   Logical Maximum (1)
        (byte) 0x75, (byte) 0x01,        //   Report Size (1)
        (byte) 0x95, (byte) 0x10,        //   Report Count (16)
        (byte) 0x81, (byte) 0x02,        //   Input (Data,Var,Abs)
        // Hat Switch (D-Pad)
        (byte) 0x05, (byte) 0x01,        //   Usage Page (Generic Desktop Ctrls)
        (byte) 0x09, (byte) 0x39,        //   Usage (Hat switch)
        (byte) 0x15, (byte) 0x01,        //   Logical Minimum (1)
        (byte) 0x25, (byte) 0x08,        //   Logical Maximum (8)
        (byte) 0x35, (byte) 0x00,        //   Physical Minimum (0)
        (byte) 0x46, (byte) 0x3B, (byte) 0x01, // Physical Maximum (315)
        (byte) 0x65, (byte) 0x14,        //   Unit (Eng Rot:deg)
        (byte) 0x75, (byte) 0x04,        //   Report Size (4)
        (byte) 0x95, (byte) 0x01,        //   Report Count (1)
        (byte) 0x81, (byte) 0x42,        //   Input (Data,Var,Abs,Null)
        // 4-bit padding
        (byte) 0x75, (byte) 0x04,        //   Report Size (4)
        (byte) 0x95, (byte) 0x01,        //   Report Count (1)
        (byte) 0x81, (byte) 0x03,        //   Input (Cnst,Var,Abs)
        // 4 Axes: X, Y, Z, Rz
        (byte) 0x05, (byte) 0x01,        //   Usage Page (Generic Desktop Ctrls)
        (byte) 0x09, (byte) 0x30,        //   Usage (X)
        (byte) 0x09, (byte) 0x31,        //   Usage (Y)
        (byte) 0x09, (byte) 0x32,        //   Usage (Z)
        (byte) 0x09, (byte) 0x35,        //   Usage (Rz)
        (byte) 0x15, (byte) 0x00,        //   Logical Minimum (0)
        (byte) 0x26, (byte) 0xFF, (byte) 0x00, // Logical Maximum (255)
        (byte) 0x75, (byte) 0x08,        //   Report Size (8)
        (byte) 0x95, (byte) 0x04,        //   Report Count (4)
        (byte) 0x81, (byte) 0x02,        //   Input (Data,Var,Abs)
        // 2 Triggers: Slider (L2), Dial (R2)
        (byte) 0x09, (byte) 0x36,        //   Usage (Slider)
        (byte) 0x09, (byte) 0x37,        //   Usage (Dial)
        (byte) 0x15, (byte) 0x00,        //   Logical Minimum (0)
        (byte) 0x26, (byte) 0xFF, (byte) 0x00, // Logical Maximum (255)
        (byte) 0x75, (byte) 0x08,        //   Report Size (8)
        (byte) 0x95, (byte) 0x02,        //   Report Count (2)
        (byte) 0x81, (byte) 0x02,        //   Input (Data,Var,Abs)
        (byte) 0xC0                      // End Collection
    };

    public interface StateListener {
        void onBluetoothStateChanged(String status, boolean isConnected);
    }

    private final Context context;
    private final StateListener stateListener;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothHidDevice hidDevice;
    private BluetoothDevice connectedHostDevice;
    private boolean isRegistered = false;

    // Gamepad state
    private int buttonBitmask = 0;
    private boolean dpadUp = false;
    private boolean dpadDown = false;
    private boolean dpadLeft = false;
    private boolean dpadRight = false;
    private byte leftX = (byte) 128;
    private byte leftY = (byte) 128;
    private byte rightX = (byte) 128;
    private byte rightY = (byte) 128;
    private byte l2Trigger = 0;
    private byte r2Trigger = 0;

    private final byte[] reportBuffer = new byte[9];

    public BluetoothGamepadManager(Context context, StateListener stateListener) {
        this.context = context;
        this.stateListener = stateListener;
        BluetoothManager bm = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        if (bm != null) {
            this.bluetoothAdapter = bm.getAdapter();
        }
    }

    public boolean isSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && bluetoothAdapter != null;
    }

    public boolean isEnabled() {
        return bluetoothAdapter != null && bluetoothAdapter.isEnabled();
    }

    public boolean isConnected() {
        return connectedHostDevice != null;
    }

    public void start() {
        if (!isSupported() || !isEnabled()) {
            notifyState("Bluetooth tidak aktif", false);
            return;
        }

        if (hidDevice != null) {
            notifyState(connectedHostDevice != null ? "Terhubung ke TV" : "Siap dipairing ke TV", connectedHostDevice != null);
            return;
        }

        notifyState("Memulai mode Bluetooth Gamepad...", false);

        bluetoothAdapter.getProfileProxy(context, new BluetoothProfile.ServiceListener() {
            @Override
            public void onServiceConnected(int profile, BluetoothProfile proxy) {
                if (profile == BluetoothProfile.HID_DEVICE && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    hidDevice = (BluetoothHidDevice) proxy;
                    registerHidApp();
                }
            }

            @Override
            public void onServiceDisconnected(int profile) {
                if (profile == BluetoothProfile.HID_DEVICE) {
                    hidDevice = null;
                    isRegistered = false;
                    connectedHostDevice = null;
                    notifyState("Bluetooth terputus", false);
                }
            }
        }, BluetoothProfile.HID_DEVICE);
    }

    private void registerHidApp() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P || hidDevice == null) return;

        BluetoothHidDeviceAppSdpSettings sdp = new BluetoothHidDeviceAppSdpSettings(
            "AirPad Gamepad",
            "Virtual Bluetooth Gamepad for Android TV",
            "NZA Dev",
            BluetoothHidDevice.SUBCLASS2_GAMEPAD,
            HID_REPORT_DESCRIPTOR
        );

        try {
            hidDevice.registerApp(sdp, null, null, Executors.newSingleThreadExecutor(), new BluetoothHidDevice.Callback() {
                @Override
                public void onAppStatusChanged(BluetoothDevice device, boolean registered) {
                    isRegistered = registered;
                    Log.d(TAG, "HID App Status: registered=" + registered);
                    if (registered) {
                        notifyState("Siap! Buka Bluetooth TV & pilih AirPad Gamepad", false);
                    }
                }

                @Override
                public void onConnectionStateChanged(BluetoothDevice device, int state) {
                    Log.d(TAG, "HID Device state: " + state);
                    if (state == BluetoothProfile.STATE_CONNECTED) {
                        connectedHostDevice = device;
                        notifyState("🟢 Terhubung ke TV (" + getDeviceName(device) + ")", true);
                    } else if (state == BluetoothProfile.STATE_DISCONNECTED) {
                        connectedHostDevice = null;
                        notifyState("Menunggu koneksi dari TV...", false);
                    } else if (state == BluetoothProfile.STATE_CONNECTING) {
                        notifyState("Menghubungkan ke TV...", false);
                    }
                }
            });
        } catch (SecurityException se) {
            Log.e(TAG, "SecurityException registering HID app: " + se.getMessage());
            notifyState("Izin Bluetooth belum diberikan", false);
        }
    }

    private String getDeviceName(BluetoothDevice device) {
        if (device == null) return "TV";
        try {
            String n = device.getName();
            return (n != null && !n.isEmpty()) ? n : device.getAddress();
        } catch (SecurityException e) {
            return "TV";
        }
    }

    private void notifyState(String text, boolean connected) {
        if (stateListener != null) {
            stateListener.onBluetoothStateChanged(text, connected);
        }
    }

    public synchronized void setButton(String btn, boolean pressed) {
        int bit = getButtonBit(btn);
        if (bit >= 0) {
            if (pressed) {
                buttonBitmask |= (1 << bit);
            } else {
                buttonBitmask &= ~(1 << bit);
            }
            sendReport();
        }
    }

    private int getButtonBit(String btn) {
        switch (btn.toUpperCase()) {
            case "A":
            case "CROSS": return 0;     // A
            case "B":
            case "CIRCLE": return 1;    // B
            case "X":
            case "SQUARE": return 3;    // X
            case "Y":
            case "TRIANGLE": return 4;  // Y
            case "L1":
            case "LB": return 6;        // Left Bumper
            case "R1":
            case "RB": return 7;        // Right Bumper
            case "L2":
            case "LT": return 8;        // L2 digital
            case "R2":
            case "RT": return 9;        // R2 digital
            case "SELECT":
            case "BACK": return 10;     // Select / Back
            case "START": return 11;    // Start
            case "PS":                  // Home / Mode
            case "HOME":
            case "MODE": return 12;
            case "L3":
            case "LS": return 13;       // Left Stick Press
            case "R3":
            case "RS": return 14;       // Right Stick Press
            default: return -1;
        }
    }

    public synchronized void setDpad(String dir, boolean pressed) {
        switch (dir.toUpperCase()) {
            case "UP": dpadUp = pressed; break;
            case "DOWN": dpadDown = pressed; break;
            case "LEFT": dpadLeft = pressed; break;
            case "RIGHT": dpadRight = pressed; break;
        }
        sendReport();
    }

    private byte computeDpadHat() {
        if (dpadUp && dpadRight) return 2;
        if (dpadDown && dpadRight) return 4;
        if (dpadDown && dpadLeft) return 6;
        if (dpadUp && dpadLeft) return 8;
        if (dpadUp) return 1;
        if (dpadRight) return 3;
        if (dpadDown) return 5;
        if (dpadLeft) return 7;
        return 0; // Centered
    }

    public synchronized void setStick(String stick, float x, float y) {
        // Convert -1.0..1.0 to 0..255 byte with 128 as center
        byte bX = (byte) (Math.max(0, Math.min(255, (int) ((x + 1.0f) * 127.5f))));
        byte bY = (byte) (Math.max(0, Math.min(255, (int) ((y + 1.0f) * 127.5f))));
        if ("L".equalsIgnoreCase(stick) || "LS".equalsIgnoreCase(stick) || "LEFT".equalsIgnoreCase(stick)) {
            leftX = bX;
            leftY = bY;
        } else {
            rightX = bX;
            rightY = bY;
        }
        sendReport();
    }

    public synchronized void setTrigger(String trig, float val) {
        byte bVal = (byte) (Math.max(0, Math.min(255, (int) (val * 255.0f))));
        if ("L2".equalsIgnoreCase(trig)) {
            l2Trigger = bVal;
            if (val > 0.1f) buttonBitmask |= (1 << 8);
            else buttonBitmask &= ~(1 << 8);
        } else {
            r2Trigger = bVal;
            if (val > 0.1f) buttonBitmask |= (1 << 9);
            else buttonBitmask &= ~(1 << 9);
        }
        sendReport();
    }

    private synchronized void sendReport() {
        if (hidDevice == null || connectedHostDevice == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return;
        }

        reportBuffer[0] = (byte) (buttonBitmask & 0xFF);
        reportBuffer[1] = (byte) ((buttonBitmask >> 8) & 0xFF);
        reportBuffer[2] = computeDpadHat();
        reportBuffer[3] = leftX;
        reportBuffer[4] = leftY;
        reportBuffer[5] = rightX;
        reportBuffer[6] = rightY;
        reportBuffer[7] = l2Trigger;
        reportBuffer[8] = r2Trigger;

        try {
            hidDevice.sendReport(connectedHostDevice, 1, reportBuffer);
        } catch (SecurityException se) {
            Log.e(TAG, "sendReport SecurityException: " + se.getMessage());
        }
    }

    public void stop() {
        if (hidDevice != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                if (isRegistered) {
                    hidDevice.unregisterApp();
                    isRegistered = false;
                }
                bluetoothAdapter.closeProfileProxy(BluetoothProfile.HID_DEVICE, hidDevice);
            } catch (Exception e) {
                Log.e(TAG, "Error stopping BT HID: " + e.getMessage());
            }
            hidDevice = null;
            connectedHostDevice = null;
        }
    }
}
