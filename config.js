window.APP_CONFIG = {
  APP_NAME: "IP Lookup",
  SITE_URL: "https://iplookup-tool.vercel.app",   // replaced after deploy
  ADSENSE_CLIENT: "",                  // e.g. "ca-pub-1234567890123456" – empty = placeholders shown
  GA_ID: "",                           // e.g. "G-XXXXXXX"
  PRO_CHECKOUT_URL: "",                // Lemon Squeezy / Gumroad / Stripe Payment Link
  PRO_PRICE: "$9",                     // one-time (lifetime) – shown in UI
  LICENSE: {                           // Lemon Squeezy License API – fill in to validate keys for real
    provider: "lemonsqueezy",
    store_id: "",                      // from Lemon Squeezy > Settings > Stores (numeric id)
    product_id: "",                    // the Pro product id (numeric)
    variant_id: "",                    // optional: restrict to one variant
    recheck_days: 7,                   // re-validate silently every N days
    test_keys: []                      // local-only keys for your own testing, e.g. ["BE-TEST-KEY-1"]
  },
  NEWSLETTER: {                        // lead capture; card hidden while url is empty
    url: "",                           // e.g. "https://formspree.io/f/xxxx" or "https://app.convertkit.com/forms/123/subscriptions"
    field: "email"                     // input name the provider expects (ConvertKit: "email_address")
  },
  PAYMENTS: {                          // Mercado Pago through the bm-payments service (takes precedence over LICENSE / PRO_CHECKOUT_URL)
    url: "https://bm-payments.vercel.app",
    app: "iplookup"   // catalog key in bm-payments/catalog.js
  },
  AFFILIATE_LINKS: {}                  // app-specific affiliate CTAs
};
