// Gera um HTML estático com todos os tickets da etapa "Em andamento" do
// pipeline CS, listando os campos pedidos, preenchidos ou não.
//
//   node gerar-html-em-andamento.mjs
//
// Lê HUBSPOT_TOKEN do ambiente ou de .env.local. Escreve em-andamento.html.

import { readFileSync, writeFileSync } from 'node:fs'
import { iso, cliente, palestrante } from './lib/sinaleira.ts'

const ETAPA = '1088360205' // Em andamento
const PIPELINE = process.env.HUBSPOT_PIPELINE_CS ?? '748675953'
const PORTAL = '49656171'

const CAMPOS = [
  { prop: 'hubspot_owner_id', rotulo: 'Proprietário do Ticket', tipo: 'owner' },
  { prop: 'data_do_evento__ganho_', rotulo: 'Data do Evento', tipo: 'data' },
  { prop: 'formato_de_contrato__ganho_', rotulo: 'Formato do Contrato', tipo: 'texto' },
  { prop: 'nf_da_psa_para_o_cliente', rotulo: 'NF e Boleto da PSA para o cliente', tipo: 'link' },
  { prop: 'contrato', rotulo: 'Contrato Cliente', tipo: 'link' },
  { prop: 'contrato_palestrante', rotulo: 'Contrato Palestrante', tipo: 'link' },
]

function token() {
  if (process.env.HUBSPOT_TOKEN) return process.env.HUBSPOT_TOKEN
  try {
    const linha = readFileSync('.env.local', 'utf8')
      .replace(/^﻿/, '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith('HUBSPOT_TOKEN='))
    if (linha) return linha.slice('HUBSPOT_TOKEN='.length).trim().replace(/^["']|["']$/g, '')
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
      console.error(`\n✕ ${onde} respondeu ${res.status}\n`)
      console.error(await res.text())
      process.exit(1)
    }
    return res.json()
  }
}

// Inclui arquivados: o filtro precisa funcionar para quem saiu da empresa.
console.log('Lendo owners (ativos e arquivados)...')
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
console.log(`${owners.size} owners.`)

console.log('Lendo tickets de "Em andamento"...')
const tickets = []
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
              { propertyName: 'hs_pipeline_stage', operator: 'EQ', value: ETAPA },
            ],
          },
        ],
        properties: ['subject', ...CAMPOS.map((c) => c.prop)],
        sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
        limit: 100,
        after,
      }),
    },
    'tickets/search',
  )
  for (const r of p.results ?? []) tickets.push({ id: r.id, p: r.properties ?? {} })
  after = p.paging?.next?.after
} while (after)
console.log(`${tickets.length} tickets.`)

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const dataBr = (s) => (s ? s.split('-').reverse().join('/') : '')

function valor(campo, p) {
  const bruto = p[campo.prop]
  if (!bruto)
    return { vazio: true, texto: '', titulo: '', html: '<span class="vazio">não preenchido</span>' }

  if (campo.tipo === 'owner') {
    const o = owners.get(String(bruto))
    const nome = o?.nome ?? `#${bruto}`
    return {
      vazio: false,
      texto: nome,
      titulo: o?.inativo ? `${nome} (arquivado no HubSpot)` : nome,
      html: o?.inativo ? `${esc(nome)} <span class="inativo">inativo</span>` : esc(nome),
    }
  }

  if (campo.tipo === 'data') {
    const d = iso(bruto)
    return { vazio: false, texto: d, iso: d, titulo: dataBr(d), html: esc(dataBr(d)) }
  }

  const txt = String(bruto).trim()

  if (campo.tipo === 'link') {
    // O campo guarda ora uma URL, ora uma lista de ids separada por ";". Mostrar
    // a lista crua estourava a coluna; o valor inteiro fica no title.
    if (/^https?:\/\//i.test(txt))
      return {
        vazio: false,
        texto: txt,
        titulo: txt,
        html: `<a href="${esc(txt)}" target="_blank" rel="noreferrer">abrir</a>`,
      }
    const partes = txt.split(';').map((s) => s.trim()).filter(Boolean)
    const rotulo =
      partes.length > 1 ? `${partes.length} documentos` : partes[0] ?? txt
    return { vazio: false, texto: txt, titulo: partes.join('\n'), html: esc(rotulo) }
  }

  return { vazio: false, texto: txt, titulo: txt, html: esc(txt) }
}

const linhas = tickets.map((t) => {
  const cels = CAMPOS.map((c) => valor(c, t.p))
  const dono = cels[0]
  const subject = t.p.subject ?? '(sem assunto)'
  return {
    id: t.id,
    subject,
    // O subject traz "Cliente - Palestrante - data - formato - ID: n". Mostrar
    // a string crua deixava o ID e o formato competindo com o nome do cliente.
    cliente: cliente(subject) || subject,
    palestrante: palestrante(subject),
    proprietario: dono.vazio ? 'Sem proprietário' : dono.texto,
    cels,
  }
})

const preenchimento = CAMPOS.map((c, i) => ({
  rotulo: c.rotulo,
  ok: linhas.filter((l) => !l.cels[i].vazio).length,
}))

const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

const mesDe = (l) => {
  const d = l.cels[1].iso
  return d ? d.slice(0, 7) : ''
}
const mesBr = (m) => (m ? m.split('-').reverse().join('/') : '')

const proprietarios = [...new Set(linhas.map((l) => l.proprietario))].sort((a, b) =>
  a.localeCompare(b, 'pt-BR'),
)
const formatos = [...new Set(linhas.map((l) => l.cels[2].texto).filter(Boolean))].sort((a, b) =>
  a.localeCompare(b, 'pt-BR'),
)
const meses = [...new Set(linhas.map(mesDe).filter(Boolean))].sort()

// Os tres campos de documento interessam por estarem preenchidos ou nao, mais
// do que pelo valor: filtro de tres estados em vez de lista de valores.
const DOCS = [
  { i: 3, id: 'nf', rotulo: 'NF e Boleto' },
  { i: 4, id: 'cc', rotulo: 'Contrato Cliente' },
  { i: 5, id: 'cp', rotulo: 'Contrato Palestrante' },
]

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Em andamento · Tramitação CS</title>
<style>
:root{color-scheme:light dark;--bg:#f5f5f7;--card:#fff;--text:#1d1d1f;--t2:#6e6e73;--t3:#8e8e93;--line:rgba(0,0,0,.09);--vermelho:#c41e14;--chip:rgba(120,120,128,.14)}
@media(prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--text:#f5f5f7;--t2:#a1a1a6;--t3:#8e8e93;--line:rgba(255,255,255,.12);--vermelho:#ff6961;--chip:rgba(120,120,128,.24)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1600px;margin:0 auto;padding:36px 20px 56px}
h1{font-size:28px;font-weight:600;letter-spacing:-.02em;margin:0}
.sub{color:var(--t2);font-size:13px;margin:5px 0 20px}
.resumo{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:18px}
.resumo div{background:var(--card);border-radius:10px;padding:10px 12px}
.resumo .r{font-size:11px;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.resumo .n{font-size:19px;font-weight:600;margin-top:1px}
.resumo .n span{font-size:12px;color:var(--t3);font-weight:400}
.barra{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
select,input{font:inherit;font-size:13px;height:32px;border:0;border-radius:7px;background:var(--chip);color:var(--text);padding:0 9px;max-width:210px}
option{background:var(--card);color:var(--text)}
.conta{color:var(--t3);font-size:13px;margin-left:auto}
.limpar{border:0;background:none;color:var(--t3);font:inherit;font-size:13px;cursor:pointer;height:32px}
.limpar:hover{color:var(--text)}
.rolagem{background:var(--card);border-radius:12px;overflow-x:auto}
table{width:100%;border-collapse:separate;border-spacing:0;min-width:1020px}
thead th{position:sticky;top:0;z-index:2;background:var(--card);text-align:left;font-size:10px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;padding:10px 12px;white-space:nowrap;border-bottom:1px solid var(--line)}
td{padding:8px 12px;font-size:13px;border-bottom:1px solid var(--line);vertical-align:middle;white-space:nowrap;max-width:250px;overflow:hidden;text-overflow:ellipsis}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover td{background:var(--chip)}
th:first-child,td:first-child{position:sticky;left:0;z-index:1;background:var(--card);width:260px;max-width:260px}
tbody tr:hover td:first-child{background:var(--chip)}
.cli{font-weight:500;display:block;overflow:hidden;text-overflow:ellipsis}
.cli a{color:inherit;text-decoration:none}
.cli a:hover{text-decoration:underline}
.pal{color:var(--t2);font-size:12px;display:block;overflow:hidden;text-overflow:ellipsis}
.vazio{color:var(--vermelho)}
.inativo{color:var(--vermelho);font-size:11px}
a{color:#0071e3}
@media(prefers-color-scheme:dark){a{color:#0a84ff}}
tr.off{display:none}
.nada{padding:24px 12px;color:var(--t3);font-size:14px}
</style>
</head>
<body>
<main>
<h1>Em andamento</h1>
<p class="sub">Tramitação CS · ${tickets.length} tickets · gerado em ${esc(agora)}</p>

<div class="resumo">
${preenchimento
  .map(
    (p) =>
      `<div><div class="r" title="${esc(p.rotulo)}">${esc(p.rotulo)}</div><div class="n">${p.ok}<span> de ${tickets.length}</span></div></div>`,
  )
  .join('\n')}
</div>

<div class="barra">
<select id="f-dono"><option value="">Proprietário: todos</option>
${proprietarios.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
</select>
<select id="f-mes"><option value="">Data do evento: todas</option>
${meses.map((m) => `<option value="${esc(m)}">${esc(mesBr(m))}</option>`).join('')}
</select>
<select id="f-formato"><option value="">Formato: todos</option>
${formatos.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}
</select>
${DOCS.map(
  (d) =>
    `<select id="f-${d.id}"><option value="">${esc(d.rotulo)}: todos</option><option value="1">preenchido</option><option value="0">não preenchido</option></select>`,
).join('\n')}
<input id="f-busca" placeholder="Buscar cliente ou palestrante" size="26">
<button class="limpar" id="limpar">Limpar</button>
<span class="conta" id="conta"></span>
</div>

<div class="rolagem">
<table>
<thead><tr><th>Ticket</th>${CAMPOS.map((c) => `<th>${esc(c.rotulo)}</th>`).join('')}</tr></thead>
<tbody>
${linhas
  .map(
    (l) => `<tr data-dono="${esc(l.proprietario)}" data-mes="${esc(mesDe(l))}" data-formato="${esc(l.cels[2].texto ?? '')}" ${DOCS.map(
      (d) => `data-${d.id}="${l.cels[d.i].vazio ? 0 : 1}"`,
    ).join(' ')} data-txt="${esc((l.cliente + ' ' + l.palestrante).toLowerCase())}">
<td><span class="cli"><a href="https://app.hubspot.com/contacts/${PORTAL}/record/0-5/${l.id}" target="_blank" rel="noreferrer">${esc(l.cliente)}</a></span><span class="pal">${esc(l.palestrante || '—')}</span></td>
${l.cels.map((c) => `<td title="${esc(c.titulo ?? '')}">${c.html}</td>`).join('')}
</tr>`,
  )
  .join('\n')}
</tbody>
</table>
<p class="nada" id="nada" style="display:none">Nenhum ticket com esses filtros.</p>
</div>
</main>

<script>
const campos=['dono','mes','formato',${DOCS.map((d) => `'${d.id}'`).join(',')}]
const el=id=>document.getElementById(id)
const busca=el('f-busca'), conta=el('conta'), nada=el('nada')
const linhas=[...document.querySelectorAll('tbody tr')]
function aplicar(){
  const v={}; for(const c of campos) v[c]=el('f-'+c).value
  const q=busca.value.trim().toLowerCase()
  let n=0
  for(const tr of linhas){
    let ok = !q || tr.dataset.txt.includes(q)
    if(ok) for(const c of campos){ if(v[c] && tr.dataset[c]!==v[c]){ ok=false; break } }
    tr.classList.toggle('off', !ok)
    if(ok) n++
  }
  conta.textContent = n + (n===1?' ticket':' tickets')
  nada.style.display = n ? 'none' : 'block'
}
for(const c of campos) el('f-'+c).onchange=aplicar
busca.oninput=aplicar
el('limpar').onclick=()=>{ for(const c of campos) el('f-'+c).value=''; busca.value=''; aplicar() }
aplicar()
</script>
</body>
</html>
`

writeFileSync('em-andamento.html', html)
console.log('\nem-andamento.html gerado.')
for (const p of preenchimento)
  console.log(`  ${p.rotulo.padEnd(36)} ${String(p.ok).padStart(4)} de ${tickets.length}`)
