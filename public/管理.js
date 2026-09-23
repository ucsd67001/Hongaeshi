/* ============================================================
   本返し ― 管理画面

   ⚠️ 入口は /admin。**admins に自分の uid があるときだけ**開く。
      管理者を増やせるのは Admin SDK（04_tools/管理者にする.mjs）からだけで、
      この画面からは増やせない。
      （画面から増やせると「管理者が自分で管理者を作れる」入口になる）

   ⚠️ **いちばん大事なのは「統合」。**編集や削除ではない。
      書誌データは出典や年代で表記が揺れるので、同じ相手が
      別の主体として並ぶ。実際に「文藝春秋」と「文芸春秋」が割れた。
      正規化キーで拾える分は自動でまとまるが、
        ・旧字新字（藝／芸）      → キーで寄せてある
        ・ローマ字と日本語表記    → **寄せられない。人が繋ぐしかない**
          （openBD の Ende,Michael と 和書の ミヒャエル・エンデ）
      ここを人が直せないと、受取がいつまでも割れたままになる。

   ⚠️ 統合すると、**負けたほうの主体を指している本を全部書き換える。**
      returns の parts/toIds は**書き換えない**（記録は消さない・直さない）。
      そのかわり、勝ったほうに 旧id[] を持たせて、受取の集計で拾う。
   ============================================================ */

import * as 土台 from "./共通.js";
import { 主体のid, 読める名に, 著者をばらす, 出版社キー, 著者キー } from "./名寄せ.js";
const { 逃, pt, いつ, 知らせる } = 土台;

const {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where,
  orderBy, getDocs, writeBatch, serverTimestamp
} = 土台.Firestore;

/* ⚠️ 権限の判定は 共通.js の 権限をしらべる() に一本化した。
      ここで別に問い合わせると、2か所が食い違う。 */

/* ============================================================
   画面
   ============================================================ */
let 見ている = "本";     // 本 / 主体 / 申請

export async function 頁_管理(){
  if(!土台.私) return `<div class="節"><div class="断り">
    管理画面を見るにはログインが必要です。</div></div>`;
  await 土台.権限をしらべる();
  if(!土台.権限.管理者) return `<div class="節"><div class="断り">
    <b>この画面は管理者だけが開けます。</b><br>
    管理者にするには、手元で次を実行します。<br>
    <code>node 04_tools/管理者にする.mjs ${逃(土台.私.uid)}</code></div></div>`;

  const 中 = 見ている === "本"   ? await 頁_本の管理()
           : 見ている === "主体" ? await 頁_主体の管理()
           :                       await 頁_申請の管理();

  return `
  <section class="幕" style="padding-bottom:0">
    <p class="英字の札">Admin</p>
    <h1 class="大見出し" style="font-size:clamp(25px,3.2vw,34px)">管理</h1>
    <p class="導き">${逃(土台.私.displayName || "")} として入っています。</p>
    <div style="display:flex;gap:8px;margin-top:22px;flex-wrap:wrap">
      ${["本","主体","申請"].map(k=>
        `<button class="釦 ${見ている===k?'':'枠だけ'} 小" onclick="管理の頁('${k}')">${k}</button>`).join("")}
    </div>
  </section>
  ${中}`;
}
window.管理の頁 = k=>{ 見ている = k; window.描き直す(); };

/* ── 本 ──────────────────────────────────── */
async function 頁_本の管理(){
  const 本ら = [...土台.蔵書];
  return `
  <section class="節">
    <div class="節の頭"><h2 class="節見出し">本</h2>
      <p class="節の添え">${本ら.length}冊</p></div>
    <div class="表の板"><table>
      <tr><th>題</th><th>著者</th><th>出版社</th><th>年</th><th>届け先</th><th></th></tr>
      ${本ら.map(b=>`<tr>
        <td class="本"><a onclick="go('book',{id:'${b.id}'})">${逃(b.題)}</a>
          ${b.副題?`<br><span style="font-size:11px;color:var(--字のごく薄い)">${逃(b.副題)}</span>`:""}
          <br><span style="font-size:10.5px;color:var(--字のごく薄い)">${b.isbn}</span></td>
        <td>${逃(b.著)}</td>
        <td>${逃(b.版元)}</td>
        <td>${b.年||"―"}</td>
        <td style="font-size:11px;color:var(--字のごく薄い)">${b.受取.map(r=>逃(r.名)).join("<br>")}</td>
        <td class="右" style="white-space:nowrap">
          <button class="釦 枠だけ 小" onclick="本を直す('${b.id}')">直す</button>
          <button class="釦 枠だけ 小" style="margin-left:4px" onclick="本を消す('${b.id}')">消す</button>
        </td></tr>`).join("")}
    </table></div>
  </section>`;
}

window.本を直す = id=>{
  const b = 土台.本を引く(id);
  if(!b) return;
  開く(`『${逃(b.題)}』を直す`, `
    <label class="名札" style="margin-top:0">題</label>
    <input class="欄" id="直す題" value="${逃(b.題)}">
    <label class="名札">副題</label>
    <input class="欄" id="直す副題" value="${逃(b.副題||"")}">
    <label class="名札">著者（表示用）</label>
    <input class="欄" id="直す著" value="${逃(b.著)}">
    <label class="名札">出版社（表示用）</label>
    <input class="欄" id="直す版元" value="${逃(b.版元)}">
    <label class="名札">刊行年</label>
    <input class="欄" id="直す年" inputmode="numeric" value="${b.年||""}">
    <label class="名札">表紙のURL（手で入れる。自動取得より優先されます）</label>
    <input class="欄" id="直す書影" value="${逃(b.書影||"")}"
      placeholder="https://… 画像の直リンク">
    <label class="名札">Amazonのリンク（売れそうな本にだけ）</label>
    <div style="display:flex;gap:10px;align-items:flex-end">
      <input class="欄" id="直すAmazon" value="${逃(b.Amazon||"")}" placeholder="空なら出しません">
      <button class="釦 枠だけ 小" style="white-space:nowrap"
        onclick="Amazonを作る('${b.isbn}')">ISBNから作る</button>
    </div>
    <div class="断り" style="margin-top:16px">
      ⚠️ Amazonリンクは<b>自動では付けません。</b>全ページにAmazonが並ぶのは、
      独立系書店を応援するサービスとして望ましくないからです。
      付けた本のページには「広告リンクです」と出ます。</div>
    <div class="断り" style="margin-top:16px">
      届け先（${b.受取.map(r=>逃(r.名)).join("、")}）は、ここでは変えられません。
      主体の統合で直してください。</div>
    <button class="釦 全幅" style="margin-top:20px" onclick="本を直す確定('${b.id}')">直す</button>`);
};

window.本を直す確定 = async id=>{
  const 取 = x => document.getElementById(x)?.value.trim() || "";
  try{
    await updateDoc(doc(土台.db, "books", id), {
      title: 取("直す題"),
      subtitle: 取("直す副題") || null,
      authorText: 取("直す著"),
      publisherText: 取("直す版元"),
      year: Number(取("直す年")) || null,
      coverManual: 取("直す書影") || null,
      amazonUrl: 取("直すAmazon") || null
    });
    閉じる(); 知らせる("直しました");
    await 土台.蔵書をよみこむ(); window.描き直す();
  }catch(e){ console.error(e); 知らせる("直せませんでした：" + (e.code||e.message), true); }
};

window.Amazonを作る = isbn=>{
  const u = 土台.Amazonのリンク(isbn);
  const e = document.getElementById("直すAmazon");
  if(!u){ 知らせる("この ISBN からは作れません（978始まりのみ）", true); return; }
  if(e) e.value = u;
};

window.本を消す = id=>{
  const b = 土台.本を引く(id);
  if(!b) return;
  開く("本を消す", `
    <p style="margin:0">『${逃(b.題)}』を消します。</p>
    <div class="断り" style="margin-top:16px">
      <b>この本に届いた返しの記録は消えません。</b>記録は消さない決まりだからです。
      本だけが消えるので、記録の行き先が無くなります。
      間違って登録したものだけを消してください。</div>
    <div style="display:flex;gap:10px;margin-top:22px">
      <button class="釦 枠だけ" onclick="閉じる()">やめる</button>
      <button class="釦 朱" style="flex:1" onclick="本を消す確定('${id}')">消す</button>
    </div>`);
};

window.本を消す確定 = async id=>{
  try{
    await deleteDoc(doc(土台.db, "books", id));
    閉じる(); 知らせる("消しました");
    await 土台.蔵書をよみこむ(); window.描き直す();
  }catch(e){ console.error(e); 知らせる("消せませんでした：" + (e.code||e.message), true); }
};

/* ── 主体 ─────────────────────────────────
   ⚠️ ここが管理画面の本体。統合できないと受取が割れたままになる。 */
async function 頁_主体の管理(){
  const 主体ら = [...土台.主体表.values()];
  const 冊数 = id => 土台.蔵書.filter(b=>b.受取.some(r=>r.id===id)).length;

  /* 似ているものを拾って上に出す。
     ⚠️ あくまで**候補**。自動では統合しない。同姓同名を潰す危険があるため。 */
  const 候補 = [];
  for(let i=0;i<主体ら.length;i++) for(let j=i+1;j<主体ら.length;j++){
    const a = 主体ら[i], b = 主体ら[j];
    if(a.型 !== b.型) continue;
    const x = a.名.replace(/\s/g,""), y = b.名.replace(/\s/g,"");
    if(x.includes(y) || y.includes(x)) 候補.push([a,b]);
  }

  return `
  ${候補.length ? `<section class="節">
    <div class="節の頭"><h2 class="節見出し">同じかもしれないもの</h2>
      <p class="節の添え">${候補.length}組・自動では統合しません</p></div>
    <div class="受取の列">
      ${候補.map(([a,b])=>`<div class="受取の行">
        <div style="flex:1">${逃(a.名)}（${冊数(a.id)}冊）　と　${逃(b.名)}（${冊数(b.id)}冊）</div>
        <button class="釦 枠だけ 小" onclick="統合する('${a.id}','${b.id}')">見くらべる</button>
      </div>`).join("")}
    </div>
  </section>` : ""}

  <section class="節">
    <div class="節の頭"><h2 class="節見出し">主体</h2>
      <p class="節の添え">${主体ら.length}件</p></div>
    <div class="表の板"><table>
      <tr><th>名称</th><th>種</th><th class="右">冊数</th><th>id</th><th>状態</th><th></th></tr>
      ${主体ら.sort((a,b)=>冊数(b.id)-冊数(a.id)).map(e=>`<tr>
        <td class="本">${逃(e.名)}</td>
        <td>${逃(e.型)}</td>
        <td class="右">${冊数(e.id)}</td>
        <td style="font-size:10.5px;color:var(--字のごく薄い)">${逃(e.id)}</td>
        <td>${e.認証?'<span class="札 済">認証済</span>':'<span class="札 藤">引き継ぎ待ち</span>'}</td>
        <td class="右" style="white-space:nowrap">
          <button class="釦 枠だけ 小" onclick="主体を直す('${e.id}')">名称</button>
          <button class="釦 枠だけ 小" style="margin-left:4px" onclick="統合を選ぶ('${e.id}')">統合</button>
        </td></tr>`).join("")}
    </table></div>
  </section>`;
}

window.主体を直す = id=>{
  const e = 土台.主体表.get(id); if(!e) return;
  開く("名称を直す", `
    <p class="節の注" style="margin:0">id は変えられません（${逃(id)}）。<br>
      画面に出る名称だけを直します。</p>
    <label class="名札">名称</label>
    <input class="欄" id="直す名称" value="${逃(e.名)}">
    <button class="釦 全幅" style="margin-top:22px" onclick="主体を直す確定('${id}')">直す</button>`);
};
window.主体を直す確定 = async id=>{
  const 名 = document.getElementById("直す名称")?.value.trim();
  if(!名) return;
  try{
    await updateDoc(doc(土台.db, "entities", id), { name: 名, updatedAt: new Date().toISOString() });
    閉じる(); 知らせる("直しました");
    await 土台.蔵書をよみこむ(); window.描き直す();
  }catch(e){ console.error(e); 知らせる("直せませんでした", true); }
};

window.統合を選ぶ = id=>{
  const e = 土台.主体表.get(id); if(!e) return;
  const 他 = [...土台.主体表.values()].filter(x=>x.型===e.型 && x.id!==id);
  開く("統合する", `
    <p style="margin:0;font-size:14px"><b>${逃(e.名)}</b> に、どれをまとめますか。</p>
    <p class="節の注">選んだほうが消え、その本の届け先が ${逃(e.名)} に変わります。</p>
    <div style="max-height:46vh;overflow:auto;margin-top:14px">
      ${他.length ? 他.map(x=>`<div class="受取の行">
        <div style="flex:1;font-size:13px">${逃(x.名)}
          <span style="font-size:10.5px;color:var(--字のごく薄い)"><br>${逃(x.id)}</span></div>
        <button class="釦 枠だけ 小" onclick="統合する('${id}','${x.id}')">これ</button>
      </div>`).join("") : '<p class="節の注">同じ種の主体が他にありません。</p>'}
    </div>`);
};

window.統合する = (残すid, 消すid)=>{
  const 残 = 土台.主体表.get(残すid), 消 = 土台.主体表.get(消すid);
  if(!残 || !消) return;
  const 冊 = id => 土台.蔵書.filter(b=>b.受取.some(r=>r.id===id));
  開く("統合する", `
    <div class="内訳" style="border-top:none;margin-top:0;padding-top:0">
      <div class="行"><span>残す</span><b>${逃(残.名)}</b></div>
      <div class="行 薄"><span></span><span>${逃(残すid)}・${冊(残すid).length}冊</span></div>
      <div class="行 締め"><span>消す</span><b>${逃(消.名)}</b></div>
      <div class="行 薄"><span></span><span>${逃(消すid)}・${冊(消すid).length}冊</span></div>
    </div>
    <div class="断り" style="margin-top:20px">
      ${冊(消すid).length}冊の届け先が <b>${逃(残.名)}</b> に変わります。<br>
      <b>すでに届いた返しの記録は書き換えません。</b>記録は消さない・直さない決まりなので、
      残すほうに「旧id」として覚えさせ、受取の集計で拾えるようにします。</div>
    <div style="display:flex;gap:10px;margin-top:22px">
      <button class="釦 枠だけ" onclick="閉じる()">やめる</button>
      <button class="釦" style="flex:1" onclick="統合する確定('${残すid}','${消すid}')">統合する</button>
    </div>`);
};

window.統合する確定 = async (残すid, 消すid)=>{
  try{
    const 残 = await getDoc(doc(土台.db, "entities", 残すid));
    const 消 = await getDoc(doc(土台.db, "entities", 消すid));
    const 旧 = [...new Set([...(残.data().oldIds||[]), 消すid, ...(消.data().oldIds||[])])];
    const 別名 = [...new Set([...(残.data().aliases||[]), ...(消.data().aliases||[])])];

    const 束 = writeBatch(土台.db);
    束.update(doc(土台.db, "entities", 残すid),
      { oldIds: 旧, aliases: 別名, updatedAt: new Date().toISOString() });
    for(const b of 土台.蔵書.filter(x=>x.受取.some(r=>r.id===消すid))){
      const 新 = [...new Set(b.受取.map(r=>r.id===消すid ? 残すid : r.id))];
      束.update(doc(土台.db, "books", b.id), { to: 新 });
    }
    束.delete(doc(土台.db, "entities", 消すid));
    await 束.commit();

    閉じる(); 知らせる("統合しました");
    await 土台.蔵書をよみこむ(); window.描き直す();
  }catch(e){ console.error(e); 知らせる("統合できませんでした：" + (e.code||e.message), true); }
};

/* ── 申請 ────────────────────────────────── */
async function 頁_申請の管理(){
  const s = await getDocs(query(collection(土台.db, "requests"), orderBy("at","desc")));
  const 申請ら = s.docs.map(d=>({ id:d.id, ...d.data() }));
  const 待ち = 申請ら.filter(x=>!x.done);

  return `
  <section class="節">
    <div class="節の頭"><h2 class="節見出し">登録の申請</h2>
      <p class="節の添え">未処理 ${待ち.length}件 ／ 全 ${申請ら.length}件</p></div>
    <div class="表の板"><table>
      <tr><th>書名</th><th>著者</th><th>出版社</th><th>ISBN</th><th>いつ</th><th></th></tr>
      ${申請ら.length ? 申請ら.map(r=>`<tr${r.done?' style="opacity:.45"':''}>
        <td class="本">${逃(r.title)}
          ${r.memo?`<br><span style="font-size:11px;color:var(--字のごく薄い)">${逃(r.memo)}</span>`:""}</td>
        <td>${逃(r.author||"―")}</td>
        <td>${逃(r.publisher||"―")}</td>
        <td style="font-size:11px">${逃(r.isbn||"―")}</td>
        <td style="color:var(--字のごく薄い);white-space:nowrap">${いつ(r.at)}</td>
        <td class="右" style="white-space:nowrap">${r.done ? '<span class="札 済">処理済</span>'
          : `<button class="釦 小" onclick="申請を本にする('${r.id}')">本にする</button>
             <button class="釦 枠だけ 小" style="margin-left:4px"
               onclick="申請を処理('${r.id}')">却下</button>`}</td>
      </tr>`).join("")
      : '<tr><td colspan="6" style="color:var(--字のごく薄い)">申請はまだありません。</td></tr>'}
    </table></div>
    <div class="断り" style="margin-top:22px">
      <b>「本にする」で、この画面から登録まで済みます。</b>
      ISBN か AmazonのURL があれば openBD から書誌を引いて埋めます（57ms）。<br>
      ⚠️ <b>短縮リンク（link.amazon/…）はブラウザからは辿れません。</b>
      一度開いて、出てきたURLを貼ってください。
      手元からなら <code>node 04_tools/Amazonリンクを入れる.mjs</code> で辿れます。</div>
  </section>`;
}

window.申請を処理 = async id=>{
  try{
    await updateDoc(doc(土台.db, "requests", id), { done: true });
    知らせる("処理済にしました"); window.描き直す();
  }catch(e){ console.error(e); 知らせる("できませんでした", true); }
};

/* ── 小さな覆い ───────────────────────────── */
const 窓 = () => document.getElementById("窓");
function 開く(題, 中){
  窓().innerHTML = `
  <div class="覆い" onclick="if(event.target===this)閉じる()">
    <div class="窓">
      <div class="窓の頭"><h3>${題}</h3>
        <button class="閉じる" onclick="閉じる()">✕</button></div>
      <div class="窓の中">${中}</div>
    </div></div>`;
}
function 閉じる(){ 窓().innerHTML = ""; }
window.閉じる = 閉じる;

/* ============================================================
   申請を本にする

   ⚠️ **ブラウザだけで完結する。**openBD は CORS が開いていて 57ms で返るし、
      books と entities への書き込みは isAdmin() で許してある。
      国会図書館は遅すぎて画面からは使えないので、ISBN か AmazonのURL が要る。

   ⚠️ **短縮リンク（link.amazon/…）はブラウザからは辿れない**（CORS）。
      一度開いて、出てきたURLを貼ってもらう。手元の道具なら curl で辿れる。

   ⚠️ 主体のIDは public/名寄せ.js の規則で作る。
      手元の道具と同じ規則でないと、同じ相手が2つに割れる。
   ============================================================ */
let T = {};

window.申請を本にする = async id=>{
  const d = await getDoc(doc(土台.db, "requests", id));
  if(!d.exists()) return;
  const r = d.data();
  T = { 申請:id, 題:r.title||"", 著:r.author||"", 版元:r.publisher||"",
        isbn:(r.isbn||"").replace(/[^0-9Xx]/g,""), amazon:"", ラベル:"",
        送信中:false, 済:false };
  本にする描く();
  if(T.isbn) window.申請のISBNを引く();     // ISBN があれば、開いた時点で引いておく
};

function 本にする描く(欄を保つ){
  const 中 = T.済 ? `<div class="終い">
      <div class="印">📚</div>
      <h3 style="font-size:19px;margin:16px 0 10px;font-weight:600;letter-spacing:.09em">棚に並べました</h3>
      <p class="節の注" style="margin:0">『${逃(T.題)}』</p>
      <button class="釦 全幅" style="margin-top:26px"
        onclick="閉じる();window.描き直す()">閉じる</button>
    </div>` : `
    <p class="節の注" style="margin:0">申請された内容です。確かめて直してから登録します。</p>

    <p class="名札">AmazonのURL（入れると表紙とリンクが付きます）</p>
    <div style="display:flex;gap:10px;align-items:flex-end">
      <input class="欄" id="T_amazon" value="${逃(T.amazon)}"
        placeholder="https://www.amazon.co.jp/…/dp/4166612476">
      <button class="釦 枠だけ 小" style="white-space:nowrap"
        onclick="申請のAmazonを引く()">読み取る</button>
    </div>
    <p class="節の注">短縮リンクは辿れません。開いて出てきたURLを貼ってください。</p>

    <p class="名札">巻のラベル（上巻・I など。1冊なら空で）</p>
    <input class="欄" id="T_ラベル" value="${逃(T.ラベル)}">

    <p class="名札">ISBN</p>
    <div style="display:flex;gap:10px;align-items:flex-end">
      <input class="欄" id="T_isbn" inputmode="numeric" value="${逃(T.isbn)}">
      <button class="釦 枠だけ 小" style="white-space:nowrap"
        onclick="申請のISBNを引く()">書誌を引く</button>
    </div>

    <p class="名札">書名</p><input class="欄" id="T_題" value="${逃(T.題)}">
    <p class="名札">著者</p><input class="欄" id="T_著" value="${逃(T.著)}">
    <p class="名札">出版社</p><input class="欄" id="T_版元" value="${逃(T.版元)}">
    <p class="名札">刊行年</p><input class="欄" id="T_年" inputmode="numeric" value="${T.年||""}">

    <div class="断り" style="margin-top:20px">
      届け先は<b>著者と出版社から自動で作ります</b>（${逃(T.著)||"—"} ／ ${逃(T.版元)||"—"}）。
      すでにある主体なら、そこにまとまります。</div>
    <button class="釦 全幅" style="margin-top:20px" ${T.送信中?"disabled":""}
      onclick="申請を登録する()">${T.送信中?"登録しています…":"棚に並べる"}</button>`;

  窓().innerHTML = `
  <div class="覆い" onclick="if(event.target===this)閉じる()">
    <div class="窓">
      <div class="窓の頭"><h3>${T.済?"":"申請を本にする"}</h3>
        <button class="閉じる" onclick="閉じる()">✕</button></div>
      <div class="窓の中">${中}</div>
    </div></div>`;
  if(欄を保つ){ const e=document.getElementById(欄を保つ);
    if(e){ e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }
}

const T欄を読む = ()=>{
  ["題","著","版元","isbn","amazon","ラベル","年"].forEach(k=>{
    const e = document.getElementById("T_"+k); if(e) T[k] = e.value.trim();
  });
};

window.申請のAmazonを引く = async ()=>{
  T欄を読む();
  if(/link\.amazon|amzn\.to|amzn\.asia/.test(T.amazon)){
    知らせる("短縮リンクは辿れません。開いて出てきたURLを貼ってください", true); return; }
  const asin = 土台.AmazonのASIN(T.amazon);
  if(!asin){ 知らせる("URLから商品番号を読み取れませんでした", true); return; }
  const isbn = 土台.ISBN13にする(asin);
  if(!isbn){ 知らせる("Kindle版などは書誌を引けません。紙の本のURLでお願いします", true); return; }
  T.isbn = isbn;
  await window.申請のISBNを引く();
};

window.申請のISBNを引く = async ()=>{
  T欄を読む();
  const r = await 土台.ISBNで確かめる(T.isbn);
  if(!r){ 知らせる("openBD に見つかりませんでした。手で入れてください", true); 本にする描く(); return; }
  T.題 = r.題 || T.題; T.著 = 読める名に(r.著 || "") || T.著;
  T.版元 = r.版元 || T.版元; T.年 = r.年 || T.年; T.isbn = r.isbn || T.isbn;
  知らせる("書誌を引きました");
  本にする描く();
};

window.申請を登録する = async ()=>{
  if(T.送信中) return;
  T欄を読む();
  if(!T.題 || !T.著 || !T.版元 || !/^\d{13}$/.test(T.isbn)){
    知らせる("書名・著者・出版社・ISBN(13桁) が要ります", true); return; }

  T.送信中 = true; 本にする描く();
  try{
    const [題, ...副] = T.題.split(/\s*:\s*/);
    const 受取 = [], 主体 = [];
    const 足す = (type, 名)=>{
      if(!名) return;
      const id = 主体のid(type, 名);
      if(!受取.includes(id)){
        受取.push(id);
        主体.push({ id, type, name:名,
          key: type==="publisher" ? 出版社キー(名) : 著者キー(名) });
      }
    };
    著者をばらす(T.著).filter(a=>a.役==="著").forEach(a=>足す("author", 読める名に(a.名)));
    足す("publisher", T.版元);

    const asin = 土台.AmazonのASIN(T.amazon);
    const 束 = writeBatch(土台.db);
    /* ⚠️ merge:true。すでにある主体の claimed を壊さない */
    主体.forEach(e=>束.set(doc(土台.db,"entities",e.id),
      { type:e.type, name:e.name, key:e.key, aliases:[e.name],
        claimed:false, claimedBy:null, detail:{}, updatedAt:new Date().toISOString() },
      { merge:true }));
    束.set(doc(土台.db,"books",T.isbn), {
      isbn:T.isbn, title:題, subtitle:副.join(" : ")||null,
      authorText:T.著, publisherText:T.版元, year:Number(T.年)||null,
      pubDate:null, pages:null, cover:null, coverAlt:null,
      amazonLinks: asin
        ? [{ label:T.ラベル||"", url:`https://www.amazon.co.jp/dp/${asin}?tag=${土台.アソシエイトタグ}` }]
        : [],
      to:受取, status:"流通",
      addedBy:"admin", addedAt:new Date().toISOString(), public:true
    }, { merge:true });
    束.update(doc(土台.db,"requests",T.申請), { done:true });
    await 束.commit();

    T.送信中 = false; T.済 = true; 本にする描く();
    await 土台.蔵書をよみこむ();
  }catch(e){
    T.送信中 = false; 本にする描く();
    console.error(e); 知らせる("登録できませんでした：" + (e.code||e.message), true);
  }
};
