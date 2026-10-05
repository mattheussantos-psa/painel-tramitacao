// Os relógios da Tramitação (pipeline 941149608).
//
// A régua do CS é tempo na etapa. Estas regras são outra coisa: medem
// distância até um marco (onboarding, aceite, assinatura, data do evento), e a
// mesma etapa pode ter dois relógios correndo ao mesmo tempo. Por isso vivem
// em arquivo separado — misturar com a régua do CS faria um quadro mentir
// sobre o outro.
//
// Nada aqui é aplicado em produção: serve à simulação sobre dados reais do CS.

import { avaliar, hojeEmDias, type Avaliacao, type Regra, type Ticket } from './sinaleira.ts'

export type Cor = 'verde' | 'amarelo' | 'vermelho'

// 'nao-aplica'  — a regra não vale para este ticket (ex.: log com custo PSA)
// 'nao-iniciado'— a janela do prazo ainda não abriu (ex.: evento a D-60)
// 'sem-dado'    — a regra vale, mas falta o campo que dispara o relógio
// 'concluido'   — o marco aconteceu
// 'bloqueado'   — o relógio não existe: falta campo no HubSpot para medi-lo
export type Estado = Cor | 'nao-aplica' | 'nao-iniciado' | 'sem-dado' | 'concluido' | 'bloqueado'

// O mesmo ticket do painel. Os dois campos de faturamento são opcionais
// porque o CS não tem etapa de Faturamento — só a simulação os usa.
export type TicketSim = Ticket & {
  dataFaturamento?: string
  dataEmissao?: string
}

// Como separar a reunião de briefing das outras associadas ao ticket. Hoje
// nenhuma das 15 reuniões dos 358 tickets abertos tem "briefing" no título: 12
// se chamam "Alinhamento de conteúdo" ou "Reunião de Alinhamento" e 3
// "Onboarding". O "alinhamento" entra aqui porque é o candidato mais provável
// a ser o briefing com outro nome — está perguntado ao CS.
export const ehBriefing = (titulo: string) => /brief|alinhamento/i.test(titulo)

const briefings = (t: TicketSim) => t.reunioes.filter((r) => ehBriefing(r.titulo) && !!r.inicio)

export type Veredito = {
  estado: Estado
  // Dias que importam para a leitura: decorridos, ou que faltam para o evento.
  dias: number | null
  texto: string
  // Quando o marco existe, diz se foi cumprido dentro do prazo. null quando
  // não dá para saber.
  cumpriu: boolean | null
}

const DIA = 86400000
const dia = (d: string | undefined) => Date.parse(String(d ?? '').slice(0, 10) + 'T00:00:00Z')
const tem = (d: string | undefined) => !!d && Number.isFinite(dia(d))
const emDias = (a: number, b: number) => Math.round((a - b) / DIA)

// Dias úteis entre duas datas, só seg-sex. Feriado nacional não entra: exigiria
// calendário mantido à mão, e a pergunta está aberta com o CS.
export function diasUteis(de: string | undefined, ate: number) {
  let n = 0
  for (let t = dia(de) + DIA; t <= ate; t += DIA) {
    const d = new Date(t).getUTCDay()
    if (d !== 0 && d !== 6) n++
  }
  return n
}

const faixa = (d: number, verde: number, amarelo: number): Cor =>
  d <= verde ? 'verde' : d <= amarelo ? 'amarelo' : 'vermelho'

// 'fechado'   — tem gatilho e marco: a cor mede atraso de verdade.
// 'hipotese'  — tem gatilho, não tem marco: o relógio nunca para, então
//               ticket antigo aparece vencido mesmo tendo sido resolvido. O
//               vermelho aqui mede ausência de registro, não atraso.
// 'bloqueado' — falta até o gatilho: não há relógio.
export type Confianca = 'fechado' | 'hipotese' | 'bloqueado'

export type Relogio = {
  chave: string
  // Rótulos de etapa que este relógio serve. É lista porque o mesmo passo tem
  // nome diferente nos dois pipelines — "Contratar Logística" no CS e
  // "Logística" na Tramitação — e porque o CS renomeia etapa com frequência.
  etapa: string[]
  nome: string
  // Nome curto para o card. "aceite da logística · 45d desde o onboarding"
  // não cabe em coluna de 300px e vazava para fora do cartão.
  curto: string
  regra: string
  confianca: Confianca
  gatilho: string
  marco: string
  // Decisão ainda pendente com o CS que afeta este relógio.
  pendencia?: string
  ver: (t: TicketSim, hoje: number) => Veredito
}

const LOG_REEMBOLSO = 'Sim, com reembolso do cliente'
const LOG_CUSTO_PSA = 'Sim, com custo para PSA'

// Prazo que é uma data no proprio ticket. Mesma faixa que o CS definiu para a
// assinatura de contrato: verde ate a data, amarelo 1 a 3 dias depois,
// vermelho do quarto em diante. Sem a data nao da para cobrar — cinza, nunca
// verde por omissao.
function contraPrazo(prazo: string, hoje: number, semDado: string): Veredito {
  if (!tem(prazo)) return { estado: 'sem-dado', dias: null, texto: semDado, cumpriu: null }
  const d = emDias(hojeEmDias(hoje), dia(prazo))
  return {
    estado: d <= 0 ? 'verde' : faixa(d, 0, 3),
    dias: d,
    texto: d <= 0 ? `faltam ${-d}d para o prazo` : `${d}d depois do prazo`,
    cumpriu: null,
  }
}

// Qual minuta corre em cada formato de contrato, conforme o CS:
//   100% PSA ................. cliente e palestrante
//   Cliente x PSA x Palestrante .. só cliente (palestrante é interveniente)
//   Cliente x Palestrante ........ só palestrante (a PSA não é parte)
// Formato fora dessa lista mantém o relógio do cliente, que é como já estava:
// mudar sem regra seria inventar.
const SO_PALESTRANTE = ['MC (Cliente x Palestrante)']
const COM_PALESTRANTE = ['MC (Cliente x PSA) = 100% PSA', 'MC (Cliente x Palestrante)']

const usaCliente = (formato: string) => !SO_PALESTRANTE.includes(formato)
const usaPalestrante = (formato: string) => COM_PALESTRANTE.includes(formato)

const foraDoFormato = (texto: string): Veredito => ({
  estado: 'nao-aplica',
  dias: null,
  texto,
  cumpriu: null,
})

// Assinatura do cliente serve de prova indireta de envio: não dá para assinar
// um contrato que não foi enviado.
const contratoAssinado = (t: TicketSim) => t.statusContrato === 'Assinado' || tem(t.dataAssinatura)

export const RELOGIOS: Relogio[] = [
  {
    chave: 'log-aquisicao',
    etapa: ['Contratar Logística', 'Logística'],
    nome: 'Aquisição da logística',
    curto: 'aquisição',
    regra: 'Até a data em "Prazo de aquisição da Logística" · amarelo 1 a 3 dias depois · vermelho 4+',
    confianca: 'hipotese',
    gatilho: 'adquirir_logistica',
    marco: '— sair da etapa é o único sinal de que foi adquirida',
    pendencia: 'Faixa de cor não foi acordada: aplica a mesma da assinatura de contrato, que o CS definiu para prazo em data.',
    ver: (t, hoje) => {
      if (t.logistica !== LOG_REEMBOLSO && t.logistica !== LOG_CUSTO_PSA)
        return { estado: 'nao-aplica', dias: null, texto: t.logistica || 'sem resposta', cumpriu: null }
      return contraPrazo(t.prazoLogistica, hoje, 'sem prazo de aquisição')
    },
  },
  {
    chave: 'log-pagamento',
    etapa: ['Contratar Logística', 'Logística'],
    nome: 'Pagamento da logística',
    curto: 'pagamento',
    regra: 'Até a data em "Data prevista de pagamento Logística" · amarelo 1 a 3 dias depois · vermelho 4+',
    confianca: 'hipotese',
    gatilho: 'data_prevista_de_pagamento_logistica',
    marco: '— sair da etapa é o único sinal de que foi pago',
    pendencia: 'Só vale para logística com reembolso do cliente, conforme a regra do CS.',
    ver: (t, hoje) => {
      if (t.logistica !== LOG_REEMBOLSO)
        return { estado: 'nao-aplica', dias: null, texto: t.logistica || 'sem resposta', cumpriu: null }
      return contraPrazo(t.pagamentoLogistica, hoje, 'sem data prevista de pagamento')
    },
  },
  {
    chave: 'contrato-envio',
    etapa: ['Assinar Contrato', 'Contrato'],
    nome: 'Envio do contrato ao cliente',
    curto: 'envio',
    regra: '1 dia útil após o onboarding · amarelo 2 a 3 dias · vermelho 4+',
    confianca: 'fechado',
    gatilho: 'data_de_realizacao_do_onboarding',
    marco: 'data_de_envio_contrato_cliente',
    ver: (t, hoje) => {
      if (!usaCliente(t.formatoContrato)) return foraDoFormato('contrato é entre cliente e palestrante')
      if (tem(t.envioCliente)) return { estado: 'concluido', dias: null, texto: 'contrato enviado', cumpriu: null }
      if (contratoAssinado(t))
        return { estado: 'concluido', dias: null, texto: 'assinado, logo foi enviado', cumpriu: null }
      if (!tem(t.onboarding))
        return { estado: 'sem-dado', dias: null, texto: 'sem data de onboarding', cumpriu: null }
      const d = diasUteis(t.onboarding, hojeEmDias(hoje))
      return { estado: faixa(d, 1, 3), dias: d, texto: `${d} dias úteis desde o onboarding`, cumpriu: null }
    },
  },
  {
    chave: 'contrato-assinatura',
    etapa: ['Assinar Contrato', 'Contrato'],
    nome: 'Assinatura do contrato pelo cliente',
    curto: 'assinatura',
    regra: 'Até a data em "Prazo de Assinatura" · amarelo 1 a 3 dias depois · vermelho 4+',
    confianca: 'fechado',
    gatilho: 'assinar_contrato',
    marco: 'data_de_assinatura_do_contrato / status_do_contrato',
    ver: (t, hoje) => {
      if (!usaCliente(t.formatoContrato)) return foraDoFormato('contrato é entre cliente e palestrante')
      if (!tem(t.prazoAssinatura))
        return { estado: 'sem-dado', dias: null, texto: 'sem prazo de assinatura', cumpriu: null }

      // Único relógio com as duas pontas: dá para dizer se cumpriu de verdade.
      if (tem(t.dataAssinatura)) {
        const atraso = emDias(dia(t.dataAssinatura), dia(t.prazoAssinatura))
        return {
          estado: 'concluido',
          dias: atraso,
          texto: atraso <= 0 ? `assinado ${-atraso}d antes do prazo` : `assinado ${atraso}d depois do prazo`,
          cumpriu: atraso <= 0,
        }
      }
      if (t.statusContrato === 'Assinado')
        return { estado: 'concluido', dias: null, texto: 'assinado, sem data registrada', cumpriu: null }

      const d = emDias(hojeEmDias(hoje), dia(t.prazoAssinatura))
      return {
        estado: d <= 0 ? 'verde' : faixa(d, 0, 3),
        dias: d,
        texto: d <= 0 ? `faltam ${-d}d para o prazo` : `${d}d depois do prazo`,
        cumpriu: null,
      }
    },
  },
  {
    chave: 'palestrante-envio',
    etapa: ['Assinar Contrato', 'Contrato'],
    nome: 'Envio da minuta ao palestrante',
    curto: 'minuta',
    regra: 'Após a assinatura do cliente — gap ainda não definido pelo CS',
    confianca: 'bloqueado',
    gatilho: '— falta o gap acordado',
    marco: 'data_de_envio_contrato_palestrante',
    pendencia: 'O CS escreveu "após a assinatura de contrato com o cliente (definir gap)" e o número nunca veio. Sem ele a minuta não ganha cor: só diz se saiu.',
    ver: (t) => {
      if (!usaPalestrante(t.formatoContrato)) return foraDoFormato(t.formatoContrato || 'sem formato')
      if (tem(t.envioPalestrante)) return { estado: 'concluido', dias: null, texto: 'minuta enviada', cumpriu: null }
      return { estado: 'bloqueado', dias: null, texto: 'falta o prazo de envio da minuta', cumpriu: null }
    },
  },
  {
    chave: 'palestrante-assinatura',
    etapa: ['Assinar Contrato', 'Contrato'],
    nome: 'Assinatura do palestrante',
    curto: 'assinatura do palestrante',
    regra: 'Até a data em "Prazo de Assinatura Contrato Palestrante" · amarelo 1 a 3 dias depois · vermelho 4+',
    confianca: 'fechado',
    gatilho: 'prazo_de_assinatura__contrato_palestrante',
    marco: 'data_de_assinatura__palestrante_',
    pendencia: 'Faixa de cor não foi passada para o palestrante: aplica a mesma do contrato do cliente.',
    ver: (t, hoje) => {
      if (!usaPalestrante(t.formatoContrato)) return foraDoFormato(t.formatoContrato || 'sem formato')
      if (tem(t.dataAssinaturaPalestrante)) {
        if (!tem(t.prazoAssinaturaPalestrante))
          return { estado: 'concluido', dias: null, texto: 'assinado pelo palestrante', cumpriu: null }
        const atraso = emDias(dia(t.dataAssinaturaPalestrante), dia(t.prazoAssinaturaPalestrante))
        return {
          estado: 'concluido',
          dias: atraso,
          texto: atraso <= 0 ? `assinado ${-atraso}d antes do prazo` : `assinado ${atraso}d depois do prazo`,
          cumpriu: atraso <= 0,
        }
      }
      return contraPrazo(t.prazoAssinaturaPalestrante, hoje, 'sem prazo de assinatura do palestrante')
    },
  },
  {
    chave: 'faturamento',
    etapa: ['Faturar', 'Faturamento'],
    nome: 'Emissão do faturamento',
    curto: 'emissão',
    regra: 'Até 3 dias após a assinatura · amarelo 4 a 5 · vermelho 6+',
    confianca: 'hipotese',
    gatilho: 'data_de_assinatura_do_contrato',
    marco: 'data_de_emissao e data_emissao_nf existem e estão zeradas — uso "Enviado ao Faturamento" como proxy',
    pendencia: 'Falta definir o campo oficial de emissão, e se Órgão Público suspende o vermelho ou só ganha a tag.',
    ver: (t, hoje) => {
      if (!tem(t.dataAssinatura))
        return { estado: 'sem-dado', dias: null, texto: 'contrato ainda não assinado', cumpriu: null }
      if (tem(t.dataEmissao))
        return { estado: 'concluido', dias: emDias(dia(t.dataEmissao), dia(t.dataAssinatura)), texto: 'emitido', cumpriu: null }
      if (tem(t.dataFaturamento)) {
        const d = emDias(dia(t.dataFaturamento), dia(t.dataAssinatura))
        return { estado: 'concluido', dias: d, texto: `despachado ao financeiro em ${d}d`, cumpriu: d <= 3 }
      }
      const d = emDias(hojeEmDias(hoje), dia(t.dataAssinatura))
      return { estado: faixa(d, 3, 5), dias: d, texto: `${d}d desde a assinatura`, cumpriu: null }
    },
  },
  {
    chave: 'briefing-agendamento',
    etapa: ['Realizar Briefing', 'Briefing'],
    nome: 'Agendamento do briefing',
    curto: 'agendamento',
    regra: 'Verde D-30 a D-25 · amarelo D-24 a D-15 · vermelho D-14 em diante',
    confianca: 'hipotese',
    gatilho: 'data_do_evento__ganho_',
    marco: 'reunião de briefing associada ao ticket (ou os campos de data, como legado)',
    pendencia: 'As reuniões passarão a ser marcadas pelo ticket. Hoje são 13 reuniões em 358 tickets, nenhuma com "briefing" no título — falta combinar como reconhecê-la.',
    ver: (t, hoje) => {
      if (!tem(t.evento))
        return { estado: 'sem-dado', dias: null, texto: 'sem data de evento', cumpriu: null }
      const marcadas = briefings(t)
      if (marcadas.length)
        return { estado: 'concluido', dias: null, texto: `reunião marcada (${marcadas[0].titulo.slice(0, 40)})`, cumpriu: null }
      if (tem(t.prazoBriefing) || tem(t.callBriefing))
        return { estado: 'concluido', dias: null, texto: 'briefing agendado por campo de data', cumpriu: null }
      const D = emDias(dia(t.evento), hojeEmDias(hoje))
      if (D < 0) return { estado: 'nao-aplica', dias: D, texto: 'evento já realizado', cumpriu: null }
      if (D > 30) return { estado: 'nao-iniciado', dias: D, texto: `evento a D-${D}`, cumpriu: null }
      return { estado: D >= 25 ? 'verde' : D >= 15 ? 'amarelo' : 'vermelho', dias: D, texto: `evento a D-${D}`, cumpriu: null }
    },
  },
  {
    chave: 'briefing-realizacao',
    etapa: ['Realizar Briefing', 'Briefing'],
    nome: 'Realização do briefing',
    curto: 'realização',
    regra: 'Verde D-15 a D-11 · amarelo D-10 a D-8 · vermelho D-7 em diante',
    confianca: 'hipotese',
    gatilho: 'data_do_evento__ganho_',
    marco: 'reunião de briefing já realizada (ou o campo de data, como legado)',
    pendencia: 'Borda indefinida: D-10 aparece em verde e em amarelo na regra, D-7 em amarelo e em vermelho. Aqui a borda cai sempre na cor pior.',
    ver: (t, hoje) => {
      if (!tem(t.evento))
        return { estado: 'sem-dado', dias: null, texto: 'sem data de evento', cumpriu: null }
      const agora = hojeEmDias(hoje)
      // Realizada é a reunião que já passou, ou a que o HubSpot marcou como
      // concluída. Reunião futura conta como agendada, não como realizada.
      const feita = briefings(t).find((r) => dia(r.inicio) <= agora || r.desfecho === 'COMPLETED')
      if (feita) return { estado: 'concluido', dias: null, texto: 'reunião realizada', cumpriu: null }
      if (tem(t.callBriefing) && dia(t.callBriefing) <= agora)
        return { estado: 'concluido', dias: null, texto: 'briefing realizado (campo de data)', cumpriu: null }
      const D = emDias(dia(t.evento), agora)
      if (D < 0) return { estado: 'nao-aplica', dias: D, texto: 'evento já realizado', cumpriu: null }
      if (D > 15) return { estado: 'nao-iniciado', dias: D, texto: `evento a D-${D}`, cumpriu: null }
      return { estado: D >= 11 ? 'verde' : D >= 8 ? 'amarelo' : 'vermelho', dias: D, texto: `evento a D-${D}`, cumpriu: null }
    },
  },
]

export const ORGAO_PUBLICO = 'Órgão Público'

// Formatos em que a PSA contrata o palestrante por minuta própria. Com
// interveniente (Cliente x PSA x Palestrante) a minuta individual cai.
export const EXIGE_MINUTA_PALESTRANTE = (formato: string) =>
  /100% PSA/.test(formato) && !/x Palestrante/.test(formato)

const PESO: Record<string, number> = { vermelho: 3, amarelo: 2, verde: 1 }

// Uma etapa pode ter dois relógios correndo, e o card tem uma cor só: manda o
// pior. O texto diz qual deles, senão o número não significa nada.
// Relógio bloqueado não vira verde por omissão — devolve null, que o painel
// pinta de cinza.
export function corDaEtapa(t: TicketSim, etapa: string, hoje: number) {
  let cor: Cor | null = null
  let texto = ''
  let fechado = false
  for (const rel of RELOGIOS) {
    if (!rel.etapa.includes(etapa)) continue
    const v = rel.ver(t, hoje)
    if (!PESO[v.estado]) continue
    // Empate de cor: ganha o relógio que tem marco de conclusão. Com os dois
    // vermelhos o card dizia "envio do contrato", que é o relógio incapaz de
    // saber se foi enviado — enquanto "assinatura · 9d depois do prazo" é fato.
    const melhor =
      !cor ||
      PESO[v.estado] > PESO[cor] ||
      (PESO[v.estado] === PESO[cor] && rel.confianca === 'fechado' && !fechado)
    if (melhor) {
      cor = v.estado as Cor
      fechado = rel.confianca === 'fechado'
      texto = `${rel.curto} · ${v.texto}`
    }
  }
  return cor ? { cor, texto } : null
}

// Porta única de avaliação do painel: etapa com prazo em dias segue pela régua
// do CS, etapa com relógio passa pelos marcos da Tramitação. A régua pré/pós e
// o tempo parado vêm de avaliar() nos dois casos, para não haver duas contas
// do mesmo número.
export function avaliarEtapa(
  t: TicketSim,
  hoje: number,
  sla: Record<string, Regra>,
): Avaliacao {
  const base = avaliar(t, hoje, sla)
  const regra = sla[t.stage]
  if (regra?.tipo !== 'relogio') return base

  const s = corDaEtapa(t, regra.label, hoje)
  if (s) return { ...base, cor: s.cor, texto: s.texto }
  return { ...base, texto: 'sem prazo nesta etapa' }
}

// Da propriedade do HubSpot para o campo do ticket, só para o diálogo poder
// mostrar o valor que o relógio leu. O que não estiver aqui — "sair da etapa
// é o único sinal", por exemplo — aparece sem valor, que é a verdade.
const CAMPO: Record<string, keyof TicketSim> = {
  adquirir_logistica: 'prazoLogistica',
  data_prevista_de_pagamento_logistica: 'pagamentoLogistica',
  data_de_realizacao_do_onboarding: 'onboarding',
  assinar_contrato: 'prazoAssinatura',
  data_de_assinatura_do_contrato: 'dataAssinatura',
  data_de_envio_contrato_cliente: 'envioCliente',
  data_de_envio_contrato_palestrante: 'envioPalestrante',
  prazo_de_assinatura__contrato_palestrante: 'prazoAssinaturaPalestrante',
  data_de_assinatura__palestrante_: 'dataAssinaturaPalestrante',
  data_do_evento__ganho_: 'evento',
}

const valor = (t: TicketSim, prop: string) => {
  const campo = CAMPO[prop]
  if (!campo) return ''
  const v = t[campo]
  return typeof v === 'string' ? v : ''
}

export type Conta = {
  chave: string
  nome: string
  regra: string
  estado: Estado
  texto: string
  campos: { papel: string; prop: string; valor: string }[]
  // Prazo preenchido antes de o ticket entrar na etapa. Na migracao do
  // pipeline em 02/10/2026 isso aconteceu em 30 dos 42 tickets com data da
  // coluna de logistica: o prazo veio junto de outro momento do processo e o
  // card nasce vermelho sem ninguem ter atrasado nada.
  prazoAnteriorAEntrada?: boolean
}

// Abre a conta de um ticket: cada relógio da etapa, o que ele leu e no que deu.
// Sai da mesma régua que pinta o card — não é um texto paralelo que desatualiza.
export function explicar(t: TicketSim, etapa: string, hoje: number): Conta[] {
  const entrou = dia(t.entrouEtapa)
  return RELOGIOS.filter((rel) => rel.etapa.includes(etapa)).map((rel) => {
    const v = rel.ver(t, hoje)
    const campos = [
      { papel: 'Dispara em', prop: rel.gatilho, valor: valor(t, rel.gatilho) },
      { papel: 'Fecha em', prop: rel.marco, valor: valor(t, rel.marco) },
    ]
    const gatilho = dia(valor(t, rel.gatilho))
    return {
      chave: rel.chave,
      nome: rel.nome,
      regra: rel.regra,
      estado: v.estado,
      texto: v.texto,
      campos,
      prazoAnteriorAEntrada:
        Number.isFinite(gatilho) && Number.isFinite(entrou) && gatilho < entrou,
    }
  })
}
