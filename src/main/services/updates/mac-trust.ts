// Identidades públicas de Aula. La transición solo va del certificado local a Developer ID; nunca al revés.
// Apple TN3127: los OID solo identifican el tipo de certificado dentro de `anchor apple generic`.
export const LOCAL_MAC_REQUIREMENT = 'identifier "com.luumlabs.aula" and certificate root = H"26061b07d114b31e63193681c2909e1343076926"'
export const DEVELOPER_ID_MAC_REQUIREMENT = 'identifier "com.luumlabs.aula" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "87BM9KFJZW"'

type Run = (cmd: string, args: string[]) => Promise<string>

/** Además del DR, exige una identidad conocida. Solo el puente, con Ed25519 ya comprobada, puede cambiar de firmante. */
export async function verifyMacUpdateTrust(o: {
  current: string
  candidate: string
  currentRequirement: string
  verifiedUpdateSignature: boolean
  run: Run
}): Promise<void> {
  const verify = (app: string, requirement: string) => o.run('/usr/bin/codesign', ['--verify', '--deep', '--strict', `-R=${requirement}`, app])
  const satisfies = async (app: string, requirement: string) => {
    try { await verify(app, requirement); return true } catch { return false }
  }
  if (await satisfies(o.current, DEVELOPER_ID_MAC_REQUIREMENT)) {
    // Incluso si el DR de una app Apple fuera más amplio, no se vuelve a aceptar el certificado local.
    await verify(o.candidate, DEVELOPER_ID_MAC_REQUIREMENT)
    await verify(o.candidate, o.currentRequirement)
    return
  }
  // No basta con leer un texto que diga «Aula»: codesign comprueba la firma actual contra el pin exacto.
  await verify(o.current, LOCAL_MAC_REQUIREMENT)
  if (await satisfies(o.candidate, LOCAL_MAC_REQUIREMENT)) {
    await verify(o.candidate, o.currentRequirement)
    return
  }
  if (!o.verifiedUpdateSignature) throw new Error('El cambio a Developer ID requiere la firma Ed25519 de Aula')
  await verify(o.candidate, DEVELOPER_ID_MAC_REQUIREMENT)
}
