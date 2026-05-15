// Each step PR appends: import "./validate"  (and the file calls registerHandler at module load)
import "./validate"
import "./supabase-setup"
import "./resend-setup"
import "./cloudflare-dns"
export {}
