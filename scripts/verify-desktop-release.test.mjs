import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { releaseFiles, verifyRelease } from './verify-desktop-release.mjs';

test('tag must match the version packaged in the installer', () => {
  assert.throws(() => releaseFiles('0.1.9', 'v0.2.0-beta.1'), /must match/);
  assert.throws(() => releaseFiles('../bad', 'v../bad'), /Unsupported/);
});

for (const version of ['0.1.9', '0.2.0-beta.1']) {
  test(`checksums installer and correct updater channel for ${version}`, (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dac-release-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const files = releaseFiles(version, `v${version}`);
    assert.equal(files[2], version.includes('beta') ? 'beta.yml' : 'latest.yml');
    for (const file of files) writeFileSync(path.join(dir, file), `fixture:${file}`);
    const sha512 = createHash('sha512').update(`fixture:${files[0]}`).digest('base64');
    const metadata = {version, path: files[0], sha512, files: [{url: files[0], sha512, size: Buffer.byteLength(`fixture:${files[0]}`)}]};
    // JSON is valid YAML; exercise the real parser without a test dependency.
    writeFileSync(path.join(dir, files[2]), JSON.stringify(metadata));
    verifyRelease(dir, version, `v${version}`);
    const expected = files.map((file) => `${createHash('sha256').update(readFileSync(path.join(dir, file))).digest('hex')}  ${file}\n`).join('');
    assert.equal(readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8'), expected);
    for (const bad of [
      {...metadata, version: '99.0.0'},
      {...metadata, path: 'wrong.exe'},
      {...metadata, sha512: 'wrong'},
      {...metadata, files: [{...metadata.files[0], url: 'https://example.com/wrong.exe'}]},
      {...metadata, files: [{...metadata.files[0], size: 1}]},
      {...metadata, files: [{...metadata.files[0], sha512: 'wrong'}]},
      {...metadata, files: []},
    ]) {
      writeFileSync(path.join(dir, files[2]), JSON.stringify(bad));
      assert.throws(() => verifyRelease(dir, version, `v${version}`), /Updater metadata/);
    }
    writeFileSync(path.join(dir, files[2]), JSON.stringify(metadata));
    rmSync(path.join(dir, files[1]));
    assert.throws(() => verifyRelease(dir, version, `v${version}`), /ENOENT/);
    writeFileSync(path.join(dir, files[1]), '');
    assert.throws(() => verifyRelease(dir, version, `v${version}`), /Empty or invalid/);
  });
}
