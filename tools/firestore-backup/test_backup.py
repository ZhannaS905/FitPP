"""Synthetic data only. No gcloud invocation and no network access."""
import copy
import importlib.util
import math
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('backup', Path(__file__).with_name('backup.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
DOC = {'name': b.PREFIX+'fictional-test-uid', 'createTime':'2026-01-01T00:00:00.000000001Z',
       'updateTime':'2026-01-02T00:00:00.123456789Z', 'fields': {
           'clients': {'arrayValue': {'values': [{'mapValue': {'fields': {'name': {'stringValue':'Fictional fixture'}}}}]}},
           'attendance': {'mapValue': {'fields': {}}}, 'finances': {'mapValue': {'fields': {'2026-10': {'integerValue':'9223372036854775807'}}}},
           'intMin': {'integerValue':'-9223372036854775808'}, 'timestamp': {'timestampValue':'2026-10-17T12:00:00.123456789Z'},
           'bytes': {'bytesValue':'AP9BQkM='}, 'ref': {'referenceValue':b.PREFIX+'other-fixture'},
           'point': {'geoPointValue': {'latitude':55.751244, 'longitude':37.618423}},
           'zero': {'doubleValue':-0.0}, 'nan': {'doubleValue':'NaN'}, 'inf': {'doubleValue':'Infinity'},
           'flag': {'booleanValue':True}, 'null': {'nullValue':None}, 'unknownFutureField': {'stringValue':'retain'},
       }}
class FakeReader:
    def __init__(self): self.urls=[]; self.pass_count=0; self.changed=False
    def get(self, url):
        self.urls.append(url)
        headers={'Date':'Sat, 17 Oct 2026 12:00:10 GMT'}
        if 'readTime=' not in url: return ({},headers)
        if '/fictional-test-uid?' in url: return (copy.deepcopy(DOC),headers)
        if 'pageToken=second' in url:
            return ({'documents':[dict(copy.deepcopy(DOC),name=b.PREFIX+'second-fixture')]},headers)
        self.pass_count+=1
        doc=copy.deepcopy(DOC)
        if self.changed and self.pass_count==2:doc['fields']['flag']['booleanValue']=False
        return ({'documents':[doc],'nextPageToken':'second'},headers)

class BackupTests(unittest.TestCase):
    def setUp(self):
        # The cloud sandbox has a protective /tmp/.git sentinel. Restrict this
        # fixture's Git discovery to its synthetic subtree; production code
        # always checks every ancestor without exceptions.
        root=Path(tempfile.gettempdir()).resolve()
        check=lambda directory:any((p/'.git').exists() for p in [directory,*directory.parents] if root in p.parents)
        patcher=patch.object(b,'inside_git',side_effect=check)
        patcher.start();self.addCleanup(patcher.stop)

    def test_full_collection_two_pass_pagination_and_private_local_files(self):
        with tempfile.TemporaryDirectory() as directory:
            reader=FakeReader(); path=b.export(reader,directory)
            result=b.verify_file(path)
            self.assertEqual(result['documentCount'],2)
            self.assertEqual(result['documents'][0],DOC)
            self.assertEqual(result['readTime'],'2026-10-17T12:00:08Z')
            self.assertEqual(len(reader.urls),5)
            self.assertTrue(all('readTime=2026-10-17T12%3A00%3A08Z' in u for u in reader.urls[1:]))
            self.assertEqual(path.stat().st_mode & 0o777,0o600)
            self.assertEqual(path.with_suffix('.sha256').stat().st_mode & 0o777,0o600)
    def test_single_trainer_preserves_all_fields_types_and_nanosecond_precision(self):
        with tempfile.TemporaryDirectory() as directory:
            path=b.export(FakeReader(),directory,'fictional-test-uid')
            doc=b.verify_file(path)['documents'][0]
            self.assertEqual(doc,DOC)
            self.assertEqual(doc['fields']['finances']['mapValue']['fields']['2026-10']['integerValue'],'9223372036854775807')
            self.assertEqual(doc['fields']['timestamp']['timestampValue'],'2026-10-17T12:00:00.123456789Z')
            self.assertLess(math.copysign(1,doc['fields']['zero']['doubleValue']),0)
    def test_negative_zero_wire_form_is_preserved(self):
        doc=b.decode('{"doubleValue":-0}')
        self.assertLess(math.copysign(1,b.decode(b.encode(doc))['doubleValue']),0)
    def test_differing_second_pass_creates_no_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            reader=FakeReader();reader.changed=True
            with self.assertRaises(b.BackupError):b.export(reader,directory)
            self.assertEqual(list(Path(directory).iterdir()),[])
    def test_repeated_page_token_and_duplicates_are_rejected(self):
        class Repeat(FakeReader):
            def get(self,url):return ({'nextPageToken':'same'}, {})
        with self.assertRaises(b.BackupError):b.read_documents(Repeat(),'2026-10-17T12:00:00Z')
        with self.assertRaises(b.BackupError):b.check_documents([DOC,DOC])
    def test_git_directory_is_rejected_before_personal_data_is_read(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory)/'.git').mkdir();reader=FakeReader()
            with self.assertRaises(b.BackupError):b.export(reader,Path(directory)/'private')
            self.assertEqual(reader.urls,[])
    def test_tampered_file_fails_offline_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            path=b.export(FakeReader(),directory,'fictional-test-uid');path.write_bytes(path.read_bytes()+b' ')
            with self.assertRaises(b.BackupError):b.verify_file(path)
    def test_no_redirect_and_unexpected_destinations(self):
        with self.assertRaises(b.BackupError):b.NoRedirect().redirect_request(None,None,302,'',{},'https://example.com')
        with patch.object(b,'access_token',return_value='fake-unit-token'):
            reader=b.Reader('unit@example.test')
            with self.assertRaises(b.BackupError):reader.get('https://example.com/')
            with self.assertRaises(b.BackupError):reader.get(b.BASE.replace('trainers','other'))
    def test_transport_uses_only_get_and_does_not_print_token(self):
        class Response:
            headers={}
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def read(self):return b'{}'
        class Opener:
            def open(self,request,timeout):
                self.method=request.get_method();self.body=request.data
                return Response()
        with patch.object(b,'access_token',return_value='fake-unit-token'):
            reader=b.Reader('unit@example.test');opener=Opener();reader.opener=opener
            reader.get(b.BASE)
            self.assertEqual(opener.method,'GET');self.assertIsNone(opener.body)
    def test_wrong_uid_and_missing_server_time_rejected(self):
        with self.assertRaises(b.BackupError):b.check_documents([DOC],'different-fixture')
        class NoDate:
            def get(self,url):return ({},{})
        with self.assertRaises(b.BackupError):b.snapshot(NoDate())
    def test_offline_verification_does_not_authorize_or_read_google(self):
        with tempfile.TemporaryDirectory() as directory:
            path=b.export(FakeReader(),directory,'fictional-test-uid')
            with patch.object(b,'access_token',side_effect=AssertionError('No authorization allowed')), patch.object(b.sys,'argv',['backup.py','--verify-file',str(path)]), patch('builtins.print'):
                b.main()
    def test_permission_error_leaves_no_partial_local_backup(self):
        class Denied(FakeReader):
            def get(self,url):raise b.BackupError('HTTP 403')
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(b.BackupError):b.export(Denied(),directory)
            self.assertEqual(list(Path(directory).iterdir()),[])
    def test_auth_failure_does_not_leak_cli_output(self):
        class Result:returncode=1;stdout='SECRET-FAKE';stderr='SECRET-FAKE'
        with patch.object(b.subprocess,'run',return_value=Result()):
            with self.assertRaises(b.BackupError) as failure:b.access_token('unit@example.test')
            self.assertNotIn('SECRET-FAKE',str(failure.exception))

if __name__=='__main__':unittest.main()
