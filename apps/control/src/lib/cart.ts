import { create } from "zustand"
import { persist } from "zustand/middleware"
import { toast } from "sonner"

export type CartItem = {
  variantId: string
  productName: string
  variantName: string
  price: number
  qty: number
  imageUrl?: string
}

type CartStore = {
  items: CartItem[]
  addItem: (item: CartItem) => void
  removeItem: (variantId: string) => void
  updateQty: (variantId: string, qty: number) => void
  clear: () => void
  total: () => number
}

export const useCart = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (item) => set(state => {
        const existing = state.items.find(i => i.variantId === item.variantId)
        toast.success("已加入購物車")
        if (existing) {
          return { items: state.items.map(i => i.variantId === item.variantId ? { ...i, qty: i.qty + item.qty } : i) }
        }
        return { items: [...state.items, item] }
      }),
      removeItem: (variantId) => set(state => ({ items: state.items.filter(i => i.variantId !== variantId) })),
      updateQty: (variantId, qty) => set(state => ({
        items: qty <= 0 ? state.items.filter(i => i.variantId !== variantId) : state.items.map(i => i.variantId === variantId ? { ...i, qty } : i)
      })),
      clear: () => set({ items: [] }),
      total: () => get().items.reduce((sum, i) => sum + i.price * i.qty, 0),
    }),
    { name: "realreal-cart", skipHydration: true }
  )
)
