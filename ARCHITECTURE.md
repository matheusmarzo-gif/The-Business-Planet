# Arquitetura de Valdora

Este documento descreve o jogo e o aplicativo conforme implementados. Consulte
[`AGENTS.md`](./AGENTS.md) e este documento antes de alterar o projeto e
confirme sempre o comportamento no código atual.

## Visão geral

Valdora é um jogo medieval de mundo compartilhado, renderizado no navegador.
O jogador entra com uma conta Neon Auth, explora um mapa procedural de
4.000 × 4.000 tiles e recebe as cidades, estradas, relógio e presença do mundo
em tempo real. O servidor Node.js/Express fornece a API e o WebSocket; Neon
PostgreSQL guarda o estado persistente; Redis coordena presença e distribui
atualizações entre instâncias.

O mapa base é determinístico: não é persistido tile a tile. Cidades, estradas
e residências são sobrepostas ao terreno gerado. Atualmente, a Prefeitura
oferece a Assembleia e a Estrada de Terra. A conta master pode dividir cada
área municipal em regiões urbanas e rurais persistentes. Duas residências
podem ser colocadas em áreas urbanas ao lado de estradas; elas ficam em
construção até a master concluí-las instantaneamente. O jogo também possui um
catálogo estático de produtos com atributos padrão; estoques, produção e
deterioração ainda não estão implementados. População, bem-estar e economia
são dados da cidade, mas ainda não existe simulação econômica ou de crescimento
que os altere.

## Estrutura do repositório

O aplicativo de produção está em
[`tilescape_projeto_completo_4000x4000_seed583921/`](./tilescape_projeto_completo_4000x4000_seed583921/).
Os comandos de npm devem ser executados nessa pasta.

| Caminho | Responsabilidade |
| --- | --- |
| `src/main.tsx` | Monta o React, envolve o jogo com autenticação e carrega o CSS. |
| `src/auth/` | Neon Auth, recuperação de senha, confirmação de e-mail e restauração de sessão. |
| `src/GameApp.tsx` | Tela ativa do mundo, interface, estado de interação e chamadas da API. |
| `src/game/GameMap.tsx` | Renderização PixiJS, câmera, seleção de tiles, prévias e interação com cidades, estradas e residências. |
| `src/game/worldClient.ts` | Autentica o WebSocket, valida mensagens recebidas e atualiza o estado compartilhado. |
| `src/types/city.ts` | Tipos, dimensões e regras geométricas de cidades/Assembleias. |
| `src/types/road.ts` | Tipos, limites, validação, interpolação e escolha das peças de estrada. |
| `src/types/residence.ts` | Catálogo, atributos e validação compartilhada das residências. |
| `src/types/product.ts` | Catálogo estático dos produtos, unidades, peso, volume e validade padrão. |
| `src/components/ProductCatalog.tsx` | Interface pesquisável para consultar as fichas de produtos. |
| `src/components/CityZoneEditor.tsx` | Editor master das regiões urbanas e rurais de uma cidade. |
| `src/types/map.ts` | Tipos de configuração do mundo, terrenos, tiles e informações de mapa. |
| `src/utils/worldConfig.ts` | Configuração única do mapa usada pelo cliente e pelo servidor. |
| `src/utils/mapGenerator.ts`, `src/utils/perlin.ts` | Geração procedural determinística do terreno. |
| `src/utils/tileAssets.ts` | Catálogo de água/terra usado pelo gerador. |
| `server/index.ts` | API Express, autenticação de tokens, banco, Redis, relógio e WebSocket. |
| `database/schema.sql` | DDL aplicado pelo servidor durante a inicialização. |
| `public/` | Imagens servidas pelo Vite/Express por URLs públicas. |
| `README.md` | Instalação, configuração local, publicação e instruções para jogadores. |

`src/main.tsx` monta `src/GameApp.tsx`, o cliente ativo do mundo autenticado.
`src/App.tsx` é o editor procedural TileScape original, com controles de
terreno, tiles, minimapa, waypoints e exportação ZIP; ele não é montado pelo
entry point atual. Os componentes de editor e de exportação que ele usa não
devem ser confundidos com as funcionalidades ativas do jogo.

## Tecnologias e execução

- React 19 e TypeScript para interface e lógica cliente.
- PixiJS 7 para desenhar o mapa em canvas, com camadas de terreno, construções,
  prévias e rótulos.
- Vite para o desenvolvimento e o build do cliente.
- Node.js, Express e `ws` para HTTP e WebSocket.
- `jose` para verificar JWTs Neon Auth no servidor.
- `pg` para acessar PostgreSQL/Neon.
- Redis para presença, eleição do processo que avança o relógio e Pub/Sub.
- Neon Auth (Managed Better Auth) para identidade, sessão, e-mail e tokens.

### Desenvolvimento local

O `docker-compose.yml` inicia PostgreSQL e Redis locais. Neon Auth continua
configurado por meio das variáveis locais. Em desenvolvimento, `npm run dev`
inicia o servidor de API/WebSocket na porta 3001 e o Vite na porta 3000;
`vite.config.ts` encaminha `/api` e `/ws` para o servidor.

### Produção

O build do Vite gera `dist/`. `npm start` executa o servidor, que serve `dist/`
e atende às rotas HTTP e WebSocket na porta definida por `PORT` (padrão local
3001). O Render pode compilar o cliente e hospedar esse processo como Web
Service.

## Autenticação e autorização

1. `src/auth/AuthGate.tsx` restaura a sessão do Neon Auth e controla cadastro,
   login, logout, confirmação por código, pedido de redefinição e troca de
   senha.
2. `src/auth/authClient.ts` usa `@neon/auth` e obtém o JWT de acesso.
3. O cliente consulta `/api/me` para descobrir se a sessão tem acesso master.
4. O servidor obtém o token do cabeçalho `Authorization: Bearer ...`, valida
   assinatura e issuer com o JWKS do Neon Auth e usa o `sub` como ID do usuário.
5. Operações administrativas verificam também, no PostgreSQL, se o usuário
   corresponde ao e-mail configurado em `MASTER_EMAIL`.

Esconder a aba Prefeitura para não-masters é somente controle de interface. O
servidor protege as rotas administrativas com autenticação e autorização
independentes. Nunca aceite `isMaster`, IDs de usuário ou validações de
posicionamento fornecidas pelo browser como autoridade.

## Mapa e coordenadas

`WORLD_CONFIG` define os parâmetros usados para regenerar o mesmo mundo no
cliente e no servidor:

| Parâmetro | Valor atual |
| --- | --- |
| Dimensões | 4.000 × 4.000 tiles |
| Semente | `583921` |
| Escala | `0.008` |
| Nível do mar | `0.46` |
| Oitavas | `4` |
| Persistência | `0.5` |
| Lacunaridade | `2` |
| Escala de umidade | `0.006` |
| Densidade de flores | `0.5` |
| Preset | `continents` |

`createMapGenerator` combina campos de ruído determinísticos derivados da
semente para selecionar um tile de água ou terra e suas variantes de bioma.
`TileDefinition.category` é a classificação usada pelas regras de construção;
elas consultam o mesmo gerador tanto na prévia quanto no servidor. Terreno
gerado não é enviado ou salvo tile a tile.

No jogo, `GameMap` converte coordenadas de tela em tiles pela câmera e pelo
tamanho base de 24 pixels por tile. Em zoom distante, usa amostragem por blocos
e cores para reduzir custo; em zoom próximo, mostra as imagens dos tiles.
PixiJS atualiza objetos gráficos em camadas separadas para manter os rótulos
das cidades legíveis em tamanho fixo na tela.

## Cidades e Assembleias

- Uma Assembleia ocupa um footprint de 3 × 3 tiles, centralizado na coordenada
  escolhida.
- Cada cidade controla um quadrado municipal de 303 × 303 tiles, com raio
  inteiro de 151 tiles em cada eixo.
- A área precisa caber no mapa; para o mapa atual, cada coordenada central fica
  entre 151 e 3.848, inclusive.
- Áreas municipais não podem se sobrepor. A regra usa coordenadas centrais e
  não permite diferença menor que 303 tiles simultaneamente nos eixos X e Y.
- Os nove tiles do footprint precisam ser terra e não podem conter estrada ou
  outra Assembleia.
- A prévia verde/vermelha é uma indicação rápida do cliente. O servidor repete
  as validações sob lock transacional antes de inserir.
- A Prefeitura e a criação/edição de Assembleias são restritas à conta master.
- A conta master pode abrir o editor de regiões ao clicar em uma Assembleia e
  definir até 100 retângulos urbanos ou rurais por cidade, arrastando no mapa.
  Cada retângulo deve ficar dentro dos limites municipais e nenhum tile pode
  pertencer a mais de uma região. O servidor repete a validação sob o lock
  transacional antes de substituir a lista persistida.
- Áreas urbanas são mostradas em azul e rurais em verde somente durante a
  edição master ou ao selecionar uma categoria correspondente. Artesanais,
  Comerciais e Residências mapeiam à área urbana; Fazendas, Recursos e
  Indústrias mapeiam à rural. Prefeitura e Estrada de Terra não usam zonas.
  Este mapeamento é uma regra compartilhada preparada para posicionamento
  futuro para as demais categorias; duas residências estão habilitadas conforme
  as regras abaixo.
- Qualquer jogador pode consultar cidades autenticado; os dados demográficos e
  econômicos são atualmente inicializados em zero.
- Demolir uma Assembleia usa a propriedade `created_by`. Chaves estrangeiras
  removem estradas e residências municipais quando a respectiva cidade é
  apagada.

As dimensões e validações compartilhadas estão em `src/types/city.ts`; não
reimplemente as fórmulas separadamente no React e no servidor.

## Estradas de Terra

- A opção aparece no catálogo da Prefeitura e requer permissão master.
- O jogador clica e arrasta; os pontos entre eventos do mouse são interpolados
  como caminho ortogonal para que o traço não deixe buracos diagonais.
- Cada tile precisa ser terra, estar dentro de uma área municipal e não cruzar
  o footprint de uma Assembleia ou residência. O servidor revalida o trajeto
  inteiro sob lock transacional.
- O limite atual é de 600 tiles por solicitação.
- As imagens `public/buildings/roads/grass_dirt1.png` a `grass_dirt11.png`
  representam retas horizontal/vertical (1/2), curvas (3/4/5/6), cruzamento
  de quatro vias (7) e junções em T (8/9/10/11, respectivamente, sem ligação
  sul/norte/leste/oeste). `getRoadAssetIndex` seleciona a peça conforme os
  vizinhos ortogonais; a URL inclui versão de cache para carregar assets novos.
- Os tiles são persistidos individualmente em `road_tiles`; a chave primária
  garante um único tile de estrada em cada coordenada. Cada tile aponta para a
  cidade proprietária, e a remoção da cidade remove suas estradas por cascata.
- Ao construir, a interface apresenta a Assembleia ou os tiles de estrada
  imediatamente como estado otimista enquanto aguarda a API. A resposta
  autoritativa substitui essa prévia; em caso de falha, os tiles temporários
  são removidos e o erro é mostrado ao jogador.
- No modo Demolir, clicar em um tile de estrada ou arrastar sobre um trecho
  remove os tiles atravessados sem confirmação. O cliente envia o caminho em
  uma chamada; o servidor exclui somente tiles do jogador indicado em
  `created_by`, usa o lock transacional do mundo e publica o novo snapshot de
  cidades e estradas. Pré-visualiza a remoção localmente enquanto aguarda a API;
  em caso de falha, os tiles reaparecem. A demolição de Assembleias continua
  pedindo confirmação.

## Produtos

- `src/types/product.ts` define os 32 produtos atualmente habilitados, com
  unidade de medida (unidade ou litro), peso em kg, espaço em m³ e validade
  padrão em dias. Validades em anos usam 365 dias por ano; `null` representa
  validade infinita.
- A barra inferior abre o catálogo pesquisável; cada ficha mostra os atributos
  e usa o ícone correspondente em `public/products/`.
- A lista contém os produtos especificados pelo usuário. Ícones adicionais sem
  atributos não são tratados como produtos.
- Esta etapa é somente o catálogo: não há estoque persistido nem deterioração
  diária às 06h. A validade está disponível como dado de produto para essa
  implementação futura; variações de validade por método de fabricação ainda
  não são modeladas.

As regras, o caminho ortogonal e o mapeamento de imagens estão em
`src/types/road.ts`. Não altere a ordenação dos assets sem atualizar esse
mapeamento e verificar todas as curvas.

## Residências

- `src/types/residence.ts` define `house_poor1` (2 × 2 tiles, capacidade 4,
  apreço local 50, custo de 100 madeiras e 30 pedras, 18.000 Work Points) e
  `house_poor2` (3 × 3, capacidade 32, apreço local 40, custo de 300 madeiras
  e 450 pedras, 67.500 Work Points).
- `warehouse` (categoria Indústrias, `kind: 'warehouse'`, área rural, estrada
  adjacente) usa o mesmo catálogo/tabela: 4 × 4, até 100 funcionários,
  capacidade de 50 m³ para qualquer produto, 300 madeiras, 60 pedras e 20.000
  Work Points. Sprite `public/buildings/industrial/armazem.png`. As
  configurações por produto (estoque desejável, valor e tipo venda/compra)
  ficam em `warehouse_product_settings` (PK `building_id, product_id`, cascata
  na demolição). `src/types/warehouse.ts` valida os dados no cliente e no
  servidor. Rotas: `GET /api/residential-buildings/:id/warehouse` (qualquer
  usuário autenticado) e `PUT` (somente o dono, armazém concluído, um produto
  por chamada). O estoque atual ainda é fixo em 0 (não há sistema de estoque).
- `shop_rice` (categoria Comerciais, área urbana, `kind: 'shop'`) também usa o
  catálogo e a tabela `residential_buildings`: 2 × 2, até 4 funcionários,
  estoque máximo de 20 de Arroz, 100 madeiras e 20 pedras, 9.000 Work Points.
  Exige zona urbana e estrada adjacente; sem moradores nem aluguel. Sprite:
  `public/buildings/commerce/loja_arroz.png`.
- `farm_rice` (categoria Fazendas, área rural) usa o mesmo catálogo e a mesma
  tabela `residential_buildings`: 4 × 4, até 30 funcionários, estoque máximo de
  300 de Arroz, custo de 200 madeiras e 20 pedras, 12.000 Work Points. Exige
  zona rural, estrada ortogonalmente adjacente (como as casas), não recebe imigrantes e não tem aluguel
  (`PATCH .../rent` só vale para casas). Toda obra e a fazenda concluída têm
  uma área de busca de trabalhadores de 60 tiles de raio a partir do centro
  (`WORKER_SEARCH_RADIUS`, `isWithinWorkerSearchRadius`); a contratação ainda
  não existe. O CHECK de `building_type` é recriado
  de forma idempotente no schema. Sprite: `public/buildings/farms/fazenda_arroz.png`.
- O preview usa o sprite correspondente com tonalidade verde/vermelha. Toda a
  área ocupada deve ficar dentro da cidade e de uma zona urbana, em terra, sem
  sobrepor Assembleia, estrada ou residência, e deve encostar ortogonalmente
  em pelo menos uma estrada. Cliente e servidor compartilham a regra; o
  servidor revalida sob o lock transacional do mundo.
- Até existir estoque, jogadores comuns recebem `insufficient_materials`; a
  conta master pode iniciar a obra sem materiais. A obra é persistida com
  status `under_construction` e usa `public/buildings/em_construcao.png`.
- Não há progresso por Work Points nem conclusão automática. A conta master
  pode dar duplo clique na obra para concluí-la instantaneamente; a rota
  verifica a autorização e recusa uma obra já concluída.
- Estradas também consultam os footprints residenciais para impedir que um
  traçado posterior cubra uma casa. No modo Demolir, clicar em qualquer tile
  do footprint de uma residência a remove sem confirmação; o servidor só
  permite a remoção ao autor e publica o novo estado.
- Capacidade, apreço local, custos e Work Points são metadados; população,
  estoque, consumo e produção ainda não são simulados.
- A antiga barra lateral com dados do mundo foi removida. Fora dos modos de
  construção/demolição, clicar em uma residência abre `ResidencePanel`
  (`onResidenceSelect` em `GameMap`); clicar em outro tile a fecha. Concluída:
  ocupantes 0/capacidade (reais, vindos de `occupants`), técnica 10, saúde 100, felicidade 100 (fixos em
  `RESIDENCE_STATS`), empregados 0, renda média 0. Em construção: Work Points
  0/necessários, empregados 0/`maxWorkers`, salário diário (`wage`, C$ por dia
  de trabalho) e carga horária (`workHoursPerDay`, 4–14 h), editáveis só pelo
  criador (`created_by`). O criador também define o aluguel (`rent`, inteiro ≥
  C$ 1, por pessoa) em qualquer status. O
  cliente consulta `GET .../ownership` porque o dono não é publicado no
  WebSocket; o servidor revalida a autoria nos `PATCH` com `parseWorkSettings`
  e `parseRent`.
- Imigração (`src/types/immigration.ts`): a cada virada de dia do relógio do
  mundo (00:00 UTC do jogo), `runDailyImmigration` em `server/index.ts` (chamada
  pelo líder do relógio em `advanceClock`, sob o lock `583921303`) leva 40
  pessoas a cada cidade com menos de 1000 habitantes. Elas ocupam primeiro as
  residências concluídas mais baratas com vaga; empate vai para o maior apreço
  local. `world_state.last_immigration_day` evita repetir o dia (recupera até 30
  dias perdidos). A população da cidade é a soma de `occupants` das residências
  (calculada em SQL em `getCities`; `city_assemblies.population` não é mais
  usada). A cobrança diária do aluguel ainda não existe.
- Emprego (`src/types/employment.ts`): obras e construções concluídas que não
  são residências têm `desired_workers` (0 até `maxWorkers`; padrão 0), `wage` e
  `work_hours_per_day`. `runDailyEmployment` (mesmo lock `583921303`, chamada em
  `advanceClock`) às 12:00 do mundo recalcula do zero `job_assignments`
  (`workplace_id`, `residence_id`, `count`): `allocateWorkers` percorre as
  residências por id e emprega os moradores nas construções dentro do raio de
  60 tiles, da maior para a menor `getWorkBenefit = vagas · F_H² · salário / horas`
  (`F_H = 1 − 0,5·(|H−8|/6)²`), recalculando as vagas a cada preenchimento.
  À 00:00 o mesmo job debita de cada dono `salário × empregados` em
  `player_wallets` (o dinheiro some; o saldo pode ficar negativo). Controle
  de idempotência em `world_state.last_job_allocation_day` e `last_payroll_day`.
  `employed` em `ResidentialBuilding` é calculado por subquery em
  `RESIDENTIAL_COLUMNS` (empregados da construção ou moradores empregados).

## API HTTP

As rotas do mundo, exceto health check, exigem JWT válido do Neon Auth.

| Rota | Acesso | Função |
| --- | --- | --- |
| `GET /api/health` | Público | Verifica conectividade com PostgreSQL e Redis. |
| `GET /api/me` | Autenticado | Retorna se o usuário é master. |
| `GET /api/cities` | Autenticado | Retorna cidades persistidas. |
| `GET /api/wallet` | Autenticado | Cria a carteira do usuário com C$ 10.000 no primeiro acesso (idempotente) e retorna `{ balance }`. |
| `POST /api/cities` | Master | Valida e cria Assembleia/cidade. |
| `PATCH /api/cities/:id` | Master | Altera o nome de uma cidade. |
| `PUT /api/cities/:id/zones` | Master | Valida e substitui as regiões urbanas/rurais da cidade. |
| `DELETE /api/cities/:id` | Criador da cidade | Demole a Assembleia e remove as estradas da área. |
| `POST /api/roads` | Master | Valida e grava um caminho de estrada de até 600 tiles. |
| `DELETE /api/roads/:x/:y` | Criador do tile | Demole um tile de estrada sem confirmação; publica o novo estado. |
| `DELETE /api/roads` | Autenticado | Demole os tiles próprios de um caminho de até 600 tiles e publica o novo estado. |
| `POST /api/residential-buildings` | Master enquanto estoque não existe | Valida e inicia uma residência em construção. |
| `POST /api/residential-buildings/:id/complete` | Master | Conclui uma residência instantaneamente. |
| `DELETE /api/residential-buildings/:id` | Criador da residência | Demole a residência sem confirmação e publica o novo estado. |
| `GET /api/residential-buildings/:id/ownership` | Autenticado | Informa se o usuário é o criador da construção. |
| `PATCH /api/residential-buildings/:id/work-settings` | Criador; obras e construções não residenciais concluídas | Valida e grava funcionários desejados (0–máximo), salário diário e carga horária (4–14 h); reduz empregados excedentes. |
| `PATCH /api/residential-buildings/:id/rent` | Criador | Valida e grava o aluguel por pessoa (≥ C$ 1). |
| `GET /api/world` | Autenticado | Retorna relógio, dimensões/semente e jogadores online. |

Falhas de validação são respostas HTTP explícitas; indisponibilidade de banco,
autenticação ou sincronização é registrada e não deve virar uma resposta falsa
de sucesso.

## Persistência e sincronização

`server/index.ts` carrega `database/schema.sql` ao iniciar:

- `world_state` guarda o relógio persistente do mundo.
- `city_assemblies` guarda nomes, centros, métricas e autorias.
- `city_zones` guarda os retângulos municipais, com cascata ao excluir a cidade.
- `road_tiles` guarda uma linha por tile, referência à cidade e autoria.
- `player_wallets` guarda o saldo (`balance`, BIGINT, pode ficar negativo) por `user_id` (`sub`
  do Neon Auth). A carteira é criada com `STARTING_BALANCE` (`src/types/wallet.ts`)
  na primeira chamada a `GET /api/wallet`; o saldo aparece na barra superior
  como `C$ …` e é reconsultado a cada 30 s. Débitos/créditos futuros (aluguel,
  salários, custos) devem ser feitos no servidor, na mesma transação da ação.
- `residential_buildings` guarda tipo, footprint, cidade, status, autoria e
  horários de início/conclusão, `wage`, `work_hours_per_day`, `desired_workers`, `rent` e
  `occupants` (colunas
  adicionadas com `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, assim como
  `world_state.last_immigration_day`); excluir a cidade
  remove suas residências por cascata.
- A tabela `neon_auth."user"` é gerenciada pelo Neon Auth, não pelo esquema do
  jogo.

As transações que alteram geometria usam o advisory lock do mundo
(`583921303`) para serializar validações que dependem do estado atual. O lock
deve ser mantido para novas operações conflitantes no mesmo mapa. `ON DELETE
CASCADE` liga a vida das estradas à da cidade.

Redis exerce três funções:

1. Um sorted set com expiração registra conexões WebSocket e a contagem de
   jogadores online.
2. Uma chave curta com `SET NX` e expiração elege a instância que avança o
   relógio, evitando que cada processo de servidor o incremente em duplicidade.
3. Canais Pub/Sub distribuem snapshots e atualizações de cidades, estradas e
   residências entre processos; cada processo retransmite as mensagens a seus
   próprios sockets.

O WebSocket `/ws` exige JWT. Ao conectar, o servidor envia o snapshot e o
estado atual de cidades, estradas e residências. Atualizações compartilham um
envelope `{ type: "cities", cities, roads, buildings }`; snapshots contêm hora
do jogo, hora do servidor, velocidade, mapa e jogadores online.
`src/game/worldClient.ts` reconecta com atraso exponencial limitado e valida o
formato básico das mensagens antes de atualizar o React.

## Variáveis de ambiente

Configure valores localmente em `.env.local` e no painel do serviço de produção.
Não documente valores, tokens ou URLs privadas aqui.

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão do servidor com PostgreSQL/Neon. |
| `REDIS_URL` | Conexão com Redis/Render Key Value. |
| `NEON_AUTH_BASE_URL` | Configuração de autenticação e issuer esperado. |
| `NEON_AUTH_JWKS_URL` | Chaves usadas pelo servidor para validar JWTs. |
| `VITE_NEON_AUTH_URL` | URL de Auth embutida no bundle Vite; o Vite também aceita `NEON_AUTH_BASE_URL`. |
| `MASTER_EMAIL` | Identifica no servidor a conta com acesso à Prefeitura. |
| `PORT` | Porta HTTP/WebSocket fornecida pelo host; padrão local 3001. |

`neon.ts` declara Neon Auth. `.env.local` e `.env.*` são ignorados pelo Git;
preserve essa proteção.

## Verificação após mudanças

Na pasta do aplicativo:

```powershell
npm.cmd run lint
npm.cmd run build
```

`lint` executa o TypeScript do cliente e do servidor. `npm test` executa os testes focados das regras geométricas de zonas, estradas
e residências. Para operações de banco/sincronização, verifique também que a
API retorna erros apropriados e que os clientes recebem o estado persistido
atualizado.

## Limites e próximos passos já conhecidos

- Não há ainda produção de bens, comércio, evolução de população, bem-estar ou
  economia.
- As categorias Construções Artesanais, Comerciais, Fazendas, Recursos e
  Indústrias aparecem na interface, mas ainda não habilitam posicionamento ou
  catálogo de edifícios. Residências contém somente as duas opções descritas
  acima.
- Não há estoque nem sistema de Work Points; por isso, somente a conta master
  consegue iniciar residências, e toda obra iniciada permanece em construção
  até a conclusão manual instantânea da master.
- O estado de cada cidade/estrada é consultado e enviado integralmente na
  sincronização atual; crescimento grande do mundo pode exigir paginação ou
  atualizações incrementais.
- O editor de mapa procedural continua no código, mas não está ligado ao fluxo
  de entrada atual.
