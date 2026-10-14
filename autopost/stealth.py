"""Platform layer: Playwright stealth init-script (webdriver / cdc_ / WebGL / plugins)."""
from __future__ import annotations

STEALTH_JS = r"""
(() => {
  // 1) ซ่อน webdriver flag
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // 2) ลบ automation artifacts ของ Playwright/Chrome
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

  // 3) เติม chrome.runtime ให้ดูเหมือนส่วนขยายจริง
  window.chrome = window.chrome || {};
  window.chrome.runtime = window.chrome.runtime || {
    connect: () => {},
    sendMessage: () => {},
  };

  // 4) permissions.query กับ notifications บน headless
  const origQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
  if (origQuery) {
    window.navigator.permissions.query = (params) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(params);
  }

  // 5) plugins ปลอม (headless มักได้ length 0)
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ];
      plugins.length = 3;
      return plugins;
    },
  });

  // 6) languages คงที่
  Object.defineProperty(navigator, 'languages', {
    get: () => Object.freeze(['th-TH', 'th', 'en-US', 'en']),
  });

  // 7) ลบของที่ Playwright ยัดไว้
  const props = ['__playwright', '__pw_manual', '__PW_inspect'];
  for (const p of props) {
    if (window[p] !== undefined) delete window[p];
  }

  // 8) WebGL vendor/renderer กันบอก headless
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return 'Intel Inc.';
    if (param === 37446) return 'Intel Iris OpenGL Engine';
    return getParameter.call(this, param);
  };
  if (typeof WebGL2RenderingContext !== 'undefined') {
    const getParam2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return 'Intel Inc.';
      if (param === 37446) return 'Intel Iris OpenGL Engine';
      return getParam2.call(this, param);
    };
  }
})();
"""


async def apply_stealth(context) -> None:
    await context.add_init_script(STEALTH_JS)
