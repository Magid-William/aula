// Comprueba en la JVM lo de la demostración que no depende de Android (DemoDates.java, DemoRequest.java); build.sh lo
// ejecuta antes de empaquetar y un fallo para la compilación.
package com.luumlabs.aula;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;

public final class DemoTest {
    private static int failures;

    private static void check(boolean ok, String what) {
        if (!ok) {
            failures++;
            System.err.println("FALLA: " + what);
        }
    }

    private static DemoRequest req(String raw) {
        byte[] b = raw.getBytes(StandardCharsets.UTF_8);
        return DemoRequest.parse(b, b.length);
    }

    public static void main(String[] args) {
        // las fechas del ejemplo, al día de hoy
        check(DemoDates.days("2026-11-10", LocalDate.of(2026, 11, 17)) == 7, "una semana después son 7 días");
        check(DemoDates.days("2026-11-10", LocalDate.of(2026, 11, 3)) == -7, "antes de grabar, días negativos");
        check(DemoDates.days("roto", LocalDate.of(2026, 11, 17)) == 0, "un día que no se entiende no mueve nada");
        check(DemoDates.shift("examen 2026-11-30", 7).equals("examen 2026-12-07"), "se mueve una fecha y cambia de mes");
        check(DemoDates.shift("{\"at\":\"2026-02-27T10:00:00Z\"}", 2).equals("{\"at\":\"2026-03-01T10:00:00Z\"}"), "las horas ISO también, y febrero acaba");
        check(DemoDates.shift("2024-02-28", 1).equals("2024-02-29"), "año bisiesto");
        check(DemoDates.shift("id-12026-11-30", 7).equals("id-12026-11-30"), "un número pegado no es una fecha");
        check(DemoDates.shift("2026-13-40", 7).equals("2026-13-40"), "lo que no es una fecha se deja");
        check(DemoDates.shift("2026-11-30", 0).equals("2026-11-30"), "sin días, igual");
        check(DemoDates.shift("de 2026-11-30 a 2026-12-01", -1).equals("de 2026-11-29 a 2026-11-30"), "varias fechas, hacia atrás");
        // los textos como los escribe JSON.stringify
        check(DemoDates.json("a\"b\\c\nd/é").equals("\"a\\\"b\\\\c\\nd/é\""), "comillas, barras, saltos; «/» y acentos tal cual");
        check(DemoDates.json("\u0001").equals("\"\\u0001\""), "los de control, con \\u");
        // peticiones HTTP
        DemoRequest get = req("GET /assets/app.js?v=2 HTTP/1.1\r\nHost: 127.0.0.1:1234\r\n\r\n");
        check(get != null && get.method.equals("GET") && get.path.equals("/assets/app.js") && get.body.length == 0, "un GET sin consulta");
        DemoRequest root = req("GET /?demo=1 HTTP/1.1\r\n\r\n");
        check(root != null && root.path.equals("/"), "«/?demo=1» es «/»");
        DemoRequest post = req("POST /rpc HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: 13\r\n\r\n{\"method\":1}x");
        check(post != null && post.method.equals("POST") && post.text().equals("{\"method\":1}x"), "un POST con su cuerpo");
        check(req("POST /rpc HTTP/1.1\r\ncontent-length: 20\r\n\r\n{\"a\":1}") == null, "falta cuerpo: aún no");
        check(req("GET / HTTP/1.1\r\nHost: x\r\n") == null, "faltan cabeceras: aún no");
        check(req("POST /rpc HTTP/1.1\r\nContent-Length: nada\r\n\r\n") == null, "una longitud rota no es una petición");
        if (failures > 0) {
            System.err.println(failures + " comprobaciones de la demostración fallaron");
            System.exit(1);
        }
        System.out.println("DemoTest: bien");
    }
}
