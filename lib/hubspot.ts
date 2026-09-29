import { SLA, type Ticket } from './sinaleira'
import snapshot from '@/data/snapshot.json'
import curadores from '@/data/curadores.json'

export const ETAPAS_ABERTAS = Object.keys(SLA)

const PROPS = [
  'subject',
  'hs_pipeline_stage',
  'data_do_evento__ganho_',
  'curador_responsavel_new',
  'hubspot_owner_id',
  'hs_v2_date_entered_current_stage',
]

export type Fonte = { tickets: Ticket[]; aoVivo: boolean; capturadoEm: string }

const iso = (ms: string | null | undefined) =>
  ms ? new Date(Number(ms)).toISOString().slice(0, 10) : ''

async function json(res: Response, onde: string) {
  // O HubSpot devolve HTML em alguns erros (owner desativado, token sem scope).
  // Sem esta checagem o .json() estoura com um erro que não diz nada.
  if (!res.ok) {
    throw new Error(`HubSpot ${onde} respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  return res.json()
}

async function buscarAoVivo(token: string, pipeline: string): Promise<Ticket[]> {
  const tickets: Ticket[] = []
  let after: string | undefined

  do {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/tickets/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              { propertyName: 'hs_pipeline', operator: 'EQ', value: pipeline },
              { propertyName: 'hs_pipeline_stage', operator: 'IN', values: ETAPAS_ABERTAS },
            ],
          },
        ],
        properties: PROPS,
        limit: 100,
        after,
      }),
      cache: 'no-store',
    })

    const pagina = await json(res, 'tickets/search')
    for (const r of pagina.results ?? []) {
      const p = r.properties ?? {}
      if (!p.data_do_evento__ganho_) continue
      tickets.push({
        id: r.id,
        subject: p.subject ?? '(sem assunto)',
        stage: p.hs_pipeline_stage,
        evento: iso(p.data_do_evento__ganho_),
        curador: p.curador_responsavel_new || p.hubspot_owner_id || null,
        entrouEtapa: iso(p.hs_v2_date_entered_current_stage) || iso(p.data_do_evento__ganho_),
      })
    }
    after = pagina.paging?.next?.after
  } while (after)

  return tickets
}

export async function carregar(): Promise<Fonte> {
  const token = process.env.HUBSPOT_TOKEN
  const pipeline = process.env.HUBSPOT_PIPELINE_CS ?? '748675953'

  if (!token) {
    return {
      tickets: snapshot.tickets as Ticket[],
      aoVivo: false,
      capturadoEm: snapshot.capturadoEm,
    }
  }

  // Com token configurado, falha é falha: não cai no snapshot em silêncio.
  const tickets = await buscarAoVivo(token, pipeline)
  return { tickets, aoVivo: true, capturadoEm: new Date().toISOString().slice(0, 10) }
}

// Portal PSA. Sem o id na URL o app.hubspot.com não resolve o registro e cai
// em erro — o path também é /record/, no singular.
const PORTAL = '49656171'

export function linkTicket(id: string) {
  return `https://app.hubspot.com/contacts/${PORTAL}/record/0-5/${id}`
}

export function nomeCurador(id: string | null) {
  if (!id) return null
  return curadores.nomes[id as keyof typeof curadores.nomes] ?? `#${id}`
}

// Ticket parado com curador que saiu da empresa não tem quem atue: o painel
// precisa dizer isso, senão fica esperando ação de quem não existe mais.
export function curadorInativo(id: string | null) {
  return !!id && curadores.inativos.includes(id)
}
