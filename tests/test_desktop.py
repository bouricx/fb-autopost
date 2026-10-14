import socket
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch
from autopost.desktop import reserve_socket, run_desktop, APP_VERSION
from autopost import config as C, queue_storage as Q, runtime_config
from autopost import api

class DesktopTests(unittest.TestCase):
    def test_busy_port_is_reserved_elsewhere(self):
        blocker=socket.socket();blocker.bind(('127.0.0.1',0));blocker.listen()
        try:
            reserved=reserve_socket(blocker.getsockname()[1])
            try:
                self.assertNotEqual(reserved.getsockname()[1],blocker.getsockname()[1])
                conflict=socket.socket()
                try:
                    with self.assertRaises(OSError):conflict.bind(reserved.getsockname())
                finally:conflict.close()
            finally:reserved.close()
        finally:blocker.close()

    def test_window_opens_only_ready_new_server_when_port_busy(self):
        blocker=socket.socket();blocker.bind(('127.0.0.1',0));blocker.listen()
        opened=[]
        class FakeWebview:
            def create_window(inner,title,url,**kwargs):
                # A real HTTP request proves readiness and dynamic Host validation.
                with urllib.request.urlopen(url,timeout=5) as response:
                    html=response.read().decode()
                self.assertIn('DESKTOP · 1.3.1',html)
                self.assertNotIn(':'+str(blocker.getsockname()[1])+'/',url)
                self.assertIn(APP_VERSION,title)
                opened.append(url)
                return object()
            def start(inner,**kwargs):
                self.assertFalse(kwargs['debug'])
                self.assertTrue(Path(kwargs['storage_path']).is_dir())
                # Returning simulates closing the native window.
        old_port=api.PORT
        try:
            with tempfile.TemporaryDirectory() as tmp,patch.object(C,'STATE_DIR',Path(tmp)),patch.object(Q,'DATA',Path(tmp)/'queue'),patch.object(runtime_config,'PORT',runtime_config.PORT),patch.dict('os.environ'):
                run_desktop(FakeWebview(),blocker.getsockname()[1])
            self.assertEqual(len(opened),1)
            with self.assertRaises(Exception):urllib.request.urlopen(opened[0],timeout=1)
        finally:
            api.PORT=old_port
            blocker.close()
