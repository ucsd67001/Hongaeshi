/* ============================================================
   本返し ― 画面

   ⚠️ 道すじは history API（/、/b/<本のid>、/me、/r、/about）。
      firebase.json の rewrites がぜんぶ index.html に寄せている。
   ⚠️ 画面はすべて「読込中を出す → 待つ → 差し替える」の形。
      Firestore を待つあいだ、空の板が残らないようにするため。
   ⚠️ 組み方の決まりは style.css の頭に書いてある。
      **囲みを増やさない。罫と余白で段をつくる。**
   ============================================================ */

import * as 土台 from "./共通.js";
import { 頁_管理 } from "./管理.js";
const {
  起動, 入る, 出る, 本返しする, 残したい,
  本の集計, 全体の集計, まとめて数える, 番付, 本の声, 最近の声, 私の記録, 受取人の受取,
  本を引く, 届け先, pt, 逃, 引数, いつ, 知らせる, 窓を出す, 覆い閉じ,
  既定額, 受取率の百分率, 受取人へ, 額の内訳, 内訳を作る
} = 土台;

const 画面 = document.getElementById("画面");
const 帯のnav = document.getElementById("nav");
const 帯の右 = document.getElementById("帯の右");
const 窓 = document.getElementById("窓");

/* ============================================================
   道すじ
   ============================================================ */
let 現在 = { 頁:"home" };

/* 本の一覧の並び。ボタンの並びと、URL から受け付ける値を、ここ1か所で決める */
const 並びの札 = [["登録","登録の新しい順"],["年","刊行の新しい順"],["額","返されたポイント"],["頁","ページ数"],["題","書名"]];
const 並びの名 = new Set(並びの札.map(([k])=>k));

function 道を読む(){
  const p = location.pathname.replace(/\/+$/,"") || "/";
  if(p.startsWith("/b/")) return { 頁:"book", id:decodeURIComponent(p.slice(3)) };
  if(p.startsWith("/e/")) return { 頁:"entity", id:decodeURIComponent(p.slice(3)) };
  if(p.startsWith("/u/")) return { 頁:"reader", id:decodeURIComponent(p.slice(3)) };
  if(p === "/me")    return { 頁:"mine" };
  if(p === "/r")     return { 頁:"receiver" };
  if(p === "/about") return { 頁:"about" };
  if(p === "/admin") return { 頁:"admin" };
  /* ⚠️ 並びは決まった値だけ受ける。URL の ?s= をそのまま画面に埋めていた（引数() の注を参照） */
  if(p === "/books"){
    const s = new URLSearchParams(location.search);
    return { 頁:"books", q:s.get("q") || "",
             並び: 並びの名.has(s.get("s")) ? s.get("s") : "年" };
  }
  return { 頁:"home", q:new URLSearchParams(location.search).get("q") || "" };
}

function go(頁, 他={}, 履歴に積む=true){
  現在 = { 頁, ...他 };
  const 道 = 頁==="book" ? "/b/"+encodeURIComponent(他.id)
           : 頁==="entity" ? "/e/"+encodeURIComponent(他.id)
           : 頁==="reader" ? "/u/"+encodeURIComponent(他.id)
           : 頁==="mine" ? "/me"
           : 頁==="receiver" ? "/r"
           : 頁==="about" ? "/about"
           : 頁==="admin" ? "/admin"
           : 頁==="books" ? ("/books" + (他.q||他.並び
               ? "?" + new URLSearchParams({...(他.q?{q:他.q}:{}), ...(他.並び?{s:他.並び}:{})}) : ""))
           : (他.q ? "/?q="+encodeURIComponent(他.q) : "/");
  if(履歴に積む){
    位置を覚える();                         // ⚠️ 積む**前に**、いまのページの履歴へ書く
    history.pushState({ y:0 }, "", 道);
  }
  window.scrollTo({ top:0, behavior:"instant" });
  描く();
}
window.go = go;
window.描き直す = ()=> 描く();      // 管理画面から呼ぶ

/* ── 戻ったときに、元の位置へ ─────────────────────
   ⚠️⚠️ ブラウザ任せにすると、一覧から本へ行って戻ったときに**一番上へ戻っていた。**
      戻ると「読み込んでいます」に差し替えてから描くので、その瞬間ページが短くなり、
      ブラウザが覚えていた位置へ戻れないため（2026-09-23 に直した）。
   → 位置は自分で覚える。移る前に history.state に書き、戻ったら**描き終わってから**そこへ。
   ⚠️ html は scroll-behavior:smooth なので、戻すときは必ず instant を付ける
      （付けないと、上から流れて降りてくる）。 */
history.scrollRestoration = "manual";
const 位置を覚える = () =>
  history.replaceState({ ...(history.state || {}), y: Math.round(window.scrollY) }, "");
/* 読み直し（F5）にもそなえて、スクロールが止まるたびに覚える。
   ⚠️ pagehide で書く形は、Chrome では残らなかった（読み直すと、その前に覚えた位置へ戻った）。
   ⚠️ replaceState は短い間に呼びすぎるとブラウザに止められるので、止まってから 250ms 後にだけ書く */
let 覚える予約 = 0;
window.addEventListener("scroll", ()=>{
  clearTimeout(覚える予約);
  覚える予約 = setTimeout(位置を覚える, 250);
}, { passive:true });

/* ⚠️ 戻る位置は、**描き直す前に**読んでおく。描いている途中はページが短くなって
      スクロールが起き、上の「止まるたびに覚える」が小さい値で上書きしてしまう */
const 覚えた位置 = () => history.state?.y || 0;
/* ⚠️ 0 のときも必ず動かす。「0 なら何もしない」にしていたら、進むで本のページへ行ったとき、
      描き直しの途中でページが短くなったときの中途半端な位置（1025px）に止まっていた */
const 位置へ = y => window.scrollTo({ top:y || 0, behavior:"instant" });
window.addEventListener("popstate", async ()=>{
  const y = 覚えた位置();
  現在 = 道を読む();
  await 描く();
  位置へ(y);
});

/* ============================================================
   帯
   ============================================================ */
function 帯を描く(){
  /* ⚠️ 権限で出し分ける。③利用者に見せるのは、本の一覧／しくみ だけ。
        「さがす」は外した（2026-09-24）。トップそのものなので、左上の「本返し」から戻れる。
        「マイページ」も外した（2026-09-25）。右上の自分の名前としるしから行ける。
        受取人の控えは①②、管理は①のみ。 */
  const 品 = [["books","本の一覧"]];
  if(土台.権限.管理者 || 土台.権限.受取人.length) 品.push(["receiver","受取人の控え"]);
  品.push(["about","しくみ"]);
  if(土台.権限.管理者) 品.push(["admin","管理"]);
  帯のnav.innerHTML = 品
    .map(([k,l])=>`<button class="${現在.頁===k?'いま':''}" onclick="go('${k}')">${l}</button>`).join("");

  /* ⚠️ 名前は Google のものではなく**名乗り**を出す。
        本名を出したくない人がいるので、決めていれば必ずそちらを使う。 */
  帯の右.innerHTML = 土台.私 ? `
    <div class="財布">
      <div class="残">${(土台.財布?.残高 ?? 0).toLocaleString()}<span>PT</span></div>
    </div>
    <button class="わたし" onclick="go('mine')" title="マイページ">
      ${しるし(土台.私の印())}
      <span class="名">${逃(土台.私の名())}</span>
    </button>`
  : `<button class="釦 小" onclick="ログイン()">Googleで入る</button>`;
}
window.ログイン  = ()=> 入る();
window.ログアウト = ()=> 出る();

/* ── 狭い画面：帯のメニューをたたむ（2026-09-25。GEMu_Web の 帯.js と同じ作り） ──
   ⚠️ ボタンはここで1回だけ作る。nav の中身は 帯を描く() が描くたびに入れ替えるので、
      ボタンを nav の中に置かないこと（消える）。
   ⚠️ 押せるものとして必ず満たす：aria-expanded／Escape で閉じる／外を押すと閉じる／
      行き先を押したら閉じる／画面を広げたら閉じる（開いたまま固まって見えないように）
   ⚠️ 残高と名前（帯の右）はたたまない。いちばんよく使う入口なので出したままにする */
(function 帯をたためるように(){
  const 帯 = document.querySelector(".帯"), 中 = 帯?.querySelector(".中");
  if(!帯 || !中) return;
  const ボタン = document.createElement("button");
  ボタン.type = "button";
  ボタン.className = "たたむボタン";
  ボタン.setAttribute("aria-label", "メニュー");
  ボタン.setAttribute("aria-expanded", "false");
  ボタン.setAttribute("aria-controls", "nav");
  ボタン.innerHTML = '<span class="線"></span><span class="線"></span><span class="線"></span>';
  中.appendChild(ボタン);

  const 開け閉め = 開く =>{
    帯.classList.toggle("開いている", 開く);
    ボタン.setAttribute("aria-expanded", 開く ? "true" : "false");
  };
  ボタン.addEventListener("click", e=>{
    e.stopPropagation();
    開け閉め(ボタン.getAttribute("aria-expanded") !== "true");
  });
  帯のnav.addEventListener("click", e=>{ if(e.target.closest("button")) 開け閉め(false); });
  document.addEventListener("click", e=>{ if(!帯.contains(e.target)) 開け閉め(false); });
  document.addEventListener("keydown", e=>{
    if(e.key === "Escape" && 帯.classList.contains("開いている")){ 開け閉め(false); ボタン.focus(); }
  });
  const 広い = window.matchMedia("(min-width: 821px)");     // ⚠️ style.css の 820px とそろえる
  広い.addEventListener("change", ()=>{ if(広い.matches) 開け閉め(false); });
})();

/* ============================================================
   共通の部品
   ============================================================ */
const 読込中 = () => `<div class="読込中"><div class="こま"></div>読み込んでいます</div>`;

const 看板 = () => `<div class="看板"><img src="/看板.webp" alt="本返し ― 読んだあとに、ありがとうを。" width="2000" height="667"></div>`;

const 節の頭 = (題, 添え="") => `<div class="節の頭">
  <h2 class="節見出し">${題}</h2>${添え?`<p class="節の添え">${添え}</p>`:""}</div>`;

async function 描く(){
  帯を描く();
  画面.innerHTML = 読込中();
  try{
    /* ⚠️ 知らない画面名は、さがすへ寄せる（前は「作る is not a function」で止まった） */
    const 作る = { home:頁_さがす, book:頁_本, mine:頁_私, receiver:頁_受取人,
                   about:頁_しくみ, admin:頁_管理, books:頁_一覧, entity:頁_主体,
                   reader:頁_読書家 }[現在.頁] || 頁_さがす;
    画面.innerHTML = await 作る();
    列を仕込む();                     // ⚠️ innerHTML を入れ替えた**あと**に呼ぶ
  }catch(e){
    console.error(e);
    画面.innerHTML = `<div class="節"><div class="断り">読み込めませんでした。${逃(e.message||String(e))}<br>
      <button class="釦 枠だけ 小" style="margin-top:12px" onclick="location.reload()">やり直す</button></div></div>`;
  }
  帯を描く();
}

/* 出版社と刊行年の書き方。**ここだけで決める。**
   ⚠️ 前は「文藝春秋・2009」と中黒でつないでいたが、
      出版社名の一部か年か、ぱっと見で切れ目が分からなかった。 */
const 版元と年 = b => 逃(b.版元) + (b.年 ? `（${b.年}）` : "");

/* 品切れの根拠と判定日。「（Amazon で新品なし・9月24日時点）」の形。
   ⚠️ 機械の判定なので言い切らない。根拠が無い古い記録は何も添えない */
function 状態の添え(b){
  if(!b.状態の根拠) return "";
  const 日 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b.状態の日 || "");
  const 何日 = 日 ? `・${Number(日[2])}月${Number(日[3])}日時点` : "";
  const 根拠 = b.状態の根拠.replace(/（中古のみ）$/, "");
  return `<span class="節の注" style="display:inline;margin:0 0 0 4px;align-self:center">（${逃(根拠)}${何日}）</span>`;
}

function 本の札(b, s){
  s = s || { 人数:0, 金額:0, 残数:0, 約額:0 };
  const 右 = b.状態==="絶版"
    ? `<b>${s.残数.toLocaleString()}</b><span class="添え">人が復刊を願う</span>`
    : `<b>${pt(s.金額).replace("pt","")}</b><span class="添え">pt ／ ${s.人数.toLocaleString()}人</span>`;
  return `<button class="本の札" onclick="go('book',{id:${引数(b.id)}})">
    <div class="書影" style="background:linear-gradient(155deg,${b.色},${b.色}bb)">
      ${表紙img(b)}
      <span>${逃(b.題)}</span></div>
    <div style="flex:1;min-width:0">
      <div class="本の名">${逃(b.題)}${副(b)}${b.状態==="絶版"?' <span class="札 注">品切れ</span>':""}</div>
      <div class="本の素性">${逃(b.著)}　—　${版元と年(b)}${b.頁?`　${b.頁}ページ`:""}</div>
    </div>
    <div class="本の数">${右}</div>
  </button>`;
}

/* ⚠️⚠️ **副題を出さないと、巻が見分けられない。**
      『三剣物語』は1〜3巻と外伝で題がまったく同じで、
      違うのは副題（「1 炎の剣」「外伝 マーシリアの…」）だけだった（2026-09-23）。
      題を出すところには、必ずこれを添えること。 */
const 副 = b => b.副題 ? `<span class="副題">${逃(b.副題)}</span>` : "";

/* 表紙の img。
   ⚠️ 優先順位は 共通.js の 蔵書をよみこむ() で決めている:
      手で入れたもの → Amazon（リンクのある本だけ）→ Google（実在確認済み）→ 色の背表紙。
      読めなければ控えへ、それも駄目なら img ごと消して背表紙を見せる。 */
function 表紙img(b){
  if(!b.書影) return "";
  const 控え = b.控えの書影 && b.控えの書影 !== b.書影 ? 逃(b.控えの書影) : "";
  return `<img src="${逃(b.書影)}" alt="" loading="lazy"
    data-控え="${控え}"
    onload="表紙をみる(this)"
    onerror="表紙をやめる(this)">`;
}

/* ⚠️⚠️ **Amazon は、表紙が無くても 200 を返す。**中身は43バイトの
      1×1 の透明画像で、`onerror` は鳴らない。**読めたかどうかでは判定できない。**
      （2026-09-23、『偉人たちの挑戦』6冊のうち4冊がこれだった）
      Google Books の「image not available」も同じ性質で、あちらは
      04_tools/表紙をつける.mjs が大きさと中身の md5 で弾いている。
      こちらは外のURLを指すだけなので、**出たところの大きさで見る。** */
window.表紙をみる = el =>{ if(el.naturalWidth <= 2 || el.naturalHeight <= 2) 表紙をやめる(el); };
window.表紙をやめる = el =>{
  if(el.dataset.控え){ const u = el.dataset.控え; el.dataset.控え = ""; el.src = u; }
  else el.remove();     // 消せば、下に敷いてある色の背表紙が出る
};

/* ── 横に流れる列 ────────────────────────────
   ⚠️ 本を全部縦に並べると、冊数が増えたときに破綻する。
      トップは流れる列だけにして、全部見るのは検索に任せる。 */
function 流し札(b, s){
  s = s || { 人数:0, 金額:0, 残数:0 };
  const 下 = b.状態==="絶版"
    ? (s.残数 ? `<div class="額">${s.残数}<span>人が復刊を願う</span></div>` : "")
    : (s.金額 ? `<div class="額">${s.金額.toLocaleString()}<span>PT</span></div>` : "");
  return `<button class="流し札" onclick="go('book',{id:${引数(b.id)}})">
    <div class="表紙" style="background:linear-gradient(155deg,${b.色},${b.色}cc)">
      ${表紙img(b)}
      <span>${逃(b.題)}</span>
    </div>
    <div class="名">${逃(b.題)}${副(b)}</div>
    <div class="素性">${逃(b.著)}</div>
    <div class="素性">${版元と年(b)}</div>
    ${下}
  </button>`;
}

let 列の番号 = 0;
/* ⚠️ 見出しの右に「すべて見る」を置く。NetflixやPrime Videoと同じ場所。
      列は一部しか見せないので、全部への出口が無いと行き止まりになる。
   ⚠️ ただし「すべて見る」の先は本の一覧**全体**。主体や読書家の列のように、
      その列の本だけを並べる先が無いときは 並び に false を渡して出さない。 */
function 流れる列(見出し, 添え, 本ら, 表, 並び){
  if(!本ら.length) return "";
  const 名 = "列" + (++列の番号);
  return `<section class="節">
    <div class="列の頭">
      <h2>${見出し}</h2><p class="添え">${添え}</p>
      ${並び === false ? ""
        : `<a class="すべて" onclick="go('books',${並び?`{並び:${引数(並び)}}`:"{}"})">すべて見る →</a>`}
      <div class="矢たち">
        <button class="矢" onclick="列を送る(${引数(名)},-1)" aria-label="左へ">‹</button>
        <button class="矢" onclick="列を送る(${引数(名)},1)" aria-label="右へ">›</button>
      </div>
    </div>
    <div class="列" id="${名}" tabindex="0">${本ら.map(b=>流し札(b,表?.[b.id])).join("")}</div>
  </section>`;
}

/* 声の1件。声はすべて voices（ことば）。
   ⚠️ 前は返し・残しの text も声として出していて、ポイントや「復刊を願う」の札を付けていた。
      ことばを voices に分けた時点で、ことばの入った返し・残しは0件だったので、その分岐は外した（2026-09-25） */
const 声の行 = (v, 本を出す=false) => `<div class="声">
  <div class="素性"><b>${読書家の名(v.送り主, v.表示名||"読者", v.匿)}</b>
    ${本を出す?`<a onclick="go('book',{id:${引数(v.本)}})">『${逃(本を引く(v.本)?.題||v.本)}』</a>`:""}
    <span>${いつ(v.時)}${v.直した ? `（${いつ(v.直した)}に直した）` : ""}</span></div>
  <p>${逃(v.文)}</p></div>`;

/* 登録申請への導線。
   ⚠️ 前は一覧の一番下にしか無くて、**見つけられなかった。**
      「無い」と気づく場所すべてに置くこと（検索の空振り、一覧の頭、本のページ）。 */
const 申請ボタン = () => `<button class="釦" onclick="${土台.私 ? "申請を始める()" : "ログイン()"}">
  ${土台.私 ? "読んだ本を棚に加える" : "入って、読んだ本を棚に加える"}</button>`;

/* 棚の育ち具合。
   ⚠️ 冊数が少ないうちは「少ない」ではなく「みんなで育てている途中」と伝える（2026-09-23）。
      前は「89冊あります。ここに無い本は、登録をお願いできます」と小さな字で書いてあるだけで、
      参加できることが伝わらなかった。トップと本の一覧の頭に置く */
function 棚の育ち(){
  /* ⚠️ 「今月＋○冊」は、全冊ではないときだけ出す。2026-09-23 時点では 89冊すべての登録日が
        同じ日（棚を作り直した日）で、「いま89冊・今月＋89冊」と意味の無い並びになった */
  const 増 = 土台.今月増えた(), 全 = 土台.蔵書.length;
  return `<div class="育つ棚">
    <p class="育つ棚の数"><b>いま ${全}冊</b>${増 && 増 < 全 ? `<span>今月 ＋${増}冊</span>` : ""}</p>
    <p class="節の注" style="margin:6px 0 0">
      棚は、読んだ人の申請で育っています。読んだ本が見つからなければ、登録をお願いしてください。
      確かめてから棚に並べます。並んだかどうかは「マイページ」で見られます。</p>
    <button class="釦 枠だけ 小" style="margin-top:12px"
      onclick="${土台.私 ? "申請を始める()" : "ログイン()"}">
      ${土台.私 ? "読んだ本を棚に加える" : "入って、読んだ本を棚に加える"}</button>
  </div>`;
}

/* 印つきの名前。**名前が出るところには必ずこれを使う。**
   ⚠️ 匿名のときは印を出さない（誰のものか分かってしまう）。 */
function 名と印(uid, 表示名, 匿){
  if(匿) return `<span class="名と印"><span class="印 匿">匿</span>匿名</span>`;
  return `<span class="名と印">${しるし(土台.印を引く(uid, 表示名))}${逃(表示名)}</span>`;
}

/* 読書家の名前。**ページを公開している人だけ**押せる（読書家のページへ）。
   ⚠️ 匿名の行では押せない。名前が無い（匿名でしか送っていない）人も「匿名」のまま */
function 読書家の名(uid, 表示名, 匿){
  if(匿 || !表示名) return 名と印(uid, "匿名", true);
  const 名 = 名と印(uid, 表示名, false);
  return 土台.公開か(uid)
    ? `<a class="読書家へ" onclick="go('reader',{id:${引数(uid)}})">${名}</a>` : 名;
}

/* 顔があれば画像、無ければ1文字。**必ずどちらかが出る。**
   ⚠️ loading="lazy" は外さないこと。声が並ぶ画面で一度に読みに行かせない。 */
function しるし({ 印, 色, 顔 }, 大きさ){
  const c = "印" + (大きさ ? " " + 大きさ : "");
  return 顔
    ? `<img class="${c}" src="${逃(顔)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="${c}" style="background:${色}">${逃(印)}</span>`;
}

const 数字 = (名,値,添え,朱) =>
  `<div class="数字"><div class="名">${名}</div>
   <div class="値"${朱?' style="color:var(--朱)"':''}>${値}</div>
   <div class="添え">${添え}</div></div>`;


/* ============================================================
   列を動かす

   ⚠️ GEMu_Web の実装から、試行錯誤の結論をそのまま引き継いでいる:
     ・**吸い付き（scroll-snap）は使わない。**流し続けると毎こま吸い戻されて震える
     ・**離れたら、その場で動き出す。**待たせると「壊れている」ように見える
     ・**矢印の smooth 送りの最中に scrollLeft を書き換えない。**動きが壊れるので、
       引き戻すのは「流している一こま」と「矢印を押した頭」だけにする
     ・1秒18px。速いと目で追えず、遅いと止まって見える
   ⚠️ 端を無くすため、画面幅を越えるまで札を複製して輪にする。
      複製には .写し を付けて、本物と区別できるようにしておくこと。
   ============================================================ */
const 列たち = new Map();     // id → { 休ませる, 送る }

window.列を送る = (名, 向き)=>{
  const c = 列たち.get(名);
  if(c){ c.送る(向き); c.休ませる(1200); }
};

function 列を仕込む(){
  列たち.clear();
  for(const 列 of 画面.querySelectorAll(".列")){
    const 一枚ぶん = ()=>{
      const 札 = 列.querySelector(".流し札");
      if(!札) return 列.clientWidth;
      const 間 = parseFloat(getComputedStyle(列).columnGap || "18") || 18;
      return 札.getBoundingClientRect().width + 間;
    };

    let 一組の幅 = 0;
    function 輪にする(){
      const 本物 = [...列.querySelectorAll(".流し札:not(.写し)")];
      列.querySelectorAll(".流し札.写し").forEach(e=>e.remove());
      if(本物.length < 2) return false;
      const 間 = parseFloat(getComputedStyle(列).columnGap || "18") || 18;
      一組の幅 = 本物.reduce((合,e)=>合 + e.getBoundingClientRect().width + 間, 0);
      let いま = 一組の幅, i = 0;
      while(いま < 一組の幅 + 列.clientWidth + 一枚ぶん()){
        const 写し = 本物[i % 本物.length].cloneNode(true);
        写し.classList.add("写し");
        写し.setAttribute("aria-hidden","true");
        写し.tabIndex = -1;
        列.appendChild(写し);
        いま += 一枚ぶん(); i++;
        if(i > 60) break;                      // 念のための歯止め
      }
      return true;
    }

    function 位置を戻す(){
      if(!一組の幅) return;
      if(列.scrollLeft >= 一組の幅) 列.scrollLeft -= 一組の幅;
      else if(列.scrollLeft < 0)    列.scrollLeft += 一組の幅;
    }
    const 送る = 向き=>{ 位置を戻す();
      列.scrollTo({ left: 列.scrollLeft + 向き * 一枚ぶん(), behavior:"smooth" }); };

    const 輪になった = 輪にする();
    let 休み = 0;
    const 休ませる = ミリ秒=>{ 休み = ミリ秒 ? Date.now() + ミリ秒 : 0; };
    列たち.set(列.id, { 休ませる, 送る });

    列.addEventListener("mouseenter", ()=>休ませる(60000));
    列.addEventListener("mouseleave", ()=>休ませる(0));
    列.addEventListener("focusin",    ()=>休ませる(60000));
    列.addEventListener("focusout",   ()=>休ませる(0));
    /* ⚠️ 指と巻物は、離してすぐには動かさない。慣性で流れている最中に重ねると喧嘩する */
    列.addEventListener("touchstart", ()=>休ませる(60000), { passive:true });
    列.addEventListener("touchend",   ()=>休ませる(600),   { passive:true });
    列.addEventListener("wheel",      ()=>休ませる(1200),  { passive:true });

    if(!輪になった) continue;
    if(window.matchMedia("(prefers-reduced-motion: reduce)").matches) continue;

    const 秒あたり = 18;
    let 前の時 = 0, 余り = 0;
    function 一こま(いま){
      if(!列.isConnected) return;              // 画面が差し替わったら止める
      const 経った = 前の時 ? Math.min(いま - 前の時, 100) : 0;
      前の時 = いま;
      requestAnimationFrame(一こま);
      if(Date.now() < 休み || document.hidden) return;
      if(列.contains(document.activeElement)) return;
      余り += (秒あたり * 経った) / 1000;
      const 進む = Math.floor(余り);
      if(進む < 1) return;
      余り -= 進む;
      列.scrollLeft += 進む;
      位置を戻す();
    }
    requestAnimationFrame(一こま);
  }
}


/* ── 番付 ─────────────────────────────────
   ⚠️ 追加のクエリを投げていない。トップで既に全件を1回読んでいるので、
      本ごと・主体ごと・人ごとを**同じ読み込みから**出している（共通.js）。
   ⚠️ 人の並びは、**匿名で送った分を名前に使わない。**
      匿名でしか送っていない人は「匿名」のまま並ぶ。 */
const 番付の段 = (題, 行ら, 空の言葉) => `
  <div class="番付">
    <h3>${題}</h3>
    ${行ら.length ? `<ol>${行ら.map(r=>`<li>
      <span class="名">${r.印HTML ? r.印HTML : r.押せる
        ? `<a onclick="go('${r.先頁}',{id:${引数(r.先id)}})">${逃(r.名)}</a>`
        : 逃(r.名)}</span>
      <span class="額">${r.値.toLocaleString()}<i>${r.単位}</i></span>
    </li>`).join("")}</ol>`
    : `<p class="節の注" style="margin:10px 0 0">${空の言葉}</p>`}
  </div>`;

/* ⚠️ 番付は上下の二段（2026-09-24）。推されている側（本・著者・出版社）と、
      推している側（読書家）を1行に混ぜると、物差しを足したときに読めなくなるため。
      上の段は**ポイントだけ**で並べる（2026-09-24、持ち主の判断で 人数・ことば の切り替えを外した。
      戻すときは 共通.js の 本の物差し と 番付() に物差しを足す）。
      下の段は、ポイント・ことば・棚づくりの3つを並べて、それぞれの形の参加に1位がいることを見せる。 */
function 番付たち(順){
  return 推されている本(順) + 熱心な読書家(順);
}

function 推されている本(順){
  if(!順) return "";
  const 差 = 順.物差し;
  const 値 = x => ({ 値:x[差.項] || 0, 単位:差.単位 });
  const 主体行 = ら => ら.map(e=>({ 名:e.主体.名, ...値(e), 押せる:true,
                                   先頁:"entity", 先id:e.id }));
  return `
  <section class="節">
    ${節の頭("いま推されている本", "返されたポイントの多い順")}
    <div class="番付たち">
      ${番付の段("本", 順.本.map(b=>({ 名:b.本.題, ...値(b), 押せる:true,
                                      先頁:"book", 先id:b.id })), "まだありません")}
      ${番付の段("著者", 主体行(順.著者), "まだありません")}
      ${番付の段("出版社", 主体行(順.出版社), "まだありません")}
    </div>
  </section>`;
}

function 熱心な読書家(順){
  if(!順) return "";
  return `
  <section class="節">
    ${節の頭("熱心な読書家", "ポイント・ことば・棚づくり、それぞれの形で本の世界を支えている人")}
    <div class="番付たち">
      ${順.読書家.map(m=>番付の段(m.名,
          m.行ら.map(u=>({ 値:u[m.項] || 0, 単位:m.単位, 印HTML: 読書家の名(u.id, u.名) })),
          "まだありません")).join("")}
    </div>
  </section>`;
}

/* ============================================================
   頁：主体（著者・出版社・書店）

   ⚠️ 番付から押した先。ここが無いと番付が行き止まりになる。
   ⚠️ returns は公開読み取りなので、入っていなくても受け取った額と声を出す。
   ============================================================ */
async function 頁_主体(){
  const e = 土台.主体表.get(現在.id);
  if(!e) return `<div class="節"><div class="断り">その相手は見つかりませんでした。
    <button class="釦 枠だけ 小" style="margin-left:10px" onclick="go('home')">トップへ</button></div></div>`;

  const 本ら = 土台.蔵書.filter(b=>b.受取.some(r=>r.id === 現在.id));
  const [{ 明細, 合計 }, 声あり] = await Promise.all([
    受取人の受取(現在.id), 土台.主体へのことば(現在.id)]);

  return `
  <section class="幕">
    <p class="英字の札">${e.型 === "author" ? "Author" : e.型 === "publisher" ? "Publisher" : "Store"}</p>
    <h1 class="大見出し" style="font-size:clamp(26px,3.6vw,38px)">${逃(e.名)}</h1>
    <p class="導き">${逃(土台.種の名[e.型] || e.型)}　${本ら.length}冊
      ${e.認証 ? '<span class="札 済">認証済</span>' : '<span class="札 藤">引き継ぎ待ち</span>'}</p>
    ${e.認証 ? "" : `<div class="断り" style="margin-top:20px;max-width:58ch">
      このページは、まだ本人・関係者に引き継がれていません。
      いまは架空のポイントで試しているため、届いた分をここに記録しています。
      本物のお金を扱うときは、引き継がれた相手にだけお渡しします。</div>`}
    <div class="数字たち">
      ${数字("Received", 合計.toLocaleString(), `受け取ったポイント（支払われたポイントの${受取率の百分率}%）`, true)}
      ${数字("Thanks", 明細.length, "届いた本返し")}
      ${数字("Books", 本ら.length, "この相手の本")}
    </div>
  </section>

  <section class="節" style="padding-top:18px">
    <p class="節の注" style="margin:0">
      <a onclick="訂正を開く(null, ${引数(現在.id)})">名前の表記や、この相手の本の間違いを知らせる</a></p>
  </section>

  ${流れる列("この相手の本", `${本ら.length}冊`, 本ら, null, false)}

  <section class="節">
    ${節の頭("読者からの声", 声あり.length + "件")}
    <div class="声の列">
      ${声あり.length ? 声あり.map(v=>声の行(v, true)).join("")
        : '<p class="節の注" style="padding:20px 0">まだありません。</p>'}
    </div>
  </section>`;
}

/* ============================================================
   頁：さがす
   ============================================================ */
async function 頁_さがす(){
  /* ⚠️ **未ログインでも、ほぼ全部見せる。**本・主体・返し・残しはすべて公開読み取り。
        入っている人にしか出さないのは「あなたの残高」と、本返しのボタンだけ。
        リンクを共有されたときに入口しか見えないのは、参加してもらう上で損。 */
  const 入ってる = !!土台.私;
  const q = (現在.q||"").trim();
  /* ⚠️ returns / keeps は公開読み取りにしたので、**入っていなくても数えられる。**
        入っている人にだけ出すのは「あなたの残高」だけ。 */
  const [数, 全体, 新着] = await Promise.all([
    まとめて数える(), 全体の集計(), 最近の声(5)
  ]);
  const 表 = 数.本;
  const 順 = 番付(数, 3);
  const 一覧 = q ? 土台.蔵書.filter(b=>(b.題+b.著+b.版元).includes(q)) : 土台.蔵書;

  return `
  ${看板()}
  <section class="幕">
    <p class="英字の札">Return to books</p>
    <h1 class="大見出し">読んだあとに、<br>ありがとうを。</h1>
    <p class="導き">買うだけでは届かなかった気持ちを、著者・出版社・書店へ。
      図書館で借りた本も、古本で買った本も、昔もらった本も。
      <b style="color:var(--朱);font-weight:600">100ptから返せます。</b></p>
    <form class="さがす" style="margin-top:34px" onsubmit="event.preventDefault();go('home',{q:this.q.value})">
      <input name="q" placeholder="書名・著者名で探す" value="${逃(q)}">
      <button type="submit">さがす</button>
    </form>
    <p class="節の注" style="margin-top:14px"><a onclick="go('books')">本の一覧を見る</a></p>
    ${棚の育ち()}
    ${/* ⚠️ ここはサービス全体の数字だけ（2026-09-24）。自分の残高は上の帯とマイページに出ている。
          冊数はすぐ上の「いま○冊」と重なるので出さない。
          ⚠️ 「届いた分」は受取人に渡る9割。前は支払額の合計をそのまま出していて、見出しと合っていなかった */ ""}
    <div class="数字たち">
      ${数字("Returned", 受取人へ(全体.金額).toLocaleString(), "本の世界へ届いた分（pt）", true)}
      ${数字("Voices", 全体.ことば.toLocaleString(), "届いたことば")}
      ${数字("Revive", 全体.残数.toLocaleString(), "復刊を願う")}
    </div>
  </section>

  ${q ? `
  <section class="節">
    ${節の頭(`「${逃(q)}」の結果`, 一覧.length+"冊")}
    <div class="本の列">${一覧.map(b=>本の札(b,表[b.id])).join("")
      || `<div style="padding:30px 0">
            <p class="節の注" style="margin:0 0 16px">見つかりませんでした。</p>
            ${申請ボタン()}</div>`}</div>
  </section>` : `
  ${番付たち(順)}
  ${/* 「ありがとうが集まっている本」の流れる列は外した（2026-09-23）。
       すぐ上の番付と中身が重なり、冊数が少ないと同じ本が繰り返し流れて見えたため */ ""}
  ${/* 並びは 番付 → 新しく入った本 → 声（2026-09-24、持ち主の指定で声と入れ替えた） */ ""}
  ${流れる列("新しく入った本", "直近に登録された30冊",
      [...土台.蔵書].sort((a,b)=>String(b.登録日||"").localeCompare(String(a.登録日||"")))
        .slice(0,30), 表, "登録")}
  <section class="節" style="padding-top:44px">
    <a class="釦 枠だけ" onclick="go('books')">本の一覧をぜんぶ見る（${土台.蔵書.length}冊）</a>
  </section>
  <section class="節">
    ${節の頭("最近、届いた声", "購買データでは取れない、読後の言葉")}
    <div class="声の列">
      ${新着.length ? 新着.map(v=>声の行(v,true)).join("")
        : '<p class="節の注" style="padding:20px 0">まだありません。最初の1件を書いてみてください。</p>'}
    </div>
  </section>
  ${入ってる ? "" : 入るとこうなる()}`}`;
}

/* ============================================================
   頁：本の一覧

   ⚠️ トップは流れる列だけにしてあるので、**全部を見る場所がここ。**
      冊数が増えたら、ここに絞り込み（出版社・著者・年代）を足す。
      並べ替えは手元でやる。いまの冊数なら十分で、
      Firestore の複合インデックスを増やさずに済む。
   ============================================================ */
async function 頁_一覧(){
  const q = (現在.q || "").trim();
  const 並び = 現在.並び || "年";
  /* ⚠️ returns / keeps は公開読み取り。**入っていなくても数える。**
        前は入っている人だけ数えていて、未ログインだと「返された分」の並べ替えが
        全冊 0pt になっていた（2026-09-23 に直した。トップの番付と同じ作りにそろえた） */
  const 表 = (await まとめて数える()).本;

  let 本ら = [...土台.蔵書];
  if(q) 本ら = 本ら.filter(b=>(b.題 + b.著 + b.版元 + (b.副題||"")).includes(q));
  const 並べ方 = {
    登録: (a,b)=>String(b.登録日||"").localeCompare(String(a.登録日||"")),
    年:   (a,b)=>(b.年||0) - (a.年||0),
    額:   (a,b)=>(表[b.id]?.金額||0) - (表[a.id]?.金額||0),
    題:   (a,b)=>a.題.localeCompare(b.題, "ja"),
    頁:   (a,b)=>(b.頁||0) - (a.頁||0)
  };
  本ら.sort(並べ方[並び] || 並べ方.年);

  return `
  <section class="幕">
    <p class="英字の札">All books</p>
    <h1 class="大見出し" style="font-size:clamp(25px,3.2vw,34px)">本の一覧</h1>
    <p class="導き">本返しで扱っている本。ここに無ければ、下から知らせてください。</p>
    <form class="さがす" style="margin-top:30px"
      onsubmit="event.preventDefault();go('books',{q:this.q.value,並び:${引数(並び)}})">
      <input name="q" placeholder="書名・著者・出版社でしぼる" value="${逃(q)}">
      <button type="submit">しぼる</button>
    </form>
    ${棚の育ち()}
  </section>

  <section class="節">
    <div class="節の頭">
      <h2 class="節見出し">${q ? `「${逃(q)}」` : "すべて"}</h2>
      <p class="節の添え">${本ら.length}冊</p>
    </div>
    <div style="display:flex;gap:7px;flex-wrap:wrap;margin:16px 0 4px">
      <span class="節の注" style="margin:0 6px 0 0;align-self:center">並び</span>
      ${並びの札.map(([k,l])=>`<button class="釦 ${並び===k?'':'枠だけ'} 小"
          onclick="go('books',{q:${引数(q)},並び:'${k}'})">${l}</button>`).join("")}
    </div>
    <div class="本の列" style="margin-top:14px">
      ${本ら.length ? 本ら.map(b=>本の札(b, 表[b.id])).join("")
        : `<div style="padding:30px 0">
             <p class="節の注" style="margin:0 0 16px">見つかりませんでした。</p>
             ${申請ボタン()}</div>`}
    </div>
  </section>

  <section class="節">
    ${節の頭("さがしている本がありませんか", "読んだ本を棚に加えられます")}
    <p class="節の注" style="max-width:58ch">
      書名・著者名・出版社名を教えていただければ、確認のうえ棚に並べます。
      ISBN が分かれば、その場で書誌を確かめられます。</p>
    <button class="釦" style="margin-top:18px"
      onclick="${土台.私 ? "申請を始める()" : "ログイン()"}">
      ${土台.私 ? "読んだ本を棚に加える" : "入って、読んだ本を棚に加える"}</button>
  </section>`;
}

/* 入っていない人に見せる案内。
   ⚠️ 前は画面ごと乗っ取って棚を隠していた。共有リンクで来た人が、
      何のサービスか分からないまま入口に立たされるので、やめた。
      いまは棚を見せたうえで、この案内を差し込むだけにしている。 */
/* 入らないと見られない画面（自分の記録・受取人の控え）の案内 */
function 入るには(){
  return `<div class="節"><div class="断り" style="margin-top:40px">
    この画面は、入ってから見られます。
    <button class="釦 枠だけ 小" style="margin-left:12px" onclick="ログイン()">Googleで入る</button>
    </div></div>`;
}

function 入るとこうなる(){
  return `
  <div class="入口" style="padding-top:44px">
    <div>
      <p class="英字の札">About</p>
      <h1 class="大見出し" style="font-size:clamp(25px,3.2vw,34px)">本を買うだけでは、<br>届かない気持ちがある。</h1>
      <p class="導き">図書館で借りた本。古本で買った本。人からもらった本。
        読んで確かに何かをもらったのに、その感謝が著者にも、出版社にも、書店にも届かないまま終わる。
        本返しは、読み終わったあとに気持ちを返すための場所です。</p>
      <p class="導き" style="margin-top:22px">
        いまは<b style="color:var(--字)">架空のポイントで試している段階</b>で、実際のお金は一切動きません。
        本物のお金を扱う前に、読後に誰かへ気持ちを託すという行いが本当に起きるのかを確かめています。</p>
    </div>
    <div class="わけ">
      <p class="名札" style="margin-top:0">入ると、こうなります</p>
      <div class="内訳" style="border-top:none;margin-top:10px;padding-top:0">
        <div class="行"><span>はじめに配られる</span><b style="color:var(--朱)">10,000</b></div>
        <div class="行"><span>毎月ふたたび配られる</span><span>3,000</span></div>
        <div class="行 薄"><span>換金・購入</span><span>できません</span></div>
        <div class="行 締め"><span>実際のお金</span><span>0円</span></div>
      </div>
      <button class="釦 全幅" style="margin-top:26px" onclick="ログイン()">Googleで入る</button>
      <p class="節の注" style="margin-top:12px">
        お名前とアイコンだけ使います。<a onclick="go('about')">しくみを読む</a></p>
    </div>
  </div>`;
}

/* ============================================================
   頁：本
   ============================================================ */
async function 頁_本(){
  const 入ってる = !!土台.私;      // ⚠️ 入っていなくても本は見せる。声と本返しだけ求める
  const b = 本を引く(現在.id);
  if(!b) return `<div class="節"><div class="断り">その本は見つかりませんでした。
    <button class="釦 枠だけ 小" style="margin-left:10px" onclick="go('home')">トップへ</button></div></div>`;

  /* ⚠️ returns / keeps は公開読み取り。**入っていなくても集計と声が出る。** */
  const [s, 声たち, 自分の声] = await Promise.all([本の集計(b.id), 本の声(b.id), 土台.私のことば(b.id)]);
  const 受 = 届け先(b);
  /* ⚠️ ことばだけでも推せる（ポイント不要）。1冊に1つなので、あれば「直す」 */
  const ことばの釦 = !入ってる
    ? `<button class="釦 枠だけ" onclick="ログイン()">入ってことばを書く</button>`
    : `<button class="釦 枠だけ" onclick="ことばを開く(${引数(b.id)})">${自分の声 ? "自分のことばを直す" : "ことばを書く"}</button>`;

  return `
  <div class="本の頭">
    <div class="書影 大" style="background:linear-gradient(155deg,${b.色},${b.色}bb)">
      ${表紙img(b)}
      <span>${逃(b.題)}</span></div>
    <div style="flex:1;min-width:0">
      <p class="英字の札" style="margin-bottom:12px">${b.状態==="絶版"?"Out of stock":"In print"}</p>
      <h1 class="本の題">${逃(b.題)}</h1>
      ${b.副題 ? `<p class="本の副題">${逃(b.副題)}</p>` : ""}
      <p class="本の素性" style="font-size:12.5px;margin-top:12px">
        ${逃(b.著)}<br>${版元と年(b)}${b.頁?`　${b.頁}ページ`:""}${b.isbn?`<br>ISBN ${b.isbn}`:""}</p>
      ${/* 申請した人を讃える。⚠️ 名前を出すのは、読書家のページを公開している人だけ */
        b.申請者 && 土台.公開か(b.申請者) ? `<p class="申請の礼">
          ${読書家の名(b.申請者, 土台.名を引く(b.申請者))} さんの申請で、棚に並びました</p>` : ""}
      <div style="margin-top:14px;display:flex;gap:7px;flex-wrap:wrap">
        ${b.状態==="絶版"
          ? `<span class="札 注">品切れ</span>${状態の添え(b)}`
          : '<span class="札 済">流通中</span>'}
        ${受.length?"":'<span class="札 注">届け先なし</span>'}
      </div>
      <div style="margin-top:26px;display:flex;gap:10px;flex-wrap:wrap">
        ${/* ⚠️ 「復刊を願う」は**絶版の本だけ**（2026-09-24）。前は「残したい」の名で流通中の本にも出ていて、
              「今買える本を残すとは？」と意味が伝わらなかった。流通中の本は本返しとことばで推せる */ ""}
        ${受.length ? (入ってる
          ? `<button class="釦 朱" onclick="返し始め(${引数(b.id)})">この本に本返しする</button>`
          : `<button class="釦 朱" onclick="ログイン()">入って本返しする</button>`) : ""}
        ${b.状態==="絶版" ? (入ってる
          ? `<button class="釦 ${受.length?'枠だけ':'藤'}" onclick="残し始め(${引数(b.id)})">復刊を願う</button>`
          : `<button class="釦 ${受.length?'枠だけ':'藤'}" onclick="ログイン()">入って復刊を願う</button>`) : ""}
        ${ことばの釦}
      </div>
      ${b.状態==="絶版" ? `<p class="節の注" style="margin-top:10px">
        「復刊を願う」はポイントを動かしません。復刊したら払いたい額を記録し、出版社に示します。</p>` : ""}
      ${b.Amazonら.length ? `<p style="margin-top:18px;display:flex;gap:9px;align-items:center;flex-wrap:wrap">
        ${b.Amazonら.map(a=>`<a href="${逃(a.url)}" target="_blank" rel="noopener sponsored nofollow"
           class="外へ">Amazonで見る${a.label?`　${逃(a.label)}`:""}</a>`).join("")}
        <span class="節の注" style="display:inline;margin:0">広告リンクです</span></p>` : ""}
      ${受.length?"":`<div class="断り" style="margin-top:22px">
        この本には、まだ受取人が登録されていません。<b>ポイントも受け取りません。</b>
        ことば${b.状態==="絶版" ? "と「復刊したら払いたい額」" : ""}だけを記録します。</div>`}
      <p class="節の注" style="margin-top:18px">
        <a onclick="訂正を開く(${引数(b.id)}, null)">書誌や表紙、品切れの判定などの間違いを知らせる</a></p>
    </div>
  </div>

  <div class="数字たち" style="margin-top:44px">
    ${数字("Thanks", s.人数.toLocaleString(), "本返しした人")}
    ${数字("Returned", pt(s.金額).replace("pt",""), "この本から返った分（pt）", true)}
    ${数字("Voices", 声たち.length.toLocaleString(), "読後のことば")}
    ${数字("Revive", s.残数.toLocaleString(), s.約額?`復刊を願う（${pt(s.約額)}の意思）`:"復刊を願う")}
  </div>

  <section class="節">
    ${節の頭("この本を支える人たち", "応援する対象は本、受け取るのは人")}
    <div class="受取の列">
      ${(b.受取||[]).length ? b.受取.map(r=>`
        <div class="受取の行">
          <div class="顔">${逃(r.種[0])}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14.5px;font-weight:600;letter-spacing:.03em">
              <a onclick="go('entity',{id:${引数(r.id)}})">${逃(r.名)}</a></div>
            <div class="本の素性" style="margin-top:2px">${逃(r.種)}</div>
          </div>
          ${r.認証 ? '<span class="札 済">認証済</span>' : '<span class="札 藤">引き継ぎ待ち</span>'}
        </div>`).join("")
      : `<div class="受取の行"><div style="flex:1" class="本の素性">登録されている受取人は、まだいません。</div></div>`}
    </div>
  </section>

  <section class="節">
    ${節の頭("読者からの声", 声たち.length+"件")}
    <div class="声の列">
      ${声たち.length ? 声たち.map(v=>声の行(v)).join("")
        : '<p class="節の注" style="padding:20px 0">まだ声はありません。ポイントを返さなくても、ことばだけで推せます。</p>'}
    </div>
  </section>`;
}

/* ============================================================
   覆い：間違いを知らせる（訂正の連絡）

   ⚠️ 本か相手（著者・出版社）のどちらかについて。入っている人だけ（いたずら除け）。
      届くと運営にメールが飛ぶ（functions/index.js の notifyReport）。
   ============================================================ */
let R = {};
window.訂正を開く = (本id, 主体id)=>{
  if(!土台.私){ ログイン(); return; }
  R = { 本:本id || null, 主体:主体id || null, 種類:土台.訂正の種類[0], 文:"", 送信中:false, 済:false };
  訂正描く();
};
window.訂正の種類を選ぶ = v=>{ R.種類 = v; };
window.訂正の文 = v=>{ R.文 = v; };      // ⚠️ 描き直さない（打ちかけを消さない）

function 訂正描く(){
  const 何 = R.本 ? `『${逃(本を引く(R.本)?.題 || R.本)}』`
            : R.主体 ? `「${逃(土台.主体表.get(R.主体)?.名 || R.主体)}」` : "本返し";
  if(R.済) return 窓を出す("", `<div class="終い">
      <div class="印">✉</div>
      <h3 style="font-size:19px;margin:16px 0 10px;font-weight:600;letter-spacing:.09em">受け取りました</h3>
      <p class="節の注" style="margin:0">運営が確かめて直します。知らせてくださって、ありがとうございます。</p>
      <button class="釦 全幅" style="margin-top:26px" onclick="覆い閉じ()">閉じる</button></div>`);
  窓を出す("間違いを知らせる", `
    <p class="節の注" style="margin:0">${何}について、間違いや気づいたことを運営に知らせます。</p>
    <p class="名札">なにが違いますか</p>
    <select class="欄" id="訂正の種類" onchange="訂正の種類を選ぶ(this.value)">
      ${土台.訂正の種類.map(k=>`<option ${k===R.種類?"selected":""}>${逃(k)}</option>`).join("")}
    </select>
    <p class="名札">どう違うか（正しい内容が分かれば、あわせて）</p>
    <textarea class="欄" id="訂正の文" maxlength="1000"
      placeholder="例）著者名の漢字が違います。正しくは「〇〇」です。"
      oninput="訂正の文(this.value)">${逃(R.文)}</textarea>
    <p class="節の注">公開はされません。運営だけが読みます。</p>
    <button class="釦 全幅" style="margin-top:18px" ${R.送信中?"disabled":""} onclick="訂正を送る()">
      ${R.送信中 ? "送っています…" : "知らせる"}</button>`);
}

window.訂正を送る = async ()=>{
  if(R.送信中) return;
  R.文 = document.getElementById("訂正の文")?.value ?? R.文;      // ⚠️ 送る直前に画面から読む
  R.種類 = document.getElementById("訂正の種類")?.value || R.種類;
  if(!R.文.trim()){ 知らせる("どう違うかを書いてください", true); return; }
  R.送信中 = true; 訂正描く();
  try{
    await 土台.訂正を知らせる({ 本id:R.本, 主体id:R.主体, 種類:R.種類, 文:R.文 });
    R.送信中 = false; R.済 = true; 訂正描く();
  }catch(e){
    R.送信中 = false; 訂正描く();
    console.error(e); 知らせる("送れませんでした：" + (e.code||e.message), true);
  }
};

/* ============================================================
   覆い：ことばを書く・直す

   ⚠️ ポイントは動かない。1冊に1人1つ。あれば直す（直した日が小さく出る）・消せる。
   ============================================================ */
let W = {};
window.ことばを開く = async id=>{
  const 今 = await 土台.私のことば(id);
  W = { 本:id, 文:今?.文 || "", 匿:!!今?.匿, あり:!!今, 送信中:false };
  ことば描く();
};
window.ことばの文 = v=>{ W.文 = v; };     // ⚠️ 描き直さない（打ちかけを消さない）

function ことば描く(){
  const b = 本を引く(W.本);
  窓を出す(W.あり ? "自分のことばを直す" : "この本へのことば", `
    <p class="節の注" style="margin:0">『${逃(b?.題 || W.本)}』を読んで、伝えたいことを。
      <b style="color:var(--字)">ポイントは動きません。</b>1冊にひとつ、あとから直せます。</p>
    <textarea class="欄" id="ことばの文" maxlength="${土台.ことばの長さ}" style="margin-top:14px"
      placeholder="例）高校生の頃に読んで、進路を決めました。"
      oninput="ことばの文(this.value)">${逃(W.文)}</textarea>
    <label style="display:flex;align-items:center;gap:10px;margin-top:14px;
      font-family:var(--ゴシック);font-size:12px;color:var(--字の薄い);cursor:pointer">
      <input type="checkbox" id="ことばの匿" ${W.匿?"checked":""}> 匿名で届ける
    </label>
    <p class="節の注">本のページに公開されます。</p>
    <button class="釦 全幅" style="margin-top:18px" ${W.送信中?"disabled":""} onclick="ことばを保存()">
      ${W.送信中 ? "保存しています…" : W.あり ? "直す" : "ことばを届ける"}</button>
    ${W.あり ? `<button class="釦 枠だけ 全幅" style="margin-top:10px" ${W.送信中?"disabled":""}
      onclick="ことばを取り下げる()">このことばを消す</button>` : ""}`);
}

window.ことばを保存 = async ()=>{
  if(W.送信中) return;
  W.文 = document.getElementById("ことばの文")?.value ?? W.文;      // ⚠️ 送る直前に画面から読む
  W.匿 = !!document.getElementById("ことばの匿")?.checked;
  if(!W.文.trim()){ 知らせる("ことばを入れてください", true); return; }
  W.送信中 = true; ことば描く();
  try{
    await 土台.ことばを書く({ 本id:W.本, 文:W.文, 匿:W.匿 });
    覆い閉じ(); 知らせる(W.あり ? "直しました" : "ことばを届けました"); 描く();
  }catch(e){
    W.送信中 = false; ことば描く();
    console.error(e); 知らせる("届けられませんでした：" + (e.code||e.message), true);
  }
};

window.ことばを取り下げる = async ()=>{
  if(W.送信中 || !confirm("このことばを消します。よろしいですか？")) return;
  W.送信中 = true; ことば描く();
  try{
    await 土台.ことばを消す(W.本);
    覆い閉じ(); 知らせる("消しました"); 描く();
  }catch(e){
    W.送信中 = false; ことば描く();
    console.error(e); 知らせる("消せませんでした：" + (e.code||e.message), true);
  }
};

/* ============================================================
   覆い：本返しする
   ============================================================ */
let F = {};

/* 100% を人数で割る。割り切れない分は最初の人へ（3人なら 34・33・33） */
const 均等な配分 = ids => Object.fromEntries(
  ids.map((id,i)=>[id, Math.floor(100/ids.length) + (i===0 ? 100%ids.length : 0)]));

window.返し始め = async id=>{
  const b = 本を引く(id), 受 = 届け先(b);
  F = { 本:id, 段:1, 額:既定額, 自由:"", 文:"", 匿:false, 送信中:false,
        配分:均等な配分(受.map(r=>r.id)),
        /* ⚠️ ことばは1冊に1つ。もう書いてあれば、3段目では書かせず「直す」へ案内する */
        ことばあり: !!(await 土台.私のことば(id).catch(()=>null)) };
  返し描く();
};
window.額指定 = v=>{ F.額=v; F.自由=""; 返し描く(); };
window.額自由 = v=>{ F.自由=v; const n=parseInt(v.replace(/[^0-9]/g,""),10); F.額=isNaN(n)?0:n; 返し描く(true); };
window.配分変更 = (id,v)=>{ F.配分[id]=+v; 返し描く(); };
window.均等 = ()=>{ F.配分 = 均等な配分(Object.keys(F.配分)); 返し描く(); };
window.段へ = n=>{ F.段=n; 返し描く(); };

/* ⚠️⚠️ **インラインの on... は、グローバルスコープで動く。**
   app.js は type="module" なので、モジュールの中の F / K は**そこから見えない。**
   前は oninput="F.文=this.value" と直に書いていて、
   ReferenceError になり、**ことばと匿名だけが黙って捨てられていた**
   （金額は window.額指定 を通っていたので気づけなかった。2026-09-23に判明）。
   → 値を入れるものも、必ず window に出した関数を通すこと。 */
window.文を書く   = v=>{ F.文 = v; };
window.匿を決める = v=>{ F.匿 = v; };
const 配分計 = ()=> Object.values(F.配分).reduce((a,b)=>a+b,0);

function 返し描く(自由に){
  const b = 本を引く(F.本), 受 = 届け先(b);
  const 額 = F.額||0, 残高 = 土台.財布?.残高 ?? 0;
  const { 決, 運, 本へ } = 額の内訳(額);
  /* ⚠️ 受取人ごとの額は、送るときと同じ 内訳を作る() → 受取人へ() で出す。
        控えに載る額と、ここで見せる額を必ず一致させるため */
  const 内訳 = 内訳を作る(額, 受, F.配分);
  const 見込み = id => 受取人へ(内訳.find(x=>x.受取人 === id)?.額);
  const 足りない = 額 > 残高;
  let 中 = "";

  if(F.段===1){
    中 = `
      <p class="節の注" style="margin:0">『${逃(b.題)}』に、いくら返しますか。　残高 ${残高.toLocaleString()}pt</p>
      <div class="金額たち">
        ${[100,300,500,1000,3000,5000].map(v=>
          `<button class="${!F.自由&&F.額===v?'いま':''}" ${v>残高?"disabled":""} onclick="額指定(${v})">${v.toLocaleString()}</button>`).join("")}
      </div>
      <input class="欄" id="自由額" inputmode="numeric" placeholder="自由なポイント（100〜${Math.min(50000,残高).toLocaleString()}pt）"
        value="${逃(F.自由)}" oninput="額自由(this.value)">
      <div class="内訳">
        <div class="帯グラフ">
          <div style="width:${額?本へ/額*100:0}%;background:var(--朱)"></div>
          <div style="width:${額?決/額*100:0}%;background:var(--罫の濃い)"></div>
          <div style="width:${額?運/額*100:0}%;background:var(--灯)"></div>
        </div>
        <div class="行"><span>本の世界へ届く分</span><b style="color:var(--朱)">${本へ.toLocaleString()}</b></div>
        <div class="行 薄"><span>決済手数料ぶん（約5%）</span><span>${決.toLocaleString()}</span></div>
        <div class="行 薄"><span>本返しの運営（5%）</span><span>${運.toLocaleString()}</span></div>
        <div class="行 締め"><span>お支払い</span><span>${額.toLocaleString()} pt</span></div>
      </div>
      ${足りない?`<p class="節の注" style="color:var(--朱)">残高が足りません。</p>`:""}
      ${額>0&&額<300&&!足りない?`<p class="節の注">
        少額は決済の固定費が重くなるため、本物のお金にするときは数件まとめて決済する方式を想定しています。</p>`:""}
      <button class="釦 朱 全幅" style="margin-top:22px"
        ${額<100||額>50000||足りない?"disabled":""} onclick="段へ(2)">届け先をえらぶ</button>`;
  }

  if(F.段===2){
    const 計 = 配分計();
    中 = `
      <p class="節の注" style="margin:0 0 6px">${本へ.toLocaleString()}pt を、誰に届けますか。</p>
      ${受.map(r=>`<div class="配る">
        <div class="名">${逃(r.名)}<br><span class="種">${逃(r.種)}</span></div>
        <input type="range" min="0" max="100" step="5" value="${F.配分[r.id]}" oninput="配分変更(${引数(r.id)},this.value)">
        <div class="率">${F.配分[r.id]}%</div>
        <div class="率" style="width:56px;color:var(--朱);font-family:var(--明朝);font-size:14px">
          ${見込み(r.id).toLocaleString()}</div>
      </div>`).join("")}
      <div style="display:flex;align-items:center;gap:14px;margin-top:16px">
        <button class="釦 枠だけ 小" onclick="均等()">均等にする</button>
        <span class="節の注" style="margin:0;${計===100?'':'color:var(--朱)'}">
          合計 ${計}%${計===100?"":" ― 100%にしてください"}</span>
      </div>
      <div style="display:flex;gap:10px;margin-top:26px">
        <button class="釦 枠だけ" onclick="段へ(1)">戻る</button>
        <button class="釦" style="flex:1" ${計===100?"":"disabled"} onclick="段へ(3)">ことばを添える</button>
      </div>`;
  }

  if(F.段===3){
    中 = `
      ${F.ことばあり
        ? `<p class="節の注" style="margin:0 0 10px">この本には、もうあなたのことばがあります（1冊にひとつ）。
             直したいときは、本のページの「自分のことばを直す」から。</p>`
        : `<p class="節の注" style="margin:0 0 10px">この本に伝えたいことを。（任意・本のページに公開されます）</p>
      <textarea class="欄" id="返しの文" maxlength="${土台.ことばの長さ}" placeholder="例）高校生の頃に読んで、進路を決めました。"
        oninput="文を書く(this.value)">${逃(F.文)}</textarea>`}
      <label style="display:flex;align-items:center;gap:10px;margin-top:16px;
        font-family:var(--ゴシック);font-size:12px;color:var(--字の薄い);cursor:pointer">
        <input type="checkbox" id="返しの匿" ${F.匿?"checked":""} onchange="匿を決める(this.checked)"> 匿名で届ける
      </label>
      <div class="内訳">
        <div class="行"><span>お支払い</span><b>${額.toLocaleString()}</b></div>
        ${内訳.map(x=>
          `<div class="行 薄"><span>${逃(x.名)}</span><span>${受取人へ(x.額).toLocaleString()} pt</span></div>`).join("")}
        <div class="行 薄"><span>決済＋運営</span><span>${(決+運).toLocaleString()} pt</span></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:24px">
        <button class="釦 枠だけ" ${F.送信中?"disabled":""} onclick="段へ(2)">戻る</button>
        <button class="釦 朱" style="flex:1" ${F.送信中?"disabled":""} onclick="返し確定()">
          ${F.送信中?"送っています…":"本返しする"}</button>
      </div>
      <p class="節の注" style="text-align:center">架空のポイントです。実際のお金は動きません</p>`;
  }

  if(F.段===4){
    中 = `<div class="終い">
      <div class="印">🕊</div>
      <h3 style="font-size:19px;margin:16px 0 10px;font-weight:600;letter-spacing:.09em">本返し、届きました</h3>
      <p class="節の注" style="margin:0">『${逃(b.題)}』へ ${額.toLocaleString()}pt<br>
        <b style="color:var(--朱);font-family:var(--明朝);font-size:15px">${本へ.toLocaleString()}pt</b> が本の世界へ渡ります<br>
        残り ${(土台.財布?.残高??0).toLocaleString()}pt</p>
      <button class="釦 全幅" style="margin-top:26px" onclick="覆い閉じ();location.reload()">本のページへ戻る</button>
      ${/* ⚠️ 控えは①管理者と②受取人しか開けない。③利用者に出すと行き止まりになる（帯と同じ条件） */
        土台.権限.管理者 || 土台.権限.受取人.length
        ? `<button class="釦 枠だけ 全幅" style="margin-top:10px" onclick="覆い閉じ();go('receiver')">受取人の控えを見る</button>` : ""}
    </div>`;
  }

  窓を出す(F.段===4 ? "" : "この本に本返しする", 中,
    F.段<4 ? `<div class="段">${[1,2,3].map(i=>`<div class="${F.段>=i?'いま':''}"></div>`).join("")}</div>` : "");

  if(自由に){ const t=document.getElementById("自由額");
    if(t&&F.段===1){ t.focus(); t.setSelectionRange(t.value.length,t.value.length); } }
}

window.返し確定 = async ()=>{
  if(F.送信中) return;

  /* ⚠️ **送る直前に、画面から直に読む。**
     oninput だけに頼ると、日本語入力を確定しないままボタンを押されたときに
     取りこぼす余地が残る。ここで読めば、何があっても画面に見えている値が送られる。 */
  const 文欄 = document.getElementById("返しの文");
  if(文欄) F.文 = 文欄.value;
  const 匿欄 = document.getElementById("返しの匿");
  if(匿欄) F.匿 = 匿欄.checked;

  // ⚠️ 合計が 額 とずれると firestore.rules に弾かれる。内訳を作る() が最初の行で吸収する
  const 内訳 = 内訳を作る(F.額, 届け先(本を引く(F.本)), F.配分);
  if(内訳.some(x=>x.額<=0)){ 知らせる("配分が細かすぎます。均等にしてください", true); return; }

  F.送信中 = true; 返し描く();
  try{
    await 本返しする({ 本id:F.本, 額:F.額, 内訳, 匿:F.匿 });
    /* ことばは voices へ別に書く（1冊に1つ）。⚠️ 本返しはもう通っているので、
       ことばだけ失敗しても本返しは取り消さない。知らせて、本のページから書き直してもらう */
    if(!F.ことばあり && F.文.trim()){
      try{ await 土台.ことばを書く({ 本id:F.本, 文:F.文, 匿:F.匿 }); }
      catch(e){ console.error(e); 知らせる("本返しは届きました。ことばだけ届けられませんでした。本のページから書いてください", true); }
    }
    F.送信中 = false; 段へ(4); 帯を描く();
  }catch(e){
    F.送信中 = false; 返し描く();
    console.error(e);
    知らせる(e.code==="permission-denied"
      ? "残高が合いませんでした。開き直してからもう一度お試しください" : "送れませんでした", true);
  }
};

/* ============================================================
   覆い：復刊を願う（ポイントは動かない）
   ⚠️ 画面での名前は「復刊を願う」（2026-09-24 に「残したい」から改めた）。
      記録は今までどおり keeps、関数も 残したい / 残し始め のまま（中の名前は変えていない）
   ============================================================ */
let K = {};
window.残し始め = async id=>{
  K={ 本:id, 約:1000, 文:"", 済:false, 送信中:false,
      ことばあり: !!(await 土台.私のことば(id).catch(()=>null)) };   // ⚠️ 返し始め と同じ
  残し描く();
};
window.約指定 = v=>{ K.約=v; 残し描く(); };
window.残す文を書く = v=>{ K.文 = v; };   // ⚠️ 理由は上の F の setter と同じ

function 残し描く(){
  const b = 本を引く(K.本);
  const 中 = K.済 ? `<div class="終い">
      <div class="印">📖</div>
      <h3 style="font-size:19px;margin:16px 0 10px;font-weight:600;letter-spacing:.09em">意思を記録しました</h3>
      <p class="節の注" style="margin:0">この記録は本のページに残り、<br>権利者が引き継いだときに見られます。</p>
      <button class="釦 全幅" style="margin-top:26px" onclick="覆い閉じ();location.reload()">閉じる</button>
    </div>` : `
    <p class="節の注" style="margin:0">『${逃(b.題)}』の復刊を願う気持ちを記録します。
      <b style="color:var(--字)">ポイントは減りません。</b></p>
    <p class="名札">復刊・電子化されたら、いくら払ってもいいですか</p>
    <div class="金額たち" style="margin-top:8px">
      ${[0,500,1000,2000,3000,5000].map(v=>
        `<button class="${K.約===v?'いま':''}" onclick="約指定(${v})">${v===0?"決めない":v.toLocaleString()}</button>`).join("")}
    </div>
    ${K.ことばあり
      ? `<p class="節の注" style="margin-top:18px">この本には、もうあなたのことばがあります（1冊にひとつ）。
           直したいときは、本のページの「自分のことばを直す」から。</p>`
      : `<p class="名札">この本への思い（任意・公開されます）</p>
    <textarea class="欄" id="残しの文" maxlength="${土台.ことばの長さ}" placeholder="例）古本で出会いました。子どもにも読ませたい。"
      oninput="残す文を書く(this.value)">${逃(K.文)}</textarea>`}
    <div class="断り 藤" style="margin-top:22px">
      これは支払いの約束ではなく、<b>需要のしるし</b>です。集まった額は「これだけの読者が待っている」として、
      出版社・権利者に示されます。</div>
    <button class="釦 藤 全幅" style="margin-top:22px" ${K.送信中?"disabled":""} onclick="残し確定()">
      ${K.送信中?"記録しています…":"復刊を願う"}</button>`;

  窓を出す(K.済 ? "" : "この本の復刊を願う", 中);
}

window.残し確定 = async ()=>{
  if(K.送信中) return;
  const 文欄 = document.getElementById("残しの文");   // ⚠️ 理由は 返し確定 と同じ
  if(文欄) K.文 = 文欄.value;
  K.送信中 = true; 残し描く();
  try{
    await 残したい({ 本id:K.本, 約:K.約 });
    /* ことばは voices へ（返し確定 と同じ。残したいは通っているので、失敗しても取り消さない） */
    if(!K.ことばあり && K.文.trim()){
      try{ await 土台.ことばを書く({ 本id:K.本, 文:K.文, 匿:false }); }
      catch(e){ console.error(e); 知らせる("記録しました。ことばだけ届けられませんでした。本のページから書いてください", true); }
    }
    K.送信中 = false; K.済 = true; 残し描く();
  }catch(e){
    K.送信中 = false; 残し描く();
    console.error(e); 知らせる("記録できませんでした", true);
  }
};


/* ============================================================
   覆い：本の登録を申請する

   ⚠️ **入力はそのまま受ける。**照合はあとで管理者が回す。
      国会図書館サーチは1回20秒かかるうえ不安定なので、
      ここで待たせると出す気が失せる。
   ⚠️ ISBN のときだけ openBD で即座に確かめられる（57ms）。
      これは待たせても気にならないので、入力補助として使う。
   ============================================================ */
let S = {};
window.申請を始める = ()=>{ S = { 題:"", 著:"", 版元:"", isbn:"", amazon:"", 覚書:"",
  済:false, 送信中:false, 確認:null };
  申請描く(); };

function 申請描く(欄を保つ){
  const 中 = S.済 ? `<div class="終い">
      <div class="印">📖</div>
      <h3 style="font-size:19px;margin:16px 0 10px;font-weight:600;letter-spacing:.09em">受け取りました</h3>
      <p class="節の注" style="margin:0">書誌を確かめてから棚に並べます。<br>
        並んだかどうかは「マイページ」の「あなたの申請」で見られます。</p>
      <button class="釦 全幅" style="margin-top:26px" onclick="覆い閉じ();location.reload()">閉じる</button>
      <button class="釦 枠だけ 全幅" style="margin-top:10px" onclick="覆い閉じ();go('mine')">あなたの申請を見る</button>
    </div>` : `
    <p class="節の注" style="margin:0">棚に無い本を教えてください。確認のうえ並べます。</p>

    <p class="名札">AmazonのURL（任意・ここから書誌を引けます）</p>
    <div style="display:flex;gap:10px;align-items:flex-end">
      <input class="欄" id="申amazon" placeholder="https://www.amazon.co.jp/…/dp/4166612476"
        value="${逃(S.amazon||"")}" oninput="申請の値('amazon',this.value)">
      <button class="釦 枠だけ 小" style="white-space:nowrap" onclick="Amazonから読む()">読み取る</button>
    </div>
    <p class="節の注">
      紙の本のURLなら、書名・著者・出版社を自動で埋められます。<br>
      短縮リンク（link.amazon/… ）は一度開いて、出てきたURLを貼ってください。<br>
      <b>リンク自体は保存しません。</b>ISBNを取り出すためだけに使います。</p>

    <p class="名札">ISBN（分かれば。あると確実です）</p>
    <div style="display:flex;gap:10px;align-items:flex-end">
      <input class="欄" id="申isbn" inputmode="numeric" placeholder="9784166612475"
        value="${逃(S.isbn)}" oninput="申請の値('isbn',this.value)">
      <button class="釦 枠だけ 小" style="white-space:nowrap" onclick="ISBNを確かめる()">確かめる</button>
    </div>
    ${S.確認 === "さがし中" ? `<p class="節の注">さがしています…</p>`
      : S.確認 ? `<div class="断り 藤" style="margin-top:12px">
          <b>${逃(S.確認.題)}</b><br>${逃(S.確認.著||"")}<br>${逃(S.確認.版元||"")}・${逃(S.確認.年||"")}
          <br><button class="釦 枠だけ 小" style="margin-top:8px"
            onclick="確認を使う()">この内容を入れる</button></div>`
      : S.確認 === false ? `<p class="節の注" style="color:var(--朱)">その ISBN は見つかりませんでした。下に手で書いてください。</p>` : ""}

    <p class="名札">書名 <span style="color:var(--朱)">必須</span></p>
    <input class="欄" id="申題" value="${逃(S.題)}" oninput="申請の値('題',this.value)">
    <p class="名札">著者名 <span style="color:var(--朱)">必須</span></p>
    <input class="欄" id="申著" value="${逃(S.著)}" oninput="申請の値('著',this.value)">
    <p class="名札">出版社名 <span style="color:var(--朱)">必須</span></p>
    <input class="欄" id="申版元" value="${逃(S.版元)}" oninput="申請の値('版元',this.value)">
    <p class="名札">ひとこと（任意）</p>
    <textarea class="欄" id="申覚書" maxlength="300"
      placeholder="例）文庫版でお願いします／この本に返したくて登録しました"
      oninput="申請の値('覚書',this.value)">${逃(S.覚書)}</textarea>

    <div class="断り" style="margin-top:20px">
      そのまま受け取って、こちらで書誌を確かめてから並べます。
      <b>書名だけでは機械が別の本を掴む</b>ので、著者名と出版社名もお願いしています。</div>
    <button class="釦 全幅" style="margin-top:20px" ${S.送信中?"disabled":""} onclick="申請を出す()">
      ${S.送信中?"送っています…":"申請する"}</button>`;

  窓を出す(S.済 ? "" : "読んだ本を棚に加える", 中);
  if(欄を保つ){ const e = document.getElementById(欄を保つ);
    if(e){ e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }
}

/* ⚠️ インラインの on... はグローバルで動く。モジュールの S は見えないので、
      値を入れるものは必ず window 経由で（ことばを取りこぼした件と同じ理由）。 */
window.申請の値 = (名, 値)=>{ S[名] = 値; };

/* ⚠️ **リンクは保存しない。**ASIN→ISBN を取り出す道具として使うだけ。
      利用者の貼ったアフィリエイトタグを、こちらのサイトで使うわけにはいかない。 */
window.Amazonから読む = async ()=>{
  const u = document.getElementById("申amazon")?.value.trim() || "";
  S.amazon = u;
  if(/link\.amazon|amzn\.to|amzn\.asia/.test(u)){
    知らせる("短縮リンクは辿れません。一度開いて、出てきたURLを貼ってください", true); return;
  }
  const asin = 土台.AmazonのASIN(u);
  if(!asin){ 知らせる("AmazonのURLから商品番号を読み取れませんでした", true); return; }
  const isbn13 = 土台.ISBN13にする(asin);
  if(!isbn13){
    知らせる("Kindle版などは書誌を引けません。紙の本のURLでお願いします", true); return;
  }
  S.isbn = isbn13;
  S.確認 = "さがし中"; 申請描く();
  const r = await 土台.ISBNで確かめる(isbn13);
  S.確認 = r || false;
  if(r){ S.題 = r.題 || S.題; S.著 = r.著 || S.著; S.版元 = r.版元 || S.版元; }
  申請描く();
};

window.ISBNを確かめる = async ()=>{
  const v = document.getElementById("申isbn")?.value || "";
  S.isbn = v;
  if(v.replace(/[^0-9Xx]/g,"").length < 10){ 知らせる("ISBNを10桁以上入れてください", true); return; }
  S.確認 = "さがし中"; 申請描く();
  const r = await 土台.ISBNで確かめる(v);
  S.確認 = r || false; 申請描く();
};
window.確認を使う = ()=>{
  const c = S.確認; if(!c) return;
  S.題 = c.題 || S.題; S.著 = c.著 || S.著; S.版元 = c.版元 || S.版元; S.isbn = c.isbn || S.isbn;
  申請描く();
};

window.申請を出す = async ()=>{
  if(S.送信中) return;
  ["題","著","版元","isbn","覚書"].forEach(k=>{
    const e = document.getElementById("申" + (k==="isbn"?"isbn":k));
    if(e) S[k] = e.value.trim();
  });
  if(!S.題 || !S.著 || !S.版元){ 知らせる("書名・著者名・出版社名は必須です", true); return; }
  S.送信中 = true; 申請描く();
  try{
    await 土台.登録を申請する(S);
    S.送信中 = false; S.済 = true; 申請描く();
  }catch(e){
    S.送信中 = false; 申請描く();
    console.error(e); 知らせる("送れませんでした：" + (e.code||e.message), true);
  }
};


/* ============================================================
   覆い：設定

   ⚠️ **Googleの表示名をそのまま出さない。**本名で登録している人が多く、
      「この本に救われた」と本名で書きたくない人がいる。
      名乗りを決めれば、**過去の分もすべてその名前に変わる**
      （記録に名前を焼き付けていないので）。
   ============================================================ */
let 設定中 = { 送信中:false };

window.設定をひらく = ()=>{
  const 私の = 土台.私の印();
  設定中 = { 名:土台.私の名(), 印:私の.印, 色:私の.色, 顔:私の.顔,
            公開:土台.公開か(土台.私?.uid), 送信中:false, 支度中:false };
  設定描く();
};

function 設定描く(){
  const 決めてある = 土台.名乗り表.has(土台.私?.uid);
  const 見本 = 設定中.顔
    ? `<img class="印 大" src="${逃(設定中.顔)}" alt="">`
    : `<span class="印 大" style="background:${設定中.色}">${逃(設定中.印 || "読")}</span>`;
  窓を出す("設定", `
        <div class="見本の列">
          ${見本}
          <div>
            <p class="名札" style="margin:0 0 6px">表示する名前</p>
            <input class="欄" id="設定の名" maxlength="24" value="${逃(設定中.名 || "")}"
              placeholder="本の世界に出したい名前" oninput="設定の見本(this.value)">
          </div>
        </div>

        <p class="節の注">
          読者の声や番付に、この名前と印が出ます。${決めてある ? ""
            : "<br>いまは Google のアカウント名がそのまま出ています。"}
          <br><b>変えると、過去に送った分もすべて新しい名前に変わります。</b>
          （記録に名前を焼き付けていないため）
          <br>1回ずつ「匿名で届ける」を選ぶこともできます。</p>

        <p class="名札" style="margin-top:22px">しるし</p>
        <p class="節の注" style="margin-top:4px">
          名前の横に出るものです。画像を選ぶか、字と色で作れます。</p>

        <div class="しるしの段">
          <label class="釦 枠だけ 小">
            ${設定中.支度中 ? "読んでいます…" : (設定中.顔 ? "画像を選び直す" : "画像を選ぶ")}
            <input type="file" accept="image/*" hidden onchange="設定の画像(this)">
          </label>
          ${設定中.顔 ? `<button class="釦 枠だけ 小" onclick="設定の画像をやめる()">画像をやめる</button>` : ""}
        </div>

        <div class="しるしの作り ${設定中.顔 ? "うすい" : ""}">
          <input class="欄 一字" id="設定の印" maxlength="2" value="${逃(設定中.印 || "")}"
            oninput="設定の字(this.value)">
          <div class="色たち">
            ${土台.印の色ら.map(c=>`
              <button class="色" title="${c.名}" style="background:${c.値}"
                aria-pressed="${設定中.色===c.値}"
                onclick="設定の色('${c.値}')"></button>`).join("")}
          </div>
        </div>
        ${設定中.顔 ? `<p class="節の注">画像を選んでいるあいだは、字と色は出ません。</p>` : ""}

        <p class="名札" style="margin-top:22px">自分のページ</p>
        <label style="display:flex;align-items:center;gap:10px;margin-top:6px;
          font-family:var(--ゴシック);font-size:12.5px;color:var(--字);cursor:pointer">
          <input type="checkbox" id="設定の公開" ${設定中.公開?"checked":""}
            onchange="設定の公開(this.checked)"> 自分のページを公開する
        </label>
        <p class="節の注" style="margin-top:6px">
          公開すると、番付や声の名前から、あなたのページへ飛べるようになります。
          名前を出して届けた本返しと、ことばが並びます。
          <b>匿名で届けた分は出ません。</b>
          <br>公開しなくても、本のページに出ている声はこれまでどおり見えます。</p>

        <button class="釦 全幅" style="margin-top:22px" ${設定中.送信中||設定中.支度中?"disabled":""}
          onclick="名乗りを保存()">${設定中.送信中?"保存しています…":"これにする"}</button>

        <div style="border-top:1px solid var(--罫);margin-top:26px;padding-top:20px">
          <p class="節の注" style="margin:0 0 12px">
            ${逃(土台.私?.email || "")} で入っています。</p>
          <button class="釦 枠だけ 全幅" onclick="覆い閉じ();ログアウト()">出る（ログアウト）</button>
        </div>`);
}

/* ⚠️ 名前を打つたびに全部描き直すと、打っている欄から焦点が外れる。
      見本の1文字だけを直に書き換える。**印を自分で決めた人の分は触らない。** */
window.設定の見本 = 値 =>{
  設定中.名 = 値;
  if(設定中.顔) return;
  if(document.getElementById("設定の印")?.value) return;   // 自分で決めた字は触らない
  const 字 = [...(値 || "読")][0] || "読";
  設定中.印 = 字;
  const e = 窓.querySelector(".印.大"); if(e && e.tagName === "SPAN") e.textContent = 字;
};
window.設定の字 = 値 =>{
  設定中.印 = [...(値 || "")][0] || "";
  const e = 窓.querySelector(".印.大");
  if(e && e.tagName === "SPAN") e.textContent = 設定中.印 || [...(設定中.名 || "読")][0] || "読";
};
window.設定の色 = 値 =>{ 設定中.色 = 値; 設定描く(); };
window.設定の公開 = 値 =>{ 設定中.公開 = !!値; };   // ⚠️ 描き直さない（名前の欄の打ちかけを消さないため）

/* ⚠️ ここでは**上げるだけで、users にはまだ書かない。**
      「これにする」を押さずに閉じた人の画像は、どこからも見えないまま残る。
      それは許す（次に上げれば同じ場所に上書きされる）。 */
window.設定の画像 = async 欄 =>{
  const f = 欄.files?.[0]; if(!f) return;
  設定中.支度中 = true; 設定描く();
  try{
    設定中.顔 = await 土台.顔をあげる(f);
    設定中.支度中 = false; 設定描く();
  }catch(e){
    設定中.支度中 = false; 設定描く();
    console.error(e); 知らせる("画像を置けませんでした：" + (e.code||e.message), true);
  }
};
window.設定の画像をやめる = ()=>{ 設定中.顔 = null; 設定描く(); };

window.名乗りを保存 = async ()=>{
  if(設定中.送信中) return;
  const 名 = document.getElementById("設定の名")?.value.trim() || "";
  if(!名){ 知らせる("名前を入れてください", true); return; }
  /* ⚠️ 欄の値は、打ったあと描き直していないことがある。**DOMから読み直す。** */
  const 印 = document.getElementById("設定の印")?.value.trim() || 設定中.印 || "";
  const 公開欄 = document.getElementById("設定の公開");
  if(公開欄) 設定中.公開 = 公開欄.checked;
  設定中.名 = 名; 設定中.印 = 印; 設定中.送信中 = true; 設定描く();
  try{
    await 土台.名乗りを決める({ 名, 印, 色:設定中.色, 顔:設定中.顔, 公開:設定中.公開 });
    覆い閉じ(); 知らせる("変えました");
    描く();
  }catch(e){
    設定中.送信中 = false; 設定描く();
    console.error(e); 知らせる("変えられませんでした：" + (e.code||e.message), true);
  }
};

/* ============================================================
   頁：マイページ（/me。前の「わたしの本返し」）
   ============================================================ */
async function 頁_私(){
  if(!土台.私) return 入るには();
  /* ⚠️ 申請が読めなくても（ルールを変えた直後など）、記録の画面は出す */
  const [行, 申請ら] = await Promise.all([
    私の記録(),
    土台.私の申請().catch(e=>{ console.error(e); return []; })
  ]);
  const 返し = 行.filter(x=>x.種==="返し");
  const 合計 = 返し.reduce((s,x)=>s+x.額,0);
  const 書いた = 行.filter(x=>x.種==="ことば").length;          // 自分の画面なので匿名の分も数える
  const 願った本 = new Set(行.filter(x=>x.種==="残し").map(x=>x.本)).size;   // 同じ本は1冊

  /* ⚠️ 「自分のこと」はここに集める（2026-09-24）。前は 設定の窓・わたしの本返し・読書家のページ の
        3か所に分かれていた。右上の名前もここへ来る。設定は窓のまま（たまにしか変えないので）。
        頭に公開の状態を出して、「いま公開されているか」がすぐ分かるようにする */
  const 公開 = 土台.公開か(土台.私.uid);
  return `
  <section class="幕">
    <p class="英字の札">My page</p>
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      ${しるし(土台.私の印(), "大")}
      <div style="min-width:0">
        <h1 class="大見出し" style="font-size:clamp(25px,3.2vw,34px);margin:0">${逃(土台.私の名())}</h1>
        <p class="節の注" style="margin:4px 0 0">
          ${公開 ? '<span class="札 済">ページを公開中</span>' : '<span class="札">ページは非公開</span>'}</p>
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px">
      <button class="釦 枠だけ 小" onclick="設定をひらく()">名前・しるし・公開を変える</button>
      ${公開 ? `<button class="釦 枠だけ 小" onclick="go('reader',{id:${引数(土台.私.uid)}})">他の人からの見え方を見る</button>` : ""}
    </div>
    ${/* ⚠️ 残高は「返したもの」ではなく「手持ち」なので、数字の段から外して別に置く（2026-09-26） */ ""}
    <p class="財布の行">いまの残高 <b>${(土台.財布?.残高??0).toLocaleString()}</b><span>pt</span>
      <span class="節の注" style="display:inline;margin:0 0 0 10px">毎月 ${土台.毎月配布.toLocaleString()}pt が配られます</span></p>
    <p class="導き" style="margin-top:22px">あなたが本の世界へ返したもの。</p>
    <div class="数字たち">
      ${数字("Returned", 合計.toLocaleString(), "返したポイント", true)}
      ${数字("Voices", 書いた.toLocaleString(), "書いたことば")}
      ${数字("Revive", 願った本.toLocaleString(), "復刊を願った本")}
    </div>
  </section>

  <section class="節">
    ${節の頭("記録", 行.length+"件")}
    <div class="表の板"><table>
      <tr><th>本</th><th>種類</th><th class="右">ポイント</th><th>ことば</th><th>いつ</th></tr>
      ${行.length ? 行.map(r=>{const b=本を引く(r.本);return `<tr>
        <td class="本"><a onclick="go('book',{id:${引数(r.本)}})">${逃(b?.題||r.本)}</a></td>
        <td>${r.種==="返し" ? '<span class="札 済">本返し</span>'
            : r.種==="残し" ? '<span class="札 注">復刊を願う</span>'
            : `<span class="札 藤">ことば</span>${r.匿 ? '<span class="節の注" style="display:inline;margin-left:6px">匿名</span>' : ""}`}</td>
        <td class="右">${r.種==="返し" ? r.額.toLocaleString()
            : r.種==="残し" ? (r.約 ? r.約.toLocaleString()+"の意思" : "―") : "―"}</td>
        <td style="color:var(--字の薄い);max-width:34ch">${逃(r.文)||"―"}</td>
        <td style="color:var(--字のごく薄い);white-space:nowrap">${いつ(r.時)}</td></tr>`}).join("")
      : '<tr><td colspan="5" style="color:var(--字のごく薄い)">まだ記録がありません。本をさがして、返してみてください。</td></tr>'}
    </table></div>
  </section>

  ${/* ⚠️ 申請の結果を見せて輪を閉じる。並んだと分かれば、次も申請したくなる */ ""}
  <section class="節">
    ${節の頭("あなたの申請", 申請ら.length + "件")}
    <div class="表の板"><table>
      <tr><th>本</th><th>いま</th><th>いつ</th></tr>
      ${申請ら.length ? 申請ら.map(r=>`<tr>
        <td class="本">${r.本 && 本を引く(r.本)
          ? `<a onclick="go('book',{id:${引数(r.本)}})">${逃(本を引く(r.本).題)}</a>`
          : 逃(r.題)}</td>
        <td><span class="札 ${r.状態==="並んだ" ? "済" : r.状態==="見送り" ? "注" : "藤"}">${逃(土台.申請の状態[r.状態] || r.状態)}</span></td>
        <td style="color:var(--字のごく薄い);white-space:nowrap">${いつ(r.時)}</td></tr>`).join("")
      : `<tr><td colspan="3" style="color:var(--字のごく薄い)">まだ申請はありません。</td></tr>`}
    </table></div>
    <button class="釦 枠だけ 小" style="margin-top:16px" onclick="申請を始める()">読んだ本を棚に加える</button>
  </section>`;
}

/* ============================================================
   頁：読書家（/u/<uid>）

   ⚠️ いまの本返しの価値は「誰が何を推しているか」が見えること（README）。
      本・著者・出版社にはページがあるのに、推している人にだけ無かった。
   ⚠️⚠️ **本人が設定で公開を選んだ人だけ。**既定は非公開。
      匿名で送った分は、数字にも一覧にも入れない（共通.js の 読書家の記録）。
   ============================================================ */
async function 頁_読書家(){
  const uid = 現在.id;
  const 自分 = 土台.私?.uid === uid;
  if(!土台.公開か(uid)) return `<div class="節"><div class="断り" style="margin-top:40px">
    ${自分
      ? `あなたのページは、まだ公開していません。<br>
         設定の「自分のページを公開する」を選ぶと、ここに推している本とことばが並びます。
         <button class="釦 枠だけ 小" style="margin-left:12px" onclick="設定をひらく()">設定をひらく</button>`
      : `この人は、ページを公開していません。
         <button class="釦 枠だけ 小" style="margin-left:12px" onclick="go('home')">トップへ</button>`}
    </div></div>`;

  const 行 = await 土台.読書家の記録(uid);
  const 返し = 行.filter(x=>x.種==="返し");
  const 本ら = [...new Set(行.map(x=>x.本))].map(本を引く).filter(Boolean);
  const ことば = 行.filter(x=>x.種==="ことば");   // 声は voices だけ（返し・残しの text は空）
  const 名 = 土台.名を引く(uid);

  return `
  <section class="幕">
    <p class="英字の札">Reader</p>
    <div style="display:flex;align-items:center;gap:16px">
      ${しるし(土台.印を引く(uid, 名), "大")}
      <h1 class="大見出し" style="font-size:clamp(25px,3.2vw,34px);margin:0">${逃(名)}</h1>
    </div>
    <p class="導き">${自分 ? "あなたのページです。" : ""}名前を出して届けた本返しと、ことば。
      匿名で届けた分は出ていません。</p>
    <div class="数字たち">
      ${数字("Count", 返し.length, "本返しした回数")}
      ${数字("Books", 本ら.length, "推している本")}
      ${数字("Voices", ことば.length, "書いたことば")}
      ${数字("Paid", 返し.reduce((s,x)=>s+x.額,0).toLocaleString(), "返したポイント", true)}
    </div>
  </section>

  ${流れる列("推している本", `${本ら.length}冊`, 本ら, null, false)}
  ${(()=>{ const 加えた = 土台.蔵書.filter(b=>b.申請者 === uid);
    return 流れる列("棚に加えた本", `申請で並んだ ${加えた.length}冊`, 加えた, null, false); })()}

  <section class="節">
    ${節の頭("ことば", ことば.length + "件")}
    <div class="声の列">
      ${ことば.length ? ことば.map(v=>`<div class="声">
        <div class="素性"><a onclick="go('book',{id:${引数(v.本)}})">『${逃(本を引く(v.本)?.題 || v.本)}』</a>
          <span>${いつ(v.時)}${v.直した ? `（${いつ(v.直した)}に直した）` : ""}</span></div>
        <p>${逃(v.文)}</p></div>`).join("")
        : '<p class="節の注" style="padding:20px 0">まだありません。</p>'}
    </div>
  </section>`;
}

/* ============================================================
   頁：受取人の控え

   ⚠️ トライアル中は、誰でも好きな受取人の控えを開ける。
      本番では「本人確認を通した人だけが、自分の控えを見る」形にする。
   ⚠️ 受取人のidは**本ごとに別**（岩波書店は momo_p と ho_p を持つ）。
      名前でまとめると片方の受取が消えるので、idのまま並べて本の題を添える。
   ============================================================ */
async function 頁_受取人(){
  if(!土台.私) return 入るには();
  /* ⚠️ ③利用者には見せない。①管理者は全部、②受取人は自分の主体だけ。 */
  const 管 = 土台.権限.管理者, 自分の = 土台.権限.受取人;
  if(!管 && !自分の.length) return `<div class="節"><div class="断り" style="margin-top:40px">
    <b>この画面は受取人のためのものです。</b><br>
    著者・出版社・書店としてページを引き継ぐと、ここで受け取ったぶんと読者の声が見られます。
    </div></div>`;

  const 受取人ら = [];
  /* ⚠️ 主体は本をまたいで1つになったので、id で重複を落とす。
        （前は受取人IDが本ごとに別で、岩波書店が2人に割れていた） */
  土台.蔵書.forEach(b=>届け先(b).forEach(r=>{
    if(!受取人ら.some(x=>x.id === r.id)) 受取人ら.push({ ...r });
  }));
  受取人ら.forEach(r=>r.冊数 = 土台.蔵書.filter(b=>届け先(b).some(x=>x.id===r.id)).length);
  const 見える = 管 ? 受取人ら : 受取人ら.filter(r=>自分の.includes(r.id));
  const 選 = (見える.some(r=>r.id===現在.rid) ? 現在.rid : null) || 見える[0]?.id;
  if(!選) return `<div class="節"><div class="断り">受取人がまだいません。</div></div>`;

  const 本人 = 見える.find(x=>x.id===選) || 見える[0];
  const [{ 明細, 合計 }, 声あり] = await Promise.all([
    受取人の受取(選), 土台.主体へのことば(選)]);

  return `
  <section class="幕">
    <p class="英字の札">Receiver</p>
    <h1 class="大見出し" style="font-size:clamp(25px,3.2vw,34px)">受取人の控え</h1>
    <p class="導き">${逃(本人.名)}（${逃(本人.種)}・${本人.冊数}冊）として見ています。
      ${管 ? "管理者なので、すべての受取人に切り替えられます。" : ""}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:22px">
      ${見える.map(r=>`<button class="釦 ${r.id===選?'':'枠だけ'} 小"
        onclick="受取人を選ぶ(${引数(r.id)})">${逃(r.名)}<span style="opacity:.55"> ${r.冊数}冊</span></button>`).join("")}
    </div>
    <div class="数字たち">
      ${数字("Received", 合計.toLocaleString(), `受け取ったポイント（支払われたポイントの${受取率の百分率}%）`, true)}
      ${数字("Thanks", 明細.length, "届いた本返し")}
      ${数字("Voices", 声あり.length, "読者の声")}
    </div>
  </section>

  <section class="節">
    ${節の頭("明細", `支払われたポイントの${受取率の百分率}%が、配分に応じて渡ります`)}
    <div class="表の板"><table>
      <tr><th>本</th><th>読者</th><th class="右">受け取ったポイント</th><th>いつ</th></tr>
      ${明細.length ? 明細.map(i=>`<tr>
        <td class="本"><a onclick="go('book',{id:${引数(i.本)}})">${逃(本を引く(i.本)?.題||i.本)}</a></td>
        <td>${名と印(i.送り主, i.名, i.名==="匿名")}</td><td class="右">${i.額.toLocaleString()}</td>
        <td style="color:var(--字のごく薄い);white-space:nowrap">${いつ(i.時)}</td></tr>`).join("")
      : '<tr><td colspan="4" style="color:var(--字のごく薄い)">まだ受取はありません。</td></tr>'}
    </table></div>
  </section>

  <section class="節">
    ${節の頭("読者の声", "購買データでは決して取れない、読後の感情")}
    <div class="声の列">
      ${声あり.length ? 声あり.map(v=>声の行(v, true)).join("")
      : '<p class="節の注" style="padding:20px 0">まだありません。</p>'}
    </div>
    <div class="断り 藤" style="margin-top:28px">
      <b>この画面が、本返しのいちばんの資産です。</b>
      「1,000人が復刊希望を押した」より、「1,000人が合計72万円出してでも復刊を願っている」のほうが、
      出版社にとって意思決定できるしるしになります。</div>
  </section>`;
}
window.受取人を選ぶ = rid=>{ 現在.rid = rid; 描く(); };

/* ============================================================
   頁：しくみ
   ============================================================ */
async function 頁_しくみ(){
  return `
  <section class="幕">
    <p class="英字の札">How it works</p>
    <h1 class="大見出し">お金の流れと、<br>守っていること。</h1>
    <p class="導き">本返しは、本を買う場所ではありません。
      読み終わったあとに、その本を支えた人へ気持ちを返すための場所です。</p>
  </section>

  <section class="節">
    ${節の頭("いまは、架空のポイントで試しています", "実際のお金は1円も動きません")}
    <div style="display:grid;gap:44px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));margin-top:26px">
      <div class="内訳" style="border-top:none;margin-top:0;padding-top:0">
        <div class="行"><span>はじめに配られる</span><b style="color:var(--朱)">10,000</b></div>
        <div class="行"><span>毎月ふたたび配られる</span><span>3,000</span></div>
        <div class="行 薄"><span>換金・購入</span><span>できません</span></div>
        <div class="行 締め"><span>実際のお金</span><span>0円</span></div>
      </div>
      <p class="導き" style="margin:0">
        本物のお金を扱う前に、<b style="color:var(--字)">読んだあとに、誰かへ気持ちを託すという行いが実際に起きるか</b>を
        確かめています。ポイントには限りがあるので、どの本に使うかを選ぶことになります。
        その選び方こそが、いま知りたいことです。</p>
    </div>
  </section>

  <section class="節">
    ${節の頭("100pt を返すと、どうなるか", "送る前に、必ずこの内訳を見せます")}
    <div style="display:grid;gap:44px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));margin-top:26px">
      <div>
        <div class="帯グラフ" style="height:6px">
          <div style="width:90%;background:var(--朱)"></div>
          <div style="width:5%;background:var(--罫の濃い)"></div>
          <div style="width:5%;background:var(--灯)"></div>
        </div>
        <div class="内訳" style="border-top:none;margin-top:0;padding-top:0">
          <div class="行"><span>本の世界へ</span><b style="color:var(--朱)">90</b></div>
          <div class="行 薄"><span>決済手数料ぶん</span><span>5</span></div>
          <div class="行 薄"><span>本返しの運営</span><span>5</span></div>
          <div class="行 締め"><span>お支払い</span><span>100 pt</span></div>
        </div>
      </div>
      <p class="導き" style="margin:0">
        ほかのサービスの手数料は、CAMPFIRE が 12%＋決済5%、OFUSE が単発支援 16%（2026年10月〜）。
        本返しは合計10%を上限とし、<b style="color:var(--字)">受取人に90%</b>を渡します。</p>
    </div>
  </section>

  <section class="節">
    ${節の頭("3つの行い", "本返しでできることは、これだけです")}
    <div class="流れ">
      <div><div class="番">01</div><h4>ありがとう</h4>
        <p>いま読める本への感謝。著者・出版社・書店へ、100ptから返せます。</p></div>
      <div><div class="番">02</div><h4>応援する <span class="札 注">準備中</span></h4>
        <p>本ではなく、人・出版社・書店そのものへ。いまは準備中です。
          本返しは、本を通して届けることをいちばん大事にしています。</p></div>
      <div><div class="番">03</div><h4>復刊を願う</h4>
        <p>品切れ・絶版の本へ。ポイントは動かさず、「復刊したら払う額」を意思として貯め、出版社に示します。
          品切れかどうかは、Amazon で新品が買えるかで判定し、判定した日を本のページに添えています。</p></div>
    </div>
  </section>

  <section class="節">
    ${節の頭("受取人がいない本のこと", "ここが、本返しでいちばん大事な設計です")}
    <div style="max-width:60ch;margin-top:26px">
      <p style="margin:0 0 18px">絶版本ほど、読者の思いは濃い。けれど出版社が解散していたり、権利者が分からないことがあります。</p>
      <p style="margin:0 0 18px">本返しは、そういう本で<b>1ポイントも預かりません。</b>受け取る人がいないお金を持つことは、
        法律上も、気持ちの上でも、健全ではないからです。</p>
      <p style="margin:0">代わりに、ことばと「復刊したら払える額」を貯めます。権利者があとからページを引き継いだとき、
        そこには<b>すでに読者が待っている</b>という事実が残っています。</p>
    </div>
  </section>

  <section class="節">
    ${節の頭("まだ引き継がれていない相手のこと", "いまは架空のポイントなので、引き継ぎ待ちの相手にも届けられます")}
    <div style="max-width:60ch;margin-top:26px">
      <p style="margin:0 0 18px">本のページの受取人には、「引き継ぎ待ち」と出ているものがあります。
        著者や出版社の本人が、まだこのページを引き継いでいない、という意味です。</p>
      <p style="margin:0 0 18px">いまは架空のポイントで試しているので、引き継ぎ待ちの相手にも配分できます。</p>
      <p style="margin:0">本物のお金を扱うときは、<b>引き継いだ相手にだけ</b>お渡しします。
        引き継ぎ待ちの相手には「この人にも返したかった」という気持ちだけを記録し、
        お金を預かっておくことはしません。</p>
    </div>
  </section>

  <section class="節">
    ${節の頭("届け先と、記録の扱い", "知っておいてほしいこと")}
    <div style="max-width:60ch;margin-top:26px">
      <p style="margin:0 0 18px"><b>届け先は、いまは著者と出版社です。</b>
        翻訳者・書店・図書館は、まだ届け先に入っていません。
        書店や図書館は「その本をどこで買ったか・借りたか」が読者ごとに違うため、
        本とは別の形で届けられるように考えています。</p>
      <p style="margin:0 0 18px"><b>匿名で届けると、名前もしるしも画面に出ません。</b>
        ただし、試用の管理のために、誰が送ったかの記録は残ります。</p>
      <p style="margin:0 0 18px"><b>表示する名前は、あとから変えられます。</b>
        記録に名前を焼き付けていないので、変えると過去に送った分も新しい名前になります。</p>
      <p style="margin:0 0 18px"><b>自分のページは、選んだ人にだけ作られます。</b>
        設定で公開を選ぶと、名前を出して届けた本返しとことばが一つのページに並び、
        番付や声の名前から飛べるようになります。匿名で届けた分は出ません。</p>
      <p style="margin:0"><b>本返しの収入について。</b>
        運営の5%のほかに、本のページの「Amazonで見る」は広告リンクです。
        そこから本が買われると、本返しに紹介料が入ります。本の値段は変わりません。</p>
    </div>
  </section>

  <section class="節">
    ${節の頭("本物のお金にするときは", "トライアルのあとに控えている宿題")}
    <div class="流れ">
      <div><div class="番">01</div><h4>本人確認</h4><p>身分証、または法人登記。受取人が本当にその人かを確かめる。</p></div>
      <div><div class="番">02</div><h4>関係の確認</h4><p>奥付・契約書・屋号など、その本との関係を示すもの。</p></div>
      <div><div class="番">03</div><h4>直接の入金</h4><p>資金は預からず、Stripe Connect で受取人へ直接渡す。</p></div>
    </div>
    <div class="断り" style="margin-top:28px;max-width:62ch">
      プラットフォームが利用者から資金を受け取り第三者へ渡す設計は、資金決済法上の論点を含み得ます。
      自前でお金を預からない前提で、ローンチ前に専門家とスキームを確認します。図書館への支援は第二段階です。</div>
  </section>`;
}

/* ============================================================
   はじまり
   ============================================================ */
現在 = 道を読む();
/* ⚠️ 起動の知らせは、ログイン・ログアウトのたびにも来る。
      位置を戻すのは最初の1回だけ（読んでいる途中で飛ばさない） */
let 初回 = true;
const 起動時の位置 = 覚えた位置();        // ⚠️ 描く前に読む（理由は popstate と同じ）
起動(async ()=>{
  await 土台.権限をしらべる(); await 描く();
  if(初回){ 初回 = false; 位置へ(起動時の位置); }
}).catch(e=>{
  console.error(e);
  画面.innerHTML = `<div class="節"><div class="断り">
    <b>Firebase の設定が読めませんでした。</b><br>
    このページは Firebase Hosting 上、またはローカルでは <code>firebase serve</code> で開いてください。
    ファイルを直接ダブルクリックして開くと、ここで止まります。<br>
    <a href="/demo">ダミーデータのデモはこちら</a></div></div>`;
});
