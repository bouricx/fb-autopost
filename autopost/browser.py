"""Visible persistent browser; the user signs in directly on Facebook."""
from pathlib import Path
from playwright.async_api import async_playwright

async def launch_context(profile_dir: Path, headless=False):
    profile_dir.mkdir(parents=True,exist_ok=True)
    pw=await async_playwright().start()
    try:
        ctx=await pw.chromium.launch_persistent_context(str(profile_dir),channel='chrome',headless=False,
          viewport={'width':1366,'height':900},locale='th-TH',accept_downloads=False)
    except Exception:
        await pw.stop()
        raise RuntimeError('เปิด Chrome ไม่สำเร็จ กรุณาติดตั้ง Google Chrome หรือปิดหน้าต่างบัญชีนี้แล้วลองใหม่')
    return pw,ctx

async def close_context(pw,ctx):
    try:await ctx.close()
    finally:await pw.stop()
