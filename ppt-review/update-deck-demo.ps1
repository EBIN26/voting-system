$ErrorActionPreference = "Stop"
$src = "D:\claude\test-voting\ppt-review\Mini Project - Updated.pptx"
$target = "D:\claude\test-voting\ppt-review\Mini Project - Demo version.pptx"
$renderDir = "D:\claude\test-voting\ppt-review\render-demo"
$img = "D:\claude\test-voting\report\img"
New-Item -ItemType Directory -Force -Path $renderDir | Out-Null
Copy-Item $src $target -Force

function Rgb([int]$r, [int]$g, [int]$b) { return $r + ($g * 256) + ($b * 65536) }
$BLUE = Rgb 21 96 130; $GREEN = Rgb 46 125 50; $ORANGE = Rgb 176 84 14; $INK = Rgb 31 31 31; $GREY = Rgb 85 85 85; $PALE = Rgb 238 244 248
$FONT_UI = "Calibri"

function Set-Rich($tr, [string]$text) {
  $tr.Text = ""
  $parts = $text -split '\*\*'
  for ($i = 0; $i -lt $parts.Count; $i++) {
    if ($parts[$i].Length -eq 0) { continue }
    $r = $tr.InsertAfter(($parts[$i] -replace "`n", "`r"))
    if ($i % 2 -eq 1) { $r.Font.Bold = -1 } else { $r.Font.Bold = 0 }
  }
}
function Add-Text($slide, [double]$x, [double]$y, [double]$w, [double]$h, [string]$text, [double]$size, [int]$color, [bool]$bold, [int]$align) {
  $tb = $slide.Shapes.AddTextbox(1, $x, $y, $w, $h)
  $tb.TextFrame.WordWrap = -1
  $tr = $tb.TextFrame.TextRange
  $tr.Text = $text
  $tr.Font.Name = $FONT_UI; $tr.Font.Size = $size; $tr.Font.Color.RGB = $color
  if ($bold) { $tr.Font.Bold = -1 } else { $tr.Font.Bold = 0 }
  $tr.ParagraphFormat.Alignment = $align
  return $tb
}
function Add-Box($slide, [double]$x, [double]$y, [double]$w, [double]$h, [string]$heading, [string[]]$lines, [int]$color, [double]$size, [bool]$bullets) {
  $b = $slide.Shapes.AddShape(1, $x, $y, $w, $h)
  $b.Fill.ForeColor.RGB = (Rgb 255 255 255); $b.Line.ForeColor.RGB = $color; $b.Line.Weight = 2; $b.Shadow.Visible = 0
  $tf = $b.TextFrame
  $tf.WordWrap = -1; $tf.AutoSize = 0; $tf.VerticalAnchor = 1
  $tf.MarginLeft = 8; $tf.MarginRight = 8; $tf.MarginTop = 6; $tf.MarginBottom = 4
  $tr = $tf.TextRange
  $tr.Text = ($heading + "`r" + ($lines -join "`r"))
  $tr.Font.Name = $FONT_UI; $tr.Font.Size = $size; $tr.Font.Color.RGB = $INK; $tr.Font.Bold = 0
  $tr.ParagraphFormat.Alignment = 1; $tr.ParagraphFormat.SpaceAfter = 2
  $hp = $tr.Paragraphs(1); $hp.Font.Bold = -1; $hp.Font.Size = $size + 1.5; $hp.Font.Color.RGB = $color; $hp.ParagraphFormat.SpaceAfter = 4
  if ($bullets) {
    $t2 = $b.TextFrame2.TextRange
    for ($i = 2; $i -le $t2.Paragraphs().Count; $i++) {
      $p = $t2.Paragraphs($i)
      $p.ParagraphFormat.Bullet.Visible = -1; $p.ParagraphFormat.Bullet.Character = 8226
      $p.ParagraphFormat.LeftIndent = 11; $p.ParagraphFormat.FirstLineIndent = -11
    }
  }
  return $b
}
function Add-Arrow($slide, [double]$x1, [double]$y1, [double]$x2, [double]$y2) {
  $c = $slide.Shapes.AddConnector(1, $x1, $y1, $x2, $y2)
  $c.Line.ForeColor.RGB = $INK; $c.Line.Weight = 2.25; $c.Line.EndArrowheadStyle = 2
  return $c
}
function Set-Notes($slide, [string]$text) { $slide.NotesPage.Shapes.Placeholders(2).TextFrame.TextRange.Text = $text }
function Clear-Slide($slide, [string[]]$keep) {
  for ($i = $slide.Shapes.Count; $i -ge 1; $i--) { if ($keep -notcontains $slide.Shapes($i).Name) { $slide.Shapes($i).Delete() } }
}

$app = New-Object -ComObject PowerPoint.Application
try {
  $pres = $app.Presentations.Open($target, 0, 0, 0)
  $s2 = $pres.Slides(2); $s6 = $pres.Slides(6); $s7 = $pres.Slides(7); $s8 = $pres.Slides(8)
  $s9 = $pres.Slides(9); $s10 = $pres.Slides(10); $s11 = $pres.Slides(11); $s12 = $pres.Slides(12); $s14 = $pres.Slides(14)

  # ---------- Abstract ----------
  Set-Rich $s2.Shapes(2).TextFrame.TextRange (
    "This project is a working **blockchain voting system** that is demonstrated with a single button. The voter opens one web page and presses the Vote button for a candidate; a **backend on a cloud server** then does everything else in about a quarter of a second.`n" +
    "The backend checks that voting is open, verifies the voter through a **Keccak-256 voter hash** on the electoral roll, issues a **one-time voting token** with no link to the voter, **encrypts the ballot** (AES-256-GCM + RSA-3072, always 430 bytes) and records it through a **Solidity smart contract** on an Ethereum blockchain.`n" +
    "The contract enforces the voting window, the voter limit and one ballot per token. The decryption key is split among **three trustees (2 of 3)**, and anyone can recount the votes from the published key. The system runs on an **Oracle Cloud server** (Docker + Caddy HTTPS) and on the **Sepolia** test network, where a full election was run and verified.")

  # ---------- Objectives ----------
  Set-Rich $s6.Shapes(2).TextFrame.TextRange (
    "To build a voting demonstration in which **one button press** runs the whole secure backend process.`n" +
    "To prevent duplicate voting with a **Keccak-256 voter hash** on an electoral roll and a **one-time voting token**.`n" +
    "To keep votes confidential by encrypting every ballot with **RSA-3072 and AES-256-GCM** into a fixed 430 bytes.`n" +
    "To let a **Solidity smart contract**, not the server, enforce one vote per token, the voting window and the voter limit.`n" +
    "To split the decryption key among **trustees (2 of 3)** and make the result **publicly verifiable**.`n" +
    "To package the backend with **Docker and Caddy** for a **cloud server** and the **Sepolia** test network.`n" +
    "To test the system and **measure** its speed and cost.")

  # ---------- Block diagram: use the new picture with the cloud server ----------
  Clear-Slide $s7 @("TextBox 1", "TextBox 3")
  $s7.Shapes("TextBox 3").TextFrame.TextRange.Text = "Voting page, cloud server and blockchain"
  $pic = $s7.Shapes.AddPicture("$img\fig31_architecture_cloud.png", 0, -1, 80, 78, 800, 450)
  $pic.Name = "Architecture picture"

  # ---------- Methodology: the demo flow ----------
  Clear-Slide $s8 @("Title 1")
  $steps = @(
    @("1  Press Vote", "The voter opens one page, picks a voter ID and presses the Vote button for a candidate. The page sends only the ID and the candidate number."),
    @("2  Check and verify", "The backend checks that voting is open, then turns the voter ID into a Keccak-256 voter hash and looks it up on the electoral roll."),
    @("3  One-time token", "A random 32-byte token is made and only its hash is stored, with no link to the voter. The voter is marked as voted, so a second try is refused."),
    @("4  Encrypt the ballot", "The vote is sealed with AES-256-GCM and the key is wrapped with the election's RSA-3072 key. Every ballot is 430 bytes."),
    @("5  Blockchain transaction", "The backend sends the ballot and the token hash to the smart contract, which checks its rules and stores the ballot permanently."),
    @("6  Cloud and election", "The server runs in Docker with Caddy for HTTPS on an Oracle Cloud VM and talks to Sepolia. The administrator opens the election from their own wallet."),
    @("7  Count and verify", "Two of three trustees rebuild the key, decrypt and count. The result is final when two submit the same totals. Anyone can recount.")
  )
  $bw = 210; $bh = 172; $gap = 20; $x0 = 30
  for ($i = 0; $i -lt 7; $i++) {
    if ($i -lt 4) { $x = $x0 + $i * ($bw + $gap); $y = 112 } else { $x = $x0 + (3 - ($i - 4)) * ($bw + $gap); $y = 312 }
    $col = $BLUE; if ($i -eq 3) { $col = $ORANGE }; if ($i -eq 4 -or $i -eq 6) { $col = $GREEN }
    $null = Add-Box $s8 $x $y $bw $bh $steps[$i][0] @($steps[$i][1]) $col 12.5 $false
  }
  for ($i = 0; $i -lt 3; $i++) { $x = $x0 + ($i + 1) * ($bw + $gap) - $gap; $null = Add-Arrow $s8 $x 198 ($x + $gap) 198 }
  $null = Add-Arrow $s8 825 284 825 312
  $null = Add-Arrow $s8 720 398 700 398
  $null = Add-Arrow $s8 490 398 470 398

  # ---------- New slide: live walk-through (after Methodology) ----------
  $walk = $s6.Duplicate().Item(1)
  $walk.MoveTo($s8.SlideIndex + 1)
  $walk.Shapes(2).Delete()
  $walk.Shapes(1).TextFrame.TextRange.Text = "What happens when you press Vote"
  $p = $walk.Shapes.AddPicture("$img\fig32b_pipeline.png", 0, -1, 40, 112, 880, 316)
  $p.Name = "Pipeline picture"
  $null = Add-Text $walk 40 436 880 70 ("Refused votes stop at the step that fails: a second press at step 3 (already voted), a voter not on the roll at step 2, voting not open at step 1. The page shows each step, its time and a receipt: confirmation code, transaction hash and block number.") 15 $INK $false 1

  # ---------- New slide: cloud deployment ----------
  $cloud = $s6.Duplicate().Item(1)
  $cloud.MoveTo($walk.SlideIndex + 1)
  $cloud.Shapes(2).Delete()
  $cloud.Shapes(1).TextFrame.TextRange.Text = "Cloud deployment"
  $null = Add-Box $cloud 50 118 420 360 "HOW IT IS DEPLOYED" @(
    "Oracle Cloud free-tier VM running Ubuntu and Docker (1 GB memory, plus 2 GB swap).",
    "Two containers: the Node.js backend and Caddy.",
    "Caddy gets a free HTTPS certificate for a DuckDNS address.",
    "The database sits on a persistent Docker volume.",
    "The contract is deployed to Sepolia with the administrator's wallet; wallets are funded from a faucet.",
    "One script builds the folder to copy to the server.") $BLUE 17 $true
  $null = Add-Box $cloud 490 118 420 360 "WHAT STAYS OFF THE SERVER" @(
    "The administrator's wallet key.",
    "The trustees' key shares.",
    "The private election key, which exists only as three encrypted shares.",
    "The bundle script checks automatically that none of these is inside the folder.",
    "The server holds only the public key and the backend's submitter key, so a stolen server cannot read votes or change the rules.") $GREEN 17 $true

  # ---------- Security table: remove OTP and Aadhaar wording ----------
  $tbl = $null
  foreach ($sh in $s9.Shapes) { if ($sh.HasTable) { $tbl = $sh.Table } }
  $tbl.Cell(8, 2).Shape.TextFrame.TextRange.Text = "Only keyed hashes are stored: no identity and no vote"
  $tbl.Cell(10, 2).Shape.TextFrame.TextRange.Text = "Rate limits and a strict content security policy"

  # ---------- Results ----------
  Set-Rich $s10.Shapes(2).TextFrame.TextRange (
    "The demonstration was built and tested end to end on a local Ethereum-compatible test network. **107 automated tests** pass: 20 for the smart contract, 75 for the backend and cryptography, and 12 for the deployment tooling.`n" +
    "One press of the Vote button runs **five steps in about 0.23 seconds**: check 29 ms, verify 14 ms, token 11 ms, encrypt 3 ms and blockchain 168 ms. A vote costs about **417,000 gas**, and every ballot is exactly **430 bytes**.`n" +
    "**Live run on the cloud server and Sepolia:** four voters produced **four ballots** in four blocks, a repeated vote and an off-roll voter were **refused**, two trustees submitted the same count, the contract **finalised** it (Ann 2, Ben 1, Cat 1) and a **public recount verified** it.`n" +
    "On Sepolia a ballot used about **1.81 million gas** (the local chain showed 417,000; the difference is not yet explained) and took **7 to 14 seconds** to confirm. Test ether is free, so the cost was zero.`n" +
    "The 0.23 s, per-step times and 417,000 gas are from the local test chain.")

  # ---------- Limitations ----------
  Clear-Slide $s11 @("Google Shape;120;p6", "Google Shape;122;p6", "Text Placeholder 2")
  $null = Add-Box $s11 66 128 400 322 "LIMITATIONS" @(
    "The demo uses dummy voter IDs: there is no proof of real identity.",
    "In the one-button page the server encrypts the ballot, so it sees the voter and the choice together.",
    "One backend submits all ballots.",
    "An online vote cannot stop coercion.",
    "The live run used four voters on a test network; load and main-network cost are not measured.") $ORANGE 18 $true
  $null = Add-Box $s11 494 128 400 322 "FUTURE WORK" @(
    "Explain and reduce the gas used per ballot on Sepolia.",
    "Encrypt in the voter's browser so the server never sees a choice.",
    "Add a real identity check before the voter hash is looked up.",
    "Use zero-knowledge proofs so even the server cannot link voters to votes.",
    "Commission an independent security audit.") $GREEN 18 $true

  # ---------- Timeline: remove the biometric reference ----------
  foreach ($sh in $s12.Shapes) { if ($sh.HasTable) { $sh.Table.Cell(3, 2).Shape.TextFrame.TextRange.Text = "Study existing voting systems, blockchain technology, smart contracts and cryptography." } }

  # ---------- Status ----------
  Set-Rich $s14.Shapes(2).TextFrame.TextRange (
    "The **demonstration is built and working** on a local test network: Solidity smart contract, backend server, hybrid encryption, key splitting among three trustees, the one-button voting page and an admin page.`n" +
    "The workflow runs end to end: voter hash verification, a one-time token, an encrypted ballot recorded on the blockchain, closing, trustee counting and a public recount.`n" +
    "It is also **deployed live**: the contract is on **Sepolia**, the backend runs in **Docker with Caddy HTTPS on an Oracle Cloud server**, and a full four-voter election was run, counted by two trustees and verified publicly.`n" +
    "**Next stage:** encrypt in the browser, add a real identity check, explain the gas difference and carry out security testing.")

  # ---------- Notes ----------
  Set-Notes $s6 "Seven objectives. The first is the point of the demo: one button press runs the whole secure process."
  Set-Notes $s7 "Left to right: the voter's browser, then the cloud server with Caddy, the backend and the database, then the blockchain. Bottom row: key ceremony, administrator, trustees and the public. The server holds only the public key; wallet keys and trustee shares stay with their owners."
  Set-Notes $s8 "Seven steps. Steps 1 to 5 happen when the button is pressed. Step 6 is the cloud and the election set-up. Step 7 is the count after voting closes."
  Set-Notes $walk "Press Vote live. Show the five steps and their times. Then press again as the same voter to show the refusal at step 3, and use the fifth voter to show the refusal at step 2."
  Set-Notes $cloud "This is deployed and was used for a live election. Stress what never goes to the server: the administrator wallet and the trustee shares."
  Set-Notes $s10 "Show the live Etherscan page: one openElection and four castBallot transactions. Local figures: 0.23 s and 417,000 gas. Sepolia: 7 to 14 s and 1.81 million gas, a difference we have not yet explained. Say that yourself before anyone asks."
  Set-Notes $s11 "Say the limitations yourself before anyone asks. The most important one: in the demo page the server encrypts the ballot."

  # the duplicated slides land after Security analysis; put them right after Methodology
  $pres.Slides(10).MoveTo(9)
  $pres.Slides(12).MoveTo(10)

  # ---------- Two evidence slides with the live screenshots, right after Results ----------
  $live = "D:\claude\test-voting\report\img\live"
  $ev1 = $s6.Duplicate().Item(1)
  $ev1.MoveTo($pres.Slides.Count)
  $ev1.MoveTo($s10.SlideIndex + 1)
  $ev1.Shapes(2).Delete()
  $ev1.Shapes(1).TextFrame.TextRange.Text = "Live on the cloud server"
  $pa = $ev1.Shapes.AddPicture("$live\live-2-vote-ok.png", 0, -1, 40, 116, 466, 372)
  $pb = $ev1.Shapes.AddPicture("$live\live-4-refused-roll.png", 0, -1, 530, 116, 393, 372)
  $null = Add-Text $ev1 24 492 920 30 "Left: a vote recorded on Sepolia, with the time of each step. Right: a voter who is not on the electoral roll is refused at step 2." 13 $GREY $false 2

  $ev2 = $s6.Duplicate().Item(1)
  $ev2.MoveTo($pres.Slides.Count)
  $ev2.MoveTo($ev1.SlideIndex + 1)
  $ev2.Shapes(2).Delete()
  $ev2.Shapes(1).TextFrame.TextRange.Text = "Public proof on Sepolia"
  $pc = $ev2.Shapes.AddPicture("$live\live-5-etherscan-contract.png", 0, -1, 200, 112, 560, 258)
  $pd = $ev2.Shapes.AddPicture("$live\live-8-verify.png", 0, -1, 200, 378, 560, 114)
  Set-Notes $ev1 "Left: the live page on the cloud server. Right: the refusal for a voter who is not on the roll."
  Set-Notes $ev2 "Top: the contract on Etherscan with one openElection and four castBallot transactions. Bottom: the trustees' submissions, Finalized, and the public recount that matches."

  $pres.Save()
  foreach ($s in $pres.Slides) { $s.Export("$renderDir\slide$($s.SlideIndex).png", "PNG", 1280, 720) }
  "Saved. Slides: $($pres.Slides.Count)"
  $pres.Close()
} finally { $app.Quit() }
