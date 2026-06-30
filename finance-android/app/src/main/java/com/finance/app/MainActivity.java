package com.finance.app;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);          // приложение на JS
        settings.setDomStorageEnabled(true);           // localStorage — здесь хранятся данные
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);

        web.setWebViewClient(new WebViewClient());     // переходы остаются внутри приложения
        web.setWebChromeClient(new WebChromeClient());
        web.setBackgroundColor(Color.parseColor("#EEF0EC"));

        // Загружаем приложение из ресурсов (файл лежит в app/src/main/assets)
        web.loadUrl("file:///android_asset/finance.html");
    }

    // Кнопка «Назад» сначала листает историю внутри приложения
    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
