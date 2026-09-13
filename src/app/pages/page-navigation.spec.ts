import { returnPage } from './page-navigation';

describe('Feature return destinations', () => {
  it('keeps known feature destinations and falls back safely for arbitrary URLs', () => {
    expect(returnPage('/tabs/builder')).toEqual({ url: '/tabs/builder', label: 'Outfit Studio' });
    expect(returnPage('/tabs/analytics').label).toBe('Analytics');
    for (const url of [null, 'https://example.com', '//example.com', '/login', 'constructor', '__proto__']) {
      expect(returnPage(url)).toEqual({ url: '/tabs/wardrobe', label: 'Wardrobe' });
    }
  });
});
