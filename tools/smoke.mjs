import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/usr/bin/chromium' })
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } })
const errs = []
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
p.on('pageerror', e => errs.push('pageerror: ' + e.message))
await p.goto('http://localhost:5174/', { waitUntil: 'networkidle' })
await p.waitForTimeout(800)

const step = async (name, fn) => {
  try { await fn(); console.log('✓', name) } catch (e) { console.log('✗', name, '—', e.message) }
}

await step('harfe tıkla → müfettiş açılır', async () => {
  await p.locator('.hit').first().click()
  await p.waitForSelector('.insp', { timeout: 2000 })
})
await p.screenshot({ path: 'build/app-inspector.png' })

await step('varyant sabitle', async () => {
  const before = await p.locator('.sheet').boundingBox()
  await p.locator('.insp .v').last().click()
  await p.waitForTimeout(400)
  const pinned = await p.locator('.hit.pinned').count()
  if (!pinned) throw new Error('sabitlenen harf işaretlenmedi')
})
await p.screenshot({ path: 'build/app-pinned.png' })

await step('sabitlemeyi temizle', async () => {
  await p.getByText(/sabitlemeyi temizle/).click()
  await p.waitForTimeout(300)
  if (await p.locator('.hit.pinned').count()) throw new Error('sabitleme kalktı sayılmadı')
})

for (const preset of ['stroke', 'line', 'bold', 'fillet', 'chamfer', 'stroke+fill']) {
  await step(`stil: ${preset}`, async () => {
    await p.getByRole('button', { name: preset, exact: true }).click()
    await p.waitForTimeout(250)
    const paths = await p.locator('.art svg path').count()
    if (!paths) throw new Error('çizim yok')
  })
  await p.screenshot({ path: `build/style-${preset.replace('+','-')}.png`, clip: { x: 340, y: 150, width: 1160, height: 760 } })
}

await step('hizalamayı kapat → satırlar farklı genişlikte', async () => {
  await p.getByRole('button', { name: 'normal', exact: true }).click()
  await p.getByText('satırları aynı genişliğe getir').click()
  await p.waitForTimeout(300)
})
await p.screenshot({ path: 'build/app-nojustify.png' })

await step('metni değiştir', async () => {
  await p.locator('textarea').fill('yunus emre\nbir dem gelir')
  await p.waitForTimeout(400)
  const t = await p.locator('.toolbar .mono').first().innerText()
  if (!/birim/.test(t)) throw new Error('ölçü güncellenmedi')
})

await step('desteklenmeyen karakter uyarısı', async () => {
  await p.locator('textarea').fill('test xqw')
  await p.waitForTimeout(400)
  await p.waitForSelector('.warn', { timeout: 1500 })
})

console.log(errs.length ? '\nKONSOL HATALARI:\n' + errs.join('\n') : '\nkonsol temiz')
await b.close()
