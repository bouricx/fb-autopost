import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from autopost import message_profiles as P

class MessageProfileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        def directory(aid):
            path = self.root / aid
            path.mkdir(exist_ok=True)
            return path
        self.patch = patch.object(P, 'account_dir', directory)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def test_persist_assignment_and_account_isolation(self):
        row = P.create('account-a', 'Promotion', 'Line one\nLine two')
        url = 'https://www.facebook.com/groups/123/'
        P.assign('account-a', [url], row['id'])
        self.assertEqual(P.resolve('account-a', [url], 'fallback')[url], 'Line one\nLine two')
        self.assertEqual(P.resolve('account-b', [url], 'fallback')[url], 'fallback')
        P.assign('account-a', [url], '')
        self.assertEqual(P.resolve('account-a', [url], 'fallback')[url], 'fallback')

    def test_failed_replace_keeps_previous_file(self):
        P.create('account-a', 'Original', 'original')
        with patch.object(P.os, 'replace', side_effect=OSError('locked')):
            with self.assertRaises(OSError): P.create('account-a', 'New', 'new')
        self.assertEqual(len(P.load('account-a')['profiles']), 1)
        self.assertEqual(list((self.root / 'account-a').glob('*.tmp')), [])

    def test_invalid_assignment_does_not_change_saved_data(self):
        P.create('account-a', 'One', 'hello')
        before = P.load('account-a')
        with self.assertRaises(ValueError): P.assign('account-a', ['group'], 'missing')
        self.assertEqual(P.load('account-a'), before)
