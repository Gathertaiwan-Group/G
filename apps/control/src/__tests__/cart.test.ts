import { describe, it, expect, beforeEach, vi } from "vitest"
import { useCart, type CartItem } from "@/lib/cart"

// Silence sonner toast calls
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    variantId: "v1",
    productName: "Protein Powder",
    variantName: "1kg",
    price: 500,
    qty: 1,
    ...overrides,
  }
}

describe("Cart Zustand store", () => {
  beforeEach(() => {
    // Reset store to empty state before each test
    useCart.setState({ items: [] })
  })

  /* ---- addItem ---- */

  describe("addItem", () => {
    it("adds an item to an empty cart", () => {
      useCart.getState().addItem(makeItem())
      const items = useCart.getState().items
      expect(items).toHaveLength(1)
      expect(items[0].variantId).toBe("v1")
      expect(items[0].qty).toBe(1)
    })

    it("increments qty when adding a duplicate variantId", () => {
      useCart.getState().addItem(makeItem({ qty: 2 }))
      useCart.getState().addItem(makeItem({ qty: 3 }))
      const items = useCart.getState().items
      expect(items).toHaveLength(1)
      expect(items[0].qty).toBe(5)
    })

    it("adds multiple different items", () => {
      useCart.getState().addItem(makeItem({ variantId: "v1" }))
      useCart.getState().addItem(makeItem({ variantId: "v2", productName: "Creatine" }))
      expect(useCart.getState().items).toHaveLength(2)
    })
  })

  /* ---- removeItem ---- */

  describe("removeItem", () => {
    it("removes an item by variantId", () => {
      useCart.getState().addItem(makeItem({ variantId: "v1" }))
      useCart.getState().addItem(makeItem({ variantId: "v2" }))
      useCart.getState().removeItem("v1")
      const items = useCart.getState().items
      expect(items).toHaveLength(1)
      expect(items[0].variantId).toBe("v2")
    })

    it("does nothing when removing a non-existent variantId", () => {
      useCart.getState().addItem(makeItem())
      useCart.getState().removeItem("non-existent")
      expect(useCart.getState().items).toHaveLength(1)
    })
  })

  /* ---- updateQty ---- */

  describe("updateQty", () => {
    it("updates the qty for a given variant", () => {
      useCart.getState().addItem(makeItem({ variantId: "v1", qty: 1 }))
      useCart.getState().updateQty("v1", 5)
      expect(useCart.getState().items[0].qty).toBe(5)
    })

    it("removes the item when qty is set to 0", () => {
      useCart.getState().addItem(makeItem({ variantId: "v1" }))
      useCart.getState().updateQty("v1", 0)
      expect(useCart.getState().items).toHaveLength(0)
    })

    it("removes the item when qty is negative", () => {
      useCart.getState().addItem(makeItem({ variantId: "v1" }))
      useCart.getState().updateQty("v1", -3)
      expect(useCart.getState().items).toHaveLength(0)
    })
  })

  /* ---- clear ---- */

  describe("clear", () => {
    it("removes all items from the cart", () => {
      useCart.getState().addItem(makeItem({ variantId: "v1" }))
      useCart.getState().addItem(makeItem({ variantId: "v2" }))
      useCart.getState().clear()
      expect(useCart.getState().items).toHaveLength(0)
    })

    it("is safe to call on an already empty cart", () => {
      useCart.getState().clear()
      expect(useCart.getState().items).toHaveLength(0)
    })
  })

  /* ---- total ---- */

  describe("total", () => {
    it("returns 0 for an empty cart", () => {
      expect(useCart.getState().total()).toBe(0)
    })

    it("calculates total as sum of price * qty", () => {
      useCart.getState().addItem(makeItem({ variantId: "v1", price: 500, qty: 2 }))
      useCart.getState().addItem(makeItem({ variantId: "v2", price: 300, qty: 3 }))
      // 500*2 + 300*3 = 1900
      expect(useCart.getState().total()).toBe(1900)
    })

    it("reflects updated qty in total", () => {
      useCart.getState().addItem(makeItem({ variantId: "v1", price: 100, qty: 1 }))
      useCart.getState().updateQty("v1", 10)
      expect(useCart.getState().total()).toBe(1000)
    })

    it("returns 0 after clearing the cart", () => {
      useCart.getState().addItem(makeItem({ price: 999, qty: 5 }))
      useCart.getState().clear()
      expect(useCart.getState().total()).toBe(0)
    })
  })
})
