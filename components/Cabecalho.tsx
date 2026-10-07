'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ABAS } from '@/lib/sinaleira'

const dataBr = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—')

// Recarrega pulando o cache de 60s do servidor. Sem o ?r o botão devolveria o
// mesmo retrato por até um minuto — e depois de mexer no HubSpot é isso que
// faz alguém achar que o painel está errado.
function Atualizar() {
  const [indo, setIndo] = useState(false)
  return (
    <button
      onClick={() => {
        setIndo(true)
        window.location.href = `${window.location.pathname}?r=${Date.now()}`
      }}
      disabled={indo}
      style={{
        height: 28,
        padding: '0 11px',
        border: 0,
        borderRadius: 7,
        background: 'var(--cinza-bg)',
        color: 'var(--text)',
        font: 'inherit',
        fontSize: 13,
        flexShrink: 0,
      }}
    >
      {indo ? 'Atualizando…' : 'Atualizar'}
    </button>
  )
}

// Cabeçalho de todas as guias. Vive num arquivo só para o quadro e o
// calendário não divergirem no título, no horário e na barra de guias.
// A barra de guias sozinha: o esqueleto de carregamento usa a mesma, para a
// casca nao piscar enquanto a pagina nova nao chega. Guia e link e nao
// estado: cada uma tem a propria URL e o proprio fetch, e trocar de guia nao
// pode arrastar dado de uma para a outra.
export function Guias({ slug }: { slug: string }) {
  const router = useRouter()
  const [indo, comecar] = useTransition()
  const [alvo, setAlvo] = useState<string | null>(null)

  return (
    <nav
      style={{
        display: 'inline-flex',
        background: 'var(--cinza-bg)',
        borderRadius: 9,
        padding: 2,
        height: 36,
      }}
    >
      {ABAS.map((a) => {
        const ativa = a.slug === slug
        return (
          <Link
            key={a.slug}
            href={a.href}
            prefetch={false}
            onClick={(e) => {
              // Navegacao pela mao para a guia clicada acender na hora. Com
              // o Link puro o clique nao devolvia nada por ate um segundo e
              // parecia que o botao nao funcionava.
              if (ativa) return
              e.preventDefault()
              setAlvo(a.slug)
              comecar(() => router.push(a.href))
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              borderRadius: 7,
              padding: '0 15px',
              fontSize: 13,
              fontWeight: ativa ? 600 : 400,
              textDecoration: 'none',
              background: ativa || (indo && alvo === a.slug) ? 'var(--card)' : 'transparent',
              color: 'var(--text)',
              opacity: indo && alvo !== a.slug && !ativa ? 0.5 : 1,
            }}
          >
            {indo && alvo === a.slug ? 'Abrindo…' : a.nome}
          </Link>
        )
      })}
    </nav>
  )
}

export default function Cabecalho({
  slug,
  resumo,
  aoVivo,
  atualizadoEm,
  capturadoEm,
}: {
  slug: string
  resumo: string
  aoVivo: boolean
  atualizadoEm: string
  capturadoEm: string
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 24,
      }}
    >
      <div>
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
        <p
          style={{
            color: 'var(--text-2)',
            margin: '8px 0 0',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span>
            {resumo} · {aoVivo ? `ao vivo, ${atualizadoEm}` : `snapshot de ${dataBr(capturadoEm)}`}
          </span>
          <Atualizar />
        </p>
      </div>

      <Guias slug={slug} />
    </header>
  )
}
