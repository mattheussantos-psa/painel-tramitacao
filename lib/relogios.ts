// Os relógios da Tramitação (pipeline 941149608).
//
// A régua do CS é tempo na etapa. Estas regras são outra coisa: medem
// distância até um marco (onboarding, aceite, assinatura, data do evento), e a
// mesma etapa pode ter dois relógios correndo ao mesmo tempo. Por isso vivem
// em arquivo separado — misturar com a régua do CS faria um quadro mentir
// sobre o outro.
//
// Nada aqui é aplicado em produção: serve à simulação sobre dados reais do CS.

import {
  AMARELO_ANTES,
  type Alerta,
  avaliar,
  hojeEmDias,
  type Avaliacao,
  type Regra,
  type Ticket,
} from './sinaleira.ts'

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
  // Data limite, quando ela é calculada e não lida de uma propriedade. A
  // assinatura vence em onboarding + 20 dias: sem isto o diálogo mostraria a
  // data do onboarding como se fosse o prazo.
  prazo?: string
  // O relógio não corre porque falta classificar o ticket, não porque o caso
  // é isento. O card fica cinza nos dois, mas só este é acionável — e some do
  // diálogo se não for marcado, porque não-se-aplica não é mostrado.
  faltaDado?: boolean
  // Qual propriedade está em branco, em nome curto. O card só tem uma linha:
  // "falta Formato da Empresa" cabe, a frase inteira do relógio não.
  campoFaltando?: string
  // Quando o marco existe, diz se foi cumprido dentro do prazo. null quando
  // não dá para saber.
  cumpriu: boolean | null
}

const DIA = 86400000
const dia = (d: string | undefined) => Date.parse(String(d ?? '').slice(0, 10) + 'T00:00:00Z')
const tem = (d: string | undefined) => !!d && Number.isFinite(dia(d))
// Anexo não é data: tem() rejeitaria o id do arquivo.
const anexado = (v: string | undefined) => !!v && v.trim() !== ''
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

// Data ISO a partir de um instante, para o prazo que o painel calcula.
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

const br = (d: string) => d.split('-').reverse().join('/')

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

// A etapa tem nome diferente nos dois pipelines. A lista fica aqui porque a
// busca de dados precisa saber quais tickets carregam a data de ganho.
export const ETAPAS_LOGISTICA = ['Contratar Logística', 'Logística']

// Dias entre o negócio ser ganho e a logística ter que estar adquirida.
export const PRAZO_AQUISICAO = 5

// Dias entre a realização do evento e a coleta de NPS e fotos.
export const PRAZO_NPS = 5

// Confirmação do pagamento pré-palestra: tem que estar fechada até D-7 do
// evento. O CS deu três âncoras — D-7 verde, D-5 amarelo, D-3 vermelho — e as
// faixas saem delas: verde enquanto falta uma semana ou mais, amarelo de D-6 a
// D-4, vermelho de D-3 em diante. Diferente do pós-palestra, esta é etapa de
// trabalho ANTES do evento: com o evento realizado e o ticket ainda aqui,
// manda a regra de evento passado.
export const PGTO_PRE_PRAZO = 7
export const PGTO_PRE_ATRASO = 3

// Confirmação do pagamento pós-palestra: 30 dias do evento, amarelo quando
// faltam 15 dias ou menos, vermelho quando faltam 10 ou menos. Numa janela de
// 30 dias, "a partir de 15 dias" e "faltando 15 dias" são o mesmo instante.
export const PRAZO_PGTO_POS = 30
export const PGTO_POS_ATENCAO = 15
export const PGTO_POS_ATRASO = 10

// Etapas de trabalho DEPOIS do evento. Nelas o evento ter passado é a
// condição para o prazo começar, não um atraso — sem esta lista, a regra de
// eventoPassou pintaria de vermelho todo ticket que chega em Coletar NPS.
export const ETAPAS_POS_EVENTO = ['Coletar NPS e Fotos', 'Confirmar PGTO Pós palestra']

const LOG_REEMBOLSO = 'Sim, com reembolso do cliente'
const LOG_CUSTO_PSA = 'Sim, com custo para PSA'

// Prazo que é uma data no proprio ticket. Mesma faixa que o CS definiu para a
// assinatura de contrato: verde ate a data, amarelo 1 a 3 dias depois,
// vermelho do quarto em diante. Sem a data nao da para cobrar — cinza, nunca
// verde por omissao.
// Prazo contado até uma data-limite calculada. Amarelo na reta final: um prazo
// que vence amanhã ainda dá para salvar, e ir de verde direto para vermelho
// esconde justamente a janela em que cobrar adianta. Mesma antecedência da
// régua de tempo na etapa.
const faixaAteOPrazo = (d: number): Estado => (d > 0 ? 'vermelho' : d > -AMARELO_ANTES ? 'amarelo' : 'verde')

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
const SEM_MINUTA = 'palestrante é exclusivo, não há minuta por evento'

const usaCliente = (formato: string) => !SO_PALESTRANTE.includes(formato)
// Em 100% PSA a minuta do palestrante só é exigida quando ele NÃO é
// exclusivo: palestrante exclusivo já tem contrato com a PSA, e não se assina
// um por evento. Em branco conta como não exclusivo, que é o lado seguro — e
// hoje são 87 dos 87 tickets 100% PSA da etapa com esse campo vazio.
const usaPalestrante = (t: TicketSim) =>
  COM_PALESTRANTE.includes(t.formatoContrato) &&
  !(t.formatoContrato === PSA_100 && t.palestranteExclusivo === 'Sim')

const PSA_100 = 'MC (Cliente x PSA) = 100% PSA'

const foraDoFormato = (texto: string, faltaDado = false, campoFaltando?: string): Veredito => ({
  estado: 'nao-aplica',
  dias: null,
  texto,
  cumpriu: null,
  faltaDado,
  campoFaltando,
})

// O painel não distingue minuta anexada de contrato assinado — o nome do
// arquivo não diz, e o token não lê a API de Files. Se o time anexar antes de
// assinar, o relógio fecha cedo.
//
// "Data de Envio contrato Cliente" e "Data de Envio contrato Palestrante"
// saíram da sinaleira em 17/10/2026: o CS não tem como metrificá-las hoje —
// 23 e 21 preenchidas de 62 na etapa, e 14 das 32 do palestrante com data no
// futuro. Relógio sem prazo cobrável só pinta cor sem ação possível.

export const RELOGIOS: Relogio[] = [
  {
    chave: 'log-aquisicao',
    etapa: ETAPAS_LOGISTICA,
    nome: 'Aquisição da logística',
    curto: 'aquisição',
    regra: `${PRAZO_AQUISICAO} dias após a primeira entrada do negócio em etapa de ganho · amarelo 1 a 3 dias depois · vermelho 4+`,
    confianca: 'fechado',
    gatilho: 'ganho_negocio',
    marco: '— sair da etapa é o único sinal de que foi adquirida',
    pendencia:
      'O prazo é calculado do ganho do negócio. A propriedade "Prazo de aquisição da Logística", preenchida em 32 dos 55 tickets da etapa, deixou de decidir a cor e saiu do diálogo.',
    ver: (t, hoje) => {
      if (t.logistica !== LOG_REEMBOLSO && t.logistica !== LOG_CUSTO_PSA)
        return t.logistica
          ? foraDoFormato(`a PSA não organiza a logística deste evento ("${t.logistica}")`)
          : foraDoFormato(
              '"Logística será organizada pela PSA?" está em branco',
              true,
              'Logística será organizada pela PSA?',
            )
      // Sem negócio ganho associado o prazo não tem de onde partir. Cinza, não
      // vermelho: o CS definiu isso só para o contrato sem onboarding.
      if (!tem(t.ganhoNegocio))
        return {
          estado: 'sem-dado',
          dias: null,
          texto: 'sem negócio ganho associado ao ticket, não há de onde contar o prazo',
          cumpriu: null,
          faltaDado: true,
        }
      const prazo = iso(dia(t.ganhoNegocio) + PRAZO_AQUISICAO * DIA)
      return { ...contraPrazo(prazo, hoje, ''), prazo }
    },
  },
  {
    chave: 'log-pagamento',
    etapa: ETAPAS_LOGISTICA,
    nome: 'Pagamento da logística',
    curto: 'pagamento',
    regra: 'Até a data em "Data prevista de pagamento Logística" · amarelo 1 a 3 dias depois · vermelho 4+',
    confianca: 'hipotese',
    gatilho: 'data_prevista_de_pagamento_logistica',
    marco: '— sair da etapa é o único sinal de que foi pago',
    pendencia: 'Só vale para logística com reembolso do cliente, conforme a regra do CS.',
    ver: (t, hoje) => {
      if (t.logistica !== LOG_REEMBOLSO)
        return t.logistica
          ? foraDoFormato(`não há reembolso de logística a cobrar do cliente ("${t.logistica}")`)
          : foraDoFormato(
              '"Logística será organizada pela PSA?" está em branco',
              true,
              'Logística será organizada pela PSA?',
            )
      return contraPrazo(t.pagamentoLogistica, hoje, 'sem data prevista de pagamento')
    },
  },
  {
    chave: 'contrato-assinatura',
    etapa: ['Assinar Contrato', 'Contrato'],
    nome: 'Assinatura do contrato pelo cliente',
    curto: 'assinatura',
    regra: `Até a data em "Prazo de Assinatura de Contrato" · amarelo nos ${AMARELO_ANTES} dias antes · vermelho depois · sem o prazo preenchido também é vermelho`,
    confianca: 'fechado',
    gatilho: 'assinar_contrato',
    marco: 'data_de_assinatura_do_contrato / status_do_contrato / contrato anexado',
    ver: (t, hoje) => {
      if (!usaCliente(t.formatoContrato)) return foraDoFormato('contrato é entre cliente e palestrante')

      const limite = dia(t.prazoAssinatura)
      const temPrazo = Number.isFinite(limite)
      const prazo = temPrazo ? iso(limite) : undefined

      if (anexado(t.anexoCliente) && !tem(t.dataAssinatura) && t.statusContrato !== 'Assinado')
        return { estado: 'concluido', dias: null, prazo, texto: 'contrato anexado ao ticket', cumpriu: null }

      // Único relógio com as duas pontas: dá para dizer se cumpriu de verdade.
      if (tem(t.dataAssinatura)) {
        if (!temPrazo) return { estado: 'concluido', dias: null, texto: 'assinado', cumpriu: null }
        const atraso = emDias(dia(t.dataAssinatura), limite)
        return {
          estado: 'concluido',
          dias: atraso,
          prazo,
          texto: atraso <= 0 ? `assinado ${-atraso}d antes do prazo` : `assinado ${atraso}d depois do prazo`,
          cumpriu: atraso <= 0,
        }
      }
      if (t.statusContrato === 'Assinado')
        return { estado: 'concluido', dias: null, prazo, texto: 'assinado, sem data registrada', cumpriu: null }

      // Prazo em branco não é prazo em dia: sem data não há o que cobrar, e
      // isso conta como atraso. Mesma decisão do faturamento.
      if (!temPrazo)
        return {
          estado: 'vermelho',
          dias: null,
          texto: 'sem "Prazo de Assinatura de Contrato" preenchido',
          cumpriu: null,
        }

      const d = emDias(hojeEmDias(hoje), limite)
      return {
        estado: faixaAteOPrazo(d),
        dias: d,
        prazo,
        texto: d > 0 ? `${d}d depois do prazo` : `faltam ${-d}d para o prazo`,
        cumpriu: null,
      }
    },
  },
  {
    chave: 'palestrante-assinatura',
    etapa: ['Assinar Contrato', 'Contrato'],
    nome: 'Assinatura do palestrante',
    curto: 'assinatura do palestrante',
    regra: `Até a data em "Prazo de Assinatura  Contrato Palestrante" · amarelo nos ${AMARELO_ANTES} dias antes · vermelho depois · sem o prazo preenchido também é vermelho`,
    confianca: 'fechado',
    gatilho: 'prazo_de_assinatura__contrato_palestrante',
    marco: 'data_de_assinatura__palestrante_ / contrato do palestrante anexado',
    ver: (t, hoje) => {
      if (!usaPalestrante(t))
        return foraDoFormato(
          t.palestranteExclusivo === 'Sim' ? SEM_MINUTA : t.formatoContrato || 'Formato de Contrato está em branco',
          !t.formatoContrato && t.palestranteExclusivo !== 'Sim',
          'Formato de Contrato',
        )

      const limite = dia(t.prazoAssinaturaPalestrante)
      const temPrazo = Number.isFinite(limite)
      const prazo = temPrazo ? iso(limite) : undefined

      if (anexado(t.anexoPalestrante) && !tem(t.dataAssinaturaPalestrante))
        return { estado: 'concluido', dias: null, prazo, texto: 'contrato anexado ao ticket', cumpriu: null }

      if (tem(t.dataAssinaturaPalestrante)) {
        if (!temPrazo)
          return { estado: 'concluido', dias: null, texto: 'assinado pelo palestrante', cumpriu: null }
        const atraso = emDias(dia(t.dataAssinaturaPalestrante), limite)
        return {
          estado: 'concluido',
          dias: atraso,
          prazo,
          texto: atraso <= 0 ? `assinado ${-atraso}d antes do prazo` : `assinado ${atraso}d depois do prazo`,
          cumpriu: atraso <= 0,
        }
      }

      if (!temPrazo)
        return {
          estado: 'vermelho',
          dias: null,
          texto: 'sem "Prazo de Assinatura  Contrato Palestrante" preenchido',
          cumpriu: null,
        }

      const d = emDias(hojeEmDias(hoje), limite)
      return {
        estado: faixaAteOPrazo(d),
        dias: d,
        prazo,
        texto: d > 0 ? `${d}d depois do prazo` : `faltam ${-d}d para o prazo`,
        cumpriu: null,
      }
    },
  },
  {
    chave: 'faturamento',
    etapa: ['Faturar', 'Faturamento'],
    nome: 'Emissão do faturamento',
    curto: 'emissão',
    regra: `Até a data em "Prazo para Despachar (Faturamento ao Financeiro)" · amarelo nos ${AMARELO_ANTES} dias antes · vermelho depois · sem o prazo preenchido também é vermelho`,
    confianca: 'fechado',
    gatilho: 'prazo_para_despachar_faturamento_ao_financeiro',
    marco: '— sair da etapa é o único sinal de que o faturamento terminou',
    pendencia: 'Falta definir se Órgão Público suspende o vermelho ou só ganha a tag.',
    ver: (t, hoje) => {
      // O prazo é a propriedade, ponto. Caiu o cálculo de "assinatura + 3":
      // com ele, Redetelesul (47930894741) ficava verde com o prazo em branco
      // — assinatura 13/10 + 3 dava 16/10, "vence hoje". Prazo em branco não
      // é prazo em dia; é a mesma decisão do contrato sem onboarding.
      const limite = dia(t.prazoDespacho)
      if (!Number.isFinite(limite))
        return {
          estado: 'vermelho',
          dias: null,
          texto: 'sem "Prazo para Despachar (Faturamento ao Financeiro)" preenchido',
          cumpriu: null,
        }
      const prazo = iso(limite)

      // Despachar não fecha a etapa: só sair dela fecha. O que se cobra aqui
      // é CONCLUIR o faturamento, e isso não aconteceu enquanto o ticket
      // estiver na coluna — então o relógio corre contra o prazo igual a
      // qualquer pendência. A data de despacho entra na frase como contexto,
      // não como alívio: Alvarez & Marsal (47449431815) tinha prazo 01/09,
      // despacho em 02/09 e seguia na etapa em 16/10.
      const d = emDias(hojeEmDias(hoje), limite)
      const marco = tem(t.dataEmissao) ? t.dataEmissao : t.dataFaturamento
      if (tem(marco)) {
        const atraso = emDias(dia(marco), limite)
        return {
          estado: faixaAteOPrazo(d),
          dias: d,
          prazo,
          texto:
            d > 0
              ? `despachado ${br(marco)} e a etapa não fechou — ${d}d depois do prazo`
              : `despachado ${br(marco)}, ${atraso <= 0 ? 'no prazo' : `${atraso}d depois do prazo`}, etapa aberta`,
          cumpriu: atraso <= 0,
        }
      }
      return {
        estado: faixaAteOPrazo(d),
        dias: d,
        prazo,
        texto: d <= 0 ? `faltam ${-d}d para o prazo` : `${d}d depois do prazo`,
        cumpriu: null,
      }
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
  {
    chave: 'pgto-pre',
    etapa: ['Confirmar PGTO Pré palestra'],
    nome: 'Confirmação do pagamento pré-palestra',
    curto: 'pagamento',
    regra: `Até D-${PGTO_PRE_PRAZO} do evento · verde até D-${PGTO_PRE_PRAZO} · amarelo de D-${PGTO_PRE_PRAZO - 1} a D-${PGTO_PRE_ATRASO + 1} · vermelho de D-${PGTO_PRE_ATRASO} em diante`,
    confianca: 'fechado',
    gatilho: 'data_do_evento__ganho_',
    marco: '— sair da etapa é o único sinal de que o pagamento foi confirmado',
    pendencia: 'Não há campo que marque a confirmação do pagamento; o relógio corre enquanto o ticket estiver na etapa.',
    ver: (t, hoje) => {
      if (!tem(t.evento))
        return { estado: 'sem-dado', dias: null, texto: 'sem data de evento', cumpriu: null }
      const D = emDias(dia(t.evento), hojeEmDias(hoje))
      const prazo = iso(dia(t.evento) - PGTO_PRE_PRAZO * DIA)
      if (D < 0)
        return { estado: 'vermelho', dias: -D, prazo, texto: 'evento já realizado', cumpriu: null }
      return {
        estado: D >= PGTO_PRE_PRAZO ? 'verde' : D > PGTO_PRE_ATRASO ? 'amarelo' : 'vermelho',
        dias: D,
        prazo,
        texto: `evento a D-${D}`,
        cumpriu: null,
      }
    },
  },
  {
    chave: 'pgto-pos',
    etapa: ['Confirmar PGTO Pós palestra'],
    nome: 'Confirmação do pagamento pós-palestra',
    curto: 'pagamento',
    regra: `Até ${PRAZO_PGTO_POS} dias após o evento · amarelo faltando ${PGTO_POS_ATENCAO} dias ou menos · vermelho faltando ${PGTO_POS_ATRASO} ou menos`,
    confianca: 'fechado',
    gatilho: 'data_do_evento__ganho_',
    marco: '— sair da etapa é o único sinal de que o pagamento foi confirmado',
    pendencia: 'Não há campo que marque a confirmação do pagamento; o relógio corre enquanto o ticket estiver na etapa.',
    ver: (t, hoje) => {
      if (!tem(t.evento))
        return { estado: 'sem-dado', dias: null, texto: 'sem data de evento', cumpriu: null }
      const limite = dia(t.evento) + PRAZO_PGTO_POS * DIA
      const prazo = iso(limite)
      // Dias que ainda faltam para o prazo; negativo já é atraso.
      const faltam = emDias(limite, hojeEmDias(hoje))
      return {
        estado: faltam > PGTO_POS_ATENCAO ? 'verde' : faltam > PGTO_POS_ATRASO ? 'amarelo' : 'vermelho',
        dias: -faltam,
        prazo,
        texto: faltam >= 0 ? `faltam ${faltam}d para o prazo` : `${-faltam}d depois do prazo`,
        cumpriu: null,
      }
    },
  },
  {
    chave: 'nps-coleta',
    etapa: ['Coletar NPS e Fotos'],
    nome: 'Coleta de NPS e fotos',
    curto: 'coleta',
    regra: `Até ${PRAZO_NPS} dias após a realização do evento · amarelo 1 a 3 dias depois · vermelho 4+`,
    confianca: 'fechado',
    gatilho: 'data_do_evento__ganho_',
    marco: '— sair da etapa é o único sinal de que foi coletado',
    pendencia:
      'Faixa de cor não foi acordada: aplica a mesma que o CS definiu para prazo em data. Não há campo que marque a coleta, então o relógio corre enquanto o ticket estiver na etapa.',
    ver: (t, hoje) => {
      if (!tem(t.evento))
        return { estado: 'sem-dado', dias: null, texto: 'sem data de evento', cumpriu: null }
      // Antes do evento não há o que coletar: o prazo nem abriu.
      const D = emDias(dia(t.evento), hojeEmDias(hoje))
      if (D > 0) return { estado: 'nao-iniciado', dias: D, texto: `evento a D-${D}`, cumpriu: null }
      const prazo = iso(dia(t.evento) + PRAZO_NPS * DIA)
      return { ...contraPrazo(prazo, hoje, ''), prazo }
    },
  },]

export const ETAPA_BRIEFING = 'Realizar Briefing'
export const BRIEFING_ATENCAO = 15
export const BRIEFING_ATRASO = 7

// Regra que atravessa todas as etapas: com o evento chegando, o ticket já
// tinha que ter passado por Realizar Briefing. Se não passou, ele está parado
// na etapa errada — não importa se os prazos da etapa onde ele está estão em
// dia. Vale independentemente de quando a etapa foi criada no HubSpot: se
// estivesse tudo certo, o ticket já teria sido movido.
export function briefingPendente(t: TicketSim, etapa: string, hoje: number): { cor: Cor; texto: string } | null {
  if (etapa === ETAPA_BRIEFING || tem(t.entrouBriefing)) return null
  if (!tem(t.evento)) return null
  const d = emDias(dia(t.evento), hojeEmDias(hoje))
  if (d < 0 || d > BRIEFING_ATENCAO) return null
  const quando = d === 0 ? 'é hoje' : `em ${d}d`
  return {
    cor: d <= BRIEFING_ATRASO ? 'vermelho' : 'amarelo',
    texto: `briefing não aconteceu e o evento ${quando}`,
  }
}

export const ORGAO_PUBLICO = 'Órgão Público'

// O prazo de assinatura dos dois contratos vem da propriedade do ticket —
// "Prazo de Assinatura de Contrato" e "Prazo de Assinatura  Contrato
// Palestrante". Era calculado do onboarding (20/30/45 por Formato da Empresa,
// 25 para o palestrante), e isso contradizia o prazo que o CS escrevia no
// ticket: Colombo (46097473964) tinha 26/10 no campo e o painel cobrava
// 19/07. Formato da Empresa deixa de entrar na conta.

// Formatos em que a PSA contrata o palestrante por minuta própria. Com
// interveniente (Cliente x PSA x Palestrante) a minuta individual cai.
export const EXIGE_MINUTA_PALESTRANTE = (formato: string) =>
  /100% PSA/.test(formato) && !/x Palestrante/.test(formato)

const PESO: Record<string, number> = { vermelho: 3, amarelo: 2, verde: 1 }

// Uma etapa pode ter dois relógios correndo, e o card tem uma cor só: manda o
// pior. O texto diz qual deles, senão o número não significa nada.
// Relógio bloqueado não vira verde por omissão — devolve null, que o painel
// pinta de cinza.
// Etapa com relógio é trabalho que tem que estar pronto ANTES do evento, não
// no dia dele: no dia já é tarde. Por isso <= 0 e não < 0 — com < 0, um ticket
// com o evento HOJE e o contrato assinado ficava verde em Assinar Contrato.
export const eventoPassou = (t: TicketSim, hoje: number) =>
  tem(t.evento) && emDias(dia(t.evento), hojeEmDias(hoje)) <= 0

export function corDaEtapa(t: TicketSim, etapa: string, hoje: number) {
  let cor: Cor | null = null
  let texto = ''
  let fechado = false
  // Cumprido é verde, não cinza. Cinza é só para o que não dá para medir:
  // falta data, ou falta regra. Um contrato enviado e assinado dentro do prazo
  // caía em cinza porque nenhum relógio "produzia cor", e ficava indistinguível
  // de um ticket sem dado nenhum.
  let cumprido: { curto: string; texto: string; cumpriu: boolean | null } | null = null
  // Relógio cuja janela ainda não abriu. Não é falta de dado: é prazo que
  // começa depois. Positiva Eventos (43679094830) ficava cinza em Realizar
  // Briefing com o evento a D-34, dizendo "sem prazo nesta etapa" — a etapa
  // tem prazo, ele abre em D-30.
  let porComecar: { curto: string; texto: string; dias: number } | null = null
  // Relógio que não vale para este ticket por causa de uma resposta que está
  // preenchida — "Logística será organizada pela PSA? = Não". Grupo Mascarello
  // (48990612847) ficava cinza com isso, e cinza quer dizer "não sei medir".
  // Aqui sabe-se: não há o que cobrar.
  let naoAplica: { curto: string; texto: string } | null = null
  let faltaData = false

  for (const rel of RELOGIOS) {
    if (!rel.etapa.includes(etapa)) continue
    const v = rel.ver(t, hoje)
    if (v.estado === 'sem-dado' || v.faltaDado) faltaData = true
    if (v.estado === 'nao-aplica' && !v.faltaDado && !naoAplica)
      naoAplica = { curto: rel.curto, texto: v.texto }
    // O último concluído ganha a frase: é o passo mais adiantado da etapa.
    // Cumprido fora do prazo nao cede a vez: com dois concluidos na etapa, o
    // que estourou o prazo e o que importa dizer — e o que tira o verde.
    if (v.estado === 'concluido' && cumprido?.cumpriu !== false)
      cumprido = { curto: rel.curto, texto: v.texto, cumpriu: v.cumpriu }
    // O primeiro a abrir é o que vale dizer: é o próximo prazo a correr.
    if (v.estado === 'nao-iniciado' && (!porComecar || (v.dias ?? 0) < (porComecar.dias ?? 0)))
      porComecar = { curto: rel.curto, texto: v.texto, dias: v.dias ?? 0 }
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
  if (cor) return { cor, texto }
  // Sem nenhum relógio aceso: verde quando algo foi cumprido e nada ficou sem
  // data. Com data faltando continua cinza, e o diálogo diz qual campo é.
  // Cumprido FORA do prazo não é verde. Alvarez & Marsal (48344186331) tinha
  // o faturamento despachado um dia depois do prazo e o card dizia "em dia";
  // outro estava verde com o contrato assinado 197 dias depois. Amarelo e não
  // vermelho porque o marco aconteceu — não há o que cobrar, há o que
  // registrar.
  if (cumprido && !faltaData)
    return {
      cor: (cumprido.cumpriu === false ? 'amarelo' : 'verde') as Cor,
      texto: `${cumprido.curto} · ${cumprido.texto}`,
    }
  // Nada aceso, nada cumprido, mas há prazo esperando a janela abrir: está em
  // dia. Cinza aqui diria "não sei medir", e sabe-se — só não é hora ainda.
  if (porComecar && !faltaData)
    return { cor: 'verde' as Cor, texto: `${porComecar.curto} · ${porComecar.texto}` }
  // Todos os relógios fora de cena por resposta preenchida: não há prazo a
  // cobrar neste ticket, e isso é estar em dia.
  if (naoAplica && !faltaData) return { cor: 'verde' as Cor, texto: `${naoAplica.curto} · ${naoAplica.texto}` }
  return null
}

// Entre a cor da etapa e a do briefing pendente, manda a pior — e cinza perde
// de qualquer cor, porque cor é informação e cinza é ausência dela.
const pior = (a: { cor: Cor; texto: string } | null, b: { cor: Cor; texto: string } | null) => {
  if (!a) return b
  if (!b) return a
  return PESO[b.cor] > PESO[a.cor] ? b : a
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

  // Etapa com relógio é etapa de trabalho que tem que acontecer ANTES do
  // evento. Se o evento já passou e o ticket ainda está nela, está atrasado —
  // e isso vale mais que qualquer data de propriedade. Sem esta regra, um
  // ticket com o evento três dias atrás ficava verde porque o pagamento da
  // logística estava marcado para dali a um mês.
  if (!ETAPAS_POS_EVENTO.includes(regra.label) && eventoPassou(t, hoje))
    return {
      ...base,
      cor: 'vermelho',
      texto:
        emDias(dia(t.evento), hojeEmDias(hoje)) === 0
          ? 'o evento é hoje e a etapa não fechou'
          : `evento foi em ${br(t.evento)} e a etapa não fechou`,
    }

  const s = pior(corDaEtapa(t, regra.label, hoje), briefingPendente(t, regra.label, hoje))
  if (s) return { ...base, cor: s.cor, texto: s.texto }

  // Cinza nesta altura é sempre falta de dado — cumprido, prazo por abrir e
  // isenção por resposta preenchida já viraram verde em corDaEtapa. Então diz
  // qual campo, que é a única ação possível.
  for (const rel of RELOGIOS) {
    if (!rel.etapa.includes(regra.label)) continue
    const v = rel.ver(t, hoje)
    if (v.campoFaltando) return { ...base, texto: `falta ${v.campoFaltando}` }
    if (v.estado === 'sem-dado') return { ...base, texto: `${rel.curto} · ${v.texto}` }
  }
  return { ...base, texto: 'sem prazo nesta etapa' }
}

// Alertas de processo: o segundo eixo do painel. A cor diz se o ticket está
// travado na etapa onde ele está; o alerta diz que um marco passou do prazo,
// esteja o ticket na etapa que estiver — ticket verde em "Solicitar NF" com o
// contrato nunca assinado é exatamente o caso que o alerta existe para pegar.
//
// Saíam de uma conta própria, escrita antes dos relógios: contavam 27
// contratos pendentes enquanto os relógios acendiam em 233, e o briefing
// usava "onboarding em branco" como proxy, acendendo em 1 ticket contra os 44
// da regra que o CS acordou depois. Agora é o mesmo relógio, ou é bug.
//
// Cliente e palestrante são alertas separados de propósito: "Data de
// assinatura (palestrante)" está preenchida em 6 dos 245 tickets que exigem a
// minuta, contra 112 de 185 no lado do cliente. Somados, o número do cliente
// sumiria dentro de uma lacuna de preenchimento.
const DE_RELOGIO: { chave: string; texto: string; relogio: string }[] = [
  { chave: 'contrato', texto: 'Contrato do cliente pendente', relogio: 'contrato-assinatura' },
  { chave: 'minuta', texto: 'Contrato do palestrante pendente', relogio: 'palestrante-assinatura' },
]

export function alertas(t: TicketSim, hoje: number, sla: Record<string, Regra>): Alerta[] {
  const out: Alerta[] = []

  for (const a of DE_RELOGIO) {
    const rel = RELOGIOS.find((x) => x.chave === a.relogio)
    if (!rel) continue
    const v = rel.ver(t, hoje)
    if (v.estado === 'vermelho' || v.estado === 'amarelo') out.push({ chave: a.chave, texto: a.texto })
  }

  if (briefingPendente(t, sla[t.stage]?.label ?? '', hoje))
    out.push({ chave: 'briefing', texto: 'Briefing pendente' })

  return out
}

// Nome humano e campo do ticket para cada propriedade que um relógio lê. O
// diálogo mostra "Prazo de aquisição", não "adquirir_logistica": quem abre o
// painel não precisa saber o nome interno da propriedade.
// O rótulo é o nome EXATO da propriedade no HubSpot, não um apelido curto.
// O diálogo manda preencher campo, e campo com nome inventado não se acha na
// tela do ticket — "Assinatura do cliente" não existe, "Data de assinatura do
// contrato" existe. Conferido contra /properties/tickets: os 12 divergiam.
const PROP: Record<string, { rotulo: string; campo: keyof TicketSim }> = {
  data_de_realizacao_do_onboarding: { rotulo: 'Data de realização do Onboarding', campo: 'onboarding' },
  adquirir_logistica: { rotulo: 'Prazo de aquisição da Logística', campo: 'prazoLogistica' },
  // Único que não é propriedade do ticket: vem do histórico do negócio
  // associado, então não há nome de campo para mandar preencher.
  ganho_negocio: { rotulo: 'Negócio ganho', campo: 'ganhoNegocio' },
  data_prevista_de_pagamento_logistica: { rotulo: 'Data prevista de pagamento Logistica', campo: 'pagamentoLogistica' },
  assinar_contrato: { rotulo: 'Prazo de Assinatura de Contrato', campo: 'prazoAssinatura' },
  data_de_assinatura_do_contrato: { rotulo: 'Data de assinatura do contrato', campo: 'dataAssinatura' },
  prazo_para_despachar_faturamento_ao_financeiro: {
    rotulo: 'Prazo para Despachar (Faturamento ao Financeiro)',
    campo: 'prazoDespacho',
  },
  prazo_de_assinatura__contrato_palestrante: {
    rotulo: 'Prazo de Assinatura  Contrato Palestrante',
    campo: 'prazoAssinaturaPalestrante',
  },
  data_de_assinatura__palestrante_: {
    rotulo: 'Data de Assinatura (Palestrante)',
    campo: 'dataAssinaturaPalestrante',
  },
  data_do_evento__ganho_: { rotulo: 'Data do Evento', campo: 'evento' },
}

const dataDe = (t: TicketSim, prop: string) => {
  const p = PROP[prop]
  if (!p) return null
  const v = t[p.campo]
  return { rotulo: p.rotulo, valor: typeof v === 'string' ? v : '' }
}

export type Conta = {
  chave: string
  nome: string
  estado: Estado
  // Uma frase dizendo por que esta nessa cor, com a data e a conta de dias.
  porque: string
  // Relogio parado por campo em branco: o dialogo mostra mesmo sendo
  // nao-aplica, porque e a unica forma de alguem saber o que preencher.
  faltaDado?: boolean
  // Prazo preenchido antes de o ticket entrar na etapa: na reorganizacao do
  // pipeline em 02/10/2026 isso valeu para 30 dos 42 tickets com data da
  // coluna de logistica, que nasceram vermelhos sem ninguem ter atrasado.
  herdado?: boolean
}


function porQue(rel: Relogio, t: TicketSim, v: Veredito): string {
  const g = dataDe(t, rel.gatilho)
  // Prazo calculado manda: dizer "Onboarding 07/10 venceu há 9 dias" esconde
  // que o prazo era 27/10, e quem lê não tem como refazer a conta.
  const quando = v.prazo
    ? `O prazo era ${br(v.prazo)}`
    : g?.valor
      ? `${g.rotulo} ${br(g.valor)}`
      : g?.rotulo

  if (v.faltaDado) return `${v.texto[0].toUpperCase()}${v.texto.slice(1)}.`
  if (v.estado === 'sem-dado') return `Falta preencher ${quando ?? 'a data que inicia o prazo'}.`
  if (v.estado === 'nao-aplica') return `Não se aplica: ${v.texto}.`
  if (v.estado === 'bloqueado') return `Sem como medir: ${v.texto}.`
  if (v.estado === 'concluido') return `Concluída — ${v.texto}.`
  if (v.estado === 'nao-iniciado') return `Ainda não começou a contar: ${v.texto}.`

  // Cor sem contagem de dias: a frase do próprio relógio já diz tudo.
  if (v.dias === null) return `${v.texto[0].toUpperCase()}${v.texto.slice(1)}.`

  const d = v.dias
  if (d > 0) return `${quando} venceu há ${d} ${d === 1 ? 'dia' : 'dias'}.`
  if (d === 0) return `${quando} vence hoje.`
  return `${quando} ainda não venceu: faltam ${-d} ${-d === 1 ? 'dia' : 'dias'}.`
}

// Abre a conta de um ticket: as datas que os relógios da etapa leram e, para
// cada relógio, uma frase dizendo por que deu aquela cor. Sai da mesma régua
// que pinta o card — não é um texto paralelo que desatualiza.
export function explicar(t: TicketSim, etapa: string, hoje: number) {
  const meus = RELOGIOS.filter((rel) => rel.etapa.includes(etapa))
  const entrou = dia(t.entrouEtapa)

  // 'cumprido' marca a data cujo relógio já fechou. Sem isso, um prazo
  // vencido aparece na tabela com cara de cobrança mesmo quando o contrato
  // está anexado e não há nada a cobrar — ASAAS (48724787061) mostrava
  // "Prazo de Assinatura de Contrato 09/10/2026" no topo com o relógio
  // concluído logo abaixo.
  const datas: { rotulo: string; valor: string; cumprido?: boolean }[] = []
  const vistos = new Set<string>()

  // A tabela só traz data de relógio que corre neste ticket. Antes vinham as
  // dos quatro relógios da etapa, e num contrato com interveniente — formato
  // MC (Cliente x PSA x Palestrante), que não pede minuta do palestrante — a
  // tabela listava "Envio ao palestrante" e "Prazo de assinatura do
  // palestrante" como vazio, parecendo campo faltando.
  const vereditos = meus.map((rel) => ({ rel, v: rel.ver(t, hoje) }))

  for (const { rel, v } of vereditos) {
    if (v.estado === 'nao-aplica') continue
    for (const prop of [rel.gatilho, rel.marco]) {
      const d = dataDe(t, prop)
      if (!d || vistos.has(d.rotulo)) continue
      vistos.add(d.rotulo)
      datas.push({ ...d, cumprido: v.estado === 'concluido' })
    }
  }

  const contas: Conta[] = vereditos.map(({ rel, v }) => {
    // Prazo calculado: entra na tabela com o nome do relógio, senão o da
    // logística apareceria como "Prazo de assinatura".
    const rotuloPrazo = `Prazo de ${rel.curto}`
    // Com o prazo vindo de propriedade, a data já está na tabela pelo nome do
    // campo: repetir como "Prazo de assinatura" seria a mesma data duas vezes.
    const jaListado = datas.some((x) => x.valor === v.prazo)
    if (v.prazo && !jaListado && !vistos.has(rotuloPrazo)) {
      vistos.add(rotuloPrazo)
      datas.push({ rotulo: rotuloPrazo, valor: v.prazo, cumprido: v.estado === 'concluido' })
    }
    const g = dataDe(t, rel.gatilho)
    const prazo = dia(v.prazo || g?.valor || '')
    return {
      chave: rel.chave,
      nome: rel.nome,
      estado: v.estado,
      porque: porQue(rel, t, v),
      faltaDado: v.faltaDado,
      herdado:
        !!PESO[v.estado] && Number.isFinite(prazo) && Number.isFinite(entrou) && prazo < entrou,
    }
  })

  return {
    datas,
    contas,
    eventoPassou: meus.length > 0 && eventoPassou(t, hoje),
    briefing: briefingPendente(t, etapa, hoje),
    // O que governa quais relógios correm. Sem isso na tela, duas etapas com
    // a mesma cor e motivos diferentes ficam indistinguíveis.
    ficha: {
      formatoContrato: t.formatoContrato,
      exclusivo: t.palestranteExclusivo,
      palestrante: t.palestrantePrincipal,
    },
  }
}
