// Simula a regra de Briefing sobre a base real e mostra quantos alertas cada
// sinal de conclusão geraria. Serve para escolher o sinal com número na mão.

import { readFileSync } from 'node:fs'
import { iso, SLA } from './lib/sinaleira.ts'

const tk = readFileSync('.env.local', 'utf8')
  .replace(/^﻿/, '')
  .split(/\r?\n/)
  .find((l) => l.startsWith('HUBSPOT_TOKEN='))
  .slice('HUBSPOT_TOKEN='.length)
  .trim()

const H = { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const DIA = 86400000
const dia = (s) => (s ? Date.parse(s + 'T00:00:00Z') : NaN)

const tickets = []
let after
do {
  await espera(300)
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/tickets/search', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            { propertyName: 'hs_pipeline', operator: 'EQ', value: '748675953' },
            { propertyName: 'hs_pipeline_stage', operator: 'IN', values: Object.keys(SLA) },
          ],
        },
      ],
      properties: [
        'subject',
        'data_do_evento__ganho_',
        'data_de_realizacao_do_onboarding',
        'data_e_hora_da_call_de_briefing',
        'etapas_nova',
      ],
      sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
      limit: 100,
      after,
    }),
  })
  const p = await res.json()
  for (const r of p.results ?? []) {
    const q = r.properties ?? {}
    tickets.push({
      id: r.id,
      evento: iso(q.data_do_evento__ganho_),
      onboarding: iso(q.data_de_realizacao_do_onboarding),
      briefing: iso(q.data_e_hora_da_call_de_briefing),
      etapas: (q.etapas_nova ?? '').split(';').map((s) => s.trim()).filter(Boolean),
    })
  }
  after = p.paging?.next?.after
} while (after)

const hoje = Date.now()

// A regra só faz sentido para evento que ainda vai acontecer.
const futuro = tickets.filter((t) => t.evento && dia(t.evento) >= hoje)
// Com onboarding realizado: é o portão que o CS pediu.
const comOnb = futuro.filter((t) => t.onboarding)
// Vencida: passou de D-15 e o briefing deveria estar marcado.
const vencida = comOnb.filter((t) => dia(t.evento) - 15 * DIA < hoje)
// Na janela: entre D-30 e D-15, ainda dá tempo.
const janela = comOnb.filter(
  (t) => dia(t.evento) - 30 * DIA <= hoje && dia(t.evento) - 15 * DIA >= hoje,
)

// A regra do CS: valida pela Data de realização do Onboarding. Se ela não
// estiver preenchida até D-15, o briefing não teria como estar agendado.
const semOnb = futuro.filter((t) => !t.onboarding)
const semOnbVencido = semOnb.filter((t) => dia(t.evento) - 15 * DIA < hoje)

console.log('REGRA DO CS — valida por Data de realizacao do Onboarding:')
console.log(`  evento no futuro e sem onboarding ....... ${semOnb.length}`)
console.log(`  destes, ja passaram de D-15 ............. ${semOnbVencido.length}  <- ALERTA`)
console.log(`  destes, ainda na janela D-30 a D-15 ..... ${semOnb.filter((t) => dia(t.evento) - 30 * DIA <= hoje && dia(t.evento) - 15 * DIA >= hoje).length}\n`)

const feito = {
  campo: (t) => !!t.briefing,
  etapaRealizada: (t) => t.etapas.includes('Call de Briefing Realizada'),
  etapaAgendada: (t) => t.etapas.includes('Agendar Call de Briefing'),
  qualquer: (t) =>
    !!t.briefing ||
    t.etapas.includes('Call de Briefing Realizada') ||
    t.etapas.includes('Agendar Call de Briefing'),
}

console.log(`tickets abertos .................. ${tickets.length}`)
console.log(`com evento no futuro ............. ${futuro.length}`)
console.log(`  e onboarding realizado ......... ${comOnb.length}`)
console.log(`    ja passou de D-15 ............ ${vencida.length}  <- a regra cobra aqui`)
console.log(`    na janela D-30 a D-15 ........ ${janela.length}\n`)

console.log('ALERTA "Call de Briefing pendente" por sinal de conclusao:\n')
for (const [nome, fn] of Object.entries(feito)) {
  const alerta = vencida.filter((t) => !fn(t)).length
  const pct = vencida.length ? Math.round((alerta / vencida.length) * 100) : 0
  console.log(`  ${nome.padEnd(16)} ${String(alerta).padStart(3)} de ${vencida.length} vencidos  (${pct}%)`)
}
