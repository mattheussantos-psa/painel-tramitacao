'use client'

import { useMemo, useState } from 'react'
import type { Cor, Regua } from '@/lib/sinaleira'

export type Linha = {
  id: string
  link: string
  cliente: string
  palestrante: string
  evento: string
  diasEvento: number
  diasNaEtapa: number
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

const CORES: { cor: Cor; label: string }[] = [
  { cor: 'vermelho', label: 'Atrasado' },
  { cor: 'amarelo', label: 'Atenção' },
  { cor: 'verde', label: 'Em dia' },
  { cor: 'cinza', label: 'Sem prazo' },
]

const dataBr = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—')

function prazo(l: Linha) {
  if (l.cor === 'cinza') return 'Etapa sem prazo na régua'
  if (l.dias > 0) return `${l.dias} ${l.dias === 1 ? 'dia' : 'dias'} de atraso`
  if (l.dias === 0) return 'Vence hoje'
  return `Vence em ${-l.dias} ${-l.dias === 1 ? 'dia' : 'dias'}`
}

function Pessoa({ papel, nome, inativo }: { papel: string; nome: string | null; inativo: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 3 }}>
      <span>{papel}</span>
      <span style={{ textAlign: 'right', color: inativo ? 'var(--vermelho)' : undefined }}>
        {nome ?? '—'}
        {inativo ? ' · inativo' : ''}
      </span>
    </div>
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
      style={{
        font: 'inherit',
        padding: '7px 12px',
        borderRadius: 9,
        border: '1px solid var(--line)',
        background: 'var(--card)',
        color: 'var(--text)',
        maxWidth: 240,
      }}
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

  const daRegua = useMemo(() => linhas.filter((l) => l.regua === regua), [linhas, regua])

  // Curador e proprietário entram na contagem: o número no card tem que ser o
  // do recorte que a pessoa está olhando. A cor fica de fora de propósito —
  // se entrasse, clicar em "Atrasado" zerava os outros três.
  const filtradas = useMemo(
    () =>
      daRegua.filter(
        (l) =>
          (!curador || l.curador === curador) &&
          (!proprietario || l.proprietario === proprietario),
      ),
    [daRegua, curador, proprietario],
  )

  const contagem = useMemo(() => {
    const c: Record<Cor, number> = { vermelho: 0, amarelo: 0, verde: 0, cinza: 0 }
    for (const l of filtradas) c[l.cor]++
    return c
  }, [filtradas])

  const nomes = (campo: 'curador' | 'proprietario') =>
    Array.from(new Set(daRegua.map((l) => l[campo]).filter(Boolean) as string[])).sort((a, b) =>
      a.localeCompare(b, 'pt-BR'),
    )

  const curadores = useMemo(() => nomes('curador'), [daRegua])
  const proprietarios = useMemo(() => nomes('proprietario'), [daRegua])

  const visiveis = filtradas.filter((l) => !cor || l.cor === cor)

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '40px 24px 64px' }}>
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
          Sinaleira
        </h1>
        <p style={{ color: 'var(--text-2)', margin: '6px 0 0' }}>
          Tramitação CS · {linhas.length} tickets abertos ·{' '}
          <span style={{ color: aoVivo ? 'var(--verde)' : 'var(--text-3)' }}>
            {aoVivo ? `ao vivo, ${atualizadoEm}` : `snapshot de ${dataBr(capturadoEm)}`}
          </span>
        </p>
      </header>

      {aviso && (
        <p
          style={{
            background: 'var(--amarelo-bg)',
            color: 'var(--amarelo)',
            borderRadius: 'var(--radius)',
            padding: '11px 14px',
            fontSize: 13,
            margin: '0 0 20px',
          }}
        >
          {aviso}
        </p>
      )}

      <div
        style={{
          display: 'inline-flex',
          background: 'var(--cinza-bg)',
          borderRadius: 10,
          padding: 2,
          marginBottom: 20,
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
              setCor(null)
              setCurador('')
            }}
            style={{
              border: 0,
              borderRadius: 8,
              padding: '7px 18px',
              fontWeight: 500,
              background: regua === v ? 'var(--card)' : 'transparent',
              color: regua === v ? 'var(--text)' : 'var(--text-2)',
              boxShadow: regua === v ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        {CORES.map(({ cor: c, label }) => (
          <button
            key={c}
            onClick={() => setCor(cor === c ? null : c)}
            style={{
              textAlign: 'left',
              border: cor === c ? `1.5px solid var(--${c})` : '1.5px solid transparent',
              background: `var(--${c}-bg)`,
              borderRadius: 'var(--radius)',
              padding: '14px 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 5,
                  background: `var(--${c})`,
                  display: 'inline-block',
                }}
              />
              <span style={{ fontSize: 13, color: `var(--${c})`, fontWeight: 500 }}>{label}</span>
            </div>
            <div
              style={{ fontSize: 32, fontWeight: 600, color: `var(--${c})`, letterSpacing: '-0.02em' }}
            >
              {contagem[c]}
            </div>
          </button>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <Filtro vazio="Todos os curadores" valor={curador} opcoes={curadores} aoMudar={setCurador} />
        <Filtro
          vazio="Todos os proprietários"
          valor={proprietario}
          opcoes={proprietarios}
          aoMudar={setProprietario}
        />
        <span style={{ color: 'var(--text-3)', fontSize: 13 }}>
          {visiveis.length} {visiveis.length === 1 ? 'ticket' : 'tickets'}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(268px, 1fr))',
          gap: 12,
        }}
      >
        {visiveis.map((l) => (
          <a
            key={l.id}
            href={l.link}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'block',
              textDecoration: 'none',
              color: 'inherit',
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius)',
              padding: '14px 16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 9,
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: `var(--${l.cor}-bg)`,
                  color: `var(--${l.cor})`,
                  borderRadius: 7,
                  padding: '3px 9px',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 4, background: `var(--${l.cor})` }} />
                {prazo(l)}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {l.diasEvento >= 0 ? `D-${l.diasEvento}` : `D+${-l.diasEvento}`}
              </span>
            </div>

            <div style={{ fontWeight: 500, letterSpacing: '-0.01em' }}>{l.cliente}</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              {l.palestrante || '—'} · evento {dataBr(l.evento)}
            </div>

            <div style={{ fontSize: 13, color: `var(--${l.cor})`, marginTop: 8 }}>
              Sai da etapa até {dataBr(l.vence)} · {l.diasNaEtapa} dias parado
            </div>

            <div
              style={{
                marginTop: 10,
                paddingTop: 9,
                borderTop: '1px solid var(--line)',
                fontSize: 12,
                color: 'var(--text-3)',
              }}
            >
              <div style={{ color: 'var(--text-2)' }}>{l.etapa}</div>
              <Pessoa papel="Curador" nome={l.curador} inativo={l.curadorInativo} />
              <Pessoa papel="Proprietário" nome={l.proprietario} inativo={l.proprietarioInativo} />
            </div>
          </a>
        ))}
      </div>

      {visiveis.length === 0 && (
        <p style={{ color: 'var(--text-3)' }}>Nenhum ticket com esse filtro.</p>
      )}
    </main>
  )
}
