import { carregar, nomeCurador, curadorInativo, linkTicket, type Fonte } from '@/lib/hubspot'
import { alertas, avaliarEtapa, explicar } from '@/lib/relogios'
import {
  cliente,
  palestrante,
  diasParaEvento,
  diasNaEtapa,
  diasParaTarefa,
  type Quadro,
} from '@/lib/sinaleira'
import Painel from '@/components/Painel'

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

// Um quadro por pipeline. A mesma montagem serve os dois porque o que muda é
// a tabela de prazos e se o quadro corre contra a data do evento — o resto do
// cálculo é igual.
// A mesma linha serve o quadro e o calendário: duas montagens dariam duas
// cores para o mesmo ticket na hora que uma das duas ficasse para trás.
export function linhasDe(fonte: Fonte, quadro: Quadro, hoje: number) {
  const { tickets, owners } = fonte
  return tickets
    .map((t) => {
      const a = avaliarEtapa(t, hoje, quadro.sla)
      return {
        id: t.id,
        link: linkTicket(t.id),
        cliente: cliente(t.subject),
        palestrante: palestrante(t.subject),
        evento: t.evento,
        diasEvento: diasParaEvento(t, hoje),
        diasNaEtapa: diasNaEtapa(t, hoje),
        diasTarefa: diasParaTarefa(t, hoje),
        alertas: alertas(t, hoje, quadro.sla),
        entrouEtapa: t.entrouEtapa,
        conta: explicar(t, quadro.sla[t.stage]?.label ?? '', hoje),
        stage: t.stage,
        curador: nomeCurador(owners, t.curador),
        curadorInativo: curadorInativo(owners, t.curador),
        proprietario: nomeCurador(owners, t.proprietario),
        proprietarioInativo: curadorInativo(owners, t.proprietario),
        ...a,
      }
    })
    // Por data do evento, nao por cor nem por atraso: ordenar por atraso
    // agrupa as cores, porque a cor vem dele. O quadro tem que sair misturado.
    // Sem data de evento, por nome — ordem neutra, que é o ponto.
    .sort((a, b) =>
      quadro.evento ? a.evento.localeCompare(b.evento) : a.cliente.localeCompare(b.cliente, 'pt-BR'),
    )
}

export default async function Quadro({ quadro, forcar }: { quadro: Quadro; forcar?: boolean }) {
  let fonte
  try {
    fonte = await carregar(quadro.slug, forcar)
  } catch (e) {
    return <Falha mensagem={e instanceof Error ? e.message : String(e)} />
  }

  const { aoVivo, capturadoEm, atualizadoEm, aviso } = fonte
  const linhas = linhasDe(fonte, quadro, Date.now())

  return (
    <Painel
      linhas={linhas}
      quadro={{ slug: quadro.slug, nome: quadro.nome, evento: quadro.evento, sla: quadro.sla }}
      aoVivo={aoVivo}
      capturadoEm={capturadoEm}
      atualizadoEm={atualizadoEm}
      aviso={aviso}
    />
  )
}
