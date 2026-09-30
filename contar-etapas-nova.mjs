// Conta quantos tickets abertos do CS têm cada valor marcado em etapas_nova.
// Serve para responder onde o time realmente registra o "check" hoje.

import { readFileSync } from 'node:fs'
import { SLA } from './lib/sinaleira.ts'

const tk = readFileSync('.env.local', 'utf8')
  .replace(/^﻿/, '')
  .split(/\r?\n/)
  .find((l) => l.startsWith('HUBSPOT_TOKEN='))
  .slice('HUBSPOT_TOKEN='.length)
  .trim()

const H = { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

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
      properties: ['etapas_nova', 'hs_pipeline_stage'],
      sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
      limit: 100,
      after,
    }),
  })
  const p = await res.json()
  for (const r of p.results ?? []) tickets.push(r.properties?.etapas_nova ?? '')
  after = p.paging?.next?.after
} while (after)

const conta = new Map()
let comAlgo = 0
for (const v of tickets) {
  if (!v) continue
  comAlgo++
  for (const e of v.split(';').map((s) => s.trim()).filter(Boolean))
    conta.set(e, (conta.get(e) ?? 0) + 1)
}

console.log(`tickets abertos: ${tickets.length}`)
console.log(`com alguma etapa marcada: ${comAlgo} (${Math.round((comAlgo / tickets.length) * 100)}%)\n`)
for (const [e, n] of [...conta.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(n).padStart(4)}  ${Math.round((n / tickets.length) * 100).toString().padStart(3)}%  ${e}`)
