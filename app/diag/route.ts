// TEMPORÁRIO — diagnóstico de 05/10/2026. Serve para ver o que a produção
// recebe do HubSpot, em vez de inferir a partir do que ela desenha. Remover
// assim que a investigação fechar.

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? ''
  const token = process.env.HUBSPOT_TOKEN ?? ''

  const corpo = {
    filterGroups: [{ filters: [{ propertyName: 'hs_object_id', operator: 'EQ', value: id }] }],
    properties: ['subject', 'hs_pipeline_stage', 'hs_v2_date_entered_current_stage', 'hs_lastmodifieddate'],
    limit: 1,
  }

  const inicio = Date.now()
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/tickets/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    cache: 'no-store',
  })
  const json = await res.json().catch(() => null)

  return Response.json(
    {
      agoraNoServidor: new Date().toISOString(),
      msDaChamada: Date.now() - inicio,
      // Prefixo só para confirmar que é o mesmo PAT, sem expor o token.
      tokenComeca: token.slice(0, 11) || '(sem token)',
      tokenTamanho: token.length,
      regiao: process.env.VERCEL_REGION ?? '(local)',
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? '(local)',
      httpDoHubSpot: res.status,
      ticket: json?.results?.[0]?.properties ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
