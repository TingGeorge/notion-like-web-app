/** iPhone layout at 393×852 (M01–M22): home, 所有頁面, page menu sheet, insert-block sheet, settings. */
import { BASE_URL, attachFake, expect, makeFake, test } from './fixtures'
import { bodyOf, editor, readRepoFile, setupDevice, syncAndWaitForCommit, titleInput } from './helpers'

const FILES = {
  '工作.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2W01\n---\n工作首頁\n',
  '工作/會議記錄.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2W02\n---\n討論事項\n',
  '讀書筆記.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2W03\n---\n好書\n',
}

test.describe('phone', () => {
  test.beforeEach(async ({ page }) => {
    expect(page.viewportSize()).toEqual({ width: 393, height: 852 })
  })

  test('home: greeting, 最近造訪 cards after visiting pages, favourites and pages', async ({ browser }) => {
    const fake = await makeFake({ files: FILES })
    const context = await browser.newContext({ baseURL: BASE_URL, locale: 'zh-TW', timezoneId: 'Asia/Taipei', serviceWorkers: 'block', viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true })
    await attachFake(context, fake)
    const page = await context.newPage()
    await setupDevice(page)

    await expect(page.locator('.tabbar')).toBeVisible()
    await expect(page.locator('.sidebar')).toHaveCount(0)
    await expect(page.locator('.home-greeting')).toHaveText(/^(早安|午安|晚安)，Ting$/)
    // No pages visited yet: no 最近造訪.
    await expect(page.getByRole('heading', { name: '最近造訪' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '頁面', exact: true })).toBeVisible()

    // Visit two pages, come back.
    await page.locator('.home-row', { hasText: '讀書筆記' }).tap()
    await expect(titleInput(page)).toHaveValue('讀書筆記')
    await page.getByRole('button', { name: '返回' }).tap()
    await page.locator('.home-row', { hasText: '工作' }).tap()
    await expect(titleInput(page)).toHaveValue('工作')
    await page.getByRole('button', { name: '返回' }).tap()
    await expect(page.getByRole('heading', { name: '最近造訪' })).toBeVisible()
    await expect(page.locator('.home-card .home-card-title')).toHaveText(['工作', '讀書筆記'])
    // A card opens the page.
    await page.locator('.home-card', { hasText: '讀書筆記' }).tap()
    await expect(editor(page)).toContainText('好書')
    await context.close()
  })

  test('the tab bar leaves the search screen for 首頁, 所有頁面 and 新增', async ({ browser }) => {
    const fake = await makeFake({ files: FILES })
    const context = await browser.newContext({ baseURL: BASE_URL, locale: 'zh-TW', serviceWorkers: 'block', viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true })
    await attachFake(context, fake)
    const page = await context.newPage()
    await setupDevice(page)
    const tabbar = page.locator('.tabbar')
    const search = page.locator('.search.is-mobile')

    await tabbar.getByRole('button', { name: '搜尋' }).tap()
    await expect(search).toBeVisible()
    await tabbar.getByRole('button', { name: '首頁' }).tap()
    await expect(search).toHaveCount(0)
    await expect(page.locator('.home-greeting')).toBeVisible()
    await expect(tabbar.getByRole('button', { name: '首頁' })).toHaveAttribute('aria-current', 'page')

    await tabbar.getByRole('button', { name: '搜尋' }).tap()
    await expect(search).toBeVisible()
    await tabbar.getByRole('button', { name: '所有頁面' }).tap()
    await expect(search).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '所有頁面' })).toBeVisible()

    await tabbar.getByRole('button', { name: '搜尋' }).tap()
    await expect(search).toBeVisible()
    await tabbar.getByRole('button', { name: '新增' }).tap()
    await expect(search).toHaveCount(0)
    await expect(titleInput(page)).toBeVisible()
    await context.close()
  })

  test('所有頁面 shows the same tree as the sidebar; tapping opens a page', async ({ browser }) => {
    const fake = await makeFake({ files: FILES })
    const context = await browser.newContext({ baseURL: BASE_URL, locale: 'zh-TW', serviceWorkers: 'block', viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true })
    await attachFake(context, fake)
    const page = await context.newPage()
    await setupDevice(page)
    await page.locator('.tabbar').getByRole('button', { name: '所有頁面' }).tap()
    await expect(page.getByRole('heading', { name: '所有頁面' })).toBeVisible()
    const titles = page.locator('.page-tree .tree-title')
    await expect(titles).toHaveText(['工作', '讀書筆記'])
    await page.locator('.tree-row', { hasText: '工作' }).getByRole('button', { name: '展開' }).tap()
    await expect(titles).toHaveText(['工作', '會議記錄', '讀書筆記'])
    await page.locator('.tree-link', { hasText: '會議記錄' }).tap()
    await expect(titleInput(page)).toHaveValue('會議記錄')
    await expect(editor(page)).toContainText('討論事項')
    // The page's parent is shown in the back button.
    await expect(page.locator('.m-page-parent')).toHaveText('工作')
    await context.close()
  })

  test('page menu sheet: favourite, duplicate and delete from the phone', async ({ page, fake }) => {
    await setupDevice(page)
    await page.locator('.home-row', { hasText: '歡迎使用' }).tap()
    await page.getByRole('button', { name: '頁面選單' }).tap()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toContainText('歡迎使用')
    for (const item of ['加入我的最愛', '複製連結', '複製頁面', '移動到…', '頁面歷史', '匯出 Markdown', '列印／存成 PDF', '刪除頁面']) {
      await expect(sheet.getByRole('button', { name: item })).toBeVisible()
    }
    await sheet.getByRole('button', { name: '加入我的最愛' }).tap()
    await expect(page.getByText('已加入我的最愛')).toBeVisible()
    await syncAndWaitForCommit(page, fake)
    expect(await readRepoFile(fake, '.notes/settings.json')).toContain('"favorites"')
    // Delete from the sheet goes to the trash and leaves the page.
    await page.getByRole('button', { name: '頁面選單' }).tap()
    await page.getByRole('dialog').getByRole('button', { name: '刪除頁面' }).tap()
    await expect(page.getByText('已刪除「歡迎使用」')).toBeVisible()
    await expect(page.locator('.home-greeting')).toBeVisible()
  })

  test('the keyboard toolbar + opens the insert-block sheet (M06)', async ({ page, fake }) => {
    await setupDevice(page)
    await page.locator('.tabbar').getByRole('button', { name: '新增' }).tap()
    await expect(titleInput(page)).toBeFocused()
    await titleInput(page).fill('手機頁')
    await titleInput(page).press('Enter')
    await expect(editor(page)).toBeFocused()
    // The toolbar sits above the keyboard while the editor has focus.
    const bar = page.getByRole('toolbar', { name: '編輯工具列' })
    await expect(bar).toBeVisible()
    await bar.getByRole('button', { name: '插入區塊' }).tap()
    const sheet = page.getByRole('dialog', { name: '插入區塊' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('textbox', { name: '搜尋區塊…' }).fill('標題 1')
    await sheet.getByRole('button', { name: '標題 1' }).tap()
    await expect(sheet).toHaveCount(0)
    await page.keyboard.type('手機上的標題')
    await page.keyboard.press('Enter')
    await bar.getByRole('button', { name: '待辦清單' }).tap()
    await page.keyboard.type('買牛奶')
    await page.waitForTimeout(500)
    await syncAndWaitForCommit(page, fake)
    expect(bodyOf(await readRepoFile(fake, '手機頁.md'))).toBe('# 手機上的標題\n\n- [ ] 買牛奶\n')
  })

  test('settings: sections, auto-sync switch, theme and 立即同步 on the phone', async ({ page, fake }) => {
    await setupDevice(page)
    await page.locator('.home-ws').tap()
    const settings = page.getByRole('dialog', { name: '設定' })
    await expect(settings).toBeVisible()
    await expect(settings.getByText('儲存位置')).toBeVisible()
    await expect(settings.getByText('GitHub token')).toBeVisible()
    await expect(settings.getByText('連結新裝置')).toBeVisible()
    await expect(settings.getByText('Windows')).toHaveCount(0)
    const auto = settings.getByRole('switch', { name: '自動同步' })
    await expect(auto).toHaveAttribute('aria-checked', 'true')
    await auto.tap()
    await expect(auto).toHaveAttribute('aria-checked', 'false')
    await auto.tap()
    // 外觀 opens its choices, the current one ticked; choosing one applies it and closes the sheet.
    const themeRow = settings.getByRole('button', { name: /外觀/ })
    await expect(themeRow).toContainText('跟隨系統')
    await themeRow.tap()
    const themeSheet = page.getByRole('dialog', { name: '外觀' })
    await expect(themeSheet.getByRole('radio')).toHaveText(['跟隨系統', '淺色', '深色'])
    await expect(themeSheet.getByRole('radio', { name: '跟隨系統' })).toHaveAttribute('aria-checked', 'true')
    await themeSheet.getByRole('radio', { name: '深色' }).tap()
    await expect(themeSheet).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(themeRow).toContainText('深色')
    // 語言 lists both languages; keeping the current one changes nothing.
    await settings.getByRole('button', { name: /語言/ }).tap()
    const languageSheet = page.getByRole('dialog', { name: '語言' })
    await expect(languageSheet.getByRole('radio')).toHaveText(['繁體中文', 'English'])
    await expect(languageSheet.getByRole('radio', { name: '繁體中文' })).toHaveAttribute('aria-checked', 'true')
    await languageSheet.getByRole('radio', { name: '繁體中文' }).tap()
    await expect(languageSheet).toHaveCount(0)
    await expect(settings).toBeVisible()
    await settings.getByRole('button', { name: '立即同步' }).tap()
    await expect.poll(() => fake.count('GET', /\/git\/ref\/heads\//)).toBeGreaterThan(0)
    await settings.getByRole('button', { name: '完成' }).tap()
    await expect(settings).toHaveCount(0)
    expect(await editor(page).count()).toBe(0)
  })
})
