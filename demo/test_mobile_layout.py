import asyncio
from pathlib import Path
import shutil
import tempfile
DEMO = Path(__file__).resolve().parent / "fitpp-demo-v4.html"
SCREENSHOTS = Path(tempfile.mkdtemp(prefix="fitpp-v4-layout-"))
from playwright.async_api import async_playwright,expect
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=shutil.which('chromium') or p.chromium.executable_path,args=['--no-sandbox'])
  page=await b.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
  await page.route('http://127.0.0.1:8004/',lambda r:r.fulfill(path=str(DEMO),content_type='text/html'))
  await page.goto('http://127.0.0.1:8004/')
  for tab,label,selector in [('Журнал','journal','.journal-panel'),('Клиенты','clients','.client-grid'),('Финансы','finances','.finance-toolbar')]:
   await page.locator('.bottom-nav').get_by_role('button',name=tab,exact=True).click()
   await expect(page.locator(selector)).to_be_visible()
   assert not await page.get_by_text('База клиентов',exact=True).count()
   assert not await page.get_by_role('button',name='Сбросить базу данных',exact=True).count()
   assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
   if label=='clients':
    gap=await page.locator('.client-tile').first.evaluate('e=>e.getBoundingClientRect().top-document.querySelector("header").getBoundingClientRect().bottom')
    assert gap==12,gap
   await page.screenshot(path=str(SCREENSHOTS / f'{label}-390.png'))
  for width in [320,390]:
   await page.set_viewport_size({'width':width,'height':844})
   for month in range(1,13):
    await page.evaluate('(m)=>Alpine.$data(document.body).currentMonth=`2026-${String(m).padStart(2,"0")}`',month)
    await expect(page.locator('.month-switcher span')).to_have_text(await page.evaluate('Alpine.$data(document.body).formatMonthName(Alpine.$data(document.body).currentMonth)'))
    assert await page.locator('.month-switcher span').evaluate('e=>e.scrollWidth<=e.clientWidth'),(width,month)
    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  await page.get_by_role('button',name='Следующий месяц',exact=True).click()
  await page.wait_for_function('Alpine.$data(document.body).currentMonth === "2027-01"')
  await page.get_by_role('button',name='Предыдущий месяц',exact=True).click()
  await page.wait_for_function('Alpine.$data(document.body).currentMonth === "2026-12"')
  await page.locator('.bottom-nav').get_by_role('button',name='Добавить клиента',exact=True).click()
  modal=page.locator('[x-show="showClientModal"]');await expect(modal).to_be_visible()
  await modal.locator('input[type=text]').first.fill('Новый демонстрационный клиент')
  await modal.get_by_role('button',name='Сохранить',exact=True).click()
  await page.locator('.bottom-nav').get_by_role('button',name='Клиенты',exact=True).click()
  await expect(page.locator('.client-tile')).to_have_count(7)
  await page.locator('.client-tile').last.locator('.client-name').click()
  await expect(page.locator('.client-detail')).to_be_visible()
  print('PASS v4: all 3 mobile screens; clients start 12px below header; plus adds client; detail history opens; no reset action; all 12 month names fit one line at 320/390px; month buttons cross year correctly; no horizontal overflow.')
  await b.close()
asyncio.run(main())
