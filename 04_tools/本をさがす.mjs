/* ============================================================
   本をさがす ― 「これですか？」の候補を出す道具

   使い方（著者名・書籍名・出版社名を渡す。書名だけ必須）:
     node 04_tools/本をさがす.mjs "舟を編む" "三浦しをん" "光文社"
     node 04_tools/本をさがす.mjs "モモ" "エンデ"
     node 04_tools/本をさがす.mjs 9784001141276        ← ISBN なら一発

   ⚠️⚠️ **国会図書館の OpenSearch は使わない。SRU を使う。**
      OpenSearch(/api/opensearch) は関連度で並ばず、かな順のあいまい一致で返す。
      「モモ」で1件目がイラスト辞典、「夜と霧」で『阿片王』が出た。
      title+creator を渡すと 0件になり、any= も無関係な結果しか返さない。
      SRU(/api/sru) は CQL で項目を指定した論理検索ができ、
      title="モモ" AND creator="エンデ" が正しく効く（2026-09-23 確認）。

   ⚠️ それでも**最後は人が選ぶ。**この道具は候補を出すところまでしかやらない。
      書名だけで機械に決めさせないこと。

   ⚠️ **Node の fetch（undici）は国会図書館サーチに 429 で弾かれる。**
      curl なら同じURLで通る。TLSの指紋かヘッダを見ているらしい。
   ⚠️ NDL は遅い（ブラウザから 21秒、curl で 30秒タイムアウトも）。
      openBD の ISBN 引きは 57ms で安定。**ISBN が分かっているなら必ずそちら。**
   ============================================================ */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
const 実行 = promisify(execFile);

async function 取得(url, 待つ = 60, 再挑戦 = 2){
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

/* ── 正規化 ──────────────────────────────────
   ⚠️ 決定的な処理だけ。LLMに投げない。 */
const 共通 = s => (s || "")
  .normalize("NFKC")
  .replace(/[\s　]+/g, "")
  .replace(/[・･·]/g, "")
  .replace(/[‐‑‒–—―ー−]/g, "-")
  .toLowerCase();

export const 出版社キー = s => 共通(s)
  .replace(/^\(株\)|\(株\)$|^株式会社|株式会社$/g, "")
  .replace(/^\(有\)|\(有\)$|^有限会社|有限会社$/g, "");

/* ⚠️ 著者は「三浦,しをん,1976-」の形で来る。生没年を落として区切りを詰める。 */
export const 著者キー = s => 共通(
  (s || "").replace(/,\s*\d{3,4}(-\d{0,4})?\s*$/, "").replace(/[／\/,，、]/g, "")
);

export const 主体のid = (型, 名) =>
  `${型}:${型 === "publisher" ? 出版社キー(名) : 著者キー(名)}`;

/* ── 著者の文字列をばらす ─────────────────────
   ⚠️ 実物はこう来る（2026-09-23 確認）:
        "Ende,Michael,1929-1995 大島,かおり,1931-2018"   ← 生没年つき・単一スペース区切り
        "ミヒャエル・エンデ／著 大島かおり／訳"            ← 版元ドットコム式・役割つき
      **単純にスペースで切ると姓名が割れる。**生没年か役割の直後で切ること。 */
export function 著者をばらす(文字列){
  if(!文字列) return [];
  let 断片;
  if(/\d{3,4}\s*-\s*\d{0,4}/.test(文字列)){
    断片 = 文字列.split(/(?<=\d{3,4}-\d{0,4})[\s　]+/);   // 生没年の直後で切る
  }else if(文字列.includes("／")){
    断片 = 文字列.split(/(?<=／\s*(?:著|訳|編|監修|画|絵|文|写真|原作))[\s　]+/);
  }else{
    /* ⚠️ ここは**当てにならない。**「ミヒャエル・エンデ 大島かおり」のように
          生没年も役割も無く、単一スペースで複数人が並ぶ形が実在する。
          日本語の姓名自体にも空白が入る（大島 かおり）ので、機械には割れない。
          → **登録には ISBN のある候補（openBD の「姓,名,生没年」形式）を使うこと。**
             そちらなら生没年が区切りになるので確実に割れる。 */
    断片 = 文字列.split(/[\s　]{2,}|[;；]/);
  }
  return 断片.map(x=>x.trim()).filter(Boolean).map(x=>{
    const m = x.match(/^(.*?)／\s*(著|訳|編|監修|画|絵|文|写真|原作)?\s*$/);
    return m ? { 名:m[1].trim(), 役:m[2] || "著" } : { 名:x, 役:"著" };
  }).filter(x=>x.名 && x.名.length <= 40);
}

/* ── openBD（ISBN → 正の書誌。57ms・安定） ────── */
export async function openBDで引く(isbn){
  let d = null;
  try{ [d] = JSON.parse(await 取得(`https://api.openbd.jp/v1/get?isbn=${isbn}`, 20, 1)); }
  catch(e){ return null; }
  if(!d) return null;
  const s = d.summary || {};
  return { 出典:"openBD", isbn:s.isbn || isbn, 題:s.title, 著:s.author,
           版元:s.publisher, 年:(s.pubdate||"").slice(0,4), 書影:s.cover || null };
}

/* ── 国会図書館サーチ（書名 → 候補。遅い） ─────── */
const 抜く    = (x,t) => (x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]?.trim();
const 全部抜く
  = (x,t) => [...x.matchAll(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`,"g"))].map(m=>m[1].trim());

/* ⚠️ CQL は絞りすぎると 0件になる。出版社 → 著者 の順に条件を外して掛け直す。 */
async function NDLで探す(書名, 著者, 出版社, 件数 = 30){
  const 組 = [
    [書名, 著者, 出版社], [書名, 著者, null], [書名, null, 出版社], [書名, null, null]
  ].filter(([t,c,p],i,a)=> a.findIndex(x=>String(x)===String([t,c,p]))===i);

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

/* SRU は dcndl の RDF で返ってくる。OpenSearch の素朴な RSS とは形が違う。

   ⚠️⚠️ **new RegExp(`...`) の中では [\s\S] と二重に書くこと。**
      テンプレート文字列は \s を s に潰すので、[\s\S] と書くと
      正規表現には [sS] が渡り、s と S しか拾わなくなる。
      正規表現リテラル /.../ の側は [\s\S] のままでよい。 */
function SRUをほどく(xml){
  return [...xml.matchAll(/<dcndl:BibResource[^>]*>([\s\S]*?)<\/dcndl:BibResource>/g)]
    .map(m=>{
      const r = m[1];
      const 値 = (tag) => {
        const b = r.match(new RegExp(`<${tag}[^>]*>([^]*?)</${tag}>`));
        if(!b) return null;
        const v = b[1].match(/<rdf:value>([\s\S]*?)<\/rdf:value>/)
               || b[1].match(/<foaf:name>([\s\S]*?)<\/foaf:name>/);
        return (v ? v[1] : b[1]).replace(/<[^>]+>/g,"").trim() || null;
      };
      const 全名 = (tag) =>
        [...r.matchAll(new RegExp(`<${tag}[^>]*>([^]*?)</${tag}>`,"g"))]
          .map(x=>{ const v = x[1].match(/<foaf:name>([\s\S]*?)<\/foaf:name>/);
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
    /* ⚠️ **ISBN を必須にしない。**国会図書館には ISBN の無い記録が多い
          （古い本、全集、多巻もの）。必須にすると候補が全滅する。
          ISBN の有無は点で差をつけるだけにして、拾うだけ拾う。 */
    .filter(x=>x.題);
}

/* ⚠️ ここが要。書名だけでなく**著者と出版社も点にする。**
      書名一致だけで選ぶと、上のコメントの通り別の本を掴む。 */
function 点をつける(c, 書名, 著者, 出版社){
  const q = 共通(書名), t = 共通(c.題 || "");
  let p = t === q ? 60 : t.startsWith(q) ? 40 : t.includes(q) ? 15 : 0;
  if(p === 0) return 0;                         // 書名がかすりもしないものは捨てる

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
  /* ⚠️ ISBN の無い記録は**登録に使えない**（openBD から正データと書影が取れない）。
        国会図書館には古い版の ISBN 無し記録が多く、書名が完全一致するぶん
        上位に来てしまうので、ISBN があることを強く買う。 */
  if(c.isbn) p += 30;
  if(/^9784/.test(c.isbn || "")) p += 5;        // 978-4 = 日本で出た本
  return p;
}

/* ── 本体 ──────────────────────────────────── */
const [第1, 第2, 第3] = process.argv.slice(2);
if(!第1){
  console.log('使い方: node 04_tools/本をさがす.mjs "書名" ["著者名"] ["出版社名"]');
  process.exit(1);
}

const 見せる = (c, 印="") => {
  console.log(`${印}  ${c.題}`);
  console.log(`     著者   ${c.著 || "―"}`);
  console.log(`     出版社 ${c.版元 || "―"}　　${c.年 || ""}`);
  console.log(`     ISBN   ${c.isbn || "―"}　　出典 ${c.出典}`);
  const 著者ら = 著者をばらす(c.著);
  if(著者ら.length){
    console.log(`     主体   ${主体のid("publisher", c.版元)}`);
    著者ら.forEach(a=>console.log(`            ${主体のid(a.役==="著"?"author":"person", a.名)}（${a.役}）`));
  }
};

if(/^\d{9,13}[\dxX]?$/.test(第1.replace(/-/g,""))){
  const c = await openBDで引く(第1.replace(/-/g,""));
  console.log("");
  if(c){ 見せる(c, "◆"); } else console.log("  そのISBNは openBD に見つかりませんでした。");
  process.exit(0);
}

console.log(`\nさがしています… 書名「${第1}」${第2?` 著者「${第2}」`:""}${第3?` 出版社「${第3}」`:""}`);
console.log("（国会図書館サーチは遅いので、20秒ほどかかります）\n");

const { 件:生, 使った条件 } = await NDLで探す(第1, 第2, 第3);
if(!生.length){
  console.log("  国会図書館サーチから結果が返りませんでした（混んでいるか、書名が違います）。");
  console.log("  ISBN が分かれば、そちらのほうが確実です。");
  process.exit(1);
}

// ISBN で重複を落としつつ点順に
const 見た = new Set();
const ISBN無し = 生.filter(c=>!c.isbn).length;
const 候補 = 生.filter(c=>c.isbn)          // ⚠️ ISBN が無いと openBD から正データを取れない
  .map(c=>({ c, p:点をつける(c, 第1, 第2, 第3) }))
  .filter(x=>x.p > 0)
  .sort((a,b)=>b.p - a.p)
  .filter(x=>{ const k = x.c.isbn || x.c.題 + x.c.版元;
               if(見た.has(k)) return false; 見た.add(k); return true; })
  .slice(0, 6);

if(!候補.length){
  console.log(`  ${生.length}件ひっかかりましたが、著者・出版社と合うものがありませんでした。`);
  console.log("  条件を緩めるか、ISBN でお願いします。");
  process.exit(1);
}

console.log(`${生.length}件から、${候補.length}件にしぼりました。これですか？\n`);
for(let i = 0; i < 候補.length; i++){
  const { c, p } = 候補[i];
  const 正 = c.isbn ? (await openBDで引く(c.isbn)) || c : c;
  正.出典 = c.isbn && 正.出典 === "openBD" ? "openBD（正）" : "NDL のみ";
  見せる(正, `\n[${i+1}] 点${p}`);
}
console.log(`\n番号でお知らせください。そのまま登録します。`);
console.log(`違うものばかりなら、ISBN をいただけると確実です。`);
