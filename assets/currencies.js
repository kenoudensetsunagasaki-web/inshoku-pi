// Shared list of currencies the app recognizes. Extend this array to add
// more chains/tokens — every page (search filters, register form, submit
// form) reads from this single source so they never drift out of sync.
const CURRENCIES = [
  { code: "PI", label: "Pi", symbol: "π" },
  { code: "BTC", label: "Bitcoin", symbol: "₿" },
  { code: "ETH", label: "Ethereum", symbol: "Ξ" },
  { code: "USDT", label: "USDT", symbol: "₮" },
  { code: "USDC", label: "USDC", symbol: "$" },
  { code: "OTHER", label: "その他 / Other", symbol: "◆" },
];

function currencyLabel(code) {
  const c = CURRENCIES.find((c) => c.code === code);
  return c ? `${c.symbol} ${c.label}` : code;
}
