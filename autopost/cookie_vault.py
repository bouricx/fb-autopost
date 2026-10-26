"""Local Windows DPAPI vault; no plaintext fallback and no credentials in config/logs."""
import ctypes
import os
import re
import tempfile
from pathlib import Path


class CookieVault:
    def __init__(self, root: Path | None = None):
        self.root = root or Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".local" / "share") / "FB-AutoPost" / "cookie-secrets"

    def _path(self, user_id: str) -> Path:
        if not re.fullmatch(r"[0-9]+", user_id):
            raise ValueError("invalid_cookie")
        return self.root / (user_id + ".bin")

    @staticmethod
    def _crypt(data: bytes, decrypt=False) -> bytes:
        if os.name != "nt":
            raise ValueError("secure_storage_unavailable · Python Cookie storage requires Windows DPAPI")
        from ctypes import wintypes
        class Blob(ctypes.Structure):
            _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]
        buffer = ctypes.create_string_buffer(data)
        source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
        target = Blob()
        crypt = ctypes.WinDLL("crypt32", use_last_error=True)
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        if decrypt:
            fn = crypt.CryptUnprotectData
            fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
            ok = fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
        else:
            fn = crypt.CryptProtectData
            fn.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
            ok = fn(ctypes.byref(source), "FB-AutoPost", None, None, None, 1, ctypes.byref(target))
        if not ok:
            raise ValueError("secure_storage_unavailable")
        try:
            return ctypes.string_at(target.data, target.size)
        finally:
            kernel.LocalFree.argtypes = [ctypes.c_void_p]
            kernel.LocalFree(ctypes.cast(target.data, ctypes.c_void_p))

    def store(self, user_id: str, raw: str):
        path = self._path(user_id)
        encrypted = self._crypt(raw.encode("utf-8"))
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, scratch = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(encrypted)
            os.replace(scratch, path)
        finally:
            if os.path.exists(scratch):
                os.unlink(scratch)

    def load(self, user_id: str) -> str:
        try:
            return self._crypt(self._path(user_id).read_bytes(), decrypt=True).decode("utf-8")
        except Exception:
            raise ValueError("cookie_required · นำเข้า Cookie ใหม่") from None
