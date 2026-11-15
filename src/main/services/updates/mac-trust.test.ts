import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { DEVELOPER_ID_MAC_REQUIREMENT, LOCAL_MAC_REQUIREMENT, verifyMacUpdateTrust } from './mac-trust'

const current = '/Applications/Aula.app'
const candidate = '/stage/Aula.app'
const dr = 'identifier "com.luumlabs.aula" and certificate leaf = H"1111111111111111111111111111111111111111"'
type Identity = 'local' | 'apple' | 'foreign' | 'adhoc' | 'unsigned' | 'broken'

// Doble del verificador del sistema, no de la política: solo los dos requisitos públicos dan una identidad conocida.
// La evaluación real de una firma Developer ID se ensaya con los binarios firmados antes de publicar.
function scenario(from: Identity, to: Identity, matchesDR = from === to) {
  const run = vi.fn(async (cmd: string, args: string[]) => {
    expect(cmd).toBe('/usr/bin/codesign')
    expect(args.slice(0, 3)).toEqual(['--verify', '--deep', '--strict'])
    const identity = args.at(-1) === current ? from : to
    const requirement = args[3]
    const ok = requirement === `-R=${LOCAL_MAC_REQUIREMENT}` ? identity === 'local'
      : requirement === `-R=${DEVELOPER_ID_MAC_REQUIREMENT}` ? identity === 'apple'
        : requirement === `-R=${dr}` && matchesDR
    if (!ok) throw new Error('code failed to satisfy specified code requirement(s)')
    return ''
  })
  return { run, verify: (verifiedUpdateSignature = true) => verifyMacUpdateTrust({ current, candidate, currentRequirement: dr, verifiedUpdateSignature, run }) }
}

describe('firmantes del puente macOS', () => {
  it.each([['local', 'local'], ['local', 'apple'], ['apple', 'apple']] as const)('%s → %s', async (from, to) => {
    await expect(scenario(from, to).verify()).resolves.toBeUndefined()
  })

  it.each(['foreign', 'adhoc', 'unsigned', 'broken'] as const)('una app actual %s no habilita el puente, aunque el candidato sea Apple', async (from) => {
    await expect(scenario(from, 'apple', true).verify()).rejects.toThrow()
  })

  it.each(['local', 'apple'] as const)('desde %s se rechazan firmas distintas, ad hoc, ausentes o alteradas', async (from) => {
    for (const to of ['foreign', 'adhoc', 'unsigned', 'broken'] as const) {
      await expect(scenario(from, to, true).verify(), to).rejects.toThrow()
    }
  })

  it('Apple → local se rechaza incluso si el DR actual lo permitiera', async () => {
    await expect(scenario('apple', 'local', true).verify()).rejects.toThrow()
  })

  it.each(['local', 'apple'] as const)('conserva el DR para las actualizaciones dentro de %s', async (identity) => {
    await expect(scenario(identity, identity, false).verify()).rejects.toThrow()
    const s = scenario(identity, identity)
    await s.verify()
    expect(s.run).toHaveBeenCalledWith('/usr/bin/codesign', ['--verify', '--deep', '--strict', `-R=${dr}`, candidate])
  })

  it('el cambio local → Apple exige Ed25519 ya comprobada y no reutiliza el DR local', async () => {
    await expect(scenario('local', 'apple').verify(false)).rejects.toThrow('Ed25519')
    const s = scenario('local', 'apple')
    await s.verify()
    expect(s.run.mock.calls.some(([, args]) => args[3] === `-R=${dr}`)).toBe(false)
  })

  it('fija bundle, raíz local y todos los límites de Developer ID (no basta el nombre ni el equipo)', () => {
    expect(LOCAL_MAC_REQUIREMENT).toBe('identifier "com.luumlabs.aula" and certificate root = H"26061b07d114b31e63193681c2909e1343076926"')
    expect(DEVELOPER_ID_MAC_REQUIREMENT).toBe('identifier "com.luumlabs.aula" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "87BM9KFJZW"')
  })

  it.skipIf(process.platform !== 'darwin')('macOS compila ambos requisitos sin credenciales ni llaveros', () => {
    for (const requirement of [LOCAL_MAC_REQUIREMENT, DEVELOPER_ID_MAC_REQUIREMENT]) {
      expect(() => execFileSync('/usr/bin/csreq', ['-r', `=${requirement}`, '-t'], { stdio: 'pipe' })).not.toThrow()
    }
  })
})
