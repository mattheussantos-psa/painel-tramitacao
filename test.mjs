import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { avaliar, iso, tarefaMaisUrgente, SLA, ENCERRADAS } from './lib/sinaleira.ts'

// A API v3 manda "2026-09-30", a camada de relatório manda epoch em ms.
// Assumir um formato só derrubou o painel em produção com "Invalid time value".
assert.equal(iso('2026-09-30'), '2026-09-30')
assert.equal(iso('2026-09-30T14:51:32.427Z'), '2026-09-30')
assert.equal(iso('1790726400000'), '2026-09-30')
assert.equal(iso(1790726400000), '2026-09-30')
assert.equal(iso(''), '')
assert.equal(iso(null), '')
assert.equal(iso(undefined), '')
assert.equal(iso('nao e data'), '')

const HOJE = Date.parse('2026-09-29T00:00:00Z')

const t = (over) => ({
  id: 'x',
  subject: 'Cliente - Palestrante - Presencial',
  stage: '1088360205',
  evento: '2026-12-01',
  curador: null,
  entrouEtapa: '2026-09-01',
  ...over,
})

// Prazo e tempo NA ETAPA: o relogio comeca quando o ticket entra nela.
// Aguardando Onboarding tem 7 dias.
const onb = avaliar(t({ stage: '1088360204', entrouEtapa: '2026-09-25' }), HOJE)
assert.equal(onb.vence, '2026-10-02')
assert.equal(onb.dias, -3)
assert.equal(onb.cor, 'amarelo')

// O caso que a regua antiga errava: ticket criado dias antes do evento nao
// pode nascer atrasado por um prazo anterior a propria entrada na etapa.
const deloitte = avaliar(t({ stage: '1088360204', evento: '2026-09-30', entrouEtapa: '2026-09-25' }), HOJE)
assert.equal(deloitte.cor, 'amarelo', 'nao pode ser vermelho: entrou ha 4 dias e tem 7')

// Em andamento tem 20 dias na etapa
assert.equal(avaliar(t({ stage: '1088360205', entrouEtapa: '2026-09-20' }), HOJE).cor, 'verde')
const parado = avaliar(t({ stage: '1088360205', entrouEtapa: '2026-08-20' }), HOJE)
assert.equal(parado.dias, 20)
assert.equal(parado.cor, 'vermelho')

// Aguardando Evento segura ate a realizacao do evento
const ag = avaliar(t({ stage: '1448673032', evento: '2026-10-20', entrouEtapa: '2026-01-01' }), HOJE)
assert.equal(ag.vence, '2026-10-20')
assert.equal(ag.cor, 'verde', 'tempo parado nao importa nessa etapa, so o evento')
assert.equal(avaliar(t({ stage: '1448673032', evento: '2026-09-01' }), HOJE).cor, 'vermelho')

// Etapa sem prazo acordado fica cinza, e o numero e o tempo parado
const sem = avaliar(t({ stage: '1333136740', entrouEtapa: '2026-03-01' }), HOJE)
assert.equal(sem.cor, 'cinza')
assert.equal(sem.dias, 212)

// A divisao pre/pos segue o evento, nao a etapa
assert.equal(avaliar(t({ stage: '1088360205', evento: '2025-10-30' }), HOJE).regua, 'pos')
assert.equal(avaliar(t({ stage: '1333136740', evento: '2026-12-01' }), HOJE).regua, 'pre')
assert.equal(avaliar(t({ stage: '1088360205', evento: '2026-09-29' }), HOJE).regua, 'pre')

for (const id of Object.keys(ENCERRADAS))
  assert.ok(!(id in SLA), `etapa encerrada ${id} nao devia ter prazo`)
assert.equal(Object.keys(SLA).length, 6)

// Todo ticket do snapshot recebe uma cor
const snap = JSON.parse(readFileSync(new URL('./data/snapshot.json', import.meta.url), 'utf8'))
const cores = { verde: 0, amarelo: 0, vermelho: 0, cinza: 0 }
for (const ticket of snap.tickets) {
  const a = avaliar(ticket, HOJE)
  assert.ok(a.cor in cores, `cor inesperada em ${ticket.id}`)
  cores[a.cor]++
}
assert.equal(snap.tickets.length, 64)

console.log('ok —', snap.tickets.length, 'tickets:', cores)

// Tarefa que vale: a aberta que vence primeiro, mesmo se ja venceu.
const tarefas = new Map([
  ['a', { vence: '2026-10-10', aberta: true }],
  ['b', { vence: '2026-09-01', aberta: false }],
  ['c', { vence: '2026-09-20', aberta: true }],
  ['d', { vence: '', aberta: true }],
])
assert.equal(tarefaMaisUrgente(['a', 'b', 'c', 'd'], tarefas), '2026-09-20')
assert.equal(tarefaMaisUrgente(['a', 'b'], tarefas), '2026-10-10')
assert.equal(tarefaMaisUrgente(['b'], tarefas), '', 'concluida nao conta')
assert.equal(tarefaMaisUrgente(['d'], tarefas), '', 'sem data nao conta')
assert.equal(tarefaMaisUrgente(['inexistente'], tarefas), '')
assert.equal(tarefaMaisUrgente([], tarefas), '')

console.log('ok — selecao de tarefa')
