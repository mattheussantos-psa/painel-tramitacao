import { SLA, iso, type Ticket } from './sinaleira'
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

export type Owner = { nome: string; inativo: boolean }
export type Owners = Record<string, Owner>
export type Fonte = {
  tickets: Ticket[]
  owners: Owners
  aoVivo: boolean
  capturadoEm: string
  atualizadoEm: string
  aviso?: string
}


const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

// O search do HubSpot tem teto por segundo (policy SECONDLY, 4 req/s). Paginar
// os 436 tickets em sequência já estoura sozinho, e o teto é da conta inteira:
// outro integrador consumindo a cota derruba o painel do mesmo jeito. Então
// espaça as chamadas e tenta de novo no 429 em vez de morrer.
const PAUSA = 300

async function chamar(url: string | URL, init: RequestInit, onde: string) {
  for (let tentativa = 0; ; tentativa++) {
    const res = await fetch(url, init)
    if (res.status !== 429 || tentativa >= 4) return json(res, onde)

    const retryAfter = Number(res.headers.get('Retry-After'))
    await espera(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** tentativa * 500)
  }
}

async function json(res: Response, onde: string) {
  // O HubSpot devolve HTML em alguns erros (owner desativado, token sem scope).
  // Sem esta checagem o .json() estoura com um erro que não diz nada.
  if (!res.ok) {
    throw new Error(`HubSpot ${onde} respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  return res.json()
}

async function buscarAoVivo(
  token: string,
  pipeline: string,
): Promise<{ tickets: Ticket[]; ignorados: number }> {
  const tickets: Ticket[] = []
  let ignorados = 0
  let after: string | undefined

  do {
    if (after) await espera(PAUSA)
    const pagina = await chamar(
      'https://api.hubapi.com/crm/v3/objects/tickets/search',
      {
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
          // Sem sort explícito a paginação do search do HubSpot não é estável:
          // entre uma página e outra dá pra repetir e pular registro. Numa
          // sinaleira, sumir com ticket é o pior defeito possível.
          sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
          limit: 100,
          after,
        }),
      },
      'tickets/search',
    )

    for (const r of pagina.results ?? []) {
      const p = r.properties ?? {}
      // Sem data de evento não dá pra calcular prazo. Não some calado: o
      // total de ignorados aparece na tela.
      const evento = iso(p.data_do_evento__ganho_)
      if (!evento) {
        ignorados++
        continue
      }
      tickets.push({
        id: r.id,
        subject: p.subject ?? '(sem assunto)',
        stage: p.hs_pipeline_stage,
        evento,
        curador: p.curador_responsavel_new || p.hubspot_owner_id || null,
        entrouEtapa: iso(p.hs_v2_date_entered_current_stage) || evento,
      })
    }
    after = pagina.paging?.next?.after
  } while (after)

  return { tickets, ignorados }
}

// Os owners arquivados não vêm na listagem padrão, e são justamente os que
// interessam: ticket parado com curador que saiu não tem quem atue.
async function buscarOwners(token: string): Promise<Owners> {
  const owners: Owners = {}

  for (const arquivados of [false, true]) {
    let after: string | undefined
    do {
      const url = new URL('https://api.hubapi.com/crm/v3/owners')
      url.searchParams.set('limit', '500')
      if (arquivados) url.searchParams.set('archived', 'true')
      if (after) url.searchParams.set('after', after)

      await espera(PAUSA)
      const pagina = await chamar(url, { headers: { Authorization: `Bearer ${token}` } }, 'owners')
      for (const o of pagina.results ?? []) {
        const nome = [o.firstName, o.lastName].filter(Boolean).join(' ').trim()
        owners[String(o.id)] = { nome: nome || o.email || `#${o.id}`, inativo: arquivados }
      }
      after = pagina.paging?.next?.after
    } while (after)
  }

  return owners
}

function ownersDoSnapshot(): Owners {
  const out: Owners = {}
  for (const [id, nome] of Object.entries(curadores.nomes)) {
    out[id] = { nome, inativo: curadores.inativos.includes(id) }
  }
  return out
}

async function buscarTudo(): Promise<Fonte> {
  const token = process.env.HUBSPOT_TOKEN
  const pipeline = process.env.HUBSPOT_PIPELINE_CS ?? '748675953'

  if (!token) {
    return {
      tickets: snapshot.tickets as Ticket[],
      owners: ownersDoSnapshot(),
      aoVivo: false,
      capturadoEm: snapshot.capturadoEm,
      atualizadoEm: '',
    }
  }

  // Sem ticket não tem painel: falha aqui é fatal e não cai no snapshot em
  // silêncio — número velho passando por atual é pior que erro.
  const { tickets, ignorados } = await buscarAoVivo(token, pipeline)

  // Nome de curador é acessório. Se faltar o scope crm.objects.owners.read o
  // painel continua servindo, mostrando o id em vez do nome — mas o motivo
  // aparece na tela, não vira silêncio.
  const avisos: string[] = []
  let owners: Owners = {}
  try {
    owners = await buscarOwners(token)
  } catch (e) {
    avisos.push(
      `Nomes dos curadores não carregaram, aparecem como id. ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  if (ignorados > 0) {
    avisos.push(
      `${ignorados} ${ignorados === 1 ? 'ticket ficou' : 'tickets ficaram'} de fora por não ter data de evento preenchida.`,
    )
  }

  return {
    tickets,
    owners,
    aviso: avisos.length ? avisos.join(' ') : undefined,
    aoVivo: true,
    capturadoEm: new Date().toISOString().slice(0, 10),
    atualizadoEm: new Date().toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    }),
  }
}

// Portal PSA. Sem o id na URL o app.hubspot.com não resolve o registro e cai
// em erro — o path também é /record/, no singular.
const PORTAL = '49656171'

export function linkTicket(id: string) {
  return `https://app.hubspot.com/contacts/${PORTAL}/record/0-5/${id}`
}

export function nomeCurador(owners: Owners, id: string | null) {
  if (!id) return null
  return owners[id]?.nome ?? `#${id}`
}

// Ticket parado com curador que saiu da empresa não tem quem atue: o painel
// precisa dizer isso, senão fica esperando ação de quem não existe mais.
export function curadorInativo(owners: Owners, id: string | null) {
  return !!id && !!owners[id]?.inativo
}

// Cache em memória, por instância. O teto do search é por segundo e vale pra
// conta inteira: sem isso cada carregamento da página refaz 5 chamadas, e dois
// farmers abrindo o painel junto derrubam os dois. Erro não entra no cache.
const TTL = 60_000
let cache: { em: number; fonte: Fonte } | null = null

export async function carregar(): Promise<Fonte> {
  if (cache && Date.now() - cache.em < TTL) return cache.fonte
  const fonte = await buscarTudo()
  if (fonte.aoVivo) cache = { em: Date.now(), fonte }
  return fonte
}
