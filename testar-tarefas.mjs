// Testa só a leitura de tarefas do HubSpot e responde "quantos tickets ativos
// têm tarefa atribuída, vencida ou em dia".
//
//   node testar-tarefas.mjs
//
// Lê HUBSPOT_TOKEN do ambiente ou de .env.local. Não imprime o token.
// Se faltar escopo, imprime a mensagem inteira do HubSpot, que nomeia o escopo.

import { readFileSync } from 'node:fs'
import { iso, tarefaMaisUrgente, SLA } from './lib/sinaleira.ts'

function token() {
  if (process.env.HUBSPOT_TOKEN) return process.env.HUBSPOT_TOKEN
  try {
    // replace(/^﻿/) porque Set-Content e Notepad no Windows podem gravar
    // BOM, e aí a primeira linha não casa com startsWith.
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

const TOKEN = token()
const PIPELINE = process.env.HUBSPOT_PIPELINE_CS ?? '748675953'
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const pedacos = (xs, n) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

async function chamar(url, init, onde) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, init)
    if (res.status === 429 && i < 4) {
      await espera(2 ** i * 500)
      continue
    }
    if (!res.ok) {
      const corpo = await res.text()
      console.error(`\n✕ ${onde} respondeu ${res.status}\n`)
      console.error(corpo)
      console.error(
        '\nSe a mensagem acima falar em escopo, é esse nome que você adiciona no Private App.',
      )
      process.exit(1)
    }
    return res.json()
  }
}

console.log('Buscando tickets abertos do pipeline', PIPELINE, '...')

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
              { propertyName: 'hs_pipeline_stage', operator: 'IN', values: Object.keys(SLA) },
            ],
          },
        ],
        properties: ['subject', 'hs_pipeline_stage'],
        sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
        limit: 100,
        after,
      }),
    },
    'tickets/search',
  )
  for (const r of p.results ?? []) tickets.push({ id: r.id, subject: r.properties?.subject ?? '' })
  after = p.paging?.next?.after
} while (after)

console.log(`${tickets.length} tickets abertos.`)
console.log('Lendo as tarefas associadas...')

const porTicket = new Map()
for (const lote of pedacos(tickets.map((t) => t.id), 100)) {
  await espera(300)
  const r = await chamar(
    'https://api.hubapi.com/crm/v4/associations/tickets/tasks/batch/read',
    { method: 'POST', headers: H, body: JSON.stringify({ inputs: lote.map((id) => ({ id })) }) },
    'associations tickets→tasks',
  )
  for (const res of r.results ?? []) {
    const para = (res.to ?? []).map((t) => String(t.toObjectId ?? t.id))
    if (res.from?.id && para.length) porTicket.set(String(res.from.id), para)
  }
}

const idsTarefa = [...new Set([...porTicket.values()].flat())]
console.log(`${idsTarefa.length} tarefas associadas no total.`)

const tarefas = new Map()
for (const lote of pedacos(idsTarefa, 100)) {
  await espera(300)
  const r = await chamar(
    'https://api.hubapi.com/crm/v3/objects/tasks/batch/read',
    {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        properties: ['hs_timestamp', 'hs_task_status'],
        inputs: lote.map((id) => ({ id })),
      }),
    },
    'tasks/batch/read',
  )
  for (const t of r.results ?? [])
    tarefas.set(String(t.id), {
      vence: iso(t.properties?.hs_timestamp),
      aberta: (t.properties?.hs_task_status ?? '') !== 'COMPLETED',
    })
}

const hoje = new Date().toISOString().slice(0, 10)
let comTarefa = 0
let vencida = 0
let emDia = 0

for (const t of tickets) {
  const vence = tarefaMaisUrgente(porTicket.get(t.id) ?? [], tarefas)
  if (!vence) continue
  comTarefa++
  if (vence < hoje) vencida++
  else emDia++
}

console.log('\n─────────────────────────────────────')
console.log(`tickets ativos ............. ${tickets.length}`)
console.log(`com tarefa atribuída ....... ${comTarefa}  (${Math.round((comTarefa / tickets.length) * 100)}%)`)
console.log(`   vencida ................. ${vencida}`)
console.log(`   em dia .................. ${emDia}`)
console.log(`sem tarefa nenhuma ......... ${tickets.length - comTarefa}`)
console.log('─────────────────────────────────────')
