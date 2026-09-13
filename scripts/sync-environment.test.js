const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'sync-environment.js'), 'utf8');

function generate(env = {}, dotEnv = '') {
  const files = new Map();
  const fakeFs = {
    existsSync: () => !!dotEnv,
    readFileSync: () => dotEnv,
    mkdirSync: () => {},
    writeFileSync: (name, content) => files.set(path.basename(name), content)
  };
  vm.runInNewContext(source, {
    __dirname, process: { env }, URL,
    require: name => name === 'node:fs' ? fakeFs : require(name)
  });
  return files;
}

test('release injection normalises the API suffix and writes both environments', () => {
  const files = generate({ npm_lifecycle_event: 'prebuild', UI_API_BASE_URL: 'https://api.example.com/api/' });
  assert.match(files.get('environment.ts'), /apiBaseUrl: "https:\/\/api.example.com"/);
  assert.match(files.get('environment.prod.ts'), /production: true/);
  assert.match(files.get('environment.prod.ts'), /apiBaseUrl: "https:\/\/api.example.com"/);
});

test('release builds require an explicit environment URL even when .env has one', () => {
  assert.throws(() => generate({ npm_lifecycle_event: 'prebuild' }, 'UI_API_BASE_URL=https://api.example.com'),
    /must be supplied by the environment/);
});

test('release builds reject insecure, malformed and loopback API URLs', () => {
  for (const url of ['http://api.example.com', 'ftp://api.example.com', 'invalid',
    'https://localhost', 'https://127.0.0.1', 'https://[::1]']) {
    assert.throws(() => generate({ npm_lifecycle_event: 'prebuild', UI_API_BASE_URL: url }), /Release builds/);
  }
});

test('signing lanes cannot bypass release validation with the development flag', () => {
  assert.throws(() => generate({ UI_REQUIRE_PRODUCTION_API: 'true', UI_ALLOW_LOCALHOST_API: 'true',
    UI_API_BASE_URL: 'http://localhost:5055' }), /Release builds/);
});

test('development uses local configuration without copying it into production', () => {
  const files = generate({}, 'UI_API_BASE_URL=http://localhost:5055');
  assert.match(files.get('environment.ts'), /http:\/\/localhost:5055/);
  assert.match(files.get('environment.prod.ts'), /apiBaseUrl: ""/);
});
