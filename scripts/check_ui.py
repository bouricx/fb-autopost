"""Run real Chromium UI checks against a temporary local workspace, never Facebook.
CHROMIUM_PATH may select a local browser; default /usr/bin/chromium.
"""
import asyncio,os,sys,tempfile,threading
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from autopost import config as C, storage as S, queue_storage as Q
from autopost.api import app,browsers
from autopost.group_metadata import EXTRACT_GROUPS
import uvicorn
from playwright.async_api import async_playwright

async def check(server,out):
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
        page=await browser.new_page(viewport={'width':1440,'height':1050},device_scale_factor=1)
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        for _ in range(50):
            if server.started:break
            await asyncio.sleep(.1)
        # Exercise the extraction script on DOM cards with separate image/title anchors.
        await page.set_content('''<main>
        <article><a href="https://www.facebook.com/groups/alpha/"><img src="https://scontent.fbcdn.net/alpha.jpg" style="width:60px;height:60px"></a><h3><a href="https://www.facebook.com/groups/alpha/?ref=joins">Alpha Group</a></h3></article>
        <article><img src="https://scontent.fbcdn.net/avatar.jpg" style="width:80px;height:80px"><a href="https://www.facebook.com/groups/beta/">Beta Group</a></article>
        <article><a href="https://www.facebook.com/groups/gamma/"><svg width="60" height="60"><image width="60" height="60" href="https://scontent.fbcdn.net/gamma.jpg"/></svg></a><a href="https://www.facebook.com/groups/gamma/">Gamma Group</a></article>
        <a href="https://www.facebook.com/groups/joins/">Your groups</a></main>''')
        rows=await page.locator('a[href]').evaluate_all(EXTRACT_GROUPS)
        assert len(rows)==3,rows
        by_name={row['name']:row for row in rows}
        assert by_name['Alpha Group']['image_url'].endswith('alpha.jpg')
        assert by_name['Beta Group']['image_url']=='' # Must not use neighbouring avatar.
        assert by_name['Gamma Group']['image_url'].endswith('gamma.jpg')
        await page.route('https://*.fbcdn.net/**',lambda route:route.fulfill(status=200,content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="20" fill="#b9c9bc"/><path d="M0 100 40 45 80 90 100 60 120 100" fill="#74998a"/></svg>'))
        await page.goto('http://127.0.0.1:8765/')
        await page.get_by_text('เชื่อมต่อบนเครื่องแล้ว',exact=True).wait_for()
        assert await page.get_by_text('เพิ่มบัญชีแรกของคุณ',exact=True).count()==1
        await page.locator('#add input').fill('Veltshop')
        await page.get_by_role('button',name='เพิ่มบัญชี',exact=True).click()
        await page.locator('#active-account option').filter(has_text='Veltshop').wait_for(state='attached')
        first=await page.locator('#active-account').input_value()
        fixture_names=['Veltshop Community','พื้นที่คนรักงานออกแบบ','ตลาดสินค้ามือสอง','คนชอบถ่ายภาพ','ชุมชนคนทำธุรกิจ','มุมแบ่งปันไอเดีย']
        fixtures=[{'url':f'https://www.facebook.com/groups/test{i}/','name':name,'image_url':('https://scontent.fbcdn.net/photo.jpg' if i<4 else '')} for i,name in enumerate(fixture_names)]
        S.save_joined_groups(first,fixtures,'2026-10-14T03:00:00+00:00')
        other=await browsers.add('บัญชีที่สอง')
        S.save_joined_groups(other['id'],[{'url':'https://www.facebook.com/groups/other/','name':'กลุ่มบัญชีที่สอง','image_url':''}])
        await page.reload()
        await page.locator('nav [data-view=groups]').click()
        await page.locator('.group-card').nth(5).wait_for()
        assert await page.locator('.group-card').count()==6
        assert await page.locator('.group-photo img').count()==4
        await page.locator('.group-photo img').first.evaluate("img=>img.dispatchEvent(new Event('error'))")
        assert await page.locator('.group-photo img').count()==3
        await page.get_by_role('checkbox',name='เลือกกลุ่ม Veltshop Community',exact=True).check()
        await page.get_by_role('checkbox',name='เลือกกลุ่ม พื้นที่คนรักงานออกแบบ',exact=True).check()
        await page.screenshot(path=str(out/'groups-light.png'),full_page=True)
        await page.locator('#search').fill('ถ่ายภาพ')
        assert await page.locator('.group-card').count()==1
        await page.locator('#search').fill('')
        await page.locator('#filter-selected').click()
        assert await page.locator('.group-card').count()==2
        await page.locator('#filter-all').click()
        await page.locator('#write-selected').click()
        assert await page.locator('#targets .target-row').count()==2
        await page.locator('#message').fill('ข้อความทดสอบ UI เท่านั้น ไม่ได้ส่งไป Facebook')
        await page.locator('nav [data-view=groups]').click()
        await page.locator('#active-account').select_option(other['id'])
        await page.get_by_text('กลุ่มบัญชีที่สอง',exact=True).wait_for()
        assert await page.locator('.group-card').count()==1
        await page.locator('nav [data-view=compose]').click()
        assert await page.locator('#targets .target-row').count()==0
        await page.locator('#active-account').select_option(first)
        await page.locator('#targets .target-row').nth(1).wait_for()
        assert 'ข้อความทดสอบ UI' in await page.locator('#message').input_value()
        await page.locator('#theme').click()
        assert await page.locator('html').get_attribute('data-theme')=='dark'
        await page.screenshot(path=str(out/'compose-dark.png'),full_page=True)
        await page.locator('nav [data-view=groups]').click()
        await page.set_viewport_size({'width':390,'height':844})
        assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile overflow'
        await page.screenshot(path=str(out/'groups-mobile.png'),full_page=True)
        assert not errors,errors
        print('DOM group extraction + actual UI passed: account isolation, cache reload, images/fallback, search, selection, composer, themes, mobile; no Facebook posts sent.')
        await browser.close()

def main():
    with tempfile.TemporaryDirectory() as tmp:
        root=Path(tmp);out=Path(os.environ.get('UI_SCREENSHOTS','/workspace/fb-glass-check'));out.mkdir(parents=True,exist_ok=True)
        patches=[patch.object(C,'CONFIG_PATH',root/'config.json'),patch.object(C,'PROFILE_ROOT',root/'profiles'),patch.object(C,'DATA_DIR',root/'data'),patch.object(C,'IMAGES_DIR',root/'images'),patch.object(C,'IMAGES_DISCORD_DIR',root/'discord'),patch.object(S,'DATA_DIR',root/'data'),patch.object(Q,'DATA',root/'queue')]
        for p in patches:p.start()
        server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=8765,log_level='error',access_log=False))
        thread=threading.Thread(target=server.run,daemon=True);thread.start()
        try:asyncio.run(check(server,out))
        finally:
            server.should_exit=True;thread.join(timeout=10)
            for p in patches:p.stop()
if __name__=='__main__':main()
