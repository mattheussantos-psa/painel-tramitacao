import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  avaliar,
  diasNaEtapa,
  iso,
  tarefaMaisUrgente,
  SLA,
  ENCERRADAS,
  QUADROS,
} from './lib/sinaleira.ts'
import { RELOGIOS, alertas, avaliarEtapa, diasUteis, explicar, EXIGE_MINUTA_PALESTRANTE } from './lib/relogios.ts'
import { classificar, agrupar } from './lib/closer.ts'

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
  formatoEmpresa: '',
  statusContrato: '',
  proximaTarefa: '',
  ...over,
})

// Prazo e tempo NA ETAPA: o relogio comeca quando o ticket entra nela.
// Pagamento Pos-Palestra tem 20 dias. (Aguardando Onboarding, que era o caso
// original deste teste, deixou de existir no pipeline em 05/10/2026.)
const onb = avaliar(t({ stage: '1088361911', entrouEtapa: '2026-09-13' }), HOJE)
assert.equal(onb.vence, '2026-10-03')
assert.equal(onb.dias, -4)
assert.equal(onb.cor, 'amarelo')

// O caso que a regua antiga errava: ticket criado dias antes do evento nao
// pode nascer atrasado por um prazo anterior a propria entrada na etapa.
const deloitte = avaliar(t({ stage: '1088361911', evento: '2026-09-30', entrouEtapa: '2026-09-25' }), HOJE)
assert.equal(deloitte.cor, 'verde', 'nao pode ser vermelho: entrou ha 4 dias e tem 20')

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
assert.equal(Object.keys(SLA).length, 10)

// Confirmar PGTO Pre palestra segue sem regra do CS: cinza mostrando o tempo
// parado, nunca verde. Coletar NPS saiu desta lista quando ganhou prazo.
assert.equal(SLA['1452885000'].tipo, 'sem-prazo', 'etapa sem regra do CS')
assert.equal(avaliar(t({ stage: '1452885000', entrouEtapa: '2026-09-01' }), HOJE).cor, 'cinza')

// Logistica, Contrato e Briefing entraram no CS em 02/10/2026 e levaram os
// tickets de "Em andamento". Sem elas na tabela o painel perdia 152 tickets.
for (const id of ['1450325173', '1450325174', '1450325175', '1450683393']) {
  assert.ok(id in SLA, 'etapa nova precisa estar no quadro do CS')
  assert.equal(SLA[id].tipo, 'relogio', 'essas tres medem marco, nao tempo parado')
}

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

// Alertas de processo — eixo separado da cor da etapa, mesma régua.
// stage 1088360205 (Em andamento) não é etapa de contrato: serve para provar
// que o alerta atravessa a etapa onde o ticket está.
const A = (o) => alertas(t({ stage: '1088360205', ...o }), HOJE, QUADROS.cs.sla).map((x) => x.chave).sort()

// Contrato do cliente: o prazo e a propriedade "Prazo de Assinatura de
// Contrato", a mesma conta do relogio da etapa. HOJE = 29/09.
const INTERVENIENTE = { formatoContrato: 'MC (Cliente x PSA x Palestrante)' }
assert.deepEqual(A({ ...INTERVENIENTE, prazoAssinatura: '2026-09-20', statusContrato: 'Pendente' }), ['contrato'])
assert.deepEqual(A({ ...INTERVENIENTE, prazoAssinatura: '2026-09-20', statusContrato: 'Assinado' }), [])
assert.deepEqual(A({ ...INTERVENIENTE, prazoAssinatura: '2026-09-20', dataAssinatura: '2026-09-18' }), [], 'assinado fecha o alerta')
assert.deepEqual(A({ ...INTERVENIENTE, prazoAssinatura: '2026-10-10', statusContrato: 'Pendente' }), [], 'faltam 11 dias')
// A reta final amarela ja acende o alerta: o ponto e cobrar antes de estourar.
assert.deepEqual(A({ ...INTERVENIENTE, prazoAssinatura: '2026-10-03', statusContrato: 'Pendente' }), ['contrato'], 'faltam 4')

// Sem o prazo preenchido o relogio ja conta como atraso, entao o alerta
// acende junto — e a divergencia com o quadro que isso evita.
assert.deepEqual(A({ ...INTERVENIENTE, statusContrato: 'Pendente' }), ['contrato'])

// Formato em que a PSA nao e parte do contrato do cliente nao acende o dele.
assert.deepEqual(A({ formatoContrato: 'MC (Cliente x Palestrante)', prazoAssinaturaPalestrante: '2026-10-10' }), [])

// Contrato do palestrante e alerta proprio, nao somado ao do cliente.
const COM_MINUTA = { formatoContrato: 'MC (Cliente x PSA) = 100% PSA', palestranteExclusivo: 'Não' }
assert.deepEqual(
  A({ ...COM_MINUTA, prazoAssinatura: '2026-09-20', prazoAssinaturaPalestrante: '2026-09-20' }),
  ['contrato', 'minuta'],
)
assert.deepEqual(
  A({ ...COM_MINUTA, prazoAssinatura: '2026-10-10', prazoAssinaturaPalestrante: '2026-09-20' }),
  ['minuta'],
  'so o do palestrante estourou',
)
assert.deepEqual(
  A({ ...COM_MINUTA, palestranteExclusivo: 'Sim', prazoAssinatura: '2026-10-10' }),
  [],
  'exclusivo nao tem minuta',
)
assert.deepEqual(
  A({ ...COM_MINUTA, prazoAssinatura: '2026-10-10', prazoAssinaturaPalestrante: '2026-09-20', dataAssinaturaPalestrante: '2026-09-10' }),
  [],
  'assinado fecha a minuta',
)

// Briefing: a mesma regra do quadro — D-15 amarelo, D-7 vermelho, e so para
// quem nao passou por Realizar Briefing. Prazo de contrato em aberto para o
// alerta de contrato nao poluir a conta.
const SO_BRIEFING = { ...INTERVENIENTE, prazoAssinatura: '2026-10-10' }
assert.deepEqual(A({ ...SO_BRIEFING, evento: '2026-10-05' }), ['briefing'], 'D-6')
assert.deepEqual(A({ ...SO_BRIEFING, evento: '2026-10-20' }), [], 'D-21 ainda da tempo')
assert.deepEqual(A({ ...SO_BRIEFING, evento: '2026-10-05', entrouBriefing: '2026-09-20' }), [], 'ja passou pelo briefing')
assert.deepEqual(A({ ...SO_BRIEFING, evento: '2026-09-01' }), [], 'evento passado nao cobra briefing')

console.log('ok — alertas de processo')

// Ticket sem data de entrada na etapa: o card imprimia "NaNd parado".
assert.equal(diasNaEtapa(t({ entrouEtapa: '' }), HOJE), null)
assert.equal(diasNaEtapa(t({ entrouEtapa: '2026-09-20' }), HOJE), 9)

console.log('ok — dias na etapa sem data')

// ---- quadros separados ----
// O risco real de dois pipelines no mesmo painel e um encostar no outro: id de
// etapa repetido faria ticket de um quadro cair na coluna do outro.
const idsCS = Object.keys(QUADROS.cs.sla)
const idsTram = Object.keys(QUADROS.tramitacao.sla)
assert.equal(idsCS.filter((i) => idsTram.includes(i)).length, 0, 'etapa compartilhada entre quadros')
assert.notEqual(QUADROS.cs.pipeline, QUADROS.tramitacao.pipeline)
assert.equal(idsTram.length, 7)

// A regua tem que sair da tabela do quadro que foi passado, nao da global.
const emConferencia = t({ stage: '1449991474', evento: '', entrouEtapa: '2026-09-01' })
assert.equal(avaliar(emConferencia, HOJE, QUADROS.tramitacao.sla).etapa, 'Em Conferência')
assert.equal(avaliar(emConferencia, HOJE, QUADROS.tramitacao.sla).cor, 'cinza', 'sem prazo acordado')
assert.equal(avaliar(emConferencia, HOJE, QUADROS.tramitacao.sla).dias, 28, 'dias parado')
// Mesmo ticket lido com a tabela do CS nao acha a etapa: prova que nao mistura.
assert.equal(avaliar(emConferencia, HOJE).etapa, '1449991474')

console.log('ok — quadros separados')

// ---- relogios da Tramitacao ----
const T = (over) => ({
  id: '1', subject: 'ACME - Fulano', stage: '1', proprietario: null,
  evento: '', logistica: '', tipoEmpresa: '', formatoEmpresa: 'Empresa Privada', formatoContrato: '',
  onboarding: '', prazoAssinatura: '', dataAssinatura: '', statusContrato: '',
  dataFaturamento: '', dataEmissao: '', prazoBriefing: '', callBriefing: '',
  entrouBriefing: '', entrouEtapa: '2026-09-01', palestranteExclusivo: '',
  reunioes: [], ...over,
})
const R = Object.fromEntries(RELOGIOS.map((r) => [r.chave, (t) => r.ver(T(t), HOJE)]))
const REEMBOLSO = 'Sim, com reembolso do cliente'
const CUSTO_PSA = 'Sim, com custo para PSA'
const PRIVADA = 'Empresa Privada'

// Dias uteis: de sexta 25/09 ate terca 29/09 sao 2 uteis, nao 4.
assert.equal(diasUteis('2026-09-25', Date.parse('2026-09-29T00:00:00Z')), 2)
assert.equal(diasUteis('2026-09-28', Date.parse('2026-09-29T00:00:00Z')), 1)

// Aquisicao vale para quem a PSA organiza, com custo dela ou com reembolso.
assert.equal(R['log-aquisicao']({ logistica: 'Evento Online' }).estado, 'nao-aplica')
assert.equal(R['log-aquisicao']({ logistica: 'Não' }).estado, 'nao-aplica')
assert.equal(R['log-aquisicao']({ logistica: CUSTO_PSA }).estado, 'sem-dado', 'sem negocio ganho nao da para cobrar')
// O prazo sai do ganho do negocio, nao da propriedade: com a propriedade
// preenchida e sem ganho o relogio continua sem poder cobrar.
assert.equal(R['log-aquisicao']({ logistica: CUSTO_PSA, prazoLogistica: '2026-10-05' }).estado, 'sem-dado')
// 26/09 + 5 = 01/10, ainda no prazo.
assert.equal(R['log-aquisicao']({ logistica: CUSTO_PSA, ganhoNegocio: '2026-09-26' }).estado, 'verde')
// 24/09 + 5 = 29/09, vence hoje: ainda verde.
assert.equal(R['log-aquisicao']({ logistica: REEMBOLSO, ganhoNegocio: '2026-09-24' }).estado, 'verde')
// 22/09 + 5 = 27/09, dois dias depois.
assert.equal(R['log-aquisicao']({ logistica: REEMBOLSO, ganhoNegocio: '2026-09-22' }).estado, 'amarelo')
assert.equal(R['log-aquisicao']({ logistica: REEMBOLSO, ganhoNegocio: '2026-09-15' }).estado, 'vermelho')
// A data limite vai no veredito para o dialogo mostrar o prazo calculado, nao
// a data do ganho — dizer "ganho 15/09 venceu ha 9 dias" esconde a conta.
assert.equal(R['log-aquisicao']({ logistica: REEMBOLSO, ganhoNegocio: '2026-09-15' }).prazo, '2026-09-20')

// Pagamento so corre quando o cliente reembolsa: com custo para a PSA nao ha
// pagamento a cobrar do cliente.
assert.equal(R['log-pagamento']({ logistica: CUSTO_PSA, pagamentoLogistica: '2026-09-20' }).estado, 'nao-aplica')
assert.equal(R['log-pagamento']({ logistica: REEMBOLSO }).estado, 'sem-dado')
assert.equal(R['log-pagamento']({ logistica: REEMBOLSO, pagamentoLogistica: '2026-10-05' }).estado, 'verde')
assert.equal(R['log-pagamento']({ logistica: REEMBOLSO, pagamentoLogistica: '2026-09-20' }).estado, 'vermelho')

// Assinatura: 20 dias a partir do onboarding. Exemplo do CS: onboarding em
// 07/10 vence em 27/10. Nao ha faixa de atencao — verde ate o prazo, vermelho
// depois — e sem onboarding conta como atrasado.
const assin = (over) => R['contrato-assinatura']({ formatoEmpresa: PRIVADA, ...over })
// O prazo e a propriedade "Prazo de Assinatura de Contrato". HOJE = 29/09.
assert.equal(assin({ prazoAssinatura: '2026-10-10' }).estado, 'verde', 'faltam 11 dias')
assert.equal(assin({ prazoAssinatura: '2026-10-10' }).prazo, '2026-10-10')
// Reta final: 4 dias antes e o dia do prazo.
assert.equal(assin({ prazoAssinatura: '2026-10-03' }).estado, 'amarelo', 'faltam 4')
assert.equal(assin({ prazoAssinatura: '2026-09-29' }).estado, 'amarelo', 'vence hoje')
assert.equal(assin({ prazoAssinatura: '2026-09-28' }).estado, 'vermelho', 'venceu ontem')
assert.equal(assin({ prazoAssinatura: '2026-09-28' }).dias, 1)
// Prazo em branco nao e prazo em dia.
assert.equal(assin({}).estado, 'vermelho', 'sem prazo preenchido conta como atrasado')
assert.match(assin({}).texto, /sem "Prazo de Assinatura de Contrato" preenchido/)
// O onboarding nao entra mais na conta do prazo de assinatura.
assert.equal(assin({ onboarding: '2026-09-28' }).estado, 'vermelho', 'onboarding nao e prazo')

// Assinado mede contra a propriedade.
const noPrazo = assin({ prazoAssinatura: '2026-09-10', dataAssinatura: '2026-09-05' })
assert.equal(noPrazo.cumpriu, true)
const atrasado = assin({ prazoAssinatura: '2026-09-10', dataAssinatura: '2026-09-13' })
assert.equal(atrasado.cumpriu, false)
assert.match(atrasado.texto, /assinado 3d depois do prazo/)
// Assinado sem prazo preenchido nao tem como dizer se cumpriu, mas fecha.
assert.equal(assin({ dataAssinatura: '2026-09-05' }).estado, 'concluido')
assert.equal(assin({ dataAssinatura: '2026-09-05' }).cumpriu, null)

console.log('ok — relogios da Tramitacao')

// ---- as tres etapas do CS medidas por relogio ----
// Logistica, Contrato e Briefing nao medem tempo parado: medem distancia ate
// um marco. A cor da coluna e a do pior relogio que corre naquela etapa.
const E = (over) => avaliarEtapa(T({ entrouEtapa: '2026-09-01', ...over }), HOJE, QUADROS.cs.sla)
const LOG = '1450325173', CTR = '1450325174', BRF = '1450325175'

// Logistica anda por duas datas do proprio ticket, e o pior manda.
const log = (over) => E({ stage: LOG, evento: '2026-10-20', logistica: REEMBOLSO, ...over })
assert.equal(log({ ganhoNegocio: '2026-09-26', pagamentoLogistica: '2026-10-05' }).cor, 'verde')
assert.equal(log({ ganhoNegocio: '2026-09-26', pagamentoLogistica: '2026-09-20' }).cor, 'vermelho', 'pagamento vencido puxa a etapa')
assert.match(log({ ganhoNegocio: '2026-09-26', pagamentoLogistica: '2026-09-20' }).texto, /^pagamento · /)
assert.equal(log({ ganhoNegocio: '2026-09-15', pagamentoLogistica: '2026-10-05' }).cor, 'vermelho', 'aquisicao vencida tambem')
// Com custo para a PSA so corre a aquisicao.
assert.equal(log({ logistica: CUSTO_PSA, ganhoNegocio: '2026-09-15', pagamentoLogistica: '2026-09-20' }).cor, 'vermelho')
assert.match(log({ logistica: CUSTO_PSA, ganhoNegocio: '2026-09-15', pagamentoLogistica: '2026-09-20' }).texto, /^aquisição · /)
// Log externa e evento online nao tem prazo a cobrar — e isso e estar em dia,
// nao e falta de dado. A resposta esta preenchida: o painel sabe medir.
assert.equal(log({ logistica: 'Não', ganhoNegocio: '2026-09-15' }).cor, 'verde')
assert.match(log({ logistica: 'Não', ganhoNegocio: '2026-09-15' }).texto, /não organiza a logística/)
assert.equal(log({ logistica: 'Evento Online', ganhoNegocio: '2026-09-15' }).cor, 'verde')
// Mas com o campo em branco continua cinza: ai e falta de dado de verdade.
assert.equal(log({ logistica: '', ganhoNegocio: '2026-09-15' }).cor, 'cinza', 'sem resposta')
// Sem as datas preenchidas o card nao vira verde por omissao.
assert.equal(log({}).cor, 'cinza', 'sem ganho e sem pagamento')

// Contrato: a etapa corre pelas duas assinaturas, cada uma ate a data da sua
// propriedade. Os relogios de envio sairam em 17/10/2026 — o CS nao tem como
// metrificar "Data de Envio contrato Cliente/Palestrante" hoje.
const ctr = (over) => E({ stage: CTR, evento: '2026-11-20', ...over })
const SO_CLIENTE = { formatoContrato: 'MC (Cliente x PSA x Palestrante)' }
assert.equal(ctr({ ...SO_CLIENTE, prazoAssinatura: '2026-10-20' }).cor, 'verde')
assert.equal(ctr({ ...SO_CLIENTE, prazoAssinatura: '2026-09-10' }).cor, 'vermelho')
assert.match(ctr({ ...SO_CLIENTE, prazoAssinatura: '2026-09-10' }).texto, /^assinatura · /)
// Onboarding nao pinta mais nada nesta etapa.
assert.equal(ctr({ ...SO_CLIENTE, onboarding: '2026-01-05', prazoAssinatura: '2026-10-20' }).cor, 'verde')
// Sem prazo preenchido a assinatura ja conta como atrasada.
assert.equal(ctr(SO_CLIENTE).cor, 'vermelho', 'sem prazo de assinatura')
// Cumprido e verde: cinza so quando falta dado ou falta regra.
const fechado = { ...SO_CLIENTE, prazoAssinatura: '2026-01-20', dataAssinatura: '2026-01-08' }
assert.equal(ctr(fechado).cor, 'verde', 'assinado fecha o relogio do cliente')
assert.match(ctr(fechado).texto, /^assinatura · assinado/)
// Com minuta do palestrante exigida e sem prazo dela, a etapa fica vermelha
// mesmo com o cliente fechado.
assert.equal(
  ctr({ ...fechado, formatoContrato: 'MC (Cliente x PSA) = 100% PSA', palestranteExclusivo: 'Não' }).cor,
  'vermelho',
  'falta o prazo do palestrante',
)

// ---- prazo do palestrante sai da propriedade ----
// "Prazo de Assinatura  Contrato Palestrante" e o validador. Colombo
// (46097473964) tinha 26/10 no campo e o painel cobrava 19/07, calculado do
// onboarding — o calculo saiu.
const palestrante100 = { formatoContrato: 'MC (Cliente x PSA) = 100% PSA', palestranteExclusivo: 'Não' }
const assinaPal = (over) => R['palestrante-assinatura']({ ...palestrante100, ...over })
assert.equal(assinaPal({ prazoAssinaturaPalestrante: '2026-10-10' }).estado, 'verde', 'faltam 11')
assert.equal(assinaPal({ prazoAssinaturaPalestrante: '2026-10-03' }).estado, 'amarelo', 'faltam 4')
assert.equal(assinaPal({ prazoAssinaturaPalestrante: '2026-09-29' }).estado, 'amarelo', 'vence hoje')
assert.equal(assinaPal({ prazoAssinaturaPalestrante: '2026-09-20' }).estado, 'vermelho')
assert.equal(assinaPal({}).estado, 'vermelho', 'sem prazo preenchido')
assert.match(assinaPal({}).texto, /sem "Prazo de Assinatura  Contrato Palestrante" preenchido/)
// O onboarding nao entra.
assert.equal(assinaPal({ onboarding: '2026-09-28' }).estado, 'vermelho')
// Assinado mede contra a propriedade.
assert.equal(
  assinaPal({ prazoAssinaturaPalestrante: '2026-09-25', dataAssinaturaPalestrante: '2026-09-20' }).cumpriu,
  true,
)
assert.equal(
  assinaPal({ prazoAssinaturaPalestrante: '2026-09-25', dataAssinaturaPalestrante: '2026-09-30' }).cumpriu,
  false,
)
// Formato que nao exige minuta do palestrante segue fora de qualquer prazo.
assert.equal(R['palestrante-assinatura']({ formatoContrato: 'MC (Cliente x PSA x Palestrante)' }).estado, 'nao-aplica')
assert.equal(
  R['palestrante-assinatura']({ formatoContrato: 'MC (Cliente x PSA) = 100% PSA', palestranteExclusivo: 'Sim' }).estado,
  'nao-aplica',
)

console.log('ok — prazo do palestrante sai da propriedade')

// Briefing: so a data do evento manda.
assert.equal(E({ stage: BRF, evento: '2026-10-27' }).cor, 'verde', 'D-28')
assert.equal(E({ stage: BRF, evento: '2026-10-19' }).cor, 'amarelo', 'D-20')
assert.equal(E({ stage: BRF, evento: '2026-10-09' }).cor, 'vermelho', 'D-10 ja perdeu o agendamento')
assert.equal(
  E({ stage: BRF, evento: '2026-10-09', reunioes: [{ titulo: 'Briefing', inicio: '2026-10-05', desfecho: '' }] }).cor,
  'amarelo',
  'agendado fecha um relogio, sobra o da realizacao',
)

// As cinco etapas antigas seguem por tempo na etapa, sem relogio.
assert.equal(E({ stage: '1088361911', entrouEtapa: '2026-09-27', evento: '2026-11-01' }).cor, 'verde')
assert.equal(E({ stage: '1088361911', entrouEtapa: '2026-03-01', evento: '2026-11-01' }).cor, 'vermelho')

// Contrato so entre cliente e palestrante: a PSA nao e parte, entao os prazos
// do contrato do cliente nao correm.
assert.equal(
  ctr({ onboarding: '2026-01-05', prazoAssinatura: '2026-01-10', formatoContrato: 'MC (Cliente x Palestrante)' }).cor,
  'vermelho',
  'sem a PSA os relogios do cliente nao correm, mas o do palestrante sim: 05/01 + 25 venceu',
)
assert.match(
  ctr({ onboarding: '2026-01-05', prazoAssinatura: '2026-01-10', formatoContrato: 'MC (Cliente x Palestrante)' }).texto,
  /^assinatura do palestrante · /,
)
assert.equal(
  ctr({ onboarding: '2026-01-05', prazoAssinatura: '2026-01-10', formatoContrato: 'MC (Cliente x PSA x Palestrante)' }).cor,
  'vermelho',
  'com a PSA no contrato os prazos do cliente valem',
)

console.log('ok — etapas por relogio no CS')

// Empate de cor entre as duas assinaturas: manda quem trava primeiro, e o
// relogio com marco de conclusao ganha o desempate. Os dois sao 'fechado'.
const empate = {
  stage: CTR, evento: '2026-11-20',
  formatoContrato: 'MC (Cliente x PSA) = 100% PSA', palestranteExclusivo: 'Não',
  prazoAssinatura: '2026-08-20', prazoAssinaturaPalestrante: '2026-09-20',
}
assert.equal(E(empate).cor, 'vermelho')
assert.match(E(empate).texto, /^assinatura · /, 'os dois vermelhos: o do cliente vem primeiro na lista')
assert.match(
  E({ ...empate, dataAssinatura: '2026-08-10' }).texto,
  /^assinatura do palestrante · /,
  'cliente fechado: sobra a minuta do palestrante',
)

console.log('ok — empate entre as duas assinaturas')

// Faturamento corre contra "Prazo para Despachar (Faturamento ao
// Financeiro)" e so contra ele. Prazo em branco e vermelho, igual ao
// contrato sem onboarding: Redetelesul (47930894741) ficava verde com o
// prazo vazio porque o calculo de "assinatura + 3" dava 16/10, "vence hoje".
const FAT = '1450683393'
const fat = (over) => E({ stage: FAT, evento: '2026-11-20', ...over })
assert.equal(fat({}).cor, 'vermelho', 'sem prazo preenchido nao e em dia')
assert.match(fat({}).texto, /sem "Prazo para Despachar \(Faturamento ao Financeiro\)" preenchido/)
// Assinatura preenchida nao substitui o prazo.
assert.equal(fat({ dataAssinatura: '2026-09-28' }).cor, 'vermelho')
// HOJE = 29/09. Prazo 10/10: faltam 11 dias.
assert.equal(fat({ prazoDespacho: '2026-10-10' }).cor, 'verde')
// Reta final: 4 dias antes ja e amarelo, e o dia do prazo tambem.
assert.equal(fat({ prazoDespacho: '2026-10-03' }).cor, 'amarelo', 'faltam 4')
assert.equal(fat({ prazoDespacho: '2026-09-29' }).cor, 'amarelo', 'vence hoje')
assert.equal(fat({ prazoDespacho: '2026-09-28' }).cor, 'vermelho', 'venceu ontem')
assert.match(fat({ prazoDespacho: '2026-09-20' }).texto, /^emissão · 9d depois do prazo/)

console.log('ok — faturamento no CS')

// ---- minuta do palestrante ----
// O formato de contrato diz quais minutas correm: 100% PSA roda as duas,
// interveniente roda so a do cliente, cliente x palestrante so a do palestrante.
const PSA100 = 'MC (Cliente x PSA) = 100% PSA'
const INTERV = 'MC (Cliente x PSA x Palestrante)'
const CLIPAL = 'MC (Cliente x Palestrante)'
const pal = (chave, over) => RELOGIOS.find((r) => r.chave === chave).ver(T(over), HOJE)

assert.equal(pal('palestrante-assinatura', { formatoContrato: INTERV }).estado, 'nao-aplica', 'interveniente nao tem minuta propria')
assert.equal(pal('palestrante-assinatura', { formatoContrato: CLIPAL, prazoAssinaturaPalestrante: '2026-09-20' }).estado, 'vermelho')
const palOk = pal('palestrante-assinatura', { formatoContrato: PSA100, prazoAssinaturaPalestrante: '2026-09-26', dataAssinaturaPalestrante: '2026-09-18' })
assert.equal(palOk.estado, 'concluido')
assert.equal(palOk.cumpriu, true, '18/09 veio antes de 26/09')

// Com o contrato do cliente fechado, quem sobra na etapa e a minuta do
// palestrante — prazo dela em 20/09, vencido.
const soMinuta = {
  stage: CTR, evento: '2026-11-20', formatoContrato: PSA100, palestranteExclusivo: 'Não',
  prazoAssinatura: '2026-09-15', dataAssinatura: '2026-09-10',
  prazoAssinaturaPalestrante: '2026-09-20',
}
assert.equal(E(soMinuta).cor, 'vermelho')
assert.match(E(soMinuta).texto, /^assinatura do palestrante · /)
// Palestrante exclusivo nao tem minuta por evento: a mesma etapa fica verde.
assert.equal(E({ ...soMinuta, palestranteExclusivo: 'Sim' }).cor, 'verde')

console.log('ok — minuta do palestrante')

// ---- a conta que o card abre ----
// A explicacao sai da mesma regua que pinta o card: se divergirem, o farmer
// cobra uma coisa e o quadro mostra outra.
const tLog = T({ stage: LOG, logistica: REEMBOLSO, ganhoNegocio: '2026-09-15', pagamentoLogistica: '2026-10-05', entrouEtapa: '2026-10-02', evento: '2026-11-20' })
const { datas, contas } = explicar(tLog, 'Contratar Logística', HOJE)

// A tabela traz o nome EXATO da propriedade no HubSpot: quem le o dialogo
// precisa achar o campo na tela do ticket.
assert.deepEqual(
  datas.map((d) => [d.rotulo, d.valor]),
  [
    ['Negócio ganho', '2026-09-15'],
    ['Data prevista de pagamento Logistica', '2026-10-05'],
    ['Prazo de aquisição', '2026-09-20'],
  ],
)

// Uma frase por relogio, com a data e a conta de dias.
assert.equal(contas[0].estado, 'vermelho')
assert.equal(contas[0].porque, 'O prazo era 20/09/2026 venceu há 9 dias.')
assert.equal(contas[1].estado, 'verde')
assert.equal(contas[1].porque, 'Data prevista de pagamento Logistica 05/10/2026 ainda não venceu: faltam 6 dias.')

// Prazo anterior a entrada na etapa e dado possivelmente herdado.
assert.equal(contas[0].herdado, true, 'prazo 20/09 contra entrada 02/10')
assert.equal(contas[1].herdado, false, 'prazo do proprio ciclo nao leva aviso')

// Sem data preenchida a frase pede o preenchimento em vez de inventar prazo.
const semData = explicar(T({ stage: LOG, logistica: CUSTO_PSA, entrouEtapa: '2026-10-02' }), 'Contratar Logística', HOJE)
assert.equal(semData.contas[0].estado, 'sem-dado')
assert.equal(
  semData.contas[0].porque,
  'Sem negócio ganho associado ao ticket, não há de onde contar o prazo.',
)

// A cor da conta e a mesma do card, sempre.
assert.equal(avaliarEtapa(tLog, HOJE, QUADROS.cs.sla).cor, 'vermelho')
assert.ok(contas.some((c) => c.estado === 'vermelho'))

console.log('ok — conta do card bate com a cor do card')

// ---- evento passado manda na cor ----
// Etapa com relogio e trabalho que tem que acontecer ANTES do evento. Com o
// evento passado e o ticket ainda nela, esta atrasado — nao importa o que
// diga a data da propriedade. Caso real: Votorantim Cimentos, evento 02/10,
// parado em Contratar Logistica, verde porque o pagamento estava marcado para
// 09/11.
const votorantim = T({
  stage: LOG, logistica: REEMBOLSO, evento: '2026-09-26',
  prazoLogistica: '', pagamentoLogistica: '2026-11-09', entrouEtapa: '2026-09-26',
})
assert.equal(avaliarEtapa(votorantim, HOJE, QUADROS.cs.sla).cor, 'vermelho')
assert.match(avaliarEtapa(votorantim, HOJE, QUADROS.cs.sla).texto, /evento foi em 26\/09\/2026/)
assert.equal(explicar(votorantim, 'Contratar Logística', HOJE).eventoPassou, true)

// Com o evento no futuro a regra dos prazos continua mandando.
const futuro = T({ ...votorantim, evento: '2026-11-20' })
assert.equal(avaliarEtapa(futuro, HOJE, QUADROS.cs.sla).cor, 'verde', 'pagamento ainda no prazo')

// Etapa pos-evento nao e afetada: ali o evento passado e o normal.
assert.equal(
  avaliarEtapa(T({ stage: '1088361911', evento: '2026-09-01', entrouEtapa: '2026-09-27' }), HOJE, QUADROS.cs.sla).cor,
  'verde',
  'Pagamento Pos-Palestra existe justamente depois do evento',
)

console.log('ok — evento passado manda na cor')

// Formato da Empresa saiu da conta do prazo de assinatura: o prazo e a
// propriedade do ticket, igual para privada, orgao publico, Sistema S,
// associacao e formato em branco. Antes era 20/30/45 por formato, e isso
// contradizia o prazo que o CS escrevia no campo.
for (const f of ['Associação', 'Agência', '', 'Empresa Privada', 'Órgão Público']) {
  assert.equal(
    R['contrato-assinatura']({ formatoEmpresa: f, prazoAssinatura: '2026-10-10' }).estado,
    'verde',
    'o prazo manda, nao o formato: ' + f,
  )
  assert.equal(
    R['contrato-assinatura']({ formatoEmpresa: f, prazoAssinatura: '2026-09-20' }).estado,
    'vermelho',
    'o prazo manda, nao o formato: ' + f,
  )
  assert.equal(
    R['contrato-assinatura']({ formatoEmpresa: f }).estado,
    'vermelho',
    'sem prazo preenchido, em qualquer formato: ' + f,
  )
}
// Na etapa, sem prazo de assinatura preenchido o card fica vermelho em
// qualquer formato de empresa.
assert.equal(E({ stage: CTR, evento: '2026-11-20', formatoEmpresa: 'Associação' }).cor, 'vermelho')
assert.equal(E({ stage: CTR, evento: '2026-11-20', formatoEmpresa: 'Órgão Público' }).cor, 'vermelho')

console.log('ok — formato da empresa nao decide prazo')

// Campo em branco para o relogio e cinza no card, mas tem que aparecer no
// dialogo: isento e falta de preenchimento ficam iguais na cor, e so um dos
// dois alguem consegue resolver.
const semFormato = explicar(
  T({ stage: CTR, formatoEmpresa: '', formatoContrato: '', prazoAssinatura: '2026-10-10', evento: '2026-11-20' }),
  'Assinar Contrato',
  HOJE,
)
const branco = semFormato.contas.filter((c) => c.faltaDado)
assert.equal(branco.length, 1, 'so o relogio de assinatura do palestrante para pelo Formato de Contrato')
assert.match(branco[0].porque, /^Formato de Contrato está em branco/)

// Isento de verdade nao leva a marca: nao ha o que preencher. O unico isento
// do relogio do cliente e o contrato em que a PSA nao e parte.
const semPsa = explicar(
  T({ stage: CTR, formatoContrato: 'MC (Cliente x Palestrante)', prazoAssinaturaPalestrante: '2026-10-10', evento: '2026-11-20' }),
  'Assinar Contrato',
  HOJE,
)
const assinatura = semPsa.contas.find((c) => c.chave === 'contrato-assinatura')
assert.equal(assinatura.estado, 'nao-aplica')
assert.equal(assinatura.faltaDado, false)
assert.match(assinatura.porque, /contrato é entre cliente e palestrante/)

console.log('ok — campo em branco aparece no dialogo')

// ---- guia Closer: proposta no mesmo dia ----
// Regra trazida do painel Negocios Ativos. HOJE no teste e 29/09/2026 09:00 BRT.
const N = (over) => ({
  id: 'd1', nome: 'Negocio', ownerId: '1',
  criadoMs: Date.parse('2026-09-20T12:00:00Z'),
  qualificacaoMs: Date.parse('2026-09-25T00:00:00Z'), // campo DATE, meia-noite UTC
  propostaMs: null, reunioes: [], ...over,
})
const dia = (d, h = '15:00') => Date.parse(`${d}T${h}:00Z`)
const cls = (o) => classificar(N(o), HOJE)

// Sem reuniao: o evento e a qualificacao.
assert.deepEqual(cls({ propostaMs: dia('2026-09-25') }), { balde: 'sem', estado: 'no_dia', reuniaoMs: null })
assert.equal(cls({ propostaMs: dia('2026-09-26') }).estado, 'fora', 'proposta no dia seguinte')
assert.equal(cls({}).estado, 'fora', 'qualificou e nunca mandou proposta')
assert.equal(cls({ qualificacaoMs: Date.parse('2026-09-29T00:00:00Z') }).estado, 'aguardando', 'qualificou hoje')

// Com reuniao: vale o dia de qualquer reuniao ja ocorrida.
const reuniaoVenda = (d, h) => [{ ms: dia(d, h), tipo: 'B2B | Reunião de Venda' }]
assert.equal(cls({ reunioes: reuniaoVenda('2026-09-24'), propostaMs: dia('2026-09-24') }).estado, 'no_dia')
assert.equal(cls({ reunioes: reuniaoVenda('2026-09-24'), propostaMs: dia('2026-09-26') }).estado, 'fora')
// Proposta no dia da qualificacao tambem vale: mandou rapido e so depois marcou.
assert.equal(cls({ reunioes: reuniaoVenda('2026-09-28'), propostaMs: dia('2026-09-25') }).estado, 'no_dia')
// Reuniao futura: a janela nem abriu.
assert.equal(cls({ reunioes: reuniaoVenda('2026-10-10') }).estado, 'aguardando')
// Reuniao de hoje que ja aconteceu: o dia nao acabou, ainda da tempo.
assert.equal(cls({ reunioes: reuniaoVenda('2026-09-29', '08:00') }).estado, 'aguardando')

// So reuniao de venda conta. Relacionamento nao joga o negocio para o balde com.
assert.equal(cls({ reunioes: [{ ms: dia('2026-09-24'), tipo: 'B2B | Relacionamento' }] }).balde, 'sem')
// Reuniao sem tipo entra quando e a primeira do negocio.
assert.equal(cls({ reunioes: [{ ms: dia('2026-09-24'), tipo: '' }] }).balde, 'com')
assert.equal(
  cls({ reunioes: [{ ms: dia('2026-09-24'), tipo: '' }, { ms: dia('2026-09-26'), tipo: '' }] }).balde,
  'com',
  'a segunda sem tipo nao conta, mas a primeira ja jogou no balde com',
)

// A razao do card: aguardando fica FORA do denominador.
const grupo = agrupar(
  [
    N({ id: 'a', propostaMs: dia('2026-09-25') }),
    N({ id: 'b', propostaMs: dia('2026-09-26') }),
    N({ id: 'c', qualificacaoMs: Date.parse('2026-09-29T00:00:00Z') }),
  ],
  () => 'Closer X',
  HOJE,
)
assert.equal(grupo.length, 1)
assert.equal(grupo[0].semCumpriu, 1)
assert.equal(grupo[0].semTestavel, 2, 'o aguardando nao entra no denominador')
assert.equal(grupo[0].semAguardando, 1)

console.log('ok — proposta no mesmo dia')

// ---- formato com interveniente nao pede nada do palestrante ----
// MC (Cliente x PSA x Palestrante): a PSA e parte, o palestrante entra como
// interveniente no mesmo contrato, entao nao ha minuta propria para cobrar.
const INTERV2 = 'MC (Cliente x PSA x Palestrante)'
const interv = explicar(
  T({ stage: CTR, formatoEmpresa: 'Empresa Privada', formatoContrato: INTERV2,
      onboarding: '2026-09-20', evento: '2026-11-20' }),
  'Assinar Contrato',
  HOJE,
)
assert.deepEqual(
  interv.datas.map((d) => d.rotulo),
  ['Prazo de Assinatura de Contrato'],
  'a tabela nao lista data de palestrante num formato que nao tem minuta',
)
assert.deepEqual(
  interv.contas.filter((c) => c.estado !== 'nao-aplica').map((c) => c.chave),
  ['contrato-assinatura'],
  'so o relogio de assinatura do cliente corre',
)

// Em 100% PSA, que exige minuta, as datas do palestrante voltam.
const psa100 = explicar(
  T({ stage: CTR, formatoEmpresa: 'Empresa Privada', formatoContrato: 'MC (Cliente x PSA) = 100% PSA',
      onboarding: '2026-09-20', evento: '2026-11-20' }),
  'Assinar Contrato',
  HOJE,
)
assert.ok(psa100.datas.some((d) => /palestrante/i.test(d.rotulo)), '100% PSA pede minuta')

console.log('ok — interveniente nao cobra minuta do palestrante')

// ---- palestrante exclusivo nao tem minuta por evento ----
// Em 100% PSA a minuta do palestrante so e exigida quando ele NAO e exclusivo:
// exclusivo ja tem contrato com a PSA. Em branco conta como nao exclusivo.
const CEM_PSA = 'MC (Cliente x PSA) = 100% PSA'
const semMinuta = explicar(
  T({ stage: CTR, formatoEmpresa: 'Empresa Privada', formatoContrato: CEM_PSA,
      palestranteExclusivo: 'Sim', onboarding: '2026-09-20', evento: '2026-11-20' }),
  'Assinar Contrato',
  HOJE,
)
assert.deepEqual(
  semMinuta.contas.filter((c) => c.estado !== 'nao-aplica').map((c) => c.chave),
  ['contrato-assinatura'],
  'exclusivo roda so o relogio de assinatura do cliente',
)
assert.ok(!semMinuta.datas.some((d) => /palestrante/i.test(d.rotulo)), 'e some da tabela de datas')
assert.ok(
  semMinuta.contas.every((c) => !c.faltaDado),
  'exclusivo nao e campo faltando: nao ha o que preencher',
)

// Nao exclusivo, e em branco, seguem exigindo a minuta.
for (const v of ['Não', '']) {
  const comMinuta = explicar(
    T({ stage: CTR, formatoEmpresa: 'Empresa Privada', formatoContrato: CEM_PSA,
        palestranteExclusivo: v, onboarding: '2026-09-20', evento: '2026-11-20' }),
    'Assinar Contrato',
    HOJE,
  )
  assert.ok(
    comMinuta.datas.some((d) => /palestrante/i.test(d.rotulo)),
    `"${v || 'em branco'}" ainda pede minuta`,
  )
}

// Exclusivo nao muda nada no formato Cliente x Palestrante: ali a minuta e o
// contrato inteiro, nao um acessorio.
const cliPal = explicar(
  T({ stage: CTR, formatoEmpresa: 'Empresa Privada', formatoContrato: 'MC (Cliente x Palestrante)',
      palestranteExclusivo: 'Sim', evento: '2026-11-20' }),
  'Assinar Contrato',
  HOJE,
)
assert.ok(cliPal.contas.some((c) => c.chave === 'palestrante-assinatura' && c.estado !== 'nao-aplica'))

console.log('ok — palestrante exclusivo dispensa a minuta')

// Evento HOJE numa etapa com relogio ja e atraso: o trabalho dela tem que
// estar pronto ANTES do evento. Caso real: Thermo Fisher, evento 08/10,
// contrato assinado e palestrante exclusivo, parado em Assinar Contrato —
// ficava verde porque a regra so pegava evento estritamente passado.
const noDiaDoEvento = T({
  stage: CTR, formatoEmpresa: 'Empresa Privada', formatoContrato: 'MC (Cliente x PSA) = 100% PSA',
  palestranteExclusivo: 'Sim', onboarding: '2026-09-01', dataAssinatura: '2026-09-10',
  evento: '2026-09-29', entrouEtapa: '2026-09-20',
})
assert.equal(avaliarEtapa(noDiaDoEvento, HOJE, QUADROS.cs.sla).cor, 'vermelho')
assert.equal(avaliarEtapa(noDiaDoEvento, HOJE, QUADROS.cs.sla).texto, 'o evento é hoje e a etapa não fechou')

// Amanha ainda da tempo para a etapa, mas o briefing ja devia ter acontecido.
assert.equal(
  avaliarEtapa({ ...noDiaDoEvento, evento: '2026-09-30' }, HOJE, QUADROS.cs.sla).cor,
  'vermelho',
  'evento amanha sem ter passado por Realizar Briefing',
)
// Com o briefing feito, segue pela regua da etapa.
assert.equal(
  avaliarEtapa({ ...noDiaDoEvento, evento: '2026-09-30', entrouBriefing: '2026-09-15' }, HOJE, QUADROS.cs.sla).cor,
  'verde',
  'evento amanha, briefing feito e tudo cumprido',
)

console.log('ok — evento hoje ja e atraso em etapa de trabalho')

// ---- briefing pendente atravessa todas as etapas ----
// Com o evento chegando, o ticket ja tinha que ter passado por Realizar
// Briefing. Se nao passou, esta parado na etapa errada — e isso vale mesmo
// que os prazos da etapa onde ele esta estejam em dia.
const semBrief = (over) =>
  avaliarEtapa(
    T({ stage: CTR, formatoEmpresa: 'Empresa Privada', formatoContrato: 'MC (Cliente x PSA x Palestrante)',
        onboarding: '2026-09-25', dataAssinatura: '2026-09-26', entrouEtapa: '2026-09-26', ...over }),
    HOJE,
    QUADROS.cs.sla,
  )

assert.equal(semBrief({ evento: '2026-10-20' }).cor, 'verde', 'D-21 ainda nao cobra briefing')
assert.equal(semBrief({ evento: '2026-10-14' }).cor, 'amarelo', 'D-15')
assert.equal(semBrief({ evento: '2026-10-07' }).cor, 'amarelo', 'D-8')
assert.equal(semBrief({ evento: '2026-10-06' }).cor, 'vermelho', 'D-7')
assert.equal(semBrief({ evento: '2026-09-30' }).cor, 'vermelho', 'D-1')
assert.match(semBrief({ evento: '2026-10-06' }).texto, /briefing não aconteceu/)

// Ja passou pela etapa: a regra nao se aplica, mesmo com o evento em cima.
assert.equal(semBrief({ evento: '2026-10-06', entrouBriefing: '2026-09-20' }).cor, 'verde')
// E quem esta NA etapa de briefing segue pelos relogios dela.
assert.equal(
  avaliarEtapa(T({ stage: BRF, evento: '2026-10-19' }), HOJE, QUADROS.cs.sla).cor,
  'amarelo',
  'na propria etapa manda o relogio de agendamento, D-20',
)

// A pior cor manda: etapa vermelha nao vira amarela por causa do briefing.
assert.equal(
  semBrief({ evento: '2026-10-14', onboarding: '2026-08-01', dataAssinatura: '' }).cor,
  'vermelho',
  'assinatura vencida pesa mais que o amarelo do briefing',
)

console.log('ok — briefing pendente atravessa as etapas')

// ---- etapa com relogio que nao corre neste ticket ----
// Grupo Mascarello (48990612847): em Contratar Logistica com "Logistica sera
// organizada pela PSA? = Nao". O dialogo dizia "esta etapa nao tem relogio",
// que e falso: a etapa tem dois, eles e que nao se aplicam a este ticket.
const semLog = explicar(T({ stage: LOG, logistica: 'Não', entrouEtapa: '2026-10-05' }), 'Contratar Logística', HOJE)
assert.equal(semLog.contas.length, 2, 'os relogios continuam na conta, so nao correm')
assert.equal(semLog.contas[0].estado, 'nao-aplica')
assert.equal(
  semLog.contas[0].porque,
  'Não se aplica: a PSA não organiza a logística deste evento ("Não").',
)
assert.equal(
  semLog.contas[1].porque,
  'Não se aplica: não há reembolso de logística a cobrar do cliente ("Não").',
)
// Campo em branco continua sendo falta de dado, nao "nao se aplica" calado.
assert.equal(explicar(T({ stage: LOG, logistica: '' }), 'Contratar Logística', HOJE).contas[0].faltaDado, true)

console.log('ok — relogio que nao corre diz por que')

// ---- anexo do contrato conta como prova ----
// Suzano - Mariana Ferrao (45637669421): contrato do palestrante anexado ao
// ticket, sem data de assinatura. O painel cobrava um contrato que esta la.
// 127 dos 245 tickets que exigem minuta tem anexo, contra 6 com data.
const anexado = {
  formatoContrato: 'MC (Cliente x PSA) = 100% PSA',
  palestranteExclusivo: 'Não',
  prazoAssinaturaPalestrante: '2026-06-20',
}
assert.equal(R['palestrante-assinatura'](anexado).estado, 'vermelho', 'sem anexo e sem data, prazo 20/06 venceu')
assert.equal(R['palestrante-assinatura']({ ...anexado, anexoPalestrante: '12345' }).estado, 'concluido')
assert.equal(R['palestrante-assinatura']({ ...anexado, anexoPalestrante: '12345' }).texto, 'contrato anexado ao ticket')
// A data continua mandando quando existe: ela diz se cumpriu o prazo, o anexo nao.
assert.equal(
  R['palestrante-assinatura']({ ...anexado, anexoPalestrante: '12345', dataAssinaturaPalestrante: '2026-06-15' }).cumpriu,
  true,
)
// Mesmo tratamento do lado do cliente.
assert.equal(R['contrato-assinatura']({ prazoAssinatura: '2026-06-20' }).estado, 'vermelho')
assert.equal(R['contrato-assinatura']({ prazoAssinatura: '2026-06-20', anexoCliente: '9' }).estado, 'concluido')

console.log('ok — anexo do contrato conta como prova')

// Etapa sem relogio nao deve dizer que o evento passado manda na cor: em
// Confirmar PGTO Pre palestra (1452885000) a cor e cinza, e avaliarEtapa nem
// olha o evento. O dialogo afirmava o contrario.
const semRelogio = T({ stage: '1452885000', evento: '2026-09-24', entrouEtapa: '2026-10-08' })
assert.equal(explicar(semRelogio, 'Confirmar PGTO Pré palestra', HOJE).eventoPassou, false)
assert.equal(avaliarEtapa(semRelogio, HOJE, QUADROS.cs.sla).cor, 'cinza')
// Em etapa com relogio continua mandando.
assert.equal(explicar(T({ stage: LOG, evento: '2026-09-24', logistica: REEMBOLSO }), 'Contratar Logística', HOJE).eventoPassou, true)

console.log('ok — evento passado so fala onde manda')

// ---- prazo que ainda nao abriu e verde, nao cinza ----
// Positiva Eventos (43679094830): em Realizar Briefing com o evento a D-34.
// A janela do agendamento abre em D-30, entao nada esta atrasado — mas o card
// dizia "sem prazo nesta etapa" e ficava cinza, que e a cor de "nao sei medir".
const aindaNaoAbriu = T({ stage: BRF, evento: '2026-11-02', entrouEtapa: '2026-09-28' })
assert.equal(avaliarEtapa(aindaNaoAbriu, HOJE, QUADROS.cs.sla).cor, 'verde', 'D-34')
assert.match(avaliarEtapa(aindaNaoAbriu, HOJE, QUADROS.cs.sla).texto, /^agendamento · evento a D-34/)
// Dentro da janela a regra volta a mandar.
assert.equal(avaliarEtapa(T({ stage: BRF, evento: '2026-10-27' }), HOJE, QUADROS.cs.sla).cor, 'verde', 'D-28')
assert.equal(avaliarEtapa(T({ stage: BRF, evento: '2026-10-19' }), HOJE, QUADROS.cs.sla).cor, 'amarelo', 'D-20')
// Falta de dado continua cinza: isso o painel nao sabe medir mesmo.
assert.equal(avaliarEtapa(T({ stage: BRF, evento: '' }), HOJE, QUADROS.cs.sla).cor, 'cinza', 'sem data de evento')

console.log('ok — prazo que ainda nao abriu e verde')

// ---- relogio fora de cena por resposta preenchida e verde ----
// Grupo Mascarello (48990612847): Contratar Logistica com "Logistica sera
// organizada pela PSA? = Nao". Nenhum relogio corre, nada ha a cobrar — e o
// card ficava cinza, que e a cor de "nao sei medir".
const foraPorResposta = T({ stage: LOG, logistica: 'Não', entrouEtapa: '2026-10-05', evento: '2027-01-27' })
assert.equal(avaliarEtapa(foraPorResposta, HOJE, QUADROS.cs.sla).cor, 'verde')
assert.match(avaliarEtapa(foraPorResposta, HOJE, QUADROS.cs.sla).texto, /^aquisição · a PSA não organiza/)
// Campo em branco continua cinza: resposta ausente nao e resposta.
assert.equal(avaliarEtapa(T({ stage: LOG, logistica: '', entrouEtapa: '2026-10-05' }), HOJE, QUADROS.cs.sla).cor, 'cinza')
// Contrato entre cliente e palestrante: o relogio do cliente nao se aplica,
// mas o do palestrante corre — resposta preenchida nao pode apagar prazo vivo.
assert.equal(
  avaliarEtapa(T({ stage: CTR, formatoContrato: 'MC (Cliente x Palestrante)', onboarding: '2026-01-05', evento: '2026-11-20' }), HOJE, QUADROS.cs.sla).cor,
  'vermelho',
)

console.log('ok — fora de cena por resposta preenchida e verde')

// ---- cinza diz qual campo falta ----
// O card dizia "sem prazo nesta etapa" numa etapa que tem quatro relogios — a
// frase escondia a unica acao possivel. Com os relogios do cliente fechados e
// o Formato de Contrato em branco, o que falta e esse campo.
const faltaFormatoContrato = T({
  stage: CTR, evento: '2026-11-13', onboarding: '2026-08-03', formatoContrato: '',
  envioCliente: '2026-08-07', prazoAssinatura: '2026-08-20', dataAssinatura: '2026-08-10',
})
const vFormato = avaliarEtapa(faltaFormatoContrato, HOJE, QUADROS.cs.sla)
assert.equal(vFormato.cor, 'cinza')
assert.equal(vFormato.texto, 'falta Formato de Contrato')
// Logistica sem resposta diz o campo dela.
assert.equal(
  avaliarEtapa(T({ stage: LOG, logistica: '', entrouEtapa: '2026-10-05' }), HOJE, QUADROS.cs.sla).texto,
  'falta Logística será organizada pela PSA?',
)
// Falta de data sem campo nomeado cai na frase do proprio relogio.
assert.match(
  avaliarEtapa(T({ stage: LOG, logistica: CUSTO_PSA, entrouEtapa: '2026-10-05' }), HOJE, QUADROS.cs.sla).texto,
  /^aquisição · sem negócio ganho/,
)

console.log('ok — cinza diz qual campo falta')

// ---- Coletar NPS e Fotos: 5 dias apos o evento ----
// Etapa de trabalho DEPOIS do evento, entao eventoPassou nao pode pinta-la de
// vermelho: o evento ter acontecido e a condicao para o prazo comecar.
const NPS = '1451268423'
const nps = (over) => avaliarEtapa(T({ stage: NPS, entrouEtapa: '2026-09-20', ...over }), HOJE, QUADROS.cs.sla)

// HOJE = 29/09. Evento em 26/09 + 5 = 01/10, ainda no prazo.
assert.equal(nps({ evento: '2026-09-26' }).cor, 'verde')
assert.match(nps({ evento: '2026-09-26' }).texto, /^coleta · faltam 2d/)
// Evento em 24/09 + 5 = 29/09: vence hoje, ainda verde.
assert.equal(nps({ evento: '2026-09-24' }).cor, 'verde')
// 22/09 + 5 = 27/09, dois dias depois.
assert.equal(nps({ evento: '2026-09-22' }).cor, 'amarelo')
// 20/09 + 5 = 25/09, quatro dias depois.
assert.equal(nps({ evento: '2026-09-20' }).cor, 'vermelho')
// Evento ainda por vir: o prazo nem abriu, e isso e estar em dia.
assert.equal(nps({ evento: '2026-10-20' }).cor, 'verde')
assert.match(nps({ evento: '2026-10-20' }).texto, /^coleta · evento a D-21/)
// Sem data de evento nao da para contar: cinza dizendo o que falta.
assert.equal(nps({ evento: '' }).cor, 'cinza')
assert.match(nps({ evento: '' }).texto, /sem data de evento/)
// A regra do briefing nao atravessa para ca: o evento ja passou.
assert.ok(!alertas(T({ stage: NPS, evento: '2026-09-26' }), HOJE, QUADROS.cs.sla).some((a) => a.chave === 'briefing'))

console.log('ok — coleta de NPS em 5 dias do evento')

// ---- marco com data no futuro nao aconteceu ----
// Prefeitura de Colombo (46097473964): "Envio contrato palestrante" marcado
// para 22/10 e o painel dizia "minuta enviada". Os campos de envio sao usados
// como data PLANEJADA: 14 dos 32 preenchidos no palestrante estao no futuro.
const ENVIO = { formatoContrato: 'MC (Cliente x PSA) = 100% PSA', palestranteExclusivo: 'Não' }
assert.equal(R['palestrante-envio']({ ...ENVIO, envioPalestrante: '2026-09-10' }).estado, 'concluido')
assert.equal(R['palestrante-envio']({ ...ENVIO, envioPalestrante: '2026-09-29' }).estado, 'concluido', 'hoje ja conta')
const marcado = R['palestrante-envio']({ ...ENVIO, envioPalestrante: '2026-10-22' })
assert.equal(marcado.estado, 'bloqueado')
assert.match(marcado.texto, /envio marcado para 22\/10\/2026, ainda não aconteceu/)

// No contrato do cliente o envio futuro devolve o relogio a contagem: nao foi
// enviado, entao os dias uteis desde o onboarding voltam a correr.
assert.equal(R['contrato-envio']({ onboarding: '2026-09-01', envioCliente: '2026-09-10' }).estado, 'concluido')
assert.equal(R['contrato-envio']({ onboarding: '2026-09-01', envioCliente: '2026-10-22' }).estado, 'vermelho')
assert.match(R['contrato-envio']({ onboarding: '2026-09-01', envioCliente: '2026-10-22' }).texto, /dias úteis desde o onboarding/)

console.log('ok — marco com data no futuro nao aconteceu')

// ---- despacho registrado nao fecha a etapa ----
// Despachar nao conclui o faturamento: so sair da coluna conclui. A data de
// despacho entra na frase como contexto, nao como alivio.
const desp = (over) => E({ stage: FAT, evento: '2026-11-20', ...over })
// Prazo vencido com despacho feito: segue vermelho, e a frase diz as duas
// coisas. Alvarez & Marsal (47449431815): prazo 01/09, despacho 02/09, e em
// 16/10 ainda em Faturar.
const preso = desp({ prazoDespacho: '2026-09-01', dataFaturamento: '2026-09-02' })
assert.equal(preso.cor, 'vermelho')
assert.match(preso.texto, /despachado 02\/09\/2026 e a etapa não fechou — 28d depois do prazo/)
// Prazo em aberto com despacho feito: verde, dizendo que a etapa segue aberta.
const noPrazoAberto = desp({ prazoDespacho: '2026-10-05', dataFaturamento: '2026-10-01' })
assert.equal(noPrazoAberto.cor, 'verde')
assert.match(noPrazoAberto.texto, /despachado 01\/10\/2026, no prazo, etapa aberta/)
// cumpriu mede o despacho contra o prazo, nao contra hoje.
assert.equal(R['faturamento']({ prazoDespacho: '2026-10-05', dataFaturamento: '2026-10-01' }).cumpriu, true)
assert.equal(R['faturamento']({ prazoDespacho: '2026-10-05', dataFaturamento: '2026-10-06' }).cumpriu, false)

console.log('ok — despacho registrado nao fecha a etapa')

// ---- cumprido fora do prazo nao e verde ----
// O codigo tratava "concluido" como verde sem olhar o cumpriu do veredito:
// havia card verde com o contrato assinado 197 dias depois do prazo.
const assinouTarde = E({ stage: CTR, evento: '2026-11-20',
  formatoContrato: 'MC (Cliente x PSA x Palestrante)', onboarding: '2026-01-05',
  envioCliente: '2026-01-06', prazoAssinatura: '2026-01-25', dataAssinatura: '2026-06-01' })
assert.equal(assinouTarde.cor, 'amarelo')
assert.match(assinouTarde.texto, /assinado \d+d depois do prazo/)
// Assinado dentro do prazo segue verde.
const assinouNoPrazo = E({ stage: CTR, evento: '2026-11-20',
  formatoContrato: 'MC (Cliente x PSA x Palestrante)', onboarding: '2026-01-05',
  envioCliente: '2026-01-06', prazoAssinatura: '2026-01-25', dataAssinatura: '2026-01-20' })
assert.equal(assinouNoPrazo.cor, 'verde')

console.log('ok — cumprido fora do prazo nao e verde')

