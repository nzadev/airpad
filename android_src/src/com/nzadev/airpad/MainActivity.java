package com.nzadev.airpad;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private WebView webView;
    private PermissionRequest pendingPermissionRequest;
    private BluetoothGamepadManager btGamepadManager;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        hideSystemUI();

        btGamepadManager = new BluetoothGamepadManager(this, (status, connected) -> {
            if (webView != null) {
                final String safeStatus = status.replace("'", "\\'");
                webView.post(() -> {
                    webView.evaluateJavascript(
                        "if (typeof window.onBluetoothStateChanged === 'function') window.onBluetoothStateChanged('"
                        + safeStatus + "', " + connected + ");",
                        null
                    );
                });
            }
        });

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " AirPadNative/2.3");

        webView.addJavascriptInterface(new AirPadBridgeInterface(), "AirPadBridge");

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                            pendingPermissionRequest = request;
                            requestPermissions(new String[]{Manifest.permission.CAMERA}, 101);
                            return;
                        }
                    }
                    request.grant(request.getResources());
                });
            }
        });

        loadAppUrl(getIntent());
        setContentView(webView);
    }

    private class AirPadBridgeInterface {
        @JavascriptInterface
        public boolean isNative() {
            return true;
        }

        @JavascriptInterface
        public boolean isBluetoothSupported() {
            return btGamepadManager != null && btGamepadManager.isSupported();
        }

        @JavascriptInterface
        public boolean isBluetoothConnected() {
            return btGamepadManager != null && btGamepadManager.isConnected();
        }

        @JavascriptInterface
        public void startBluetoothMode() {
            runOnUiThread(() -> checkAndStartBluetooth());
        }

        @JavascriptInterface
        public void stopBluetoothMode() {
            runOnUiThread(() -> {
                if (btGamepadManager != null) {
                    btGamepadManager.stop();
                }
            });
        }

        @JavascriptInterface
        public void makeBluetoothDiscoverable() {
            runOnUiThread(() -> promptDiscoverable());
        }

        @JavascriptInterface
        public void sendButton(String btn, int val) {
            if (btGamepadManager != null) {
                if ("UP".equalsIgnoreCase(btn) || "DOWN".equalsIgnoreCase(btn) ||
                    "LEFT".equalsIgnoreCase(btn) || "RIGHT".equalsIgnoreCase(btn)) {
                    btGamepadManager.setDpad(btn, val == 1);
                } else {
                    btGamepadManager.setButton(btn, val == 1);
                }
            }
        }

        @JavascriptInterface
        public void sendAxis(String stick, float x, float y) {
            if (btGamepadManager != null) {
                btGamepadManager.setStick(stick, x, y);
            }
        }

        @JavascriptInterface
        public void sendTrigger(String trig, float val) {
            if (btGamepadManager != null) {
                btGamepadManager.setTrigger(trig, val);
            }
        }
    }

    private void checkAndStartBluetooth() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            List<String> needed = new ArrayList<>();
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH_ADVERTISE);
            }
            if (!needed.isEmpty()) {
                requestPermissions(needed.toArray(new String[0]), 102);
                return;
            }
        }

        promptDiscoverable();
        if (btGamepadManager != null) {
            btGamepadManager.start();
        }
    }

    private void promptDiscoverable() {
        try {
            Intent discoverableIntent = new Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE);
            discoverableIntent.putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 300);
            startActivity(discoverableIntent);
        } catch (Exception e) {
            // Ignore if unable to prompt
        }
    }

    private void hideSystemUI() {
        View decorView = getWindow().getDecorView();
        decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUI();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadAppUrl(intent);
    }

    private void loadAppUrl(Intent intent) {
        String baseUrl = "file:///android_asset/index.html";
        if (intent != null && intent.getData() != null) {
            Uri data = intent.getData();
            String query = data.getQuery();
            if (query != null && !query.isEmpty()) {
                webView.loadUrl(baseUrl + "?" + query);
                return;
            }
        }
        webView.loadUrl(baseUrl);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 101 && pendingPermissionRequest != null) {
            final PermissionRequest req = pendingPermissionRequest;
            pendingPermissionRequest = null;
            runOnUiThread(() -> {
                if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                    req.grant(req.getResources());
                } else {
                    req.deny();
                }
            });
        } else if (requestCode == 102) {
            boolean allGranted = true;
            for (int r : grantResults) {
                if (r != PackageManager.PERMISSION_GRANTED) {
                    allGranted = false;
                    break;
                }
            }
            if (allGranted) {
                checkAndStartBluetooth();
            }
        }
    }

    @Override
    protected void onDestroy() {
        if (btGamepadManager != null) {
            btGamepadManager.stop();
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        // Prevent accidental exit during game
    }
}
