// Simula as regras de prazo da Tramitação (pipeline 941149608) sobre os
// tickets REAIS e abertos do CS (748675953), e gera um HTML único para
// compartilhar e discutir.
//
//   node simular-tramitacao.mjs
//
// Nada é escrito no HubSpot. Nada é aplicado no painel em produção: o arquivo
// existe para o CS olhar caso a caso e decidir o que fecha e o que falta.
//
// Lê HUBSPOT_TOKEN do ambiente ou de .env.local.

import { readFileSync, writeFileSync } from 'node:fs'
import { iso, cliente, palestrante, SLA } from './lib/sinaleira.ts'
import { RELOGIOS, ORGAO_PUBLICO, EXIGE_MINUTA_PALESTRANTE } from './lib/relogios.ts'

const PIPELINE = process.env.HUBSPOT_PIPELINE_CS ?? '748675953'
const PORTAL = '49656171'
const SAIDA = 'simulacao-tramitacao.html'

// Em lote de 50, e só as etapas ativas do CS.
const LOTE = 50
const ETAPAS = Object.keys(SLA)

const PROPS = [
  'subject',
  'hs_pipeline_stage',
  'hubspot_owner_id',
  'data_do_evento__ganho_',
  'logistica_sera_organizada_pela_psa_',
  'tipo_de_empresa_contratante',
  'formato_de_contrato__ganho_',
  'data_de_realizacao_do_onboarding',
  'assinar_contrato',
  'data_de_assinatura_do_contrato',
  'status_do_contrato',
  'data_de_faturamento',
  'data_de_emissao',
  'data_para_realizacao_de_briefing',
  'data_e_hora_da_call_de_briefing',
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

// O search do HubSpot tem teto de 4 req/s para a conta inteira. 300ms entre
// chamadas e repetição no 429 — morrer no meio de uma simulação de 8 chamadas
// seria o jeito mais bobo de perder 2 minutos.
async function chamar(url, init, onde) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, init)
    if (res.status === 429 && i < 4) {
      await espera(2 ** i * 500)
      continue
    }
    if (!res.ok) {
      console.error(`\n✕ ${onde} respondeu ${res.status}\n${(await res.text()).slice(0, 600)}`)
      process.exit(1)
    }
    return res.json()
  }
}

const pedacos = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

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
      owners.set(String(o.id), nome || o.email || `#${o.id}`)
    }
    after = p.paging?.next?.after
  } while (after)
}

console.log(`Lendo tickets abertos do CS em lotes de ${LOTE}...`)
const brutos = []
let after
do {
  await espera(300)
  const p = await chamar(
    'https://api.hubapi.com/crm/v3/objects/tickets/search',
    {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              { propertyName: 'hs_pipeline', operator: 'EQ', value: PIPELINE },
              { propertyName: 'hs_pipeline_stage', operator: 'IN', values: ETAPAS },
            ],
          },
        ],
        properties: PROPS,
        sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
        limit: LOTE,
        after,
      }),
    },
    'tickets/search',
  )
  brutos.push(...(p.results ?? []))
  after = p.paging?.next?.after
  process.stdout.write(`\r  ${brutos.length} tickets`)
} while (after)
console.log('')

console.log('Lendo reuniões associadas...')
const porTicket = new Map()
for (const lote of pedacos(brutos.map((t) => t.id), LOTE)) {
  await espera(300)
  const r = await chamar(
    'https://api.hubapi.com/crm/v4/associations/tickets/meetings/batch/read',
    { method: 'POST', headers: H, body: JSON.stringify({ inputs: lote.map((id) => ({ id })) }) },
    'associations tickets→meetings',
  )
  for (const x of r.results ?? []) porTicket.set(String(x.from.id), (x.to ?? []).map((m) => String(m.toObjectId)))
}

const reunioes = new Map()
const idsReuniao = [...new Set([...porTicket.values()].flat())]
for (const lote of pedacos(idsReuniao, LOTE)) {
  await espera(300)
  const r = await chamar(
    'https://api.hubapi.com/crm/v3/objects/meetings/batch/read',
    {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        properties: ['hs_meeting_title', 'hs_meeting_start_time', 'hs_meeting_outcome'],
        inputs: lote.map((id) => ({ id })),
      }),
    },
    'meetings/batch/read',
  )
  for (const m of r.results ?? [])
    reunioes.set(String(m.id), {
      titulo: m.properties?.hs_meeting_title ?? '',
      inicio: iso(m.properties?.hs_meeting_start_time),
      desfecho: m.properties?.hs_meeting_outcome ?? '',
    })
}
console.log(`  ${idsReuniao.length} reuniões em ${[...porTicket.values()].filter((v) => v.length).length} tickets`)

const hoje = Date.now()

const tickets = brutos.map((r) => {
  const p = r.properties ?? {}
  const t = {
    id: r.id,
    subject: p.subject ?? '(sem assunto)',
    stage: p.hs_pipeline_stage,
    proprietario: owners.get(String(p.hubspot_owner_id)) ?? null,
    evento: iso(p.data_do_evento__ganho_),
    logistica: p.logistica_sera_organizada_pela_psa_ ?? '',
    tipoEmpresa: p.tipo_de_empresa_contratante ?? '',
    formatoContrato: p.formato_de_contrato__ganho_ ?? '',
    onboarding: iso(p.data_de_realizacao_do_onboarding),
    prazoAssinatura: iso(p.assinar_contrato),
    dataAssinatura: iso(p.data_de_assinatura_do_contrato),
    statusContrato: p.status_do_contrato ?? '',
    dataFaturamento: iso(p.data_de_faturamento),
    dataEmissao: iso(p.data_de_emissao),
    prazoBriefing: iso(p.data_para_realizacao_de_briefing),
    callBriefing: iso(p.data_e_hora_da_call_de_briefing),
    reunioes: (porTicket.get(r.id) ?? []).map((m) => reunioes.get(m)).filter(Boolean),
  }
  return {
    ...t,
    cliente: cliente(t.subject),
    palestrante: palestrante(t.subject),
    etapa: SLA[t.stage]?.label ?? t.stage,
    orgaoPublico: t.tipoEmpresa === ORGAO_PUBLICO,
    minutaPalestrante: EXIGE_MINUTA_PALESTRANTE(t.formatoContrato),
    veredito: Object.fromEntries(RELOGIOS.map((rel) => [rel.chave, rel.ver(t, hoje)])),
  }
})

// ---------- HTML ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const dataBr = (s) => (s ? s.split('-').reverse().join('/') : '—')

const fonte = readFileSync('public/fonts/BrutaProCompressed-ExtraBold.otf').toString('base64')

const CORES = ['vermelho', 'amarelo', 'verde']
const CONFIANCA = {
  fechado: 'Relógio fechado',
  hipotese: 'Hipótese · sem marco de conclusão',
  bloqueado: 'Sem como medir',
}

const ROTULO = {
  vermelho: 'Vencido',
  amarelo: 'Alerta',
  verde: 'No prazo',
  concluido: 'Concluído',
  'nao-iniciado': 'Não iniciado',
  'nao-aplica': 'Não se aplica',
  'sem-dado': 'Sem dado',
  bloqueado: 'Sem como medir',
}

const cobertura = RELOGIOS.map((rel) => {
  const c = {}
  for (const t of tickets) {
    const e = t.veredito[rel.chave].estado
    c[e] = (c[e] ?? 0) + 1
  }
  const comCor = CORES.reduce((s, k) => s + (c[k] ?? 0), 0)
  return { ...rel, contagem: c, comCor }
})

// Único relógio com as duas pontas: dá para medir aderência de verdade.
const comVeredito = tickets.filter((t) => t.veredito['contrato-assinatura'].cumpriu !== null)
const cumpriram = comVeredito.filter((t) => t.veredito['contrato-assinatura'].cumpriu).length

const dados = tickets.map((t) => ({
  id: t.id,
  cliente: t.cliente,
  palestrante: t.palestrante,
  etapa: t.etapa,
  proprietario: t.proprietario ?? 'Sem proprietário',
  evento: t.evento,
  logistica: t.logistica || '(vazio)',
  tipoEmpresa: t.tipoEmpresa || '(vazio)',
  formatoContrato: t.formatoContrato || '(vazio)',
  onboarding: t.onboarding,
  prazoAssinatura: t.prazoAssinatura,
  dataAssinatura: t.dataAssinatura,
  statusContrato: t.statusContrato || '(vazio)',
  orgaoPublico: t.orgaoPublico,
  minutaPalestrante: t.minutaPalestrante,
  v: Object.fromEntries(RELOGIOS.map((r) => [r.chave, t.veredito[r.chave]])),
}))

const barra = (c) => {
  const ordem = ['vermelho', 'amarelo', 'verde', 'concluido', 'nao-iniciado', 'nao-aplica', 'sem-dado', 'bloqueado']
  const total = ordem.reduce((s, k) => s + (c[k] ?? 0), 0) || 1
  return ordem
    .filter((k) => c[k])
    .map(
      (k) =>
        `<span class="fatia ${k}" style="width:${(c[k] / total) * 100}%" title="${ROTULO[k]}: ${c[k]}">${
          (c[k] / total) * 100 > 6 ? c[k] : ''
        }</span>`,
    )
    .join('')
}

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Simulação · regras da Tramitação sobre o CS</title>
<style>
@font-face{font-family:'Bruta Pro Compressed';src:url(data:font/otf;base64,${fonte}) format('opentype');font-weight:800;font-display:swap}
:root{
  color-scheme:light;
  --bg:#f5f5f7;--card:#fff;--text:#1d1d1f;--text-2:#6e6e73;--line:rgba(0,0,0,.1);
  --verde:#248a3d;--verde-bg:#e7f6ec;--verde-ponto:#34c759;
  --amarelo:#a25c00;--amarelo-bg:#fdf1e0;--amarelo-ponto:#ff9500;
  --vermelho:#c41e14;--vermelho-bg:#fdecea;--vermelho-ponto:#ff3b30;
  --cinza:#6e6e73;--cinza-bg:rgba(120,120,128,.12);--cinza-ponto:#8e8e93;
  --roxo:#4b49c7;--roxo-bg:rgba(94,92,230,.12);
}
@media(prefers-color-scheme:dark){:root{
  color-scheme:dark;
  --bg:#000;--card:#1c1c1e;--text:#f5f5f7;--text-2:#a1a1a6;--line:rgba(255,255,255,.14);
  --verde:#5be07f;--verde-bg:rgba(52,199,89,.18);--verde-ponto:#30d158;
  --amarelo:#ffb340;--amarelo-bg:rgba(255,159,10,.2);--amarelo-ponto:#ff9f0a;
  --vermelho:#ff6961;--vermelho-bg:rgba(255,59,48,.2);--vermelho-ponto:#ff453a;
  --cinza:#a1a1a6;--cinza-bg:rgba(120,120,128,.24);--cinza-ponto:#98989d;
  --roxo:#a5a3ff;--roxo-bg:rgba(94,92,230,.22);
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1680px;margin:0 auto;padding:44px 32px 72px}
h1{font-family:'Bruta Pro Compressed',Haettenschweiler,sans-serif;font-size:46px;font-weight:800;letter-spacing:.01em;line-height:1;margin:0;text-transform:uppercase}
h2{font-size:17px;font-weight:600;letter-spacing:-.01em;margin:40px 0 12px}
.sub{color:var(--text-2);margin:9px 0 0;font-size:14px}
.aviso{background:var(--roxo-bg);color:var(--roxo);border-radius:12px;padding:13px 16px;font-size:13px;margin:22px 0 0;font-weight:500}
.grupo{background:var(--card);border-radius:14px;border:1px solid var(--line);overflow:hidden}
.rel{padding:15px 18px;border-top:1px solid var(--line)}
.rel:first-child{border-top:0}
.rel-topo{display:flex;align-items:baseline;justify-content:space-between;gap:14px;flex-wrap:wrap}
.rel-nome{font-size:15px;font-weight:600}
.rel-etapa{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;background:var(--cinza-bg);border-radius:5px;padding:2px 7px;margin-left:8px}
.conf{font-size:11px;font-weight:600;border-radius:5px;padding:2px 7px;margin-left:6px;white-space:nowrap}
.conf.fechado{background:var(--verde-bg);color:var(--verde)}
.conf.hipotese{background:var(--amarelo-bg);color:var(--amarelo)}
.conf.bloqueado{background:var(--vermelho-bg);color:var(--vermelho)}
.leia{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:15px 18px;font-size:13px;margin:12px 0 0}
.leia p{margin:0 0 8px}
.leia p:last-child{margin:0}
.rel-regra{font-size:13px;color:var(--text-2);margin:3px 0 0}
.campos{font-size:12px;margin:7px 0 0;display:flex;gap:18px;flex-wrap:wrap}
.campos b{font-weight:600}
.campos code{font-size:11px;background:var(--cinza-bg);border-radius:4px;padding:1px 5px}
.pend{font-size:12px;background:var(--amarelo-bg);color:var(--amarelo);border-radius:8px;padding:8px 11px;margin:9px 0 0}
.barra{display:flex;height:22px;border-radius:6px;overflow:hidden;margin:11px 0 0;background:var(--cinza-bg)}
.fatia{display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#fff;min-width:3px}
.fatia.vermelho{background:var(--vermelho-ponto)}
.fatia.amarelo{background:var(--amarelo-ponto)}
.fatia.verde{background:var(--verde-ponto)}
.fatia.concluido{background:var(--roxo)}
.fatia.nao-iniciado{background:var(--cinza-ponto);opacity:.65}
.fatia.nao-aplica{background:var(--cinza-ponto);opacity:.4}
.fatia.sem-dado{background:var(--cinza-ponto);opacity:.25;color:var(--text)}
.fatia.bloqueado{background:repeating-linear-gradient(45deg,var(--cinza-ponto),var(--cinza-ponto) 5px,transparent 5px,transparent 10px)}
.legenda{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--text-2);margin:9px 0 0}
.legenda span{display:inline-flex;align-items:center;gap:5px}
.ponto{width:9px;height:9px;border-radius:5px;display:inline-block}
.filtros{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 0;align-items:center}
select,input[type=search]{height:34px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--text);font:inherit;font-size:13px;padding:0 10px;max-width:240px}
select option{background:var(--card);color:var(--text)}
button.limpar{height:34px;border-radius:8px;border:0;background:var(--cinza-bg);color:var(--text);font:inherit;font-size:13px;padding:0 13px;cursor:pointer}
.quadro{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:8px;scrollbar-width:thin}
.coluna{flex:1 0 290px;background:var(--cinza-bg);border-radius:14px;padding:10px;min-width:0}
.col-cab{padding:4px 6px 10px}
.col-nome{font-size:14px;font-weight:600;display:flex;align-items:center;gap:7px}
.col-n{background:var(--card);border-radius:20px;padding:1px 8px;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
.col-sub{font-size:11px;margin-top:2px}
.pilha{display:flex;flex-direction:column;gap:8px;max-height:560px;overflow-y:auto;padding-right:8px;scrollbar-width:thin}
.cartao{display:block;text-decoration:none;color:inherit;border-radius:11px;padding:10px 12px 10px 14px;border:1px solid transparent}
.cartao:hover{border-color:var(--text-2)}
.cartao.vermelho{background:var(--vermelho-bg);box-shadow:inset 3px 0 0 var(--vermelho-ponto)}
.cartao.amarelo{background:var(--amarelo-bg);box-shadow:inset 3px 0 0 var(--amarelo-ponto)}
.cartao.verde{background:var(--verde-bg);box-shadow:inset 3px 0 0 var(--verde-ponto)}
.c-topo{font-size:12px;font-weight:600;margin-bottom:5px}
.cartao.vermelho .c-topo{color:var(--vermelho)}
.cartao.amarelo .c-topo{color:var(--amarelo)}
.cartao.verde .c-topo{color:var(--verde)}
.c-cliente{font-size:14px;font-weight:600;letter-spacing:-.01em;line-height:1.3}
.c-pal{font-size:12px}
.c-pe{font-size:11px;margin-top:7px;padding-top:7px;border-top:1px solid rgba(0,0,0,.14)}
.tag{display:inline-block;font-size:10px;font-weight:600;border-radius:5px;padding:2px 6px;margin-top:6px;background:var(--amarelo-bg);color:var(--amarelo)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text-2);padding:10px 10px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--card);white-space:nowrap}
td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
tbody tr:hover{background:var(--cinza-bg)}
.rolagem-tabela{max-height:70vh;overflow:auto;scrollbar-width:thin}
.pill{display:inline-block;font-size:11px;font-weight:600;border-radius:5px;padding:2px 7px;white-space:nowrap}
.pill.vermelho{background:var(--vermelho-bg);color:var(--vermelho)}
.pill.amarelo{background:var(--amarelo-bg);color:var(--amarelo)}
.pill.verde{background:var(--verde-bg);color:var(--verde)}
.pill.concluido{background:var(--roxo-bg);color:var(--roxo)}
.pill.nao-iniciado,.pill.nao-aplica,.pill.sem-dado,.pill.bloqueado{background:var(--cinza-bg);color:var(--text)}
a.tk{color:inherit;text-decoration:none;font-weight:600}
a.tk:hover{text-decoration:underline}
.vazio{padding:12px 6px;font-size:13px;color:var(--text-2)}
.numero{font-family:'Bruta Pro Compressed',sans-serif;font-size:34px;font-weight:800;line-height:1}
.cxs{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0 0}
.cx{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:13px 16px;min-width:170px}
.cx-r{font-size:12px;color:var(--text-2)}
@media print{.filtros{display:none}.pilha{max-height:none}.rolagem-tabela{max-height:none}}
</style>
</head>
<body>
<main>
<h1>Simulação</h1>
<p class="sub">Regras da <b>TESTE | Tramitação</b> aplicadas aos <b>${tickets.length}</b> tickets reais e abertos do CS · capturado em ${new Date(hoje).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
<p class="aviso">Nada foi escrito no HubSpot e nada foi aplicado no painel em produção. Este arquivo existe para olhar caso a caso e decidir o que fecha e o que ainda falta de campo.</p>

<h2>Cobertura de cada relógio</h2>
<div class="leia">
  <p><b>Relógio fechado</b> tem as duas pontas: a data que dispara e o registro de que terminou. A cor mede atraso de verdade. Só um dos sete está nesse estado hoje.</p>
  <p><b>Hipótese</b> tem a data que dispara mas nenhum registro de conclusão. O relógio nunca para, então ticket resolvido há um ano continua contando — por isso esses aparecem entre 92% e 99% vermelhos. <b>O vermelho aqui mede ausência de registro, não atraso.</b> É o que precisa de campo novo para virar número confiável.</p>
  <p><b>Sem como medir</b> é quando falta até a data que dispara o relógio.</p>
</div>
<div class="grupo">
${cobertura
  .map(
    (r) => `<div class="rel">
  <div class="rel-topo">
    <div>
      <span class="rel-nome">${esc(r.nome)}</span><span class="rel-etapa">${esc(r.etapa)}</span><span class="conf ${r.confianca}">${CONFIANCA[r.confianca]}</span>
      <div class="rel-regra">${esc(r.regra)}</div>
    </div>
    <div style="text-align:right"><div class="numero">${r.comCor}</div><div class="cx-r">com cor calculada</div></div>
  </div>
  <div class="campos">
    <span><b>Dispara em</b> <code>${esc(r.gatilho)}</code></span>
    <span><b>Conclui em</b> <code>${esc(r.marco)}</code></span>
  </div>
  <div class="barra">${barra(r.contagem)}</div>
  <div class="legenda">${Object.entries(r.contagem)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `<span><i class="ponto fatia ${k}"></i>${ROTULO[k]} ${n}</span>`)
    .join('')}</div>
  ${r.pendencia ? `<div class="pend"><b>Pendente:</b> ${esc(r.pendencia)}</div>` : ''}
</div>`,
  )
  .join('')}
</div>

<h2>Aderência histórica — o único relógio com as duas pontas</h2>
<div class="cxs">
  <div class="cx"><div class="numero">${comVeredito.length}</div><div class="cx-r">contratos com prazo e data de assinatura</div></div>
  <div class="cx"><div class="numero" style="color:var(--verde)">${cumpriram}</div><div class="cx-r">assinados dentro do prazo</div></div>
  <div class="cx"><div class="numero" style="color:var(--vermelho)">${comVeredito.length - cumpriram}</div><div class="cx-r">assinados depois do prazo</div></div>
  <div class="cx"><div class="numero">${comVeredito.length ? Math.round((cumpriram / comVeredito.length) * 100) : 0}%</div><div class="cx-r">de aderência</div></div>
</div>

<h2>Quadro por relógio</h2>
<p class="sub">Cada coluna é um relógio, não uma etapa: o mesmo ticket aparece em mais de uma quando tem mais de um prazo correndo. Só entram os que têm cor — concluído, sem dado e não se aplica ficam de fora.</p>
<div class="filtros" id="filtros"></div>
<div class="quadro" id="quadro"></div>

<h2>Todos os tickets</h2>
<div class="grupo"><div class="rolagem-tabela"><table id="tabela"></table></div></div>
<p class="sub" id="contagem"></p>
</main>

<script>
const DADOS = ${JSON.stringify(dados)};
const RELOGIOS = ${JSON.stringify(RELOGIOS.map((r) => ({ chave: r.chave, nome: r.nome, etapa: r.etapa, regra: r.regra, confianca: r.confianca })))};
const CONFIANCA = ${JSON.stringify(CONFIANCA)};
const ROTULO = ${JSON.stringify(ROTULO)};
const PORTAL = '${PORTAL}';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dataBr = s => s ? s.split('-').reverse().join('/') : '—';
const link = id => 'https://app.hubspot.com/contacts/' + PORTAL + '/record/0-5/' + id;

const CAMPOS = [
  ['proprietario','Proprietário'],['etapa','Etapa no CS'],['logistica','Logística pela PSA'],
  ['tipoEmpresa','Tipo de empresa'],['formatoContrato','Formato de contrato'],['statusContrato','Status do contrato'],
];
const estado = {};
const filtros = document.getElementById('filtros');

for (const [campo, rotulo] of CAMPOS) {
  const vals = [...new Set(DADOS.map(d => d[campo]))].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));
  const s = document.createElement('select');
  s.innerHTML = '<option value="">' + rotulo + '</option>' + vals.map(v => '<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');
  s.onchange = () => { estado[campo] = s.value; pintar(); };
  filtros.appendChild(s);
}
const sRel = document.createElement('select');
sRel.innerHTML = '<option value="">Relógio: todos</option>' + RELOGIOS.map(r => '<option value="'+r.chave+'">'+esc(r.nome)+'</option>').join('');
sRel.onchange = () => { estado.relogio = sRel.value; pintar(); };
filtros.appendChild(sRel);

const sCor = document.createElement('select');
sCor.innerHTML = '<option value="">Situação: todas</option>' + Object.entries(ROTULO).map(([k,v]) => '<option value="'+k+'">'+esc(v)+'</option>').join('');
sCor.onchange = () => { estado.cor = sCor.value; pintar(); };
filtros.appendChild(sCor);

const busca = document.createElement('input');
busca.type = 'search'; busca.placeholder = 'Cliente ou palestrante';
busca.oninput = () => { estado.busca = busca.value.toLowerCase(); pintar(); };
filtros.appendChild(busca);

const btn = document.createElement('button');
btn.className = 'limpar'; btn.textContent = 'Limpar';
btn.onclick = () => {
  for (const k of Object.keys(estado)) delete estado[k];
  filtros.querySelectorAll('select').forEach(s => s.value = '');
  busca.value = ''; pintar();
};
filtros.appendChild(btn);

function filtrados() {
  return DADOS.filter(d => {
    for (const [campo] of CAMPOS) if (estado[campo] && d[campo] !== estado[campo]) return false;
    if (estado.busca && !((d.cliente+' '+d.palestrante).toLowerCase().includes(estado.busca))) return false;
    if (estado.cor) {
      const chaves = estado.relogio ? [estado.relogio] : RELOGIOS.map(r=>r.chave);
      if (!chaves.some(c => d.v[c].estado === estado.cor)) return false;
    }
    return true;
  });
}

function cartao(d, chave) {
  const v = d.v[chave];
  return '<a class="cartao '+v.estado+'" href="'+link(d.id)+'" target="_blank" rel="noreferrer">'
    + '<div class="c-topo">'+esc(v.texto)+'</div>'
    + '<div class="c-cliente">'+esc(d.cliente)+'</div>'
    + '<div class="c-pal">'+esc(d.palestrante || '—')+'</div>'
    + '<div class="c-pe">'+esc(d.etapa)+' · '+esc(d.proprietario)+'</div>'
    + (d.orgaoPublico ? '<span class="tag">Órgão Público</span>' : '')
    + '</a>';
}

function pintar() {
  const base = filtrados();
  const rels = estado.relogio ? RELOGIOS.filter(r => r.chave === estado.relogio) : RELOGIOS;

  document.getElementById('quadro').innerHTML = rels.map(r => {
    const itens = base.filter(d => ['verde','amarelo','vermelho'].includes(d.v[r.chave].estado))
      .sort((a,b) => ({vermelho:0,amarelo:1,verde:2}[a.v[r.chave].estado]) - ({vermelho:0,amarelo:1,verde:2}[b.v[r.chave].estado]) || a.cliente.localeCompare(b.cliente,'pt-BR'));
    return '<div class="coluna"><div class="col-cab"><div class="col-nome">'+esc(r.nome)+'<span class="col-n">'+itens.length+'</span></div>'
      + '<div class="col-sub"><span class="conf '+r.confianca+'" style="margin:0">'+esc(CONFIANCA[r.confianca])+'</span></div>'
      + '<div class="col-sub">'+esc(r.etapa)+' · '+esc(r.regra)+'</div></div>'
      + '<div class="pilha">' + (itens.length ? itens.map(d => cartao(d, r.chave)).join('') : '<div class="vazio">Nenhum com cor aqui.</div>') + '</div></div>';
  }).join('');

  const cols = ['Cliente','Palestrante','Etapa no CS','Proprietário','Evento','Onboarding','Logística','Tipo'].concat(RELOGIOS.map(r => r.nome));
  document.getElementById('tabela').innerHTML =
    '<thead><tr>' + cols.map(c => '<th>'+esc(c)+'</th>').join('') + '</tr></thead><tbody>'
    + base.map(d => '<tr>'
      + '<td><a class="tk" href="'+link(d.id)+'" target="_blank" rel="noreferrer">'+esc(d.cliente)+'</a>'
      + (d.orgaoPublico ? ' <span class="pill amarelo">OP</span>' : '') + '</td>'
      + '<td>'+esc(d.palestrante || '—')+'</td><td>'+esc(d.etapa)+'</td><td>'+esc(d.proprietario)+'</td>'
      + '<td>'+dataBr(d.evento)+'</td><td>'+dataBr(d.onboarding)+'</td>'
      + '<td>'+esc(d.logistica)+'</td><td>'+esc(d.tipoEmpresa)+'</td>'
      + RELOGIOS.map(r => '<td><span class="pill '+d.v[r.chave].estado+'" title="'+esc(d.v[r.chave].texto)+'">'+esc(ROTULO[d.v[r.chave].estado])+'</span></td>').join('')
      + '</tr>').join('')
    + '</tbody>';

  document.getElementById('contagem').textContent = base.length + ' de ' + DADOS.length + ' tickets';
}
pintar();
</script>
</body>
</html>`

writeFileSync(SAIDA, html)
console.log(`\n✓ ${SAIDA} — ${tickets.length} tickets`)
for (const r of cobertura) {
  const c = r.contagem
  console.log(
    `  ${r.nome.padEnd(26)} cor=${String(r.comCor).padStart(3)}  concluido=${String(c.concluido ?? 0).padStart(3)}  sem-dado=${String(c['sem-dado'] ?? 0).padStart(3)}  n/a=${String((c['nao-aplica'] ?? 0) + (c['nao-iniciado'] ?? 0)).padStart(3)}  bloq=${c.bloqueado ?? 0}`,
  )
}
console.log(`\n  aderência de assinatura: ${cumpriram}/${comVeredito.length}`)
