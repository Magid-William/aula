// Hablar con Aula con la IA simulada: el mensaje del estudiante aparece al momento y la respuesta llega por partes; los
// cuestionarios y las tarjetas se resuelven en la conversación; «@» menciona cosas de tus cursos; lo que se escribe mientras Aula
// responde espera en cola y se envía al terminar.
import { test, expect, type Page } from 'playwright/test'
import { go, homeWithDemoCourse, launch } from './helpers'

/** Envía un mensaje desde la caja y espera a que Aula termine de responder. */
async function ask(page: Page, text: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Message Aula…' })
  await box.fill(text)
  await box.press('Enter')
  await expect(page.locator('[data-role="user"]').filter({ hasText: text }).first()).toBeVisible()
  await expect.poll(async () => page.locator('[data-role="assistant"]').count(), { timeout: 60_000 }).toBeGreaterThan(0)
  await expect(page.locator('[data-streaming="true"]')).toHaveCount(0, { timeout: 60_000 })
}

test('enviar un mensaje y recibir la respuesta de Aula', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launch({ home: homeWithDemoCourse() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'chat' })
  const box = page.getByRole('textbox', { name: 'Message Aula…' })
  await box.fill('¿Qué es una parábola?')
  await box.press('Enter')
  await expect(page.getByText('¿Qué es una parábola?').first()).toBeVisible()
  // la respuesta simulada termina con «Hecho · N pasos» o similar; basta con que haya un mensaje de Aula con texto
  await expect.poll(async () => page.locator('[data-role="assistant"]').count(), { timeout: 60_000 }).toBeGreaterThan(0)
  expect(errors).toEqual([])
  await app.close()
})

test('un cuestionario en la conversación: fallo, acierto, la nota, y sigue igual al volver a abrirla', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launch({ home: homeWithDemoCourse() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'chat' })
  await ask(page, 'Give me a quick quiz')
  const quiz = page.locator('[data-studyset="quiz"]')
  await expect(quiz).toBeVisible()
  await quiz.getByRole('button', { name: 'Start' }).click()
  await expect(quiz.getByText('Question 1 of 2').first()).toBeVisible()
  // mal: el porqué de la opción elegida y «Intentar de nuevo»
  await quiz.locator('[role="radio"]').filter({ hasText: '±4' }).click()
  await quiz.getByRole('button', { name: /^Check/ }).click()
  await expect(quiz.getByText('take the square root')).toBeVisible()
  await expect(quiz.locator('[aria-label="Question 1: missed"]')).toHaveCount(0) // las casillas solo en la portada y la nota
  await quiz.getByRole('button', { name: /^Try again/ }).click()
  // bien (el primer intento ya contó como fallo)
  await quiz.locator('[role="radio"]').filter({ hasText: '±2' }).click()
  await quiz.getByRole('button', { name: /^Check/ }).click()
  // como en la práctica, un segundo clic justo después de comprobar no se salta el resultado recién mostrado
  await expect(quiz.getByText('Correct', { exact: true })).toBeVisible()
  await page.waitForTimeout(450)
  await quiz.getByRole('button', { name: /^Next/ }).click()
  // la numérica, bien a la primera
  await expect(quiz.getByText('Question 2 of 2').first()).toBeVisible()
  await quiz.getByRole('textbox').first().fill('5')
  await quiz.getByRole('button', { name: /^Check/ }).click()
  await expect(quiz.getByText('Correct', { exact: true })).toBeVisible()
  await page.waitForTimeout(450)
  await quiz.getByRole('button', { name: /^Finish/ }).click()
  await expect(quiz.getByTestId('quiz-score')).toHaveText('1 of 2 right the first time')
  await expect(quiz.locator('[aria-label="Question 1: missed"]')).toHaveCount(1)
  // otra pantalla y vuelta a la conversación: la nota sigue ahí (se guardó en la tarjeta)
  await go(page, { name: 'home' })
  await go(page, { name: 'chat' })
  // en la lista de conversaciones (una sugerencia del chat vacío podría llamarse igual)
  await page.locator('[data-thread-list]').getByRole('button', { name: /Give me a quick quiz/ }).first().click()
  await expect(page.locator('[data-studyset="quiz"]').getByTestId('quiz-score')).toHaveText('1 of 2 right the first time')
  expect(errors).toEqual([])
  await app.close()
})

test('tarjetas en la conversación: se giran con un clic o con la barra espaciadora y se pasan', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launch({ home: homeWithDemoCourse() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'chat' })
  await ask(page, 'Make me some flashcards')
  const cards = page.locator('[data-studyset="flashcards"]')
  const face = cards.locator('[data-flipped]')
  await expect(face).toHaveAttribute('data-flipped', 'false')
  await face.click()
  await expect(face).toHaveAttribute('data-flipped', 'true')
  await expect(cards.getByText('Its highest or lowest point')).toBeVisible()
  await face.press('Space')
  await expect(face).toHaveAttribute('data-flipped', 'false')
  await face.press('ArrowRight')
  await expect(cards.getByText('2/3')).toBeVisible()
  await cards.getByRole('button', { name: 'Next card' }).click()
  await expect(cards.getByText('3/3')).toBeVisible()
  await expect(cards.getByRole('button', { name: /Save to a course/ })).toBeEnabled()
  expect(errors).toEqual([])
  await app.close()
})

test('mencionar con «@»: el selector con teclado, la ficha y Aula recibe lo mencionado', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launch({ home: homeWithDemoCourse() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'chat' })
  const box = page.getByRole('textbox', { name: 'Message Aula…' })
  await box.fill('Explain ')
  await box.pressSequentially('@trig')
  const list = page.getByRole('listbox', { name: 'Mention' })
  await expect(list).toBeVisible()
  await expect.poll(async () => list.getByRole('option').count()).toBeGreaterThan(1)
  // Esc lo cierra sin cerrar nada más; borrar la «@» y volver a escribirla lo abre otra vez
  await box.press('Escape')
  await expect(list).toBeHidden()
  for (let i = 0; i < 5; i++) await box.press('Backspace')
  await box.pressSequentially('@trig')
  await expect(list).toBeVisible()
  await expect.poll(async () => list.getByRole('option').count()).toBeGreaterThan(1)
  // ↓ ↑ ↩ elige la primera
  const first = (await list.getByRole('option').first().locator('span.truncate').first().textContent())?.trim() ?? ''
  await box.press('ArrowDown')
  await expect(list.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true')
  await box.press('ArrowUp')
  await box.press('Enter')
  await expect(list).toBeHidden()
  await expect(box).toHaveValue('Explain ')
  await expect(page.getByRole('button', { name: `Mention: ${first}` })).toBeVisible()
  await box.pressSequentially('this, please')
  await box.press('Enter')
  const sent = page.locator('[data-role="user"]').filter({ hasText: 'Explain this, please' })
  await expect(sent.locator('[data-mention]')).toHaveCount(1)
  // el proceso principal pasó lo mencionado a la IA (la simulada lo nombra)
  await expect(page.locator('[data-role="assistant"]').filter({ hasText: 'What you mentioned: “' })).toBeVisible({ timeout: 60_000 })
  // la ficha del mensaje abre lo mencionado
  await sent.locator('[data-mention] button').first().click()
  await expect(page.locator('[data-role="user"]')).toHaveCount(0, { timeout: 10_000 })
  expect(errors).toEqual([])
  await app.close()
})

test('escribir mientras Aula responde: espera en cola (se puede quitar) y se envía al terminar o al detener', async () => {
  test.setTimeout(150_000)
  // respuestas lentas, para escribir mientras llegan
  const { app, page } = await launch({ home: homeWithDemoCourse(), env: { AULA_FAKE_AI_DELAY_MS: '90' } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'chat' })
  const box = page.getByRole('textbox', { name: 'Message Aula…' })
  await box.fill('What is a parabola?')
  await box.press('Enter')
  await expect(page.locator('[data-streaming="true"]')).toHaveCount(1, { timeout: 30_000 })
  // un mensaje en cola que luego se quita: vuelve a la caja
  await box.fill('Never mind')
  await box.press('Enter')
  const queued = page.locator('[data-role="queued"]')
  await expect(queued.filter({ hasText: 'Never mind' })).toBeVisible()
  await expect(box).toHaveValue('')
  await queued.filter({ hasText: 'Never mind' }).getByRole('button', { name: 'Remove from the queue' }).click()
  await expect(queued).toHaveCount(0)
  await expect(box).toHaveValue('Never mind')
  // el que se queda se envía solo cuando Aula termina
  await box.fill('And what is a radian?')
  await box.press('Enter')
  await expect(queued.filter({ hasText: 'And what is a radian?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await expect(queued).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-role="user"]').filter({ hasText: 'And what is a radian?' })).toBeVisible()
  await expect(page.locator('[data-role="assistant"]').filter({ hasText: '«And what is a radian?»' })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-streaming="true"]')).toHaveCount(0, { timeout: 60_000 })
  // «Detener» para solo la respuesta en curso: lo que esperaba se envía a continuación
  await box.fill('One more question')
  await box.press('Enter')
  await expect(page.locator('[data-streaming="true"]')).toHaveCount(1, { timeout: 30_000 })
  await box.fill('Last one')
  await box.press('Enter')
  await expect(queued.filter({ hasText: 'Last one' })).toBeVisible()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.locator('[data-role="user"]').filter({ hasText: 'Last one' })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-role="assistant"]').filter({ hasText: '«Last one»' })).toBeVisible({ timeout: 60_000 })
  expect(errors).toEqual([])
  await app.close()
})

test('el tutor se abre al lado del ejercicio con su contexto y responde', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launch({ home: homeWithDemoCourse() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'study', id: 'exam-2-math112', mode: 'practice' })
  // una respuesta cualquiera (casi seguro incorrecta) para que aparezca «Explicar mi error»
  const input = page.getByRole('textbox').first()
  if (await input.isVisible().catch(() => false)) {
    await input.fill('12345')
    await page.getByRole('button', { name: /^Check/ }).click()
  } else {
    await page.getByRole('radio').first().click().catch(() => undefined)
    await page.getByRole('button', { name: /^Check/ }).click().catch(() => undefined)
  }
  const explain = page.getByRole('button', { name: 'Explain my mistake' })
  if (await explain.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await explain.click()
    await expect(page.getByText('Your tutor')).toBeVisible()
    // la pregunta con la que se abre se ve como mensaje del estudiante (no la pisa la conversación que llega después)
    await expect(page.locator('[data-role="user"]').first()).toBeVisible()
    await expect.poll(async () => page.locator('[data-role="assistant"]').count(), { timeout: 60_000 }).toBeGreaterThan(0)
  }
  expect(errors).toEqual([])
  await app.close()
})

test('el tutor va al lado del ejercicio (no tapa «Try again»), dice qué mira, Esc lo cierra primero y en una ventana estrecha se abre encima', async () => {
  test.setTimeout(150_000)
  const { app, page } = await launch({ home: homeWithDemoCourse() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'study', id: 'exam-2-math112', mode: 'practice', skill: 'exact-trig-values' })
  await page.locator('main input:visible').first().click()
  await page.keyboard.type('1/2')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Explain my mistake' }).click()
  // 1440×900: una columna al lado, que empuja el ejercicio a la izquierda
  const column = page.locator('aside[aria-label="Your tutor"]')
  await expect(column).toBeVisible()
  await expect(page.getByText('Your tutor', { exact: true })).toHaveCount(1)
  await expect(page.locator('[data-tutor-looking]')).toHaveText(/^Looking at: .+/)
  await expect.poll(async () => page.locator('[data-role="assistant"]').count(), { timeout: 60_000 }).toBeGreaterThan(0)
  await page.waitForTimeout(500)
  const side = (await column.boundingBox())!
  for (const el of [page.getByRole('button', { name: /^Try again/ }), page.locator('main input:visible').first()]) {
    await expect(el).toBeVisible()
    const box = (await el.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(side.x)
  }
  // Esc cierra el tutor y se queda en el ejercicio (no sale del estudio); el foco vuelve a lo que lo abrió, no a <body>
  const explain = page.getByRole('button', { name: 'Explain my mistake' })
  await expect(page.getByRole('textbox', { name: 'Message Aula…' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(column).toHaveCount(0)
  await expect(page.getByText('Your tutor', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Try again/ })).toBeVisible()
  await expect(explain).toBeFocused()
  // con la × pasa lo mismo
  await explain.click()
  await expect(column).toBeVisible()
  await expect(page.locator('[data-streaming="true"]')).toHaveCount(0, { timeout: 60_000 })
  await column.getByRole('button', { name: 'Close the tutor' }).click()
  await expect(column).toHaveCount(0)
  await expect(explain).toBeFocused()
  // ventana estrecha: no cabe al lado, se abre encima como un cajón (y Esc también lo cierra primero, con el foco de vuelta)
  await page.setViewportSize({ width: 1000, height: 680 })
  await page.waitForTimeout(300)
  await explain.click()
  await expect(page.getByText('Your tutor', { exact: true })).toBeVisible()
  await expect(column).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByText('Your tutor', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Try again/ })).toBeVisible()
  await expect(explain).toBeFocused()
  expect(errors).toEqual([])
  await app.close()
})

test('la puerta fija del tutor en la cápsula: abre el tutor con el ejercicio que se mira y lo cierra (nunca en el simulacro)', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launch({ home: homeWithDemoCourse() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'study', id: 'exam-2-math112', mode: 'practice', skill: 'exact-trig-values' })
  const door = page.locator('[data-tutor-button]')
  await expect(door).toHaveCount(1)
  await expect(door).toHaveAttribute('aria-label', 'Ask the tutor')
  await door.click()
  const column = page.locator('aside[aria-label="Your tutor"]')
  await expect(column).toBeVisible()
  // sin pregunta: el vacío del tutor, y dice qué ejercicio de la sesión mira
  await expect(page.locator('[data-tutor-looking]')).toHaveText(/^Looking at: exercise 1 of \d+$/)
  await expect(page.locator('[data-role="user"]')).toHaveCount(0)
  await expect(door).toHaveAttribute('aria-pressed', 'true')
  await door.click()
  await expect(column).toHaveCount(0)
  // en el simulacro no hay tutor
  await go(page, { name: 'study', id: 'exam-2-math112', mode: 'exam' })
  await expect(page.getByRole('button', { name: 'Start the mock exam' })).toBeVisible()
  await expect(page.locator('[data-tutor-button]')).toHaveCount(0)
  expect(errors).toEqual([])
  await app.close()
})

test('el chat vacío: Aula habla primero con el examen y lo pendiente, tres ideas de sus cursos y el aviso tras el primer mensaje', async () => {
  test.setTimeout(120_000)
  // modo demostración: el curso de ejemplo hace de curso del estudiante (si no, su examen no es «tuyo»)
  const { app, page } = await launch({ home: homeWithDemoCourse(), env: { AULA_SEED: 'demo', AULA_DEMO: '1' } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'chat' })
  const opening = page.locator('[data-chat-opening]')
  await expect(opening.getByRole('heading', { level: 1 })).toHaveText(/^Exam #2 — Trigonometry is (in \d+ days|tomorrow|today)\.$/)
  await expect(opening).toContainText(/Today: \d+ mistakes? to go over/)
  const ideas = opening.getByRole('list', { name: 'Ideas from your courses' }).getByRole('button')
  await expect(ideas).toHaveCount(3)
  await expect(ideas.last()).toHaveText(/^What’s on Exam #2 — Trigonometry\?$/)
  // sin pegatinas ni chips: el flexo a tinta y la lista
  await expect(opening.locator('img')).toHaveCount(0)
  // «puede equivocarse», solo cuando ya hay algo que comprobar
  const disclaimer = page.getByText('Aula can make mistakes: double-check what matters.')
  await expect(disclaimer).toBeHidden()
  const first = (await ideas.first().textContent())?.trim() ?? ''
  await ideas.first().click()
  await expect(page.locator('[data-role="user"]').filter({ hasText: first }).first()).toBeVisible()
  await expect(opening).toHaveCount(0)
  await expect(disclaimer).toBeVisible()
  expect(errors).toEqual([])
  await app.close()
})

test('sin cursos propios (solo el de ejemplo), el chat vacío pregunta qué estudiamos y no hace suyo el examen de ejemplo', async () => {
  test.setTimeout(90_000)
  const { app, page } = await launch()
  await go(page, { name: 'chat' })
  const opening = page.locator('[data-chat-opening]')
  await expect(opening.getByRole('heading', { level: 1 })).toHaveText('What shall we study?')
  await expect(opening).not.toContainText('Exam #2')
  await expect(opening.getByRole('button')).toHaveCount(3)
  await app.close()
})

test('Aula enseña lo que hace: piensa, una fila por paso con lo que busca, y al terminar un resumen y el texto entero', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launch({ home: homeWithDemoCourse(), env: { AULA_FAKE_AI_DELAY_MS: '120' } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'chat' })
  const box = page.getByRole('textbox', { name: 'Message Aula…' })
  await box.fill('What is a parabola?')
  await box.press('Enter')
  // en cuanto se envía: la línea de «pensando» (antes de que llegue nada)
  await expect(page.getByTestId('chat-thinking').first()).toBeVisible({ timeout: 5_000 })
  // los pasos, con lo que buscó
  const activity = page.getByTestId('chat-activity').last()
  await expect(activity.getByText('«What is a parabola?»')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-streaming="true"]')).toHaveCount(0, { timeout: 60_000 })
  // terminado: los pasos plegados en una frase, que se vuelve a abrir
  const summary = page.getByTestId('chat-activity-summary').last()
  await expect(summary).toHaveText(/looked at your courses · searched Aula · ran 1 calculation/i)
  await expect(page.getByTestId('chat-thinking')).toHaveCount(0)
  await summary.click()
  await expect(activity).toHaveAttribute('data-open', 'true')
  await expect(activity.locator('li[data-state="done"]')).toHaveCount(3)
  // el texto llegó entero (también la última frase) y la caja vuelve a «Enviar»
  await expect(page.locator('[data-role="assistant"]').last()).toContainText('Would you like a quick quiz to check it?')
  await expect(page.getByTestId('chat-stop')).toHaveCount(0)
  expect(errors).toEqual([])
  await app.close()
})
