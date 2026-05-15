// Each step PR appends: import "./validate"  (and the file calls registerHandler at module load)
import "./validate"
import "./supabase-setup"
import "./resend-setup"
import "./cloudflare-dns"
import "./vercel-setup"
import "./railway-setup"
import "./domain-finalize"
import "./tenant-finalize"
export {}
