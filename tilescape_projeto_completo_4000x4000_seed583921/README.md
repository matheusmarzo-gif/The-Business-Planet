# Valdora — Crônicas de um Reino

Primeira etapa do jogo de simulação medieval: mapa mundial compartilhado,
navegável no navegador, relógio contínuo e presença online.

## Publicar online com GitHub, Render e Neon

Esta opção não exige instalar o Docker Desktop no computador. O GitHub guarda o
código e aciona a publicação no Render; o Render executa o servidor do jogo; e
o Neon hospeda o PostgreSQL.

O jogo também usa **Redis** para controlar a presença dos jogadores e
distribuir atualizações em tempo real. Portanto, além do banco Neon, crie um
serviço compatível com Redis, por exemplo o **Key Value** do Render.

### 1. Enviar o projeto ao GitHub

Crie um repositório no GitHub e envie para ele os arquivos desta pasta. Se o
repositório contiver esta pasta dentro de outra, configure a pasta do projeto
como diretório raiz (`Root Directory`) no Render.

Não envie senhas, URLs privadas de banco de dados ou arquivos `.env` ao GitHub.

### 2. Criar o banco no Neon

1. Crie um projeto em [Neon](https://console.neon.tech/).
2. Copie a connection string do PostgreSQL. Prefira a string com pooling
   disponibilizada pelo Neon e mantenha `sslmode=require` nela.
3. Guarde essa URL para configurar a variável `DATABASE_URL` no Render.

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

4. Em **Environment Variables**, adicione:

   | Nome | Valor |
   | --- | --- |
   | `DATABASE_URL` | Connection string do Neon |
   | `REDIS_URL` | URL de conexão do Key Value |

   O Render fornece a variável `PORT` para o servidor; não é necessário
   defini-la manualmente. Cadastre as URLs privadas somente nas configurações
   do serviço, nunca no código ou no GitHub.

5. Publique o serviço. O Render fornecerá um endereço público; abra-o para
   acessar o jogo.

Para verificar a conexão com PostgreSQL e Redis, abra
`https://<endereco-do-servico>/api/health`. A resposta esperada é
`{"status":"ok"}`. O serviço também aceita WebSockets no caminho `/ws`, usados
para atualizar o estado do mundo e a presença online.

Cada push para a branch conectada ao Render pode iniciar uma nova publicação.
O relógio global e sua persistência ficam no PostgreSQL; o Redis gerencia a
presença e a distribuição das atualizações em tempo real.

## Executar localmente (opcional)

Para desenvolvimento local, o Docker Compose inicia PostgreSQL e Redis. Se
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

Abra **http://localhost:3000** no navegador. Mantenha o terminal aberto enquanto
estiver jogando; `Ctrl+C` encerra o jogo. Confira o servidor em
**http://localhost:3000/api/health**; a resposta esperada é `{"status":"ok"}`.

Para parar os contêineres, use `docker compose stop`; para iniciá-los novamente,
use `docker compose up -d`. `docker compose down` remove os contêineres, mas
preserva os dados. **Não use `docker compose down -v` para parar o jogo:** essa
opção apaga os volumes, incluindo o banco e o estado persistente do mundo.

## Sobre o jogo

O mapa parte do projeto procedural
`tilescape_projeto_completo_4000x4000_seed583921`. Suas dimensões
(4.000 × 4.000), semente `583921`, escala de ruído, nível do mar e biomas foram
mantidos. O renderizador PixiJS adapta o detalhe ao nível de zoom. Arraste para
explorar, use a roda do mouse para aproximar e clique em um tile para consultar
suas coordenadas e bioma.

As regras de construções, produção, estoques, trabalho e compra regional estão
em `RegrasGerais.odt` na pasta do projeto. Esta primeira etapa estabelece o mapa
e a infraestrutura persistente em tempo real, sem ainda habilitar construções
ou transações econômicas.
