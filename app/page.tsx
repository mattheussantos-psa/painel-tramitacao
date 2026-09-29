import { carregar, nomeCurador, curadorInativo, linkTicket } from '@/lib/hubspot'
import { avaliar, cliente, palestrante, diasParaEvento, diasNaEtapa } from '@/lib/sinaleira'
import Painel from '@/components/Painel'

export const dynamic = 'force-dynamic'

// Quem precisa de ação primeiro. Dentro da mesma cor, o mais atrasado sobe.
const PRIORIDADE = { vermelho: 0, amarelo: 1, cinza: 2, verde: 3 }

export default async function Page() {
  const { tickets, aoVivo, capturadoEm } = await carregar()
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
        curador: nomeCurador(t.curador),
        curadorInativo: curadorInativo(t.curador),
        ...a,
      }
    })
    .sort((a, b) => PRIORIDADE[a.cor] - PRIORIDADE[b.cor] || b.dias - a.dias)

  return <Painel linhas={linhas} aoVivo={aoVivo} capturadoEm={capturadoEm} />
}
