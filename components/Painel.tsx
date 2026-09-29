'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Cor, Regua } from '@/lib/sinaleira'

const POR_PAGINA = 40

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

// Os cards se ajustam à largura: em tela larga viram 5 colunas em vez de
// deixar meia tela vazia dos dois lados.
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

// Curador e proprietário na mesma linha, sem rótulo e sem travessão quando
// faltam. A versão com "Curador —" repetido em todo card era só ruído.
function pessoas(l: Linha) {
  const nomes = [l.curador, l.proprietario].filter(Boolean) as string[]
  const unicos = [...new Set(nomes)]
  return unicos.length ? unicos.join(' · ') : 'sem responsável'
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
        fontSize: 13,
        padding: '6px 10px',
        borderRadius: 8,
        border: 0,
        background: 'var(--cinza-bg)',
        color: valor ? 'var(--text)' : 'var(--text-2)',
        maxWidth: 210,
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

function Passo({
  rotulo,
  ativo,
  aoClicar,
}: {
  rotulo: string
  ativo: boolean
  aoClicar: () => void
}) {
  return (
    <button
      onClick={aoClicar}
      disabled={!ativo}
      aria-label={rotulo === '‹' ? 'Página anterior' : 'Próxima página'}
      style={{
        border: 0,
        background: 'var(--cinza-bg)',
        color: 'var(--text-2)',
        borderRadius: 8,
        width: 30,
        height: 30,
        fontSize: 16,
        lineHeight: 1,
        cursor: ativo ? 'pointer' : 'default',
        opacity: ativo ? 1 : 0.35,
      }}
    >
      {rotulo}
    </button>
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
  const [etapa, setEtapa] = useState('')
  const [semDono, setSemDono] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [rankingInteiro, setRankingInteiro] = useState(false)

  // Qualquer filtro muda o conjunto: ficar na página 5 de um recorte que agora
  // tem 3 itens deixa a tela vazia sem explicação.
  useEffect(() => {
    setPagina(0)
  }, [regua, cor, curador, proprietario, etapa, semDono])

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

  const base = semDono ? porPessoa.filter(orfao) : porPessoa

  const porEtapa = useMemo(() => {
    const c = new Map<string, number>()
    for (const l of base) c.set(l.etapa, (c.get(l.etapa) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }, [base])

  const comEtapa = etapa ? base.filter((l) => l.etapa === etapa) : base

  // A cor fica de fora da contagem de propósito: se entrasse, clicar em
  // "Atrasado" zerava os outros três e a pessoa perdia a visão do quadro.
  const contagem = useMemo(() => {
    const c: Record<Cor, number> = { vermelho: 0, amarelo: 0, verde: 0, cinza: 0 }
    for (const l of comEtapa) c[l.cor]++
    return c
  }, [comEtapa])

  const visiveis = comEtapa.filter((l) => !cor || l.cor === cor)

  const paginas = Math.max(1, Math.ceil(visiveis.length / POR_PAGINA))
  const atual = Math.min(pagina, paginas - 1)
  const naTela = visiveis.slice(atual * POR_PAGINA, (atual + 1) * POR_PAGINA)

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
    setEtapa('')
    setSemDono(false)
  }

  const filtrando = !!(cor || curador || proprietario || etapa || semDono)
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

      <div
        style={{
          display: 'inline-flex',
          background: 'var(--cinza-bg)',
          borderRadius: 9,
          padding: 2,
          marginBottom: 18,
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
              borderRadius: 7,
              padding: '6px 16px',
              fontSize: 14,
              fontWeight: regua === v ? 500 : 400,
              background: regua === v ? 'var(--card)' : 'transparent',
              color: regua === v ? 'var(--text)' : 'var(--text-2)',
            }}
          >
            {label}
          </button>
        ))}
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

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 18,
          flexWrap: 'wrap',
        }}
      >
        <Filtro vazio="Curador" valor={curador} opcoes={curadores} aoMudar={setCurador} />
        <Filtro
          vazio="Proprietário"
          valor={proprietario}
          opcoes={proprietarios}
          aoMudar={setProprietario}
        />

        {porEtapa.map(([nome, n]) => (
          <button
            key={nome}
            onClick={() => setEtapa(etapa === nome ? '' : nome)}
            style={{
              border: 0,
              background: etapa === nome ? 'var(--text)' : 'var(--cinza-bg)',
              color: etapa === nome ? 'var(--card)' : 'var(--text-2)',
              borderRadius: 8,
              padding: '6px 11px',
              fontSize: 13,
            }}
          >
            {nome} {n}
          </button>
        ))}

        {orfaos > 0 && (
          <button
            onClick={() => setSemDono(!semDono)}
            style={{
              border: 0,
              background: semDono ? 'var(--vermelho)' : 'var(--cinza-bg)',
              color: semDono ? 'var(--card)' : 'var(--text-2)',
              borderRadius: 8,
              padding: '6px 11px',
              fontSize: 13,
            }}
          >
            Sem responsável {orfaos}
          </button>
        )}

        {filtrando && (
          <button
            onClick={limpar}
            style={{
              border: 0,
              background: 'transparent',
              color: 'var(--text-3)',
              fontSize: 13,
              padding: '6px 2px',
            }}
          >
            Limpar
          </button>
        )}
      </div>

      <Grade>
        {naTela.map((l) => (
          <a
            key={l.id}
            href={l.link}
            target="_blank"
            rel="noreferrer"
            className="cartao"
            style={{
              display: 'block',
              textDecoration: 'none',
              color: 'inherit',
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: 12,
              padding: '13px 15px 12px',
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 500,
                  color: `var(--${l.cor})`,
                }}
              >
                <Ponto cor={l.cor} />
                {prazo(l)}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {l.diasEvento >= 0 ? `D-${l.diasEvento}` : `D+${-l.diasEvento}`}
              </span>
            </span>

            <span
              style={{
                display: 'block',
                fontSize: 16,
                fontWeight: 600,
                letterSpacing: '-0.015em',
                lineHeight: 1.25,
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
                fontSize: 13,
                color: 'var(--text-2)',
                marginTop: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {[l.palestrante, dataBr(l.evento)].filter(Boolean).join(' · ')}
            </span>

            <span
              style={{
                display: 'block',
                marginTop: 11,
                paddingTop: 10,
                borderTop: '1px solid var(--line)',
                fontSize: 12,
                color: 'var(--text-2)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {l.etapa} · {l.diasNaEtapa}d parado
            </span>
            <span
              style={{
                display: 'block',
                fontSize: 12,
                marginTop: 2,
                color:
                  l.curadorInativo || l.proprietarioInativo ? 'var(--vermelho)' : 'var(--text-3)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {pessoas(l)}
            </span>
          </a>
        ))}
      </Grade>

      {visiveis.length === 0 && (
        <p style={{ color: 'var(--text-3)', fontSize: 14 }}>Nenhum ticket com esse filtro.</p>
      )}

      {paginas > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            margin: '20px 0 28px',
            fontSize: 13,
          }}
        >
          <span style={{ color: 'var(--text-3)' }}>
            {atual * POR_PAGINA + 1}–{Math.min((atual + 1) * POR_PAGINA, visiveis.length)} de{' '}
            {visiveis.length}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Passo rotulo="‹" ativo={atual > 0} aoClicar={() => setPagina(atual - 1)} />
            <span style={{ color: 'var(--text-2)', padding: '0 8px' }}>
              {atual + 1} de {paginas}
            </span>
            <Passo rotulo="›" ativo={atual < paginas - 1} aoClicar={() => setPagina(atual + 1)} />
          </span>
        </div>
      )}

      {/* Ranking no fim: é leitura de gestão, não a tarefa do dia. Em cima ele
          empurrava os tickets para baixo da dobra. */}
      <Grupo style={{ marginTop: 28, maxWidth: 560 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 52px 52px 52px',
            gap: 4,
            padding: '11px 18px',
            fontSize: 12,
            color: 'var(--text-3)',
          }}
        >
          <span>Por proprietário</span>
          <span style={{ textAlign: 'right' }}>Atraso</span>
          <span style={{ textAlign: 'right' }}>Atenção</span>
          <span style={{ textAlign: 'right' }}>Em dia</span>
        </div>

        {(rankingInteiro ? ranking : ranking.slice(0, 6)).map((r) => (
          <button
            key={r.nome}
            onClick={() => setProprietario(proprietario === r.nome ? '' : r.nome)}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 52px 52px 52px',
              gap: 4,
              width: '100%',
              textAlign: 'left',
              border: 0,
              borderTop: '1px solid var(--line)',
              background: proprietario === r.nome ? 'var(--cinza-bg)' : 'transparent',
              padding: '11px 18px',
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
          </button>
        ))}

        {ranking.length > 6 && (
          <button
            onClick={() => setRankingInteiro(!rankingInteiro)}
            style={{
              width: '100%',
              textAlign: 'left',
              border: 0,
              borderTop: '1px solid var(--line)',
              background: 'transparent',
              color: 'var(--link)',
              fontSize: 13,
              padding: '11px 18px',
            }}
          >
            {rankingInteiro ? 'Mostrar menos' : `Mostrar todos os ${ranking.length}`}
          </button>
        )}
      </Grupo>
    </main>
  )
}
