"""Legacy launch entry point is disabled; cookie_login owns authenticated contexts."""
from pathlib import Path

async def launch_context(profile_dir: Path, headless=False):
    raise RuntimeError('manual_login_disabled · use cookie_login.login_with_cookies')

async def close_context(pw,ctx):
    try:await ctx.close()
    finally:await pw.stop()
