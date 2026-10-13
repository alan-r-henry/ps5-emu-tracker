/** Where the site is published, and the optional visit counter. Changing either needs a rebuild. */
export const SITE = {
  url: 'https://alan-r-henry.github.io/ps5-emu-tracker/',
  /**
   * GoatCounter site code: "ps5tracker" for ps5tracker.goatcounter.com. Empty turns counting off.
   * GoatCounter's own script never loads; the page requests a 1×1 image from the count endpoint, so no
   * third-party code runs here, no cookies are set and no personal data is stored.
   */
  goatcounter: '',
};

/** Records one visit. Skipped on localhost so local testing doesn't inflate the numbers. */
export function countVisit(): void {
  const code = SITE.goatcounter;
  if (!/^[a-z0-9-]{1,50}$/.test(code) || /^(localhost|127\.|\[::1\])/.test(location.hostname)) return;
  const q = new URLSearchParams({
    p: location.pathname,
    t: document.title,
    r: document.referrer,
    s: `${screen.width},${screen.height},${devicePixelRatio || 1}`,
    rnd: Math.random().toString(36).slice(2),
  });
  new Image().src = `https://${code}.goatcounter.com/count?${q}`;
}
