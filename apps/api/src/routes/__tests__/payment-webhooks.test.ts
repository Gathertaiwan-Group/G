import { describe, it, expect, vi, beforeEach } from "vitest"
import request from "supertest"

// Mock the data layer + verification libs so we can assert exactly which
// table/columns the webhooks read and write (this is the bug under test:
// they previously hit a non-existent `payment_transactions` table).
vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}))

// Partial-mock: keep PAYMENT_FIELDS etc. (used by other routes mounted in app)
// but stub getPaymentConfig so we don't need DB/env for credentials.
vi.mock("../../lib/provider-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/provider-config")>()
  return {
    ...actual,
    getPaymentConfig: vi.fn().mockResolvedValue({
      pchomepay_hash_key: "k",
      pchomepay_hash_iv: "iv",
      jkopay_secret_key: "secret",
    }),
  }
})

vi.mock("../../lib/pchomepay", () => ({
  verifyCheckMacValue: vi.fn(),
}))

vi.mock("../../lib/jkopay", () => ({
  verifySignature: vi.fn(),
}))

vi.mock("../../lib/enqueue-post-payment", () => ({
  enqueuePostPaymentJobs: vi.fn().mockResolvedValue(undefined),
}))

import { app } from "../../app"
import { supabase } from "../../lib/supabase"
import { verifyCheckMacValue } from "../../lib/pchomepay"
import { verifySignature } from "../../lib/jkopay"

const PAYMENT_ROW = { id: "pay-uuid-1", order_id: "order-uuid-1", amount: 50000 }

/**
 * Build a supabase.from() mock router that records the calls made against the
 * `payments` and `orders` tables so assertions can verify the webhook used the
 * correct table + lookup key + status values.
 */
function buildSupabaseMock(opts: { paymentFound: boolean }) {
  const calls = {
    webhookEventsInsert: vi.fn(),
    paymentsSelectEq: vi.fn(),
    paymentsUpdate: vi.fn(),
    paymentsUpdateEq: vi.fn(),
    ordersUpdate: vi.fn(),
    ordersUpdateEq: vi.fn(),
    tableNames: [] as string[],
  }

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    calls.tableNames.push(table)

    if (table === "webhook_events") {
      return {
        insert: (payload: unknown) => {
          calls.webhookEventsInsert(payload)
          // No idempotency conflict
          return Promise.resolve({ error: null })
        },
      } as any
    }

    if (table === "payments") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockImplementation(function (this: any, col: string, val: unknown) {
          // Distinguish the SELECT lookup from the UPDATE filter by what
          // method follows. We expose `single` for the lookup chain.
          calls.paymentsSelectEq(col, val)
          return {
            single: vi.fn().mockResolvedValue({
              data: opts.paymentFound ? PAYMENT_ROW : null,
              error: opts.paymentFound ? null : { message: "not found" },
            }),
          }
        }),
        update: (patch: unknown) => {
          calls.paymentsUpdate(patch)
          return {
            eq: (col: string, val: unknown) => {
              calls.paymentsUpdateEq(col, val)
              return Promise.resolve({ error: null })
            },
          }
        },
      } as any
    }

    if (table === "orders") {
      return {
        update: (patch: unknown) => {
          calls.ordersUpdate(patch)
          return {
            eq: (col: string, val: unknown) => {
              calls.ordersUpdateEq(col, val)
              return Promise.resolve({ error: null })
            },
          }
        },
      } as any
    }

    // default no-op chain
    return {
      insert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as any
  })

  return calls
}

describe("POST /webhooks/pchomepay", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("valid webhook locates the payments row, marks it paid, and flips orders.payment_status to 'paid'", async () => {
    vi.mocked(verifyCheckMacValue).mockReturnValue(true)
    const calls = buildSupabaseMock({ paymentFound: true })

    const res = await request(app)
      .post("/webhooks/pchomepay")
      .type("form")
      .send({ MerchantTradeNo: "RR1234567890", TradeNo: "PCT999", RtnCode: "1", CheckMacValue: "x" })

    expect(res.status).toBe(200)
    expect(res.text).toBe("1|OK")

    // (a) looked up the correct table by the correct lookup key
    expect(calls.tableNames).toContain("payments")
    expect(calls.tableNames).not.toContain("payment_transactions")
    expect(calls.paymentsSelectEq).toHaveBeenCalledWith("gateway_tx_id", "RR1234567890")

    // (b) set the payment row paid/captured
    expect(calls.paymentsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "captured" })
    )
    expect(calls.paymentsUpdateEq).toHaveBeenCalledWith("id", PAYMENT_ROW.id)

    // (c) flipped the linked order to paid
    expect(calls.ordersUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_status: "paid", status: "processing" })
    )
    expect(calls.ordersUpdateEq).toHaveBeenCalledWith("id", PAYMENT_ROW.order_id)
  })

  it("invalid CheckMacValue does NOT touch payments or orders", async () => {
    vi.mocked(verifyCheckMacValue).mockReturnValue(false)
    const calls = buildSupabaseMock({ paymentFound: true })

    const res = await request(app)
      .post("/webhooks/pchomepay")
      .type("form")
      .send({ MerchantTradeNo: "RR1234567890", RtnCode: "1", CheckMacValue: "bad" })

    expect(res.status).toBe(400)
    expect(calls.tableNames).not.toContain("payments")
    expect(calls.paymentsUpdate).not.toHaveBeenCalled()
    expect(calls.ordersUpdate).not.toHaveBeenCalled()
  })

  it("failed RtnCode marks payment + order failed (still uses payments table)", async () => {
    vi.mocked(verifyCheckMacValue).mockReturnValue(true)
    const calls = buildSupabaseMock({ paymentFound: true })

    const res = await request(app)
      .post("/webhooks/pchomepay")
      .type("form")
      .send({ MerchantTradeNo: "RR1234567890", RtnCode: "0", CheckMacValue: "x" })

    expect(res.status).toBe(200)
    expect(calls.paymentsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    )
    expect(calls.ordersUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_status: "failed" })
    )
  })
})

describe("POST /webhooks/jkopay", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("valid webhook locates the payments row, marks it paid, and flips orders.payment_status to 'paid'", async () => {
    vi.mocked(verifySignature).mockReturnValue(true)
    const calls = buildSupabaseMock({ paymentFound: true })

    const res = await request(app)
      .post("/webhooks/jkopay")
      .set("X-Signature", "validsig")
      .send({ merchant_trade_no: "RRJ1700000000000", trade_no: "JKT1", status: "SUCCESS" })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ result: "OK" })

    // (a) correct table + lookup key
    expect(calls.tableNames).toContain("payments")
    expect(calls.tableNames).not.toContain("payment_transactions")
    expect(calls.paymentsSelectEq).toHaveBeenCalledWith("gateway_tx_id", "RRJ1700000000000")

    // (b) payment row marked paid
    expect(calls.paymentsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "captured" })
    )
    expect(calls.paymentsUpdateEq).toHaveBeenCalledWith("id", PAYMENT_ROW.id)

    // (c) order flipped to paid
    expect(calls.ordersUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_status: "paid", status: "processing" })
    )
    expect(calls.ordersUpdateEq).toHaveBeenCalledWith("id", PAYMENT_ROW.order_id)
  })

  it("invalid signature does NOT touch payments or orders", async () => {
    vi.mocked(verifySignature).mockReturnValue(false)
    const calls = buildSupabaseMock({ paymentFound: true })

    const res = await request(app)
      .post("/webhooks/jkopay")
      .set("X-Signature", "bad")
      .send({ merchant_trade_no: "RRJ1700000000000", status: "SUCCESS" })

    expect(res.status).toBe(400)
    expect(calls.tableNames).not.toContain("payments")
    expect(calls.paymentsUpdate).not.toHaveBeenCalled()
    expect(calls.ordersUpdate).not.toHaveBeenCalled()
  })

  it("failed status marks payment + order failed (still uses payments table)", async () => {
    vi.mocked(verifySignature).mockReturnValue(true)
    const calls = buildSupabaseMock({ paymentFound: true })

    const res = await request(app)
      .post("/webhooks/jkopay")
      .set("X-Signature", "validsig")
      .send({ merchant_trade_no: "RRJ1700000000000", trade_no: "JKT1", status: "FAILED" })

    expect(res.status).toBe(200)
    expect(calls.paymentsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    )
    expect(calls.ordersUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_status: "failed" })
    )
  })
})
