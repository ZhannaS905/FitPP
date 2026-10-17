"""Offline browser integration with fake Firebase and real local Alpine/Tailwind."""
import argparse
import asyncio
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]

async def main(vendors):
    output = Path(tempfile.mkdtemp(prefix='fitpp-safe-browser-'))
    (output / 'input.css').write_text('@tailwind base;\n@tailwind components;\n@tailwind utilities;\n')
    subprocess.run([str(vendors / 'node_modules/.bin/tailwindcss'), '-i', str(output/'input.css'), '-o', str(output/'tailwind.css'), '--content', str(ROOT/'index.html'), '--minify'], check=True, capture_output=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=shutil.which('chromium') or p.chromium.executable_path, args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True)
        errors, unexpected = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        async def route(request):
            url = request.request.url
            if url.startswith('http://fitpp.test/'):
                filename = url.split('http://fitpp.test/')[1] or 'index.html'
                if filename not in ['index.html','styles.css','persistence.js','manifest.json','icon-192.png','favicon.ico']:
                    unexpected.append(url); await request.abort(); return
                path = ROOT / filename
                if not path.exists(): await request.fulfill(status=404,body=''); return
                await request.fulfill(path=str(path))
            elif 'www.gstatic.com/firebasejs/' in url:
                await request.fulfill(body=(ROOT/'tests/browser-fixture.js').read_text() if url.endswith('/firebase-app-compat.js') else '', content_type='application/javascript')
            elif url.startswith('https://cdn.tailwindcss.com'):
                css=(output/'tailwind.css').read_text()
                await request.fulfill(body='document.head.insertAdjacentHTML("beforeend", '+json.dumps('<style>'+css+'</style>')+');', content_type='application/javascript')
            elif url.startswith('https://cdn.jsdelivr.net/npm/alpinejs@'):
                await request.fulfill(path=str(vendors/'node_modules/alpinejs/dist/cdn.min.js'),content_type='application/javascript')
            else:
                unexpected.append(url); await request.abort()
        await page.route('**/*',route)
        await page.goto('http://fitpp.test/')
        await page.wait_for_function('window.Alpine && Alpine.$data(document.body).dataReady')
        await page.evaluate("() => { const a=Alpine.$data(document.body); a.selectedDate='2026-10-17';a.currentMonth='2026-10';a.currentLocation='online'; }")
        row=page.locator('.client-row').first
        await page.evaluate('__fakeFirebase.holdCommit=true')
        await row.get_by_role('button',name='✓ Был (-1)',exact=True).click()
        await expect(page.locator('[role=status]')).to_have_text('Сохранение в Firebase…')
        await expect(row.get_by_role('button',name='✓ Был (-1)',exact=True)).to_be_disabled()
        assert await page.evaluate('Alpine.$data(document.body).clients[0].subscriptions[0].left') == 1
        await page.evaluate('() => {__fakeFirebase.holdCommit=false;__fakeFirebase.release();}')
        await expect(page.locator('[role=status]')).to_have_text('Сохранено в Firebase')
        await row.get_by_role('button',name='✓ Был (-1)',exact=True).click()
        await page.wait_for_function('!Alpine.$data(document.body).saving')
        assert await page.evaluate('Alpine.$data(document.body).clients[0].subscriptions[0].left') == 1
        await row.locator('.client-name').click()
        await expect(page.locator('.client-detail')).to_be_visible()
        await page.locator('.client-detail').get_by_role('button',name='+ Оформить',exact=True).click()
        await page.evaluate("__fakeFirebase.switch('B')")
        await page.wait_for_function("Alpine.$data(document.body).dataReady && Alpine.$data(document.body).currentUser.uid==='B'")
        await expect(page.locator('.client-detail')).to_be_hidden()
        await expect(page.locator('[x-show="showSubModal"]')).to_be_hidden()
        assert await page.evaluate('__fakeFirebase.docs.B.finances["2026-10"]') == 1000
        await page.evaluate('__fakeFirebase.failSave=true')
        await row.get_by_role('button',name='₽ Разово (500)',exact=True).click()
        await expect(page.locator('[role=alert]')).to_contain_text('TEST SAVE FAILURE')
        assert await page.evaluate('Alpine.$data(document.body).saveStatus') == ''
        await page.screenshot(path=str(output/'save-error-390.png'))
        await page.evaluate('__fakeFirebase.failSave=false;__fakeFirebase.failLoad=true')
        await page.get_by_role('button',name='Обновить данные',exact=True).click()
        await expect(page.locator('[role=alert]')).to_contain_text('TEST LOAD FAILURE')
        await expect(page.locator('.bottom-nav').get_by_role('button',name='Добавить клиента')).to_be_disabled()
        await page.evaluate('__fakeFirebase.failLoad=false')
        await page.get_by_role('button',name='Обновить данные',exact=True).click()
        await page.wait_for_function('Alpine.$data(document.body).dataReady')
        # Save a new test client through the retained mobile + flow.
        await page.locator('.bottom-nav').get_by_role('button',name='Добавить клиента').click()
        modal=page.locator('[x-show="showClientModal"]')
        await modal.locator('input[type=text]').first.fill('Новый тестовый клиент')
        await modal.get_by_role('button',name='Сохранить',exact=True).click()
        await expect(modal).to_be_hidden()
        assert await page.evaluate('__fakeFirebase.docs.B.clients.length') == 2
        for width in [320,390,768,1280]:
            await page.set_viewport_size({'width':width,'height':844})
            for label in ['Журнал','Клиенты','Финансы']:
                await page.locator('.bottom-nav' if width<768 else 'header nav').get_by_role('button',name=label,exact=True).click()
                assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width,label)
        await page.set_viewport_size({'width':390,'height':844})
        await page.locator('.bottom-nav').get_by_role('button',name='Клиенты',exact=True).click()
        await page.screenshot(path=str(output/'clients-390.png'))
        assert not errors, errors
        assert not unexpected, unexpected
        print('PASS: mobile UI, account/form reset, confirmed-only success, visible save/load errors, add-client form, disabled writes, all tabs 320/390/768/1280px; all requests locally fulfilled, no Firebase connection.')
        print('Screenshots:',output)
        await browser.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--vendors',type=Path,required=True)
    asyncio.run(main(parser.parse_args().vendors))
