create table if not exists tenant_infrastructure (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  vercel_project_id text not null,
  vercel_deployment_url text,
  railway_project_id text not null,
  railway_api_service_id text not null,
  railway_api_url text,
  railway_mcp_service_id text not null,
  railway_mcp_url text,
  supabase_project_ref text not null,
  supabase_url text not null,
  supabase_anon_key text not null,
  supabase_service_role_key_encrypted bytea not null,
  resend_domain_id text,
  resend_dkim_verified_at timestamptz,
  cloudflare_zone_id text,
  mcp_token_hash text,
  created_at timestamptz default now()
);

comment on column tenant_infrastructure.supabase_service_role_key_encrypted is
  'aes-256-gcm encrypted with PLATFORM_KEK. Format: 12-byte IV || ciphertext || 16-byte auth tag.';
