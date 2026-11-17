import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { remoteCall } from '@main/services/remote/policy'
import { canFrom, deviceRole, keySafeNote, ONLY_FROM, settingsElsewhere, type DeviceGatedMethod, type DeviceRole } from './device'

const ROLES: DeviceRole[] = ['window', 'owner', 'macDevice', 'serverDevice']

describe('deviceRole', () => {
  it('la ventana no es un dispositivo, aunque el resto diga otra cosa', () => {
    expect(deviceRole({ remote: false, owner: false, server: false })).toBe('window')
    expect(deviceRole({ remote: false, owner: true, server: true })).toBe('window')
  })
  it('distingue el propietario de un servidor de los demás dispositivos', () => {
    expect(deviceRole({ remote: true, owner: true, server: true })).toBe('owner')
    expect(deviceRole({ remote: true, owner: false, server: true })).toBe('serverDevice')
    expect(deviceRole({ remote: true, owner: false, server: false })).toBe('macDevice')
  })
})

describe('settingsElsewhere', () => {
  it('la ventana y el propietario lo arreglan aquí; los demás, en el Mac o el propietario', () => {
    expect(settingsElsewhere('window')).toBeNull()
    expect(settingsElsewhere('owner')).toBeNull()
    expect(settingsElsewhere('macDevice')).toBe('mac')
    expect(settingsElsewhere('serverDevice')).toBe('owner')
  })
})

describe('keySafeNote', () => {
  it('sin saber cómo se protegen los secretos no promete nada', () => {
    for (const role of ROLES) expect(keySafeNote(role, undefined)).toBeNull()
  })
  it('en la ventana: cifrada en este ordenador, o sin cifrar si no hay llavero', () => {
    expect(keySafeNote('window', 'os')).toBe('keySafe')
    expect(keySafeNote('window', 'basic')).toBe('keySafeBasic')
  })
  it('el propietario guarda la clave en el servidor, que sin llavero la deja sin cifrar', () => {
    expect(keySafeNote('owner', 'basic')).toBe('keySafeServerBasic')
    expect(keySafeNote('owner', 'os')).toBe('keySafeServer')
  })
  it('sin llavero ahora en macOS o Windows (no se guarda nada) no promete nada', () => {
    for (const role of ROLES) expect(keySafeNote(role, 'unavailable')).toBeNull()
  })
  it('los dispositivos que no guardan claves no llevan nota', () => {
    expect(keySafeNote('macDevice', 'os')).toBeNull()
    expect(keySafeNote('serverDevice', 'basic')).toBeNull()
  })
  it('cada nota existe en es y en', () => {
    for (const lang of ['es', 'en']) {
      const ai = (JSON.parse(readFileSync(join(__dirname, '../i18n/locales', lang, 'settings.json'), 'utf8')) as { ai: Record<string, unknown> }).ai
      for (const role of ROLES) {
        for (const p of ['os', 'basic'] as const) {
          const note = keySafeNote(role, p)
          if (note) expect(typeof ai[note], `${lang}: ai.${note}`).toBe('string')
        }
      }
    }
  })
})

describe('ONLY_FROM', () => {
  it('dice lo mismo que la política: negado a un dispositivo y, según el caso, permitido a un propietario', () => {
    for (const [method, from] of Object.entries(ONLY_FROM)) {
      expect(remoteCall(method, {}).verdict, method).toBe('deny')
      expect(remoteCall(method, {}, { owner: true }).verdict, method).toBe(from === 'owner' ? 'allow' : 'deny')
    }
  })
  it('la ventana lo puede todo; un propietario, lo suyo; los demás dispositivos, nada', () => {
    for (const method of Object.keys(ONLY_FROM) as DeviceGatedMethod[]) {
      expect(canFrom('window', method)).toBe(true)
      expect(canFrom('owner', method)).toBe(ONLY_FROM[method] === 'owner')
      expect(canFrom('macDevice', method)).toBe(false)
      expect(canFrom('serverDevice', method)).toBe(false)
    }
  })
})

/** Los archivos de la interfaz (sin pruebas), con su ruta desde src/renderer/src. */
function sources(dir: string, root = dir): { file: string; text: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path, root)
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return []
    return [{ file: relative(root, path).split('\\').join('/'), text: readFileSync(path, 'utf8') }]
  })
}

// Los que piden un método negado a un dispositivo sin mirar desde dónde se usa Aula, porque ya lo mira quien los enseña
const REVIEWED: Record<string, string> = {
  'app/shell/KeychainNotice.tsx': 'en un dispositivo secrets.status no hace nada (dice «ok»): el aviso nunca sale',
  'app/shell/UpdateNotice.tsx': 'en un dispositivo updates.state dice «sin actualizaciones»: no ofrece instalar',
  'lib/figureExport/chart.ts': 'solo lo llama FigureExportAction, que no se pinta en un dispositivo',
  'lib/figureExport/diagram.ts': 'solo lo llama FigureExportAction, que no se pinta en un dispositivo',
  'lib/figureExport/drawing.ts': 'solo lo llama FigureExportAction, que no se pinta en un dispositivo',
  'screens/course/Actions.tsx': 'sus acciones las abren la cabecera del curso y su aviso de fallo, con canFrom(…)',
  'screens/calendar/Subscriptions.tsx': 'solo lo abre el calendario, con canFrom(…, calendar.subscribe)',
  'screens/documents/export/ExportDialog.tsx': 'solo lo abren la biblioteca y el lector, con canFrom(…, documents.save)',
  'screens/settings/Updates.tsx': 'Ajustes solo enseña las actualizaciones en la ventana (settings/index.tsx)',
  'screens/settings/chatgptLogin.ts': 'lo usa AIPicker, que Ajustes solo enseña en la ventana o al propietario'
}

describe('acciones negadas a un dispositivo', () => {
  // un método acotado (se permite con ciertos argumentos) o que el puente del dispositivo resuelve allí (abrir un enlace)
  const fine = new Set(['settings.update', 'memory.forget', 'ai.choose', 'app.openExternal'])
  const denied = (m: string): boolean => !fine.has(m) && remoteCall(m, undefined).verdict === 'deny'
  const gate = /canFrom\(|api\.(remote|owner|role)\b|\bremote\b/

  it('solo se ofrecen donde se pueden hacer (o el archivo está revisado)', () => {
    const offenders: string[] = []
    for (const { file, text } of sources(join(__dirname, '..'))) {
      const methods = [...text.matchAll(/api\.invoke\('([a-zA-Z]+\.[a-zA-Z]+)'/g)].map((m) => m[1]).filter(denied)
      if (methods.length && !gate.test(text) && !REVIEWED[file]) offenders.push(`${file}: ${[...new Set(methods)].join(', ')}`)
    }
    expect(offenders).toEqual([])
  })

  it('cada archivo revisado sigue existiendo y pidiendo algo negado', () => {
    const all = new Map(sources(join(__dirname, '..')).map((s) => [s.file, s.text]))
    for (const file of Object.keys(REVIEWED)) {
      const text = all.get(file)
      expect(text, file).toBeDefined()
      expect([...(text ?? '').matchAll(/api\.invoke\('([a-zA-Z]+\.[a-zA-Z]+)'/g)].some((m) => denied(m[1])), file).toBe(true)
    }
  })
})
