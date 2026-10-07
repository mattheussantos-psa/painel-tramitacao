import { QUADROS, completar, iso, tarefaMaisUrgente, type Quadro, type Tarefa, type Ticket } from './sinaleira'
import snapshot from '@/data/snapshot.json'
import curadores from '@/data/curadores.json'

const PROPS = [
  'subject',
  'hs_pipeline_stage',
  'data_do_evento__ganho_',
  'curador_responsavel_new',
  'hubspot_owner_id',
  'hs_v2_date_entered_current_stage',
  'hs_nextactivitydate',
  'data_de_realizacao_do_onboarding',
  'status_do_contrato',
  // Lidos pelos relogios das etapas Logistica, Contrato e Briefing.
  'logistica_sera_organizada_pela_psa_',
  'tipo_de_empresa_contratante',
  'formato_da_empresa',
  'formato_de_contrato__ganho_',
  'assinar_contrato',
  'data_de_assinatura_do_contrato',
  'data_para_realizacao_de_briefing',
  'data_e_hora_da_call_de_briefing',
  'data_de_faturamento',
  'data_de_emissao',
  'adquirir_logistica',
  'data_prevista_de_pagamento_logistica',
  'data_de_envio_contrato_cliente',
  'data_de_envio_contrato_palestrante',
  'prazo_de_assinatura__contrato_palestrante',
  'data_de_assinatura__palestrante_',
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
    // O fetch do Next e instrumentado e guarda a resposta por conta propria.
    // Sem no-store o painel servia resposta velha carimbando "ao vivo": em
    // 05/10/2026 um ticket aparecia na etapa de tres dias antes enquanto a
    // mesma busca, feita no mesmo processo com no-store, trazia a etapa certa.
    // force-dynamic na pagina nao cobre isso — e cache de dado, nao de rota.
    const res = await fetch(url, { ...init, cache: 'no-store' })
    if (res.status !== 429 || tentativa >= 4) return json(res, onde)

    const retryAfter = Number(res.headers.get('Retry-After'))
    await espera(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** tentativa * 500)
  }
}

async function json(res: Response, onde: string) {
  // O HubSpot devolve HTML em alguns erros (owner desativado, token sem scope).
  // Sem esta checagem o .json() estoura com um erro que não diz nada.
  if (!res.ok) {
    // 600 e nao 300: a resposta de escopo faltando traz a lista de escopos
    // exigidos no fim do corpo, que é justamente o que precisamos ler.
    throw new Error(`HubSpot ${onde} respondeu ${res.status}: ${(await res.text()).slice(0, 600)}`)
  }
  return res.json()
}

async function buscarAoVivo(
  token: string,
  q: Quadro,
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
                { propertyName: 'hs_pipeline', operator: 'EQ', value: q.pipeline },
                { propertyName: 'hs_pipeline_stage', operator: 'IN', values: Object.keys(q.sla) },
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
      // Num quadro que corre contra a data do evento, ticket sem ela não tem
      // prazo calculável. Não some calado: o total aparece na tela. Em quadro
      // sem evento (Tramitação) a propriedade nem é usada, então não derruba.
      const evento = iso(p.data_do_evento__ganho_)
      if (!evento && q.evento) {
        ignorados++
        continue
      }
      tickets.push(completar({
        id: r.id,
        subject: p.subject ?? '(sem assunto)',
        stage: p.hs_pipeline_stage,
        evento,
        curador: p.curador_responsavel_new || null,
        proprietario: p.hubspot_owner_id || null,
        proximaTarefa: iso(p.hs_nextactivitydate),
        onboarding: iso(p.data_de_realizacao_do_onboarding),
        statusContrato: p.status_do_contrato ?? '',
        // Sem cair na data do evento: com prazo por tempo na etapa, isso
        // afirmaria uma entrada que nao houve. Vazio vira cinza na avaliacao.
        entrouEtapa: iso(p.hs_v2_date_entered_current_stage),
        logistica: p.logistica_sera_organizada_pela_psa_ ?? '',
        tipoEmpresa: p.tipo_de_empresa_contratante ?? '',
        formatoEmpresa: p.formato_da_empresa ?? '',
        formatoContrato: p.formato_de_contrato__ganho_ ?? '',
        prazoAssinatura: iso(p.assinar_contrato),
        dataAssinatura: iso(p.data_de_assinatura_do_contrato),
        prazoBriefing: iso(p.data_para_realizacao_de_briefing),
        callBriefing: iso(p.data_e_hora_da_call_de_briefing),
        dataFaturamento: iso(p.data_de_faturamento),
        dataEmissao: iso(p.data_de_emissao),
        prazoLogistica: iso(p.adquirir_logistica),
        pagamentoLogistica: iso(p.data_prevista_de_pagamento_logistica),
        envioCliente: iso(p.data_de_envio_contrato_cliente),
        envioPalestrante: iso(p.data_de_envio_contrato_palestrante),
        prazoAssinaturaPalestrante: iso(p.prazo_de_assinatura__contrato_palestrante),
        dataAssinaturaPalestrante: iso(p.data_de_assinatura__palestrante_),
      }))
    }
    after = pagina.paging?.next?.after
  } while (after)

  return { tickets, ignorados }
}

const pedacos = <T,>(xs: T[], n: number) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

// hs_nextactivitydate só guarda atividade FUTURA: medido nos 438 abertos, zero
// tickets com data no passado. Ou seja, tarefa vencida some do campo. Para
// saber quem tem tarefa em aberto — vencida ou não — é preciso ler o objeto
// task via associação.
async function buscarTarefas(token: string, ticketIds: string[]) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const porTicket = new Map<string, string[]>()
  for (const lote of pedacos(ticketIds, 100)) {
    await espera(PAUSA)
    const r = await chamar(
      'https://api.hubapi.com/crm/v4/associations/tickets/tasks/batch/read',
      { method: 'POST', headers, body: JSON.stringify({ inputs: lote.map((id) => ({ id })) }) },
      'associations tickets→tasks',
    )
    for (const res of r.results ?? []) {
      const de = res.from?.id
      const para = (res.to ?? []).map((t: { toObjectId?: string; id?: string }) =>
        String(t.toObjectId ?? t.id),
      )
      if (de && para.length) porTicket.set(String(de), para)
    }
  }

  const idsTarefa = [...new Set([...porTicket.values()].flat())]
  const tarefas = new Map<string, Tarefa>()

  for (const lote of pedacos(idsTarefa, 100)) {
    await espera(PAUSA)
    const r = await chamar(
      'https://api.hubapi.com/crm/v3/objects/tasks/batch/read',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: ['hs_timestamp', 'hs_task_status'],
          inputs: lote.map((id) => ({ id })),
        }),
      },
      'tasks/batch/read',
    )
    for (const t of r.results ?? []) {
      tarefas.set(String(t.id), {
        vence: iso(t.properties?.hs_timestamp),
        // Qualquer coisa que não seja COMPLETED conta como pendente.
        aberta: (t.properties?.hs_task_status ?? '') !== 'COMPLETED',
      })
    }
  }

  const proxima = new Map<string, string>()
  for (const [ticket, ids] of porTicket) {
    const vence = tarefaMaisUrgente(ids, tarefas)
    if (vence) proxima.set(ticket, vence)
  }
  return proxima
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

async function buscarTudo(q: Quadro): Promise<Fonte> {
  const token = process.env.HUBSPOT_TOKEN

  // O snapshot é do CS. Outro quadro sem token não tem de onde tirar número —
  // melhor vazio e dizendo o motivo do que mostrar ticket de outro pipeline.
  if (!token) {
    return {
      tickets: q.slug === 'cs' ? snapshot.tickets.map((t) => completar(t as Partial<Ticket>)) : [],
      aviso: q.slug === 'cs' ? undefined : 'Sem HUBSPOT_TOKEN: este quadro só existe ao vivo.',
      owners: ownersDoSnapshot(),
      aoVivo: false,
      capturadoEm: snapshot.capturadoEm,
      atualizadoEm: '',
    }
  }

  // Sem ticket não tem painel: falha aqui é fatal e não cai no snapshot em
  // silêncio — número velho passando por atual é pior que erro.
  const { tickets, ignorados } = await buscarAoVivo(token, q)

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

  // Tarefa é acessório, igual aos owners: sem o escopo crm.objects.tasks.read o
  // painel segue servindo, caindo no hs_nextactivitydate que já veio no ticket
  // — que só enxerga atividade futura. O motivo aparece na tela.
  try {
    const proxima = await buscarTarefas(
      token,
      tickets.map((t) => t.id),
    )
    for (const t of tickets) t.proximaTarefa = proxima.get(t.id) ?? ''
  } catch (e) {
    avisos.push(
      `Tarefas não carregaram; a coluna cai em hs_nextactivitydate, que ignora tarefa vencida. ${e instanceof Error ? e.message : String(e)}`,
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
// Um cache por quadro: chave única misturaria os pipelines, que é exatamente o
// que não pode acontecer aqui.
const cache = new Map<string, { em: number; fonte: Fonte }>()

// forcar pula o cache: e o que o botao Atualizar usa. Sem isso o botao
// devolveria o mesmo retrato por ate um minuto, que e justamente o que leva
// alguem a desconfiar do painel depois de mexer no HubSpot.
export async function carregar(slug: string, forcar = false): Promise<Fonte> {
  const q = QUADROS[slug]
  if (!q) throw new Error(`Quadro desconhecido: ${slug}`)

  const guardado = cache.get(slug)
  if (!forcar && guardado && Date.now() - guardado.em < TTL) return guardado.fonte

  const fonte = await buscarTudo(q)
  if (fonte.aoVivo) cache.set(slug, { em: Date.now(), fonte })
  return fonte
}
