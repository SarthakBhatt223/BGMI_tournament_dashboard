import { useEffect, useState } from 'react';

// Returns the first URL in `urls` that loads as an image, or null while checking / when none do.
// Used for optional files (player photos, custom artwork): a missing file simply yields null, so
// the caller falls back without any visible error.
export function useFirstLoadableImage(urls) {
  const key = urls.join('|');
  const [found, setFound] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const candidates = key === '' ? [] : key.split('|');
    setFound(null);
    (async () => {
      for (const url of candidates) {
        const loaded = await new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve(true);
          image.onerror = () => resolve(false);
          image.src = url;
        });
        if (cancelled) return;
        if (loaded) {
          setFound(url);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return found;
}
