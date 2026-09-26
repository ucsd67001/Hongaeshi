/* ============================================================
   申請 ― 利用者からの「読んだ本を棚に加える」を、手元で処理する

     node 04_tools/申請.mjs                         ← 未処理の申請を並べる（棚との重複も見る）
     node 04_tools/申請.mjs 並べた <申請id> <ISBN13>  ← 棚に並べたことを記録する（別の版として足した ISBN でもよい）
     node 04_tools/申請.mjs 既にある <申請id> <ISBN13> ← もう棚にあったことを記録する（本の requestedBy は触らない）
     node 04_tools/申請.mjs 見送り <申請id>           ← 見送ったことを記録する

   ⚠️⚠️ **管理画面の「本にする」と同じ記録を残すこと。**手元の道具で本を登録しただけだと、
      次の2つが抜ける（2026-09-26、処理を Claude Code に任せる形＝案B にしたときに足した）：
        ・申請の status を「並んだ」にし、book を入れる → 申請した人のマイページに「棚に並びました」と出る
        ・本の requestedBy に申請した人を入れる → 「棚に加えた本」の番付と、本のページの礼に使う
      見送りは status を「見送り」にするだけ。
   ⚠️ 手順全体は README の「申請を処理する（案B）」。本の登録そのものは「本を増やす手順」の道具で行う。

   環境変数: HONGAESHI_KEY
   ============================================================ */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const [何を, 申請id, isbn] = process.argv.slice(2);
const 鍵の場所 = process.env.HONGAESHI_KEY;
if(!鍵の場所){ console.error("× HONGAESHI_KEY を渡してください。"); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(readFileSync(鍵の場所, "utf8"))) });
const db = getFirestore();

const 日本時間 = t => t?.toDate ? t.toDate().toLocaleString("ja-JP", { timeZone:"Asia/Tokyo" }) : "―";
const 名を引く = async uid => {
  if(!uid) return "（不明）";
  const u = await db.doc(`users/${uid}`).get();
  return u.exists ? `${u.data().name}${u.data().profilePublic ? "（ページ公開中）" : ""}` : "（名乗りなし）";
};

/* ── 一覧 ── */
if(!何を){
  /* ⚠️ where("done","==",false) で引かない。利用者が出した申請には done が**無い**
        （処理したときに初めて入る）ので、それだと未処理を1件も拾えない */
  const 全部 = await db.collection("requests").get();
  const s = { docs: 全部.docs.filter(d=>!d.data().done) };
  s.size = s.docs.length;
  if(!s.size){ console.log(`未処理の申請はありません（全 ${全部.size}件）。`); process.exit(0); }
  const 棚 = new Map((await db.collection("books").get()).docs.map(d=>[d.id, d.data()]));
  const 題の鍵 = t => String(t || "").replace(/[\s:：・=＝「」『』"“”]/g, "").split(/[:：]/)[0].slice(0, 12);
  for(const d of s.docs){
    const x = d.data();
    console.log(`\n■ ${d.id}`);
    console.log(`  書名　：${x.title}`);
    console.log(`  著者　：${x.author || "―"}　出版社：${x.publisher || "―"}　ISBN：${x.isbn || "―"}`);
    if(x.memo) console.log(`  ひとこと：${x.memo}`);
    console.log(`  申請　：${x.name || ""} ${await 名を引く(x.from)}　${日本時間(x.at)}`);
    /* 重複の疑い：同じ ISBN／題の頭が同じ本 */
    if(x.isbn && 棚.has(x.isbn)) console.log(`  ⚠ 同じ ISBN の本がもう棚にあります：${棚.get(x.isbn).title}`);
    const 版の作品 = x.isbn && [...棚].find(([, b])=>(b.editions || []).some(v=>v.isbn === x.isbn));
    if(版の作品) console.log(`  ⚠ 同じ ISBN が、もう別の版として棚にあります：${版の作品[1].title}　${版の作品[0]}`);
    const 似た = [...棚].filter(([id, b])=>id !== x.isbn && 題の鍵(b.title) && 題の鍵(b.title) === 題の鍵(x.title));
    似た.forEach(([id, b])=>console.log(`  ⚠ 題が似た本が棚にあります（別の版かも）：${b.title}　${id}\n` +
      `    別の版なら新しい本にせず、node 04_tools/版を足す.mjs --下見 ${id} <この版のISBN> --版 文庫`));
  }
  console.log(`\n未処理 ${s.size}件`);
  process.exit(0);
}

/* ── 記録する ── */
const 申請 = db.doc(`requests/${申請id || "_"}`);
const 今 = await 申請.get();
if(!今.exists){ console.error(`× 申請 ${申請id} がありません。`); process.exit(1); }
const x = 今.data();

if(何を === "並べた"){
  if(!/^\d{13}$/.test(isbn || "")){ console.error("× ISBN13 を渡してください。"); process.exit(1); }
  const 本 = db.doc(`books/${isbn}`);
  const 束 = db.batch();
  if((await 本.get()).exists){
    束.update(申請, { done:true, status:"並んだ", book:isbn });
    束.update(本, { requestedBy: x.from });
    await 束.commit();
    console.log(`✓ 『${x.title}』を「棚に並びました」にし、本に申請した人を記録しました。`);
  }else{
    /* ⚠️ 別の版として足した ISBN なら、申請の行き先は**作品のページ**（版を足す.mjs）。
          申請した人は**その版に**記録する。作品の requestedBy は、作品を棚に加えた人のまま触らない
          （「棚に加えた本」の番付は作品を加えた人を数える） */
    const 作品 = (await db.collection("books").get()).docs.find(d=>(d.data().editions || []).some(v=>v.isbn === isbn));
    if(!作品){ console.error(`× ${isbn} はまだ棚にありません（別の版にもありません）。先に本か版を登録してください。`); process.exit(1); }
    const editions = 作品.data().editions.map(v=>v.isbn === isbn ? { ...v, requestedBy: x.from } : v);
    束.update(申請, { done:true, status:"並んだ", book:作品.id });
    束.update(作品.ref, { editions });
    await 束.commit();
    console.log(`✓ 『${x.title}』を「棚に並びました」にしました。行き先は作品『${作品.data().title}』（${作品.id}）の版です。`);
  }
}else if(何を === "既にある"){
  /* もう棚にある（2026-09-26）。⚠️ 本の requestedBy は触らない（棚に加えた人は先に加えた人のまま）。
        「並べた」で処理すると上書きされ、「棚に並びました」のメールも飛ぶ。
        status を「既にある」にすると、notifyRequestDone が「もう棚にありました」のメールを送る（本人が選んでいれば） */
  if(!/^\d{13}$/.test(isbn || "")){ console.error("× 棚にある本の ISBN13 を渡してください。"); process.exit(1); }
  const 棚 = (await db.collection("books").get()).docs;
  const 作品 = 棚.find(d=>d.id === isbn) || 棚.find(d=>(d.data().editions || []).some(v=>v.isbn === isbn));
  if(!作品){ console.error(`× ${isbn} は棚にありません（別の版にもありません）。`); process.exit(1); }
  await 申請.update({ done:true, status:"既にある", book:作品.id });
  console.log(`✓ 『${x.title}』を「もう棚にありました」にしました。行き先は『${作品.data().title}』（${作品.id}）です。`);
}else if(何を === "見送り"){
  await 申請.update({ done:true, status:"見送り" });
  console.log(`✓ 『${x.title}』を「見送り」にしました。`);
}else{
  console.error(`× 「${何を}」は分かりません。並べた／既にある／見送り のどれかです。`); process.exit(1);
}
process.exit(0);
