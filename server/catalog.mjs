/* Server-owned SKU allowlist and prices. Neon expects integers at 100 times the currency base unit: KRW 4,900 is 490000. Keep numeric prices here and derive display strings; hardcoded display prices previously drifted from checkout amounts. */
export const MARKETS = Object.freeze({
  KR: Object.freeze({ currency: 'KRW', displayLocale: 'ko-KR' }),
  US: Object.freeze({ currency: 'USD', displayLocale: 'en-US' }),
});

export const DEFAULT_COUNTRY = 'KR';

/* Countries this catalogue does not price are Neon's Global Store: the checkout still declares the country the player is actually in and is priced in USD, rather than being relabelled as one of the two markets below. Declaring a Japanese player Korean to reach a price is a tax statement made for our own convenience. */
export const GLOBAL_MARKET = Object.freeze({ currency: 'USD', displayLocale: 'en-US', global: true });

export function marketFor(country) {
  return MARKETS[String(country || '').toUpperCase()] || GLOBAL_MARKET;
}

/* A market with its own price row here. Everything else is valid and handled by the Global Store. */
export function isSupportedCountry(country) {
  return Object.hasOwn(MARKETS, String(country || '').toUpperCase());
}

/* ISO 3166-1 alpha-2 shape, minus the user-assigned ranges (AA, QM-QZ, XA-XZ, ZZ). Those name no jurisdiction, and geolocation uses them for exactly that: Cloudflare reports XX for an unresolved address and T1 for Tor, which the shape test already rejects. */
export function isCountryCode(value) {
  const country = String(value || '').toUpperCase();
  return /^[A-Z]{2}$/.test(country) && !/^(AA|Q[M-Z]|X[A-Z]|ZZ)$/.test(country);
}

export const PRODUCTS = Object.freeze({
  CELESTIAL_BANNER: Object.freeze({
    sku: 'CELESTIAL_BANNER',
    entitlement: 'cosmetic.celestial_banner',
    /* Permanent items cannot be repurchased while owned. Consumables would need quantity accounting rather than a boolean ownership check. */
    permanent: true,
    names: Object.freeze({ ko: '별빛 개척자 깃발', en: 'Celestial Pioneer Banner' }),
    subtitles: Object.freeze({
      ko: '전투 능력에 영향을 주지 않는 영구 치장품',
      en: 'A permanent cosmetic with no gameplay benefit',
    }),
    prices: Object.freeze({ KRW: 490000, USD: 499 }),
  }),
  AURORA_SPIRES: Object.freeze({
    sku: 'AURORA_SPIRES', entitlement: 'cosmetic.aurora_spires', permanent: true,
    names: Object.freeze({ ko: '오로라 수정 첨탑', en: 'Aurora Crystal Spires' }),
    subtitles: Object.freeze({ ko: '성 위에 빛나는 푸른 수정 장식', en: 'Tall turquoise crystals crown both watchtowers' }),
    prices: Object.freeze({ KRW: 390000, USD: 399 }),
  }),
  GOLDEN_SENTINELS: Object.freeze({
    sku: 'GOLDEN_SENTINELS', entitlement: 'cosmetic.golden_sentinels', permanent: true,
    names: Object.freeze({ ko: '황금 성문 수호상', en: 'Golden Gate Sentinels' }),
    subtitles: Object.freeze({ ko: '성문 양옆을 장식하는 황금 수호상', en: 'Two golden guardians flank the castle gate' }),
    prices: Object.freeze({ KRW: 590000, USD: 599 }),
  }),
});

/* Convert Neon base-unit-times-100 integers with Intl: KRW uses zero fraction digits and USD uses two. */
export function formatPrice(price, currency) {
  const market = Object.values(MARKETS).find((entry) => entry.currency === currency);
  return new Intl.NumberFormat(market?.displayLocale || 'en-US', { style: 'currency', currency })
    .format(price / 100);
}

export function publicCatalog(locale, country) {
  const lang = locale === 'en' ? 'en' : 'ko';
  const { currency } = marketFor(country);
  return Object.values(PRODUCTS)
    .filter((product) => product.prices[currency])
    .map((product) => ({
      sku: product.sku,
      entitlement: product.entitlement,
      name: product.names[lang],
      subtitle: product.subtitles[lang],
      currency,
      price: product.prices[currency],
      displayPrice: formatPrice(product.prices[currency], currency),
    }));
}

/* One Neon /checkout items entry. bundleContents and taxCode have documented defaults; this non-bundle cosmetic uses the smaller payload verified in the sandbox. */
export function checkoutItem(sku, { locale, country }) {
  const product = Object.hasOwn(PRODUCTS, sku) ? PRODUCTS[sku] : null;
  if (!product) return null;
  const { currency } = marketFor(country);
  const price = product.prices[currency];
  if (!price) return null;
  const lang = locale === 'en' ? 'en' : 'ko';
  return {
    item: { sku: product.sku, name: product.names[lang], subtitle: product.subtitles[lang], price, quantity: 1 },
    currency,
    entitlement: product.entitlement,
    permanent: product.permanent === true,
  };
}
