export type Cor = 'verde' | 'amarelo' | 'vermelho' | 'cinza'
export type Regua = 'pre' | 'pos'

export type Ticket = {
  id: string
  subject: string
  stage: string
  evento: string
  curador: string | null
  entrouEtapa: string
}

// ponytail: esta é a régua de calibração. Os prazos são proposta minha, não
// regra medida no HubSpot — ajuste aqui, o cálculo não precisa mudar.
//
// Etapas abertas do pipeline CS (748675953) e até quando o ticket pode ficar em
// cada uma, em dias relativos à data do evento. Negativo = tem que sair antes
// do evento; positivo = depois.
export const SLA: Record<string, { label: string; prazo: number }> = {
  '1088360203': { label: 'Etapa de conferência', prazo: -45 },
  '1088360204': { label: 'Iniciar Trâmites', prazo: -30 },
  '1088360205': { label: 'Em andamento', prazo: 0 },
  '1088361911': { label: 'Pagamento Pós-Palestra', prazo: 15 },
  '1333136740': { label: 'Aguardando NF Palestrante', prazo: 30 },
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

  // Etapa fora da tabela não pode virar verde por omissão: fica cinza e aparece.
  if (!regra) {
    return {
      cor: 'cinza',
      regua: 'pre',
      dias: 0,
      etapa: ENCERRADAS[t.stage] ?? t.stage,
      vence: '',
    }
  }

  const vencimento = dia(t.evento) + regra.prazo * DIA
  const atraso = emDias(hoje, vencimento)
  const regua: Regua = regra.prazo <= 0 ? 'pre' : 'pos'
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
