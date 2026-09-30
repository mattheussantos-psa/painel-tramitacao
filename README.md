# painel-tramitacao

Sinaleira dos tickets abertos do pipeline **CS** (`748675953`) do HubSpot.

```bash
npm install
npm run dev    # http://localhost:3005
npm test       # self-check da lógica de cor
```

## Como a cor sai

O relógio é o **tempo na etapa**, contado de `hs_v2_date_entered_current_stage`.
A exceção é Aguardando Evento, que segura até a data do evento.

| Etapa | Id | Prazo |
|---|---|---|
| Aguardando Onboarding | 1088360204 | 7 dias na etapa |
| Em andamento | 1088360205 | 20 dias na etapa |
| Aguardando Evento | 1448673032 | até o evento |

Etapa de conferência, Pagamento Pós-Palestra e Aguardando NF Palestrante ficam
**fora do painel** por decisão do CS: não são etapas de atuação do farmer e não
têm prazo acordado.

## Alertas de processo

Eixo separado da cor. A cor diz se o ticket está travado na etapa; o alerta diz
que um marco específico passou do prazo. Um ticket pode estar verde e ter
alerta.

| Alerta | Regra | Sinal de conclusão |
|---|---|---|
| Contrato pendente de assinatura | 20 dias após `data_de_realizacao_do_onboarding` | `status_do_contrato` = Assinado, preenchido em 99% |
| Call de Briefing pendente | a partir de D-15 do evento | `data_de_realizacao_do_onboarding` preenchida |

Pendente de definição com o CS: **envio de contrato**, que precisa de um estado
"Enviado" em `status_do_contrato` — hoje ele só tem Assinado e Pendente, e
Pendente não distingue "não enviei" de "enviei e não assinaram"; e **checklist**,
que o CS vai criar como propriedade nova.

Passado o prazo em mais de `TOLERANCIA` dias vira vermelho; dentro da faixa de
`AMARELO_ANTES` a `TOLERANCIA`, amarelo; antes disso, verde.

Etapa sem prazo acordado fica **cinza**, nunca verde — e o número que sobe é o
tempo parado, para o mais esquecido aparecer primeiro mesmo sem régua. Hoje são
221 dos 439 tickets nessa situação, à espera de três números.

Medir contra o tempo na etapa, e não contra a data do evento, foi o que
corrigiu o defeito de origem: na versão anterior um ticket criado 6 dias antes
da palestra já nascia com 30 dias de atraso numa etapa em que acabara de
entrar. 21% dos tickets das etapas iniciais caíam nisso.

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

Scopes: `crm.objects.tickets.read`, `crm.objects.owners.read` e
`crm.objects.contacts.read`.

O último é o que libera a leitura de **tarefas**: o HubSpot não tem escopo
próprio para engajamento — tarefa, ligação, reunião e nota entram todos debaixo
do escopo de contatos. Não procure por `crm.objects.tasks.read`, esse não
existe.

Os dois últimos são acessórios: sem eles o painel serve os tickets do mesmo
jeito, mostrando id no lugar do nome do curador e caindo em
`hs_nextactivitydate` para a tarefa — que só enxerga atividade futura. O motivo
aparece numa tarja na tela.

## Tarefas

Medido em 29/09/2026 nos 440 tickets abertos, lendo o objeto task pela
associação:

| | |
|---|---|
| com tarefa em aberto | 126 — 29% |
| dela, vencida | 103 |
| dela, em dia | 23 |
| sem tarefa nenhuma | 314 — 71% |

A propriedade `hs_nextactivitydate` do ticket mostrava só 26 desses 126, porque
ela guarda apenas atividade futura e descarta tarefa vencida. Por isso o painel
lê as tarefas pela associação em vez de usar a propriedade.

O número também explica por que a régua do painel é por etapa e não por tarefa:
em 71% dos tickets não há tarefa nenhuma para medir.

## Pendências conhecidas

- O snapshot em data/snapshot.json foi capturado antes de o campo proprietário
  existir, então ali ele aparece vazio. Ao vivo vem preenchido. Só afeta quem
  roda local sem token.

- `data/curadores.json` tem o `isActive` de apenas 6 owners, os que foram
  conferidos na API. O fetch ao vivo deve puxar de `/crm/v3/owners` para todos.
  Dos 6, **5 estão desativados** e aparecem marcados em vermelho no card.
- O snapshot ainda carrega o campo `etapas` de uma versão anterior da régua.
  Não é lido por nada; sai na próxima captura.
