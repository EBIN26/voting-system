$ErrorActionPreference = "Stop"
$out = "D:\claude\test-voting\report\img"
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Rgb([int]$r, [int]$g, [int]$b) { return $r + ($g * 256) + ($b * 65536) }
$BLUE = Rgb 21 96 130; $GREEN = Rgb 46 125 50; $ORANGE = Rgb 176 84 14; $RED = Rgb 160 40 40
$INK = Rgb 31 31 31; $WHITE = Rgb 255 255 255; $PALE = Rgb 238 244 248; $GREY = Rgb 85 85 85
$FONT = "Calibri"

function Add-Node($slide, [int]$type, [double]$cx, [double]$y, [double]$w, [double]$h, [string]$text, [int]$line, [double]$size, [int]$fill) {
  $s = $slide.Shapes.AddShape($type, $cx - $w / 2, $y, $w, $h)
  $s.Fill.ForeColor.RGB = $fill
  $s.Line.ForeColor.RGB = $line
  $s.Line.Weight = 2
  $s.Shadow.Visible = 0
  $tf = $s.TextFrame
  $tf.WordWrap = -1; $tf.AutoSize = 0
  $tf.MarginLeft = 6; $tf.MarginRight = 6; $tf.MarginTop = 3; $tf.MarginBottom = 3
  $tf.VerticalAnchor = 3
  $tr = $tf.TextRange
  $tr.Text = $text
  $tr.Font.Name = $FONT; $tr.Font.Size = $size; $tr.Font.Color.RGB = $INK; $tr.Font.Bold = 0
  $tr.ParagraphFormat.Alignment = 2
  return $s
}
function Add-Line($slide, [double]$x1, [double]$y1, [double]$x2, [double]$y2) {
  $c = $slide.Shapes.AddConnector(1, $x1, $y1, $x2, $y2)
  $c.Line.ForeColor.RGB = $INK; $c.Line.Weight = 2; $c.Line.EndArrowheadStyle = 2
  return $c
}
function Add-Label($slide, [double]$x, [double]$y, [string]$text, [double]$size, [int]$color, [bool]$bold) {
  $t = $slide.Shapes.AddTextbox(1, $x, $y, 200, 22)
  $t.TextFrame.WordWrap = 0
  $t.TextFrame.TextRange.Text = $text
  $t.TextFrame.TextRange.Font.Name = $FONT; $t.TextFrame.TextRange.Font.Size = $size
  $t.TextFrame.TextRange.Font.Color.RGB = $color
  if ($bold) { $t.TextFrame.TextRange.Font.Bold = -1 }
  return $t
}

$app = New-Object -ComObject PowerPoint.Application
try {
  # ================= Figure 3.2: flow chart of the voting process =================
  $pres = $app.Presentations.Add(0)
  $pres.PageSetup.SlideWidth = 900
  $pres.PageSetup.SlideHeight = 1290
  $s = $pres.Slides.AddSlide(1, $pres.SlideMaster.CustomLayouts(7))
  $s.FollowMasterBackground = 0
  $s.Background.Fill.ForeColor.RGB = $WHITE

  $cx = 330; $rx = 735; $w = 330; $h = 52; $gap = 22; $dh = 66
  $y = 14
  $nodes = @()
  # type: 69 terminator, 61 process, 63 decision
  $spec = @(
    @(69, "START: voter presses Vote", $BLUE, $PALE, $h),
    @(61, "Backend checks the request and the election state", $BLUE, $WHITE, $h),
    @(63, "Is voting open?", $ORANGE, $WHITE, $dh),
    @(61, "Verify voter: Keccak-256 voter hash of the identity", $BLUE, $WHITE, $h),
    @(63, "On the electoral roll?", $ORANGE, $WHITE, $dh),
    @(63, "Voting token already issued to this voter?", $ORANGE, $WHITE, $dh),
    @(61, "Issue a one-time voting token and mark the voter as voted", $BLUE, $WHITE, $h),
    @(61, "Encrypt the ballot: RSA-3072 + AES-256-GCM (430 bytes)", $ORANGE, $WHITE, $h),
    @(61, "Send encrypted ballot and token hash to the smart contract", $GREEN, $WHITE, $h),
    @(63, "Contract rules satisfied?", $ORANGE, $WHITE, $dh),
    @(61, "Ballot stored permanently on the blockchain; receipt shown", $GREEN, $PALE, $h),
    @(61, "Voting window ends; the election is closed", $GREEN, $WHITE, $h),
    @(61, "Two or more trustees rebuild the key, decrypt and count", $ORANGE, $WHITE, $h),
    @(63, "Do 2 trustees submit identical totals?", $ORANGE, $WHITE, $dh),
    @(61, "Result finalised on the blockchain; anyone can recount", $GREEN, $PALE, $h),
    @(69, "END", $BLUE, $PALE, 40)
  )
  $tops = @(); $bottoms = @()
  foreach ($sp in $spec) {
    $node = Add-Node $s $sp[0] $cx $y $w $sp[4] $sp[1] $sp[2] 12.5 $sp[3]
    $tops += $y; $bottoms += ($y + $sp[4])
    $y += $sp[4] + $gap
  }
  # arrows down the main column
  for ($i = 0; $i -lt $spec.Count - 1; $i++) {
    $null = Add-Line $s $cx $bottoms[$i] $cx $tops[$i + 1]
  }
  # "Yes" labels beside the downward arrows that leave a decision
  foreach ($i in 2, 4, 9, 13) { $null = Add-Label $s ($cx + 6) ($bottoms[$i] - 1) "Yes" 11 $GREEN $true }
  $null = Add-Label $s ($cx + 6) ($bottoms[5] - 1) "No" 11 $GREEN $true   # token not yet issued: continues

  # rejection / wait boxes on the right, entered from the decisions
  $rej = @(
    @(2, "Reject: voting is not open"),
    @(4, "Reject: not eligible"),
    @(5, "Reject: this voter has already voted"),
    @(9, "Reject: ballot not recorded; token released"),
    @(13, "Wait for the missing trustee, or investigate")
  )
  foreach ($r in $rej) {
    $i = $r[0]
    $mid = $tops[$i] + ($spec[$i][4] / 2)
    $box = Add-Node $s 61 $rx ($mid - 22) 250 44 $r[1] $RED 12 (Rgb 252 238 238)
    $null = Add-Line $s ($cx + $w / 2) $mid ($rx - 125) $mid
    $lbl = "No"; if ($i -eq 5) { $lbl = "Yes" }
    $null = Add-Label $s ($cx + $w / 2 + 4) ($mid - 22) $lbl 11 $RED $true
  }

  $pres.Slides(1).Export("$out\flowchart_raw.png", "PNG", 1800, 2580)
  $pres.Saved = -1; $pres.Close()

  # ================= Figure 3.3: election lifecycle =================
  $pres = $app.Presentations.Add(0)
  $pres.PageSetup.SlideWidth = 960
  $pres.PageSetup.SlideHeight = 235
  $s = $pres.Slides.AddSlide(1, $pres.SlideMaster.CustomLayouts(7))
  $s.FollowMasterBackground = 0
  $s.Background.Fill.ForeColor.RGB = $WHITE
  $phases = @(
    @("SETUP", "Contract deployed with the candidates, trustees and election key hash. Voters can register.", $BLUE),
    @("VOTING", "Ballots accepted from the backend inside the time window, up to the voter limit.", $GREEN),
    @("CLOSED", "No more ballots. Trustees decrypt the ballots and each submits a tally.", $ORANGE),
    @("FINALIZED", "Two identical tallies agreed. Results are public and can be recounted by anyone.", $BLUE)
  )
  $bx = 18; $bw = 205; $bgap = 36
  for ($i = 0; $i -lt 4; $i++) {
    $x = $bx + $i * ($bw + $bgap)
    $b = Add-Node $s 5 ($x + $bw / 2) 40 $bw 125 ($phases[$i][0] + "`r" + $phases[$i][1]) $phases[$i][2] 13 $WHITE
    $b.TextFrame.VerticalAnchor = 1
    $b.TextFrame.TextRange.Paragraphs(1).Font.Bold = -1
    $b.TextFrame.TextRange.Paragraphs(1).Font.Size = 17
    $b.TextFrame.TextRange.Paragraphs(1).Font.Color.RGB = $phases[$i][2]
    $b.TextFrame.TextRange.Paragraphs(1).ParagraphFormat.SpaceAfter = 8
  }
  $trans = @("admin: openElection()", "anyone, after the end time: closeElection()", "2 trustees: submitTally()")
  for ($i = 0; $i -lt 3; $i++) {
    $x = $bx + ($i + 1) * ($bw + $bgap) - $bgap
    $null = Add-Line $s $x 102 ($x + $bgap) 102
    $t = Add-Label $s ($x - 58) 175 $trans[$i] 11.5 $INK $true
    $t.TextFrame.WordWrap = -1; $t.Width = 150; $t.Left = $x - 56; $t.TextFrame.TextRange.ParagraphFormat.Alignment = 2
  }
  $null = Add-Label $s 18 6 "Phases only move forward. Nobody, including the administrator, can go back, skip a phase, or close voting early." 12.5 $GREY $false
  $pres.Slides(1).Export("$out\lifecycle_raw.png", "PNG", 1920, 470)
  $pres.Saved = -1; $pres.Close()

  # ================= Figure 3.4: structure of an encrypted ballot =================
  $pres = $app.Presentations.Add(0)
  $pres.PageSetup.SlideWidth = 960
  $pres.PageSetup.SlideHeight = 360
  $s = $pres.Slides.AddSlide(1, $pres.SlideMaster.CustomLayouts(7))
  $s.FollowMasterBackground = 0
  $s.Background.Fill.ForeColor.RGB = $WHITE
  $null = Add-Label $s 20 10 "Encrypted ballot: 430 bytes, identical for every voter and every candidate" 16 $INK $true
  $segs = @(
    @("Version", "1 byte", 70, $BLUE),
    @("RSA-OAEP wrapped AES key", "384 bytes", 470, $ORANGE),
    @("IV", "12 bytes", 90, $BLUE),
    @("Ciphertext", "17 bytes", 120, $GREEN),
    @("GCM tag", "16 bytes", 110, $BLUE)
  )
  $x = 20
  foreach ($sg in $segs) {
    $b = Add-Node $s 1 ($x + $sg[2] / 2) 60 $sg[2] 80 ($sg[0] + "`r" + $sg[1]) $sg[3] 13 $WHITE
    $b.TextFrame.TextRange.Paragraphs(1).Font.Bold = -1
    $x += $sg[2]
  }
  $null = Add-Label $s 20 160 "What the 17-byte ciphertext protects (the plaintext before AES-256-GCM encryption):" 14 $INK $true
  $p1 = Add-Node $s 1 (20 + 110) 195 220 70 "Candidate number`r1 byte" $GREEN 13 $PALE
  $p2 = Add-Node $s 1 (20 + 220 + 190) 195 380 70 "Random padding`r16 random bytes, so equal votes look different" $GREEN 13 $PALE
  $p1.Left = 20; $p2.Left = 240
  $null = Add-Label $s 20 285 "The election identity (chain number and contract address) is bound in as additional authenticated data, so a ballot cannot be reused in another election." 12.5 $GREY $false
  $pres.Slides(1).Export("$out\ballot_raw.png", "PNG", 1920, 720)
  $pres.Saved = -1; $pres.Close()
  "figures done"
} finally { $app.Quit() }
