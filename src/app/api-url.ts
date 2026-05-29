import { environment } from '../environments/environment';

export function apiBaseUrl(): string {
  const value = environment.apiBaseUrl.trim().replace(/\/+$/, '');
  if (!value) {
    throw new Error('API base URL is not configured.');
  }

  if (environment.production) {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') {
      throw new Error('Production API base URL must use HTTPS.');
    }
  }

  return value;
}
