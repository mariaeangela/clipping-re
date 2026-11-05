// Função serverless da Vercel: tenta descobrir o título de um relatório do Itaú BBA
// a partir do link do portal.
//
//   GET /api/relatorio?url=https://www.itau.com.br/itaubba-pt/portal/viewer/equity/<id>/MULT_20261029
//     -> { nome: 'Multiplan', titulo: 'Decent 3Q results, …' | null, via: 'pagina' | 'link' }
//
// O nome (empresa ou setor) sai do fim do link (MULT_20261029 -> Multiplan). O título
// só vem se a página do portal mostrar (og:title, <title> ou JSON embutido); se o
// portal pedir login, volta `titulo: null` e o app pede pra ela colar o título.

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Código no fim do link -> como aparece no clipping. Tirado dos relatórios que já
// saíram no grupo (abr–nov/2026).
const NOMES = {
  HOMEBUILDERS: 'Homebuilders', MALLS: 'Malls', REAL_ESTATE: 'Real Estate', REALESTATE: 'Real Estate',
  PROPERTIES: 'Properties', ALOS: 'Allos', CURY: 'Cury', CYRE: 'Cyrela', DIRR: 'Direcional', EVEN: 'Even',
  EZTC: 'EZ Tec', HBOR: 'Helbor', IGTI: 'Iguatemi', LAVV: 'Lavvi', LOGG: 'Log CP', LPSB: 'LPS Brasil',
  MDNE: 'Moura Dubeux', MELK: 'Melnick', MRVE: 'MRV', MTRE: 'Mitre', MULT: 'Multiplan', PLPL: 'Plano&Plano',
  TEND: 'Tenda', TRIS: 'Trisul', JHSF: 'JHSF', GFSA: 'Gafisa', TCSA: 'Tecnisa', SYNE: 'SYN', BRPR: 'BR Properties',
  HBRE: 'HBR Realty', JFEN: 'João Fortes', RDNI: 'RNI', PDGR: 'PDG', VIVR: 'Viver',
};

function nomeDoLink(url) {
  const m = String(url).match(/\/([A-Za-z&_]+?)\d?_(\d{8})(?:[/?#]|$)/);
  if (!m) return '';
  const cod = m[1].toUpperCase();
  return NOMES[cod] || NOMES[cod.replace(/_/g, '')] || m[1].replace(/_/g, ' ');
}

function decode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

// Separa "Itaú BBA on Multiplan: Decent 3Q…" em nome e título.
function separa(texto) {
  const t = decode(texto).replace(/^(Itaú BBA|Itau BBA|IBBA)\s+(on|sobre)\s+/i, '');
  const m = t.match(/^([^:]{2,60}):\s*(.{10,})$/);
  return m ? { nome: m[1].trim(), titulo: m[2].trim() } : { nome: '', titulo: t };
}

function tituloDaPagina(html) {
  const candidatos = [
    (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || [])[1],
    (html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title/i) || [])[1],
    (html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)/i) || [])[1],
    (html.match(/"(?:reportTitle|documentTitle|title|titulo)"\s*:\s*"([^"]{15,400})"/) || [])[1],
    (html.match(/<h1[^>]*>([\s\S]{15,400}?)<\/h1>/i) || [])[1],
    (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1],
  ].map(c => c && decode(c.replace(/<[^>]+>/g, ' ').replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))));
  // Título genérico do portal ("Itaú BBA", "Portal", "Login"…) não serve.
  return candidatos.find(c => c && c.length >= 15 && !/^(ita[uú]|portal|login|entrar|acesso|research|equity)\b/i.test(c) && !/^ita[uú] bba( -|$)/i.test(c)) || null;
}

module.exports = async function handler(req, res) {
  const url = String((req.query && req.query.url) || '').trim();
  if (!/^https:\/\/(www\.)?itau\.com\.br\//i.test(url)) {
    res.status(400).json({ error: 'link precisa ser do itau.com.br' });
    return;
  }
  const out = { nome: nomeDoLink(url), titulo: null, via: 'link' };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' } });
    clearTimeout(timer);
    const html = await r.text();
    // ?ver=1: mostra o que o servidor recebeu do Itaú (pra descobrir onde o título fica).
    if (req.query.ver) {
      res.status(200).json({
        status: r.status, urlFinal: r.url, tamanho: html.length,
        titulos: (html.match(/<title[^>]*>[^<]*<\/title>|<meta[^>]+(og:|twitter:)[^>]+>|<h1[^>]*>[\s\S]{0,300}?<\/h1>/gi) || []).slice(0, 10),
        enderecosApi: [...new Set(html.match(/["'](\/[^"'\s]*(api|graphql|service|json)[^"'\s]*|https?:\/\/[^"'\s]*(api|graphql|service)[^"'\s]*)["']/gi) || [])].slice(0, 30),
        scripts: [...new Set(html.match(/<script[^>]+src=["'][^"']+["']/gi) || [])].slice(0, 20),
        inicio: html.slice(0, 3000),
      });
      return;
    }
    if (r.ok) {
      const achado = tituloDaPagina(html);
      if (achado) {
        const p = separa(achado);
        out.titulo = p.titulo;
        if (p.nome) out.nome = p.nome;
        out.via = 'pagina';
      }
    }
  } catch { /* fica só com o que o link diz */ }
  res.setHeader('Cache-Control', 's-maxage=86400');
  res.status(200).json(out);
};

module.exports._interno = { nomeDoLink, separa, tituloDaPagina };
