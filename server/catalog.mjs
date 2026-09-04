/* SKU 허용 목록. 가격은 서버만 소유한다 — 클라이언트는 SKU 이름만 보낸다.
 *
 * Neon은 가격을 "통화 기본 단위의 100배" 정수로 받는다. 원화는 보조 단위가 없어서
 * ₩4,900이 490000으로 나가는데, 이게 한국 개발자 눈에는 100배 오류처럼 보인다.
 * 그래서 배수는 이 표 한 곳에만 두고, 표시 문자열은 절대 손으로 적지 않는다
 * (예전에 '₩4,900'을 상수로 박아 뒀다가 가격과 표시가 따로 노는 버그가 있었다). */
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
    names: Object.freeze({ ko: '별빛 개척자 깃발', en: 'Celestial Pioneer Banner' }),
    subtitles: Object.freeze({
      ko: '전투 능력에 영향을 주지 않는 영구 치장품',
      en: 'A permanent cosmetic with no gameplay benefit',
    }),
    prices: Object.freeze({ KRW: 490000, USD: 499 }),
  }),
});

/* Neon 정수(기본 단위 × 100)를 사람이 읽는 문자열로. KRW는 소수점 0자리,
 * USD는 2자리 — Intl이 통화별 자릿수를 알고 있으므로 직접 계산하지 않는다. */
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
      name: product.names[lang],
      subtitle: product.subtitles[lang],
      currency,
      price: product.prices[currency],
      displayPrice: formatPrice(product.prices[currency], currency),
    }));
}

/* Neon /checkout 의 items[] 한 항목. 문서에서 확인한 필드만 보낸다 —
 * bundleContents/taxCode는 요청 레퍼런스에서 확인되지 않아 일부러 뺐다. */
export function checkoutItem(sku, { locale, country }) {
  const product = PRODUCTS[sku];
  if (!product) return null;
  const { currency } = marketFor(country);
  const price = product.prices[currency];
  if (!price) return null;
  const lang = locale === 'en' ? 'en' : 'ko';
  return {
    item: { sku: product.sku, name: product.names[lang], subtitle: product.subtitles[lang], price, quantity: 1 },
    currency,
    entitlement: product.entitlement,
  };
}
