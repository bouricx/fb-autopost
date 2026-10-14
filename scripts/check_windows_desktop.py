"""Exercise the bundled native Windows WebView2 window with a conflicting port."""
import os
import socket
import tempfile
import threading
from pathlib import Path

# WebView2 releases its profile lock asynchronously after window.destroy().
# The hosted runner discards this isolated directory at job completion.
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    os.environ['FBAUTO_USER_DIR']=str(Path(tmp)/'profile')
    os.environ['FBAUTO_DATA']=str(Path(tmp)/'queue')
    import webview
    from autopost.desktop import run_desktop
    blocker=socket.socket();blocker.bind(('127.0.0.1',0));blocker.listen()
    blocked=blocker.getsockname()[1]
    failures=[]
    class NativeWindow:
        def create_window(self,*args,**kwargs):
            kwargs['confirm_close']=False
            self.window=webview.create_window(*args,**kwargs)
            return self.window
        def start(self,**kwargs):
            def inspect_window():
                try:
                    assert self.window.events.loaded.wait(40),'Native WebView did not load'
                    title=self.window.evaluate_js('document.title')
                    version=self.window.evaluate_js("document.querySelector('.version').textContent")
                    url=self.window.get_current_url()
                    assert '1.3.1' in title,title
                    assert 'DESKTOP' in version,version
                    assert ':'+str(blocked)+'/' not in url,url
                    print('PASS: native WebView2 window rendered Desktop 1.3.1 on a free port; no Facebook actions.',flush=True)
                except BaseException as exc:
                    failures.append(str(exc))
                finally:
                    self.window.destroy()
            webview.start(inspect_window,**kwargs)
    def timeout():
        print('Native desktop smoke test timed out',flush=True)
        os._exit(2)
    watchdog=threading.Timer(70,timeout);watchdog.daemon=True;watchdog.start()
    try:run_desktop(NativeWindow(),preferred_port=blocked)
    finally:
        watchdog.cancel();blocker.close()
    if failures:raise RuntimeError('; '.join(failures))
