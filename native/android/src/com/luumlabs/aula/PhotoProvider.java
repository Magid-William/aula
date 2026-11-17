// Dónde deja la cámara la foto que se hace al añadir materiales (apuntes, la pizarra): un archivo en la caché de la app,
// que solo la app de cámara elegida puede escribir (el permiso va en el Intent, por esa foto) y que luego la vista web
// sube a Aula como cualquier archivo elegido. Así no hace falta pedir el permiso de la cámara ni el de las fotos.
package com.luumlabs.aula;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public final class PhotoProvider extends ContentProvider {
    static final String AUTHORITY = "com.luumlabs.aula.photos";
    private static final long DAY = 24L * 60 * 60 * 1000;

    private static File dir(Context context) {
        return new File(context.getCacheDir(), "photos");
    }

    /** Una dirección nueva para la próxima foto (y fuera las de días anteriores); null si no hay dónde. */
    static Uri newPhoto(Context context) {
        File d = dir(context);
        if (!d.isDirectory() && !d.mkdirs()) return null;
        File[] old = d.listFiles();
        if (old != null) for (File f : old) if (System.currentTimeMillis() - f.lastModified() > DAY) f.delete();
        String name = "Aula " + new SimpleDateFormat("yyyy-MM-dd HH.mm.ss", Locale.ROOT).format(new Date()) + ".jpg";
        return new Uri.Builder().scheme("content").authority(AUTHORITY).appendPath(name).build();
    }

    /** ¿La cámara dejó algo en esa dirección? */
    static boolean taken(Context context, Uri uri) {
        File f = file(context, uri);
        return f != null && f.length() > 0;
    }

    /** El archivo de una dirección nuestra: solo un nombre .jpg dentro de la carpeta de fotos. */
    private static File file(Context context, Uri uri) {
        if (uri == null || !AUTHORITY.equals(uri.getAuthority()) || uri.getPathSegments().size() != 1) return null;
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("/") || name.startsWith(".") || !name.endsWith(".jpg")) return null;
        return new File(dir(context), name);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = file(getContext(), uri);
        if (f == null) throw new FileNotFoundException(String.valueOf(uri));
        int how = mode.contains("w") ? ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_TRUNCATE
            : ParcelFileDescriptor.MODE_READ_ONLY;
        if (mode.contains("w")) dir(getContext()).mkdirs();
        return ParcelFileDescriptor.open(f, how);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        File f = file(getContext(), uri);
        if (f == null) return null;
        String[] cols = projection != null ? projection : new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE };
        MatrixCursor c = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
        }
        c.addRow(row);
        return c;
    }

    @Override
    public String getType(Uri uri) {
        return file(getContext(), uri) == null ? null : "image/jpeg";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] args) {
        File f = file(getContext(), uri);
        return f != null && f.delete() ? 1 : 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] args) {
        return 0;
    }
}
