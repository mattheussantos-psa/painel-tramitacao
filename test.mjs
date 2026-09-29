import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { avaliar, iso, SLA, ENCERRADAS } from './lib/sinaleira.ts'

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

// Em andamento vence na data do evento: evento longe, fica verde
assert.equal(avaliar(t({ evento: '2026-12-01' }), HOJE).cor, 'verde')

// Em andamento com evento já passado há mais que a tolerância é vermelho
const passou = avaliar(t({ evento: '2026-09-01' }), HOJE)
assert.equal(passou.cor, 'vermelho')
assert.equal(passou.dias, 28)
assert.equal(passou.etapa, 'Em andamento')

// Etapa de conferência tem que sair em D-45
const conferencia = avaliar(t({ stage: '1088360203', evento: '2026-10-20' }), HOJE)
assert.equal(conferencia.vence, '2026-09-05')
assert.equal(conferencia.dias, 24)
assert.equal(conferencia.cor, 'vermelho')

// Iniciar Trâmites sai em D-30: evento em 24/10 vence em 24/09, 5 dias de atraso
// cai na tolerância e fica amarelo, não vermelho
const tramites = avaliar(t({ stage: '1088360204', evento: '2026-10-24' }), HOJE)
assert.equal(tramites.vence, '2026-09-24')
assert.equal(tramites.dias, 5)
assert.equal(tramites.cor, 'amarelo')

// Vencendo dentro da janela de aviso também é amarelo
assert.equal(avaliar(t({ stage: '1088360204', evento: '2026-10-31' }), HOJE).cor, 'amarelo')
assert.equal(avaliar(t({ stage: '1088360204', evento: '2026-11-05' }), HOJE).cor, 'verde')

// Pós-evento: Pagamento Pós-Palestra vence D+15, NF vence D+30
const pagamento = avaliar(t({ stage: '1088361911', evento: '2026-01-29' }), HOJE)
assert.equal(pagamento.cor, 'vermelho')
assert.equal(pagamento.regua, 'pos')
assert.equal(pagamento.dias, 228)

assert.equal(avaliar(t({ stage: '1333136740', evento: '2026-09-10' }), HOJE).cor, 'verde')
assert.equal(avaliar(t({ stage: '1333136740', evento: '2026-08-25' }), HOJE).cor, 'amarelo')

// Etapa fora da régua nunca vira verde por omissão
const encerrada = avaliar(t({ stage: '1088361913', evento: '2027-02-11' }), HOJE)
assert.equal(encerrada.cor, 'cinza')
assert.equal(encerrada.etapa, 'Stand by')

// As 4 etapas encerradas não estão na régua
for (const id of Object.keys(ENCERRADAS)) assert.ok(!(id in SLA), `${id} não devia ter prazo`)
assert.equal(Object.keys(SLA).length, 5)

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
