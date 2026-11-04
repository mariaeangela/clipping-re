// Função serverless da Vercel: junta as últimas notícias de real estate dos
// jornais que entram no clipping e devolve tudo num JSON só.
//
//   GET /api/noticias            -> { geradoEm, itens:[...], fontes:{...} }
//   GET /api/noticias?dias=3     -> janela maior (padrão: 2 dias)
//
// Cada jornal tem uma lista de "jeitos" de ler as notícias (RSS, sitemap de
// notícias, a própria página HTML e, por último, a busca do Google Notícias).
// Se um jeito falhar (site fora do ar, endereço mudou), os outros continuam —
// o app nunca fica em branco por causa de um site só.
//
// Jornais especializados (Metro Quadrado, Siila) entram inteiros; nos jornais
// gerais (Folha, Estadão, Valor, O Globo) só entram as manchetes que batem com
// as palavras do setor (imóveis, FGTS, incorporadora, shopping...).

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const TIMEOUT_MS = 8000;

// Palavras do setor. Comparação sem acento e em minúsculas, por palavra inteira
// (o "*" no fim aceita continuação: "imove*" pega imóvel, imóveis...).
const PALAVRAS = [
  'imove*', 'imobiliari*', 'fgts', 'construtora*', 'incorporador*', 'incorporac*',
  'shopping*', 'mall*', 'minha casa minha vida', 'mcmv', 'aluguel', 'alugue*', 'locac*',
  'galpao', 'galpoes', 'logistico*', 'lajes corporativas', 'escritorios', 'coworking',
  'fundo imobiliario', 'fundos imobiliarios', 'fii', 'fiis', 'loteament*', 'condominio*',
  'residencia*', 'habitac*', 'moradia*', 'retrofit', 'metro quadrado', 'm2', 'm²',
  'credito imobiliario', 'financiamento imobiliario', 'sbpe', 'construcao civil',
  'terreno*', 'plano diretor', 'zoneamento', 'verticaliz*', 'apartamento*', 'cri',
  'cyrela', 'mrv', 'cury', 'direcional', 'tenda', 'eztec', 'gafisa', 'moura dubeux', 'lavvi',
  'mitre', 'trisul', 'helbor', 'melnick', 'plano&plano', 'plano e plano', 'jhsf', 'tecnisa',
  'even construtora', 'pdg', 'rni', 'vitacon', 'multiplan', 'iguatemi', 'allos', 'aliansce',
  'brmalls', 'xp malls', 'hsi', 'log cp', 'log commercial', 'glp', 'prologis', 'syn', 'cbre',
  'jll', 'brookfield', 'patria', 'kinea', 'secovi', 'abrainc', 'cbic', 'abrasce',
];

const RE_PALAVRAS = new RegExp(
  '(^|[^a-z0-9])(' + PALAVRAS.map(p => {
    const base = semAcento(p).replace(/[.*+?^${}()|[\]\\]/g, m => (m === '*' ? m : '\\' + m));
    return base.endsWith('*') ? base.slice(0, -1) + '[a-z]*' : base;
  }).join('|') + ')(?![a-z0-9])'
);

// Palavras que puxam a notícia pra MALLS & PROPERTIES (o resto vai pra HOMEBUILDERS).
const RE_MALLS = new RegExp('(^|[^a-z0-9])(' + [
  'shopping[a-z]*', 'malls?', 'galpo(es)?', 'galpao', 'logistic[a-z]*', 'escritorios?',
  'lajes? corporativ[a-z]*', 'coworking', 'fundos? imobiliarios?', 'fiis?', 'varejo',
  'multiplan', 'iguatemi', 'allos', 'aliansce', 'brmalls', 'xp malls', 'hsi', 'log cp',
  'glp', 'prologis', 'syn', 'brookfield', 'kinea', 'abrasce', 'faria lima', 'corporativ[a-z]*',
  'hote(l|is|leiro)', 'data ?centers?', 'lojas?', 'centros? comerci[a-z]*', 'kaml11',
].join('|') + ')(?![a-z0-9])');

// Fontes. `especializado: true` = tudo é do setor (não passa pelo filtro de palavras).
const FONTES = [
  {
    id: 'metroquadrado', nome: 'Metro Quadrado', dominio: 'metroquadrado.com', especializado: true,
    rss: ['https://metroquadrado.com/feed', 'https://metroquadrado.com/rss', 'https://metroquadrado.com/rss.xml', 'https://metroquadrado.com/feed.xml'],
    sitemap: ['https://metroquadrado.com/sitemap-news.xml', 'https://metroquadrado.com/news-sitemap.xml'],
    html: ['https://metroquadrado.com/', 'https://metroquadrado.com/residencial', 'https://metroquadrado.com/comercial', 'https://metroquadrado.com/cidades'],
    linkOk: /^https?:\/\/(www\.)?metroquadrado\.com\/[a-z0-9-]+\/[a-z0-9-]{12,}\/?$/i,
  },
  {
    id: 'siila', nome: 'Siila', dominio: 'siila.com.br', especializado: true,
    rss: ['https://siila.com.br/feed', 'https://siila.com.br/noticias/rss', 'https://siila.com.br/rss'],
    sitemap: ['https://siila.com.br/sitemap-news.xml'],
    html: ['https://siila.com.br/noticias', 'https://siila.com.br/'],
    linkOk: /^https?:\/\/(www\.)?siila\.com\.br\/noticias\/[a-z0-9-]+\/\d+\/?$/i,
    // Os links da Siila terminam num número crescente: dá pra ordenar sem data.
    ordem: url => Number((url.match(/\/(\d+)\/?$/) || [])[1]) || 0,
  },
  {
    id: 'folha', nome: 'Folha', dominio: 'folha.uol.com.br',
    rss: [
      'https://feeds.folha.uol.com.br/mercado/rss091.xml',
      'https://feeds.folha.uol.com.br/emcimadahora/rss091.xml',
      'https://feeds.folha.uol.com.br/cotidiano/rss091.xml',
      'https://c-level.folha.uol.com.br/feed/',
    ],
  },
  {
    id: 'estadao', nome: 'Estadão', dominio: 'estadao.com.br',
    rss: [
      'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/economia/',
      'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/economia/negocios/',
      'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/sao-paulo/',
      'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/e-investidor/',
      'https://einvestidor.estadao.com.br/feed/',
    ],
  },
  {
    id: 'valor', nome: 'Valor Econômico', dominio: 'valor.globo.com',
    rss: [
      'https://pox.globo.com/rss/valor/',
      'https://valor.globo.com/rss/valor/',
      'https://pox.globo.com/rss/valor/empresas/',
      'https://pox.globo.com/rss/valor/financas/',
    ],
  },
  {
    id: 'oglobo', nome: 'O Globo', dominio: 'oglobo.globo.com',
    rss: [
      'https://oglobo.globo.com/rss/oglobo',
      'https://oglobo.globo.com/rss/economia/',
      'https://pox.globo.com/rss/oglobo/economia/',
      'https://pox.globo.com/rss/oglobo/rio/',
    ],
  },
];

// Busca de reforço no Google Notícias (pega o que os RSS gerais deixam passar).
// Os links do Google são de redirecionamento; só entram se o jornal não
// trouxer a mesma manchete com o link original.
const BUSCA_GOOGLE = '(imóveis OR imobiliário OR FGTS OR construtora OR incorporadora OR shopping OR galpões OR "fundo imobiliário")';

// ----------------------------------------------------------------- utilidades

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&hellip;/g, '…')
    .replace(/&lsquo;/g, '‘').replace(/&rsquo;/g, '’').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/&amp;/g, '&');
}

function limpaTexto(s) {
  const semCdata = String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // Duas passadas: alguns feeds mandam o HTML do resumo "escapado" (&lt;p&gt;).
  return decodeEntities(decodeEntities(semCdata.replace(/<[^>]+>/g, ' ')).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tag(bloco, nome) {
  const m = bloco.match(new RegExp('<' + nome + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + nome + '>', 'i'));
  return m ? m[1] : '';
}

function ehDoSetor(titulo, resumo) {
  return RE_PALAVRAS.test(semAcento(titulo + ' ' + (resumo || '')));
}

function categoria(titulo, url, resumo) {
  const t = semAcento(titulo + ' ' + (resumo || ''));
  if (/metroquadrado\.com\/comercial\//.test(url)) return 'malls';
  if (/siila\.com\.br/.test(url)) return RE_MALLS.test(t) || !/residenc|incorpora|construtora|imovel|imoveis/.test(t) ? 'malls' : 'homebuilders';
  return RE_MALLS.test(t) ? 'malls' : 'homebuilders';
}

function data(s) {
  if (!s) return null;
  const d = new Date(decodeEntities(s).trim());
  return isNaN(d) ? null : d.toISOString();
}

function urlLimpa(u) {
  try {
    const x = new URL(decodeEntities(u).trim());
    for (const k of [...x.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(k)) x.searchParams.delete(k);
    x.hash = '';
    return x.toString();
  } catch { return ''; }
}

function chaveTitulo(t) {
  return semAcento(t).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

async function baixa(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9' },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    // A Folha (e outros) ainda mandam em ISO-8859-1: decodifica pelo charset certo.
    const bytes = Buffer.from(await r.arrayBuffer());
    const cabeca = bytes.subarray(0, 400).toString('latin1');
    const charset = ((r.headers.get('content-type') || '').match(/charset=([\w-]+)/i) || cabeca.match(/encoding=["']([\w-]+)["']/i) || cabeca.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
    try { return new TextDecoder(charset.toLowerCase()).decode(bytes); } catch { return bytes.toString('utf8'); }
  } finally {
    clearTimeout(timer);
  }
}

// ----------------------------------------------------------------- leitores

// RSS 2.0 e Atom.
function lerFeed(xml) {
  const itens = [];
  const blocos = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocos) {
    let link = limpaTexto(tag(b, 'link'));
    if (!link) {
      const m = b.match(/<link[^>]*href="([^"]+)"/i);
      link = m ? m[1] : '';
    }
    if (!link) link = limpaTexto(tag(b, 'guid'));
    const fonte = b.match(/<source[^>]*url="([^"]+)"[^>]*>([\s\S]*?)<\/source>/i);
    itens.push({
      titulo: limpaTexto(tag(b, 'title')),
      url: urlLimpa(link),
      data: data(tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'published') || tag(b, 'updated')),
      resumo: limpaTexto(tag(b, 'description') || tag(b, 'summary')).slice(0, 300),
      fonteUrl: fonte ? fonte[1] : '',
      fonteNome: fonte ? limpaTexto(fonte[2]) : '',
    });
  }
  return itens.filter(i => i.titulo && i.url);
}

// Sitemap de notícias do Google (<url><loc>…<news:title>…).
function lerSitemap(xml) {
  const itens = [];
  for (const b of xml.match(/<url>[\s\S]*?<\/url>/gi) || []) {
    const titulo = limpaTexto(tag(b, 'news:title'));
    const url = urlLimpa(limpaTexto(tag(b, 'loc')));
    if (titulo && url) itens.push({ titulo, url, data: data(tag(b, 'news:publication_date') || tag(b, 'lastmod')), resumo: '' });
  }
  return itens;
}

// Página HTML: pega os <a> que apontam pra matérias (pelo formato do link) e
// usa o texto do link (ou o title/aria-label) como manchete.
function lerHtml(html, base, linkOk) {
  const itens = [];
  const vistos = new Map();
  const re = /<a\b([^>]*?)href\s*=\s*["']([^"'#]+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    let url;
    try { url = urlLimpa(new URL(decodeEntities(m[2]), base).toString()); } catch { continue; }
    if (!linkOk.test(url)) continue;
    const attrs = m[1] + ' ' + m[3];
    const extra = (attrs.match(/(?:title|aria-label)\s*=\s*["']([^"']+)["']/i) || [])[1];
    // Dentro do link costuma vir também categoria/data; fica com o maior trecho (a manchete).
    const pedacos = m[4].split(/<\/?(?:h\d|p|span|div|strong|small|time|br)\b[^>]*>/i).map(limpaTexto).filter(Boolean);
    let titulo = pedacos.sort((a, b) => b.length - a.length)[0] || limpaTexto(extra);
    if (!titulo || titulo.length < 20) titulo = limpaTexto(extra) || titulo;
    if (!titulo || titulo.length < 20) continue;
    const dt = (m[4].match(/datetime\s*=\s*["']([^"']+)["']/i) || [])[1];
    const anterior = vistos.get(url);
    if (anterior && anterior.titulo.length >= titulo.length) continue;
    vistos.set(url, { titulo, url, data: data(dt), resumo: '' });
  }
  for (const v of vistos.values()) itens.push(v);
  return itens;
}

// Último recurso quando a página não tem <a> legível (site montado em JS):
// procura URLs de matéria soltas no código e tira a manchete do próprio endereço.
function lerUrlsSoltas(html, base, linkOk) {
  const itens = [];
  const vistos = new Set();
  const re = /(https?:\/\/[^\s"'<>\\]+|\/[a-z0-9-]+\/[a-z0-9-]{12,}(?:\/\d+)?)/gi;
  let m;
  while ((m = re.exec(html))) {
    let url;
    try { url = urlLimpa(new URL(m[1], base).toString()); } catch { continue; }
    if (!linkOk.test(url) || vistos.has(url)) continue;
    vistos.add(url);
    const slug = url.replace(/\/\d+\/?$/, '').replace(/\/$/, '').split('/').pop();
    const titulo = slug.replace(/-/g, ' ');
    itens.push({ titulo: titulo.charAt(0).toUpperCase() + titulo.slice(1), url, data: null, resumo: '', tituloDoLink: true });
  }
  return itens;
}

// ----------------------------------------------------------------- coleta

async function tentar(lista, fn) {
  const out = [];
  const erros = [];
  await Promise.all((lista || []).map(async u => {
    try { out.push(...fn(await baixa(u), u)); } catch (e) { erros.push(u + ': ' + (e.message || e)); }
  }));
  return { itens: out, erros };
}

async function coletaFonte(f, dias) {
  const relatorio = { nome: f.nome, via: [], erros: [] };
  let itens = [];

  const rss = await tentar(f.rss, xml => lerFeed(xml));
  relatorio.erros.push(...rss.erros);
  if (rss.itens.length) { relatorio.via.push('rss'); itens.push(...rss.itens); }

  if (f.sitemap && itens.length < 5) {
    const sm = await tentar(f.sitemap, xml => lerSitemap(xml));
    relatorio.erros.push(...sm.erros);
    if (sm.itens.length) { relatorio.via.push('sitemap'); itens.push(...sm.itens); }
  }

  if (f.html && itens.length < 5) {
    const h = await tentar(f.html, (html, u) => {
      const lidos = lerHtml(html, u, f.linkOk);
      return lidos.length ? lidos : lerUrlsSoltas(html, u, f.linkOk);
    });
    relatorio.erros.push(...h.erros);
    if (h.itens.length) { relatorio.via.push('html'); itens.push(...h.itens); }
  }

  // Reforço do Google Notícias (sempre, pra cobrir o que o RSS geral não traz).
  const q = 'site:' + f.dominio + ' ' + (f.especializado ? '' : BUSCA_GOOGLE + ' ') + 'when:' + dias + 'd';
  const g = await tentar(['https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=pt-BR&gl=BR&ceid=BR:pt-419'], xml => lerFeed(xml));
  relatorio.erros.push(...g.erros);
  if (g.itens.length) {
    relatorio.via.push('google');
    for (const i of g.itens) {
      // O Google põe " - Nome do Jornal" no fim da manchete.
      if (i.fonteNome) i.titulo = i.titulo.replace(new RegExp('\\s+-\\s+' + i.fonteNome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '');
      else i.titulo = i.titulo.replace(/\s+-\s+[^-]{2,40}$/, '');
      i.viaGoogle = true;
      itens.push(i);
    }
  }

  const limite = Date.now() - dias * 864e5;
  const final = [];
  for (const i of itens) {
    if (!i.viaGoogle && !i.url.includes(f.dominio.replace(/^www\./, ''))) continue;
    if (i.data && Date.parse(i.data) < limite) continue;
    if (!f.especializado && !ehDoSetor(i.titulo, i.resumo)) continue;
    final.push({
      fonte: f.id,
      fonteNome: f.nome,
      titulo: i.titulo,
      url: i.url,
      data: i.data,
      viaGoogle: !!i.viaGoogle,
      tituloDoLink: !!i.tituloDoLink,
      ordem: f.ordem ? f.ordem(i.url) : 0,
      categoria: categoria(i.titulo, i.url, i.resumo),
    });
  }
  relatorio.total = final.length;
  return { itens: final, relatorio };
}

// Junta repetidas: mesma URL ou mesma manchete. Fica a versão com link
// original (não Google), com data e com manchete de verdade.
function deduplica(itens) {
  const pontos = i => (i.viaGoogle ? 0 : 4) + (i.tituloDoLink ? 0 : 2) + (i.data ? 1 : 0);
  const grupos = [];
  const porChave = new Map();
  for (const i of itens) {
    const chaves = [i.url, chaveTitulo(i.titulo)];
    const g = chaves.map(k => porChave.get(k)).find(x => x !== undefined);
    if (g === undefined) {
      grupos.push(i);
      chaves.forEach(k => porChave.set(k, grupos.length - 1));
      continue;
    }
    const existente = grupos[g];
    const fica = pontos(existente) >= pontos(i) ? existente : i;
    const outro = fica === i ? existente : i;
    if (!fica.data && outro.data) fica.data = outro.data;
    if (fica.tituloDoLink && !outro.tituloDoLink) { fica.titulo = outro.titulo; fica.tituloDoLink = false; }
    grupos[g] = fica;
    [...chaves, fica.url, chaveTitulo(fica.titulo)].forEach(k => porChave.set(k, g));
  }
  return grupos;
}

async function coletaTudo(dias) {
  const resultados = await Promise.all(FONTES.map(f => coletaFonte(f, dias).catch(e => ({
    itens: [], relatorio: { nome: f.nome, via: [], erros: [String(e && e.message || e)], total: 0 },
  }))));
  const fontes = {};
  let itens = [];
  FONTES.forEach((f, k) => { fontes[f.id] = resultados[k].relatorio; itens.push(...resultados[k].itens); });
  itens = deduplica(itens);
  itens.sort((a, b) => {
    const da = a.data ? Date.parse(a.data) : 0, db = b.data ? Date.parse(b.data) : 0;
    if (da !== db) return db - da;
    return (b.ordem || 0) - (a.ordem || 0);
  });
  itens.forEach(i => {
    i.id = require('node:crypto').createHash('sha1').update(i.url).digest('hex').slice(0, 12);
    delete i.ordem;
  });
  return { geradoEm: new Date().toISOString(), dias, itens, fontes };
}

async function handler(req, res) {
  const dias = Math.min(7, Math.max(1, Number(req.query && req.query.dias) || 2));
  try {
    const out = await coletaTudo(dias);
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}

module.exports = handler;
module.exports._interno = { lerFeed, lerSitemap, lerHtml, lerUrlsSoltas, ehDoSetor, categoria, deduplica, FONTES };
