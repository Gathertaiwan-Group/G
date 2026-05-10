"use client"

import { ShoppingCart } from "lucide-react"
import { useCart } from "@/lib/cart"
import { useEffect, useState } from "react"
import { CartDrawer } from "./CartDrawer"

export function CartButton() {
  const items = useCart(s => s.items)
  const [hydrated, setHydrated] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    useCart.persist.rehydrate()
    setHydrated(true)
  }, [])

  const count = hydrated ? items.reduce((sum, i) => sum + i.qty, 0) : 0

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative inline-flex items-center justify-center h-10 w-10 rounded-[10px] hover:bg-accent transition-colors"
        aria-label={`購物車 (${count} 件)`}
      >
        <ShoppingCart className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#10305a] text-white text-xs font-medium">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      <CartDrawer open={open} onOpenChange={setOpen} />
    </>
  )
}
