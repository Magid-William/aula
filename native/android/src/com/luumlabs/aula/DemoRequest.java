// Una petición HTTP al servidor de la demostración (DemoServer): la línea de la petición, la longitud y el cuerpo. Sin
// Android, para comprobarla en la JVM al compilar (tools/DemoTest.java).
package com.luumlabs.aula;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

final class DemoRequest {
    /** Lo más grande que se acepta (cabeceras y cuerpo). */
    static final int MAX = 1 << 20;

    final String method;
    /** Sin la consulta: «/?demo=1» es la misma página que «/». */
    final String path;
    final byte[] body;

    private DemoRequest(String method, String path, byte[] body) {
        this.method = method;
        this.path = path;
        this.body = body;
    }

    String text() {
        return new String(body, StandardCharsets.UTF_8);
    }

    /** La petición entera de los `len` primeros bytes; null mientras falte algo por llegar (o si no es HTTP). */
    static DemoRequest parse(byte[] data, int len) {
        int end = -1;
        for (int i = 0; i + 3 < len; i++) {
            if (data[i] == '\r' && data[i + 1] == '\n' && data[i + 2] == '\r' && data[i + 3] == '\n') { end = i; break; }
        }
        if (end < 0) return null;
        String[] lines = new String(data, 0, end, StandardCharsets.ISO_8859_1).split("\r\n");
        String[] first = lines[0].split(" ");
        if (first.length < 2) return null;
        int length = 0;
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon <= 0) continue;
            if (!"content-length".equals(lines[i].substring(0, colon).trim().toLowerCase(Locale.ROOT))) continue;
            try {
                length = Integer.parseInt(lines[i].substring(colon + 1).trim());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        int start = end + 4;
        if (length < 0 || len - start < length) return null;
        byte[] body = new byte[length];
        System.arraycopy(data, start, body, 0, length);
        String target = first[1];
        int q = target.indexOf('?');
        return new DemoRequest(first[0], q >= 0 ? target.substring(0, q) : target, body);
    }

    /** Lee de `in` hasta tener una petición entera; null si se corta antes o pasa de MAX. */
    static DemoRequest read(InputStream in) throws IOException {
        ByteArrayOutputStream got = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        while (got.size() <= MAX) {
            int n = in.read(buf);
            if (n < 0) return null;
            got.write(buf, 0, n);
            byte[] all = got.toByteArray();
            DemoRequest r = parse(all, all.length);
            if (r != null) return r;
        }
        return null;
    }
}
