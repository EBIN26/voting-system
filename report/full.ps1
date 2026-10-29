$w = New-Object -ComObject Word.Application; $w.Visible = $false
try {
  $doc = $w.Documents.Open("D:\claude\test-voting\report\frontpage.docx", $false, $true, $false)
  foreach ($i in 31,32,33,34,35,36,37,38,39,40,41,42,43,44,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73) {
    $p = $doc.Paragraphs($i)
    $t = ($p.Range.Text -replace "[\r\a]", "").Replace([string][char]11, "<VT>").Replace([string][char]12, "<FF>")
    "{0,3} pb={1} sb={2} sa={3} ls={4}/{5} :: {6}" -f $i, $p.PageBreakBefore, $p.SpaceBefore, $p.SpaceAfter, $p.LineSpacingRule, $p.LineSpacing, $t
  }
  $doc.Close($false)
} finally { $w.Quit() }
