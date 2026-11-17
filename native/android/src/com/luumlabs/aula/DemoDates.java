// Lo de la demostración que no depende de Android, para comprobarlo en la JVM al compilar (tools/DemoTest.java): las
// fechas del ejemplo movidas al día de hoy y los textos como literales JSON (los mismos que escribe JSON.stringify).
// Lo mismo que DemoDates de la app del iPhone (native/ios/Aula/DemoServer.swift).
package com.luumlabs.aula;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class DemoDates {
    private DemoDates() { }

    private static final Pattern DATE = Pattern.compile("(?<![0-9])(20[0-9]{2})-([0-9]{2})-([0-9]{2})(?![0-9])");

    /** Días enteros entre el día grabado («AAAA-MM-DD») y `today`; 0 si no se entiende. */
    static int days(String recorded, LocalDate today) {
        try {
            return (int) ChronoUnit.DAYS.between(LocalDate.parse(recorded), today);
        } catch (DateTimeException | NullPointerException e) {
            return 0;
        }
    }

    /**
     * Mueve `days` días cada fecha «AAAA-MM-DD» del texto (las de las horas ISO incluidas): lo grabado un martes con un
     * examen «dentro de 20 días» sigue teniéndolo dentro de 20 días cuando se abre meses después.
     */
    static String shift(String text, int days) {
        if (days == 0 || text == null) return text;
        Matcher m = DATE.matcher(text);
        StringBuilder out = null;
        int last = 0;
        while (m.find()) {
            if (out == null) out = new StringBuilder(text.length());
            out.append(text, last, m.start());
            last = m.end();
            String moved;
            try {
                LocalDate d = LocalDate.of(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
                moved = d.plusDays(days).toString();
            } catch (DateTimeException e) {
                moved = m.group(); // no es una fecha (un 2025-13-40): se deja
            }
            out.append(moved);
        }
        if (out == null) return text;
        out.append(text, last, text.length());
        return out.toString();
    }

    /** `s` como literal JSON, con sus comillas, escapado como JSON.stringify (la «/» y lo que no es ASCII, tal cual). */
    static String json(String s) {
        StringBuilder b = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\b': b.append("\\b"); break;
                case '\f': b.append("\\f"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }
}
