import asyncio
import shutil
import tempfile
from pathlib import Path

DEMO = Path(__file__).resolve().parent / "index.html"
SCREENSHOTS = Path(tempfile.mkdtemp(prefix="fitpp-demo-check-"))
from playwright.async_api import async_playwright,expect
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=shutil.which('chromium') or p.chromium.executable_path,args=['--no-sandbox'])
  c=await b.new_context(viewport={'width':390,'height':844},offline=True)
  page=await c.new_page();errors=[];requests=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('request',lambda r:requests.append(r.url))
  await page.route('http://127.0.0.1:8001/', lambda route: route.fulfill(path=str(DEMO), content_type='text/html'))
  await page.goto('http://127.0.0.1:8001/')
  await page.wait_for_function('window.Alpine && Alpine.$data(document.body).clients.length === 6')
  await expect(page.locator('.client-row')).to_have_count(3)
  assert await page.evaluate('typeof firebase')=='undefined'
  row=page.locator('.client-row').first
  await row.get_by_role('button',name='✓ Был (-1)',exact=True).click()
  assert await page.evaluate('Alpine.$data(document.body).clients[0].subscriptions[0].left')==4
  await row.get_by_role('button',name='✓ Был (-1)',exact=True).click()
  assert await page.evaluate('Alpine.$data(document.body).clients[0].subscriptions[0].left')==3
  await row.get_by_role('button',name='₽ Разово (500)',exact=True).click()
  assert await page.evaluate("Alpine.$data(document.body).finances['2026-10']")==25900
  await row.get_by_role('button',name='Сгорело',exact=True).click()
  assert await page.evaluate("Alpine.$data(document.body).finances['2026-10']")==25400
  await row.get_by_role('button',name='Уваж.',exact=True).click()
  await page.get_by_role('button',name='Сбросить',exact=True).click()
  await page.screenshot(path=str(SCREENSHOTS / 'journal.png'))
  await page.get_by_role('button',name='Анна Демонстрационная').click()
  await expect(page.locator('.client-detail h2')).to_have_text('Анна Демонстрационная')
  await page.screenshot(path=str(SCREENSHOTS / 'client.png'))
  await page.get_by_role('tab',name='Оплаты',exact=True).click()
  await expect(page.locator('.client-detail').get_by_text('3800 ₽',exact=True)).to_be_visible()
  await page.get_by_role('tab',name='Абонементы',exact=True).click()
  await expect(page.locator('.client-detail').get_by_text('Остаток: 3',exact=True)).to_be_visible()
  await page.get_by_role('button',name='Редактировать клиента').click()
  modal=page.locator('[x-show="showClientModal"]')
  await modal.locator('input[type=text]').first.fill('Изменённый демоклиент')
  await modal.get_by_role('button',name='Сохранить',exact=True).click()
  await expect(page.locator('.client-detail h2')).to_have_text('Изменённый демоклиент')
  await page.get_by_role('button',name='Назад',exact=True).click()
  await page.get_by_role('button',name='Следующий день',exact=True).click()
  assert await page.evaluate('Alpine.$data(document.body).selectedDate')=='2026-10-18'
  await page.get_by_role('button',name='Предыдущий день',exact=True).click()
  for name,price,count in [('мкр. Заря',700,2),('Поле чудес',600,2),('Онлайн',500,3)]:
   await page.locator('.location-switch').get_by_role('button',name=name).click()
   await expect(page.locator('.client-row')).to_have_count(count)
   await expect(page.locator('.client-row').first.get_by_role('button',name=f'₽ Разово ({price})',exact=True)).to_be_visible()
  await page.locator('.bottom-nav').get_by_role('button',name='Клиенты',exact=True).click()
  await expect(page.locator('.client-tile')).to_have_count(6)
  await page.locator('.client-tile').nth(2).get_by_role('button',name='+ Продать',exact=True).click()
  await page.locator('[x-show="showSubModal"]').get_by_role('button',name='Оформить',exact=True).click()
  assert await page.evaluate('Alpine.$data(document.body).clients[2].subscriptions[0].left')==8
  await page.locator('.bottom-nav').get_by_role('button',name='Финансы',exact=True).click()
  await expect(page.get_by_text('29800 ₽',exact=True)).to_be_visible()
  await page.screenshot(path=str(SCREENSHOTS / 'finances.png'))
  await page.get_by_role('button',name='Сбросить',exact=True).click()
  for width in [320,390,768,1280]:
   await page.set_viewport_size({'width':width,'height':844})
   for tab in ['Журнал','Клиенты','Финансы']:
    nav = page.locator('.bottom-nav' if width < 768 else 'header nav')
    await nav.get_by_role('button',name=tab,exact=True).click()
    await expect(page.locator('header nav')).to_be_hidden() if width < 768 else await expect(page.locator('header nav')).to_be_visible()
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'),(width,tab)
    if tab == 'Клиенты':
     await expect(page.locator('.client-tile').first).to_be_visible()
     metrics = await page.locator('.client-tile').first.evaluate('''el => ({height:el.getBoundingClientRect().height,buttons:[...el.querySelectorAll('button')].map(b=>({h:b.getBoundingClientRect().height,font:parseFloat(getComputedStyle(b).fontSize)})),phone:el.querySelector('.client-phone').textContent,sub:el.querySelector('.client-subscription').textContent})''')
     assert all(b['h'] >= 44 and b['font'] >= 13 for b in metrics['buttons']),metrics
     assert 'Остаток:' in metrics['sub'] and 'До:' in metrics['sub'],metrics
     print(f'Client card at {width}px: {metrics["height"]:.0f}px; buttons ≥44px, text ≥13px')
  await page.reload()
  await page.wait_for_function('window.Alpine && Alpine.$data(document.body).clients.length === 6')
  assert await page.evaluate("Alpine.$data(document.body).finances['2026-10']")==25400
  assert not errors,errors
  assert not [url for url in requests if url != 'http://127.0.0.1:8001/'],requests
  await c.set_offline(False)
  directive = await asyncio.wait_for(page.evaluate("() => new Promise(resolve => { document.addEventListener('securitypolicyviolation', e => resolve(e.effectiveDirective), {once:true}); fetch('https://example.com').catch(() => {}); })"), timeout=5)
  assert directive == 'connect-src', directive
  print('PASS: standalone document runs offline; 0 external requests, 0 JS errors; Firebase absent; CSP rejects fetch; attendance/payment reversal, detail tabs/edit, subscription sale, finances, dates, locations, reset/reload and layouts at 320/390/768/1280px passed.')
  await b.close()
asyncio.run(main())
