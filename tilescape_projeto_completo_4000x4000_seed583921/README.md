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

### Benefício associado das residências

Ao selecionar uma residência concluída, o painel mostra, logo abaixo de
**Salvar aluguel**, o benefício associado calculado com o aluguel, a média de
gastos dos últimos 30 dias e a renda média por morador. O painel também mostra
o apreço da empregabilidade (renda média por morador dividida pela média da
cidade), o apreço da região (média da empregabilidade das residências
concluídas da mesma cidade num raio de 10 tiles, incluindo a própria casa), o
apreço da construção e o apreço interno. O apreço interno é o maior valor
entre 10 e o produto do apreço da construção pelo apreço da região. Passe o
mouse sobre o benefício associado para consultar `Cb` (média de gastos),
`benefício erro` e `benefício ideal`, além da contribuição individual de cada
produto para o `Cb`. A média diária de cada produto considera a quantidade
consumida dividida por `30 × moradores registrados`. Os dados são calculados
no servidor a partir do histórico persistido da residência.
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
Cada tipo de construção de um jogador recebe numeração romana individual
(por exemplo, Loja de Arroz I e Loja de Arroz II). O nome aparece no painel de
detalhes. A etiqueta sobre a construção mostra o nome do jogador somente para
ele; a partir do zoom 3 (de 6), uma segunda etiqueta abaixo informa o tipo da
construção. Na aba **Contábil**, **Visualizar** fecha o painel, centraliza o
mapa na construção e abre seus detalhes.

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
essa conta pelo formulário do jogo para ativar a permissão. O botão **Contábil**
abre os relatórios das lojas comerciais, dos armazéns, das residências e da
produção do jogador conectado, incluindo todas as construções industriais e
artesanais produtivas. A lista de produção é ordenada alfabeticamente pelo nome
da construção. Ao selecionar uma categoria de construção na
barra inferior, o catálogo abre em um painel lateral à direita; escolha um
edifício no painel e clique no mapa para posicioná-lo.

No painel da Assembleia, todos os jogadores podem consultar o salário mínimo
diário da cidade. Somente a conta Master pode alterá-lo; ao aumentar o piso,
salários menores das construções existentes são reajustados automaticamente.
O servidor também impede que uma construção ofereça salário abaixo do mínimo
vigente na cidade. Em **Produtos e estoque** do armazém, passe o mouse sobre o
ícone de um produto para ver o peso unitário e total e o volume unitário e
ocupado pelo estoque.
O catálogo também inclui Areia (150 kg, 0,1 m³), Aço (800 kg, 0,1 m³),
Roupa (25 kg, 0,1 m³), Móveis (50 kg, 0,1 m³), Utilitários (5 kg, 0,01 m³)
e Vidro (300 kg, 0,1 m³); todos têm validade infinita.

A ordem dos cartões é definida por categoria: Comerciais lista primeiro as
lojas de arroz, trigo, cevada, batata e milho, depois Peixaria, Leitaria e
Açougue; em seguida lojas de açúcar, especiarias, vegetais e sal, Padaria,
Queijaria, Frutaria, Chocolateria, lojas de roupas e móveis, loja de utilitários
e Vidraçaria. Fazendas lista arroz, trigo, cevada,
batata, milho, leiteira, bovina, cana, vegetais, especiarias, cacau e frutas.
Fazenda de Ovelha e Fazenda de Algodão também aparecem em Fazendas.
Construções Artesanais lista Pesqueiro, Ferramentaria, Carvoaria, Casa de
Engenho, Fábrica de Pães e Fábrica de Queijo; Recursos inclui a Cava de Areia.
Indústrias lista Armazém, Silo,
Moinho, Fábrica de Chocolate, Usina de Aço, Fábrica de Fiação, Fábrica Têxtil,
Fábrica de Móveis, Fábrica de Utilitários e Fábrica de Vidros.

A conta Master pode clicar em uma construção para abrir seu painel como antes;
arrastá-la reposiciona a construção. Ela mantém seu estado, funcionários e
estoques; o novo local precisa
respeitar terreno, zona municipal, estradas e ocupação, e não pode deixar
armazéns ligados fora do raio permitido.

### Configuração editável do jogo

Os dados das 58 construções ficam em arquivos individuais
[`config/construcoes/`](./config/construcoes/), um JSON válido por arquivo
`.txt` nomeado pelo tipo interno (por exemplo, `farm_rice.txt`). É possível
ajustar dimensões, zona, estrada/água exigida, custo de Madeira/Pedra/Ferro/Aço, Work
Points de construção, funcionários, capacidade e estoques de produtos e
insumos, receitas, regras de produção e safras sazonais. Os parâmetros das
fórmulas residem em [`config/formulas/consumo.txt`](./config/formulas/consumo.txt),
[`trabalho.txt`](./config/formulas/trabalho.txt) e
[`transporte.txt`](./config/formulas/transporte.txt); as demandas por produto
continuam em [`config/demanda_basica.txt`](./config/demanda_basica.txt).

Edite somente valores, mantendo a sintaxe JSON, os nomes dos campos e os tipos
de construção existentes. Custos de obra podem incluir Madeira, Pedra, Ferro e
Aço. A estrutura das fórmulas e o comportamento especial
de cada tipo continuam no código; coeficientes, limites e dados podem ser
alterados nos arquivos. Para adicionar um tipo de construção ou uma nova regra
de comportamento, ainda é necessário alterar o código. O gerador valida as
configurações e cria o módulo compartilhado pelo cliente e servidor; se algum
arquivo estiver inválido, o comando falha em vez de iniciar com valores
alternativos.

As configurações não são recarregadas a quente. No desenvolvimento, reinicie
`npm.cmd run dev` após editar os arquivos; `predev` os valida e gera novamente
o módulo. No Render, publique a alteração para executar o build e aplicar os
valores juntos no cliente e no servidor. Os scripts `build`, `lint` e `test`
também validam e geram esse módulo automaticamente.

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
região precisa ficar dentro dos 303 × 303 tiles municipais. Regiões do mesmo
tipo podem se sobrepor entre si, mas uma área urbana e uma rural não podem
compartilhar tiles. Regiões urbanas aparecem em azul e rurais em verde durante
a edição; jogadores também veem somente a região relevante quando selecionam
uma categoria: Construções Artesanais, Comerciais e Residências usam áreas
urbanas; Fazendas, Recursos e Indústrias usam áreas rurais. Cada tile da
construção precisa estar coberto por pelo menos uma região do tipo exigido; a
construção pode atravessar várias áreas do mesmo tipo, desde que a união delas
cubra todo o footprint, inclusive tiles compartilhados pela interseção. A
definição das zonas é persistida e sincronizada em tempo real. Jogadores
autenticados podem iniciar construções em todas as seis categorias; os
requisitos de zona, terreno, estrada e espaço continuam sendo validados pelo
servidor. Residências e demais construções são descritas abaixo.
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

Cada jogador começa com **C$ 25.000**. O saldo aparece na barra superior, ao
lado do contador de viajantes. A carteira é criada no primeiro acesso após esta
atualização para contas sem carteira; saldos já existentes são preservados e a
carteira é guardada no servidor.
Preços, salários, aluguéis, negociações e saldos aceitam até duas casas
decimais (centavos), exibidas no padrão brasileiro; por exemplo, **C$ 1,23**
por litro de leite.

### Residências

Na categoria **Residências**, selecione uma das três casas para ver no cursor
uma prévia verde/vermelha. Cada tile da casa precisa estar coberto por uma ou
mais áreas urbanas da cidade; o footprint pode atravessar regiões urbanas
vizinhas. Também precisa ficar em terra, sem ocupar outra construção ou estrada
e ao lado de uma estrada. Clique para iniciar a obra:

| Residência | Tamanho | Capacidade | Apreço da construção | Custo | Trabalho necessário |
| --- | --- | --- | --- | --- | --- |
| Simples 1 | 2 × 2 tiles | 4 pessoas | 50 | 100 madeiras, 30 pedras | 18.000 Work Points |
| Simples 2 | 3 × 3 tiles | 32 pessoas | 40 | 300 madeiras, 450 pedras | 67.500 Work Points |
| Simples 3 | 4 × 4 tiles | 128 pessoas | 30 | 1.200 madeiras, 2.000 pedras | 300.000 Work Points |

Todos os jogadores podem iniciar construções das seis categorias. Para jogadores
que não são Master, o custo de Madeira, Pedra e, quando indicado, Ferro é
descontado dos armazéns concluídos do próprio jogador a até 60 tiles do centro
da construção; o servidor exige os materiais e faz a cobrança atomicamente ao
iniciar a obra. Se o
custo não estiver disponível, a construção não é iniciada. Cada jogador pode
construir um primeiro **Armazém** gratuito, que fica pronto imediatamente; esse
direito permanece registrado mesmo se o armazém for demolido. As demais
construções aparecem com o ícone **Em construção** e avançam com os Work Points
dos funcionários; a conta Master mantém a permissão de iniciar sem materiais e
concluí-las instantaneamente com duplo clique. A capacidade limita os moradores
de cada residência; o apreço local desempata a ordem de ocupação quando os
aluguéis são iguais. Nenhum deles altera estoques de produtos.
Para demolir uma residência, ative **Demolir** e clique em qualquer tile dela.
Não há confirmação; somente o jogador que iniciou a construção pode removê-la.

A barra lateral com dados do mundo foi removida. Clique em uma residência (fora
dos modos de construção e demolição) para abrir o painel lateral: residências
concluídas mostram ocupantes, capacidade, técnica, saúde, felicidade, empregados
e renda média por morador (calculada a partir dos empregos já alocados: soma dos
salários dos empregos dos moradores ÷ ocupantes); obras mostram Work Points, empregados
e permitem ao dono editar o salário ofertado (C$ por dia de trabalho) e a carga
horária por dia (4 a 14 h). O dono também define o aluguel por pessoa (mínimo
C$ 0,01, com até duas casas decimais) da residência. Todo dia às 00:00 do reino,
cidades com menos de 1.000 habitantes recebem 40 imigrantes, que ocupam as
residências concluídas mais baratas com vaga (empate: maior apreço). A população
da cidade é a soma dos ocupantes das suas residências. Todo dia às 00:00 do
relógio do jogo, o aluguel por pessoa é multiplicado pelos moradores e creditado
ao dono da residência. No dia 7 de cada mês, às 03:00, moradores também podem
mudar entre residências concluídas da mesma cidade. A comparação usa o custo
médio mensal da casa (consumo médio dos últimos 30 dias, valorizado pelo preço
médio pago de cada produto, mais aluguel), a renda média diária por morador e o
apreço local. A mudança só ocorre quando o benefício associado da residência de
destino é maior; a quantidade é limitada pelas vagas e pelos moradores da casa
de origem. Cada mudança é registrada no histórico do servidor. Como moradores
são NPCs sem carteira individual, não há débito separado. Clique em outro ponto
do mapa ou em × para fechar.

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

O **Silo** também fica em Indústrias. Tem 4 × 4 tiles, até 100 funcionários,
capacidade de 400 m³ e custa 300 madeiras, 60 pedras e 20.000 Work Points.
Só pode armazenar Trigo, Cevada, Batata, Milho, Arroz, Especiarias, Cacau, Cana,
Azeitona, Uva, Fumo, Algodão e Lã; transferências e compras/vendas respeitam essa lista.
Assim como o Armazém, ao clicar nele é possível abrir **Produtos e estoque** e
configurar os produtos permitidos.

Uma construção produtora ou comercial pode ser ligada a vários armazéns e
silos concluídos do mesmo dono, dentro de 60 tiles. No painel da construção,
a lista **Armazéns e silos ligados** mostra os depósitos conectados. O dono pode
adicionar outro ao escolher **Ligar a outro armazém ou silo** e clicar nele no
mapa, ou remover individualmente um vínculo com **Desligar**. A rotina diária
considera o estoque já movimentado entre depósitos, evitando enviar ou abastecer
mais que o necessário.

O **Moinho** fica na categoria Indústrias; a **Fábrica de Pães** e a
**Fábrica de Queijo** ficam em Construções Artesanais. O Moinho (3 × 3, 60 funcionários) custa 100 madeiras,
40 pedras e 40 ferros, exige 110.000 Work Points e guarda até 100 farinhas. Seu dono escolhe no
painel lateral da construção concluída se o insumo será trigo, cevada ou milho;
somente a matéria-prima escolhida é recebida do armazém ligado, até 20 unidades.
Trocar a seleção descarta o
estoque restante da matéria-prima anterior. Cada unidade de grão e 300 Work
Points produz 5 farinhas. A Fábrica de Pães (3 × 3, 60 funcionários) custa 180
madeiras, 120 pedras e 60 ferros, exige 480.000 Work Points e guarda 30 farinhas e 300 pães;
cada farinha e 200 Work Points produz 10 pães. Ela guarda até 60 Ferramentas e a
demanda é 0,25 Ferramenta por funcionário/dia, com a penalidade por falta.
A Fábrica de Queijo (3 × 3, 200
funcionários) custa 360 madeiras, 240 pedras e 120 ferros, exige 960.000 Work Points e guarda
2.000 litros de leite, 133 unidades de sal e 100 queijos; 15 litros de leite,
1 unidade de sal e 200 Work Points produzem 1 queijo. Ela guarda até 200
Ferramentas e demanda 0,25 Ferramenta por funcionário/dia, com a penalidade
por falta. Os três edifícios recebem seus insumos pelo armazém ligado e enviam a
produção ao armazém. A **Fábrica de Chocolate** (4 × 4, 40 funcionários) custa
180 madeiras, 120 pedras e 60 ferros, exige 480.000 Work Points e guarda 50 chocolates, 5
cacaus, 130 litros de leite, 10 açúcares, 100 carvões e 200 Ferramentas. A cada
400 Work Points produz 1 chocolate: consome 2 carvões, 2 leites e 4 Ferramentas;
há 10% de chance proporcional de consumir 1 cacau, 20% de consumir 1 açúcar e
60% de consumir 1 leite extra por unidade. Frações de produção e consumo são
arredondadas como probabilidades.

As **Fazendas de Ovelha e de Algodão** ocupam 4 × 4, empregam até 10 pessoas,
custam 60 madeiras/20 pedras e exigem 130.000 Work Points. A primeira guarda
100 lãs; a segunda, 300 algodões. Ambas completam um ciclo em 12 meses e
oferecem as mesmas opções de automatização de plantio e colheita das outras
fazendas. A fazenda de ovelha produz até 100 lãs, com 500 Work Points diários e
50 por unidade colhida; a eficiência de plantio é 20%, 100%, 80% e 100% por
trimestre. A de algodão produz até 300 unidades, com 1.000 Work Points diários
e 100 por unidade colhida; sua eficiência trimestral é 40%, 80%, 100% e 60%.

A **Cava de Areia** (4 × 4, 30 funcionários) é um recurso rural que custa
60 madeiras/30 pedras, exige 240.000 Work Points, guarda 10 areias e produz
1 unidade a cada 600 Work Points. A **Usina de Aço** (5 × 5, 40 funcionários)
custa 1.000 madeiras, 600 pedras e 400 ferros, exige 20.000.000 Work Points,
guarda 30 aços e recebe até 60 ferros e 300 carvões. Cada 400 Work Points,
2 ferros e 10 carvões produzem 1 aço.

As novas indústrias ocupam 5 × 5, empregam até 40 pessoas e exigem Ferramentas
(estoque máximo 80; demanda de 2 por funcionário/dia, com penalidade por falta).
A **Fábrica de Fiação** custa 800 madeiras, 500 pedras, 300 ferros e 100 aços,
exige 7.000.000 Work Points e, a cada 300 Work Points, 1 algodão, 1 lã e 4
carvões produzem 2 linhas. A **Fábrica Têxtil** custa 1.000 madeiras, 600
pedras, 400 ferros e 100 aços, exige 10.000.000 Work Points e transforma 1
linha e 2 carvões em 2 roupas a cada 400 Work Points. A **Fábrica de Móveis**
tem o mesmo custo e Work Points da Têxtil; cada 400 Work Points e 1 madeira
produzem 1 móvel. A **Fábrica de Utilitários** custa 2.000 madeiras, 1.200
pedras, 800 ferros e 300 aços; cada 400 Work Points, 1 aço e 5 carvões
produzem 8 utilitários. A **Fábrica de Vidros** tem o mesmo custo e Work Points;
cada 400 Work Points, 10 areias e 20 carvões produzem 8 vidros. As fábricas
recebem insumos e ferramentas do armazém ligado e enviam a produção para ele.

### Comércio

Na categoria **Comerciais**, a **Loja de Arroz** (2 × 2 tiles, até 1 funcionário,
estoque máximo de 5 unidades de arroz) custa 10 madeiras e 5 pedras e exige
5.000 Work Points. Cada tile deve estar coberto por uma ou mais áreas urbanas,
ao lado de uma estrada e sem sobrepor outras construções. O fluxo (prévia, obra,
demolição, painel lateral com raio de busca de 60 tiles) é o mesmo das fazendas.
As vendas usam arroz entregue pelo armazém ligado e o preço configurado pelo
dono.

As **Lojas de Batata, Milho, Cevada e Trigo** seguem os mesmos limites de
funcionários, estoque e custo da Loja de Arroz. Cada uma vende o respectivo
produto com capacidade de 1 unidade por 25 Work Points. O **Açougue** também
emprega até 1 funcionário e guarda 5 unidades; cada unidade vendida exige 25
Work Points, e a construção custa 15 madeiras, 10 pedras e 5.000 Work Points.
A **Peixaria** emprega até 2 pessoas, guarda 5 peixes e usa 50 Work Points por
unidade; custa 15 madeiras, 10 pedras e 5.000 Work Points. A **Leitaria**
emprega 1 pessoa, guarda 120 litros e usa 1 Work Point por litro; custa 10
madeiras, 5 pedras e 5.000 Work Points.

As lojas de **Açúcar** e **Especiarias** empregam até 4 pessoas, guardam 5
unidades e usam 125 Work Points por unidade. As lojas de **Vegetais** e **Sal**
também empregam até 4 pessoas, guardam 25 unidades e usam 20 Work Points por
unidade. Todas custam 60 madeiras, 40 pedras e 70.000 Work Points.

A **Padaria** (2 × 2, até 8 funcionários, estoque máximo de 350 pães), a
**Queijaria** (até 8 funcionários, 35 queijos), a **Frutaria** (até 8
funcionários, 6 frutas) e a **Chocolateria** (até 8 funcionários, 20
chocolates) custam 180 madeiras, 120 pedras e 60 ferros e exigem 480.000 Work
Points cada. A capacidade de venda considera os Work Points gerados por seus
funcionários: respectivamente 3, 26, 160 e 54 Work Points por unidade.
Todas recebem estoque do armazém ligado e permitem definir o preço.

As novas **Lojas de Roupas, Móveis e Utilitários** e a **Vidraçaria** ocupam
2 × 2, empregam até 12 pessoas, guardam 5 unidades do produto vendido e custam
40 madeiras/20 pedras e 15.000 Work Points. Cada venda usa 300 Work Points.
Seus estoques são abastecidos pelo armazém ligado, e esses quatro produtos
participam da cesta básica de bens.

Ao terminar a construção de um comércio, o preço inicial deixa de ser sempre
C$ 10: primeiro é usada a média dos preços atuais de comércios concluídos do
mesmo tipo pertencentes ao jogador. Se ele ainda não tiver um comércio desse
tipo, usa-se a média desse tipo na cidade, considerando todos os jogadores.
Somente quando não houver nenhum comércio similar concluído na cidade o preço
inicial será C$ 10. O dono pode alterar esse preço depois no painel.

O botão **Simular venda**, abaixo do preço, estima vendas e resultado com o
histórico de comportamento guardado no navegador, o preço informado, estoque e
funcionários atuais; não consulta o servidor. Sem histórico local, a interface
avisa que ainda é cedo para simular. **Simular contratação**, abaixo do salário,
calcula localmente a estimativa de empregados usando as construções e moradores
recebidos no mapa e os valores digitados no formulário.

### Pesqueiro e Peixaria

Na categoria **Construções Artesanais**, o **Pesqueiro** (2 × 2 tiles, até 40
funcionários, estoque máximo de 300 peixes e 10 Ferramentas) custa 50 madeiras e
15 pedras e exige 25.000 Work Points. Deve ficar em área urbana, ao lado de uma
estrada e com pelo menos um tile sobre a água (o resto pode ser terra). Produz
diariamente (00:00) 1 peixe a cada 100 Work Points. Consome Ferramentas: 0,05 por
funcionário/dia (valores abaixo de 1 são probabilidade). Sem Ferramentas, a
eficiência cai 30% e a penalidade sobe 10% por dia até 90%; ao suprir, ela cai 10%
por dia até zerar. Ferramentas (5 kg, 0,01 m³, sem validade) chegam por armazém
ligado.

Na categoria **Comerciais**, a **Peixaria** (2 × 2, 2 funcionários, estoque
máximo de 5 peixes) custa 15 madeiras e 10 pedras e exige 5.000 Work Points. As
vendas e o consumo das residências seguem a mesma fórmula do arroz; o consumo de
peixe aparece em "Ver consumo da casa".

### Fazenda leiteira e Leitaria

Na categoria **Fazendas**, a **Fazenda leiteira** (3 × 3 tiles, até 10
funcionários, estoque máximo de 400 litros) custa 50 madeiras e 15 pedras e
exige 25.000 Work Points. Ela produz 1 litro a cada 5 Work Points efetivos; sua
eficiência é de 40% nos meses 1–3, 100% nos meses 4–6, 80% nos meses 7–9 e
60% nos meses 10–12. O leite produzido segue para o armazém ligado.

Na categoria **Comerciais**, a **Leitaria** ocupa 2 × 2 tiles, emprega até 1
pessoa, guarda 120 litros, custa 10 madeiras e 5 pedras e exige 5.000 Work
Points para construir. Seu preço padrão é C$ 10 e pode ser alterado pelo dono.
A loja recebe leite do armazém
ligado e vende às residências pelo mesmo cálculo de demanda e benefício usado
para os demais produtos.

As **Lojas de Açúcar, Vegetais, Sal e Especiarias** ocupam 2 × 2 tiles e seguem
os limites e custos definidos na seção Comércio. Cada loja recebe seu produto
do armazém ligado e vende por preço definido pelo dono.

O consumo diário desejável por morador das **cestas básica, intermediária,
avançada e básica de bens**
pode ser ajustado em [`config/demanda_basica.txt`](./config/demanda_basica.txt).
Na cesta básica: 0,03 de arroz, trigo, cevada, milho, batata, peixe e carne
vermelha; e 1 litro de leite. Na cesta intermediária: 0,01 de açúcar, 0,05 de
vegetais, 0,04 de sal e 0,01 de especiarias. Na cesta avançada: 1 pão, 0,1 queijo,
0,02 frutas e 0,025 chocolate. Na cesta básica de bens, roupas, móveis,
utilitários e vidros têm demanda de 0,01 cada por pessoa/dia. O servidor lê o
arquivo ao iniciar; reinicie o serviço depois de alterá-lo.

O preço médio de cada produto é ponderado pelas vendas do período definido em
`config/formulas/consumo.txt` (30 dias por padrão) ou,
na ausência de vendas, pela média dos preços anunciados na cidade. `RR` é a soma
de necessidade diária × preço médio dos produtos básicos com preço disponível;
`RR2` é a mesma soma para os produtos intermediários e `RR3` para os avançados.

As compras básicas usam a fórmula existente com `RR`: `Pf = preço local ×
necessidade`, `w = (1 − Pf/RR)^4`, `q = (0,8^w − 1) × Rf`, benefício de erro
`Dᵢ × ((Rf − Pf − q)/RR)^4` quando `Rf ≥ Pf` e benefício ideal
`(Rf/RR − 0,125/RR)^4`. Para os produtos intermediários, usa-se
`w = (1 − Pf/(RR + RR2))^3` e o mesmo cálculo de `q`. O benefício de erro é
`Dᵢ × ((Rf − Pf − q)/(RR + RR2))^3` somente quando `Rf > Pf + 1` e
`Rf > RR/6 + RR2/3`; caso contrário, é zero. O benefício ideal é
`((Rf − 1/6)/(RR + RR2) − 1/110)^3`. Em ambas as cestas, o benefício associado
continua sendo `(benefício de erro / benefício ideal)^4`. Para a cesta avançada,
usa-se `w = (1 − Pf/(RR + RR2 + RR3))^2` e o mesmo `q`; o benefício de erro é
`Dᵢ × ((Rf − Pf − q)/(RR + RR2 + RR3))^2` quando `Rf > Pf + 4` e
`Rf > RR/6 + RR2/3 + RR3/4`, caso contrário é zero. O benefício ideal é
`((Rf − 1/6)/(RR + RR2 + RR3) − 1/180)^2`. O benefício associado permanece
`(benefício de erro / benefício ideal)^4`. `Rf` é a renda média
por morador e `Dᵢ = √(60/(60 + distância))`. A demanda efetiva ainda depende da
distribuição de moradores entre lojas, estoque e capacidade de venda. A cesta
básica de bens usa `RR_total = RR + RR2 + RR3`,
`w = (1 − Pf/RR_total)^3` e `q = (0,8^w − 1) × Rf`. Seu benefício de erro é
zero quando `Rf ≤ RR_total/2`; acima disso, é
`Dᵢ × ((Rf − Pf − q)/RR_total)^3`. O benefício ideal é
`(Rf/RR_total − 1/(6 × RR_total) + 1/16)^3` e o associado é
`(benefício de erro / benefício ideal)^6`.
As necessidades e os parâmetros dessas fórmulas, inclusive as eficiências
usadas no benefício do trabalho e os Work Points por distância, estão nos
arquivos de configuração indicados acima. O transporte usa
`quantidade × (Work Points por m³ × volume + Work Points por kg × peso)` e um
raio configurável para ligações e transferências.

### Recursos e Ferramentaria

Na categoria **Recursos** (área rural, ao lado de estrada):

| Construção | Tam. | Func. | Estoque máx. | Custo | Work Points | Produção diária |
|---|---|---|---|---|---|---|
| Madeireira | 2 × 2 | 10 | 30 madeiras, 5 Ferramentas | 20 madeira, 5 pedra | 35.000 | 1 madeira / 1000 WP |
| Pedreira | 2 × 2 | 30 | 10 pedras, 5 Ferramentas | 60 madeira, 20 pedra | 120.000 | 1 pedra / 3000 WP |
| Mina de Ferro | 3 × 3 | 30 | 5 ferro, 5 Ferramentas | 60 madeira, 20 pedra | 120.000 | 1 ferro / 3000 WP |
| Coleta de Sal | 2 × 2 | 40 | 100 sal, 5 Ferramentas | 100 madeira, 40 pedra, 40 ferro | 10.000 | 1 sal / 400 WP efetivos; fração é chance diária |

Abaixo do mínimo de WP, a fração vira probabilidade de produzir 1 unidade. A
demanda de Ferramentas é 0,05 por funcionário/dia (0,15 na Mina) com a mesma
penalidade do Pesqueiro, que reduz os WP efetivos. A Coleta de Sal deve ficar ao
lado de uma estrada e de um tile de água; ela ocupa somente terra. Como o mapa
ainda não diferencia rios de outros tiles aquáticos, qualquer água adjacente é
aceita.

Na categoria **Artesanais** (área urbana, ao lado de estrada), a **Ferramentaria**
(2 × 2, 30 funcionários, estoque máx. 100 Ferramentas, 30 carvões e 5 ferro)
custa 60 madeiras e 20 pedras e exige 120.000 Work Points. Por dia, cada lote de
1.000 WP + 5 carvões + 1 ferro produz 100 Ferramentas. Carvão e ferro chegam pelo
armazém ligado.

Na mesma categoria **Artesanais**, a **Casa de Engenho** (3 × 3, até 60
funcionários) custa 100 madeiras, 40 pedras e 40 ferros e exige 60.000 Work Points.
Armazena até 200 unidades de açúcar, 400 de cana, 30 de carvão e 5 Ferramentas.
Cada lote de 600 Work Points efetivos, 3 carvões e 6 canas produz 1 açúcar. A
demanda de Ferramentas é 0,05 por funcionário/dia, com a mesma penalidade de eficiência do
Pesqueiro. Cana, carvão e Ferramentas são recebidos pelo armazém ligado; a cana
armazenada na construção também está sujeita à validade de 3 dias.

A **Carvoaria** (3 × 3, até 20 funcionários) custa 60 madeiras e 20 pedras e
exige 120.000 Work Points. Armazena até 100 carvões, 40 Ferramentas e 30 madeiras
(limite de madeira adotado como nas outras oficinas). Cada 200 Work Points
efetivos e 1 madeira produzem 5 carvões. Ferramentas e madeira são recebidas
pelo armazém ligado; a demanda de Ferramentas é 0,5 por funcionário/dia e
segue a penalidade do Pesqueiro. O carvão pesa 5 kg, ocupa 0,015 m³ e tem
validade infinita.

### Fazendas

Na categoria **Fazendas**, as fazendas de arroz, batata, trigo, cevada e milho
têm 4 × 4 tiles, até 30 funcionários, estoque máximo de 300 unidades, custo de
100 madeiras e 40 pedras e exigem 30.000 Work Points. A Fazenda Bovina também
ocupa 4 × 4 e emprega até 30; custa 250 madeiras e 75 pedras e exige 125.000
Work Points. Cada tile deve
estar coberto por uma ou mais áreas rurais, sem sobrepor estradas ou construções,
e ao lado de uma estrada. Toda obra e fazenda concluída têm um raio de 60 tiles
para procurar trabalhadores (exibido no painel; veja "Empregos e salários"). O
funcionamento é o mesmo das residências (prévia, obra, demolição e painel
lateral), mas sem moradores nem aluguel.

| Fazenda | Produto | Eficiência pelo mês de plantio (1–3 / 4–6 / 7–9 / 10–12) | Crescimento | Work Points por dia / por unidade colhida | Rendimento máximo |
|---|---|---|---:|---:|---:|
| Arroz | Arroz | 100 % / 60 % / 40 % / 20 % | 6 meses | 1.000 / 20 | 1.000 |
| Batata | Batata | 50 % / 100 % / 20 % / 80 % | 6 meses | 1.000 / 20 | 1.000 |
| Trigo | Trigo | 40 % / 50 % / 60 % / 100 % | 6 meses | 1.000 / 20 | 1.000 |
| Cevada | Cevada | 30 % / 70 % / 100 % / 60 % | 6 meses | 1.000 / 20 | 1.000 |
| Milho | Milho | 80 % / 100 % / 10 % / 10 % | 6 meses | 1.000 / 20 | 1.000 |
| Bovina | Carne vermelha | 40 % / 100 % / 80 % / 60 % | 24 meses | 500 / 40 | 4.000 |
| Cana | Cana | 90 % / 80 % / 100 % / 90 % | 6 meses | 100 / 25 | 2.000 |
| Especiarias | Especiarias | 100 % / 60 % / 60 % / 60 % | 6 meses | 5.000 / 10 | 600 |
| Vegetais | Vegetais | 20 % / 40 % / 100 % / 80 % | 2 meses | 5.000 / 10 | 1.000 |
| Frutas | Fruta | 100 % / 80 % / 60 % / 40 % | 12 meses | 5.000 / 20 | 1.000 |
| Cacau | Cacau | 100 % / 90 % / 70 % / 50 % | 12 meses | 2.000 / 62 | 400 |

O mês em que o plantio começa define a eficiência sazonal do ciclo. A média diária
de `min(1, Work Points / requisito diário)` durante o crescimento também reduz
proporcionalmente o rendimento. O botão do painel inicia ou reinicia o ciclo;
durante a colheita (ou corte, na fazenda bovina), cada unidade exige os Work
Points indicados e a produção é limitada ao estoque livre. A carne vermelha tem
validade de 30 dias. A Fazenda de Cana e a Fazenda de Especiarias ocupam 3 × 3
e empregam até 10 e 50 funcionários, respectivamente. Cana custa 100 madeiras,
40 pedras e 40 ferros, com 10.000 Work Points; especiarias custa 200 madeiras,
80 pedras e 80 ferros, com 320.000 Work Points. Seus estoques máximos são 2.000 canas e 400
especiarias; o excedente da colheita aguarda no campo até haver espaço livre.
A Fazenda de Vegetais também ocupa 3 × 3, emprega até 50 funcionários, custa
100 madeiras, 40 pedras e 40 ferros, exige 110.000 Work Points e guarda até 100 vegetais.
Nas fazendas com ciclo de cultivo ou criação, **Configurações avançadas** permite
automatizar o replantio: selecione os meses permitidos e quantos funcionários
deseja durante o crescimento e durante a colheita. A automação não interrompe um
ciclo ativo; quando a fazenda ficar livre, ela aguarda um dos meses selecionados
para iniciar outro. Na Fazenda Bovina, os meses selecionados controlam o início
de um novo ciclo de criação, com trabalhadores configurados separadamente para
criação e abate. É possível desativá-la no mesmo painel. Sem automação, o
proprietário continua iniciando os ciclos manualmente.

### Empregos e salários

Em obras, fazendas, comércios e indústrias o dono define **funcionários
desejados**, **salário por dia** e **carga horária** (4 a 14 h). Durante a obra,
é possível definir até 100 funcionários, independentemente do limite final do
edifício; ao concluir, o número desejado e os empregados são reduzidos ao máximo
definitivo da construção (por exemplo, 1 na Leitaria). Em construções
concluídas vale o limite do catálogo. Todo dia às 12:00 (horário do mundo), cada
residência considera todas as ofertas com vagas a até 60 tiles. O benefício de
cada oferta é `vagas × bônus × F_H² × (salário diário ÷ horas) × fator_distância`, com
`F_H = 1 − 0,5·(|H−8|/6)²` e `fator_distância = √(60 / (60 + d))`, onde `d` é a
distância entre os centros da residência e do trabalho. O bônus depende das
vagas abertas: ×5 (1–4), ×3 (5–10), ×2 (11–20), ×1 (21–40), ×0,9 (41–100),
×0,8 (101–300) e ×0,7 (mais de 300). Os moradores são
repartidos entre os postos proporcionalmente a esses benefícios. O arredondamento
inteiro pelo método dos maiores restos mantém a soma igual ao número de moradores
que podem ser contratados; se uma oferta atingir suas vagas, o excedente é
redistribuído entre as demais. As vagas restantes são atualizadas antes de
processar a próxima residência. A ordem das residências é pelo apreço interno,
do maior para o menor; em caso de empate, usa-se o ID para manter o resultado
determinístico. O apreço interno segue a regra dos apreços residenciais e é
recalculado antes da alocação, considerando a média salarial da cidade ponderada
pelos moradores e a média regional de residências concluídas em até 10 tiles,
inclusive residências desocupadas. A prévia de contratação usa a mesma ordem.
Às 00:00 o dono paga o
salário de cada funcionário (o dinheiro some e o caixa pode ficar negativo). Também
às 00:00 cada funcionário de uma obra gera
`12,5 × horas × saúde/100 × felicidade/100 × fator de descanso` Work Points (fator
1,2 com 4 h, 1 com 8 h, 0,8 com 14 h); a obra termina sozinha ao atingir o total
necessário. Saúde e felicidade ainda são fixas em 100.

Nas lojas de arroz, batata, milho, cevada, trigo, peixe, leite, açúcar, vegetais,
sal, especiarias e no Açougue, o dono define o preço (a partir de C$ 0,01, com
até duas casas decimais). Às 00:00, a capacidade de venda considera os Work
Points gerados pelos funcionários no dia: arroz/batata/milho/cevada/trigo e
carne vermelha usam 25 WP/unidade; peixe, 50; açúcar/especiarias, 125;
vegetais/sal, 20; e leite, 1 WP/litro. Padaria, Queijaria, Frutaria e
Chocolateria usam, respectivamente, 3, 26, 160 e 54 WP por unidade. Para cada
produto, as residências consideram lojas do
produto em até 60 tiles. O custo de referência `RR` é o custo diário por pessoa
da cesta básica e `RR2`, o da cesta intermediária. Ambos usam preços médios
ponderados pelas unidades vendidas nos últimos 30 dias. Produtos sem vendas no
período usam a média dos preços atuais anunciados na cidade; produtos sem loja
na cidade são omitidos do custo da cesta correspondente.

Para cada residência e loja, `Pf` é o preço local multiplicado pela necessidade
diária por pessoa, e `Rf` é a renda média por morador. As fórmulas de benefício
e a distinção entre produtos básicos e intermediários estão descritas acima.
`Dᵢ = √(60 / (60 + dᵢ))`, onde `dᵢ` é a distância entre a residência e a loja.
Para cada produto, os moradores são divididos entre as lojas elegíveis em até
60 tiles, proporcionalmente ao benefício associado. O arredondamento pelo
método dos maiores restos mantém o número de moradores inteiro e igual à
população da residência quando existe benefício positivo. Se o custo de
referência da cesta aplicável (`RR` ou `RR + RR2`) for zero, ou todas as lojas
tiverem benefício zero, não há compra. A quantidade desejada em cada loja é
moradores alocados × necessidade diária por pessoa × benefício associado e pode
superar a necessidade diária. Frações de unidade são arredondadas
aleatoriamente, preservando a quantidade esperada ao longo do tempo. Estoque e
capacidade limitam as vendas; moradores alocados a uma loja sem unidades
disponíveis não são realocados para outra. O dono recebe o valor das vendas;
moradores não são cobrados.

A loja vende somente o estoque que tiver (começa em 0; pode ser abastecida por
um armazém ligado). No histórico do comércio, **Ver cálculo** mostra `RR` e
`RR2` e a composição por produto de cada cesta: necessidade diária por morador,
preço médio usado, subtotal, origem do preço (vendas ponderadas ou média dos
anúncios), unidades vendidas e receita no período; itens sem preço disponível
aparecem fora do custo de referência correspondente. Também mostra preço médio
do produto, `Pf`, `w`, `q`, benefícios de
erro/ideal/associado, participação e número de moradores alocados, demanda,
estoque/capacidade e resultado. Os subtotais da cesta são exibidos com maior
precisão, sem arredondamento intermediário. O cálculo é enviado ao dono em
tempo real e salvo somente no
armazenamento local do navegador por até 30 dias; o navegador precisa estar
conectado quando as vendas forem processadas. Se estiver offline, o cálculo
daquele dia não será salvo nesse navegador.
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
mostra Madeira, Pedra, Ferro e Aço dos armazéns próprios a até 60 tiles do centro
da câmera; os totais são atualizados ao explorar outra área e periodicamente.

**Transferência manual:** no painel **Produtos e estoque** de um armazém seu,
clique em **Transferir** na linha do produto, selecione outra construção sua
concluída a até 60 tiles e informe a quantidade. A transferência usa os Work
Points diários ainda disponíveis no armazém e preserva o **Estoque Mínimo
Desejável** da origem. O destino precisa armazenar aquele produto; o limite da
quantidade considera sua capacidade própria ou, para outro armazém, o **Estoque
Máximo Desejável** e o espaço livre em m³. Madeira e Ferramentas, por exemplo,
podem ser enviadas diretamente aos estoques de insumos de construções que as
utilizam. Se ocorrer uma falha técnica, a mensagem informa a etapa e um código
de diagnóstico; envie esse código ao administrador para localizar o erro
correspondente nos logs do servidor.

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

**Fazendas agrícolas:** o dono inicia ou reinicia manualmente o ciclo no painel
da fazenda concluída; a automação segue a configuração avançada descrita acima.
O crescimento dura 6 meses (2 meses para vegetais), exceto a fazenda
bovina, que leva 24 meses até o corte. A eficiência sazonal, o requisito de Work Points diários e o
custo de colheita/corte são mostrados no painel e detalhados na tabela acima.
O rendimento é ajustado pela média de `min(1, Work Points / requisito diário)`
durante o crescimento. Na colheita ou corte, cada unidade consome os Work Points
indicados, limitada ao estoque livre (300; ligar a um armazém libera espaço).
Durante a colheita, a fazenda não inicia outro ciclo; a automação espera a
colheita terminar e um mês selecionado para replantar.
A **Fazenda de Frutas** e a **Fazenda de Cacau** ocupam 4 × 4 tiles, empregam
até 50 funcionários e levam 12 meses para crescer. A Fazenda de Frutas custa
360 madeiras, 240 pedras e 120 ferros e exige 960.000 Work Points. A Fazenda de
Cacau custa 180 madeiras, 120 pedras e 60 ferros e exige 480.000 Work Points.
A Fazenda de Frutas exige
5.000 Work Points/dia, colhe até 1.000 unidades a 20 Work Points por unidade
e tem eficiência sazonal de 100%, 80%, 60% e 40%. A Fazenda de Cacau exige
2.000 Work Points/dia, colhe até 400 unidades a 62 Work Points por unidade
e tem eficiência sazonal de 100%, 90%, 70% e 50%. Ambas armazenam a colheita
no próprio estoque e transferem o excedente para o armazém ligado.

**Consumo:** em residências concluídas, **Ver consumo da casa** mostra o consumo
por pessoa de todos os produtos das cestas básica (arroz, trigo, cevada, milho,
batata, peixe, carne vermelha e leite), intermediária (açúcar, vegetais, sal e
especiarias) e avançada (pão, queijo, frutas e chocolate) no
último dia e a média diária por pessoa nos últimos 30 dias, além do preço médio
pago no dia e no mês. No painel da cidade, **Consumo**
mostra esses mesmos dados agregados para todos os cidadãos: as quantidades
compradas pelas residências da cidade são divididas pela população total, e os
preços médios são ponderados pelas unidades compradas.

Use **Produtos** na barra inferior para consultar os 35 produtos especificados,
com seus ícones, unidade de medida, peso, espaço ocupado e validade padrão.
Validades informadas em anos são convertidas para dias considerando 365 dias
por ano; produtos sem deterioração aparecem com validade infinita. Carne vermelha
tem validade de 30 dias; farinha pesa 5 kg, ocupa 0,01 m³ e dura 1 ano. A validade
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

A conta Master vê o botão **Master** na barra superior. O painel permite mudar a velocidade do mundo (1:15, 1:30, 1:60 ou 1:240; dias mais rápidos aceleram folha, Work Points e vendas), adicionar C$ à própria conta (de C$ 0,01 a C$ 1.000.000.000 por vez) e ver os jogadores online conectados.

## Histórico de produção

Fazendas, recursos e construções artesanais concluídas têm o botão **Histórico de produção**, com os últimos 30 dias: Work Points gerados, unidades produzidas, unidades enviadas ao armazém e eficiência (penalidade de Ferramentas ou, nas fazendas, a relação entre os Work Points do dia e os 1.000 necessários).

## Histórico do comércio

O dono de qualquer loja de alimentos concluída — arroz, batata, milho, cevada,
trigo, peixe, leite ou Açougue — pode abrir **Histórico do comércio** para
consultar os últimos 30 dias por dia: gasto com funcionários, gasto com produtos
efetivamente pagos, unidades vendidas, preço unitário de venda, receita e
lucro/prejuízo. O abastecimento pelo armazém ligado do mesmo dono é uma
transferência interna sem cobrança e aparece com gasto de produto C$ 0.

## Contábil

O botão **Contábil** na barra inferior tem uma aba **Resumo** e quatro abas
detalhadas. O resumo permite consultar a semana atual ou qualquer uma das quatro
semanas anteriores. O lucro/prejuízo inclui receitas das lojas, aluguéis e
vendas de armazéns, menos compras de armazéns, despesas de produtos e salários.
Também mostra o número atual de funcionários empregados e os valores estimados
da empresa e do estoque. A empresa é avaliada pelo custo de materiais de cada
construção aos preços médios atuais de venda configurados nos armazéns; o estoque
usa os mesmos preços e inclui armazéns, produtos principais e insumos das
construções. Produtos sem preço anunciado ficam fora do valor estimado.
**Lojas comerciais**
lista todas as lojas do jogador e soma salários pagos e receita de vendas no
período selecionado (último dia ou últimos 7 ou 30 dias); **Visualizar** centraliza a loja no mapa e abre seus
detalhes. **Armazéns** mostra os armazéns do jogador (também com **Visualizar**),
salários pagos e, por produto,
quantidades e valores comprados/vendidos, além do resultado bruto (receita de
vendas menos custo de compras). O resultado por produto não desconta salários.
**Residências** lista moradores, capacidade e aluguel efetivamente gerado para
cada casa no período selecionado, com o mesmo atalho **Visualizar**. **Produção**
lista fazendas, pesqueiros, recursos e oficinas, seus salários e unidades
produzidas no período selecionado. O histórico de aluguel começa com esta atualização;
salários de construções não comerciais anteriores a ela não podem ser
reconstruídos. O histórico financeiro de armazéns começa com esta atualização;
transações anteriores não podem ser reconstruídas.

- **Histórico do armazém:** o botão Histórico do armazém mostra, por dia, os Work Points gerados e cada transporte tentado, quanto foi movido e o motivo quando não foi tudo (estoque máximo atingido, estoque mínimo preservado, sem espaço, Work Points insuficientes ou armazém sem estoque). Falhas internas são exibidas separadamente, com a etapa e a mensagem do erro.
- **Validade e espaço de armazenamento:** às 18:00 de cada dia do jogo, a perda esperada de cada produto perecível é `estoque atual / validade em dias`. A parte inteira é removida e a fração vira probabilidade de perder uma unidade adicional (por exemplo, 10 unidades com validade de 100 dias: 0,1 unidade/dia, ou 10% de chance de perder uma). Não há controle por lote ou data de entrada; produtos recém-adicionados seguem a mesma regra sobre o estoque agregado. A regra cobre os estoques principais de fazendas, comércios, construções artesanais e recursos, além dos produtos nos armazéns (indústrias). Produtos sem validade, como madeira, pedra, ferro e Ferramentas, não se deterioram. O espaço ocupado é atualizado ao abrir **Produtos e estoque** e reconsultado enquanto o armazém está selecionado.

## Logs do processamento diário

O botão **Log**, na barra superior, mostra as medições mais recentes do
processamento do mundo: alocação de empregos, folha e aluguel, vendas,
produção, fazendas, transporte, imigração e publicação. Cada registro inclui
duração total, tempo acumulado das consultas ao PostgreSQL (inclui o tempo de
resposta), espera por lock, quantidade de consultas, contagens de residências,
locais de trabalho, lojas e armazéns, além do estado da etapa. **Fora do banco**
é uma estimativa que também pode incluir esperas que não são consultas.

Os registros são compartilhados entre instâncias pelo Redis e ficam limitados
aos 100 mais recentes, com expiração após sete dias. A rota é acessível somente
a usuários autenticados. As medições aparecem quando cada etapa é executada;
use **Atualizar** no painel para consultar os registros novamente.
