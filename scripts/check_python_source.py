"""Run repository tests even when an embedded runtime's ._pth prefers its bundled app."""
import sys
import unittest
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
import autopost
if Path(autopost.__file__).resolve().parent != root / 'autopost':
    raise RuntimeError('Source verification must import the checked-out repository')
print('Verifying checked-out Python source (not the historical bundled app)', flush=True)
suite = unittest.defaultTestLoader.discover(str(root / 'tests'))
raise SystemExit(0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1)
