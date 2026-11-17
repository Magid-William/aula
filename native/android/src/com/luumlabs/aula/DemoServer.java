// La demostración: Aula sin un Mac, como en la app del iPhone (native/ios/Aula/DemoServer.swift). El APK lleva el mismo
// archivo grabado desde la app real con el curso de ejemplo (scripts/dev/ios-demo.mjs → Demo.aulademo, que build.sh
// copia a assets/): la interfaz, sus archivos y lo que el Mac contestó a cada llamada. Este servidor lo sirve en
// 127.0.0.1 con las mismas rutas que el Mac (`/`, `/rpc`, `/events`…), así que la vista web no nota la diferencia.
// Nada se guarda y nada sale del teléfono.
package com.luumlabs.aula;

import android.content.Context;
import android.content.res.AssetFileDescriptor;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

final class DemoServer {
    static final String ASSET = "Demo.aulademo";
    private static final byte[] MAGIC = "AULADEMO1\n".getBytes(StandardCharsets.US_ASCII);

    private final ByteBuffer data;
    private final int base;
    private final String csp;
    private final JSONObject files, rpc, fallback, events;
    /** Lo que se contesta a algo que la demostración no trae, y lo que dice Aula en el chat a una pregunta nueva. */
    private final String unavailable, chatReply;
    private final int days;

    private ServerSocket server;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    /** Los eventos (el chat) y el latido salen de un solo hilo: nunca dos escrituras a la vez en una conexión. */
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private final List<OutputStream> streams = new CopyOnWriteArrayList<>();

    /** ¿Esta copia de la app trae la demostración? */
    static boolean bundled(Context context) {
        try {
            String[] names = context.getAssets().list("");
            if (names != null) for (String n : names) if (ASSET.equals(n)) return true;
        } catch (IOException e) {
            // sin assets legibles: sin demostración
        }
        return false;
    }

    static DemoServer open(Context context, String unavailable, String chatReply) throws IOException, JSONException {
        return new DemoServer(load(context), unavailable, chatReply, LocalDate.now());
    }

    /** El archivo entero: proyectado en memoria si va sin comprimir (build.sh lo deja así), si no leído. */
    private static ByteBuffer load(Context context) throws IOException {
        try (AssetFileDescriptor fd = context.getAssets().openFd(ASSET);
             FileInputStream in = new FileInputStream(fd.getFileDescriptor())) {
            return in.getChannel().map(FileChannel.MapMode.READ_ONLY, fd.getStartOffset(), fd.getLength());
        } catch (IOException e) {
            try (InputStream in = context.getAssets().open(ASSET)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream(12 << 20);
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                return ByteBuffer.wrap(out.toByteArray());
            }
        }
    }

    /** «AULADEMO1\n» · longitud del índice (uint32 BE) · índice JSON · datos. */
    private DemoServer(ByteBuffer data, String unavailable, String chatReply, LocalDate today) throws IOException, JSONException {
        this.data = data;
        this.unavailable = unavailable;
        this.chatReply = chatReply;
        int at = MAGIC.length;
        if (data.capacity() < at + 4) throw new IOException("demo: archivo corto");
        for (int i = 0; i < at; i++) if (data.get(i) != MAGIC[i]) throw new IOException("demo: no es un archivo de demostración");
        int length = data.getInt(at); // big-endian, como lo escribe ios-demo.mjs
        if (length <= 0 || at + 4 + length > data.capacity()) throw new IOException("demo: índice roto");
        JSONObject index = new JSONObject(new String(slice(at + 4, length), StandardCharsets.UTF_8));
        base = at + 4 + length;
        csp = index.optString("csp", "");
        files = index.getJSONObject("files");
        rpc = index.getJSONObject("rpc");
        fallback = index.optJSONObject("fallback") != null ? index.getJSONObject("fallback") : new JSONObject();
        events = index.optJSONObject("events") != null ? index.getJSONObject("events") : new JSONObject();
        days = DemoDates.days(index.optString("day"), today);
    }

    private byte[] slice(int from, int length) {
        byte[] out = new byte[length];
        ByteBuffer view = data.duplicate();
        view.position(from);
        view.get(out, 0, length);
        return out;
    }

    /** Los datos [desde, largo] del archivo; null si se salen. */
    private byte[] bytes(long offset, long length) {
        if (offset < 0 || length < 0 || base + offset + length > data.capacity()) return null;
        return slice((int) (base + offset), (int) length);
    }

    private String text(JSONArray range) {
        if (range == null || range.length() != 2) return null;
        byte[] b = bytes(range.optLong(0, -1), range.optLong(1, -1));
        return b == null ? null : new String(b, StandardCharsets.UTF_8);
    }

    // MARK: El servidor

    /** Empieza a escuchar en 127.0.0.1 (un puerto libre) y devuelve el puerto. */
    int start() throws IOException {
        server = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        pool.execute(this::acceptLoop);
        // una línea vacía cada poco mantiene abiertas las conexiones de eventos
        timer.scheduleWithFixedDelay(() -> broadcast(""), 20, 20, TimeUnit.SECONDS);
        return server.getLocalPort();
    }

    void stop() {
        try {
            if (server != null) server.close();
        } catch (IOException e) {
            // ya cerrado
        }
        for (OutputStream s : streams) closeQuietly(s);
        streams.clear();
        timer.shutdownNow();
        pool.shutdownNow();
    }

    private void acceptLoop() {
        while (!server.isClosed()) {
            try {
                Socket s = server.accept();
                pool.execute(() -> serve(s));
            } catch (IOException e) {
                return; // cerrado
            } catch (RuntimeException e) {
                return; // el grupo de hilos ya se cerró
            }
        }
    }

    private void serve(Socket socket) {
        try (Socket s = socket) {
            s.setSoTimeout(60_000);
            DemoRequest r = DemoRequest.read(s.getInputStream());
            if (r == null) return;
            OutputStream out = new BufferedOutputStream(s.getOutputStream(), 64 * 1024);
            route(r, s, out);
        } catch (IOException e) {
            // la vista web cerró la conexión
        }
    }

    // MARK: Rutas (las del servidor del Mac: src/main/electron/remote/server.ts)

    private void route(DemoRequest r, Socket s, OutputStream out) throws IOException {
        String m = r.method;
        if ("POST".equals(m) && "/rpc".equals(r.path)) {
            json(out, answer(r.text()));
        } else if ("GET".equals(m) && "/events".equals(r.path)) {
            out.write(("HTTP/1.1 200 OK\r\ncontent-type: application/x-ndjson; charset=utf-8\r\ncache-control: no-store\r\n"
                + "connection: close\r\n\r\n\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
            streams.add(out);
            // abierta hasta que la vista web la suelte (cambia de página): entonces se quita
            s.setSoTimeout(0);
            InputStream in = s.getInputStream();
            byte[] buf = new byte[1024];
            try {
                while (in.read(buf) >= 0) { /* nada que leer: solo se espera al cierre */ }
            } finally {
                streams.remove(out);
            }
        } else if ("GET".equals(m) && "/health".equals(r.path)) {
            json(out, "{\"ok\":true,\"app\":\"aula\",\"demo\":true}");
        } else if ("PUT".equals(m) && r.path.startsWith("/upload/")) {
            json(out, "{\"ok\":true}");
        } else if ("GET".equals(m) || "HEAD".equals(m)) {
            String path = "/index.html".equals(r.path) ? "/" : r.path;
            JSONArray file = files.optJSONArray(path);
            byte[] body = file == null || file.length() != 3 ? null : bytes(file.optLong(0, -1), file.optLong(1, -1));
            if (body == null) {
                respond(out, "404 Not Found", "application/json; charset=utf-8",
                    "{\"ok\":false,\"error\":{\"message\":\"not_found\",\"code\":\"not_found\"}}".getBytes(StandardCharsets.UTF_8), -1, Collections.emptyList());
                return;
            }
            List<String> extra = new ArrayList<>();
            extra.add("x-content-type-options: nosniff");
            if ("/".equals(path) && !csp.isEmpty()) extra.add("content-security-policy: " + csp);
            extra.add(path.startsWith("/assets/") ? "cache-control: public, max-age=31536000, immutable" : "cache-control: no-store");
            respond(out, "200 OK", file.optString(2, "application/octet-stream"), "HEAD".equals(m) ? new byte[0] : body, body.length, extra);
        } else {
            respond(out, "405 Method Not Allowed", "application/json; charset=utf-8",
                "{\"ok\":false,\"error\":{\"message\":\"invalid_args\",\"code\":\"invalid_args\"}}".getBytes(StandardCharsets.UTF_8), -1, Collections.emptyList());
        }
    }

    private static void json(OutputStream out, String text) throws IOException {
        respond(out, "200 OK", "application/json; charset=utf-8", text.getBytes(StandardCharsets.UTF_8), -1, Collections.singletonList("cache-control: no-store"));
    }

    private static void respond(OutputStream out, String status, String type, byte[] body, int length, List<String> extra) throws IOException {
        StringBuilder head = new StringBuilder("HTTP/1.1 ").append(status).append("\r\ncontent-type: ").append(type)
            .append("\r\ncontent-length: ").append(length >= 0 ? length : body.length).append("\r\nconnection: close\r\n");
        for (String line : extra) head.append(line).append("\r\n");
        head.append("\r\n");
        out.write(head.toString().getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    // MARK: Lo que contestaría el Mac

    /** La respuesta grabada a esta llamada; si no se grabó tal cual, la última de ese método; si tampoco, un «no está». */
    String answer(String body) {
        String key = DemoDates.shift(body, -days);
        String source = key;
        JSONArray range = rpc.optJSONArray(key);
        String method = methodOf(body);
        if (range == null && method != null && fallback.has(method)) {
            source = fallback.optString(method);
            range = rpc.optJSONArray(source);
        }
        String recorded = text(range);
        if (recorded == null) return "{\"ok\":false,\"error\":{\"message\":" + DemoDates.json(unavailable) + ",\"code\":\"demo\"}}";
        // una llamada parecida a la grabada: lo que el estudiante mandó (su texto, el id de su mensaje) sustituye a lo grabado
        List<String[]> swaps = source.equals(key) ? Collections.emptyList() : swaps(source, key);
        // una pregunta nueva en el chat: la respuesta grabada llega como un mensaje nuevo, y dice que esto es la demostración
        String fresh = !source.equals(key) && "chat.send".equals(method) ? "demo-" + UUID.randomUUID().toString().substring(0, 8) : null;
        JSONArray list = events.optJSONArray(source);
        for (int i = 0; list != null && i < list.length(); i++) {
            JSONObject e = list.optJSONObject(i);
            if (e == null) continue;
            String fitted = fit(e.optString("line"), swaps);
            String line = fresh == null ? fitted : asNewReply(fitted, fresh, chatReply);
            try {
                timer.schedule(() -> broadcast(line), Math.max(0, e.optLong("after")), TimeUnit.MILLISECONDS);
            } catch (RuntimeException closed) {
                // la demostración ya se cerró
            }
        }
        return fit(recorded, swaps);
    }

    private String fit(String text, List<String[]> swaps) {
        for (String[] s : swaps) text = text.replace(s[0], s[1]);
        return DemoDates.shift(text, days);
    }

    private static String methodOf(String body) {
        try {
            return new JSONObject(body).optString("method", null);
        } catch (JSONException e) {
            return null;
        }
    }

    /** Los textos de la llamada grabada que en la de ahora son otros, como literales JSON (sin comillas): (grabado, de ahora). */
    static List<String[]> swaps(String recorded, String actual) {
        List<String[]> out = new ArrayList<>();
        try {
            JSONObject then = new JSONObject(recorded), now = new JSONObject(actual);
            if (!then.optString("method").equals(now.optString("method"))) return out;
            JSONObject a = then.optJSONObject("args"), b = now.optJSONObject("args");
            if (a == null || b == null) return out;
            for (Iterator<String> it = a.keys(); it.hasNext(); ) {
                String name = it.next();
                Object was = a.opt(name), isNow = b.opt(name);
                // solo los largos: un texto corto podría coincidir con otra cosa
                if (!(was instanceof String) || !(isNow instanceof String)) continue;
                String w = (String) was, n = (String) isNow;
                if (w.equals(n) || w.length() < 8 || n.isEmpty()) continue;
                String lw = DemoDates.json(w), ln = DemoDates.json(n);
                out.add(new String[] { lw.substring(1, lw.length() - 1), ln.substring(1, ln.length() - 1) });
            }
        } catch (JSONException e) {
            return out;
        }
        // primero los más largos: un id que contiene a otro no se rompe a medias
        out.sort((x, y) -> y[0].length() - x[0].length());
        return out;
    }

    /** Un evento del chat grabado, como respuesta a otra pregunta: el mensaje de Aula con otro id y el texto de la demostración. */
    static String asNewReply(String line, String id, String text) {
        try {
            JSONObject event = new JSONObject(line);
            JSONObject payload = event.optJSONObject("payload");
            JSONObject message = payload == null ? null : payload.optJSONObject("message");
            if (message == null || !"assistant".equals(message.optString("role"))) return line;
            message.put("id", id);
            if (!message.optString("text").isEmpty()) message.put("text", text);
            return event.toString();
        } catch (JSONException e) {
            return line;
        }
    }

    private void broadcast(String line) {
        byte[] bytes = (line + "\n").getBytes(StandardCharsets.UTF_8);
        for (OutputStream s : streams) {
            try {
                s.write(bytes);
                s.flush();
            } catch (IOException e) {
                streams.remove(s);
                closeQuietly(s);
            }
        }
    }

    private static void closeQuietly(OutputStream s) {
        try {
            s.close();
        } catch (IOException e) {
            // ya cerrada
        }
    }
}
