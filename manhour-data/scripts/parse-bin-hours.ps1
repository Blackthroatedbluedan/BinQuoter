# Parse 2025 Bin Hours (sheet1) from xlsx without Excel COM
Add-Type -AssemblyName System.IO.Compression.FileSystem
$path = 'c:\Users\Roy\Documents\ManhourData\2025 Man Hour Data.xlsx'
$zip = [System.IO.Compression.ZipFile]::OpenRead($path)

# Shared strings
$ssXml = [xml]([System.IO.StreamReader]::new($zip.GetEntry('xl/sharedStrings.xml').Open()).ReadToEnd())
$strings = [System.Collections.Generic.List[string]]::new()
$silist = @($ssXml.sst.si)
foreach ($si in $silist) {
    if ($si.t) {
        $tx = if ($si.t -is [string]) { $si.t } else { $si.t.InnerText }
        [void]$strings.Add($tx)
    } elseif ($si.r) {
        $sb = [System.Text.StringBuilder]::new()
        foreach ($r in @($si.r)) {
            $tx = if ($r.t -is [string]) { $r.t } else { $r.t.InnerText }
            [void]$sb.Append($tx)
        }
        [void]$strings.Add($sb.ToString())
    } else { [void]$strings.Add('') }
}
$strings = $strings.ToArray()

# Sheet 1 — use local-name() for default namespace
$sheetXml = [xml]([System.IO.StreamReader]::new($zip.GetEntry('xl/worksheets/sheet1.xml').Open()).ReadToEnd())
$rows = $sheetXml.SelectNodes('//*[local-name()="sheetData"]/*[local-name()="row"]')

function Get-CellRef {
    param([string]$ref)
    if ($ref -match '^([A-Z]+)(\d+)$') {
        return @{ Col = $Matches[1]; Row = [int]$Matches[2] }
    }
    return $null
}

function ColToNum([string]$col) {
    $n = 0
    foreach ($ch in $col.ToCharArray()) { $n = $n * 26 + ([int][char]$ch - 64) }
    return $n
}

$grid = @{}  # "row,col" -> @{raw=; text=; num=}
foreach ($row in $rows) {
    $rn = [int]$row.r
    $cells = @($row.c)
    foreach ($c in $cells) {
        $ref = Get-CellRef $c.r
        if (-not $ref) { continue }
        $colNum = ColToNum $ref.Col
        $key = "$rn,$colNum"
        $val = $null
        if ($null -ne $c.v -and "$($c.v)" -ne '') {
            $raw = if ($c.v -is [System.Xml.XmlElement]) { $c.v.InnerText } else { [string]$c.v }
            if ($c.t -eq 's') {
                $idx = [int]$raw
                $val = @{ text = $strings[$idx]; num = $null }
            } else {
                $d = 0.0
                if ([double]::TryParse($raw, [ref]$d)) {
                    $val = @{ text = $null; num = $d }
                } else {
                    $val = @{ text = $raw; num = $null }
                }
            }
        }
        $grid[$key] = $val
    }
}
$zip.Dispose()

$maxRow = ($grid.Keys | ForEach-Object { [int]($_ -split ',')[0] } | Measure-Object -Maximum).Maximum
$colNames = @('Customer','Drive_hrs','Build','BinManufacturer','Diameter','Rings','Bushels_k','Hours','Guys',
  'Sidedraw','Stirator','TopDry','DaySweep','HopperBin','year')

$records = @()
for ($r = 2; $r -le $maxRow; $r++) {
    $h = [ordered]@{}
    foreach ($name in $colNames) { $h[$name] = $null }
    for ($ci = 1; $ci -le 15; $ci++) {
        $k = "$r,$ci"
        $cell = $grid[$k]
        $name = $colNames[$ci-1]
        if ($cell) {
            if ($null -ne $cell.num) { $h[$name] = $cell.num }
            elseif ($null -ne $cell.text) { $h[$name] = $cell.text }
        }
    }
    if ($h['Hours'] -eq $null -and $h['Customer'] -eq $null) { continue }
    $records += [pscustomobject]$h
}

$records | Export-Csv -Path 'c:\Users\Roy\Documents\ManhourData\bin_hours_parsed.csv' -NoTypeInformation -Encoding UTF8

Write-Host "Rows parsed (data rows): $($records.Count)"
Write-Host "Max sheet row index: $maxRow"
$records | Select-Object -First 3 | Format-List
