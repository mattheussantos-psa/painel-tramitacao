// Gera um HTML por etapa do pipeline CS, pronto para compartilhar: arquivo
// único, fonte embutida, sem dependência de rede.
//
//   node gerar-html-etapas.mjs
//
// Lê HUBSPOT_TOKEN do ambiente ou de .env.local.

import { readFileSync, writeFileSync } from 'node:fs'
import { iso, cliente, palestrante, avaliar, SLA, prazoEmTexto } from './lib/sinaleira.ts'

const PIPELINE = process.env.HUBSPOT_PIPELINE_CS ?? '748675953'
const PORTAL = '49656171'

const ETAPAS = [
  { id: '1088360205', arquivo: 'em-andamento.html' },
  { id: '1088361911', arquivo: 'pagamento-pos-palestra.html' },
  { id: '1333136740', arquivo: 'aguardando-nf-palestrante.html' },
]

const CAMPOS = [
  { prop: 'formato_de_contrato__ganho_', rotulo: 'Formato do Contrato', tipo: 'texto', id: 'fmt' },
  { prop: 'nf_da_psa_para_o_cliente', rotulo: 'NF e Boleto da PSA', tipo: 'doc', id: 'nf' },
  { prop: 'contrato', rotulo: 'Contrato Cliente', tipo: 'doc', id: 'cc' },
  { prop: 'contrato_palestrante', rotulo: 'Contrato Palestrante', tipo: 'doc', id: 'cp' },
]

const PROPS = [
  'subject',
  'hs_pipeline_stage',
  'hubspot_owner_id',
  'data_do_evento__ganho_',
  'hs_v2_date_entered_current_stage',
  ...CAMPOS.map((c) => c.prop),
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

async function buscar(etapa) {
  const out = []
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
                { propertyName: 'hs_pipeline_stage', operator: 'EQ', value: etapa },
              ],
            },
          ],
          properties: PROPS,
          sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
          limit: 100,
          after,
        }),
      },
      'tickets/search',
    )
    for (const r of p.results ?? []) out.push({ id: r.id, p: r.properties ?? {} })
    after = p.paging?.next?.after
  } while (after)
  return out
}

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
const dataBr = (s) => (s ? s.split('-').reverse().join('/') : '')

// Fonte embutida: o arquivo precisa abrir igual na máquina de quem receber.
const fonte = readFileSync('public/fonts/BrutaProCompressed-ExtraBold.otf').toString('base64')

const hoje = Date.now()
const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

function montar(etapaId, tickets) {
  const regra = SLA[etapaId]
  const temPrazo = regra.tipo !== 'sem-prazo'

  const linhas = tickets.map((t) => {
    const subject = t.p.subject ?? '(sem assunto)'
    const evento = iso(t.p.data_do_evento__ganho_)
    const entrou = iso(t.p.hs_v2_date_entered_current_stage)
    const a = avaliar(
      { stage: etapaId, evento, entrouEtapa: entrou, subject, id: t.id, curador: null, proprietario: null, proximaTarefa: '' },
      hoje,
    )
    const dono = t.p.hubspot_owner_id ? owners.get(String(t.p.hubspot_owner_id)) : null
    const diasEtapa = entrou ? Math.round((hoje - Date.parse(entrou + 'T00:00:00Z')) / 86400000) : null

    const cels = CAMPOS.map((c) => {
      const bruto = t.p[c.prop]
      if (!bruto) return { vazio: true, texto: '', titulo: '', html: '<span class="falta">falta</span>' }
      const txt = String(bruto).trim()
      if (c.tipo === 'doc') {
        if (/^https?:\/\//i.test(txt))
          return { vazio: false, texto: txt, titulo: txt, html: `<a href="${esc(txt)}" target="_blank" rel="noreferrer">abrir</a>` }
        const partes = txt.split(';').map((s) => s.trim()).filter(Boolean)
        return {
          vazio: false,
          texto: txt,
          titulo: partes.join('\n'),
          html: `<span class="ok">${esc(partes.length > 1 ? `${partes.length} docs` : partes[0] ?? txt)}</span>`,
        }
      }
      return { vazio: false, texto: txt, titulo: txt, html: esc(txt) }
    })

    return {
      id: t.id,
      cliente: cliente(subject) || subject,
      palestrante: palestrante(subject),
      dono: dono?.nome ?? (t.p.hubspot_owner_id ? `#${t.p.hubspot_owner_id}` : 'Sem proprietário'),
      donoInativo: !!dono?.inativo,
      semDono: !t.p.hubspot_owner_id,
      evento,
      mes: evento ? evento.slice(0, 7) : '',
      diasEtapa,
      cor: a.cor,
      cels,
      faltam: cels.filter((c) => c.vazio).length,
    }
  })

  // Quem tem mais buraco primeiro; empate desempata pelo tempo parado.
  linhas.sort((a, b) => b.faltam - a.faltam || (b.diasEtapa ?? 0) - (a.diasEtapa ?? 0))

  const donos = [...new Set(linhas.map((l) => l.dono))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const formatos = [...new Set(linhas.map((l) => l.cels[0].texto).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  )
  const meses = [...new Set(linhas.map((l) => l.mes).filter(Boolean))].sort()
  const mesBr = (m) => m.split('-').reverse().join('/')

  const n = linhas.length || 1
  const barras = [
    { rotulo: 'Proprietário', ok: linhas.filter((l) => !l.semDono).length },
    { rotulo: 'Data do Evento', ok: linhas.filter((l) => l.evento).length },
    ...CAMPOS.map((c, i) => ({ rotulo: c.rotulo, ok: linhas.filter((l) => !l.cels[i].vazio).length })),
  ]

  const completos = linhas.filter((l) => l.faltam === 0).length

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(regra.label)} · Tramitação CS</title>
<style>
@font-face{font-family:'Bruta Pro Compressed';src:url(data:font/otf;base64,${fonte}) format('opentype');font-weight:800;font-display:swap}
:root{color-scheme:light;--bg:#f2f2f5;--card:#fff;--text:#16161a;--t2:#63636b;--t3:#93939b;--line:rgba(0,0,0,.08);--vermelho:#c8332a;--vermelho-bg:#fdeeec;--ambar:#9a5a00;--ambar-bg:#fdf3e3;--verde:#1f7a38;--verde-bg:#e9f6ed;--chip:rgba(120,120,128,.1)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1560px;margin:0 auto;padding:40px 24px 64px}
header{margin-bottom:26px}
.chapeu{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--t3)}
h1{font-family:'Bruta Pro Compressed','Arial Narrow',sans-serif;font-weight:800;font-size:52px;line-height:1;letter-spacing:.01em;text-transform:uppercase;margin:6px 0 0}
.linha-topo{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap}
.total{text-align:right}
.total b{font-family:'Bruta Pro Compressed','Arial Narrow',sans-serif;font-weight:800;font-size:44px;line-height:1;display:block}
.total span{font-size:12px;color:var(--t2)}
.meta{color:var(--t2);font-size:13px;margin-top:10px}
.painel{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-bottom:24px}
.barra{background:var(--card);border-radius:12px;padding:13px 15px}
.barra .r{font-size:12px;color:var(--t2);display:flex;justify-content:space-between;gap:8px;margin-bottom:8px}
.barra .r b{font-weight:600;color:var(--text)}
.trilho{height:6px;border-radius:3px;background:var(--chip);overflow:hidden}
.trilho i{display:block;height:100%;border-radius:3px}
.filtros{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
select,input{font:inherit;font-size:13px;height:34px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text);padding:0 10px;max-width:220px}
option{background:var(--card);color:var(--text)}
.limpar{border:0;background:none;color:var(--t2);font:inherit;font-size:13px;cursor:pointer;height:34px;padding:0 4px}
.limpar:hover{color:var(--text);text-decoration:underline}
.conta{margin-left:auto;font-size:13px;color:var(--t2)}
.quadro{background:var(--card);border-radius:14px;overflow-x:auto;box-shadow:0 1px 2px rgba(0,0,0,.04)}
table{width:100%;border-collapse:separate;border-spacing:0;min-width:1120px}
th{position:sticky;top:0;z-index:2;background:var(--card);text-align:left;font-size:10px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.07em;padding:13px 14px;white-space:nowrap;border-bottom:1px solid var(--line)}
td{padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:middle;white-space:nowrap;max-width:230px;overflow:hidden;text-overflow:ellipsis}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover td{background:#fafafc}
th:first-child,td:first-child{position:sticky;left:0;z-index:1;background:var(--card);width:280px;max-width:280px;white-space:normal}
tbody tr:hover td:first-child{background:#fafafc}
.cli{font-weight:600;display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cli a{color:inherit;text-decoration:none}
.cli a:hover{text-decoration:underline}
.pal{color:var(--t2);font-size:12px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.falta{display:inline-block;background:var(--vermelho-bg);color:var(--vermelho);font-size:11px;font-weight:600;padding:2px 8px;border-radius:5px}
.ok{font-variant-numeric:tabular-nums;color:var(--t2);font-size:12px}
.dias{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;border-radius:5px;font-variant-numeric:tabular-nums}
.dias.verde{background:var(--verde-bg);color:var(--verde)}
.dias.amarelo{background:var(--ambar-bg);color:var(--ambar)}
.dias.vermelho{background:var(--vermelho-bg);color:var(--vermelho)}
.dias.cinza{background:var(--chip);color:var(--t2)}
.inativo{color:var(--vermelho);font-size:11px}
.pend{font-variant-numeric:tabular-nums;font-weight:600;font-size:12px}
.pend.zero{color:var(--verde)}
.pend.tem{color:var(--vermelho)}
a{color:#0064d2}
tr.off{display:none}
.nada{padding:28px 16px;color:var(--t3)}
footer{margin-top:20px;font-size:12px;color:var(--t3)}
@media print{
  body{background:#fff}
  .filtros,.limpar{display:none}
  .quadro{box-shadow:none;overflow:visible}
  tr.off{display:none}
  th{position:static}
  th:first-child,td:first-child{position:static}
}
</style>
</head>
<body>
<main>
<header>
<div class="linha-topo">
<div>
<div class="chapeu">Tramitação CS · etapa do pipeline</div>
<h1>${esc(regra.label)}</h1>
</div>
<div class="total"><b>${linhas.length}</b><span>tickets na etapa</span></div>
</div>
<p class="meta">Prazo da etapa: <b>${esc(prazoEmTexto(regra))}</b> · ${completos} de ${linhas.length} com todos os campos preenchidos · gerado em ${esc(agora)}</p>
</header>

<div class="painel">
${barras
  .map((b) => {
    const pct = Math.round((b.ok / n) * 100)
    const cor = pct >= 90 ? 'var(--verde)' : pct >= 60 ? 'var(--ambar)' : 'var(--vermelho)'
    return `<div class="barra"><div class="r"><span>${esc(b.rotulo)}</span><b>${b.ok} de ${linhas.length}</b></div><div class="trilho"><i style="width:${pct}%;background:${cor}"></i></div></div>`
  })
  .join('\n')}
</div>

<div class="filtros">
<select id="f-dono"><option value="">Proprietário: todos</option>${donos.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select>
<select id="f-mes"><option value="">Data do evento: todas</option>${meses.map((m) => `<option value="${esc(m)}">${esc(mesBr(m))}</option>`).join('')}</select>
<select id="f-fmt"><option value="">Formato: todos</option>${formatos.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select>
<select id="f-nf"><option value="">NF e Boleto: todos</option><option value="1">preenchido</option><option value="0">falta</option></select>
<select id="f-cc"><option value="">Contrato Cliente: todos</option><option value="1">preenchido</option><option value="0">falta</option></select>
<select id="f-cp"><option value="">Contrato Palestrante: todos</option><option value="1">preenchido</option><option value="0">falta</option></select>
<input id="f-busca" placeholder="Buscar cliente ou palestrante" size="24">
<button class="limpar" id="limpar">Limpar</button>
<span class="conta" id="conta"></span>
</div>

<div class="quadro">
<table>
<thead><tr>
<th>Ticket</th><th>Proprietário</th><th>Data do Evento</th><th>Dias na etapa</th>
${CAMPOS.map((c) => `<th>${esc(c.rotulo)}</th>`).join('')}<th>Pendências</th>
</tr></thead>
<tbody>
${linhas
  .map(
    (l) => `<tr data-dono="${esc(l.dono)}" data-mes="${esc(l.mes)}" data-fmt="${esc(l.cels[0].texto)}" data-nf="${l.cels[1].vazio ? 0 : 1}" data-cc="${l.cels[2].vazio ? 0 : 1}" data-cp="${l.cels[3].vazio ? 0 : 1}" data-txt="${esc((l.cliente + ' ' + l.palestrante).toLowerCase())}">
<td><span class="cli"><a href="https://app.hubspot.com/contacts/${PORTAL}/record/0-5/${l.id}" target="_blank" rel="noreferrer">${esc(l.cliente)}</a></span><span class="pal">${esc(l.palestrante || '—')}</span></td>
<td>${l.semDono ? '<span class="falta">sem dono</span>' : esc(l.dono) + (l.donoInativo ? ' <span class="inativo">inativo</span>' : '')}</td>
<td>${l.evento ? esc(dataBr(l.evento)) : '<span class="falta">falta</span>'}</td>
<td>${l.diasEtapa === null ? '<span class="falta">sem data</span>' : `<span class="dias ${l.cor}">${l.diasEtapa}d</span>`}</td>
${l.cels.map((c) => `<td title="${esc(c.titulo)}">${c.html}</td>`).join('')}
<td class="pend ${l.faltam ? 'tem' : 'zero'}">${l.faltam ? `${l.faltam} de 4` : 'completo'}</td>
</tr>`,
  )
  .join('\n')}
</tbody>
</table>
<p class="nada" id="nada" style="display:none">Nenhum ticket com esses filtros.</p>
</div>

<footer>Fonte: HubSpot, pipeline CS (${PIPELINE}). Cada linha abre o ticket no HubSpot.${temPrazo ? '' : ' Esta etapa ainda não tem prazo acordado, por isso os dias aparecem em cinza.'}</footer>
</main>

<script>
const campos=['dono','mes','fmt','nf','cc','cp'], el=i=>document.getElementById(i)
const busca=el('f-busca'), conta=el('conta'), nada=el('nada')
const linhas=[...document.querySelectorAll('tbody tr')]
function aplicar(){
  const v={}; for(const c of campos) v[c]=el('f-'+c).value
  const q=busca.value.trim().toLowerCase()
  let n=0
  for(const tr of linhas){
    let ok=!q||tr.dataset.txt.includes(q)
    if(ok) for(const c of campos){ if(v[c]&&tr.dataset[c]!==v[c]){ok=false;break} }
    tr.classList.toggle('off',!ok); if(ok)n++
  }
  conta.textContent=n+(n===1?' ticket':' tickets')
  nada.style.display=n?'none':'block'
}
for(const c of campos) el('f-'+c).onchange=aplicar
busca.oninput=aplicar
el('limpar').onclick=()=>{for(const c of campos)el('f-'+c).value='';busca.value='';aplicar()}
aplicar()
</script>
</body>
</html>
`
}

for (const e of ETAPAS) {
  console.log(`\nLendo "${SLA[e.id].label}"...`)
  const tickets = await buscar(e.id)
  writeFileSync(e.arquivo, montar(e.id, tickets))
  console.log(`  ${tickets.length} tickets → ${e.arquivo}`)
}
console.log('\npronto.')
