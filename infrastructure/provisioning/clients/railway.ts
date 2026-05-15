import { mgmtFetch } from "./http"

const GQL = "https://backboard.railway.app/graphql/v2"

async function railwayGql<T = unknown>(
  token: string, label: string, query: string, variables: Record<string, unknown>,
): Promise<T> {
  const r = await mgmtFetch<{ data: T; errors?: Array<{ message: string }> }>(GQL, {
    method: "POST", token, label, body: { query, variables },
  })
  if (r.errors?.length) throw new Error(`${label}: ${r.errors.map(e => e.message).join("; ")}`)
  return r.data
}

export async function createRailwayProject(token: string, name: string): Promise<string> {
  const d = await railwayGql<{ projectCreate: { id: string } }>(
    token, "createRailwayProject",
    `mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { id } }`,
    { input: { name } },
  )
  return d.projectCreate.id
}

export async function createRailwayService(
  token: string, projectId: string, name: string,
  repo: string, branch: string, rootDir: string,
): Promise<string> {
  const d = await railwayGql<{ serviceCreate: { id: string } }>(
    token, "createRailwayService",
    `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
    {
      input: {
        projectId, name,
        source: { repo },
        branch,
        rootDirectory: rootDir,
      },
    },
  )
  return d.serviceCreate.id
}

export async function setRailwayVars(
  token: string, serviceId: string, kv: Record<string, string>,
): Promise<void> {
  await railwayGql(
    token, "setRailwayVars",
    `mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
    { input: { serviceId, variables: kv } },
  )
}

export async function deployRailwayService(token: string, serviceId: string): Promise<void> {
  await railwayGql(
    token, "deployRailwayService",
    `mutation($serviceId: String!) { serviceInstanceRedeploy(serviceId: $serviceId) }`,
    { serviceId },
  )
}

// projectCreate only returns { id }; the environment id needed by
// serviceDomainCreate must be fetched separately. A freshly created Railway
// project always has a single default `production` environment.
export async function getRailwayEnvironmentId(
  token: string, projectId: string,
): Promise<string> {
  const d = await railwayGql<{
    project: { environments: { edges: Array<{ node: { id: string; name: string } }> } }
  }>(
    token, "getRailwayEnvironmentId",
    `query($id: String!) {
      project(id: $id) { environments { edges { node { id name } } } }
    }`,
    { id: projectId },
  )
  const edges = d.project?.environments?.edges ?? []
  const prod = edges.find(e => e.node.name === "production") ?? edges[0]
  if (!prod) throw new Error(`getRailwayEnvironmentId: no environments for project ${projectId}`)
  return prod.node.id
}

// Creates a Railway-managed public domain (xxxx.up.railway.app) for a service
// in a given environment and returns the generated domain string.
export async function createRailwayServiceDomain(
  token: string, environmentId: string, serviceId: string,
): Promise<string> {
  const d = await railwayGql<{ serviceDomainCreate: { domain: string } }>(
    token, "createRailwayServiceDomain",
    `mutation($input: ServiceDomainCreateInput!) {
      serviceDomainCreate(input: $input) { domain }
    }`,
    { input: { environmentId, serviceId } },
  )
  return d.serviceDomainCreate.domain
}

export async function pollRailwayHealthz(
  url: string, o: { intervalMs?: number; maxMs?: number } = {},
): Promise<void> {
  const interval = o.intervalMs ?? 5_000
  const deadline = Date.now() + (o.maxMs ?? 300_000)
  const target = url.replace(/\/$/, "") + "/health"
  for (;;) {
    try {
      const res = await fetch(target, {
        method: "GET",
        headers: { "User-Agent": "provisioning/1.0" },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) return
    } catch {
      // network error during cold start — keep polling until deadline
    }
    if (Date.now() > deadline) throw new Error(`pollRailwayHealthz: timed out (${target})`)
    await new Promise(r => setTimeout(r, interval))
  }
}
