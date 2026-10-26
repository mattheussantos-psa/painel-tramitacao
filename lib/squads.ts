// As duas squads de CS, para a auditoria das gestoras: cada gestora abre o
// painel já recortado na sua equipe.
//
// O vínculo é pelo PROPRIETÁRIO do ticket, não pelo curador. Medido em
// 15/10/2026 sobre os 319 tickets ativos: ZERO têm alguém das squads como
// curador, e 230 têm como proprietário (120 Cami, 110 Katy). Filtrar por
// curador devolveria quadro vazio.
//
// A chave é o e-mail e não o id do owner: é o que o CS passa, e sobrevive a
// recriação de conta. A resolução para id acontece na leitura dos owners.

export const SQUADS: Record<string, string[]> = {
  'Squad Cami': [
    'jhuly.carvalho@profissionaissa.com',
    'luiza.rodriguez@profissionaissa.com',
    'maria.azevedo@profissionaissa.com',
    'hans.lopes@profissionaissa.com',
    'vitoria.schaeffer@profissionaissa.com',
    'nathalia.pereira@profissionaissa.com',
    'rhayssa.wolkmer@profissionaissa.com',
    'talita.cruz@profissionaissa.com',
  ],
  'Squad Katy': [
    'juliano.marques@profissionaissa.com',
    'francielle.lenz@profissionaissa.com',
    'francielle.sotoriva@profissionaissa.com',
    'bruna.saraiva@profissionaissa.com',
    'thaina.malta@profissionaissa.com',
    'eduardo.godoy@profissionaissa.com',
    'matheus.lirio@profissionaissa.com',
    'bruno.beck@profissionaissa.com',
  ],
}

export const NOMES_SQUADS = Object.keys(SQUADS)

// 89 dos 319 tickets ativos não são de ninguém das duas squads. Sem esta
// opção eles sumiriam do recorte sem ninguém notar.
export const FORA_DAS_SQUADS = 'Fora das squads'

const POR_EMAIL = new Map<string, string>()
for (const [squad, emails] of Object.entries(SQUADS))
  for (const e of emails) POR_EMAIL.set(e.toLowerCase(), squad)

export const squadDoEmail = (email: string | undefined | null) =>
  POR_EMAIL.get((email ?? '').toLowerCase().trim()) ?? null
