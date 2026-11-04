# Instruções para agentes

Estas instruções se aplicam a todo o repositório, inclusive ao aplicativo em
`tilescape_projeto_completo_4000x4000_seed583921/`.

## Antes de alterar o projeto

1. Leia este arquivo e [`ARCHITECTURE.md`](./ARCHITECTURE.md) no início de cada
   tarefa. Use a arquitetura como mapa inicial e confirme detalhes no código
   antes de tomar decisões.
2. Leia o `README.md` do aplicativo e os arquivos diretamente relacionados à
   tarefa. Não presuma que todos os componentes em `src/` fazem parte da
   experiência ativa: `src/main.tsx` monta `AuthGate` e `GameApp.tsx`;
   `src/App.tsx` é o editor procedural legado.
3. Faça mudanças cirúrgicas, respeite alterações locais existentes e não
   sobrescreva nem inclua arquivos não relacionados.

## Regras de arquitetura

- O aplicativo implantável está em `tilescape_projeto_completo_4000x4000_seed583921/`.
  Execute comandos de npm dentro dessa pasta.
- Antes de criar regras de jogo, procure e reutilize os helpers compartilhados
  em `src/types/`, especialmente a validação de posicionamento de cidades e
  estradas. A interface pode antecipar uma validação, mas o servidor deve
  repeti-la antes de persistir qualquer mudança.
- `src/utils/worldConfig.ts` é a configuração compartilhada do mapa. Preserve
  a geração determinística e os mesmos parâmetros no cliente e no servidor.
- O PostgreSQL é a fonte de verdade de cidades, estradas e relógio persistente.
  Mudanças de estado compartilhado devem ser validadas e gravadas no servidor,
  e depois publicadas para os demais clientes por Redis/WebSocket.
- O servidor valida o JWT do Neon Auth e verifica permissões de master no
  banco. Nunca confie em permissões ou validações exclusivamente da interface.
- O servidor aplica `database/schema.sql` na inicialização. Ao alterar o
  esquema, considere também bancos já existentes: `CREATE TABLE IF NOT EXISTS`
  não migra automaticamente colunas de tabelas existentes.
- Arquivos servidos pelo navegador devem estar em `public/` e ser referenciados
  por URL pública, não por caminho local da máquina de desenvolvimento.
- Não leia, registre, copie ou comite `.env`, `.env.local`, credenciais,
  tokens, connection strings privadas ou outros segredos. Não exponha os
  valores de variáveis de ambiente em logs ou documentação.

## Documentação e validação

- Mantenha `ARCHITECTURE.md` sincronizado quando mudar fluxos, limites de
  domínio, endpoints, persistência, sincronização, autenticação, dependências
  ou estrutura de pastas. Atualize este `AGENTS.md` quando mudarem as regras de
  trabalho para agentes.
- Atualize o `README.md` do aplicativo quando um comportamento ou instrução
  visível ao jogador/operador mudar.
- Execute, no mínimo, `npm.cmd run lint` e `npm.cmd run build` para mudanças no
  aplicativo. Faça também testes focados nas regras de domínio alteradas.
- O projeto não define um script de testes automatizados geral. Não declare
  testes não executados como aprovados; indique claramente limitações e avisos
  preexistentes.

## GitHub obrigatório

- Depois de cada mudança concluída a pedido do usuário, publique o resultado
  no GitHub: verifique a branch/remoto e sincronize com o remoto; faça commit
  apenas dos arquivos relacionados; envie a branch atualizada e confirme que
  `HEAD` e `origin` estão sincronizados.
- Esta regra também se aplica a alterações apenas em documentação.
- Preserve o trabalho existente. Não faça force-push, não reescreva commits e
  não use operações destrutivas para resolver conflitos. Se houver divergência,
  falha de autenticação ou outro bloqueio, pare e relate-o em vez de descartar
  ou sobrescrever mudanças.
- Revise o staging antes de cada commit. Nunca inclua segredos, artefatos
  gerados, dependências instaladas nem arquivos de usuário não relacionados.
- Use mensagens de commit descritivas e inclua o trailer de coautoria exigido
  pelas instruções de commit do ambiente.
