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
  if (!bruto) return { vazio: true, html: '<span class="vazio">não preenchido</span>' }
  if (campo.tipo === 'owner') {
    const o = owners.get(String(bruto))
    const nome = o?.nome ?? `#${bruto}`
    return {
      vazio: false,
      texto: nome,
      html: o?.inativo
        ? `${esc(nome)} <span class="inativo">inativo</span>`
        : esc(nome),
    }
  }
  if (campo.tipo === 'data') return { vazio: false, html: esc(dataBr(iso(bruto))) }
  if (campo.tipo === 'link' && /^https?:\/\//i.test(String(bruto).trim()))
    return { vazio: false, html: `<a href="${esc(bruto)}" target="_blank" rel="noreferrer">abrir</a>` }
  return { vazio: false, html: esc(bruto) }
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

const proprietarios = [...new Set(linhas.map((l) => l.proprietario))].sort((a, b) =>
  a.localeCompare(b, 'pt-BR'),
)

const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Em andamento · Tramitação CS</title>
<style>
:root{color-scheme:light dark;--bg:#f5f5f7;--card:#fff;--text:#1d1d1f;--t2:#6e6e73;--t3:#8e8e93;--line:rgba(0,0,0,.1);--vermelho:#c41e14;--verde:#248a3d}
@media(prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--text:#f5f5f7;--t2:#a1a1a6;--t3:#8e8e93;--line:rgba(255,255,255,.14);--vermelho:#ff6961;--verde:#5be07f}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1680px;margin:0 auto;padding:40px 24px 64px}
h1{font-size:30px;font-weight:600;letter-spacing:-.02em;margin:0}
.sub{color:var(--t2);font-size:14px;margin:6px 0 22px}
.resumo{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:22px}
.resumo div{background:var(--card);border-radius:12px;padding:12px 14px}
.resumo .r{font-size:12px;color:var(--t2)}
.resumo .n{font-size:22px;font-weight:600;margin-top:2px}
.barra{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:18px}
select,input{font:inherit;font-size:13px;height:34px;border:0;border-radius:8px;background:rgba(120,120,128,.14);color:var(--text);padding:0 10px}
/* Sem isto o popup do select sai cinza sobre cinza no Chrome/Windows. */
option{background:var(--card);color:var(--text)}
.conta{color:var(--t3);font-size:13px}
/* A tabela tem 7 colunas: em tela estreita ela precisa rolar dentro do
   contêiner, senão o conteúdo some cortado na borda da página. */
.rolagem{background:var(--card);border-radius:12px;overflow:auto;max-height:calc(100vh - 120px)}
table{width:100%;border-collapse:separate;border-spacing:0;min-width:1100px}
thead th{position:sticky;top:0;z-index:2;background:var(--card);text-align:left;font-size:11px;font-weight:500;color:var(--t3);text-transform:uppercase;letter-spacing:.05em;padding:12px 14px;white-space:nowrap;border-bottom:1px solid var(--line)}
td{padding:10px 14px;font-size:13px;border-bottom:1px solid var(--line);vertical-align:middle;white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover td{background:rgba(120,120,128,.09)}
th:first-child,td:first-child{position:sticky;left:0;z-index:1;background:var(--card);min-width:300px;white-space:normal}
tbody tr:hover td:first-child{background:var(--card)}
.cli{font-weight:500;display:block}
.cli a{color:inherit;text-decoration:none}
.cli a:hover{text-decoration:underline}
.pal{color:var(--t2);font-size:12px}
.vazio{color:var(--vermelho)}
.inativo{color:var(--vermelho);font-size:11px}
a{color:#0071e3}
@media(prefers-color-scheme:dark){a{color:#0a84ff}}
tr.off{display:none}
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
      `<div><div class="r">${esc(p.rotulo)}</div><div class="n">${p.ok}<span style="font-size:13px;color:var(--t3);font-weight:400"> de ${tickets.length}</span></div></div>`,
  )
  .join('\n')}
</div>

<div class="barra">
<select id="dono">
<option value="">Todos os proprietários</option>
${proprietarios.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('\n')}
</select>
<input id="busca" placeholder="Buscar cliente ou palestrante" size="30">
<label style="font-size:13px;color:var(--t2)"><input type="checkbox" id="faltando" style="height:auto;width:auto;vertical-align:middle"> só com campo faltando</label>
<span class="conta" id="conta"></span>
</div>

<div class="rolagem">
<table>
<thead><tr><th>Ticket</th>${CAMPOS.map((c) => `<th>${esc(c.rotulo)}</th>`).join('')}</tr></thead>
<tbody>
${linhas
  .map(
    (l) => `<tr data-dono="${esc(l.proprietario)}" data-falta="${l.cels.some((c) => c.vazio) ? 1 : 0}" data-txt="${esc(l.subject.toLowerCase())}">
<td><span class="cli"><a href="https://app.hubspot.com/contacts/${PORTAL}/record/0-5/${l.id}" target="_blank" rel="noreferrer">${esc(l.cliente)}</a></span><span class="pal">${esc(l.palestrante || '—')}</span></td>
${l.cels.map((c) => `<td>${c.html}</td>`).join('')}
</tr>`,
  )
  .join('\n')}
</tbody>
</table>
</div>
</main>

<script>
const dono=document.getElementById('dono'),busca=document.getElementById('busca'),
      faltando=document.getElementById('faltando'),conta=document.getElementById('conta'),
      linhas=[...document.querySelectorAll('tbody tr')]
function aplicar(){
  const d=dono.value, q=busca.value.trim().toLowerCase(), f=faltando.checked
  let n=0
  for(const tr of linhas){
    const ok = (!d || tr.dataset.dono===d) && (!q || tr.dataset.txt.includes(q)) && (!f || tr.dataset.falta==='1')
    tr.classList.toggle('off', !ok)
    if(ok) n++
  }
  conta.textContent = n + (n===1?' ticket':' tickets')
}
dono.onchange=busca.oninput=faltando.onchange=aplicar
aplicar()
</script>
</body>
</html>
`

writeFileSync('em-andamento.html', html)
console.log('\nem-andamento.html gerado.')
for (const p of preenchimento)
  console.log(`  ${p.rotulo.padEnd(36)} ${String(p.ok).padStart(4)} de ${tickets.length}`)
