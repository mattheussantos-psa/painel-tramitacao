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

// Etapas sem regra acordada ficam cinza mostrando o tempo parado, nunca verde.
for (const id of ['1452885000', '1451268423']) {
  assert.equal(SLA[id].tipo, 'sem-prazo', 'etapa sem regra do CS')
  assert.equal(avaliar(t({ stage: id, entrouEtapa: '2026-09-01' }), HOJE).cor, 'cinza')
}

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

// Contrato do cliente: 20 dias para empresa privada, 45 para orgao publico,
// contados do onboarding — a mesma conta do relogio da etapa.
const PRIV = { formatoEmpresa: 'Empresa Privada', formatoContrato: 'MC (Cliente x PSA x Palestrante)' }
const PUB = { formatoEmpresa: 'Órgão Público', formatoContrato: 'MC (Cliente x PSA x Palestrante)' }
assert.deepEqual(A({ ...PRIV, onboarding: '2026-09-01', statusContrato: 'Pendente' }), ['contrato'])
assert.deepEqual(A({ ...PRIV, onboarding: '2026-09-01', statusContrato: 'Assinado' }), [])
assert.deepEqual(A({ ...PRIV, onboarding: '2026-07-01', dataAssinatura: '2026-07-10' }), [], 'assinado fecha o alerta')
assert.deepEqual(A({ ...PRIV, onboarding: '2026-09-15', statusContrato: 'Pendente' }), [], 'vence 05/10, faltam 6 dias')
// A reta final amarela ja acende o alerta: o ponto e cobrar antes de estourar.
assert.deepEqual(A({ ...PRIV, onboarding: '2026-09-13', statusContrato: 'Pendente' }), ['contrato'], 'vence 03/10, faltam 4')

// Orgao publico tem 45 dias: o mesmo onboarding que acende a privada nao
// acende ele.
assert.deepEqual(A({ ...PUB, onboarding: '2026-09-01', statusContrato: 'Pendente' }), [], 'dia 28 dos 45')
assert.deepEqual(A({ ...PUB, onboarding: '2026-08-01', statusContrato: 'Pendente' }), ['contrato'], 'dia 59')

// Sem onboarding o relogio ja conta como atraso, entao o alerta acende junto —
// antes ficava calado, que era a divergencia com o quadro.
assert.deepEqual(A({ ...PRIV, onboarding: '', statusContrato: 'Pendente' }), ['contrato'])

// Formato sem prazo acordado, ou em branco, nao acende: o painel nao inventa
// prazo que o CS nao deu.
assert.deepEqual(A({ formatoContrato: 'MC (Cliente x PSA x Palestrante)', onboarding: '2026-01-01' }), [])
assert.deepEqual(
  A({ formatoEmpresa: 'Associação', formatoContrato: 'MC (Cliente x PSA x Palestrante)', onboarding: '2026-01-01' }),
  [],
)

// Contrato do palestrante e alerta proprio, nao somado ao do cliente.
const COM_MINUTA = { formatoContrato: 'MC (Cliente x PSA) = 100% PSA', palestranteExclusivo: 'Não' }
assert.deepEqual(A({ ...COM_MINUTA, ...PRIV, formatoContrato: COM_MINUTA.formatoContrato, onboarding: '2026-09-01' }), ['contrato', 'minuta'])
assert.deepEqual(A({ ...COM_MINUTA, onboarding: '2026-09-01' }), ['minuta'], 'formato da empresa em branco so acende a minuta')
assert.deepEqual(A({ ...COM_MINUTA, palestranteExclusivo: 'Sim', onboarding: '2026-09-01' }), [], 'exclusivo nao tem minuta')
assert.deepEqual(
  A({ ...COM_MINUTA, onboarding: '2026-09-01', dataAssinaturaPalestrante: '2026-09-10' }),
  [],
  'assinado fecha a minuta',
)

// Briefing: a mesma regra do quadro — D-15 amarelo, D-7 vermelho, e so para
// quem nao passou por Realizar Briefing.
assert.deepEqual(A({ evento: '2026-10-05' }), ['briefing'], 'D-6')
assert.deepEqual(A({ evento: '2026-10-20' }), [], 'D-21 ainda da tempo')
assert.deepEqual(A({ evento: '2026-10-05', entrouBriefing: '2026-09-20' }), [], 'ja passou pelo briefing')
assert.deepEqual(A({ evento: '2026-09-01' }), [], 'evento passado nao cobra briefing')

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
assert.equal(assin({ onboarding: '2026-10-07' }).prazo, '2026-10-27', 'onboarding + 20 dias')
assert.equal(assin({ onboarding: '2026-09-20' }).estado, 'verde', 'vence 10/10, ainda no prazo')
// A reta final e amarela: ir de verde direto para vermelho esconde a janela
// em que cobrar ainda adianta. Amarelo cobre os 4 dias antes e o dia do prazo.
assert.equal(assin({ onboarding: '2026-09-09' }).estado, 'amarelo', 'vence hoje 29/09')
assert.equal(assin({ onboarding: '2026-09-13' }).estado, 'amarelo', 'vence 03/10, faltam 4 dias')
assert.equal(assin({ onboarding: '2026-09-14' }).estado, 'verde', 'vence 04/10, faltam 5 dias')
assert.equal(assin({ onboarding: '2026-09-08' }).estado, 'vermelho', 'venceu ontem')
assert.equal(assin({ onboarding: '2026-09-08' }).dias, 1)
assert.equal(assin({}).estado, 'vermelho', 'sem onboarding conta como atrasado')
assert.match(assin({}).texto, /sem data de onboarding/)

// As duas pontas: da pra dizer se cumpriu, agora contra o prazo calculado.
const noPrazo = assin({ onboarding: '2026-08-20', dataAssinatura: '2026-09-05' })
assert.equal(noPrazo.cumpriu, true, 'assinou em 05/09, prazo era 09/09')
const atrasado = assin({ onboarding: '2026-08-20', dataAssinatura: '2026-09-13' })
assert.equal(atrasado.cumpriu, false)
assert.equal(atrasado.dias, 4)

// A data manual deixou de valer como prazo: so o onboarding manda.
assert.equal(assin({ prazoAssinatura: '2026-12-31' }).estado, 'vermelho', 'data manual nao salva ticket sem onboarding')

// Contrato assinado prova que foi enviado, mesmo sem o valor "Enviado".
assert.equal(R['contrato-envio']({ onboarding: '2026-01-01', statusContrato: 'Assinado' }).estado, 'concluido')
assert.equal(R['contrato-envio']({ onboarding: '2026-01-01', dataAssinatura: '2026-02-01' }).estado, 'concluido')

// Briefing anda pela data do evento, e a reuniao associada e o marco.
assert.equal(R['briefing-agendamento']({ evento: '2026-11-30' }).estado, 'nao-iniciado', 'D-62')
assert.equal(R['briefing-agendamento']({ evento: '2026-10-27' }).estado, 'verde', 'D-28')
assert.equal(R['briefing-agendamento']({ evento: '2026-10-19' }).estado, 'amarelo', 'D-20')
assert.equal(R['briefing-agendamento']({ evento: '2026-10-09' }).estado, 'vermelho', 'D-10')
assert.equal(
  R['briefing-agendamento']({ evento: '2026-10-09', reunioes: [{ titulo: 'Briefing PSA', inicio: '2026-10-05', desfecho: '' }] }).estado,
  'concluido',
  'reuniao marcada fecha o agendamento',
)
// Reuniao futura conta como agendada, nao como realizada.
const futura = [{ titulo: 'Alinhamento de conteúdo', inicio: '2026-10-02', desfecho: 'SCHEDULED' }]
assert.equal(R['briefing-realizacao']({ evento: '2026-10-03', reunioes: futura }).estado, 'vermelho', 'D-4 com reuniao ainda por acontecer')
const passada = [{ titulo: 'Alinhamento de conteúdo', inicio: '2026-09-20', desfecho: 'COMPLETED' }]
assert.equal(R['briefing-realizacao']({ evento: '2026-10-09', reunioes: passada }).estado, 'concluido')
// Bordas que a regra deixou em duas cores caem sempre na pior.
assert.equal(R['briefing-realizacao']({ evento: '2026-10-10' }).estado, 'verde', 'D-11')
assert.equal(R['briefing-realizacao']({ evento: '2026-10-09' }).estado, 'amarelo', 'D-10')
assert.equal(R['briefing-realizacao']({ evento: '2026-10-06' }).estado, 'vermelho', 'D-7')

// Minuta individual cai quando o palestrante e interveniente no contrato.
assert.equal(EXIGE_MINUTA_PALESTRANTE('MC (Cliente x PSA) = 100% PSA'), true)
assert.equal(EXIGE_MINUTA_PALESTRANTE('MC (Cliente x PSA x Palestrante)'), false)

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

// Contrato: envio em 1 dia util e assinatura em 20 dias do onboarding, pior
// manda.
const ctr = (over) => E({ stage: CTR, evento: '2026-11-20', ...over })
assert.equal(ctr({ onboarding: '2026-09-28' }).cor, 'verde', 'enviado ontem, assinatura vence em 18/10')
assert.equal(ctr({ onboarding: '2026-08-20' }).cor, 'vermelho', 'assinatura venceu em 09/09')
// Os dois vermelhos: manda quem trava primeiro, que e o envio.
assert.match(ctr({ onboarding: '2026-08-20' }).texto, /^envio · /)
// Com o envio registrado sobra a assinatura, que e a que o farmer cobra.
assert.match(ctr({ onboarding: '2026-08-20', envioCliente: '2026-08-21' }).texto, /^assinatura · /)
assert.equal(ctr({}).cor, 'vermelho', 'sem onboarding a assinatura ja conta como atrasada')
// 25/09 e sexta: ate 29/09 sao 2 dias uteis, nao 4. O envio fica amarelo e a
// assinatura verde, entao a etapa sai amarela.
assert.equal(ctr({ onboarding: '2026-09-25' }).cor, 'amarelo', 'fim de semana nao conta')
// Cumprido e verde: cinza so quando falta dado ou falta regra.
assert.equal(
  ctr({ onboarding: '2026-01-05', dataAssinatura: '2026-01-08', formatoContrato: 'MC (Cliente x PSA x Palestrante)' }).cor,
  'verde',
  'assinado fecha os dois relogios da etapa, e cumprido e verde',
)
assert.match(
  ctr({ onboarding: '2026-01-05', dataAssinatura: '2026-01-08', formatoContrato: 'MC (Cliente x PSA x Palestrante)' }).texto,
  /^assinatura · assinado/,
)
// O prazo do palestrante tambem sai do onboarding: 05/01 + 25 = 30/01, que ja
// venceu. O cliente assinou, o palestrante nao — e isso e vermelho, nao cinza.
assert.equal(
  ctr({ onboarding: '2026-01-05', dataAssinatura: '2026-01-08', formatoContrato: 'MC (Cliente x PSA) = 100% PSA', palestranteExclusivo: 'Não' }).cor,
  'vermelho',
  'palestrante nao assinou e os 25 dias venceram',
)

// ---- 25 dias do onboarding para o palestrante assinar ----
// Mesmo marco do contrato do cliente, numero unico: o do cliente varia por
// Formato da Empresa, o do palestrante nao.
const palestrante100 = { formatoContrato: 'MC (Cliente x PSA) = 100% PSA', palestranteExclusivo: 'Não' }
const assinaPal = (over) => R['palestrante-assinatura']({ ...palestrante100, ...over })
// HOJE = 29/09. 10/09 + 25 = 05/10, faltam 6 dias: fora da reta final.
assert.equal(assinaPal({ onboarding: '2026-09-10' }).estado, 'verde')
assert.equal(assinaPal({ onboarding: '2026-09-10' }).prazo, '2026-10-05')
// 04/09 + 25 = 29/09, vence hoje: amarelo, igual ao contrato do cliente.
assert.equal(assinaPal({ onboarding: '2026-09-04' }).estado, 'amarelo')
// 01/09 + 25 = 26/09, tres dias depois. Sem faixa de atencao: ja e vermelho.
assert.equal(assinaPal({ onboarding: '2026-09-01' }).estado, 'vermelho')
// Sem onboarding o prazo nem comeca a correr, e isso conta como atraso.
assert.equal(assinaPal({}).estado, 'vermelho')
// Assinado mede contra o prazo calculado, nao contra a propriedade.
assert.equal(assinaPal({ onboarding: '2026-09-01', dataAssinaturaPalestrante: '2026-09-20' }).cumpriu, true)
assert.equal(assinaPal({ onboarding: '2026-09-01', dataAssinaturaPalestrante: '2026-09-30' }).cumpriu, false)
// Formato que nao exige minuta do palestrante segue fora de qualquer prazo.
assert.equal(R['palestrante-assinatura']({ formatoContrato: 'MC (Cliente x PSA x Palestrante)' }).estado, 'nao-aplica')
assert.equal(
  R['palestrante-assinatura']({ formatoContrato: 'MC (Cliente x PSA) = 100% PSA', palestranteExclusivo: 'Sim' }).estado,
  'nao-aplica',
)

console.log('ok — 25 dias do onboarding para o palestrante')

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

// Empate de cor entre envio e assinatura: manda quem trava primeiro. Os dois
// tem marco proprio — data de envio ao cliente e data de assinatura — entao
// contrato sem registro de envio e cobrado como envio, e so depois que a data
// de envio aparece a assinatura assume o card.
const empate = { stage: CTR, evento: '2026-11-20', onboarding: '2026-08-01', prazoAssinatura: '2026-08-20' }
assert.match(E(empate).texto, /^envio · /, 'nao enviado: o envio trava a assinatura')
assert.match(
  E({ ...empate, envioCliente: '2026-08-02' }).texto,
  /^assinatura · /,
  'enviado e nao assinado: cobra a assinatura, que antes ficava escondida atras do envio',
)

console.log('ok — empate cobra quem trava primeiro')

// Faturamento entrou no CS em 02/10/2026 com a regra de 3 dias apos a
// assinatura. Sem assinatura nao ha de onde contar: cinza, nao verde.
const FAT = '1450683393'
const fat = (over) => E({ stage: FAT, evento: '2026-11-20', ...over })
assert.equal(fat({}).cor, 'cinza', 'contrato nao assinado nao inicia o relogio')
assert.equal(fat({ dataAssinatura: '2026-09-28' }).cor, 'verde', '1 dia')
assert.equal(fat({ dataAssinatura: '2026-09-26' }).cor, 'verde', '3 dias')
assert.equal(fat({ dataAssinatura: '2026-09-24' }).cor, 'amarelo', '5 dias')
assert.equal(fat({ dataAssinatura: '2026-09-20' }).cor, 'vermelho', '9 dias')
assert.equal(
  fat({ dataAssinatura: '2026-09-20', dataFaturamento: '2026-09-22' }).cor,
  'verde',
  'despachado ao financeiro fecha o relogio, e cumprido e verde',
)
assert.match(fat({ dataAssinatura: '2026-09-20' }).texto, /^emissão · /)

console.log('ok — faturamento no CS')

// ---- minuta do palestrante ----
// O formato de contrato diz quais minutas correm: 100% PSA roda as duas,
// interveniente roda so a do cliente, cliente x palestrante so a do palestrante.
const PSA100 = 'MC (Cliente x PSA) = 100% PSA'
const INTERV = 'MC (Cliente x PSA x Palestrante)'
const CLIPAL = 'MC (Cliente x Palestrante)'
const pal = (chave, over) => RELOGIOS.find((r) => r.chave === chave).ver(T(over), HOJE)

assert.equal(pal('palestrante-assinatura', { formatoContrato: INTERV }).estado, 'nao-aplica', 'interveniente nao tem minuta propria')
assert.equal(pal('palestrante-assinatura', { formatoContrato: CLIPAL, onboarding: '2026-08-20' }).estado, 'vermelho')
const palOk = pal('palestrante-assinatura', { formatoContrato: PSA100, onboarding: '2026-09-01', dataAssinaturaPalestrante: '2026-09-18' })
assert.equal(palOk.estado, 'concluido')
assert.equal(palOk.cumpriu, true, '18/09 veio antes de 26/09')

// Envio da minuta so sabe dizer se saiu: o gap depois da assinatura do cliente
// nunca foi definido, entao nao ganha cor em vez de ganhar uma inventada.
assert.equal(pal('palestrante-envio', { formatoContrato: PSA100 }).estado, 'bloqueado')
assert.equal(pal('palestrante-envio', { formatoContrato: PSA100, envioPalestrante: '2026-09-10' }).estado, 'concluido')
assert.equal(pal('palestrante-envio', { formatoContrato: INTERV }).estado, 'nao-aplica')

// A data de envio ao cliente agora e marco de verdade, sem depender da assinatura.
assert.equal(pal('contrato-envio', { formatoContrato: PSA100, onboarding: '2026-01-05', envioCliente: '2026-01-06' }).estado, 'concluido')
assert.equal(pal('contrato-envio', { formatoContrato: CLIPAL }).estado, 'nao-aplica')

// Com o contrato do cliente fechado, quem sobra na etapa e a minuta do
// palestrante — 01/09 + 25 = 26/09, vencido.
const soMinuta = {
  stage: CTR, evento: '2026-11-20', formatoContrato: PSA100, palestranteExclusivo: 'Não',
  onboarding: '2026-09-01', envioCliente: '2026-09-02', dataAssinatura: '2026-09-10',
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

// A tabela traz data com nome humano, nao nome de propriedade.
assert.deepEqual(
  datas.map((d) => [d.rotulo, d.valor]),
  [['Negócio ganho', '2026-09-15'], ['Pagamento previsto', '2026-10-05'], ['Prazo de aquisição', '2026-09-20']],
)

// Uma frase por relogio, com a data e a conta de dias.
assert.equal(contas[0].estado, 'vermelho')
assert.equal(contas[0].porque, 'O prazo era 20/09/2026 venceu há 9 dias.')
assert.equal(contas[1].estado, 'verde')
assert.equal(contas[1].porque, 'Pagamento previsto 05/10/2026 ainda não venceu: faltam 6 dias.')

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

// O prazo de assinatura vale so para empresa privada: orgao publico, Sistema S
// e associacao tem rito proprio, e formato em branco nao vira regra por
// suposicao — sao 44 dos 118 da etapa.
for (const f of ['Associação', 'Agência', '']) {
  const v = R['contrato-assinatura']({ formatoEmpresa: f, onboarding: '2026-01-01' })
  assert.equal(v.estado, 'nao-aplica', 'formato sem prazo acordado nao corre o relogio: ' + f)
}
assert.equal(R['contrato-assinatura']({ formatoEmpresa: PRIVADA, onboarding: '2026-01-01' }).estado, 'vermelho')

// Orgao publico tem 45 dias em vez de 20: a mesma data que estoura a privada
// ainda esta no prazo dele.
const PUBLICO = 'Órgão Público'
const SISTEMA_S = 'Sistema S (SEST/SENAT/SEBRAE/SESCOOP)'

// Sistema S fica no meio: 30 dias. O mesmo onboarding que ja estourou a
// privada ainda esta no prazo dele, e o dele estoura antes do orgao publico.
assert.equal(R['contrato-assinatura']({ formatoEmpresa: SISTEMA_S, onboarding: '2026-09-01' }).prazo, '2026-10-01')
assert.equal(R['contrato-assinatura']({ formatoEmpresa: SISTEMA_S, onboarding: '2026-09-05' }).estado, 'verde')
assert.equal(R['contrato-assinatura']({ formatoEmpresa: SISTEMA_S, onboarding: '2026-08-25' }).estado, 'vermelho')
assert.equal(R['contrato-assinatura']({ formatoEmpresa: PUBLICO, onboarding: '2026-08-25' }).estado, 'verde', 'os 45 dias ainda seguram')
assert.equal(R['contrato-assinatura']({ formatoEmpresa: PUBLICO, onboarding: '2026-09-01' }).prazo, '2026-10-16')
assert.equal(R['contrato-assinatura']({ formatoEmpresa: PUBLICO, onboarding: '2026-09-01' }).estado, 'verde')
assert.equal(R['contrato-assinatura']({ formatoEmpresa: PRIVADA, onboarding: '2026-09-01' }).estado, 'vermelho')
assert.equal(R['contrato-assinatura']({ formatoEmpresa: PUBLICO, onboarding: '2026-07-01' }).estado, 'vermelho')
assert.equal(
  R['contrato-assinatura']({ formatoEmpresa: PUBLICO }).estado,
  'vermelho',
  'sem onboarding vale para os dois formatos',
)
assert.match(R['contrato-assinatura']({ formatoEmpresa: '', onboarding: '' }).texto, /em branco/)

// Na etapa, formato sem prazo acordado fica cinza mesmo sem onboarding.
assert.equal(E({ stage: CTR, evento: '2026-11-20', formatoEmpresa: 'Associação' }).cor, 'cinza')
// Orgao publico agora tem prazo, entao sem onboarding ele fica vermelho.
assert.equal(E({ stage: CTR, evento: '2026-11-20', formatoEmpresa: 'Órgão Público' }).cor, 'vermelho')

console.log('ok — prazo de assinatura por formato da empresa')

// Campo em branco para o relogio e cinza no card, mas tem que aparecer no
// dialogo: isento e falta de preenchimento ficam iguais na cor, e so um dos
// dois alguem consegue resolver.
const semFormato = explicar(
  T({ stage: CTR, formatoEmpresa: '', formatoContrato: '', onboarding: '2026-01-01', evento: '2026-11-20' }),
  'Assinar Contrato',
  HOJE,
)
const branco = semFormato.contas.filter((c) => c.faltaDado)
assert.equal(branco.length, 3, 'assinatura do cliente e os dois relogios do palestrante')
assert.match(branco[0].porque, /^Formato da Empresa está em branco/)
assert.match(branco[1].porque, /^Formato de Contrato está em branco/)

// Isento de verdade nao leva a marca: nao ha o que preencher.
const publico = explicar(
  T({ stage: CTR, formatoEmpresa: 'Associação', formatoContrato: 'MC (Cliente x PSA) = 100% PSA', evento: '2026-11-20' }),
  'Assinar Contrato',
  HOJE,
)
const assinatura = publico.contas.find((c) => c.chave === 'contrato-assinatura')
assert.equal(assinatura.estado, 'nao-aplica')
assert.equal(assinatura.faltaDado, false)
assert.match(assinatura.porque, /Associação/)

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
  ['Onboarding', 'Envio ao cliente', 'Prazo de assinatura'],
  'a tabela nao lista data de palestrante num formato que nao tem minuta',
)
assert.deepEqual(
  interv.contas.filter((c) => c.estado !== 'nao-aplica').map((c) => c.chave),
  ['contrato-envio', 'contrato-assinatura'],
  'so os dois relogios do cliente correm',
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
  ['contrato-envio', 'contrato-assinatura'],
  'exclusivo roda so os dois relogios do cliente',
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
const anexado = { formatoContrato: 'MC (Cliente x PSA) = 100% PSA', palestranteExclusivo: 'Não', onboarding: '2026-06-09' }
assert.equal(R['palestrante-assinatura'](anexado).estado, 'vermelho', 'sem anexo e sem data, 09/06 + 25 venceu')
assert.equal(R['palestrante-assinatura']({ ...anexado, anexoPalestrante: '12345' }).estado, 'concluido')
assert.equal(R['palestrante-assinatura']({ ...anexado, anexoPalestrante: '12345' }).texto, 'contrato anexado ao ticket')
// A data continua mandando quando existe: ela diz se cumpriu o prazo, o anexo nao.
assert.equal(
  R['palestrante-assinatura']({ ...anexado, anexoPalestrante: '12345', dataAssinaturaPalestrante: '2026-06-20' }).cumpriu,
  true,
)
// Mesmo tratamento do lado do cliente.
assert.equal(R['contrato-assinatura']({ formatoEmpresa: 'Empresa Privada', onboarding: '2026-06-09' }).estado, 'vermelho')
assert.equal(
  R['contrato-assinatura']({ formatoEmpresa: 'Empresa Privada', onboarding: '2026-06-09', anexoCliente: '9' }).estado,
  'concluido',
)
// E o envio passa a estar provado pelo anexo: nao se anexa o que nao existe.
assert.equal(
  R['contrato-envio']({ formatoEmpresa: 'Empresa Privada', onboarding: '2026-06-09', anexoCliente: '9' }).estado,
  'concluido',
)

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
