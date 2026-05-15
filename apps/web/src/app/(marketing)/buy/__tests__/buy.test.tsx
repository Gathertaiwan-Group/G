import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import BuyPage from "../page"

describe("BuyPage", () => {
  it("renders pricing and a Checkout CTA pointing at the configured (test-mode) link", () => {
    process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_URL = "https://buy.stripe.com/test_abc"
    render(<BuyPage />)
    expect(screen.getByText(/NT\$10,000/)).toBeTruthy()
    const cta = screen.getByRole("link", { name: /get started|buy|start/i })
    expect(cta.getAttribute("href")).toBe("https://buy.stripe.com/test_abc")
  })
  it("falls back to a safe placeholder when no checkout URL is configured", () => {
    delete process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_URL
    render(<BuyPage />)
    expect(screen.getByRole("link", { name: /get started|buy|start/i })
      .getAttribute("href")).toBe("#")
  })
})
