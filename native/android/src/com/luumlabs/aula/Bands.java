// El fondo de la ventana: lo que se ve bajo las barras del sistema (la hora arriba, los gestos o los botones abajo, la
// muesca de lado). En las pantallas propias de la app es su papel; con Aula a la vista, el color de cada borde de la
// página (Shell.js lo mide: el grano del papel, el velo de un diálogo, la barra lateral junto a la hoja en una tableta),
// así la página parece llegar hasta el borde de la pantalla.
package com.luumlabs.aula;

import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;

final class Bands extends Drawable {
    /** Un borde de arriba o de abajo: a la izquierda de `split` (fracción del ancho de la página) `left`, luego `main`. */
    static final class Edge {
        final int left, main;
        final float split;

        Edge(int left, int main, float split) {
            this.left = left;
            this.main = main;
            this.split = split;
        }
    }

    private final Paint paint = new Paint();
    private int paper;
    /** null: las pantallas propias (todo papel). */
    private Edge top, bottom;
    private int left, right;
    /** Las barras: izquierda, arriba, derecha, abajo (px). */
    private int l, t, r, b;

    void setPaper(int color) {
        paper = color;
        invalidateSelf();
    }

    void setInsets(int left, int top, int right, int bottom) {
        if (l == left && t == top && r == right && b == bottom) return;
        l = left;
        t = top;
        r = right;
        b = bottom;
        invalidateSelf();
    }

    /** Los colores de la página; con `top` null, solo papel. */
    void setPage(Edge top, Edge bottom, int left, int right) {
        this.top = top;
        this.bottom = bottom;
        this.left = left;
        this.right = right;
        invalidateSelf();
    }

    @Override
    public void draw(Canvas c) {
        Rect box = getBounds();
        if (top == null || bottom == null) {
            c.drawColor(paper);
            return;
        }
        // lo de en medio queda bajo la página (o bajo el teclado): del color de abajo
        c.drawColor(bottom.main);
        int pageLeft = box.left + l;
        int pageWidth = Math.max(0, box.width() - l - r);
        edge(c, top, box.left, box.top, box.right, box.top + t, pageLeft, pageWidth);
        edge(c, bottom, box.left, box.bottom - b, box.right, box.bottom, pageLeft, pageWidth);
        fill(c, left, box.left, box.top + t, pageLeft, box.bottom - b);
        fill(c, right, box.right - r, box.top + t, box.right, box.bottom - b);
    }

    private void edge(Canvas c, Edge e, int x0, int y0, int x1, int y1, int pageLeft, int pageWidth) {
        if (y1 <= y0) return;
        int split = e.split > 0 && e.left != e.main ? pageLeft + Math.round(e.split * pageWidth) : x0;
        fill(c, e.left, x0, y0, split, y1);
        fill(c, e.main, split, y0, x1, y1);
    }

    private void fill(Canvas c, int color, int x0, int y0, int x1, int y1) {
        if (x1 <= x0 || y1 <= y0) return;
        paint.setColor(color);
        c.drawRect(x0, y0, x1, y1, paint);
    }

    @Override
    public void setAlpha(int alpha) { }

    @Override
    public void setColorFilter(ColorFilter filter) { }

    @Override
    @SuppressWarnings("deprecation")
    public int getOpacity() {
        return PixelFormat.OPAQUE;
    }
}
