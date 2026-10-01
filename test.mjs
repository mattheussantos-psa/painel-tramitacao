import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  avaliar,
  alertas,
  diasNaEtapa,
  iso,
  tarefaMaisUrgente,
  SLA,
  ENCERRADAS,
} from './lib/sinaleira.ts'

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

// 12:00 UTC = 09:00 em Sao Paulo, ou seja um instante que e mesmo dia 29 no
// fuso do painel. Com meia-noite UTC a data local seria 28.
const HOJE = Date.parse('2026-09-29T12:00:00Z')

const t = (over) => ({
  id: 'x',
  subject: 'Cliente - Palestrante - Presencial',
  stage: '1088360205',
  evento: '2026-12-01',
  curador: null,
  entrouEtapa: '2026-09-01',
  onboarding: '',
  statusContrato: '',
  proximaTarefa: '',
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

// A divisao pre/pos segue o evento, nao a etapa
assert.equal(avaliar(t({ stage: '1088360205', evento: '2025-10-30' }), HOJE).regua, 'pos')
assert.equal(avaliar(t({ stage: '1088360205', evento: '2026-09-29' }), HOJE).regua, 'pre')

for (const id of Object.keys(ENCERRADAS))
  assert.ok(!(id in SLA), `etapa encerrada ${id} nao devia ter prazo`)
assert.equal(Object.keys(SLA).length, 5)

// As duas etapas de financeiro voltaram com prazo de 20 dias na etapa.
for (const id of ['1088361911', '1333136740']) {
  assert.equal(avaliar(t({ stage: id, entrouEtapa: '2026-09-20' }), HOJE).cor, 'verde')
  const velho = avaliar(t({ stage: id, entrouEtapa: '2026-03-01' }), HOJE)
  assert.equal(velho.cor, 'vermelho')
  assert.equal(velho.dias, 192)
  assert.equal(velho.vence, '2026-03-21')
}

// Todo ticket do snapshot recebe uma cor
const snap = JSON.parse(readFileSync(new URL('./data/snapshot.json', import.meta.url), 'utf8'))
const cores = { verde: 0, amarelo: 0, vermelho: 0, cinza: 0 }
for (const ticket of snap.tickets) {
  const a = avaliar(ticket, HOJE)
  assert.ok(a.cor in cores, `cor inesperada em ${ticket.id}`)
  cores[a.cor]++
}
assert.equal(snap.tickets.length, 32)

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

// Alertas de processo — eixo separado da cor da etapa.
const A = (o) => alertas(t(o), HOJE).map((x) => x.chave)

// Contrato: 20 dias apos o onboarding, e status_do_contrato manda.
assert.deepEqual(A({ onboarding: '2026-09-01', statusContrato: 'Pendente' }), ['contrato'])
assert.deepEqual(A({ onboarding: '2026-09-01', statusContrato: 'Assinado' }), [])
assert.deepEqual(A({ onboarding: '2026-09-15', statusContrato: 'Pendente' }), [], 'ainda dentro dos 20 dias')
assert.deepEqual(A({ onboarding: '', statusContrato: 'Pendente' }), [], 'sem onboarding nao ha prazo de assinatura')

// Briefing: cobra a partir de D-15, e valida pela data de onboarding.
assert.deepEqual(A({ onboarding: '', evento: '2026-10-05' }), ['briefing'], 'D-6 sem onboarding')
assert.deepEqual(A({ onboarding: '', evento: '2026-10-20' }), [], 'D-21 ainda da tempo')
assert.deepEqual(A({ onboarding: '2026-09-28', evento: '2026-10-05' }), [], 'onboarding feito, sem alerta')
assert.deepEqual(A({ onboarding: '', evento: '2026-09-01' }), [], 'evento passado nao cobra briefing')

console.log('ok — alertas de processo')

// Ticket sem data de entrada na etapa: o card imprimia "NaNd parado".
assert.equal(diasNaEtapa(t({ entrouEtapa: '' }), HOJE), null)
assert.equal(diasNaEtapa(t({ entrouEtapa: '2026-09-20' }), HOJE), 9)

console.log('ok — dias na etapa sem data')
