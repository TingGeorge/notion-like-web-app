/** Resizing and cropping images (DATA-19): the width is written as `<img width>`, a crop is a new attachment. */
import type { Page } from '@playwright/test'
import { expect, modKey, test } from './fixtures'
import { assetPaths, bodyOf, createPage, editor, expectUploadedImages, readRepoFile, setupDevice, syncAndWaitForCommit } from './helpers'

/** A `width`×`width/2` PNG: red on the left half, blue on the right. */
async function twoColourPng(page: Page, width = 600): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const b64 = await page.evaluate((w) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = w / 2
    const g = c.getContext('2d')!
    g.fillStyle = '#ff0000'
    g.fillRect(0, 0, w / 2, w / 2)
    g.fillStyle = '#0000ff'
    g.fillRect(w / 2, 0, w / 2, w / 2)
    return c.toDataURL('image/png').split(',')[1]
  }, width)
  return { name: 'halves.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') }
}

async function insertImage(page: Page, width = 600) {
  const file = await twoColourPng(page, width)
  const chooser = page.waitForEvent('filechooser')
  await page.keyboard.type('/圖片')
  await expect(page.getByRole('listbox', { name: '插入區塊' })).toBeVisible()
  await page.keyboard.press('Enter')
  await (await chooser).setFiles(file)
  await expectUploadedImages(page, 1)
}

/** Drag from the centre of `selector` by `dx`, `dy`. */
async function dragBy(page: Page, selector: string, dx: number, dy = 0) {
  const box = (await page.locator(selector).boundingBox())!
  // Whole pixels, as the browser reports them: the drag then moves by exactly round(dx).
  const x = Math.round(box.x + box.width / 2)
  const y = Math.round(box.y + box.height / 2)
  const [tx, ty] = [x + Math.round(dx), y + Math.round(dy)]
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(Math.round((x + tx) / 2), Math.round((y + ty) / 2), { steps: 4 })
  await page.mouse.move(tx, ty, { steps: 4 })
  await page.mouse.up()
}

/** Mouse positions are whole pixels, so a drag lands within a pixel or two of the aim. */
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected), `${actual} ≈ ${expected}`).toBeLessThanOrEqual(3)

const imgTags = (body: string) => [...body.matchAll(/<img src="([^"]+)" alt="" width="(\d+)">/g)].map((m) => ({ src: m[1], width: Number(m[2]) }))

test('an image is resized by dragging its side, and cropped into a new attachment (DATA-19)', async ({ page, fake }) => {
  await setupDevice(page)
  await createPage(page, '圖片縮放', '')
  await insertImage(page)
  const frame = editor(page).locator('figure.image-block .image-frame')
  await expect.poll(async () => (await frame.boundingBox())?.width).toBe(600)

  // Resize: drag the right side 200 px to the left.
  await frame.hover()
  await dragBy(page, 'figure.image-block .image-resize.is-right', -200)
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(400)
  await syncAndWaitForCommit(page, fake)
  let body = bodyOf(await readRepoFile(fake, '圖片縮放.md'))
  const [original] = imgTags(body)
  expect(original.width).toBe(400)
  expect(decodeURIComponent(original.src).replace(/^\//, '')).toBe(assetPaths(fake)[0])

  // Crop: keep the left (red) half.
  await frame.hover()
  await page.getByRole('button', { name: '裁切圖片' }).click()
  const dialog = page.getByRole('dialog', { name: '裁切圖片' })
  await expect(dialog.getByText('600 × 300')).toBeVisible()
  const shown = (await dialog.locator('.gn-crop-canvas img').boundingBox())!
  await dragBy(page, '.gn-crop-handle.is-e', -shown.width / 2)
  await expect(dialog.locator('.gn-crop-size')).toHaveText(/^\d+ × 300$/)
  const keptWidth = Number(/^(\d+)/.exec(await dialog.locator('.gn-crop-size').innerText())![1])
  near(keptWidth, 300)
  await dialog.getByRole('button', { name: '完成' }).click()
  await expect(dialog).toHaveCount(0)
  // Same scale on the page: half the picture, half the width.
  await expect.poll(() => editor(page).locator('figure.image-block img').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(keptWidth)
  const scaled = Math.round((400 * keptWidth) / 600)
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(scaled)
  const colour = await editor(page)
    .locator('figure.image-block img')
    .evaluate((img) => {
      const c = document.createElement('canvas')
      c.width = c.height = 1
      const g = c.getContext('2d')!
      g.drawImage(img as HTMLImageElement, 290, 150, 1, 1, 0, 0, 1, 1)
      return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3))
    })
  expect(colour[0]).toBeGreaterThan(200)
  expect(colour[2]).toBeLessThan(60)

  await syncAndWaitForCommit(page, fake)
  body = bodyOf(await readRepoFile(fake, '圖片縮放.md'))
  const [cropped] = imgTags(body)
  expect(cropped.width).toBe(scaled)
  expect(cropped.src).not.toBe(original.src)
  // The original stays in the repo (DATA-20).
  expect(assetPaths(fake)).toHaveLength(2)

  // ⌘Z brings the original back.
  await page.keyboard.press(`${await modKey(page)}+z`)
  await expect.poll(() => editor(page).locator('figure.image-block img').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(600)
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(400)
})

test('dragging an image back to its own size removes the width', async ({ page, fake }) => {
  await setupDevice(page)
  await createPage(page, '圖片寬度', '')
  await insertImage(page)
  const frame = editor(page).locator('figure.image-block .image-frame')
  await frame.hover()
  await dragBy(page, 'figure.image-block .image-resize.is-left', 300)
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(300)
  await syncAndWaitForCommit(page, fake)
  expect(bodyOf(await readRepoFile(fake, '圖片寬度.md'))).toMatch(/^<img src="[^"]+" alt="" width="300">\n$/)
  await frame.hover()
  await dragBy(page, 'figure.image-block .image-resize.is-right', 300)
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(600)
  await syncAndWaitForCommit(page, fake)
  expect(bodyOf(await readRepoFile(fake, '圖片寬度.md'))).toMatch(/^!\[\]\([^)]+\)\n$/)
})

test('a tap on a handle changes nothing; the keyboard resizes and crops too', async ({ page, fake }) => {
  await setupDevice(page)
  await createPage(page, '鍵盤圖片', '')
  await insertImage(page)
  const frame = editor(page).locator('figure.image-block .image-frame')
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(600)
  // A tap (no movement) on a side.
  await frame.hover()
  const handle = editor(page).locator('figure.image-block .image-resize.is-right')
  await handle.click()
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(600)

  // ← / Shift+← on a focused handle.
  await handle.focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(580)
  await page.keyboard.press('Shift+ArrowLeft')
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(530)
  await expect(handle).toHaveAttribute('aria-valuenow', '530')
  await syncAndWaitForCommit(page, fake)
  expect(imgTags(bodyOf(await readRepoFile(fake, '鍵盤圖片.md')))[0].width).toBe(530)

  // Crop with the keyboard: Shift+Alt+← takes 10% of the long edge off the right each time.
  await frame.hover()
  await page.getByRole('button', { name: '裁切圖片' }).click()
  const dialog = page.getByRole('dialog', { name: '裁切圖片' })
  await expect(dialog.locator('.gn-crop-size')).toHaveText('600 × 300')
  await dialog.getByRole('group', { name: /裁切範圍/ }).focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+Alt+ArrowLeft')
  await expect(dialog.locator('.gn-crop-size')).toHaveText('300 × 300')
  // Arrows alone move the frame (it stays inside the picture).
  await page.keyboard.press('Alt+ArrowRight')
  await expect(dialog.locator('.gn-crop-size')).toHaveText('300 × 300')
  await dialog.getByRole('button', { name: '完成' }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => editor(page).locator('figure.image-block img').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(300)
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(265)
})

test('cropping a picture wider than the page keeps the size it shows at', async ({ page }) => {
  await setupDevice(page)
  await createPage(page, '大圖', '')
  await insertImage(page, 1400)
  const frame = editor(page).locator('figure.image-block .image-frame')
  const shown = Math.round((await frame.boundingBox())!.width)
  expect(shown).toBeLessThan(1400)
  await frame.hover()
  await page.getByRole('button', { name: '裁切圖片' }).click()
  const dialog = page.getByRole('dialog', { name: '裁切圖片' })
  await dialog.getByRole('group', { name: /裁切範圍/ }).focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+Alt+ArrowLeft')
  await expect(dialog.locator('.gn-crop-size')).toHaveText('700 × 700')
  await dialog.getByRole('button', { name: '完成' }).click()
  await expect(dialog).toHaveCount(0)
  // Half the picture, half the width it showed at.
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(Math.round(shown / 2))
})
