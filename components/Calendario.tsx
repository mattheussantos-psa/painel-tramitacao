'use client'

import { useMemo, useState } from 'react'
import Cabecalho from './Cabecalho'
import { Conta, Filtro, type Linha } from './Painel'
import type { Cor } from '@/lib/sinaleira'
import { FORA_DAS_SQUADS, NOMES_SQUADS } from '@/lib/squads'

const DIA = 86400000
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

const CORES: { cor: Cor; label: string }[] = [
  { cor: 'vermelho', label: 'atrasado' },
  { cor: 'amarelo', label: 'atenção' },
  { cor: 'verde', label: 'em dia' },
  { cor: 'cinza', label: 'sem prazo' },
]

// Datas em UTC de ponta a ponta. Montar a grade com o fuso local faria o mês
// começar no dia errado quando o navegador está fora de São Paulo, e o evento
// cairia na célula vizinha.
const chave = (d: Date) => d.toISOString().slice(0, 10)

// "Tipo de produto" traz o produto inteiro — "Palestra Presencial",
// "Treinamento Online", "Mestre de Cerimônias Presencial". No chip cabe só a
// modalidade; o resto vai no title do botão.
const MODALIDADE: { teste: RegExp; curto: string; cor: string }[] = [
  { teste: /presencial/i, curto: 'Presencial', cor: 'var(--verde)' },
  { teste: /online/i, curto: 'Online', cor: 'var(--link)' },
  { teste: /híbrid/i, curto: 'Híbrida', cor: 'var(--amarelo)' },
]
const modalidade = (tipo: string) => MODALIDADE.find((m) => m.teste.test(tipo)) ?? null
const doIso = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00Z')

export default function Calendario({
  linhas: todas,
  hoje,
  aoVivo,
  atualizadoEm,
  capturadoEm,
}: {
  linhas: Linha[]
  hoje: string
  aoVivo: boolean
  atualizadoEm: string
  capturadoEm: string
}) {
  const [squad, setSquad] = useState('')

  // O recorte da gestora vem antes de tudo: contagem do mês, cores e a linha
  // de "sem data de evento" têm que falar da equipe dela, não da base inteira.
  const linhas = useMemo(
    () =>
      squad
        ? todas.filter((l) => (squad === FORA_DAS_SQUADS ? !l.squad : l.squad === squad))
        : todas,
    [todas, squad],
  )

  const squads = useMemo(() => {
    const existentes = NOMES_SQUADS.filter((s) => todas.some((l) => l.squad === s))
    return todas.some((l) => !l.squad) ? [...existentes, FORA_DAS_SQUADS] : existentes
  }, [todas])

  const inicio = doIso(hoje)
  const [mes, setMes] = useState(() => new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), 1)))
  const [cor, setCor] = useState<Cor | null>(null)
  const [conta, setConta] = useState<Linha | null>(null)

  const porDia = useMemo(() => {
    const m = new Map<string, Linha[]>()
    for (const l of linhas) {
      if (!l.evento) continue
      const k = l.evento.slice(0, 10)
      const lista = m.get(k) ?? []
      lista.push(l)
      m.set(k, lista)
    }
    for (const lista of m.values()) lista.sort((a, b) => a.cliente.localeCompare(b.cliente, 'pt-BR'))
    return m
  }, [linhas])

  const semEvento = linhas.filter((l) => !l.evento).length

  // A grade sempre começa no domingo da semana do dia 1 e fecha a última
  // semana inteira: mês que começa numa quinta deixaria quatro células vazias
  // sem isso, e a leitura por linha de semana quebra.
  const dias = useMemo(() => {
    const primeiro = new Date(mes)
    const comeco = new Date(primeiro.getTime() - primeiro.getUTCDay() * DIA)
    const fim = new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() + 1, 0))
    const total = Math.ceil((fim.getTime() - comeco.getTime()) / DIA / 7 + 0.0001) * 7
    return Array.from({ length: Math.max(total, 35) }, (_, i) => new Date(comeco.getTime() + i * DIA))
  }, [mes])

  const doMes = useMemo(
    () => dias.filter((d) => d.getUTCMonth() === mes.getUTCMonth()).flatMap((d) => porDia.get(chave(d)) ?? []),
    [dias, mes, porDia],
  )

  const contagem = useMemo(() => {
    const c: Record<Cor, number> = { vermelho: 0, amarelo: 0, verde: 0, cinza: 0 }
    for (const l of doMes) c[l.cor]++
    return c
  }, [doMes])

  const mostra = (l: Linha) => !cor || l.cor === cor

  // Semana corrente, de domingo a sábado, para o "quais eventos tenho na
  // semana" sair da tela sem contar no dedo.
  const domingo = new Date(inicio.getTime() - inicio.getUTCDay() * DIA)
  const naSemana = (d: Date) => d >= domingo && d.getTime() < domingo.getTime() + 7 * DIA

  const andar = (n: number) => setMes(new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() + n, 1)))

  return (
    <main style={{ maxWidth: 1680, margin: '0 auto', padding: '44px 32px 72px' }}>
      <Cabecalho
        slug="calendario"
        resumo={`${linhas.length} tickets abertos`}
        aoVivo={aoVivo}
        atualizadoEm={atualizadoEm}
        capturadoEm={capturadoEm}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          rowGap: 10,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => andar(-1)} aria-label="Mês anterior" style={BOTAO}>
            ‹
          </button>
          <span style={{ fontSize: 17, fontWeight: 600, minWidth: 168 }}>
            {MES[mes.getUTCMonth()]} de {mes.getUTCFullYear()}
          </span>
          <button onClick={() => andar(1)} aria-label="Próximo mês" style={BOTAO}>
            ›
          </button>
          <button
            onClick={() => setMes(new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), 1)))}
            style={{ ...BOTAO, width: 'auto', padding: '0 12px', fontSize: 13 }}
          >
            Hoje
          </button>
          {squads.length > 0 && (
            <Filtro vazio="Squad" valor={squad} opcoes={squads} aoMudar={setSquad} />
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CORES.filter((c) => c.cor !== 'cinza' || contagem.cinza > 0).map(({ cor: c, label }) => {
            const marcado = cor === c
            return (
              <button
                key={c}
                onClick={() => setCor(marcado ? null : c)}
                aria-pressed={marcado}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  height: 34,
                  padding: '0 13px',
                  border: 0,
                  borderRadius: 8,
                  fontSize: 13,
                  color: 'var(--text)',
                  background: marcado ? `var(--${c}-bg)` : 'var(--cinza-bg)',
                  boxShadow: marcado ? `inset 0 0 0 1.5px var(--${c}-ponto)` : 'none',
                }}
              >
                <i style={{ width: 9, height: 9, borderRadius: 5, background: `var(--${c}-ponto)` }} />
                <b style={{ fontWeight: 600, color: `var(--${c})`, fontVariantNumeric: 'tabular-nums' }}>
                  {contagem[c]}
                </b>
                <span>{label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 }}>
        {SEMANA.map((d) => (
          <div key={d} style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 4px 4px' }}>
            {d}
          </div>
        ))}

        {dias.map((d) => {
          const k = chave(d)
          const deste = k === hoje
          const fora = d.getUTCMonth() !== mes.getUTCMonth()
          const eventos = (porDia.get(k) ?? []).filter(mostra)
          return (
            <div
              key={k}
              style={{
                minHeight: 130,
                borderRadius: 11,
                padding: 7,
                background: fora ? 'transparent' : 'var(--cinza-bg)',
                opacity: fora ? 0.45 : 1,
                boxShadow: deste
                  ? 'inset 0 0 0 2px var(--link)'
                  : naSemana(d) && !fora
                    ? 'inset 0 0 0 1px var(--text-3)'
                    : 'none',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  fontWeight: deste ? 700 : 500,
                  padding: '0 3px 5px',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <span>{d.getUTCDate()}</span>
                {eventos.length > 1 && <span style={{ fontSize: 11 }}>{eventos.length}</span>}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {eventos.map((l) => {
                  const m = modalidade(l.tipoProduto)
                  return (
                    <button
                      key={l.id}
                      onClick={() => setConta(l)}
                      title={`${l.cliente} — ${l.palestrante || 'sem palestrante'} · ${l.etapa}${
                        l.tipoProduto ? ` · ${l.tipoProduto}` : ''
                      }`}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        border: 0,
                        borderRadius: 7,
                        padding: '5px 7px',
                        font: 'inherit',
                        lineHeight: 1.25,
                        color: `var(--${l.cor})`,
                        background: `var(--${l.cor}-bg)`,
                        boxShadow: `inset 2px 0 0 var(--${l.cor}-ponto)`,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11.5,
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {l.cliente}
                      </span>
                      {m && (
                        <span
                          style={{
                            display: 'inline-block',
                            margin: '3px 0 2px',
                            padding: '0 5px',
                            borderRadius: 4,
                            fontSize: 9.5,
                            fontWeight: 600,
                            letterSpacing: '0.02em',
                            color: m.cor,
                            boxShadow: `inset 0 0 0 1px ${m.cor}`,
                          }}
                        >
                          {m.curto}
                        </span>
                      )}
                      {/* Quem responde pelo ticket. Nome do proprietário, que é
                          por onde as squads são montadas. */}
                      <span
                        style={{
                          display: 'block',
                          fontSize: 10,
                          fontWeight: 500,
                          opacity: 0.8,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {l.proprietario ?? 'sem proprietário'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '16px 0 0' }}>
        {doMes.length} {doMes.length === 1 ? 'evento' : 'eventos'} em {MES[mes.getUTCMonth()]}
        {semEvento > 0 && ` · ${semEvento} ${semEvento === 1 ? 'ticket ficou' : 'tickets ficaram'} de fora por não ter data de evento`}
      </p>

      {conta && <Conta l={conta} aoFechar={() => setConta(null)} />}
    </main>
  )
}

const BOTAO: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 8,
  border: 0,
  background: 'var(--cinza-bg)',
  color: 'var(--text)',
  font: 'inherit',
  fontSize: 17,
  lineHeight: '34px',
  padding: 0,
}
