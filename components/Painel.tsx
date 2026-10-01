'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { SLA, prazoEmTexto, type Cor, type Regua } from '@/lib/sinaleira'

export type Linha = {
  id: string
  link: string
  cliente: string
  palestrante: string
  evento: string
  diasEvento: number
  diasNaEtapa: number | null
  diasTarefa: number | null
  alertas: { chave: string; texto: string }[]
  stage: string
  curador: string | null
  curadorInativo: boolean
  proprietario: string | null
  proprietarioInativo: boolean
  cor: Cor
  regua: Regua
  dias: number
  etapa: string
  vence: string
}

// Todo controle da barra usa esta medida. Antes o segmented, os selects e os
// chips tinham três alturas diferentes na mesma linha.
const CONTROLE: React.CSSProperties = {
  height: 34,
  borderRadius: 8,
  border: 0,
  padding: '0 12px',
  fontSize: 13,
  lineHeight: '34px',
  background: 'var(--cinza-bg)',
  color: 'var(--text-2)',
  whiteSpace: 'nowrap',
}

// Deriva da mesma tabela de SLA da régua, ordenada pelo prazo — que é a ordem
// do kanban. Duplicar a lista aqui faria o cabeçalho mentir assim que alguém
// calibrasse os prazos em lib/sinaleira.
const ETAPAS_KANBAN = Object.entries(SLA).map(([id, r]) => ({ id, label: r.label, prazo: prazoEmTexto(r) }))

const LINHA_RANKING: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 56px 62px 56px 56px',
  gap: 4,
  padding: '11px 18px',
  alignItems: 'center',
}

const CORES: { cor: Cor; label: string }[] = [
  { cor: 'vermelho', label: 'Atrasado' },
  { cor: 'amarelo', label: 'Atenção' },
  { cor: 'verde', label: 'Em dia' },
  { cor: 'cinza', label: 'Sem prazo' },
]

const dataBr = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—')

// Só 6% dos tickets têm atividade futura agendada. "Sem tarefa" não é campo
// vazio a esconder: é ticket que ninguém marcou para tocar.
function tarefa(l: Linha) {
  if (l.diasTarefa === null) return { texto: 'sem tarefa', cor: 'var(--text-2)' }
  if (l.diasTarefa < 0)
    return { texto: `tarefa venceu há ${-l.diasTarefa}d`, cor: 'var(--vermelho)' }
  if (l.diasTarefa === 0) return { texto: 'tarefa hoje', cor: 'var(--amarelo)' }
  return {
    texto: `tarefa em ${l.diasTarefa}d`,
    cor: l.diasTarefa <= 2 ? 'var(--amarelo)' : 'var(--text-2)',
  }
}

function prazo(l: Linha) {
  if (l.cor === 'cinza') return 'sem prazo'
  if (l.dias > 0) return `${l.dias}d de atraso`
  if (l.dias === 0) return 'vence hoje'
  return `em ${-l.dias}d`
}

function Ponto({ cor, tamanho = 8 }: { cor: Cor; tamanho?: number }) {
  return (
    <span
      style={{
        width: tamanho,
        height: tamanho,
        borderRadius: tamanho,
        background: `var(--${cor}-ponto)`,
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  )
}

// Container agrupado: uma superfície, hairlines por dentro. É o padrão de lista
// do iOS e do macOS — a alternativa era uma borda por item, que vira ruído.
function Grupo({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div style={{ background: 'var(--card)', borderRadius: 12, overflow: 'hidden', ...style }}>
      {children}
    </div>
  )
}

type Faixa = { rotulo: string; dentro: (l: Linha) => boolean }

// Futuro: quanto falta para o evento. Passado: há quanto tempo ele aconteceu e
// o ticket segue aberto. As faixas do passado são mais largas de propósito —
// tem ticket com evento há mais de 300 dias, e 0–7 ali não separaria nada.
const FAIXAS: Record<Regua, Faixa[]> = {
  pre: [
    { rotulo: '0–7 dias', dentro: (l) => l.diasEvento >= 0 && l.diasEvento <= 7 },
    { rotulo: '8–15 dias', dentro: (l) => l.diasEvento >= 8 && l.diasEvento <= 15 },
    { rotulo: '16–30 dias', dentro: (l) => l.diasEvento >= 16 && l.diasEvento <= 30 },
  ],
  pos: [
    { rotulo: 'até 15 dias', dentro: (l) => -l.diasEvento <= 15 },
    { rotulo: '16–30 dias', dentro: (l) => -l.diasEvento >= 16 && -l.diasEvento <= 30 },
    { rotulo: '31–90 dias', dentro: (l) => -l.diasEvento >= 31 && -l.diasEvento <= 90 },
    { rotulo: 'mais de 90 dias', dentro: (l) => -l.diasEvento > 90 },
  ],
}

const TITULO: Record<Regua, { chapeu: string; descricao: string; preposicao: string }> = {
  pre: {
    chapeu: 'Evento em até 30 dias',
    descricao: 'Data prevista do evento nos próximos 30 dias · por sinal',
    preposicao: 'em',
  },
  pos: {
    chapeu: 'Evento já realizado',
    descricao: 'Ticket ainda aberto depois do evento · por sinal',
    preposicao: 'há',
  },
}

// Texto sobre a barra: no laranja o branco não passa no contraste, então vai
// escuro. Nos outros dois o branco é o que lê.
const SOBRE_BARRA: Record<Cor, string> = {
  vermelho: '#fff',
  amarelo: '#3d2400',
  verde: '#04340f',
  cinza: '#fff',
}

// <dialog> nativo em vez de modal à mão: Esc, trava de foco e backdrop já vêm
// no elemento, e ele fica na top layer, sem briga de z-index.
function Detalhe({
  titulo,
  itens,
  aoFechar,
}: {
  titulo: string
  itens: Linha[]
  aoFechar: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (!d.open) d.showModal()
  }, [])

  const ordenados = [...itens].sort((a, b) => b.dias - a.dias)

  return (
    <dialog
      ref={ref}
      onClose={aoFechar}
      onClick={(e) => {
        // Clique no backdrop chega no próprio <dialog>; no conteúdo, não.
        if (e.target === ref.current) ref.current?.close()
      }}
      style={{
        width: 'min(680px, calc(100vw - 32px))',
        maxHeight: '76vh',
        padding: 0,
        border: 0,
        borderRadius: 14,
        background: 'var(--card)',
        color: 'var(--text)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '15px 18px',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <span>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{titulo}</span>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
            {itens.length} {itens.length === 1 ? 'ticket' : 'tickets'} · abre no HubSpot
          </span>
        </span>
        <button
          onClick={() => ref.current?.close()}
          aria-label="Fechar"
          style={{ ...CONTROLE, width: 34, padding: 0, fontSize: 16, color: 'var(--text-2)' }}
        >
          ✕
        </button>
      </div>

      <div style={{ overflowY: 'auto', overflowX: 'hidden', maxHeight: 'calc(76vh - 68px)' }}>
        {ordenados.map((l, i) => (
          <a
            key={l.id}
            href={l.link}
            target="_blank"
            rel="noreferrer"
            className="linha"
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              alignItems: 'center',
              gap: 12,
              padding: '11px 18px',
              borderTop: i ? '1px solid var(--line)' : 0,
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <Ponto cor={l.cor} />
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 14,
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {l.cliente}
              </span>
              <span
                style={{
                  display: 'block',
                  fontSize: 12,
                  color: 'var(--text-3)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {l.proprietario ? `Proprietário ${l.proprietario}` : 'Sem proprietário'}
                {l.proprietarioInativo ? ' · inativo' : ''}
              </span>
            </span>
            <span
              style={{
                fontSize: 13,
                color: `var(--${l.cor})`,
                whiteSpace: 'nowrap',
                textAlign: 'right',
              }}
            >
              {prazo(l)}
            </span>
          </a>
        ))}
      </div>
    </dialog>
  )
}

// Horizonte por data do evento. Antes do evento mede o que falta; depois mede
// há quanto tempo o ticket está aberto sem o evento existir mais.
//
// Clicar abre a lista daquele recorte num diálogo, em vez de filtrar o painel:
// a pergunta é "quais são esses", e o filtro obrigava a rolar até os cards.
function Horizonte({
  linhas,
  regua,
  aoAbrir,
}: {
  linhas: Linha[]
  regua: Regua
  aoAbrir: (titulo: string, itens: Linha[]) => void
}) {
  const cores: Cor[] = ['vermelho', 'amarelo', 'verde', 'cinza']
  const { chapeu, descricao, preposicao } = TITULO[regua]

  const faixas = FAIXAS[regua].map((f) => {
    const dentro = linhas.filter(f.dentro)
    const por = Object.fromEntries(
      cores.map((c) => [c, dentro.filter((l) => l.cor === c).length]),
    ) as Record<Cor, number>
    return { ...f, total: dentro.length, por }
  })

  const total = faixas.reduce((s, f) => s + f.total, 0)
  if (!total) return null

  return (
    <Grupo style={{ marginTop: 28, marginBottom: 18, padding: "18px 20px 20px" }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          color: 'var(--text-2)',
        }}
      >
        {chapeu}
      </div>
      <div
        style={{
          fontFamily: 'var(--display)',
          fontSize: 40,
          fontWeight: 800,
          lineHeight: 1.1,
          marginTop: 2,
        }}
      >
        {total}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
        {descricao}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        {CORES.filter((c) => faixas.some((f) => f.por[c.cor] > 0)).map(({ cor, label }) => (
          <span
            key={cor}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--text-2)',
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: `var(--${cor}-ponto)`,
              }}
            />
            {label}
          </span>
        ))}
      </div>

      {faixas.map((f) => {
        return (
          <div key={f.rotulo} style={{ marginBottom: 14 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 6,
              }}
            >
              <button
                onClick={() => aoAbrir(`Evento ${preposicao} ${f.rotulo}`, linhas.filter(f.dentro))}
                disabled={!f.total}
                style={{
                  border: 0,
                  background: 'transparent',
                  padding: 0,
                  fontSize: 14,
                  color: 'var(--text)',
                  cursor: f.total ? 'pointer' : 'default',
                  // Numa propriedade só: o React avisa quando o atalho e a
                  // versão detalhada do mesmo valor mudam juntos no rerender.
                  textDecoration: f.total ? 'underline var(--text-3)' : 'none',
                  textUnderlineOffset: 3,
                }}
              >
                {f.rotulo}{' '}
                <span style={{ color: 'var(--text-2)' }}>
                  {f.total} {f.total === 1 ? 'ticket' : 'tickets'}
                </span>
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {f.por.vermelho > 0 ? (
                  <>
                    <b style={{ color: 'var(--vermelho)', fontWeight: 600 }}>{f.por.vermelho}</b> em
                    atraso
                  </>
                ) : (
                  'nenhum em atraso'
                )}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                height: 26,
                borderRadius: 6,
                overflow: 'hidden',
                background: 'var(--cinza-bg)',
              }}
            >
              {cores
                .filter((c) => f.por[c] > 0)
                .map((c) => {
                  const rotuloCor = CORES.find((x) => x.cor === c)?.label.toLowerCase()
                  return (
                    <button
                      key={c}
                      onClick={() =>
                        aoAbrir(
                          `${CORES.find((x) => x.cor === c)?.label} · evento ${preposicao} ${f.rotulo}`,
                          linhas.filter((l) => f.dentro(l) && l.cor === c),
                        )
                      }
                      aria-label={`Ver ${f.por[c]} em ${rotuloCor}, evento ${preposicao} ${f.rotulo}`}
                      style={{
                        flexGrow: f.por[c],
                        flexBasis: 0,
                        minWidth: 26,
                        border: 0,
                        background: `var(--${c}-ponto)`,
                        color: SOBRE_BARRA[c],
                        fontSize: 12,
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {f.por[c]}
                    </button>
                  )
                })}
            </div>
          </div>
        )
      })}
    </Grupo>
  )
}

// Os cards se ajustam à largura: em tela larga viram 5 colunas em vez de
// deixar meia tela vazia dos dois lados.
// Matriz ticket × etapa do kanban. Cada ticket está em uma etapa só, então a
// linha marca onde ele parou e a cor diz o sinal. Serve para ver a carteira de
// uma pessoa inteira sem abrir ticket por ticket.
function Matriz({
  linhas,
  etapas,
  aoAbrir,
}: {
  linhas: Linha[]
  etapas: { id: string; label: string; prazo: string }[]
  aoAbrir: (l: Linha) => void
}) {
  const grade = `minmax(180px, 1.4fr) 92px 96px repeat(${etapas.length}, minmax(86px, 1fr))`

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 700 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: grade,
            gap: 4,
            padding: '10px 16px',
            fontSize: 11,
            color: 'var(--text-3)',
          }}
        >
          <span>Ticket</span>
          <span style={{ textAlign: 'right' }}>Evento</span>
          <span style={{ textAlign: 'right' }}>Tarefa</span>
          {etapas.map((e) => (
            <span key={e.id} style={{ textAlign: 'center', lineHeight: 1.3 }}>
              {e.label}
              <span style={{ display: 'block', color: 'var(--text-3)', opacity: 0.75 }}>
                {e.prazo}
              </span>
            </span>
          ))}
        </div>

        {linhas.map((l) => (
          <button
            key={l.id}
            onClick={() => aoAbrir(l)}
            className="linha"
            style={{
              display: 'grid',
              gridTemplateColumns: grade,
              gap: 4,
              alignItems: 'center',
              width: '100%',
              textAlign: 'left',
              border: 0,
              borderTop: '1px solid var(--line)',
              background: 'transparent',
              color: 'var(--text)',
              padding: '9px 16px',
              fontSize: 13,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {l.cliente}
            </span>
            <span style={{ textAlign: 'right', color: 'var(--text-2)', fontSize: 12 }}>
              {dataBr(l.evento)}
            </span>
            <span style={{ textAlign: 'right', fontSize: 12, color: tarefa(l).cor }}>
              {l.diasTarefa === null ? '—' : `${l.diasTarefa}d`}
            </span>

            {etapas.map((e) => (
              <span key={e.id} style={{ display: 'flex', justifyContent: 'center' }}>
                {l.stage === e.id ? (
                  <span
                    style={{
                      background: `var(--${l.cor}-ponto)`,
                      color: SOBRE_BARRA[l.cor],
                      borderRadius: 6,
                      padding: '3px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {prazo(l)}
                  </span>
                ) : (
                  <span style={{ color: 'var(--line)' }}>·</span>
                )}
              </span>
            ))}
          </button>
        ))}
      </div>
    </div>
  )
}

function Cartao({ l }: { l: Linha }) {
  const t = tarefa(l)
  return (
    <a
      href={l.link}
      target="_blank"
      rel="noreferrer"
      className="cartao"
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        // O fundo tingido é o sinal. A barra vai como sombra interna e não
        // como border-left: assim ela acompanha o raio do canto em vez de
        // cortar reto nas pontas.
        background: `var(--${l.cor}-bg)`,
        boxShadow: `inset 3px 0 0 var(--${l.cor}-ponto)`,
        border: '1px solid transparent',
        borderRadius: 12,
        padding: '11px 13px 11px 15px',
      }}
    >
      {/* O prazo é a informação que justifica o card existir, então abre. */}
      <span
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 7,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: `var(--${l.cor})`,
            whiteSpace: 'nowrap',
          }}
        >
          {prazo(l)}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
          evento {dataBr(l.evento)}
        </span>
      </span>

      {/* Deixa quebrar em duas linhas: cortar o nome do cliente no meio é o
          que mais atrapalha a leitura numa coluna estreita. */}
      <span
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          lineHeight: 1.3,
        }}
      >
        {l.cliente}
      </span>
      <span
        style={{
          display: 'block',
          fontSize: 12,
          color: 'var(--text)',
          marginTop: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {l.palestrante || '—'}
      </span>

      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          marginTop: 9,
          paddingTop: 8,
          borderTop: '1px solid var(--linha-sobre-cor)',
          fontSize: 11,
          color: 'var(--text-2)',
        }}
      >
        <span>{l.diasNaEtapa === null ? 'sem data de entrada' : `${l.diasNaEtapa}d parado`}</span>
        {/* Tarefa só aparece quando existe: 94% dos tickets não têm nenhuma, e
            repetir "sem tarefa" em todo card gastava a melhor linha do topo. */}
        {l.diasTarefa !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span style={{ color: t.cor }}>{t.texto}</span>
          </>
        )}
      </span>

      <span style={{ display: 'block', fontSize: 11, marginTop: 2, lineHeight: 1.45 }}>
        <Pessoas l={l} />
      </span>

      {l.alertas.length > 0 && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 7 }}>
          {l.alertas.map((a) => (
            <span
              key={a.chave}
              style={{
                background: 'var(--card)',
                color: 'var(--vermelho)',
                borderRadius: 5,
                padding: '2px 7px',
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              {a.texto}
            </span>
          ))}
        </span>
      )}
    </a>
  )
}

// Kanban: a etapa vira coluna e cada coluna rola sozinha. É o mesmo desenho do
// HubSpot, e dispensa o filtro de etapa — a coluna já é o filtro.
function Kanban({ colunas }: { colunas: { id: string; label: string; prazo: string; itens: Linha[] }[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${colunas.length}, minmax(300px, 1fr))`,
        gap: 12,
        alignItems: 'start',
      }}
    >
      {colunas.map((col) => (
        <div key={col.id} style={{ background: 'var(--cinza-bg)', borderRadius: 14, padding: 10, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '4px 6px 10px' }}>
            <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {col.label}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{col.itens.length}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', padding: '0 6px 10px' }}>{col.prazo}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100vh - 220px)', overflowY: 'auto', overflowX: 'hidden' }}>
            {col.itens.map((l) => (
              <Cartao key={l.id} l={l} />
            ))}
            {col.itens.length === 0 && (
              <p style={{ color: 'var(--text-3)', fontSize: 13, padding: '10px 6px', margin: 0 }}>Nada aqui.</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function Grade({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 12,
      }}
    >
      {children}
    </div>
  )
}

// Papel rotulado, mas sem linha vazia quando o campo falta: a versão com
// "Curador —" fixo em todo card era ruído. Quando as duas pessoas são a mesma,
// sai um rótulo só em vez do nome repetido.
function Pessoas({ l }: { l: Linha }) {
  const mesma = l.curador && l.curador === l.proprietario
  const papeis: { papel: string; nome: string; inativo: boolean }[] = mesma
    ? [{ papel: 'Curador e proprietário', nome: l.curador!, inativo: l.curadorInativo }]
    : [
        ...(l.curador ? [{ papel: 'Curador', nome: l.curador, inativo: l.curadorInativo }] : []),
        ...(l.proprietario
          ? [{ papel: 'Proprietário', nome: l.proprietario, inativo: l.proprietarioInativo }]
          : []),
      ]

  if (!papeis.length) {
    return <span style={{ color: 'var(--vermelho)' }}>Sem curador e sem proprietário</span>
  }

  return (
    <>
      {papeis.map(({ papel, nome, inativo }) => (
        <span
          key={papel}
          style={{
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {/* Sem cinza no card: o fundo tingido come o --text-3 e o rodape
              vira decoracao em vez de informacao. */}
          <span style={{ color: 'var(--text-2)' }}>{papel} </span>
          <span style={{ color: inativo ? 'var(--vermelho)' : 'var(--text)' }}>
            {nome}
            {inativo ? ' · inativo' : ''}
          </span>
        </span>
      ))}
    </>
  )
}

// Select de opções já rotuladas, para etapa e para os liga/desliga. Mesma
// caixa do Filtro, para a barra inteira ter um tipo de controle só.
function Escolha({
  vazio,
  valor,
  opcoes,
  aoMudar,
}: {
  vazio: string
  valor: string
  opcoes: { v: string; r: string }[]
  aoMudar: (v: string) => void
}) {
  if (!opcoes.length) return null
  return (
    <select
      value={valor}
      onChange={(e) => aoMudar(e.target.value)}
      style={{ ...CONTROLE, font: 'inherit', fontSize: 13, color: 'var(--text)', maxWidth: 230 }}
    >
      <option value="">{vazio}: todos</option>
      {opcoes.map((o) => (
        <option key={o.v} value={o.v}>
          {o.r}
        </option>
      ))}
    </select>
  )
}

function Filtro({
  vazio,
  valor,
  opcoes,
  aoMudar,
}: {
  vazio: string
  valor: string
  opcoes: string[]
  aoMudar: (v: string) => void
}) {
  return (
    <select
      value={valor}
      onChange={(e) => aoMudar(e.target.value)}
      style={{ ...CONTROLE, font: 'inherit', fontSize: 13, color: 'var(--text)', maxWidth: 210 }}
    >
      <option value="">{vazio}</option>
      {opcoes.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

export default function Painel({
  linhas,
  aoVivo,
  capturadoEm,
  atualizadoEm,
  aviso,
}: {
  linhas: Linha[]
  aoVivo: boolean
  capturadoEm: string
  atualizadoEm: string
  aviso?: string
}) {
  const [regua, setRegua] = useState<'pre' | 'pos'>('pre')
  const [cor, setCor] = useState<Cor | null>(null)
  const [curador, setCurador] = useState('')
  const [proprietario, setProprietario] = useState('')
  const [semDono, setSemDono] = useState(false)
  const [comTarefa, setComTarefa] = useState(false)
  const [alerta, setAlerta] = useState('')
  const [detalhe, setDetalhe] = useState<{ titulo: string; itens: Linha[] } | null>(null)

  const daRegua = useMemo(() => linhas.filter((l) => l.regua === regua), [linhas, regua])

  const porPessoa = useMemo(
    () =>
      daRegua.filter(
        (l) =>
          (!curador || l.curador === curador) &&
          (!proprietario || l.proprietario === proprietario),
      ),
    [daRegua, curador, proprietario],
  )

  // Ninguém ativo no ticket: nem curador, nem proprietário. Não adianta cobrar
  // prazo de quem saiu da empresa — esses precisam de dono antes de tudo.
  const orfao = (l: Linha) =>
    (!l.curador || l.curadorInativo) && (!l.proprietario || l.proprietarioInativo)

  const orfaos = useMemo(() => porPessoa.filter(orfao).length, [porPessoa])

  const porAlerta = useMemo(() => {
    const m = new Map<string, { texto: string; n: number }>()
    for (const l of porPessoa)
      for (const a of l.alertas)
        m.set(a.chave, { texto: a.texto, n: (m.get(a.chave)?.n ?? 0) + 1 })
    return [...m.entries()].sort((x, y) => y[1].n - x[1].n)
  }, [porPessoa])

  const comTarefas = useMemo(() => porPessoa.filter((l) => l.diasTarefa !== null).length, [porPessoa])

  const base = porPessoa.filter(
    (l) =>
      (!semDono || orfao(l)) &&
      (!comTarefa || l.diasTarefa !== null) &&
      (!alerta || l.alertas.some((a) => a.chave === alerta)),
  )

  const comEtapa = base


  // A cor fica de fora da contagem de propósito: se entrasse, clicar em
  // "Atrasado" zerava os outros três e a pessoa perdia a visão do quadro.
  const contagem = useMemo(() => {
    const c: Record<Cor, number> = { vermelho: 0, amarelo: 0, verde: 0, cinza: 0 }
    for (const l of comEtapa) c[l.cor]++
    return c
  }, [comEtapa])

  const visiveis = comEtapa.filter((l) => !cor || l.cor === cor)

  // Uma coluna por etapa, na ordem do kanban do HubSpot. Dentro da coluna, por
  // data do evento: ordenar por atraso empilharia os vermelhos no topo e os
  // verdes no fim, e a leitura de sinaleira some quando a cor vira bloco.
  const colunas = useMemo(
    () =>
      Object.entries(SLA)
        .sort(([, a], [, b]) => a.ordem - b.ordem)
        .map(([id, r]) => ({
          id,
          label: r.label,
          prazo: prazoEmTexto(r),
          itens: visiveis
            .filter((l) => l.stage === id)
            .sort((a, b) => a.evento.localeCompare(b.evento)),
        })),
    [visiveis],
  )

  // Ranking lê a aba inteira de propósito: se respeitasse o filtro de
  // proprietário, viraria uma linha só e deixaria de servir para escolher.
  const ranking = useMemo(() => {
    const m = new Map<string, Record<Cor, number>>()
    for (const l of daRegua) {
      const nome = l.proprietario ?? 'Sem proprietário'
      const r = m.get(nome) ?? { vermelho: 0, amarelo: 0, verde: 0, cinza: 0 }
      r[l.cor]++
      m.set(nome, r)
    }
    return [...m.entries()]
      .map(([nome, r]) => ({ nome, ...r, total: r.vermelho + r.amarelo + r.verde + r.cinza }))
      .sort((a, b) => b.vermelho - a.vermelho || b.total - a.total)
  }, [daRegua])

  const nomes = (campo: 'curador' | 'proprietario') =>
    Array.from(new Set(daRegua.map((l) => l[campo]).filter(Boolean) as string[])).sort((a, b) =>
      a.localeCompare(b, 'pt-BR'),
    )

  const curadores = useMemo(() => nomes('curador'), [daRegua])
  const proprietarios = useMemo(() => nomes('proprietario'), [daRegua])

  const limpar = () => {
    setCor(null)
    setCurador('')
    setProprietario('')
    setSemDono(false)
    setComTarefa(false)
    setAlerta('')
  }

  const filtrando = !!(cor || curador || proprietario || semDono || comTarefa || alerta)
  const visiveisCores = CORES.filter(({ cor: c }) => c !== 'cinza' || contagem[c] > 0)

  return (
    <main style={{ maxWidth: 1680, margin: '0 auto', padding: '44px 32px 72px' }}>
      <header style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: 'var(--display)',
            fontSize: 44,
            fontWeight: 800,
            letterSpacing: '0.01em',
            lineHeight: 1,
            margin: 0,
            textTransform: 'uppercase',
          }}
        >
          Sinaleira
        </h1>
        <p style={{ color: 'var(--text-2)', margin: '8px 0 0', fontSize: 14 }}>
          Tramitação CS · {linhas.length} tickets abertos ·{' '}
          {aoVivo ? `ao vivo, ${atualizadoEm}` : `snapshot de ${dataBr(capturadoEm)}`}
        </p>
      </header>

      {aviso && (
        <p
          style={{
            background: 'var(--amarelo-bg)',
            color: 'var(--amarelo)',
            borderRadius: 12,
            padding: '11px 14px',
            fontSize: 13,
            margin: '0 0 20px',
          }}
        >
          {aviso}
        </p>
      )}

      {/* Abas e filtros na mesma linha: sao todos recortes do mesmo conjunto,
          e separados empurravam os tickets para baixo da dobra. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          rowGap: 10,
          flexWrap: 'wrap',
          marginBottom: 18,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            background: 'var(--cinza-bg)',
            borderRadius: 8,
            padding: 2,
            height: 34,
            marginRight: 4,
          }}
        >
        {(
          [
            ['pre', 'Antes do evento'],
            ['pos', 'Depois do evento'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => {
              setRegua(v)
              limpar()
            }}
            style={{
              border: 0,
              borderRadius: 6,
              padding: '0 14px',
              fontSize: 13,
              fontWeight: regua === v ? 500 : 400,
              background: regua === v ? 'var(--card)' : 'transparent',
              color: regua === v ? 'var(--text)' : 'var(--text-2)',
            }}
          >
            {label}
          </button>
        ))}
        </div>

        {/* Etapa nao entra aqui: no kanban a coluna ja e o filtro de etapa. */}
        <Filtro vazio="Curador" valor={curador} opcoes={curadores} aoMudar={setCurador} />
        <Filtro
          vazio="Proprietário"
          valor={proprietario}
          opcoes={proprietarios}
          aoMudar={setProprietario}
        />
        <Escolha
          vazio="Tarefa"
          valor={comTarefa ? 'sim' : semDono ? '' : ''}
          opcoes={[{ v: 'sim', r: `com tarefa (${comTarefas})` }]}
          aoMudar={(v) => setComTarefa(v === 'sim')}
        />
        {orfaos > 0 && (
          <Escolha
            vazio="Responsável"
            valor={semDono ? 'sem' : ''}
            opcoes={[{ v: 'sem', r: `sem responsável ativo (${orfaos})` }]}
            aoMudar={(v) => setSemDono(v === 'sem')}
          />
        )}

        {filtrando && (
          <button
            onClick={limpar}
            style={{ ...CONTROLE, background: 'transparent', color: 'var(--text-3)' }}
          >
            Limpar
          </button>
        )}
      </div>

      {/* Números sobre superfície neutra, cor só no ponto e no algarismo. A
          versão anterior pintava três retângulos inteiros de cor semântica. */}
      <Grupo style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex' }}>
          {visiveisCores.map(({ cor: c, label }, i) => (
            <button
              key={c}
              onClick={() => setCor(cor === c ? null : c)}
              style={{
                flex: 1,
                border: 0,
                borderLeft: i ? '1px solid var(--line)' : 0,
                background: cor === c ? 'var(--cinza-bg)' : 'transparent',
                padding: '14px 18px',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  color: 'var(--text-2)',
                }}
              >
                <Ponto cor={c} />
                {label}
              </span>
              <div
                style={{
                  fontSize: 30,
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                  marginTop: 2,
                  color: `var(--${c})`,
                }}
              >
                {contagem[c]}
              </div>
            </button>
          ))}
        </div>
      </Grupo>

      {/* Alerta é contagem antes de ser filtro: "23 contratos pendentes" é a
          informação. Ficava escondido numa fileira de chips igual aos outros. */}
      {porAlerta.length > 0 && (
        <Grupo style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex' }}>
            {porAlerta.map(([chave, a], i) => (
              <button
                key={chave}
                onClick={() => setAlerta(alerta === chave ? '' : chave)}
                style={{
                  flex: 1,
                  border: 0,
                  borderLeft: i ? '1px solid var(--line)' : 0,
                  background: alerta === chave ? 'var(--vermelho-bg)' : 'transparent',
                  padding: '13px 18px',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 13,
                    color: 'var(--text-2)',
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      background: 'var(--vermelho-ponto)',
                    }}
                  />
                  {a.texto}
                </span>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 600,
                    letterSpacing: '-0.02em',
                    marginTop: 2,
                    color: 'var(--vermelho)',
                  }}
                >
                  {a.n}
                </div>
              </button>
            ))}
          </div>
        </Grupo>
      )}

      {detalhe && (
        <Detalhe
          titulo={detalhe.titulo}
          itens={detalhe.itens}
          aoFechar={() => setDetalhe(null)}
        />
      )}

      <Horizonte
        linhas={comEtapa}
        regua={regua}
        aoAbrir={(titulo, itens) => setDetalhe({ titulo, itens })}
      />

      <Kanban colunas={colunas} />



      {/* Ranking no fim: é leitura de gestão, não a tarefa do dia. Em cima ele
          empurrava os tickets para baixo da dobra.

          Sem corte de linhas: truncar em 6 escondia justamente quem tinha menos
          atraso mas muito volume. Clicar numa linha abre os tickets da pessoa,
          igual ao gráfico. */}
      {proprietario ? (
        <Grupo style={{ marginTop: 28 }}>
          <div
            style={{
              padding: '14px 16px 2px',
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            {proprietario}
            <span style={{ fontWeight: 400, color: 'var(--text-2)' }}>
              {' '}
              · {porPessoa.length} {porPessoa.length === 1 ? 'ticket aberto' : 'tickets abertos'}
            </span>
          </div>
          <Matriz
            linhas={[...porPessoa].sort((a, b) => b.dias - a.dias)}
            etapas={ETAPAS_KANBAN}
            aoAbrir={(l) => setDetalhe({ titulo: l.cliente, itens: [l] })}
          />
        </Grupo>
      ) : (
      <Grupo style={{ marginTop: 28, maxWidth: 620 }}>
        <div style={{ ...LINHA_RANKING, color: 'var(--text-3)', fontSize: 12 }}>
          <span>Por proprietário · {ranking.length}</span>
          <span style={{ textAlign: 'right' }}>Atraso</span>
          <span style={{ textAlign: 'right' }}>Atenção</span>
          <span style={{ textAlign: 'right' }}>Em dia</span>
          <span style={{ textAlign: 'right' }}>Total</span>
        </div>

        {ranking.map((r) => (
          <button
            key={r.nome}
            onClick={() =>
              setDetalhe({
                titulo: r.nome,
                itens: daRegua.filter((l) => (l.proprietario ?? 'Sem proprietário') === r.nome),
              })
            }
            className="linha"
            style={{
              ...LINHA_RANKING,
              width: '100%',
              textAlign: 'left',
              border: 0,
              borderTop: '1px solid var(--line)',
              background: 'transparent',
              fontSize: 14,
              color: 'var(--text)',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.nome}
            </span>
            <span
              style={{ textAlign: 'right', color: r.vermelho ? 'var(--vermelho)' : 'var(--text-3)' }}
            >
              {r.vermelho}
            </span>
            <span
              style={{ textAlign: 'right', color: r.amarelo ? 'var(--amarelo)' : 'var(--text-3)' }}
            >
              {r.amarelo}
            </span>
            <span style={{ textAlign: 'right', color: r.verde ? 'var(--verde)' : 'var(--text-3)' }}>
              {r.verde}
            </span>
            <span style={{ textAlign: 'right', color: 'var(--text-2)' }}>{r.total}</span>
          </button>
        ))}
      </Grupo>
      )}
    </main>
  )
}
