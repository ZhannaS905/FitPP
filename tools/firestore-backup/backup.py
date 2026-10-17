#!/usr/bin/env python3
"""Local-only, GET-only Firestore ProtoJSON backup. Never imports or restores data."""
import argparse
import datetime as dt
import email.utils
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PROJECT = 'fitpp-crm'
DATABASE = '(default)'
BASE = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}/documents/trainers'
PREFIX = f'projects/{PROJECT}/databases/{DATABASE}/documents/trainers/'
FORMAT = 'fitpp-firestore-protojson-v1'

class BackupError(Exception):
    pass


def decode(data):
    def integer(value):
        return -0.0 if value == '-0' else int(value)
    def constant(_):
        raise BackupError('Unexpected non-JSON numeric literal from server.')
    return json.loads(data, parse_int=integer, parse_constant=constant)


def encode(data):
    return (json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')


def canonical(documents):
    return json.dumps(sorted(documents, key=lambda d: d['name']), sort_keys=True,
                      ensure_ascii=False, allow_nan=False, separators=(',', ':'))


def access_token(account):
    try:
        result = subprocess.run(['gcloud', 'auth', 'print-access-token', '--account', account, '--quiet'],
                                capture_output=True, text=True, timeout=60, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise BackupError('Cannot run gcloud. Install Google Cloud CLI and sign in locally.') from exc
    token = result.stdout.strip()
    if result.returncode or not token or any(c.isspace() for c in token):
        # Never forward CLI stderr/stdout: they may contain sensitive information.
        raise BackupError('Local Google authorization failed. Run gcloud auth login on your Mac.')
    return token


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise BackupError('Redirect refused; credentials may only be sent to firestore.googleapis.com.')


class Reader:
    def __init__(self, account):
        self.account = account
        self.token = access_token(account)
        # Default TLS certificate verification remains enabled.
        self.opener = urllib.request.build_opener(NoRedirect())

    def get(self, url):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != 'https' or parsed.netloc != 'firestore.googleapis.com' or not (parsed.path == urllib.parse.urlsplit(BASE).path or parsed.path.startswith(urllib.parse.urlsplit(BASE).path + '/')):
            raise BackupError('Refused unexpected network destination.')
        refreshed = False
        for attempt in range(4):
            request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + self.token,
                                                          'Accept': 'application/json'}, method='GET')
            try:
                with self.opener.open(request, timeout=60) as response:
                    return decode(response.read()), response.headers
            except urllib.error.HTTPError as exc:
                status = exc.code
                if status == 401 and not refreshed:
                    self.token = access_token(self.account)
                    refreshed = True
                    continue
                if status in (429, 500, 502, 503, 504) and attempt < 3:
                    time.sleep(2 ** attempt)
                    continue
                raise BackupError(f'Firestore read failed (HTTP {status}). No backup declared complete. Check access and retry.') from None
            except (urllib.error.URLError, TimeoutError) as exc:
                raise BackupError('Network/TLS error. Certificate verification was not disabled; no complete backup created.') from exc
        raise BackupError('Read retry limit reached.')


def document_url(trainer_id):
    if not trainer_id or '/' in trainer_id or trainer_id in ('.', '..'):
        raise BackupError('Trainer UID must be a single nonempty document ID.')
    return BASE + '/' + urllib.parse.quote(trainer_id, safe='')


def check_documents(documents, trainer_id=None):
    seen = set()
    for doc in documents:
        name = doc.get('name')
        if not isinstance(name, str) or not name.startswith(PREFIX) or '/' in name[len(PREFIX):] or not name[len(PREFIX):]:
            raise BackupError('Unexpected document path in backup.')
        if trainer_id is not None and name != PREFIX + trainer_id:
            raise BackupError('Wrong trainer returned by server.')
        if name in seen or not isinstance(doc.get('fields', {}), dict):
            raise BackupError('Duplicate or invalid document in backup.')
        seen.add(name)


def snapshot(reader, trainer_id=None):
    probe = document_url(trainer_id) if trainer_id is not None else BASE + '?pageSize=1'
    _, headers = reader.get(probe)
    try:
        # Google's HTTP Date supplies server time: no dependence on the Mac's clock.
        # Use an explicitly recorded point two seconds in the past to avoid future-read errors.
        instant = email.utils.parsedate_to_datetime(headers['Date']).astimezone(dt.timezone.utc) - dt.timedelta(seconds=2)
    except (KeyError, TypeError, ValueError) as exc:
        raise BackupError('Missing valid server Date; cannot establish a consistent snapshot.') from exc
    return instant.isoformat(timespec='seconds').replace('+00:00', 'Z')


def read_documents(reader, read_time, trainer_id=None):
    if trainer_id is not None:
        document, _ = reader.get(document_url(trainer_id) + '?' + urllib.parse.urlencode({'readTime': read_time}))
        documents = [document]
    else:
        documents, seen_tokens, token = [], set(), None
        while True:
            query = {'pageSize': 300, 'readTime': read_time}
            if token:
                query['pageToken'] = token
            page, _ = reader.get(BASE + '?' + urllib.parse.urlencode(query))
            chunk = page.get('documents', [])
            if not isinstance(chunk, list):
                raise BackupError('Invalid Firestore list response.')
            documents.extend(chunk)
            token = page.get('nextPageToken')
            if not token:
                break
            if not isinstance(token, str) or token in seen_tokens:
                raise BackupError('Repeated or invalid pagination token; export incomplete.')
            seen_tokens.add(token)
    check_documents(documents, trainer_id)
    return documents


def inside_git(directory):
    return any((parent / '.git').exists() or ((parent / 'HEAD').is_file() and (parent / 'objects').is_dir())
               for parent in [directory, *directory.parents])


def safe_directory(directory):
    directory = Path(directory).expanduser().resolve()
    if inside_git(directory):
        raise BackupError('Backup destination is inside a Git repository. Choose an external local folder.')
    if any(part.lower() in ('dropbox', 'onedrive', 'google drive', 'cloudstorage', 'mobile documents') for part in directory.parts):
        raise BackupError('Choose a local, non-cloud-synchronized backup directory.')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.stat().st_mode & 0o077:
        raise BackupError('Backup folder permissions must be private. Use chmod 700 on that local folder.')
    return directory


def verify_file(path):
    path = Path(path)
    raw = path.read_bytes()
    expected = path.with_suffix('.sha256').read_text(encoding='ascii').strip()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise BackupError('Backup checksum does not match.')
    payload = decode(raw)
    if payload.get('format') != FORMAT or payload.get('project') != PROJECT or payload.get('database') != DATABASE or payload.get('collection') != 'trainers':
        raise BackupError('Unexpected backup format/project.')
    documents = payload.get('documents')
    if not isinstance(documents, list) or len(documents) != payload.get('documentCount'):
        raise BackupError('Document count does not match.')
    check_documents(documents, payload.get('trainerId'))
    return payload


def write_backup(directory, payload):
    directory = safe_directory(directory)
    filename = 'fitpp-backup-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + secrets.token_hex(4)
    path = directory / (filename + '.json')
    digest_path = path.with_suffix('.sha256')
    raw = encode(payload)
    # Round-trip verification before writing any file.
    if canonical(decode(raw)['documents']) != canonical(payload['documents']):
        raise BackupError('JSON round-trip check failed.')
    created = []
    try:
        for destination, content in [(path, raw), (digest_path, (hashlib.sha256(raw).hexdigest() + '\n').encode('ascii'))]:
            fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created.append(destination)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
        verified = verify_file(path)
        if canonical(verified['documents']) != canonical(payload['documents']):
            raise BackupError('Written file differs from verified snapshot.')
        return path
    except BaseException:
        # Clean up only new local incomplete files, never anything in Firestore.
        for destination in created:
            destination.unlink(missing_ok=True)
        raise


def export(reader, directory, trainer_id=None):
    safe_directory(directory)  # Fail before reading personal data if destination is unsafe.
    read_time = snapshot(reader, trainer_id)
    documents = read_documents(reader, read_time, trainer_id)
    repeated = read_documents(reader, read_time, trainer_id)
    if canonical(documents) != canonical(repeated):
        raise BackupError('Independent reads differ; no complete backup created.')
    payload = {'format': FORMAT, 'project': PROJECT, 'database': DATABASE, 'collection': 'trainers',
               'trainerId': trainer_id, 'readTime': read_time, 'documentCount': len(documents),
               'verification': 'two-identical-reads-at-same-readTime',
               'documents': documents}
    return write_backup(directory, payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--trainer-id', help='Export exactly one trainer UID.')
    mode.add_argument('--all-trainers', action='store_true', help='Export every document directly in trainers.')
    mode.add_argument('--verify-file', type=Path, help='Verify a local backup offline; no Google authorization.')
    parser.add_argument('--account', help='Explicit owner Google account already authorized in local gcloud.')
    parser.add_argument('--output-dir', type=Path, default=Path.home() / 'FitPP-Local-Backups')
    args = parser.parse_args()
    if args.verify_file:
        result = verify_file(args.verify_file)
        print(f'Local integrity check passed: {result["documentCount"]} document(s).')
        return
    if not args.account:
        parser.error('--account is required for export; authenticate with gcloud locally first.')
    # No preview/dry-run reads, auth, or writes happen without an explicit export command.
    safe_directory(args.output_dir)
    path = export(Reader(args.account), args.output_dir, args.trainer_id)
    print(f'Complete, verified local backup: {path}')
    print('Keep the adjacent .sha256 file. No Firestore data was modified.')

if __name__ == '__main__':
    try:
        main()
    except (BackupError, OSError, ValueError, KeyError) as error:
        # Error bodies and raw server payloads are deliberately never logged.
        print('Backup failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
