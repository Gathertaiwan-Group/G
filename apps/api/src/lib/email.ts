import { Resend } from "resend"

const API_KEY = process.env.RESEND_API_KEY
const FROM = process.env.RESEND_FROM_EMAIL ?? "誠真生活 RealReal <onboarding@resend.dev>"

let resend: Resend | null = null

if (API_KEY) {
  resend = new Resend(API_KEY)
  console.log("[email] Resend configured, from:", FROM)
} else {
  console.warn("[email] RESEND_API_KEY not set — emails will be logged but not sent")
}

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  if (!resend) {
    console.warn(`[email] Skipping send (no Resend config): to=${to} subject="${subject}"`)
    return
  }

  const { data, error } = await resend.emails.send({ from: FROM, to, subject, html })
  if (error) {
    console.error(`[email] Failed to send: to=${to} subject="${subject}"`, error)
    throw error
  }
  console.log(`[email] Sent: to=${to} subject="${subject}" id=${data?.id}`)
}
