// Carteira por CS: quantos tickets cada um carrega, em que etapa estão, qual a
// cor na sinaleira, quanto tempo de atraso, e onde a atribuição está furada
// (sem curador, sem proprietário, ou com usuário desativado).
//
//   node gerar-html-cs.mjs
//
// Lê HUBSPOT_TOKEN do ambiente ou de .env.local. Sai em cs-carteira.html,
// arquivo único — o HTML tem nome de cliente, então fica fora do git.
//
// A cor sai de avaliarEtapa, a mesma função que pinta o painel: se divergir, é
// bug, não é outra régua.

import { readFileSync, writeFileSync } from 'node:fs'
import { QUADROS, avaliar, cliente, palestrante, completar, iso } from './lib/sinaleira.ts'
import { RELOGIOS, avaliarEtapa, eventoPassou } from './lib/relogios.ts'

const PIPELINE = process.env.HUBSPOT_PIPELINE_CS ?? '748675953'
const PORTAL = '49656171'
const SAIDA = 'cs-carteira.html'
const DIA = 86_400_000

const PROPS = [
  'subject',
  'hs_pipeline_stage',
  'data_do_evento__ganho_',
  'curador_responsavel_new',
  'hubspot_owner_id',
  'hs_v2_date_entered_current_stage',
  'data_de_realizacao_do_onboarding',
  'status_do_contrato',
  'logistica_sera_organizada_pela_psa_',
  'tipo_de_empresa_contratante',
  'formato_da_empresa',
  'formato_de_contrato__ganho_',
  'palestrante_e_exclusivo',
  'palestrante_principal',
  'assinar_contrato',
  'data_de_assinatura_do_contrato',
  'data_para_realizacao_de_briefing',
  'data_e_hora_da_call_de_briefing',
  'hs_v2_date_entered_1450325175',
  'data_de_faturamento',
  'data_de_emissao',
  'adquirir_logistica',
  'data_prevista_de_pagamento_logistica',
  'data_de_envio_contrato_cliente',
  'data_de_envio_contrato_palestrante',
  'prazo_de_assinatura__contrato_palestrante',
  'data_de_assinatura__palestrante_',
  'contrato',
  'contrato_palestrante',
]

function token() {
  if (process.env.HUBSPOT_TOKEN) return process.env.HUBSPOT_TOKEN
  try {
    const l = readFileSync('.env.local', 'utf8')
      .replace(/^﻿/, '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.startsWith('HUBSPOT_TOKEN='))
    if (l) return l.slice('HUBSPOT_TOKEN='.length).trim().replace(/^["']|["']$/g, '')
  } catch {}
  console.error('Faltou o token. Crie .env.local com HUBSPOT_TOKEN=pat-na1-...')
  process.exit(1)
}

const H = { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

async function chamar(url, init, onde) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, init)
    if (res.status === 429 && i < 4) {
      await espera(2 ** i * 500)
      continue
    }
    if (!res.ok) {
      console.error(`\n✕ ${onde} respondeu ${res.status}\n${await res.text()}`)
      process.exit(1)
    }
    return res.json()
  }
}
const postar = (url, body, onde) =>
  chamar(url, { method: 'POST', headers: H, body: JSON.stringify(body) }, onde)
const pedacos = (xs, n) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

// ---- dados ----

console.log('Lendo owners...')
const owners = new Map()
for (const arquivados of [false, true]) {
  let after
  do {
    await espera(300)
    const u = new URL('https://api.hubapi.com/crm/v3/owners')
    u.searchParams.set('limit', '500')
    if (arquivados) u.searchParams.set('archived', 'true')
    if (after) u.searchParams.set('after', after)
    const p = await chamar(u, { headers: H }, 'owners')
    for (const o of p.results ?? []) {
      const nome = [o.firstName, o.lastName].filter(Boolean).join(' ').trim()
      owners.set(String(o.id), { nome: nome || o.email || `#${o.id}`, inativo: arquivados })
    }
    after = p.paging?.next?.after
  } while (after)
}

const SLA = QUADROS.cs.sla
console.log('Lendo tickets das etapas da sinaleira...')
const brutos = []
let after
do {
  await espera(300)
  const p = await postar(
    'https://api.hubapi.com/crm/v3/objects/tickets/search',
    {
      filterGroups: [
        {
          filters: [
            { propertyName: 'hs_pipeline', operator: 'EQ', value: PIPELINE },
            { propertyName: 'hs_pipeline_stage', operator: 'IN', values: Object.keys(SLA) },
          ],
        },
      ],
      properties: PROPS,
      sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
      limit: 100,
      after,
    },
    'tickets/search',
  )
  brutos.push(...(p.results ?? []))
  after = p.paging?.next?.after
} while (after)
console.log(`  ${brutos.length} tickets`)

const tickets = brutos.map((r) => {
  const p = r.properties ?? {}
  return completar({
    id: r.id,
    subject: p.subject ?? '(sem assunto)',
    stage: p.hs_pipeline_stage,
    evento: iso(p.data_do_evento__ganho_),
    curador: p.curador_responsavel_new || null,
    proprietario: p.hubspot_owner_id || null,
    onboarding: iso(p.data_de_realizacao_do_onboarding),
    statusContrato: p.status_do_contrato ?? '',
    entrouEtapa: iso(p.hs_v2_date_entered_current_stage),
    logistica: p.logistica_sera_organizada_pela_psa_ ?? '',
    tipoEmpresa: p.tipo_de_empresa_contratante ?? '',
    formatoEmpresa: p.formato_da_empresa ?? '',
    formatoContrato: p.formato_de_contrato__ganho_ ?? '',
    palestranteExclusivo: p.palestrante_e_exclusivo ?? '',
    palestrantePrincipal: p.palestrante_principal ?? '',
    prazoAssinatura: iso(p.assinar_contrato),
    dataAssinatura: iso(p.data_de_assinatura_do_contrato),
    prazoBriefing: iso(p.data_para_realizacao_de_briefing),
    callBriefing: iso(p.data_e_hora_da_call_de_briefing),
    entrouBriefing: iso(p.hs_v2_date_entered_1450325175),
    dataFaturamento: iso(p.data_de_faturamento),
    dataEmissao: iso(p.data_de_emissao),
    prazoLogistica: iso(p.adquirir_logistica),
    pagamentoLogistica: iso(p.data_prevista_de_pagamento_logistica),
    envioCliente: iso(p.data_de_envio_contrato_cliente),
    envioPalestrante: iso(p.data_de_envio_contrato_palestrante),
    prazoAssinaturaPalestrante: iso(p.prazo_de_assinatura__contrato_palestrante),
    dataAssinaturaPalestrante: iso(p.data_de_assinatura__palestrante_),
    anexoCliente: p.contrato ?? '',
    anexoPalestrante: p.contrato_palestrante ?? '',
  })
})

// A aquisição da logística corre do ganho do negócio: sem isso a coluna sairia
// cinza aqui e colorida no painel.
const ETAPAS_LOGISTICA = ['Contratar Logística', 'Logística']
const naLogistica = tickets.filter((t) => ETAPAS_LOGISTICA.includes(SLA[t.stage]?.label))
if (naLogistica.length) {
  console.log(`Lendo ganho do negócio de ${naLogistica.length} tickets de logística...`)
  await espera(300)
  const funis = await chamar('https://api.hubapi.com/crm/v3/pipelines/deals', { headers: H }, 'pipelines/deals')
  const ganho = new Set()
  for (const f of funis.results ?? [])
    for (const e of f.stages ?? [])
      if (e.metadata?.isClosed === 'true' && e.metadata?.probability === '1.0') ganho.add(String(e.id))

  const porTicket = new Map()
  for (const lote of pedacos(naLogistica.map((t) => t.id), 100)) {
    await espera(300)
    const r = await postar(
      'https://api.hubapi.com/crm/v4/associations/tickets/deals/batch/read',
      { inputs: lote.map((id) => ({ id })) },
      'associations tickets→deals',
    )
    for (const res of r.results ?? []) {
      const para = (res.to ?? []).map((d) => String(d.toObjectId ?? d.id))
      if (res.from?.id && para.length) porTicket.set(String(res.from.id), para)
    }
  }
  const primeiro = new Map()
  for (const lote of pedacos([...new Set([...porTicket.values()].flat())], 50)) {
    await espera(300)
    const r = await postar(
      'https://api.hubapi.com/crm/v3/objects/deals/batch/read',
      { properties: ['dealstage'], propertiesWithHistory: ['dealstage'], inputs: lote.map((id) => ({ id })) },
      'deals/batch/read',
    )
    for (const d of r.results ?? []) {
      const quando = (d.propertiesWithHistory?.dealstage ?? [])
        .filter((h) => ganho.has(String(h.value)))
        .map((h) => String(h.timestamp))
        .sort()[0]
      if (quando) primeiro.set(String(d.id), quando)
    }
  }
  for (const t of naLogistica) {
    const datas = (porTicket.get(t.id) ?? []).map((d) => primeiro.get(d)).filter(Boolean).sort()
    if (datas.length) t.ganhoNegocio = iso(datas[0])
  }
}

// ---- avaliação ----

const hoje = Date.now()
const emDias = (a, b) => Math.round((a - b) / DIA)
const dia = (s) => (s ? Date.parse(s + 'T00:00:00Z') : NaN)
const hojeEmDias = dia(new Date(hoje).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }))

// Quantos dias de atraso o ticket acumula. Etapa por tempo na etapa já devolve
// isso em avaliar().dias; etapa por relógio precisa do pior relógio aceso, e o
// evento passado manda em todos.
function atrasoDe(t) {
  const regra = SLA[t.stage]
  if (!regra) return 0
  if (regra.tipo === 'dias' || regra.tipo === 'evento') {
    const a = avaliar(t, hoje, SLA)
    return Math.max(0, a.dias)
  }
  if (regra.tipo !== 'relogio') return 0
  if (eventoPassou(t, hoje)) return Math.max(0, emDias(hojeEmDias, dia(t.evento)))
  let pior = 0
  for (const rel of RELOGIOS) {
    if (!rel.etapa.includes(regra.label)) continue
    const v = rel.ver(t, hoje)
    if ((v.estado === 'vermelho' || v.estado === 'amarelo') && typeof v.dias === 'number')
      pior = Math.max(pior, v.dias)
  }
  return pior
}

const nomeDe = (id) => (id ? (owners.get(String(id))?.nome ?? `#${id}`) : null)
const inativo = (id) => !!id && !!owners.get(String(id))?.inativo

const linhas = tickets.map((t) => {
  const a = avaliarEtapa(t, hoje, SLA)
  return {
    id: t.id,
    cliente: cliente(t.subject),
    palestrante: palestrante(t.subject),
    evento: t.evento,
    etapa: a.etapa,
    ordem: SLA[t.stage]?.ordem ?? 99,
    cor: a.cor,
    texto: a.texto ?? '',
    atraso: atrasoDe(t),
    diasNaEtapa: Number.isFinite(dia(t.entrouEtapa)) ? emDias(hojeEmDias, dia(t.entrouEtapa)) : null,
    curador: nomeDe(t.curador),
    curadorInativo: inativo(t.curador),
    proprietario: nomeDe(t.proprietario),
    proprietarioInativo: inativo(t.proprietario),
  }
})

// ---- html ----

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const dataBr = (s) => (s ? s.split('-').reverse().join('/') : '—')
const CORES = ['vermelho', 'amarelo', 'verde', 'cinza']
const ROTULO = { vermelho: 'Atrasado', amarelo: 'Atenção', verde: 'Em dia', cinza: 'Sem prazo' }

function agrupar(linhas, chave, chaveInativo) {
  const m = new Map()
  for (const l of linhas) {
    const nome = l[chave] ?? '— sem atribuição —'
    if (!m.has(nome)) m.set(nome, { nome, inativo: l[chaveInativo], semAtribuicao: !l[chave], linhas: [] })
    m.get(nome).linhas.push(l)
  }
  for (const g of m.values()) {
    for (const c of CORES) g[c] = g.linhas.filter((l) => l.cor === c).length
    const atrasos = g.linhas.filter((l) => l.atraso > 0).map((l) => l.atraso)
    g.atrasados = atrasos.length
    g.atrasoMax = atrasos.length ? Math.max(...atrasos) : 0
    g.atrasoMediano = atrasos.length ? atrasos.sort((a, b) => a - b)[Math.floor(atrasos.length / 2)] : 0
    g.linhas.sort((a, b) => b.atraso - a.atraso || a.ordem - b.ordem)
  }
  // Quem tem mais vermelho primeiro: a lista existe para achar carteira travada.
  return [...m.values()].sort((a, b) => b.vermelho - a.vermelho || b.linhas.length - a.linhas.length)
}

const porCurador = agrupar(linhas, 'curador', 'curadorInativo')
const porProprietario = agrupar(linhas, 'proprietario', 'proprietarioInativo')

const porEtapa = [...new Set(linhas.map((l) => l.etapa))]
  .map((etapa) => {
    const minhas = linhas.filter((l) => l.etapa === etapa)
    const o = { etapa, total: minhas.length, ordem: minhas[0].ordem }
    for (const c of CORES) o[c] = minhas.filter((l) => l.cor === c).length
    return o
  })
  .sort((a, b) => a.ordem - b.ordem)

const semCurador = linhas.filter((l) => !l.curador).length
const curadorMorto = linhas.filter((l) => l.curador && l.curadorInativo).length
const semProprietario = linhas.filter((l) => !l.proprietario).length
const proprietarioMorto = linhas.filter((l) => l.proprietario && l.proprietarioInativo).length

const bolinha = (cor) => `<span class="p p-${cor}"></span>`

const linhaTicket = (l) => `
  <tr>
    <td><a href="https://app.hubspot.com/contacts/${PORTAL}/record/0-5/${l.id}" target="_blank" rel="noopener">${esc(l.cliente)}</a>
      <span class="sub">${esc(l.palestrante)}</span></td>
    <td>${esc(l.etapa)}</td>
    <td class="nowrap">${bolinha(l.cor)} ${ROTULO[l.cor]}</td>
    <td class="num ${l.atraso > 0 ? 'mal' : ''}">${l.atraso > 0 ? l.atraso + 'd' : '—'}</td>
    <td class="num">${l.diasNaEtapa == null ? '—' : l.diasNaEtapa + 'd'}</td>
    <td class="nowrap">${dataBr(l.evento)}</td>
    <td>${esc(l.texto)}</td>
  </tr>`

const bloco = (titulo, grupos, rotuloOutro, campoOutro, campoOutroInativo) => `
<h2>${titulo}</h2>
<table class="resumo">
  <thead><tr>
    <th>${titulo.replace('Por ', '')}</th><th class="num">Tickets</th>
    ${CORES.map((c) => `<th class="num">${bolinha(c)} ${ROTULO[c]}</th>`).join('')}
    <th class="num">Atraso mediano</th><th class="num">Pior atraso</th>
  </tr></thead>
  <tbody>
  ${grupos
    .map(
      (g) => `
    <tr class="cab">
      <td>
        ${g.semAtribuicao ? '<b class="mal">— sem atribuição —</b>' : `<b>${esc(g.nome)}</b>`}
        ${g.inativo && !g.semAtribuicao ? '<span class="tag">usuário desativado</span>' : ''}
      </td>
      <td class="num">${g.linhas.length}</td>
      ${CORES.map((c) => `<td class="num ${c === 'vermelho' && g[c] ? 'mal' : ''}">${g[c] || ''}</td>`).join('')}
      <td class="num">${g.atrasoMediano || '—'}</td>
      <td class="num ${g.atrasoMax ? 'mal' : ''}">${g.atrasoMax || '—'}</td>
    </tr>
    <tr class="det"><td colspan="8">
      <details>
        <summary>${g.linhas.length} ticket${g.linhas.length === 1 ? '' : 's'} — ver etapa, cor e atraso</summary>
        <table class="tickets">
          <thead><tr>
            <th>Ticket</th><th>Etapa</th><th>Sinaleira</th><th class="num">Atraso</th>
            <th class="num">Na etapa</th><th>Evento</th><th>Motivo</th>
          </tr></thead>
          <tbody>${g.linhas.map(linhaTicket).join('')}</tbody>
        </table>
      </details>
    </td></tr>`,
    )
    .join('')}
  </tbody>
</table>`

const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

const html = `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carteira por CS — Sinaleira</title>
<style>
  :root{
    --fundo:#0b0d10; --card:#14181d; --linha:#232a31; --texto:#e8edf2; --fraco:#9fb0c0;
    --verde:#22c55e; --amarelo:#eab308; --vermelho:#ef4444; --cinza:#64748b; --link:#3b82f6;
  }
  *{box-sizing:border-box}
  body{margin:0;padding:28px 20px 64px;background:var(--fundo);color:var(--texto);
       font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  .topo{max-width:1180px;margin:0 auto 24px}
  h1{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}
  .meta{color:var(--fraco);font-size:13px}
  h2{font-size:16px;margin:36px 0 10px;max-width:1180px;margin-inline:auto}
  main{max-width:1180px;margin:0 auto}
  .cartoes{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0 0}
  .cartao{background:var(--card);border:1px solid var(--linha);border-radius:10px;padding:14px 18px;min-width:168px}
  .cartao .n{font-size:26px;font-weight:700;line-height:1.1}
  .cartao .r{color:var(--fraco);font-size:12px;margin-top:2px}
  .cartao.ruim .n{color:var(--vermelho)}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--linha);border-radius:10px;overflow:hidden}
  th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--linha);vertical-align:top}
  th{font-size:12px;font-weight:600;color:var(--fraco);white-space:nowrap}
  .num{text-align:right;white-space:nowrap}
  .nowrap{white-space:nowrap}
  tr.cab td{background:#171c22}
  tr.det td{padding:0 12px 10px}
  .mal{color:var(--vermelho);font-weight:600}
  .tag{display:inline-block;margin-left:8px;padding:1px 7px;border-radius:99px;font-size:11px;
       background:rgba(239,68,68,.15);color:var(--vermelho)}
  .p{display:inline-block;width:9px;height:9px;border-radius:99px;vertical-align:-1px}
  .p-verde{background:var(--verde)} .p-amarelo{background:var(--amarelo)}
  .p-vermelho{background:var(--vermelho)} .p-cinza{background:var(--cinza)}
  a{color:var(--link);text-decoration:none} a:hover{text-decoration:underline}
  .sub{display:block;color:var(--fraco);font-size:12px}
  details>summary{cursor:pointer;color:var(--fraco);font-size:12px;padding:6px 0}
  table.tickets{margin:4px 0 10px;background:#10141a}
  table.tickets th{font-size:11px}
  table.tickets td{font-size:13px}
</style>
</head><body>
<div class="topo">
  <h1>Carteira por CS</h1>
  <div class="meta">${linhas.length} tickets nas etapas da sinaleira · pipeline de CS · gerado em ${agora}</div>
  <div class="cartoes">
    <div class="cartao"><div class="n">${linhas.length}</div><div class="r">tickets abertos</div></div>
    <div class="cartao ${semCurador ? 'ruim' : ''}"><div class="n">${semCurador}</div><div class="r">sem curador</div></div>
    <div class="cartao ${curadorMorto ? 'ruim' : ''}"><div class="n">${curadorMorto}</div><div class="r">curador desativado</div></div>
    <div class="cartao ${semProprietario ? 'ruim' : ''}"><div class="n">${semProprietario}</div><div class="r">sem proprietário</div></div>
    <div class="cartao ${proprietarioMorto ? 'ruim' : ''}"><div class="n">${proprietarioMorto}</div><div class="r">proprietário desativado</div></div>
  </div>
</div>

<main>
${bloco('Por curador', porCurador)}
${bloco('Por proprietário', porProprietario)}

<h2>Por etapa</h2>
<table class="resumo">
  <thead><tr><th>Etapa</th><th class="num">Tickets</th>
  ${CORES.map((c) => `<th class="num">${bolinha(c)} ${ROTULO[c]}</th>`).join('')}</tr></thead>
  <tbody>
  ${porEtapa
    .map(
      (e) => `<tr><td>${esc(e.etapa)}</td><td class="num">${e.total}</td>
      ${CORES.map((c) => `<td class="num ${c === 'vermelho' && e[c] ? 'mal' : ''}">${e[c] || ''}</td>`).join('')}</tr>`,
    )
    .join('')}
  </tbody>
</table>
</main>
</body></html>`

writeFileSync(SAIDA, html)
console.log(`\n✓ ${SAIDA}`)
console.log(`  ${linhas.length} tickets · ${porCurador.length} curadores · ${porProprietario.length} proprietários`)
console.log(`  sem curador ${semCurador} · curador desativado ${curadorMorto}`)
console.log(`  sem proprietário ${semProprietario} · proprietário desativado ${proprietarioMorto}`)
for (const c of CORES) console.log(`  ${c}: ${linhas.filter((l) => l.cor === c).length}`)
