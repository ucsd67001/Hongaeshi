/* ============================================================
   Amazonリンクを入れる ― リンクを渡すと、該当の本に紐づける

     node 04_tools/Amazonリンクを入れる.mjs --下見 <URL> [<URL> …]
     node 04_tools/Amazonリンクを入れる.mjs <URL> [<URL> …]
     node 04_tools/Amazonリンクを入れる.mjs --本 <ISBN13> "<URL>|<ラベル>" …
     node 04_tools/Amazonリンクを入れる.mjs --新規 <URL> …   ← 棚に無ければ登録もする

   ⚠️ **--新規 を付けると、リンクから本の登録まで通る。**
      ASIN → ISBN → openBD で書誌を引いて、本と主体を作り、リンクを付ける。
      リンクを並べて渡すだけで棚が増やせる。ページ数と表紙は
      そのあと 表紙をつける.mjs で入る。

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
import { openBDで引く, 著者をばらす, 読める名に, 主体のid, 出版社キー, 著者キー }
  from "./書誌.mjs";
import { 名前をととのえる } from "../public/名寄せ.js";
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
const 新規 = 引数.includes("--新規");
const 本指定 = 引数.includes("--本") ? 引数[引数.indexOf("--本") + 1] : null;
const リンクら = 引数.filter((x,i)=>
  x !== "--下見" && x !== "--新規" && x !== "--本"
  && !(本指定 && i === 引数.indexOf("--本") + 1));

/* ⚠️ openBD に無い本がある（文庫の一部など）。Google Books を控えにする。
      GOOGLE_BOOKS_KEY が無ければ控えは使わない（鍵なしだと 429）。 */
async function GoogleBooksで引く(isbn){
  const 鍵 = process.env.GOOGLE_BOOKS_KEY;
  if(!鍵) return null;
  try{
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes`
      + `?q=isbn:${isbn}&country=JP&key=${鍵}`);
    if(!r.ok) return null;
    const v = (await r.json()).items?.[0]?.volumeInfo;
    if(!v?.title) return null;
    return { 出典:"GoogleBooks", isbn, 題: v.subtitle ? `${v.title} : ${v.subtitle}` : v.title,
             著: (v.authors || []).join("  "),      // ⚠️ 2つ空きで区切る（著者をばらす の想定）
             版元: v.publisher || null, 年: (v.publishedDate || "").slice(0,4) };
  }catch(e){ return null; }
}

/* 書誌から本の中身を組み立てる。--新規 のときだけ使う */
const 新しい主体 = new Map();
async function 本をこしらえる(isbn, 正URL, ラベル){
  const o = (await openBDで引く(isbn)) || (await GoogleBooksで引く(isbn));
  if(!o?.題) return null;
  const [題, ...副] = String(o.題).split(/\s*:\s*/);
  /* ⚠️ 書誌の著者欄には訳者や「ほか」が混ざる。主体になりえない語は落とす */
  const 除ける = /^(ほか|他|編集部|著者不明)$/;
  const 著者名ら = 著者をばらす(o.著).filter(a=>a.役 === "著")
    .map(a=>読める名に(a.名)).filter(n=>n && !除ける.test(n));

  const 受取 = [];
  const 足す = (type, 名)=>{
    if(!名) return;
    const id = 主体のid(type, 名);
    if(受取.includes(id)) return;
    受取.push(id);
    新しい主体.set(id, { id, type, name:名,
      key: type==="publisher" ? 出版社キー(名) : 著者キー(名) });
  };
  著者名ら.forEach(n=>足す("author", n));
  足す("publisher", 名前をととのえる(o.版元));

  return {
    isbn, title:題, subtitle: 副.join(" : ") || null,
    authorText: 著者名ら.join("、"), publisherText: o.版元 || null,
    year: Number(o.年) || null, pubDate:null, pages:null,
    cover:null, coverAlt:null,
    amazonLinks: [{ label: ラベル || "", url: 正URL }],
    to: 受取, status:"流通",
    addedBy:"admin", addedAt:new Date().toISOString(), public:true,
    /* ⚠️ Firestore には入れない。下の表示で人に見せるためだけに持つ */
    書誌の著者欄: o.著 || null
  };
}
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
const 作る本 = [];          // --新規 のときに貯める
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

  /* ⚠️ --新規 なら、棚に無い本はその場で書誌を引いて登録する */
  if(!本 && 新規){
    const 中身 = await 本をこしらえる(isbn, 正, ラベル);
    if(!中身){ console.log(`      × ISBN ${isbn} の書誌が openBD にありません\n`); continue; }
    console.log(`      ＋ ${中身.title}${中身.subtitle ? " : " + 中身.subtitle : ""}`);
    console.log(`        ${中身.authorText || "（著者なし）"} ／ ${中身.publisherText} ／ ${中身.year}`);
    console.log(`        ISBN ${isbn}   届け先 ${中身.to.join("  ")}\n`);
    作る本.push({ id: isbn, 中身 });
    continue;
  }
  if(!本){   console.log(`      × ISBN ${isbn} は棚にありません。`
    + `--新規 を付ければ登録もします\n`); continue; }

  console.log(`      ◎ ${本.title}`);
  console.log(`        ASIN ${asin} → ISBN ${isbn}`);
  console.log(`        ${(本.amazonLinks||[]).length || 本.amazonUrl ? "差し替え" : "新規"} → ${正}\n`);
  直す.push({ id: isbn, links: [{ label: ラベル || "", url: 正 }], 題: 本.title });
}

if(本指定 && 束ねる.length)
  直す.push({ id: 本指定, links: 束ねる, 題: 蔵書.get(本指定)?.title });

console.log(`紐づける本：${直す.length}　新しく登録：${作る本.length} / ${リンクら.length}`);
if(下見){ console.log("（下見なので、何も書いていません）"); process.exit(0); }
if(!直す.length && !作る本.length) process.exit(0);

/* ⚠️ 単数の amazonUrl は消して、配列の amazonLinks に一本化する。
      両方あると、どちらを見るかで食い違う。 */
const 束 = db.batch();
/* ⚠️ merge:true。すでにある主体の claimed を壊さない */
for(const [, e] of 新しい主体)
  束.set(db.collection("entities").doc(e.id),
    { type:e.type, name:e.name, key:e.key, aliases:[e.name],
      claimed:false, claimedBy:null, detail:{}, updatedAt:new Date().toISOString() },
    { merge:true });
作る本.forEach(x=>束.set(db.collection("books").doc(x.id), x.中身, { merge:true }));
直す.forEach(x=>束.update(db.collection("books").doc(x.id),
  { amazonLinks: x.links, amazonUrl: null }));
await 束.commit();
console.log(`✓ 書きました。表紙も Amazon のものに変わります。`);
process.exit(0);
