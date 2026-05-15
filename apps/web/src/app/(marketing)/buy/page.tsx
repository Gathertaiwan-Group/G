// Public landing/pricing page. The Checkout URL is injected via
// NEXT_PUBLIC_STRIPE_CHECKOUT_URL — TEST-mode link until GA. Flipping it to a
// LIVE Stripe payment link is a USER-ACTIONABLE step (see
// docs/ga-go-live-checklist.md). No secret keys ever live in this file.
export const metadata = { title: "Get your own branded store" }

export default function BuyPage() {
  const checkoutUrl = process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_URL || "#"
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 32 }}>
      <h1>Your own branded online store, live in minutes</h1>
      <p>
        A fully managed e-commerce site — products, orders, subscriptions,
        campaigns — controllable by your own AI agent over MCP.
      </p>
      <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 24, marginTop: 24 }}>
        <h2>Standard</h2>
        <p style={{ fontSize: 28, fontWeight: 700 }}>NT$10,000 / month</p>
        <ul>
          <li>Branded storefront on a platform subdomain (BYO domain supported)</li>
          <li>Admin dashboard + AI-agent control (MCP)</li>
          <li>Subscriptions, campaigns, CMS, membership tiers</li>
          <li>Automated setup — live in 5–8 minutes</li>
        </ul>
        <a
          href={checkoutUrl}
          style={{
            display: "inline-block", marginTop: 16, padding: "10px 20px",
            background: "#2d3436", color: "#fff", borderRadius: 6,
            textDecoration: "none",
          }}
        >
          Get started
        </a>
      </section>
      <p style={{ marginTop: 16, fontSize: 13, color: "#666" }}>
        Questions? Email us — we reply within one business day.
      </p>
    </main>
  )
}
