"""Native desktop window backed by a loopback server on a reserved free port."""
import os
import socket
import threading
import time
from pathlib import Path

APP_VERSION = '1.3.1'

def reserve_socket(preferred=8765):
    """Keep the bound socket open: there is no port-check / bind race."""
    for port in (preferred, 0):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            sock.bind(('127.0.0.1', port))
            sock.listen(128)
            sock.set_inheritable(True)
            return sock
        except OSError:
            sock.close()
    raise RuntimeError('Cannot reserve a local port for FB AutoPost.')


def run_desktop(webview_module=None, preferred_port=None):
    import uvicorn
    from . import runtime_config
    sock = reserve_socket(preferred_port if preferred_port is not None else runtime_config.PORT)
    port = sock.getsockname()[1]
    runtime_config.PORT = port
    os.environ['FBAUTO_PORT'] = str(port)
    # Import after selecting the actual port, including the Host validation value.
    from . import api
    api.PORT = port
    from .config import STATE_DIR
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    server = uvicorn.Server(uvicorn.Config(api.app, host='127.0.0.1', port=port,
        access_log=False, log_level='warning', use_colors=False))
    failure = []
    def serve():
        try:
            server.run(sockets=[sock])
        except BaseException as exc:
            failure.append(type(exc).__name__)
    thread = threading.Thread(target=serve, name='fb-autopost-server', daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 20
        while not server.started:
            if failure or not thread.is_alive() or time.monotonic() >= deadline:
                raise RuntimeError('FB AutoPost could not start. Close older copies and try again.')
            time.sleep(.05)
        if webview_module is None:
            import webview as webview_module
        # Private per-version WebView profile avoids locks from older app windows.
        storage = STATE_DIR / 'desktop' / APP_VERSION
        storage.mkdir(parents=True, exist_ok=True)
        print(f'FB AutoPost {APP_VERSION} Desktop ready (local port {port})', flush=True)
        window = webview_module.create_window(
            f'FB AutoPost {APP_VERSION} · Liquid Glass',
            f'http://127.0.0.1:{port}/', width=1380, height=920, min_size=(920,650),
            background_color='#141722', text_select=True, confirm_close=True)
        webview_module.start(gui='edgechromium' if os.name=='nt' else None,
            debug=False, private_mode=False, storage_path=str(storage))
    finally:
        server.should_exit = True
        thread.join(timeout=80)
        sock.close()


def report_error(error):
    text = ('FB AutoPost could not open its desktop window.\n\n'
            'Install Microsoft Edge WebView2 Runtime if it is missing, then try again.\n'
            'https://developer.microsoft.com/microsoft-edge/webview2/\n\n'
            f'Details: {type(error).__name__}: {error}')
    if os.name == 'nt':
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text, 'FB AutoPost startup error', 0x10)
    else:
        print(text, flush=True)
