param(
  [string]$Out = "D:\claude\test-voting\report\Mini Project Report.docx",
  [string]$ContentDir = "content",
  [string[]]$Parts = @("ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "refs")
)
$ErrorActionPreference = "Stop"
$root = "D:\claude\test-voting\report"
$cm = 28.3465   # points per centimetre
$TITLE = "SECURE BLOCKCHAIN-BASED VOTING SYSTEM"
$LQ = [string][char]0x201C; $RQ = [string][char]0x201D; $VT = [string][char]11

function Read-Json([string]$name) {
  $text = [System.IO.File]::ReadAllText("$root\$ContentDir\$name.json", [System.Text.Encoding]::UTF8)
  return ConvertFrom-Json $text
}

$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
try {
  $doc = $w.Documents.Open("$root\frontpage.docx", $false, $false, $false)
  $doc.SaveAs2($Out)
  $doc.TrackRevisions = $false
  $w.Options.AutoFormatAsYouTypeReplaceQuotes = $false

  function Find-Para([string]$startsWith) {
    foreach ($p in $doc.Paragraphs) { if ($p.Range.Text.TrimStart().StartsWith($startsWith)) { return $p } }
    throw "Paragraph not found: $startsWith"
  }
  function Body-Range($p) { $r = $p.Range; $null = $r.MoveEnd(1, -1); return $r }
  function Replace-In($para, [string]$find, [string]$repl) {
    $r = $para.Range
    $ok = $r.Find.Execute($find, $true, $false, $false, $false, $false, $true, 0, $false, $repl, 1)
    if (-not $ok) { throw "Text not found in paragraph: $find" }
  }

  # ---------------- 1. Fill in the placeholders on the college front pages ----------------
  $p = Find-Para "TITLE"
  $r = Body-Range $p; $r.Text = $TITLE; $r.Font.Color = 0; $r.Font.Size = 20

  $p = Find-Para "Student Name"
  $r = Body-Range $p; $r.Text = "M. EBIN VIRJO  $([char]0x2013)  24626122"; $r.Font.Color = 0
  $p.Range.InsertParagraphAfter()
  $p2 = $p.Next()
  $r2 = Body-Range $p2; $r2.Text = "K. KIRITHIKA  $([char]0x2013)  24626160"; $r2.Font.Color = 0
  $p2.Alignment = 1; $p2.LeftIndent = $p.LeftIndent; $p2.FirstLineIndent = $p.FirstLineIndent

  $p = Find-Para "Dr. R. KUMUDHAM"; (Body-Range $p).Font.Color = 0
  $p = Find-Para "Oct 2026"; (Body-Range $p).Font.Color = 0

  $p = Find-Para "Certified that this project report"
  Replace-In $p "________________" $TITLE
  Replace-In $p "Student Name  (Reg No)" "M. EBIN VIRJO (24626122) and K. KIRITHIKA (24626160)"

  # bonafide certificate on its own page
  $p = Find-Para "BONAFIDE CERTIFICATE"; $p.PageBreakBefore = -1
  # drop the blank paragraphs that pushed an empty page 2
  for ($n = 0; $n -lt 8; $n++) {
    $prev = $p.Previous()
    if ($null -eq $prev) { break }
    $pt = $prev.Range.Text
    if ($pt.Length -le 1 -and $pt -notmatch "\f") { $null = $prev.Range.Delete() } else { break }
  }

  # yellow highlight on every [Reg No] so it is impossible to miss
  $r = $doc.Content
  $f = $r.Find
  $f.ClearFormatting()
  $f.Text = "[Reg No]"
  $f.Forward = $true; $f.Wrap = 0
  while ($f.Execute()) { $r.HighlightColorIndex = 7; $r.Collapse(0) }

  # ---------------- 2. Remove the template's sample abstract, index and tables; we rebuild them ----------------
  $abs = Find-Para "Abstract"
  $rangeToDelete = $doc.Range($abs.Range.Start, $doc.Content.End)
  $null = $rangeToDelete.Delete()
  # the template's closing thank-you line survives as the last paragraph; keep it as ordinary acknowledgement text
  $lp = $doc.Paragraphs.Last
  if ($lp.Range.Text.TrimStart().StartsWith("We would also")) {
    $lp.Format = $lp.Previous().Format
    $lp.Range.Font.Size = 12; $lp.Range.Font.Bold = 0; $lp.Range.Font.Name = "Times New Roman"
    $lp.Alignment = 3
    $doc.Content.InsertParagraphAfter()
  }

  # ---------------- 3. Styles ----------------
  function New-Style([string]$name, [double]$size, [bool]$bold, [int]$align, [double]$before, [double]$after, [double]$lineMult, [int]$outline, [bool]$keepNext, [bool]$pageBreak) {
    $st = $null
    try { $st = $doc.Styles.Item($name) } catch { $st = $doc.Styles.Add($name, 1) }
    $st.BaseStyle = "Normal"
    $st.Font.Name = "Times New Roman"; $st.Font.Size = $size
    $st.Font.Bold = [int]$bold * -1; $st.Font.Italic = 0; $st.Font.Color = 0
    $pf = $st.ParagraphFormat
    $pf.Alignment = $align; $pf.SpaceBefore = $before; $pf.SpaceAfter = $after
    $pf.LineSpacingRule = 5; $pf.LineSpacing = 12 * $lineMult
    $pf.OutlineLevel = $outline
    $pf.KeepWithNext = [int]$keepNext * -1
    $pf.PageBreakBefore = [int]$pageBreak * -1
    $pf.WidowControl = -1
    $pf.LeftIndent = 0; $pf.FirstLineIndent = 0; $pf.RightIndent = 0
    return $st
  }
  $null = New-Style "RptFront"   16   $true  1 0  18 1.0 10 $true  $true
  $null = New-Style "RptChapter" 16   $true  1 0  18 1.0 1  $true  $true
  $null = New-Style "RptH2"      14   $true  0 12 6  1.0 2  $true  $false
  $null = New-Style "RptH3"      12   $true  0 8  4  1.0 3  $true  $false
  $null = New-Style "RptBody"    12   $false 3 0  6  1.5 10 $false $false
  $null = New-Style "RptCaption" 11   $true  1 4  12 1.0 10 $false $false
  $null = New-Style "RptTCaption" 11  $true  1 10 4  1.0 10 $true  $false
  $null = New-Style "RptFigure"  12   $false 1 6  0  1.0 10 $true  $false
  $null = New-Style "RptTable"   10.5 $false 0 0  0  1.0 10 $false $false
  $null = New-Style "RptRef"     11   $false 3 0  5  1.15 10 $false $false
  $null = New-Style "RptCode"    9    $false 0 0  0  1.0 10 $false $false
  $null = New-Style "RptSpacer"  4    $false 0 0  0  1.0 10 $false $false
  $null = New-Style "RptStep"    12   $false 3 0  4  1.5 10 $false $false
  $doc.Styles.Item("RptStep").ParagraphFormat.LeftIndent = 0.9 * $cm
  $doc.Styles.Item("RptStep").ParagraphFormat.FirstLineIndent = -0.9 * $cm
  $doc.Styles.Item("RptStep").ParagraphFormat.TabStops.ClearAll()
  $null = $doc.Styles.Item("RptStep").ParagraphFormat.TabStops.Add(0.9 * $cm)
  $doc.Styles.Item("RptCode").Font.Name = "Consolas"
  $doc.Styles.Item("RptCode").ParagraphFormat.LeftIndent = 0.3 * $cm
  $doc.Styles.Item("RptCode").ParagraphFormat.Shading.BackgroundPatternColor = 15921906   # RGB(242,242,242)
  $doc.Styles.Item("RptRef").ParagraphFormat.LeftIndent = 1.0 * $cm
  $doc.Styles.Item("RptRef").ParagraphFormat.FirstLineIndent = -1.0 * $cm
  # bullets: based on Word's List Bullet so real bullets are used
  $bs = $null
  try { $bs = $doc.Styles.Item("RptBullet") } catch { $bs = $doc.Styles.Add("RptBullet", 1) }
  $bs.BaseStyle = "List Bullet"
  $bs.Font.Name = "Times New Roman"; $bs.Font.Size = 12; $bs.Font.Bold = 0; $bs.Font.Color = 0
  $bs.ParagraphFormat.Alignment = 3; $bs.ParagraphFormat.SpaceAfter = 3; $bs.ParagraphFormat.SpaceBefore = 0
  $bs.ParagraphFormat.LineSpacingRule = 5; $bs.ParagraphFormat.LineSpacing = 18

  # ---------------- 4. Insertion helpers (always append at the end of the document) ----------------
  function End-Range { return $doc.Range($doc.Content.End - 1, $doc.Content.End - 1) }

  function Add-Runs([string]$text) {
    # **bold** markers switch bold on and off
    $parts = $text -split '\*\*'
    for ($i = 0; $i -lt $parts.Count; $i++) {
      if ($parts[$i].Length -eq 0) { continue }
      $r = End-Range
      $r.InsertAfter(($parts[$i] -replace "`n", $VT))
      $r.Font.Bold = [int]($i % 2 -eq 1) * -1
    }
  }

  function Add-Para([string]$text, [string]$style) {
    $last = $doc.Paragraphs.Last
    $last.Style = $style
    $last.Range.Font.Reset()
    $startPos = $doc.Content.End - 1
    Add-Runs $text
    $para = $doc.Range($startPos, $doc.Content.End - 1)
    $doc.Content.InsertParagraphAfter()
    return $para
  }

  $script:bm = 0
  function Add-Bookmark($range, [string]$prefix) {
    $name = "{0}_{1}" -f $prefix, $script:bm; $script:bm++
    $null = $doc.Bookmarks.Add($name, $range)
    return $name
  }

  function Add-Table($spec, [switch]$forceCaption) {
    if ($spec.caption) { $null = Add-Para $spec.caption "RptTCaption" }
    $nrows = @($spec.rows).Count + 1
    $ncols = @($spec.header).Count
    $doc.Paragraphs.Last.Style = "RptBody"
    $r = End-Range
    $tbl = $doc.Tables.Add($r, $nrows, $ncols)
    $tbl.Range.Style = "RptTable"
    $tbl.AllowAutoFit = $false
    for ($c = 1; $c -le $ncols; $c++) { $tbl.Cell(1, $c).Range.Text = [string]$spec.header[$c - 1] }
    for ($i = 0; $i -lt @($spec.rows).Count; $i++) {
      $row = @($spec.rows)[$i]
      for ($c = 1; $c -le $ncols; $c++) { $tbl.Cell($i + 2, $c).Range.Text = ([string]@($row)[$c - 1]) -replace "`n", $VT }
    }
    $sum = 0; foreach ($x in $spec.widths) { $sum += [double]$x }
    for ($c = 1; $c -le $ncols; $c++) { $tbl.Columns.Item($c).Width = ([double]@($spec.widths)[$c - 1]) * 15.6 / $sum * $cm }
    $tbl.Borders.InsideLineStyle = 1; $tbl.Borders.OutsideLineStyle = 1
    $tbl.Borders.InsideColor = 0; $tbl.Borders.OutsideColor = 0
    $tbl.TopPadding = 2; $tbl.BottomPadding = 2; $tbl.LeftPadding = 4; $tbl.RightPadding = 4
    $tbl.Rows.AllowBreakAcrossPages = 0
    $tbl.Rows.Alignment = 1
    $tbl.Rows.Item(1).HeadingFormat = -1
    $tbl.Rows.Item(1).Range.Font.Bold = -1
    $tbl.Rows.Item(1).Shading.BackgroundPatternColor = 14277081   # RGB(217,217,217)
    $tbl.Range.ParagraphFormat.Alignment = 0
    $tbl.Range.Cells.VerticalAlignment = 0
    if ($spec.boldFirstCol) { for ($i = 2; $i -le $nrows; $i++) { $tbl.Cell($i, 1).Range.Font.Bold = -1 } }
    # a small gap after the table
    $doc.Paragraphs.Last.Style = "RptSpacer"
    $doc.Content.InsertParagraphAfter()
  }

  $script:figNames = @()
  function Add-Figure($spec) {
    $file = "$root\$($spec.file)"
    if (-not (Test-Path $file)) { throw "Missing figure file $file" }
    $doc.Paragraphs.Last.Style = "RptFigure"
    $r = End-Range
    $pic = $doc.InlineShapes.AddPicture($file, $false, $true, $r)
    $pic.LockAspectRatio = -1
    $targetW = [double]$spec.width * $cm
    $pic.Width = $targetW
    $doc.Content.InsertParagraphAfter()
    $cap = Add-Para $spec.caption "RptCaption"
    $null = Add-Bookmark $cap "fig"
  }

  function Add-Code([string[]]$lines) {
    $text = ($lines -join $VT)
    $last = $doc.Paragraphs.Last
    $last.Style = "RptCode"
    $r = End-Range
    $r.InsertAfter($text)
    $doc.Content.InsertParagraphAfter()
    $doc.Paragraphs.Last.Style = "RptSpacer"
    $doc.Content.InsertParagraphAfter()
  }

  # ---------------- 5. Pre-scan the content so the index and list of figures can be built first ----------------
  $content = @{}
  foreach ($n in $Parts) { $content[$n] = @(Read-Json $n | ForEach-Object { $_ }) }
  $front = Read-Json "front"
  $tocEntries = @(); $figEntries = @()
  $tocIndex = 0; $figIndex = 0
  foreach ($n in $Parts) {
    foreach ($b in @($content[$n])) {
      if ($b.t -eq "h1") { $tocEntries += [pscustomobject]@{ level = 1; num = [string]$b.num; title = [string]$b.title; bm = "toc_$tocIndex" }; $tocIndex++ }
      elseif ($b.t -eq "h2") {
        $num, $title = ([string]$b.text) -split " ", 2
        $tocEntries += [pscustomobject]@{ level = 2; num = $num; title = $title; bm = "toc_$tocIndex" }; $tocIndex++
      }
      elseif ($b.t -eq "refs") { $tocEntries += [pscustomobject]@{ level = 1; num = ""; title = "REFERENCES"; bm = "toc_$tocIndex" }; $tocIndex++ }
      elseif ($b.t -eq "fig") {
        $label, $ftitle = ([string]$b.caption) -split ":\s*", 2
        $figEntries += [pscustomobject]@{ num = $label; title = $ftitle; bm = "figx_$figIndex" }; $figIndex++
      }
    }
  }

  # ---------------- 6. Front matter: abstract, index, list of figures, abbreviations ----------------
  $null = Add-Para "Abstract" "RptFront"
  $null = Add-Para ([string]$front.abstract) "RptBody"
  $kw = Add-Para ("**Keywords:** " + [string]$front.keywords) "RptBody"

  $null = Add-Para "INDEX" "RptFront"
  $doc.Paragraphs.Last.Style = "RptSpacer"; $doc.Content.InsertParagraphAfter()
  $idxRows = @(); foreach ($e in $tocEntries) { $idxRows += , @($e.num, $e.title, "00") }
  $idxSpec = [pscustomobject]@{ caption = ""; widths = @(2.6, 10.6, 2.4); header = @("CHAPTER NO", "TITLE", "PAGE NO"); rows = $idxRows }
  $script:idxTableStart = $doc.Content.End - 1
  Add-Table $idxSpec
  $idxTable = $doc.Tables.Item($doc.Tables.Count)
  for ($i = 0; $i -lt $tocEntries.Count; $i++) {
    $row = $idxTable.Rows.Item($i + 2)
    if ($tocEntries[$i].level -eq 1) { $row.Range.Font.Bold = -1 }
    $row.Cells.Item(1).Range.ParagraphFormat.Alignment = 1
    $row.Cells.Item(3).Range.ParagraphFormat.Alignment = 1
    $row.Range.Font.Size = 11.5
  }
  $idxTable.Rows.Item(1).Range.ParagraphFormat.Alignment = 1
  $idxTable.Rows.Item(1).Range.Font.Size = 11.5

  $null = Add-Para "LIST OF FIGURES" "RptFront"
  $doc.Paragraphs.Last.Style = "RptSpacer"; $doc.Content.InsertParagraphAfter()
  $figRows = @(); foreach ($e in $figEntries) { $figRows += , @($e.num, $e.title, "00") }
  $figSpec = [pscustomobject]@{ caption = ""; widths = @(3.0, 10.2, 2.4); header = @("Figure No.", "Title of Figure", "Page No."); rows = $figRows }
  Add-Table $figSpec
  $figTable = $doc.Tables.Item($doc.Tables.Count)
  for ($i = 0; $i -lt $figEntries.Count; $i++) {
    $row = $figTable.Rows.Item($i + 2)
    $row.Cells.Item(1).Range.Font.Bold = -1
    $row.Cells.Item(1).Range.ParagraphFormat.Alignment = 1
    $row.Cells.Item(3).Range.ParagraphFormat.Alignment = 1
    $row.Range.Font.Size = 11.5
  }
  $figTable.Rows.Item(1).Range.ParagraphFormat.Alignment = 1
  $figTable.Rows.Item(1).Range.Font.Size = 11.5

  $null = Add-Para "LIST OF ABBREVIATIONS" "RptFront"
  $doc.Paragraphs.Last.Style = "RptSpacer"; $doc.Content.InsertParagraphAfter()
  $abRows = @(); foreach ($a in @($front.abbreviations)) { $abRows += , @([string]$a[0], [string]$a[1]) }
  Add-Table ([pscustomobject]@{ caption = ""; widths = @(3.2, 12.4); header = @("Abbreviation", "Full form"); rows = $abRows; boldFirstCol = $true })

  # ---------------- 7. Chapters ----------------
  $tocCounter = 0; $figCounter = 0
  foreach ($n in $Parts) {
    foreach ($b in @($content[$n])) {
      switch ($b.t) {
        "h1" {
          $para = Add-Para ("CHAPTER " + $b.num + $VT + $b.title) "RptChapter"
          $null = $doc.Bookmarks.Add("toc_$tocCounter", $para); $tocCounter++
        }
        "refs" {
          $para = Add-Para "REFERENCES" "RptChapter"
          $null = $doc.Bookmarks.Add("toc_$tocCounter", $para); $tocCounter++
          foreach ($ref in @($b.items)) { $null = Add-Para ([string]$ref) "RptRef" }
        }
        "h2" {
          $para = Add-Para ([string]$b.text) "RptH2"
          $null = $doc.Bookmarks.Add("toc_$tocCounter", $para); $tocCounter++
        }
        "h3" { $null = Add-Para ([string]$b.text) "RptH3" }
        "p" { $null = Add-Para ([string]$b.text) "RptBody" }
        "ul" { foreach ($it in @($b.items)) { $null = Add-Para ([string]$it) "RptBullet" } }
        "steps" {
          $k = 1
          foreach ($it in @($b.items)) { $null = Add-Para (([string]$k) + ".`t" + [string]$it) "RptStep"; $k++ }
        }
        "table" { Add-Table $b }
        "fig" {
          Add-Figure $b
          # rename the bookmark that Add-Figure created so the list of figures can find it
          $last = $doc.Bookmarks.Count
          $fb = "figx_$figCounter"
          $capPara = $doc.Paragraphs.Item($doc.Paragraphs.Count - 1).Range
          $null = $doc.Bookmarks.Add($fb, $capPara); $figCounter++
        }
        "code" { Add-Code @($b.lines) }
        "pagebreak" { $r = End-Range; $r.InsertBreak(7) }
        default { throw "Unknown block type: $($b.t)" }
      }
    }
  }

  # remove the empty paragraph left at the very end
  $lastP = $doc.Paragraphs.Last
  if ($lastP.Range.Text.Trim().Length -eq 0 -and $doc.Paragraphs.Count -gt 1) {
    $r = $doc.Range($lastP.Range.Start - 1, $lastP.Range.End - 1)
    $null = $r.Delete()
  }

  # ---------------- 8. Fill in real page numbers ----------------
  for ($i = 0; $i -lt $tocEntries.Count; $i++) {
    $page = $doc.Bookmarks.Item($tocEntries[$i].bm).Range.Information(3)
    $idxTable.Cell($i + 2, 3).Range.Text = [string]$page
  }
  for ($i = 0; $i -lt $figEntries.Count; $i++) {
    $page = $doc.Bookmarks.Item($figEntries[$i].bm).Range.Information(3)
    $figTable.Cell($i + 2, 3).Range.Text = [string]$page
  }

  $doc.Repaginate()
  $doc.Save()
  "Pages: " + $doc.ComputeStatistics(2) + "  Words: " + $doc.ComputeStatistics(0) + "  Tables: " + $doc.Tables.Count + "  Figures: " + $doc.InlineShapes.Count
  $doc.Close(-1)
} finally { $w.Quit() }
