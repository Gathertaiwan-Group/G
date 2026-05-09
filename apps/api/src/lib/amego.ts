import axios from "axios"
import { getPaymentConfig } from "./provider-config"

const AMEGO_API_URL = process.env.AMEGO_API_URL ?? "https://api.amego.tw"

async function makeClient() {
  const cfg = await getPaymentConfig()
  return axios.create({
    baseURL: AMEGO_API_URL,
    headers: {
      "X-Tax-Id": cfg.amego_tax_id,
      "X-App-Key": cfg.amego_app_key,
    },
    timeout: 10000,
  })
}

export type InvoiceType = "B2C_2" | "B2C_3" | "B2B"

export interface IssueInvoiceParams {
  orderId: string
  orderNumber: string
  amount: number
  taxAmount: number
  type: InvoiceType
  buyerEmail?: string
  carrierType?: "phone" | "natural_person" | "love_code"
  carrierNumber?: string
  loveCode?: string
  taxId?: string
  companyTitle?: string
  items: Array<{ name: string; qty: number; unitPrice: number }>
}

export async function issueInvoice(params: IssueInvoiceParams) {
  const client = await makeClient()
  const { data } = await client.post("/invoices", params)
  return data as { invoiceNumber: string; randomCode: string; amegoId: string }
}

export async function voidInvoice(amegoId: string, reason: string) {
  const client = await makeClient()
  const { data } = await client.post(`/invoices/${amegoId}/void`, { reason })
  return data
}

export async function queryInvoice(amegoId: string) {
  const client = await makeClient()
  const { data } = await client.get(`/invoices/${amegoId}`)
  return data
}

export function invoicePdfUrl(amegoId: string) {
  return `${AMEGO_API_URL}/invoices/${amegoId}/pdf`
}
