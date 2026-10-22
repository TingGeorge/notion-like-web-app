/** Resizing and cropping images (DATA-19): the width is written as `<img width>`, a crop is a new attachment. */
import type { Page } from '@playwright/test'
import { expect, modKey, test } from './fixtures'
import { assetPaths, bodyOf, createPage, editor, expectUploadedImages, readRepoFile, setupDevice, syncAndWaitForCommit } from './helpers'

/** A 600×300 PNG: red on the left half, blue on the right. */
async function twoColourPng(page: Page): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 600
    c.height = 300
    const g = c.getContext('2d')!
    g.fillStyle = '#ff0000'
    g.fillRect(0, 0, 300, 300)
    g.fillStyle = '#0000ff'
    g.fillRect(300, 0, 300, 300)
    return c.toDataURL('image/png').split(',')[1]
  })
  return { name: 'halves.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') }
}

async function insertImage(page: Page) {
  const file = await twoColourPng(page)
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
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 })
  await page.mouse.move(x + dx, y + dy, { steps: 4 })
  await page.mouse.up()
}

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
  await expect(dialog.getByText('300 × 300')).toBeVisible()
  await dialog.getByRole('button', { name: '完成' }).click()
  await expect(dialog).toHaveCount(0)
  // Same scale on the page: half the picture, half the width.
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(200)
  await expect.poll(() => editor(page).locator('figure.image-block img').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(300)
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
  expect(cropped.width).toBe(200)
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
