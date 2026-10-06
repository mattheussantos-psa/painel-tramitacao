import { carregar } from '@/lib/hubspot'
import { QUADROS } from '@/lib/sinaleira'
import Calendario from '@/components/Calendario'
import { linhasDe } from '../quadro'

export const metadata = { title: 'Sinaleira · Calendário' }

export const dynamic = 'force-dynamic'

export default async function Page({ searchParams }: { searchParams: { r?: string } }) {
  const quadro = QUADROS.cs
  const fonte = await carregar(quadro.slug, !!searchParams.r)
  const hoje = Date.now()

  return (
    <Calendario
      linhas={linhasDe(fonte, quadro, hoje)}
      // A data de hoje vem do servidor, no fuso de São Paulo: calcular no
      // navegador marcaria o dia errado para quem abrisse de outro fuso.
      hoje={new Date(hoje).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })}
      aoVivo={fonte.aoVivo}
      atualizadoEm={fonte.atualizadoEm}
      capturadoEm={fonte.capturadoEm}
    />
  )
}
