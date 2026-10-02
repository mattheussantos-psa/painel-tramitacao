// Os relógios da Tramitação (pipeline 941149608).
//
// A régua do CS é tempo na etapa. Estas regras são outra coisa: medem
// distância até um marco (onboarding, aceite, assinatura, data do evento), e a
// mesma etapa pode ter dois relógios correndo ao mesmo tempo. Por isso vivem
// em arquivo separado — misturar com a régua do CS faria um quadro mentir
// sobre o outro.
//
// Nada aqui é aplicado em produção: serve à simulação sobre dados reais do CS.

import { hojeEmDias } from './sinaleira.ts'

export type Cor = 'verde' | 'amarelo' | 'vermelho'

// 'nao-aplica'  — a regra não vale para este ticket (ex.: log com custo PSA)
// 'nao-iniciado'— a janela do prazo ainda não abriu (ex.: evento a D-60)
// 'sem-dado'    — a regra vale, mas falta o campo que dispara o relógio
// 'concluido'   — o marco aconteceu
// 'bloqueado'   — o relógio não existe: falta campo no HubSpot para medi-lo
export type Estado = Cor | 'nao-aplica' | 'nao-iniciado' | 'sem-dado' | 'concluido' | 'bloqueado'

export type TicketSim = {
  id: string
  subject: string
  stage: string
  proprietario: string | null
  evento: string
  logistica: string
  tipoEmpresa: string
  formatoContrato: string
  onboarding: string
  prazoAssinatura: string
  dataAssinatura: string
  statusContrato: string
  dataFaturamento: string
  dataEmissao: string
  prazoBriefing: string
  callBriefing: string
  // O briefing passa a ser marcado como reunião a partir do ticket, igual ao
  // que já se faz em negócio. Então o marco é a reunião, não o campo de data.
  reunioes: { titulo: string; inicio: string; desfecho: string }[]
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
const dia = (d: string) => Date.parse(d.slice(0, 10) + 'T00:00:00Z')
const tem = (d: string) => !!d && Number.isFinite(dia(d))
const emDias = (a: number, b: number) => Math.round((a - b) / DIA)

// Dias úteis entre duas datas, só seg-sex. Feriado nacional não entra: exigiria
// calendário mantido à mão, e a pergunta está aberta com o CS.
export function diasUteis(de: string, ate: number) {
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
  etapa: string
  nome: string
  regra: string
  confianca: Confianca
  gatilho: string
  marco: string
  // Decisão ainda pendente com o CS que afeta este relógio.
  pendencia?: string
  ver: (t: TicketSim, hoje: number) => Veredito
}

const LOG_COM_PRAZO = 'Sim, com reembolso do cliente'

// Assinatura do cliente serve de prova indireta de envio: não dá para assinar
// um contrato que não foi enviado.
const contratoAssinado = (t: TicketSim) => t.statusContrato === 'Assinado' || tem(t.dataAssinatura)

export const RELOGIOS: Relogio[] = [
  {
    chave: 'log-aceite',
    etapa: 'Logística',
    nome: 'Aceite da logística',
    regra: 'Até 24h após o onboarding · amarelo 2 a 3 dias · vermelho 4+',
    confianca: 'hipotese',
    gatilho: 'data_de_realizacao_do_onboarding',
    marco: '— não existe campo de aceite',
    pendencia: 'Sem marco de conclusão, todo ticket antigo aparece vencido. O campo autorizacao_logistica já existe com as opções certas e está vazio nos 358.',
    ver: (t, hoje) => {
      if (t.logistica !== LOG_COM_PRAZO)
        return { estado: 'nao-aplica', dias: null, texto: t.logistica || 'sem resposta', cumpriu: null }
      if (!tem(t.onboarding))
        return { estado: 'sem-dado', dias: null, texto: 'sem data de onboarding', cumpriu: null }
      const d = emDias(hojeEmDias(hoje), dia(t.onboarding))
      return { estado: faixa(d, 1, 3), dias: d, texto: `${d}d desde o onboarding`, cumpriu: null }
    },
  },
  {
    chave: 'log-emissao',
    etapa: 'Logística',
    nome: 'Emissão da logística',
    regra: 'Até 24h após o aceite · amarelo 2 a 3 dias · vermelho 4+',
    confianca: 'bloqueado',
    gatilho: '— não existe campo de aceite',
    marco: '— não existe campo de emissão',
    pendencia: 'Relógio impossível hoje: sem data de aceite não há de onde contar.',
    ver: (t) => ({
      estado: t.logistica === LOG_COM_PRAZO ? 'bloqueado' : 'nao-aplica',
      dias: null,
      texto: t.logistica === LOG_COM_PRAZO ? 'falta a data de aceite' : t.logistica || 'sem resposta',
      cumpriu: null,
    }),
  },
  {
    chave: 'contrato-envio',
    etapa: 'Contrato',
    nome: 'Envio do contrato',
    regra: '1 dia útil após o onboarding · amarelo 2 a 3 dias · vermelho 4+',
    confianca: 'hipotese',
    gatilho: 'data_de_realizacao_do_onboarding',
    marco: 'assinatura serve de prova indireta — falta o valor "Enviado"',
    pendencia: 'status_do_contrato só tem Assinado e Pendente: Pendente não separa "não enviei" de "enviei e não assinaram".',
    ver: (t, hoje) => {
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
    etapa: 'Contrato',
    nome: 'Assinatura do contrato',
    regra: 'Até a data em "Prazo de Assinatura" · amarelo 1 a 3 dias depois · vermelho 4+',
    confianca: 'fechado',
    gatilho: 'assinar_contrato',
    marco: 'data_de_assinatura_do_contrato / status_do_contrato',
    ver: (t, hoje) => {
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
    chave: 'faturamento',
    etapa: 'Faturamento',
    nome: 'Emissão do faturamento',
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
    etapa: 'Briefing',
    nome: 'Agendamento do briefing',
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
    etapa: 'Briefing',
    nome: 'Realização do briefing',
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
