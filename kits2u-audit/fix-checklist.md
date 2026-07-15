# Kits2u.au — Step-by-Step Fix Checklist (WP Admin)

Work top to bottom. Everything in Part 1 must be done before spending a single dollar or hour on marketing. Times are rough estimates.

> **Before you start:** take a full site backup (host control panel, or a plugin like UpdraftPlus). Several steps below change store settings.

---

## Part 1 — Make it possible to buy (do these first)

### 1.1 Switch the store to AUD (5 min)
1. WP Admin → **WooCommerce → Settings → General**.
2. Set **Currency** = Australian dollar (A$), **Selling location** = Sell to specific countries → Australia, **Default customer location** = Shop country/region.
3. Save. Prices keep their numbers (a $2,600 product becomes A$2,600) — **review every product & variation price afterwards** to confirm they're the AUD figures you intend. Your test-cart price matrix produced $6,114.63 for a 12m×2m Fixed-to-Timber kit — sanity-check that against your cost sheet.

### 1.2 Enable payment methods (1–2 hours incl. account signup)
Recommended set for $1.8k–$6k orders:

1. **Direct bank transfer (EFT)** — free, instant to enable, and popular in Australia for large amounts:
   - WooCommerce → Settings → **Payments** → enable **Direct bank transfer**, enter your BSB/account details, and set the instructions text ("Your order ships once payment clears, usually 1 business day").
2. **Cards via Stripe**:
   - Install the **WooCommerce Stripe Payment Gateway** plugin (Plugins → Add New → search "Stripe WooCommerce").
   - Create a Stripe account at stripe.com (needs ABN, bank account, ID). Connect it in WooCommerce → Settings → Payments → Stripe.
3. **PayPal** (optional but adds buyer confidence): install **WooCommerce PayPal Payments**, connect a PayPal Business account.
4. Consider **Afterpay/Zip later** — their limits are usually below your ticket size; skip for now.

> Note: your checkout uses the **block-based checkout**, so any gateway you add must support WooCommerce Blocks — Stripe, PayPal Payments, and the built-in bank transfer all do.

### 1.3 Fix the WooCommerce page mapping (15 min)
The store is currently wired to leftover demo pages (`/shop-2/`, `/cart-2/`, `/checkout-2/`, `/my-account-2/`) and has **no Terms or Privacy page set**.

1. WooCommerce → Settings → **Advanced**: set **Cart page** = "Cart" (`/cart/`), **Checkout page** = "Checkout" (`/checkout/`), **My account page** = "My account" (`/my-account/`), **Terms and conditions** = your "Terms and conditions" page.
2. Appearance → Customize (or WooCommerce → Settings → Products) → set **Shop page** to the real shop page.
3. Settings → **Privacy** → set the Privacy Policy page (currently `/privacy-policy-2/` — rename its slug to `/privacy-policy/` first: Pages → Quick Edit).
4. Then **delete the demo duplicates**: Pages → move to bin: `Shop (shop-2)` if a proper one exists, `Shopping Cart (cart-2)`, `Checkout (checkout-2)`, `My Account (my-account-2)`, `Coming soon`, and the older duplicate of any page you keep. Empty the bin after confirming the site still works.

### 1.4 Set up shipping (30–60 min, plus a freight decision)
Products currently report `needs_shipping: false` — they're likely marked **Virtual** or have no shipping class, and no shipping zones exist.

1. Open each product → Product data → **untick "Virtual"** if ticked, and enter approximate weight/dimensions.
2. WooCommerce → Settings → **Shipping** → create a zone "Australia" and pick ONE model to start:
   - **Simplest:** Flat rate per state/metro (e.g. "Delivery: $XXX, quoted exactly after order for regional areas"), or
   - **Free shipping** with the freight cost built into prices (then the banner becomes true), or
   - **Local pickup** + "freight quoted via the quote form" while you sort a carrier.
3. If freight is genuinely free, keep the "ENJOY FREE SHIPPING" banner. Otherwise change it (see copy-pack).

### 1.5 Place a test order (30 min) ✅ the acceptance test
1. Enable Stripe **test mode**, or use bank transfer.
2. Go through the entire flow on your phone: pick a kit → choose size/colours → add to cart → checkout → pay → confirm you receive the order email and the customer confirmation email arrives (check spam).
3. WooCommerce → Settings → **Emails**: confirm "New order" goes to admin@kits2u.au and customer emails are enabled.

---

## Part 2 — Make it trustworthy

### 2.1 Fix the site title & tagline (5 min)
- Settings → **General**: Site Title = `Kits2u`, Tagline = `DIY Patio & Carport Kits Australia`.
- The homepage `<title>` currently reads "Elementor WooCommerce WordPress Theme" — if it persists after the settings change, it's set in the theme/Elementor page settings (edit the homepage with Elementor → ⚙ Settings → check the page title), or fix it via the SEO plugin in step 3.1.

### 2.2 Kill the demo banner (10 min)
The header of every page says "Up to 40% off Best-Selling Furniture. Shop Now".
- Edit the header template: Appearance → Editor, or Elementor → **Theme Builder → Header** (or the theme's "Topbar" option under Appearance → Customize).
- Replace with a true statement — see copy-pack for options.

### 2.3 Replace lorem ipsum product copy (30 min)
- Products → edit each product → **Short description** field → paste from `copy-pack.md`.

### 2.4 Delete the demo product & fix slugs (15 min)
- Products → "Gable Carport – Single Skin" ($0, out of stock, slug `wood-outdoor-adirondack-chair`) → **Bin** (or finish it properly with a real price/photos before publishing).
- Fix slugs (Products → Quick Edit → Slug):
  - Flyover Patio Kit: `7360` → `flyover-patio-kit-insulated`
  - Double Carport: `freestanding-patio-kits-diy-insulated-roof-with-customizable-posts` → `double-carport-kit-freestanding`
- Old URLs will 404; if the site had traffic you'd add redirects, but since it's not yet indexed this is the perfect time to fix slugs consequence-free.

### 2.5 Contact & legal trust signals (30 min)
1. Add a **phone number** to: the header top bar, the contact page, and the footer. (The markup currently contains a garbled `04460492503130` — looks like `0446 049 250` + postcode `3130` mashed together; fix wherever that widget is.)
2. Contact page: replace "Headquarter:" (blank) with your suburb/state at minimum; fix the typo "**Saturady**" → "Saturday".
3. Footer: add **ABN** and business name — Australians check this for any big purchase.
4. Point the footer social icons at real profiles, or remove the ones that don't exist yet.

### 2.6 Gallery (1 hour)
Remove images belonging to other businesses (`Apollo-Patios-…`, `…Enigma-Outdoors…`) and the ChatGPT-generated image. Replace with:
- your own installation photos, or
- your supplier/manufacturer's official product photos **with permission**, captioned as such.
Three honest photos beat twenty borrowed ones — and competitors' photos in your gallery are a copyright complaint waiting to happen.

---

## Part 3 — Make it findable & measurable

### 3.1 SEO plugin + sitemap + Search Console (1 hour)
1. Plugins → Add New → install **Rank Math SEO** (free) → run the setup wizard.
2. This fixes: proper title templates, meta descriptions (paste from copy-pack), and generates a sitemap at `/sitemap_index.xml` (currently `/sitemap.xml` → `/wp-sitemap.xml` → **404**).
3. Go to **Google Search Console** (search.google.com/search-console) → add property `kits2u.au` → verify (Rank Math offers the verification snippet) → **submit the sitemap** → use "URL inspection" to request indexing of the homepage and each product.
4. While you're there: **Bing Webmaster Tools** takes 10 minutes and imports from Search Console.

### 3.2 Analytics (30 min)
1. Create a **GA4** property at analytics.google.com.
2. Install via **Site Kit by Google** plugin (also links Search Console) or Rank Math's integration.
3. Turn on WooCommerce ecommerce events (Site Kit does this automatically) so you see add-to-carts and checkout abandonment.

### 3.3 Performance quick wins (optional this month)
- The homepage loads 32 stylesheets + 29 scripts. Quick wins: install a caching plugin (LiteSpeed Cache/WP Rocket/whatever your host recommends), lazy-load images, and if Slider Revolution is only used for the hero, consider replacing it with a static Elementor hero image — sliders hurt speed and rarely convert better.
- Test before/after at pagespeed.web.dev on **mobile**.

---

## Acceptance checklist — "the site can now take a sale"

- [ ] A stranger on a phone can pay by card AND see a bank-transfer option
- [ ] Prices show and charge in **AUD**
- [ ] Shipping cost (or pickup/quote path) is clear before payment
- [ ] Checkout links to Terms & Privacy
- [ ] No lorem ipsum, no furniture banner, no $0 demo product anywhere
- [ ] Phone number + ABN visible site-wide
- [ ] `site:kits2u.au` in Google shows your pages (allow 1–2 weeks after sitemap submission)
- [ ] GA4 shows your own test visit
