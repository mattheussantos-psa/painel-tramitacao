'use client'

import Cabecalho from './Cabecalho'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ABAS,
  AMARELO_ANTES,
  TOLERANCIA,
  prazoEmTexto,
  type Cor,
  type Regra,
  type Regua,
} from '@/lib/sinaleira'
import { RELOGIOS, type Conta } from '@/lib/relogios'

// O quadro vem do servidor porque a tabela de prazos e por pipeline. Com ela
// fixa no cliente, os dois quadros dividiriam a mesma regua — que e justamente
// o que nao pode acontecer.
export type QuadroCliente = {
  slug: string
  nome: string
  evento: boolean
  sla: Record<string, Regra>
}

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
  entrouEtapa: string
  conta: {
    datas: { rotulo: string; valor: string }[]
    contas: Conta[]
    eventoPassou: boolean
    briefing: { cor: Cor; texto: string } | null
    ficha: { formatoContrato: string; exclusivo: string; palestrante: string }
  }
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
  texto?: string
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

// Deriva da mesma tabela de SLA da régua, ordenada pela posição no funil —
// que é a ordem do kanban. Duplicar a lista faria o cabeçalho mentir assim que
// alguém calibrasse os prazos em lib/sinaleira.
const etapasDo = (sla: Record<string, Regra>) =>
  Object.entries(sla)
    .sort(([, a], [, b]) => a.ordem - b.ordem)
    .map(([id, r]) => ({ id, label: r.label, prazo: prazoEmTexto(r), regras: regrasDa(r) }))

export type Explicacao = {
  nome: string
  regra: string
  dispara?: string
  fecha?: string
  pendencia?: string
}

// A explicação sai da mesma régua que pinta o card. Escrever o texto à mão
// aqui faria o painel mentir no dia seguinte a uma calibração.
function regrasDa(r: Regra): Explicacao[] {
  if (r.tipo === 'relogio')
    return RELOGIOS.filter((x) => x.etapa.includes(r.label)).map((x) => ({
      nome: x.nome,
      regra: x.regra,
      dispara: x.gatilho,
      fecha: x.marco,
      pendencia: x.pendencia,
    }))

  if (r.tipo === 'dias')
    return [
      {
        nome: 'Tempo na etapa',
        regra: `Vence ${r.dias} dias depois de o ticket entrar na etapa · amarelo a partir de ${AMARELO_ANTES} dias antes do vencimento · vermelho ${TOLERANCIA + 1} dias depois dele`,
        dispara: 'hs_v2_date_entered_current_stage',
        fecha: 'sair da etapa',
      },
    ]

  if (r.tipo === 'evento')
    return [
      {
        nome: 'Até o evento',
        regra: `Vence na data do evento · amarelo a partir de ${AMARELO_ANTES} dias antes · vermelho ${TOLERANCIA + 1} dias depois`,
        dispara: 'data_do_evento__ganho_',
        fecha: 'sair da etapa',
      },
    ]

  return [
    {
      nome: 'Sem prazo acordado',
      regra: 'O CS ainda não definiu prazo para esta etapa. O card fica cinza e mostra só há quantos dias o ticket está parado.',
    },
  ]
}

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
  if (l.diasTarefa === null) return { texto: 'sem tarefa', cor: 'var(--text)' }
  if (l.diasTarefa < 0)
    return { texto: `tarefa venceu há ${-l.diasTarefa}d`, cor: 'var(--vermelho)' }
  if (l.diasTarefa === 0) return { texto: 'tarefa hoje', cor: 'var(--amarelo)' }
  return {
    texto: `tarefa em ${l.diasTarefa}d`,
    cor: l.diasTarefa <= 2 ? 'var(--amarelo)' : 'var(--text)',
  }
}

function prazo(l: Linha) {
  // Etapa medida por relogio traz a frase pronta: o numero sozinho nao diz se
  // conta desde o onboarding, desde a assinatura ou ate o evento.
  if (l.texto) return l.texto
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
// Dias desde o evento. Negativo quando o evento ainda nao aconteceu.
const passou = (l: Linha) => -l.diasEvento

// Uma linha do tempo só, do evento mais antigo ao mais próximo. Eram dois
// cards empilhados, um para antes e outro para depois do evento; separados,
// a leitura mais útil — o quanto o atraso cresce conforme o evento fica para
// trás — exigia comparar dois blocos distantes na tela.
// O "passou > 0" não é redundante: sem ele um evento no futuro (diasEvento
// positivo) satisfaz "<= 15" e cai na primeira faixa de passado.
const FAIXAS: Faixa[] = [
  { rotulo: 'há mais de 90 dias', dentro: (l) => passou(l) > 90 },
  { rotulo: 'há 31–90 dias', dentro: (l) => passou(l) >= 31 && passou(l) <= 90 },
  { rotulo: 'há 16–30 dias', dentro: (l) => passou(l) >= 16 && passou(l) <= 30 },
  { rotulo: 'há até 15 dias', dentro: (l) => passou(l) > 0 && passou(l) <= 15 },
  { rotulo: 'é hoje', dentro: (l) => l.diasEvento === 0 },
  { rotulo: 'em até 7 dias', dentro: (l) => l.diasEvento >= 1 && l.diasEvento <= 7 },
  { rotulo: 'em 8–15 dias', dentro: (l) => l.diasEvento >= 8 && l.diasEvento <= 15 },
  { rotulo: 'em 16–30 dias', dentro: (l) => l.diasEvento >= 16 && l.diasEvento <= 30 },
]

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
  aoAbrir,
}: {
  linhas: Linha[]
  aoAbrir: (titulo: string, itens: Linha[]) => void
}) {
  const cores: Cor[] = ['vermelho', 'amarelo', 'verde', 'cinza']

  const faixas = FAIXAS.map((f) => {
    const dentro = linhas.filter(f.dentro)
    const por = Object.fromEntries(
      cores.map((c) => [c, dentro.filter((l) => l.cor === c).length]),
    ) as Record<Cor, number>
    return { ...f, total: dentro.length, por }
  })

  const total = faixas.reduce((s, f) => s + f.total, 0)
  if (!total) return null

  return (
    <Grupo style={{ marginTop: 18, marginBottom: 18, padding: '14px 18px 16px' }}>
      {/* Titulo, total e legenda numa linha so. Em pilha, os dois horizontes
          somavam mais de 500px antes da primeira barra. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
          <span
            style={{
              fontFamily: 'var(--display)',
              fontSize: 28,
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            {total}
          </span>
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
              }}
            >
              Por data do evento
            </span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--text-2)' }}>
              Eventos já realizados e os dos próximos 30 dias · por sinal
            </span>
          </span>
        </div>

        <div style={{ display: 'flex', gap: 13, flexWrap: 'wrap' }}>
          {CORES.filter((c) => faixas.some((f) => f.por[c.cor] > 0)).map(({ cor, label }) => (
            <span
              key={cor}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                color: 'var(--text-2)',
              }}
            >
              <span
                style={{ width: 9, height: 9, borderRadius: 3, background: `var(--${cor}-ponto)` }}
              />
              {label}
            </span>
          ))}
        </div>
      </div>

      {faixas.map((f) => {
        return (
          <div key={f.rotulo} style={{ marginBottom: 9 }}>
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
                onClick={() => aoAbrir(`Evento ${f.rotulo}`, linhas.filter(f.dentro))}
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
                height: 22,
                borderRadius: 5,
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
                          `${CORES.find((x) => x.cor === c)?.label} · evento ${f.rotulo}`,
                          linhas.filter((l) => f.dentro(l) && l.cor === c),
                        )
                      }
                      aria-label={`Ver ${f.por[c]} em ${rotuloCor}, evento ${f.rotulo}`}
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

function Cartao({ l, aoAbrir }: { l: Linha; aoAbrir: () => void }) {
  const t = tarefa(l)
  return (
    <button
      onClick={aoAbrir}
      className="cartao"
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        font: 'inherit',
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
        {/* Deixa quebrar: com nowrap a frase do relogio passava 15px da
            borda do card e ainda empurrava a data do evento 113px para fora. */}
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            // Card cinza nao tem cor de sinal para emprestar ao texto, e
            // --cinza como letra era o ultimo cinza que sobrava no card.
            color: l.cor === 'cinza' ? 'var(--text)' : `var(--${l.cor})`,
            minWidth: 0,
            overflowWrap: 'anywhere',
            lineHeight: 1.3,
          }}
        >
          {prazo(l)}
        </span>
        {l.evento && (
          <span style={{ fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>
            evento {dataBr(l.evento)}
          </span>
        )}
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
    </button>
  )
}

// Clicar no card abre a conta daquele ticket: as datas que a régua leu e uma
// frase por relógio dizendo o porquê da cor. Nada disso cabe no card — são
// 180 na tela — e no HubSpot o farmer vê as propriedades soltas sem saber
// qual delas pintou o card.
export function Conta({ l, aoFechar }: { l: Linha; aoFechar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal()
  }, [])

  const datas = [
    ...l.conta.datas,
    { rotulo: 'Entrou nesta etapa', valor: l.entrouEtapa },
  ].filter((d) => d.rotulo !== 'Evento' || d.valor)

  // Nao-se-aplica some do dialogo, menos quando a razao e campo em branco:
  // ai e a unica forma de alguem saber por que o relogio nao corre.
  const correndo = l.conta.contas
    .filter((c) => c.estado !== 'nao-aplica' || c.faltaDado)
    // Os dois relogios do palestrante param pelo mesmo campo em branco e
    // diriam a mesma frase duas vezes.
    .filter((c, i, todas) => !c.faltaDado || todas.findIndex((x) => x.porque === c.porque) === i)
  const contas = correndo.length ? correndo : l.conta.contas

  return (
    <dialog
      ref={ref}
      onClose={aoFechar}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close()
      }}
      style={{
        width: 'min(460px, calc(100vw - 32px))',
        maxHeight: '80vh',
        padding: 0,
        border: 0,
        borderRadius: 14,
        background: 'var(--card)',
        color: 'var(--text)',
        overflow: 'auto',
      }}
    >
      <div style={{ padding: '18px 20px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>{l.cliente}</div>
            <div style={{ fontSize: 13 }}>{l.palestrante || '—'}</div>
          </div>
          <button
            onClick={() => ref.current?.close()}
            aria-label="Fechar"
            style={{
              border: 0,
              background: 'transparent',
              color: 'var(--text-2)',
              fontSize: 22,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, margin: '16px 0 0' }}>
          <tbody>
            {[
              { rotulo: 'Palestrante principal', valor: l.conta.ficha.palestrante },
              { rotulo: 'Modelo do contrato', valor: l.conta.ficha.formatoContrato },
              { rotulo: 'Palestrante é exclusivo?', valor: l.conta.ficha.exclusivo },
            ].map((f) => (
              <tr key={f.rotulo}>
                <td style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>{f.rotulo}</td>
                <td
                  style={{
                    padding: '6px 0',
                    borderBottom: '1px solid var(--line)',
                    textAlign: 'right',
                    fontWeight: f.valor ? 600 : 400,
                  }}
                >
                  {f.valor || 'vazio'}
                </td>
              </tr>
            ))}
            {datas.map((d) => (
              <tr key={d.rotulo}>
                <td style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>{d.rotulo}</td>
                <td
                  style={{
                    padding: '6px 0',
                    borderBottom: '1px solid var(--line)',
                    textAlign: 'right',
                    fontWeight: d.valor ? 600 : 400,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {d.valor ? dataBr(d.valor) : 'vazio'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {l.conta.briefing && (
          <p style={{ fontSize: 13, margin: '14px 0 0', lineHeight: 1.5 }}>
            <Ponto cor={l.conta.briefing.cor} /> <b>Briefing pendente</b> — o ticket ainda não passou
            por Realizar Briefing e o evento está chegando. Está na etapa errada, independente dos
            prazos desta aqui.
          </p>
        )}

        {l.conta.eventoPassou && (
          <p style={{ fontSize: 13, margin: '14px 0 0', lineHeight: 1.5 }}>
            <Ponto cor="vermelho" /> <b>Evento já aconteceu</b> — foi em {dataBr(l.evento)} e o
            ticket continua nesta etapa, que é trabalho de antes do evento. Isso manda na cor, acima
            de qualquer prazo abaixo.
          </p>
        )}

        {contas.map((c) => (
          <p key={c.chave} style={{ fontSize: 13, margin: '14px 0 0', lineHeight: 1.5 }}>
            <Ponto cor={COR_DO_ESTADO[c.estado] ?? 'cinza'} />{' '}
            <b>{c.nome}</b> — {c.porque}
            {c.herdado && (
              <>
                {' '}
                <span style={{ color: 'var(--amarelo)' }}>
                  Esse prazo é anterior à entrada do ticket nesta etapa, então pode ser data de
                  outro momento do processo: confira antes de cobrar.
                </span>
              </>
            )}
          </p>
        ))}

        {!contas.length && (
          <p style={{ fontSize: 13, margin: '14px 0 0' }}>
            Esta etapa não tem relógio. A cor vem do prazo da própria etapa: {prazo(l)}.
          </p>
        )}

        <a
          href={l.link}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-block',
            marginTop: 18,
            background: 'var(--link)',
            color: '#fff',
            textDecoration: 'none',
            borderRadius: 9,
            padding: '9px 15px',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Abrir no HubSpot
        </a>
      </div>
    </dialog>
  )
}

const COR_DO_ESTADO: Record<string, Cor> = {
  vermelho: 'vermelho',
  amarelo: 'amarelo',
  verde: 'verde',
}

// Kanban: a etapa vira coluna e cada coluna rola sozinha. É o mesmo desenho do
// HubSpot, e dispensa o filtro de etapa — a coluna já é o filtro.
// A regra de cada etapa fica a um passar de mouse do cabeçalho. Quem abre o
// painel não tem como adivinhar por que um card está vermelho, e mandar a
// régua por mensagem desatualiza no primeiro ajuste.
const LARGURA_REGRAS = 300

function Regras({
  etapa,
  itens,
  aberta,
  aoAbrir,
  aoFechar,
}: {
  etapa: string
  itens: Explicacao[]
  aberta: boolean
  aoAbrir: () => void
  aoFechar: () => void
}) {
  // Posicao fixa, calculada ao abrir. Dentro da coluna o balao sai cortado: o
  // quadro rola na horizontal, e overflow-x recorta os dois eixos.
  const [onde, setOnde] = useState<{ top: number; left: number } | null>(null)
  const botao = useRef<HTMLButtonElement>(null)
  const balao = useRef<HTMLSpanElement>(null)

  const posicionar = () => {
    const r = botao.current?.getBoundingClientRect()
    if (!r) return
    setOnde({
      top: r.bottom + 6,
      left: Math.max(8, Math.min(r.right - LARGURA_REGRAS, window.innerWidth - LARGURA_REGRAS - 8)),
    })
  }

  useEffect(() => {
    if (aberta) posicionar()
    else setOnde(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta])

  // Depois de montado da para medir a altura real e subir o balao quando ele
  // passaria do rodape. Chutar a altura erra: a etapa com quatro relogios
  // ocupa quatro vezes a de um.
  useLayoutEffect(() => {
    if (!onde || !balao.current) return
    const r = balao.current.getBoundingClientRect()
    const sobra = r.bottom - (window.innerHeight - 8)
    if (sobra <= 0) return
    const topo = Math.max(8, onde.top - sobra)
    if (topo !== onde.top) setOnde({ ...onde, top: topo })
  }, [onde])

  // Fica aberto ate mandarem fechar. Fechar ao tirar o mouse parecia obvio e
  // era inutilizavel: para ler o fim do texto e preciso rolar dentro do balao,
  // e qualquer movimento do ponteiro o apagava no meio da leitura.
  useEffect(() => {
    if (!aberta) return
    const dentro = (alvo: EventTarget | null) =>
      alvo instanceof Node && (!!balao.current?.contains(alvo) || !!botao.current?.contains(alvo))

    const naTecla = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar()
    const noClique = (e: MouseEvent) => !dentro(e.target) && aoFechar()
    // Rolagem dentro do balao e leitura, nao saida: so a de fora fecha.
    const naRolagem = (e: Event) => !dentro(e.target) && aoFechar()

    document.addEventListener('keydown', naTecla)
    document.addEventListener('mousedown', noClique)
    window.addEventListener('scroll', naRolagem, true)
    return () => {
      document.removeEventListener('keydown', naTecla)
      document.removeEventListener('mousedown', noClique)
      window.removeEventListener('scroll', naRolagem, true)
    }
  }, [aberta, aoFechar])

  if (!itens.length) return null

  return (
    <span style={{ marginLeft: 'auto', flexShrink: 0, lineHeight: 0 }}>
      <button
        ref={botao}
        onMouseEnter={aoAbrir}
        onClick={() => (aberta ? aoFechar() : aoAbrir())}
        aria-label={`Regras de ${etapa}`}
        aria-expanded={aberta}
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          border: 0,
          padding: 0,
          background: aberta ? 'var(--card)' : 'transparent',
          boxShadow: 'inset 0 0 0 1.5px var(--text-2)',
          color: 'var(--text)',
          fontSize: 12,
          fontWeight: 700,
          fontFamily: 'Georgia, serif',
          lineHeight: '17px',
        }}
      >
        i
      </button>

      {onde && (
        <span
          ref={balao}
          role="dialog"
          aria-label={`Regras de ${etapa}`}
          style={{
            position: 'fixed',
            top: onde.top,
            left: onde.left,
            zIndex: 50,
            width: LARGURA_REGRAS,
            maxHeight: '70vh',
            overflowY: 'auto',
            background: 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            boxShadow: '0 10px 28px rgba(0,0,0,0.28)',
            padding: '12px 14px 14px',
            fontSize: 12,
            fontWeight: 400,
            lineHeight: 1.45,
            letterSpacing: 0,
            whiteSpace: 'normal',
            textAlign: 'left',
            display: 'block',
            cursor: 'default',
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 10,
              marginBottom: 9,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13 }}>{etapa}</span>
            <button
              onClick={aoFechar}
              aria-label="Fechar"
              style={{
                border: 0,
                background: 'transparent',
                color: 'var(--text-2)',
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </span>

          {itens.map((e, i) => (
            <span
              key={e.nome}
              style={{
                display: 'block',
                marginTop: i ? 10 : 0,
                paddingTop: i ? 10 : 0,
                borderTop: i ? '1px solid var(--line)' : 0,
              }}
            >
              <span style={{ display: 'block', fontWeight: 600 }}>{e.nome}</span>
              <span style={{ display: 'block', marginTop: 1 }}>{e.regra}</span>
              {e.dispara && (
                <span style={{ display: 'block', marginTop: 4 }}>
                  Dispara em <code style={CODIGO}>{e.dispara}</code>
                </span>
              )}
              {e.fecha && (
                <span style={{ display: 'block', marginTop: 2 }}>
                  Fecha em <code style={CODIGO}>{e.fecha}</code>
                </span>
              )}
              {e.pendencia && (
                <span
                  style={{
                    display: 'block',
                    marginTop: 6,
                    background: 'var(--amarelo-bg)',
                    color: 'var(--amarelo)',
                    borderRadius: 7,
                    padding: '6px 8px',
                  }}
                >
                  {e.pendencia}
                </span>
              )}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}


const CODIGO: React.CSSProperties = {
  background: 'var(--cinza-bg)',
  borderRadius: 4,
  padding: '1px 5px',
  fontSize: 11,
  overflowWrap: 'anywhere',
}

function Kanban({
  colunas,
  aoAbrirConta,
}: {
  colunas: { id: string; label: string; prazo: string; regras: Explicacao[]; itens: Linha[] }[]
  aoAbrirConta: (l: Linha) => void
}) {
  // Uma regra aberta por vez: com estado em cada coluna, passar o mouse pela
  // fileira de icones deixava varios baloes abertos ao mesmo tempo.
  const [regras, setRegras] = useState<string | null>(null)
  const fechar = useCallback(() => setRegras(null), [])

  return (
    <div
      className="rolagem"
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'start',
        // Cinco colunas de 300px passam de 1500px: em tela menor o quadro
        // estourava a pagina inteira e a barra horizontal ia parar no rodape
        // da janela, com a ultima etapa fora do alcance. Igual ao HubSpot, a
        // rolagem horizontal e do quadro, nao da pagina.
        overflowX: 'auto',
        paddingBottom: 6,
      }}
    >
      {colunas.map((col) => (
        <div
          key={col.id}
          style={{
            // Cresce para ocupar a sobra quando o monitor permite, mas nunca
            // encolhe abaixo de 300px — abaixo disso o card fica ilegivel.
            flex: '1 0 300px',
            background: 'var(--cinza-bg)',
            borderRadius: 14,
            padding: 10,
            minWidth: 0,
          }}
        >
          {/* Nome e contagem andam juntos: a contagem jogada na outra ponta
              da coluna obrigava a varrer a linha para ligar uma coisa a outra. */}
          <div style={{ padding: '5px 6px 11px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {col.label}
              </span>
              <span
                style={{
                  flexShrink: 0,
                  background: 'var(--card)',
                  borderRadius: 20,
                  padding: '1px 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {col.itens.length}
              </span>
              <Regras
                etapa={col.label}
                itens={col.regras}
                aberta={regras === col.id}
                aoAbrir={() => setRegras(col.id)}
                aoFechar={fechar}
              />
            </div>
            <div style={{ fontSize: 11, marginTop: 2 }}>{col.prazo}</div>
          </div>
          {/* paddingRight afasta o card da barra de rolagem: colada nele o
              conteudo parecia cortado. */}
          <div
            className="rolagem"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              maxHeight: 'calc(100vh - 220px)',
              overflowY: 'auto',
              overflowX: 'hidden',
              paddingRight: 8,
            }}
          >
            {col.itens.map((l) => (
              <Cartao key={l.id} l={l} aoAbrir={() => aoAbrirConta(l)} />
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
          {/* Nada de cinza aqui: o fundo tingido come o --text-2 e o rodape
              vira decoracao em vez de informacao. A hierarquia fica por conta
              do peso — rotulo normal, nome em negrito. */}
          <span>{papel} </span>
          <span style={{ fontWeight: 600, color: inativo ? 'var(--vermelho)' : 'var(--text)' }}>
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
  quadro,
  aoVivo,
  capturadoEm,
  atualizadoEm,
  aviso,
}: {
  linhas: Linha[]
  quadro: QuadroCliente
  aoVivo: boolean
  capturadoEm: string
  atualizadoEm: string
  aviso?: string
}) {
  const [cor, setCor] = useState<Cor | null>(null)
  const [curador, setCurador] = useState('')
  const [proprietario, setProprietario] = useState('')
  const [semDono, setSemDono] = useState(false)
  const [comTarefa, setComTarefa] = useState(false)
  const [alerta, setAlerta] = useState('')
  const [detalhe, setDetalhe] = useState<{ titulo: string; itens: Linha[] } | null>(null)
  const [conta, setConta] = useState<Linha | null>(null)

  // A aba e controle do kanban, nao da pagina: filtros, alertas, horizontes e
  // ranking leem a base inteira e so o quadro recorta por regua.
  const porPessoa = useMemo(
    () =>
      linhas.filter(
        (l) =>
          (!curador || l.curador === curador) &&
          (!proprietario || l.proprietario === proprietario),
      ),
    [linhas, curador, proprietario],
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

  // O quadro mostra tudo. A aba antes/depois do evento saiu: etapa de
  // trabalho com o evento já passado agora é vermelha por regra, então
  // esconder metade do quadro só servia para o atraso não aparecer. Os dois
  // cards de horizonte continuam dando o recorte por data do evento.
  const doKanban = base


  // A cor fica de fora da contagem de propósito: se entrasse, clicar em
  // "Atrasado" zerava os outros três e a pessoa perdia a visão do quadro.
  const contagem = useMemo(() => {
    const c: Record<Cor, number> = { vermelho: 0, amarelo: 0, verde: 0, cinza: 0 }
    for (const l of doKanban) c[l.cor]++
    return c
  }, [doKanban])

  const visiveis = doKanban.filter((l) => !cor || l.cor === cor)

  // Uma coluna por etapa, na ordem do kanban do HubSpot. Dentro da coluna, por
  // data do evento: ordenar por atraso empilharia os vermelhos no topo e os
  // verdes no fim, e a leitura de sinaleira some quando a cor vira bloco.
  const colunas = useMemo(
    () =>
      etapasDo(quadro.sla).map((e) => ({
        ...e,
        itens: visiveis
          .filter((l) => l.stage === e.id)
          .sort((a, b) =>
            quadro.evento
              ? a.evento.localeCompare(b.evento)
              : a.cliente.localeCompare(b.cliente, 'pt-BR'),
          ),
      })),
    [visiveis, quadro],
  )

  // Lê a base inteira de propósito: se respeitasse o filtro de proprietário,
  // viraria uma linha só e deixaria de servir para escolher.
  const ranking = useMemo(() => {
    const m = new Map<string, Record<Cor, number>>()
    for (const l of linhas) {
      const nome = l.proprietario ?? 'Sem proprietário'
      const r = m.get(nome) ?? { vermelho: 0, amarelo: 0, verde: 0, cinza: 0 }
      r[l.cor]++
      m.set(nome, r)
    }
    return [...m.entries()]
      .map(([nome, r]) => ({ nome, ...r, total: r.vermelho + r.amarelo + r.verde + r.cinza }))
      .sort((a, b) => b.vermelho - a.vermelho || b.total - a.total)
  }, [linhas])

  const nomes = (campo: 'curador' | 'proprietario') =>
    Array.from(new Set(linhas.map((l) => l[campo]).filter(Boolean) as string[])).sort((a, b) =>
      a.localeCompare(b, 'pt-BR'),
    )

  const curadores = useMemo(() => nomes('curador'), [linhas])
  const proprietarios = useMemo(() => nomes('proprietario'), [linhas])

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
      <Cabecalho
        slug={quadro.slug}
        resumo={`${quadro.nome} · ${linhas.length} tickets abertos`}
        aoVivo={aoVivo}
        atualizadoEm={atualizadoEm}
        capturadoEm={capturadoEm}
      />

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
        {/* Etapa nao entra aqui: no kanban a coluna ja e o filtro de etapa. */}
        {curadores.length > 0 && (
          <Filtro vazio="Curador" valor={curador} opcoes={curadores} aoMudar={setCurador} />
        )}
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

      {conta && <Conta l={conta} aoFechar={() => setConta(null)} />}

      {detalhe && (
        <Detalhe
          titulo={detalhe.titulo}
          itens={detalhe.itens}
          aoFechar={() => setDetalhe(null)}
        />
      )}

      {quadro.evento && (
        <Horizonte linhas={base} aoAbrir={(titulo, itens) => setDetalhe({ titulo, itens })} />
      )}

      {/* Barra do quadro: a aba a esquerda, os contadores a direita, na mesma
          altura. Os contadores ocupavam 160px com os numeros maiores da tela —
          sao resumo, nao conteudo, e empurravam o board para fora da dobra. */}
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {visiveisCores.map(({ cor: c, label }) => {
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
                  background: marcado ? `var(--${c}-bg)` : 'var(--cinza-bg)',
                  boxShadow: marcado ? `inset 0 0 0 1.5px var(--${c}-ponto)` : 'none',
                }}
              >
                <Ponto cor={c} />
                <b
                  style={{
                    fontWeight: 600,
                    color: `var(--${c})`,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {contagem[c]}
                </b>
                <span style={{ color: 'var(--text-2)' }}>{label.toLowerCase()}</span>
              </button>
            )
          })}
        </div>
      </div>

      <Kanban colunas={colunas} aoAbrirConta={setConta} />



      {/* Ranking no fim: é leitura de gestão, não a tarefa do dia. Em cima ele
          empurrava os tickets para baixo da dobra.

          Sem corte de linhas: truncar em 6 escondia justamente quem tinha menos
          atraso mas muito volume. Clicar numa linha abre os tickets da pessoa,
          igual ao gráfico. */}
      {proprietario && (
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
            etapas={etapasDo(quadro.sla)}
            aoAbrir={(l) => setDetalhe({ titulo: l.cliente, itens: [l] })}
          />
        </Grupo>
      )}
    </main>
  )
}
