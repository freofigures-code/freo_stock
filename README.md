# FreoStock AI — PWA

App pessoal para controlar produção 3D, estoque real, filamentos e vendas da Shopee.

## O que esta versão faz

- Roda como site estático.
- Pode ser publicada no GitHub Pages.
- Pode ser instalada no celular como PWA.
- Salva dados no navegador usando `localStorage`.
- Permite backup/exportação em JSON.
- Calcula recomendação de produção usando:
  - vendas recentes;
  - estoque real interno;
  - filamento disponível;
  - gramas por unidade;
  - perda de produção;
  - estoque mínimo desejado.
- Ignora o estoque anunciado na Shopee no cálculo de produção.
- Usa o estoque anunciado da Shopee apenas como alerta operacional.

## Como testar localmente

Você pode abrir o `index.html` direto no navegador.

Para testar o PWA/service worker corretamente, rode um servidor local:

```bash
python -m http.server 8000
```

Depois abra:

```text
http://localhost:8000
```

## Como publicar no GitHub Pages

### Opção simples

1. Crie um repositório no GitHub.
2. Envie todos os arquivos deste projeto para a raiz do repositório.
3. Vá em **Settings → Pages**.
4. Em **Build and deployment**, escolha **Deploy from a branch**.
5. Selecione a branch `main` e a pasta `/root`.
6. Salve.

O site ficará disponível no endereço do GitHub Pages do repositório.

### Opção com GitHub Actions

Este projeto já inclui o arquivo:

```text
.github/workflows/deploy.yml
```

Se preferir usar Actions, em **Settings → Pages**, escolha **GitHub Actions**.

## Próxima fase: Supabase

Esta versão ainda não tem banco online. Os dados ficam no navegador.

Para acessar com a mesma conta no celular e no PC, a próxima fase deve adicionar:

- Supabase Auth para login;
- Supabase PostgreSQL para salvar produtos, vendas, filamentos e recomendações;
- Row Level Security para separar seus dados por usuário;
- Supabase Edge Functions ou backend para conectar Shopee/OpenAI com segurança.

## Atenção sobre chaves de API

Não coloque chave secreta da Shopee ou da OpenAI diretamente no frontend.

Fluxo correto:

```text
PWA → Supabase Edge Function/backend → Shopee/OpenAI
```

O arquivo `config/api-placeholders.example.js` existe apenas como referência para a próxima fase.
