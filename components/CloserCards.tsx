'use client'

import { useState } from 'react'
import Cabecalho from './Cabecalho'
import type { Closer, Negocio, NegocioSLA } from '@/lib/closer'

const num = (n: number) => n.toLocaleString('pt-BR')
const data = (ms: number | null) =>
  ms == null
    ? '—'
    : new Date(ms).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        timeZone: 'America/Sao_Paulo',
      })

const CARTAO: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 14,
}

const CHAPEU: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

const CABECA_TABELA: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-2)',
}

// ---------- Proposta no mesmo dia ----------

type Faixa = { chave: 'noDia' | 'fora' | 'emDia' | 'futura'; rotulo: string; cor: string }

// "em dia" e "futura" são a janela ainda aberta, e ficam fora do denominador
// da taxa: só entra no cálculo o que já teve a chance de acontecer.
const FAIXAS: Faixa[] = [
  { chave: 'noDia', rotulo: 'no dia', cor: 'var(--verde-ponto)' },
  { chave: 'fora', rotulo: 'fora', cor: 'var(--vermelho-ponto)' },
  { chave: 'emDia', rotulo: 'em dia', cor: 'var(--link)' },
  { chave: 'futura', rotulo: 'futura', cor: '#a78bfa' },
]

type Resumo = { noDia: number; fora: number; emDia: number; futura: number; total: number }

function resumir(closers: Closer[], balde: 'sem' | 'com'): Resumo {
  const r: Resumo = { noDia: 0, fora: 0, emDia: 0, futura: 0, total: 0 }
  const agora = Date.now()
  for (const c of closers)
    for (const n of balde === 'sem' ? c.semReuniao : c.comReuniao) {
      if (n.estado === 'no_dia') r.noDia++
      else if (n.estado === 'fora') r.fora++
      else if (balde === 'com' && n.reuniaoMs != null && n.reuniaoMs > agora) r.futura++
      else r.emDia++
    }
  r.total = r.noDia + r.fora + r.emDia + r.futura
  return r
}

function Painel({ rotulo, balde, r }: { rotulo: string; balde: 'sem' | 'com'; r: Resumo }) {
  const testaveis = r.noDia + r.fora
  const pct = testaveis > 0 ? Math.round((r.noDia / testaveis) * 100) : 0
  const faixas = FAIXAS.filter((f) => balde === 'com' || f.chave !== 'futura')

  return (
    <div style={{ ...CARTAO, borderRadius: 12, padding: 13, background: 'var(--cinza-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={CHAPEU}>{rotulo}</span>
        <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
          <b style={{ color: 'var(--verde)' }}>{pct}%</b> no dia · {num(r.noDia)}/{num(testaveis)}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
        <span
          style={{
            fontFamily: 'var(--display)',
            fontSize: 30,
            fontWeight: 800,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {num(r.total)}
        </span>
        <span style={{ fontSize: 11 }}>{r.total === 1 ? 'lead no período' : 'leads no período'}</span>
      </div>

      <div
        style={{
          display: 'flex',
          height: 8,
          borderRadius: 99,
          overflow: 'hidden',
          background: 'var(--line)',
          marginTop: 9,
        }}
      >
        {faixas.map((f) =>
          r[f.chave] === 0 ? null : (
            <div
              key={f.chave}
              style={{ width: `${(r[f.chave] / r.total) * 100}%`, background: f.cor }}
              title={`${r[f.chave]} ${f.rotulo}`}
            />
          ),
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 13px', marginTop: 8 }}>
        {faixas.map((f) => (
          <span
            key={f.chave}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
          >
            <i style={{ width: 8, height: 8, borderRadius: 2, background: f.cor }} />
            <b>{num(r[f.chave])}</b>
            <span>{f.rotulo}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function Razao({ feito, total }: { feito: number; total: number }) {
  if (total === 0) return <span style={{ color: 'var(--text-2)' }}>—</span>
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      <b>{num(feito)}</b>
      <span style={{ color: 'var(--text-2)' }}>/{num(total)}</span>
    </span>
  )
}

const SELO = (n: Negocio, balde: 'sem' | 'com') => {
  if (n.estado === 'no_dia') return { rotulo: 'no dia', cor: 'verde' as const }
  if (n.estado === 'fora') return { rotulo: 'fora', cor: 'vermelho' as const }
  const futura = balde === 'com' && n.reuniaoMs != null && n.reuniaoMs > Date.now()
  return { rotulo: futura ? 'futura' : 'em dia', cor: 'cinza' as const }
}

function Lista({ negocios, titulo, balde }: { negocios: Negocio[]; titulo: string; balde: 'sem' | 'com' }) {
  const noDia = negocios.filter((n) => n.estado === 'no_dia').length
  const aguardando = negocios.filter((n) => n.estado === 'aguardando').length
  const testaveis = negocios.length - aguardando

  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <span style={{ ...CHAPEU, color: 'var(--link)' }}>{titulo}</span>
        <span style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
          <b style={{ color: 'var(--verde)' }}>{noDia}</b> no dia / {testaveis}
          {aguardando > 0 && <span style={{ color: 'var(--link)' }}> · {aguardando} pendente</span>}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '0 6px 4px', borderBottom: '1px solid var(--line)', ...CABECA_TABELA, fontSize: 9 }}>
        <span style={{ width: 54, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>Negócio</span>
        <span style={{ width: 54, textAlign: 'right', flexShrink: 0 }}>Criado</span>
        {balde === 'com' && <span style={{ width: 54, textAlign: 'right', flexShrink: 0 }}>Reunião</span>}
        <span style={{ width: 54, textAlign: 'right', flexShrink: 0 }}>1ª prop.</span>
      </div>

      {negocios.map((n) => {
        const s = SELO(n, balde)
        return (
          <div
            key={n.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 6px',
              borderBottom: '1px solid var(--line)',
              background: n.estado === 'no_dia' ? 'var(--verde-bg)' : 'transparent',
            }}
          >
            <span
              style={{
                width: 54,
                flexShrink: 0,
                textAlign: 'center',
                fontSize: 9,
                fontWeight: 700,
                textTransform: 'uppercase',
                borderRadius: 4,
                padding: '2px 0',
                background: `var(--${s.cor}-bg)`,
                color: s.cor === 'cinza' ? 'var(--text)' : `var(--${s.cor})`,
              }}
            >
              {s.rotulo}
            </span>
            <a
              href={n.link}
              target="_blank"
              rel="noreferrer"
              title={n.nome}
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 12,
                color: 'inherit',
              }}
            >
              {n.nome}
            </a>
            <span style={{ width: 54, textAlign: 'right', flexShrink: 0, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
              {data(n.criadoMs)}
            </span>
            {balde === 'com' && (
              <span style={{ width: 54, textAlign: 'right', flexShrink: 0, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                {data(n.reuniaoMs)}
              </span>
            )}
            <span
              style={{
                width: 54,
                textAlign: 'right',
                flexShrink: 0,
                fontSize: 11,
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: n.estado === 'no_dia' ? 'var(--verde)' : 'inherit',
              }}
            >
              {data(n.propostaMs)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function PropostaMesmoDia({ closers }: { closers: Closer[] }) {
  const [aberto, setAberto] = useState<string | null>(null)
  const razao: React.CSSProperties = { width: 112, textAlign: 'right', fontSize: 13, fontWeight: 600 }

  return (
    <section style={{ ...CARTAO, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden style={{ width: 4, height: 16, borderRadius: 99, background: 'var(--link)' }} />
          <h2
            style={{
              fontFamily: 'var(--display)',
              fontSize: 14,
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              margin: 0,
            }}
          >
            Proposta no mesmo dia
          </h2>
        </div>
        <p style={{ fontSize: 11, margin: '6px 0 0', maxWidth: 680, lineHeight: 1.5 }}>
          Agilidade por closer: de quantas oportunidades ele mandou a proposta no mesmo dia
          (<b>enviou / teve</b>). <b>Sem reunião</b> conta pelo dia da qualificação; <b>com reunião</b>,
          pelo dia da reunião — ou da qualificação, se a proposta saiu antes. Clique numa linha para
          ver os negócios.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 14 }}>
          <Painel rotulo="Sem reunião" balde="sem" r={resumir(closers, 'sem')} />
          <Painel rotulo="Com reunião" balde="com" r={resumir(closers, 'com')} />
        </div>
      </div>

      <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {closers.length === 0 ? (
          <p style={{ textAlign: 'center', fontSize: 13, padding: '24px 0', margin: 0 }}>
            Nenhum negócio ativo no funil B2B.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12, padding: '0 12px', ...CABECA_TABELA }}>
              <span style={{ flex: 1 }}>Closer</span>
              <span style={{ width: 112, textAlign: 'right' }}>Sem reunião</span>
              <span style={{ width: 112, textAlign: 'right' }}>Com reunião</span>
            </div>

            {closers.map((c) => {
              const escancarado = aberto === c.ownerId
              const total = c.semTestavel + c.comTestavel + c.semAguardando + c.comAguardando
              return (
                <div key={c.ownerId} style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                  <button
                    onClick={() => setAberto((o) => (o === c.ownerId ? null : c.ownerId))}
                    disabled={total === 0}
                    aria-expanded={escancarado}
                    className="linha"
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '9px 12px',
                      border: 0,
                      background: 'transparent',
                      color: 'var(--text)',
                      font: 'inherit',
                      textAlign: 'left',
                      cursor: total === 0 ? 'default' : 'pointer',
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 13,
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={c.nome}
                    >
                      {total > 0 && (
                        <span
                          aria-hidden
                          style={{
                            color: 'var(--link)',
                            fontSize: 10,
                            display: 'inline-block',
                            transform: escancarado ? 'none' : 'rotate(-90deg)',
                          }}
                        >
                          ▼
                        </span>
                      )}
                      {c.nome}
                    </span>
                    <span style={razao}>
                      <Razao feito={c.semCumpriu} total={c.semTestavel} />
                    </span>
                    <span style={razao}>
                      <Razao feito={c.comCumpriu} total={c.comTestavel} />
                    </span>
                  </button>

                  {escancarado && (
                    <div>
                      {c.semReuniao.length > 0 && (
                        <Lista
                          negocios={c.semReuniao}
                          titulo="Sem reunião · proposta no dia da qualificação"
                          balde="sem"
                        />
                      )}
                      {c.comReuniao.length > 0 && (
                        <Lista negocios={c.comReuniao} titulo="Com reunião · proposta no dia da reunião" balde="com" />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
    </section>
  )
}

// ---------- SLA de Onboarding ----------

function SlaOnboarding({
  sla,
}: {
  sla: { rotulo: string; prazoDias: number; total: number; atrasados: number; negocios: NegocioSLA[] }
}) {
  const [tudo, setTudo] = useState(false)
  const pct = sla.total > 0 ? Math.round((sla.atrasados / sla.total) * 100) : 0
  const lista = tudo ? sla.negocios : sla.negocios.slice(0, 8)

  return (
    <section style={{ ...CARTAO, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={CHAPEU}>SLA de Onboarding</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
            <span
              style={{
                fontFamily: 'var(--display)',
                fontSize: 38,
                fontWeight: 800,
                lineHeight: 1,
                color: 'var(--vermelho)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {num(sla.atrasados)}
            </span>
            <span style={{ fontSize: 14 }}>
              atrasados de {num(sla.total)} em {sla.rotulo}
            </span>
          </div>
          <p style={{ fontSize: 11, margin: '6px 0 0', maxWidth: 680, lineHeight: 1.5 }}>
            Negócios parados em {sla.rotulo} há mais de <b>{sla.prazoDias} dias</b> desde que entraram
            em Negócio fechado ou no próprio {sla.rotulo} — o que for mais antigo.
          </p>
        </div>

        <div
          style={{
            flexShrink: 0,
            border: '1px solid var(--line)',
            borderRadius: 12,
            padding: '8px 12px',
            textAlign: 'right',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--display)',
              fontSize: 24,
              fontWeight: 800,
              lineHeight: 1,
              color: 'var(--vermelho)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {pct}%
          </div>
          <div style={{ ...CHAPEU, marginTop: 2 }}>atrasados</div>
        </div>
      </div>

      {sla.total === 0 ? (
        <p style={{ textAlign: 'center', fontSize: 13, padding: '24px 0 8px', margin: 0 }}>
          Nenhum negócio em {sla.rotulo}.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, padding: '0 12px', marginTop: 16, ...CABECA_TABELA }}>
            <span style={{ width: 64, flexShrink: 0 }}>Status</span>
            <span style={{ flex: 1 }}>Negócio</span>
            <span style={{ width: 120, textAlign: 'right' }}>Closer</span>
            <span style={{ width: 60, textAlign: 'right' }}>Fechou</span>
            <span style={{ width: 48, textAlign: 'right' }}>Dias</span>
          </div>

          <div style={{ marginTop: 4 }}>
            {lista.map((n, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '6px 12px',
                  borderTop: '1px solid var(--line)',
                  background: n.atrasado ? 'var(--vermelho-bg)' : 'transparent',
                }}
              >
                <span
                  style={{
                    width: 64,
                    flexShrink: 0,
                    textAlign: 'center',
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    borderRadius: 4,
                    padding: '2px 0',
                    background: n.atrasado ? 'var(--card)' : 'var(--verde-bg)',
                    color: n.atrasado ? 'var(--vermelho)' : 'var(--verde)',
                  }}
                >
                  {n.atrasado ? 'atrasado' : 'no prazo'}
                </span>
                <a
                  href={n.link}
                  target="_blank"
                  rel="noreferrer"
                  title={n.nome}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 12,
                    color: 'inherit',
                  }}
                >
                  {n.nome}
                </a>
                <span
                  style={{
                    width: 120,
                    textAlign: 'right',
                    fontSize: 11,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={n.closer}
                >
                  {n.closer}
                </span>
                <span style={{ width: 60, textAlign: 'right', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                  {data(n.fechouMs)}
                </span>
                <span
                  style={{
                    width: 48,
                    textAlign: 'right',
                    fontSize: 12,
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                    color: n.atrasado ? 'var(--vermelho)' : 'inherit',
                  }}
                >
                  {n.dias ?? '—'}
                </span>
              </div>
            ))}
          </div>

          {sla.negocios.length > 8 && (
            <button
              onClick={() => setTudo((v) => !v)}
              style={{
                width: '100%',
                marginTop: 8,
                border: 0,
                background: 'transparent',
                color: 'var(--link)',
                font: 'inherit',
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              {tudo ? 'Ver menos' : `Ver todos (${num(sla.negocios.length)})`}
            </button>
          )}
        </>
      )}
    </section>
  )
}

export default function CloserCards({
  closers,
  sla,
  aoVivo,
  atualizadoEm,
  capturadoEm,
  aviso,
}: {
  closers: Closer[]
  sla: { rotulo: string; prazoDias: number; total: number; atrasados: number; negocios: NegocioSLA[] }
  aoVivo: boolean
  atualizadoEm: string
  capturadoEm: string
  aviso?: string
}) {
  const ativos = closers.reduce(
    (s, c) => s + c.semTestavel + c.comTestavel + c.semAguardando + c.comAguardando,
    0,
  )

  return (
    <main style={{ maxWidth: 1680, margin: '0 auto', padding: '44px 32px 72px' }}>
      <Cabecalho
        slug="closer"
        resumo={`Funil de Vendas B2B · ${ativos} negócios ativos`}
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <SlaOnboarding sla={sla} />
        <PropostaMesmoDia closers={closers} />
      </div>
    </main>
  )
}
