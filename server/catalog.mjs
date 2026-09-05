/* Server-owned SKU allowlist and prices. Neon expects integers at 100 times the currency base unit: KRW 4,900 is 490000. Keep numeric prices here and derive display strings; hardcoded display prices previously drifted from checkout amounts. */
export const MARKETS = Object.freeze({
  KR: Object.freeze({ currency: 'KRW', displayLocale: 'ko-KR' }),
  US: Object.freeze({ currency: 'USD', displayLocale: 'en-US' }),
});

export const DEFAULT_COUNTRY = 'KR';

export function marketFor(country) {
  return MARKETS[country] || MARKETS[DEFAULT_COUNTRY];
}

export function isSupportedCountry(country) {
  return Object.hasOwn(MARKETS, String(country || '').toUpperCase());
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
