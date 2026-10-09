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
  DIAS_PARA_ASSINAR,
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

// Dias entre o onboarding e a assinatura do palestrante. Mesmo marco do
// contrato do cliente, número único: o prazo do cliente varia por Formato da
// Empresa, o do palestrante não.
export const DIAS_ASSINATURA_PALESTRANTE = 25

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

const foraDoFormato = (texto: string, faltaDado = false): Veredito => ({
  estado: 'nao-aplica',
  dias: null,
  texto,
  cumpriu: null,
  faltaDado,
})

// Assinatura do cliente serve de prova indireta de envio: não dá para assinar
// um contrato que não foi enviado. O anexo conta junto: o arquivo está no
// ticket, então o contrato existe e não há o que cobrar.
//
// O painel não distingue minuta anexada de contrato assinado — o nome do
// arquivo não diz, e o token não lê a API de Files. Se o time anexar antes de
// assinar, o relógio fecha cedo.
const contratoAssinado = (t: TicketSim) =>
  t.statusContrato === 'Assinado' || tem(t.dataAssinatura) || anexado(t.anexoCliente)

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
          : foraDoFormato('"Logística será organizada pela PSA?" está em branco', true)
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
          : foraDoFormato('"Logística será organizada pela PSA?" está em branco', true)
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
    regra: 'Do onboarding: 20 dias para Empresa Privada, 30 para Sistema S, 45 para Órgão Público · amarelo nos ${AMARELO_ANTES} dias antes · vermelho depois disso · sem onboarding também é vermelho',
    confianca: 'fechado',
    gatilho: 'data_de_realizacao_do_onboarding',
    marco: 'data_de_assinatura_do_contrato / status_do_contrato',
    pendencia:
      'Associação e agência não têm prazo acordado, e 44 dos 118 tickets da etapa estão com Formato da Empresa em branco — nesses o relógio não corre. Não há faixa de atenção: o CS definiu verde até o prazo e vermelho depois.',
    ver: (t, hoje) => {
      if (!usaCliente(t.formatoContrato)) return foraDoFormato('contrato é entre cliente e palestrante')
      const dias = DIAS_PARA_ASSINAR[t.formatoEmpresa]
      if (!dias)
        return t.formatoEmpresa
          ? foraDoFormato(`não há prazo de assinatura acordado para ${t.formatoEmpresa}`)
          : foraDoFormato(
              'Formato da Empresa está em branco, então o prazo de assinatura não corre — preencha para o painel cobrar',
              true,
            )

      const limite = dia(t.onboarding) + dias * DIA
      const prazo = Number.isFinite(limite) ? iso(limite) : undefined

      // Único relógio com as duas pontas: dá para dizer se cumpriu de verdade.
      if (anexado(t.anexoCliente) && !tem(t.dataAssinatura) && t.statusContrato !== 'Assinado')
        return { estado: 'concluido', dias: null, prazo, texto: 'contrato anexado ao ticket', cumpriu: null }

      if (tem(t.dataAssinatura)) {
        if (!prazo)
          return { estado: 'concluido', dias: null, texto: 'assinado', cumpriu: null }
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

      // Sem onboarding o prazo nem começa a correr, e o CS decidiu que isso
      // conta como atrasado: contrato sem onboarding registrado é o caso que
      // mais some, justamente por não ter data para cobrar.
      if (!prazo)
        return {
          estado: 'vermelho',
          dias: null,
          texto: 'sem data de onboarding, não há prazo para cobrar',
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
      if (!usaPalestrante(t))
        return foraDoFormato(
          t.palestranteExclusivo === 'Sim' ? SEM_MINUTA : t.formatoContrato || 'Formato de Contrato está em branco',
          !t.formatoContrato && t.palestranteExclusivo !== 'Sim',
        )
      if (tem(t.envioPalestrante)) return { estado: 'concluido', dias: null, texto: 'minuta enviada', cumpriu: null }
      return { estado: 'bloqueado', dias: null, texto: 'falta o prazo de envio da minuta', cumpriu: null }
    },
  },
  {
    chave: 'palestrante-assinatura',
    etapa: ['Assinar Contrato', 'Contrato'],
    nome: 'Assinatura do palestrante',
    curto: 'assinatura do palestrante',
    regra: `${DIAS_ASSINATURA_PALESTRANTE} dias após o onboarding, quando o formato exige contrato com o palestrante · amarelo nos ${AMARELO_ANTES} dias antes · vermelho depois disso · sem onboarding também é vermelho`,
    confianca: 'fechado',
    gatilho: 'data_de_realizacao_do_onboarding',
    marco: 'data_de_assinatura__palestrante_',
    pendencia:
      'A propriedade "Prazo de Assinatura Contrato Palestrante", em branco em 29 tickets, deixou de decidir a cor — era a causa dos cinzas nesta etapa.',
    ver: (t, hoje) => {
      if (!usaPalestrante(t))
        return foraDoFormato(
          t.palestranteExclusivo === 'Sim' ? SEM_MINUTA : t.formatoContrato || 'Formato de Contrato está em branco',
          !t.formatoContrato && t.palestranteExclusivo !== 'Sim',
        )
      const limite = dia(t.onboarding) + DIAS_ASSINATURA_PALESTRANTE * DIA
      const prazo = Number.isFinite(limite) ? iso(limite) : undefined

      if (anexado(t.anexoPalestrante) && !tem(t.dataAssinaturaPalestrante))
        return { estado: 'concluido', dias: null, prazo, texto: 'contrato anexado ao ticket', cumpriu: null }

      if (tem(t.dataAssinaturaPalestrante)) {
        if (!prazo)
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

      // Mesmo marco do contrato do cliente, mesmo tratamento: sem onboarding o
      // prazo nem começa a correr, e o CS decidiu que isso conta como atraso.
      if (!prazo)
        return {
          estado: 'vermelho',
          dias: null,
          texto: 'sem data de onboarding, não há prazo para cobrar',
          cumpriu: null,
        }

      // Sem faixa de atenção, igual ao contrato do cliente: verde até o prazo,
      // vermelho depois.
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

// O prazo de assinatura sai de DIAS_PARA_ASSINAR: 20 dias para empresa
// privada, 30 para Sistema S e 45 para órgão público. Associação e agência não têm
// prazo acordado, e formato em branco não entra — aplicar prazo de um tipo de
// empresa a uma que ninguém classificou seria supor. São 44 dos 118 da etapa,
// e a conversa ali é preencher o campo, não afrouxar a régua.

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
  let cumprido: { curto: string; texto: string } | null = null
  // Relógio cuja janela ainda não abriu. Não é falta de dado: é prazo que
  // começa depois. Positiva Eventos (43679094830) ficava cinza em Realizar
  // Briefing com o evento a D-34, dizendo "sem prazo nesta etapa" — a etapa
  // tem prazo, ele abre em D-30.
  let porComecar: { curto: string; texto: string; dias: number } | null = null
  let faltaData = false

  for (const rel of RELOGIOS) {
    if (!rel.etapa.includes(etapa)) continue
    const v = rel.ver(t, hoje)
    if (v.estado === 'sem-dado') faltaData = true
    // O último concluído ganha a frase: é o passo mais adiantado da etapa.
    if (v.estado === 'concluido') cumprido = { curto: rel.curto, texto: v.texto }
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
  if (cumprido && !faltaData) return { cor: 'verde' as Cor, texto: `${cumprido.curto} · ${cumprido.texto}` }
  // Nada aceso, nada cumprido, mas há prazo esperando a janela abrir: está em
  // dia. Cinza aqui diria "não sei medir", e sabe-se — só não é hora ainda.
  if (porComecar && !faltaData)
    return { cor: 'verde' as Cor, texto: `${porComecar.curto} · ${porComecar.texto}` }
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
  if (eventoPassou(t, hoje))
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
const PROP: Record<string, { rotulo: string; campo: keyof TicketSim }> = {
  data_de_realizacao_do_onboarding: { rotulo: 'Onboarding', campo: 'onboarding' },
  adquirir_logistica: { rotulo: 'Prazo de aquisição', campo: 'prazoLogistica' },
  ganho_negocio: { rotulo: 'Negócio ganho', campo: 'ganhoNegocio' },
  data_prevista_de_pagamento_logistica: { rotulo: 'Pagamento previsto', campo: 'pagamentoLogistica' },
  data_de_envio_contrato_cliente: { rotulo: 'Envio ao cliente', campo: 'envioCliente' },
  assinar_contrato: { rotulo: 'Prazo de assinatura', campo: 'prazoAssinatura' },
  data_de_assinatura_do_contrato: { rotulo: 'Assinatura do cliente', campo: 'dataAssinatura' },
  data_de_envio_contrato_palestrante: { rotulo: 'Envio ao palestrante', campo: 'envioPalestrante' },
  prazo_de_assinatura__contrato_palestrante: {
    rotulo: 'Prazo de assinatura do palestrante',
    campo: 'prazoAssinaturaPalestrante',
  },
  data_de_assinatura__palestrante_: {
    rotulo: 'Assinatura do palestrante',
    campo: 'dataAssinaturaPalestrante',
  },
  data_do_evento__ganho_: { rotulo: 'Evento', campo: 'evento' },
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

  const datas: { rotulo: string; valor: string }[] = []
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
      datas.push(d)
    }
  }

  const contas: Conta[] = vereditos.map(({ rel, v }) => {
    // Prazo calculado: entra na tabela com o nome do relógio, senão o da
    // logística apareceria como "Prazo de assinatura".
    const rotuloPrazo = `Prazo de ${rel.curto}`
    if (v.prazo && !vistos.has(rotuloPrazo)) {
      vistos.add(rotuloPrazo)
      datas.push({ rotulo: rotuloPrazo, valor: v.prazo })
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
