/* ============================================================
   書誌 ― 本をさがすための土台（道具から共通に使う）

   ⚠️⚠️ **国会図書館の OpenSearch は使わない。SRU を使う。**
      OpenSearch(/api/opensearch) は関連度で並ばず、かな順のあいまい一致。
      「モモ」で1件目がイラスト辞典、「夜と霧」で『阿片王』が出た。
      title+creator を渡すと 0件、any= も無関係。
      SRU(/api/sru) は CQL で title="…" AND creator="…" が正しく効く
      （2026-09-23 確認）。

   ⚠️ **Node の fetch（undici）は国会図書館サーチに 429 で弾かれる。**
      curl なら同じURLで通る。TLSの指紋かヘッダを見ているらしい。
   ⚠️ NDL は遅い（1回 20秒前後、タイムアウトもする）。
      openBD の ISBN 引きは 57ms で安定。**ISBN が分かっているなら必ずそちら。**
   ============================================================ */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
const 実行 = promisify(execFile);

export async function 取得(url, 待つ = 60, 再挑戦 = 2){
  for(let i = 0; i <= 再挑戦; i++){
    try{
      const { stdout } = await 実行("curl",
        ["-sS","--compressed","-m",String(待つ), url],
        { encoding:"utf8", maxBuffer: 1e8 });
      if(stdout && !stdout.includes("<code>429</code>")) return stdout;
    }catch(e){ /* タイムアウト。下で待って掛け直す */ }
    if(i < 再挑戦) await new Promise(r=>setTimeout(r, 2000 * (i+1)));
  }
  return "";
}

/* ── 名寄せ ──────────────────────────────────
   ⚠️ **規則は public/名寄せ.js にまとめてある。**ブラウザの管理画面からも
      同じ規則で登録するので、2か所に書くと主体が割れる。 */
export { 出版社キー, 著者キー, 主体のid, 読める名に, 著者をばらす }
  from "../public/名寄せ.js";
import { 出版社キー, 著者キー, 主体のid, 著者をばらす } from "../public/名寄せ.js";

const 共通 = s => (s || "").normalize("NFKC")
  .replace(/[\s　]+/g, "").replace(/[・･·]/g, "")
  .replace(/[‐‑‒–—―ー−]/g, "-").toLowerCase();

/* ── openBD（ISBN → 正の書誌。57ms・安定） ────── */
export async function openBDで引く(isbn){
  let d = null;
  try{ [d] = JSON.parse(await 取得(`https://api.openbd.jp/v1/get?isbn=${isbn}`, 20, 1)); }
  catch(e){ return null; }
  if(!d) return null;
  const s = d.summary || {};
  /* ⚠️ **ページ数は openBD にもある。**ONIX の Extent。
        Google Books だけに頼っていたら、日本の本で欠けた（2026-09-23、
        『偉人たちの挑戦』6冊のうち3冊が頁なしで入った）。
        ExtentUnit "03" がページ。これ以外（語数・分）は取らないこと。 */
  const 頁 = (d.onix?.DescriptiveDetail?.Extent || [])
    .filter(x=>x.ExtentUnit === "03")
    .map(x=>Number(x.ExtentValue)).filter(n=>n > 0).sort((a,b)=>b-a)[0] || null;
  return { 出典:"openBD", isbn:s.isbn || isbn, 題:s.title, 著:s.author,
           版元:s.publisher, 年:(s.pubdate||"").slice(0,4), 書影:s.cover || null, 頁 };
}

/* ── 国会図書館サーチ SRU（書名 → 候補） ───────── */
/* ⚠️ CQL は絞りすぎると 0件になる。出版社 → 著者 の順に条件を外して掛け直す。 */
export async function NDLで探す(書名, 著者, 出版社, 件数 = 30){
  const 組 = [[書名,著者,出版社],[書名,著者,null],[書名,null,出版社],[書名,null,null]]
    .filter((x,i,a)=> a.findIndex(y=>String(y)===String(x))===i);

  for(const [t,c,p] of 組){
    const 条件 = [`title="${t}"`];
    if(c) 条件.push(`creator="${c}"`);
    if(p) 条件.push(`publisher="${p}"`);
    const xml = await 取得(`https://ndlsearch.ndl.go.jp/api/sru`
      + `?operation=searchRetrieve&version=1.2&recordSchema=dcndl&recordPacking=xml`
      + `&maximumRecords=${件数}&query=${encodeURIComponent(条件.join(" AND "))}`);
    const 件 = SRUをほどく(xml);
    if(件.length) return { 件, 使った条件:条件.join(" AND ") };
  }
  return { 件:[], 使った条件:null };
}

/* SRU は dcndl の RDF で返る。OpenSearch の素朴な RSS とは形が違う。

   ⚠️ new RegExp(`…`) の中で [\s\S] と書くと、テンプレート文字列が \s を s に
      潰して [sS] になる。**[^] を使うこと**（改行も含む任意の1文字）。 */
export function SRUをほどく(xml){
  return [...xml.matchAll(/<dcndl:BibResource[^>]*>([^]*?)<\/dcndl:BibResource>/g)]
    .map(m=>{
      const r = m[1];
      const 値 = (tag) => {
        const b = r.match(new RegExp(`<${tag}[^>]*>([^]*?)</${tag}>`));
        if(!b) return null;
        const v = b[1].match(/<rdf:value>([^]*?)<\/rdf:value>/)
               || b[1].match(/<foaf:name>([^]*?)<\/foaf:name>/);
        return (v ? v[1] : b[1]).replace(/<[^>]+>/g,"").trim() || null;
      };
      const 全名 = (tag) =>
        [...r.matchAll(new RegExp(`<${tag}[^>]*>([^]*?)</${tag}>`,"g"))]
          .map(x=>{ const v = x[1].match(/<foaf:name>([^]*?)<\/foaf:name>/);
                    return v ? v[1].replace(/<[^>]+>/g,"").trim() : null; })
          .filter(Boolean);
      const isbn = (r.match(/ISBN"?>([\d\-Xx]{10,17})</) || [])[1];
      return {
        出典:"NDL",
        isbn: isbn ? isbn.replace(/-/g,"") : null,
        題: 値("dc:title"),
        著: 全名("dcterms:creator").join(" ") || 値("dc:creator"),
        版元: 全名("dcterms:publisher")[0] || 値("dc:publisher"),
        年: (値("dcterms:issued") || "").slice(0,4)
      };
    })
    .filter(x=>x.題);      // ⚠️ ISBN は必須にしない。無い記録が多い（呼ぶ側で絞る）
}

/* ⚠️ ここが要。書名だけでなく**著者と出版社も点にする。**
      書名一致だけで選ぶと別の本を掴む（証明済み）。 */
export function 点をつける(c, 書名, 著者, 出版社){
  const q = 共通(書名), t = 共通(c.題 || "");
  let p = t === q ? 60 : t.startsWith(q) ? 40 : t.includes(q) ? 15 : 0;
  if(p === 0) return 0;

  if(著者){
    const a = 著者キー(著者);
    const 名ら = 著者をばらす(c.著).map(x=>著者キー(x.名));
    p += 名ら.some(n=>n === a) ? 40
       : 名ら.some(n=>n.includes(a) || a.includes(n)) ? 30 : -25;
  }
  if(出版社){
    const h = 出版社キー(出版社), g = 出版社キー(c.版元);
    p += g === h ? 40 : (g && (g.includes(h) || h.includes(g))) ? 25 : -25;
  }
  /* ⚠️ ISBN の無い記録は登録に使えない（openBD から正データと書影が取れない）。
        書名が完全一致するぶん上位に来てしまうので、ISBN があることを強く買う。 */
  if(c.isbn) p += 30;
  if(/^9784/.test(c.isbn || "")) p += 5;
  return p;
}

/* 書名・著者・出版社 → 候補（点順・ISBN のあるものだけ） */
export async function さがす(書名, 著者, 出版社, 上限 = 6){
  const { 件:生, 使った条件 } = await NDLで探す(書名, 著者, 出版社);
  const 見た = new Set();
  const 候補 = 生.filter(c=>c.isbn)
    .map(c=>({ c, p:点をつける(c, 書名, 著者, 出版社) }))
    .filter(x=>x.p > 0)
    .sort((a,b)=>b.p - a.p)
    .filter(x=>{ if(見た.has(x.c.isbn)) return false; 見た.add(x.c.isbn); return true; })
    .slice(0, 上限);
  return { 候補, 使った条件, 総数:生.length, ISBN無し:生.filter(c=>!c.isbn).length };
}

/* ============================================================
   主体（著者・出版社）を作る ― **まだ無いものだけ**

   ⚠️⚠️ **既にある主体には何も書かない。**前は各道具が
      set({ …, aliases:[名], claimed:false, claimedBy:null }, { merge:true }) と書いていて、
      「merge だから既存の claimed を壊さない」とコメントしていたが、**merge でも書いた項目は上書きされる。**
      引き継ぎ済みの出版社の本を登録すると引き継ぎが外れ、統合で集めた別名も消えていた
      （まだ誰も引き継いでいないので実害は無かった。管理画面は 2026-09-23、道具は 2026-09-25 に直した）。
   主体ら : [{ id, type, name, key, aliases? }]。束 : Admin SDK の batch。作ったものを返す。
   ============================================================ */
export async function 無い主体を作る(db, 束, 主体ら){
  if(!主体ら.length) return [];
  const 今 = await db.getAll(...主体ら.map(e=>db.collection("entities").doc(e.id)));
  const 新 = 主体ら.filter((_, i)=>!今[i].exists);
  新.forEach(e=>束.set(db.collection("entities").doc(e.id), {
    type:e.type, name:e.name, key:e.key, aliases:e.aliases || [e.name],
    claimed:false, claimedBy:null, detail:{}, updatedAt:new Date().toISOString()
  }));
  return 新;
}
