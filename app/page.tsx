import { carregar, nomeCurador, curadorInativo, linkTicket } from '@/lib/hubspot'
import {
  avaliar,
  cliente,
  palestrante,
  diasParaEvento,
  diasNaEtapa,
  diasParaTarefa,
  alertas,
} from '@/lib/sinaleira'
import Painel from '@/components/Painel'

// Nada de prerender no build: a pagina renderiza por requisicao e quem segura
// o HubSpot e o cache com TTL dentro de carregar().
export const dynamic = 'force-dynamic'

// Quem precisa de ação primeiro. Dentro da mesma cor, o mais atrasado sobe.
const PRIORIDADE = { vermelho: 0, amarelo: 1, cinza: 2, verde: 3 }

// Erro no fetch não pode virar tela branca com digest: na Vercel a mensagem
// some nos logs e o painel fica indistinguível de "não tem ticket".
function Falha({ mensagem }: { mensagem: string }) {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '56px 24px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, color: 'var(--vermelho)' }}>
        Não consegui carregar os tickets
      </h1>
      <p style={{ color: 'var(--text-2)' }}>
        O painel tem <code>HUBSPOT_TOKEN</code> configurado, então buscou ao vivo e a busca falhou.
        Não caí no snapshot de propósito — número velho passando por atual é pior que erro.
      </p>
      <pre
        style={{
          background: 'var(--vermelho-bg)',
          color: 'var(--vermelho)',
          border: '1px solid var(--border-vermelho, transparent)',
          borderRadius: 'var(--radius)',
          padding: '14px 16px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 13,
        }}
      >
        {mensagem}
      </pre>
    </main>
  )
}

export default async function Page() {
  let fonte
  try {
    fonte = await carregar()
  } catch (e) {
    return <Falha mensagem={e instanceof Error ? e.message : String(e)} />
  }

  const { tickets, owners, aoVivo, capturadoEm, atualizadoEm, aviso } = fonte
  const hoje = Date.now()

  const linhas = tickets
    .map((t) => {
      const a = avaliar(t, hoje)
      return {
        id: t.id,
        link: linkTicket(t.id),
        cliente: cliente(t.subject),
        palestrante: palestrante(t.subject),
        evento: t.evento,
        diasEvento: diasParaEvento(t, hoje),
        diasNaEtapa: diasNaEtapa(t, hoje),
        diasTarefa: diasParaTarefa(t, hoje),
        alertas: alertas(t, hoje),
        stage: t.stage,
        curador: nomeCurador(owners, t.curador),
        curadorInativo: curadorInativo(owners, t.curador),
        proprietario: nomeCurador(owners, t.proprietario),
        proprietarioInativo: curadorInativo(owners, t.proprietario),
        ...a,
      }
    })
    .sort((a, b) => PRIORIDADE[a.cor] - PRIORIDADE[b.cor] || b.dias - a.dias)

  return <Painel linhas={linhas} aoVivo={aoVivo} capturadoEm={capturadoEm} atualizadoEm={atualizadoEm} aviso={aviso} />
}
