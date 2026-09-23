/* ============================================================
   表紙をつける ― 表紙URLとページ数を books に足す

     node 04_tools/表紙をつける.mjs --下見     ← 書かずに見せる
     node 04_tools/表紙をつける.mjs            ← 実際に書く
     node 04_tools/表紙をつける.mjs --全部     ← 入っているものも取り直す

   ── 表紙をどこから取るか ─────────────────────
   ⚠️ **自動で入れるのは Google Books の、実在を確かめたものだけ。**
      残りは色の背表紙になる。欲しい本は管理画面から手でURLを入れる
      （Amazonリンクと同じ「原則自動・大事なものは手動」の考え方）。

   ⚠️⚠️ **国会図書館の書影は、一次ソースにしない。**
      日本の本に強く、ホットリンクもできる（コンビニ人間で確認）。
      しかし **遅い。**15冊ぶんの img を同時に出したら、
      15秒たっても1枚も返らず、全部が待ちのまま固まった。
      しかも img の onerror は**タイムアウトでは鳴らない**ので、
      控えの画像にも落ちず、いつまでも空のままになる。
      使うなら、順番に1枚ずつ 読み込む仕組みか、中継が要る。

   ⚠️⚠️ **Google Books は、表紙が無くても imageLinks を返す。**
      返ってくるのは「image not available」の絵で、
      15冊中8冊が**まったく同じ画像**（15,567バイト）だった。
      URLの有無で判断すると、棚じゅうに「image not available」が並ぶ。
      → **必ず中身を落として確かめること。**
         ・小さすぎるもの（5KB未満）は捨てる
         ・同じ中身が2冊以上に出たら、それは差し替え画像なので捨てる
         ・**縦横比を見る。**28KBもあるのに 300x48 という細い帯が来た。
           本の表紙は縦長（高さ÷幅が 1.1〜1.9）なので、外れたら捨てる

   ⚠️ 画像そのものは保存しない。URLを持つだけ。
   ⚠️ 鍵はブラウザに置かない。ここで取ってFirestoreに入れる。

   環境変数: HONGAESHI_KEY / GOOGLE_BOOKS_KEY
   ============================================================ */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const 下見 = process.argv.includes("--下見");
const 全部 = process.argv.includes("--全部");

const 鍵 = process.env.GOOGLE_BOOKS_KEY;
const 鍵の場所 = process.env.HONGAESHI_KEY;
if(!鍵 || !鍵の場所){
  console.error("× GOOGLE_BOOKS_KEY と HONGAESHI_KEY を環境変数で渡してください。");
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(readFileSync(鍵の場所, "utf8"))) });
const db = getFirestore();

/* http→https、zoom=1→2（300px）、ページの折り目は外す */
const 整える = u => u
  ? u.replace(/^http:/, "https:").replace(/&zoom=\d/, "&zoom=2").replace(/&edge=curl/, "")
  : null;

async function GoogleBooks(語){
  const r = await fetch(`https://www.googleapis.com/books/v1/volumes`
    + `?q=${encodeURIComponent(語)}&country=JP&maxResults=5&key=${鍵}`);
  if(!r.ok) return [];
  const j = await r.json();
  return (j.items || []).map(x=>({
    id: x.id, 頁: x.volumeInfo?.pageCount || null,
    表紙: 整える(x.volumeInfo?.imageLinks?.thumbnail)
  }));
}

/* JPEG/PNG の寸法を、頭のバイトから読む（画像ライブラリを入れずに済ませる） */
function 寸法(buf){
  if(buf[0] === 0x89 && buf[1] === 0x50)             // PNG
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if(buf[0] === 0xFF && buf[1] === 0xD8){            // JPEG
    let i = 2;
    while(i < buf.length - 9){
      if(buf[i] !== 0xFF){ i++; continue; }
      const m = buf[i + 1];
      if(m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC)
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/* ⚠️ ここが要。**中身を見ないと差し替え画像を掴む。** */
const 見た画像 = new Map();      // hash → 題
async function 本物の表紙か(url, 題){
  if(!url) return { 可:false, 訳:"URLなし" };
  try{
    const r = await fetch(url);
    if(!r.ok) return { 可:false, 訳:`HTTP ${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    if(buf.length < 5000) return { 可:false, 訳:`小さすぎる(${buf.length}b)` };
    const 寸 = 寸法(buf);
    if(寸){
      const 比 = 寸.h / 寸.w;
      if(比 < 1.1 || 比 > 1.9)
        return { 可:false, 訳:`形が違う(${寸.w}x${寸.h})` };
    }
    const h = createHash("md5").update(buf).digest("hex");
    if(見た画像.has(h)) return { 可:false, 訳:`「${見た画像.get(h)}」と同じ絵` };
    見た画像.set(h, 題);
    return { 可:true, 訳:`${Math.round(buf.length/1024)}KB` };
  }catch(e){ return { 可:false, 訳:"取得できない" }; }
}

/* ── 本体 ──────────────────────────────── */
const 本ら = (await db.collection("books").orderBy("year","desc").get()).docs;
console.log(`${本ら.length}冊を見ます。\n`);

const 直すもの = [];
for(const d of 本ら){
  const b = d.data();

  let 候補 = await GoogleBooks(`isbn:${b.isbn}`);
  if(!候補.length) 候補 = await GoogleBooks(`intitle:${b.title} inauthor:${b.authorText}`);
  const g = 候補.find(x=>x.表紙 || x.頁) || 候補[0] || {};

  const 判定 = await 本物の表紙か(g.表紙, b.title);

  const 中身 = {};
  if(g.頁 && (全部 || !b.pages)) 中身.pages = g.頁;
  if(g.id) 中身.googleId = g.id;
  中身.cover    = 判定.可 ? g.表紙 : null;   // ⚠️ 実在を確かめたものだけ
  中身.coverAlt = null;
  直すもの.push({ id:d.id, 中身 });

  console.log(`  ${判定.可 ? "◎" : " "} ${b.title.slice(0,28)}`);
  console.log(`      頁 ${g.頁 ?? "―"}   Google ${判定.可 ? 判定.訳 : "× " + 判定.訳}`);
  await new Promise(r=>setTimeout(r, 200));
}

const 実あり = 直すもの.filter(x=>x.中身.cover).length;
console.log(`\nGoogle に本物の表紙があったもの：${実あり} / ${本ら.length}冊`);
console.log(`残りは色の背表紙になります。欲しいものは管理画面から手でURLを入れてください。`);
if(下見){ console.log("（下見なので、何も書いていません）"); process.exit(0); }

const 束 = db.batch();
直すもの.forEach(x=>束.update(db.collection("books").doc(x.id), x.中身));
await 束.commit();
console.log(`✓ 書きました。`);
process.exit(0);
