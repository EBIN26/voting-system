param([string]$Path, [string]$PngPrefix)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
try {
  $doc = $w.Documents.Open($Path, $false, $true, $false)   # no conversion dialog, read-only
  "File: $Path"
  "Pages: " + $doc.ComputeStatistics(2) + "   Paragraphs: " + $doc.Paragraphs.Count + "   Tables: " + $doc.Tables.Count + "   Sections: " + $doc.Sections.Count + "   InlineShapes: " + $doc.InlineShapes.Count + "   Shapes: " + $doc.Shapes.Count
  $ps = $doc.PageSetup
  "Page: " + [math]::Round($ps.PageWidth/72*2.54,1) + " x " + [math]::Round($ps.PageHeight/72*2.54,1) + " cm  margins(cm) T" + [math]::Round($ps.TopMargin/72*2.54,1) + " B" + [math]::Round($ps.BottomMargin/72*2.54,1) + " L" + [math]::Round($ps.LeftMargin/72*2.54,1) + " R" + [math]::Round($ps.RightMargin/72*2.54,1)
  $i = 0
  foreach ($p in $doc.Paragraphs) {
    $i++
    $t = $p.Range.Text -replace "[\r\n\a\f\v]+", " | "
    if ($t.Trim().Length -eq 0 -or $t.Trim() -eq "|") { continue }
    if ($t.Length -gt 140) { $t = $t.Substring(0, 140) + "..." }
    "{0,3} [{1}] {2} {3}pt b={4} al={5} :: {6}" -f $i, $p.Style.NameLocal, $p.Range.Font.Name, $p.Range.Font.Size, $p.Range.Font.Bold, $p.Alignment, $t
  }
  if ($PngPrefix) {
    $n = [math]::Min($doc.ComputeStatistics(2), 6)
    $pane = $doc.ActiveWindow.ActivePane
    for ($k = 1; $k -le $n; $k++) {
      $page = $pane.Pages.Item($k)
      $bytes = $page.EnhMetaFileBits
      $ms = New-Object System.IO.MemoryStream(,$bytes)
      $img = [System.Drawing.Image]::FromStream($ms)
      $bmp = New-Object System.Drawing.Bitmap(1000, [int](1000 * $img.Height / $img.Width))
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.Clear([System.Drawing.Color]::White)
      $g.DrawImage($img, 0, 0, $bmp.Width, $bmp.Height)
      $bmp.Save("$PngPrefix$k.png", [System.Drawing.Imaging.ImageFormat]::Png)
      $g.Dispose(); $bmp.Dispose(); $img.Dispose(); $ms.Dispose()
    }
    "Saved $n page image(s) with prefix $PngPrefix"
  }
  $doc.Close($false)
} finally { $w.Quit() }
