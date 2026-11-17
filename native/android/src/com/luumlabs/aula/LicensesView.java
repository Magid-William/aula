// «Licencias»: la de Aula y las de lo que el APK lleva dentro (el componente de Tailscale, Go y sus módulos), como la
// pantalla del mismo nombre de la app del iPhone. Los textos salen de assets/licenses.json, que build.sh escribe al
// compilar con native/ios/scripts/licenses.mjs --android (los módulos de Go que de verdad se enlazan).
package com.luumlabs.aula;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.function.Consumer;

final class LicensesView {
    static final String ASSET = "licenses.json";
    static final Uri SOURCE = Uri.parse("https://github.com/luumlabs/aula");

    private LicensesView() { }

    /** La pantalla entera; `close` la quita, `open` abre una dirección fuera (el código de Aula). */
    static View build(Activity a, Runnable close, Consumer<Uri> open) {
        int ink = a.getResources().getColor(R.color.ink, a.getTheme());
        int soft = a.getResources().getColor(R.color.soft, a.getTheme());
        int brick = a.getResources().getColor(R.color.brick, a.getTheme());

        LinearLayout page = new LinearLayout(a);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(a.getResources().getColor(R.color.paper, a.getTheme()));
        page.setClickable(true); // lo de debajo no recibe los toques

        LinearLayout head = new LinearLayout(a);
        head.setGravity(Gravity.CENTER_VERTICAL);
        head.setPadding(dp(a, 20), dp(a, 8), dp(a, 8), dp(a, 4));
        TextView title = text(a, 24, ink);
        title.setTypeface(Typeface.create(Typeface.SERIF, Typeface.NORMAL));
        title.setText(R.string.licenses_title);
        head.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView done = text(a, 16, brick);
        done.setTypeface(Typeface.DEFAULT_BOLD);
        done.setText(R.string.done);
        done.setGravity(Gravity.CENTER);
        done.setMinHeight(dp(a, 48));
        done.setMinWidth(dp(a, 48));
        done.setPadding(dp(a, 14), 0, dp(a, 14), 0);
        done.setBackground(ripple(a, brick, dp(a, 12)));
        done.setOnClickListener(v -> close.run());
        head.addView(done);
        page.addView(head);

        ScrollView scroll = new ScrollView(a);
        LinearLayout list = new LinearLayout(a);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(a, 20), dp(a, 4), dp(a, 20), dp(a, 24));
        TextView intro = text(a, 15, soft);
        intro.setText(R.string.licenses_intro);
        intro.setLineSpacing(0, 1.15f);
        list.addView(intro);
        TextView source = text(a, 15, brick);
        source.setTypeface(Typeface.DEFAULT_BOLD);
        source.setText(R.string.licenses_source);
        source.setMinHeight(dp(a, 48));
        source.setGravity(Gravity.CENTER_VERTICAL);
        source.setBackground(ripple(a, brick, dp(a, 10)));
        source.setOnClickListener(v -> open.accept(SOURCE));
        list.addView(source, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        JSONArray components = read(a);
        if (components == null || components.length() == 0) {
            TextView missing = text(a, 15, soft);
            missing.setText(R.string.licenses_missing);
            missing.setPadding(0, dp(a, 12), 0, 0);
            list.addView(missing);
        }
        for (int i = 0; components != null && i < components.length(); i++) {
            JSONObject c = components.optJSONObject(i);
            if (c != null) list.addView(row(a, c, ink, soft));
        }
        scroll.addView(list);
        page.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        return page;
    }

    /** Un componente: su nombre, su licencia y su versión; al tocarlo, el texto entero de sus avisos. */
    private static View row(Activity a, JSONObject c, int ink, int soft) {
        LinearLayout box = new LinearLayout(a);
        box.setOrientation(LinearLayout.VERTICAL);
        LinearLayout head = new LinearLayout(a);
        head.setOrientation(LinearLayout.VERTICAL);
        head.setPadding(dp(a, 4), dp(a, 10), dp(a, 4), dp(a, 10));
        head.setMinimumHeight(dp(a, 52));
        head.setBackground(ripple(a, ink, dp(a, 10)));
        TextView name = text(a, 16, ink);
        name.setText(c.optString("name"));
        head.addView(name);
        TextView meta = text(a, 13, soft);
        String version = c.optString("version", "");
        meta.setText(version.isEmpty() ? c.optString("license") : c.optString("license") + " · " + version);
        head.addView(meta);
        box.addView(head);
        TextView body = text(a, 12, soft);
        body.setTypeface(Typeface.MONOSPACE);
        body.setTextIsSelectable(true);
        body.setPadding(dp(a, 4), 0, dp(a, 4), dp(a, 14));
        body.setVisibility(View.GONE);
        box.addView(body);
        head.setOnClickListener(v -> {
            boolean show = body.getVisibility() != View.VISIBLE;
            if (show && body.getText().length() == 0) body.setText(c.optString("text"));
            body.setVisibility(show ? View.VISIBLE : View.GONE);
        });
        return box;
    }

    private static JSONArray read(Activity a) {
        try (InputStream in = a.getAssets().open(ASSET)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[32 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8)).optJSONArray("components");
        } catch (IOException | org.json.JSONException e) {
            return null;
        }
    }

    private static TextView text(Activity a, float sp, int color) {
        TextView t = new TextView(a);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        return t;
    }

    /** Un fondo que responde al toque (la onda del sistema) dentro de un rectángulo redondeado. */
    static Drawable ripple(Activity a, int color, float radius) {
        GradientDrawable mask = new GradientDrawable();
        mask.setCornerRadius(radius);
        mask.setColor(0xFFFFFFFF);
        return new RippleDrawable(ColorStateList.valueOf((color & 0x00FFFFFF) | 0x29000000), null, mask);
    }

    private static int dp(Activity a, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, a.getResources().getDisplayMetrics()));
    }
}
