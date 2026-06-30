package com.financetracker.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);          // localStorage
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Keep navigation inside the WebView.
        webView.setWebViewClient(new WebViewClient());

        // Native bridges.
        webView.addJavascriptInterface(new RatesBridge(), "AndroidRates");
        webView.addJavascriptInterface(new ShareBridge(), "AndroidShare");

        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /* ============================================================
       Bridge: share a PNG (base64) — saves to gallery + opens chooser.
       Used for "Поделиться в Stories".
       ============================================================ */
    private class ShareBridge {

        @JavascriptInterface
        public void shareImage(final String b64) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { doShare(b64); }
            });
        }

        private void doShare(String b64) {
            try {
                String clean = b64;
                int comma = clean.indexOf(',');
                if (clean.startsWith("data:") && comma >= 0) {
                    clean = clean.substring(comma + 1);
                }
                byte[] bytes = Base64.decode(clean, Base64.DEFAULT);

                File dir = new File(getCacheDir(), "shared");
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, "finance_story.png");
                FileOutputStream fos = new FileOutputStream(f);
                fos.write(bytes);
                fos.flush();
                fos.close();

                Uri uri = FileProvider.getUriForFile(
                        MainActivity.this, getPackageName() + ".fileprovider", f);

                saveToGallery(bytes);

                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("image/png");
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(send, "Поделиться историей");
                startActivity(chooser);
            } catch (Exception e) {
                String msg = e.getMessage();
                if (msg == null) msg = e.getClass().getSimpleName();
                Toast.makeText(MainActivity.this,
                        "Не удалось поделиться: " + msg, Toast.LENGTH_LONG).show();
            }
        }

        private void saveToGallery(byte[] bytes) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return; // legacy storage skipped
            try {
                ContentValues cv = new ContentValues();
                String name = "MoiFinansy_" + System.currentTimeMillis() + ".png";
                cv.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                cv.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                cv.put(MediaStore.Images.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_PICTURES + "/MoiFinansy");
                ContentResolver r = getContentResolver();
                Uri u = r.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                if (u != null) {
                    OutputStream os = r.openOutputStream(u);
                    if (os != null) {
                        os.write(bytes);
                        os.flush();
                        os.close();
                    }
                    Toast.makeText(MainActivity.this,
                            "Картинка сохранена в Галерею", Toast.LENGTH_SHORT).show();
                }
            } catch (Exception ignore) {
                // gallery save is best-effort; sharing still works
            }
        }
    }

    /* ============================================================
       Bridge: fetch currency rates off the UI thread (avoids CORS).
       Delivers raw JSON back via window.onRatesResult(base64).
       ============================================================ */
    private class RatesBridge {

        @JavascriptInterface
        public void fetchRates(final String base) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    final String json = doFetch(base);
                    deliver(json);
                }
            }).start();
        }

        private String doFetch(String base) {
            HttpURLConnection conn = null;
            try {
                String safeBase = (base == null || base.trim().isEmpty()) ? "USD" : base.trim();
                URL url = new URL("https://open.er-api.com/v6/latest/" + safeBase);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                conn.setRequestProperty("Accept", "application/json");

                int code = conn.getResponseCode();
                InputStream is = (code >= 200 && code < 400)
                        ? conn.getInputStream() : conn.getErrorStream();
                if (is == null) {
                    return "{\"result\":\"error\",\"error-type\":\"no-body\",\"http\":" + code + "}";
                }
                BufferedReader reader = new BufferedReader(
                        new InputStreamReader(is, StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                reader.close();
                return sb.toString();
            } catch (Exception e) {
                String msg = e.getMessage();
                if (msg == null) msg = e.getClass().getSimpleName();
                msg = msg.replace("\"", "'").replace("\\", "/");
                return "{\"result\":\"error\",\"error-type\":\"network\",\"message\":\"" + msg + "\"}";
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }

        private void deliver(final String json) {
            final String b64 = Base64.encodeToString(
                    json.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (webView != null) {
                        webView.evaluateJavascript(
                                "window.onRatesResult && window.onRatesResult(\"" + b64 + "\");",
                                null);
                    }
                }
            });
        }
    }
}
