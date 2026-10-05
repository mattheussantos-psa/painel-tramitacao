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

  // A busca paginada, que e a que o painel usa de verdade.
  const url = new URL(req.url)
  if (url.searchParams.get('paginado') === '1') {
    const ETAPAS = ['1450325173','1450325174','1450683393','1450325175','1448673032','1451268423','1088361911','1333136740','1088360205']
    let after: string | undefined
    let total = 0
    const vistos = new Map<string, number>()
    const achados: unknown[] = []
    const paginas: number[] = []
    do {
      const r: Response = await fetch('https://api.hubapi.com/crm/v3/objects/tickets/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          filterGroups: [{ filters: [
            { propertyName: 'hs_pipeline', operator: 'EQ', value: '748675953' },
            { propertyName: 'hs_pipeline_stage', operator: 'IN', values: ETAPAS },
          ] }],
          properties: ['hs_pipeline_stage', 'hs_v2_date_entered_current_stage'],
          sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
          limit: 100,
          after,
        }),
      })
      const j: any = await r.json()
      paginas.push((j.results ?? []).length)
      for (const t of j.results ?? []) {
        total++
        vistos.set(t.id, (vistos.get(t.id) ?? 0) + 1)
        if (t.id === id) achados.push({ pagina: paginas.length, ...t.properties })
      }
      after = j.paging?.next?.after
      await new Promise((r) => setTimeout(r, 300))
    } while (after)
    const repetidos = [...vistos.entries()].filter(([, n]) => n > 1)
    return Response.json(
      { agoraNoServidor: new Date().toISOString(), regiao: process.env.VERCEL_REGION ?? '(local)',
        total, distintos: vistos.size, paginas, repetidos, achados },
      { headers: { 'Cache-Control': 'no-store' } },
    )
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
