# Clipping Real Estate

App só para montar o clipping diário de real estate e mandar no WhatsApp.
Repositório e projeto na Vercel próprios, sem nada do Diagonal.

## Como funciona
- `api/noticias.js` — função da Vercel que busca as notícias de Metro Quadrado,
  Folha, Estadão, Valor Econômico, O Globo e Siila (RSS, sitemap, a página do
  site e, de reforço, o Google Notícias). Nos jornais gerais só entram manchetes
  do setor (imóveis, FGTS, construtora, incorporadora, shopping, galpões, FII…).
  Já separa em HOMEBUILDERS ou MALLS & PROPERTIES.
- `index.html` — a tela: marca as notícias com o check, toca em “Montar
  clipping”, ajusta a ordem e copia (ou abre direto no WhatsApp).
- Tudo que ela marca/edita fica salvo no próprio celular (localStorage).
  Notícias já enviadas aparecem apagadinhas por 10 dias.

## Colocar no ar (uma vez só)
1. vercel.com/new → importar `mariaeangela/clipping-re`.
2. Application Preset: **Other**. Root Directory: `./`. Deploy.
3. Abrir o endereço no celular → Compartilhar → “Adicionar à Tela de Início”.

## Ajustes comuns
- Faltou um jornal ou um link mudou: lista `FONTES` em `api/noticias.js`.
- O que é do setor: `TERMOS` (pontos por termo, montados a partir de ~1.100
  notícias que já saíram no clipping). O que vai para MALLS & PROPERTIES:
  `RE_MALLS`; incorporadoras sempre em HOMEBUILDERS: `RE_HOMEBUILDERS`.
- Patrocinados (Dino, Pressworks, Estúdio Folha…) entram com a etiqueta “Patrocinado”: `PATROCINADO`.
- Na tela, a lista padrão é “Novas desde o último clipping”; as de pontuação
  baixa ficam em “+ N menos prováveis”. O app aprende com cada envio: palavras
  das notícias escolhidas sobem, das que ficaram de fora descem.
- Na tela, “Diagnóstico das fontes” (no fim da lista) mostra quantas notícias
  vieram de cada jornal e qual endereço falhou.
