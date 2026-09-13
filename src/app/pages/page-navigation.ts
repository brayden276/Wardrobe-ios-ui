const returnPages: Record<string, string> = {
  '/tabs/builder': 'Outfit Studio',
  '/tabs/outfits': 'Outfits',
  '/tabs/analytics': 'Analytics',
  '/tabs/getting-started': 'Getting Started',
  '/tabs/wardrobe': 'Wardrobe'
};

export function returnPage(value: string | null): { url: string; label: string } {
  const url = value && Object.prototype.hasOwnProperty.call(returnPages, value) ? value : '/tabs/wardrobe';
  return { url, label: returnPages[url] };
}
