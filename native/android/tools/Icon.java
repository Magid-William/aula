// El primer plano del icono adaptable: el icono de Aula (el del iPhone) reducido al centro y rodeado del mismo papel.
//   java native/android/tools/Icon.java <icono.png> <salida.png> <lado> <lado del dibujo> <color RRGGBB> [mono]
// Con «mono», la capa de los iconos temáticos (Android 13 o posterior): el dibujo en una sola tinta, sin el papel. Lo
// oscuro (la tinta del arco) queda opaco, el ladrillo y el sol a medias y el papel (el color dado) transparente.
// Con Java (que la compilación ya necesita) en lugar de sips o ImageMagick: lo mismo en la Mac y en Linux.
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

public class Icon {
    public static void main(String[] a) throws Exception {
        BufferedImage src = ImageIO.read(new File(a[0]));
        int size = Integer.parseInt(a[2]);
        int inner = Integer.parseInt(a[3]);
        Color paper = new Color(Integer.parseInt(a[4], 16));
        boolean mono = a.length > 5 && "mono".equals(a[5]);
        int off = (size - inner) / 2;
        if (mono) {
            BufferedImage scaled = draw(src, inner, inner, 0, null);
            BufferedImage out = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
            double lp = luma(paper.getRGB());
            double ink = 0.18;
            for (int y = 0; y < inner; y++) {
                for (int x = 0; x < inner; x++) {
                    double k = (lp - luma(scaled.getRGB(x, y))) / (lp - ink);
                    k = k < 0.22 ? 0 : Math.min(1, k);
                    out.setRGB(off + x, off + y, ((int) Math.round(k * 255) << 24) | 0xFFFFFF);
                }
            }
            ImageIO.write(out, "png", new File(a[1]));
            return;
        }
        ImageIO.write(draw(src, size, inner, off, paper), "png", new File(a[1]));
    }

    /** El dibujo a `inner` px, en un lienzo de `size` px del color `bg` (o transparente). */
    private static BufferedImage draw(BufferedImage src, int size, int inner, int off, Color bg) {
        BufferedImage out = new BufferedImage(size, size, bg == null ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        if (bg != null) {
            g.setColor(bg);
            g.fillRect(0, 0, size, size);
        }
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.drawImage(src, off, off, inner, inner, null);
        g.dispose();
        return out;
    }

    private static double luma(int rgb) {
        return (0.299 * ((rgb >> 16) & 0xFF) + 0.587 * ((rgb >> 8) & 0xFF) + 0.114 * (rgb & 0xFF)) / 255;
    }
}
