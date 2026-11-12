import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

function loadUpdaterMetadata(text) {
  // Use the updater's own YAML parser, resolved from its dependency context.
  const appRequire = createRequire(new URL('../app/package.json', import.meta.url));
  const updaterRequire = createRequire(appRequire.resolve('electron-updater/package.json'));
  return updaterRequire('js-yaml').load(text);
}

export function releaseFiles(version, tag) {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)*)?$/.test(version)) {
    throw new Error(`Unsupported release version: ${version}`);
  }
  if (tag !== `v${version}`) throw new Error(`Tag ${tag} must match desktop version v${version}`);
  const channel = version.includes('-') ? version.split('-')[1].split('.')[0] : 'latest';
  const installer = `Track-Auto-Chess-Setup-${version}.exe`;
  return [installer, `${installer}.blockmap`, `${channel}.yml`];
}

export function verifyRelease(directory, version, tag) {
  const files = releaseFiles(version, tag);
  const installer = readFileSync(path.join(directory, files[0]));
  const metadata = loadUpdaterMetadata(readFileSync(path.join(directory, files[2]), 'utf8'));
  const digest = createHash('sha512').update(installer).digest('base64');
  if (!metadata || metadata.version !== version) throw new Error('Updater metadata version does not match release');
  if (metadata.path !== files[0] || metadata.sha512 !== digest) {
    throw new Error('Updater metadata installer path or checksum does not match release');
  }
  if (!Array.isArray(metadata.files) || metadata.files.length !== 1) {
    throw new Error('Updater metadata must describe exactly one Windows installer');
  }
  const entry = metadata.files[0];
  if (!entry || entry.url !== files[0] || entry.sha512 !== digest || entry.size !== installer.length) {
    throw new Error('Updater metadata installer URL, checksum or size does not match release');
  }
  // Keep installer, differential update map, and channel metadata together.
  const sums = files.map((name) => {
    const filename = path.join(directory, name);
    if (!statSync(filename).isFile() || statSync(filename).size === 0) {
      throw new Error(`Empty or invalid release artifact: ${name}`);
    }
    return `${createHash('sha256').update(readFileSync(filename)).digest('hex')}  ${name}`;
  });
  writeFileSync(path.join(directory, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { version } = JSON.parse(readFileSync(path.join(root, 'app/package.json'), 'utf8'));
  const tag = process.env.GITHUB_REF_NAME;
  releaseFiles(version, tag);
  if (!process.argv.includes('--version-only')) {
    const files = verifyRelease(path.join(root, 'app/release'), version, tag);
    console.log('Verified release files:', files.join(', '));
    if (process.env.GITHUB_OUTPUT) {
      const uploads = [...files, 'SHA256SUMS.txt'].map((file) => `app/release/${file}`);
      appendFileSync(process.env.GITHUB_OUTPUT, `files<<RELEASE_FILES\n${uploads.join('\n')}\nRELEASE_FILES\n`);
    }
  }
}
