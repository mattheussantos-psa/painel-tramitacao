import { Guias } from './Cabecalho'

// Casca mostrada enquanto a página nova não chega. Trocar de guia leva de
// 0,6s a 1s no servidor, e mais quando o cache expira: sem isso o Next segura
// a página antiga inteira e o clique não devolve nada, o que faz o botão
// parecer quebrado. O título e as guias continuam no lugar para a tela não
// piscar de branco entre uma guia e outra.
export default function Esqueleto({ slug }: { slug: string }) {
  return (
    <main style={{ maxWidth: 1680, margin: '0 auto', padding: '44px 32px 72px' }}>
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
          <p style={{ color: 'var(--text-2)', margin: '8px 0 0', fontSize: 14 }}>
            Carregando os tickets do HubSpot…
          </p>
        </div>
        <Guias slug={slug} />
      </header>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', overflow: 'hidden' }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              flex: '1 0 300px',
              background: 'var(--cinza-bg)',
              borderRadius: 14,
              padding: 10,
              minWidth: 0,
            }}
          >
            <div
              style={{
                height: 14,
                width: '55%',
                borderRadius: 5,
                background: 'var(--card)',
                margin: '5px 6px 14px',
              }}
            />
            {[0, 1, 2].map((j) => (
              <div
                key={j}
                className="pulsando"
                style={{
                  height: 96,
                  borderRadius: 12,
                  background: 'var(--card)',
                  marginBottom: 8,
                  animationDelay: `${(i * 3 + j) * 70}ms`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </main>
  )
}
