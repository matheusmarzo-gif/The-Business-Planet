# Valdora — Crônicas de um Reino

Primeira etapa do jogo de simulação medieval: mapa mundial compartilhado,
navegável no navegador, relógio contínuo e presença online.

## Publicar online com GitHub, Render e Neon

Esta opção não exige instalar o Docker Desktop no computador. O GitHub guarda o
código e aciona a publicação no Render; o Render executa o servidor do jogo; e
o Neon hospeda o PostgreSQL e a autenticação dos jogadores. O jogo exige uma
conta para abrir o mapa e conectar ao mundo.

O jogo também usa **Redis** para controlar a presença dos jogadores e
distribuir atualizações em tempo real. Portanto, além do banco Neon, crie um
serviço compatível com Redis, por exemplo o **Key Value** do Render.
Na tela de entrada, a opção **Esqueci minha senha** envia um link de redefinição
para o e-mail informado. O link expira após 15 minutos; para concluir a
redefinição, a autenticação por e-mail deve estar habilitada no Neon Auth.
Novas contas precisam confirmar o e-mail com o código enviado pelo Neon Auth
antes de entrar. Para uma conta já cadastrada e ainda não confirmada, use
**Reenviar código de confirmação** na tela de entrada.

### 1. Enviar o projeto ao GitHub

Crie um repositório no GitHub e envie para ele os arquivos desta pasta. Se o
repositório contiver esta pasta dentro de outra, configure a pasta do projeto
como diretório raiz (`Root Directory`) no Render.

Não envie senhas, URLs privadas de banco de dados ou arquivos `.env` ao GitHub.

### 2. Criar o banco no Neon

O projeto Neon já está configurado para o projeto `gentle-tooth-49930425`, branch
`production`, com PostgreSQL e Neon Auth. Para usar essa configuração:

1. Instale o CLI Neon, se necessário, e entre na conta:

   ```powershell
   npm.cmd install --global neon@latest
   neon.cmd login
   ```

2. Na pasta do projeto, publique/aplique os serviços e gere as variáveis locais:

   ```powershell
   neon.cmd deploy
   ```

3. O comando cria/atualiza `.env.local` com `DATABASE_URL`,
   `DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL` e `NEON_AUTH_JWKS_URL`.
   Mantenha esse arquivo privado; ele é ignorado pelo Git.

O servidor Node usa `pg` com `DATABASE_URL` para as consultas normais. Neon
Auth usa `NEON_AUTH_BASE_URL` no cliente e `NEON_AUTH_JWKS_URL` para validar as
sessões no servidor.

O servidor cria a tabela necessária (`world_state`) automaticamente ao iniciar.

### 3. Criar o Redis no Render

1. No painel do Render, crie um serviço **Key Value** compatível com Redis.
2. Use a URL de conexão interna quando o serviço do jogo e o Key Value estiverem
   na mesma região.
3. Guarde a URL para configurar a variável `REDIS_URL` no serviço web.

### 4. Criar o serviço web no Render

1. No Render, crie um **Web Service** e conecte o repositório do GitHub.
2. Se necessário, informe o diretório do projeto em `Root Directory`.
3. Configure:

   - **Build Command:** `npm install --include=dev && npm run build`
   - **Start Command:** `npm start`

4. Em **Environment Variables**, adicione as variáveis de `.env.local`:

   | Nome | Valor |
   | --- | --- |
   | `DATABASE_URL` | Connection string do Neon |
   | `NEON_AUTH_BASE_URL` | URL base do Neon Auth |
   | `NEON_AUTH_JWKS_URL` | URL JWKS do Neon Auth |
   | `MASTER_EMAIL` | E-mail da conta Neon Auth que terá acesso à Prefeitura |
   | `REDIS_URL` | URL de conexão do Key Value |

   O Render fornece a variável `PORT` para o servidor; não é necessário
   defini-la manualmente. Cadastre as URLs privadas somente nas configurações
   do serviço, nunca no código ou no GitHub. `NEON_AUTH_BASE_URL` é pública e é
   usada pelo Vite para configurar o cliente de autenticação.

5. Publique o serviço. O Render fornecerá um endereço público; abra-o para
   acessar o jogo.
6. Adicione o domínio público do app à lista de domínios confiáveis do Neon Auth:

   ```powershell
   neon.cmd neon-auth domain add https://<dominio-do-servico>
   ```

   Faça isso para cada domínio de produção ou preview usado para abrir o jogo.
   O `localhost` costuma ser permitido por padrão; se não for, habilite-o com
   `neon.cmd neon-auth domain allow-localhost enable`.

   A branch `production` já está configurada com o domínio
   `https://the-business-planet.onrender.com` e verificação por código para
   novos cadastros e contas não confirmadas. O provedor compartilhado do Neon
   pode ter limites de envio; para produção, configure SMTP próprio em
   **Neon Console → Settings → Better Auth → Custom SMTP provider**.

Para verificar a conexão com PostgreSQL e Redis, abra
`https://<endereco-do-servico>/api/health`. A resposta esperada é
`{"status":"ok"}`. O mapa e o WebSocket `/ws` exigem uma sessão Neon Auth
válida; as rotas do mundo verificam os tokens no servidor.

Cada push para a branch conectada ao Render pode iniciar uma nova publicação.
O relógio global e sua persistência ficam no PostgreSQL; o Redis gerencia a
presença e a distribuição das atualizações em tempo real. Após 00:30 no
relógio do jogo, o servidor também envia a todos os jogadores conectados uma
sincronização completa de cidades, estradas e construções, sem recarregar a
página.

## Executar localmente (opcional)

O Neon fornece o PostgreSQL e o Neon Auth do ambiente local por meio de
`.env.local`. Para Redis local, o Docker Compose inicia Redis e PostgreSQL. Se
preferir, instale o Docker Desktop para Windows em
[docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
e, se solicitado, habilite o WSL 2.

Abra um PowerShell na pasta do projeto:

```powershell
cd "C:\Users\MATHEUS\Desktop\matheus - the business planet\tilescape_projeto_completo_4000x4000_seed583921"
docker compose up -d
npm.cmd install
npm.cmd run dev
```

Abra **http://localhost:3000** no navegador, crie uma conta ou entre com uma
conta existente. Mantenha o terminal aberto enquanto estiver jogando; `Ctrl+C`
encerra o jogo. Confira o servidor em **http://localhost:3000/api/health**; a
resposta esperada é `{"status":"ok"}`.

Para parar os contêineres, use `docker compose stop`; para iniciá-los novamente,
use `docker compose up -d`. `docker compose down` remove os contêineres, mas
preserva os dados. **Não use `docker compose down -v` para parar o jogo:** essa
opção apaga os volumes, incluindo o banco e o estado persistente do mundo.

## Construções e cidades

O mapa tem uma barra inferior com as categorias Construções Artesanais,
Comerciais, Fazendas, Residências, Recursos, Indústrias e Prefeitura. As seis
categorias de construções estão disponíveis para todos os jogadores autenticados;
a Prefeitura aparece somente para a conta Neon Auth configurada em
`MASTER_EMAIL`. Cadastre o mesmo e-mail nas variáveis locais e no Render; crie
essa conta pelo formulário do jogo para ativar a permissão.

A primeira estrutura da Prefeitura é a **Assembleia**. Escolha-a no catálogo,
informe o nome da cidade e mova o cursor pelo mapa para ver uma prévia: verde
indica um local válido e vermelho indica água, outra construção ou uma área
municipal incompatível. Clique para selecionar o centro. A Assembleia ocupa
3 × 3 tiles e só pode ser colocada inteiramente em terra; sua área municipal
ocupa 303 × 303 tiles. Áreas municipais não podem se sobrepor nem ultrapassar
os limites do mapa, e o servidor valida essas regras antes de salvar.
Clique na Assembleia para consultar os dados da cidade; a conta master também
pode editar o nome. O painel mostra população, pessoas empregadas, vagas de
emprego ainda abertas e salário médio diário dos empregados. O botão **Consumo**
abre o consumo médio por cidadão no último dia e nos últimos 30 dias, com o
preço médio pago por produto. O rótulo da cidade mantém tamanho legível mesmo
ao mudar o zoom. Bem-estar e economia começam em zero.
Na janela da Assembleia, a conta master pode abrir **Configurar áreas urbanas
e rurais** e arrastar no mapa para desenhar vários retângulos por tipo. Cada
região precisa ficar dentro dos 303 × 303 tiles municipais e as áreas não
podem se sobrepor. Regiões urbanas aparecem em azul e rurais em verde durante
a edição; jogadores também veem somente a região relevante quando selecionam
uma categoria: Construções Artesanais, Comerciais e Residências usam áreas
urbanas; Fazendas, Recursos e Indústrias usam áreas rurais. A definição das
zonas é persistida e sincronizada em tempo real. Jogadores autenticados podem
iniciar construções em todas as seis categorias; os requisitos de zona, terreno,
estrada e espaço continuam sendo validados pelo servidor. Residências e demais
construções são descritas abaixo.
Depois de confirmar o local, a Assembleia aparece imediatamente enquanto o
servidor salva; se a operação falhar, ela é removida e a mensagem de erro é
exibida.
Use **Demolir** na barra inferior e clique em uma construção para removê-la.
O servidor só permite que o jogador que criou a construção a demola; ao
demolir uma Assembleia, sua cidade e área municipal também são removidas.
No modo **Demolir**, clique em um tile de estrada ou clique e arraste ao longo
do trecho para removê-lo sem confirmação. Somente quem construiu cada tile
pode demoli-lo; em trechos com estradas de outros jogadores, apenas as suas
serão removidas.
Na Prefeitura, selecione **Estrada de Terra** e clique e arraste para desenhar
um traçado de até 600 tiles. As peças retas e curvas se ajustam aos trechos
vizinhos; estradas só são aceitas em terra dentro de uma área municipal e não
podem passar sobre a Assembleia. Apenas a conta master pode construí-las; os
traçados são salvos e sincronizados com o mundo. As junções em T e cruzamentos
de quatro vias também se ajustam às conexões vizinhas. O traçado aparece
imediatamente enquanto o servidor salva e some com uma mensagem caso a
operação seja rejeitada. Cada tile pode ser demolido individualmente e sua
remoção é sincronizada com os demais jogadores.

## Dinheiro

Cada jogador começa com **C$ 10.000**. O saldo aparece na barra superior, ao
lado do contador de viajantes. A carteira é criada no primeiro acesso após esta
atualização (inclusive para contas já existentes) e é guardada no servidor.

### Residências

Na categoria **Residências**, selecione uma das duas casas para ver no cursor
uma prévia verde/vermelha. A casa precisa caber inteira em uma área urbana da
cidade, ficar em terra, não ocupar outra construção ou estrada e estar ao lado
de uma estrada. Clique para iniciar a obra:

| Residência | Tamanho | Capacidade | Apreço local | Custo | Trabalho necessário |
| --- | --- | --- | --- | --- | --- |
| Simples 1 | 2 × 2 tiles | 4 pessoas | 50 | 100 madeiras, 30 pedras | 18.000 Work Points |
| Simples 2 | 3 × 3 tiles | 32 pessoas | 40 | 300 madeiras, 450 pedras | 67.500 Work Points |

Todos os jogadores podem iniciar construções das seis categorias. Para jogadores
que não são Master, o custo de Madeira e Pedra é descontado dos armazéns
concluídos do próprio jogador a até 60 tiles do centro da construção; o servidor
exige os dois materiais e faz a cobrança atomicamente ao iniciar a obra. Se o
custo não estiver disponível, a construção não é iniciada. Cada jogador pode
construir um primeiro **Armazém** gratuito, que fica pronto imediatamente; esse
direito permanece registrado mesmo se o armazém for demolido. As demais
construções aparecem com o ícone **Em construção** e avançam com os Work Points
dos funcionários; a conta Master mantém a permissão de iniciar sem materiais e
concluí-las instantaneamente com duplo clique. Capacidade e apreço ainda não
alteram população ou estoque.
Para demolir uma residência, ative **Demolir** e clique em qualquer tile dela.
Não há confirmação; somente o jogador que iniciou a construção pode removê-la.

A barra lateral com dados do mundo foi removida. Clique em uma residência (fora
dos modos de construção e demolição) para abrir o painel lateral: residências
concluídas mostram ocupantes, capacidade, técnica, saúde, felicidade, empregados
e renda média por morador (calculada a partir dos empregos já alocados: soma dos
salários dos empregos dos moradores ÷ ocupantes); obras mostram Work Points, empregados
e permitem ao dono editar o salário ofertado (C$ por dia de trabalho) e a carga
horária por dia (4 a 14 h). O dono também define o aluguel por pessoa (mínimo
C$ 1) da residência. Todo dia às 00:00 do reino, cidades com menos de 1.000
habitantes recebem 40 imigrantes, que ocupam as residências concluídas mais
baratas com vaga (empate: maior apreço). A população da cidade é a soma dos
ocupantes das suas residências. A cobrança do aluguel ainda não é aplicada, pois
o jogo não tem dinheiro dos jogadores. Clique em outro ponto do mapa ou em × para fechar.

### Indústrias

Na categoria **Indústrias**, o **Armazém** (4 × 4 tiles, até 100 funcionários,
capacidade de 50 m³ para qualquer produto) custa 300 madeiras e 60 pedras e
exige 20.000 Work Points. Deve ficar em área rural, ao lado de uma estrada.
O primeiro armazém de cada jogador é gratuito e concluído instantaneamente,
inclusive para a conta Master; armazéns adicionais seguem as regras normais de
construção. A autorização do primeiro armazém é persistida no servidor e não
volta após demolição. Ao clicar em um armazém concluído, use **Produtos e
estoque** no painel lateral para abrir a lista de todos os produtos com o
estoque atual e, para cada um, o
**Estoque Máximo Desejável**, o **Estoque Mínimo Desejável**, o valor e se é de
venda ou compra (somente o dono edita; cada linha tem seu botão **Salvar**).
O máximo aceita um número ou **MAX** (padrão), que deixa o limite a cargo do
espaço natural de 50 m³; o mínimo é o estoque que o armazém preserva ao vender
ou abastecer suas construções ligadas. A busca filtra produtos pelo nome. O
campo **Preço médio** mostra a média ponderada dos preços de venda em
armazéns concluídos a até 60 tiles, ponderada pela quantidade que cada um pode
oferecer acima do próprio mínimo. **Procurar fornecedores** tenta comprar, para
os produtos configurados como **Compra**, até os estoques desejados, respeitando
preços (inclusive quando a oferta iguala o limite desejado), distância,
capacidade e Work Points; a ação pode ser repetida sem aguardar a rodada
automática. Pedra exige mais Work Points por unidade que Madeira por ser mais
pesada; cada compra é limitada aos Work Points disponíveis naquela rodada.

### Comércio

Na categoria **Comerciais**, a **Loja de Arroz** (2 × 2 tiles, até 4 funcionários,
estoque máximo de 20 unidades de arroz) custa 100 madeiras e 20 pedras e exige
9.000 Work Points. Deve ficar inteira em área urbana, ao lado de uma estrada e
sem sobrepor outras construções. O fluxo (prévia, obra, demolição, painel
lateral com raio de busca de 60 tiles) é o mesmo das fazendas. As vendas usam
arroz entregue pelo armazém ligado e o preço configurado pelo dono.

### Pesqueiro e Loja de Peixes

Na categoria **Construções Artesanais**, o **Pesqueiro** (2 × 2 tiles, até 10
funcionários, estoque máximo de 300 peixes e 10 Ferramentas) custa 60 madeiras e
10 pedras e exige 12.000 Work Points. Deve ficar em área urbana, ao lado de uma
estrada e com pelo menos um tile sobre a água (o resto pode ser terra). Produz
diariamente (00:00) 1 peixe a cada 100 Work Points. Consome Ferramentas: 0,05 por
funcionário/dia (valores abaixo de 1 são probabilidade). Sem Ferramentas, a
eficiência cai 30% e a penalidade sobe 10% por dia até 90%; ao suprir, ela cai 10%
por dia até zerar. Ferramentas (5 kg, 0,01 m³, sem validade) chegam por armazém
ligado.

Na categoria **Comerciais**, a **Loja de Peixes** (2 × 2, 4 funcionários, estoque
máximo de 40 peixes) custa 30 madeiras e 10 pedras e exige 6.000 Work Points. As
vendas e o consumo das residências seguem a mesma fórmula do arroz; o consumo de
peixe aparece em "Ver consumo da casa".

### Fazenda leiteira e Loja de Leite

Na categoria **Fazendas**, a **Fazenda leiteira** (3 × 3 tiles, até 10
funcionários, estoque máximo de 400 litros) custa 60 madeiras e 60 pedras e
exige 12.000 Work Points. Ela produz 1 litro a cada 5 Work Points efetivos; sua
eficiência é de 40% nos meses 1–3, 100% nos meses 4–6, 80% nos meses 7–9 e
60% nos meses 10–12. O leite produzido segue para o armazém ligado.

Na categoria **Comerciais**, a **Loja de Leite** copia as características da
Loja de Peixes: 2 × 2 tiles, até 4 funcionários, estoque máximo de 40 litros,
custo de 30 madeiras e 10 pedras e 6.000 Work Points para construir. Seu preço
padrão é C$ 10 e pode ser alterado pelo dono. A loja recebe leite do armazém
ligado e vende às residências pelo mesmo cálculo de demanda e benefício usado
para os demais produtos.

O multiplicador de demanda básica pode ser ajustado em
[`config/demanda_basica.txt`](./config/demanda_basica.txt). Os valores iniciais
são `0.03` para arroz e peixe e `1` para leite. O servidor lê o arquivo ao
iniciar; reinicie o serviço depois de alterá-lo.

### Recursos e Ferramentaria

Na categoria **Recursos** (área rural, ao lado de estrada):

| Construção | Tam. | Func. | Estoque máx. | Custo | Work Points | Produção diária |
|---|---|---|---|---|---|---|
| Madeireira | 2 × 2 | 10 | 30 madeiras, 5 Ferramentas | 60 madeira, 10 pedra | 6.000 | 1 madeira / 1000 WP |
| Pedreira | 2 × 2 | 30 | 10 pedras, 5 Ferramentas | 60 madeira, 10 pedra | 6.000 | 1 pedra / 3000 WP |
| Mina de Ferro | 3 × 3 | 30 | 5 ferro, 5 Ferramentas | 120 madeira, 60 pedra | 24.000 | 1 ferro / 3000 WP |

Abaixo do mínimo de WP, a fração vira probabilidade de produzir 1 unidade. A
demanda de Ferramentas é 0,05 por funcionário/dia (0,15 na Mina) com a mesma
penalidade do Pesqueiro, que reduz os WP efetivos.

Na categoria **Artesanais** (área urbana, ao lado de estrada), a **Ferramentaria**
(2 × 2, 30 funcionários, estoque máx. 100 Ferramentas, 30 madeiras e 5 ferro)
custa 60 madeiras e 60 pedras e exige 12.000 Work Points. Por dia, cada lote de
1000 WP + 5 madeiras + 1 ferro produz 100 Ferramentas. Madeira e ferro chegam por
armazém ligado.

### Fazendas

Na categoria **Fazendas**, a **Fazenda de arroz** (4 × 4 tiles, até 30 funcionários,
estoque máximo de 300 unidades de arroz) custa 200 madeiras e 20 pedras e exige
12.000 Work Points. Ela só pode ser construída inteiramente em área rural, sem
sobrepor estradas ou construções e precisa ficar ao lado de uma estrada. Toda obra
e a fazenda concluída terão uma área de 60 tiles de raio para procurar
trabalhadores (exibida no painel; veja "Empregos e salários"). O
funcionamento é o mesmo das residências (prévia, obra, demolição e painel
lateral), mas sem moradores nem aluguel; consulte a regra de crescimento e
colheita da fazenda de arroz abaixo.

### Empregos e salários

Em obras, fazendas, comércios e indústrias o dono define **funcionários
desejados**, **salário por dia** e **carga horária** (4 a 14 h). Durante a obra,
é possível definir até 100 funcionários, independentemente do limite final do
edifício; ao concluir, o número desejado e os empregados são reduzidos ao máximo
definitivo da construção (por exemplo, 4 na Loja de Leite). Em construções
concluídas vale o limite do catálogo. Todo dia às 12:00 (horário do mundo) os moradores
são distribuídos: cada construção com vagas tem um *benefício*
`vagas × F_H² × salário / carga horária`, com `F_H = 1 − 0,5·(|H−8|/6)²`, e as
residências empregam seus moradores (dentro de 60 tiles) do maior benefício para
o menor, atualizando as vagas a cada preenchimento. Às 00:00 o dono paga o
salário de cada funcionário (o dinheiro some e o caixa pode ficar negativo). Também
às 00:00 cada funcionário de uma obra gera
`12,5 × horas × saúde/100 × felicidade/100 × fator de descanso` Work Points (fator
1,2 com 4 h, 1 com 8 h, 0,8 com 14 h); a obra termina sozinha ao atingir o total
necessário. Saúde e felicidade ainda são fixas em 100.

Nas lojas de arroz, peixe e leite, o dono define o preço (C$ 1 ou mais). Às 00:00
cada 100 Work Points gerados pelos funcionários no dia somam 5 unidades de
capacidade de venda. As residências compram primeiro das lojas em até 60 tiles com maior
benefício. A média efetiva da área é calculada com as vendas do dia anterior,
ponderando o preço praticado em cada loja pelas unidades vendidas. Para cada
loja, calcula-se `quantidade desejada = moradores × demanda_basica × max(0,125,
min(4, média efetiva da área / preço local))`; o benefício é
`((renda média por morador − preço local × (quantidade desejada / moradores))
/ preço local)³ × (60 / (distância + 60))²`, com distância entre centros. Loja
com benefício negativo não vende para a residência. A parte
fracionária da quantidade é a chance de comprar uma unidade adicional. Se não houve vendas na
área no dia anterior, usa-se a média simples dos preços atuais das lojas
próximas. As vendas continuam limitadas pela capacidade diária e estoque
disponível, e o dono recebe o valor da venda. A loja só vende o estoque que
tiver (começa em 0; pode ser abastecida por um armazém ligado). No histórico do
comércio, **Ver cálculo** detalha, por residência, renda e população, média
efetiva da área, demanda, benefício e posição de cada loja, estoque/capacidade
disponíveis, quanto foi comprado e se faltou estoque ou capacidade. Esse cálculo
é enviado ao dono em tempo real e salvo somente no armazenamento local do
navegador por até 30 dias; o navegador precisa estar conectado quando as vendas
do dia forem processadas. Se estiver offline, o cálculo daquele dia não será
salvo nesse navegador. Os detalhes antigos permanecem apenas até a retenção
atual do histórico removê-los e não são reconstruídos.
O painel também mostra funcionários atuais,
desejados e vagas; nas residências, as pessoas empregadas. Nos painéis de
construções produtivas, uma descrição antes
dos dados de funcionários resume os Work Points e os insumos usados por unidade
ou lote; lojas mostram a capacidade de venda e armazéns, o custo de transporte.

**Armazéns e logística:** no painel de uma construção concluída sua que aceite
armazém, use **Ligar a um armazém** e clique em um armazém seu, concluído, a até
60 tiles (ou **Desligar**). Às 00:00 a produção das construções ligadas vai para
o armazém até o **Estoque Máximo Desejável** e os 50 m³; compras entre
armazéns também respeitam esse máximo. O armazém abastece comércios e insumos
das construções ligadas sem depender de a ordem do produto ser Compra ou Venda,
preservando o **Estoque Mínimo Desejável**. Se o produto
disponível acima do mínimo não bastar para atender todos, as unidades são
repartidas proporcionalmente ao que falta em cada construção. O transporte
custa Work Points do armazém:
`100 × m³ + 0,125 × kg`; os pontos vêm dos funcionários do armazém e limites de
espaço ou Work Points podem impedir parte do transporte.
O painel do armazém mostra o estoque real e o espaço ocupado. A barra superior
mostra Madeira e Pedra dos armazéns próprios a até 60 tiles do centro da câmera;
os totais são atualizados ao explorar outra área e periodicamente.

**Influência:** o botão **Ver influência** no painel de qualquer construção
desenha no mapa o raio de 60 tiles dela.

**Comércio entre armazéns:** às 03:00 e 15:00 os armazéns com produtos em modo
**Compra** procuram, em até 60 tiles, armazéns de outros jogadores com o produto
em modo **Venda**. O vendedor oferece apenas o estoque acima do seu **Estoque
Mínimo Desejável**; o comprador aceita até o **Estoque Máximo Desejável** (ou
até a capacidade natural em m³ quando estiver em **MAX**). O comprador só compra
se o valor do vendedor for menor que seu limite. As ofertas mais baratas vêm
primeiro. O comprador gasta Work Points de transporte (cada rodada usa metade
dos pontos diários). O dono também pode usar **Procurar fornecedores** no
painel para executar uma tentativa imediata com as mesmas regras e limites.

**Demanda do armazém:** o painel do armazém mostra a demanda de Work Points do
último dia, a média do último mês (30 dias de jogo) e a previsão de pontos que
os funcionários atuais gerarão no próximo dia, para decidir se é preciso contratar.

**Fazenda de arroz:** o dono usa **Plantar arroz** no painel da fazenda concluída.
A colheita ocorre 6 meses (de calendário do jogo) depois e rende até 1.000
unidades. O mês do plantio define a produtividade (meses 1–3: 100 %, 4–6: 60 %,
7–9: 40 %, 10–12: 20 %). A fazenda precisa de 1.000 Work Points por dia; a
média diária de `min(1, pontos/1000)` durante o crescimento multiplica a
produção (800 pontos por dia = −20 %). **Replantar** durante o crescimento zera
o contador. Na colheita cada unidade custa 20 Work Points, limitados ao espaço
livre do estoque (300; ligar a um armazém libera espaço); só depois de colher tudo é possível plantar de novo.

**Consumo:** em residências concluídas, **Ver consumo da casa** mostra o consumo
por pessoa de arroz, peixe e leite no último dia e a média diária por pessoa nos últimos
30 dias, além do preço médio pago no dia e no mês. No painel da cidade, **Consumo**
mostra esses mesmos dados agregados para todos os cidadãos: as quantidades
compradas pelas residências da cidade são divididas pela população total, e os
preços médios são ponderados pelas unidades compradas.

Use **Produtos** na barra inferior para consultar os 32 produtos especificados,
com seus ícones, unidade de medida, peso, espaço ocupado e validade padrão.
Validades informadas em anos são convertidas para dias considerando 365 dias
por ano; produtos sem deterioração aparecem com validade infinita. A validade
também é usada para calcular a perda diária dos estoques às 18:00, conforme
descrito em **Validade e espaço de armazenamento**. Produtos cujos atributos
ainda não foram definidos não aparecem.

## Sobre o jogo

O mapa parte do projeto procedural
`tilescape_projeto_completo_4000x4000_seed583921`. Suas dimensões
(4.000 × 4.000), semente `583921`, escala de ruído, nível do mar e biomas foram
mantidos. O renderizador PixiJS adapta o detalhe ao nível de zoom. Arraste para
explorar, use a roda do mouse para aproximar e as setas do teclado (esquerda,
direita, cima e baixo) para mover o mapa; clique em um tile para consultar
suas coordenadas e bioma.

As regras de construções, produção, estoques, trabalho e compra regional estão
em `RegrasGerais.odt` na pasta do projeto. Esta primeira etapa estabelece o mapa
e a infraestrutura persistente em tempo real, com a assembleia municipal como
primeira estrutura fundamental e estradas de terra como primeira infraestrutura
urbana. As construções e transações habilitadas são descritas nas seções acima.

## Comandos do Master

A conta Master vê o botão **Master** na barra superior. O painel permite mudar a velocidade do mundo (1:15, 1:30, 1:60 ou 1:240; dias mais rápidos aceleram folha, Work Points e vendas), adicionar C$ à própria conta (de 1 a 1.000.000.000 por vez) e ver os jogadores online conectados.

## Histórico de produção

Fazendas, recursos e construções artesanais concluídas têm o botão **Histórico de produção**, com os últimos 30 dias: Work Points gerados, unidades produzidas, unidades enviadas ao armazém e eficiência (penalidade de Ferramentas ou, nas fazendas, a relação entre os Work Points do dia e os 1.000 necessários).

## Histórico do comércio

O dono de uma Loja de Arroz, Loja de Peixes ou Loja de Leite concluída pode abrir **Histórico do comércio** para consultar os últimos 30 dias por dia: gasto com funcionários, gasto com produtos efetivamente pagos, unidades vendidas, preço unitário de venda, receita e lucro/prejuízo. O abastecimento pelo armazém ligado do mesmo dono é uma transferência interna sem cobrança e aparece com gasto de produto C$ 0.

- **Histórico do armazém:** o botão Histórico do armazém mostra, por dia, os Work Points gerados e cada transporte tentado, quanto foi movido e o motivo quando não foi tudo (estoque máximo atingido, estoque mínimo preservado, sem espaço, Work Points insuficientes ou armazém sem estoque). Falhas internas são exibidas separadamente, com a etapa e a mensagem do erro.
- **Validade e espaço de armazenamento:** às 18:00 de cada dia do jogo, a perda esperada de cada produto perecível é `estoque atual / validade em dias`. A parte inteira é removida e a fração vira probabilidade de perder uma unidade adicional (por exemplo, 10 unidades com validade de 100 dias: 0,1 unidade/dia, ou 10% de chance de perder uma). Não há controle por lote ou data de entrada; produtos recém-adicionados seguem a mesma regra sobre o estoque agregado. A regra cobre os estoques principais de fazendas, comércios, construções artesanais e recursos, além dos produtos nos armazéns (indústrias). Produtos sem validade, como madeira, pedra, ferro e Ferramentas, não se deterioram. O espaço ocupado é atualizado ao abrir **Produtos e estoque** e reconsultado enquanto o armazém está selecionado.
