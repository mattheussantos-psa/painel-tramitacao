// Guia Closer — dois cards trazidos do painel Negócios Ativos
// (github.com/mattheusdosantosss/negocios-ativos-b2b), com a mesma lógica:
//
//   Proposta no mesmo dia — agilidade por closer, razão enviou/teve.
//   SLA de Onboarding     — negócios parados em Aguardando Onboarding.
//
// Aqui é negócio, não ticket: pipeline "Funil de Vendas B2B" (default). A
// classificação fica separada da busca para dar para testar sem rede.

import { chamar } from './http.ts'

export const PIPELINE_B2B = 'default'
const PORTAL = '49656171'

// Etapas que contam como negócio ativo. Nesta pipeline os ids internos
// closedwon/closedlost foram renomeados pelo negócio para "Proposta enviada" e
// "Em negociação" — não são os terminais de ganho e perda do HubSpot.
export const ETAPAS_ATIVAS = [
  'decisionmakerboughtin',
  'closedwon',
  'closedlost',
  '1167445770',
  '1367665802',
]

// Só reunião de venda conta. Reunião de relacionamento, follow-up e CRM ficam
// de fora; reunião sem tipo entra quando é a primeira do negócio, assumindo
// que é a de venda sem etiqueta.
const TIPOS_VENDA = new Set(['B2B | Reunião de Venda', 'B2B | Marcação IA'])

export const ONBOARDING = {
  etapa: '1451255875',
  rotulo: 'Aguardando Onboarding',
  // Entrada em "Negócio fechado": é de lá que o relógio começa.
  etapaReferencia: '1076664462',
  // 2 dias, como está no painel de origem. O comentário do arquivo lá fala em
  // 7, mas quem roda é a configuração.
  prazoDias: 2,
}

const DIA = 86_400_000
const FUSO_BR = 3 * 60 * 60 * 1000

export const paraMs = (v?: string | null): number | null => {
  if (!v) return null
  const n = Number(v)
  const ms = Number.isNaN(n) ? Date.parse(v) : n
  return Number.isFinite(ms) ? ms : null
}

// Reunião e a marca de proposta são datetime: o dia é o de São Paulo.
export const diaBR = (ms: number | null): string | null => {
  if (ms == null) return null
  const d = new Date(ms - FUSO_BR)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// Qualificação é campo de data, gravado à meia-noite UTC: o dia é o próprio.
export const diaUTC = (ms: number | null): string | null =>
  ms == null ? null : new Date(ms).toISOString().slice(0, 10)

export const linkNegocio = (id: string) => `https://app.hubspot.com/contacts/${PORTAL}/record/0-3/${id}`

// no_dia  — a proposta saiu no mesmo dia do evento
// fora    — o dia do evento acabou sem proposta
// aguardando — a janela ainda não fechou: reunião futura, ou evento hoje
export type Estado = 'no_dia' | 'fora' | 'aguardando'

export type Negocio = {
  id: string
  nome: string
  link: string
  estado: Estado
  criadoMs: number | null
  propostaMs: number | null
  reuniaoMs: number | null
}

export type Closer = {
  ownerId: string
  nome: string
  semCumpriu: number
  semTestavel: number
  semAguardando: number
  comCumpriu: number
  comTestavel: number
  comAguardando: number
  semReuniao: Negocio[]
  comReuniao: Negocio[]
}

export type Bruto = {
  id: string
  nome: string
  ownerId: string
  criadoMs: number | null
  qualificacaoMs: number | null
  propostaMs: number | null
  reunioes: { ms: number; tipo: string }[]
}

// Das reuniões do negócio, as que contam como reunião de venda.
export const reunioesDeVenda = (todas: { ms: number; tipo: string }[]) => {
  if (!todas.length) return []
  const primeira = Math.min(...todas.map((m) => m.ms))
  return todas.filter((m) => TIPOS_VENDA.has(m.tipo) || (m.tipo === '' && m.ms === primeira))
}

// Classifica um negócio. Separado da busca de propósito: é aqui que mora a
// regra, e é o que o teste exercita.
export function classificar(n: Bruto, hoje: number): { balde: 'sem' | 'com'; estado: Estado; reuniaoMs: number | null } {
  const diaProposta = diaBR(n.propostaMs)
  const diaQualificacao = diaUTC(n.qualificacaoMs)
  const diaDeHoje = diaBR(hoje)
  const reunioes = reunioesDeVenda(n.reunioes)
  const primeiraReuniao = reunioes.length ? Math.min(...reunioes.map((m) => m.ms)) : null

  if (!reunioes.length) {
    // Sem reunião o evento é a qualificação.
    if (diaProposta && diaProposta === diaQualificacao) return { balde: 'sem', estado: 'no_dia', reuniaoMs: null }
    if (diaQualificacao === diaDeHoje) return { balde: 'sem', estado: 'aguardando', reuniaoMs: null }
    return { balde: 'sem', estado: 'fora', reuniaoMs: null }
  }

  const jaOcorreram = reunioes.filter((m) => m.ms < hoje)
  const bateReuniao = diaProposta ? jaOcorreram.find((m) => diaBR(m.ms) === diaProposta) : undefined
  // Proposta no dia da qualificação também vale: não penaliza quem mandou
  // proposta rápido e só depois agendou a reunião.
  const bateQualificacao = !!diaProposta && diaProposta === diaQualificacao

  if (bateReuniao || bateQualificacao)
    return { balde: 'com', estado: 'no_dia', reuniaoMs: bateReuniao ? bateReuniao.ms : primeiraReuniao }

  const diasEncerrados = jaOcorreram.filter((m) => (diaBR(m.ms) as string) < (diaDeHoje as string))
  if (diasEncerrados.length)
    return { balde: 'com', estado: 'fora', reuniaoMs: Math.min(...diasEncerrados.map((m) => m.ms)) }

  // Reunião de hoje que já aconteceu, ou só reuniões futuras: janela aberta.
  const deHoje = jaOcorreram.filter((m) => diaBR(m.ms) === diaDeHoje)
  return {
    balde: 'com',
    estado: 'aguardando',
    reuniaoMs: deHoje.length ? Math.min(...deHoje.map((m) => m.ms)) : primeiraReuniao,
  }
}

export function agrupar(brutos: Bruto[], nomeDe: (id: string) => string, hoje: number): Closer[] {
  const porCloser = new Map<string, Closer>()
  const pegar = (id: string) => {
    if (!porCloser.has(id))
      porCloser.set(id, {
        ownerId: id,
        nome: nomeDe(id),
        semCumpriu: 0,
        semTestavel: 0,
        semAguardando: 0,
        comCumpriu: 0,
        comTestavel: 0,
        comAguardando: 0,
        semReuniao: [],
        comReuniao: [],
      })
    return porCloser.get(id)!
  }

  for (const n of brutos) {
    const { balde, estado, reuniaoMs } = classificar(n, hoje)
    const c = pegar(n.ownerId)
    const item: Negocio = {
      id: n.id,
      nome: n.nome,
      link: linkNegocio(n.id),
      estado,
      criadoMs: n.criadoMs,
      propostaMs: n.propostaMs,
      reuniaoMs,
    }
    if (balde === 'sem') {
      c.semReuniao.push(item)
      if (estado === 'aguardando') c.semAguardando++
      else {
        c.semTestavel++
        if (estado === 'no_dia') c.semCumpriu++
      }
    } else {
      c.comReuniao.push(item)
      if (estado === 'aguardando') c.comAguardando++
      else {
        c.comTestavel++
        if (estado === 'no_dia') c.comCumpriu++
      }
    }
  }

  return [...porCloser.values()].sort(
    (a, b) =>
      b.comTestavel + b.semTestavel + b.comAguardando + b.semAguardando -
      (a.comTestavel + a.semTestavel + a.comAguardando + a.semAguardando),
  )
}

// ---------- busca ----------

const pedacos = <T,>(xs: T[], n: number) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function buscarNegocios(token: string, filtros: object[], props: string[]) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const out: { id: string; properties: Record<string, string> }[] = []
  let after: string | undefined
  do {
    if (after) await espera(200)
    const pagina = await chamar(
      'https://api.hubapi.com/crm/v3/objects/deals/search',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filterGroups: [{ filters: filtros }],
          properties: props,
          sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
          limit: 100,
          after,
        }),
      },
      'deals/search',
    )
    out.push(...(pagina.results ?? []))
    after = pagina.paging?.next?.after
  } while (after)
  return out
}

export async function buscarPropostaMesmoDia(token: string, nomeDe: (id: string) => string, hoje: number) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const negocios = await buscarNegocios(
    token,
    [
      { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B2B },
      { propertyName: 'dealstage', operator: 'IN', values: ETAPAS_ATIVAS },
    ],
    ['dealname', 'hubspot_owner_id', 'pipedrive___data_de_qualificacao', 'createdate'],
  )
  const ids = negocios.map((d) => d.id)

  // Data da proposta = primeiro instante em que tem_proposta_anexada virou
  // "true". Só o histórico responde isso; o valor atual não diz quando mudou.
  const primeiraProposta = new Map<string, number>()
  for (const lote of pedacos(ids, 50)) {
    await espera(150)
    const r = await chamar(
      'https://api.hubapi.com/crm/v3/objects/deals/batch/read',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          propertiesWithHistory: ['tem_proposta_anexada'],
          inputs: lote.map((id) => ({ id })),
        }),
      },
      'deals/batch/read historico',
    )
    for (const d of r.results ?? []) {
      let primeiro: number | null = null
      for (const h of d.propertiesWithHistory?.tem_proposta_anexada ?? []) {
        if (h.value !== 'true') continue
        const t = Date.parse(h.timestamp)
        if (Number.isFinite(t) && (primeiro == null || t < primeiro)) primeiro = t
      }
      if (primeiro != null) primeiraProposta.set(String(d.id), primeiro)
    }
  }

  // Reuniões de cada negócio.
  const porNegocio = new Map<string, string[]>()
  for (const lote of pedacos(ids, 100)) {
    await espera(150)
    const r = await chamar(
      'https://api.hubapi.com/crm/v4/associations/deals/meetings/batch/read',
      { method: 'POST', headers, body: JSON.stringify({ inputs: lote.map((id) => ({ id })) }) },
      'associations deals→meetings',
    )
    for (const x of r.results ?? [])
      porNegocio.set(String(x.from.id), (x.to ?? []).map((t: { toObjectId?: string }) => String(t.toObjectId)))
  }

  const reuniao = new Map<string, { ms: number; tipo: string }>()
  for (const lote of pedacos([...new Set([...porNegocio.values()].flat())], 100)) {
    await espera(150)
    const r = await chamar(
      'https://api.hubapi.com/crm/v3/objects/meetings/batch/read',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: ['hs_meeting_start_time', 'hs_activity_type'],
          inputs: lote.map((id) => ({ id })),
        }),
      },
      'meetings/batch/read',
    )
    for (const m of r.results ?? []) {
      const ms = paraMs(m.properties?.hs_meeting_start_time)
      if (ms != null) reuniao.set(String(m.id), { ms, tipo: (m.properties?.hs_activity_type || '').trim() })
    }
  }

  const brutos: Bruto[] = negocios
    // Negócio de usuário desativado some: não há quem cobrar.
    .filter((d) => !!d.properties.hubspot_owner_id && !!nomeDe(d.properties.hubspot_owner_id))
    .map((d) => ({
      id: d.id,
      nome: d.properties.dealname || `Negócio ${d.id}`,
      ownerId: d.properties.hubspot_owner_id,
      criadoMs: paraMs(d.properties.createdate),
      qualificacaoMs: paraMs(d.properties.pipedrive___data_de_qualificacao),
      propostaMs: primeiraProposta.get(d.id) ?? null,
      reunioes: (porNegocio.get(d.id) ?? []).map((m) => reuniao.get(m)).filter(Boolean) as {
        ms: number
        tipo: string
      }[],
    }))

  return agrupar(brutos, nomeDe, hoje)
}

export type NegocioSLA = {
  nome: string
  link: string
  closer: string
  fechouMs: number | null
  dias: number | null
  atrasado: boolean
}

export async function buscarSlaOnboarding(token: string, nomeDe: (id: string) => string, hoje: number) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const negocios = await buscarNegocios(
    token,
    [
      { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B2B },
      { propertyName: 'dealstage', operator: 'EQ', value: ONBOARDING.etapa },
    ],
    ['dealname', 'hubspot_owner_id', 'closedate'],
  )

  // Referência = a entrada MAIS ANTIGA em "Negócio fechado" ou na própria
  // "Aguardando Onboarding", lida do histórico de dealstage. O
  // hs_v2_date_entered pega só a última entrada, e a de Aguardando Onboarding
  // vem vazia no HubSpot.
  const entrada = new Map<string, number>()
  const alvos = new Set([ONBOARDING.etapaReferencia, ONBOARDING.etapa])
  for (const lote of pedacos(negocios.map((d) => d.id), 50)) {
    await espera(150)
    const r = await chamar(
      'https://api.hubapi.com/crm/v3/objects/deals/batch/read',
      { method: 'POST', headers, body: JSON.stringify({ propertiesWithHistory: ['dealstage'], inputs: lote.map((id) => ({ id })) }) },
      'deals/batch/read dealstage',
    )
    for (const d of r.results ?? []) {
      let menor: number | null = null
      for (const h of d.propertiesWithHistory?.dealstage ?? []) {
        if (!alvos.has(h.value)) continue
        const t = Date.parse(h.timestamp)
        if (Number.isFinite(t) && (menor == null || t < menor)) menor = t
      }
      if (menor != null) entrada.set(String(d.id), menor)
    }
  }

  const itens: NegocioSLA[] = negocios
    .map((d) => {
      const fechouMs = entrada.get(d.id) ?? paraMs(d.properties.closedate)
      const dias = fechouMs != null ? Math.floor((hoje - fechouMs) / DIA) : null
      return {
        nome: d.properties.dealname || `Negócio ${d.id}`,
        link: linkNegocio(d.id),
        closer: nomeDe(d.properties.hubspot_owner_id) || 'Sem closer',
        fechouMs,
        dias,
        atrasado: dias != null && dias > ONBOARDING.prazoDias,
      }
    })
    .sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1))

  const atrasados = itens.filter((i) => i.atrasado).length
  return {
    rotulo: ONBOARDING.rotulo,
    prazoDias: ONBOARDING.prazoDias,
    total: itens.length,
    atrasados,
    noPrazo: itens.length - atrasados,
    negocios: itens,
  }
}
