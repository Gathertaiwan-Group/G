import { mgmtFetch } from "./http"

const API = "https://api.vercel.com"

export interface CreateVercelArgs {
  token: string; name: string; repo: string; branch: string; rootDir: string
}

export async function createVercelProject(a: CreateVercelArgs): Promise<string> {
  const r = await mgmtFetch<{ id: string }>(`${API}/v11/projects`, {
    method: "POST", token: a.token, label: "createVercelProject",
    body: {
      name: a.name,
      framework: "nextjs",
      rootDirectory: a.rootDir,
      gitRepository: { type: "github", repo: a.repo },
      buildCommand: null,
    },
  })
  // Pin the production branch so the platform repo's `production` branch
  // is what auto-deploys for this tenant project.
  await mgmtFetch(`${API}/v9/projects/${r.id}`, {
    method: "PATCH", token: a.token, label: "createVercelProject:branch",
    body: { framework: "nextjs", productionBranch: a.branch },
  })
  return r.id
}

export async function setVercelEnv(
  token: string, projectId: string, kv: Record<string, string>,
): Promise<void> {
  for (const [key, value] of Object.entries(kv)) {
    await mgmtFetch(`${API}/v10/projects/${projectId}/env?upsert=true`, {
      method: "POST", token, label: `setVercelEnv:${key}`,
      body: { key, value, type: "encrypted", target: ["production", "preview", "development"] },
    })
  }
}

export async function triggerVercelDeploy(token: string, projectId: string): Promise<string> {
  const r = await mgmtFetch<{ id: string }>(`${API}/v13/deployments`, {
    method: "POST", token, label: "triggerVercelDeploy",
    body: { name: projectId, project: projectId, target: "production", gitSource: { type: "github" } },
  })
  return r.id
}

export async function pollVercelReady(
  token: string, deploymentId: string, o: { intervalMs?: number; maxMs?: number } = {},
): Promise<string> {
  const interval = o.intervalMs ?? 5_000
  const deadline = Date.now() + (o.maxMs ?? 300_000)
  for (;;) {
    const d = await mgmtFetch<{ readyState: string; url?: string }>(
      `${API}/v13/deployments/${deploymentId}`,
      { method: "GET", token, label: "pollVercelReady" },
    )
    if (d.readyState === "READY") return `https://${d.url}`
    if (d.readyState === "ERROR" || d.readyState === "CANCELED") {
      throw new Error(`pollVercelReady: deployment ${d.readyState}`)
    }
    if (Date.now() > deadline) throw new Error(`pollVercelReady: timed out (last=${d.readyState})`)
    await new Promise(r => setTimeout(r, interval))
  }
}

export async function addVercelDomain(
  token: string, projectId: string, domain: string,
): Promise<void> {
  await mgmtFetch(`${API}/v10/projects/${projectId}/domains`, {
    method: "POST", token, label: "addVercelDomain", body: { name: domain },
  })
}

export async function rollbackVercel(token: string, projectId: string): Promise<void> {
  const list = await mgmtFetch<{ deployments: Array<{ uid: string; readyState: string }> }>(
    `${API}/v6/deployments?projectId=${projectId}&limit=20&state=READY`,
    { method: "GET", token, label: "rollbackVercel:list" },
  )
  const ready = list.deployments.filter(d => d.readyState === "READY")
  const previous = ready[1]
  if (!previous) throw new Error("rollbackVercel: no previous READY deployment to promote")
  await mgmtFetch(`${API}/v10/projects/${projectId}/promote/${previous.uid}`, {
    method: "POST", token, label: "rollbackVercel:promote",
  })
}
