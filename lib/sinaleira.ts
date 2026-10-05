export type Cor = 'verde' | 'amarelo' | 'vermelho' | 'cinza'
export type Regua = 'pre' | 'pos'

export type Ticket = {
  id: string
  subject: string
  stage: string
  evento: string
  curador: string | null
  proprietario: string | null
  proximaTarefa: string
  onboarding: string
  statusContrato: string
  entrouEtapa: string
  // Campos que só os relógios da Tramitação leem. Vazio é o normal fora das
  // etapas que usam relógio — e vazio vira cinza, nunca verde.
  logistica: string
  tipoEmpresa: string
  formatoContrato: string
  prazoAssinatura: string
  dataAssinatura: string
  prazoBriefing: string
  callBriefing: string
  dataFaturamento: string
  dataEmissao: string
  prazoLogistica: string
  pagamentoLogistica: string
  envioCliente: string
  envioPalestrante: string
  prazoAssinaturaPalestrante: string
  dataAssinaturaPalestrante: string
  reunioes: { titulo: string; inicio: string; desfecho: string }[]
}

// Preenche o que falta num ticket vindo do snapshot, que é anterior aos
// campos de relógio. Sem isso o fallback sem token nem compila.
export const completar = (t: Partial<Ticket>): Ticket => ({
  id: '', subject: '', stage: '', evento: '', curador: null, proprietario: null,
  proximaTarefa: '', onboarding: '', statusContrato: '', entrouEtapa: '',
  logistica: '', tipoEmpresa: '', formatoContrato: '', prazoAssinatura: '',
  dataAssinatura: '', prazoBriefing: '', callBriefing: '', dataFaturamento: '',
  dataEmissao: '', prazoLogistica: '', pagamentoLogistica: '', envioCliente: '',
  envioPalestrante: '', prazoAssinaturaPalestrante: '', dataAssinaturaPalestrante: '',
  reunioes: [],
  ...t,
})

// ponytail: esta é a régua de calibração. Os prazos são proposta minha, não
// regra medida no HubSpot — ajuste aqui, o cálculo não precisa mudar.
//
// Etapas abertas do pipeline CS (748675953) e até quando o ticket pode ficar em
// cada uma, em dias relativos à data do evento. Negativo = tem que sair antes
// do evento; positivo = depois.
// O prazo é TEMPO NA ETAPA, contado de quando o ticket entrou nela — não
// distância até o evento. Isso importa: na versão anterior, medida contra a
// data do evento, um ticket criado 6 dias antes da palestra já nascia com 30
// dias de atraso numa etapa que ele acabara de entrar. 21% dos tickets das
// etapas iniciais caíam nisso.
//
// 'evento' é a exceção: a etapa segura até a realização do evento.
// 'sem-prazo' não vira verde por omissão — fica cinza e aparece pedindo número.
export type Regra = { label: string; ordem: number } & (
  | { tipo: 'dias'; dias: number }
  | { tipo: 'evento' }
  | { tipo: 'sem-prazo' }
  // Etapa medida pelos relógios da Tramitação: o prazo não é tempo parado, é
  // distância até um marco, e a etapa pode ter mais de um correndo.
  | { tipo: 'relogio' }
)

// Ordem e rótulos espelham o board do HubSpot, relidos da API em 05/10/2026.
// O CS virou o funil da Tramitação e as etapas passaram a ter nome de ação:
// Contratar Logística, Assinar Contrato, Faturar, Realizar Briefing. Nessa
// rodada "Aguardando Onboarding" deixou de existir e "Coleta de NPS" entrou.
// Etapa que existe no HubSpot e falta aqui some do painel sem avisar — foi o
// que aconteceu com Logística e Contrato, e sumiram 152 tickets.
export const SLA: Record<string, Regra> = {
  '1450325173': { label: 'Contratar Logística', ordem: 1, tipo: 'relogio' },
  '1450325174': { label: 'Assinar Contrato', ordem: 2, tipo: 'relogio' },
  '1450683393': { label: 'Faturar', ordem: 3, tipo: 'relogio' },
  '1450325175': { label: 'Realizar Briefing', ordem: 4, tipo: 'relogio' },
  '1448673032': { label: 'Aguardando Evento', ordem: 5, tipo: 'evento' },
  // Etapa nova, sem regra de prazo acordada: cinza mostrando o tempo parado.
  '1451268423': { label: 'Coleta de NPS', ordem: 6, tipo: 'sem-prazo' },
  '1088361911': { label: 'Pagamento Pós-Palestra', ordem: 7, tipo: 'dias', dias: 20 },
  '1333136740': { label: 'Aguardando NF Palestrante', ordem: 8, tipo: 'dias', dias: 20 },
  // O HubSpot jogou "Em andamento" para o fim do board e ela está com zero
  // ticket. Fica aqui porque continua aberta lá, e some do quadro sozinha
  // enquanto ninguém a usar.
  '1088360205': { label: 'Em andamento', ordem: 13, tipo: 'dias', dias: 20 },
}

// Ficam fora do painel por decisao do CS: nao ha prazo acordado para elas e
// nao sao etapas de atuacao do farmer. Aparecem aqui so para rotular um ticket
// que mude de etapa enquanto a pagina esta aberta.
export const FORA_DO_ESCOPO: Record<string, string> = {
  '1088360203': 'Etapa de conferência',
}

export const prazoEmTexto = (r: Regra) =>
  r.tipo === 'dias'
    ? `${r.dias} dias na etapa`
    : r.tipo === 'evento'
      ? 'até o evento'
      : r.tipo === 'relogio'
        ? REGRA_EM_TEXTO[r.label] ?? 'por marco'
        : 'sem prazo'

// Resumo da regra para o cabeçalho da coluna. Fica aqui e não em relogios.ts
// para o painel não precisar importar a lógica só para escrever um subtítulo.
const REGRA_EM_TEXTO: Record<string, string> = {
  'Contratar Logística': 'prazo de aquisição · pagamento previsto',
  'Assinar Contrato':
    'envio 1 dia útil após o onboarding · assinatura na data do prazo · minuta do palestrante conforme o formato',
  'Realizar Briefing': 'agendar entre D-30 e D-25 · realizar entre D-15 e D-10',
  'Faturar': 'emissão em até 3 dias após a assinatura',
}

// As outras 4 etapas do CS têm closed_date preenchido — ticket encerrado, sai
// da sinaleira. Aprovação Arquivo (422) e Stand by (27) entram aqui porque
// foram parados de propósito, não por atraso.
export const ENCERRADAS: Record<string, string> = {
  '1088361912': 'Aprovação Arquivo',
  '1088361913': 'Stand by',
  '1088360206': 'Concluído',
  '1108384635': 'Cancelado',
}

export const AMARELO_ANTES = 5
export const TOLERANCIA = 7

const DIA = 86400000
const dia = (d: string) => Date.parse(d.slice(0, 10) + 'T00:00:00Z')
const emDias = (a: number, b: number) => Math.round((a - b) / DIA)

// Meia-noite de hoje no fuso de São Paulo. Comparar um timestamp de agora
// contra uma data em meia-noite fazia o contador virar ao meio-dia: às 14h o
// painel mostrava "30 dias de atraso" onde eram 29.
export const hojeEmDias = (hoje: number) =>
  Date.parse(
    new Date(hoje).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T00:00:00Z',
  )

// A API v3 devolve propriedade de data como "2026-09-30", e datetime como
// "2026-09-30T00:00:00Z". A camada de relatório devolve epoch em ms. Aceita as
// três: assumir um formato só foi o que derrubou o painel em produção.
export const iso = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === '') return ''
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const n = Number(s)
  if (!Number.isFinite(n)) return ''
  const d = new Date(n)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

export type Tarefa = { vence: string; aberta: boolean }

// De todas as tarefas de um ticket, vale a aberta que vence primeiro —
// inclusive se já venceu. Concluída não conta, e sem data não dá para cobrar.
export function tarefaMaisUrgente(ids: string[], tarefas: Map<string, Tarefa>) {
  const datas = ids
    .map((i) => tarefas.get(i))
    .filter((t): t is Tarefa => !!t && t.aberta && !!t.vence)
    .map((t) => t.vence)
    .sort()
  return datas[0] ?? ''
}

export type Avaliacao = {
  cor: Cor
  regua: Regua
  dias: number
  etapa: string
  vence: string
  // Frase pronta quando a cor vem de relógio: "assinatura · 6d depois do
  // prazo". Sem ela o card teria que adivinhar o que o número significa.
  texto?: string
}

const brasil = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function avaliar(
  t: Ticket,
  hoje: number = Date.now(),
  sla: Record<string, Regra> = SLA,
): Avaliacao {
  const regra = sla[t.stage]
  const agora = hojeEmDias(hoje)

  // A divisão do painel é sobre o EVENTO, não sobre a etapa. Evento no futuro
  // ainda dá pra prevenir; evento passado só dá pra fechar.
  const regua: Regua = emDias(dia(t.evento), agora) >= 0 ? 'pre' : 'pos'

  // Etapa fora da tabela, ou sem prazo acordado, não pode virar verde por
  // omissão. Fica cinza, e o número que sobe é o tempo parado, para o mais
  // esquecido aparecer primeiro mesmo sem régua.
  if (!regra || regra.tipo === 'sem-prazo' || regra.tipo === 'relogio') {
    return {
      cor: 'cinza',
      regua,
      // Sem data de entrada o tempo parado nao existe: 0 em vez de NaN, que
      // vazava para a ordenacao da matriz.
      dias: Number.isFinite(dia(t.entrouEtapa)) ? emDias(agora, dia(t.entrouEtapa)) : 0,
      etapa: regra?.label ?? FORA_DO_ESCOPO[t.stage] ?? ENCERRADAS[t.stage] ?? t.stage,
      vence: '',
    }
  }

  // Prazo por tempo na etapa depende de hs_v2_date_entered_current_stage, que
  // está em 94% dos tickets. Sem ela não dá para contar, e inventar uma data de
  // entrada é pior que admitir que falta: fica cinza.
  if (regra.tipo === 'dias' && !Number.isFinite(dia(t.entrouEtapa))) {
    return { cor: 'cinza', regua, dias: 0, etapa: regra.label, vence: '' }
  }

  const vencimento =
    regra.tipo === 'evento' ? dia(t.evento) : dia(t.entrouEtapa) + regra.dias * DIA
  const atraso = emDias(agora, vencimento)
  const base = { regua, dias: atraso, etapa: regra.label, vence: brasil(vencimento) }

  if (atraso > TOLERANCIA) return { cor: 'vermelho', ...base }
  if (atraso > -AMARELO_ANTES) return { cor: 'amarelo', ...base }
  return { cor: 'verde', ...base }
}

// Alertas de processo, acordados com o CS. São um eixo separado da cor: a cor
// diz se o ticket está travado na etapa; o alerta diz que um marco específico
// passou do prazo. Um ticket pode estar verde na etapa e ter alerta.
export type Alerta = { chave: string; texto: string }

// Prazo de assinatura: 20 dias após a realização do onboarding.
export const DIAS_ASSINATURA = 20
// Briefing: cobrado a partir de D-15 do evento.
export const DIAS_BRIEFING = 15

export function alertas(t: Ticket, hoje: number = Date.now()): Alerta[] {
  const agora = hojeEmDias(hoje)
  const out: Alerta[] = []

  // status_do_contrato está em 99% dos tickets das etapas do farmer e distingue
  // Assinado de Pendente — é o sinal mais confiável que existe hoje.
  if (t.onboarding && t.statusContrato !== 'Assinado') {
    if (emDias(agora, dia(t.onboarding) + DIAS_ASSINATURA * DIA) > 0)
      out.push({ chave: 'contrato', texto: 'Contrato pendente de assinatura' })
  }

  // Valida pela data de realização do onboarding: sem onboarding feito, o
  // briefing não teria como estar agendado. Só faz sentido antes do evento —
  // depois dele não há mais o que antecipar.
  if (!t.onboarding && t.evento && emDias(dia(t.evento), agora) >= 0) {
    if (emDias(agora, dia(t.evento) - DIAS_BRIEFING * DIA) > 0)
      out.push({ chave: 'briefing', texto: 'Call de Briefing pendente' })
  }

  return out
}

export function cliente(subject: string) {
  return subject.split(/\s+[-|]\s+/)[0].trim()
}

export function palestrante(subject: string) {
  return (subject.split(/\s+[-|]\s+/)[1] ?? '').trim()
}

export function diasParaEvento(t: Ticket, hoje: number = Date.now()) {
  return emDias(dia(t.evento), hojeEmDias(hoje))
}

// null quando falta hs_v2_date_entered_current_stage, que e 6% dos tickets.
// Sem isso o card imprimia "NaNd parado".
export function diasNaEtapa(t: Ticket, hoje: number = Date.now()) {
  const d = dia(t.entrouEtapa)
  return Number.isFinite(d) ? emDias(hojeEmDias(hoje), d) : null
}

// Dias até a próxima atividade agendada. null quando não há nenhuma — que é o
// caso de 94% dos tickets: o time praticamente não agenda tarefa aqui.
export function diasParaTarefa(t: Ticket, hoje: number = Date.now()) {
  return t.proximaTarefa ? emDias(dia(t.proximaTarefa), hojeEmDias(hoje)) : null
}

// Cada pipeline é um quadro separado — nada se mistura, nem os tickets nem a
// régua. Medido na API em 02/10/2026: o pipeline 941149608 ("TESTE |
// Tramitação") tem 7 etapas e 6 tickets, todos sem data_do_evento__ganho_
// preenchida. Por isso 'evento: false': sem data de evento não há como dividir
// antes/depois nem montar o horizonte, e inventar essa divisão seria mentir.
export type Quadro = {
  slug: string
  nome: string
  href: string
  pipeline: string
  evento: boolean
  sla: Record<string, Regra>
}

// Prazos ainda não acordados com o CS. 'sem-prazo' deixa o card cinza pedindo
// número em vez de virar verde por omissão — inventar dias aqui já custou caro
// uma vez.
export const SLA_TRAMITACAO: Record<string, Regra> = {
  '1449991474': { label: 'Em Conferência', ordem: 1, tipo: 'sem-prazo' },
  '1449991476': { label: 'Logística', ordem: 2, tipo: 'sem-prazo' },
  '1449991477': { label: 'Contrato', ordem: 3, tipo: 'sem-prazo' },
  '1449985704': { label: 'Faturamento', ordem: 4, tipo: 'sem-prazo' },
  '1449985705': { label: 'Briefing', ordem: 5, tipo: 'sem-prazo' },
  '1450153031': { label: 'Pagamento Pós Palestra', ordem: 6, tipo: 'sem-prazo' },
  '1450153032': { label: 'Aguardando NF Palestrante', ordem: 7, tipo: 'sem-prazo' },
}

export const QUADROS: Record<string, Quadro> = {
  cs: {
    slug: 'cs',
    nome: 'Tramitação CS',
    href: '/',
    pipeline: '748675953',
    evento: true,
    sla: SLA,
  },
  tramitacao: {
    slug: 'tramitacao',
    nome: 'Tramitação',
    href: '/tramitacao',
    pipeline: '941149608',
    evento: false,
    sla: SLA_TRAMITACAO,
  },
}

export const ABAS = Object.values(QUADROS).map((q) => ({ slug: q.slug, nome: q.nome, href: q.href }))
