/* Server-owned SKU allowlist and prices. Neon expects integers at 100 times the currency base unit: KRW 4,900 is 490000. Keep numeric prices here and derive display strings; hardcoded display prices previously drifted from checkout amounts. */
export const MARKETS = Object.freeze({
  KR: Object.freeze({ currency: 'KRW', displayLocale: 'ko-KR' }),
  US: Object.freeze({ currency: 'USD', displayLocale: 'en-US' }),
});

export const DEFAULT_COUNTRY = 'KR';

/* A country with no row here is priced on the USD row, as a reference, until Neon's pricing sheet answers for it (server/pricing.mjs). The checkout still declares the country the player is in: relabelling a Japanese player as Korean to reach a price row is a tax statement made for our own convenience. This is not Neon's Global Store — that is Neon's fallback for countries it does not serve locally (Japan is served, in JPY), and only Neon's answer says a country is in it. */
const REFERENCE_MARKET = Object.freeze({ currency: 'USD', displayLocale: 'en-US' });

export function marketFor(country) {
  return MARKETS[String(country || '').toUpperCase()] || REFERENCE_MARKET;
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
    /* Neon pricing-sheet tier. Tier codes name the USD anchor (Neon's example: tier 3.99 is USD 3.99, CAD 5.39, JPY 600), so each matches the USD row. Whether the sandbox's sheet carries these three is known only once a lookup answers; a sheet without them leaves the catalogue's rows in charge. */
    priceTierCode: '4.99',
  }),
  AURORA_SPIRES: Object.freeze({
    sku: 'AURORA_SPIRES', entitlement: 'cosmetic.aurora_spires', permanent: true,
    names: Object.freeze({ ko: '오로라 수정 첨탑', en: 'Aurora Crystal Spires' }),
    subtitles: Object.freeze({ ko: '성 위에 빛나는 푸른 수정 장식', en: 'Tall turquoise crystals crown both watchtowers' }),
    prices: Object.freeze({ KRW: 390000, USD: 399 }),
    priceTierCode: '3.99',
  }),
  GOLDEN_SENTINELS: Object.freeze({
    sku: 'GOLDEN_SENTINELS', entitlement: 'cosmetic.golden_sentinels', permanent: true,
    names: Object.freeze({ ko: '황금 성문 수호상', en: 'Golden Gate Sentinels' }),
    subtitles: Object.freeze({ ko: '성문 양옆을 장식하는 황금 수호상', en: 'Two golden guardians flank the castle gate' }),
    prices: Object.freeze({ KRW: 590000, USD: 599 }),
    priceTierCode: '5.99',
  }),
});

/* Convert Neon base-unit-times-100 integers with Intl: KRW uses zero fraction digits and USD uses two. */
export function formatPrice(price, currency) {
  const market = Object.values(MARKETS).find((entry) => entry.currency === currency);
  return new Intl.NumberFormat(market?.displayLocale || 'en-US', { style: 'currency', currency })
    .format(price / 100);
}

/* Every product's price for one country. Neon's pricing sheet decides when its answer is for this country and covers every tier here — all or nothing, so one list never mixes currencies or sources. Otherwise the rows above, with countries outside them on the USD reference row. */
export function priceList(country, localized = null) {
  const code = String(country || '').toUpperCase();
  if (localized?.supported && localized.country === code) {
    const rows = {};
    const complete = Object.values(PRODUCTS).every((product) => {
      const tier = localized.tiers?.[product.priceTierCode];
      if (!Number.isFinite(tier?.price) || typeof tier?.localizedPrice !== 'string') return false;
      rows[product.sku] = { price: tier.price, displayPrice: tier.localizedPrice, priceTierCode: product.priceTierCode };
      return true;
    });
    if (complete) return { currency: localized.currency, source: 'neon', globalStore: localized.globalStore === true, unpriced: false, rows };
  }
  const { currency } = marketFor(code);
  const rows = {};
  for (const product of Object.values(PRODUCTS)) {
    const price = product.prices[currency];
    if (price) rows[product.sku] = { price, displayPrice: formatPrice(price, currency) };
  }
  return { currency, source: 'catalogue', globalStore: false, unpriced: !Object.hasOwn(MARKETS, code), rows };
}

export function publicCatalog(locale, prices) {
  const lang = locale === 'en' ? 'en' : 'ko';
  return Object.values(PRODUCTS)
    .filter((product) => prices.rows[product.sku])
    .map((product) => ({
      sku: product.sku,
      entitlement: product.entitlement,
      name: product.names[lang],
      subtitle: product.subtitles[lang],
      currency: prices.currency,
      price: prices.rows[product.sku].price,
      displayPrice: prices.rows[product.sku].displayPrice,
    }));
}

/* One Neon /checkout items entry. A Neon-priced list sends the tier code and Neon prices it for the declared country; the catalogue's rows send the amount. bundleContents and taxCode have documented defaults; this non-bundle cosmetic uses the smaller payload verified in the sandbox. */
export function checkoutItem(sku, { locale, country, localized = null }) {
  const product = Object.hasOwn(PRODUCTS, sku) ? PRODUCTS[sku] : null;
  if (!product) return null;
  const prices = priceList(country, localized);
  const row = prices.rows[product.sku];
  if (!row) return null;
  const lang = locale === 'en' ? 'en' : 'ko';
  const amount = row.priceTierCode ? { priceTierCode: row.priceTierCode } : { price: row.price };
  return {
    item: { sku: product.sku, name: product.names[lang], subtitle: product.subtitles[lang], ...amount, quantity: 1 },
    currency: prices.currency,
    entitlement: product.entitlement,
    permanent: product.permanent === true,
    unpriced: prices.unpriced,
    /* What Neon quoted for the tier. Recorded for the audit trail, not compared: the checkout amount is Neon's to set. */
    quotedPrice: row.priceTierCode ? row.price : null,
  };
}
