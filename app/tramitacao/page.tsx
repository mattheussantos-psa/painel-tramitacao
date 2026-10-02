import Quadro from '../quadro'
import { QUADROS } from '@/lib/sinaleira'

export const metadata = { title: 'Sinaleira · Tramitação' }

export const dynamic = 'force-dynamic'

export default function Page() {
  return <Quadro quadro={QUADROS.tramitacao} />
}
