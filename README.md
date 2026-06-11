# FreoStock AI PWA + Supabase

App PWA estático para GitHub Pages, agora conectado ao Supabase para login e banco online.

## O que esta versão faz

- Login com e-mail e senha via Supabase Auth
- Produtos salvos no Supabase
- Estoque real salvo no Supabase
- Filamentos salvos no Supabase
- Receitas de produção salvas no Supabase
- Vendas manuais/simuladas salvas no Supabase
- Recomendação de produção calculada no app e salva em `recomendacoes`
- PWA instalável no celular

## Antes de publicar

1. No Supabase, execute o SQL inicial das tabelas.
2. Se você já executou o SQL antigo que foi enviado antes, execute também o arquivo:

```sql
supabase-patch.sql
```

Esse patch adiciona campos usados pela versão conectada:

- `produtos.margem_estimada`
- `configuracoes.dias_cobertura_desejada`
- `configuracoes.maximo_lote_recomendado`

## Configuração Supabase

O arquivo com a configuração pública está em:

```text
config/supabase-config.js
```

Ele usa:

- Project URL
- Anon public key

Não coloque `service_role`, chave da Shopee ou chave da OpenAI nesse arquivo.

## Como publicar no GitHub Pages

1. Copie todos os arquivos desta pasta para a raiz do seu repositório.
2. Faça commit e push.
3. No GitHub, vá em `Settings > Pages`.
4. Use GitHub Actions ou deploy pela branch.
5. Abra o link gerado pelo GitHub Pages.

## Importante

Se o navegador estiver mostrando a versão antiga, faça hard refresh:

- Windows: `Ctrl + F5`
- Celular: feche e abra de novo, ou remova/reinstale o PWA

## Próxima fase

A Shopee deve ser conectada por uma Supabase Edge Function, não diretamente pelo navegador.

Fluxo correto:

```text
PWA -> Supabase Auth/Banco -> Edge Function -> Shopee API
```


## Atualização de precificação

Esta versão adiciona a lógica da planilha de custos ao app: preço do rolo/kg do filamento, custo de energia, embalagem, custos fixos, falhas, markup, taxa Shopee e preço sugerido de venda.

Antes de publicar, execute `supabase-patch.sql` no SQL Editor do Supabase.


## Correção v4-loginfix
- Corrige o carregamento do JavaScript que impedia o clique em Entrar quando o arquivo app.js era publicado com escapeHtml quebrado.
- Bump no cache do service worker para `freostock-ai-pwa-v4-loginfix`.
- Adiciona `?v=4-loginfix` nos arquivos para evitar cache antigo no GitHub Pages/PWA.
