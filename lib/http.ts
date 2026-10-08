// Cliente HTTP do HubSpot, num arquivo só para o painel e a guia Closer
// usarem o mesmo — e para o teste poder importar sem arrastar os aliases do
// Next, que o Node puro não resolve.

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

// O search do HubSpot tem teto por segundo (policy SECONDLY, 4 req/s). Paginar
// centenas de registros em sequência já estoura sozinho, e o teto é da conta
// inteira: outro integrador consumindo a cota derruba o painel do mesmo jeito.
// Então espaça as chamadas e tenta de novo no 429 em vez de morrer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function chamar(url: string | URL, init: RequestInit, onde: string): Promise<any> {
  for (let tentativa = 0; ; tentativa++) {
    // O fetch do Next é instrumentado e guarda a resposta por conta própria.
    // Sem no-store o painel servia resposta velha carimbando "ao vivo": em
    // 05/10/2026 um ticket aparecia na etapa de três dias antes enquanto a
    // mesma busca, feita no mesmo processo com no-store, trazia a etapa certa.
    // force-dynamic na página não cobre isso — é cache de dado, não de rota.
    const res = await fetch(url, { ...init, cache: 'no-store' })
    if (res.status !== 429 || tentativa >= 4) return json(res, onde)

    const retryAfter = Number(res.headers.get('Retry-After'))
    await espera(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** tentativa * 500)
  }
}

export async function json(res: Response, onde: string) {
  // O HubSpot devolve HTML em alguns erros (owner desativado, token sem
  // escopo). Sem esta checagem o .json() estoura com um erro que não diz nada.
  // 600 e não 300: a resposta de escopo faltando traz a lista de escopos
  // exigidos no fim do corpo, que é justamente o que precisamos ler.
  if (!res.ok) {
    throw new Error(`HubSpot ${onde} respondeu ${res.status}: ${(await res.text()).slice(0, 600)}`)
  }
  return res.json()
}
