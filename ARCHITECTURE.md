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
área municipal em regiões urbanas e rurais persistentes. Todos os jogadores
autenticados podem iniciar as construções do catálogo nas respectivas zonas e
ao lado de estradas; o primeiro armazém de cada jogador é gratuito e instantâneo,
e as obras regulares progridem por Work Points. A conta master pode concluí-las
instantaneamente. O jogo também possui um catálogo de produtos, estoques
persistentes e produção para as construções habilitadas; estoques perecíveis
sofrem deterioração diária conforme a validade. Armazéns e silos armazenam e
transportam produtos; construções produtoras e comerciais podem se ligar a mais
de um deles.
População e economia agregadas da cidade ainda não têm dinâmica própria; o
bem-estar individual das residências é calculado pelas necessidades supridas.
O jogo também processa rotinas diárias de imigração, emprego, consumo, produção,
vendas e aluguel. No dia 7 de cada mês, às 03:00, o servidor também
processa mudanças de moradores entre residências concluídas da mesma cidade,
persistindo cada transferência em `residence_relocation_log`.
Na alocação diária de empregos, as residências concluídas com moradores são
processadas por apreço interno decrescente; empates são resolvidos pelo ID.
O apreço é calculado com as rendas médias residenciais e a média salarial
municipal ponderada pelos moradores, incluindo todas as residências concluídas
da cidade e considerando as residências desocupadas na média regional de 10
tiles. Cada construção com trabalhadores (inclusive uma obra) persiste o nível
mínimo de técnica exigido (10–40; padrão 10). Na alocação diária, cada residência
só pode oferecer trabalhadores quando sua técnica, derivada do bem-estar, atinge
o mínimo configurado pela construção. A prévia de contratação no cliente aplica
a mesma regra compartilhada. O painel mostra a técnica média dos trabalhadores
atualmente alocados a cada construção.
O relatório contábil de produção inclui toda construção com regra de produção,
inclusive indústrias, e ordena os edifícios alfabeticamente por nome. Clique
simples em qualquer construção abre seu painel; a conta Master pode arrastar
uma construção para movê-la. O endpoint valida novamente a posição, mantém o
estado da construção e rejeita movimentos que invalidem vínculos com armazéns.
O schema aplicado na inicialização mantém a constraint
`all_buildings_building_type_check` sincronizada com todos os tipos do
catálogo, inclusive em bancos existentes; um teste de domínio verifica essa
correspondência para evitar que novas construções sejam rejeitadas pelo banco.
`all_buildings` é a tabela única de todos os tipos de construção; na inicialização,
`schema.sql` renomeia a tabela legada `residential_buildings` sem recriar seus
dados e relacionamentos, renomeia os índices de consulta e recria as constraints
de domínio com seus nomes atuais.
Ao abrir uma residência concluída, o cliente consulta
`GET /api/residential-buildings/:id/residence-benefit`. A rota calcula sob
demanda o custo mensal (`Cb`), os apreços de empregabilidade, região,
construção e interno, `benefício erro`, `benefício ideal` e o benefício
associado usando consumo dos últimos 30 dias, aluguel e renda dos moradores.
O apreço de empregabilidade é a renda média por morador dividida pela média
da cidade; o apreço da região é a média dos apreços de empregabilidade das
residências concluídas da mesma cidade num raio de 10 tiles, incluindo a
própria residência. O apreço interno é o maior entre 10 e o produto dos
apreços da construção e da região. A média diária de cada produto usa a
quantidade dividida pelo total de dias-consumidor empregados no período e o tooltip também lista a contribuição de
cada produto para o `Cb`; o cliente exibe os valores abaixo de “Salvar aluguel”.

Cada compartimento de estoque de uma construção pode ter nível 1–4, persistido
em `all_buildings.stock_levels`. O nível 1 é o padrão; cada nível multiplica a
capacidade original por esse número, e os limites são aplicados à produção,
transporte automático e transferência manual. O dono pode alterar os níveis no
painel de uma construção concluída. Upgrade para os níveis 2, 3 e 4 custa,
respectivamente, 10%, 40% e 100% do custo esperado da construção: materiais
precificados pela média das ofertas de venda ativas em armazéns/silos concluídos
mais Work Points convertidos à razão de 100 por salário médio municipal. Se não
houver preço de algum material requerido, o servidor não autoriza o upgrade.
Downgrade não custa, mas o servidor impede reduzir a capacidade abaixo do estoque
atual. A alteração e o débito da carteira são atômicos; a API valida novamente
propriedade, nível, capacidade e saldo, e publica o novo estado no mundo.

## Estrutura do repositório

O aplicativo de produção está em
[`tilescape_projeto_completo_4000x4000_seed583921/`](./tilescape_projeto_completo_4000x4000_seed583921/).
Os comandos de npm devem ser executados nessa pasta.

| Caminho | Responsabilidade |
| --- | --- |
| `src/main.tsx` | Monta o React, envolve o jogo com autenticação e carrega o CSS. |
| `src/auth/` | Neon Auth, recuperação de senha, confirmação de e-mail e restauração de sessão. |
| `src/GameApp.tsx` | Tela ativa do mundo, interface, estado de interação e chamadas da API. |
| `src/game/GameMap.tsx` | Renderização PixiJS, câmera, seleção de tiles, prévias e interação com cidades, estradas e residências. Usa camadas separadas para terreno, estradas, construções e etiquetas; construções fora do viewport não são anexadas à camada visível, sprites são reutilizados por ID e texturas são cacheadas por asset. |
| `src/game/worldClient.ts` | Autentica o WebSocket, valida mensagens recebidas e atualiza o estado compartilhado. |
| `src/components/ConstructionBar.tsx` | Barra inferior de categorias; a seleção abre o catálogo de construções no painel lateral direito. |
| `src/components/CityAssemblyModal.tsx` | Informações da cidade, inclusive salário mínimo; edição do piso restrita à conta master. |
| `src/components/WarehousePanel.tsx` | Produtos e estoque de armazéns e silos; tooltip nos ícones mostra peso e volume unitários e totais. |
| `src/types/city.ts` | Tipos, dimensões e regras geométricas de cidades/Assembleias. |
| `src/types/road.ts` | Tipos, limites, validação, interpolação e escolha das peças de estrada. |
| `src/types/residence.ts` | Tipos, validação compartilhada e regras geométricas das construções. |
| `src/types/commerceDemand.ts` | Parsing e validação dos multiplicadores de demanda básica configurados no servidor. |
| `src/types/wellbeing.ts` | Pontuação residencial de bem-estar e conversão para técnica média dos trabalhadores. |
| `src/types/dairy.ts` | Eficiência mensal da produção leiteira. |
| `src/types/product.ts` | Catálogo estático dos produtos, unidades, peso, volume e validade padrão. |
| `src/components/ProductCatalog.tsx` | Interface pesquisável para consultar as fichas de produtos. |
| `src/components/CommerceHistoryPanel.tsx` | Histórico diário de despesas, vendas e resultado dos comércios. |
| `src/components/AccountingPanel.tsx` | Relatórios agregados de lojas comerciais, armazéns, residências e produção do jogador autenticado. |
| `src/types/accounting.ts` | Tipos da resposta da API contábil. |
| `src/components/PerformanceLogPanel.tsx` | Exibição das medições recentes das etapas do processamento diário. |
| `src/types/performanceLog.ts` | Tipos dos registros de desempenho retornados pela API. |
| `src/components/CityZoneEditor.tsx` | Editor master das regiões urbanas e rurais de uma cidade. |
| `src/types/map.ts` | Tipos de configuração do mundo, terrenos, tiles e informações de mapa. |
| `src/utils/worldConfig.ts` | Configuração única do mapa usada pelo cliente e pelo servidor. |
| `src/utils/mapGenerator.ts`, `src/utils/perlin.ts` | Geração procedural determinística do terreno. |
| `src/utils/tileAssets.ts` | Catálogo de água/terra usado pelo gerador. |
| `server/index.ts` | API Express, autenticação de tokens, banco, Redis, relógio e WebSocket. |
| `database/schema.sql` | DDL aplicado pelo servidor durante a inicialização. |
| `config/demanda_basica.txt` | Multiplicadores de demanda residencial por produto, carregados na inicialização do servidor. |
| `config/construcoes/*.txt` | Dados editáveis das 58 construções, um JSON por arquivo. |
| `config/formulas/*.txt` | Parâmetros editáveis de consumo, trabalho e transporte. |
| `server/generate-game-config.ts` | Valida os TXT e gera o módulo de configuração compartilhado. |
| `src/generated/gameConfig.ts` | Saída ignorada pelo Git, regenerada pelos comandos npm antes de uso. |
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
3001). O HTML usa `Cache-Control: no-cache` para revalidar a versão publicada;
arquivos estáticos públicos usam cache de um dia, e bundles JS/CSS com hash de
conteúdo do Vite usam cache imutável de um ano. O Render pode compilar o cliente
e hospedar esse processo como Web Service.

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
  Cada retângulo deve ficar dentro dos limites municipais. Regiões do mesmo
  tipo podem se sobrepor; regiões urbanas e rurais não podem compartilhar
  tiles. O servidor repete a validação sob o lock transacional antes de
  substituir a lista persistida.
- Áreas urbanas são mostradas em azul e rurais em verde somente durante a
  edição master ou ao selecionar uma categoria correspondente. Artesanais,
  Comerciais e Residências mapeiam à área urbana; Fazendas, Recursos e
  Indústrias mapeiam à rural. Prefeitura e Estrada de Terra não usam zonas.
  Cada tile do footprint deve estar coberto por pelo menos uma região do tipo
  exigido; a união de várias regiões do mesmo tipo pode cobrir a construção
  inteira, inclusive quando ela atravessa a interseção delas.
  Todas as seis categorias de construções são exibidas para jogadores
  autenticados; a Prefeitura permanece restrita à conta master. O servidor
  aplica o mapeamento de zonas ao posicionar qualquer construção do catálogo.
- Qualquer jogador autenticado pode consultar cidades. `getCities` calcula a
  população, empregados nos estabelecimentos da cidade, vagas ainda abertas e
  salário diário médio ponderado por empregados; bem-estar e economia são
  inicializados em zero. As cidades são republicadas após mudanças diárias de
  emprego/população.
- O botão **Consumo** da Assembleia abre `GET /api/cities/:id/consumption`.
  A rota agrega as compras das residências da cidade, divide as quantidades pela
  população total para obter consumo por cidadão e calcula preço médio
  ponderado por unidades compradas, no último dia e nos últimos 30 dias. O
  painel reaproveita `ConsumptionPanel`.
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

- `src/types/product.ts` define os 35 produtos atualmente habilitados, com
  unidade de medida (unidade ou litro), peso em kg, espaço em m³ e validade
  padrão em dias. Validades em anos usam 365 dias por ano; `null` representa
  validade infinita.
- A barra inferior abre o catálogo pesquisável; cada ficha mostra os atributos
  e usa o ícone correspondente em `public/products/`.
- A lista contém os produtos especificados pelo usuário. Ícones adicionais sem
  atributos não são tratados como produtos.
- O catálogo também fornece os parâmetros usados pela deterioração diária dos
  estoques persistidos; variações de validade por método de fabricação ainda
  não são modeladas.

As regras, o caminho ortogonal e o mapeamento de imagens estão em
`src/types/road.ts`. Não altere a ordenação dos assets sem atualizar esse
mapeamento e verificar todas as curvas.

## Residências

- A ordem de construção é explícita em `getConstructionMenuDefinitions`:
  Comerciais (lojas de arroz, trigo, cevada, batata e milho; Peixaria, Leitaria,
  Açougue; lojas de açúcar, especiarias, vegetais e sal; Padaria, Queijaria,
  Frutaria, Chocolateria), Fazendas (arroz, trigo, cevada, batata, milho,
  leiteira, bovina, cana, vegetais, especiarias, cacau, frutas), Artesanais
  (Pesqueiro, Ferramentaria, Carvoaria, Casa de Engenho) e Indústrias (Armazém,
  Moinho, Fábrica de Pães, Fábrica de Queijo, Fábrica de Chocolate). O painel
  exibe custos em madeira, pedra e ferro quando definidos.
- O catálogo gerado em `src/generated/gameConfig.ts` define `house_poor1`
  (2 × 2 tiles, capacidade 4, apreço local 50, custo de 100 madeiras e 30
  pedras, 18.000 Work Points), `house_poor2` (3 × 3, capacidade 32, apreço
  local 40, custo de 300 madeiras e 450 pedras, 67.500 Work Points) e
  `house_poor3` (4 × 4, capacidade 128, apreço local 30, custo de 1.200
  madeiras e 2.000 pedras, 300.000 Work Points). As três são residências urbanas
  com estrada adjacente, imigração e aluguel.
- `warehouse` (categoria Indústrias, `kind: 'warehouse'`, área rural, estrada
  adjacente) usa o mesmo catálogo/tabela: 4 × 4, até 100 funcionários,
  capacidade de 50 m³ para qualquer produto, 300 madeiras, 60 pedras e 20.000
  Work Points. Sprite `public/buildings/industrial/armazem.png`. As
  configurações por produto (estoque mínimo, estoque máximo numérico ou `MAX`,
  valor e tipo venda/compra) ficam em `warehouse_product_settings` (PK
  `building_id, product_id`, cascata na demolição). `MAX` é armazenado como
  `maximum_stock = NULL` e deixa a capacidade natural em m³ como limite. O
  schema migra configurações antigas: `desired_stock` positivo vira mínimo e
  máximo; zero vira mínimo 0 e máximo `MAX`. `src/types/warehouse.ts` valida os dados no cliente e no
  servidor. O preço médio local soma apenas o estoque ofertável acima do mínimo
  dos armazéns concluídos em até 60 tiles, ponderando pelo volume ofertável. O
  painel filtra produtos e permite uma tentativa imediata de compra pelo mesmo
  planejador de trocas (sem aguardar a rodada automática), sob o lock transacional
  do mundo. Rotas: `GET /api/residential-buildings/:id/warehouse` (qualquer
  usuário autenticado), `PUT` (somente o dono, armazém concluído, um produto por
  chamada) e `POST /api/residential-buildings/:id/warehouse/suppliers` (somente
  o dono, compra imediata respeitando ordem, preço, distância, espaço e Work
  Points).
- `silo` (categoria Indústrias, `kind: 'warehouse'`, área rural, estrada
  adjacente) ocupa 4 × 4, emprega até 100 pessoas e tem 400 m³ de capacidade.
  Custa 300 madeiras, 60 pedras e 20.000 Work Points. Só armazena Trigo,
  Cevada, Batata, Milho, Arroz, Especiarias, Cacau, Cana, Azeitona, Uva e Fumo;
  a restrição também é aplicada a transferências locais/manuais, compras e
  vendas. Sprite `public/buildings/industrial/silo.png`.
- `shop_rice` (categoria Comerciais, área urbana, `kind: 'shop'`) também usa o
  catálogo e a tabela `all_buildings`: 2 × 2, até 1 funcionário,
  estoque máximo de 5 de Arroz, 10 madeiras e 5 pedras, 5.000 Work Points.
  Exige zona urbana e estrada adjacente; sem moradores nem aluguel. Sprite:
  `public/buildings/commerce/loja_arroz.png`.
- `shop_potato`, `shop_corn`, `shop_barley` e `shop_wheat` (Lojas de Batata,
  Milho, Cevada e Trigo) são lojas urbanas 2 × 2, com até 1 funcionário,
  estoque máximo de 5 unidades e custo de 10 madeiras, 5 pedras e 5.000 Work
  Points. `shop_butcher` (Açougue) tem 1 funcionário, estoque máximo de 5,
  custo de 15 madeiras, 10 pedras e 5.000 Work Points. Vendem,
  respectivamente, `potato`, `corn`, `barley`, `wheat` e `red_meat`, recebem
  estoque do armazém ligado e têm preço editável pelo dono. Os sprites ficam em
  `public/buildings/commerce/loja_batata.png`, `loja_milho.png`,
  `loja_cevada.png`, `loja_trigo.png` e `loja_acougue.png`.
- `farm_rice` (categoria Fazendas, área rural) usa o mesmo catálogo e a mesma
  tabela `all_buildings`: 4 × 4, até 30 funcionários, estoque máximo de
  300 de Arroz, custo de 100 madeiras e 40 pedras, 30.000 Work Points. As
  fazendas de trigo, cevada, batata e milho compartilham dimensão, limite de
  funcionários e custos. A Fazenda Bovina custa 250 madeiras/75 pedras e exige
  125.000 Work Points. Exige
  zona rural, estrada ortogonalmente adjacente (como as casas), não recebe imigrantes e não tem aluguel
  (`PATCH .../rent` só vale para casas). Toda obra e a fazenda concluída têm
  uma área de busca de trabalhadores de 60 tiles de raio a partir do centro
  (`WORKER_SEARCH_RADIUS`, `isWithinWorkerSearchRadius`); a contratação ainda
  não existe. O CHECK de `building_type` é recriado
  de forma idempotente no schema. Sprite: `public/buildings/farms/fazenda_arroz.png`.
- `farm_dairy` (categoria Fazendas, área rural) ocupa 3 × 3 tiles, emprega até
  10 funcionários, guarda até 400 litros de leite, custa 50 madeiras/15 pedras
  e exige 25.000 Work Points. A regra `accumulate` produz 1 litro a
  cada 5 Work Points efetivos, com eficiência mensal de 40%, 100%, 80% e 60%
  nos respectivos trimestres. Seu leite é transferido ao armazém ligado.
  Sprite: `public/buildings/farms/fazenda_leiteira.png`.
- `farm_cane`, `farm_spices` e `farm_vegetables` (categoria Fazendas) usam o ciclo agrícola comum
  em áreas rurais: 3 × 3. Cana custa 100 madeiras/40 pedras/40 ferros e exige
  10.000 Work Points; especiarias custa 200/80/80 e exige 320.000 WP; vegetais
  custa 100/40/40 e exige 110.000 WP.
  Cana e especiarias empregam até 10/50 pessoas, armazenam 2.000 canas/400
  especiarias e têm requisitos diários de 100/5.000 WP, crescimento de seis
  meses, colheita de 25/10 WP por unidade, rendimento de 2.000/600 e eficiências
  sazonais 90/80/100/90% e 100/60/60/60%. Vegetais emprega até 50 pessoas,
  armazena 100 unidades, requer 5.000 WP/dia, cresce por dois meses, colhe a 10 WP
  por unidade, rende até 1.000 e tem eficiências sazonais 20/40/100/80%. O
  excedente da colheita permanece pendente até haver espaço no estoque.
  Sprites: `public/buildings/farms/fazenda_cana.png`,
  `public/buildings/farms/fazenda_especiarias.png` e
  `public/buildings/farms/fazenda_vegetais.png`.
- `farm_fruit` e `farm_cocoa` usam o ciclo agrícola comum em áreas rurais. Ambas
  ocupam 4 × 4 e empregam até 50. Frutas custa 360 madeiras/240 pedras/120 ferros
  e exige 960.000 WP; cacau custa 180/120/60 e exige 480.000 WP. A Fazenda de
  Frutas armazena 1.000 unidades, exige 5.000 WP/dia,
  cresce por 12 meses, colhe a 20 WP/unidade, rende até 1.000 e tem eficiências
  sazonais 100/80/60/40%. A Fazenda de Cacau armazena 400, exige 2.000 WP/dia,
  cresce por 12 meses, colhe a 62 WP/unidade, rende até 400 e tem eficiências
  100/90/70/50%. Sprites em `public/buildings/farms/`.
- As fazendas agrícolas com plantio (exceto criação bovina) podem salvar automação em
  `PUT /api/residential-buildings/:id/farm-automation`. O servidor valida dono,
  fase da construção, meses (1–12) e limites de funcionários do tipo antes de
  gravar meses de replantio e equipes separadas de crescimento e colheita.
  Durante a alocação diária, uma fazenda automatizada sem ciclo inicia outro
  somente se o mês atual estiver selecionado; ciclos ativos não são interrompidos.
  A equipe desejada muda conforme a fase e as configurações são propagadas pelo
  mesmo snapshot de construções. Desativá-la não cancela um ciclo em andamento.
- `shop_fish` (Peixaria) usa 2 × 2 tiles, 2 funcionários, estoque máximo de
  5 peixes, custo de 15 madeiras/10 pedras e 5.000 Work Points; vende 1 unidade
  por 50 WP. `shop_milk` (Leitaria) tem 1 funcionário, 120 litros, custo de 10
  madeiras/5 pedras e 5.000 WP; vende 1 litro por WP. Sprite da Leitaria:
  `public/buildings/commerce/loja_leite.png`.
- `shop_sugar`, `shop_vegetables`, `shop_salt` e `shop_spices` ocupam 2 × 2 e
  empregam até 4 pessoas, com 60 madeiras/40 pedras e 70.000 Work Points.
  Açúcar/especiarias guardam 5 unidades e usam 125 WP/unidade; vegetais/sal
  guardam 25 e usam 20 WP/unidade. Vendem,
  respectivamente, `sugar`, `vegetables`, `salt` e `spices`, abastecidas pelo
  armazém ligado. Seus sprites ficam em `public/buildings/commerce/`.
- `shop_bread` (Padaria), `shop_cheese` (Queijaria), `shop_chocolate`
  (Chocolateria) e `shop_fruit` (Frutaria) são comércios urbanos 2 × 2, com
  até 8 funcionários cada. Custam 180 madeiras, 120 pedras, 60 ferros e
  480.000 WP. Estoques máximos: 350 pães, 35 queijos, 20 chocolates e 6 frutas;
  limites de venda: 3, 26, 54 e 160 WP/unidade, respectivamente.
  Seus produtos participam da cesta avançada e recebem estoque do armazém ligado.
  Sprites em `public/buildings/commerce/`.
- `shop_clothing`, `shop_furniture`, `shop_utilities` e `shop_glass` são lojas
  urbanas 2 × 2, com 12 funcionários, estoque de 5 e venda a cada 300 WP. Os
  produtos recebem estoque do armazém ligado e participam da cesta de bens.
- `farm_sheep` e `farm_cotton` usam a mesma automação e ciclo genérico das
  demais fazendas. Cada regra de colheita está no catálogo gerado; algodão e lã
  também são aceitos pelo Silo.
- `sand_pit`, `steelworks`, `thread_factory`, `textile_factory`,
  `furniture_factory`, `utilities_factory` e `glass_factory` usam as regras de
  produção genéricas (`accumulate`/`batch`) e insumos em
  `building_input_stock`. Os custos de construção aceitam também aço e são
  debitados atomicamente dos armazéns concluídos próximos. As fábricas de
  fiação, têxtil, móveis, utilitários e vidro recebem Ferramentas e compartilham
  a penalidade diária configurada por falta.
- O preview usa o sprite correspondente com tonalidade verde/vermelha. Toda a
  área ocupada deve ficar dentro da cidade e da zona exigida pela construção
  (urbana ou rural), em terra, sem
  sobrepor Assembleia, estrada ou residência, e deve encostar ortogonalmente
  em pelo menos uma estrada. Cliente e servidor compartilham a regra; o
  servidor revalida sob o lock transacional do mundo.
- O primeiro armazém de cada jogador é gratuito e criado diretamente como
  concluído, sem aguardar Work Points. `player_warehouse_claims` persiste esse
  direito mesmo após demolição e é inicializada para jogadores com armazéns
  existentes. O servidor aplica essa regra dentro do lock transacional. Todos
  os jogadores autenticados podem iniciar qualquer construção do catálogo; a
  conta master mantém a permissão de iniciar sem materiais.
  Exceto o primeiro armazém, a construção exige os materiais definidos
  em `ResidenceDefinition.cost` (Madeira, Pedra, Ferro e, quando aplicável, Aço),
  debitados atomicamente dos armazéns concluídos
  do jogador a até 60 tiles do centro do local escolhido; estoques de vários
  armazéns próximos podem ser combinados. Para jogadores comuns, estoque
  insuficiente rejeita a obra sem débito parcial. Obras regulares são
  persistidas com status `under_construction` e usam
  `public/buildings/em_construcao.png`.
- Os funcionários atribuídos a uma obra geram Work Points diários e a conclusão
  ocorre automaticamente ao atingir o requisito. A conta master também pode
  dar duplo clique na obra para concluí-la instantaneamente; a rota protege essa
  operação e recusa uma obra já concluída. Durante a obra, o limite de vagas é
  100; na conclusão, o servidor reduz atomicamente `desired_workers` e as
  atribuições existentes ao máximo definitivo do tipo de construção.
- Estradas também consultam os footprints residenciais para impedir que um
  traçado posterior cubra uma casa. No modo Demolir, clicar em qualquer tile
  do footprint de uma residência a remove sem confirmação; o servidor só
  permite a remoção ao autor e publica o novo estado.
- Capacidade limita os moradores e apreço da construção desempata a ordem de ocupação
  quando os aluguéis são iguais; Work Points avançam obras e custos debitam
  materiais. A população é atualizada pela imigração; o consumo das cestas
  básica, intermediária, avançada e de bens é simulado nas lojas e considera
  somente moradores empregados.
- `GET /api/player/resources?x=&y=` agrega Madeira, Pedra, Ferro e Aço dos
  armazéns concluídos do próprio usuário em até 60 tiles do centro da câmera. A
  barra superior atualiza esses totais quando a área muda e em intervalo regular.
- A antiga barra lateral com dados do mundo foi removida. Fora dos modos de
  construção/demolição, clicar em uma residência abre `ResidencePanel`
  (`onResidenceSelect` em `GameMap`); clicar em outro tile a fecha. Concluída:
  ocupantes 0/capacidade (reais, vindos de `occupants`), bem-estar persistido em
  `all_buildings.wellbeing`, técnica calculada por `getWorkerTechnique`, saúde 100
  e felicidade 100 (fixas em `RESIDENCE_STATS`), empregados reais e renda média
  (`averageIncome`: subquery em `ALL_BUILDING_COLUMNS` somando
  `job_assignments.count × wage` ÷ ocupantes). O planejador de vendas usa os
  moradores empregados como consumidores e calcula a renda média por trabalhador
  para a demanda. Em construção: Work Points
  0/necessários, empregados 0/até 100, salário diário (`wage`, C$ por dia
  de trabalho) e carga horária (`workHoursPerDay`, 4–14 h), editáveis só pelo
  criador (`created_by`). O criador também define o aluguel (`rent`, ≥ C$ 0,01,
  com até duas casas decimais, por pessoa) em qualquer status. O
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
  usada). A cobrança diária do aluguel é processada pelo job das 00:00.
- Emprego (`src/types/employment.ts`): obras e construções concluídas que não
  são residências têm `desired_workers` (0 até 100 durante a obra e 0 até
  `maxWorkers` após a conclusão; padrão 0), `wage` e `work_hours_per_day`.
  Cada cidade guarda `minimum_wage` (padrão C$ 1/dia), visível a todos e
  editável apenas pela conta master. O servidor rejeita ofertas abaixo do piso;
  aumentá-lo reajusta na mesma transação os salários menores nas construções
  daquela cidade. Novas construções começam com salário de pelo menos C$ 10 ou
  o piso vigente, o que for maior. A inicialização do esquema também eleva
  salários antigos que estejam abaixo do piso.
  `runDailyEmployment` (mesmo lock `583921303`, chamada em
  `advanceClock`) às 12:00 do mundo recalcula do zero `job_assignments`
  (`workplace_id`, `residence_id`, `count`): `allocateWorkers` percorre as
  residências por id e considera todas as ofertas com vagas no raio de 60 tiles.
  Para cada residência, cada oferta recebe `benefícioᵢ = vagas · bônus · F_H² · salário /
  horas · √(60 / (60 + dᵢ))`, onde o bônus é ×5 para 1–4 vagas, ×3 para 5–10,
  ×2 para 11–20, ×1 para 21–40, ×0,9 para 41–100, ×0,8 para 101–300 e ×0,7
  acima de 300; `F_H = 1 − 0,5·(|H−8|/6)²` e `dᵢ` é a
  distância entre os centros da casa e do trabalho. Os moradores são repartidos
  proporcionalmente aos benefícios; o método dos maiores restos garante
  alocações inteiras cuja soma é a população empregável da casa, limitada pelas
  vagas elegíveis. Se uma oferta atingir seu limite, o excedente é redistribuído
  entre as demais; as vagas restantes e os benefícios são recalculados para a
  residência seguinte.
  À 00:00 o mesmo job debita de cada dono `salário × empregados` em
  `player_wallets` (o dinheiro some; o saldo pode ficar negativo). Para cada
  residência concluída, calcula `occupants × rent`, credita o total ao dono e
  grava moradores, aluguel por pessoa e receita em `residence_rent_history`.
  Como moradores são NPCs sem carteira individual, não há débito pessoal. O
  crédito, o histórico e a folha são transacionais e idempotentes, protegidos
  pelo lock `583921303` e `world_state.last_payroll_day`.
  No mesmo job das 00:00, cada obra soma `work_points_done += empregados ×
  getDailyWorkPoints` (`12,5 · H · saúde/100 · felicidade/100 · fator_descanso`;
  fator 1,2 em 4 h, 1 em 8 h, 0,8 em 14 h, linear entre eles; saúde e felicidade
  fixas em 100 por enquanto) e é concluída automaticamente ao atingir os Work
  Points necessários.
- Vendas das cestas básica, intermediária, avançada e básica de bens (`src/types/commerce.ts`): lojas cujo catálogo tem
  `kind: 'shop'` e `stockProductId` participam das vendas; incluem arroz,
  batata, milho, cevada, trigo, peixe, carne vermelha, leite, açúcar, vegetais,
  sal, especiarias, pão, queijo, frutas, chocolate, roupas, móveis, utilitários
  e vidros. Todas têm `price` (padrão
  C$ 10, editável pelo dono em centavos via
  `PATCH /api/residential-buildings/:id/price`) e estoque abastecido pelo
  armazém ligado do mesmo dono. No job das 00:00, lojas de produtos por unidade
  têm capacidade definida pelo `salesWorkPointsPerUnit` do tipo de construção
  (WP = empregados × `getDailyWorkPoints`).
  `config/demanda_basica.txt` define as necessidades diárias por trabalhador
  empregado: na
  cesta básica, arroz, trigo, cevada, milho, batata, peixe e carne vermelha
  começam em `0.03`, leite em `1`; na cesta intermediária, açúcar `0.01`,
  vegetais `0.05`, sal `0.04` e especiarias `0.01`; na cesta avançada, pão
  `1`, queijo `0.1`, frutas `0.02` e chocolate `0.025`; roupas, móveis,
  utilitários e vidros começam em `0.01` cada na cesta de bens.
  `commerce_history` fornece os preços e unidades vendidas nos últimos 30 dias.
  `getCityProductAveragePrices` calcula a média ponderada por unidades vendidas,
  por produto e cidade; se ainda não houve venda do produto, usa a média dos
  preços atuais anunciados na cidade. Produtos básicos sem preço disponível não
  contribuem em `RR`; os intermediários sem preço não contribuem em `RR2`;
  produtos avançados sem preço não contribuem em `RR3`. `RR` é o custo diário
  por pessoa da cesta básica, `RR2` o da cesta intermediária e `RR3` o da cesta
  avançada. Para todos os produtos, `Pf = preço local × necessidade
  diária por pessoa`, `Dᵢ = √(60 / (60 + dᵢ))`, onde `dᵢ` é a distância entre
  residência e loja. Na cesta básica, com `Rf` como renda média por trabalhador
  empregado:
  `w = (1 − Pf / RR)^4`, `q = (0,8^w − 1) × Rf`,
  `benefício_erro = 0` se `Rf < Pf`, senão
  `Dᵢ × ((Rf − Pf − q) / RR)^4`, e
  `benefício_ideal = (Rf / RR − 0,125 / RR)^4`.
  Na cesta intermediária, `w = (1 − Pf / (RR + RR2))^3`,
  `q = (0,8^w − 1) × Rf`; o benefício de erro é
  `Dᵢ × ((Rf − Pf − q) / (RR + RR2))^3` somente se
  `Rf > Pf + 1` e `Rf > RR/6 + RR2/3`, e zero caso contrário. Seu benefício
  ideal é `((Rf − 1/6) / (RR + RR2) − 1/110)^3`. Na cesta avançada,
  `w = (1 − Pf / (RR + RR2 + RR3))^2`; `q` mantém a mesma fórmula. O benefício
  de erro é `Dᵢ × ((Rf − Pf − q) / (RR + RR2 + RR3))^2` se
  `Rf > Pf + 4` e `Rf > RR/6 + RR2/3 + RR3/4`, caso contrário zero; o ideal é
  `((Rf − 1/6) / (RR + RR2 + RR3) − 1/180)^2`. Nas cestas básica,
  intermediária e avançada, `benefício_associado = (benefício_erro /
  benefício_ideal)^4`; se o ideal for zero, o associado também é zero. Na cesta
  de bens, `RR_total = RR + RR2 + RR3`, `w = (1 − Pf/RR_total)^3` e
  `q = (0,8^w − 1) × Rf`. O benefício de erro é zero se
  `Rf ≤ RR_total/2`; caso contrário, é
  `Dᵢ × ((Rf − Pf − q)/RR_total)^3`. O ideal é
  `(Rf/RR_total − 1/(6 × RR_total) + 1/16)^3` e o associado é
  `(benefício_erro / benefício_ideal)^6`.
  Os moradores empregados são repartidos entre as lojas do produto em 60 tiles
  na proporção do benefício associado. O método dos maiores restos garante
  alocações inteiras cuja soma é a população empregada da residência quando há
  benefício positivo; se o custo da cesta aplicável (`RR` para produtos básicos,
  `RR + RR2` para intermediários, `RR + RR2 + RR3` para avançados) ou todos os benefícios forem zero, não há
  compra. A distância define a elegibilidade no raio de 60 tiles e também
  reduz o benefício por `Dᵢ`.   A quantidade desejada por loja é `trabalhadores
  alocados × necessidade diária por pessoa × benefício associado`, com
  arredondamento aleatório das frações, e pode exceder a necessidade diária.
  Não há redistribuição de moradores quando
  estoque ou capacidade da loja é insuficiente. Vendas são limitadas pelo
  estoque e capacidade diários; o dono recebe `quantidade × preço`.
  `employed` em `ResidentialBuilding` é calculado por subquery em
  `ALL_BUILDING_COLUMNS` (empregados da construção ou moradores empregados).
  `residence_consumption` registra quantidade, gasto, ocupantes e consumidores
  empregados por residência/produto/dia. Linhas diárias inclusive sem compras
  guardam os dias-consumidor usados na média móvel de bem-estar dos últimos 30
  dias. As APIs usam consumidores para normalizar consumo por pessoa e para o
  custo residencial (`Cb`). Registros históricos sem a contagem de empregados
  permanecem com `consumers` nulo e são excluídos dessas médias por trabalhador.
  A capacidade de venda converte Work Points diários pelos limites
  `salesWorkPointsPerUnit` definidos por construção; `bread`, `cheese`, `fruit`
  e `chocolate` participam da cesta avançada; `clothing`, `furniture`,
  `utilities` e `glass` participam da cesta de bens.
  O bem-estar residencial (`src/types/wellbeing.ts`) soma a satisfação por
  produto nos últimos 30 dias, limitada a 100% da necessidade: cada produto
  básico vale até 12,5 pontos, intermediário e bem valem 6,25, e avançado vale
  3 (máximo 162). O valor é persistido em `all_buildings.wellbeing`; a técnica
  média exibida no painel segue a fórmula por faixas de Bn definida pelo domínio.
  Para cada loja concluída, o job registra em `commerce_history` o salário dos
  funcionários, gastos efetivamente pagos com produtos, unidades vendidas e
  preço unitário de venda. Os detalhes do diagnóstico (renda, moradores,
  produto, `RR`, `Pf`, `w`, `q`, benefícios de erro/ideal/associado,
  participação e moradores alocados, quantidade, estoque/capacidade, resultado
  e decomposição de `RR`, `RR2` e `RR3` por produto (cesta, necessidade diária, preço
  médio, origem do preço, vendas/receita do período e contribuição) são
  encaminhados via Redis apenas aos WebSockets autenticados do
  proprietário e ficam somente no `localStorage` do navegador. O navegador
  precisa estar conectado durante o processamento das vendas para capturar
  esse diagnóstico; clientes offline não o recebem. A API do histórico retorna
  somente os dados financeiros, e os diagnósticos locais são combinados no
  cliente.

  ## Configuração editável das regras

  Os 58 arquivos `config/construcoes/<tipo>.txt` são a fonte dos dados do catálogo:
  nome, imagem pública, categoria funcional, zona e requisitos de posicionamento,
  dimensões, custos, Work Points de obra, capacidade de trabalhadores, estoques
  de produtos/insumos, receitas, regras de produção e safras sazonais. Os arquivos
  `config/formulas/consumo.txt`, `trabalho.txt` e `transporte.txt` guardam as
  necessidades e os coeficientes/limites usados pelas fórmulas de cesta, busca e
  alocação de empregos, Work Points e transporte. `config/demanda_basica.txt`
  continua definindo as quantidades diárias desejadas de cada produto.

  Os TXT de construções e fórmulas usam sintaxe JSON, apesar da extensão `.txt`.
  `server/generate-game-config.ts` valida conteúdo, tipos, limites e catálogo e
  gera `src/generated/gameConfig.ts`, ignorado pelo Git. Vite e Node importam o
  mesmo módulo gerado para manter cliente e servidor consistentes. `predev`,
  `prebuild`, `prelint` e `pretest` executam a validação e geração; configuração
  inválida interrompe o comando sem aplicar valores padrão silenciosos. As regras
  matemáticas e o comportamento específico de cada tipo continuam implementados
  em código; apenas dados e parâmetros expostos nos arquivos são editáveis. Novos
  tipos ou comportamentos exigem alteração do código e do validador.

  Não há recarga a quente. Reinicie o processo de desenvolvimento com `npm run
  dev` ou gere um novo build/redeploy de produção para aplicar as alterações.
  `employed` em `ResidentialBuilding` é calculado por subquery em
  `ALL_BUILDING_COLUMNS` (empregados da construção ou moradores empregados).
  Para cada loja concluída, o job registra em `commerce_history` o salário dos
  funcionários, gastos efetivamente pagos com produtos, unidades vendidas e
  preço unitário de venda. Os detalhes do cálculo da demanda (renda, moradores,
  média efetiva da área, demanda esperada e arredondada; preço, distância,
  benefício, posição no ranking, estoque/capacidade disponíveis, demanda
  antes/depois, quantidade comprada e resultado da tentativa por loja candidata)
  são encaminhados via Redis apenas aos WebSockets autenticados do proprietário
  e ficam somente no `localStorage` do navegador. O navegador precisa estar conectado
  durante o processamento das vendas para capturar esse diagnóstico; clientes
  offline não o recebem. A API do histórico retorna somente os dados financeiros,
  e os diagnósticos locais são combinados no cliente.
  Receita e lucro/prejuízo são calculados dos dados financeiros.
  Como o abastecimento pelo armazém do mesmo dono é uma transferência interna
  sem cobrança, esse movimento registra C$ 0 de gasto com produto. O histórico
  financeiro conserva no mínimo 35 dias para os cinco períodos semanais e só o dono consulta pela rota de histórico do
  comércio. Os diagnósticos locais conservam até 30 dias e alimentam a simulação
  de venda no navegador; a simulação de contratação também usa o snapshot local,
  sem novas consultas ao servidor. A coluna
  `transaction_details` de instalações anteriores não é mais lida ou atualizada;
  os registros existentes expiram junto com o histórico financeiro.
- Produção das fazendas agrícolas (`src/types/farming.ts`): `POST
  /api/residential-buildings/:id/plant` (só dono, fazenda concluída; iniciar ou
  replantar durante o crescimento zera o contador; bloqueado na colheita)
  grava `crop_phase`, `crop_planted_day` (dia do relógio do mundo),
  `crop_ratio_sum`, `crop_days`, `crop_yield`, `crop_harvested`. O job das
  00:00 (antes do transporte) usa as regras específicas da fazenda: arroz,
  batata, trigo, cevada, milho, cana e especiarias crescem por 6 meses;
  vegetais por 2 meses; a fazenda bovina por 24.
  Durante `growing`, soma `min(1, WP do dia / requisito diário)`; no dia de
  colheita/corte a produção é `floor(rendimento máximo · fator do mês do plantio
  · média diária)`. Os requisitos diários, rendimentos, eficiência sazonal e
  Work Points por unidade colhida/cortada estão em `FARM_CROP_RULES`. A fase
  passa a `harvesting`; a produção é limitada ao espaço livre do estoque; ao
  terminar, o plantio é limpo e um novo pode ser feito. `ResidentialBuilding.crop`
  expõe o estado ao cliente.
- `red_meat` tem validade padrão de 30 dias em `src/types/product.ts`.
- Consumo das residências: as compras de todos os produtos disponíveis da
  cesta básica (arroz, trigo, cevada, milho, batata, peixe, carne vermelha e
  leite) e da cesta intermediária (açúcar, vegetais, sal e especiarias) das
  00:00 são gravadas em
  `residence_consumption (building_id, product_id, day, quantity, spent,
  occupants)` (cascata). `GET /api/residential-buildings/:id/consumption`
  devolve por produto o consumo por pessoa no último dia e a média diária por
  pessoa nos últimos 30 dias, além do preço médio pago (dia e mês). O painel
  `ConsumptionPanel` abre pelo botão "Ver consumo da casa" (residências concluídas).
  A rota da cidade agrega os mesmos registros para todas as casas municipais,
  divide pelo total atual de moradores para obter a média diária por cidadão e
  pondera os preços pelas unidades compradas.
- Pesqueiro e lojas de peixes/leite/açúcar/vegetais/sal/especiarias (`fishery`,
  `shop_fish`, `shop_milk`, `shop_sugar`, `shop_vegetables`, `shop_salt`,
  `shop_spices`):
  `src/types/fishing.ts`
  concentra as regras puras. O Pesqueiro (categoria Artesanais, `kind: 'fishery'`,
  2 × 2, 40 funcionários, estoque de 300 peixes e 10 Ferramentas, custa
  50 madeiras/15 pedras e exige 25.000 WP. Precisa de área urbana, ao lado de
  estrada e com pelo menos 1 tile sobre água (`requiresWater`;
  erro `not_on_water`; demais tiles podem ser terra). Colunas
  `tool_stock`, `efficiency_penalty` (0–90) e `production_progress` em
  `all_buildings` (migração aditiva em `schema.sql`, que também amplia o
  CHECK de `building_type`). Às 00:00 (`runDailyEmployment`): demanda de
  Ferramentas = 0,05 por funcionário (fração = probabilidade de 1 unidade,
  `rollToolDemand`); atendida se `tool_stock` cobre a demanda (consome), senão a
  penalidade vai a 30% e sobe 10 pontos/dia até 90%; atendida, cai 10/dia
  (`nextEfficiencyPenalty`). Produção: 100 Work Points por peixe, reduzidos pela
  penalidade, com o resto acumulado. As regras `accumulate` usam o custo por
  unidade de `ProductionRule.workPointsPerUnit`. Todas as lojas usam o planner
  compartilhado de vendas; cada uma vende seu `stockProductId`, incluindo as
  lojas de batata, milho, cevada, trigo, carne vermelha, açúcar, vegetais, sal e
  especiarias. Açúcar, vegetais, sal e especiarias têm necessidades configuradas
  em `config/demanda_basica.txt` e participam do cálculo de vendas da cesta
  intermediária. Ferramentas (`tools`) é um produto novo (5 kg, 0,01 m³,
  validade infinita); `planTransfers` leva peixe do Pesqueiro ao armazém e
  Ferramentas do armazém ao Pesqueiro (`Transfer.productId === 'tools'` grava em
  `  tool_stock`). A rota de preço e o histórico financeiro atendem todos os
  tipos em `SHOP_TYPES`.
- Produção leiteira: `getDairyFarmEfficiency` (`src/types/dairy.ts`) aplica
  fatores mensais de 40%, 100%, 80% e 60% à produção diária de `farm_dairy`.
  O produto existente `milk` (litro, 0,001 m³, validade de 7 dias) deteriora
  nos estoques da fazenda, armazéns e lojas pela rotina genérica de validade.
- Recursos e Ferramentaria (`lumber_mill`, `quarry`, `iron_mine` em `kind:
  'resource'`, categoria Recursos, zona rural, ao lado de estrada; `toolmaker`
  em `kind: 'workshop'`, categoria Artesanais, zona urbana). `KIND_CATEGORY` em
  `residence.ts` mapeia kind → categoria. A produção é declarada por
  `ResidenceDefinition.production` (`ProductionRule`: `accumulate`, `chance` ou
  `batch`) e executada por `planProduction` (`fishing.ts`) no bloco diário de
  `runDailyEmployment`, que serve a qualquer construção com `production`.
  Madeireira custa 20 madeiras/5 pedras e exige 35.000 WP; Pedreira e Mina
  custam 60 madeiras/20 pedras e exigem 120.000 WP. Madeireira: 1 madeira/1000
  WP; Pedreira e Mina: 1 pedra/ferro a cada 3000 WP
  (fração = probabilidade); demanda de Ferramentas 0,05 (0,15 na Mina) com a
  penalidade do Pesqueiro. Ferramentaria: armazena 30 carvões e 5 ferros; cada
  lote de 1.000 WP + 5 carvões + 1 ferro = 100 Ferramentas, sem penalidade.
  Ferramentaria e Carvoaria custam 60 madeiras/20 pedras e exigem 120.000 WP.
  Estoques de carvão e ferro são abastecidos pelo armazém ligado (`InputProduct`),
  em `charcoal_stock` e `iron_stock`.
- `salt_gatherer` (categoria Recursos, zona rural) ocupa 2 × 2, emprega até 10,
  guarda 100 sal e 5 Ferramentas, custa 100 madeiras/40 pedras/40 ferros e
  exige 10.000 WP.
  Precisa de estrada adjacente e água adjacente, sem ocupar água. A categoria
  de mapa ainda não distingue rios de outros tiles aquáticos, então qualquer
  água adjacente atende ao requisito. Produz sal pelo modo `chance`: 1 unidade
  por 400 WP efetivos, com fração como chance diária; demanda de Ferramentas
  0,05 por funcionário e penalidade igual à do Pesqueiro. Sprite
  `public/buildings/resources/coleta_sal.png`.
- `sugar_mill` (Casa de Engenho, categoria Artesanais, zona urbana) ocupa 3 × 3,
  emprega até 60, custa 100 madeiras/40 pedras/40 ferros e exige 60.000 WP. Guarda 200
  açúcares, 400 canas, 30 carvões e 5 Ferramentas. Cada lote de 600 WP efetivos
  + 3 carvões + 6 canas produz 1 açúcar; a penalidade por Ferramentas é igual à
  do Pesqueiro. `charcoal_stock` e `sugarcane_stock` são colunas aditivas no
  schema, exibidas no painel, abastecidas pelo armazém ligado e consumidas por
  `planProduction`; a cana nesse insumo também sofre validade de 3 dias. Sprite
  `public/buildings/artisan/casa_de_engenho.png`.
- `charcoal_works` (Carvoaria, categoria Artesanais, zona urbana) ocupa 3 × 3,
  emprega até 20, custa 60 madeiras/20 pedras e exige 120.000 WP. Guarda 100
  carvões, 10 Ferramentas e 30 madeiras (capacidade de insumo definida pelo
  padrão de outras oficinas). Cada lote de 200 WP efetivos e 1 madeira produz
  5 carvões. A demanda de Ferramentas é 0,05 por funcionário/dia, com a
  penalidade do Pesqueiro. Usa os estoques existentes `stock`, `tool_stock` e
  `wood_stock`; o armazém ligado abastece madeira e Ferramentas. O produto
  `charcoal` pesa 5 kg, ocupa 0,015 m³ e não perece. Sprites
  `public/buildings/artisan/carvoaria.png` e `public/products/carvao.png`.
- `flour_mill`, `bread_factory`, `cheese_factory` e `chocolate_factory` (categoria Indústrias, zona
  rural) recebem seus insumos pelo armazém ligado. O Moinho ocupa 3 × 3, emprega
  até 60, custa 100 madeiras/40 pedras/40 ferros e exige 110.000 WP; armazena 100 farinhas e
  até 20 unidades de cada grão elegível, mas só recebe o item selecionado pelo
  dono no painel lateral do Moinho concluído (trigo por padrão). O seletor e sua
  ação de salvar são renderizados independentemente do formulário de preço das
  lojas. Cada 300 WP + 1 grão produz 5 farinhas. Trocar a
  matéria-prima remove o saldo anterior de `building_input_stock`. A Fábrica de
  Pães ocupa 3 × 3, emprega 60, custa 180 madeiras/120 pedras/60 ferros e exige
  480.000 WP, armazena 300 pães/30 farinhas e produz 10 pães por farinha + 200 WP.
  A Fábrica de Queijo ocupa 3 × 3, emprega 200, custa 360 madeiras/240 pedras/
  120 ferros, exige 960.000 WP, armazena 100 queijos/2.000 litros de leite e
  produz 1 queijo por 20 litros + 200 WP. A Fábrica de Chocolate ocupa 4 × 4,
  emprega 40, custa 180 madeiras/120 pedras/60 ferros e exige 480.000 WP e armazena 50 chocolates,
  5 cacaus, 130 litros de leite, 10 açúcares, 100 carvões e 200 Ferramentas.
  Cada 400 WP gera 1 chocolate, consumindo 2 carvões, 2 leites e 4 Ferramentas;
  os consumos esperados de cacau (0,1), açúcar (0,2) e leite extra (0,6) por
  unidade são arredondados estocasticamente, inclusive para frações de WP. Os
  insumos perecíveis também passam pela deterioração diária. Sprites em
  `public/buildings/industrial/`.
- Comércio entre armazéns (`planWarehouseTrades` em `src/types/logistics.ts`): às
  03:00 e 15:00 (`world_state.last_warehouse_trade_slot`, ex. `2026-01-01T15`,
  garante uma execução por rodada) cada armazém em modo `buy` procura armazéns
  de outros donos em até 60 tiles em modo `sell`. O vendedor oferece só o que
  excede seu estoque mínimo, ao preço dele; o comprador só compra se esse
  preço for igual ou menor que seu valor e recebe até seu estoque máximo numérico ou,
  em `MAX`, até o espaço livre (50 m³). As ofertas mais baratas são atendidas primeiro entre todos os
  fornecedores. O comprador gasta Work Points de transporte (mesma fórmula; cada
  rodada usa metade dos pontos diários) e paga ao vendedor (carteira pode ficar
  negativa). Cada troca real grava produto, quantidade, preço unitário,
  comprador, vendedor e dia em `warehouse_trade_history`; as compras/vendas
  imediatas pela rota de fornecedores usam o mesmo registro. `runDailyEmployment`
  grava em `warehouse_payroll_history` os salários efetivamente pagos por cada
  armazém. Os dois históricos são limitados aos últimos 30 dias do relógio do
  jogo; registros anteriores à instalação dessas tabelas não podem ser
  reconstruídos. Pedra exige 30 Work Points por unidade (160 kg, 0,1 m³), contra
  16,25 por unidade de Madeira (50 kg, 0,1 m³).
- Demanda de Work Points do armazém: `logWarehouseDemand` (server/index.ts)
  acumula por dia de jogo, na tabela `warehouse_demand (building_id, day, demand)`
  (cascata), a demanda das transferências locais (00:00) e das compras entre
  armazéns (03:00/15:00, armazém comprador). `GET .../warehouse` devolve
  `demand {lastDay, last, monthAverage}` (média = soma dos últimos 30 dias ÷ 30);
  a previsão do próximo dia é calculada no cliente (`WarehousePanel`:
  empregados × `getDailyWorkPoints`).
- Câmera: sem botões de zoom/centralizar; zoom pela roda do mouse e movimento
  pelas setas do teclado (`GameApp.tsx`, laço `requestAnimationFrame`, ignorado
  em campos de formulário).
- Vínculos logísticos (`src/types/logistics.ts`): `building_warehouse_links`
  permite ligar uma construção produtora ou comercial concluída a vários
  armazéns/silos concluídos do mesmo dono, a até 60 tiles. O endpoint
  `PUT /api/residential-buildings/:id/warehouse-link` adiciona um vínculo com
  `{warehouseId}`, remove um vínculo com `{warehouseId, linked:false}` ou limpa
  todos com `{warehouseId:null}`; o servidor valida dono, tipo, status e distância
  sob o lock transacional. `all_buildings.warehouse_id` mantém o primeiro
  vínculo legado e é migrado para a tabela associativa na inicialização. O painel
  da construção lista todos os depósitos conectados. O estoque real fica em `warehouse_stock`
  (`building_id, product_id, quantity`, cascata) e é devolvido por
  `GET .../warehouse` junto das configurações. No job das 00:00 (depois das
  vendas), `planTransfersDetailed` move produção dos ligados para cada depósito
  e abastece comércios/insumos a partir do saldo acima do mínimo. A rotina
  atualiza o estoque das construções entre depósitos na mesma rodada para não
  duplicar envios nem abastecimentos. O silo usa capacidade de 400 m³ e sua
  lista restrita de produtos; o armazém comum mantém 50 m³ para qualquer produto.
  A ordem Compra/Venda não bloqueia transferências locais. Cada carga consome
  Work Points do depósito (`100 · m³ + 0,125 · kg`; pontos = empregados ×
  `getDailyWorkPoints`); envios ao depósito fazem upsert positivo e
  retiradas atualizam apenas uma linha existente com saldo suficiente. Os
  deltas são separados antes da persistência para nunca tentar inserir uma
  quantidade negativa, evitando violar `warehouse_stock.quantity >= 0`. Quando
  o produto disponível acima do mínimo
  não cobre a soma dos déficits das construções ligadas, `allocateProportionalStock` divide as
  unidades proporcionalmente ao que falta em cada uma, com arredondamento
  inteiro determinístico; o histórico informa essa distribuição. O que não
  couber por espaço ou Work Points não é transportado, e a produção para o
  armazém tem prioridade sobre o abastecimento. No job diário, construções
  ligadas, estoques de insumos e inventários/configurações dos armazéns são
  carregados em consultas por lote, e alterações de estoque, construções,
  histórico e demanda são gravadas em lotes, em vez de repetir essas consultas
  para cada armazém. A persistência do transporte é atômica no savepoint da
  etapa: falha em uma gravação reverte o lote de transporte, sem desfazer as
  demais etapas econômicas. A transferência manual começa
  no painel do armazém por produto, seleciona um destino concluído do mesmo
  dono em até 60 tiles e consulta um limite no servidor. A rota executora volta
  a validar a origem e o destino sob o lock transacional global, respeita o
  estoque mínimo da origem, o limite natural/desejável do destino e os Work
  Points restantes do dia (`gerados - warehouse_demand`). Ela atualiza ambos
  os estoques, registra o movimento no `warehouse_transport_log` e debita os
  Work Points no `warehouse_demand`. Destinos não armazéns só recebem produtos
  para os quais tenham estoque de saída ou capacidade de insumo configurados.
  Insumos genéricos ficam em `building_input_stock`; o Moinho demanda somente o
  produto salvo em `all_buildings.selected_input_product_id`.
  Falhas técnicas na execução retornam uma referência, a etapa e uma categoria
  segura do erro; os logs do servidor associam essa referência ao erro técnico
  completo, sem expor detalhes do banco ao cliente.
- Validade de estoques: não há lotes nem datas de entrada. Às 18:00 do dia do
  jogo, `applyDailySpoilage` calcula para cada estoque perecível a perda
  esperada `quantidade / PRODUCTS.shelfLifeDays`; a parte inteira é removida
  sempre e a fração arredondada estocasticamente para uma unidade. A rotina
  varre o estoque principal de todas as construções que produzem ou vendem um
  produto perecível (fazendas, comércios, construções artesanais, recursos e
  indústrias), os insumos perecíveis em `building_input_stock` e os produtos
  perecíveis em `warehouse_stock` (armazéns).
  `world_state.last_spoilage_day` garante execução única por dia. Estoques
  iniciam a mesma regra imediatamente, sem backfill; produtos de validade
  infinita, como madeira, pedra, ferro e ferramentas, não se deterioram.

## API HTTP

As rotas do mundo, exceto health check, exigem JWT válido do Neon Auth.

| Rota | Acesso | Função |
| --- | --- | --- |
| `GET /api/health` | Público | Verifica conectividade com PostgreSQL e Redis. |
| `GET /api/me` | Autenticado | Retorna se o usuário é master. |
| `GET /api/performance-logs` | Autenticado | Retorna até 100 medições recentes de etapas globais, armazenadas no Redis por até sete dias. |
| `GET /api/cities` | Autenticado | Retorna cidades com população, pessoas empregadas, vagas abertas e salário médio diário dos empregados. |
| `GET /api/cities/:id/consumption` | Autenticado | Retorna consumo médio por cidadão da cidade e preço médio ponderado, no último dia e nos últimos 30 dias. |
| `GET /api/wallet` | Autenticado | Cria a carteira sem saldo prévio com C$ 25.000 (idempotente), preserva saldos existentes e retorna `{ balance }`. |
| `GET /api/accounting?days=1\|7\|30&week=0\|1\|2\|3\|4` | Autenticado | Retorna relatórios detalhados no período selecionado e o resumo financeiro da semana indicada (0 = atual, 4 = quatro semanas antes), além de funcionários empregados e estimativas atuais do valor da empresa e do estoque. |
| `PUT /api/residential-buildings/:id/farm-automation` | Dono da fazenda agrícola concluída | Valida e salva meses de replantio e limites de trabalhadores por fase; desativar mantém as preferências e o ciclo atual, mas interrompe novos plantios automáticos. |
| `PATCH /api/residential-buildings/:id/input-product` | Dono do Moinho concluído | Seleciona trigo, cevada ou milho; descarta o estoque de outro insumo na mesma transação e publica a seleção/estoques. |
| `GET /api/player/resources?x=&y=` | Autenticado | Retorna `{ wood, stone }` dos armazéns concluídos do jogador em até 60 tiles das coordenadas validadas. |
| `GET /api/residential-buildings/:id/warehouse-log` | Dono do armazém | Retorna `{ days: [{ day, workPoints }], events: [{ day, buildingType, productId, direction, wanted, moved, reason, errorDetail }] }` do armazém (tabela `warehouse_transport_log`, gravada às 00:00 na etapa de transporte, 30 dias; `reason` = `desired_reached`/`no_space`/`no_work_points`/`warehouse_empty` quando moveu menos que o desejado; erros internos registram etapa e detalhe em `errorDetail`). |
| `GET /api/residential-buildings/:id/warehouse` | Autenticado | Retorna configurações por produto (`minimumStock`, `maximumStock` numérico ou `null` para `MAX`, valor e modo), estoque e preço médio local ponderado por oferta acima do mínimo; espaço ocupado é calculado no cliente. |
| `GET /api/residential-buildings/:id/warehouse-transfer-quote?destinationId=&productId=` | Dono do armazém | Calcula o limite atual da transferência considerando estoque mínimo de origem, capacidade/estoque desejável do destino, distância e Work Points restantes do dia. |
| `POST /api/residential-buildings/:id/warehouse-transfer` | Dono do armazém | Transfere `{ destinationId, productId, quantity }` para construção concluída do mesmo dono em até 60 tiles; recalcula e valida todos os limites no servidor, grava o histórico e publica os estoques atualizados. Erros técnicos retornam `{ error, failureStage, reason, failureReference }`; a referência pode ser localizada nos logs do servidor. |
| `GET /api/residential-buildings/:id/stock-upgrades` | Dono da construção concluída | Retorna os níveis, capacidades e custos de upgrade por compartimento; os custos usam a média de ofertas de venda ativas de materiais em armazéns/silos e o salário médio municipal. |
| `PATCH /api/residential-buildings/:id/stock-upgrades` | Dono da construção concluída | Recebe `{ stockKey, direction: "upgrade" \| "downgrade" }`; valida os limites e a propriedade no servidor, cobra o upgrade atomicamente ou impede downgrade que descarte estoque, e publica a capacidade atualizada. |
| `POST /api/residential-buildings/:id/warehouse/suppliers` | Dono do armazém | Executa compras imediatas do armazém especificado pelo mesmo planejador das rodadas automáticas. |
| `GET /api/residential-buildings/:id/production-history` | Autenticado | Retorna `{ days: [{ day, workPoints, produced, transported, efficiency }] }` dos últimos 30 dias (tabela `production_history`, gravada às 00:00 pelas etapas de produção, fazendas e transporte; `transported` conta só envios ao armazém). |
| `GET /api/residential-buildings/:id/commerce-history` | Dono do comércio | Retorna os últimos 30 dias de dados financeiros de `commerce_history`; o painel combina a resposta com diagnósticos presentes no armazenamento local do navegador. |
| `GET /api/master/online-players` | Master | Lista `{ players: [{ id, name, email, connections }] }` a partir da presença no Redis (`userId|uuid`) e de `neon_auth."user"`. |
| `POST /api/master/time-scale` | Master | `{ timeScale }` validado por `isValidTimeScale` (`src/types/worldClock.ts`: 15, 30, 60, 240); avança o relógio com a velocidade antiga, grava `world_state.time_scale` e republica o snapshot. |
| `POST /api/master/grant-money` | Master | `{ amount }` (C$ 0,01 a C$ 1.000.000.000, com até duas casas decimais, `parseMasterGrant`) creditado na carteira do próprio Master; retorna `{ balance }`. |
| `POST /api/cities` | Master | Valida e cria Assembleia/cidade. |
| `PATCH /api/cities/:id` | Master | Altera o nome de uma cidade. |
| `PUT /api/cities/:id/zones` | Master | Valida e substitui as regiões urbanas/rurais da cidade. |
| `DELETE /api/cities/:id` | Criador da cidade | Demole a Assembleia e remove as estradas da área. |
| `POST /api/roads` | Master | Valida e grava um caminho de estrada de até 600 tiles. |
| `DELETE /api/roads/:x/:y` | Criador do tile | Demole um tile de estrada sem confirmação; publica o novo estado. |
| `DELETE /api/roads` | Autenticado | Demole os tiles próprios de um caminho de até 600 tiles e publica o novo estado. |
| `POST /api/residential-buildings` | Autenticado | Valida o estoque e desconta atomicamente Madeira, Pedra e Ferro quando exigido pela configuração (exceto para Master); o primeiro armazém do jogador é concluído e gratuito. |
| `POST /api/residential-buildings/:id/complete` | Master | Conclui uma residência instantaneamente. |
| `DELETE /api/residential-buildings/:id` | Criador da residência | Demole a residência sem confirmação e publica o novo estado. |
| `GET /api/residential-buildings/:id/ownership` | Autenticado | Informa se o usuário é o criador da construção. |
| `PATCH /api/residential-buildings/:id/work-settings` | Criador; obras e construções não residenciais concluídas | Valida funcionários desejados (0–100 em obras ou 0–máximo após concluídas), salário diário (até duas casas decimais), carga horária (4–14 h) e técnica mínima necessária (10–40); reduz empregados excedentes. |
| `PATCH /api/residential-buildings/:id/rent` | Criador | Valida e grava o aluguel por pessoa (≥ C$ 0,01, até duas casas decimais). |
| `GET /api/world` | Autenticado | Retorna relógio, dimensões/semente e jogadores online. |

Falhas de validação são respostas HTTP explícitas; indisponibilidade de banco,
autenticação ou sincronização é registrada e não deve virar uma resposta falsa
de sucesso.

## Persistência e sincronização

`server/index.ts` carrega `database/schema.sql` ao iniciar:

- `world_state` guarda o relógio persistente do mundo.
- `city_assemblies` guarda nomes, centros, métricas, autorias e o salário
  mínimo diário (NUMERIC(12,2), padrão C$ 1); a alteração do piso atualiza
  salários menores em `all_buildings` na mesma transação.
- `city_zones` guarda os retângulos municipais, com cascata ao excluir a cidade.
- `road_tiles` guarda uma linha por tile, referência à cidade e autoria.
- `player_wallets` guarda o saldo (`balance`, NUMERIC(14,2), pode ficar negativo) por `user_id` (`sub`
  do Neon Auth). A carteira é criada com `STARTING_BALANCE` (`src/types/wallet.ts`)
  na primeira chamada a `GET /api/wallet`; o saldo aparece na barra superior
  como `C$ …` e é reconsultado a cada 30 s. Débitos e créditos são aplicados no
  servidor e na mesma transação do processamento diário.
- Valores monetários usam precisão de centavos (`NUMERIC(...,2)` no PostgreSQL);
  preços, salários, aluguéis, pagamentos, históricos e carteiras aceitam no
  máximo duas casas decimais. O parser do driver converte esses campos em
  números para a API, e `formatMoney` os exibe em pt-BR. O esquema converte as
  antigas colunas inteiras/`BIGINT`/`DOUBLE PRECISION` para `NUMERIC` preservando
  os valores já existentes.
- Ao concluir um comércio, o servidor define o preço inicial pela média dos
  preços atuais de comércios concluídos do mesmo tipo pertencentes ao jogador.
  Se ele ainda não tiver um comércio desse tipo, usa a média do mesmo tipo na
  cidade, considerando todos os jogadores. Sem referência na cidade, o preço
  inicial é C$ 10. A decisão ocorre dentro da transação de conclusão.
- `all_buildings` guarda tipo, footprint, cidade, status, autoria e
  horários de início/conclusão, `wage`, `work_hours_per_day`, `desired_workers`, `rent` e
  `occupants`, o estado do ciclo agrícola e as preferências de automação das
  fazendas (`farm_auto_planting_enabled`, meses e trabalhadores por fase) (colunas
  adicionadas com `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, assim como
  `world_state.last_immigration_day`); excluir a cidade
  remove suas residências por cascata.
- `residence_rent_history` registra, por residência e dia, moradores, aluguel
  por pessoa e receita gerada. `building_payroll_history` guarda despesas
  salariais diárias para todas as construções; o esquema migra salários
  históricos disponíveis de lojas e armazéns. Novos históricos de aluguel e de
  salários de outras construções começam com esta atualização.
- `production_history` guarda a produção diária por construção. A aba
  **Produção** combina essa tabela com `building_payroll_history`; **Residências**
  combina população/capacidade atuais com a receita de
  `residence_rent_history`. O endpoint contábil restringe os relatórios ao dono
  autenticado e filtra os relatórios detalhados pelo período selecionado (1, 7
  ou 30 dias, incluindo o dia corrente). O resumo usa semanas de sete dias
  ancoradas no dia atual do jogo e mantém 35 dias de históricos financeiros.
  Valor empresarial e estoque usam preços médios atuais de venda anunciados nos
  armazéns; produtos sem preço anunciado não entram na estimativa.
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
4. A lista `valdora:world:performance-logs` mantém até 100 medições globais,
   com expiração de sete dias, acessível ao botão **Log** por usuários
   autenticados. Os registros incluem duração, tempo acumulado das consultas
   PostgreSQL, espera por lock, quantidade de consultas, contagens de entidades
   e sucesso/falha; não incluem SQL nem dados pessoais.

O servidor mede as etapas de alocação de empregos, folha e aluguel, vendas,
produção, fazendas, transporte, imigração e publicação. O tempo de consulta é
medido como duração observada no cliente PostgreSQL; o tempo restante é uma
diferença aproximada e pode incluir cálculo e outras esperas, não somente CPU.

O WebSocket `/ws` exige JWT. Ao conectar, o servidor envia o snapshot e o
estado atual de cidades, estradas e residências. Atualizações compartilham um
envelope `{ type: "cities", cities, roads, buildings }`; snapshots contêm hora
do jogo, hora do servidor, velocidade, mapa e jogadores online.
`src/game/worldClient.ts` reconecta com atraso exponencial limitado e valida o
formato básico das mensagens antes de atualizar o React.
Depois das 00:30 UTC do relógio do jogo, o líder publica uma sincronização
completa desse estado para todos os jogadores conectados. `last_full_world_sync_day`
em `world_state` registra a publicação por dia; o lock transacional da linha
evita duplicatas entre instâncias e a marcação só é gravada após o Pub/Sub ter
aceitado a mensagem.
O nome do criador é obtido de `neon_auth."user"` e aparece no painel de detalhes.
Cada construção recebe um número sequencial por dono e tipo, mantido em
`player_building_counters` e persistido em `all_buildings.building_number`.
Na inicialização, instalações existentes recebem números por data de criação;
demolições não reutilizam números. O cliente formata esses números em algarismos
romanos (`getResidentialBuildingName`) no painel descritivo. O nome do criador é
obtido de `neon_auth."user"` e aparece no painel de detalhes; a etiqueta sobre
cada construção do próprio jogador mostra esse nome. A partir do zoom 3 (de
6), uma segunda etiqueta abaixo identifica o tipo de construção. O servidor
envia a cada socket apenas um booleano de propriedade para controlar as
etiquetas; o ID interno do proprietário é removido antes da transmissão ao
navegador. **Visualizar** no painel contábil centraliza a câmera e seleciona a
construção pelo ID recebido.

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

- A população e os indicadores agregados da cidade ainda não evoluem; cada
  residência concluída, porém, tem bem-estar individual dinâmico.
- O catálogo habilita casas, armazéns, fazendas agrícolas e leite, lojas de
  arroz, peixe e leite, pesqueiro, recursos e ferramentaria para todos os
  jogadores autenticados. Custos de materiais de construção ainda não são
  debitados; obras progridem por Work Points e a conta master pode concluí-las
  instantaneamente.
- O estado de cada cidade/estrada é consultado e enviado integralmente na
  sincronização atual; crescimento grande do mundo pode exigir paginação ou
  atualizações incrementais.
- O editor de mapa procedural continua no código, mas não está ligado ao fluxo
  de entrada atual.

- Obras e economia diária: às 00:00 o progresso das obras usa `advanceConstruction` (employment.ts; conclui quando Work Points >= necessários, para todos os tipos). Vendas, produção, fazendas e transporte rodam, cada etapa, sob seu próprio SAVEPOINT (`runStage`): se uma falhar, as demais, a folha e as obras do dia são preservadas e o erro é registrado com o nome da etapa. As etapas agrupam leituras e gravações de construções com arrays PostgreSQL, preservando o cálculo e as transações; o transporte continua isolando falhas por armazém.
- Métricas do processamento diário: as etapas de economia, alocação, imigração, mudanças de residência e publicação registram duração, consultas PostgreSQL, espera pelo lock, contagens globais de residências/locais de trabalho/lojas/armazéns e status; a lista Redis tem limite de 100 registros e expira após sete dias.
- Sincronização diária: a partir de 00:30 UTC do relógio do jogo, uma mensagem completa de cidades, estradas e construções é publicada pelo Redis para os jogadores conectados, no máximo uma vez por dia. A atualização não recarrega a página; `worldClient.ts` aplica o estado recebido.
