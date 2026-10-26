export const modes = [
 {id:1,name:'ねこつんつん',tag:'そーっと、つん。',operation:'目を閉じている間にタップ',time:'30秒',desc:'目を開けたら、手を止めて！',ready:'猫をタップして、はじめる'},
 {id:2,name:'箱をずらせ',tag:'入れると思った？',operation:'飛び込む瞬間、箱をスワイプ',time:'30秒',desc:'入る直前に、箱をスワイプ',ready:'箱をタップして、はじめる'},
 {id:3,name:'猫パンチ寸止め',tag:'ぎりぎり、どきどき。',operation:'長押しして、パンチの前に離す',time:'ひと勝負',desc:'長押しでちょっかい<br>パンチの前に離す',ready:'鼻の前を長押しして、はじめる'},
 {id:4,name:'その帽子、いやニャ！',tag:'似合ってるのに。',operation:'帽子が外れたら、またタップ',time:'15秒',desc:'タップで、またかぶせる',ready:'猫をタップして、かぶせる'},
 {id:5,name:'ほっぺむにむに',tag:'時間を忘れて、むに。',operation:'ほっぺを引っぱって、離すだけ',time:'気ままに',desc:'ほっぺを引っぱって、離すだけ',ready:''},
 {id:6,name:'あとちょっとで届くのに',tag:'届きそうで、届かない。',operation:'羽を動かして、つかまるな！',time:'15秒',desc:'指で動かして、つかまるな！',ready:'右上の光る輪を、そのままドラッグ'}
];
export const asset=(name:string)=>`/assets/${name}.webp`;
export const icons={
 paw:'<svg viewBox="0 0 32 32" fill="currentColor"><ellipse cx="8" cy="10" rx="3.3" ry="4.3" transform="rotate(-25 8 10)"/><ellipse cx="15" cy="6.5" rx="3.2" ry="4.3"/><ellipse cx="23" cy="9" rx="3.2" ry="4.3" transform="rotate(25 23 9)"/><ellipse cx="28" cy="16" rx="2.8" ry="3.8" transform="rotate(30 28 16)"/><path d="M7 22c0-4 6-10 10-10s9 7 9 11c0 6-6 4-9 3-3 1-10 3-10-4Z"/></svg>',
 back:'<svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg>',
 sound:'<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Zm4 3c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/></svg>',
 muted:'<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Zm5 4 5 6m0-6-5 6"/></svg>',
 pause:'<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
 reset:'<svg viewBox="0 0 24 24"><path d="M18 6a8 8 0 1 0 2 8M18 2v5h-5"/></svg>',
 settings:'<svg viewBox="0 0 24 24"><path d="M4 7h16M4 17h16M8 4v6m8 4v6"/></svg>'
};
