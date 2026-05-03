const fs = require('node:fs');
const path = require('node:path');

function parseDotEnv(contents) {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .reduce((acc, line) => {
      const equalsIndex = line.indexOf('=');
      if (equalsIndex === -1) {
        return acc;
      }

      const key = line.slice(0, equalsIndex).trim();
      const value = line.slice(equalsIndex + 1).trim();
      acc[key] = value;
      return acc;
    }, {});
}

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const appEnvPath = path.join(root, 'src', 'environments', 'environment.ts');
const prodEnvPath = path.join(root, 'src', 'environments', 'environment.prod.ts');

const defaults = {
  UI_API_BASE_URL: 'https://localhost:7152'
};

const envFile = fs.existsSync(envPath) ? parseDotEnv(fs.readFileSync(envPath, 'utf8')) : {};
const apiBaseUrl = normaliseApiBaseUrl(process.env.UI_API_BASE_URL || envFile.UI_API_BASE_URL || defaults.UI_API_BASE_URL);
const output = `// This file is generated from .env by scripts/sync-environment.js.
// Update UI_API_BASE_URL in .env or the process environment, then run npm start or npm run build.

export const environment = {
  production: false,
  apiBaseUrl: "${apiBaseUrl}"
};
`;

const productionOutput = `// This file is generated from .env by scripts/sync-environment.js.
// Update UI_API_BASE_URL in .env or the process environment, then run npm start or npm run build.

export const environment = {
  production: true,
  apiBaseUrl: "${apiBaseUrl}"
};
`;

fs.mkdirSync(path.dirname(appEnvPath), { recursive: true });
fs.writeFileSync(appEnvPath, output, 'utf8');
fs.writeFileSync(prodEnvPath, productionOutput, 'utf8');

function normaliseApiBaseUrl(value) {
  return value
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api$/i, '');
}
