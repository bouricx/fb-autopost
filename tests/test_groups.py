import unittest
from autopost.group_metadata import normalize_group

class GroupMetadataTests(unittest.TestCase):
    def test_identity_and_image_are_preserved(self):
        row=normalize_group({'url':'https://facebook.com/groups/123?ref=feed','name':'  Veltshop\n Community  ','image_url':'https://scontent.fbcdn.net/photo.jpg?token=abc'})
        self.assertEqual(row,{'url':'https://www.facebook.com/groups/123/','name':'Veltshop Community','image_url':'https://scontent.fbcdn.net/photo.jpg?token=abc'})
    def test_disallowed_image_does_not_discard_group(self):
        for image in ['https://evil.test/p.jpg','https://fbcdn.net.evil.test/a','http://scontent.fbcdn.net/a','https://user@fbcdn.net/a','javascript:alert(1)']:
            self.assertEqual(normalize_group({'url':'https://facebook.com/groups/123','name':'Group','image_url':image})['image_url'],'')
    def test_non_group_links_are_rejected(self):
        for url in ['https://facebook.com/groups/joins/','https://facebook.com.evil.test/groups/123','https://facebook.com/groups/123/posts/456','javascript:alert(1)','https://user@facebook.com/groups/123']:
            self.assertIsNone(normalize_group({'url':url,'name':'Group'}))
    def test_legacy_group_without_photo_still_works(self):
        self.assertEqual(normalize_group({'url':'https://facebook.com/groups/test','name':'Test'})['image_url'],'')
