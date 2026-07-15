# Kits2u.au — Website Audit & First-Sale Roadmap

**Audit date:** 15 July 2026
**Method:** Live analysis of the public site — homepage, all products, a real cart/checkout test via the WooCommerce Store API, every key page, SEO signals, and Google search presence.

**Platform:** WordPress 7.0.1 + WooCommerce 10.9.4 + Elementor 4.1.5 + Slider Revolution (theme demo import)

---

## The one-paragraph summary

The site looks like a real store, but **no one can buy from it**: the checkout has **zero payment methods configured**, the store currency is set to **USD instead of AUD**, and the site is **not indexed in Google at all** — searching "kits2u" returns only competitors. On top of that, visible leftovers from the theme demo (a "40% off Furniture" banner, lorem ipsum product text, a $0 demo product) undermine trust for a $2,000–$6,000+ purchase. The good news: the underlying content (FAQs, warranty, blog, product configurator) is genuinely decent, and every blocker below is fixable in WP admin in a few hours to a few days.

---

## Findings by severity

### 🔴 P0 — Sale blockers (a customer physically cannot buy)

| # | Finding | Evidence | Impact |
|---|---------|----------|--------|
| 1 | **No payment methods at checkout** | With a real kit in the cart, the checkout renders `paymentMethodData: []`; the Store API returns `payment_methods: []` | **It is impossible to complete a purchase.** This alone explains zero sales. |
| 2 | **Store currency is USD, not AUD** | Store API and `wcSettings` both report `currency: USD` | An Australian buying a $6,114 kit would be charged in US dollars (~AU$9,300). Also breaks any future payment gateway setup for an AU business. |
| 3 | **No shipping configured; products flagged as not needing shipping** | Cart API: `needs_shipping: false`, no shipping rates; header banner claims "ENJOY FREE SHIPPING" | Freight for 6–12 m steel kits is undefined. Either you eat an unquoted freight cost, or the customer hits a confusing checkout. The free-shipping promise is currently unbacked. |
| 4 | **WooCommerce store pages point at leftover demo pages** | Store config: shop → `/shop-2/`, cart → `/cart-2/`, checkout → `/checkout-2/`, my-account → `/my-account-2/`; Terms & Privacy pages **unset** | Duplicate cart/checkout/shop pages exist; checkout shows no Terms/Privacy links (a legal requirement and a trust signal for big-ticket purchases). |

### 🟠 P1 — Trust killers (visible demo/placeholder content)

For a considered purchase of thousands of dollars, buyers actively look for reasons to distrust a site they've never heard of. Right now the site provides several:

| # | Finding | Evidence |
|---|---------|----------|
| 5 | Homepage title tag is the **theme's placeholder** | `<title>Kits 2U. – Elementor WooCommerce WordPress Theme</title>` — this is what shows in the browser tab and in Google |
| 6 | Site-wide banner sells **furniture** | "Up to 40% off Best-Selling Furniture. Shop Now" appears in the header of every page — demo text from the theme |
| 7 | **Lorem ipsum** product short descriptions | e.g. Single Carport Kit: "Aliquam condimentum dictum gravida. Sed eu odio id lorem fermentum faucibus…" |
| 8 | **Demo product remnant** live in the shop | "Gable Carport – Single Skin": $0.00, out of stock, permalink slug `/product/wood-outdoor-adirondack-chair/` (an Adirondack chair slug from the demo). Also: Flyover kit lives at `/product/7360/` (bare ID slug) and the Double Carport uses the Flyover kit's descriptive slug |
| 9 | **No phone number anywhere**; contact page says "Headquarter:" with **no address**, has a typo ("Saturady"), and only lists admin@kits2u.au. No ABN displayed. A garbled digit string (`04460492503130`) sits in the page markup — looks like a mobile number merged with a postcode | Nobody spends $4k with a business they can't call. Phone + ABN + address are the cheapest trust wins available |
| 10 | Gallery uses **other companies' project photos** | Image filenames include `Apollo-Patios-Insulated-Veranda.jpg` and `9-West-Coorang-Rd-Enigma-Outdoors…` (both are competing AU patio businesses), plus a `ChatGPT-Image-…` file. Copyright risk + instantly recognizable to anyone comparing sites |
| 11 | No H1 on the homepage; hero sections duplicated 4× in the markup; **no reviews/testimonials anywhere** on the site | Weak SEO signal + nothing that says "real customers exist" |

### 🟡 P2 — Zero acquisition (nobody can find the site)

| # | Finding | Evidence |
|---|---------|----------|
| 12 | **Not indexed in Google** | A search for "kits2u" returns only competitors (SmartKits, Online Patios, Concept Kits…). `/sitemap.xml` redirects to `/wp-sitemap.xml` which returns **404** — there is no working sitemap. No SEO plugin installed, no meta descriptions on any page |
| 13 | **No analytics whatsoever** | No GA4, no Google Tag Manager, no Meta pixel. You cannot see how many visitors you get, where they come from, or where they drop off |
| 14 | Heavy front end | 32 stylesheets + 29 scripts on the homepage; Slider Revolution + Elementor stack. Slower loads cost conversions, especially on mobile |

### ✅ What's already good

- **FAQs, Warranty, About Us, and Blog pages have real, well-written content** — no placeholders.
- The **product configurator** is genuinely strong: size (length × width) plus Colorbond® colour selection for roof, beams, posts, and gutters. This is competitive with the big players.
- A working **quote/contact form** with a 24-hour response promise.
- The niche is proven — SmartKits, Online Patios, Concept Kits, Patios Wholesale all sell essentially this product profitably online.

---

## Current catalogue (as audited)

| Product | Listed price | Notes |
|---|---|---|
| Single Carport Kit – Freestanding | $2,600–$3,100 | Lorem ipsum short description |
| Double Carport Kit – Freestanding | $3,400+ | Wrong slug (uses Flyover kit's slug) |
| Flyover Patio Kits – DIY Insulated Roof | $2,709.47 | Slug is `/product/7360/` |
| Fixed-to-Timber Fascia Patio Kits | $1,822.15 | — |
| Attached Insulated Patio/Carport – Masonry/Brick/Concrete | $2,000 (on sale) | — |
| Gable Carport – Single Skin | $0.00, out of stock | **Demo remnant — delete or finish it** |

A test cart (Fixed-to-Timber kit, 12m × 2m) totalled **$6,114.63 USD** — worth double-checking the variation price matrix once currency is switched to AUD.

---

## The roadmap

### Week 1 — Make it possible to buy (P0)
1. Switch currency to AUD and re-verify every product/variation price.
2. Enable payment methods: Stripe (cards) + PayPal, plus **direct bank transfer** — many Australians paying $3–6k prefer EFT, and it costs you 0% in fees.
3. Decide the freight model (flat rate per zone, quote-after-order, or pickup) and configure it; fix or remove the "FREE SHIPPING" banner.
4. Repoint WooCommerce pages to the real cart/checkout/shop; set Terms & Privacy; delete the `-2` demo pages.
5. **Place a real test order end-to-end** (small test product, then refund).

### Week 2 — Make it trustworthy (P1)
6. Fix the site title, kill the furniture banner, replace lorem ipsum with the copy in `copy-pack.md`.
7. Delete the demo product; fix product slugs.
8. Add a phone number (site-wide header + contact page), ABN, and a real address or at least a suburb/state; fix the "Saturady" typo.
9. Replace competitor photos in the gallery with your own installs — even 3 genuine photos beat 20 borrowed ones. If you have no installs yet, use supplier product photography with permission and label it.

### Weeks 3–4 — Make it findable (P2)
10. Install Rank Math (or Yoast), generate a sitemap, verify the site in **Google Search Console**, and submit the sitemap.
11. Add the meta titles/descriptions from `copy-pack.md`.
12. Install **GA4** so every later decision is data-driven.
13. Create a **Google Business Profile** — for "patio kits [city]" searches this can outrank your website for months.
14. Work `first-sale-playbook.md` — the first sale will almost certainly come from quote-led selling and local channels, not organic SEO.

---

## Files in this audit pack

| File | What it's for |
|---|---|
| `README.md` | This report — findings + roadmap |
| `fix-checklist.md` | Click-by-click WP admin instructions for every fix above |
| `copy-pack.md` | Ready-to-paste SEO titles, meta descriptions, product copy, and homepage copy |
| `first-sale-playbook.md` | The go-to-market plan for landing the first sale in 2–4 weeks |
