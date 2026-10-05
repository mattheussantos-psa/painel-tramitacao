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
  QUADROS,
} from './lib/sinaleira.ts'
import { RELOGIOS, avaliarEtapa, diasUteis, explicar, EXIGE_MINUTA_PALESTRANTE } from './lib/relogios.ts'

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
assert.equal(Object.keys(SLA).length, 9)

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
  evento: '', logistica: '', tipoEmpresa: '', formatoContrato: '',
  onboarding: '', prazoAssinatura: '', dataAssinatura: '', statusContrato: '',
  dataFaturamento: '', dataEmissao: '', prazoBriefing: '', callBriefing: '',
  reunioes: [], ...over,
})
const R = Object.fromEntries(RELOGIOS.map((r) => [r.chave, (t) => r.ver(T(t), HOJE)]))
const REEMBOLSO = 'Sim, com reembolso do cliente'
const CUSTO_PSA = 'Sim, com custo para PSA'

// Dias uteis: de sexta 25/09 ate terca 29/09 sao 2 uteis, nao 4.
assert.equal(diasUteis('2026-09-25', Date.parse('2026-09-29T00:00:00Z')), 2)
assert.equal(diasUteis('2026-09-28', Date.parse('2026-09-29T00:00:00Z')), 1)

// Aquisicao vale para quem a PSA organiza, com custo dela ou com reembolso.
assert.equal(R['log-aquisicao']({ logistica: 'Evento Online' }).estado, 'nao-aplica')
assert.equal(R['log-aquisicao']({ logistica: 'Não' }).estado, 'nao-aplica')
assert.equal(R['log-aquisicao']({ logistica: CUSTO_PSA }).estado, 'sem-dado', 'sem a data nao da para cobrar')
assert.equal(R['log-aquisicao']({ logistica: CUSTO_PSA, prazoLogistica: '2026-10-05' }).estado, 'verde')
assert.equal(R['log-aquisicao']({ logistica: REEMBOLSO, prazoLogistica: '2026-09-27' }).estado, 'amarelo')
assert.equal(R['log-aquisicao']({ logistica: REEMBOLSO, prazoLogistica: '2026-09-20' }).estado, 'vermelho')

// Pagamento so corre quando o cliente reembolsa: com custo para a PSA nao ha
// pagamento a cobrar do cliente.
assert.equal(R['log-pagamento']({ logistica: CUSTO_PSA, pagamentoLogistica: '2026-09-20' }).estado, 'nao-aplica')
assert.equal(R['log-pagamento']({ logistica: REEMBOLSO }).estado, 'sem-dado')
assert.equal(R['log-pagamento']({ logistica: REEMBOLSO, pagamentoLogistica: '2026-10-05' }).estado, 'verde')
assert.equal(R['log-pagamento']({ logistica: REEMBOLSO, pagamentoLogistica: '2026-09-20' }).estado, 'vermelho')

// Assinatura e o unico relogio com as duas pontas: da pra dizer se cumpriu.
const noPrazo = R['contrato-assinatura']({ prazoAssinatura: '2026-09-20', dataAssinatura: '2026-09-18' })
assert.equal(noPrazo.cumpriu, true)
const atrasado = R['contrato-assinatura']({ prazoAssinatura: '2026-09-20', dataAssinatura: '2026-09-24' })
assert.equal(atrasado.cumpriu, false)
assert.equal(atrasado.dias, 4)
assert.equal(R['contrato-assinatura']({ prazoAssinatura: '2026-10-05' }).estado, 'verde')
assert.equal(R['contrato-assinatura']({ prazoAssinatura: '2026-09-27' }).estado, 'amarelo')
assert.equal(R['contrato-assinatura']({ prazoAssinatura: '2026-09-20' }).estado, 'vermelho')

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
assert.equal(log({ prazoLogistica: '2026-10-05', pagamentoLogistica: '2026-10-05' }).cor, 'verde')
assert.equal(log({ prazoLogistica: '2026-10-05', pagamentoLogistica: '2026-09-20' }).cor, 'vermelho', 'pagamento vencido puxa a etapa')
assert.match(log({ prazoLogistica: '2026-10-05', pagamentoLogistica: '2026-09-20' }).texto, /^pagamento · /)
assert.equal(log({ prazoLogistica: '2026-09-20', pagamentoLogistica: '2026-10-05' }).cor, 'vermelho', 'aquisicao vencida tambem')
// Com custo para a PSA so corre a aquisicao.
assert.equal(log({ logistica: CUSTO_PSA, prazoLogistica: '2026-09-20', pagamentoLogistica: '2026-09-20' }).cor, 'vermelho')
assert.match(log({ logistica: CUSTO_PSA, prazoLogistica: '2026-09-20', pagamentoLogistica: '2026-09-20' }).texto, /^aquisição · /)
// Log externa e evento online seguem fora de qualquer prazo.
assert.equal(log({ logistica: 'Não', prazoLogistica: '2026-09-20' }).cor, 'cinza')
assert.equal(log({ logistica: 'Evento Online', prazoLogistica: '2026-09-20' }).cor, 'cinza')
// Sem as datas preenchidas o card nao vira verde por omissao.
assert.equal(log({}).cor, 'cinza', 'sem prazo e sem pagamento')

// Contrato: envio em 1 dia util e assinatura contra a data do prazo, pior manda.
const ctr = (over) => E({ stage: CTR, evento: '2026-11-20', ...over })
assert.equal(ctr({ onboarding: '2026-09-28', prazoAssinatura: '2026-10-10' }).cor, 'verde')
assert.equal(ctr({ onboarding: '2026-09-28', prazoAssinatura: '2026-09-20' }).cor, 'vermelho', 'assinatura vencida puxa a etapa')
assert.match(ctr({ onboarding: '2026-09-28', prazoAssinatura: '2026-09-20' }).texto, /assinatura/)
// 25/09 e sexta: ate 29/09 sao 2 dias uteis, nao 4.
assert.equal(ctr({ onboarding: '2026-09-25', prazoAssinatura: '2026-10-10' }).cor, 'amarelo', 'fim de semana nao conta')
assert.equal(
  ctr({ onboarding: '2026-01-05', prazoAssinatura: '2026-01-10', dataAssinatura: '2026-01-08' }).cor,
  'cinza',
  'assinado fecha os dois relogios da etapa',
)

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
  'cinza',
  'sem a PSA no contrato nao ha prazo de envio nem de assinatura do cliente',
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
  'cinza',
  'despachado ao financeiro fecha o relogio',
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
assert.equal(pal('palestrante-assinatura', { formatoContrato: PSA100 }).estado, 'sem-dado', 'sem prazo preenchido')
assert.equal(pal('palestrante-assinatura', { formatoContrato: PSA100, prazoAssinaturaPalestrante: '2026-10-05' }).estado, 'verde')
assert.equal(pal('palestrante-assinatura', { formatoContrato: CLIPAL, prazoAssinaturaPalestrante: '2026-09-20' }).estado, 'vermelho')
const palOk = pal('palestrante-assinatura', { formatoContrato: PSA100, prazoAssinaturaPalestrante: '2026-09-20', dataAssinaturaPalestrante: '2026-09-18' })
assert.equal(palOk.estado, 'concluido')
assert.equal(palOk.cumpriu, true)

// Envio da minuta so sabe dizer se saiu: o gap depois da assinatura do cliente
// nunca foi definido, entao nao ganha cor em vez de ganhar uma inventada.
assert.equal(pal('palestrante-envio', { formatoContrato: PSA100 }).estado, 'bloqueado')
assert.equal(pal('palestrante-envio', { formatoContrato: PSA100, envioPalestrante: '2026-09-10' }).estado, 'concluido')
assert.equal(pal('palestrante-envio', { formatoContrato: INTERV }).estado, 'nao-aplica')

// A data de envio ao cliente agora e marco de verdade, sem depender da assinatura.
assert.equal(pal('contrato-envio', { formatoContrato: PSA100, onboarding: '2026-01-05', envioCliente: '2026-01-06' }).estado, 'concluido')
assert.equal(pal('contrato-envio', { formatoContrato: CLIPAL }).estado, 'nao-aplica')

// Na etapa, a minuta vencida puxa a cor mesmo com o contrato do cliente em dia.
assert.equal(
  E({ stage: CTR, evento: '2026-11-20', formatoContrato: PSA100, onboarding: '2026-09-28',
      prazoAssinatura: '2026-10-20', envioCliente: '2026-09-29', prazoAssinaturaPalestrante: '2026-09-20' }).cor,
  'vermelho',
)

console.log('ok — minuta do palestrante')

// ---- a conta que o card abre ----
// A explicacao sai da mesma regua que pinta o card: se divergirem, o farmer
// cobra uma coisa e o quadro mostra outra.
const conta = explicar(
  T({ stage: LOG, logistica: REEMBOLSO, prazoLogistica: '2026-09-20', pagamentoLogistica: '2026-10-05', entrouEtapa: '2026-10-02' }),
  'Contratar Logística',
  HOJE,
)
assert.equal(conta.length, 2, 'a etapa de logistica tem dois relogios')
assert.equal(conta[0].estado, 'vermelho')
assert.deepEqual(
  conta[0].campos.map((c) => [c.prop, c.valor]),
  [['adquirir_logistica', '2026-09-20'], ['— sair da etapa é o único sinal de que foi adquirida', '']],
  'mostra a propriedade lida e o valor que ela tinha',
)
assert.equal(conta[1].estado, 'verde', 'pagamento ainda no prazo')

// O aviso que separa dado herdado de atraso real: prazo anterior a entrada.
assert.equal(conta[0].prazoAnteriorAEntrada, true, 'prazo 20/09 contra entrada 02/10')
const noCiclo = explicar(
  T({ stage: LOG, logistica: REEMBOLSO, prazoLogistica: '2026-10-20', entrouEtapa: '2026-10-02' }),
  'Contratar Logística',
  HOJE,
)
assert.equal(noCiclo[0].prazoAnteriorAEntrada, false, 'prazo do proprio ciclo nao leva aviso')

// A cor da conta e a mesma do card, sempre.
const t2 = T({ stage: LOG, logistica: REEMBOLSO, prazoLogistica: '2026-09-20', entrouEtapa: '2026-10-02', evento: '2026-11-20' })
assert.equal(avaliarEtapa(t2, HOJE, QUADROS.cs.sla).cor, 'vermelho')
assert.ok(explicar(t2, 'Contratar Logística', HOJE).some((c) => c.estado === 'vermelho'))

console.log('ok — conta do card bate com a cor do card')
