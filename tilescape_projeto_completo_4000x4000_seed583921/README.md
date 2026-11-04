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
Fazendas, Residências, Indústrias e Prefeitura. A Prefeitura aparece somente
para a conta Neon Auth configurada em `MASTER_EMAIL`. Cadastre o mesmo e-mail
nas variáveis locais e no Render; crie essa conta pelo formulário do jogo para
ativar a permissão.

A primeira estrutura da Prefeitura é a **Assembleia**. Escolha-a no catálogo,
informe o nome da cidade e clique no mapa para selecionar o centro. A
Assembleia ocupa 3 × 3 tiles, e sua área municipal ocupa 303 × 303 tiles.
Áreas municipais não podem se sobrepor nem ultrapassar os limites do mapa.
Clique na Assembleia para consultar os dados da cidade; a conta master também
pode editar o nome. População, bem-estar e economia começam em zero.
Use **Demolir** na barra inferior e clique em uma construção para removê-la.
O servidor só permite que o jogador que criou a construção a demola; ao
demolir uma Assembleia, sua cidade e área municipal também são removidas.

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
primeira estrutura fundamental. As outras construções e transações econômicas
ainda não estão habilitadas.
