# painel-tramitacao

Sinaleira dos tickets abertos do pipeline **CS** (`748675953`) do HubSpot.

```bash
npm install
npm run dev    # http://localhost:3005
npm test       # self-check da lógica de cor
```

## Como a cor sai

O relógio é a **etapa do ticket** (`hs_pipeline_stage`), e cada etapa tem um
prazo em dias relativos à **data do evento** (`data_do_evento__ganho_`).
Negativo = o ticket tem que sair da etapa antes do evento.

| Etapa | Id | Sai até | Tickets |
|---|---|---|---|
| Etapa de conferência | 1088360203 | D-45 | 14 |
| Iniciar Trâmites | 1088360204 | D-30 | 39 |
| Em andamento | 1088360205 | D-0 | 184 |
| Pagamento Pós-Palestra | 1088361911 | D+15 | 110 |
| Aguardando NF Palestrante | 1333136740 | D+30 | 88 |

`atraso = hoje − (evento + prazo)`. Acima de `TOLERANCIA` vira vermelho, dentro
da faixa `AMARELO_ANTES`…`TOLERANCIA` vira amarelo, antes disso verde.

Etapa que não estiver na tabela fica **cinza**, nunca verde — para não sumir
com um ticket por omissão de regra.

## Etapas de fora

As outras 4 etapas do CS ficam fora porque têm `closed_date` preenchido — o
ticket foi encerrado, não está atrasado:

| Etapa | Tickets |
|---|---|
| Aprovação Arquivo | 422 |
| Stand by | 27 |
| Concluído | 3.692 |
| Cancelado | 189 |

Stand by inclusive guarda tickets com evento em 2027, parados de propósito.
Se algum desses precisar entrar na sinaleira, é acrescentar uma linha em `SLA`.

## Calibrar

Tudo que é palpite meu está no topo de [`lib/sinaleira.ts`](lib/sinaleira.ts):
os prazos de `SLA`, e as larguras `AMARELO_ANTES` e `TOLERANCIA`. Mexer nesses
números não exige mexer no cálculo — `npm test` cobre as bordas.

## Dados

Preenchimento medido nos 436 tickets abertos: `data_do_evento__ganho_` 100%,
`hubspot_owner_id` 99%, `hs_v2_date_entered_current_stage` 94%,
`curador_responsavel_new` 92%.

Os campos `prazo_*` do ticket ficaram de fora: `prazo_de_aquisicao_de_logistica`
tem 3,7% de preenchimento e `prazo_para_assinatura_de_contrato` tem 0%. Sinaleira
em cima deles pinta verde por ausência de dado.

Sem `HUBSPOT_TOKEN`, o painel roda no snapshot em
[`data/snapshot.json`](data/snapshot.json) — 64 tickets reais capturados em
29/09/2026. Com o token em `.env.local`, busca ao vivo; se a busca falhar, ele
quebra em vez de cair no snapshot em silêncio.

```
HUBSPOT_TOKEN=pat-na1-...
HUBSPOT_PIPELINE_CS=748675953
```

Scopes: `crm.objects.tickets.read`, `crm.objects.owners.read`.

## Pendências conhecidas

- `data/curadores.json` tem o `isActive` de apenas 6 owners, os que foram
  conferidos na API. O fetch ao vivo deve puxar de `/crm/v3/owners` para todos.
  Dos 6, **5 estão desativados** e aparecem marcados em vermelho no card.
- O snapshot ainda carrega o campo `etapas` de uma versão anterior da régua.
  Não é lido por nada; sai na próxima captura.
