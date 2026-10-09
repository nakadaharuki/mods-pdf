// ModsPDF の samples から scripts/compare-typst.mjs が作った元。手で直さない。
#set document(title: "Notes on Mixed Japanese and English Text (Sample)", author: "ModsPDF 見本")
#set page(width: 595.28pt, height: 841.89pt, margin: (left: 45.89pt, right: 45.89pt, top: 52.36pt, bottom: 58.03pt), footer: context [
  #set text(size: 8pt, fill: rgb("#4A4A4A"))
  #line(length: 100%, stroke: 0.5pt + rgb("#CCCCC9"))
  #align(right)[#"ModsPDF 見本 ／ Notes on Mixed Japanese and English Text (Sample)"#h(1em)#counter(page).display()#" / "#counter(page).final().first()]
])
#set text(font: ("Zen Old Mincho", "Noto Sans JP"), lang: "en", region: "us", hyphenate: true, size: 9.5pt, fill: rgb("#111111"), top-edge: 1em, bottom-edge: 0pt)
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
  #text(size: 18pt, weight: "bold")[#"Notes on Mixed Japanese and English Text (Sample)"]
  #v(0.25em)
  #line(length: 100%, stroke: 1.4pt + rgb("#111111"))
]

#heading(level: 2)[#"Scope"]

#"This sample shows how the layout engine handles a page of English prose that contains Japanese words such as 「組版」 and 禁則処理, together with Japanese punctuation such as 、 and 。 The figures are invented for the sample and do not come from any measurement."

#"Japanese text is set in full-width characters, while English words use proportional letters. When the two meet, the gap between them matters. A gap that is too narrow makes the line look cramped, and a gap that is too wide makes the words look as if they belong to different sentences."

#heading(level: 2)[#"Method"]

#"We set the same paragraph three times, with three rules for the gap between a Japanese character and a Latin letter. We then compared the line ends by eye and counted the lines that needed a correction."

#list(tight: true, [#"Rule one: no gap at the boundary."], [#"Rule two: a quarter-em gap at every boundary."], [#"Rule three: the gap follows the spacing table of the typesetting requirements, and the engine may shrink or stretch it within the limits."])

#"Each rule was applied to the same forty lines, so the counts in the table below can be compared directly."

#heading(level: 2)[#"Results"]

#"Table 1 summarizes the lines that needed a correction under each rule."

#table(columns: (auto, auto, auto, auto), align: (left, right, right, left), stroke: (x: none, y: 0.4pt + rgb("#CCCCC9")), inset: (x: 5pt, y: 3.5pt), fill: (x, y) => if y == 0 { rgb("#F1F0ED") } else { none },
  table.header([#strong("Rule")], [#strong("Lines set")], [#strong("Lines corrected")], [#strong("Remark")]),
  [#"No gap"], [#"40"], [#"9"], [#"Latin words touch the kana"],
  [#"Quarter em"], [#"40"], [#"3"], [#"Acceptable for most text"],
  [#"Table of spacing"], [#"40"], [#"1"], [#"Corrected at one line end"])

#"The quarter-em rule removed most of the cramped boundaries. The table-based rule was the most consistent of the three, but it still needed one correction at a line end where an opening bracket had been carried over from the previous line."

#heading(level: 2)[#"Discussion"]

#"The results suggest that the gap should depend on the pair of characters on either side, not on a single fixed value. A period followed by a Latin word needs a different space from a Japanese opening bracket followed by a Latin letter."

#"Kinsoku rules, the rules that stop certain characters from starting or ending a line, matter more in mixed text than in plain English. A closing bracket or a comma at the start of a line is easy to notice, and readers tend to treat it as a sign of careless typesetting."

#"We also noticed that long unbroken words, such as file names and URLs, need their own handling. Breaking them by character keeps the line within the measure, but the break must be recorded so that the author can see where it happened."

#heading(level: 2)[#"Conclusion"]

#"For mixed text, the best result came from a table of spacing with limits, applied pair by pair. The simple fixed gap was easy to implement but produced more visible errors. The sample document therefore uses the table-based rule as its default."
