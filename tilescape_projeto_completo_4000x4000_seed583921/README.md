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
presença e a distribuição das atualizações em tempo real.

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
Comerciais, Fazendas, Residências, Recursos, Indústrias e Prefeitura. A Prefeitura aparece somente
para a conta Neon Auth configurada em `MASTER_EMAIL`. Cadastre o mesmo e-mail
nas variáveis locais e no Render; crie essa conta pelo formulário do jogo para
ativar a permissão.

A primeira estrutura da Prefeitura é a **Assembleia**. Escolha-a no catálogo,
informe o nome da cidade e mova o cursor pelo mapa para ver uma prévia: verde
indica um local válido e vermelho indica água, outra construção ou uma área
municipal incompatível. Clique para selecionar o centro. A Assembleia ocupa
3 × 3 tiles e só pode ser colocada inteiramente em terra; sua área municipal
ocupa 303 × 303 tiles. Áreas municipais não podem se sobrepor nem ultrapassar
os limites do mapa, e o servidor valida essas regras antes de salvar.
Clique na Assembleia para consultar os dados da cidade; a conta master também
pode editar o nome. O rótulo da cidade mantém tamanho legível mesmo ao mudar o
zoom. População, bem-estar e economia começam em zero.
Na janela da Assembleia, a conta master pode abrir **Configurar áreas urbanas
e rurais** e arrastar no mapa para desenhar vários retângulos por tipo. Cada
região precisa ficar dentro dos 303 × 303 tiles municipais e as áreas não
podem se sobrepor. Regiões urbanas aparecem em azul e rurais em verde durante
a edição; jogadores também veem somente a região relevante quando selecionam
uma categoria: Construções Artesanais, Comerciais e Residências usam áreas
urbanas; Fazendas, Recursos e Indústrias usam áreas rurais. A definição das
zonas é persistida e sincronizada em tempo real. O posicionamento de edifícios
das demais categorias ainda não está habilitado. Residências são descritas
abaixo.
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

O estoque e o sistema de Work Points ainda não estão implementados. Por isso,
jogadores comuns recebem uma mensagem de indisponibilidade por falta de estoque;
a conta Master pode iniciar a construção sem materiais. A obra aparece com o
ícone **Em construção** e não avança automaticamente. A conta Master pode
concluí-la instantaneamente com duplo clique no ícone da obra. Capacidade,
apreço e custo são dados informativos; ainda não alteram população ou estoque.
Para demolir uma residência, ative **Demolir** e clique em qualquer tile dela.
Não há confirmação; somente o jogador que iniciou a construção pode removê-la.

A barra lateral com dados do mundo foi removida. Clique em uma residência (fora
dos modos de construção e demolição) para abrir o painel lateral: residências
concluídas mostram ocupantes, capacidade, técnica, saúde, felicidade, empregados
e renda média (valores fixos por enquanto); obras mostram Work Points, empregados
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
exige 20.000 Work Points. Deve ficar em área rural, ao lado de uma estrada. Ao
clicar em um armazém concluído, use **Produtos e estoque** no painel lateral
para abrir a lista de todos os produtos com o estoque atual e, para cada um, o
estoque desejável, o valor e se é de venda ou de compra (somente o dono edita;
cada linha tem seu botão **Salvar**). O estoque atual ainda é 0, pois o sistema
de estoque não existe.

### Comércio

Na categoria **Comerciais**, a **Loja de Arroz** (2 × 2 tiles, até 4 funcionários,
estoque máximo de 20 unidades de arroz) custa 100 madeiras e 20 pedras e exige
9.000 Work Points. Deve ficar inteira em área urbana, ao lado de uma estrada e
sem sobrepor outras construções. O fluxo (prévia, obra, demolição, painel
lateral com raio de busca de 60 tiles) é o mesmo das fazendas; venda e estoque
ainda não estão implementados.

### Fazendas

Na categoria **Fazendas**, a **Fazenda de arroz** (4 × 4 tiles, até 30 funcionários,
estoque máximo de 300 unidades de arroz) custa 200 madeiras e 20 pedras e exige
12.000 Work Points. Ela só pode ser construída inteiramente em área rural, sem
sobrepor estradas ou construções e precisa ficar ao lado de uma estrada. Toda obra
e a fazenda concluída terão uma área de 60 tiles de raio para procurar
trabalhadores (exibida no painel; veja "Empregos e salários"). O
funcionamento é o mesmo das residências (prévia, obra, demolição e painel
lateral), mas sem moradores nem aluguel; produção e estoque ainda não existem.

### Empregos e salários

Em obras, fazendas, comércios e indústrias o dono define **funcionários
desejados** (0 até o máximo da construção; padrão 0), **salário por dia** e
**carga horária** (4 a 14 h). Todo dia às 12:00 (horário do mundo) os moradores
são distribuídos: cada construção com vagas tem um *benefício*
`vagas × F_H² × salário / carga horária`, com `F_H = 1 − 0,5·(|H−8|/6)²`, e as
residências empregam seus moradores (dentro de 60 tiles) do maior benefício para
o menor, atualizando as vagas a cada preenchimento. Às 00:00 o dono paga o
salário de cada funcionário (o dinheiro some e o caixa pode ficar negativo). O
painel mostra funcionários atuais, desejados e vagas; nas residências, as
pessoas empregadas.

Use **Produtos** na barra inferior para consultar os 32 produtos especificados,
com seus ícones, unidade de medida, peso, espaço ocupado e validade padrão.
Validades informadas em anos são convertidas para dias considerando 365 dias
por ano; produtos sem deterioração aparecem com validade infinita. Por enquanto,
o catálogo é informativo: estoques e perda diária às 6h ainda não estão
habilitados. Produtos cujos atributos ainda não foram definidos não aparecem.

## Sobre o jogo

O mapa parte do projeto procedural
`tilescape_projeto_completo_4000x4000_seed583921`. Suas dimensões
(4.000 × 4.000), semente `583921`, escala de ruído, nível do mar e biomas foram
mantidos. O renderizador PixiJS adapta o detalhe ao nível de zoom. Arraste para
explorar, use a roda do mouse para aproximar e clique em um tile para consultar
suas coordenadas e bioma.

As regras de construções, produção, estoques, trabalho e compra regional estão
em `RegrasGerais.odt` na pasta do projeto. Esta primeira etapa estabelece o mapa
e a infraestrutura persistente em tempo real, com a assembleia municipal como
primeira estrutura fundamental e estradas de terra como primeira infraestrutura
urbana. As demais construções e transações econômicas ainda não estão habilitadas.
