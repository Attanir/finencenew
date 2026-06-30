package com.financetracker.app;

import android.app.Activity;
import android.os.Bundle;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
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

        // Native bridge: lets the page fetch currency rates without CORS issues.
        webView.addJavascriptInterface(new RatesBridge(), "AndroidRates");

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

    /**
     * Exposed to JavaScript as window.AndroidRates.
     * fetchRates(base) runs the network call off the UI thread, then delivers
     * the raw JSON back to the page via window.onRatesResult(base64String).
     */
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
