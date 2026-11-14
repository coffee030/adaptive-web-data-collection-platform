const fs = require('node:fs');
const path = require('node:path');

const project = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const installed = JSON.parse(fs.readFileSync('node_modules/.package-lock.json', 'utf8'));

for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  const expected = lock.packages[''][field] ?? {};
  const actual = project[field] ?? {};
  if (Object.keys(actual).length !== Object.keys(expected).length ||
      Object.keys(actual).some(name => actual[name] !== expected[name])) process.exit(1);
}

for (const [name, expected] of Object.entries(lock.packages)) {
  if (!name) continue;
  const compatible = (values, current) => !values ||
    (!values.includes('!' + current) && (values.every(value => value.startsWith('!')) || values.includes(current)));
  const previous = installed.packages[name];
  if (expected.optional && (!compatible(expected.os, process.platform) ||
      !compatible(expected.cpu, process.arch) || expected.libc)) continue;
  if (expected.optional && !previous) continue;
  if (!previous || previous.version !== expected.version || previous.integrity !== expected.integrity) process.exit(1);
  const manifest = JSON.parse(fs.readFileSync(path.join(name, 'package.json'), 'utf8'));
  if (manifest.version !== expected.version) process.exit(1);
}

if (Object.keys(installed.packages).some(name => !lock.packages[name])) process.exit(1);
const vitePath = require.resolve('vite/package.json', { paths: [process.cwd()] });
require(require.resolve('rolldown', { paths: [path.dirname(vitePath)] }));
