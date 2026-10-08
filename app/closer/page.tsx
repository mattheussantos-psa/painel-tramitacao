import { buscarOwners } from '@/lib/hubspot'
import { buscarPropostaMesmoDia, buscarSlaOnboarding } from '@/lib/closer'
import CloserCards from '@/components/CloserCards'

export const metadata = { title: 'Sinaleira · Closer' }

export const dynamic = 'force-dynamic'
// Os dois cards leem negocio, nao ticket, e o de proposta percorre historico de
// propriedade e reuniao de 349 negocios: passa do teto padrao de 10s.
export const maxDuration = 60

// Cache proprio, igual ao do painel e pelo mesmo motivo: o teto do HubSpot e da
// conta inteira, e esta guia e a mais cara de todas.
const TTL = 60_000
let cache: { em: number; dados: Dados } | null = null

type Dados = Awaited<ReturnType<typeof montar>>

async function montar(token: string) {
  const owners = await buscarOwners(token)
  const nomeDe = (id: string) => owners[String(id)]?.nome ?? ''
  const hoje = Date.now()
  const [closers, sla] = await Promise.all([
    buscarPropostaMesmoDia(token, nomeDe, hoje),
    buscarSlaOnboarding(token, nomeDe, hoje),
  ])
  return {
    closers,
    sla,
    atualizadoEm: new Date(hoje).toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    }),
  }
}

export default async function Page({ searchParams }: { searchParams: { r?: string } }) {
  const token = process.env.HUBSPOT_TOKEN
  if (!token)
    return (
      <CloserCards
        closers={[]}
        sla={{ rotulo: 'Aguardando Onboarding', prazoDias: 2, total: 0, atrasados: 0, negocios: [] }}
        aoVivo={false}
        atualizadoEm=""
        capturadoEm=""
        aviso="Sem HUBSPOT_TOKEN: esta guia só existe ao vivo."
      />
    )

  const guardado = cache
  const usar = !searchParams.r && guardado && Date.now() - guardado.em < TTL ? guardado.dados : null
  const dados = usar ?? (await montar(token))
  if (!usar) cache = { em: Date.now(), dados }

  return (
    <CloserCards
      closers={dados.closers}
      sla={dados.sla}
      aoVivo
      atualizadoEm={dados.atualizadoEm}
      capturadoEm=""
    />
  )
}
