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
  entrouEtapa: string
}

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
export type Regra =
  | { label: string; tipo: 'dias'; dias: number }
  | { label: string; tipo: 'evento' }
  | { label: string; tipo: 'sem-prazo' }

export const SLA: Record<string, Regra> = {
  '1088360203': { label: 'Etapa de conferência', tipo: 'sem-prazo' },
  '1088360204': { label: 'Aguardando Onboarding', tipo: 'dias', dias: 7 },
  '1088360205': { label: 'Em andamento', tipo: 'dias', dias: 20 },
  '1448673032': { label: 'Aguardando Evento', tipo: 'evento' },
  '1088361911': { label: 'Pagamento Pós-Palestra', tipo: 'sem-prazo' },
  '1333136740': { label: 'Aguardando NF Palestrante', tipo: 'sem-prazo' },
}

export const prazoEmTexto = (r: Regra) =>
  r.tipo === 'dias' ? `${r.dias} dias na etapa` : r.tipo === 'evento' ? 'até o evento' : 'sem prazo'

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
}

const brasil = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function avaliar(t: Ticket, hoje: number = Date.now()): Avaliacao {
  const regra = SLA[t.stage]

  // A divisão do painel é sobre o EVENTO, não sobre a etapa. Evento no futuro
  // ainda dá pra prevenir; evento passado só dá pra fechar.
  const regua: Regua = emDias(dia(t.evento), hoje) >= 0 ? 'pre' : 'pos'

  // Etapa fora da tabela, ou sem prazo acordado, não pode virar verde por
  // omissão. Fica cinza, e o número que sobe é o tempo parado, para o mais
  // esquecido aparecer primeiro mesmo sem régua.
  if (!regra || regra.tipo === 'sem-prazo') {
    return {
      cor: 'cinza',
      regua,
      dias: emDias(hoje, dia(t.entrouEtapa)),
      etapa: regra?.label ?? ENCERRADAS[t.stage] ?? t.stage,
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
  const atraso = emDias(hoje, vencimento)
  const base = { regua, dias: atraso, etapa: regra.label, vence: brasil(vencimento) }

  if (atraso > TOLERANCIA) return { cor: 'vermelho', ...base }
  if (atraso > -AMARELO_ANTES) return { cor: 'amarelo', ...base }
  return { cor: 'verde', ...base }
}

export function cliente(subject: string) {
  return subject.split(/\s+[-|]\s+/)[0].trim()
}

export function palestrante(subject: string) {
  return (subject.split(/\s+[-|]\s+/)[1] ?? '').trim()
}

export function diasParaEvento(t: Ticket, hoje: number = Date.now()) {
  return emDias(dia(t.evento), hoje)
}

export function diasNaEtapa(t: Ticket, hoje: number = Date.now()) {
  return emDias(hoje, dia(t.entrouEtapa))
}

// Dias até a próxima atividade agendada. null quando não há nenhuma — que é o
// caso de 94% dos tickets: o time praticamente não agenda tarefa aqui.
export function diasParaTarefa(t: Ticket, hoje: number = Date.now()) {
  return t.proximaTarefa ? emDias(dia(t.proximaTarefa), hoje) : null
}
