import Quadro from './quadro'
import { QUADROS } from '@/lib/sinaleira'

// Nada de prerender no build: a pagina renderiza por requisicao e quem segura
// o HubSpot e o cache com TTL dentro de carregar().
export const metadata = { title: 'Sinaleira · Tramitação CS' }

export const dynamic = 'force-dynamic'

export default function Page({ searchParams }: { searchParams: { r?: string } }) {
  return <Quadro quadro={QUADROS.cs} forcar={!!searchParams.r} />
}
