/* ============================================================
   Amazonリンクを入れる ― リンクを渡すと、該当の本に紐づける

     node 04_tools/Amazonリンクを入れる.mjs --下見 <URL> [<URL> …]
     node 04_tools/Amazonリンクを入れる.mjs <URL> [<URL> …]
     node 04_tools/Amazonリンクを入れる.mjs --本 <ISBN13> "<URL>|<ラベル>" …

   ⚠️⚠️ **1冊に複数のリンクを持てる。**作品は1つでも、Amazonでは
      版や巻で分かれていることがある。『二十歳のころ』は、棚にあるのが
      新潮社1998の単行本(684p)なのに、Amazonにあるのは
      ランダムハウス講談社文庫2008の上下2巻(613p/661p)だった。
      ISBNでは突き合わせられないので、**--本 で行き先を指定して束ねる。**
      ラベル（「I」「上巻」など）を付けると、画面でそのまま出る。

   ⚠️ **短縮リンク（link.amazon/…）も辿れる。**ブラウザからはCORSで辿れないが、
      手元からなら curl で追える。だから利用者の申請では書誌を引くだけにして、
      管理者はこの道具でリンクそのものを入れる。

   ⚠️ 紙の本の ASIN は ISBN-10 と同じなので、ISBN-13 に直せば books と突き合わせられる。
      Kindle版などの B0… で始まる ASIN は ISBN ではないので、突き合わせできない。

   ⚠️ 保存するのは**正規形**（/dp/{ASIN}?tag=…）。
      SiteStripe が出すURLには crid や ascsubtag など、
      そのときの検索セッション由来の値が大量に付いていて、永続リンクにならない。

   ⚠️ リンクを入れると、**表紙も Amazon のものに変わる**（共通.js の優先順位）。
      Amazonの画像は規約上グレーなので、**リンクのある本だけ**に出る作りにしてある。

   環境変数: HONGAESHI_KEY
   ============================================================ */

import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const 実行 = promisify(execFile);

export const アソシエイトタグ = "ucsd67001-22";

const ISBN13にする = isbn10 => {
  const d = String(isbn10 || "").replace(/[^0-9Xx]/g, "");
  if(!/^[0-9]{9}[0-9Xx]$/.test(d)) return null;
  const 体 = "978" + d.slice(0, 9);
  let 和 = 0;
  for(let i = 0; i < 12; i++) 和 += Number(体[i]) * (i % 2 ? 3 : 1);
  return 体 + String((10 - (和 % 10)) % 10);
};

/* ⚠️ Windows の Git Bash では、curl の -o /dev/null が
      「client returned ERROR on write」で終了コード23を返すことがある。
      **そのときも url_effective は stdout に出ている**ので、拾って使う。 */
async function 辿る(url){
  const 引数 = ["-sS","-L","-m","40","-o","/dev/null","-w","%{url_effective}", url];
  try{
    const { stdout } = await 実行("curl", 引数, { encoding:"utf8", maxBuffer: 1e7 });
    return stdout.trim();
  }catch(e){
    if(e.stdout && e.stdout.includes("amazon")) return e.stdout.trim();
    throw e;
  }
}

const 引数 = process.argv.slice(2);
const 下見 = 引数.includes("--下見");
const 本指定 = 引数.includes("--本") ? 引数[引数.indexOf("--本") + 1] : null;
const リンクら = 引数.filter((x,i)=>
  x !== "--下見" && x !== "--本" && !(本指定 && i === 引数.indexOf("--本") + 1));
if(!リンクら.length){
  console.log("使い方: node 04_tools/Amazonリンクを入れる.mjs [--下見] <AmazonのURL> …");
  process.exit(1);
}

const 鍵の場所 = process.env.HONGAESHI_KEY;
if(!鍵の場所){ console.error("× HONGAESHI_KEY を渡してください。"); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(readFileSync(鍵の場所, "utf8"))) });
const db = getFirestore();

const 蔵書 = new Map((await db.collection("books").get()).docs.map(d=>[d.id, d.data()]));
console.log(`棚には ${蔵書.size}冊。${リンクら.length}本のリンクを見ます。\n`);

const 直す = [];
const 束ねる = [];          // --本 のときに貯める
for(const 生 of リンクら){
  const [もと, ラベル] = 生.split("|");
  const 先 = await 辿る(もと);
  const m = 先.match(/\/(?:dp|gp\/product|ASIN)\/([0-9A-Za-z]{10})/);
  const asin = m ? m[1] : null;
  const isbn = asin ? ISBN13にする(asin) : null;
  console.log(`  ${もと}`);
  if(!asin){ console.log(`      × 商品番号を読み取れませんでした\n`); continue; }
  const 正 = `https://www.amazon.co.jp/dp/${asin}?tag=${アソシエイトタグ}`;

  /* ⚠️ --本 が指定されていれば、ISBNが合わなくてもその本に束ねる。
        版や巻が違っても「同じ作品」であることは、人にしか判断できない。 */
  if(本指定){
    const 先本 = 蔵書.get(本指定);
    if(!先本){ console.log(`      × 行き先 ${本指定} が棚にありません\n`); continue; }
    console.log(`      ◎ 『${先本.title}』に束ねます${ラベル ? `（${ラベル}）` : ""}`);
    console.log(`        ASIN ${asin}${isbn ? ` → ISBN ${isbn}` : "（ISBNではない）"}`);
    console.log(`        ${正}\n`);
    束ねる.push({ label: ラベル || "", url: 正 });
    continue;
  }

  const 本 = isbn ? 蔵書.get(isbn) : null;
  if(!isbn){ console.log(`      × ASIN ${asin} は ISBN ではありません（Kindle版など）\n`); continue; }
  if(!本){   console.log(`      × ISBN ${isbn} は棚にありません。`
    + `--本 <ISBN13> を付ければ、別の本に束ねられます\n`); continue; }

  console.log(`      ◎ ${本.title}`);
  console.log(`        ASIN ${asin} → ISBN ${isbn}`);
  console.log(`        ${(本.amazonLinks||[]).length || 本.amazonUrl ? "差し替え" : "新規"} → ${正}\n`);
  直す.push({ id: isbn, links: [{ label: ラベル || "", url: 正 }], 題: 本.title });
}

if(本指定 && 束ねる.length)
  直す.push({ id: 本指定, links: 束ねる, 題: 蔵書.get(本指定)?.title });

console.log(`紐づける本：${直す.length} / ${リンクら.length}`);
if(下見){ console.log("（下見なので、何も書いていません）"); process.exit(0); }
if(!直す.length) process.exit(0);

/* ⚠️ 単数の amazonUrl は消して、配列の amazonLinks に一本化する。
      両方あると、どちらを見るかで食い違う。 */
const 束 = db.batch();
直す.forEach(x=>束.update(db.collection("books").doc(x.id),
  { amazonLinks: x.links, amazonUrl: null }));
await 束.commit();
console.log(`✓ 書きました。表紙も Amazon のものに変わります。`);
process.exit(0);
