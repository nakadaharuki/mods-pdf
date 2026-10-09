// ModsPDF の samples から scripts/compare-typst.mjs が作った元。手で直さない。
#set document(title: "ルビの見本（グループとモノルビ）", author: "ModsPDF 見本")
#set page(width: 595.28pt, height: 841.89pt, margin: (left: 45.89pt, right: 45.89pt, top: 52.36pt, bottom: 58.03pt), footer: context [
  #set text(size: 8pt, fill: rgb("#4A4A4A"))
  #line(length: 100%, stroke: 0.5pt + rgb("#CCCCC9"))
  #align(right)[#"ModsPDF 見本 ／ ルビの見本（グループとモノルビ）"#h(1em)#counter(page).display()#" / "#counter(page).final().first()]
])
#set text(font: ("Zen Old Mincho", "Noto Sans JP"), lang: "ja", region: "jp", size: 9.5pt, fill: rgb("#111111"), top-edge: 1em, bottom-edge: 0pt)
#set par(justify: true, first-line-indent: (amount: 1em, all: true), leading: 0.75em, spacing: 0.75em, linebreaks: "optimized")
#set smartquote(enabled: false)
#show heading: it => {
  set par(first-line-indent: 0pt, justify: false)
  let (size, rule) = if it.level == 1 { (15pt, 0.8pt) } else if it.level == 2 { (13pt, 0.6pt) } else { (10.5pt, 0pt) }
  block(above: 19.95pt, below: 9.975pt, sticky: true)[
    #text(size: size, weight: "bold")[#it.body]
    #if rule > 0pt [#v(0.2em)#line(length: 100%, stroke: rule + rgb("#111111"))]
  ]
}
#show list: set par(first-line-indent: 0pt, justify: false)
#show enum: set par(first-line-indent: 0pt, justify: false)
#show table: set par(first-line-indent: 0pt, justify: false)
#show table: set text(size: 8.5pt)

#block(below: 13.3pt)[
  #set par(first-line-indent: 0pt, justify: false)
  #text(size: 18pt, weight: "bold")[#"ルビの見本（グループとモノルビ）"]
  #v(0.25em)
  #line(length: 100%, stroke: 1.4pt + rgb("#111111"))
]

#"東京の朝は、歩道の端に薄い霜が残る。白雪のように見える道を、人々が急ぎ足で通り過ぎていく。"

#"鯨は海に住む大きな生き物だが、名の字を見るだけでは想像しにくい。見本の中では、鯨の字を大きく扱う。"

#"春雨の降る日は、紅葉が濡れて色が深くなる。鏡餅を飾る家が減っても、古い習わしを守る人は多い。"

#"漢字は、一字ずつ読みを付けるか、言葉ごとに一つの読みを付けるかで、組み方が変わる。青空の例では、字ごとに読みを付けた。赤字の例も、同じ形で組む。"

#"東京の地図を見ながら、「歩道は広い」と誰かが言った。傘の色が変わって見えるのは、雨が止んだ合図だった。"
