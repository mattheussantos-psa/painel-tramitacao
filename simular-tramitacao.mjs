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
import { iso, cliente, palestrante, SLA, SLA_TRAMITACAO } from './lib/sinaleira.ts'
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


// ---------- quadro ----------

// As sete etapas da TESTE | Tramitação, com os nomes e a ordem que estão no
// HubSpot. Cada uma junta os relógios que correm nela.
const ETAPAS_TRAMITACAO = Object.entries(SLA_TRAMITACAO)
  .sort(([, a], [, b]) => a.ordem - b.ordem)
  .map(([id, r]) => ({
    id,
    label: r.label,
    relogios: RELOGIOS.filter((rel) => rel.etapa.includes(r.label)),
  }))

const PESO = { vermelho: 3, amarelo: 2, verde: 1 }

// A etapa fica com a cor do pior relógio que corre nela: dois prazos na mesma
// etapa e uma cor só no card, então quem manda é o pior. Relógio bloqueado não
// tem cor — vira "sem prazo" em vez de verde por omissão.
function situacao(t, etapa) {
  let cor = null
  let texto = ''
  let bloqueado = false
  for (const rel of etapa.relogios) {
    const v = t.veredito[rel.chave]
    if (v.estado === 'bloqueado') bloqueado = true
    if (!PESO[v.estado]) continue
    if (!cor || PESO[v.estado] > PESO[cor]) {
      cor = v.estado
      texto = `${rel.nome.toLowerCase()} · ${v.texto}`
    }
  }
  if (cor) return { cor, texto }
  if (bloqueado) return { cor: 'cinza', texto: 'sem como medir a emissão' }
  return null
}

// Onde o ticket cairia na Tramitação: a primeira etapa, na ordem do funil, com
// regra ainda pendente. É derivação, não dado do HubSpot — o ticket vive no
// CS. Quem não tem nenhuma regra pendente fica fora do quadro e é contado no
// rodapé, em vez de ser empurrado para uma etapa que não é dele.
function alocar(t) {
  for (const etapa of ETAPAS_TRAMITACAO) {
    const s = situacao(t, etapa)
    if (s) return { etapa, ...s }
  }
  return null
}

const alocados = tickets.map((t) => ({ t, a: alocar(t) }))
const foraDoQuadro = alocados.filter((x) => !x.a).length

const dados = alocados
  .filter((x) => x.a)
  .map(({ t, a }) => ({
    id: t.id,
    cliente: t.cliente,
    palestrante: t.palestrante,
    evento: t.evento,
    etapaTramitacao: a.etapa.label,
    cor: a.cor,
    texto: a.texto,
    etapaCS: t.etapa,
    proprietario: t.proprietario ?? 'Sem proprietário',
    logistica: t.logistica || '(vazio)',
    tipoEmpresa: t.tipoEmpresa || '(vazio)',
    formatoContrato: t.formatoContrato || '(vazio)',
    statusContrato: t.statusContrato || '(vazio)',
    orgaoPublico: t.orgaoPublico,
  }))

// ---------- HTML ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const fonte = readFileSync('public/fonts/BrutaProCompressed-ExtraBold.otf').toString('base64')

const colunas = ETAPAS_TRAMITACAO.map((e) => ({
  label: e.label,
  regra: e.relogios.length ? e.relogios.map((r) => r.regra).join(' · ') : 'sem regra definida',
}))

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Simulação · TESTE | Tramitação com tickets reais do CS</title>
<style>
@font-face{font-family:'Bruta Pro Compressed';src:url(data:font/otf;base64,${fonte}) format('opentype');font-weight:800;font-display:swap}
:root{
  color-scheme:light;
  --bg:#f5f5f7;--card:#fff;--text:#1d1d1f;--text-2:#6e6e73;--line:rgba(0,0,0,.1);--linha-sobre-cor:rgba(0,0,0,.12);
  --verde:#248a3d;--verde-bg:#e7f6ec;--verde-ponto:#34c759;
  --amarelo:#a25c00;--amarelo-bg:#fdf1e0;--amarelo-ponto:#ff9500;
  --vermelho:#c41e14;--vermelho-bg:#fdecea;--vermelho-ponto:#ff3b30;
  --cinza:#6e6e73;--cinza-bg:rgba(120,120,128,.12);--cinza-ponto:#8e8e93;
}
@media(prefers-color-scheme:dark){:root{
  color-scheme:dark;
  --bg:#000;--card:#1c1c1e;--text:#f5f5f7;--text-2:#a1a1a6;--line:rgba(255,255,255,.14);--linha-sobre-cor:rgba(255,255,255,.14);
  --verde:#5be07f;--verde-bg:rgba(52,199,89,.18);--verde-ponto:#30d158;
  --amarelo:#ffb340;--amarelo-bg:rgba(255,159,10,.2);--amarelo-ponto:#ff9f0a;
  --vermelho:#ff6961;--vermelho-bg:rgba(255,59,48,.2);--vermelho-ponto:#ff453a;
  --cinza:#a1a1a6;--cinza-bg:rgba(120,120,128,.24);--cinza-ponto:#98989d;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1680px;margin:0 auto;padding:44px 32px 72px}
h1{font-family:'Bruta Pro Compressed',Haettenschweiler,sans-serif;font-size:44px;font-weight:800;letter-spacing:.01em;line-height:1;margin:0;text-transform:uppercase}
.sub{color:var(--text-2);margin:8px 0 0;font-size:14px}
.nota{font-size:13px;margin:16px 0 0;background:var(--cinza-bg);border-radius:12px;padding:11px 14px}
.filtros{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:18px 0 0}
select,input[type=search]{height:34px;border-radius:8px;border:0;background:var(--cinza-bg);color:var(--text);font:inherit;font-size:13px;padding:0 11px;max-width:230px}
select option{background:var(--card);color:var(--text)}
button.limpar{height:34px;border-radius:8px;border:0;background:transparent;color:var(--text);font:inherit;font-size:13px;padding:0 12px;cursor:pointer}
.contadores{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 12px}
.pilula{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 13px;border:0;border-radius:8px;background:var(--cinza-bg);font:inherit;font-size:13px;color:var(--text);cursor:pointer}
.pilula b{font-weight:600;font-variant-numeric:tabular-nums}
.pilula.on{box-shadow:inset 0 0 0 1.5px currentColor}
.pilula.vermelho b{color:var(--vermelho)}.pilula.amarelo b{color:var(--amarelo)}
.pilula.verde b{color:var(--verde)}.pilula.cinza b{color:var(--text)}
.pilula.on.vermelho{background:var(--vermelho-bg);color:var(--vermelho-ponto)}
.pilula.on.amarelo{background:var(--amarelo-bg);color:var(--amarelo-ponto)}
.pilula.on.verde{background:var(--verde-bg);color:var(--verde-ponto)}
.pilula.on.cinza{color:var(--cinza-ponto)}
.ponto{width:9px;height:9px;border-radius:5px;display:inline-block}
.ponto.vermelho{background:var(--vermelho-ponto)}.ponto.amarelo{background:var(--amarelo-ponto)}
.ponto.verde{background:var(--verde-ponto)}.ponto.cinza{background:var(--cinza-ponto)}
.quadro{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:6px;scrollbar-width:thin}
.coluna{flex:1 0 300px;background:var(--cinza-bg);border-radius:14px;padding:10px;min-width:0}
.col-cab{padding:5px 6px 11px}
.col-nome{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:600;letter-spacing:-.01em}
.col-n{flex-shrink:0;background:var(--card);border-radius:20px;padding:1px 8px;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
.col-sub{font-size:11px;margin-top:2px;line-height:1.35}
.pilha{display:flex;flex-direction:column;gap:8px;max-height:calc(100vh - 220px);overflow-y:auto;padding-right:8px;scrollbar-width:thin}
.cartao{display:block;text-decoration:none;color:inherit;border:1px solid transparent;border-radius:12px;padding:11px 13px 11px 15px}
.cartao:hover{border-color:var(--text-2)}
.cartao.vermelho{background:var(--vermelho-bg);box-shadow:inset 3px 0 0 var(--vermelho-ponto)}
.cartao.amarelo{background:var(--amarelo-bg);box-shadow:inset 3px 0 0 var(--amarelo-ponto)}
.cartao.verde{background:var(--verde-bg);box-shadow:inset 3px 0 0 var(--verde-ponto)}
.cartao.cinza{background:var(--cinza-bg);box-shadow:inset 3px 0 0 var(--cinza-ponto)}
.c-topo{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:7px;font-size:13px}
.c-prazo{font-weight:600}
.cartao.vermelho .c-prazo{color:var(--vermelho)}.cartao.amarelo .c-prazo{color:var(--amarelo)}
.cartao.verde .c-prazo{color:var(--verde)}.cartao.cinza .c-prazo{color:var(--text)}
.c-evento{font-size:11px;white-space:nowrap}
.c-cliente{display:block;font-size:14px;font-weight:600;letter-spacing:-.01em;line-height:1.3}
.c-pal{display:block;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.c-pe{display:block;font-size:11px;margin-top:9px;padding-top:8px;border-top:1px solid var(--linha-sobre-cor);line-height:1.45}
.c-pe b{font-weight:600}
.tag{display:inline-block;font-size:10px;font-weight:600;border-radius:5px;padding:2px 7px;margin-top:7px;background:var(--card);color:var(--amarelo)}
.vazio{padding:10px 6px;font-size:13px;margin:0}
.rodape{font-size:13px;color:var(--text-2);margin:16px 0 0}
@media print{.filtros,.contadores{display:none}.pilha{max-height:none}}
</style>
</head>
<body>
<main>
<h1>Sinaleira</h1>
<p class="sub">Simulação · etapas da <b>TESTE | Tramitação</b> com os <b>${tickets.length}</b> tickets reais e abertos do CS · ${new Date(hoje).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
<p class="nota">Nada foi escrito no HubSpot e nada foi aplicado no painel. Os tickets vivem no CS: aqui cada um aparece na <b>primeira etapa da Tramitação com regra ainda pendente</b>, com a cor do pior prazo daquela etapa.</p>

<div class="filtros" id="filtros"></div>
<div class="contadores" id="contadores"></div>
<div class="quadro" id="quadro"></div>
<p class="rodape" id="rodape"></p>
</main>

<script>
const DADOS = ${JSON.stringify(dados)};
const COLUNAS = ${JSON.stringify(colunas)};
const FORA = ${foraDoQuadro};
const TOTAL = ${tickets.length};
const PORTAL = '${PORTAL}';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dataBr = s => s ? s.split('-').reverse().join('/') : '';
const link = id => 'https://app.hubspot.com/contacts/' + PORTAL + '/record/0-5/' + id;

const CAMPOS = [
  ['proprietario','Proprietário'],['etapaCS','Etapa no CS'],['logistica','Logística pela PSA'],
  ['tipoEmpresa','Tipo de empresa'],['formatoContrato','Formato de contrato'],['statusContrato','Status do contrato'],
];
const CORES = [['vermelho','atrasado'],['amarelo','atenção'],['verde','em dia'],['cinza','sem prazo']];
const estado = {};
const filtros = document.getElementById('filtros');

for (const [campo, rotulo] of CAMPOS) {
  const vals = [...new Set(DADOS.map(d => d[campo]))].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));
  const s = document.createElement('select');
  s.innerHTML = '<option value="">' + rotulo + '</option>' + vals.map(v => '<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');
  s.onchange = () => { estado[campo] = s.value; pintar(); };
  filtros.appendChild(s);
}
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

// A cor fica de fora da propria contagem: clicar em "atrasado" nao pode zerar
// os outros tres e tirar a visao do quadro.
function semCor() {
  return DADOS.filter(d => {
    for (const [campo] of CAMPOS) if (estado[campo] && d[campo] !== estado[campo]) return false;
    if (estado.busca && !((d.cliente+' '+d.palestrante).toLowerCase().includes(estado.busca))) return false;
    return true;
  });
}

function pintar() {
  const base = semCor();
  const visiveis = estado.cor ? base.filter(d => d.cor === estado.cor) : base;

  document.getElementById('contadores').innerHTML = CORES.map(([c, rotulo]) => {
    const n = base.filter(d => d.cor === c).length;
    if (!n && c === 'cinza') return '';
    return '<button class="pilula '+c+(estado.cor===c?' on':'')+'" data-cor="'+c+'">'
      + '<i class="ponto '+c+'"></i><b>'+n+'</b><span>'+rotulo+'</span></button>';
  }).join('');
  document.querySelectorAll('.pilula').forEach(b => b.onclick = () => {
    estado.cor = estado.cor === b.dataset.cor ? null : b.dataset.cor; pintar();
  });

  document.getElementById('quadro').innerHTML = COLUNAS.map(col => {
    const itens = visiveis.filter(d => d.etapaTramitacao === col.label)
      .sort((a,b) => a.cliente.localeCompare(b.cliente,'pt-BR'));
    return '<div class="coluna"><div class="col-cab">'
      + '<div class="col-nome">'+esc(col.label)+'<span class="col-n">'+itens.length+'</span></div>'
      + '<div class="col-sub">'+esc(col.regra)+'</div></div>'
      + '<div class="pilha">'
      + (itens.length ? itens.map(cartao).join('') : '<p class="vazio">Nada aqui.</p>')
      + '</div></div>';
  }).join('');

  document.getElementById('rodape').textContent =
    visiveis.length + ' de ' + TOTAL + ' tickets no quadro · '
    + FORA + ' ficaram de fora por não ter nenhuma regra pendente';
}

function cartao(d) {
  return '<a class="cartao '+d.cor+'" href="'+link(d.id)+'" target="_blank" rel="noreferrer">'
    + '<span class="c-topo"><span class="c-prazo">'+esc(d.texto)+'</span>'
    + (d.evento ? '<span class="c-evento">evento '+dataBr(d.evento)+'</span>' : '') + '</span>'
    + '<span class="c-cliente">'+esc(d.cliente)+'</span>'
    + '<span class="c-pal">'+esc(d.palestrante || '—')+'</span>'
    + '<span class="c-pe">'+esc(d.etapaCS)+' no CS<br>Proprietário <b>'+esc(d.proprietario)+'</b></span>'
    + (d.orgaoPublico ? '<span class="tag">Órgão Público</span>' : '')
    + '</a>';
}
pintar();
</script>
</body>
</html>`

writeFileSync(SAIDA, html)
console.log(`\n✓ ${SAIDA}`)
for (const col of colunas) {
  const n = dados.filter((d) => d.etapaTramitacao === col.label).length
  const c = Object.fromEntries(
    ['vermelho', 'amarelo', 'verde', 'cinza'].map((k) => [k, dados.filter((d) => d.etapaTramitacao === col.label && d.cor === k).length]),
  )
  console.log(`  ${col.label.padEnd(26)} ${String(n).padStart(3)}   verm ${String(c.vermelho).padStart(3)}  amar ${String(c.amarelo).padStart(3)}  verde ${String(c.verde).padStart(3)}  cinza ${String(c.cinza).padStart(3)}`)
}
console.log(`  ${'fora do quadro'.padEnd(26)} ${String(foraDoQuadro).padStart(3)}   sem nenhuma regra pendente`)
